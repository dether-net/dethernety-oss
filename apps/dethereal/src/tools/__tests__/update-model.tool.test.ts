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

describe('UpdateModelTool — the re-export path fixes up what it invalidates', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-update-remap-'))
    mockUpdateFromSplitModel.mockReset()
    mockExportModelToSplit.mockReset()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  /** Seed the two id-keyed sidecars under .dethereal/ for element `id`. */
  const seedSidecars = async (id: string) => {
    const deth = path.join(tmpDir, '.dethereal')
    await fs.mkdir(path.join(deth, 'template-fields'), { recursive: true })
    await fs.writeFile(path.join(deth, 'template-fields', `${id}.json`),
      JSON.stringify({ classId: 'class-mysql', templateFields: ['ssl_enabled'] }), 'utf-8')
    await fs.writeFile(path.join(deth, 'state.json'),
      JSON.stringify({ currentState: 'ENRICHING', staleElements: [id] }), 'utf-8')
    return deth
  }

  it('re-keys the .dethereal/ sidecars when a push mints new element ids', async () => {
    // update_model is an id-remap site too: an element added since the last push
    // gets its platform id here, and the re-export rewrites the model files with
    // it. Only create/import used to fix the sidecars, so on an existing model
    // every newly added element orphaned its template-field manifest (silently
    // disabling reclassification cleanup) and its re-enrichment queue entry.
    const local = makeStructure([{ id: 'c-new', name: 'New' }])
    await writeModelDir(tmpDir, local, [], [])
    const deth = await seedSidecars('c-new')

    mockUpdateFromSplitModel.mockResolvedValue({
      ...okResult, idMapping: new Map([['c-new', 'CNEW-uuid']]),
    })
    mockExportModelToSplit.mockResolvedValue(
      makeExportedModel(makeStructure([{ id: 'CNEW-uuid', name: 'New' }]), [], []))

    const res = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)

    expect(res.success).toBe(true)
    expect(res.data!.source_files_updated).toBe(true)
    expect((await fs.readdir(path.join(deth, 'template-fields'))).sort()).toEqual(['CNEW-uuid.json'])
    const state = JSON.parse(await fs.readFile(path.join(deth, 'state.json'), 'utf-8'))
    expect(state.staleElements).toEqual(['CNEW-uuid'])
    expect(state.currentState).toBe('ENRICHING')
  })

  it('re-keys the sidecars even when writeScope refuses a malformed scope.json', async () => {
    // writeScope throws rather than overwrite a present-but-unparseable
    // scope.json. Sequenced after it, the sidecar re-key would be skipped for
    // exactly the directories most likely to need it — the model files are
    // rewritten with platform ids either way.
    const local = makeStructure([{ id: 'c-new', name: 'New' }])
    await writeModelDir(tmpDir, local, [], [])
    const deth = await seedSidecars('c-new')
    await fs.writeFile(path.join(deth, 'scope.json'), '{ not json', 'utf-8')

    mockUpdateFromSplitModel.mockResolvedValue({
      ...okResult, idMapping: new Map([['c-new', 'CNEW-uuid']]),
    })
    mockExportModelToSplit.mockResolvedValue(
      makeExportedModel(makeStructure([{ id: 'CNEW-uuid', name: 'New' }]), [], []))

    const res = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)

    expect(res.success).toBe(true)
    expect((await fs.readdir(path.join(deth, 'template-fields'))).sort()).toEqual(['CNEW-uuid.json'])
    // The scope failure is still reported — it is not swallowed by the reorder.
    expect(res.data!.warnings.join(' ')).toMatch(/scope\.json/i)
  })

  it('leaves the sidecars alone when source-file update is disabled', async () => {
    // With the re-export off, the model files keep their local ids — remapping
    // the sidecars would be the thing that broke them.
    const local = makeStructure([{ id: 'c-new', name: 'New' }])
    await writeModelDir(tmpDir, local, [], [])
    const deth = await seedSidecars('c-new')

    mockUpdateFromSplitModel.mockResolvedValue({
      ...okResult, idMapping: new Map([['c-new', 'CNEW-uuid']]),
    })

    const res = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false,
        disable_source_file_update: true }, contextWithClient)

    expect(res.success).toBe(true)
    expect(mockExportModelToSplit).not.toHaveBeenCalled()
    expect(await fs.readdir(path.join(deth, 'template-fields'))).toEqual(['c-new.json'])
    const state = JSON.parse(await fs.readFile(path.join(deth, 'state.json'), 'utf-8'))
    expect(state.staleElements).toEqual(['c-new'])
  })

  it('does not delete an unreadable attribute file during the merge-back', async () => {
    // The warning about the unreadable file already existed; the very next
    // statement was the write whose stale-file cleanup deleted the file the
    // warning told the operator to go and restore.
    const local = makeStructure([{ id: 'c-db', name: 'DB' }])
    await writeModelDir(tmpDir, local, [], [])
    const attrDir = path.join(tmpDir, 'attributes', 'components')
    await fs.mkdir(attrDir, { recursive: true })
    await fs.writeFile(path.join(attrDir, 'c-db.json'), '{ "elementId": "c-db", "attrib', 'utf-8')

    mockUpdateFromSplitModel.mockResolvedValue({ ...okResult, idMapping: new Map() })
    mockExportModelToSplit.mockResolvedValue(makeExportedModel(local, [], []))

    const res = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)

    expect(res.success).toBe(true)
    expect(await fs.readFile(path.join(attrDir, 'c-db.json'), 'utf-8'))
      .toBe('{ "elementId": "c-db", "attrib')
    expect(res.data!.warnings.join(' ')).toContain('attributes/components/c-db.json')
  })

  it('warns that an unreadable attribute file was not pushed', async () => {
    // Distinct from the merge-back warning: this one is about the PUSH. The file
    // is absent from the bag dt-core receives, so the element's attributes never
    // reach the platform and every count reports success.
    const local = makeStructure([{ id: 'c-db', name: 'DB' }])
    await writeModelDir(tmpDir, local, [], [])
    const attrDir = path.join(tmpDir, 'attributes', 'components')
    await fs.mkdir(attrDir, { recursive: true })
    await fs.writeFile(path.join(attrDir, 'c-db.json'), '}{', 'utf-8')

    mockUpdateFromSplitModel.mockResolvedValue({ ...okResult, idMapping: new Map() })
    mockExportModelToSplit.mockResolvedValue(makeExportedModel(local, [], []))

    const res = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false,
        disable_source_file_update: true }, contextWithClient)

    expect(res.success).toBe(true)
    expect(res.data!.warnings.some(w => w.includes('NOT pushed'))).toBe(true)
  })
})
