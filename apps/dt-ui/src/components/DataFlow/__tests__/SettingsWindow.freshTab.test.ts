// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'

// Dropping a new element used to leave the settings panel on whichever tab the previous
// selection was resting on — Exposures or Controls for a brand-new element, both empty,
// with the name/description fields a click away. It should open on General instead.

const mockFlowStore = reactive<Record<string, unknown>>({
  selectedItem: null,
  modelId: 'model-1',
  defaultBoundary: null,
  defaultBoundaryId: 'b-default',
  controls: [],
  dataItems: [],
  isOperationLoading: () => false,
  isPendingNode: () => false,
  setSelectedItem: vi.fn(({ item }: { item: unknown }) => { mockFlowStore.selectedItem = item }),
  getExposures: vi.fn().mockResolvedValue([]),
  getComponentClass: vi.fn().mockResolvedValue(null),
  getBoundaryClass: vi.fn().mockResolvedValue(null),
  getDataFlowClass: vi.fn().mockResolvedValue(null),
  getComponentRepresentedModel: vi.fn().mockResolvedValue(null),
  getBoundaryRepresentedModel: vi.fn().mockResolvedValue(null),
  getAttributesFromClassRelationship: vi.fn().mockResolvedValue([]),
  setInstantiationAttributesWithStaleCount: vi.fn().mockResolvedValue(true),
  updateNode: vi.fn().mockResolvedValue(true),
  updateDataFlow: vi.fn().mockResolvedValue(true),
  updateNodeClass: vi.fn().mockResolvedValue(true),
  updateDataFlowClass: vi.fn().mockResolvedValue(true),
  updateRepresentedModel: vi.fn().mockResolvedValue(true),
  deleteComponentNode: vi.fn().mockResolvedValue(true),
  deleteBoundaryNode: vi.fn().mockResolvedValue(true),
  deleteDataFlow: vi.fn().mockResolvedValue(true),
})

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => mockFlowStore }))
vi.mock('@/stores/issueStore', () => ({
  useIssueStore: () => reactive({ issueClasses: [], setIssueDataClipboard: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { path: '/dataflow', query: {} } } }),
}))
// Children reached through this panel statically import @jsonforms/vue-vuetify, which pulls
// Vuetify component CSS Vitest can't parse. Same cut as DataDialog.test.ts — mock the package
// once and every importer in the graph is covered.
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [] }))

import SettingsWindow from '../SettingsWindow.vue'

const node = (id: string) => ({ id, type: 'PROCESS', position: { x: 0, y: 0 }, data: { label: id } })

const mountPanel = () =>
  mount(SettingsWindow, {
    props: { freshlyCreatedId: null },
    shallow: true,
    global: {
      stubs: {
        teleport: true,
        // A shallow stub renders no scoped-slot payload, and this template destructures
        // v-hover's. Supply the shape so the render doesn't throw. (The speed-dial's
        // activator slot is never invoked by its stub, so it needs no equivalent.)
        VHover: { name: 'VHover', template: '<div><slot :is-hovering="false" :props="{}" /></div>' },
      },
    },
  })

describe('SettingsWindow — a freshly created element opens on General', () => {
  beforeEach(() => {
    mockFlowStore.selectedItem = node('existing')
  })

  it('switches to General when an element is dropped while another tab is active', async () => {
    const w = mountPanel()
    ;(w.vm as any).tab = 'exposures'
    await nextTick()

    // What DataFlow.vue does on drop: the new element becomes the selection and its id
    // is published as freshlyCreatedId.
    mockFlowStore.selectedItem = node('n-new')
    await w.setProps({ freshlyCreatedId: 'n-new' })
    await nextTick()

    expect((w.vm as any).tab).toBe('general')
  })

  it('switches to General for a newly drawn data flow too', async () => {
    const w = mountPanel()
    ;(w.vm as any).tab = 'controls'
    await nextTick()

    mockFlowStore.selectedItem = { id: 'e-new', source: 'a', target: 'b', data: {} }
    await w.setProps({ freshlyCreatedId: 'e-new' })
    await nextTick()

    expect((w.vm as any).tab).toBe('general')
  })

  it('leaves the tab alone when selecting an existing element', async () => {
    const w = mountPanel()
    ;(w.vm as any).tab = 'exposures'
    await nextTick()

    // A plain selection change publishes no freshly-created id.
    mockFlowStore.selectedItem = node('other')
    await nextTick()

    expect((w.vm as any).tab).toBe('exposures')
  })

  // Creating a component selects an optimistic temp node synchronously, which trips the
  // dirty navigation guard: selection snaps back to the element being edited and the
  // discard prompt opens. The create still resolves and still publishes a fresh id, but
  // the panel is showing the OLD element — so the tab must not move.
  it('leaves the tab alone when the dirty guard intercepted the drop', async () => {
    const w = mountPanel()
    ;(w.vm as any).tab = 'exposures'
    ;(w.vm as any).markDirty('exposures')
    await nextTick()

    // Guard snapped selection back; the new element was never shown.
    await w.setProps({ freshlyCreatedId: 'n-new' })
    await nextTick()

    expect((w.vm as any).tab).toBe('exposures')
    expect(mockFlowStore.selectedItem).toMatchObject({ id: 'existing' })
  })

  it('does not yank the tab back to General when the fresh id is cleared on save', async () => {
    const w = mountPanel()
    mockFlowStore.selectedItem = node('n-new')
    await w.setProps({ freshlyCreatedId: 'n-new' })
    await nextTick()
    expect((w.vm as any).tab).toBe('general')

    // User moves to Controls, then saves — DataFlow.vue clears the id.
    ;(w.vm as any).tab = 'controls'
    await nextTick()
    await w.setProps({ freshlyCreatedId: null })
    await nextTick()

    expect((w.vm as any).tab).toBe('controls')
  })
})
