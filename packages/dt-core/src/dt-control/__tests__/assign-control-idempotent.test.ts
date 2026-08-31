/**
 * `assignControlToElements` is append-only and must be idempotent across sequential
 * calls. `connect` compiles to a bare relationship CREATE, so it reads the currently
 * attached ids and connects only the difference — otherwise every repeat call appends
 * a parallel SUPPORTS edge.
 *
 * The read (FIND_CONTROLS) must cover exactly the three typed fields the write
 * connects on. These tests pin that pairing, the two dedup paths, and the
 * already-fully-attached short-circuit.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtControl } from '../dt-control.js'

/**
 * @param attached - what the control already supports, by typed field
 */
const harness = (attached: {
  components?: string[]
  boundaries?: string[]
  dataFlows?: string[]
} = {}) => {
  const dt = new DtControl({} as any) as any

  const performQuery = vi.fn().mockResolvedValue({
    controls: [
      {
        id: 'ctrl-1',
        name: 'Control One',
        supportedComponents: (attached.components ?? []).map(id => ({ id, name: id })),
        supportedBoundaries: (attached.boundaries ?? []).map(id => ({ id, name: id })),
        supportedDataFlows: (attached.dataFlows ?? []).map(id => ({ id, name: id })),
      },
    ],
  })
  const performMutation = vi.fn().mockResolvedValue({
    id: 'ctrl-1',
    name: 'Control One',
    supportedComponents: [],
    supportedBoundaries: [],
    supportedDataFlows: [],
  })

  dt.dtUtils.performQuery = performQuery
  dt.dtUtils.performMutation = performMutation
  return { dt, performQuery, performMutation }
}

/** The ids offered to each of the three typed connect paths. */
const connectedIds = (performMutation: ReturnType<typeof vi.fn>) => {
  const input = performMutation.mock.calls[0][0].variables.input
  return {
    components: input.supportedComponents.connect.map((c: any) => c.where.node.id.eq),
    boundaries: input.supportedBoundaries.connect.map((c: any) => c.where.node.id.eq),
    dataFlows: input.supportedDataFlows.connect.map((c: any) => c.where.node.id.eq),
  }
}

describe('DtControl.assignControlToElements — idempotent across sequential calls', () => {
  it('connects only the ids not already attached', async () => {
    const { dt, performMutation } = harness({ components: ['e1'], boundaries: ['e2'] })

    await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['e1', 'e2', 'e3'] })

    // e1/e2 are already attached on their own paths — reconnecting them is what
    // appends the parallel edge. Only e3 survives.
    expect(connectedIds(performMutation)).toEqual({
      components: ['e3'],
      boundaries: ['e3'],
      dataFlows: ['e3'],
    })
  })

  it('broadcasts an un-attached id to all three typed paths (type resolved by the WHERE)', async () => {
    const { dt, performMutation } = harness()

    await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['unknown-type'] })

    // Subtraction never needs the id's label: "absent from all three read arrays"
    // is decidable without it, so the broadcast trick is preserved.
    expect(connectedIds(performMutation)).toEqual({
      components: ['unknown-type'],
      boundaries: ['unknown-type'],
      dataFlows: ['unknown-type'],
    })
  })

  it('dedupes the incoming list — the same id twice must not yield two connects', async () => {
    const { dt, performMutation } = harness()

    await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['e1', 'e1', 'e1'] })

    expect(connectedIds(performMutation).components).toEqual(['e1'])
  })

  it('dedupes the read — a repeated id in the attached set still subtracts once', async () => {
    // Defensive, not load-bearing: the engine's node-field projection already collapses
    // parallel edges, so a pair with N edges reads back as ONE entry. (Corollary worth
    // knowing: a duplicate-edge census cannot be taken through GraphQL — only raw Cypher
    // sees multiplicity.) The Set keeps `attached` correct either way.
    const { dt, performMutation } = harness({ components: ['e1', 'e1', 'e1', 'e1'] })

    await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['e1', 'e2'] })

    expect(connectedIds(performMutation).components).toEqual(['e2'])
  })

  it('fires NO mutation when everything is already attached, and does not return null', async () => {
    const { dt, performMutation } = harness({ components: ['e1'], boundaries: ['e2'] })

    const result = await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['e1', 'e2'] })

    expect(performMutation).not.toHaveBeenCalled()
    // Callers treat null as failure: the greenfield push throws and parks the
    // control at lifecycle=partially-pushed. The no-op path must return a Control.
    expect(result).not.toBeNull()
    expect(result.id).toBe('ctrl-1')
    // …shaped like the mutation path, with `elements` synthesized from the typed fields.
    expect(result.elements.map((e: any) => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('propagates a read failure instead of falling back to connecting everything', async () => {
    const { dt, performMutation } = harness()
    dt.dtUtils.performQuery = vi.fn().mockRejectedValue(new Error('graph unreachable'))

    await expect(
      dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['e1'] }),
    ).rejects.toThrow('graph unreachable')

    // A catch-and-broadcast fallback would reinstate the duplicate-edge bug on
    // exactly the transient-failure path where a retry is most likely.
    expect(performMutation).not.toHaveBeenCalled()
  })

  it('keys deduplication on the narrowed payload, not the caller’s raw list', async () => {
    const { dt, performMutation } = harness({ components: ['e1'] })

    await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: ['e1', 'e2'] })

    expect(performMutation.mock.calls[0][0].deduplicationKey).toBe('assign-control-ctrl-1-e2')
  })

  it('still short-circuits on empty/missing input before any read', async () => {
    const { dt, performQuery, performMutation } = harness()

    expect(await dt.assignControlToElements({ controlId: 'ctrl-1', elementIds: [] })).toBeNull()
    expect(await dt.assignControlToElements({ controlId: '', elementIds: ['e1'] })).toBeNull()

    expect(performQuery).not.toHaveBeenCalled()
    expect(performMutation).not.toHaveBeenCalled()
  })
})
