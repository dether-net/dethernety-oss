/**
 * flowStore boundary-zoning persist path.
 *
 * The load-bearing guarantee: `updateNode` snapshots `node.data.conduits` BEFORE
 * the optimistic merge and threads it as `baselineConduits` to dt-core. That
 * baseline is what makes the conduit reconcile a correct delta — and it makes a
 * position-only save a conduit no-op (baseline === current), so a drag never
 * re-connects an existing peer (CONDUIT connect is not idempotent → dup edge).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const updateBoundaryNodeMock = vi.fn()
const updateComponentMock = vi.fn()

// Real recursive deepMerge (mirrors dt-utils): nested objects merge, arrays are replaced.
class DtUtilsStub {
  handleError = vi.fn()
  deepMerge(target: any, updates: any) {
    for (const key in updates) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        target[key] = target[key] || {}
        this.deepMerge(target[key], updates[key])
      } else {
        target[key] = updates[key]
      }
    }
    return target
  }
}

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class { updateBoundaryNode = updateBoundaryNodeMock },
  DtClass: class {},
  DtComponent: class { updateComponent = updateComponentMock },
  DtControl: class {},
  DtDataflow: class {},
  DtDataItem: class {},
  DtExposure: class {},
  DtMitreAttack: class {},
  DtModel: class {},
  DtModule: class {},
  DtUtils: DtUtilsStub,
  executeSupersedeFlow: vi.fn(),
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFlowStore: typeof import('../flowStore').useFlowStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../flowStore')
  useFlowStore = mod.useFlowStore
})

const boundaryNode = (conduits: any[]) => ({
  id: 'b1',
  type: 'BOUNDARY',
  position: { x: 0, y: 0 },
  width: 10,
  height: 10,
  parentNode: '',
  data: { label: 'B', conduits },
})

const serverBoundary = (over: any = {}) => ({
  id: 'b1', name: 'B', description: '', controls: [], dataItems: [], parentBoundary: [],
  zone: 'PUBLIC', domains: ['erp'], planes: ['WORKLOAD'],
  conduits: [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'edited', peerName: 'P' }],
  ...over,
})

const seed = (store: any, conduits: any[]) =>
  store.$patch({ nodes: [boundaryNode(conduits)], defaultBoundaryId: 'root' })

describe('flowStore — conduit baseline snapshot before merge', () => {
  it('threads the PRE-merge conduits as baselineConduits and merges the new buffer onto the node', async () => {
    const store = useFlowStore()
    seed(store, [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'orig' }])
    updateBoundaryNodeMock.mockResolvedValue(serverBoundary())

    await store.updateNode({
      nodeId: 'b1',
      updates: { data: { conduits: [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'edited' }] } },
    })

    const arg = updateBoundaryNodeMock.mock.calls[0][0]
    expect(arg.baselineConduits).toEqual([{ peerId: 'p1', direction: 'OUTBOUND', justification: 'orig' }])
    expect(arg.updatedNode.data.conduits).toEqual([{ peerId: 'p1', direction: 'OUTBOUND', justification: 'edited' }])
  })

  it('a position-only save passes baselineConduits === current conduits (empty delta → no duplicate edge)', async () => {
    const store = useFlowStore()
    const current = [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'orig' }]
    seed(store, current)
    updateBoundaryNodeMock.mockResolvedValue(serverBoundary({ conduits: current }))

    await store.updateNode({ nodeId: 'b1', updates: { position: { x: 5, y: 5 } } })

    const arg = updateBoundaryNodeMock.mock.calls[0][0]
    expect(arg.baselineConduits).toEqual(arg.updatedNode.data.conduits)
    expect(arg.updatedNode.data.conduits).toEqual(current)
  })
})

describe('flowStore — reconcile re-pins zoning to server truth', () => {
  it('writes server zone/domains/planes/conduits back onto the node', async () => {
    const store = useFlowStore()
    seed(store, [])
    updateBoundaryNodeMock.mockResolvedValue(serverBoundary())

    await store.updateNode({ nodeId: 'b1', updates: { data: { zone: 'PUBLIC' } } })

    const node: any = store.nodes.find((n: any) => n.id === 'b1')
    expect(node.data.zone).toBe('PUBLIC')
    expect(node.data.domains).toEqual(['erp'])
    expect(node.data.planes).toEqual(['WORKLOAD'])
    expect(node.data.conduits).toEqual([{ peerId: 'p1', direction: 'OUTBOUND', justification: 'edited', peerName: 'P' }])
  })
})

describe('flowStore — in-flight gating', () => {
  it('marks updateBoundary-<id> loading during the save and clears it after', async () => {
    const store = useFlowStore()
    seed(store, [])
    let resolveSave: (v: any) => void = () => {}
    updateBoundaryNodeMock.mockReturnValue(new Promise(r => { resolveSave = r }))

    const pending = store.updateNode({ nodeId: 'b1', updates: { position: { x: 1, y: 1 } } })
    expect(store.isOperationLoading('updateBoundary-b1')).toBe(true)

    resolveSave(serverBoundary({ conduits: [] }))
    await pending
    expect(store.isOperationLoading('updateBoundary-b1')).toBe(false)
  })
})

describe('flowStore — failed save reverts to server truth (updateNode never rejects)', () => {
  const boundaryWithZone = (zone: string): any => ({
    id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, width: 10, height: 10, parentNode: '',
    data: { label: 'B', zone, conduits: [] },
  })

  it('boundary save throws → node reverts to server truth, returns false, selectedItem re-pinned', async () => {
    const store = useFlowStore()
    store.$patch({ nodes: [boundaryWithZone('PUBLIC')], defaultBoundaryId: 'root' })
    store.selectedItem = store.nodes.find((n: any) => n.id === 'b1') as any
    updateBoundaryNodeMock.mockRejectedValue(new Error('network down'))

    const ok = await store.updateNode({ nodeId: 'b1', updates: { data: { zone: 'RESTRICTED' } } })

    expect(ok).toBe(false)
    expect((store.nodes.find((n: any) => n.id === 'b1') as any).data.zone).toBe('PUBLIC')
    expect((store.selectedItem as any).data.zone).toBe('PUBLIC')
  })

  it('boundary save returns falsy (no throw) → node still reverts, returns false', async () => {
    const store = useFlowStore()
    store.$patch({ nodes: [boundaryWithZone('PUBLIC')], defaultBoundaryId: 'root' })
    updateBoundaryNodeMock.mockResolvedValue(null)

    const ok = await store.updateNode({ nodeId: 'b1', updates: { data: { zone: 'RESTRICTED' } } })

    expect(ok).toBe(false)
    expect((store.nodes.find((n: any) => n.id === 'b1') as any).data.zone).toBe('PUBLIC')
  })

  it('component save throws → node reverts to server truth, returns false', async () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [{ id: 'c1', type: 'COMPONENT', position: { x: 0, y: 0 }, parentNode: '', data: { label: 'C', description: 'old' } }] as any,
      defaultBoundaryId: 'root',
    })
    updateComponentMock.mockRejectedValue(new Error('network down'))

    const ok = await store.updateNode({ nodeId: 'c1', updates: { data: { description: 'new' } } })

    expect(ok).toBe(false)
    expect((store.nodes.find((n: any) => n.id === 'c1') as any).data.description).toBe('old')
  })

  it('default-boundary save throws → defaultBoundary.value restored (ref reassign, no splice)', async () => {
    const store = useFlowStore()
    const root = { id: 'root', type: 'BOUNDARY', position: { x: 0, y: 0 }, width: 10, height: 10, parentNode: '', data: { label: 'root', zone: 'PUBLIC', conduits: [] } }
    store.$patch({ nodes: [], defaultBoundaryId: 'root', defaultBoundary: root as any })
    updateBoundaryNodeMock.mockRejectedValue(new Error('network down'))

    const ok = await store.updateNode({ nodeId: 'root', updates: { data: { zone: 'RESTRICTED' } } })

    expect(ok).toBe(false)
    expect((store.defaultBoundary as any).data.zone).toBe('PUBLIC')
  })

  it('node concurrently deleted while the save is in flight → revert skipped, node not resurrected', async () => {
    const store = useFlowStore()
    store.$patch({ nodes: [boundaryWithZone('PUBLIC')], defaultBoundaryId: 'root' })
    // Simulate another op removing the node during the in-flight mutation, then the save fails.
    updateBoundaryNodeMock.mockImplementation(async () => {
      store.$patch({ nodes: [] as any })
      throw new Error('network down')
    })

    const ok = await store.updateNode({ nodeId: 'b1', updates: { data: { zone: 'RESTRICTED' } } })

    expect(ok).toBe(false)
    expect(store.nodes.find((n: any) => n.id === 'b1')).toBeUndefined()
    expect(store.nodes.length).toBe(0)
  })

  it('a failed save never mutates peer boundaries (syncPeerConduits runs only on success)', async () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [
        { id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, width: 10, height: 10, parentNode: '', data: { label: 'B-one', conduits: [] } },
        { id: 'p1', type: 'BOUNDARY', position: { x: 0, y: 0 }, width: 10, height: 10, parentNode: '', data: { label: 'Peer', conduits: [] } },
      ] as any,
      defaultBoundaryId: 'root',
    })
    updateBoundaryNodeMock.mockRejectedValue(new Error('network down'))

    const ok = await store.updateNode({
      nodeId: 'b1',
      updates: { data: { conduits: [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'card flow' }] } },
    })

    expect(ok).toBe(false)
    // Peer untouched (no mirrored inbound conduit) and b1 reverted to its empty-conduit baseline.
    expect((store.nodes.find((n: any) => n.id === 'p1') as any).data.conduits).toEqual([])
    expect((store.nodes.find((n: any) => n.id === 'b1') as any).data.conduits).toEqual([])
  })
})

describe('flowStore — peer conduit mirror (no reload needed)', () => {
  // Two boundaries: b1 (the one being saved) and p1 (the peer). Adding an OUTBOUND conduit b1→p1 should
  // surface as an INBOUND conduit on p1 in-memory, so p1's settings show it without a full reload.
  const twoBoundaries = (store: any, b1Conduits: any[], p1Conduits: any[]) =>
    store.$patch({
      nodes: [
        { id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, width: 10, height: 10, parentNode: '', data: { label: 'B-one', conduits: b1Conduits } },
        { id: 'p1', type: 'BOUNDARY', position: { x: 0, y: 0 }, width: 10, height: 10, parentNode: '', data: { label: 'Peer', conduits: p1Conduits } },
      ],
      defaultBoundaryId: 'root',
    })

  it('mirrors an added outbound conduit as an inbound conduit on the peer', async () => {
    const store = useFlowStore()
    twoBoundaries(store, [], [])
    updateBoundaryNodeMock.mockResolvedValue(serverBoundary({
      id: 'b1', name: 'B-one',
      conduits: [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'card flow', peerName: 'Peer' }],
    }))

    await store.updateNode({
      nodeId: 'b1',
      updates: { data: { conduits: [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'card flow' }] } },
    })

    const peer: any = store.nodes.find((n: any) => n.id === 'p1')
    expect(peer.data.conduits).toEqual([
      { peerId: 'b1', peerName: 'B-one', direction: 'INBOUND', justification: 'card flow', controlRefs: undefined },
    ])
  })

  it('removes the mirror on the peer when the conduit is removed', async () => {
    const store = useFlowStore()
    // p1 already carries the inbound mirror; b1 had the outbound, now removed (server returns none).
    twoBoundaries(store, [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'x' }], [{ peerId: 'b1', direction: 'INBOUND', justification: 'x', peerName: 'B-one' }])
    updateBoundaryNodeMock.mockResolvedValue(serverBoundary({ id: 'b1', name: 'B-one', conduits: [] }))

    await store.updateNode({ nodeId: 'b1', updates: { data: { conduits: [] } } })

    const peer: any = store.nodes.find((n: any) => n.id === 'p1')
    expect(peer.data.conduits).toEqual([])
  })

  it('leaves peers untouched when a zone-only save produces no conduit delta', async () => {
    const store = useFlowStore()
    const shared = [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'x', peerName: 'Peer' }]
    twoBoundaries(store, shared, [{ peerId: 'b1', direction: 'INBOUND', justification: 'x', peerName: 'B-one' }])
    updateBoundaryNodeMock.mockResolvedValue(serverBoundary({ id: 'b1', name: 'B-one', zone: 'RESTRICTED', conduits: shared }))

    await store.updateNode({ nodeId: 'b1', updates: { data: { zone: 'RESTRICTED' } } })

    const peer: any = store.nodes.find((n: any) => n.id === 'p1')
    expect(peer.data.conduits).toEqual([{ peerId: 'b1', direction: 'INBOUND', justification: 'x', peerName: 'B-one' }])
  })
})

describe('flowStore — zoning getters', () => {
  it('boundaryById, allBoundaries, and effectiveZone resolve from store state', () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [
        { id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, parentNode: '', data: { zone: 'RESTRICTED' } },
        { id: 'c1', type: 'COMPONENT', position: { x: 0, y: 0 }, data: {} },
      ] as any,
      defaultBoundaryId: 'root',
    })

    expect(store.boundaryById('b1')?.id).toBe('b1')
    expect(store.allBoundaries().map((b: any) => b.id)).toEqual(['b1'])
    expect(store.effectiveZone('b1')).toEqual({ zone: 'RESTRICTED', source: 'declared' })
  })
})
