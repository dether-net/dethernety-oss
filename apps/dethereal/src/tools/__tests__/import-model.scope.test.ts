/**
 * import_model reads the local scope before it takes a backup: a scope file it
 * cannot read refuses the push and leaves no backup behind.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import type { ToolContext } from '../base-tool.js'

const { mockImportSplitModel } = vi.hoisted(() => ({ mockImportSplitModel: vi.fn() }))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DtImportSplit: class MockDtImportSplit {
      constructor(_apolloClient: unknown) {}
      importSplitModel = mockImportSplitModel
    },
  }
})

import { importModelTool } from '../import-model.tool.js'

const context: ToolContext = { debug: false, apolloClient: {} as never }

describe('import_model and the local scope', () => {
  let tmpDir: string
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-import-scope-'))
    mockImportSplitModel.mockReset()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('refuses a push whose scope.json cannot be read, before any backup or platform call', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    await writeGateModel(tmpDir, gateModel())
    await fs.writeFile(path.join(tmpDir, 'outside-scope.json'), '{}')
    await fs.rm(path.join(tmpDir, '.dethereal', 'scope.json'), { force: true })
    await fs.symlink(path.join(tmpDir, 'outside-scope.json'), path.join(tmpDir, '.dethereal', 'scope.json'))
    const res = await importModelTool.run({ directory_path: tmpDir }, context)
    expect(res.success).toBe(false)
    expect(res.error).toBe('.dethereal/scope.json could not be read (symlink); fix or remove it, then push again')
    expect(mockImportSplitModel).not.toHaveBeenCalled()
    expect((await fs.readdir(path.dirname(tmpDir))).some((f) => f.startsWith(`${path.basename(tmpDir)}.backup-`))).toBe(false)
  })
})
