/**
 * The loop-back guard: once a loop-back is armed, Gate 3 is computed again only when every element it listed was
 * touched (changed, removed, fixed or waived) or dropped with a reason; Gates 1 and 2 always are. And the zone a
 * boundary that allows any inbound traffic is proposed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelStateTool } from '../model-state.tool.js'
import { validateModelTool } from '../validate-model.tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { LOOP_BACK_ARM } from '../../utils/gates.js'
import { writeClassCache } from '../../acceptance/key.js'

vi.setConfig({ testTimeout: 30_000 })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  // Models inside the working directory, as the tools confine model paths to it; the home elsewhere.
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-loop-back-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-loop-back-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  const h = path.join(homes, `h${seq++}`)
  await fs.mkdir(h)
  process.env.HOME = h
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }

/** Four elements on the loop-back list: c-web (C2, C8), f-submit (C3, C8), d-card (C7), c-db (C9). */
function failing(m: GateModel): void {
  const web = m.attributes.components['c-web']!.attributes
  for (const k of Object.keys(web)) web[k] = null
  web.authentication_type = 'TBC'
  const submit = m.attributes.dataFlows['f-submit']!.attributes
  submit.auth_failure_mode = 'unknown'
  delete submit.encryption_in_transit
  m.dataItems.find((i) => i.id === 'd-card')!.sensitivity = 'internal'
  m.attributes.components['c-db']!.attributes.credential_scope = ['db-app-cred', 'backup-cred']
}

async function model(mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
  return dir
}

const run = async (input: Record<string, unknown>) => (await modelStateTool.run(input as never, { debug: false } as never)) as any
const loopBack = (dir: string, extra: Record<string, unknown> = {}) => run({ action: 'loop_back', directory_path: dir, ...extra })
const gates = async (dir: string) => {
  const r = (await validateModelTool.run({ action: 'gates', directory_path: dir } as never, {} as never)) as any
  expect(r.success, r.error).toBe(true)
  return r.data
}
const record = (dir: string) => path.join(dir, '.dethereal', 'loop-back.json')
const attrFile = (dir: string, group: string, id: string) => path.join(dir, 'attributes', group, `${id}.json`)
const editJson = (file: string, edit: (v: any) => void) => {
  const v = JSON.parse(readFileSync(file, 'utf8'))
  edit(v)
  writeFileSync(file, JSON.stringify(v, null, 2))
}
const setAttr = (dir: string, group: string, id: string, field: string, value: unknown) => editJson(attrFile(dir, group, id), (v) => { v.attributes[field] = value })
const untouchedIds = (g: any) => g.gate3.loop_back.untouched.map((e: any) => e.element_id).sort()
const statusOf = (g: any, id: string) => g.loop_back_round.elements.find((e: any) => e.element_id === id)?.status

describe('arming a loop-back', () => {
  it('arms nothing while Gate 3 passes', async () => {
    const dir = await model()
    expect((await loopBack(dir)).data).toMatchObject({ armed: false })
    expect(existsSync(record(dir))).toBe(false)
    expect((await gates(dir)).gate3.verdict).toBe('PASS')
  })

  it('tells a failing report how a loop-back starts', async () => {
    const dir = await model(failing)
    const g = await gates(dir)
    expect(g.gate3.verdict).toBe('FAIL')
    expect(g.gate3.loopback.arm).toBe(LOOP_BACK_ARM)
  })

  it('holds Gate 3 back, never Gates 1 and 2, and lists what is untouched as the worklist', async () => {
    const dir = await model(failing)
    const armed = await loopBack(dir)
    expect(armed.data).toMatchObject({ armed: true, elements_total: 4 })
    const before = readFileSync(record(dir))
    const g = await gates(dir)
    expect(g.gate1.verdict).toBeDefined()
    expect(g.gate2.verdict).toBe('PASS')
    expect(g.gate3).toMatchObject({ verdict: 'NOT_COMPUTED', code: 'loopback_untouched', loop_back: { untouched_total: 4, touched_total: 0, dropped_total: 0 } })
    expect(untouchedIds(g)).toEqual(['c-db', 'c-web', 'd-card', 'f-submit'])
    // The worklist has the loop-back list's own shape.
    expect(g.gate3.loop_back.untouched.find((e: any) => e.element_id === 'f-submit')).toEqual({
      element_id: 'f-submit', name: expect.any(String), kind: 'flow', criteria: ['C3', 'C8'], fields: ['auth_failure_mode', 'encryption_in_transit'],
    })
    expect(g.gate3.message).toMatch(/^Gate 3 is not computed yet: 4 loop-back element\(s\) are untouched since the loop-back started: /)
    expect(g.gate3.message).toMatch(/drop: \[\{ element_id, reason \}\] \(drop_remaining: \{ reason \} for all of them\).*Gates 1 and 2 are computed; Gate 3 is not\.$/)
    // A gates call only reads the record.
    expect(readFileSync(record(dir)).equals(before)).toBe(true)
    // Arming again keeps a record that still has untouched elements.
    expect((await loopBack(dir)).data).toMatchObject({ armed: true, kept: true, untouched_total: 4 })
    expect(readFileSync(record(dir)).equals(before)).toBe(true)
    // get shows it, for a resumed session.
    expect((await run({ action: 'get', directory_path: dir })).data.loop_back).toMatchObject({ armed: true, elements: 4, dropped: 0 })
  })

  it('does not count a change made before the arm', async () => {
    const dir = await model(failing)
    // The operator's answer registered first, then the arm: the change is already in the armed values.
    setAttr(dir, 'dataFlows', 'f-submit', 'encryption_in_transit', 'TLS 1.3')
    await loopBack(dir)
    expect(untouchedIds(await gates(dir))).toContain('f-submit')
  })
})

describe('what touches an element', () => {
  it('counts a real value the enricher writes, with its pending row, and nothing hollow', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    // The enricher: the attribute file's listed field from empty to a sourced value, and a pending row for the operator.
    setAttr(dir, 'dataFlows', 'f-submit', 'encryption_in_transit', 'TLS 1.3')
    writeFileSync(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({
      version: 1, entries: [{ batch: 'b1', element_id: 'f-submit', group: 'dataFlows', field: 'encryption_in_transit', value: 'TLS 1.3', source: 'deploy/app.yaml:12', previous: null }],
    }))
    // A stand-in is no answer, and a field the element does not list does not count.
    setAttr(dir, 'components', 'c-web', 'authentication_type', 'unknown')
    setAttr(dir, 'components', 'c-db', 'monitoring_tools', ['splunk'])
    // The data item's sensitivity is on the item itself.
    editJson(path.join(dir, 'data-items.json'), (v) => { (Array.isArray(v) ? v : v.dataItems).find((i: any) => i.id === 'd-card').sensitivity = 'restricted' })
    const g = await gates(dir)
    expect(g.gate3.verdict).toBe('NOT_COMPUTED')
    expect(untouchedIds(g)).toEqual(['c-db', 'c-web'])
    expect(g.gate3.loop_back).toMatchObject({ untouched_total: 2, touched_total: 2, dropped_total: 0 })
  })

  it('counts new data-item links on an element that lists no field', async () => {
    const dir = await model((m) => { m.dataFlows.find((f) => f.id === 'f-audit')!.dataItemIds = [] })
    await loopBack(dir)
    const g = await gates(dir)
    expect(g.gate3.loop_back.untouched.find((e: any) => e.element_id === 'f-audit')).toMatchObject({ criteria: ['C4'], fields: [] })
    editJson(path.join(dir, 'dataflows.json'), (v) => { (Array.isArray(v) ? v : v.dataFlows).find((f: any) => f.id === 'f-audit').dataItemIds = ['d-order'] })
    const after = await gates(dir)
    expect(after.gate3.verdict).not.toBe('NOT_COMPUTED')
    expect(statusOf(after, 'f-audit')).toMatch(/^(changed|not_listed)$/)
  })

  it('ends a round once every element is touched or dropped, reports how each left, and keeps reporting it', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    setAttr(dir, 'dataFlows', 'f-submit', 'encryption_in_transit', 'TLS 1.3')
    setAttr(dir, 'dataFlows', 'f-submit', 'auth_failure_mode', 'deny')
    editJson(path.join(dir, 'data-items.json'), (v) => { (Array.isArray(v) ? v : v.dataItems).find((i: any) => i.id === 'd-card').sensitivity = 'restricted' })
    setAttr(dir, 'components', 'c-web', 'input_validation', 'schema')
    expect((await loopBack(dir, { drop: [{ element_id: 'c-db', reason: 'The operator does not know which credentials the backup job uses.' }] })).data)
      .toMatchObject({ armed: true, dropped_now: 1, untouched_total: 0 })
    const g = await gates(dir)
    expect(g.gate3.verdict).toBe('FAIL')
    expect(g.loop_back_round.nothing_changed).toBe(false)
    expect(statusOf(g, 'c-db')).toBe('dropped')
    expect(g.loop_back_round.elements.find((e: any) => e.element_id === 'c-db').reason).toMatch(/^The operator does not know/)
    expect(statusOf(g, 'c-web')).toBe('changed')
    expect(statusOf(g, 'f-submit')).toMatch(/^(changed|not_listed)$/)
    // Still a reader: the next call is never held back, and reports the same round.
    const again = await gates(dir)
    expect(again.gate3.verdict).toBe('FAIL')
    expect(again.loop_back_round).toEqual(g.loop_back_round)
    // A new loop-back replaces the satisfied record.
    expect((await loopBack(dir)).data).toMatchObject({ armed: true })
    expect((await gates(dir)).gate3.verdict).toBe('NOT_COMPUTED')
  })
})

describe('the way out', () => {
  it('drops what is left with one reason, and says when nothing changed', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    expect((await loopBack(dir, { drop_remaining: { reason: 'The operator chose to move on without these answers.' } })).data)
      .toMatchObject({ dropped_now: 4, untouched_total: 0, dropped_total: 4 })
    const g = await gates(dir)
    expect(g.gate3.verdict).toBe('FAIL')
    expect(g.loop_back_round.nothing_changed).toBe(true)
  })

  it('refuses a drop it cannot place or a reason that is not words', async () => {
    const dir = await model(failing)
    expect((await loopBack(dir, { drop: [{ element_id: 'c-web', reason: 'x' }] })).data.codes).toEqual(['loop_back_not_armed'])
    await loopBack(dir)
    expect((await loopBack(dir, { drop: [{ element_id: 'c-nowhere', reason: 'gone' }] })).data.codes).toEqual(['loop_back_unknown_element'])
    for (const reason of ['   ', 'y'.repeat(501), `no${String.fromCharCode(7)}`]) {
      expect((await loopBack(dir, { drop: [{ element_id: 'c-web', reason }] })).data.codes, JSON.stringify(reason.slice(0, 5))).toEqual(['reason_invalid'])
    }
    expect((await loopBack(dir, { drop: Array.from({ length: 51 }, () => ({ element_id: 'c-web', reason: 'r' })) })).success).toBe(false)
  })

  it('leaves an unreadable record a way out: drop_remaining removes it, a new arm replaces it', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    writeFileSync(record(dir), '{ not json')
    const g = await gates(dir)
    expect(g.gate2.verdict).toBe('PASS')
    expect(g.gate3).toMatchObject({ verdict: 'NOT_COMPUTED', code: 'loop_back_unreadable' })
    expect((await loopBack(dir, { drop: [{ element_id: 'c-web', reason: 'r' }] })).data.codes).toEqual(['loop_back_unreadable'])
    expect((await loopBack(dir, { drop_remaining: { reason: 'The record was damaged.' } })).data).toMatchObject({ armed: false, cleared: true })
    expect(existsSync(record(dir))).toBe(false)
    expect((await gates(dir)).gate3.verdict).toBe('FAIL')
    writeFileSync(record(dir), JSON.stringify({ version: 1, armed_at: 'x', elements: [{ element_id: 'c-web' }] }))
    expect((await loopBack(dir)).data).toMatchObject({ armed: true, elements_total: 4 })
  })

  it('never lets REVIEWED through an untouched element, and keeps the loop-back across a backward transition', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    expect((await run({ action: 'transition', directory_path: dir, to: 'REVIEWED' })).success).toBe(false)
    const armed = readFileSync(record(dir), 'utf8')
    const back = await run({ action: 'transition', directory_path: dir, to: 'STRUCTURE_COMPLETE' })
    expect(back.success).toBe(true)
    expect(back.data.loop_back).toEqual({ kept: true, armed: true, armed_at: JSON.parse(armed).armed_at, elements: 4, dropped: 0, untouched_total: 4 })
    expect(back.data.loop_back_note).toMatch(/^The loop-back stays open across this transition: .* \(now 4\), Gate 3 is not computed: .*Arming again does not replace the record/)
    // Kept as it was armed: nothing is re-hashed, and arming again does not replace it.
    expect(readFileSync(record(dir), 'utf8')).toBe(armed)
    expect((await gates(dir)).gate3.verdict).toBe('NOT_COMPUTED')
    expect((await run({ action: 'transition', directory_path: dir, to: 'ENRICHING' })).data.loop_back).toBeUndefined()
    expect((await loopBack(dir)).data).toMatchObject({ armed: true, kept: true, untouched_total: 4 })
    expect(readFileSync(record(dir), 'utf8')).toBe(armed)
    expect((await run({ action: 'transition', directory_path: dir, to: 'REVIEWED' })).success).toBe(false)
    expect((await run({ action: 'get', directory_path: dir })).data.loop_back).toMatchObject({ armed: true, elements: 4 })
  })

  it('keeps the loop-back when a review whose content moved on goes back to enrichment', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    const armed = readFileSync(record(dir), 'utf8')
    await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify({
      ...ENRICHING, currentState: 'REVIEWED', completedStates: [...ENRICHING.completedStates, 'ENRICHING', 'REVIEWED'], reviewHash: 'f'.repeat(64),
    }))
    const back = await run({ action: 'transition', directory_path: dir, to: 'ENRICHING' })
    expect(back.data).toMatchObject({ from: 'REVIEWED', to: 'ENRICHING', loop_back: { kept: true, armed: true, untouched_total: 4 } })
    expect(readFileSync(record(dir), 'utf8')).toBe(armed)
  })

  it('says nothing of a loop-back on a backward transition when none is armed', async () => {
    const dir = await model(failing)
    await fs.writeFile(path.join(dir, '.dethereal', 'quality.json'), '{}')
    const back = await run({ action: 'transition', directory_path: dir, to: 'STRUCTURE_COMPLETE' })
    expect(back.success).toBe(true)
    expect(back.data).not.toHaveProperty('loop_back')
    expect(back.data).not.toHaveProperty('loop_back_note')
    expect(existsSync(path.join(dir, '.dethereal', 'quality.json'))).toBe(false)
    expect(existsSync(record(dir))).toBe(false)
  })

  it('keeps a finished loop-back across a backward transition, and Gate 3 stays computed', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    await loopBack(dir, { drop_remaining: { reason: 'The operator chose to move on without these answers.' } })
    const back = await run({ action: 'transition', directory_path: dir, to: 'STRUCTURE_COMPLETE' })
    expect(back.data.loop_back).toMatchObject({ kept: true, armed: true, dropped: 4, untouched_total: 0 })
    expect(back.data.loop_back_note).toMatch(/^The loop-back record is kept: every armed element is touched or dropped, so Gate 3 is computed\./)
    expect((await gates(dir)).gate3.verdict).toBe('FAIL')
  })

  it('keeps an unreadable record across a backward transition, with drop_remaining still its way out', async () => {
    const dir = await model(failing)
    await loopBack(dir)
    writeFileSync(record(dir), '{ not json')
    const back = await run({ action: 'transition', directory_path: dir, to: 'STRUCTURE_COMPLETE' })
    expect(back.data.loop_back).toEqual({ kept: true, armed: null, unreadable: true })
    expect(back.data.loop_back_note).toMatch(/cannot be read and is kept: Gate 3 is not computed until model_state action 'loop_back' with drop_remaining/)
    expect(readFileSync(record(dir), 'utf8')).toBe('{ not json')
    expect((await gates(dir)).gate3).toMatchObject({ verdict: 'NOT_COMPUTED', code: 'loop_back_unreadable' })
    expect((await loopBack(dir, { drop_remaining: { reason: 'The record was damaged.' } })).data).toMatchObject({ armed: false, cleared: true })
    expect((await gates(dir)).gate3.verdict).toBe('FAIL')
  })

  it('arms the whole list, past the 100 a report lists', async () => {
    const dir = await model((m) => {
      failing(m)
      const app = m.structure.defaultBoundary.boundaries.find((b: any) => b.id === 'b-app')
      for (let i = 0; i < 110; i++) {
        app.components.push({ id: `c-bulk-${i}`, name: `bulk ${i}`, description: 'b', type: 'PROCESS', positionX: 0, positionY: 0, classData: { id: 'cls-service', name: 'Application Service' }, crownJewel: true })
      }
    })
    const armed = (await loopBack(dir)).data
    expect(armed.elements_total).toBeGreaterThan(110)
    expect(armed.elements).toHaveLength(100)
    const g = await gates(dir)
    expect(g.gate3.loop_back.untouched_total).toBe(armed.elements_total)
    expect(g.gate3.loop_back.untouched).toHaveLength(100)
    expect(g.gate3.message).toMatch(/\(\+\d+ more\)\./)
  })
})

describe('the zone a boundary that allows any inbound traffic is proposed', () => {
  const zoning = async (dir: string) => {
    const r = (await validateModelTool.run({ action: 'zoning', directory_path: dir } as never, {} as never)) as any
    expect(r.success, r.error).toBe(true)
    return Object.fromEntries(r.data.boundaries.map((b: any) => [b.id, b]))
  }
  const allowAny = (value: unknown, ...ids: string[]) => (m: GateModel) => {
    for (const id of ids) m.attributes.boundaries[id] = { elementId: id, elementType: 'boundary', elementName: id, attributes: { allow_any_inbound: value } }
  }

  it('is PUBLIC, over RESTRICTED too, with its own reason; an external entity keeps its tier', async () => {
    const before = await zoning(await model())
    expect(before['b-data'].proposedTier).not.toBe('PUBLIC')
    const after = await zoning(await model(allowAny(true, 'b-data', 'b-internet')))
    expect(after['b-data']).toMatchObject({ proposedTier: 'PUBLIC', reason: 'allows any inbound traffic (allow_any_inbound: true)', confidence: 'high' })
    expect(after['b-data'].blockedBy).toBeUndefined()
    expect(after['b-internet'].proposedTier).toBe(before['b-internet'].proposedTier)
  })

  it('takes only a true value', async () => {
    for (const value of [false, 'true', 1, null]) {
      expect((await zoning(await model(allowAny(value, 'b-data'))))['b-data'].proposedTier, String(value)).not.toBe('PUBLIC')
    }
  })

  it('shows in the gate report\'s disagreements with the declared zone', async () => {
    const g = await gates(await model(allowAny(true, 'b-data')))
    expect(g.gate3.report.zone_disagreements).toContainEqual(expect.objectContaining({ boundary: 'b-data', zone: 'RESTRICTED', proposed: 'PUBLIC' }))
  })
})

describe('on the synthetic fixture: removing an out-of-model store counts', () => {
  const FIXTURE = path.resolve(__dirname, '../../acceptance/fixtures/synthetic')
  const MODULE = path.resolve(__dirname, '../../../../../modules/dethernety-general/data/dethernety-general')

  /** The OrderDesk key model, as a run that modelled the ExternalSecret sync: a store among the partners and a flow from the gateway to it. */
  async function withSecretStore(): Promise<{ dir: string; removeStore: () => void }> {
    const dir = await fs.mkdtemp(path.join(root, 'orderdesk-'))
    await fs.cp(path.join(FIXTURE, 'key', 'model'), dir, { recursive: true })
    await writeClassCache(dir, MODULE)
    await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
    const structureFile = path.join(dir, 'structure.json')
    const flowsFile = path.join(dir, 'dataflows.json')
    const structure = JSON.parse(readFileSync(structureFile, 'utf8'))
    const partners = structure.defaultBoundary.boundaries.find((b: any) => b.id === 'b-partners')
    const idp = partners.components.find((c: any) => c.id === 'x-idp')
    partners.components.push({ ...idp, id: 'x-secret-store', name: 'Cloud Secret Store', description: 'Secrets the cluster pulls' })
    writeFileSync(structureFile, JSON.stringify(structure, null, 2))
    const flows = JSON.parse(readFileSync(flowsFile, 'utf8'))
    const list = Array.isArray(flows) ? flows : flows.dataFlows
    const logs = list.find((f: any) => f.id === 'f-gateway-logs')
    list.push({ ...logs, id: 'f-secret-sync', name: 'ExternalSecret sync', target: { id: 'x-secret-store' } })
    writeFileSync(flowsFile, JSON.stringify(flows, null, 2))
    // The loop-back reply's instruction: the store and every flow to or from it are removed.
    const removeStore = () => {
      partners.components = partners.components.filter((c: any) => c.id !== 'x-secret-store')
      writeFileSync(structureFile, JSON.stringify(structure, null, 2))
      list.splice(list.findIndex((f: any) => f.id === 'f-secret-sync'), 1)
      writeFileSync(flowsFile, JSON.stringify(flows, null, 2))
    }
    return { dir, removeStore }
  }

  it('holds the rest of the loop-back when the store is removed and the model goes back to structure and on again', async () => {
    const { dir, removeStore } = await withSecretStore()
    setAttr(dir, 'dataFlows', 'f-customer-gateway', 'auth_failure_mode', null)
    expect((await loopBack(dir)).data).toMatchObject({ armed: true })
    expect(untouchedIds(await gates(dir))).toEqual(expect.arrayContaining(['f-customer-gateway', 'f-secret-sync']))
    removeStore()
    const back = await run({ action: 'transition', directory_path: dir, to: 'STRUCTURE_COMPLETE' })
    expect(back.data.loop_back).toMatchObject({ kept: true, armed: true, untouched_total: 1 })
    expect((await run({ action: 'transition', directory_path: dir, to: 'ENRICHING' })).success).toBe(true)
    expect((await run({ action: 'get', directory_path: dir })).data.loop_back).toMatchObject({ armed: true })
    const held = await gates(dir)
    expect(held.gate3.verdict).toBe('NOT_COMPUTED')
    expect(untouchedIds(held)).toEqual(['f-customer-gateway'])
    setAttr(dir, 'dataFlows', 'f-customer-gateway', 'auth_failure_mode', 'deny')
    const after = await gates(dir)
    expect(after.gate3.verdict).toBe('PASS')
    expect(statusOf(after, 'f-secret-sync')).toBe('removed')
    expect(statusOf(after, 'f-customer-gateway')).toMatch(/^(changed|not_listed)$/)
  })

  it('touches the flow to the cloud secret store when the store and its flows are removed', async () => {
    const { dir, removeStore } = await withSecretStore()
    const failing = await gates(dir)
    expect(failing.gate3.loopback.elements.map((e: any) => e.element_id)).toContain('f-secret-sync')

    expect((await loopBack(dir)).data).toMatchObject({ armed: true })
    expect(untouchedIds(await gates(dir))).toContain('f-secret-sync')
    removeStore()
    const after = await gates(dir)
    expect(after.gate3.verdict).toBe('PASS')
    expect(statusOf(after, 'f-secret-sync')).toBe('removed')
  })
})
