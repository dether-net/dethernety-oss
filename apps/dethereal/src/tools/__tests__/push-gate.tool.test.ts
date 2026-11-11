/**
 * Gate 2 and unconfirmed enrichment block every push: import_model,
 * create_threat_model and update_attributes refuse, before any backup or
 * platform call, and let a clean model through. (update_model has its own tests.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import type { ToolContext } from '../base-tool.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { registerAll } from './helpers/settle.js'

// Each test registers, gates and pushes whole models: slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

const { mockImport, mockUpdateAttributes } = vi.hoisted(() => ({ mockImport: vi.fn(), mockUpdateAttributes: vi.fn() }))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtImportSplit: class { constructor(_c: unknown) {} importSplitModel = mockImport },
    // update_attributes calls updateAttributesOnly; the other two names are kept so a rename cannot hide a call.
    DtUpdateSplit: class { constructor(_c: unknown) {} updateAttributesOnly = mockUpdateAttributes; updateAttributesFromSplitModel = mockUpdateAttributes; updateAttributes = mockUpdateAttributes },
    // update_attributes reads the platform model before it pushes: none of its elements there yet.
    DtExportSplit: class { constructor(_c: unknown) {} exportModelToSplit = async () => ({ manifest: { model: { id: 'model-1', name: 'Shop' }, modules: [] }, structure: {}, dataFlows: [], dataItems: [], attributes: {} }) },
  }
})

// The settlement gate, wrapped so a test can change the directory right after it decides.
const { afterSettlementGate } = vi.hoisted(() => ({ afterSettlementGate: { run: null as null | (() => Promise<void>) } }))
vi.mock('../../utils/settlement-state.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/settlement-state.js')
  return {
    ...actual,
    settlementPushRefusal: async (...args: Parameters<typeof actual.settlementPushRefusal>) => {
      const refusal = await actual.settlementPushRefusal(...args)
      await afterSettlementGate.run?.()
      return refusal
    },
  }
})

const { importModelTool } = await import('../import-model.tool.js')
const { createModelTool } = await import('../create-model.tool.js')
const { updateAttributesTool } = await import('../update-attributes.tool.js')

const context: ToolContext = { debug: false, apolloClient: {} as any }
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(process.cwd(), '.test-push-gate-'))
  mockImport.mockReset()
  mockUpdateAttributes.mockReset()
  mockImport.mockResolvedValue({ success: false, errors: [{ error: 'stopped by the test' }], warnings: [], idMapping: new Map() })
  mockUpdateAttributes.mockResolvedValue({ success: false, errors: [{ error: 'stopped by the test' }], warnings: [] })
})
afterEach(async () => {
  afterSettlementGate.run = null
  await fs.rm(dir, { recursive: true, force: true })
  // A push that gets past the gate may leave its backup beside the model.
  const parent = path.dirname(dir)
  for (const entry of await fs.readdir(parent)) {
    if (entry.startsWith(`${path.basename(dir)}.backup-`)) await fs.rm(path.join(parent, entry), { recursive: true, force: true })
  }
})

const NO_ATTRIBUTES = { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} }

/** Backups a push left beside the model directory. */
async function backupsBeside(modelDir: string): Promise<string[]> {
  return (await fs.readdir(path.dirname(modelDir))).filter((e) => e.startsWith(`${path.basename(modelDir)}.backup-`))
}

/** One pending entry for an element of the reference model. */
const pendingEntry = (extra: Record<string, unknown> = {}) => ({
  batch: 'b1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema',
  source: 'app/server.py:12', previous: 'null', ...extra,
})

async function writePending(modelDir: string, doc: unknown): Promise<void> {
  await fs.mkdir(path.join(modelDir, '.dethereal'), { recursive: true })
  await fs.writeFile(path.join(modelDir, '.dethereal', 'enrichment-pending.json'), typeof doc === 'string' ? doc : JSON.stringify(doc))
}

/** The reference model with one Gate 2 failure: a component without a position. */
function brokenModel() {
  const m = gateModel()
  const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-web') delete c.positionX; (b.boundaries ?? []).forEach(walk) }
  walk(m.structure.defaultBoundary)
  return m
}

describe('push gate', () => {
  it('import_model refuses a model that fails Gate 2, and passes a clean one on to the platform', async () => {
    await writeGateModel(dir, brokenModel())
    const refused = await importModelTool.run({ directory_path: dir }, context)
    expect(refused.success).toBe(false)
    expect(refused.error).toMatch(/^Push refused: Gate 2 fails \(.*lint_errors/)
    expect(refused.error).not.toContain(dir)
    expect(mockImport).not.toHaveBeenCalled()

    await writeGateModel(dir, gateModel())
    const unregistered = await importModelTool.run({ directory_path: dir }, context)
    expect(unregistered.error).toMatch(/^Push refused: \d+ values are not registered as the operator's \(unregistered_changes\)/)
    await registerAll(dir)
    await importModelTool.run({ directory_path: dir }, context)
    expect(mockImport).toHaveBeenCalledOnce()
  })

  it('import_model refuses a model the gate loader cannot read', async () => {
    await writeGateModel(dir, gateModel())
    await fs.writeFile(path.join(dir, 'structure.json'), 'not json')
    const r = await importModelTool.run({ directory_path: dir }, context)
    expect(r.error).toBe('Push refused: the model could not be read (structure.json: invalid json).')
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('create_threat_model checks the model it is given', async () => {
    const asSplit = (m: ReturnType<typeof gateModel>) => ({
      manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: m.attributes,
    })
    const refused = await createModelTool.run({ model: asSplit(brokenModel()) as any }, context)
    expect(refused.success).toBe(false)
    expect(refused.error).toMatch(/^Push refused: Gate 2 fails/)
    expect(mockImport).not.toHaveBeenCalled()
    // In memory there is no baseline: every value is unregistered, records included (each element's placement is
    // one), so a model with any element is refused until it comes from a registered directory.
    for (const model of [asSplit(gateModel()), { ...asSplit(gateModel()), attributes: NO_ATTRIBUTES }]) {
      const inMemory = await createModelTool.run({ model: model as any }, context)
      expect(inMemory.error).toMatch(/\(unregistered_changes\)/)
    }
    expect(mockImport).not.toHaveBeenCalled()
    // The positive control: the same model, written into a registered directory.
    await writeGateModel(dir, gateModel())
    await registerAll(dir)
    await createModelTool.run({ model: asSplit(gateModel()) as any, directory_path: dir }, context)
    expect(mockImport).toHaveBeenCalledOnce()
  })

  it('update_attributes refuses a model that fails Gate 2', async () => {
    const m = gateModel()
    m.attributes.components['c-web']!.attributes.mitre_techniques = ['T1190']
    await writeGateModel(dir, m)
    const r = await updateAttributesTool.run({ model_id: 'model-1', directory_path: dir }, context)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/^Push refused: Gate 2 fails/)
    expect(mockUpdateAttributes).not.toHaveBeenCalled()
  })

  it('update_attributes passes a clean model on to the platform (the positive control for the refusal above)', async () => {
    await writeGateModel(dir, gateModel())
    await registerAll(dir)
    await updateAttributesTool.run({ model_id: 'model-1', directory_path: dir }, context)
    expect(mockUpdateAttributes).toHaveBeenCalledOnce()
  })
})

describe('push gate: pending enrichment', () => {
  const refusal = /^Push refused: 1 enrichment value awaits the operator's confirmation \(pending_enrichment\)/

  it('import_model refuses while an enrichment value awaits the operator, and pushes once it is cleared', async () => {
    await writeGateModel(dir, gateModel())
    await writePending(dir, { version: 1, entries: [pendingEntry()] })
    const r = await importModelTool.run({ directory_path: dir }, context)
    expect(r.error).toMatch(refusal)
    expect(mockImport).not.toHaveBeenCalled()
    expect(await backupsBeside(dir)).toEqual([])
    await writePending(dir, { version: 1, entries: [] })
    await registerAll(dir)
    await importModelTool.run({ directory_path: dir }, context)
    expect(mockImport).toHaveBeenCalledOnce()
  })

  it('update_attributes refuses while an enrichment value awaits the operator', async () => {
    await writeGateModel(dir, gateModel())
    await writePending(dir, { version: 1, entries: [pendingEntry()] })
    const r = await updateAttributesTool.run({ model_id: 'model-1', directory_path: dir }, context)
    expect(r.error).toMatch(refusal)
    expect(mockUpdateAttributes).not.toHaveBeenCalled()
    expect(await backupsBeside(dir)).toEqual([])
  })

  it('an unreadable or malformed pending file refuses too, and no content reaches the message', async () => {
    await writeGateModel(dir, gateModel())
    for (const [doc, code] of [
      ['{"version": 1, "entries": [ canary-secret-value', 'invalid_json'],
      [{ version: 2, entries: [] }, 'unsupported_version'],
      [{ version: 1, entries: 'canary-secret-value' }, 'entries_not_a_list'],
    ] as const) {
      await writePending(dir, doc)
      const r = await importModelTool.run({ directory_path: dir }, context)
      expect(r.error).toContain(`(pending_enrichment_unreadable: ${code})`)
      expect(r.error).not.toContain('canary-secret-value')
    }
    await writePending(dir, { version: 1, entries: [pendingEntry({ previous: null, source: 'canary-secret-value' })] })
    const r = await importModelTool.run({ directory_path: dir }, context)
    expect(r.error).toMatch(refusal)
    expect(r.error).not.toContain('canary-secret-value')
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('create_threat_model into a registered directory pushes the model it judged, not what the directory holds after', async () => {
    const m = gateModel()
    const asSplit = { manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: m.attributes }
    await writeGateModel(dir, m)
    await registerAll(dir)
    let gated = 0
    afterSettlementGate.run = async () => {
      gated += 1
      const p = path.join(dir, 'attributes', 'components', 'c-web.json')
      const doc = JSON.parse(await fs.readFile(p, 'utf8'))
      doc.attributes.session_timeout = 900
      await fs.writeFile(p, JSON.stringify(doc))
    }
    await createModelTool.run({ model: asSplit as any, directory_path: dir }, context)
    expect(gated).toBe(1)
    expect(mockImport).toHaveBeenCalledOnce()
    const pushed = mockImport.mock.calls[0]![0]
    expect(pushed.attributes.components['c-web'].attributes).not.toHaveProperty('session_timeout')
    expect(pushed.attributes.components['c-web'].attributes.input_validation).toBe('schema')
  })

  it('create_threat_model refuses to write into a model directory with pending enrichment, not an in-memory create', async () => {
    const m = gateModel()
    const asSplit = { manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: m.attributes }
    await writeGateModel(dir, m)
    await writePending(dir, { version: 1, entries: [pendingEntry()] })
    const r = await createModelTool.run({ model: asSplit as any, directory_path: dir }, context)
    expect(r.error).toMatch(refusal)
    expect(mockImport).not.toHaveBeenCalled()
    // An in-memory create is not held against that directory's pending rows (it is refused only as unregistered).
    const inMemory = await createModelTool.run({ model: { ...asSplit, attributes: NO_ATTRIBUTES } as any }, context)
    expect(inMemory.error).toMatch(/\(unregistered_changes\)/)
    expect(inMemory.error).not.toMatch(refusal)
  })
})
