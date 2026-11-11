/**
 * create_threat_model and update_model push with strict control resolution, say
 * why a push was refused before anything was written, and register the ids a
 * push linked for controls named without one, where the files hold them.
 *
 * dt-core's import, update and export are doubles; the settlement is real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { mockImport, mockUpdate, mockExport } = vi.hoisted(() => ({ mockImport: vi.fn(), mockUpdate: vi.fn(), mockExport: vi.fn() }))
vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtImportSplit: class { importSplitModel = mockImport },
    DtUpdateSplit: class { updateFromSplitModel = mockUpdate },
    DtExportSplit: class { exportModelToSplit = mockExport },
    mergeAttributes: (...sources: unknown[]) => sources[sources.length - 1],
  }
})
// The platform-change check and the platform record are the push's other concerns: they pass here.
vi.mock('../../utils/platform-baseline.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/platform-baseline.js')
  return { ...actual, exportPlatformPrints: async () => ({}), checkPlatformChanges: async () => ({}) }
})

const { createModelTool } = await import('../create-model.tool.js')
const { updateModelTool } = await import('../update-model.tool.js')
const { modelStateTool } = await import('../model-state.tool.js')
const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
const { readModelDirectory } = await import('../../utils/directory-utils.js')
const { parseBaseline } = await import('../../utils/settlement.js')
const { registerAll } = await import('./helpers/settle.js')

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false, apolloClient: {} as never }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-push-pin-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-push-pin-homes-')))
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
  mockImport.mockReset()
  mockUpdate.mockReset()
  mockExport.mockReset()
})

const component = (s: any, id: string): any => {
  let found: any
  const walk = (b: any) => {
    for (const c of b?.components ?? []) if (c.id === id) found = c
    for (const n of b?.boundaries ?? []) walk(n)
  }
  walk(s.defaultBoundary)
  return found
}
/** A registered model directory whose c-web names a control without an id. */
async function registered(): Promise<string> {
  const m = gateModel()
  component(m.structure, 'c-web').controls = [{ name: 'WAF' }]
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await registerAll(dir)
  return dir
}
const rowsOf = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir } as never, context)) as any).data.unregistered_changes
const linked = { 'c-web': [{ id: 'ctl-a', name: 'WAF' }] }
const refusedResult = {
  success: false, warnings: [], stats: { created: 0, updated: 0, deleted: 0 }, idMapping: new Map(),
  errors: [{ step: 'resolve_controls', code: 'control_name_ambiguous', ref: 'c-web', index: 0, control: { id: null, name: 'WAF' }, candidates: [{ id: 'a', name: 'WAF' }, { id: 'b', name: 'WAF' }], candidates_total: 2, error: 'ambiguous' }],
}

describe('update_model', () => {
  it('pushes with strict resolution, and says what to fix when a control reference is refused', async () => {
    const dir = await registered()
    mockUpdate.mockResolvedValue(refusedResult)
    const r = await updateModelTool.execute({ model_id: 'M1', directory_path: dir, create_backup: false } as never, context) as any
    expect(mockUpdate.mock.calls[0]![2]).toMatchObject({ controlResolution: 'strict' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Control references could not be resolved; nothing was pushed')
    expect(r.data).toEqual({ codes: ['control_name_ambiguous'], control_errors: [expect.objectContaining({ code: 'control_name_ambiguous', ref: 'c-web', candidates_total: 2 })] })
  })

  it('registers the pinned id the re-export wrote back, and reports what it linked', async () => {
    const dir = await registered()
    const exported = await readModelDirectory(dir)
    component(exported.structure, 'c-web').controls = [{ id: 'ctl-a', name: 'WAF' }]
    mockUpdate.mockResolvedValue({ success: true, errors: [], warnings: [], stats: { created: 0, updated: 1, deleted: 0 }, idMapping: new Map(), resolvedControls: linked, model: { name: 'Shop' } })
    mockExport.mockResolvedValue(exported)
    const r = await updateModelTool.execute({ model_id: 'M1', directory_path: dir, create_backup: false } as never, context) as any
    expect(r.success, r.error).toBe(true)
    expect(r.data.resolved_controls).toEqual(linked)
    expect(r.data.settlement_registration).toMatchObject({ status: 'registered', registered: 1 })
    expect((await rowsOf(dir)).rows_total).toBe(0)
  })
})

describe('create_threat_model', () => {
  it('pushes with strict resolution, and says what to fix when a control reference is refused', async () => {
    const dir = await registered()
    mockImport.mockResolvedValue({ ...refusedResult, model: undefined })
    const r = await createModelTool.execute({ model: await readModelDirectory(dir), directory_path: dir, include_schema: false, include_example: false } as never, context) as any
    expect(mockImport.mock.calls[0]![1]).toMatchObject({ controlResolution: 'strict' })
    expect(r.error).toBe('Control references could not be resolved; nothing was pushed')
    expect(r.data.codes).toEqual(['control_name_ambiguous'])
  })

  it('writes the linked ids into the directory it writes, and registers them where the operator registered the list', async () => {
    const dir = await registered()
    const model = await readModelDirectory(dir)
    mockImport.mockResolvedValue({ success: true, errors: [], warnings: [], idMapping: new Map(), resolvedControls: linked, model: { id: 'M9', name: 'Shop' } })
    const r = await createModelTool.execute({ model, directory_path: dir, include_schema: false, include_example: false } as never, context) as any
    expect(r.success, r.error).toBe(true)
    expect(component(JSON.parse(readFileSync(path.join(dir, 'structure.json'), 'utf8')), 'c-web').controls).toEqual([{ id: 'ctl-a', name: 'WAF' }])
    expect(r.data.settlement_registration).toMatchObject({ status: 'registered', registered: 1 })
    expect(Object.values(parseBaseline(readFileSync(path.join(dir, '.dethereal', 'settlement-baseline.json')))!.sources)).toEqual(['push-pin'])
    expect((await rowsOf(dir)).rows_total).toBe(0)
  })

  it('pins and registers a data item\'s control linked by name, as a component\'s', async () => {
    const m = gateModel()
    m.dataItems.find((i) => i.id === 'd-card')!.controls = [{ name: 'Tokenisation' }]
    const dir = path.join(root, `m${seq++}`)
    await writeGateModel(dir, m)
    await registerAll(dir)
    mockImport.mockResolvedValue({ success: true, errors: [], warnings: [], idMapping: new Map(), resolvedControls: { 'd-card': [{ id: 'ctl-t', name: 'Tokenisation' }] }, model: { id: 'M9', name: 'Shop' } })
    const r = await createModelTool.execute({ model: await readModelDirectory(dir), directory_path: dir, include_schema: false, include_example: false } as never, context) as any
    expect(r.success, r.error).toBe(true)
    const items = JSON.parse(readFileSync(path.join(dir, 'data-items.json'), 'utf8'))
    expect((Array.isArray(items) ? items : items.dataItems).find((i: any) => i.id === 'd-card').controls).toEqual([{ id: 'ctl-t', name: 'Tokenisation' }])
    expect(r.data.settlement_registration).toMatchObject({ status: 'registered', registered: 1 })
    expect((await rowsOf(dir)).rows_total).toBe(0)
  })
})
