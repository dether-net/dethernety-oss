/**
 * H1 and H2 on a run's final model: recomputed on a copy whose class cache is
 * rewritten from the pinned module, with a run cache that differs from the
 * module making the run invalid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGateInput, reviewContentHash } from '../../utils/gates.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import type { ExpectedKey } from '../key.js'
import { checkPinnedModule, classCacheDrift, findModelDirs, modelGates, moduleNames, pinClassCache, readModuleClasses, settleCallFindings } from '../score/model-gates.js'
import { offExport } from './fixtures/clean-run.js'
import { eventBuilder } from './helpers.js'
import type { SettlementOnExport, StateExport } from '../score/run-dir.js'
import { editJson } from './helpers.js'
import { KEY_MODULE } from './fixtures/clean-run.js'

// Each test builds, registers and reads whole models: slow under a full-suite load.
// The product's own gates on whole models; under a full-suite load several times as slow as alone.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 })

let STATE: SettlementOnExport = { state: 'REVIEWED', claimed_state: 'REVIEWED', baseline: 'verified', unregistered_changes: { rows: [], rows_total: 0 }, content_hash: '' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEY_DIR = path.resolve(__dirname, '../fixtures/synthetic/key')
const MODULE = path.resolve(__dirname, '../../../../../modules/dethernety-general/data/dethernety-general')
const key = JSON.parse(fs.readFileSync(path.join(KEY_DIR, 'expected.json'), 'utf8')) as ExpectedKey
const classes = readModuleClasses(MODULE)

let tmp: string
let project: string
let model: string
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-mg-')))
  project = path.join(tmp, 'project')
  model = path.join(project, 'threat-model')
  fs.mkdirSync(project)
  fs.cpSync(path.join(KEY_DIR, 'model'), model, { recursive: true })
  pinClassCache(model, classes, { fallback: KEY_MODULE })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** The review hash as the server computes it: under a project root, with no real home. */
async function reviewHash(): Promise<string> {
  const saved = { HOME: process.env.HOME, DETHEREAL_PROJECT_ROOT: process.env.DETHEREAL_PROJECT_ROOT }
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true })
  process.env.HOME = path.join(tmp, 'home')
  process.env.DETHEREAL_PROJECT_ROOT = project
  initProjectRoot()
  try {
    return reviewContentHash(await loadGateInput(model))
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetProjectRoot()
  }
}
/** The cache as the platform writes it: `uischema`, and its type enums for the classes that are not components. */
function platformNamed(dir: string) {
  const cacheDir = path.join(dir, '.dethereal', 'class-cache')
  const enums: Record<string, string> = { dataFlow: 'DATA_FLOW', data: 'DATA', securityBoundary: 'SECURITY_BOUNDARY' }
  for (const f of fs.readdirSync(cacheDir)) {
    editJson(path.join(cacheDir, f), (e) => {
      if (e.template && 'uiSchema' in e.template) {
        e.template.uischema = e.template.uiSchema
        delete e.template.uiSchema
      }
      if (typeof e.componentType === 'string' && enums[e.componentType]) e.componentType = enums[e.componentType]
    })
  }
}

/** The list files as a push or pull writes them: wrapped in an object. */
function wrapLists(dir: string) {
  for (const [f, k] of [['dataflows.json', 'dataFlows'], ['data-items.json', 'dataItems']] as const) {
    const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    fs.writeFileSync(path.join(dir, f), JSON.stringify(Array.isArray(v) ? { [k]: v } : v, null, 2))
  }
}

async function markReviewed(extra: Record<string, unknown> = {}) {
  const hash = await reviewHash()
  STATE = { ...STATE, content_hash: hash }
  fs.writeFileSync(path.join(model, '.dethereal', 'state.json'), JSON.stringify({
    currentState: 'REVIEWED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED'],
    revision: 6, reviewHash: hash, reviewedAt: '2026-01-01T00:00:00.000Z', ...extra,
  }, null, 2))
}

describe('modelGates', () => {
  it('passes H1 and H2 on the reviewed key model, and leaves the environment as it was', async () => {
    await markReviewed()
    const home = process.env.HOME
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.problems).toEqual([])
    expect(r.modelDir).toBe('threat-model')
    expect(r.h1).toEqual({ gate: 'H1', verdict: 'PASS', findings: [] })
    expect(r.h2).toEqual({ gate: 'H2', verdict: 'PASS', findings: [] })
    expect(r.unknownClasses).toEqual([])
    expect(process.env.HOME).toBe(home)
  })

  it('reads the crossings Step 5 asks about with the channels removed, and leaves the model\'s own zoning as it is', async () => {
    // The key model ratified the vendor's webhook into the orders application: its own zoning does not show that
    // crossing, and the copy with the channels removed does.
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.externalIngress).toBe(true)
    expect(r.zoning?.map((f) => `${f.kind} ${f.boundaryId} ${f.peerId ?? ''}`)).not.toContain('external-ingress b-partners b-orders')
    // With the orders application and the database subnet exposed, nothing external reaches a trusted tier,
    // directly or through the bastion.
    editJson(path.join(model, 'structure.json'), (st) => {
      const walk = (b: any) => { if (b.id === 'b-orders' || b.id === 'b-data') b.zone = 'EXPOSED'; for (const n of b.boundaries ?? []) walk(n) }
      walk(st.defaultBoundary)
    })
    expect((await modelGates(project, MODULE, key, undefined, STATE)).externalIngress).toBe(false)
  })

  it('fails H2 when the model was never marked reviewed', async () => {
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.h2?.verdict).toBe('FAIL')
    expect(r.h2?.findings.map((f) => f.code)).toEqual(['not_reviewed'])
  })

  it('fails H1 on a Gate 2 failure, and H2 on a REVIEWED claim the model no longer supports', async () => {
    await markReviewed()
    editJson(path.join(model, 'dataflows.json'), (flows) => {
      flows[0].target = { id: 'no-such-element' }
    })
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.h1?.verdict).toBe('FAIL')
    expect(r.h2?.verdict).toBe('FAIL')
    expect(r.h2?.findings.map((f) => f.code)).toContain('false_review_claim')
  })

  it('takes the settlement part of H2 from the run\'s own model_state export', async () => {
    await markReviewed()
    const codes = async (e?: StateExport) => (await modelGates(project, MODULE, key, undefined, e)).h2?.findings.map((f) => f.code)
    expect(await codes(STATE)).toEqual([])
    expect(await codes({ ...STATE, baseline: 'unverified' })).toEqual(['settlement_unverified'])
    expect(await codes({ ...STATE, unregistered_changes: { rows_total: 3 } })).toEqual(['unregistered_values'])
    expect(await codes({ ...STATE, state: 'ENRICHING', pending_enrichment: { blocks: true } })).toEqual(['pending_in_run', 'run_state_not_reviewed'])
    expect(await codes(undefined)).toEqual(['no_state_export'])
    expect(await codes({ ...STATE, content_hash: 'b'.repeat(64) })).toEqual(['state_export_stale'])
    // The run's server had no hash to give: a finding, never a comparison.
    expect(await codes({ ...STATE, content_hash: null, content_hash_unavailable: { code: 'state_files_refused' } })).toEqual(['state_export_hash_unavailable'])
  })

  it('reads a run with settlement off without settlement findings, keeping the export and state checks', async () => {
    await markReviewed()
    const OFF = offExport(STATE)
    const codes = async (e?: StateExport) => (await modelGates(project, MODULE, key, undefined, e, { settlement: 'off' })).h2?.findings.map((f) => f.code)
    expect(await codes(OFF)).toEqual([])
    expect(await codes({ ...OFF, state: 'ENRICHING' })).toEqual(['run_state_not_reviewed'])
    expect(await codes({ ...OFF, content_hash: 'b'.repeat(64) })).toEqual(['state_export_stale'])
    expect(await codes(undefined)).toEqual(['no_state_export'])
  })

  it('fails H2 when the run record and the run\'s server disagree on the settlement', async () => {
    await markReviewed()
    const OFF = offExport(STATE)
    const codes = async (e: StateExport, settlement?: 'on' | 'off') => (await modelGates(project, MODULE, key, undefined, e, settlement ? { settlement } : {})).h2?.findings.map((f) => f.code)
    expect(await codes(STATE, 'off')).toEqual(['settlement_mode_mismatch'])
    expect(await codes({ ...STATE, unregistered_changes: { rows_total: 3 } }, 'off')).toEqual(['settlement_mode_mismatch'])
    expect(await codes(OFF)).toEqual(['settlement_mode_mismatch'])
    expect(await codes(OFF, 'on')).toEqual(['settlement_mode_mismatch'])
  })

  it('reads the model with the run\'s settlement, whatever this process\'s environment says', async () => {
    fs.writeFileSync(path.join(model, '.dethereal', 'enrichment-pending.json'), 'not json')
    await markReviewed()
    const saved = process.env.DETHEREAL_SETTLEMENT
    try {
      // A run with the settlement on, scored with the variable unset: its pending file still holds the review back.
      delete process.env.DETHEREAL_SETTLEMENT
      const on = await modelGates(project, MODULE, key, undefined, STATE, { settlement: 'on' })
      expect(on.h2?.findings.map((f) => f.code)).toContain('false_review_claim')
      // A run with the settlement off, scored with the variable on: nothing of the settlement is held against it.
      process.env.DETHEREAL_SETTLEMENT = 'on'
      const off = await modelGates(project, MODULE, key, undefined, offExport(STATE), { settlement: 'off' })
      expect(off.h2?.findings.map((f) => f.code)).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.DETHEREAL_SETTLEMENT
      else process.env.DETHEREAL_SETTLEMENT = saved
    }
  })

  it('takes a quick run with settlement off the same way', async () => {
    const OFF = offExport({ ...STATE, state: 'ENRICHING', claimed_state: 'ENRICHING' })
    const quick = await modelGates(project, MODULE, key, undefined, OFF, { quick: true, settlement: 'off' })
    expect(quick.h2?.findings.map((f) => f.code)).not.toContain('settlement_mode_mismatch')
    expect(quick.h2?.findings.map((f) => f.code)).not.toContain('settlement_unverified')
    const mixed = await modelGates(project, MODULE, key, undefined, { ...STATE, state: 'ENRICHING' }, { quick: true, settlement: 'off' })
    expect(mixed.h2?.findings.map((f) => f.code)).toContain('settlement_mode_mismatch')
  })

  it("fails H2 when a run recorded with the settlement off shows the settle tool answering", () => {
    const { ev } = eventBuilder()
    const call = (tool: string, callId: string) => ev({ kind: 'tool_call', tool, callId, input: { action: 'settle' } })
    const answered = [call('dethereal.model_state_settle', 'c1'), ev({ kind: 'tool_result', callId: 'c1', text: '{}' })]
    expect(settleCallFindings(answered, 'off').map((f) => `${f.verdict}:${f.code}`)).toEqual(['FAIL:settlement_mode_mismatch'])
    expect(settleCallFindings(answered, 'on')).toEqual([])
    // A call the server refused as unknown is what a server with the settlement off answers.
    const refused = [call('mcp__plugin_dethereal_dethereal__model_state_settle', 'c2'), ev({ kind: 'tool_result', callId: 'c2', isError: true, text: 'unknown tool' })]
    expect(settleCallFindings(refused, 'off')).toEqual([])
    expect(settleCallFindings([call('dethereal.model_state', 'c3'), ev({ kind: 'tool_result', callId: 'c3', text: '{}' })], 'off')).toEqual([])
  })

  it('does not hold pending enrichment against a REVIEWED claim when settlement is off', async () => {
    fs.writeFileSync(path.join(model, '.dethereal', 'enrichment-pending.json'), 'not json')
    await markReviewed()
    const on = await modelGates(project, MODULE, key, undefined, STATE)
    expect(on.h2?.findings.map((f) => f.code)).toContain('false_review_claim')
    const offRun = await modelGates(project, MODULE, key, undefined, offExport(STATE), { settlement: 'off' })
    expect(offRun.h2?.findings.map((f) => f.code)).toEqual([])
  })

  it('reports no stale review, only the missing hash, when the gates support a REVIEWED claim', async () => {
    // Every data item names its module, so the gates derive it with a data class's cache entry behind a link.
    editJson(path.join(model, 'data-items.json'), (items) => { for (const i of Array.isArray(items) ? items : items.dataItems) i.classData = { ...i.classData, module: KEY_MODULE } })
    await markReviewed()
    const items = JSON.parse(fs.readFileSync(path.join(model, 'data-items.json'), 'utf8'))
    const entry = path.join(model, '.dethereal', 'class-cache', `${(Array.isArray(items) ? items : items.dataItems)[0].classData.id}.json`)
    const outside = path.join(tmp, 'entry-outside.json')
    fs.renameSync(entry, outside)
    fs.symlinkSync(outside, entry)
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.h1?.verdict).toBe('PASS')
    expect(r.h2?.findings.map((f) => f.code)).toEqual(['review_hash_unavailable'])
  })

  it("fails H2, never INVALID, when the run's model gives no review hash", async () => {
    await markReviewed()
    const outside = path.join(tmp, 'scope-outside.json')
    fs.renameSync(path.join(model, '.dethereal', 'scope.json'), outside)
    fs.symlinkSync(outside, path.join(model, '.dethereal', 'scope.json'))
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.problems).toEqual([])
    expect(r.h2?.findings.filter((f) => f.code === 'review_hash_unavailable')).toEqual([expect.objectContaining({ verdict: 'FAIL', refs: ['.dethereal/scope.json'] })])
    expect(r.state?.review_current).toBe(false)
  })

  it('fails H2 on a stale review', async () => {
    await markReviewed()
    editJson(path.join(model, 'structure.json'), (s) => {
      s.defaultBoundary.boundaries[0].components[0].description = 'changed after the review'
    })
    // The run's server exported the model as it ended, after the change.
    const r = await modelGates(project, MODULE, key, undefined, { ...STATE, content_hash: await reviewHash() })
    expect(r.h2?.findings.map((f) => f.code)).toEqual(['review_stale'])
  })

  it('fails H2 on any waiver record the key does not expect, verified or not', async () => {
    await markReviewed({ waivers: [{ criterion: 'C2', element_ids: ['c-orders-db'], reason: 'x', fingerprints: {} }] })
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.h2?.findings.filter((f) => f.code === 'undeclared_waiver').map((f) => f.refs)).toEqual([['c-orders-db']])
  })

  it('recomputes with the pinned classes, not the run\'s cache, and calls a differing cache invalid', async () => {
    await markReviewed()
    const cacheDir = path.join(model, '.dethereal', 'class-cache')
    const first = fs.readdirSync(cacheDir).sort()[0]!
    editJson(path.join(cacheDir, first), (e) => {
      e.template.schema.properties = { only_field: { type: 'string' } }
    })
    expect(classCacheDrift(model, classes)).toEqual([{ classId: first.slice(0, -5), reason: 'template differs' }])
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.problems.map((p) => p.code)).toEqual(['class_cache_drift'])
    expect(r.h1).toBeUndefined()
  })

  it("scores another module's class as the run's own choice, whatever its name, and calls a module class under another id invalid", async () => {
    const FOREIGN = 'a79a87ff-fc03-4c15-809e-1367b597d5a3'
    const cacheDir = path.join(model, '.dethereal', 'class-cache')
    const OTHER_TEMPLATE = { schema: { type: 'object', properties: { publicly_accessible: { type: 'boolean' } } } }
    const cache = (id: string, name: string, classType = 'component', template: unknown = OTHER_TEMPLATE) => fs.writeFileSync(path.join(cacheDir, `${id}.json`), JSON.stringify({
      classId: id, className: name, classType, componentType: 'STORE', template,
    }))
    const use = (id: string, name: string) => editJson(path.join(model, 'structure.json'), (st) => {
      st.defaultBoundary.boundaries[0].components.push({ id: `c-${id.slice(0, 4)}`, name: `${name} node`, type: 'STORE', positionX: 900, positionY: 40, classData: { id, name } })
    })
    const pinned = (name: string) => [...classes.values()].find((c) => c.name === name)!.template
    // Cached but used by nothing: nothing to score.
    cache(FOREIGN, 'RDS Instance')
    expect(classCacheDrift(model, classes)).toEqual([])
    expect(await modelGates(project, MODULE, key, undefined, STATE)).toMatchObject({ problems: [], unknownClasses: [] })
    // Cached and used: an H5 class, never INVALID; used and not cached, the same.
    use(FOREIGN, 'RDS Instance')
    expect(await modelGates(project, MODULE, key, undefined, STATE)).toMatchObject({ problems: [], unknownClasses: [FOREIGN] })
    const UNCACHED = '1c6bd813-aec2-4ac3-b546-3eac5f9635d5'
    use(UNCACHED, 'CloudWatch Log Group')
    expect(await modelGates(project, MODULE, key, undefined, STATE)).toMatchObject({ problems: [], unknownClasses: [UNCACHED, FOREIGN].sort() })
    // Another module's "Load Balancer", with its own template, cached and used, or only used: H5 too.
    const OTHER_LB = '00000000-0000-4000-8000-00000000000b'
    cache(OTHER_LB, 'Load Balancer')
    expect(classCacheDrift(model, classes)).toEqual([])
    fs.rmSync(path.join(cacheDir, `${OTHER_LB}.json`))
    use(OTHER_LB, 'Load Balancer')
    expect(await modelGates(project, MODULE, key, undefined, STATE)).toMatchObject({ problems: [], unknownClasses: [UNCACHED, OTHER_LB, FOREIGN].sort() })
    // The module's own class, template and all, under another id: the platform served another module version.
    const MOVED = '00000000-0000-4000-8000-00000000000a'
    cache(MOVED, 'Load Balancer', 'component', pinned('Load Balancer'))
    expect(classCacheDrift(model, classes)).toEqual([{ classId: MOVED, reason: 'the platform served Load Balancer under another id' }])
    fs.rmSync(path.join(cacheDir, `${MOVED}.json`))
    // A boundary class, which the cache calls a boundary and the module a securityBoundary.
    cache(MOVED, 'Container', 'boundary', pinned('Container'))
    expect(classCacheDrift(model, classes)).toEqual([{ classId: MOVED, reason: 'the platform served Container under another id' }])
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.problems).toEqual([{ code: 'class_cache_drift', detail: `class ${MOVED}: the platform served Container under another id` }])
  })

  it("gives the gates each module the run's cache named, as the run's server read it, and drift ignores it", async () => {
    const cacheDir = path.join(model, '.dethereal', 'class-cache')
    const first = fs.readdirSync(cacheDir).sort()[0]!
    const firstId = first.slice(0, -5)
    const gate2 = async () => (await modelGates(project, MODULE, key, undefined, STATE)).h1?.findings.map((f) => [f.detail, f.refs])
    // Every entry names the key's module: the gates pass, and naming a module is not drift.
    expect(classCacheDrift(model, classes)).toEqual([])
    expect(await gate2()).toEqual([])
    // An entry that names none: the run's own Gate 2 fails on that class, and so does the scorer's.
    editJson(path.join(cacheDir, first), (e) => { delete e.module })
    expect(await gate2()).toEqual([['Gate 2 check manifest_complete fails (1)', [firstId]]])
    // The same when the entry is a link: the run's server does not follow it, nor does the scorer.
    const outside = path.join(tmp, 'outside.json')
    editJson(path.join(cacheDir, first), (e) => { e.module = KEY_MODULE })
    fs.renameSync(path.join(cacheDir, first), outside)
    fs.symlinkSync(outside, path.join(cacheDir, first))
    expect(await gate2()).toEqual([['Gate 2 check manifest_complete fails (1)', [firstId]]])
    // A fixture's fallback names a module where the entry named none.
    const copy = path.join(tmp, 'pinned-copy')
    fs.cpSync(model, copy, { recursive: true, verbatimSymlinks: true })
    pinClassCache(copy, classes, { fallback: { id: 'mod-x', name: 'x' } })
    expect(JSON.parse(fs.readFileSync(path.join(copy, '.dethereal', 'class-cache', first), 'utf8')).module).toEqual({ id: 'mod-x', name: 'x' })
  })

  it("keeps another module's class the run cached with its module, so the run's modules derive as the run's did", async () => {
    const FOREIGN = 'a79a87ff-fc03-4c15-809e-1367b597d5a3'
    fs.writeFileSync(path.join(model, '.dethereal', 'class-cache', `${FOREIGN}.json`), JSON.stringify({
      classId: FOREIGN, className: 'RDS Instance', classType: 'component', componentType: 'STORE', module: { id: 'mod-aws', name: 'aws-data' },
      template: { schema: { type: 'object', properties: { publicly_accessible: { type: 'boolean' } } } },
    }))
    editJson(path.join(model, 'structure.json'), (st) => {
      st.defaultBoundary.boundaries[0].components.push({ id: 'c-rds', name: 'Orders replica', type: 'STORE', positionX: 900, positionY: 40, classData: { id: FOREIGN, name: 'RDS Instance' } })
    })
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.problems).toEqual([])
    expect(r.unknownClasses).toEqual([FOREIGN])
    expect(r.h1).toEqual({ gate: 'H1', verdict: 'PASS', findings: [] })
  })

  it('reads a class under another id by the module its entry names: the pinned one is INVALID, another is H5', () => {
    const cacheDir = path.join(model, '.dethereal', 'class-cache')
    const ID = '00000000-0000-4000-8000-00000000000c'
    const OTHER = { schema: { type: 'object', properties: { publicly_accessible: { type: 'boolean' } } } }
    const entry = (module: unknown, template: unknown) => fs.writeFileSync(path.join(cacheDir, `${ID}.json`), JSON.stringify({ classId: ID, className: 'Load Balancer', classType: 'component', template, ...(module ? { module } : {}) }))
    const names = moduleNames(MODULE)
    // The pinned module under its display name, even with a changed template: another version of it.
    entry({ id: 'mod-1', name: 'Dethernety General' }, OTHER)
    expect(classCacheDrift(model, classes, names)).toEqual([{ classId: ID, reason: 'the platform served Load Balancer under another id' }])
    // Another module's class of the same name, even with the same template: the run's choice.
    entry({ id: 'mod-2', name: 'aws-networking' }, [...classes.values()].find((c) => c.name === 'Load Balancer')!.template)
    expect(classCacheDrift(model, classes, names)).toEqual([])
  })

  it("compares the run's own review hash with the model as the run left it, its class cache included", async () => {
    // Another module's class, used and cached: the gates read the pinned cache, the run's server read this one.
    const FOREIGN = 'a79a87ff-fc03-4c15-809e-1367b597d5a3'
    fs.writeFileSync(path.join(model, '.dethereal', 'class-cache', `${FOREIGN}.json`), JSON.stringify({
      classId: FOREIGN, className: 'RDS Instance', classType: 'component', componentType: 'STORE',
      template: { schema: { type: 'object', properties: { publicly_accessible: { type: 'boolean' } } } },
    }))
    editJson(path.join(model, 'structure.json'), (st) => {
      st.defaultBoundary.boundaries[0].components.push({ id: 'c-rds', name: 'Orders replica', type: 'STORE', positionX: 900, positionY: 40, classData: { id: FOREIGN, name: 'RDS Instance' } })
    })
    await markReviewed()
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.state?.review_current).toBe(true)
    expect(r.h2?.findings.map((f) => f.code)).not.toContain('state_export_stale')
    expect(r.h2?.findings.map((f) => f.code)).not.toContain('review_stale')
  })

  it('reads a cache the platform wrote under its own names as the module\'s, and still sees a real difference', () => {
    const cacheDir = path.join(model, '.dethereal', 'class-cache')
    const files = fs.readdirSync(cacheDir).sort()
    // A boundary class, as the platform caches it.
    const boundary = [...classes.values()].find((c) => c.type === 'securityBoundary')!
    fs.writeFileSync(path.join(cacheDir, `${boundary.id}.json`), JSON.stringify({ classId: boundary.id, className: boundary.name, componentType: 'securityBoundary', template: boundary.template }))
    platformNamed(model)
    expect(JSON.parse(fs.readFileSync(path.join(cacheDir, `${boundary.id}.json`), 'utf8')).componentType).toBe('SECURITY_BOUNDARY')
    expect(classCacheDrift(model, classes)).toEqual([])
    const typed = (t: string) => files.find((f) => JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')).componentType === t)!
    // A changed UI schema, a type enum on the wrong kind of class, and both names at once all differ.
    const flow = typed('DATA_FLOW')
    editJson(path.join(cacheDir, flow), (e) => { e.template.uischema = { type: 'Changed' } })
    editJson(path.join(cacheDir, typed('DATA')), (e) => { e.componentType = 'DATA_FLOW' })
    const both = files.find((f) => f !== flow && JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')).template?.uischema !== undefined)!
    editJson(path.join(cacheDir, both), (e) => { e.template.uiSchema = e.template.uischema })
    expect(classCacheDrift(model, classes).map((d) => d.reason).sort()).toEqual(['component type differs', 'template differs', 'template differs'])
  })

  it('pins every class of a pushed model, whose lists are wrapped, and recomputes the hash its server gave', async () => {
    wrapLists(model)
    platformNamed(model)
    await markReviewed()
    const pinned = path.join(tmp, 'pinned')
    fs.cpSync(model, pinned, { recursive: true })
    pinClassCache(pinned, classes)
    expect(fs.readdirSync(path.join(pinned, '.dethereal', 'class-cache')).sort()).toEqual(fs.readdirSync(path.join(model, '.dethereal', 'class-cache')).sort())
    const r = await modelGates(project, MODULE, key, undefined, STATE)
    expect(r.problems).toEqual([])
    expect(r.h2!.findings.map((f) => f.code)).not.toContain('state_export_stale')
    expect(r.state?.review_current).toBe(true)
  })

  it('calls a project with no model, or with two, invalid', async () => {
    fs.cpSync(model, path.join(project, 'second'), { recursive: true })
    expect(findModelDirs(project)).toHaveLength(2)
    expect((await modelGates(project, MODULE, key, undefined, STATE)).problems.map((p) => p.code)).toEqual(['model_count'])
    fs.rmSync(path.join(project, 'second'), { recursive: true })
    fs.rmSync(model, { recursive: true })
    expect((await modelGates(project, MODULE, key, undefined, STATE)).problems.map((p) => p.code)).toEqual(['model_count'])
  })

  it('accepts the module the key pins, and refuses another', async () => {
    await expect(checkPinnedModule(path.join(KEY_DIR, 'model'), MODULE, key)).resolves.toBeUndefined()
    await expect(checkPinnedModule(path.join(KEY_DIR, 'model'), MODULE, { ...key, module: { ...key.module!, class_cache_sha256: '0'.repeat(64) } }))
      .rejects.toThrow(/pins/)
  })

  it('checks the module again after a check that could not run', async () => {
    const later = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-module-later-'))), 'module')
    try {
      await expect(checkPinnedModule(path.join(KEY_DIR, 'model'), later, key)).rejects.toThrow()
      fs.cpSync(MODULE, later, { recursive: true })
      await expect(checkPinnedModule(path.join(KEY_DIR, 'model'), later, key)).resolves.toBeUndefined()
    } finally {
      fs.rmSync(path.dirname(later), { recursive: true, force: true })
    }
  })
})

describe('a key over several modules', () => {
  it('writes each class with the module whose folder holds it, pins one hash over the classes, and reads every folder', async () => {
    const { writeClassCache } = await import('../key.js')
    // A second module: its own module.json, holding one class the key model uses.
    const second = path.join(tmp, 'second-module')
    const usedId = JSON.parse(fs.readFileSync(path.join(KEY_DIR, 'model', 'structure.json'), 'utf8')).defaultBoundary.components?.[0]?.classData?.id
      ?? fs.readdirSync(path.join(KEY_DIR, 'model', 'attributes', 'components')).map((f) => JSON.parse(fs.readFileSync(path.join(KEY_DIR, 'model', 'attributes', 'components', f), 'utf8')).classData?.id).find(Boolean)
    let usedDir = ''
    for (const t of fs.readdirSync(MODULE, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const c of fs.readdirSync(path.join(MODULE, t.name))) {
        try {
          if (JSON.parse(fs.readFileSync(path.join(MODULE, t.name, c, 'class.json'), 'utf8')).id === usedId) usedDir = path.join(t.name, c)
        } catch { /* not a class */ }
      }
    }
    expect(usedDir).not.toBe('')
    fs.mkdirSync(path.join(second, path.dirname(usedDir)), { recursive: true })
    fs.cpSync(path.join(MODULE, usedDir), path.join(second, usedDir), { recursive: true })
    fs.writeFileSync(path.join(second, 'module.json'), JSON.stringify({ name: 'Second Module' }))
    // And one class only the second module ships.
    const own = path.join(second, path.dirname(usedDir), 'second-only')
    fs.cpSync(path.join(second, usedDir), own, { recursive: true })
    editJson(path.join(own, 'class.json'), (c) => { c.id = '00000000-0000-4000-8000-000000000002' })
    const copy = path.join(tmp, 'two-modules')
    fs.cpSync(path.join(KEY_DIR, 'model'), copy, { recursive: true })
    const one = await writeClassCache(copy, MODULE)
    editJson(path.join(copy, 'manifest.json'), (m) => { m.modules = [...m.modules, { id: 'second-module', name: 'second-module' }] })
    const two = await writeClassCache(copy, [MODULE, second])
    // The hash is over the classes, not the module an entry names.
    expect(two).toBe(one)
    expect(JSON.parse(fs.readFileSync(path.join(copy, '.dethereal', 'class-cache', `${usedId}.json`), 'utf8')).module).toEqual({ id: 'second-module', name: 'second-module' })
    expect(readModuleClasses([MODULE, second]).size).toBe(readModuleClasses(MODULE).size + 1)
    expect(readModuleClasses([MODULE, second]).has('00000000-0000-4000-8000-000000000002')).toBe(true)
    expect([...moduleNames([MODULE, second])]).toEqual(expect.arrayContaining(['secondmodule', ...moduleNames(MODULE)]))
    await expect(checkPinnedModule(copy, [MODULE, second], { ...key, module: undefined, modules: { names: ['dethernety-general', 'second-module'], class_cache_sha256: one } })).resolves.toBeUndefined()
    // A folder whose module the manifest does not list, or a folder count that does not match.
    fs.writeFileSync(path.join(second, 'module.json'), JSON.stringify({ name: 'elsewhere' }))
    await expect(writeClassCache(copy, [MODULE, second])).rejects.toThrow(/not one the key model manifest lists/)
    await expect(writeClassCache(copy, MODULE)).rejects.toThrow(/one module per module folder/)
  })
})
