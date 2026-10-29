// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

/**
 * A change of selection while the new element's class is still loading.
 *
 * The class and its template arrive in one read, which can take as long as the slowest module's template.
 * Until it lands, the Attributes tab must show that it is loading, not the previous element's form, and a
 * Save must not send the previous element's class and attributes for the new element, nor empty name and
 * description fields. A class or attributes answer for an earlier selection that arrives late must not replace
 * the current one. And a save of the same element keeps its class on screen while the form reloads, and keeps an
 * unsaved zoning edit for the zoning save that follows.
 */

const mockFlowStore = reactive<Record<string, any>>({
  selectedItem: null,
  modelId: 'model-1',
  defaultBoundary: null,
  defaultBoundaryId: 'b-default',
  controls: [{ id: 'ctl-a', name: 'A' }, { id: 'ctl-b', name: 'B' }, { id: 'ctl-new', name: 'New' }],
  dataItems: [],
  allBoundaries: () => [],
  isOperationLoading: () => false,
  isPendingNode: () => false,
  setSelectedItem: vi.fn(({ item }: { item: unknown }) => { mockFlowStore.selectedItem = item }),
  getExposures: vi.fn().mockResolvedValue([]),
  getComponentClass: vi.fn(),
  getBoundaryClass: vi.fn().mockResolvedValue(null),
  getDataFlowClass: vi.fn().mockResolvedValue(null),
  getComponentRepresentedModel: vi.fn().mockResolvedValue(null),
  getBoundaryRepresentedModel: vi.fn().mockResolvedValue(null),
  getAttributesFromClassRelationship: vi.fn().mockResolvedValue([]),
  setInstantiationAttributesWithStaleCount: vi.fn().mockResolvedValue({ success: true, staleCount: 0 }),
  updateNode: vi.fn().mockResolvedValue(true),
  updateDataFlow: vi.fn().mockResolvedValue(true),
})

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => mockFlowStore }))
vi.mock('@/stores/issueStore', () => ({
  useIssueStore: () => reactive({ issueClasses: [], setIssueDataClipboard: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { path: '/dataflow', query: {} } } }),
}))
// Same cut as SettingsWindow.namedEdits.test.ts: children pull Vuetify component CSS Vitest can't parse.
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [], ControlWrapper: {}, useVuetifyControl: () => ({}) }))

import SettingsWindow from '../SettingsWindow.vue'

const node = (id: string, data: Record<string, unknown> = {}, type = 'PROCESS') => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, description: '', controls: [], dataItems: [], ...data },
})

const componentClass = (id: string) => ({
  id,
  name: id,
  category: 'c',
  template: { schema: { type: 'object', properties: { port: { type: 'number' } } }, uischema: { type: 'VerticalLayout', elements: [] } },
})

/** A read the test answers when it chooses. */
const pendingRead = () => {
  let answer!: (value: unknown) => void
  const promise = new Promise((resolve) => { answer = resolve })
  return { promise, answer }
}

// Every panel watches the one store, so a panel left mounted would answer the next test's selections too.
let mounted: Array<ReturnType<typeof mount>> = []

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
  mounted.push(w)
  await flushPromises()
  vi.clearAllMocks()
  return w
}

/** The loading state the Attributes form and dialog are given. The tab content is stubbed in a shallow mount. */
const formLoading = (w: ReturnType<typeof mount>) => (w.vm as any).attributesFormLoading

afterEach(() => {
  for (const w of mounted) w.unmount()
  mounted = []
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockFlowStore.selectedItem = node('n-a')
  mockFlowStore.getAttributesFromClassRelationship.mockReset().mockResolvedValue([])
  mockFlowStore.getComponentClass.mockReset().mockImplementation(async ({ componentId }: { componentId: string }) =>
    componentClass(`class-of-${componentId}`))
})

describe('a change of selection while the class loads', () => {
  it('shows the Attributes tab as loading, not the previous element\'s form, until the class lands', async () => {
    const w = await mountPanel()
    expect((w.vm as any).itemClass.id).toBe('class-of-n-a')

    const read = pendingRead()
    mockFlowStore.getComponentClass.mockReturnValueOnce(read.promise)
    mockFlowStore.selectedItem = node('n-b')
    await nextTick()

    expect((w.vm as any).itemClass).toBeNull()
    expect(formLoading(w)).toBe(true)

    read.answer(componentClass('class-of-n-b'))
    await flushPromises()

    expect((w.vm as any).itemClass.id).toBe('class-of-n-b')
    expect(formLoading(w)).toBe(false)
  })

  // An unsaved edit would hold the selection (the discard prompt), so the save here is the panel's own,
  // made after the selection has moved: it must not send the previous element's class and attributes.
  it('does not save attributes while the new element\'s class loads', async () => {
    const w = await mountPanel()

    mockFlowStore.getComponentClass.mockReturnValueOnce(pendingRead().promise)
    mockFlowStore.selectedItem = node('n-b')
    await nextTick()
    await (w.vm as any).saveAttributes()

    expect(mockFlowStore.setInstantiationAttributesWithStaleCount).not.toHaveBeenCalled()
  })

  it('drops a late class answer for an earlier selection', async () => {
    const w = await mountPanel()
    const forB = pendingRead()
    const forC = pendingRead()

    mockFlowStore.getComponentClass.mockReturnValueOnce(forB.promise)
    mockFlowStore.selectedItem = node('n-b')
    await nextTick()
    mockFlowStore.getComponentClass.mockReturnValueOnce(forC.promise)
    mockFlowStore.selectedItem = node('n-c')
    await nextTick()

    forC.answer(componentClass('class-of-n-c'))
    await flushPromises()
    forB.answer(componentClass('class-of-n-b'))
    await flushPromises()

    expect((w.vm as any).itemClass.id).toBe('class-of-n-c')
    expect(formLoading(w)).toBe(false)
  })

  it('stops loading when the class read fails', async () => {
    const w = await mountPanel()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    mockFlowStore.getComponentClass.mockRejectedValueOnce(new Error('read failed'))
    mockFlowStore.selectedItem = node('n-b')
    await flushPromises()

    expect(formLoading(w)).toBe(false)
  })

  it('ends the loading state when the next class read fails after a late attributes answer', async () => {
    const w = await mountPanel()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const forC = pendingRead()
    mockFlowStore.getAttributesFromClassRelationship.mockReturnValueOnce(forC.promise)
    mockFlowStore.selectedItem = node('n-c')
    await flushPromises()

    const forB = pendingRead()
    mockFlowStore.getComponentClass.mockReturnValueOnce(forB.promise)
    mockFlowStore.selectedItem = node('n-b')
    await nextTick()
    forC.answer({ port: 22 })
    await flushPromises()
    forB.answer(Promise.reject(new Error('read failed')))
    await flushPromises()

    expect(formLoading(w)).toBe(false)
  })

  it('drops a late attributes answer for an earlier selection', async () => {
    const w = await mountPanel()
    const forC = pendingRead()
    mockFlowStore.getAttributesFromClassRelationship.mockReturnValueOnce(forC.promise)
    mockFlowStore.selectedItem = node('n-c')
    await flushPromises()

    mockFlowStore.getAttributesFromClassRelationship.mockResolvedValueOnce({ port: 443 })
    mockFlowStore.selectedItem = node('n-b')
    await flushPromises()
    forC.answer({ port: 22 })
    await flushPromises()

    expect((w.vm as any).pendingAttributes).toEqual({ port: 443 })
    expect(formLoading(w)).toBe(false)
  })

  it('a control added while the class loads links the new element\'s controls only', async () => {
    mockFlowStore.selectedItem = node('n-a', { controls: ['ctl-a'] })
    const w = await mountPanel()
    mockFlowStore.getComponentClass.mockReturnValueOnce(pendingRead().promise)
    mockFlowStore.selectedItem = node('n-b', { controls: ['ctl-b'] })
    await nextTick()

    ;(w.vm as any).updateSelectedControls([{ id: 'ctl-new', name: 'New' }])
    await flushPromises()

    const { nodeId, updates } = mockFlowStore.updateNode.mock.calls.at(-1)[0]
    expect(nodeId).toBe('n-b')
    expect(updates.data.controls).toEqual(['ctl-b', 'ctl-new'])
  })

  it('shows the new boundary\'s zoning while its class loads', async () => {
    mockFlowStore.selectedItem = node('b-a', { zone: 'zone-a' }, 'BOUNDARY')
    const w = await mountPanel()
    mockFlowStore.getBoundaryClass.mockReturnValueOnce(pendingRead().promise)
    mockFlowStore.selectedItem = node('b-b', { zone: 'zone-b' }, 'BOUNDARY')
    await nextTick()

    expect((w.vm as any).pendingZoning.zone).toBe('zone-b')
  })

  it('keeps a zoning edit made while the class loads', async () => {
    mockFlowStore.selectedItem = node('b-a', { zone: 'zone-a' }, 'BOUNDARY')
    const w = await mountPanel()
    const read = pendingRead()
    mockFlowStore.getBoundaryClass.mockReturnValueOnce(read.promise)
    mockFlowStore.selectedItem = node('b-b', { zone: 'zone-b' }, 'BOUNDARY')
    await nextTick()

    ;(w.vm as any).onPendingZoningUpdate({ zone: 'zone-edit', domains: [], planes: [], conduits: [] })
    read.answer(null)
    await flushPromises()

    expect((w.vm as any).pendingZoning.zone).toBe('zone-edit')
    expect((w.vm as any).isDirty).toBe(true)
  })

  it('a crown-jewel toggle while the class loads sends only the crown-jewel flag', async () => {
    const w = await mountPanel()
    mockFlowStore.getComponentClass.mockReturnValueOnce(pendingRead().promise)
    mockFlowStore.selectedItem = node('n-b')
    await nextTick()

    await (w.vm as any).onCrownJewelToggle(true)

    const { nodeId, updates } = mockFlowStore.updateNode.mock.calls.at(-1)[0]
    expect(nodeId).toBe('n-b')
    expect(updates.data).toEqual({ crownJewel: true })
  })
})

describe('the first element the panel opens on', () => {
  it('shows its zoning while its class loads', async () => {
    mockFlowStore.selectedItem = node('b-a', { zone: 'zone-a' }, 'BOUNDARY')
    mockFlowStore.getBoundaryClass.mockReturnValueOnce(pendingRead().promise)

    const w = await mountPanel()

    expect(formLoading(w)).toBe(true)
    expect((w.vm as any).pendingZoning.zone).toBe('zone-a')
  })
})

describe('a save of the same element', () => {
  it('keeps an unsaved zoning edit for the zoning save that follows a General save', async () => {
    mockFlowStore.selectedItem = node('b-a', { zone: 'zone-a' }, 'BOUNDARY')
    const w = await mountPanel()
    ;(w.vm as any).onPendingZoningUpdate({ zone: 'zone-edit', domains: [], planes: [], conduits: [] })

    await (w.vm as any).saveItem()
    await flushPromises()

    expect((w.vm as any).pendingZoning.zone).toBe('zone-edit')
    await (w.vm as any).saveZoning()
    expect(mockFlowStore.updateNode.mock.calls.at(-1)[0].updates.data.zone).toBe('zone-edit')
  })

  it('keeps the class on screen while the form reloads', async () => {
    const w = await mountPanel()
    mockFlowStore.getComponentClass.mockReturnValueOnce(pendingRead().promise)

    await (w.vm as any).saveItem()

    expect((w.vm as any).itemClass.id).toBe('class-of-n-a')
    expect(formLoading(w)).toBe(false)
  })
})
