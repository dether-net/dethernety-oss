/**
 * DtBoundary.updateBoundaryNode — zoning input-builder shapes (no live Apollo: the
 * `performMutation` seam is replaced with a spy and we assert the captured `variables.input`).
 */
import { describe, it, expect, vi } from 'vitest'
import { DtBoundary } from '../dt-boundary.js'
import { Conduit } from '../../interfaces/core-types-interface.js'

const make = (mutationResult: any = { id: 'b1', parentBoundary: [], dataItems: [] }) => {
  const dtBoundary = new DtBoundary({} as any)
  const performMutation = vi.fn().mockResolvedValue(mutationResult)
  ;(dtBoundary as any).dtUtils.performMutation = performMutation
  return { dtBoundary, performMutation }
}

const node = (data: Record<string, any>, id = 'b1') => ({
  id,
  parentNode: undefined, // root → no parentBoundary op
  position: { x: 1, y: 2 },
  width: 100,
  height: 50,
  data,
}) as any

const inputOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[0][0].variables.input

describe('updateBoundaryNode — zoning scalars', () => {
  it('sets sanitized zone / domains / planes', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({
      updatedNode: node({ label: 'B', zone: 'RESTRICTED', domains: ['  ERP ', 'erp'], planes: ['MANAGEMENT', 'WORKLOAD'] }),
      defaultBoundaryId: 'b0',
    })
    expect(inputOf(performMutation)).toMatchObject({
      zone: { set: 'RESTRICTED' },
      domains: { set: ['ERP'] },
      // `planes` is a `[String!]` field (the enum-list mutation input is broken in @neo4j/graphql v7),
      // so it takes a plain `{ set }` like `domains`. Values stay Plane-constrained by normalizePlanes.
      planes: { set: ['WORKLOAD', 'MANAGEMENT'] },
    })
  })

  it('omits zone/domains/planes entirely when absent from node.data (NO-CLOBBER)', async () => {
    // The import/update controls & dataItems association passes rebuild node.data without zoning; the
    // partial-update guard must leave the persisted zone untouched rather than reset it to null/[].
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B' }), defaultBoundaryId: 'b0' })
    const input = inputOf(performMutation)
    expect(input).not.toHaveProperty('zone')
    expect(input).not.toHaveProperty('domains')
    expect(input).not.toHaveProperty('planes')
  })

  it('writes a present-but-empty/null value (explicit clear/inherit — only absence omits)', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', zone: null, domains: [], planes: [] }), defaultBoundaryId: 'b0' })
    const input = inputOf(performMutation)
    expect(input.zone).toEqual({ set: null })
    expect(input.domains).toEqual({ set: [] })
    expect(input.planes).toEqual({ set: [] })
  })

  it('coerces an invalid zone to null (inherit)', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', zone: 'BOGUS' }), defaultBoundaryId: 'b0' })
    expect(inputOf(performMutation).zone).toEqual({ set: null })
  })
})

describe('updateBoundaryNode — conduits', () => {
  it('omits both conduit keys entirely when the buffer is undefined (no-op, leaves edges untouched)', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B' }), defaultBoundaryId: 'b0' })
    const input = inputOf(performMutation)
    expect(input).not.toHaveProperty('outboundConduits')
    expect(input).not.toHaveProperty('inboundConduits')
  })

  it('connects an added outbound peer and routes it to outboundConduits only', async () => {
    const { dtBoundary, performMutation } = make()
    const conduits: Conduit[] = [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'sanctioned' }]
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', conduits }), defaultBoundaryId: 'b0', baselineConduits: [] })
    const input = inputOf(performMutation)
    expect(input.outboundConduits).toEqual([
      { connect: [{ where: { node: { id: { eq: 'p1' } } }, edge: { justification: 'sanctioned' } }] },
    ])
    expect(input).not.toHaveProperty('inboundConduits')
  })

  it('disconnects a removed peer against the supplied baseline', async () => {
    const { dtBoundary, performMutation } = make()
    const baselineConduits: Conduit[] = [{ peerId: 'p1', direction: 'OUTBOUND' }]
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', conduits: [] }), defaultBoundaryId: 'b0', baselineConduits })
    expect(inputOf(performMutation).outboundConduits).toEqual([
      { disconnect: [{ where: { node: { id: { eq: 'p1' } } } }] },
    ])
  })

  it('re-derives the flattened conduits from the server response on return', async () => {
    const result = {
      id: 'b1',
      parentBoundary: [],
      dataItems: [],
      outboundConduitsConnection: { edges: [{ properties: { justification: 'j' }, node: { id: 'p1', name: 'Peer' } }] },
      inboundConduitsConnection: { edges: [] },
    }
    const { dtBoundary } = make(result)
    const ret = await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', conduits: [] }), defaultBoundaryId: 'b0' })
    expect(ret?.conduits).toEqual([
      { peerId: 'p1', peerName: 'Peer', direction: 'OUTBOUND', justification: 'j', controlRefs: undefined },
    ])
  })
})

describe('updateBoundaryNode — controls / dataItems REPLACE guards (P0)', () => {
  it('omits controls and dataItems entirely when absent (preserve — the conduit/import safe-node relies on this)', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B' }), defaultBoundaryId: 'b0' })
    const input = inputOf(performMutation)
    expect(input).not.toHaveProperty('controls')
    expect(input).not.toHaveProperty('dataItems')
  })

  it('clears via a bare disconnect-all when present-but-empty ([] = explicit clear)', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', controls: [], dataItems: [] }), defaultBoundaryId: 'b0' })
    const input = inputOf(performMutation)
    expect(input.controls).toEqual({ disconnect: {}, connect: [] })
    expect(input.dataItems).toEqual({ disconnect: {}, connect: [] })
  })

  it('REPLACEs to the listed set when populated — via an unconditional disconnect-all', async () => {
    const { dtBoundary, performMutation } = make()
    await dtBoundary.updateBoundaryNode({ updatedNode: node({ label: 'B', controls: ['c1', 'c2'], dataItems: ['d1'] }), defaultBoundaryId: 'b0' })
    const input = inputOf(performMutation)
    expect(input.controls.disconnect).toEqual({})
    expect(input.controls.connect).toEqual([{ where: { node: { id: { eq: 'c1' } } } }, { where: { node: { id: { eq: 'c2' } } } }])
    expect(input.dataItems.disconnect).toEqual({})
    expect(input.dataItems.connect).toEqual([{ where: { node: { id: { eq: 'd1' } } } }])
  })

})
