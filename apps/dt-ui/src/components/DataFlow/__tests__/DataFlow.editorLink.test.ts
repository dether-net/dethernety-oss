// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

// `/dataflow?id=<model>&element=<id>&tab=<name>`: once the model has loaded and been framed, the editor selects the
// element (in the store, which the settings panel reads, and in vue-flow, which draws the selection), centres it, and
// with a tab opens the settings panel on that tab. Anything it cannot resolve in the loaded model does nothing.

const flow = vi.hoisted(() => ({
  onInit: null as null | (() => void),
  fitView: vi.fn(),
  addSelectedNodes: vi.fn(),
  addSelectedEdges: vi.fn(),
}))
const query = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

const { nodes, edges, ROOT, BackgroundStub } = vi.hoisted(() => {
  const nodes = [
    { id: 'web', type: 'PROCESS', position: { x: 0, y: 0 }, data: { label: 'web' }, parentNode: 'dmz' },
    { id: 'db', type: 'STORE', position: { x: 0, y: 0 }, data: { label: 'db' }, parentNode: 'dmz' },
    { id: 'dmz', type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { label: 'dmz' } },
  ]
  const edges = [{ id: 'f1', source: 'web', target: 'db', data: {} }]
  const ROOT = { id: 'root', type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { label: 'root' } }
  const BackgroundStub = {
    name: 'DataFlowBackground',
    props: ['openSettings', 'modelId', 'modelName', 'freshlyCreatedId', 'requestedTab'],
    emits: ['requested-tab-applied', 'update:open-settings', 'open-model'],
    template: '<div class="background-stub" />',
  }
  return { nodes, edges, ROOT, BackgroundStub }
})

vi.mock('@vue-flow/core', async () => {
  const { ref: vref } = await import('vue')
  const noop = () => {}
  return {
    VueFlow: { name: 'VueFlow', template: '<div class="vue-flow-stub"><slot /></div>' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    getRectOfNodes: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    useVueFlow: () => ({
      onInit: (cb: () => void) => { flow.onInit = cb },
      onNodeDrag: noop, onNodeDragStop: noop, onConnect: noop, onNodesChange: noop, onEdgesChange: noop,
      onNodeDoubleClick: noop, onEdgeDoubleClick: noop,
      applyNodeChanges: noop, applyEdgeChanges: noop, updateNode: noop,
      getIntersectingNodes: () => [],
      getNodes: vref(nodes),
      getEdges: vref(edges),
      addSelectedNodes: flow.addSelectedNodes,
      addSelectedEdges: flow.addSelectedEdges,
      screenToFlowCoordinate: (p: unknown) => p,
      fitView: flow.fitView,
      onDragOver: noop, onDrop: noop, onDragLeave: noop,
    }),
  }
})
vi.mock('@vue-flow/controls', () => ({ Controls: { name: 'Controls', template: '<div />' } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: query.value }),
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))
vi.mock('@/utils/dataFlowUtils', async () => {
  const { ref: vref } = await import('vue')
  return {
    getId: () => 'new-id',
    getNewName: () => 'New',
    nodeTypes: {},
    useDragAndDrop: () => ({ onDragOver: vi.fn(), onDrop: vi.fn(), onDragLeave: vi.fn(), isDragOver: vref(false), draggedType: vref(null) }),
  }
})

const store = reactive<Record<string, any>>({})
const resetStore = (loaded: boolean | 'overtaken') => {
  Object.assign(store, {
    nodes: [],
    edges: [],
    defaultBoundary: null,
    defaultBoundaryId: undefined,
    modelId: undefined,
    selectedItem: null,
    editMode: false,
    fetchMitreAttackTactics: vi.fn(),
    getModelData: vi.fn().mockResolvedValue({ name: 'Model' }),
    setModelId: vi.fn(({ newModelId }: { newModelId: string }) => { store.modelId = newModelId }),
    fetchControls: vi.fn(),
    resetStore: vi.fn(),
    setSelectedItem: vi.fn(({ item }: { item: unknown }) => { store.selectedItem = item }),
    fetchData: vi.fn(async ({ model }: { model: string }) => {
      store.modelId = model
      if (loaded === 'overtaken') {
        // the store still holds the element (as another load's data could), so only the load's own result tells
        store.nodes = nodes
        store.edges = edges
        return null
      }
      if (!loaded) {
        // a failed load: the store keeps the last root boundary object but has no id for it
        store.defaultBoundary = ROOT
        return null
      }
      store.nodes = nodes
      store.edges = edges
      store.defaultBoundary = ROOT
      store.defaultBoundaryId = 'root'
      return { components: [], boundaries: [], dataFlows: [] }
    }),
  })
}
vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => store, crownJewelClass: () => '' }))

vi.mock('@/components/DataFlow/DataFlowBackground.vue', () => ({ default: BackgroundStub }))
vi.mock('@/components/DataFlow/Nodes/ProcessNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/StoreNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/ExtEntNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/BoundaryNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/General/ConfirmDeleteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/DataFlow/ConfirmEdgeRerouteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/Model/ModelDialog.vue', () => ({ default: { template: '<div />' } }))

import DataFlow from '../DataFlow.vue'

const open = async (q: Record<string, unknown>, loaded: boolean | 'overtaken' = true) => {
  resetStore(loaded)
  query.value = { id: 'm1', ...q }
  const w = mount(DataFlow, {
    global: { stubs: { teleport: true, 'v-snackbar': true, 'v-progress-circular': true } },
  })
  flow.onInit?.()
  await flushPromises()
  vi.advanceTimersByTime(100)
  await flushPromises()
  return w
}
const background = (w: ReturnType<typeof mount>) => w.findComponent(BackgroundStub)

describe('DataFlow — an editor link', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    flow.onInit = null
    flow.fitView.mockClear()
    flow.addSelectedNodes.mockClear()
    flow.addSelectedEdges.mockClear()
  })
  afterEach(() => { vi.useRealTimers() })

  it('selects and centres an element after the model is framed, with the settings closed', async () => {
    const w = await open({ element: 'web' })
    expect(store.setSelectedItem).toHaveBeenCalledWith({ item: nodes[0] })
    expect(flow.addSelectedNodes).toHaveBeenCalledWith([nodes[0]])
    expect(flow.fitView.mock.calls).toEqual([[], [{ nodes: ['web'], padding: 0.4, maxZoom: 1.5 }]])
    expect(background(w).props('openSettings')).toBe(false)
    expect(background(w).props('requestedTab')).toBeNull()
  })

  it('selects a data flow and centres its two endpoints', async () => {
    await open({ element: 'f1' })
    expect(flow.addSelectedEdges).toHaveBeenCalledWith([edges[0]])
    expect(flow.addSelectedNodes).not.toHaveBeenCalled()
    expect(flow.fitView).toHaveBeenLastCalledWith({ nodes: ['web', 'db'], padding: 0.4, maxZoom: 1.5 })
  })

  it('selects the default boundary as a pane click does: in the store only, with the whole-model frame', async () => {
    await open({ element: 'root' })
    expect(store.setSelectedItem).toHaveBeenCalledWith({ item: ROOT })
    expect(flow.addSelectedNodes).not.toHaveBeenCalled()
    expect(flow.fitView.mock.calls).toEqual([[]])
  })

  it('opens the settings on the requested tab', async () => {
    const w = await open({ element: 'web', tab: 'exposures' })
    expect(background(w).props('openSettings')).toBe(true)
    expect(background(w).props('requestedTab')).toBe('exposures')
    // the panel reports the request consumed, and DataFlow clears it
    await background(w).vm.$emit('requested-tab-applied')
    expect(background(w).props('requestedTab')).toBeNull()
  })

  it('only selects for an unknown tab', async () => {
    const w = await open({ element: 'web', tab: 'history' })
    expect(store.setSelectedItem).toHaveBeenCalledWith({ item: nodes[0] })
    expect(background(w).props('openSettings')).toBe(false)
    expect(background(w).props('requestedTab')).toBeNull()
  })

  it('only selects for a tab the element does not show (Zoning on a component)', async () => {
    const w = await open({ element: 'web', tab: 'zoning' })
    expect(store.setSelectedItem).toHaveBeenCalledWith({ item: nodes[0] })
    expect(background(w).props('openSettings')).toBe(false)
  })

  it('selects nothing for an element that is not in the loaded model, and says so', async () => {
    const w = await open({ element: 'elsewhere', tab: 'general' })
    expect(store.setSelectedItem).not.toHaveBeenCalled()
    expect(flow.addSelectedNodes).not.toHaveBeenCalled()
    expect(flow.fitView.mock.calls).toEqual([[]])
    expect(background(w).props('openSettings')).toBe(false)
    expect((w.vm as any).snackBar).toEqual({ show: true, message: 'The linked element is not in this model.', color: 'warning' })
  })

  it('says nothing when the link names no element, or only selects', async () => {
    expect(((await open({})).vm as any).snackBar.show).toBe(false)
    expect(((await open({ element: 'web', tab: 'history' })).vm as any).snackBar.show).toBe(false)
  })

  it('does nothing after a failed load, even for the root boundary the store still holds, and says nothing', async () => {
    const w = await open({ element: 'root', tab: 'general' }, false)
    expect(store.setSelectedItem).not.toHaveBeenCalled()
    // a failed load is not a missing element: no warning
    expect((w.vm as any).snackBar.show).toBe(false)
  })

  it('does nothing when another model is opened after the load but before the canvas settles', async () => {
    resetStore(true)
    query.value = { id: 'm1', element: 'web' }
    const w = mount(DataFlow, { global: { stubs: { teleport: true, 'v-snackbar': true, 'v-progress-circular': true } } })
    flow.onInit?.()
    await flushPromises() // m1's load resolved; its settle timer is pending
    await background(w).vm.$emit('open-model', 'm2') // the store now holds m2, which has an element of the same id
    await flushPromises()
    vi.advanceTimersByTime(100)
    await flushPromises()
    expect(store.modelId).toBe('m2')
    expect(store.setSelectedItem).not.toHaveBeenCalled()
  })

  it('does nothing when a newer load overtook this one, and does not keep the link for later', async () => {
    const w = await open({ element: 'web' }, 'overtaken')
    expect(store.setSelectedItem).not.toHaveBeenCalled()
    // the user comes back to the linked model: the link was one attempt, so it does not apply now
    resetStore(true)
    await background(w).vm.$emit('open-model', 'm1')
    await flushPromises()
    vi.advanceTimersByTime(100)
    await flushPromises()
    expect(store.setSelectedItem).not.toHaveBeenCalled()
  })

  it('frames the model as before when the link names no element', async () => {
    const w = await open({})
    expect(store.setSelectedItem).not.toHaveBeenCalled()
    expect(flow.fitView.mock.calls).toEqual([[]])
    expect(background(w).props('openSettings')).toBe(false)
  })

  it('is applied once: reopening the linked model does not apply it again', async () => {
    const w = await open({ element: 'web' })
    store.setSelectedItem.mockClear()
    await background(w).vm.$emit('open-model', 'm1')
    await flushPromises()
    vi.advanceTimersByTime(100)
    await flushPromises()
    expect(store.setSelectedItem).not.toHaveBeenCalled()
  })
})
