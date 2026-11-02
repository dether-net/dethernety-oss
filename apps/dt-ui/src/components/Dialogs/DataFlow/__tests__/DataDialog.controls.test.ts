// @vitest-environment happy-dom
/**
 * DataDialog's Controls tab writes a data item's controls the way an element panel writes its own: a pick from the
 * picker and a confirmed removal are each saved at once, as the change from the controls the cached item holds. A
 * removal waits for confirmation, and a cancelled one writes nothing and puts the row back. A data item that does not
 * exist yet has no Controls tab.
 *
 * Harness as DataDialog.test.ts: no Pinia, the stores mocked directly, internals reached through the defineExpose seam.
 * The cached item is reactive, and a successful save replaces its controls, as the store does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

const DATA_ITEM = {
  name: 'Cards',
  description: '',
  dataClass: null,
  controls: [{ id: 'ctl-1', name: 'Field encryption' }],
}

const mocks = vi.hoisted(() => ({
  flow: {
    getDataItem: vi.fn(),
    getDataClass: vi.fn().mockResolvedValue(null),
    getExposures: vi.fn().mockResolvedValue([]),
    getAttributesFromClassRelationship: vi.fn().mockResolvedValue({}),
    updateDataItem: vi.fn().mockResolvedValue(true),
    isOperationLoading: vi.fn().mockReturnValue(false),
    createDataItem: vi.fn().mockResolvedValue({ id: 'd1' }),
    controls: [{ id: 'ctl-1', name: 'Field encryption', controlClasses: [{ id: 'cc-1', name: 'Encryption' }] }],
    selectedItem: { id: 'el1' } as { id: string } | null,
    modelId: 'm1',
  },
  issue: {},
  router: { push: vi.fn() },
}))

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => mocks.flow }))
vi.mock('@/stores/issueStore', () => ({ useIssueStore: () => mocks.issue }))
vi.mock('vue-router', () => ({ useRouter: () => mocks.router }))
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [], ControlWrapper: {}, useVuetifyControl: () => ({}) }))

import DataDialog from '../DataDialog.vue'
import SettingsControlsTab from '@/components/DataFlow/SettingsTabs/SettingsControlsTab.vue'

interface Exposed {
  selectedControlIds: string[]
  showRemoveControlDialog: boolean
  removeControlMessage: string
  onAddControls: (picked: { id: string; name: string }[]) => Promise<void>
  onSelectedControlIds: (value: string[]) => void
  onRemoveControlConfirmed: () => Promise<void>
  onRemoveControlCanceled: () => void
}

const stubs = {
  'v-hover': { template: '<div><slot :isHovering="false" :props="{}" /></div>' },
}

const mountDialog = (props: { action: string; id: string | null } = { action: 'edit', id: 'd1' }) =>
  shallowMount(DataDialog, {
    props: { show: true, class: 'classA', ...props },
    global: { stubs, renderStubDefaultSlot: true },
  })

const vm = (w: ReturnType<typeof mountDialog>) => w.vm as unknown as Exposed

let cache: { item: { controls: { id: string; name: string }[] } & Record<string, unknown> }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.flow.isOperationLoading.mockReturnValue(false)
  cache = reactive({ item: { ...DATA_ITEM, controls: [...DATA_ITEM.controls] } })
  mocks.flow.getDataItem.mockImplementation(() => cache.item)
  mocks.flow.updateDataItem.mockImplementation(async ({ controls }: { controls?: string[] }) => {
    if (controls) cache.item = { ...cache.item, controls: controls.map(id => ({ id, name: id })) }
    return true
  })
})

const snack = (wrapper: ReturnType<typeof mountDialog>) => (wrapper.emitted('update:snackBar') ?? []).at(-1)?.[0] as { color: string } | undefined

describe('DataDialog — the Controls tab', () => {
  it('shows the item\'s controls, as the catalogue describes them', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const tab = wrapper.findComponent(SettingsControlsTab)
    expect(tab.exists()).toBe(true)
    expect(tab.props('selectedControlIds')).toEqual(['ctl-1'])
    expect(tab.props('controls')).toEqual([mocks.flow.controls[0]])
  })

  it('saves a pick at once, as the change from the cached controls', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await vm(wrapper).onAddControls([{ id: 'ctl-2', name: 'Tokenisation' }])

    expect(mocks.flow.updateDataItem).toHaveBeenCalledWith({
      dataItemId: 'd1',
      controls: ['ctl-1', 'ctl-2'],
      baselineLinks: { controls: ['ctl-1'] },
    })
  })

  it('saves only the new controls of a pick that mixes them with ones the item has, and follows the save', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await vm(wrapper).onAddControls([{ id: 'ctl-1', name: 'Field encryption' }, { id: 'ctl-2', name: 'Tokenisation' }])

    expect(mocks.flow.updateDataItem).toHaveBeenCalledWith(expect.objectContaining({ controls: ['ctl-1', 'ctl-2'] }))
    expect(vm(wrapper).selectedControlIds).toEqual(['ctl-1', 'ctl-2'])
    expect(snack(wrapper)?.color).toBe('success')
  })

  it('says so when a save fails, and leaves the selection as the item has it', async () => {
    mocks.flow.updateDataItem.mockResolvedValue(false)
    const wrapper = mountDialog()
    await flushPromises()

    // The table shows the row unticked; the dialog never assigns what it emits, so stand in for that here.
    vm(wrapper).selectedControlIds = []
    vm(wrapper).onSelectedControlIds([])
    await vm(wrapper).onRemoveControlConfirmed()

    expect(snack(wrapper)?.color).toBe('error')
    expect(vm(wrapper).selectedControlIds).toEqual(['ctl-1'])
  })

  it('removes only what was unticked, when the item gains a control while the confirmation is open', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    vm(wrapper).onSelectedControlIds([])
    // A pick still saving lands, or an element save returns the item, before the user confirms.
    cache.item = { ...cache.item, controls: [...cache.item.controls, { id: 'ctl-2', name: 'Tokenisation' }] }
    await vm(wrapper).onRemoveControlConfirmed()

    expect(mocks.flow.updateDataItem).toHaveBeenCalledWith({
      dataItemId: 'd1',
      controls: ['ctl-2'],
      baselineLinks: { controls: ['ctl-1', 'ctl-2'] },
    })
  })

  it('counts the controls when several are unticked at once', async () => {
    cache.item = { ...cache.item, controls: [{ id: 'ctl-1', name: 'Field encryption' }, { id: 'ctl-2', name: 'Tokenisation' }] }
    const wrapper = mountDialog()
    await flushPromises()

    vm(wrapper).onSelectedControlIds([])

    expect(vm(wrapper).removeControlMessage).toBe('Remove 2 controls from this data entity?')
  })

  it('writes nothing for a pick of a control the item already has', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await vm(wrapper).onAddControls([{ id: 'ctl-1', name: 'Field encryption' }])

    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
  })

  it('asks before removing a control, and saves the removal once confirmed', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    vm(wrapper).onSelectedControlIds([])
    expect(vm(wrapper).showRemoveControlDialog).toBe(true)
    expect(vm(wrapper).removeControlMessage).toBe("Remove control 'Field encryption' from this data entity?")
    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()

    await vm(wrapper).onRemoveControlConfirmed()

    expect(mocks.flow.updateDataItem).toHaveBeenCalledWith({
      dataItemId: 'd1',
      controls: [],
      baselineLinks: { controls: ['ctl-1'] },
    })
  })

  it('writes nothing for a cancelled removal, and puts the row back', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    // The table shows the row unticked; the dialog never assigns what it emits, so stand in for that here.
    vm(wrapper).selectedControlIds = []
    vm(wrapper).onSelectedControlIds([])
    vm(wrapper).onRemoveControlCanceled()

    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
    expect(vm(wrapper).showRemoveControlDialog).toBe(false)
    expect(vm(wrapper).selectedControlIds).toEqual(['ctl-1'])
  })

  it('refuses a pick or an untick while a save of the item is in flight, and puts the table back', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    mocks.flow.isOperationLoading.mockImplementation((op: string) => op === 'updateDataItem-d1')

    await vm(wrapper).onAddControls([{ id: 'ctl-2', name: 'Tokenisation' }])
    vm(wrapper).selectedControlIds = []
    vm(wrapper).onSelectedControlIds([])

    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
    expect(vm(wrapper).showRemoveControlDialog).toBe(false)
    expect(vm(wrapper).selectedControlIds).toEqual(['ctl-1'])
    expect(snack(wrapper)?.color).toBe('warning')
  })

  it('refuses a confirmed removal when a save started while the confirmation was open', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    vm(wrapper).selectedControlIds = []
    vm(wrapper).onSelectedControlIds([])
    mocks.flow.isOperationLoading.mockImplementation((op: string) => op === 'updateDataItem-d1')

    await vm(wrapper).onRemoveControlConfirmed()

    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
    expect(vm(wrapper).selectedControlIds).toEqual(['ctl-1'])
    expect(snack(wrapper)?.color).toBe('warning')
  })

  it('refuses a General save while another save of the item is in flight, and keeps the edit', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    mocks.flow.isOperationLoading.mockImplementation((op: string) => op === 'updateDataItem-d1')
    ;(wrapper.vm as unknown as { name: string }).name = 'Card numbers'

    await (wrapper.vm as unknown as { onSubmit: () => Promise<void> }).onSubmit()

    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
    expect(snack(wrapper)?.color).toBe('warning')
    expect((wrapper.vm as unknown as { name: string }).name).toBe('Card numbers')
  })

  it('has no Controls tab for a data item that is being created', async () => {
    mocks.flow.getDataItem.mockImplementation(() => undefined)
    const wrapper = mountDialog({ action: 'create', id: null })
    await flushPromises()

    expect(wrapper.findComponent(SettingsControlsTab).exists()).toBe(false)
  })
})
