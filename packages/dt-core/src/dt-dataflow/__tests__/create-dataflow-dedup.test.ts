/**
 * createDataFlow's dedup key must distinguish parallel edges between the same
 * pair+class (different handles/label/id) so one isn't collapsed away, while a true
 * repeat of the same edge still shares a key. Plus DELETE_DATA_FLOW cascades analyses.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtDataflow } from '../dt-dataflow.js'
import { DELETE_DATA_FLOW } from '../dt-dataflow-gql.js'

const keyFor = async (edge: any) => {
  const dt = new DtDataflow({} as any) as any
  const performMutation = vi.fn().mockResolvedValue({ id: 'server-1' })
  dt.dtUtils.performMutation = performMutation
  await dt.createDataFlow({ newEdge: edge, classId: 'cls1' })
  return performMutation.mock.calls[0][0].deduplicationKey as string
}

const edge = (over: any) => ({
  id: '', source: 'A', target: 'B', sourceHandle: null, targetHandle: null,
  label: undefined, data: { description: '' }, ...over,
})

describe('DtDataflow.createDataFlow — dedup key discriminates parallel edges', () => {
  it('differs for two edges between the same pair with different handles', async () => {
    const k1 = await keyFor(edge({ sourceHandle: 'right', targetHandle: 'left' }))
    const k2 = await keyFor(edge({ sourceHandle: 'bottom', targetHandle: 'top' }))
    expect(k1).not.toBe(k2)
  })

  it('differs for two same-endpoint edges with distinct client ids', async () => {
    const k1 = await keyFor(edge({ id: 'edge-1' }))
    const k2 = await keyFor(edge({ id: 'edge-2' }))
    expect(k1).not.toBe(k2)
  })

  it('is stable for a repeat of the same edge (dedup still collapses a double-submit)', async () => {
    // Fresh objects with identical content — a double-submit shares the same edge
    // identity. (keyFor mutates newEdge.id to the server id on success, so the two
    // submits must be distinct objects carrying the same client id.)
    const k1 = await keyFor(edge({ id: 'edge-1', sourceHandle: 'r', targetHandle: 'l' }))
    const k2 = await keyFor(edge({ id: 'edge-1', sourceHandle: 'r', targetHandle: 'l' }))
    expect(k1).toBe(k2)
  })
})

describe('DELETE_DATA_FLOW cascade', () => {
  it('cascades exposures and analyses by-element (the proven DELETE_COMPONENT pattern)', () => {
    const m = DELETE_DATA_FLOW.loc?.source.body ?? ''
    expect(m).toMatch(/deleteExposures\(where:\s*{\s*element:/)
    expect(m).toMatch(/deleteAnalyses\(\s*where:\s*{\s*element:/)
    expect(m).toMatch(/deleteDataFlows\(where:\s*{\s*id:/)
  })
})
