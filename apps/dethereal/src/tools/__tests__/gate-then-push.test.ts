/**
 * A push sends exactly the model its gate checked. import_model and
 * update_attributes read the directory once, gate that object and push it:
 * a file changed on disk after the gate has decided never reaches the
 * platform, and a model the gate refuses is never pushed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import type { ToolContext } from '../base-tool.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { registerAll } from './helpers/settle.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'

const { mockImport, mockUpdateAttributes, gate } = vi.hoisted(() => ({
  mockImport: vi.fn(),
  mockUpdateAttributes: vi.fn(),
  // What the wrapped gate saw, and what the test writes to disk once the real gate has decided.
  gate: { payloads: [] as unknown[], options: [] as unknown[], afterDecision: null as null | (() => Promise<void>) },
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtImportSplit: class { constructor(_c: unknown) {} importSplitModel = mockImport },
    DtUpdateSplit: class { constructor(_c: unknown) {} updateAttributesOnly = mockUpdateAttributes },
    // update_attributes reads the platform model before it pushes: none of its elements there yet.
    DtExportSplit: class {
      constructor(_c: unknown) {}
      exportModelToSplit = async () => ({ manifest: { model: { id: 'model-1', name: 'Shop' }, modules: [] }, structure: {}, dataFlows: [], dataItems: [], attributes: {} })
    },
  }
})

vi.mock('../../utils/gates.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/gates.js')
  return {
    ...actual,
    directoryPushRefusal: async (...args: Parameters<typeof actual.directoryPushRefusal>) => {
      const refusal = await actual.directoryPushRefusal(...args)
      gate.payloads.push(args[1])
      gate.options.push(args[2])
      if (gate.afterDecision) await gate.afterDecision()
      return refusal
    },
  }
})

const { importModelTool } = await import('../import-model.tool.js')
const { updateAttributesTool } = await import('../update-attributes.tool.js')

const context: ToolContext = { debug: false, apolloClient: {} as never }
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(process.cwd(), '.test-gate-then-push-'))
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: dir } })
  gate.payloads = []
  gate.options = []
  gate.afterDecision = null
  // The platform calls stop the push right after the payload is handed over.
  mockImport.mockReset().mockResolvedValue({ success: false, errors: [{ error: 'stopped by the test' }], warnings: [], idMapping: new Map() })
  mockUpdateAttributes.mockReset().mockResolvedValue({ success: false, errors: [], warnings: [], stats: {} })
})
afterEach(async () => {
  resetProjectRoot()
  await fs.rm(dir, { recursive: true, force: true })
  const parent = path.dirname(dir)
  for (const entry of await fs.readdir(parent)) {
    if (entry.startsWith(`${path.basename(dir)}.backup-`)) await fs.rm(path.join(parent, entry), { recursive: true, force: true })
  }
})

const model = () => path.join(dir, 'model')

/** Rewrite one JSON file of the model directory. */
async function rewrite(rel: string, change: (doc: any) => void): Promise<void> {
  const file = path.join(model(), rel)
  const doc = JSON.parse(await fs.readFile(file, 'utf8'))
  change(doc)
  await fs.writeFile(file, JSON.stringify(doc, null, 2))
}

/** Rename the web component, and remove its position so the directory would now fail Gate 2. */
const breakWebComponent = () => rewrite('structure.json', (s) => {
  const walk = (b: any) => {
    for (const c of b.components ?? []) if (c.id === 'c-web') { c.name = 'Written after the gate'; delete c.positionX }
    ;(b.boundaries ?? []).forEach(walk)
  }
  walk(s.defaultBoundary)
})

function webComponent(structure: any): any {
  const stack = [structure.defaultBoundary]
  while (stack.length) {
    const b = stack.pop()
    const hit = (b.components ?? []).find((c: any) => c.id === 'c-web')
    if (hit) return hit
    stack.push(...(b.boundaries ?? []))
  }
  return undefined
}

describe('a push sends the model its gate checked', () => {
  it('import_model: a change written after the gate decided is not pushed', async () => {
    await writeGateModel(model(), gateModel())
    await registerAll(model())
    gate.afterDecision = breakWebComponent

    await importModelTool.run({ directory_path: model() }, context)

    expect(gate.payloads).toHaveLength(1)
    expect(mockImport).toHaveBeenCalledTimes(1)
    const pushed = mockImport.mock.calls[0]![0]
    expect(pushed).toBe(gate.payloads[0])
    // A new platform model: no model binds a pull's registrations.
    expect(gate.options).toHaveLength(1)
    expect(gate.options[0]).not.toHaveProperty('modelId')
    expect(webComponent(pushed.structure)).toMatchObject({ name: 'Web frontend', positionX: expect.any(Number) })
    // The directory did change: the push simply never read it again.
    expect(webComponent(JSON.parse(await fs.readFile(path.join(model(), 'structure.json'), 'utf8'))).name).toBe('Written after the gate')
  })

  it('update_attributes: an attribute changed after the gate decided is not pushed', async () => {
    await writeGateModel(model(), gateModel())
    await registerAll(model())
    gate.afterDecision = () => rewrite('attributes/components/c-web.json', (f) => { f.attributes.input_validation = 'written-after-the-gate' })

    await updateAttributesTool.run({ model_id: 'model-1', directory_path: model() }, context)

    expect(gate.payloads).toHaveLength(1)
    const gated = gate.payloads[0] as { attributes: { components: Record<string, { attributes: Record<string, unknown> }> } }
    expect(gated.attributes.components['c-web']!.attributes.input_validation).toBe('schema')
    // The platform model it writes: a pull's registrations for that model count.
    expect(gate.options).toEqual([{ modelId: 'model-1' }])
    expect(mockUpdateAttributes).toHaveBeenCalledTimes(1)
    const [modelId, pushed] = mockUpdateAttributes.mock.calls[0]!
    expect(modelId).toBe('model-1')
    expect(pushed.components['c-web'].attributes.input_validation).toBe('schema')
    expect(JSON.stringify(pushed)).not.toContain('written-after-the-gate')
  })

  it('a model the gate refuses is never pushed by either tool', async () => {
    await writeGateModel(model(), gateModel())
    await breakWebComponent()

    const imported = await importModelTool.run({ directory_path: model() }, context)
    const updated = await updateAttributesTool.run({ model_id: 'model-1', directory_path: model() }, context)

    for (const r of [imported, updated]) {
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/^Push refused: Gate 2 fails/)
    }
    expect(gate.payloads).toHaveLength(2)
    expect(gate.payloads.every((p) => p !== undefined)).toBe(true)
    expect(mockImport).not.toHaveBeenCalled()
    expect(mockUpdateAttributes).not.toHaveBeenCalled()
  })
})
