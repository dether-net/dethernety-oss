/**
 * One rule for every decision that registers a value: a field of the element's class, or a key the gates
 * read or the workflow asks for on that kind of element, with a value that fits. `set`, `confirm`, `accept`
 * and `modify` hold a value to it alike; a value already registered stays registered; a row no decision
 * could register says why; removing a value never needs the rule.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const { richExport } = await import('./fixtures/platform-export.js')
  return { ...actual, DtExportSplit: class { constructor(_c: unknown) {} exportModelToSplit = async () => richExport() } }
})

const { modelStateTool } = await import('../model-state.tool.js')
const { modelStateSettleTool } = await import('../model-state-settle.tool.js')
const { exportModelTool } = await import('../export-model.tool.js')
const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
const { registerAll } = await import('./helpers/settle.js')
const { initProjectRoot, resetProjectRoot } = await import('../../utils/project-root.js')
type GateModel = ReturnType<typeof gateModel>

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-settle-registrable-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-registrable-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  const h = path.join(homes, `h${seq++}`)
  await fs.mkdir(h)
  process.env.HOME = h
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
})

const FLOOR = ['authentication_type', 'encryption_in_transit', 'encryption_at_rest', 'implicit_deny_enabled', 'monitoring_tools']

/**
 * Templates with gaps: the service class declares no floor keys, the HTTP/S class no auth_failure_mode, and the
 * application boundary has a class (Network Segment) that declares none of the enforcement keys.
 */
function templateGaps(m: GateModel): void {
  for (const k of FLOOR) delete m.classCache['cls-service']!.template.schema.properties[k]
  delete m.classCache['cls-https']!.template.schema.properties.auth_failure_mode
  const b = m.structure.defaultBoundary.boundaries!.find((x: any) => x.id === 'b-app') as any
  b.classData = { id: 'cls-segment', name: 'Network Segment' }
  m.classCache['cls-segment'] = { classId: 'cls-segment', className: 'Network Segment', classType: 'boundary', template: { schema: { type: 'object', properties: { segment_cidr: { type: 'string' } } } } }
  m.attributes.boundaries['b-app'] = { elementId: 'b-app', elementType: 'boundary', elementName: 'Application', classData: b.classData, attributes: {} }
}

async function model(mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await registerAll(dir)
  return dir
}

const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'] }, context)) as any).data
const settle = (dir: string, items: Array<Record<string, unknown>>) =>
  modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: 'Yes, those are the values.', items } as never, context) as Promise<any>
const attrPath = (dir: string, group: string, id: string) => path.join(dir, 'attributes', group, `${id}.json`)
const attrs = (dir: string, group: string, id: string) => JSON.parse(readFileSync(attrPath(dir, group, id), 'utf8')).attributes
const editAttrs = async (dir: string, group: string, id: string, fn: (a: any) => void) => {
  const doc = JSON.parse(readFileSync(attrPath(dir, group, id), 'utf8'))
  fn(doc.attributes)
  await fs.writeFile(attrPath(dir, group, id), JSON.stringify(doc, null, 2))
}
const writePending = (dir: string, entries: Array<Record<string, unknown>>) =>
  fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 1, entries }))
const pending = (extra: Record<string, unknown>) => ({ batch: 'b1', group: 'components', element_id: 'c-web', source: 'app/server.py:12', previous: 'null', ...extra })
const rows = async (dir: string) => (await get(dir)).unregistered_changes.rows.map((r: any) => `${r.element_id}.${r.record ? 'record:' : ''}${r.field}${r.code ? `:${r.code}` : ''}`).sort()
const baseline = (dir: string) => readFileSync(path.join(dir, '.dethereal', 'settlement-baseline.json'))
const set = (group: string, id: string, name: string, field: string, value: unknown, extra: Record<string, unknown> = {}) =>
  ({ group, element_id: id, element_name: name, field, decision: 'set', value, ...extra })

describe('set on templates with gaps', () => {
  it('registers the floor, enforcement and flow keys the templates lack, and echoes each', async () => {
    const dir = await model(templateGaps)
    const r = await settle(dir, [
      set('components', 'c-web', 'Web frontend', 'monitoring_tools', ['siem', 'cloud audit log']),
      set('components', 'c-web', 'Web frontend', 'asset_criticality', 'high'),
      set('boundaries', 'b-app', 'Application', 'implicit_deny_enabled', true),
      set('boundaries', 'b-app', 'Application', 'allow_any_inbound', false),
      set('boundaries', 'b-app', 'Application', 'egress_filtering', 'allow_list'),
      set('dataFlows', 'f-submit', 'Order submit', 'auth_failure_mode', 'fail_open'),
    ])
    expect(r.success, JSON.stringify(r.data)).toBe(true)
    expect(r.data.recorded).toBe(6)
    expect(r.data.echo.map((e: any) => `${e.element_id}.${e.field}`)).toEqual([
      'c-web.monitoring_tools', 'c-web.asset_criticality', 'b-app.implicit_deny_enabled', 'b-app.allow_any_inbound', 'b-app.egress_filtering', 'f-submit.auth_failure_mode',
    ])
    expect(attrs(dir, 'boundaries', 'b-app')).toMatchObject({ implicit_deny_enabled: true, allow_any_inbound: false, egress_filtering: 'allow_list' })
    expect(await rows(dir)).toEqual([])
  })

  it('refuses a workflow key on another kind of element and an ill-typed value, and writes nothing', async () => {
    const dir = await model(templateGaps)
    const before = baseline(dir)
    const r = await settle(dir, [
      set('components', 'c-web', 'Web frontend', 'egress_filtering', 'allow_list'),
      set('boundaries', 'b-app', 'Application', 'auth_failure_mode', 'deny'),
      set('boundaries', 'b-app', 'Application', 'egress_filtering', 'maybe'),
      set('boundaries', 'b-app', 'Application', 'allow_any_inbound', 'yes'),
      set('components', 'c-web', 'Web frontend', 'asset_criticality', 'high'),
    ])
    expect(r.success).toBe(false)
    expect(r.data.refused.map((x: any) => [x.index, x.code])).toEqual([[0, 'off_template_field'], [1, 'off_template_field'], [2, 'invalid_value'], [3, 'invalid_value']])
    expect(baseline(dir).equals(before)).toBe(true)
    expect(attrs(dir, 'components', 'c-web')).not.toHaveProperty('asset_criticality')
  })
})

describe('confirm, accept and modify: the same rule', () => {
  it('confirm registers a well-typed workflow key and refuses an off-template field or an ill-typed value, as get codes them', async () => {
    const dir = await model()
    await editAttrs(dir, 'components', 'c-web', (a) => { a.made_up = 'x'; a.asset_criticality = 'critical'; a.stores_credentials = false })
    expect(await rows(dir)).toEqual(['c-web.asset_criticality:invalid_value', 'c-web.made_up:off_template_field', 'c-web.stores_credentials'])
    const confirm = (field: string, value: unknown) => ({ group: 'components', element_id: 'c-web', field, decision: 'confirm', value })
    const refused = await settle(dir, [confirm('made_up', 'x'), confirm('asset_criticality', 'critical')])
    expect(refused.data.refused.map((x: any) => x.code)).toEqual(['off_template_field', 'invalid_value'])
    expect((await settle(dir, [confirm('stores_credentials', false)])).data).toMatchObject({ recorded: 1 })
  })

  it('accept and modify refuse what the rule refuses; reject still answers the row', async () => {
    const dir = await model()
    await editAttrs(dir, 'components', 'c-web', (a) => { a.made_up = 'x'; a.asset_criticality = 'critical' })
    await writePending(dir, [pending({ field: 'made_up', value: 'x' }), pending({ field: 'asset_criticality', value: 'critical' })])
    const row = (field: string, decision: string, value?: unknown) => ({ group: 'components', element_id: 'c-web', field, decision, ...(value === undefined ? {} : { value }) })
    const r = await settle(dir, [row('made_up', 'accept', 'x'), row('asset_criticality', 'accept', 'critical')])
    expect(r.data.refused.map((x: any) => x.code)).toEqual(['off_template_field', 'invalid_value'])
    expect(r.data.refused[0].message).toMatch(/answer this row with reject/)
    expect((await settle(dir, [row('made_up', 'modify', 'y')])).data.refused[0].code).toBe('off_template_field')
    const ok = await settle(dir, [row('made_up', 'reject'), row('asset_criticality', 'modify', 'low')])
    expect(ok.data, JSON.stringify(ok.data)).toMatchObject({ recorded: 2 })
    expect(attrs(dir, 'components', 'c-web')).toMatchObject({ made_up: null, asset_criticality: 'low' })
  })

  it("the pending route: accept registers a template field and a floor key the template lacks", async () => {
    const dir = await model((m) => { delete m.classCache['cls-service']!.template.schema.properties.monitoring_tools })
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list'; a.monitoring_tools = ['siem'] })
    await writePending(dir, [pending({ field: 'input_validation', value: 'allow_list' }), pending({ field: 'monitoring_tools', value: ['siem'] })])
    const r = await settle(dir, [
      { group: 'components', element_id: 'c-web', field: 'input_validation', decision: 'accept', value: 'allow_list' },
      { group: 'components', element_id: 'c-web', field: 'monitoring_tools', decision: 'accept', value: ['siem'] },
    ])
    expect(r.data, JSON.stringify(r.data)).toMatchObject({ recorded: 2 })
    expect(await rows(dir)).toEqual([])
  })
})

describe('records', () => {
  it('confirm holds a record to its own rule, as set does', async () => {
    const dir = await model()
    const structure = path.join(dir, 'structure.json')
    const s = JSON.parse(readFileSync(structure, 'utf8'))
    s.defaultBoundary.boundaries.find((b: any) => b.id === 'b-app').zone = 'BANANA'
    await fs.writeFile(structure, JSON.stringify(s, null, 2))
    expect(await rows(dir)).toEqual(['b-app.record:zone:invalid_value'])
    const r = await settle(dir, [{ group: 'boundaries', element_id: 'b-app', field: 'zone', record: true, decision: 'confirm', value: 'BANANA' }])
    expect(r.data.refused.map((x: any) => x.code)).toEqual(['invalid_value'])
    const fixed = await settle(dir, [set('boundaries', 'b-app', 'Application', 'zone', 'INTERNAL', { record: true })])
    expect(fixed.data, JSON.stringify(fixed.data)).toMatchObject({ recorded: 1 })
    expect(await rows(dir)).toEqual([])
  })
})

describe('what is registered stays registered', () => {
  it('a value registered before its class cache went stays registered; a retried confirm of it is settled, not refused', async () => {
    const dir = await model()
    await fs.rm(path.join(dir, '.dethereal', 'class-cache'), { recursive: true })
    expect(await rows(dir)).toEqual([])
    const again = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'input_validation', decision: 'confirm', value: attrs(dir, 'components', 'c-web').input_validation }])
    expect(again.data).toMatchObject({ recorded: 0, already_settled: [0] })
    const retriedSet = await settle(dir, [set('components', 'c-web', 'Web frontend', 'input_validation', attrs(dir, 'components', 'c-web').input_validation)])
    expect(retriedSet.data).toMatchObject({ recorded: 0, already_settled: [0] })
    // A change now needs a class template to register (only the workflow's keys register without one).
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'none' })
    expect(await rows(dir)).toEqual(['c-web.input_validation:no_template'])
  })

  it('a pulled model, with no class cache, shows nothing to register', async () => {
    const dir = path.join(root, `pull${seq++}`)
    const res = (await exportModelTool.run({ model_id: 'm-1', directory_path: dir }, { debug: false, apolloClient: {} as never })) as any
    expect(res.success, res.error).toBe(true)
    expect(existsSync(path.join(dir, '.dethereal', 'class-cache'))).toBe(false)
    const g = await get(dir)
    expect(g.unregistered_changes.rows_total).toBe(0)
  })

  it('reject clears a pending row on a field no decision could register, whose value was registered', async () => {
    const dir = await model()
    // The class loses the field after its value was registered: the value stays registered, and cannot be renewed.
    const cache = path.join(dir, '.dethereal', 'class-cache', 'cls-service.json')
    const entry = JSON.parse(readFileSync(cache, 'utf8'))
    delete entry.template.schema.properties.input_validation
    await fs.writeFile(cache, JSON.stringify(entry))
    await writePending(dir, [pending({ field: 'input_validation', value: 'schema', previous: 'null' })])
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'input_validation', decision: 'reject' }])
    expect(r.data, JSON.stringify(r.data)).toMatchObject({ recorded: 1 })
    expect(attrs(dir, 'components', 'c-web').input_validation).toBeNull()
  })

  it('a reclassification leftover is dropped with set absent: true, and nothing is left to register', async () => {
    const dir = await model()
    const structure = path.join(dir, 'structure.json')
    const s = JSON.parse(readFileSync(structure, 'utf8'))
    const find = (b: any): any => (b.components ?? []).find((c: any) => c.id === 'c-orders') ?? (b.boundaries ?? []).map(find).find(Boolean)
    find(s.defaultBoundary).classData = { id: 'cls-gateway', name: 'API Gateway' }
    await fs.writeFile(structure, JSON.stringify(s, null, 2))
    const leftovers = (await rows(dir)).filter((r: string) => r.endsWith(':off_template_field')).map((r: string) => r.split('.')[1]!.split(':')[0]!)
    expect(leftovers.sort()).toEqual(['input_validation', 'runs_as_root'])
    const drop = await modelStateSettleTool.run({
      action: 'settle', directory_path: dir, reply: 'Drop them.', orphaned_acknowledged: (await get(dir)).orphaned_registrations.total,
      items: leftovers.map((field: string) => set('components', 'c-orders', 'Order service', field, undefined, { absent: true })),
    } as never, context) as any
    expect(drop.data, JSON.stringify(drop.data)).toMatchObject({ recorded: 2 })
    await registerAll(dir)
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
  })
})
