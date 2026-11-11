/**
 * The writers that leave a model directory in sync with the platform record the
 * platform model for the next push's change check: a first push (import_model) and
 * a create with a directory (create_threat_model) export the platform model after
 * writing it. On a machine that may keep no record they say so.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import type { ToolContext } from '../base-tool.js'

const { mockImportSplitModel, mockExportModelToSplit } = vi.hoisted(() => ({
  mockImportSplitModel: vi.fn(),
  mockExportModelToSplit: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DtImportSplit: class MockDtImportSplit {
      constructor(_apolloClient: unknown) {}
      importSplitModel = mockImportSplitModel
    },
    DtExportSplit: class MockDtExportSplit {
      constructor(_apolloClient: unknown) {}
      exportModelToSplit = mockExportModelToSplit
    },
  }
})

import { importModelTool } from '../import-model.tool.js'
import { createModelTool } from '../create-model.tool.js'
import { loadPlatformBaseline } from '../../utils/platform-baseline.js'
import { richExport } from './fixtures/platform-export.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { registerAll } from './helpers/settle.js'

// Each case pushes and records a baseline on a real directory: sized for a loaded full run.
vi.setConfig({ testTimeout: 30_000 })

const context: ToolContext = { debug: false, apolloClient: {} as never }

describe('writers that record the platform model', () => {
  let tmpDir: string
  const savedHome = process.env.HOME

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-baseline-writers-'))
    // Import and create register their model: the registry goes under this test's own project root.
    initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: tmpDir } })
    mockImportSplitModel.mockReset().mockResolvedValue({
      success: true,
      model: { id: 'm-1', name: 'Shop' },
      idMapping: new Map(),
      warnings: [],
      errors: [],
    })
    mockExportModelToSplit.mockReset().mockImplementation(async () => richExport())
  })
  afterEach(async () => {
    resetProjectRoot()
    process.env.HOME = savedHome
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Created without attribute values: a new directory has no baseline, so any value would be unregistered.
  const asSplit = (m: ReturnType<typeof gateModel>) => ({
    manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: {},
  })

  it('import_model records the platform model after a first push', async () => {
    const model = path.join(tmpDir, 'model')
    await writeGateModel(model, gateModel())
    await registerAll(model)
    const res = await importModelTool.run({ directory_path: model }, context)
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data?.platform_baseline).toBe('recorded')
    expect(res.data?.registered).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(tmpDir, '.dethernety', 'models.json'), 'utf8')).models).toEqual([
      expect.objectContaining({ path: './model', source: 'local' }),
    ])
    expect(mockExportModelToSplit).toHaveBeenCalledWith('m-1')
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('verified')
  })

  it('create_threat_model records the platform model when it writes a directory', async () => {
    const model = path.join(tmpDir, 'created')
    // The values created must be the operator's: the model is written and registered in its directory first.
    await writeGateModel(model, gateModel())
    await registerAll(model)
    // The model as the directory holds it: a payload without its attribute values would remove registered values.
    const res = await createModelTool.run({ model: { ...asSplit(gateModel()), attributes: gateModel().attributes } as never, directory_path: model }, context)
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data?.platform_baseline).toBe('recorded')
    expect(res.data?.registered).toBe(true)
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('verified')
  })

  it('says when the platform model could not be recorded, and keeps no record', async () => {
    const model = path.join(tmpDir, 'model')
    await writeGateModel(model, gateModel())
    await registerAll(model)
    mockExportModelToSplit.mockRejectedValue(new Error('network'))
    const failedExport = await importModelTool.run({ directory_path: model }, context)
    expect(failedExport.data?.platform_baseline).toBe('not_recorded')
    expect(failedExport.data?.warnings.join('\n')).toMatch(/was not recorded \(export_failed\): the next push treats every element as changed/)
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('legacy')

    // A home inside the project: this machine's key may not be used for it.
    mockExportModelToSplit.mockImplementation(async () => richExport())
    process.env.HOME = path.join(tmpDir, 'home-inside')
    await fs.mkdir(process.env.HOME)
    // With this machine's key unusable nothing can be registered, so the push is refused before the platform.
    const imports = mockImportSplitModel.mock.calls.length
    const created = await createModelTool.run({ model: asSplit(gateModel()) as never, directory_path: path.join(tmpDir, 'c2') }, context)
    expect(created.success).toBe(false)
    expect(created.error).toMatch(/\(unregistered_changes\)/)
    expect(mockImportSplitModel.mock.calls.length).toBe(imports)
  })
})
