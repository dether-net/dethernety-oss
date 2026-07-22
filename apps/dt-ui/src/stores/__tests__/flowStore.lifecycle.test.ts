/**
 * flowStore edge-update rollback + temp-node deferred-queue correctness.
 *
 * Guarantees under test:
 *  - updateDataFlow hands dt-core a CLONE (dt-core deep-merges the edge in place
 *    then rethrows on failure), so a failed edge save never diverges the canvas;
 *    it returns false instead of throwing.
 *  - isPendingNode is pendingNodes-only (no `startsWith('temp-')`), and updateNode
 *    translates a resolved temp id to its real node via tempNodeMapping.
 *  - applyDeferredUpdates loop-flushes updates queued during its await window and
 *    retires pendingNodes atomically; a failed deferred write is surfaced, not
 *    swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const handleErrorMock = vi.fn()
const updateComponentMock = vi.fn()
const updateBoundaryNodeMock = vi.fn()
const updateDataFlowMock = vi.fn()

// Real recursive deepMerge (mirrors dt-utils): nested objects merge, arrays replace.
class DtUtilsStub {
  handleError = handleErrorMock
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
  DtDataflow: class { updateDataFlow = updateDataFlowMock },
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

afterEach(() => {
  vi.useRealTimers()
})

const componentNode = (id: string, dataOver: any = {}) => ({
  id, type: 'COMPONENT', position: { x: 0, y: 0 }, parentNode: '',
  data: { label: id, description: '', ...dataOver },
})
const serverComponent = (id: string, over: any = {}) => ({
  id, name: id, type: 'COMPONENT', description: '', controls: [], dataItems: [],
  positionX: 0, positionY: 0, parentBoundary: null, ...over,
})
const flowEdge = (id: string, over: any = {}) => ({
  id, source: 'A', target: 'B', sourceHandle: 'sh', targetHandle: 'th',
  label: 'orig', data: { description: 'd', controls: [], dataItems: [] }, markerEnd: 'arrowclosed', ...over,
})
const serverDataFlow = (id: string, over: any = {}) => ({
  id, name: 'L2', description: 'd2', controls: [], dataItems: [],
  source: { id: 's2' }, target: { id: 't2' }, sourceHandle: 'sh2', targetHandle: 'th2', ...over,
})

describe('flowStore — updateDataFlow edge rollback / no divergence', () => {
  it('a rejecting save leaves the live edge unchanged (clone protected it) and returns false', async () => {
    const store = useFlowStore()
    store.$patch({ edges: [flowEdge('f1', { label: 'orig', source: 'A', target: 'B' })] as any })
    const liveEdge = store.edges[0]
    // Simulate dt-core: deep-merge the passed edge IN PLACE, then rethrow.
    updateDataFlowMock.mockImplementation(async ({ edge }: any) => {
      Object.assign(edge, { label: 'new', source: 'C', target: 'D' })
      throw new Error('network down')
    })

    const ok = await store.updateDataFlow({ edgeId: 'f1', updates: { label: 'new', source: 'C' } })

    expect(ok).toBe(false)
    const after: any = store.edges.find((e: any) => e.id === 'f1')
    expect(after.label).toBe('orig')
    expect(after.source).toBe('A')
    expect(after.target).toBe('B')
    // dt-core was handed a detached clone, not the live reactive edge.
    expect(updateDataFlowMock.mock.calls[0][0].edge).not.toBe(liveEdge)
  })

  it('a successful save rebuilds the edge from server truth and returns true', async () => {
    const store = useFlowStore()
    store.$patch({ edges: [flowEdge('f1', { label: 'orig' })] as any })
    updateDataFlowMock.mockResolvedValue(
      serverDataFlow('f1', { name: 'renamed', source: { id: 'X' }, target: { id: 'Y' } }),
    )

    const ok = await store.updateDataFlow({ edgeId: 'f1', updates: { label: 'renamed' } })

    expect(ok).toBe(true)
    const after: any = store.edges.find((e: any) => e.id === 'f1')
    expect(after.label).toBe('renamed')
    expect(after.source).toBe('X')
    expect(after.target).toBe('Y')
  })
})

describe('flowStore — isPendingNode + temp->real translation', () => {
  it('isPendingNode no longer treats a bare temp- id as pending forever', () => {
    const store = useFlowStore()
    expect(store.isPendingNode('temp-123')).toBe(false)
    store.pendingNodes.add('temp-123')
    expect(store.isPendingNode('temp-123')).toBe(true)
  })

  it('updateNode translates a mapped temp id to the real node instead of re-queueing', async () => {
    const store = useFlowStore()
    store.$patch({ nodes: [componentNode('real-1')] as any })
    store.tempNodeMapping.set('temp-1', 'real-1') // create resolved; temp no longer pending
    updateComponentMock.mockResolvedValue(serverComponent('real-1', { name: 'updated' }))

    const ok = await store.updateNode({ nodeId: 'temp-1', updates: { data: { description: 'x' } } })

    expect(ok).toBe(true)
    expect(updateComponentMock).toHaveBeenCalledTimes(1)
    expect(updateComponentMock.mock.calls[0][0].updatedNode.id).toBe('real-1')
  })
})

describe('flowStore — applyDeferredUpdates loop-flush + surfacing', () => {
  it('applies an update queued DURING the flush window and clears pending atomically', async () => {
    vi.useFakeTimers()
    const store = useFlowStore()
    store.$patch({ nodes: [componentNode('real-1')] as any })
    store.pendingNodes.add('temp-1')
    store.queueUpdateForTempNode('temp-1', { data: { description: 'first' } })

    // The first flush's network call queues a second update for the same temp id.
    updateComponentMock
      .mockImplementationOnce(async () => {
        store.queueUpdateForTempNode('temp-1', { data: { crownJewel: true } })
        return serverComponent('real-1')
      })
      .mockImplementation(async () => serverComponent('real-1'))

    const p = store.applyDeferredUpdates('temp-1', 'real-1')
    await vi.advanceTimersByTimeAsync(100)
    await p

    // Both batches flushed (initial + injected-during-await); pending retired.
    expect(updateComponentMock).toHaveBeenCalledTimes(2)
    expect(store.isPendingNode('temp-1')).toBe(false)
  })

  it('surfaces a failed deferred update via handleError instead of swallowing it', async () => {
    vi.useFakeTimers()
    const store = useFlowStore()
    store.$patch({ nodes: [componentNode('real-1')] as any })
    store.queueUpdateForTempNode('temp-1', { data: { description: 'x' } })
    updateComponentMock.mockResolvedValue(null) // dt-core returns falsy -> updateNode returns false

    const p = store.applyDeferredUpdates('temp-1', 'real-1')
    await vi.advanceTimersByTimeAsync(100)
    await p

    expect(handleErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'applyDeferredUpdates' }),
    )
  })
})
