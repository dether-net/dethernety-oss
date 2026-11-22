/**
 * A hidden edge this machine accepted is no flow of the system: quality, zoning and coverage leave it out and count
 * it apart, the settlement never asks for its values, prune keeps its attribute file, and a push of its directory is
 * not refused for it. Without this machine's key or its accept, the same flow is an ordinary one again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { directoryPushRefusal, payloadPushRefusal } from '../../utils/gates.js'
import { validateModelTool } from '../validate-model.tool.js'
import { modelStateTool } from '../model-state.tool.js'
import { modelStatePruneTool } from '../model-state-prune.tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { acceptHiddenEdge, addHiddenEdge, REMOTE } from '../../utils/__tests__/fixtures/hidden-edge.js'
import { registerAll } from './helpers/settle.js'

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const EDGE = { id: 'he-1', source: 'x-customer', target: 'c-db' }
let root: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-hidden-edge-flows-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** A gate model, with the edge when `edge`, and this machine's accept of it when `accepted`. */
async function modelDir(edge: boolean, accepted: boolean, mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  if (edge) addHiddenEdge(m, EDGE)
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  if (accepted) await acceptHiddenEdge(dir, EDGE)
  return dir
}

const run = async (action: string, dir: string) => {
  const r = (await validateModelTool.run({ action, directory_path: dir }, context)) as { success: boolean; data?: any; error?: string }
  expect(r.success, r.error).toBe(true)
  return r.data
}
const get = async (dir: string, include?: string[]) => ((await modelStateTool.run({ action: 'get', directory_path: dir, ...(include ? { include } : {}) } as never, context)) as any).data

describe('quality, zoning and coverage', () => {
  it('leave an accepted hidden edge out, and quality counts it apart', async () => {
    const ref = await modelDir(false, false)
    const dir = await modelDir(true, true)
    const [q0, q1] = [await run('quality', ref), await run('quality', dir)]
    expect(q1.factors).toEqual(q0.factors)
    expect(q1.quality_score).toBe(q0.quality_score)
    expect(q1.attribute_residual).toEqual(q0.attribute_residual)
    expect(q0.element_counts).toMatchObject({ data_flows: 8, hidden_edge_flows: 0 })
    expect(q1.element_counts).toEqual({ ...q0.element_counts, hidden_edge_flows: 1 })
    expect(await run('zoning', dir)).toEqual(await run('zoning', ref))
    expect(await run('coverage', dir)).toEqual(await run('coverage', ref))
  })

  it('read the same flow as an ordinary one without this machine\'s accept', async () => {
    const q = await run('quality', await modelDir(true, false))
    expect(q.element_counts).toMatchObject({ data_flows: 9, hidden_edge_flows: 0 })
    const cov = await run('coverage', await modelDir(true, false))
    expect(cov.formal_coverage.cross_boundary_flows.map((f: { id: string }) => f.id)).toContain('he-1')
  })

  it('without this machine\'s key, the accepted edge counts as an ordinary flow', async () => {
    const dir = await modelDir(true, true)
    const home = process.env.HOME
    process.env.HOME = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-no-key-')))
    try {
      expect((await run('quality', dir)).element_counts).toMatchObject({ data_flows: 9, hidden_edge_flows: 0 })
      expect((await get(dir)).gates.hidden_edge_flows).toBe(0)
    } finally {
      await fs.rm(process.env.HOME!, { recursive: true, force: true })
      process.env.HOME = home
    }
  })
})

describe('the settlement and model_state', () => {
  it('never asks for an accepted edge\'s values, and model_state counts it apart', async () => {
    const dir = await modelDir(false, false)
    await registerAll(dir)
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
    const m = gateModel()
    addHiddenEdge(m, EDGE)
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify(m.dataFlows, null, 2))
    await fs.writeFile(path.join(dir, 'attributes', 'dataFlows', 'he-1.json'), JSON.stringify(m.attributes.dataFlows['he-1'], null, 2))
    // Before the accept, its values are unregistered like any flow's.
    expect((await get(dir)).unregistered_changes.rows_total).toBeGreaterThan(0)
    await acceptHiddenEdge(dir, EDGE)
    const state = await get(dir)
    expect(state.unregistered_changes.rows_total).toBe(0)
    expect(state.gates.hidden_edge_flows).toBe(1)
  })

  it('does not report a registered value of the edge as gone once it is accepted', async () => {
    // Registered while the flow was an ordinary one, against a cached template of its class.
    const dir = await modelDir(true, false, (m) => {
      const properties = Object.fromEntries(Object.keys(m.attributes.dataFlows['he-1']!.attributes).map((k) => [k, k.endsWith('_ids') ? { type: 'array', items: { type: 'string' } } : { type: 'string' }]))
      m.classCache[REMOTE.id] = { classId: REMOTE.id, className: REMOTE.name, classType: 'dataflow', module: { id: 'mod-he', name: 'dethernety-hidden-edges' }, template: { schema: { type: 'object', properties } } }
    })
    await registerAll(dir)
    const file = path.join(dir, 'attributes', 'dataFlows', 'he-1.json')
    const doc = JSON.parse(await fs.readFile(file, 'utf8'))
    delete doc.attributes.tier
    await fs.writeFile(file, JSON.stringify(doc, null, 2))
    const rows = async () => (await get(dir, ['unregistered_rows'])).unregistered_changes.rows as Array<{ element_id: string; removed?: true }>
    expect((await rows()).filter((r) => r.element_id === 'he-1' && r.removed)).toHaveLength(1)
    await acceptHiddenEdge(dir, EDGE)
    expect(await rows()).toEqual([])
  })
})

describe('prune and push', () => {
  it('prune never takes an accepted edge\'s attribute file for an orphan', async () => {
    const dir = await modelDir(true, true, (m) => {
      m.attributes.components['c-gone'] = { elementId: 'c-gone', elementType: 'component', attributes: {} }
    })
    await registerAll(dir)
    const refused = (await modelStatePruneTool.run({ directory_path: dir, files: ['attributes/dataFlows/he-1.json'] }, context)) as any
    expect(refused.success).toBe(false)
    expect(refused.data.orphaned_files).toEqual(['attributes/components/c-gone.json'])
    const r = (await modelStatePruneTool.run({ directory_path: dir, files: ['attributes/components/c-gone.json'] }, context)) as any
    expect(r.success, r.error).toBe(true)
    expect(existsSync(path.join(dir, 'attributes', 'dataFlows', 'he-1.json'))).toBe(true)
  })

  it('a push of the directory is not refused for an accepted edge, and is for the same flow unaccepted', async () => {
    const accepted = await modelDir(true, true)
    await registerAll(accepted)
    expect(await directoryPushRefusal(accepted)).toBeNull()
    const unaccepted = await modelDir(true, false)
    expect(await directoryPushRefusal(unaccepted, undefined, { settlement: 'off' })).toMatch(/Gate 2 fails \(lint_errors: 1\)/)
  })

  it('a payload pushed with no directory has no accepts to read: its hidden-edge flows count as ordinary', async () => {
    const m = gateModel()
    addHiddenEdge(m, EDGE)
    const dir = await modelDir(true, true)
    const payload = { manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: m.attributes } as never
    expect(await directoryPushRefusal(dir, payload, { settlement: 'off' })).toBeNull()
    expect(await payloadPushRefusal(null, payload, { settlement: 'off' })).toMatch(/Gate 2 fails \(lint_errors: 1\)/)
  })
})
