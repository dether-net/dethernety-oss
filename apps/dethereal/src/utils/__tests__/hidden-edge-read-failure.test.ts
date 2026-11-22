/**
 * Reading which flows are hidden edges never fails the model's read: when the key cannot be read at all (here the
 * signer throws), every flow counts as ordinary.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'

vi.mock('../../hidden-edges/records.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../hidden-edges/records.js')
  return { ...actual, signerFor: async () => { throw new Error('the key cannot be read') } }
})

const { computeGates, loadGateInput } = await import('../gates.js')
const { gateModel, writeGateModel } = await import('./fixtures/gate-model.js')
const { addHiddenEdge } = await import('./fixtures/hidden-edge.js')

let root: string
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-hidden-edge-read-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('a hidden-edge read that throws', () => {
  it('leaves the model readable, with every flow ordinary', async () => {
    const m = gateModel()
    addHiddenEdge(m, { id: 'he-1', source: 'x-customer', target: 'c-db' })
    const dir = path.join(root, 'm')
    await writeGateModel(dir, m)
    await fs.writeFile(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), JSON.stringify({ version: 1, decisions: [] }))
    const input = await loadGateInput(dir)
    expect(input.hiddenEdgeFlows?.size).toBe(0)
    const r = computeGates(input)
    expect(r.gate3.report.hidden_edge_flows).toBe(0)
    expect(r.gate3.criteria.C3.failing.map((f) => f.id)).toContain('he-1')
  })
})
