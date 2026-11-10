/**
 * manifest.json's modules are derived. The gates read the derived list without writing anything; a
 * push gates and sends it, and import_model and update_model write it into manifest.json only after
 * every refusal has passed, and only while the file is still what the push read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import type { ToolContext } from '../base-tool.js'
import { FIXTURE_MODULE, gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { registerAll } from './helpers/settle.js'
import { richExport } from './fixtures/platform-export.js'

vi.setConfig({ testTimeout: 30_000 })

const { mockImport, mockUpdate, mockUpdateAttributes, mockExport, hooks } = vi.hoisted(() => ({
  mockImport: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateAttributes: vi.fn(),
  mockExport: vi.fn(),
  hooks: { afterGate: null as null | (() => Promise<void>), platformRefusal: null as null | { message: string }, wrote: 0, recordThrows: null as null | string },
}))

/** As dt-core does: every check passed, the hook runs, and only then the platform is written. */
async function platformCall<T extends object>(options: { beforeFirstWrite?: () => Promise<string | undefined> }, success: T) {
  const held = await options?.beforeFirstWrite?.()
  if (held !== undefined) return { success: false, errors: [{ step: 'before_first_write', error: held }], warnings: [], idMapping: new Map(), stats: { created: 0, updated: 0, deleted: 0 } }
  hooks.wrote++
  return success
}

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DtImportSplit: class { constructor(_c: unknown) {} importSplitModel = mockImport },
    DtUpdateSplit: class {
      constructor(_c: unknown) {}
      updateFromSplitModel = mockUpdate
      updateAttributesOnly = mockUpdateAttributes
      updateAttributesFromSplitModel = mockUpdateAttributes
      updateAttributes = mockUpdateAttributes
    },
    DtExportSplit: class { constructor(_c: unknown) {} exportModelToSplit = mockExport },
  }
})

// The settlement gate is the last part of the push gate: a test changes the directory right after it.
vi.mock('../../utils/settlement-state.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/settlement-state.js')
  return {
    ...actual,
    settlementPushRefusal: async (...args: Parameters<typeof actual.settlementPushRefusal>) => {
      const refusal = await actual.settlementPushRefusal(...args)
      await hooks.afterGate?.()
      return refusal
    },
  }
})

// The module list's write: as it is, or throwing as the test says.
vi.mock('../../utils/manifest-modules.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/manifest-modules.js')
  return {
    ...actual,
    recordModulesForPush: async (...args: Parameters<typeof actual.recordModulesForPush>) => {
      if (hooks.recordThrows) throw new Error(hooks.recordThrows)
      return actual.recordModulesForPush(...args)
    },
  }
})

// update_model's platform-change check: passes, or refuses as the test says.
vi.mock('../../utils/platform-baseline.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/platform-baseline.js')
  return {
    ...actual,
    exportPlatformPrints: async () => ({}),
    checkPlatformChanges: async () => (hooks.platformRefusal ? { refusal: { message: hooks.platformRefusal.message, data: {} } } : {}),
  }
})

const { importModelTool } = await import('../import-model.tool.js')
const { updateModelTool } = await import('../update-model.tool.js')
const { updateAttributesTool } = await import('../update-attributes.tool.js')
const { createModelTool } = await import('../create-model.tool.js')
const { modelStateTool } = await import('../model-state.tool.js')
const { validateModelTool } = await import('../validate-model.tool.js')
const { initProjectRoot, resetProjectRoot } = await import('../../utils/project-root.js')

const context: ToolContext = { debug: false, apolloClient: {} as never }
const AWS = { id: 'mod-aws', name: 'aws-identity-cryptography' }
let root: string
let dir: string
let seq = 0

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-manifest-modules-push-'))
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
  hooks.afterGate = null
  hooks.platformRefusal = null
  hooks.recordThrows = null
  hooks.wrote = 0
  mockImport.mockReset().mockImplementation(async (_split: unknown, options: any) =>
    platformCall(options, { success: true, model: { id: 'm-1', name: 'Shop' }, idMapping: new Map(), warnings: [], errors: [] }))
  mockUpdate.mockReset().mockImplementation(async (_id: string, _split: unknown, options: any) =>
    platformCall(options, { success: true, model: { id: 'm-1', name: 'Shop' }, stats: { created: 0, updated: 0, deleted: 0 }, idMapping: new Map(), warnings: [], errors: [] }))
  mockUpdateAttributes.mockReset().mockResolvedValue({ success: false, errors: [{ error: 'stopped by the test' }], warnings: [] })
  mockExport.mockReset().mockImplementation(async () => richExport())
})
afterEach(async () => {
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
})

/** A model whose manifest.json lists no module: the scope names the confirmed ones, every class is cached. */
async function scopeModulesModel(mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  m.manifest.modules = []
  m.scope = { ...(m.scope ?? {}), activeModules: [AWS] }
  mutate?.(m)
  dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await registerAll(dir)
  return dir
}

const manifestPath = (d: string) => path.join(d, 'manifest.json')
const readManifest = async (d: string) => JSON.parse(await fs.readFile(manifestPath(d), 'utf8'))
/** Every file under the model directory, with its bytes. */
async function snapshot(d: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of (await fs.readdir(d, { recursive: true })) as string[]) {
    const p = path.join(d, f)
    if ((await fs.stat(p)).isFile()) out[f] = (await fs.readFile(p)).toString('base64')
  }
  return out
}
const get = async (d: string) => ((await modelStateTool.run({ action: 'get', directory_path: d }, context)) as any).data
const DERIVED = [AWS, FIXTURE_MODULE]

describe('the gates read the derived list and write nothing', () => {
  it('Gate 2 passes on a model whose manifest lists no module; get shows both lists; get and validate leave every byte as it was', async () => {
    const d = await scopeModulesModel()
    const before = await snapshot(d)
    const g = (await validateModelTool.run({ action: 'gates', directory_path: d } as never, context)) as any
    expect(g.data.gate2.checks.manifest_complete.verdict).toBe('PASS')
    const s = await get(d)
    expect(s.gates.gate2).toBe('PASS')
    expect(s.manifest_modules).toEqual({ on_disk: [], derived: DERIVED })
    expect(await snapshot(d)).toEqual(before)
  })

  it('names a class with no known module in Gate 2, with the remedy', async () => {
    const d = await scopeModulesModel((m) => { for (const e of Object.values(m.classCache)) if (e.classType === 'data') delete e.module })
    const g = (await validateModelTool.run({ action: 'gates', directory_path: d } as never, context)) as any
    const c = g.data.gate2.checks.manifest_complete
    expect(c.verdict).toBe('FAIL')
    expect(c.value).toMatch(/module reference\(s\) cannot be derived/)
    expect(c.failing.map((f: any) => f.detail.split(':')[0])).toEqual(['module_unknown', 'module_unknown', 'module_unknown'])
    expect(c.failing.map((f: any) => f.name)).toContain('Customer & Personal Data')
    expect(c.remedy).toMatch(/run generate_attribute_stubs with platform access/)
  })

  it('keeps the review hash through the push that writes the list', async () => {
    const d = await scopeModulesModel()
    const hash = (await get(d)).content_hash
    expect((await importModelTool.run({ directory_path: d, create_backup: false }, context) as any).success).toBe(true)
    expect((await readManifest(d)).modules).toEqual(DERIVED)
    expect((await get(d)).content_hash).toBe(hash)
  })

  it("the review hash does not see the modules' order or names, only their ids", async () => {
    const d = await scopeModulesModel((m) => { m.manifest.modules = [FIXTURE_MODULE, AWS] })
    const hash = (await get(d)).content_hash
    const m = await readManifest(d)
    m.modules = [{ ...AWS, name: 'renamed' }, FIXTURE_MODULE]
    await fs.writeFile(manifestPath(d), JSON.stringify(m, null, 2))
    expect((await get(d)).content_hash).toBe(hash)
  })
})

describe('import_model', () => {
  it('fills an empty list before the gate, sends it, writes it, and reports it', async () => {
    const d = await scopeModulesModel()
    const rowsBefore = (await get(d)).unregistered_changes.rows_total
    const { modules: _before, ...rest } = await readManifest(d)
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.success, res.error).toBe(true)
    expect(mockImport.mock.calls[0]![0].manifest.modules).toEqual(DERIVED)
    expect(res.data.manifest_modules).toEqual({ after: DERIVED, before: [] })
    const { modules, ...restAfter } = await readManifest(d)
    expect(modules).toEqual(DERIVED)
    // Only the list changed; the platform write-back may add what a push records, never drop a key.
    for (const [k, v] of Object.entries(rest)) if (k !== 'model') expect(restAfter[k]).toEqual(v)
    // A machine-derived field: nothing to register.
    expect((await get(d)).unregistered_changes.rows_total).toBe(rowsBefore)
  })

  it("the push's backup holds manifest.json as the operator left it", async () => {
    const d = await scopeModulesModel()
    const original = await fs.readFile(manifestPath(d))
    const res = (await importModelTool.run({ directory_path: d, create_backup: true }, context)) as any
    expect(res.success, res.error).toBe(true)
    expect(res.data.backup_path).toBeTruthy()
    expect((await fs.readFile(path.join(res.data.backup_path, 'manifest.json'))).equals(original)).toBe(true)
    expect((await readManifest(d)).modules).toEqual(DERIVED)
  })

  it('a second push writes nothing, and reports the list without before', async () => {
    const d = await scopeModulesModel()
    expect((await importModelTool.run({ directory_path: d, create_backup: false }, context) as any).success).toBe(true)
    const st = await fs.stat(manifestPath(d))
    const bytes = await fs.readFile(manifestPath(d))
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.success, res.error).toBe(true)
    expect(res.data.manifest_modules).toEqual({ after: DERIVED })
    const st2 = await fs.stat(manifestPath(d))
    expect(st2.ino).toBe(st.ino)
    expect(st2.mtimeMs).toBe(st.mtimeMs)
    expect((await fs.readFile(manifestPath(d))).equals(bytes)).toBe(true)
  })

  it('with a class whose module is unknown: refused by Gate 2, nothing sent, nothing written', async () => {
    const d = await scopeModulesModel((m) => { for (const e of Object.values(m.classCache)) if (e.classType === 'data') delete e.module })
    const before = await snapshot(d)
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^Push refused: Gate 2 fails \(manifest_complete: 3\)/)
    expect(mockImport).not.toHaveBeenCalled()
    expect(await snapshot(d)).toEqual(before)
  })

  it('a later refusal (pending enrichment) leaves every byte as it was', async () => {
    const d = await scopeModulesModel()
    await fs.writeFile(path.join(d, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 1, entries: [
      { batch: 'b1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema', source: 'app/server.py:12', previous: 'null' },
    ] }))
    const before = await snapshot(d)
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/enrichment value awaits the operator/)
    expect(mockImport).not.toHaveBeenCalled()
    expect(await snapshot(d)).toEqual(before)
  })

  it('a manifest.json edited after the gate decided: refused, nothing sent, the edit kept', async () => {
    const d = await scopeModulesModel()
    let edited = ''
    hooks.afterGate = async () => {
      const m = await readManifest(d)
      m.model.description = 'Edited while the push was prepared.'
      edited = JSON.stringify(m, null, 2)
      await fs.writeFile(manifestPath(d), edited)
    }
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/manifest.json changed while the push was being prepared/)
    expect(hooks.wrote).toBe(0)
    expect(await fs.readFile(manifestPath(d), 'utf8')).toBe(edited)
  })
})

describe('a refusal made on the platform side, before anything was written', () => {
  const refused = (code: string, step = 'resolve_controls') => ({
    success: false, errors: [{ step, code, ref: 'c-web', index: 0, control: { id: null, name: 'MFA' }, error: 'x' }],
    warnings: [], idMapping: new Map(), stats: { created: 0, updated: 0, deleted: 0 },
  })

  it('import_model: a control reference refusal leaves manifest.json as it was', async () => {
    const d = await scopeModulesModel()
    const bytes = await fs.readFile(manifestPath(d))
    mockImport.mockResolvedValue(refused('control_name_ambiguous'))
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.error).toBe('Control references could not be resolved; nothing was pushed')
    expect((await fs.readFile(manifestPath(d))).equals(bytes)).toBe(true)
  })

  it('import_model: a duplicate element id refusal leaves manifest.json as it was', async () => {
    const d = await scopeModulesModel()
    const bytes = await fs.readFile(manifestPath(d))
    mockImport.mockResolvedValue(refused('duplicate_element_id', 'validate'))
    const res = (await importModelTool.run({ directory_path: d, create_backup: false }, context)) as any
    expect(res.error).toBe('Element ids must be unique in the model; nothing was pushed')
    expect((await fs.readFile(manifestPath(d))).equals(bytes)).toBe(true)
  })

  it('update_model: a control reference refusal leaves manifest.json as it was', async () => {
    const d = await scopeModulesModel()
    const bytes = await fs.readFile(manifestPath(d))
    mockUpdate.mockResolvedValue(refused('control_id_not_found'))
    const res = (await updateModelTool.run({ model_id: 'm-1', directory_path: d, create_backup: false }, context)) as any
    expect(res.error).toBe('Control references could not be resolved; nothing was pushed')
    expect((await fs.readFile(manifestPath(d))).equals(bytes)).toBe(true)
  })
})

describe('update_model', () => {
  it('a platform-change refusal leaves every byte as it was', async () => {
    const d = await scopeModulesModel()
    hooks.platformRefusal = { message: 'PLATFORM_CHANGED_SINCE_SYNC (test)' }
    const before = await snapshot(d)
    const res = (await updateModelTool.run({ model_id: 'm-1', directory_path: d, create_backup: false }, context)) as any
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/PLATFORM_CHANGED_SINCE_SYNC/)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(await snapshot(d)).toEqual(before)
  })

  it('a module list that cannot be written: refused as nothing pushed, never as a partial push', async () => {
    for (const run of [
      (d: string) => updateModelTool.run({ model_id: 'm-1', directory_path: d, create_backup: false }, context),
      (d: string) => importModelTool.run({ directory_path: d, create_backup: false }, context),
    ]) {
      const d = await scopeModulesModel()
      hooks.recordThrows = 'EACCES: permission denied'
      hooks.wrote = 0
      const res = (await run(d)) as any
      expect(res.success).toBe(false)
      expect(res.error).toBe('manifest.json could not be written with the derived module list (EACCES: permission denied), so nothing was pushed.')
      expect(hooks.wrote).toBe(0)
    }
  })

  it('a manifest.json edited after the gate decided: refused before the first platform write, the edit kept', async () => {
    const d = await scopeModulesModel()
    let edited = ''
    hooks.afterGate = async () => {
      const m = await readManifest(d)
      m.model.description = 'Edited while the push was prepared.'
      edited = JSON.stringify(m, null, 2)
      await fs.writeFile(manifestPath(d), edited)
    }
    const res = (await updateModelTool.run({ model_id: 'm-1', directory_path: d, create_backup: false }, context)) as any
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/manifest.json changed while the push was being prepared/)
    expect(hooks.wrote).toBe(0)
    expect(await fs.readFile(manifestPath(d), 'utf8')).toBe(edited)
  })

  it("the push's backup holds manifest.json as the operator left it", async () => {
    const d = await scopeModulesModel()
    const original = await fs.readFile(manifestPath(d))
    const res = (await updateModelTool.run({ model_id: 'm-1', directory_path: d, create_backup: true }, context)) as any
    expect(res.success, res.error).toBe(true)
    expect((await fs.readFile(path.join(res.data.backup_path, 'manifest.json'))).equals(original)).toBe(true)
  })

  it('sends and writes the derived list once every refusal has passed', async () => {
    const d = await scopeModulesModel()
    let onDiskAtPush: unknown
    mockUpdate.mockImplementation(async (_id: string, split: any, options: any) => {
      const before = (await readManifest(d)).modules
      const result = await platformCall(options, { success: true, model: { id: 'm-1', name: 'Shop' }, stats: { created: 0, updated: 0, deleted: 0 }, idMapping: new Map(), warnings: [], errors: [], sent: split })
      onDiskAtPush = (await readManifest(d)).modules
      expect(before).toEqual([])
      return result
    })
    const res = (await updateModelTool.run({ model_id: 'm-1', directory_path: d, create_backup: false }, context)) as any
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0]![1].manifest.modules).toEqual(DERIVED)
    // Written by the hook, after the platform's own checks and before its first write (the export-back
    // afterwards writes the platform's own list); not yet when the platform call began.
    expect(onDiskAtPush).toEqual(DERIVED)
    expect(res.success, res.error).toBe(true)
    expect(res.data.manifest_modules).toEqual({ after: DERIVED, before: [] })
  })
})

describe('update_attributes and create_threat_model', () => {
  it('update_attributes gates the derived list and writes nothing', async () => {
    const d = await scopeModulesModel()
    const bytes = await fs.readFile(manifestPath(d))
    const res = (await updateAttributesTool.run({ model_id: 'm-1', directory_path: d }, context)) as any
    expect(res.error ?? '').not.toMatch(/Gate 2/)
    expect(mockUpdateAttributes).toHaveBeenCalled()
    expect((await fs.readFile(manifestPath(d))).equals(bytes)).toBe(true)
  })

  it("create_threat_model judges its own list, never the target directory's module gaps", async () => {
    const d = await scopeModulesModel((m) => { for (const e of Object.values(m.classCache)) delete e.module })
    const m = gateModel()
    const res = (await createModelTool.run({
      model: { manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: m.attributes },
      directory_path: d, include_schema: false, include_example: false,
    } as never, context)) as any
    expect(res.error ?? '', JSON.stringify(res)).not.toMatch(/manifest_complete/)
    expect(mockImport, JSON.stringify(res)).toHaveBeenCalled()
  })
})
