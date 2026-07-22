// @vitest-environment happy-dom
/**
 * Control dialog family lifecycle guards.
 *
 * 1. A failed countermeasure save must NOT close the parent dialog (the child stays
 *    mounted so the user's input survives); a successful save still closes it.
 * 2. Switching the tuned class must reset the attribute buffer/schema BEFORE loading and
 *    open the dialog only once the new class's data has arrived — so a prior class's
 *    values can never bleed into (or be saved onto) the new class. An invalid/missing
 *    template warns and clears the schema instead of showing the previous class's form.
 *
 * Precedent: DispositionDialog.test.ts / TechniquePickerInline.test.ts — no Pinia, mock
 * the stores directly, shallowMount auto-stubs children (incl. CounterMeasureDialog,
 * AttributesDialog, Vuetify). Internals are reached via ControlDialog's defineExpose seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { unflattenProperties } from '@/utils/dataFlowUtils'

const mocks = vi.hoisted(() => ({
  store: {
    // onMounted fan-out + the two functions under test
    fetchMitreAttackMitigations: vi.fn().mockResolvedValue(undefined),
    fetchMitreDefendTactics: vi.fn().mockResolvedValue(undefined),
    getControl: vi.fn().mockResolvedValue(null),
    getCountermeasuresFromControl: vi.fn().mockResolvedValue([]),
    getClass: vi.fn().mockResolvedValue(null),
    getAttributesFromClassRelationship: vi.fn().mockResolvedValue(null),
    // handler-only methods — safe no-op defaults so any stray reference is inert
    deleteControl: vi.fn(),
    deleteCountermeasure: vi.fn(),
    disposeCountermeasure: vi.fn(),
    clearCountermeasureDisposition: vi.fn(),
    setInstantiationAttributes: vi.fn(),
    supersedeCountermeasure: vi.fn(),
    updateControl: vi.fn(),
    controls: [] as unknown[],
  },
  classStore: { listResults: [] as unknown[], matchResults: [] as unknown[] },
  auth: { user: { id: 'u1' } },
}))

vi.mock('@/stores/controlsStore', () => ({ useControlsStore: () => mocks.store }))
vi.mock('@/stores/classSuggestionsStore', () => ({ useClassSuggestionsStore: () => mocks.classStore }))
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => mocks.auth }))

import ControlDialog from '../ControlDialog.vue'

interface Exposed {
  onCountermeasureFailed: () => void
  onCountermeasureCreated: () => void
  showCountermeasureDialog: boolean
  showClassControl: (classId: string) => Promise<void>
  showClassControlDialog: boolean
  lastLoadedAttributes: object
  attributesSchema: object | null
  attributesUiSchema: object | null
  attributesLoading: boolean
  attributesTemplateWarning: boolean
}

const mountDialog = () =>
  shallowMount(ControlDialog, {
    props: { show: true, id: 'ctrl-1', showFileActions: false },
  })

const vm = (wrapper: ReturnType<typeof mountDialog>) => wrapper.vm as unknown as Exposed

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ControlDialog — countermeasure failed-save lifecycle', () => {
  it('keeps the countermeasure dialog open on a failed save (input survives)', () => {
    const wrapper = mountDialog()
    vm(wrapper).showCountermeasureDialog = true

    vm(wrapper).onCountermeasureFailed()

    // Regression: the wipe used to set this false, unmounting the v-if child.
    expect(vm(wrapper).showCountermeasureDialog).toBe(true)
  })

  it('still closes the dialog on a successful save (happy path unchanged)', () => {
    const wrapper = mountDialog()
    vm(wrapper).showCountermeasureDialog = true

    vm(wrapper).onCountermeasureCreated()

    expect(vm(wrapper).showCountermeasureDialog).toBe(false)
  })
})

describe('ControlDialog — attribute class-bleed guard (showClassControl)', () => {
  it('resets the buffer/schema before load and defers opening until data arrives', async () => {
    const classB = { template: { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } } }
    const classBAttrs = { severity: 'high', 'meta.owner': 'sec' }
    mocks.store.getClass.mockResolvedValue(classB)
    mocks.store.getAttributesFromClassRelationship.mockResolvedValue(classBAttrs)

    const wrapper = mountDialog()
    // Seed a previous class's state that must NOT bleed into class B.
    vm(wrapper).lastLoadedAttributes = { legacy: 'classA-value' }

    const pending = vm(wrapper).showClassControl('classB')

    // Synchronous prefix (before any await) must have cleared state and NOT opened the dialog.
    expect(vm(wrapper).lastLoadedAttributes).toEqual({})
    expect(vm(wrapper).attributesLoading).toBe(true)
    expect(vm(wrapper).showClassControlDialog).toBe(false)

    await pending

    // After load: the new class's data is present, the dialog opens, loading clears.
    expect(vm(wrapper).lastLoadedAttributes).toEqual(unflattenProperties(classBAttrs))
    expect(vm(wrapper).showClassControlDialog).toBe(true)
    expect(vm(wrapper).attributesLoading).toBe(false)
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledWith({
      classId: 'classB',
      componentId: 'ctrl-1',
    })
  })

  it('warns and clears the schema for an invalid/missing template (no stale bleed)', async () => {
    mocks.store.getClass.mockResolvedValue({ template: null })

    const wrapper = mountDialog()
    // Seed a previous class's schema refs that must be cleared, not reused.
    vm(wrapper).attributesSchema = { type: 'object' }
    vm(wrapper).attributesUiSchema = { type: 'VerticalLayout' }

    await vm(wrapper).showClassControl('classC')

    expect(vm(wrapper).attributesSchema).toBeNull()
    expect(vm(wrapper).attributesUiSchema).toBeNull()
    expect(vm(wrapper).attributesTemplateWarning).toBe(true)
    // The dialog still opens (finally) — with a warning, not the previous class's form.
    expect(vm(wrapper).showClassControlDialog).toBe(true)
    // A missing template must never trigger an attribute fetch.
    expect(mocks.store.getAttributesFromClassRelationship).not.toHaveBeenCalled()
  })

  it('warns instead of opening a silent blank form when the class load throws', async () => {
    mocks.store.getClass.mockRejectedValue(new Error('network unreachable'))

    const wrapper = mountDialog()
    await vm(wrapper).showClassControl('classD')

    // The catch surfaces a warning; the finally still opens the (cleared) dialog.
    expect(vm(wrapper).attributesTemplateWarning).toBe(true)
    expect(vm(wrapper).attributesSchema).toBeNull()
    expect(vm(wrapper).showClassControlDialog).toBe(true)
    expect(vm(wrapper).attributesLoading).toBe(false)
  })
})
