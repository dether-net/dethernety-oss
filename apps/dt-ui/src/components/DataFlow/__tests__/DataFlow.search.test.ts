// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

// The editor's side of the canvas search: Ctrl/⌘F and the rail button open it (the shortcut stands down while typing or
// while a dialog or menu is open); its matches take the canvas over from the selection's neighbourhood while it has a
// query; a picked result is selected and framed the way an editor link is. CanvasSearch itself is tested on its own.

const flow = vi.hoisted(() => ({ fitView: vi.fn(), addSelectedNodes: vi.fn(), addSelectedEdges: vi.fn(), focusSearch: vi.fn() }))

const { nodes, edges, SearchStub, BackgroundStub } = vi.hoisted(() => {
  const nodes = [
    { id: 'web', type: 'PROCESS', position: { x: 0, y: 0 }, data: { label: 'web' } },
    { id: 'db', type: 'STORE', position: { x: 0, y: 0 }, data: { label: 'db' } },
  ]
  const edges = [{ id: 'f1', source: 'web', target: 'db', data: {} }]
  const SearchStub = {
    name: 'CanvasSearch',
    props: ['modelValue', 'nodes', 'edges', 'rootLabel'],
    emits: ['update:modelValue', 'matches', 'pick'],
    setup(_: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) {
      expose({ focus: () => flow.focusSearch() })
    },
    template: '<div class="search-stub canvas-search"><input class="search-input" /></div>',
  }
  const BackgroundStub = { name: 'DataFlowBackground', emits: ['open-search'], template: '<div />' }
  return { nodes, edges, SearchStub, BackgroundStub }
})

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
      getNodes: vref(nodes),
      getEdges: vref(edges),
      addSelectedNodes: flow.addSelectedNodes,
      addSelectedEdges: flow.addSelectedEdges,
      screenToFlowCoordinate: (p: unknown) => p,
      fitView: flow.fitView,
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

vi.mock('@/components/DataFlow/CanvasSearch.vue', () => ({ default: SearchStub }))
vi.mock('@/components/DataFlow/DataFlowBackground.vue', () => ({ default: BackgroundStub }))
vi.mock('@/components/DataFlow/Nodes/ProcessNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/StoreNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/ExtEntNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/Nodes/BoundaryNode.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/General/ConfirmDeleteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/DataFlow/ConfirmEdgeRerouteDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/Model/ModelDialog.vue', () => ({ default: { template: '<div />' } }))

import DataFlow from '../DataFlow.vue'

const focusSheet = () => document.head.querySelector('style[data-dt-flow-focus]')

const open = async () => {
  Object.assign(store, {
    nodes, edges, selectedItem: null, editMode: false,
    defaultBoundary: { id: 'root', type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    defaultBoundaryId: 'root',
    fetchMitreAttackTactics: vi.fn(),
    getModelData: vi.fn().mockResolvedValue({ name: 'Model' }),
    setSelectedItem: vi.fn(({ item }: { item: unknown }) => { store.selectedItem = item }),
    resetStore: vi.fn(),
  })
  const w = mount(DataFlow, {
    attachTo: document.body,
    global: { stubs: { teleport: true, 'v-snackbar': true, 'v-progress-circular': true } },
  })
  await flushPromises()
  return w
}
const search = (w: Awaited<ReturnType<typeof open>>) => w.findComponent(SearchStub)
const pressFind = (target: EventTarget = document.body, init: KeyboardEventInit = { key: 'f', metaKey: true }) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

describe('DataFlow — the canvas search', () => {
  let mounted: Awaited<ReturnType<typeof open>> | null = null
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => {
    mounted?.unmount()
    mounted = null
    document.querySelectorAll('.v-overlay--active, input.typing').forEach(el => el.remove())
  })

  it('hands the search the canvas and the default boundary\'s name', async () => {
    mounted = await open()
    expect(search(mounted).props()).toMatchObject({ modelValue: false, nodes, edges, rootLabel: 'Root' })
  })

  it('opens on ⌘F and on Ctrl+F, taking the key from the browser', async () => {
    mounted = await open()
    const e = pressFind()
    await nextTick()
    expect(e.defaultPrevented).toBe(true)
    expect(search(mounted).props('modelValue')).toBe(true)

    search(mounted).vm.$emit('update:modelValue', false)
    await nextTick()
    pressFind(document.body, { key: 'F', ctrlKey: true })
    await nextTick()
    expect(search(mounted).props('modelValue')).toBe(true)
  })

  it('opens from the rail button, and puts the cursor in the field', async () => {
    mounted = await open()
    mounted.findComponent(BackgroundStub).vm.$emit('open-search')
    await nextTick()
    await nextTick()
    expect(search(mounted).props('modelValue')).toBe(true)
    expect(flow.focusSearch).toHaveBeenCalled()
  })

  it('takes the cursor back to the field when the search is already open', async () => {
    mounted = await open()
    pressFind()
    await nextTick()
    await nextTick()
    flow.focusSearch.mockClear()
    const e = pressFind()
    await nextTick()
    await nextTick()
    expect(e.defaultPrevented).toBe(true)
    expect(flow.focusSearch).toHaveBeenCalledTimes(1)
  })

  it('keeps the shortcut inside the search\'s own field, though it is an input', async () => {
    mounted = await open()
    const input = mounted.find('.search-input').element
    expect(pressFind(input).defaultPrevented).toBe(true)
  })

  it('takes the F key by its position too, for a non-Latin layout', async () => {
    mounted = await open()
    expect(pressFind(document.body, { key: 'а', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(true)
  })

  it('goes by the letter on a remapped Latin layout: Dvorak\'s Ctrl+U sits where QWERTY has F, and stays Ctrl+U', async () => {
    mounted = await open()
    expect(pressFind(document.body, { key: 'u', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(pressFind(document.body, { key: 'f', code: 'KeyY', ctrlKey: true }).defaultPrevented).toBe(true)
  })

  it('leaves the key alone with other modifiers, while typing, and while a dialog or menu is open', async () => {
    mounted = await open()
    expect(pressFind(document.body, { key: 'f' }).defaultPrevented).toBe(false)
    expect(pressFind(document.body, { key: 'f', metaKey: true, shiftKey: true }).defaultPrevented).toBe(false)

    const input = document.createElement('input')
    input.className = 'typing'
    document.body.appendChild(input)
    expect(pressFind(input).defaultPrevented).toBe(false)

    const dialog = document.createElement('div')
    dialog.className = 'v-overlay v-overlay--active v-dialog'
    document.body.appendChild(dialog)
    expect(pressFind().defaultPrevented).toBe(false)
    await nextTick()
    expect(search(mounted).props('modelValue')).toBe(false)
  })

  it('is not held back by a tooltip or a snackbar', async () => {
    mounted = await open()
    for (const kind of ['v-tooltip', 'v-snackbar']) {
      const overlay = document.createElement('div')
      overlay.className = `v-overlay v-overlay--active ${kind}`
      document.body.appendChild(overlay)
    }
    expect(pressFind().defaultPrevented).toBe(true)
  })

  it('lights the matches over the selection\'s neighbourhood while the search has a query', async () => {
    mounted = await open()
    store.selectedItem = nodes[0]
    await nextTick()
    expect(focusSheet()?.textContent).toContain('[data-id="f1"]')

    search(mounted).vm.$emit('matches', [{ id: 'db', kind: 'component', type: 'STORE', name: 'db', context: 'Root' }])
    await nextTick()
    expect(focusSheet()?.textContent).toContain('[data-id="db"]')
    expect(focusSheet()?.textContent).not.toContain('[data-id="f1"]')
    expect(mounted.find('.vue-flow-stub').classes()).toContain('dt-flow-focus')

    search(mounted).vm.$emit('matches', [])
    await nextTick()
    expect(focusSheet()).toBeNull()
    expect(mounted.find('.vue-flow-stub').classes()).not.toContain('dt-flow-focus')

    search(mounted).vm.$emit('matches', null)
    await nextTick()
    expect(focusSheet()?.textContent).toContain('[data-id="f1"]')
  })

  it('selects and frames a picked component', async () => {
    mounted = await open()
    search(mounted).vm.$emit('pick', { id: 'db', kind: 'component', type: 'STORE', name: 'db', context: 'Root' })
    await nextTick()
    expect(store.setSelectedItem).toHaveBeenCalledWith({ item: nodes[1] })
    expect(flow.addSelectedNodes).toHaveBeenCalledWith([nodes[1]])
    expect(flow.fitView).toHaveBeenCalledWith({ nodes: ['db'], padding: 0.4, maxZoom: 1.5 })
  })

  it('selects a picked flow and frames its two ends', async () => {
    mounted = await open()
    search(mounted).vm.$emit('pick', { id: 'f1', kind: 'flow', type: 'FLOW', name: '', context: 'web → db' })
    await nextTick()
    expect(store.setSelectedItem).toHaveBeenCalledWith({ item: edges[0] })
    expect(flow.addSelectedEdges).toHaveBeenCalledWith([edges[0]])
    expect(flow.fitView).toHaveBeenCalledWith({ nodes: ['web', 'db'], padding: 0.4, maxZoom: 1.5 })
  })

  it('does nothing for a pick no longer on the canvas', async () => {
    mounted = await open()
    search(mounted).vm.$emit('pick', { id: 'gone', kind: 'component', type: 'PROCESS', name: 'gone', context: 'Root' })
    await nextTick()
    expect(store.setSelectedItem).not.toHaveBeenCalled()
    expect(flow.fitView).not.toHaveBeenCalled()
  })

  it('stops listening for the shortcut once the editor is gone', async () => {
    mounted = await open()
    mounted.unmount()
    mounted = null
    expect(pressFind().defaultPrevented).toBe(false)
  })
})
