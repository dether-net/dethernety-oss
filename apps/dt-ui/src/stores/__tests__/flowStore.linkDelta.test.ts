/**
 * The baseline the store hands the writer, and when it is read.
 *
 * An association is written as a delta against what this client believed the list to be before the
 * edit. That makes the baseline load-bearing in a way that fails silently: if it is read AFTER the
 * edit has been applied, baseline and current are equal, the delta is empty, and the attachment is
 * never written — while every assertion about the element handed to the writer stays true, because the
 * element does carry the new list.
 *
 * So these assert the BASELINE and the OPERATIONS, which is the pair that no other test in the tree
 * covers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const updateComponentMock = vi.fn()
const updateDataFlowMock = vi.fn()
const updateBoundaryNodeMock = vi.fn()

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
  useFlowStore = (await import('../flowStore')).useFlowStore
})

const componentNode = () => ({
  id: 'c1', type: 'PROCESS', position: { x: 1, y: 2 }, parentNode: 'b1',
  data: { label: 'C', description: 'd', controls: ['ctl-1'], dataItems: ['di-1'] },
})
const flowEdge = () => ({
  id: 'f1', source: 'A', target: 'B', label: 'F',
  data: { description: 'd', controls: ['ctl-1'], dataItems: [] },
})
const serverComponent = (over: any = {}) => ({
  id: 'c1', name: 'C', type: 'PROCESS', description: 'd', positionX: 1, positionY: 2,
  parentBoundary: [{ id: 'b1' }], controls: [{ id: 'ctl-1' }], dataItems: [{ id: 'di-1' }], ...over,
})
const serverDataFlow = (over: any = {}) => ({
  id: 'f1', name: 'F', description: 'd', source: { id: 'A' }, target: { id: 'B' },
  sourceHandle: null, targetHandle: null, controls: [{ id: 'ctl-1' }], dataItems: [], ...over,
})

const seedNode = (store: any) => {
  store.$patch({ nodes: [componentNode()], defaultBoundaryId: 'root' })
  updateComponentMock.mockResolvedValue(serverComponent())
}
const seedEdge = (store: any) => {
  store.$patch({ edges: [flowEdge()], defaultBoundaryId: 'root' })
  updateDataFlowMock.mockResolvedValue(serverDataFlow())
}

const sentNode = () => updateComponentMock.mock.calls.at(-1)![0]
const sentEdge = () => updateDataFlowMock.mock.calls.at(-1)![0]

describe('the baseline is read before the edit is applied', () => {
  it('hands the writer the PRE-edit control list, not the one being saved', async () => {
    const store = useFlowStore()
    seedNode(store)

    await store.updateNode({ nodeId: 'c1', updates: { data: { controls: ['ctl-1', 'ctl-2'] } } })

    // The element carries the new list; the baseline carries the old one. A baseline read after the
    // merge would make these two equal, which is the whole failure mode.
    expect(sentNode().updatedNode.data.controls).toEqual(['ctl-1', 'ctl-2'])
    expect(sentNode().baselineLinks.controls).toEqual(['ctl-1'])
  })

  it('hands the writer a COPY, so the merge cannot rewrite it underneath', async () => {
    const store = useFlowStore()
    seedNode(store)

    await store.updateNode({ nodeId: 'c1', updates: { data: { controls: ['ctl-2'] } } })

    expect(sentNode().baselineLinks.controls).toEqual(['ctl-1'])
    expect(sentNode().baselineLinks.controls).not.toBe(sentNode().updatedNode.data.controls)
  })

  it('carries both lists independently', async () => {
    const store = useFlowStore()
    seedNode(store)

    await store.updateNode({ nodeId: 'c1', updates: { data: { dataItems: ['di-1', 'di-2'] } } })

    expect(sentNode().baselineLinks).toEqual({ controls: ['ctl-1'], dataItems: ['di-1'] })
  })

  it('reports no baseline for a list the element never held, rather than an empty one', async () => {
    const store = useFlowStore()
    store.$patch({ nodes: [{ ...componentNode(), data: { label: 'C' } }] as any, defaultBoundaryId: 'root' })
    updateComponentMock.mockResolvedValue(serverComponent())

    await store.updateNode({ nodeId: 'c1', updates: { data: { controls: ['ctl-1'] } } })

    expect(sentNode().baselineLinks.controls).toBeUndefined()
  })

  it('does the same on the data-flow path', async () => {
    const store = useFlowStore()
    seedEdge(store)

    await store.updateDataFlow({ edgeId: 'f1', updates: { data: { controls: ['ctl-1', 'ctl-2'] } } })

    expect(sentEdge().edge.data.controls).toEqual(['ctl-1', 'ctl-2'])
    expect(sentEdge().baselineLinks.controls).toEqual(['ctl-1'])
  })

  it('threads it beside the conduit baseline on a boundary, not instead of it', async () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [{ id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, parentNode: '',
        data: { label: 'B', controls: ['ctl-1'], conduits: [{ peerId: 'p1', direction: 'OUTBOUND' }] } }] as any,
      defaultBoundaryId: 'root',
    })
    updateBoundaryNodeMock.mockResolvedValue({
      id: 'b1', name: 'B', description: '', controls: [], dataItems: [], parentBoundary: [],
      zone: null, domains: [], planes: [], conduits: [], positionX: 0, positionY: 0,
    })

    await store.updateNode({ nodeId: 'b1', updates: { data: { controls: ['ctl-2'] } } })

    const arg = updateBoundaryNodeMock.mock.calls.at(-1)![0]
    expect(arg.baselineLinks.controls).toEqual(['ctl-1'])
    expect(arg.baselineConduits).toEqual([{ peerId: 'p1', direction: 'OUTBOUND' }])
  })
})

// Removing the panel's out-of-band write left the store as the only thing that renders an association
// change. On the node path the merge already did that; on the edge path nothing did, because the writer
// was handed a clone and the live edge was untouched until the server answered.
describe('a data-flow save is optimistic, and comes back off if it fails', () => {
  it('shows the edit on the live edge before the save resolves', async () => {
    const store = useFlowStore()
    seedEdge(store)
    let resolveSave: (v: any) => void = () => {}
    updateDataFlowMock.mockReturnValue(new Promise(r => { resolveSave = r }))

    const pending = store.updateDataFlow({ edgeId: 'f1', updates: { data: { controls: ['ctl-1', 'ctl-2'] } } })

    expect((store.edges[0] as any).data.controls).toEqual(['ctl-1', 'ctl-2'])

    resolveSave(serverDataFlow({ controls: [{ id: 'ctl-1' }, { id: 'ctl-2' }] }))
    await pending
  })

  it('takes it back off when the save throws', async () => {
    const store = useFlowStore()
    seedEdge(store)
    updateDataFlowMock.mockRejectedValue(new Error('network down'))

    const ok = await store.updateDataFlow({ edgeId: 'f1', updates: { data: { controls: ['ctl-1', 'ctl-2'] } } })

    expect(ok).toBe(false)
    expect((store.edges[0] as any).data.controls).toEqual(['ctl-1'])
  })

  it('takes it back off when the save resolves with nothing', async () => {
    const store = useFlowStore()
    seedEdge(store)
    updateDataFlowMock.mockResolvedValue(null)

    const ok = await store.updateDataFlow({ edgeId: 'f1', updates: { data: { controls: ['ctl-2'] } } })

    expect(ok).toBe(false)
    expect((store.edges[0] as any).data.controls).toEqual(['ctl-1'])
  })

  it('re-pins a selected edge to the reverted state, not the optimistic one', async () => {
    const store = useFlowStore()
    seedEdge(store)
    store.setSelectedItem({ item: store.edges[0] })
    updateDataFlowMock.mockRejectedValue(new Error('network down'))

    await store.updateDataFlow({ edgeId: 'f1', updates: { data: { controls: ['ctl-2'] } } })

    expect((store.selectedItem as any).data.controls).toEqual(['ctl-1'])
  })

  it('does not resurrect an edge deleted while the save was in flight', async () => {
    const store = useFlowStore()
    seedEdge(store)
    updateDataFlowMock.mockImplementation(async () => {
      store.$patch({ edges: [] })
      throw new Error('network down')
    })

    const ok = await store.updateDataFlow({ edgeId: 'f1', updates: { data: { controls: ['ctl-2'] } } })

    expect(ok).toBe(false)
    expect(store.edges).toHaveLength(0)
  })
})
