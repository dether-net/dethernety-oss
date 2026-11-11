/**
 * model_state_settle `set`: a value the operator confirmed in the chat, written and registered in one call, under
 * the element's true name and within its class template; and the echo every registration comes back with (the
 * value, the value it replaced, how that one was registered), from which a restore batch is built.
 *
 * Every test runs with its own HOME, so this machine's key and pointer never carry over.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const hooks = vi.hoisted(() => ({ afterScan: null as null | (() => Promise<void>) }))
vi.mock('../../utils/settlement-state.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/settlement-state.js')
  return {
    ...actual,
    settlementState: async (...args: Parameters<typeof actual.settlementState>) => {
      const st = await actual.settlementState(...args)
      if (hooks.afterScan) await hooks.afterScan()
      return st
    },
  }
})

const { modelStateTool } = await import('../model-state.tool.js')
const { modelStateSettleTool, ECHO_BUDGET } = await import('../model-state-settle.tool.js')
const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
const { registerAll } = await import('./helpers/settle.js')
const { parseLog } = await import('../../utils/settlement.js')

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-settle-set-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-settle-set-homes-')))
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
  hooks.afterScan = null
  modelStateSettleTool.storeOptions = {}
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const REPLY = 'Yes, set those values.'
const BIDI = String.fromCharCode(0x202e)

async function model(): Promise<string> {
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, gateModel())
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
  await registerAll(dir)
  return dir
}

const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'] }, context)) as any).data
const settle = (dir: string, items: Array<Record<string, unknown>>) =>
  modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: REPLY, items } as never, context) as Promise<any>
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const attrPath = (dir: string, group: string, id: string) => path.join(dir, 'attributes', group, `${id}.json`)
const attr = (dir: string, group: string, id: string) => readJson(attrPath(dir, group, id)).attributes
const boundary = (dir: string, id: string): any => {
  let found: any
  const walk = (b: any) => { if (b?.id === id) found = b; for (const n of b?.boundaries ?? []) walk(n) }
  walk(readJson(path.join(dir, 'structure.json')).defaultBoundary)
  return found
}
const component = (dir: string, id: string): any => {
  let found: any
  const walk = (b: any) => { for (const c of b?.components ?? []) if (c.id === id) found = c; for (const n of b?.boundaries ?? []) walk(n) }
  walk(readJson(path.join(dir, 'structure.json')).defaultBoundary)
  return found
}
const dataItem = (dir: string, id: string): any => {
  const d = readJson(path.join(dir, 'data-items.json'))
  return (Array.isArray(d) ? d : d.dataItems).find((x: any) => x.id === id)
}
async function editAttr(dir: string, group: string, id: string, fn: (a: any) => void) {
  const doc = readJson(attrPath(dir, group, id))
  fn(doc.attributes)
  await fs.writeFile(attrPath(dir, group, id), JSON.stringify(doc, null, 2))
}
/** Every model file's bytes, to prove a refusal wrote nothing. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else out[path.relative(dir, p)] = readFileSync(p, 'base64')
    }
  }
  await walk(dir)
  return out
}

const setItem = (group: string, element_id: string, element_name: string, field: string, value: unknown, extra: Record<string, unknown> = {}) =>
  ({ group, element_id, element_name, field, decision: 'set', value, ...extra })

describe('set writes and registers a confirmed value in one call', () => {
  it('an attribute value: written, registered, echoed with the value it replaced', async () => {
    const dir = await model()
    const r = await settle(dir, [setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema')])
    expect(r.success, r.error).toBe(true)
    expect(attr(dir, 'components', 'c-notify').input_validation).toBe('schema')
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
    expect(r.data.decisions).toEqual({ set: 1 })
    expect(r.data.echo).toEqual([{
      index: 0, decision: 'set', group: 'components', element_id: 'c-notify', element_name: 'Notifier', field: 'input_validation',
      value: { value: 'schema' }, previous: { value: 'none' }, previous_registered: { state: 'registered', by: 'operator' },
    }])
    expect(typeof r.data.revision).toBe('number')
    const log = parseLog(readFileSync(path.join(dir, '.dethereal', 'settlements.json')))
    expect(log.entries.at(-1)).toMatchObject({ action: 'settle', decisions: { set: 1 }, reply: REPLY })
  })

  it('record values on each group: structure.json and data-items.json written, registered, echoed', async () => {
    const dir = await model()
    const r = await settle(dir, [
      setItem('boundaries', 'b-app', 'Application', 'zone', 'RESTRICTED', { record: true }),
      setItem('boundaries', 'b-app', 'Application', 'planes', ['WORKLOAD'], { record: true }),
      setItem('components', 'c-audit', 'Audit log store', 'crownJewel', true, { record: true }),
      setItem('dataItems', 'd-audit', 'Audit event', 'sensitivity', 'confidential', { record: true }),
      setItem('dataItems', 'd-audit', 'Audit event', 'regulatory_flags', ['PII'], { record: true }),
    ])
    expect(r.success, r.error).toBe(true)
    expect(boundary(dir, 'b-app')).toMatchObject({ zone: 'RESTRICTED', planes: ['WORKLOAD'] })
    expect(component(dir, 'c-audit').crownJewel).toBe(true)
    expect(dataItem(dir, 'd-audit')).toMatchObject({ sensitivity: 'confidential', regulatory_flags: ['PII'] })
    expect(readFileSync(path.join(dir, 'structure.json'), 'utf8')).toMatch(/^\{\n {2}"/)
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
    expect(r.data.echo.map((e: any) => [e.field, e.record, e.value, e.previous])).toEqual([
      ['zone', true, { value: 'RESTRICTED' }, { value: 'INTERNAL' }],
      ['planes', true, { value: ['WORKLOAD'] }, { absent: true }],
      ['crownJewel', true, { value: true }, { absent: true }],
      ['sensitivity', true, { value: 'confidential' }, { value: 'internal' }],
      ['regulatory_flags', true, { value: ['PII'] }, { value: [] }],
    ])
  })

  it('absent removes a field; the echo then builds the restore batch that puts it back', async () => {
    const dir = await model()
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', element_name: 'Web frontend', field: 'runs_as_root', decision: 'set', absent: true }])
    expect(r.success, r.error).toBe(true)
    expect(attr(dir, 'components', 'c-web')).not.toHaveProperty('runs_as_root')
    expect(r.data.echo[0]).toMatchObject({ value: { absent: true }, previous: { value: false }, previous_registered: { state: 'registered' } })
    // The operator says it differs: the restore is a set of the echo's previous values.
    const restore = r.data.echo.map((e: any) => ({
      group: e.group, element_id: e.element_id, element_name: e.element_name, field: e.field, decision: 'set',
      ...(e.previous.absent ? { absent: true } : { value: e.previous.value }), ...(e.record ? { record: true } : {}),
    }))
    const back = await settle(dir, restore)
    expect(back.success, back.error).toBe(true)
    expect(attr(dir, 'components', 'c-web').runs_as_root).toBe(false)
    expect(back.data.echo[0]).toMatchObject({ value: { value: false }, previous: { absent: true }, previous_registered: 'registered_empty' })
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
  })

  it('absent removes a record field too', async () => {
    const dir = await model()
    const r = await settle(dir, [{ group: 'components', element_id: 'c-db', element_name: 'Orders database', field: 'crownJewel', decision: 'set', absent: true, record: true }])
    expect(r.success, r.error).toBe(true)
    expect(component(dir, 'c-db')).not.toHaveProperty('crownJewel')
    expect(r.data.echo[0]).toMatchObject({ record: true, value: { absent: true }, previous: { value: true } })
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
  })

  it('a value already set and registered is already settled, and writes nothing', async () => {
    const dir = await model()
    const before = await snapshot(dir)
    const r = await settle(dir, [setItem('components', 'c-notify', 'Notifier', 'input_validation', 'none')])
    expect(r.success, r.error).toBe(true)
    expect(r.data.already_settled).toEqual([0])
    expect(r.data.echo).toEqual([])
    expect(await snapshot(dir)).toEqual(before)
  })
})

describe('set refuses, and nothing is written', () => {
  const cases: Array<[string, Array<Record<string, unknown>>, string]> = [
    ['a wrong element name', [setItem('components', 'c-notify', 'Notifier service', 'input_validation', 'schema')], 'name_mismatch'],
    ['no element name', [{ group: 'components', element_id: 'c-notify', field: 'input_validation', decision: 'set', value: 'schema' }], 'name_mismatch'],
    ['a field not in the class template', [setItem('components', 'c-notify', 'Notifier', 'made_up_field', 'x')], 'off_template_field'],
    ['a value outside the template', [setItem('components', 'c-gateway', 'API gateway', 'waf_mode', 'strict')], 'invalid_value'],
    ['a zone outside the scale', [setItem('boundaries', 'b-app', 'Application', 'zone', 'LOW', { record: true })], 'invalid_value'],
    ['a sensitivity outside the scale', [setItem('dataItems', 'd-audit', 'Audit event', 'sensitivity', 'secret', { record: true })], 'invalid_value'],
    ['crownJewel not a boolean', [setItem('components', 'c-audit', 'Audit log store', 'crownJewel', 'yes', { record: true })], 'invalid_value'],
    ['an origin in the seed spelling', [setItem('dataItems', 'd-audit', 'Audit event', 'origin', 'arbitrary-public', { record: true })], 'invalid_value'],
    ["an origin in the platform's capitals", [setItem('dataItems', 'd-audit', 'Audit event', 'origin', 'ARBITRARY_PUBLIC', { record: true })], 'invalid_value'],
    ['is_credential not a boolean', [setItem('dataItems', 'd-audit', 'Audit event', 'is_credential', 'yes', { record: true })], 'invalid_value'],
    ["an origin on a component", [setItem('components', 'c-audit', 'Audit log store', 'origin', 'curated_internal', { record: true })], 'not_found'],
    ['a record field on another group', [setItem('components', 'c-audit', 'Audit log store', 'zone', 'PUBLIC', { record: true })], 'not_found'],
    ['classData', [setItem('components', 'c-audit', 'Audit log store', 'classData', { id: 'cls-service' }, { record: true })], 'record_field'],
    ['controls', [setItem('components', 'c-audit', 'Audit log store', 'controls', [], { record: true })], 'record_field'],
    ["the model's own controls", [{ group: 'model', element_id: '@model', field: 'controls', decision: 'set', element_name: 'x', value: [], record: true }], 'record_field'],
    ['absent with a value', [{ ...setItem('components', 'c-web', 'Web frontend', 'runs_as_root', false), absent: true }], 'value_differs'],
    ['absent on another decision', [{ group: 'components', element_id: 'c-web', field: 'runs_as_root', decision: 'confirm', value: false, absent: true }], 'not_found'],
    ['an unclean value', [setItem('components', 'c-notify', 'Notifier', 'input_validation', `sch${BIDI}ema`)], 'unclean_value'],
  ]
  it.each(cases)('%s', async (_label, items, code) => {
    const dir = await model()
    const before = await snapshot(dir)
    const r = await settle(dir, items)
    expect(r.success).toBe(false)
    expect(r.data.codes).toContain(code)
    expect(await snapshot(dir)).toEqual(before)
  })

  it('the root boundary: the settlement carries no record value there, so nothing is set', async () => {
    const dir = await model()
    const rootId = readJson(path.join(dir, 'structure.json')).defaultBoundary.id
    const rootName = readJson(path.join(dir, 'structure.json')).defaultBoundary.name
    const structure = readFileSync(path.join(dir, 'structure.json'))
    const r = await settle(dir, [setItem('boundaries', rootId, rootName, 'zone', 'PUBLIC', { record: true })])
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['not_found'])
    expect(readFileSync(path.join(dir, 'structure.json')).equals(structure)).toBe(true)
  })

  it('a batch with one refused item writes none of the others', async () => {
    const dir = await model()
    const before = await snapshot(dir)
    const r = await settle(dir, [
      setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema'),
      setItem('boundaries', 'b-app', 'Application', 'zone', 'RESTRICTED', { record: true }),
      setItem('components', 'c-gateway', 'API gateway', 'waf_mode', 'strict'),
    ])
    expect(r.data.codes).toEqual(['invalid_value'])
    expect(await snapshot(dir)).toEqual(before)
  })

  it('a field with a pending row is not set: the row is accepted, rejected or modified', async () => {
    const dir = await model()
    await fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 1, entries: [
      { batch: 'b1', group: 'components', element_id: 'c-notify', field: 'input_validation', value: 'allow_list', source: 'agent', previous: 'absent' },
    ] }))
    await editAttr(dir, 'components', 'c-notify', (a) => { a.input_validation = 'allow_list' })
    const r = await settle(dir, [setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema')])
    expect(r.data.codes).toContain('duplicate_pending')
  })

  it('an element without a class template in the cache', async () => {
    const dir = await model()
    await fs.rm(path.join(dir, '.dethereal', 'class-cache', 'cls-service.json'))
    const r = await settle(dir, [setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema')])
    expect(r.data.codes).toContain('no_template')
  })

  it('a record value changed after the call was planned: refused, nothing written, attributes in the same call included', async () => {
    const dir = await model()
    hooks.afterScan = async () => {
      const s = readJson(path.join(dir, 'structure.json'))
      const walk = (b: any) => { if (b?.id === 'b-app') b.zone = 'PUBLIC'; for (const n of b?.boundaries ?? []) walk(n) }
      walk(s.defaultBoundary)
      await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(s, null, 2))
      hooks.afterScan = null
    }
    const logBefore = readFileSync(path.join(dir, '.dethereal', 'settlements.json'))
    const attrBefore = readFileSync(attrPath(dir, 'components', 'c-notify'))
    const r = await settle(dir, [
      setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema'),
      setItem('boundaries', 'b-app', 'Application', 'zone', 'RESTRICTED', { record: true }),
    ])
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['changed'])
    expect(boundary(dir, 'b-app').zone).toBe('PUBLIC')
    // Nothing else was written either: the attribute value in the same call stays as it was.
    expect(readFileSync(attrPath(dir, 'components', 'c-notify')).equals(attrBefore)).toBe(true)
    expect(readFileSync(path.join(dir, '.dethereal', 'settlements.json')).equals(logBefore)).toBe(true)
  })

  it('a batch whose echo would not fit: refused before any write, naming the largest items', async () => {
    const dir = await model()
    const flows = readJson(path.join(dir, 'dataflows.json'))
    const list = (Array.isArray(flows) ? flows : flows.dataFlows).filter((f: any) => f.classData?.id === 'cls-https')
    const long = (n: number) => `TLS 1.3 with mutual authentication, pinned certificates and rotation ${n} `.repeat(40).slice(0, 3000)
    const items = list.flatMap((f: any, i: number) => [
      setItem('dataFlows', f.id, f.name, 'encryption_in_transit', long(i)),
      setItem('dataFlows', f.id, f.name, 'credential_type', long(i + 100)),
    ])
    expect(items.length * 3000).toBeGreaterThan(ECHO_BUDGET)
    const before = await snapshot(dir)
    const r = await settle(dir, items)
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['echo_too_large'])
    expect(r.data.items.length).toBeGreaterThan(0)
    expect(await snapshot(dir)).toEqual(before)
  })
})

describe('the echo covers every registration, not only writes', () => {
  it('a value the agent wrote itself, then confirmed: echoed with the registered value it replaced', async () => {
    const dir = await model()
    await editAttr(dir, 'components', 'c-orders', (a) => { a.runs_as_root = true })
    const r = await settle(dir, [{ group: 'components', element_id: 'c-orders', field: 'runs_as_root', decision: 'confirm', value: true }])
    expect(r.success, r.error).toBe(true)
    expect(r.data.echo).toEqual([expect.objectContaining({
      decision: 'confirm', element_name: 'Order service', field: 'runs_as_root',
      value: { value: true }, previous: { value: true }, previous_registered: { state: 'registered_other', by: 'operator' },
    })])
  })

  it('shows a value or a name that cannot be shown safely only as its hash', async () => {
    const dir = await model()
    await editAttr(dir, 'components', 'c-notify', (a) => { a.input_validation = `none${BIDI}` })
    const r = await settle(dir, [setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema')])
    expect(r.success, r.error).toBe(true)
    expect(r.data.echo[0].previous).toEqual({ undisplayable: true, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(JSON.stringify(r.data)).not.toContain(BIDI)
  })

  it('a failure part-way converges on retry, and the retry echoes the batch', async () => {
    const dir = await model()
    const items = [
      setItem('components', 'c-notify', 'Notifier', 'input_validation', 'schema'),
      setItem('boundaries', 'b-app', 'Application', 'zone', 'RESTRICTED', { record: true }),
    ]
    modelStateSettleTool.storeOptions = { failAfterReplaces: 1 }
    expect((await settle(dir, items)).success).toBe(false)
    modelStateSettleTool.storeOptions = {}
    const r = await settle(dir, items)
    expect(r.success, r.error).toBe(true)
    expect(attr(dir, 'components', 'c-notify').input_validation).toBe('schema')
    expect(boundary(dir, 'b-app').zone).toBe('RESTRICTED')
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
  })
})

describe("a data item's origin and credential flag", () => {
  it('set writes both to data-items.json and registers them; false is a value, not an absence', async () => {
    const dir = await model()
    const r = await settle(dir, [
      setItem('dataItems', 'd-audit', 'Audit event', 'origin', 'authenticated_first_party', { record: true }),
      setItem('dataItems', 'd-audit', 'Audit event', 'is_credential', false, { record: true }),
    ])
    expect(r.success, r.error).toBe(true)
    expect(dataItem(dir, 'd-audit')).toMatchObject({ origin: 'authenticated_first_party', is_credential: false })
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
    expect(r.data.echo.map((e: any) => [e.field, e.record, e.value, e.previous])).toEqual([
      ['origin', true, { value: 'authenticated_first_party' }, { absent: true }],
      ['is_credential', true, { value: false }, { absent: true }],
    ])
  })

  it('every origin level is taken', async () => {
    const { ORIGIN_LEVELS } = await import('@dethernety/dt-core')
    const dir = await model()
    for (const level of ORIGIN_LEVELS) {
      const r = await settle(dir, [setItem('dataItems', 'd-audit', 'Audit event', 'origin', level, { record: true })])
      expect(r.success, `${level}: ${r.error}`).toBe(true)
      expect(dataItem(dir, 'd-audit').origin).toBe(level)
    }
  })

  it('fields a model gains after it was registered are rows until confirmed, false included', async () => {
    const dir = await model()
    const doc = readJson(path.join(dir, 'data-items.json'))
    const items = Array.isArray(doc) ? doc : doc.dataItems
    const item = items.find((x: any) => x.id === 'd-audit')
    item.origin = 'third_party'
    item.is_credential = false
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify(doc, null, 2))
    const rows = (await get(dir)).unregistered_changes
    expect(rows.rows_total).toBe(2)
    expect(rows.rows.map((x: any) => [x.field, x.record]).sort()).toEqual([['is_credential', true], ['origin', true]])
    const r = await settle(dir, [
      { group: 'dataItems', element_id: 'd-audit', field: 'origin', decision: 'confirm', value: 'third_party', record: true },
      { group: 'dataItems', element_id: 'd-audit', field: 'is_credential', decision: 'confirm', value: false, record: true },
    ])
    expect(r.success, r.error).toBe(true)
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
  })

  it('absent removes the credential flag, and a confirm of a removed value is refused', async () => {
    const dir = await model()
    expect((await settle(dir, [setItem('dataItems', 'd-audit', 'Audit event', 'is_credential', true, { record: true })])).success).toBe(true)
    const r = await settle(dir, [{ group: 'dataItems', element_id: 'd-audit', element_name: 'Audit event', field: 'is_credential', decision: 'set', absent: true, record: true }])
    expect(r.success, r.error).toBe(true)
    expect(dataItem(dir, 'd-audit')).not.toHaveProperty('is_credential')
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
    const again = await settle(dir, [{ group: 'dataItems', element_id: 'd-audit', field: 'is_credential', decision: 'confirm', value: true, record: true }])
    expect(again.success).toBe(false)
  })
})
