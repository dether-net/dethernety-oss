import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DtExportSplit, splitToMonolithic, mergeAttributes } from '@dethernety/dt-core'
import { modelStateTool } from '../model-state.tool.js'
import { modelStateWaiveTool } from '../model-state-waive.tool.js'
import { validateModelTool } from '../validate-model.tool.js'
import { applyIdMapping, readModelDirectory, remapLocalSidecars, writeModelDirectory } from '../../utils/directory-utils.js'
import { gateModel, writeGateModel, type GateModel, DATA_CLASS } from '../../utils/__tests__/fixtures/gate-model.js'
import { createHmac } from 'node:crypto'
import { grantMacFor, loadWaiverKey, updateWaiverGrants, waiverMac, waiverMacPayload, withPointerLock, type WaiverRecord } from '../../utils/gates.js'
import { modelHashOf } from '../../utils/settlement.js'
import { registerAll } from './helpers/settle.js'

// Each test registers a whole model (several settle calls): slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const base = process.cwd()
let root: string
let home: string
const realHome = process.env.HOME
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(base, '.test-waive-'))
  // The waiver key lives in the home directory: never the real one here, and never inside the project.
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-waive-home-')))
  process.env.HOME = home
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const REASON = 'The audit feed carries event metadata only; the operator confirmed no class fits it.'

/** The reference with one data item no class fits, as the only item on the audit flow: C4 fails there, nowhere else. */
function unclassifiable(m: GateModel): void {
  m.dataItems.push({ id: 'd-loose', name: 'Vendor audit blob', description: 'Opaque vendor audit payload.' })
  m.dataFlows.find((f) => f.id === 'f-audit')!.dataItemIds = ['d-loose']
}

async function model(mutate?: (m: GateModel) => void, state: Record<string, unknown> | null = ENRICHING, register = true): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  // The operator's values, registered as the workflow registers them.
  if (register) await registerAll(dir)
  if (state) await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(state))
  return dir
}
const state = (dir: string) => JSON.parse(readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8'))
const writeState = (dir: string, s: unknown) => fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(s))
const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir }, context)) as any).data
const waive = (dir: string, criterion: string, element_ids: string[], extra: Record<string, unknown> = {}) =>
  modelStateWaiveTool.run({ directory_path: dir, criterion, element_ids, reason: REASON, basis: 'not_applicable', ...extra }, context) as Promise<any>
const transition = (dir: string, to: string) => modelStateTool.run({ action: 'transition', directory_path: dir, to }, context) as Promise<any>
/** Record (or withdraw) a grant of `record` for `dir` on this machine, as model_state_waive does. */
const grant = async (dir: string, record: WaiverRecord, withdraw = false) => {
  const mac = (await grantMacFor(dir, record))!
  await withPointerLock((lock) => updateWaiverGrants(dir, withdraw ? { remove: [mac] } : { add: [mac] }, lock))
}
const grantsFile = () => path.join(home, '.dethernety', 'waiver-grants.json')
const editAttrs = async (dir: string, group: string, id: string, fn: (a: any, doc: any) => void) => {
  const p = path.join(dir, 'attributes', group, `${id}.json`)
  const doc = JSON.parse(readFileSync(p, 'utf8'))
  fn(doc.attributes, doc)
  await fs.writeFile(p, JSON.stringify(doc))
}

describe('granting a waiver', () => {
  it('lets a model with one unclassifiable data item reach REVIEWED, and shows the waiver', async () => {
    const dir = await model(unclassifiable)
    expect((await transition(dir, 'REVIEWED')).error).toContain('Gate 3 fails (C4)')
    const granted = await waive(dir, 'C4', ['f-audit'])
    expect(granted.success, granted.error).toBe(true)
    const key = path.join(home, '.dethernety', 'waiver.key')
    expect(statSync(key).mode & 0o777).toBe(0o600)

    const promoted = await transition(dir, 'REVIEWED')
    expect(promoted.success, promoted.error).toBe(true)
    expect(promoted.data.display_state).toBe('REVIEWED (1 waiver: C4×1)')
    const g = await get(dir)
    expect(g).toMatchObject({ state: 'REVIEWED', display_state: 'REVIEWED (1 waiver: C4×1)', waivers_in_use: 1, reviewed_stale: false, gate3_without_waivers: 'FAIL' })
    expect(g.waivers).toEqual([{
      criterion: 'C4', id: 'f-audit', name: 'Audit append', status: 'in_use', basis: 'not_applicable', waived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), reason: REASON,
    }])
    expect(state(dir).waivers[0]).toMatchObject({ criterion: 'C4', element_ids: ['f-audit'], reason: REASON, basis: 'not_applicable' })
  })

  it('makes gates and validate agree with model_state', async () => {
    const dir = await model(unclassifiable)
    await waive(dir, 'C4', ['f-audit'])
    const gates = ((await validateModelTool.run({ action: 'gates', directory_path: dir }, context)) as any).data
    expect(gates.gate3).toMatchObject({ verdict: 'PASS', verdict_without_waivers: 'FAIL', waived_total: 1 })
    expect(gates.gate3.criteria.C4.waived.map((w: any) => w.id)).toEqual(['f-audit'])
    expect(gates.gate3.loopback).toMatchObject({ elements: [], elements_total: 0, not_enrichable: [], not_enrichable_total: 0 })
    const validate = ((await validateModelTool.run({ directory_path: dir }, context)) as any).data
    expect(validate.warnings.some((w: any) => w.message.includes('gate3_in_progress'))).toBe(false)
  })

  it('leaves a waived failure off the loop-back list and keeps the rest', async () => {
    const dir = await model(unclassifiable)
    await waive(dir, 'C4', ['f-audit'])
    await editAttrs(dir, 'dataFlows', 'f-submit', (a) => { delete a.encryption_in_transit })
    const gates = ((await validateModelTool.run({ action: 'gates', directory_path: dir }, context)) as any).data
    expect(gates.gate3.verdict).toBe('FAIL')
    expect(gates.gate3.criteria.C4.waived.map((w: any) => w.id)).toEqual(['f-audit'])
    const listed = gates.gate3.loopback.elements.map((e: any) => e.element_id)
    expect(listed).toContain('f-submit')
    expect(listed).not.toContain('f-audit')
    expect(gates.gate3.loopback.elements.find((e: any) => e.element_id === 'f-submit').fields).toEqual(['encryption_in_transit'])
  })

  it.each([
    ['a short reason', { reason: 'too short' }, /reason must be a sentence/],
    ['a line separator', { reason: `A reason that is long enough\u2028with a separator.` }, /reason must be a sentence/],
  ])('refuses %s', async (_label, extra, error) => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'], extra)).error).toMatch(error)
    expect(state(dir).waivers).toBeUndefined()
  })

  it.each([
    ['an element that does not fail', 'C4', ['f-submit'], undefined, /f-submit: does not fail C4/],
    ['C5', 'C5', ['f-submit'], undefined, /C5 is never waived/],
    ['C6', 'C6', ['c-db'], undefined, /C6 is never waived/],
    // Without a class (or a cached template), an element holds only the keys the workflow asks for: its class's own fields go.
    ['C1 on a Tier 1–2 component', 'C1', ['c-web'], (m: GateModel) => {
      delete (m.structure.defaultBoundary.boundaries[1].components[1] as any).classData
      for (const k of ['input_validation', 'runs_as_root']) delete m.attributes.components['c-web']!.attributes[k]
    }, /Tier 1–2 component must be classified/],
    ['a C2 component without a template', 'C2', ['c-db'], (m: GateModel) => {
      delete m.classCache['cls-database']
      for (const id of ['c-db', 'c-audit']) delete m.attributes.components[id]!.attributes.backups_encrypted
    }, /generate_attribute_stubs/],
    ['a C7 floor from a regulatory flag', 'C7', ['d-order'], (m: GateModel) => { m.dataItems.find((i) => i.id === 'd-order')!.sensitivity = 'internal' }, /fixed by the data item's class or reached by one of its regulatory flags/],
    ['six elements at once', 'C4', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], undefined, /at most 5 elements per waiver/],
  ])('refuses %s', async (_label, criterion, ids, mutate, error) => {
    const dir = await model((m) => { unclassifiable(m); (mutate as ((m: GateModel) => void) | undefined)?.(m) })
    const r = await waive(dir, criterion as string, ids as string[])
    expect(r.success).toBe(false)
    expect(r.error).toMatch(error as RegExp)
  })

  it('refuses a waiver without state, and waiving past a quarter of what a criterion assesses', async () => {
    expect((await waive(await model(unclassifiable, null), 'C4', ['f-audit'])).error).toContain('no workflow state')
    // C3 assesses the 6 cross-boundary flows: one may be waived, not two.
    const dir = await model((m) => {
      delete m.attributes.dataFlows['f-submit']!.attributes.auth_failure_mode
      delete m.attributes.dataFlows['f-admin']!.attributes.auth_failure_mode
    })
    expect((await waive(dir, 'C3', ['f-submit'])).success).toBe(true)
    expect((await waive(dir, 'C3', ['f-admin'])).error).toMatch(/at most 1 of the 6 elements C3 assesses/)
  })

  it('refuses waiving C2 and C8 on one element', async () => {
    const dir = await model((m) => {
      // Enough unanswered fields for C2 to fail overall, so c-audit is among its failures.
      for (const k of Object.keys(m.attributes.components['c-audit']!.attributes)) m.attributes.components['c-audit']!.attributes[k] = null
      for (const k of ['backups_encrypted', 'credential_scope', 'encryption_at_rest', 'monitoring_tools', 'implicit_deny_enabled']) m.attributes.components['c-db']!.attributes[k] = null
      // Enough Tier 1–2 components for the share cap to allow one of each.
      for (const b of m.structure.defaultBoundary.boundaries) for (const c of b.components) if (c.type !== 'EXTERNAL_ENTITY') c.crownJewel = true
      m.scope!.crown_jewel_elements['Customer orders'] = walkIds(m)
    })
    expect((await waive(dir, 'C8', ['c-audit'])).success).toBe(true)
    expect((await waive(dir, 'C2', ['c-audit'])).error).toMatch(/C2 and C8 cannot both be waived/)
  })
})

function walkIds(m: GateModel): string[] {
  return m.structure.defaultBoundary.boundaries.flatMap((b: any) => b.components).filter((c: any) => c.type !== 'EXTERNAL_ENTITY').map((c: any) => c.id)
}

describe('waivers that do not count', () => {
  it('ignores a record not signed on this machine', async () => {
    const dir = await model(unclassifiable, {
      ...ENRICHING,
      waivers: [{ criterion: 'C4', element_ids: ['f-audit'], reason: REASON, fingerprints: { 'f-audit': 'x'.repeat(64) }, mac: 'a'.repeat(64) }],
    })
    const g = await get(dir)
    expect(g.waivers).toEqual([expect.objectContaining({ id: 'f-audit', status: 'unverified' })])
    expect(g.gates.gate3).toBe('FAIL')
    expect((await transition(dir, 'REVIEWED')).success).toBe(false)
  })

  it('lets a waiver lapse when its element changes, and when a deleted id comes back as another element', async () => {
    const dir = await model(unclassifiable)
    await waive(dir, 'C4', ['f-audit'])
    const flows = JSON.parse(readFileSync(path.join(dir, 'dataflows.json'), 'utf8'))
    flows.find((f: any) => f.id === 'f-audit').description = 'Now also carries replay tokens.'
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify(flows))
    expect((await get(dir)).waivers).toEqual([expect.objectContaining({ id: 'f-audit', status: 'lapsed' })])

    const reuse = await model(unclassifiable)
    await waive(reuse, 'C4', ['f-audit'])
    const fl = JSON.parse(readFileSync(path.join(reuse, 'dataflows.json'), 'utf8'))
    const audit = fl.find((f: any) => f.id === 'f-audit')
    Object.assign(audit, { name: 'Metrics export', source: { id: 'c-report' } })
    await fs.writeFile(path.join(reuse, 'dataflows.json'), JSON.stringify(fl))
    expect((await get(reuse)).waivers[0].status).toBe('lapsed')
  })

  it('stops counting a revoked waiver, and a demotion keeps waivers but not the review hash', async () => {
    const dir = await model(unclassifiable)
    await waive(dir, 'C4', ['f-audit'])
    await transition(dir, 'REVIEWED')
    expect(state(dir).reviewHash).toMatch(/^[0-9a-f]{64}$/)
    await transition(dir, 'ENRICHING')
    expect(state(dir).reviewHash).toBeUndefined()
    expect(state(dir).waivers).toHaveLength(1)
    const revoked = await waive(dir, 'C4', ['f-audit'], { revoke: true })
    expect(revoked.data.revoked).toEqual({ criterion: 'C4', removed: 1 })
    expect(state(dir).waivers).toEqual([])
    expect((await transition(dir, 'REVIEWED')).success).toBe(false)
  })

  it('refuses a waivers key on model_state', async () => {
    const dir = await model(unclassifiable)
    const r = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED', waivers: [] } as any, context)
    expect(r.success).toBe(false)
  })
})

describe('the push remap', () => {
  it('re-keys waivers with the element ids, and they still count', async () => {
    const dir = await model(unclassifiable)
    await waive(dir, 'C4', ['f-audit'])
    const mapping = new Map([['f-audit', 'F-AUDIT-uuid'], ['c-db', 'C-DB-uuid'], ['d-loose', 'D-LOOSE-uuid']])
    expect(await applyIdMapping(dir, mapping, 'model-1')).toBeUndefined()
    const s = state(dir)
    expect(s.waivers[0].element_ids).toEqual(['F-AUDIT-uuid'])
    expect(Object.keys(s.waivers[0].fingerprints)).toEqual(['F-AUDIT-uuid'])
    expect((await get(dir)).waivers).toEqual([expect.objectContaining({ id: 'F-AUDIT-uuid', status: 'in_use' })])
  })
})

describe('review staleness', () => {
  async function reviewed(mutate?: (m: GateModel) => void): Promise<string> {
    const dir = await model(mutate)
    expect((await transition(dir, 'REVIEWED')).success).toBe(true)
    expect((await get(dir)).reviewed_stale).toBe(false)
    return dir
  }

  it('turns stale on an attribute or name edit, not on a layout edit', async () => {
    const dir = await reviewed()
    const structure = JSON.parse(readFileSync(path.join(dir, 'structure.json'), 'utf8'))
    structure.defaultBoundary.boundaries[1].components[0].positionX += 300
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure))
    expect((await get(dir)).reviewed_stale).toBe(false)
    await editAttrs(dir, 'components', 'c-db', (a) => { a.encryption_at_rest = 'none' })
    // A value nobody registered: the model reads as ENRICHING until the operator confirms it.
    expect(await get(dir)).toMatchObject({ state: 'ENRICHING', display_state: 'ENRICHING (1 unregistered)' })
    await registerAll(dir)
    expect((await get(dir)).reviewed_stale).toBe(true)
    expect((await get(dir)).display_state).toBe('REVIEWED (stale)')
    // REVIEWED again, with the gates passing, re-stamps the review.
    expect((await transition(dir, 'REVIEWED')).data.restamped).toBe(true)
    expect((await get(dir)).reviewed_stale).toBe(false)
    structure.defaultBoundary.boundaries[1].components[0].name = 'Edge gateway'
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure))
    // A rename relabels the element: its values need the operator's confirmation again.
    expect((await get(dir)).state).toBe('ENRICHING')
    await registerAll(dir)
    expect((await get(dir)).reviewed_stale).toBe(true)
  })

  it('stays fresh through a push: new ids, the platform export, and its known rewrites', async () => {
    const dir = await reviewed((m) => {
      delete m.dataFlows.find((f) => f.id === 'f-notify')!.description
      m.dataItems.find((i) => i.id === 'd-card')!.sensitivity = 'Restricted'
      m.dataItems.find((i) => i.id === 'd-audit')!.regulatory_flags = []
    })
    // The push: every element gets a platform id...
    const local = await readModelDirectory(dir)
    const ids = [
      ...local.dataFlows.map((f) => f.id), ...local.dataItems.map((i) => i.id),
      ...JSON.stringify(local.structure).match(/"id":"[^"]+"/g)!.map((x) => x.slice(6, -1)),
    ]
    const mapping = new Map(ids.map((id, i) => [id, `uuid-${i}`]))
    await applyIdMapping(dir, mapping, 'model-1')
    expect((await get(dir)).reviewed_stale).toBe(false)
    // ...then update_model re-exports the model through the platform's shape and merges local attributes back.
    const pushed = await readModelDirectory(dir)
    // The platform holds the asset fields in its own form (camelCase flags, upper-case sensitivity) and
    // returns an empty description as ''; the export converter maps them back.
    const onPlatform = splitToMonolithic(pushed) as any
    const toPlatform = (items: any[] | undefined) => (items ?? []).map((i: any) => {
      const { regulatory_flags, sensitivity, ...rest } = i
      return { ...rest, description: rest.description || '', sensitivity: typeof sensitivity === 'string' ? sensitivity.toUpperCase() : sensitivity, regulatoryFlags: regulatory_flags }
    })
    onPlatform.dataItems = toPlatform(onPlatform.dataItems)
    for (const f of onPlatform.dataFlows ?? []) f.description = f.description || ''
    const exported = (new DtExportSplit({} as any) as any).monolithicToSplit(onPlatform)
    exported.dataFlows.reverse()
    exported.attributes = mergeAttributes(pushed.attributes, exported.attributes)
    await writeModelDirectory(dir, exported)
    await remapLocalSidecars(dir, mapping)
    expect((await get(dir)).reviewed_stale).toBe(false)
  })

  it('reads a REVIEWED with no review hash as stale', async () => {
    const dir = await model(undefined, { ...ENRICHING, currentState: 'REVIEWED' })
    expect(await get(dir)).toMatchObject({ state: 'REVIEWED', reviewed_stale: true, reviewed_stale_reason: 'no review hash recorded' })
  })
})

describe('the key', () => {
  it('refuses a key others can read, so nothing verifies', async () => {
    const dir = await model(unclassifiable)
    await waive(dir, 'C4', ['f-audit'])
    const key = path.join(home, '.dethernety', 'waiver.key')
    await fs.chmod(key, 0o644)
    try {
      expect((await get(dir)).waivers[0].status).toBe('unverified')
    } finally {
      await fs.chmod(key, 0o600)
    }
    expect(existsSync(key)).toBe(true)
    void DATA_CLASS
  })
})

describe('waivers a criterion failing structurally cannot use', () => {
  it('refuses to grant one, and reports a stored one as unwaivable rather than in use', async () => {
    const empty = await model((m) => { m.dataItems.length = 0 })
    const refused = await waive(empty, 'C4', ['f-audit'])
    expect(refused.success).toBe(false)
    expect(refused.error).toContain('C4 fails structurally')

    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const doc = JSON.parse(readFileSync(path.join(dir, 'data-items.json'), 'utf8'))
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify(Array.isArray(doc) ? [] : { ...doc, dataItems: [] }))
    const data = await get(dir)
    expect(data.waivers_in_use).toBe(0)
    expect(JSON.stringify(data)).toContain('C4 fails structurally')
  })
})

describe('the waiver record and the stored state agree', () => {
  it('stamps the same next revision on both, from a negative stored revision too', async () => {
    const dir = await model(unclassifiable, { ...ENRICHING, revision: -5 })
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const s = state(dir)
    expect(s.revision).toBe(1)
    expect(s.waivers[0].revision).toBe(1)
  })
})

describe('where the waiver key may live', () => {
  it('refuses a key inside the project, with a code, and creates nothing there', async () => {
    const inside = await fs.mkdtemp(path.join(base, '.test-waive-inproject-'))
    process.env.HOME = inside
    try {
      const dir = await model(unclassifiable, ENRICHING, false)
      const r = await waive(dir, 'C4', ['f-audit'])
      expect(r.success).toBe(false)
      expect(r.data).toEqual({ codes: ['key_in_project'] })
      expect(existsSync(path.join(inside, '.dethernety'))).toBe(false)
    } finally {
      process.env.HOME = home
      await fs.rm(inside, { recursive: true, force: true })
    }
  })

  it('ignores a signed waiver when the key it was signed with sits inside the project', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    expect((await get(dir)).waivers_in_use).toBe(1)
    const inside = await fs.mkdtemp(path.join(base, '.test-waive-inproject-'))
    // The same key, now reached through a home inside the project.
    await fs.cp(path.join(home, '.dethernety'), path.join(inside, '.dethernety'), { recursive: true })
    process.env.HOME = inside
    try {
      const data = await get(dir)
      expect(data.waivers_in_use).toBe(0)
    } finally {
      process.env.HOME = home
      await fs.rm(inside, { recursive: true, force: true })
    }
  })
})

describe('what a waiver shows', () => {
  it('shows basis, time and reason for a waiver in use, and never the reason in the state line', async () => {
    const canary = 'canary-waiver-reason-91d2'
    const dir = await model(unclassifiable)
    const granted = await modelStateWaiveTool.run({ directory_path: dir, criterion: 'C4', element_ids: ['f-audit'], reason: `${REASON} ${canary}`, basis: 'accepted_risk' }, context) as any
    expect(granted.success, granted.error).toBe(true)
    const g = await get(dir)
    expect(g.waivers[0]).toMatchObject({ status: 'in_use', basis: 'accepted_risk', reason: `${REASON} ${canary}` })
    expect(g.display_state).not.toContain(canary)
    const { waivers: _shown, ...rest } = g
    expect(JSON.stringify(rest)).not.toContain(canary)
  })

  it('omits the reason of a record that is not in use, or that hides invisible characters, and refuses one at grant', async () => {
    const vs = String.fromCodePoint(0xfe00)
    const refused = await modelStateWaiveTool.run({ directory_path: await model(unclassifiable), criterion: 'C4', element_ids: ['f-audit'], reason: `The operator${vs} accepted this gap for the model.` }, context) as any
    expect(refused.success).toBe(false)

    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const s = state(dir)
    const record = s.waivers[0]
    // Granted again on this machine: in use, but its reason now carries an invisible character.
    record.reason = `The operator${vs} accepted this gap for the evaluation model.`
    await grant(dir, record)
    await writeState(dir, s)
    const padded = (await get(dir)).waivers[0]
    expect(padded).toMatchObject({ status: 'in_use', basis: 'not_applicable' })
    expect(padded.waived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(padded).not.toHaveProperty('reason')

    // Its grant withdrawn: listed as unverified, with basis and time but never the reason.
    await grant(dir, record, true)
    const unverified = (await get(dir)).waivers[0]
    expect(unverified).toMatchObject({ status: 'unverified', basis: 'not_applicable' })
    expect(unverified).not.toHaveProperty('reason')
  })
})

describe('whose waiver counts', () => {
  it('counts a waiver only where this machine granted it: not a record with an old signature, a copy, or a teammate\'s', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const record = state(dir).waivers[0]
    expect(record).not.toHaveProperty('mac')
    expect((await get(dir)).waivers_in_use).toBe(1)

    // A record signed the way waivers used to be, with this machine's key and nothing binding it to a directory.
    const old = await model(unclassifiable)
    const legacy = { ...record, mac: createHmac('sha256', (await loadWaiverKey(false, old))!).update(waiverMacPayload(record)).digest('hex') }
    await writeState(old, { ...state(old), waivers: [legacy] })
    let g = await get(old)
    expect([g.waivers_in_use, g.waivers_inherited]).toEqual([0, 1])

    // The same directory copied elsewhere, as a checkout or a restore would put it.
    const copy = path.join(root, `copy${seq++}`)
    await fs.cp(dir, copy, { recursive: true })
    g = await get(copy)
    expect([g.waivers_in_use, g.waivers_inherited]).toEqual([0, 1])
    expect(g.waivers[0].why).toContain('re-grant')
    // Granted there again, with the same criterion, elements and reason: it counts (the copied record stays listed).
    expect((await waive(copy, 'C4', ['f-audit'])).success).toBe(true)
    g = await get(copy)
    expect([g.waivers_in_use, g.waivers_inherited]).toEqual([1, 1])

    // A teammate: another machine, with a key and waivers of its own.
    const teammate = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-waive-teammate-')))
    process.env.HOME = teammate
    try {
      expect((await waive(await model(unclassifiable), 'C4', ['f-audit'])).success).toBe(true)
      expect(await loadWaiverKey(false, dir)).not.toBeNull()
      expect((await get(dir)).waivers_in_use).toBe(0)
    } finally {
      process.env.HOME = home
      await fs.rm(teammate, { recursive: true, force: true })
    }
    expect((await get(dir)).waivers_in_use).toBe(1)
  })

  it('stops counting a record whose grant is gone here, and withdraws the grant with the waiver', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const record = state(dir).waivers[0]
    const mac = (await grantMacFor(dir, record))!
    expect(Object.values(JSON.parse(readFileSync(grantsFile(), 'utf8')).models).flat()).toContain(mac)
    expect((await waive(dir, 'C4', ['f-audit'], { revoke: true })).success).toBe(true)
    expect(Object.values(JSON.parse(readFileSync(grantsFile(), 'utf8')).models).flat()).not.toContain(mac)
    // The record put back, as git would restore it: never counted again.
    await writeState(dir, { ...state(dir), waivers: [record] })
    expect((await get(dir)).waivers_in_use).toBe(0)
  })

  it('grants again what a partial revoke leaves of this machine\'s waiver, and not what it leaves of another\'s', async () => {
    const dir = await model(unclassifiable)
    const record: WaiverRecord = { criterion: 'C4', element_ids: ['f-audit', 'f-other'], reason: REASON, basis: 'not_applicable', waived_at: '2026-01-01T00:00:00Z', revision: 1, fingerprints: { 'f-audit': 'a'.repeat(64), 'f-other': 'b'.repeat(64) } }
    const foreign: WaiverRecord = { ...record, criterion: 'C3', fingerprints: { 'f-audit': 'c'.repeat(64), 'f-other': 'd'.repeat(64) } }
    await writeState(dir, { ...state(dir), waivers: [record, foreign] })
    await grant(dir, record)
    expect((await waive(dir, 'C4', ['f-other'], { revoke: true })).success).toBe(true)
    expect((await waive(dir, 'C3', ['f-other'], { revoke: true })).success).toBe(true)
    const [rest, foreignRest] = state(dir).waivers
    const granted = Object.values(JSON.parse(readFileSync(grantsFile(), 'utf8')).models).flat()
    expect(granted).toContain(await grantMacFor(dir, rest))
    expect(granted).not.toContain(await grantMacFor(dir, record))
    expect(granted).not.toContain(await grantMacFor(dir, foreignRest))
  })

  it('refuses to grant, and verifies nothing, while the grants file cannot be trusted', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const saved = readFileSync(grantsFile())
    for (const bad of ['not json', JSON.stringify({ version: 2, models: {} }), JSON.stringify({ version: 1, models: { x: ['y'] } })]) {
      await fs.writeFile(grantsFile(), bad, { mode: 0o600 })
      try {
        expect((await get(dir)).waivers_in_use).toBe(0)
        const r = await waive(await model(unclassifiable), 'C4', ['f-audit'])
        expect([bad, r.data?.codes]).toEqual([bad, ['waiver_grants_unavailable']])
      } finally {
        await fs.writeFile(grantsFile(), saved, { mode: 0o600 })
      }
    }
    expect((await get(dir)).waivers_in_use).toBe(1)
    // Readable by others: not trusted either.
    await fs.chmod(grantsFile(), 0o644)
    try {
      expect((await get(dir)).waivers_in_use).toBe(0)
    } finally {
      await fs.chmod(grantsFile(), 0o600)
    }
  })
})

describe('a grant, exactly', () => {
  it('stops counting a granted record once any part it was granted with changes, and keeps it through a push re-key', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const record = state(dir).waivers[0]
    const edits: Array<[string, (r: any) => void]> = [
      ['reason', (r) => { r.reason = `${REASON} Also this.` }],
      ['basis', (r) => { r.basis = 'accepted_risk' }],
      ['basis removed', (r) => { delete r.basis }],
      ['criterion', (r) => { r.criterion = 'C3' }],
      ['revision', (r) => { r.revision += 1 }],
      ['waived_at', (r) => { r.waived_at = '2020-01-01T00:00:00.000Z' }],
      ['fingerprint', (r) => { r.fingerprints['f-audit'] = 'f'.repeat(64) }],
    ]
    for (const [what, edit] of edits) {
      const changed = structuredClone(record)
      edit(changed)
      await writeState(dir, { ...state(dir), waivers: [changed] })
      expect([what, (await get(dir)).waivers[0].status]).toEqual([what, 'unverified'])
    }
    await writeState(dir, { ...state(dir), waivers: [record] })
    expect((await get(dir)).waivers_in_use).toBe(1)
    // The same MAC the settlement's model hash gives: one name for a directory. Another key gives another MAC.
    const key = (await loadWaiverKey(false, dir))!
    const hash = modelHashOf(key, await fs.realpath(dir))
    expect(await grantMacFor(dir, record)).toBe(waiverMac(key, hash, record))
    expect(waiverMac(Buffer.alloc(32, 7), hash, record)).not.toBe(waiverMac(key, hash, record))
  })

  it('takes a grant back when the state cannot be written, and keeps a revoked grant when it cannot be removed', async () => {
    const dir = await model(unclassifiable)
    const tool = modelStateWaiveTool as any
    const write = vi.spyOn(tool, 'write').mockRejectedValueOnce(new Error('state write failed'))
    const before = existsSync(grantsFile()) ? readFileSync(grantsFile(), 'utf8') : null
    try {
      expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(false)
    } finally {
      write.mockRestore()
    }
    expect(existsSync(grantsFile()) ? readFileSync(grantsFile(), 'utf8') : null).toBe(before)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const granted = readFileSync(grantsFile(), 'utf8')
    const failing = vi.spyOn(tool, 'write').mockRejectedValueOnce(new Error('state write failed'))
    try {
      expect((await waive(dir, 'C4', ['f-audit'], { revoke: true })).success).toBe(false)
    } finally {
      failing.mockRestore()
    }
    expect(readFileSync(grantsFile(), 'utf8')).toBe(granted)
    expect((await get(dir)).waivers_in_use).toBe(1)
  })

  it('refuses a revoke it cannot withdraw, and a grant past what the grants file may hold', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const saved = readFileSync(grantsFile())
    await fs.writeFile(grantsFile(), 'not json', { mode: 0o600 })
    try {
      const r = await waive(dir, 'C4', ['f-audit'], { revoke: true })
      expect(r.data?.codes).toEqual(['waiver_grants_unavailable'])
      expect(state(dir).waivers).toHaveLength(1)
    } finally {
      await fs.writeFile(grantsFile(), saved, { mode: 0o600 })
    }
    // A model whose grants are at the limit.
    const doc = JSON.parse(readFileSync(grantsFile(), 'utf8'))
    const full = await model(unclassifiable)
    const key = (await loadWaiverKey(false, full))!
    const fullHash = modelHashOf(key, await fs.realpath(full))
    doc.models[fullHash] = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(64, '0'))
    await fs.writeFile(grantsFile(), JSON.stringify(doc), { mode: 0o600 })
    try {
      const r = await waive(full, 'C4', ['f-audit'])
      expect(r.data?.codes).toEqual(['waiver_grants_full'])
    } finally {
      await fs.writeFile(grantsFile(), saved, { mode: 0o600 })
    }
  })

  it('trusts the grants file only as a regular 0600 file of the format, never through a link', async () => {
    const dir = await model(unclassifiable)
    expect((await waive(dir, 'C4', ['f-audit'])).success).toBe(true)
    const saved = readFileSync(grantsFile(), 'utf8')
    const doc = JSON.parse(saved)
    const [hash] = Object.keys(doc.models)
    // Each keeps the real grant, beside one thing that is not the format.
    const bad = [
      JSON.stringify({ version: 1, models: { ...doc.models, ['NOT-A-HASH'.padEnd(64, 'x')]: [] } }),
      JSON.stringify({ version: 1, models: { ...doc.models, [hash!]: [...doc.models[hash!], 'z'.repeat(64)] } }),
      saved.padEnd(8 * 1024 * 1024 + 10, ' '),
    ]
    for (const content of bad) {
      await fs.writeFile(grantsFile(), content, { mode: 0o600 })
      expect([content.slice(0, 40), (await get(dir)).waivers_in_use]).toEqual([content.slice(0, 40), 0])
    }
    await fs.writeFile(grantsFile(), saved, { mode: 0o600 })
    expect((await get(dir)).waivers_in_use).toBe(1)
    // A link at the grants file, and at the key directory: nothing verifies.
    const elsewhere = path.join(root, `grants-${seq++}.json`)
    await fs.writeFile(elsewhere, saved, { mode: 0o600 })
    await fs.rm(grantsFile())
    await fs.symlink(elsewhere, grantsFile())
    expect((await get(dir)).waivers_in_use).toBe(0)
    await fs.rm(grantsFile())
    await fs.writeFile(grantsFile(), saved, { mode: 0o600 })
    const keyDir = path.join(home, '.dethernety')
    const moved = path.join(root, `keydir-${seq++}`)
    await fs.rename(keyDir, moved)
    await fs.symlink(moved, keyDir)
    try {
      expect((await get(dir)).waivers_in_use).toBe(0)
    } finally {
      await fs.rm(keyDir)
      await fs.rename(moved, keyDir)
    }
    expect((await get(dir)).waivers_in_use).toBe(1)
  })

  it('counts as inherited only the waived elements it lists that this machine did not grant', async () => {
    const dir = await model(unclassifiable)
    // Granted here, but no longer matching its element: lapsed, not inherited.
    const lapsed: WaiverRecord = { criterion: 'C4', element_ids: ['f-audit'], reason: REASON, waived_at: '2026-01-01T00:00:00Z', revision: 1, fingerprints: { 'f-audit': 'c'.repeat(64) } }
    await grant(dir, lapsed)
    await writeState(dir, { ...state(dir), waivers: [
      { criterion: 'C4', element_ids: ['f-audit', 'no-such-element'], reason: REASON, fingerprints: { 'f-audit': 'a'.repeat(64), 'no-such-element': 'b'.repeat(64) } },
      lapsed,
    ] })
    const g = await get(dir)
    expect(g.waivers.map((w: any) => [w.id, w.status])).toEqual([['f-audit', 'unverified'], ['f-audit', 'lapsed']])
    expect(g.waivers_inherited).toBe(1)
  })
})

describe('an inherited waiver shown for a re-grant', () => {
  it('shows the reason it was recorded with, and never takes it as the operator\'s', async () => {
    const dir = await model(unclassifiable)
    const record = { criterion: 'C4', element_ids: ['f-audit'], reason: REASON, basis: 'not_applicable', waived_at: '2026-01-01T00:00:00Z', revision: 1, fingerprints: { 'f-audit': 'a'.repeat(64) } }
    await writeState(dir, { ...state(dir), waivers: [record] })
    const [use] = (await get(dir)).waivers
    expect(use).toMatchObject({ status: 'unverified', recorded_reason: REASON })
    expect(use).not.toHaveProperty('reason')
    // A re-grant takes the operator's own reason: none is refused, as always.
    const none = await modelStateWaiveTool.run({ directory_path: dir, criterion: 'C4', element_ids: ['f-audit'], reason: '' }, context) as any
    expect(none.success).toBe(false)
    expect((await get(dir)).waivers_in_use).toBe(0)
  })

  it('shows a recorded reason that cannot be shown safely only as its hash', async () => {
    const dir = await model(unclassifiable)
    const hidden = `The operator${String.fromCodePoint(0xfe00)} accepted this gap for the model.`
    const mixed = 'The operator accepted this gap for PаyPal events.'
    for (const reason of [hidden, mixed]) {
      await writeState(dir, { ...state(dir), waivers: [{ criterion: 'C4', element_ids: ['f-audit'], reason, fingerprints: { 'f-audit': 'a'.repeat(64) } }] })
      const [use] = (await get(dir)).waivers
      expect(use.recorded_reason).toEqual({ undisplayable: true, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
      expect(JSON.stringify(use)).not.toContain(reason)
    }
  })
})
