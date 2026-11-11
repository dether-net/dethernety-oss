/**
 * The machine's registrations: a pull registers what the platform returned, a
 * push pins the controls it linked by name, and a local control created on the
 * platform carries the registrations that named it. Each fails closed: what it
 * does not register stays a row for the operator.
 *
 * Every test runs with its own HOME, so this machine's key and its pointer file
 * never carry over from another test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import { modelStateSettleTool } from '../model-state-settle.tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { readModelDirectory } from '../../utils/directory-utils.js'
import { baselineForSync, recordSyncBaseline } from '../../utils/platform-baseline.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { ABSENT, canonicalJson, contentOf, modelHashOf, parseBaseline, sha256, signedBaseline, type BaselineContent } from '../../utils/settlement.js'
import { carryGreenfield, pinList, pinnedModel, registerPulled, registerPushPin } from '../../utils/settlement-writers.js'
import { updateBaselinePointers, waiverKeyState, withPointerLock } from '../../utils/gates.js'
import { registerAll, type Row } from './helpers/settle.js'

// Each test registers whole models: slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let home: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-writers-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-writers-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  home = path.join(homes, `h${seq++}`)
  await fs.mkdir(home)
  process.env.HOME = home
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }

async function model(mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
  return dir
}

const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'] }, context)) as any).data
const rows = async (dir: string): Promise<Row[]> => (await get(dir)).unregistered_changes.rows
const baselinePath = (dir: string) => path.join(dir, '.dethereal', 'settlement-baseline.json')
const logPath = (dir: string) => path.join(dir, '.dethereal', 'settlements.json')
const baseline = (dir: string) => parseBaseline(readFileSync(baselinePath(dir)))!
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const editJson = async (p: string, fn: (d: any) => void) => {
  const d = readJson(p)
  fn(d)
  await fs.writeFile(p, JSON.stringify(d, null, 2))
}
const syncedTo = async (dir: string, modelId: string) =>
  recordSyncBaseline(dir, { platform_model_id: modelId }, await baselineForSync(dir, modelId, {}), 'pull')
const component = (s: any, id: string): any => {
  let found: any
  const walk = (b: any) => {
    for (const c of b?.components ?? []) if (c.id === id) found = c
    for (const n of b?.boundaries ?? []) walk(n)
  }
  walk(s.defaultBoundary)
  return found
}
const setControls = (dir: string, id: string, controls: unknown) => editJson(path.join(dir, 'structure.json'), (s) => { component(s, id).controls = controls })

/** Re-sign the directory's verified baseline with changes, as this machine. */
async function resign(dir: string, change: (c: BaselineContent) => void): Promise<void> {
  const key = (await waiverKeyState(true, dir)).key!
  const modelHash = modelHashOf(key, await fs.realpath(dir))
  const parsed = baseline(dir)
  const content = contentOf(parsed)
  change(content)
  content.revision = parsed.revision + 1
  await fs.writeFile(baselinePath(dir), signedBaseline(key, modelHash, content))
  await withPointerLock((lock) => updateBaselinePointers({ [modelHash]: content.revision }, lock, dir))
}

describe('a pull', () => {
  it('registers what the platform returned as pulled, counted only for that platform model', async () => {
    const dir = await model()
    const split = await readModelDirectory(dir)
    const r = await registerPulled(dir, split, { modelId: 'M1', prints: { a: 1 } })
    expect(r).toMatchObject({ status: 'registered', dropped: 0, gitignore: 'written' })
    expect(r.registered).toBeGreaterThan(10)
    // Not bound here until a sync record for M1 verifies.
    expect((await get(dir)).unregistered_changes.rows_total).toBe(r.registered)
    await syncedTo(dir, 'M1')
    const g = await get(dir)
    expect(g.unregistered_changes.rows_total).toBe(0)
    expect(g.registered.pull).toBe(r.registered)
    expect(g.settlements_recent.at(-1)).toMatchObject({ action: 'pull', model_id: 'M1', registered: r.registered, dropped: 0 })
    expect(readFileSync(path.join(dir, '.dethereal', '.gitignore'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')))
      .toEqual(['settlement-baseline.json', 'settlements.json', 'sync.json', 'control-audit.log', 'relay/'])

    // This machine's pointer holds the revision signed, so an older baseline put back reads as rolled back.
    const pointers = readJson(path.join(home, '.dethernety', 'baseline-pointers.json')).models
    expect(Object.values(pointers)).toEqual([{ revision: baseline(dir).revision }])
  })

  it('registers the model in memory, never the files: a file changed in between is a row', async () => {
    const dir = await model()
    const split = await readModelDirectory(dir)
    await editJson(path.join(dir, 'attributes', 'components', 'c-web.json'), (d) => { d.attributes.injected = 'by an agent' })
    await registerPulled(dir, split, { modelId: 'M1', prints: {} })
    await syncedTo(dir, 'M1')
    expect((await rows(dir)).map((r) => [r.element_id, r.field])).toEqual([['c-web', 'injected']])
  })

  it("keeps the operator's registration of an unchanged value, registers a changed one as pulled, and drops what the platform no longer holds", async () => {
    const dir = await model()
    await registerAll(dir)
    const before = baseline(dir)
    const split = await readModelDirectory(dir)
    ;(split.attributes as any).components['c-web'].attributes.os_patched = 'changed on the platform'
    const flows = (split.dataFlows as any).dataFlows ?? split.dataFlows
    flows.splice(0, 1)
    const r = await registerPulled(dir, split, { modelId: 'M1', prints: {} })
    expect(r.status).toBe('registered')
    const after = baseline(dir)
    const pulled = Object.keys(after.sources)
    expect(pulled.map((k) => JSON.parse(k).slice(4))).toEqual([['attr', 'os_patched']])
    expect(r.registered).toBe(1)
    expect(r.dropped).toBeGreaterThan(0)
    expect(Object.keys(after.values).length).toBe(Object.keys(before.values).length - r.dropped! + (Object.hasOwn(before.values, pulled[0]!) ? 0 : 1))
  })

  it("keeps an operator's field left empty only while the platform holds nothing there, and never registers pending or unsignable values", async () => {
    const dir = await model()
    await registerAll(dir)
    const split = await readModelDirectory(dir)
    const web = JSON.parse(Object.keys(baseline(dir).values).find((k) => JSON.parse(k)[0].endsWith('/C:Web frontend') && JSON.parse(k)[4] === 'attr')!)
    const keyOf = (field: string) => JSON.stringify([...web.slice(0, 4), 'attr', field])
    await resign(dir, (c) => {
      c.values[keyOf('left_empty')] = ABSENT
      c.values[keyOf('input_validation')] = ABSENT
    })
    // A pending row on one value, and values written on an element itself.
    await fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({
      version: 1, entries: [{ batch: 'b1', group: 'components', element_id: 'c-orders', field: 'runs_as_root', value: false, source: 'code', previous: 'absent' }],
    }))
    // Attributes written on an element itself: a value the operator could not register as it stands either.
    component(split.structure, 'c-gateway').attributes = { inline_value: 'x' }
    const r = await registerPulled(dir, split, { modelId: 'M1', prints: {} })
    expect(r.status).toBe('registered')
    const b = baseline(dir)
    expect(b.values[keyOf('left_empty')]).toBe(ABSENT)
    expect(b.sources[keyOf('input_validation')]).toBe('pull')
    const keys = Object.keys(b.values).map((k) => JSON.parse(k))
    expect(keys.some((k) => k[5] === 'runs_as_root' && k[0].endsWith('C:Order service'))).toBe(false)
    expect(keys.some((k) => k[5] === 'runs_as_root' && k[0].endsWith('C:Web frontend'))).toBe(true)
    expect(keys.some((k) => k[5] === 'inline_value')).toBe(false)
  })

  it('restarts a forged log, leaves every other directory alone, and fails closed', async () => {
    const dir = await model()
    await registerAll(dir)
    await editJson(logPath(dir), (d) => { d.entries.push({ at: 'x', action: 'settle', items: 9, decisions: {}, reply: 'forged' }) })
    const other = await model()
    await registerAll(other)
    const otherBaseline = readFileSync(baselinePath(other))
    const r = await registerPulled(dir, await readModelDirectory(dir), { modelId: 'M1', prints: {} })
    expect(r.log_restarted).toBe('digest_mismatch')
    expect(readJson(logPath(dir)).entries.map((e: any) => e.action)).toEqual(['pull'])
    expect(readFileSync(baselinePath(other)).equals(otherBaseline)).toBe(true)

    // This machine's pointer file cannot be used: nothing is registered, and nothing is written.
    const fresh = await model()
    await fs.mkdir(path.join(home, '.dethernety'), { recursive: true })
    await fs.writeFile(path.join(home, '.dethernety', 'baseline-pointers.json'), 'not json', { mode: 0o600 })
    const failed = await registerPulled(fresh, await readModelDirectory(fresh), { modelId: 'M1', prints: {} })
    expect(failed).toEqual({ status: 'failed', code: 'pointer_unavailable' })
    expect(existsSync(baselinePath(fresh))).toBe(false)
  })
})

describe('the push pin', () => {
  const resolved = (entries: Array<[string, string]>) => entries.map(([id, name]) => ({ id, name }))

  it('pins names to the ids the push linked, skipping local temporary ids, and pins nothing that does not line up', () => {
    const list = [{ name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }, { id: 'ctl-b', name: 'IDS' }]
    expect(pinList(list, resolved([['ctl-a', 'WAF'], ['ctl-b', 'IDS']]))).toEqual([{ id: 'ctl-a', name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }, { id: 'ctl-b', name: 'IDS' }])
    expect(pinList([{ name: ' WAF ' }], resolved([['ctl-a', 'WAF']]))).toEqual([{ id: 'ctl-a', name: ' WAF ' }])
    expect(pinList(list, resolved([['ctl-a', 'WAF']]))).toBeNull()
    expect(pinList(list, resolved([['ctl-a', 'WAF'], ['ctl-b', 'IDS'], ['ctl-c', 'X']]))).toBeNull()
    expect(pinList([{ name: 'WAF' }], resolved([['ctl-a', 'Web firewall']]))).toBeNull()
    expect(pinList([{ id: 'ctl-z', name: 'WAF' }], resolved([['ctl-a', 'WAF']]))).toBeNull()
    expect(pinList([], [])).toEqual([])
    expect(pinList([{ name: 'WAF' }], undefined)).toBeNull()
  })

  it('writes the pinned ids into the model a create writes', async () => {
    const dir = await model((m) => {
      component(m.structure, 'c-web').controls = [{ name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }]
      m.manifest.model.controls = [{ name: 'Policy' }]
    })
    const split = await readModelDirectory(dir)
    const pinned = pinnedModel(split, { 'c-web': resolved([['ctl-a', 'WAF']]), '@model': resolved([['pol-1', 'Policy']]) })
    expect(component(pinned.structure, 'c-web').controls).toEqual([{ id: 'ctl-a', name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }])
    expect(pinned.manifest.model.controls).toEqual([{ id: 'pol-1', name: 'Policy' }])
    expect(component(split.structure, 'c-web').controls).toEqual([{ name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }])
  })

  it('carries the operator\'s registration of a pushed list to its pinned ids, where the files hold them', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }, { id: 'ctl-b', name: 'IDS' }])
    await registerAll(dir)
    const pushed = await readModelDirectory(dir)
    const linked = { 'c-web': resolved([['ctl-a', 'WAF'], ['ctl-b', 'IDS']]) }
    // The files still hold the pushed list: nothing to carry, and nothing unregistered.
    expect(await registerPushPin(dir, pushed, linked, undefined, 'M1')).toEqual({ status: 'nothing' })
    // The push wrote the pinned list back (a re-export does, and so does a create).
    await setControls(dir, 'c-web', [{ id: 'ctl-a', name: 'WAF' }, { id: 'greenfield-1', name: 'Local' }, { id: 'ctl-b', name: 'IDS' }])
    expect((await rows(dir)).map((r) => r.field)).toEqual(['controls'])
    const r = await registerPushPin(dir, pushed, linked, undefined, 'M1')
    expect(r).toMatchObject({ status: 'registered', registered: 1 })
    const g = await get(dir)
    expect(g.unregistered_changes.rows_total).toBe(0)
    expect(g.registered.push_pin).toBe(1)
    expect(g.settlements_recent.at(-1)).toMatchObject({ action: 'push-pin', model_id: 'M1', pinned: 1 })
  })

  it('carries nothing the operator did not register as pushed, nor a list the files hold otherwise', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ name: 'WAF' }])
    await registerAll(dir)
    const pushed = await readModelDirectory(dir)
    const linked = { 'c-web': resolved([['ctl-a', 'WAF']]) }
    // The files hold another id than the push linked.
    await setControls(dir, 'c-web', [{ id: 'ctl-q', name: 'WAF' }])
    expect(await registerPushPin(dir, pushed, linked, undefined, 'M1')).toEqual({ status: 'nothing' })
    // A pushed list the operator never registered.
    const unregistered = structuredClone(pushed)
    component(unregistered.structure, 'c-web').controls = [{ name: 'WAF' }, { name: 'MFA' }]
    await setControls(dir, 'c-web', [{ id: 'ctl-a', name: 'WAF' }, { id: 'ctl-m', name: 'MFA' }])
    expect(await registerPushPin(dir, unregistered, { 'c-web': resolved([['ctl-a', 'WAF'], ['ctl-m', 'MFA']]) }, undefined, 'M1')).toEqual({ status: 'nothing' })
    expect((await rows(dir)).map((r) => r.field)).toEqual(['controls'])
  })

  it('finds an element the push created under its new id', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ name: 'WAF' }])
    await registerAll(dir)
    const pushed = await readModelDirectory(dir)
    // The platform gave c-web a new id, and the files were written with it.
    await editJson(path.join(dir, 'structure.json'), (s) => { const c = component(s, 'c-web'); c.id = 'srv-web'; c.controls = [{ id: 'ctl-a', name: 'WAF' }] })
    await fs.rename(path.join(dir, 'attributes', 'components', 'c-web.json'), path.join(dir, 'attributes', 'components', 'srv-web.json'))
    await editJson(path.join(dir, 'attributes', 'components', 'srv-web.json'), (d) => { d.elementId = 'srv-web' })
    await editJson(path.join(dir, 'dataflows.json'), (d) => {
      for (const f of Array.isArray(d) ? d : d.dataFlows) for (const e of [f.source, f.target]) if (e?.id === 'c-web') e.id = 'srv-web'
    })
    const r = await registerPushPin(dir, pushed, { 'c-web': resolved([['ctl-a', 'WAF']]) }, new Map([['c-web', 'srv-web']]), 'M1')
    expect(r).toMatchObject({ status: 'registered', registered: 1 })
  })
})

describe('a local control created on the platform', () => {
  it("carries the registrations that named it, once, and only where the files hold exactly the new id", async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ id: 'greenfield-1', name: 'Local' }, { id: 'ctl-b', name: 'IDS' }])
    await setControls(dir, 'c-orders', [{ id: 'greenfield-1', name: 'Local' }])
    await registerAll(dir)
    // The rewrite: c-web holds the new id; c-orders changed something else at the same time.
    await setControls(dir, 'c-web', [{ id: 'srv-7', name: 'Local' }, { id: 'ctl-b', name: 'IDS' }])
    await setControls(dir, 'c-orders', [{ id: 'srv-7', name: 'Local' }, { id: 'ctl-x', name: 'Extra' }])
    const r = await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv-7' })
    expect(r).toMatchObject({ status: 'registered', registered: 1 })
    expect((await get(dir)).registered.greenfield).toBe(1)
    const left = await rows(dir)
    expect(left.map((x) => [x.element_id, x.field, x.flagged])).toEqual([['c-orders', 'controls', true]])
    expect((await get(dir)).settlements_recent.at(-1)).toMatchObject({ action: 'greenfield', temp_id: 'greenfield-1', server_id: 'srv-7', carried: 1 })
    // Again, as a replay after a crash: nothing left to carry, and no new rows.
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
    expect((await rows(dir)).length).toBe(1)
  })

  it('never carries to a decoy id, and a carry that fails leaves a flagged row', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ id: 'greenfield-1', name: 'Local' }])
    await registerAll(dir)
    await setControls(dir, 'c-web', [{ id: 'decoy', name: 'Local' }])
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
    await setControls(dir, 'c-web', [{ id: 'srv-7', name: 'Local' }])
    await fs.writeFile(path.join(home, '.dethernety', 'baseline-pointers.json'), 'not json', { mode: 0o600 })
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv-7' })).toEqual({ status: 'failed', code: 'pointer_unavailable' })
    await fs.rm(path.join(home, '.dethernety', 'baseline-pointers.json'))
    const [row] = await rows(dir)
    expect(row).toMatchObject({ field: 'controls', flagged: true, controls_change: { from: [{ id: 'greenfield-1', name: 'Local' }], to: [{ id: 'srv-7', name: 'Local' }] } })
    // Temporary ids only, and never onto itself.
    expect(await carryGreenfield(dir, { tempId: 'ctl-b', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'greenfield-1' })).toEqual({ status: 'nothing' })
  })

  it('carries only a temporary id, and never onto itself', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ id: 'ctl-b', name: 'IDS' }])
    await setControls(dir, 'c-orders', [{ id: 'greenfield-2', name: 'Local' }])
    await registerAll(dir)
    await setControls(dir, 'c-web', [{ id: 'srv-7', name: 'IDS' }])
    // A platform id is never "replaced by the id the platform gave it": that is an ordinary, flagged row.
    expect(await carryGreenfield(dir, { tempId: 'ctl-b', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
    expect(await carryGreenfield(dir, { tempId: 'greenfield-2', serverId: 'greenfield-2' })).toEqual({ status: 'nothing' })
    expect(Object.values(baseline(dir).sources)).toEqual([])
  })

  it('finds nothing to carry after a pull registered the platform ids', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ id: 'srv-7', name: 'Local' }])
    await registerPulled(dir, await readModelDirectory(dir), { modelId: 'M1', prints: {} })
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
  })
})

describe('what binds, and what a writer refuses', () => {
  it('keeps a value pulled twice pulled, with the model it came from, its controls list and the prints in the log', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ id: 'ctl-a', name: 'WAF' }])
    const split = await readModelDirectory(dir)
    const prints = { 'c-web': { k: 'component' } }
    await registerPulled(dir, split, { modelId: 'M7', prints })
    const again = await registerPulled(dir, split, { modelId: 'M7', prints })
    expect(again.registered).toBeGreaterThan(0)
    const b = baseline(dir)
    expect(b.pull).toEqual({ model_id: 'M7' })
    expect(Object.values(b.sources).every((s) => s === 'pull')).toBe(true)
    expect(Object.keys(b.sources)).toHaveLength(Object.keys(b.values).length)
    expect(Object.values(b.controls_registered)).toEqual([[{ id: 'ctl-a', name: 'WAF' }]])
    expect(readJson(logPath(dir)).entries.at(-1)).toMatchObject({ action: 'pull', model_id: 'M7', prints: sha256(canonicalJson(prints)) })
    expect(await registerPulled(dir, split, { modelId: '../M7', prints })).toEqual({ status: 'failed', code: 'model_id_invalid' })
  })

  it('drops an operator\'s "left empty" on an element the platform no longer holds, never registers what cannot be shown, and fails closed on an unreadable pending file', async () => {
    const dir = await model()
    await registerAll(dir)
    const split = await readModelDirectory(dir)
    const gone = JSON.stringify(['ROOT/B:Edge/C:Gone', 'cls-x', 'PROCESS', 'components', 'attr', 'f'])
    await resign(dir, (c) => { c.values[gone] = ABSENT })
    ;(split.attributes as any).components['c-web'].attributes.hidden = `W${String.fromCharCode(0x200b)}AF`
    const r = await registerPulled(dir, split, { modelId: 'M1', prints: {} })
    expect(r.status).toBe('registered')
    const keys = Object.keys(baseline(dir).values)
    expect(keys).not.toContain(gone)
    expect(keys.some((k) => JSON.parse(k)[5] === 'hidden')).toBe(false)

    const before = readFileSync(baselinePath(dir))
    for (const bad of ['{not json', JSON.stringify({ version: 1, entries: 'not a list' })]) {
      await fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), bad)
      expect(await registerPulled(dir, split, { modelId: 'M1', prints: {} })).toEqual({ status: 'failed', code: 'pending_enrichment' })
      expect(readFileSync(baselinePath(dir)).equals(before)).toBe(true)
    }
  })

  it('never pins a pulled list, nor a list that already had its ids, and never carries a pulled list', async () => {
    const dir = await model()
    await setControls(dir, 'c-web', [{ name: 'WAF' }])
    await setControls(dir, 'c-orders', [{ id: 'ctl-b', name: 'IDS' }])
    await setControls(dir, 'c-gateway', [{ id: 'greenfield-1', name: 'Local' }])
    await registerPulled(dir, await readModelDirectory(dir), { modelId: 'M1', prints: {} })
    await syncedTo(dir, 'M1')
    const pushed = await readModelDirectory(dir)
    await setControls(dir, 'c-web', [{ id: 'ctl-a', name: 'WAF' }])
    expect(await registerPushPin(dir, pushed, { 'c-web': [{ id: 'ctl-a', name: 'WAF' }] }, undefined, 'M1')).toEqual({ status: 'nothing' })
    await setControls(dir, 'c-gateway', [{ id: 'srv-7', name: 'Local' }])
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
    expect(new Set(Object.values(baseline(dir).sources))).toEqual(new Set(['pull']))

    // The operator's list that already had its ids: pushed unchanged, nothing to pin.
    const own = await model()
    await setControls(own, 'c-orders', [{ id: 'ctl-b', name: 'IDS' }])
    await registerAll(own)
    expect(await registerPushPin(own, await readModelDirectory(own), { 'c-orders': [{ id: 'ctl-b', name: 'IDS' }] }, undefined, 'M1')).toEqual({ status: 'nothing' })
    expect(baseline(own).sources).toEqual({})
  })

  it("pins the model's own controls, and never carries to another temporary id", async () => {
    const dir = await model((m) => { m.manifest.model.controls = [{ name: 'Policy' }] })
    await registerAll(dir)
    const pushed = await readModelDirectory(dir)
    await editJson(path.join(dir, 'manifest.json'), (m) => { m.model.controls = [{ id: 'pol-1', name: 'Policy' }] })
    expect(await registerPushPin(dir, pushed, { '@model': [{ id: 'pol-1', name: 'Policy' }] }, undefined, 'M1')).toMatchObject({ status: 'registered', registered: 1 })

    await setControls(dir, 'c-web', [{ id: 'greenfield-1', name: 'Local' }])
    await registerAll(dir)
    await setControls(dir, 'c-web', [{ id: 'greenfield-evil', name: 'Local' }])
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'greenfield-evil' })).toEqual({ status: 'nothing' })
    expect(await carryGreenfield(dir, { tempId: 'greenfield-1', serverId: 'srv 7' })).toEqual({ status: 'nothing' })
  })

  it('never lets a baseline file or a directory swapped in move this machine\'s pointer, or sign for another path', async () => {
    const dir = await model()
    await registerAll(dir)
    const old = readFileSync(baselinePath(dir))
    await editJson(path.join(dir, 'attributes', 'components', 'c-web.json'), (d) => { d.attributes.asset_criticality = 'low' })
    await registerAll(dir)
    // An agent writes an enormous revision into the file, then a writer runs.
    await editJson(baselinePath(dir), (d) => { d.revision = Number.MAX_SAFE_INTEGER })
    const r = await registerPulled(dir, await readModelDirectory(dir), { modelId: 'M1', prints: {} })
    expect(r.status).toBe('registered')
    expect(Object.values(readJson(path.join(home, '.dethernety', 'baseline-pointers.json')).models)).toEqual([{ revision: baseline(dir).revision }])
    expect(baseline(dir).revision).toBeLessThan(10)
    // The older copy put back still reads as rolled back.
    await fs.writeFile(baselinePath(dir), old)
    expect((await get(dir)).baseline_code).toBe('rolled_back')

    // A pointer file that holds a revision no count can be is not used at all.
    await editJson(path.join(home, '.dethernety', 'baseline-pointers.json'), (d) => { for (const m of Object.values(d.models) as any[]) m.revision = 2 ** 60 })
    expect(await registerPulled(dir, await readModelDirectory(dir), { modelId: 'M1', prints: {} })).toEqual({ status: 'failed', code: 'pointer_unavailable' })
  })

  it('refuses a directory that resolves elsewhere by the time the locks are held', async () => {
    const dir = await model()
    await registerAll(dir)
    const real = fs.realpath
    let calls = 0
    const spy = vi.spyOn(fs, 'realpath').mockImplementation((async (p: any, ...rest: any[]) => {
      const r = await (real as any)(p, ...rest)
      return p === dir && ++calls === 3 ? `${r}-elsewhere` : r
    }) as never)
    try {
      expect(await registerPulled(dir, await readModelDirectory(dir), { modelId: 'M1', prints: {} })).toEqual({ status: 'failed', code: 'moved' })
    } finally {
      spy.mockRestore()
    }
    expect(Object.keys(baseline(dir).sources)).toEqual([])
  })

  it('keeps the machine\'s registrations out of a baseline carried from another directory', async () => {
    const source = await model()
    await setControls(source, 'c-web', [{ id: 'greenfield-1', name: 'Local' }])
    await setControls(source, 'c-orders', [{ name: 'WAF' }])
    await registerAll(source)
    const [someKey] = Object.keys(baseline(source).values).filter((k) => JSON.parse(k)[4] === 'attr')
    await resign(source, (c) => { c.sources[someKey!] = 'push-pin' })
    const copy = path.join(root, `copy${seq++}`)
    await fs.cp(source, copy, { recursive: true })
    const before = readFileSync(baselinePath(copy))
    const pushed = await readModelDirectory(copy)
    // Pin and carry sign nothing for a carried baseline, even where the files hold what the platform linked.
    await setControls(copy, 'c-web', [{ id: 'srv-7', name: 'Local' }])
    await setControls(copy, 'c-orders', [{ id: 'ctl-a', name: 'WAF' }])
    expect(await carryGreenfield(copy, { tempId: 'greenfield-1', serverId: 'srv-7' })).toEqual({ status: 'nothing' })
    expect(await registerPushPin(copy, pushed, { 'c-orders': [{ id: 'ctl-a', name: 'WAF' }] }, undefined, 'M1')).toEqual({ status: 'nothing' })
    expect(readFileSync(baselinePath(copy)).equals(before)).toBe(true)
    // A pull into it keeps the operator's registrations only, and retires the source here.
    await registerPulled(copy, await readModelDirectory(copy), { modelId: 'M1', prints: {} })
    expect(baseline(copy).sources[someKey!]).toBe('pull')
    expect((await get(source)).baseline_code).toBe('rolled_back')
  })
})

describe('the per-machine files and the registry', () => {
  it('keeps .dethereal/.gitignore to adding the lines it lacks, and never writes through a link', async () => {
    const dir = await model()
    const ignore = path.join(dir, '.dethereal', '.gitignore')
    await fs.writeFile(ignore, '# mine\r\nnotes.md\r\n/settlements.json')
    await registerAll(dir)
    expect(readFileSync(ignore, 'utf8')).toBe('# mine\r\nnotes.md\r\n/settlements.json\nsettlement-baseline.json\nsync.json\ncontrol-audit.log\nrelay/\n')
    await editJson(path.join(dir, 'attributes', 'components', 'c-web.json'), (d) => { d.attributes.asset_criticality = 'low' })
    const again = await modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: 'components', element_id: 'c-web', field: 'asset_criticality', decision: 'confirm', value: 'low' }] } as never, context) as any
    expect(again.success, again.error).toBe(true)
    expect(again.data.gitignore).toBeUndefined()

    // A project from before the control audit log was ignored gets that one line added, and nothing else changes.
    const older = await model()
    const olderIgnore = path.join(older, '.dethereal', '.gitignore')
    const before = '# Written by Dethereal: settlement and sync records of this machine, never shared.\nsettlement-baseline.json\nsettlements.json\nsync.json\n'
    await fs.writeFile(olderIgnore, before)
    await registerAll(older)
    expect(readFileSync(olderIgnore, 'utf8')).toBe(`${before}control-audit.log\nrelay/\n`)

    const linked = await model()
    const target = path.join(root, `outside-${seq++}`)
    await fs.writeFile(target, 'keep me\n')
    await fs.symlink(target, path.join(linked, '.dethereal', '.gitignore'))
    await editJson(path.join(linked, 'attributes', 'components', 'c-web.json'), (d) => { d.attributes.asset_criticality = 'low' })
    const r = await modelStateSettleTool.run({ action: 'settle', directory_path: linked, reply: 'Yes.', items: [{ group: 'components', element_id: 'c-web', field: 'asset_criticality', decision: 'confirm', value: 'low' }] } as never, context) as any
    expect(r.success, r.error).toBe(true)
    expect(r.data.gitignore).toBe('refused')
    expect(readFileSync(target, 'utf8')).toBe('keep me\n')
  })

  it('puts a pulled directory in the project registry once, leaving an entry that names it as it is', async () => {
    initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
    try {
      const dir = await model()
      const merge = () => modelStateTool.run({ action: 'merge_pulled', directory_path: dir } as never, context) as Promise<any>
      const first = await merge()
      expect(first.success, first.error).toBe(true)
      const registry = () => readJson(path.join(root, '.dethernety', 'models.json')).models.filter((m: any) => path.resolve(root, m.path) === dir)
      expect(registry()).toEqual([expect.objectContaining({ source: 'pull' })])
      await editJson(path.join(root, '.dethernety', 'models.json'), (d) => { for (const m of d.models) if (path.resolve(root, m.path) === dir) m.name = 'Named by the operator' })
      expect((await merge()).success).toBe(true)
      expect(registry()).toEqual([expect.objectContaining({ name: 'Named by the operator', source: 'pull' })])
    } finally {
      resetProjectRoot()
    }
  })
})
