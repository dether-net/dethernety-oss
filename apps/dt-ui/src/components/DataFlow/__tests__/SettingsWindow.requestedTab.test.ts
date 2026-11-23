// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'

// An editor link (`/dataflow?…&element=<id>&tab=<name>`) opens the settings panel on a tab: DataFlow passes the tab as
// requestedTab, the panel switches to it when the selected element shows it, and reports it consumed either way.

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
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [], ControlWrapper: {}, useVuetifyControl: () => ({}) }))

import SettingsWindow from '../SettingsWindow.vue'

const node = (id: string, type = 'PROCESS') => ({ id, type, position: { x: 0, y: 0 }, data: { label: id } })

const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(SettingsWindow, {
    props: { freshlyCreatedId: null, ...props },
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

describe('SettingsWindow — a requested tab from an editor link', () => {
  beforeEach(() => {
    mockFlowStore.selectedItem = node('web')
    mockFlowStore.defaultBoundaryId = 'b-default'
  })

  it('opens on the requested tab when the panel mounts with it (the panel mounts lazily)', async () => {
    const w = mountPanel({ requestedTab: 'exposures' })
    await nextTick()
    expect((w.vm as any).tab).toBe('exposures')
    expect(w.emitted('requested-tab-applied')).toHaveLength(1)
  })

  it('switches to a tab requested while it is already mounted', async () => {
    const w = mountPanel()
    expect((w.vm as any).tab).toBe('general')
    await w.setProps({ requestedTab: 'attributes' })
    await nextTick()
    expect((w.vm as any).tab).toBe('attributes')
    expect(w.emitted('requested-tab-applied')).toHaveLength(1)
  })

  it('opens Zoning for a boundary that is not the default one', async () => {
    mockFlowStore.selectedItem = node('dmz', 'BOUNDARY')
    const w = mountPanel({ requestedTab: 'zoning' })
    await nextTick()
    expect((w.vm as any).tab).toBe('zoning')
  })

  it('does not open a tab the element does not show, and still reports the request consumed', async () => {
    const w = mountPanel({ requestedTab: 'zoning' })
    await nextTick()
    expect((w.vm as any).tab).toBe('general')
    expect(w.emitted('requested-tab-applied')).toHaveLength(1)
  })

  it('does nothing without a request', async () => {
    const w = mountPanel({ requestedTab: null })
    await nextTick()
    expect((w.vm as any).tab).toBe('general')
    expect(w.emitted('requested-tab-applied')).toBeUndefined()
  })

  it('keeps the Zoning tab rule: a boundary shows it; the default boundary and a component do not', async () => {
    mockFlowStore.selectedItem = node('dmz', 'BOUNDARY')
    const w = mountPanel()
    expect((w.vm as any).showZoningTab).toBe(true)
    mockFlowStore.selectedItem = node('b-default', 'BOUNDARY')
    await nextTick()
    expect((w.vm as any).showZoningTab).toBe(false)
    mockFlowStore.selectedItem = node('web')
    await nextTick()
    expect((w.vm as any).showZoningTab).toBe(false)
    mockFlowStore.selectedItem = { id: 'f1', source: 'a', target: 'b', data: {} }
    await nextTick()
    expect((w.vm as any).showZoningTab).toBe(false)
  })
})
