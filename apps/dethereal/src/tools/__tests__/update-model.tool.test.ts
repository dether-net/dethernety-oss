import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { updateModelTool } from '../update-model.tool.js'
import { readSyncJson, writeSyncJson } from '../../utils/sync-utils.js'
import type { ToolContext } from '../base-tool.js'

// =============================================================================
// Mock dt-core — intercept DtUpdateSplit (the push) and DtExportSplit (the
// re-export of post-push platform state). mergeAttributes is a passthrough.
// =============================================================================

const { mockUpdateFromSplitModel, mockExportModelToSplit } = vi.hoisted(() => ({
  mockUpdateFromSplitModel: vi.fn(),
  mockExportModelToSplit: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtUpdateSplit: class MockDtUpdateSplit {
      constructor(_apolloClient: any) {}
      updateFromSplitModel = mockUpdateFromSplitModel
    },
    DtExportSplit: class MockDtExportSplit {
      constructor(_apolloClient: any) {}
      exportModelToSplit = mockExportModelToSplit
    },
    mergeAttributes: (_local: unknown, exported: unknown) => exported,
  }
})

// =============================================================================
// Helpers
// =============================================================================

const contextWithClient: ToolContext = { debug: false, apolloClient: {} as any }

/** A split-model structure: defaultBoundary with the given components. */
function makeStructure(
  components: Array<{ id: string; name: string }>,
  nested: Array<{ id: string; name: string; components: Array<{ id: string; name: string }> }> = [],
) {
  return {
    defaultBoundary: { id: 'b-1', name: 'System', components, boundaries: nested },
  }
}

/** Write the on-disk model directory that the push reads as its payload. */
async function writeModelDir(
  tmpDir: string,
  structure: any,
  dataFlows: any[],
  dataItems: any[],
) {
  await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
    schemaVersion: '2.0.0', format: 'split',
    model: { id: 'model-1', name: 'Test', defaultBoundaryId: 'b-1' },
  }, null, 2))
  await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify(structure, null, 2))
  await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({ dataFlows }, null, 2))
  await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({ dataItems }, null, 2))
}

/** A full SplitModel suitable for DtExportSplit.exportModelToSplit's return. */
function makeExportedModel(structure: any, dataFlows: any[], dataItems: any[]) {
  return {
    manifest: {
      schemaVersion: '2.0.0', format: 'split',
      model: { id: 'model-1', name: 'Test', defaultBoundaryId: 'b-1' },
    },
    structure,
    dataFlows,
    dataItems,
    attributes: { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} },
  }
}

const okResult = {
  success: true,
  errors: [] as Array<{ error: string }>,
  warnings: [] as string[],
  stats: { created: 0, updated: 0, deleted: 0 },
  model: { name: 'Test' },
}

// =============================================================================
// Tests
// =============================================================================

describe('UpdateModelTool', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-update-'))
    mockUpdateFromSplitModel.mockReset()
    mockExportModelToSplit.mockReset()
    mockUpdateFromSplitModel.mockResolvedValue({ ...okResult })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should have correct tool metadata', () => {
    expect(updateModelTool.name).toBe('update_model')
    expect(updateModelTool.requiresClient).toBe(true)
  })

  // Issue #94 — the regression guard. Before the fix, update_model wrote
  // push_content_hash + last_push_at but never refreshed baseline_element_ids,
  // leaving the next push's C1/C2 conflict disambiguation working off a stale
  // baseline (silent data loss / false conflict warnings on subsequent syncs).
  it('refreshes baseline_element_ids from the post-push platform state', async () => {
    // Local payload: boundary b-1 with components A, B; flow f-1; item d-1.
    await writeModelDir(
      tmpDir,
      makeStructure([{ id: 'c-A', name: 'A' }, { id: 'c-B', name: 'B' }]),
      [{ id: 'f-1', name: 'HTTP', source: { id: 'c-A' }, target: { id: 'c-B' } }],
      [{ id: 'd-1', name: 'User Data' }],
    )

    // Seed a deliberately STALE baseline (only c-A) — the pre-fix leftover state.
    await writeSyncJson(tmpDir, {
      platform_model_id: 'model-1',
      platform_url: 'http://localhost:3003',
      baseline_element_ids: { boundaries: ['b-1'], components: ['c-A'], flows: [], dataItems: [] },
    })

    // Platform after the push has gained a component (c-C) and a flow (f-2):
    // the re-export reflects that authoritative post-push state.
    mockExportModelToSplit.mockResolvedValue(makeExportedModel(
      makeStructure([{ id: 'c-A', name: 'A' }, { id: 'c-B', name: 'B' }, { id: 'c-C', name: 'C' }]),
      [
        { id: 'f-1', name: 'HTTP', source: { id: 'c-A' }, target: { id: 'c-B' } },
        { id: 'f-2', name: 'gRPC', source: { id: 'c-B' }, target: { id: 'c-C' } },
      ],
      [{ id: 'd-1', name: 'User Data' }],
    ))

    const result = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.source_files_updated).toBe(true)

    const sync = await readSyncJson(tmpDir)
    expect(sync).not.toBeNull()
    // Baseline now mirrors the post-push state, NOT the stale {c-A} seed.
    expect(sync!.baseline_element_ids.boundaries).toEqual(['b-1'])
    expect(sync!.baseline_element_ids.components.sort()).toEqual(['c-A', 'c-B', 'c-C'])
    expect(sync!.baseline_element_ids.flows.sort()).toEqual(['f-1', 'f-2'])
    expect(sync!.baseline_element_ids.dataItems).toEqual(['d-1'])
    // Push metadata is still written alongside the refreshed baseline.
    expect(sync!.last_push_at).toBeTruthy()
    expect(sync!.push_content_hash).toMatch(/^sha256:v2:/)
  })

  it('collects the baseline from the pushed local files when re-export is disabled', async () => {
    await writeModelDir(
      tmpDir,
      makeStructure(
        [{ id: 'c-A', name: 'A' }],
        [{ id: 'b-2', name: 'DMZ', components: [{ id: 'c-B', name: 'B' }] }],
      ),
      [{ id: 'f-1', name: 'HTTP', source: { id: 'c-A' }, target: { id: 'c-B' } }],
      [],
    )

    const result = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false, disable_source_file_update: true },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.source_files_updated).toBe(false)
    // No re-export happened, so DtExportSplit must not have been invoked.
    expect(mockExportModelToSplit).not.toHaveBeenCalled()

    const sync = await readSyncJson(tmpDir)
    expect(sync!.baseline_element_ids.boundaries.sort()).toEqual(['b-1', 'b-2'])
    expect(sync!.baseline_element_ids.components.sort()).toEqual(['c-A', 'c-B'])
    expect(sync!.baseline_element_ids.flows).toEqual(['f-1'])
  })
})
