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
import { flushPromises, shallowMount } from '@vue/test-utils'
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
  storedAttributeKeys: Record<string, unknown>
  attributesSchema: object | null
  attributesUiSchema: object | null
  attributesLoading: boolean
  attributesTemplateWarning: boolean
  saveAttributes: (pending: object) => Promise<boolean>
  onAttributesSaveAndClose: (pending: object) => Promise<void>
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
    vm(wrapper).storedAttributeKeys = { legacy: 'classA-value', 'legacy[0]': 'x' }

    const pending = vm(wrapper).showClassControl('classB')

    // Synchronous prefix (before any await) must have cleared state and NOT opened the dialog.
    expect(vm(wrapper).lastLoadedAttributes).toEqual({})
    expect(vm(wrapper).storedAttributeKeys).toEqual({})
    expect(vm(wrapper).attributesLoading).toBe(true)
    expect(vm(wrapper).showClassControlDialog).toBe(false)

    await pending

    // After load: the new class's data is present, the dialog opens, loading clears.
    expect(vm(wrapper).lastLoadedAttributes).toEqual(unflattenProperties(classBAttrs))
    // The stored keys are kept as they came, so a save can clear the ones it does not send.
    expect(vm(wrapper).storedAttributeKeys).toEqual(classBAttrs)
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

  it('an earlier load that returns after a later one leaves the later class shown', async () => {
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    let finishA!: (v: unknown) => void
    mocks.store.getClass
      .mockImplementationOnce(() => new Promise((r) => { finishA = r }))
      .mockResolvedValueOnce({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValue({ owner: 'b-owner' })

    const wrapper = mountDialog()
    const loadingA = vm(wrapper).showClassControl('classA')
    await vm(wrapper).showClassControl('classB')
    finishA({ template })
    await loadingA

    expect(vm(wrapper).storedAttributeKeys).toEqual({ owner: 'b-owner' })
    expect(vm(wrapper).lastLoadedAttributes).toEqual({ owner: 'b-owner' })
    // Only class B's load asked for its answers; class A's late result stopped there.
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(1)
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledWith({ classId: 'classB', componentId: 'ctrl-1' })
    expect(vm(wrapper).showClassControlDialog).toBe(true)
    expect(vm(wrapper).attributesLoading).toBe(false)
  })

  it('an earlier load that fails after a later one does not warn on the later class', async () => {
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    let failA!: (e: Error) => void
    mocks.store.getClass
      .mockImplementationOnce(() => new Promise((_r, reject) => { failA = reject }))
      .mockResolvedValueOnce({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValue(null)

    const wrapper = mountDialog()
    const loadingA = vm(wrapper).showClassControl('classA')
    await vm(wrapper).showClassControl('classB')
    failA(new Error('network unreachable'))
    await loadingA

    expect(vm(wrapper).attributesTemplateWarning).toBe(false)
    expect(vm(wrapper).attributesSchema).toEqual(template.schema)
  })
})

describe('ControlDialog — saving attributes', () => {
  it('sends an answer taken back as null, so the server clears it, and keeps the others', async () => {
    mocks.store.setInstantiationAttributes.mockResolvedValue(true)
    const w = mountDialog()
    vm(w).lastLoadedAttributes = { mfa_enforced: true, owner: 'ops' }
    await vm(w).saveAttributes({ owner: 'ops' })
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { owner: 'ops', mfa_enforced: null } }),
    )
    // What the save stored is the new baseline: nothing to clear next time.
    expect(vm(w).lastLoadedAttributes).toEqual({ owner: 'ops' })
    expect(vm(w).storedAttributeKeys).toEqual({ owner: 'ops' })
  })

  it('a failed save keeps the baseline and the stored keys, so the next save still clears them', async () => {
    for (const fail of [() => Promise.resolve(false), () => Promise.reject(new Error('down'))]) {
      mocks.store.setInstantiationAttributes.mockImplementationOnce(fail)
      const w = mountDialog()
      vm(w).storedAttributeKeys = { 'feeds[0]': 'osv', owner: 'ops' }
      vm(w).lastLoadedAttributes = { feeds: ['osv'], owner: 'ops' }
      expect(await vm(w).saveAttributes({ owner: 'sec' })).toBe(false)
      expect(vm(w).storedAttributeKeys).toEqual({ 'feeds[0]': 'osv', owner: 'ops' })
      expect(vm(w).lastLoadedAttributes).toEqual({ feeds: ['osv'], owner: 'ops' })
    }
  })

  it('clears stored list entries written by another client when it saves the whole list, and forgets them', async () => {
    mocks.store.setInstantiationAttributes.mockResolvedValue(true)
    const w = mountDialog()
    vm(w).storedAttributeKeys = { feeds: ['nvd'], 'feeds[0]': 'osv', 'feeds[1]': 'ghsa', owner: 'ops' }
    vm(w).lastLoadedAttributes = { feeds: ['nvd'], owner: 'ops' }
    await vm(w).saveAttributes({ feeds: ['nvd', 'kev'], owner: 'ops' })
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { feeds: ['nvd', 'kev'], owner: 'ops', 'feeds[0]': null, 'feeds[1]': null } }),
    )
    expect(vm(w).storedAttributeKeys).toEqual({ feeds: ['nvd', 'kev'], owner: 'ops' })
  })

  it('a list taken back clears its stored entries too, not only the whole list it showed', async () => {
    mocks.store.setInstantiationAttributes.mockResolvedValue(true)
    const w = mountDialog()
    vm(w).storedAttributeKeys = { 'feeds[0]': 'osv', 'feeds[1]': 'ghsa' }
    vm(w).lastLoadedAttributes = { feeds: ['osv', 'ghsa'] }
    await vm(w).saveAttributes({})
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { feeds: null, 'feeds[0]': null, 'feeds[1]': null } }),
    )
  })

  it('a save that returns after another class is shown leaves the baseline of that class alone', async () => {
    let finish!: (v: boolean) => void
    mocks.store.setInstantiationAttributes.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ 'tags[0]': 'b' })
    await vm(w).showClassControl('classA')
    const saving = vm(w).saveAttributes({ owner: 'sec' })
    await vm(w).showClassControl('classB')
    finish(true)
    await saving
    expect(vm(w).lastLoadedAttributes).toEqual({ tags: ['b'] })
    expect(vm(w).storedAttributeKeys).toEqual({ 'tags[0]': 'b' })
  })

  it('a class reopened while its save is in flight reads its answers only once the save has settled', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    await vm(w).showClassControl('classA')
    let finish!: (v: boolean) => void
    mocks.store.setInstantiationAttributes.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const saving = vm(w).saveAttributes({ owner: 'sec', mfa: true })
    let read!: (v: object) => void
    mocks.store.getAttributesFromClassRelationship.mockImplementationOnce(() => new Promise((r) => { read = r }))
    const reopening = vm(w).showClassControl('classA')
    await flushPromises()
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(1)
    finish(true)
    await saving
    await flushPromises()
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(2)
    // The reopen reset the form and reads the answers itself: the save does not set them.
    expect(vm(w).lastLoadedAttributes).toEqual({})
    expect(vm(w).storedAttributeKeys).toEqual({})
    read({ owner: 'sec', mfa: true })
    await reopening
    expect(vm(w).lastLoadedAttributes).toEqual({ owner: 'sec', mfa: true })
    expect(vm(w).storedAttributeKeys).toEqual({ owner: 'sec', mfa: true })
  })

  it('a second save waits for the first, and clears a key only the first wrote', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    await vm(w).showClassControl('classA')
    let finishFirst!: (v: boolean) => void
    mocks.store.setInstantiationAttributes
      .mockImplementationOnce(() => new Promise((r) => { finishFirst = r }))
      .mockResolvedValueOnce(true)
    const first = vm(w).saveAttributes({ owner: 'ops', k: 'x' })
    // The person takes k back and adds m before the first save returns.
    const second = vm(w).saveAttributes({ owner: 'ops', m: 'y' })
    await flushPromises()
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledTimes(1)
    // A waiting save goes to the control it was made for.
    await w.setProps({ id: 'ctrl-2' })
    finishFirst(true)
    await first
    await second
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledTimes(2)
    expect(mocks.store.setInstantiationAttributes).toHaveBeenLastCalledWith(
      expect.objectContaining({ componentId: 'ctrl-1', attributes: { owner: 'ops', m: 'y', k: null } }),
    )
    expect(vm(w).lastLoadedAttributes).toEqual({ owner: 'ops', m: 'y' })
    expect(vm(w).storedAttributeKeys).toEqual({ owner: 'ops', m: 'y' })
  })

  it('a save waiting for an earlier one still clears what that one wrote once the class is reopened', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops', old: 'z' })
    await vm(w).showClassControl('classA')
    let finishFirst!: (v: boolean) => void
    mocks.store.setInstantiationAttributes
      .mockImplementationOnce(() => new Promise((r) => { finishFirst = r }))
      .mockResolvedValueOnce(true)
    const first = vm(w).saveAttributes({ owner: 'sec', k: 'x' })
    const second = vm(w).saveAttributes({ owner: 'sec' })
    // The person closes the form and reopens the class: the reopen resets the form and waits for both saves.
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'sec' })
    const reopening = vm(w).showClassControl('classA')
    await flushPromises()
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(1)
    finishFirst(true)
    await first
    await second
    // k, which only the first save wrote, is cleared; old, which the first save cleared, is not sent again.
    expect(mocks.store.setInstantiationAttributes).toHaveBeenLastCalledWith(
      expect.objectContaining({ attributes: { owner: 'sec', k: null } }),
    )
    await reopening
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(2)
    expect(vm(w).lastLoadedAttributes).toEqual({ owner: 'sec' })
  })

  it('a save after a failed one clears from the baseline the failed one was made from', async () => {
    const failures: Array<(settle: { ok: (v: boolean) => void, fail: (e: Error) => void }) => void> = [
      ({ ok }) => ok(false),
      ({ fail }) => fail(new Error('down')),
    ]
    for (const failWith of failures) {
      const w = mountDialog()
      const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
      mocks.store.getClass.mockResolvedValue({ template })
      mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops', old: 'z' })
      await vm(w).showClassControl('classA')
      let settle!: { ok: (v: boolean) => void, fail: (e: Error) => void }
      mocks.store.setInstantiationAttributes
        .mockImplementationOnce(() => new Promise((ok, fail) => { settle = { ok, fail } }))
        .mockResolvedValueOnce(true)
      const first = vm(w).saveAttributes({ owner: 'ops' })
      const second = vm(w).saveAttributes({ owner: 'ops', m: 'y' })
      await flushPromises()
      failWith(settle)
      expect(await first).toBe(false)
      expect(await second).toBe(true)
      expect(mocks.store.setInstantiationAttributes).toHaveBeenLastCalledWith(
        expect.objectContaining({ attributes: { owner: 'ops', m: 'y', old: null } }),
      )
      w.unmount()
    }
  })

  it('a save of another class does not wait for a save of this one', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    await vm(w).showClassControl('classA')
    let finishA!: (v: boolean) => void
    mocks.store.setInstantiationAttributes
      .mockImplementationOnce(() => new Promise((r) => { finishA = r }))
      .mockResolvedValueOnce(true)
    const savingA = vm(w).saveAttributes({ owner: 'sec' })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ tier: 'gold' })
    await vm(w).showClassControl('classB')
    expect(await vm(w).saveAttributes({ tier: 'silver' })).toBe(true)
    expect(mocks.store.setInstantiationAttributes).toHaveBeenLastCalledWith(
      expect.objectContaining({ classId: 'classB', attributes: { tier: 'silver' } }),
    )
    finishA(true)
    expect(await savingA).toBe(true)
  })

  it('a save that settles first does not end the wait for a later save of the class', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    await vm(w).showClassControl('classA')
    let finishFirst!: (v: boolean) => void
    let finishSecond!: (v: boolean) => void
    mocks.store.setInstantiationAttributes
      .mockImplementationOnce(() => new Promise((r) => { finishFirst = r }))
      .mockImplementationOnce(() => new Promise((r) => { finishSecond = r }))
    const first = vm(w).saveAttributes({ owner: 'sec' })
    const second = vm(w).saveAttributes({ owner: 'sec', mfa: true })
    await flushPromises()
    finishFirst(true)
    await first
    // The second save is now sent.
    await flushPromises()
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'sec', mfa: true })
    const reopening = vm(w).showClassControl('classA')
    await flushPromises()
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(1)
    finishSecond(true)
    await second
    await reopening
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(2)
  })

  it('a reopen waiting for a save does not read once another class has been opened', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    await vm(w).showClassControl('classA')
    let finish!: (v: boolean) => void
    mocks.store.setInstantiationAttributes.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const saving = vm(w).saveAttributes({ owner: 'sec' })
    const reopening = vm(w).showClassControl('classA')
    // The reopen has its class and waits for the save.
    await flushPromises()
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ 'tags[0]': 'b' })
    await vm(w).showClassControl('classB')
    finish(true)
    await saving
    await reopening
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenCalledTimes(2)
    expect(mocks.store.getAttributesFromClassRelationship).toHaveBeenLastCalledWith({ classId: 'classB', componentId: 'ctrl-1' })
    expect(vm(w).lastLoadedAttributes).toEqual({ tags: ['b'] })
  })

  it('save and close closes the form it saved, and leaves a class opened meanwhile open', async () => {
    const w = mountDialog()
    const template = { schema: { type: 'object' }, uischema: { type: 'VerticalLayout' } }
    mocks.store.getClass.mockResolvedValue({ template })
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'ops' })
    await vm(w).showClassControl('classA')
    mocks.store.setInstantiationAttributes.mockResolvedValueOnce(true)
    await vm(w).onAttributesSaveAndClose({ owner: 'sec' })
    expect(vm(w).showClassControlDialog).toBe(false)

    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ owner: 'sec' })
    await vm(w).showClassControl('classA')
    let finish!: (v: boolean) => void
    mocks.store.setInstantiationAttributes.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const closing = vm(w).onAttributesSaveAndClose({ owner: 'dev' })
    // The person closes A's form while the save runs, and opens class B.
    vm(w).showClassControlDialog = false
    mocks.store.getAttributesFromClassRelationship.mockResolvedValueOnce({ 'tags[0]': 'b' })
    await vm(w).showClassControl('classB')
    expect(vm(w).showClassControlDialog).toBe(true)
    finish(true)
    await closing
    expect(vm(w).showClassControlDialog).toBe(true)
    expect(vm(w).lastLoadedAttributes).toEqual({ tags: ['b'] })
  })

  it('keeps a list as one value, so a shortened list replaces the stored one', async () => {
    mocks.store.setInstantiationAttributes.mockResolvedValue(true)
    const w = mountDialog()
    vm(w).lastLoadedAttributes = { feeds: ['nvd', 'osv'], mfa: true }
    await vm(w).saveAttributes({ feeds: ['nvd'], mfa: true })
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { feeds: ['nvd'], mfa: true } }),
    )
  })

  it('drops emptied list rows across the whole map, an earlier null-holding list included, and stores that as the baseline', async () => {
    mocks.store.setInstantiationAttributes.mockResolvedValue(true)
    const w = mountDialog()
    vm(w).lastLoadedAttributes = { feeds: ['nvd', 'osv'], owners: ['a', null] }
    const cleared: string[] = ['nvd']
    cleared[2] = 'ghsa'
    await vm(w).saveAttributes({ feeds: cleared, owners: ['a', null], tags: [''] })
    expect(mocks.store.setInstantiationAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { feeds: ['nvd', 'ghsa'], owners: ['a'], tags: [''] } }),
    )
    expect(vm(w).lastLoadedAttributes).toEqual({ feeds: ['nvd', 'ghsa'], owners: ['a'], tags: [''] })
  })
})
