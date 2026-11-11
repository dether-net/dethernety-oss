/**
 * import_model pushes with strict control resolution: a refusal made before the model exists says
 * nothing was pushed and carries the codes and entries to fix; a failure after the model exists keeps
 * the usual wording; a success returns the controls linked.
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
import { richExport } from './fixtures/platform-export.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { registerAll } from './helpers/settle.js'

vi.setConfig({ testTimeout: 30_000 })

const context: ToolContext = { debug: false, apolloClient: {} as never }

const refusedResult = (errors: unknown[]) => ({ success: false, errors, warnings: [], idMapping: new Map() })

describe('import_model and strict control resolution', () => {
  let tmpDir: string
  let model: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-import-strict-'))
    initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: tmpDir } })
    model = path.join(tmpDir, 'model')
    await writeGateModel(model, gateModel())
    await registerAll(model)
    mockImportSplitModel.mockReset()
    mockExportModelToSplit.mockReset().mockImplementation(async () => richExport())
  })
  afterEach(async () => {
    resetProjectRoot()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const syncWritten = async () => fs.access(path.join(model, '.dethereal', 'sync.json')).then(() => true, () => false)

  it('pushes with strict resolution', async () => {
    mockImportSplitModel.mockResolvedValue(refusedResult([{ step: 'resolve_controls', code: 'control_catalog_unavailable', error: 'x' }]))
    await importModelTool.run({ directory_path: model, create_backup: false }, context)
    expect(mockImportSplitModel.mock.calls[0]![1]).toMatchObject({ controlResolution: 'strict' })
  })

  it('a refusal before the model exists: nothing was pushed, with the codes and entries', async () => {
    mockImportSplitModel.mockResolvedValue(refusedResult([
      { step: 'resolve_controls', code: 'control_name_ambiguous', ref: 'c-web', index: 0, control: { id: null, name: 'MFA' },
        candidates: [{ id: 'm1', name: 'MFA' }, { id: 'm2', name: 'MFA' }], candidates_total: 2, error: 'controls[0] of c-web: ...' },
      { step: 'resolve_controls', code: 'control_id_not_found', ref: '@model', index: 1, control: { id: 'gone', name: 'WAF' }, error: '...' },
      { step: 'resolve_controls', code: 'control_name_ambiguous', ref: 'c-api', index: 2, control: { id: null, name: 'MFA' },
        candidates: [{ id: 'm1', name: 'MFA' }], candidates_total: 1, error: '...' },
    ]))
    const res = await importModelTool.run({ directory_path: model, create_backup: false }, context)
    expect(res.success).toBe(false)
    expect(res.error).toBe('Control references could not be resolved; nothing was pushed')
    expect(res.data).toEqual({
      codes: ['control_name_ambiguous', 'control_id_not_found'],
      control_errors: [
        { code: 'control_name_ambiguous', ref: 'c-web', index: 0, control: { id: null, name: 'MFA' }, candidates: [{ id: 'm1', name: 'MFA' }, { id: 'm2', name: 'MFA' }], candidates_total: 2 },
        { code: 'control_id_not_found', ref: '@model', index: 1, control: { id: 'gone', name: 'WAF' } },
        { code: 'control_name_ambiguous', ref: 'c-api', index: 2, control: { id: null, name: 'MFA' }, candidates: [{ id: 'm1', name: 'MFA' }], candidates_total: 1 },
      ],
    })
    expect(await syncWritten()).toBe(false)
    expect(mockExportModelToSplit).not.toHaveBeenCalled()
  })

  it('a catalog that cannot be read, and duplicate element ids, are refusals too', async () => {
    mockImportSplitModel.mockResolvedValueOnce(refusedResult([{ step: 'resolve_controls', code: 'control_catalog_unavailable', error: 'x' }]))
    const catalog = await importModelTool.run({ directory_path: model, create_backup: false }, context)
    expect(catalog.error).toBe('Control references could not be resolved; nothing was pushed')
    expect(catalog.data).toEqual({ codes: ['control_catalog_unavailable'], control_errors: [{ code: 'control_catalog_unavailable' }] })

    mockImportSplitModel.mockResolvedValueOnce(refusedResult([{ step: 'validate', code: 'duplicate_element_id', ref: 'c-web', error: 'x' }]))
    const ids = await importModelTool.run({ directory_path: model, create_backup: false }, context)
    expect(ids.error).toBe('Element ids must be unique in the model; nothing was pushed')
    expect(ids.data).toEqual({ codes: ['duplicate_element_id'], control_errors: [{ code: 'duplicate_element_id', ref: 'c-web' }] })
  })

  it('caps the entries returned and gives the total', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ step: 'resolve_controls', code: 'control_name_not_found', ref: 'c-web', index: i, control: { id: null, name: `n${i}` }, error: 'x' }))
    mockImportSplitModel.mockResolvedValue(refusedResult(many))
    const res = await importModelTool.run({ directory_path: model, create_backup: false }, context)
    const data = res.data as unknown as { control_errors: unknown[]; control_errors_total: number }
    expect(data.control_errors).toHaveLength(100)
    expect(data.control_errors_total).toBe(130)
  })

  it('a failure after the model exists keeps the usual wording', async () => {
    mockImportSplitModel.mockResolvedValue({
      success: false,
      model: { id: 'm-1', name: 'Shop' },
      errors: [
        { step: 'associate_controls', ref: 'c-web', error: 'Controls were not written: write refused' },
        // Even a resolution code: once the model exists, something was pushed.
        { step: 'resolve_controls', code: 'control_name_not_found', ref: 'c-api', index: 0, error: 'not resolved' },
      ],
      warnings: [],
      idMapping: new Map(),
    })
    const res = await importModelTool.run({ directory_path: model, create_backup: false }, context)
    expect(res.success).toBe(false)
    expect(res.error).toBe('Import failed: Controls were not written: write refused, not resolved')
    expect(res.error).not.toMatch(/nothing was pushed/)
    expect(res.data).toBeUndefined()
  })

  it('a success returns the controls linked', async () => {
    const resolvedControls = { '@model': [], 'c-web': [{ id: 'w1', name: 'WAF' }] }
    mockImportSplitModel.mockResolvedValue({
      success: true, model: { id: 'm-1', name: 'Shop' }, idMapping: new Map(), warnings: [], errors: [], resolvedControls,
    })
    const res = await importModelTool.run({ directory_path: model, create_backup: false }, context)
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data?.resolved_controls).toEqual(resolvedControls)
  })

  it('writes the id it linked into a data item\'s controls, as into a component\'s', async () => {
    const file = path.join(model, 'data-items.json')
    const doc = JSON.parse(await fs.readFile(file, 'utf8'))
    const items = Array.isArray(doc) ? doc : doc.dataItems
    items.find((i: any) => i.id === 'd-card').controls = [{ name: 'Tokenisation' }]
    await fs.writeFile(file, JSON.stringify(doc))
    mockImportSplitModel.mockResolvedValue({
      success: true, model: { id: 'm-1', name: 'Shop' }, idMapping: new Map(), warnings: [], errors: [], resolvedControls: { 'd-card': [{ id: 't1', name: 'Tokenisation' }] },
    })
    // The pin is the files' own: it is written with the settlement off as well.
    const res = await importModelTool.run({ directory_path: model, create_backup: false }, { ...context, settlement: 'off' })
    expect(res.success, JSON.stringify(res)).toBe(true)
    const after = JSON.parse(await fs.readFile(file, 'utf8'))
    expect((Array.isArray(after) ? after : after.dataItems).find((i: any) => i.id === 'd-card').controls).toEqual([{ id: 't1', name: 'Tokenisation' }])
  })
})
