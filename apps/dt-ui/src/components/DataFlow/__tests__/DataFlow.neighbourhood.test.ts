// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

// Selecting a component or a data flow brings its neighbourhood forward: the canvas root takes `dt-flow-focus` (which
// dims the rest) and a stylesheet of its own names what stays lit. A selection with no neighbourhood, and leaving the
// editor, take both away. The neighbourhood itself is tested in utils/__tests__/flowNeighbourhood.test.ts.

vi.mock('@vue-flow/core', async () => {
  const { ref: vref } = await import('vue')
  const noop = () => {}
  return {
    VueFlow: { name: 'VueFlow', template: '<div class="vue-flow-stub"><slot /></div>' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    getRectOfNodes: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    useVueFlow: () => ({
      onInit: noop, onNodeDrag: noop, onNodeDragStop: noop, onConnect: noop, onNodesChange: noop, onEdgesChange: noop,
      onNodeDoubleClick: noop, onEdgeDoubleClick: noop,
      applyNodeChanges: noop, applyEdgeChanges: noop, updateNode: noop,
      getIntersectingNodes: () => [],
      getNodes: vref([]),
      getEdges: vref([]),
      addSelectedNodes: noop,
      addSelectedEdges: noop,
      screenToFlowCoordinate: (p: unknown) => p,
      fitView: noop,
    }),
  }
})
vi.mock('@vue-flow/controls', () => ({ Controls: { name: 'Controls', template: '<div />' } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
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
vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => store, crownJewelClass: () => '' }))

vi.mock('@/components/DataFlow/DataFlowBackground.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/ProcessNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/StoreNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/ExtEntNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/BoundaryNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/General/ConfirmDeleteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/DataFlow/ConfirmEdgeRerouteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/Model/ModelDialog.vue', () => ({ default: { template: '<div />' } }))

import DataFlow from '../DataFlow.vue'

const nodes = [
  { id: 'web', type: 'PROCESS', position: { x: 0, y: 0 }, data: { label: 'web' } },
  { id: 'db', type: 'STORE', position: { x: 0, y: 0 }, data: { label: 'db' } },
  { id: 'dmz', type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { label: 'dmz' } },
]
const edges = [{ id: 'f1', source: 'web', target: 'db', data: {} }]

const focusSheets = () => document.head.querySelectorAll('style[data-dt-flow-focus]')

const open = async () => {
  Object.assign(store, {
    nodes, edges, selectedItem: null, editMode: false, defaultBoundary: null, defaultBoundaryId: undefined,
    fetchMitreAttackTactics: vi.fn(),
    getModelData: vi.fn().mockResolvedValue({ name: 'Model' }),
    setSelectedItem: vi.fn(({ item }: { item: unknown }) => { store.selectedItem = item }),
    resetStore: vi.fn(),
  })
  const w = mount(DataFlow, { global: { stubs: { teleport: true, 'v-snackbar': true, 'v-progress-circular': true } } })
  await flushPromises()
  return w
}

describe('DataFlow — the selection\'s neighbourhood', () => {
  beforeEach(() => { focusSheets().forEach(s => s.remove()) })
  afterEach(() => { focusSheets().forEach(s => s.remove()) })

  it('adds nothing while nothing is selected', async () => {
    const w = await open()
    expect(w.find('.vue-flow-stub').classes()).not.toContain('dt-flow-focus')
    expect(focusSheets()).toHaveLength(0)
    w.unmount()
  })

  it('dims the canvas and lights a selected component\'s neighbourhood', async () => {
    const w = await open()
    store.selectedItem = nodes[0]
    await nextTick()
    expect(w.find('.vue-flow-stub').classes()).toContain('dt-flow-focus')
    expect(focusSheets()).toHaveLength(1)
    expect(focusSheets()[0].textContent).toContain('[data-id="db"]')
    expect(focusSheets()[0].textContent).toContain('[data-id="f1"]')
    w.unmount()
  })

  it('keeps one stylesheet as the selection moves, and drops it for a selection with no neighbourhood', async () => {
    const w = await open()
    store.selectedItem = nodes[0]
    await nextTick()
    store.selectedItem = edges[0]
    await nextTick()
    expect(focusSheets()).toHaveLength(1)
    store.selectedItem = nodes[2] // a boundary
    await nextTick()
    expect(w.find('.vue-flow-stub').classes()).not.toContain('dt-flow-focus')
    expect(focusSheets()).toHaveLength(0)
    w.unmount()
  })

  it('lets go of the focus when the selected element leaves the canvas', async () => {
    const w = await open()
    store.selectedItem = edges[0]
    await nextTick()
    store.edges = []
    await nextTick()
    expect(focusSheets()).toHaveLength(0)
    w.unmount()
  })

  it('removes its stylesheet when the editor unmounts', async () => {
    const w = await open()
    store.selectedItem = nodes[0]
    await nextTick()
    w.unmount()
    expect(focusSheets()).toHaveLength(0)
  })

  it('defines the two direction arrowheads the flow styles point at', async () => {
    const w = await open()
    expect(w.find('marker#dt-flow-arrow-in').exists()).toBe(true)
    expect(w.find('marker#dt-flow-arrow-out').exists()).toBe(true)
    w.unmount()
  })
})
