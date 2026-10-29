// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

/**
 * Saving pending edits on the way to a class or model change, and saving General and Attributes together.
 *
 * "Commit & change" saves the other pending edits first. The change that follows must still apply what the user
 * picked, to the element it was picked on, not what a reload would reset the form to. Saving General with
 * Attributes must leave the form showing what was saved, a zoning edit must still be saved, and an edit that is
 * still unsaved after a save must survive it.
 */

const mockFlowStore = reactive<Record<string, any>>({
  selectedItem: null,
  modelId: 'model-1',
  defaultBoundary: null,
  defaultBoundaryId: 'b-default',
  controls: [],
  dataItems: [],
  allBoundaries: () => [],
  isOperationLoading: () => false,
  isPendingNode: () => false,
  getRealNodeId: (id: string) => id,
  setSelectedItem: vi.fn(({ item }: { item: unknown }) => { mockFlowStore.selectedItem = item }),
  getExposures: vi.fn().mockResolvedValue([]),
  getComponentClass: vi.fn(),
  getBoundaryClass: vi.fn().mockResolvedValue(null),
  getDataFlowClass: vi.fn().mockResolvedValue(null),
  getComponentRepresentedModel: vi.fn(),
  getBoundaryRepresentedModel: vi.fn().mockResolvedValue(null),
  getAttributesFromClassRelationship: vi.fn(),
  setInstantiationAttributesWithStaleCount: vi.fn(),
  updateNode: vi.fn(),
  updateDataFlow: vi.fn().mockResolvedValue(true),
  updateNodeClass: vi.fn(),
  updateDataFlowClass: vi.fn(),
  updateRepresentedModel: vi.fn(),
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

const node = { id: 'n-1', type: 'PROCESS', position: { x: 0, y: 0 }, data: { label: 'N1', description: '' } }
/** A successful rebind that changed no derived findings. */
const bound = {
  success: true,
  deltas: {
    deletedDerivedExposures: 0,
    instantiatedDerivedExposures: 0,
    preservedCustomExposures: 0,
    deletedDerivedCountermeasures: 0,
    instantiatedDerivedCountermeasures: 0,
    preservedCustomCountermeasures: 0,
  },
}
const componentClass = (id: string) => ({
  id,
  name: id,
  category: 'c',
  template: { schema: { type: 'object', properties: { port: { type: 'number' } } }, uischema: { type: 'VerticalLayout', elements: [] } },
})

// Every panel watches the one store, so a panel left mounted would answer the next test's changes too.
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
  // Vuetify is not registered here, so the form ref holds a plain element; give saveAll a form that validates. A
  // re-render puts the element back, so each test submits in the same tick as its last edit.
  ;(w.vm as any).form = { validate: async () => ({ valid: true }) }
  vi.clearAllMocks()
  return w
}

/** A General edit the user has not saved: a new name. */
const editName = (w: ReturnType<typeof mount>) => {
  const vm = w.vm as any
  vm.onPendingFormDataUpdate({ ...vm.pendingFormData, name: 'Renamed' })
}

afterEach(() => {
  for (const w of mounted) w.unmount()
  mounted = []
})

beforeEach(() => {
  vi.clearAllMocks()
  mockFlowStore.selectedItem = { ...node, data: { ...node.data } }
  mockFlowStore.getComponentClass.mockReset().mockResolvedValue(componentClass('cls-a'))
  mockFlowStore.getComponentRepresentedModel.mockReset().mockResolvedValue(null)
  mockFlowStore.getBoundaryClass.mockReset().mockResolvedValue(null)
  mockFlowStore.getAttributesFromClassRelationship.mockReset().mockResolvedValue({ port: 22 })
  mockFlowStore.setInstantiationAttributesWithStaleCount.mockReset().mockResolvedValue({ success: true, staleFlippedCount: 0 })
  mockFlowStore.updateNode.mockReset().mockResolvedValue(true)
  mockFlowStore.updateNodeClass.mockReset().mockResolvedValue(bound)
  mockFlowStore.updateRepresentedModel.mockReset().mockResolvedValue(bound)
})

describe('"Commit & change" with unsaved General edits', () => {
  it('changes the element to the class the user picked', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, class: 'cls-b' })

    await vm.onClassChangeCommit()
    await flushPromises()

    expect(mockFlowStore.updateNodeClass).toHaveBeenCalledTimes(1)
    expect(mockFlowStore.updateNodeClass).toHaveBeenCalledWith({ nodeId: 'n-1', classId: 'cls-b' })
    // The General edit was saved first.
    expect(mockFlowStore.updateNode.mock.invocationCallOrder[0]).toBeLessThan(
      mockFlowStore.updateNodeClass.mock.invocationCallOrder[0],
    )
  })

  it('changes the element to the model the user picked', async () => {
    mockFlowStore.getComponentClass.mockResolvedValue(null)
    mockFlowStore.getComponentRepresentedModel.mockResolvedValue({ id: 'm-1', name: 'Model one' })
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, model: 'm-2', modelName: 'Model two' })

    await vm.onClassChangeCommit()
    await flushPromises()

    expect(mockFlowStore.updateRepresentedModel).toHaveBeenCalledWith({ nodeId: 'n-1', modelId: 'm-2' })
  })
})

/** An attribute save the test commits when it chooses; until then the server answers the old value. */
function deferredAttributeSave() {
  const state = { committed: false }
  let finish!: (value: unknown) => void
  mockFlowStore.getAttributesFromClassRelationship.mockImplementation(async () =>
    (state.committed ? { port: 443 } : { port: 22 }))
  mockFlowStore.setInstantiationAttributesWithStaleCount.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  return {
    commit: () => {
      state.committed = true
      finish({ success: true, staleFlippedCount: 0 })
    },
  }
}

describe('"Commit & change" when the selection moves while the edits save', () => {
  it('changes nothing on the element selected meanwhile', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, class: 'cls-b' })
    let finishSave!: (value: boolean) => void
    mockFlowStore.updateNode.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve }))

    const committing = vm.onClassChangeCommit()
    await flushPromises()
    // The user selects another element and discards the unsaved edits while the save is in flight.
    vm.clearAllDirty()
    mockFlowStore.selectedItem = { ...node, id: 'n-2', data: { ...node.data } }
    await flushPromises()
    finishSave(true)
    await committing
    await flushPromises()

    expect(mockFlowStore.updateNodeClass).not.toHaveBeenCalled()
    expect(w.emitted('update:snackBar')?.flat()).toContainEqual(
      expect.objectContaining({ message: 'The selection changed while saving; class change cancelled.' }),
    )
  })
})

describe('"Commit & change" when the other edits cannot be saved', () => {
  it('puts the pick back to the element\'s binding and keeps the unsaved edit', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, class: 'cls-b' })
    mockFlowStore.setInstantiationAttributesWithStaleCount.mockResolvedValue({ success: false })

    await vm.onClassChangeCommit()
    await flushPromises()

    expect(mockFlowStore.updateNodeClass).not.toHaveBeenCalled()
    expect(vm.pendingFormData.class).toBe('cls-a')
    expect(vm.pendingAttributes).toEqual({ port: 443 })
  })
})

describe('a save that leaves another edit unsaved', () => {
  it('keeps a General edit typed while the other saves were in flight', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })
    const save = deferredAttributeSave()

    const submitting = vm.onSubmit()
    await flushPromises()
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, name: 'Renamed again' })
    save.commit()
    await submitting
    await flushPromises()

    expect(vm.pendingFormData.name).toBe('Renamed again')
  })

  it('keeps a General edit typed while the General save itself was in flight', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    let finishSave!: (value: boolean) => void
    mockFlowStore.updateNode.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve }))

    const submitting = vm.onSubmit()
    await flushPromises()
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, description: 'Typed during the save' })
    finishSave(true)
    await submitting
    await flushPromises()

    expect(vm.pendingFormData.description).toBe('Typed during the save')
    expect(vm.isDirty).toBe(true)
  })

  it('keeps an unsaved zoning edit when the form reloads for another reason', async () => {
    mockFlowStore.selectedItem = { ...node, type: 'BOUNDARY', data: { ...node.data, zone: 'zone-a' } }
    const w = await mountPanel()
    const vm = w.vm as any
    vm.onPendingZoningUpdate({ zone: 'zone-edit', domains: [], planes: [], conduits: [] })

    vm.updateForm()
    await flushPromises()

    expect(vm.pendingZoning.zone).toBe('zone-edit')
  })

  it('keeps an unsaved attribute edit when a control is linked', async () => {
    const w = await mountPanel()
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })

    vm.updateSelectedControls([{ id: 'ctl-1', name: 'C1' }])
    await flushPromises()

    expect(mockFlowStore.updateNode).toHaveBeenCalled()
    expect(vm.pendingAttributes).toEqual({ port: 443 })
  })
})

describe('"Commit & change" when an edit is made while the other edits save', () => {
  it('does not apply the change, and says why without reporting a failed save', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, class: 'cls-b' })
    let finishSave!: (value: boolean) => void
    mockFlowStore.updateNode.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve }))

    const committing = vm.onClassChangeCommit()
    await flushPromises()
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, description: 'Typed during the save' })
    finishSave(true)
    await committing
    await flushPromises()

    expect(mockFlowStore.updateNodeClass).not.toHaveBeenCalled()
    expect(vm.pendingFormData.description).toBe('Typed during the save')
    const messages = (w.emitted('update:snackBar') ?? []).flat().map((m: any) => m.message)
    expect(messages).toContain('An edit was made while saving; the class change was not applied. Choose it again.')
    expect(messages).not.toContain('Could not commit pending edits; class change cancelled.')
  })
})

describe('cancelling a class or model change', () => {
  it('puts the pick back and keeps the other unsaved edits', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })
    vm.isFromClass = false // the user switched to "Represents a Model" before picking
    vm.onPendingFormDataUpdate({ ...vm.pendingFormData, model: 'm-2', modelName: 'Model two' })

    vm.onClassChangeCancel()
    await flushPromises()

    expect(vm.pendingFormData.model).toBe('')
    expect(vm.isFromClass).toBe(true) // cls-a is still bound
    expect(vm.pendingFormData.name).toBe('Renamed')
    expect(vm.pendingAttributes).toEqual({ port: 443 })
    expect(vm.isDirty).toBe(true)
  })
})

describe('saving General with Attributes in one action', () => {
  it('keeps an attribute edit whose save failed, for a retry', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })
    mockFlowStore.setInstantiationAttributesWithStaleCount.mockResolvedValue({ success: false })

    await vm.onSubmit()
    await flushPromises()

    expect(vm.pendingAttributes).toEqual({ port: 443 })
    expect(vm.isDirty).toBe(true)
  })

  it('reloads the form once, after the attribute save commits, and shows what was saved', async () => {
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })
    const save = deferredAttributeSave()

    const submitting = vm.onSubmit()
    await flushPromises() // the attribute save is in flight; a reload now would read the old value
    save.commit()
    await submitting
    await flushPromises()

    expect(mockFlowStore.setInstantiationAttributesWithStaleCount).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 'cls-a', attributes: expect.objectContaining({ port: 443 }) }),
    )
    expect(mockFlowStore.getAttributesFromClassRelationship).toHaveBeenCalledTimes(1)
    expect(vm.pendingAttributes).toEqual({ port: 443 })
    expect(vm.lastLoadedAttributes).toEqual({ port: 443 })
  })

  it('still saves a zoning edit made with them', async () => {
    mockFlowStore.selectedItem = { ...node, type: 'BOUNDARY', data: { ...node.data, zone: 'zone-a' } }
    mockFlowStore.getBoundaryClass.mockResolvedValue(componentClass('cls-a'))
    const w = await mountPanel()
    editName(w)
    const vm = w.vm as any
    vm.onAttributesChanged({ port: 443 })
    vm.onPendingZoningUpdate({ zone: 'zone-b', domains: [], planes: [], conduits: [] })
    const save = deferredAttributeSave()

    const submitting = vm.onSubmit()
    await flushPromises()
    save.commit()
    await submitting
    await flushPromises()

    expect(mockFlowStore.updateNode).toHaveBeenLastCalledWith(
      expect.objectContaining({ updates: { data: expect.objectContaining({ zone: 'zone-b' }) } }),
    )
  })
})
