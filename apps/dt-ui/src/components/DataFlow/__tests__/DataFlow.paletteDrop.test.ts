// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

// Dropping an element from the palette onto a locked canvas turns edit mode on, creates the element and says so;
// anything else dragged onto a locked canvas is refused; an unlocked canvas takes the drop with no message.

const dnd = vi.hoisted(() => ({
  onDragOver: vi.fn(),
  onDrop: vi.fn(),
  draggedType: null as null | { value: string | null },
}))

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
  dnd.draggedType = vref<string | null>(null)
  return {
    getId: () => 'new-id',
    getNewName: () => 'New',
    nodeTypes: { PROCESS: { width: 80, height: 80, displayName: 'Process' } },
    useDragAndDrop: () => ({
      onDragOver: dnd.onDragOver,
      onDrop: dnd.onDrop,
      onDragLeave: vi.fn(),
      isDragOver: vref(false),
      draggedType: dnd.draggedType,
    }),
  }
})

const store = reactive<Record<string, any>>({})
vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => store, crownJewelClass: () => '' }))

vi.mock('@/components/DataFlow/CanvasSearch.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/DataFlowBackground.vue', () => ({
  default: { template: '<div class="sidebar-container"><div class="palette-item" /></div>' },
}))
vi.mock('@/components/DataFlow/Nodes/ProcessNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/StoreNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/ExtEntNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/BoundaryNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/General/ConfirmDeleteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/DataFlow/ConfirmEdgeRerouteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/Model/ModelDialog.vue', () => ({ default: { template: '<div />' } }))

import DataFlow from '../DataFlow.vue'

const SnackbarStub = { name: 'VSnackbar', props: ['modelValue', 'color'], template: '<div class="snack"><slot /></div>' }

const open = async (editMode: boolean) => {
  Object.assign(store, {
    nodes: [], edges: [], selectedItem: null, editMode, defaultBoundary: null, defaultBoundaryId: undefined,
    fetchMitreAttackTactics: vi.fn(),
    getModelData: vi.fn().mockResolvedValue({ name: 'Model' }),
    setSelectedItem: vi.fn(),
    resetStore: vi.fn(),
  })
  const w = mount(DataFlow, { global: { stubs: { teleport: true, 'v-snackbar': SnackbarStub, 'v-progress-circular': true } } })
  await flushPromises()
  return w
}
const snack = (w: Awaited<ReturnType<typeof open>>) => w.findComponent(SnackbarStub)

describe('DataFlow — dropping from the palette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (dnd.draggedType) dnd.draggedType.value = null
  })

  it('accepts a palette drag over a locked canvas', async () => {
    const w = await open(false)
    dnd.draggedType!.value = 'PROCESS'
    await w.find('.vue-flow-stub').trigger('dragover')
    expect(dnd.onDragOver).toHaveBeenCalled()
  })

  it('refuses anything else dragged over a locked canvas', async () => {
    const w = await open(false)
    await w.find('.vue-flow-stub').trigger('dragover')
    expect(dnd.onDragOver).not.toHaveBeenCalled()
  })

  it('turns edit mode on for a palette drop on a locked canvas, creates the element and says so', async () => {
    const w = await open(false)
    dnd.draggedType!.value = 'PROCESS'
    await w.find('.data-flow-root').trigger('drop')
    await nextTick()
    expect(store.editMode).toBe(true)
    expect(dnd.onDrop).toHaveBeenCalledTimes(1)
    expect(snack(w).props('modelValue')).toBe(true)
    expect(snack(w).text()).toContain('Edit mode is on')
  })

  it('refuses anything else dropped on a locked canvas, and stays locked', async () => {
    const w = await open(false)
    await w.find('.data-flow-root').trigger('drop')
    await nextTick()
    expect(store.editMode).toBe(false)
    expect(dnd.onDrop).not.toHaveBeenCalled()
    expect(snack(w).props('modelValue')).toBe(false)
  })

  it('takes back a drag let go over the palette, locked or not', async () => {
    for (const editMode of [false, true]) {
      const w = await open(editMode)
      dnd.draggedType!.value = 'PROCESS'
      await w.find('.palette-item').trigger('drop')
      await nextTick()
      expect(store.editMode).toBe(editMode)
      expect(dnd.onDrop).not.toHaveBeenCalled()
      w.unmount()
    }
  })

  it('takes a drop on an unlocked canvas with no message', async () => {
    const w = await open(true)
    dnd.draggedType!.value = 'PROCESS'
    await w.find('.data-flow-root').trigger('drop')
    await nextTick()
    expect(dnd.onDrop).toHaveBeenCalledTimes(1)
    expect(snack(w).props('modelValue')).toBe(false)
  })
})
