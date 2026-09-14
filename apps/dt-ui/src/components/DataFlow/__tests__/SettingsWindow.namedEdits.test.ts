// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

/**
 * A save names what the user changed, and nothing else.
 *
 * `updates` is the only part of a save that states what the user changed; the rest of the payload is
 * the element as this client last loaded it. That has two halves and they fail in opposite directions.
 * A link edit that is not named there is being carried by the snapshot, which works only for as long
 * as the whole snapshot is sent — and stops working silently, with a success toast and nothing
 * written. A General field that IS named when it did not change asserts a load-time copy over
 * whatever anybody else wrote since, which reverts their edit just as silently: ticking a control
 * reverted a peer's rename, and a crown-jewel toggle reverted their description.
 *
 * The negative cases are not decoration. Without them every positive assertion here is satisfied by
 * a save that always names everything, which is the same defect wearing the fix's clothes.
 */

const mockFlowStore = reactive<Record<string, any>>({
  selectedItem: null,
  modelId: 'model-1',
  defaultBoundary: null,
  defaultBoundaryId: 'b-default',
  controls: [
    { id: 'ctl-1', name: 'C1' },
    { id: 'ctl-2', name: 'C2' },
    { id: 'ctl-3', name: 'C3' },
  ],
  dataItems: [
    { id: 'di-1', name: 'D1' },
    { id: 'di-2', name: 'D2' },
  ],
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
// Children reached through this panel statically import @jsonforms/vue-vuetify, which pulls Vuetify
// component CSS Vitest can't parse. Same cut as SettingsWindow.freshTab.test.ts.
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [] }))

import SettingsWindow from '../SettingsWindow.vue'

const componentNode = (data: Record<string, unknown> = {}) => ({
  id: 'n-1',
  type: 'PROCESS',
  position: { x: 0, y: 0 },
  data: { label: 'N1', description: 'd', controls: ['ctl-1'], dataItems: ['di-1'], ...data },
})

// A data flow. The Data and Controls tabs render for one exactly as they do for a node, so every
// path below is reachable with an edge selected — and it travels through the OTHER branch of the save.
const dataFlowEdge = (data: Record<string, unknown> = {}) => ({
  id: 'e-1',
  source: 'n-1',
  target: 'n-2',
  label: 'E1',
  data: { description: 'd', controls: ['ctl-1'], dataItems: ['di-1'], ...data },
})

// Mount and let the panel finish initialising. `updateForm` awaits store reads before seeding the
// local control list, so a handler driven on a panel that has not settled sees an empty one — which
// is not the state any of these acts is reachable from.
const mountPanel = async () => {
  const w = mount(SettingsWindow, {
    props: { freshlyCreatedId: null },
    shallow: true,
    global: {
      stubs: {
        teleport: true,
        VHover: { name: 'VHover', template: '<div><slot :is-hovering="false" :props="{}" /></div>' },
      },
    },
  })
  await flushPromises()
  vi.clearAllMocks()
  return w
}

/** The `updates` of the most recent node save. */
const lastNodeUpdates = () => mockFlowStore.updateNode.mock.calls.at(-1)[0].updates

/** The `updates` of the most recent data-flow save. */
const lastEdgeUpdates = () => mockFlowStore.updateDataFlow.mock.calls.at(-1)[0].updates

beforeEach(() => {
  vi.clearAllMocks()
  mockFlowStore.selectedItem = componentNode()
})

describe('a link edit on a node is named in the save', () => {
  it('names the data items when one is attached', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedDataItemIds(['di-1', 'di-2'])
    await flushPromises()

    expect(lastNodeUpdates().data.dataItems).toEqual(['di-1', 'di-2'])
  })

  it('names the controls when one is attached, and nothing on the General tab', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()

    expect(lastNodeUpdates().data.controls).toEqual(['ctl-1', 'ctl-2'])
    expect('label' in lastNodeUpdates().data).toBe(false)
    expect('description' in lastNodeUpdates().data).toBe(false)
    expect('crownJewel' in lastNodeUpdates().data).toBe(false)
  })

  it('names the controls the dialog added', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedControls([{ id: 'ctl-3', name: 'C3' }])
    await flushPromises()

    expect(lastNodeUpdates().data.controls).toEqual(['ctl-1', 'ctl-3'])
  })

  // A removal goes through the confirmation dialog, so the proposed value is held on the component
  // across two user acts. It is read into the save before the pending value is reset.
  it('names the SHORTENED control list once the removal is confirmed', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedControlIds([])
    await flushPromises()
    expect(mockFlowStore.updateNode).not.toHaveBeenCalled() // the dialog is open; nothing saved yet

    ;(w.vm as any).onRemoveControlConfirmed()
    await flushPromises()

    expect(lastNodeUpdates().data.controls).toEqual([])
  })

  it('names the SHORTENED data-item list once the removal is confirmed', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedDataItemIds([])
    await flushPromises()
    expect(mockFlowStore.updateNode).not.toHaveBeenCalled()

    ;(w.vm as any).onRemoveDataItemConfirmed()
    await flushPromises()

    expect(lastNodeUpdates().data.dataItems).toEqual([])
  })
})

describe('a link edit on a data flow is named in the save too', () => {
  beforeEach(() => {
    mockFlowStore.selectedItem = dataFlowEdge()
  })

  it('names the controls attached to an edge', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()

    expect(mockFlowStore.updateNode).not.toHaveBeenCalled()
    expect(lastEdgeUpdates().data.controls).toEqual(['ctl-1', 'ctl-2'])
  })

  it('names the data items attached to an edge', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedDataItemIds(['di-1', 'di-2'])
    await flushPromises()

    expect(lastEdgeUpdates().data.dataItems).toEqual(['di-1', 'di-2'])
  })

  it('names the shortened control list on an edge removal', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedControlIds([])
    await flushPromises()
    ;(w.vm as any).onRemoveControlConfirmed()
    await flushPromises()

    expect(lastEdgeUpdates().data.controls).toEqual([])
  })
})

// Without these, every assertion above is satisfied by a save that always names both lists — which
// would send a whole-array REPLACE of the associations on every description edit and every drag.
describe('a save that changes no link names none', () => {
  // `in` rather than toHaveProperty: an explicit `controls: undefined` is an own key, and it is the
  // shape that would wipe the local list while omitting the field from the mutation.
  const names = (updates: any, key: string) => key in updates.data

  it('a general-tab save names neither list', async () => {
    const w = await mountPanel()
    await (w.vm as any).saveItem()
    await flushPromises()

    expect(names(lastNodeUpdates(), 'controls')).toBe(false)
    expect(names(lastNodeUpdates(), 'dataItems')).toBe(false)
  })

  it('a crown-jewel toggle names neither list, and neither General field', async () => {
    const w = await mountPanel()
    await (w.vm as any).onCrownJewelToggle(true)
    await flushPromises()

    expect(lastNodeUpdates().data.crownJewel).toBe(true)
    expect(names(lastNodeUpdates(), 'controls')).toBe(false)
    expect(names(lastNodeUpdates(), 'dataItems')).toBe(false)
    expect(names(lastNodeUpdates(), 'label')).toBe(false)
    expect(names(lastNodeUpdates(), 'description')).toBe(false)
  })

  it('a general-tab save on an edge names neither list', async () => {
    mockFlowStore.selectedItem = dataFlowEdge()
    const w = await mountPanel()
    await (w.vm as any).saveItem()
    await flushPromises()

    expect(names(lastEdgeUpdates(), 'controls')).toBe(false)
    expect(names(lastEdgeUpdates(), 'dataItems')).toBe(false)
  })

  it('a cancelled removal saves nothing at all', async () => {
    const w = await mountPanel()
    ;(w.vm as any).updateSelectedControlIds([])
    await flushPromises()
    ;(w.vm as any).onRemoveControlCanceled()
    await flushPromises()

    expect(mockFlowStore.updateNode).not.toHaveBeenCalled()
    expect(mockFlowStore.updateDataFlow).not.toHaveBeenCalled()
  })
})

// THE OTHER HALF OF THE FINDING. The General fields were sent on every save — including a save the
// user never made on that tab — so the panel asserted its load-time name, description and crown-jewel
// flag over whatever anybody else had written since.
describe('a General edit names the field that changed, and only that field', () => {
  /** Drive the form the way the General tab does, so the component's own update path is exercised. */
  const type = (w: any, patch: Record<string, string>) => {
    w.vm.onPendingFormDataUpdate({ ...w.vm.pendingFormData, ...patch })
  }

  const named = (updates: any, key: string) => key in updates.data

  it('a rename names the label alone', async () => {
    const w = await mountPanel()
    type(w, { name: 'renamed' })

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastNodeUpdates().data).toEqual({ label: 'renamed' })
  })

  it('a description edit names the description alone', async () => {
    const w = await mountPanel()
    type(w, { description: 'edited' })

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastNodeUpdates().data).toEqual({ description: 'edited' })
  })

  // PRESENCE IS THE TEST, NOT TRUTH — the same property `editPaths` is built on. Emptying a
  // description is an edit; a gate written on truthiness drops it and the field silently never clears.
  it('clearing the description names it as an empty string', async () => {
    const w = await mountPanel()
    type(w, { description: '' })

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastNodeUpdates().data).toEqual({ description: '' })
  })

  // A description the element does not carry at all is seeded into the form as ''. Without the same
  // normalisation on the baseline it would differ from `undefined` forever, and every save — a control
  // tick included — would re-assert it.
  it('does not read an absent description as an edit', async () => {
    mockFlowStore.selectedItem = componentNode({ description: undefined })
    const w = await mountPanel()

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(named(lastNodeUpdates(), 'description')).toBe(false)
  })

  // The negative control the three cases above are worthless without: on the shipped code this is the
  // whole element, every time.
  it('a save that changed nothing names nothing at all', async () => {
    const w = await mountPanel()

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastNodeUpdates().data).toEqual({})
  })

  it('still saves when nothing changed, because that is what clears a fresh draft', async () => {
    const w = await mountPanel()

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(mockFlowStore.updateNode).toHaveBeenCalledTimes(1)
  })
})

// The edge branch is a different shape, not a different rule: the label sits at the top of `updates`
// and the description under `data`, so each gate has to be written where its field actually lives.
describe('a General edit on a data flow names the field that changed', () => {
  beforeEach(() => {
    mockFlowStore.selectedItem = dataFlowEdge()
  })

  const type = (w: any, patch: Record<string, string>) => {
    w.vm.onPendingFormDataUpdate({ ...w.vm.pendingFormData, ...patch })
  }

  it('a rename names the top-level label alone', async () => {
    const w = await mountPanel()
    type(w, { name: 'renamed' })

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastEdgeUpdates()).toEqual({ label: 'renamed', data: {} })
  })

  it('a description edit names the description alone, and no label', async () => {
    const w = await mountPanel()
    type(w, { description: 'edited' })

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastEdgeUpdates()).toEqual({ data: { description: 'edited' } })
  })

  it('a save that changed nothing names nothing at all', async () => {
    const w = await mountPanel()

    await (w.vm as any).saveItem()
    await flushPromises()

    expect(lastEdgeUpdates()).toEqual({ data: {} })
  })
})
