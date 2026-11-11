import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { updateModelTool } from '../update-model.tool.js'
import { exportModelTool } from '../export-model.tool.js'
import { richExport } from './fixtures/platform-export.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { readSyncJson, writeSyncJson } from '../../utils/sync-utils.js'
import type { ToolContext } from '../base-tool.js'
import { registerAll } from './helpers/settle.js'

// Each test registers, gates and pushes whole models: slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

// =============================================================================
// Mock dt-core — intercept DtUpdateSplit (the push) and DtExportSplit (the
// re-export of post-push platform state). mergeAttributes is a passthrough.
// =============================================================================

const { mockUpdateFromSplitModel, mockExportModelToSplit, realMerge } = vi.hoisted(() => ({
  mockUpdateFromSplitModel: vi.fn(),
  mockExportModelToSplit: vi.fn(),
  realMerge: { on: false },
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
    mergeAttributes: (...sources: unknown[]) => (realMerge.on ? (actual.mergeAttributes as (...a: unknown[]) => unknown)(...sources) : sources[sources.length - 1]),
  }
})

// The push gate has its own tests at the end; the others are about the push itself.
const { pushGate } = vi.hoisted(() => ({ pushGate: { real: false } }))
vi.mock('../../utils/gates.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/gates.js')
  return {
    ...actual,
    directoryPushRefusal: (...args: Parameters<typeof actual.directoryPushRefusal>) =>
      pushGate.real ? actual.directoryPushRefusal(...args) : Promise.resolve(null),
  }
})

// The platform-change check has its own tests at the end; elsewhere it passes and
// reads nothing, so DtExportSplit sees only the re-export.
const { platformCheck } = vi.hoisted(() => ({ platformCheck: { real: false } }))
vi.mock('../../utils/platform-baseline.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/platform-baseline.js')
  return {
    ...actual,
    exportPlatformPrints: (...args: Parameters<typeof actual.exportPlatformPrints>) =>
      platformCheck.real ? actual.exportPlatformPrints(...args) : Promise.resolve({}),
    checkPlatformChanges: (...args: Parameters<typeof actual.checkPlatformChanges>) =>
      platformCheck.real ? actual.checkPlatformChanges(...args) : Promise.resolve({}),
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
    // The scope failure is still reported — it is not swallowed by the reorder —
    // as a scope warning: the model files themselves were updated.
    expect(res.data!.warnings.join(' ')).toMatch(/\.dethereal\/scope\.json could not be updated \(/)
    expect(res.data!.warnings.join(' ')).not.toMatch(/Could not update source directory/)
    expect(res.data!.source_files_updated).toBe(true)
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

  it('names the element of every error a failed update reports', async () => {
    const local = makeStructure([{ id: 'c-db', name: 'DB' }])
    await writeModelDir(tmpDir, local, [], [])
    mockUpdateFromSplitModel.mockResolvedValue({
      ...okResult,
      success: false,
      errors: [
        { step: 'update_component', elementName: 'DB', elementId: 'c-db', error: 'write boom, retry later' },
        { step: 'set_element_attributes', elementName: 'API', elementId: 'c-api', error: 'Failed to set the answers of "API" for class k1: class "k1" not found' },
        { step: 'fetch_model', error: 'Model model-1 not found' },
      ],
    })

    const res = await updateModelTool.run(
      { model_id: 'model-1', directory_path: tmpDir, create_backup: false, disable_source_file_update: true }, contextWithClient)

    expect(res.success).toBe(false)
    expect(res.error).toMatch(
      /^Update failed: DB: write boom, retry later; Failed to set the answers of "API" for class k1: class "k1" not found; Model model-1 not found\. The record of the platform model from before this push was kept/,
    )
  })

  it('keeps the local class and answers of an element whose class the platform does not have; rewrites the rest', async () => {
    const pg = { id: 'cls-pg', name: 'PostgreSQL', module: { name: 'example-datastores' } }
    const redis = { id: 'cls-redis', name: 'Redis', module: { name: 'example-datastores' } }
    const local = {
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [],
        components: [
          { id: 'c-db', name: 'DB', classData: pg },
          { id: 'c-web', name: 'Web', classData: { id: 'cls-web-local', name: 'Web Server' } },
          { id: 'c-new', name: 'Cache', classData: redis },
        ],
      },
    }
    await writeModelDir(tmpDir, local, [], [])
    const attrDir = path.join(tmpDir, 'attributes', 'components')
    await fs.mkdir(attrDir, { recursive: true })
    const dbAnswers = { elementId: 'c-db', elementType: 'component', elementName: 'DB', classData: pg, attributes: { encrypted_at_rest: true } }
    await fs.writeFile(path.join(attrDir, 'c-db.json'), JSON.stringify(dbAnswers, null, 2))
    await fs.writeFile(path.join(attrDir, 'c-web.json'), JSON.stringify(
      { elementId: 'c-web', elementType: 'component', elementName: 'Web', classData: { id: 'cls-web-local', name: 'Web Server' }, attributes: { tls: false } }, null, 2))

    mockUpdateFromSplitModel.mockResolvedValue({
      ...okResult,
      warnings: ['Component "DB": Could not resolve component class (…)', 'Component "Cache": Could not resolve component class (…)'],
      unresolvedClasses: [
        { elementId: 'c-db', elementName: 'DB', kind: 'COMPONENT', classData: pg },
        { elementId: 'c-new', elementName: 'Cache', kind: 'COMPONENT', classData: redis },
      ],
      // c-new was created by this push and got a platform id.
      idMapping: new Map([['c-new', 'p-new']]),
    })
    const platform = {
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [],
        components: [
          { id: 'c-db', name: 'DB', classData: { id: 'cls-generic', name: 'Generic Store' } },
          { id: 'c-web', name: 'Web', classData: { id: 'cls-web', name: 'Web Server' } },
          { id: 'p-new', name: 'Cache' },
        ],
      },
    }
    mockExportModelToSplit.mockResolvedValue({
      ...makeExportedModel(platform, [], []),
      attributes: {
        boundaries: {},
        components: {
          'c-db': { elementId: 'c-db', elementType: 'component', elementName: 'DB', classData: { id: 'cls-generic', name: 'Generic Store' }, attributes: { managed: true } },
          'c-web': { elementId: 'c-web', elementType: 'component', elementName: 'Web', classData: { id: 'cls-web', name: 'Web Server' }, attributes: { tls: true } },
          'p-new': { elementId: 'p-new', elementType: 'component', elementName: 'Cache', classData: { id: 'cls-generic', name: 'Generic Store' }, attributes: {} },
        },
        dataFlows: {},
        dataItems: {},
      },
    })

    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)

    expect(res.success).toBe(true)
    const written = JSON.parse(await fs.readFile(path.join(tmpDir, 'structure.json'), 'utf-8'))
    const byId = Object.fromEntries(written.defaultBoundary.components.map((c: any) => [c.id, c]))
    // Unresolved: the class the user chose stays, with its answers.
    expect(byId['c-db'].classData).toEqual(pg)
    expect(JSON.parse(await fs.readFile(path.join(attrDir, 'c-db.json'), 'utf-8'))).toMatchObject({ classData: pg, attributes: { encrypted_at_rest: true } })
    // Created by this push and unresolved: its local class under the platform id, and no answers it never had.
    expect(byId['p-new'].classData).toEqual(redis)
    await expect(fs.access(path.join(attrDir, 'p-new.json'))).rejects.toThrow()
    // Resolved: rewritten from the platform, as before.
    expect(byId['c-web'].classData).toEqual({ id: 'cls-web', name: 'Web Server' })
    expect(JSON.parse(await fs.readFile(path.join(attrDir, 'c-web.json'), 'utf-8'))).toMatchObject({ attributes: { tls: true } })
    expect(res.data!.warnings.join(' ')).toContain('Component "DB": Could not resolve')
  })

  // A strict push links every reference or refuses, so dt-core never reports these after a write; this pins the guard.
  it('keeps a control reference the update reports as unattached in the model files; attached ones come from the platform', async () => {
    const local = {
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [],
        components: [
          { id: 'c-api', name: 'API', controls: [{ id: null, name: 'Audit Logging', source: 'declared' }, { id: 'ctl-enc', name: 'Encryption' }] },
          { id: 'c-new', name: 'Worker', controls: [{ name: 'Firewall' }] },
        ],
      },
    }
    await writeModelDir(tmpDir, local, [{ id: 'f-1', name: 'Sync', source: { id: 'c-api' }, target: { id: 'c-new' }, controls: [{ id: 'ctl-gone' }] }], [])

    mockUpdateFromSplitModel.mockResolvedValue({
      ...okResult,
      warnings: ['Could not resolve control: Audit Logging (2 controls match that name: ctl-a, ctl-b)'],
      unresolvedControls: [
        { name: 'Audit Logging', reason: 'ambiguous', candidates: [{ id: 'ctl-a', name: 'Audit Logging' }, { id: 'ctl-b', name: 'Audit Logging' }], owner: { kind: 'COMPONENT', id: 'c-api', name: 'API' } },
        // c-new was created by this push and got a platform id.
        { name: 'Firewall', reason: 'not_found', owner: { kind: 'COMPONENT', id: 'c-new', name: 'Worker' } },
        { id: 'ctl-gone', reason: 'not_found', owner: { kind: 'DATA_FLOW', id: 'f-1', name: 'Sync' } },
        { name: 'Board Oversight', reason: 'not_found', owner: { kind: 'MODEL', name: 'Test' } },
        // Its component is not in the re-exported model.
        { name: 'Rate Limiting', reason: 'not_found', owner: { kind: 'COMPONENT', id: 'c-vanished', name: 'Edge' } },
      ],
      idMapping: new Map([['c-new', 'p-new']]),
    })
    const platform = {
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [],
        components: [
          { id: 'c-api', name: 'API', controls: [{ id: 'ctl-enc', name: 'Encryption' }] },
          { id: 'p-new', name: 'Worker' },
        ],
      },
    }
    mockExportModelToSplit.mockResolvedValue(makeExportedModel(platform, [{ id: 'f-1', name: 'Sync', source: { id: 'c-api' }, target: { id: 'p-new' } }], []))

    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)

    expect(res.success).toBe(true)
    const structure = JSON.parse(await fs.readFile(path.join(tmpDir, 'structure.json'), 'utf-8'))
    const byId = Object.fromEntries(structure.defaultBoundary.components.map((c: any) => [c.id, c]))
    expect(byId['c-api'].controls).toEqual([{ id: 'ctl-enc', name: 'Encryption' }, { id: null, name: 'Audit Logging', source: 'declared' }])
    expect(byId['p-new'].controls).toEqual([{ name: 'Firewall' }])
    const flows = JSON.parse(await fs.readFile(path.join(tmpDir, 'dataflows.json'), 'utf-8'))
    expect(flows.dataFlows[0].controls).toEqual([{ id: 'ctl-gone' }])
    const manifest = JSON.parse(await fs.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'))
    expect(manifest.model.controls).toEqual([{ name: 'Board Oversight' }])
    expect(res.data!.warnings).toContain(
      'Unresolved control references could not be kept in the model files, because their element is no longer there: Rate Limiting',
    )
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

describe('UpdateModelTool — the push gate and the merge-back', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-update-gate-'))
    mockUpdateFromSplitModel.mockReset()
    mockExportModelToSplit.mockReset()
    pushGate.real = true
  })
  afterEach(async () => {
    pushGate.real = false
    realMerge.on = false
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('refuses a push that fails Gate 2 before any backup or platform call', async () => {
    await writeModelDir(tmpDir, makeStructure([{ id: 'c-A', name: 'A' }]), [], [])
    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir }, contextWithClient)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^Push refused: Gate 2 fails \(/)
    expect(res.error).not.toContain(tmpDir)
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
    // Backups are made beside the model directory, not inside it.
    expect((await fs.readdir(path.dirname(tmpDir))).some((f) => f.startsWith(`${path.basename(tmpDir)}.backup-`))).toBe(false)
  })

  it('refuses a push while an enrichment value awaits the operator, before any backup or platform call', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    await writeGateModel(tmpDir, gateModel())
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 1, entries: [
      { batch: 'b1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema', source: 'app.py:3', previous: 'null' },
    ] }))
    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir }, contextWithClient)
    expect(res.error).toMatch(/^Push refused: 1 enrichment value awaits the operator's confirmation \(pending_enrichment\)/)
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
    expect((await fs.readdir(path.dirname(tmpDir))).some((f) => f.startsWith(`${path.basename(tmpDir)}.backup-`))).toBe(false)
  })

  it('refuses a push whose scope.json cannot be read, before any backup or platform call', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    await writeGateModel(tmpDir, gateModel())
    await fs.writeFile(path.join(tmpDir, 'outside-scope.json'), '{}')
    await fs.rm(path.join(tmpDir, '.dethereal', 'scope.json'), { force: true })
    await fs.symlink(path.join(tmpDir, 'outside-scope.json'), path.join(tmpDir, '.dethereal', 'scope.json'))
    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir }, contextWithClient)
    expect(res.success).toBe(false)
    expect(res.error).toBe('.dethereal/scope.json could not be read (symlink); fix or remove it, then push again')
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
    expect((await fs.readdir(path.dirname(tmpDir))).some((f) => f.startsWith(`${path.basename(tmpDir)}.backup-`))).toBe(false)
  })

  it('refuses a model it cannot read in the same words as the other pushes, before any backup or platform call', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    await writeGateModel(tmpDir, gateModel())
    await fs.writeFile(path.join(tmpDir, 'structure.json'), 'not json')
    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir }, contextWithClient)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^Push refused: the model could not be read \(.+\)\.$/)
    expect(res.error).not.toContain(tmpDir)
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
    expect((await fs.readdir(path.dirname(tmpDir))).some((f) => f.startsWith(`${path.basename(tmpDir)}.backup-`))).toBe(false)
  })

  it('pushes the model the gate judged, not what the directory holds after', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    const { directoryPushRefusal } = await import('../../utils/gates.js')
    await writeGateModel(tmpDir, gateModel())
    await registerAll(tmpDir)
    let gated = 0
    updateModelTool.gate = async (dir, payload) => {
      const refusal = await directoryPushRefusal(dir, payload)
      gated += 1
      const p = path.join(tmpDir, 'attributes', 'components', 'c-web.json')
      const doc = JSON.parse(await fs.readFile(p, 'utf8'))
      doc.attributes.session_timeout = 900
      await fs.writeFile(p, JSON.stringify(doc))
      return refusal
    }
    mockUpdateFromSplitModel.mockResolvedValue({ success: false, errors: [{ error: 'stopped by the test' }], warnings: [] })
    try {
      await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)
    } finally {
      updateModelTool.gate = undefined
    }
    expect(gated).toBe(1)
    expect(mockUpdateFromSplitModel).toHaveBeenCalledOnce()
    const pushed = mockUpdateFromSplitModel.mock.calls[0]![1]
    expect(pushed.attributes.components['c-web'].attributes).not.toHaveProperty('session_timeout')
    expect(pushed.attributes.components['c-web'].attributes.input_validation).toBe('schema')
  })

  it('a re-export that rewrites values the platform\'s way leaves them unregistered', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    const { modelStateTool } = await import('../model-state.tool.js')
    const m = gateModel()
    // Fields of c-web's class, so they register (the platform's '900' then reads as an ill-typed value).
    Object.assign(m.classCache['cls-service']!.template.schema.properties, { session_timeout: { type: 'integer' }, logging_enabled: { type: 'boolean' } })
    m.attributes.components['c-web']!.attributes.session_timeout = 900
    m.attributes.components['c-web']!.attributes.monitoring_tools = ['cloud audit log', 'waf log']
    await writeGateModel(tmpDir, m)
    await registerAll(tmpDir)
    realMerge.on = true
    mockUpdateFromSplitModel.mockResolvedValue({ ...okResult, idMapping: new Map() })
    // The platform returns a number as a string, an array in its own order, and a template default filled in.
    const exported = JSON.parse(JSON.stringify(m.attributes))
    Object.assign(exported.components['c-web'].attributes, { session_timeout: '900', monitoring_tools: ['waf log', 'cloud audit log'], logging_enabled: false })
    // Records come back in the platform's own forms too: sensitivity upper-cased, flags and item lists reordered.
    const exportedItems = m.dataItems.map((i) => ({ ...i, sensitivity: typeof i.sensitivity === 'string' ? i.sensitivity.toUpperCase() : i.sensitivity, regulatory_flags: [...(i.regulatory_flags ?? [])].reverse() }))
    const exportedFlows = m.dataFlows.map((f) => ({ ...f, dataItemIds: [...(f.dataItemIds ?? [])].reverse() }))
    mockExportModelToSplit.mockResolvedValue({ manifest: m.manifest, structure: m.structure, dataFlows: exportedFlows, dataItems: exportedItems, attributes: exported })
    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)
    expect(res.success, res.error).toBe(true)
    const g = (await modelStateTool.run({ action: 'get', directory_path: tmpDir, include: ['unregistered_rows'] } as never, contextWithClient) as any).data
    expect(g.baseline).toBe('verified')
    // Only the attribute rewrites: the records are compared in their normalised forms.
    expect(g.unregistered_changes.rows.map((r: any) => `${r.element_id}.${r.record ? 'record:' : ''}${r.field}`).sort())
      .toEqual(['c-web.logging_enabled', 'c-web.monitoring_tools', 'c-web.session_timeout'])
  })

  it('the backup check can see a backup (positive control)', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    await writeGateModel(tmpDir, gateModel())
    await registerAll(tmpDir)
    mockUpdateFromSplitModel.mockResolvedValue({ success: false, errors: [{ error: 'stopped by the test' }], warnings: [] })
    await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir }, contextWithClient)
    const backups = (await fs.readdir(path.dirname(tmpDir))).filter((f) => f.startsWith(`${path.basename(tmpDir)}.backup-`))
    expect(backups.length).toBeGreaterThan(0)
    for (const b of backups) await fs.rm(path.join(path.dirname(tmpDir), b), { recursive: true, force: true })
  })

  it('pushes a model that passes Gate 2, and re-keys local attributes of elements the push created', async () => {
    const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
    const m = gateModel()
    await writeGateModel(tmpDir, m)
    await registerAll(tmpDir)
    realMerge.on = true
    mockUpdateFromSplitModel.mockResolvedValue({ ...okResult, idMapping: new Map([['c-web', 'CWEB-uuid']]) })
    // The platform returns c-web under its new id, without the local-only attribute keys.
    const exportedStructure = JSON.parse(JSON.stringify(m.structure))
    const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-web') c.id = 'CWEB-uuid'; (b.boundaries ?? []).forEach(walk) }
    walk(exportedStructure)
    mockExportModelToSplit.mockResolvedValue({
      manifest: m.manifest, structure: exportedStructure,
      dataFlows: m.dataFlows.map((f) => ({ ...f, source: { id: f.source.id === 'c-web' ? 'CWEB-uuid' : f.source.id }, target: { id: f.target.id === 'c-web' ? 'CWEB-uuid' : f.target.id } })),
      dataItems: m.dataItems,
      attributes: { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} },
    })
    const res = await updateModelTool.run({ model_id: 'model-1', directory_path: tmpDir, create_backup: false }, contextWithClient)
    expect(res.success, res.error).toBe(true)
    expect(mockUpdateFromSplitModel).toHaveBeenCalledOnce()
    const files = await fs.readdir(path.join(tmpDir, 'attributes', 'components'))
    expect(files).toContain('CWEB-uuid.json')
    expect(files).not.toContain('c-web.json')
    const moved = JSON.parse(await fs.readFile(path.join(tmpDir, 'attributes', 'components', 'CWEB-uuid.json'), 'utf8'))
    expect(moved.elementId).toBe('CWEB-uuid')
    expect(moved.attributes.input_validation).toBe('schema')
  })
})

// =============================================================================
// The platform-change check: a push never overwrites what changed on the
// platform since the last pull or push without the operator naming it.
// =============================================================================

describe('UpdateModelTool — platform changes since the last pull or push', () => {
  let parent: string
  let dir: string

  /** Every file under the parent directory, with its content: a backup, sync.json write or id mapping all show. */
  async function snapshot(root: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const abs = path.join(entry.parentPath, entry.name)
      out[path.relative(root, abs)] = await fs.readFile(abs, 'utf8')
    }
    return out
  }
  const assign = (m: any) => { m.structure.defaultBoundary.components[0].controls = [{ id: 'ctl-new' }] }
  const platform = (change?: (m: any) => void) => {
    const m = richExport() as any
    change?.(m)
    return m
  }
  /** The platform as the next exports return it: a fresh copy each time, as a real export is. */
  const platformIs = (change?: (m: any) => void) => mockExportModelToSplit.mockImplementation(async () => platform(change))
  const pull = async () => {
    platformIs()
    const pulled = await exportModelTool.run({ model_id: 'm-1', directory_path: dir, if_exists: 'update' }, contextWithClient)
    expect(pulled.success, JSON.stringify(pulled)).toBe(true)
    expect(pulled.data?.platform_baseline).toBe('recorded')
    // A pull registers its directory (every successful export does).
    expect(pulled.data?.registered).toBe(true)
  }
  const push = (extra: Record<string, unknown> = {}) =>
    updateModelTool.run({ model_id: 'm-1', directory_path: dir, ...extra }, contextWithClient)

  beforeEach(async () => {
    platformCheck.real = true
    realMerge.on = true
    parent = await fs.mkdtemp(path.join(process.cwd(), '.test-platform-'))
    dir = path.join(parent, 'model')
    // The pull registers the model: its registry goes under this test's own project root.
    initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: parent } })
    mockUpdateFromSplitModel.mockReset()
    mockExportModelToSplit.mockReset()
    mockUpdateFromSplitModel.mockResolvedValue({ ...okResult, idMapping: new Map() })
  })
  afterEach(async () => {
    resetProjectRoot()
    platformCheck.real = false
    realMerge.on = false
    await fs.rm(parent, { recursive: true, force: true })
  })

  it('refuses a stale push after a control was assigned on the platform, before writing anything', async () => {
    await pull()
    platformIs(assign)
    const before = await snapshot(parent)

    const res = await push()

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/changed since your last pull or push: 1 element/)
    expect(res.data).toMatchObject({
      code: 'PLATFORM_CHANGED_SINCE_SYNC',
      baseline: 'verified',
      changes: [{ id: 'c-db', kind: 'component', name: 'DB', change: 'modified', fields: ['controls'] }],
      changed_ids: ['c-db'],
    })
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
    // No backup sibling, no sync.json write, no id mapping: the tree is exactly as it was.
    expect(await snapshot(parent)).toEqual(before)
  })

  it('overwrites exactly the named changes, then records the platform as the push left it', async () => {
    await pull()
    platformIs(assign)
    const refused = await push()
    const { changed_ids, revision } = refused.data as any

    const res = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data).toMatchObject({ acknowledgement: 'accepted', platform_baseline: 'recorded' })
    expect(mockUpdateFromSplitModel).toHaveBeenCalledTimes(1)

    // The platform now shows what the push wrote; the next push has nothing to name.
    mockUpdateFromSplitModel.mockClear()
    const next = await push()
    expect(next.success, JSON.stringify(next)).toBe(true)
    expect(next.data).not.toHaveProperty('acknowledgement')
  })

  it('refuses again when the platform changed again after the refusal', async () => {
    await pull()
    platformIs(assign)
    const { changed_ids, revision } = (await push()).data as any
    platformIs((m) => { assign(m); m.structure.defaultBoundary.components[0].controls.push({ id: 'ctl-more' }) })

    const res = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(res.success).toBe(false)
    expect(res.data).toMatchObject({ code: 'PLATFORM_CHANGED_SINCE_SYNC', acknowledgement: 'stale', changed_ids: ['c-db'] })
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
  })

  it('lists every element when the record was forged, and when sync.json predates it', async () => {
    await pull()
    const syncPath = path.join(dir, '.dethereal', 'sync.json')
    const sync = JSON.parse(await fs.readFile(syncPath, 'utf8'))
    sync.platform_baseline.elements['c-db'].f.controls = '0000000000000000'
    await fs.writeFile(syncPath, JSON.stringify(sync))
    platformIs()
    const forged = await push()
    expect(forged.data).toMatchObject({ baseline: 'unverifiable', changes_total: 8 })
    expect(new Set((forged.data as any).changes.map((c: any) => c.change))).toEqual(new Set(['no_baseline']))

    delete sync.platform_baseline
    await fs.writeFile(syncPath, JSON.stringify(sync))
    const legacy = await push()
    expect(legacy.data).toMatchObject({ baseline: 'legacy', changes_total: 8 })
    const { changed_ids, revision } = legacy.data as any
    const answered = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(answered.success, JSON.stringify(answered)).toBe(true)
    expect(answered.data).toMatchObject({ acknowledgement: 'accepted', platform_baseline: 'recorded' })
  })

  it('refuses when the platform model cannot be read for the check', async () => {
    await pull()
    mockExportModelToSplit.mockRejectedValue(new Error('network'))
    const res = await push()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/could not be read to check it for changes/)
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
  })

  it('reports an overwrite passed with nothing changed as unused', async () => {
    await pull()
    const res = await push({ overwrite_changed: ['c-db'], overwrite_revision: 'a'.repeat(64) })
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data).toMatchObject({ acknowledgement: 'unused' })
  })

  it('never reads its own writes as platform changes: pull→push→push with every push-written key present locally', async () => {
    await pull()
    // Every key the push writes only when the local file carries it is there after
    // the pull (class, attributes, conduits, model controls, scope, handles, modules);
    // a local-only attribute file is merged into the re-export on each push.
    const local = await snapshot(dir)
    const joined = Object.values(local).join('\n')
    for (const key of ['classData', 'conduits', 'ctl-model', 'sourceHandle', 'mod-1', 'compliance_drivers', 'ingress']) {
      expect(joined, key).toContain(key)
    }
    await fs.writeFile(
      path.join(dir, 'attributes', 'components', 'c-db.json'),
      JSON.stringify({ elementId: 'c-db', elementType: 'component', classData: { id: 'cls-db', name: 'DB' }, attributes: { local_only: true } }, null, 2),
    )

    for (const round of [1, 2]) {
      const res = await push()
      expect(res.success, `push ${round}: ${JSON.stringify(res)}`).toBe(true)
      expect(res.data?.platform_baseline).toBe('recorded')
    }
    expect(mockUpdateFromSplitModel).toHaveBeenCalledTimes(2)
  })

  it('lists elements added on the platform only when the push would delete them', async () => {
    await pull()
    platformIs((m) => { m.dataItems.push({ id: 'd-new', name: 'Added there' }) })
    const deleting = await push()
    expect(deleting.data).toMatchObject({ changed_ids: ['d-new'], changes: [expect.objectContaining({ change: 'added_on_platform' })] })
    const keeping = await push({ delete_orphaned: false })
    expect(keeping.success, JSON.stringify(keeping)).toBe(true)
  })

  it('without deleting orphans, ignores a platform change to an element the local model does not hold', async () => {
    await pull()
    // Locally the DB component and its flow are gone; on the platform a control was assigned to the DB.
    const structure = JSON.parse(await fs.readFile(path.join(dir, 'structure.json'), 'utf8'))
    structure.defaultBoundary.components = []
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure))
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify({ dataFlows: [] }))
    platformIs(assign)

    // Deleting orphans would delete the changed DB: refused.
    const deleting = await push()
    expect(deleting.data).toMatchObject({ code: 'PLATFORM_CHANGED_SINCE_SYNC', changed_ids: expect.arrayContaining(['c-db']) })
    expect(mockUpdateFromSplitModel).not.toHaveBeenCalled()
    // Keeping them, the push leaves the DB alone, so its change is not the push's to overwrite.
    const keeping = await push({ delete_orphaned: false })
    expect(keeping.success, JSON.stringify(keeping)).toBe(true)
  })

  it('without deleting orphans, still refuses a platform change to an element the local model holds', async () => {
    await pull()
    platformIs((m) => { m.structure.defaultBoundary.boundaries[0].components[0].positionX = 999 })
    const res = await push({ delete_orphaned: false })
    expect(res.data).toMatchObject({ code: 'PLATFORM_CHANGED_SINCE_SYNC', changed_ids: ['c-web'] })
  })

  it("refuses on a data item's attributes only in update_attributes, never here: update_model does not write them", async () => {
    await pull()
    platformIs((m) => { m.attributes.dataItems['d-1'].attributes = { retention: 'colleague' } })
    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
  })
})
