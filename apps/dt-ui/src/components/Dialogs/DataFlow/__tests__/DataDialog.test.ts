// @vitest-environment happy-dom
/**
 * DataDialog "Discard and change class" must revert ALL edited fields.
 *
 * onClassChangeDiscard used to restore only name/description, then apply the new class and
 * submit — so the discarded sensitivity/regulatoryFlags were persisted and dirty attributes
 * were written under the NEW class relationship. It now reuses revertPending (full revert
 * from initialState) plus a synchronous attributesDirty=false, so onSubmit persists only the
 * class change with the ORIGINAL general fields and skips saveAttributes.
 *
 * Harness mirrors ControlDialog.test.ts: no Pinia, stores mocked directly, shallowMount
 * auto-stubs children, internals reached via DataDialog's defineExpose seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'

const DATA_ITEM = {
  name: 'N',
  description: 'D',
  dataClass: { id: 'classA' },
  sensitivity: 'LOW',
  regulatoryFlags: ['GDPR'],
  origin: 'THIRD_PARTY',
  isCredential: false,
}

const mocks = vi.hoisted(() => ({
  flow: {
    getDataItem: vi.fn(),
    getDataClass: vi.fn().mockResolvedValue(null),
    getExposures: vi.fn().mockResolvedValue([]),
    getAttributesFromClassRelationship: vi.fn().mockResolvedValue({}),
    setInstantiationAttributesWithStaleCount: vi.fn().mockResolvedValue(1),
    updateDataItem: vi.fn().mockResolvedValue(true),
    createDataItem: vi.fn().mockResolvedValue({ id: 'd1' }),
    selectedItem: { id: 'el1' } as { id: string } | null,
    modelId: 'm1',
  },
  issue: {},
  router: { push: vi.fn() },
}))

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => mocks.flow }))
vi.mock('@/stores/issueStore', () => ({ useIssueStore: () => mocks.issue }))
vi.mock('vue-router', () => ({ useRouter: () => mocks.router }))
// Several stubbed-out children (AttributesForm, IssueDialog→IssueCard) statically import
// @jsonforms/vue-vuetify, which pulls Vuetify component CSS that Vitest's node env can't parse.
// Mock the package to cut that chain for every importer in the graph at once.
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [], ControlWrapper: {}, useVuetifyControl: () => ({}) }))

import DataDialog from '../DataDialog.vue'

interface Exposed {
  onClassChangeDiscard: () => Promise<void>
  onSubmit: () => Promise<void>
  name: string
  description: string
  dataClass: string | null
  sensitivity: string | null
  regulatoryFlags: string[]
  origin: string | null
  isCredential: boolean | null
  attributesDirty: boolean
  pendingClassId: string | null
  initialState: { name: string; description: string; dataClass: string | null; sensitivity: string | null; regulatoryFlags: string[]; origin: string | null; isCredential: boolean | null }
  lastLoadedAttributes: object
  pendingAttributes: object
  saveAttributes: () => Promise<void>
  onAttributesChanged: (data: object) => void
}

// v-hover exposes a scoped slot ({ isHovering, props }); the shallowMount auto-stub doesn't
// supply those, so the template's destructure throws. Stub it to pass inert slot props.
const stubs = {
  'v-hover': { template: '<div><slot :isHovering="false" :props="{}" /></div>' },
}

const mountDialog = () =>
  shallowMount(DataDialog, {
    props: { show: true, class: 'classA', action: 'edit', id: 'd1' },
    global: { stubs },
  })

const vm = (w: ReturnType<typeof mountDialog>) => w.vm as unknown as Exposed

beforeEach(() => {
  vi.clearAllMocks()
  mocks.flow.getDataItem.mockReturnValue({ ...DATA_ITEM, regulatoryFlags: [...DATA_ITEM.regulatoryFlags] })
})

describe('DataDialog — discard-and-change-class reverts every edited field', () => {
  it('persists only the class change with the original sensitivity/flags and no stale attributes', async () => {
    const wrapper = mountDialog()
    await flushPromises() // let onMounted getCurrentDataItem seed initialState

    // The user edited sensitivity/flags/attributes, then chose a different class + Discard.
    vm(wrapper).sensitivity = 'HIGH'
    vm(wrapper).regulatoryFlags = ['GDPR', 'HIPAA']
    vm(wrapper).attributesDirty = true
    vm(wrapper).pendingClassId = 'classB'

    await vm(wrapper).onClassChangeDiscard()

    // Only the class change is persisted, and the discarded edits are no longer merely CORRECT in the
    // payload — they are absent from it. A save now carries what the user changed, and after the revert
    // the only thing that changed is the class, so there is nothing left for a discard to get right.
    expect(mocks.flow.updateDataItem).toHaveBeenCalledTimes(1)
    expect(mocks.flow.updateDataItem).toHaveBeenCalledWith({ dataItemId: 'd1', classId: 'classB' })
    // The discarded dirty attributes are NOT flushed under the new class.
    expect(mocks.flow.setInstantiationAttributesWithStaleCount).not.toHaveBeenCalled()
  })
})

/**
 * A save carries what the user changed.
 *
 * Everything in `initialState` is a snapshot taken when the dialog opened, so a save that writes it back
 * asserts a view of the item that may be minutes old. For sensitivity and the regulatory flags it was
 * worse than stale: the writer read an ABSENCE as a clear, so sending them was the only way not to wipe
 * them — and sending them is what reverted whatever anybody else had set.
 *
 * The negative assertions carry the finding. Without them every test here is satisfied by a dialog that
 * still sends all five fields, since all five includes the one being asserted.
 */
describe('DataDialog — a save carries only what changed', () => {
  const lastSave = () => mocks.flow.updateDataItem.mock.calls.at(-1)![0]

  /** Mount, let the seed land, and forget the mount-time noise. */
  const ready = async () => {
    const w = mountDialog()
    await flushPromises()
    mocks.flow.updateDataItem.mockClear()
    return w
  }

  it('sends the name alone on a rename', async () => {
    const w = await ready()
    vm(w).name = 'renamed'

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', name: 'renamed' })
  })

  it('sends the description alone', async () => {
    const w = await ready()
    vm(w).description = 'edited'

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', description: 'edited' })
  })

  it('sends the sensitivity alone, and does not re-assert the name beside it', async () => {
    const w = await ready()
    vm(w).sensitivity = 'HIGH'

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', sensitivity: 'HIGH' })
  })

  // A clear is an edit, and it has to survive as one all the way to the writer — an absence there means
  // the opposite.
  it('sends an explicit null when the sensitivity is cleared', async () => {
    const w = await ready()
    vm(w).sensitivity = null

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', sensitivity: null })
  })

  it('sends an explicit empty list when the flags are cleared', async () => {
    const w = await ready()
    vm(w).regulatoryFlags = []

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', regulatoryFlags: [] })
  })

  // A class change used to drag the other four fields with it, and a class was sent on every save of
  // any field — so each one attempted a rebind it had no reason to.
  it('sends the class alone when only the class changed', async () => {
    const w = await ready()
    vm(w).dataClass = 'classB'

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', classId: 'classB' })
  })

  it('carries two edits together when there are two', async () => {
    const w = await ready()
    vm(w).name = 'renamed'
    vm(w).regulatoryFlags = ['GDPR', 'HIPAA']

    await vm(w).onSubmit()

    expect(lastSave()).toEqual({ dataItemId: 'd1', name: 'renamed', regulatoryFlags: ['GDPR', 'HIPAA'] })
  })

  it('does not call the store at all when nothing changed', async () => {
    const w = await ready()

    await vm(w).onSubmit()

    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
  })
})

describe('DataDialog — origin and credential', () => {
  const lastSave = () => mocks.flow.updateDataItem.mock.calls.at(-1)![0]
  const ready = async () => {
    const w = mountDialog()
    await flushPromises()
    mocks.flow.updateDataItem.mockClear()
    return w
  }

  it('seeds both from the loaded item and snapshots them, so nothing is dirty on open', async () => {
    const w = await ready()
    expect(vm(w).origin).toBe('THIRD_PARTY')
    expect(vm(w).isCredential).toBe(false)
    expect(vm(w).initialState).toMatchObject({ origin: 'THIRD_PARTY', isCredential: false })
    await vm(w).onSubmit()
    expect(mocks.flow.updateDataItem).not.toHaveBeenCalled()
  })

  it('sends the origin alone when only the origin changed', async () => {
    const w = await ready()
    vm(w).origin = 'ARBITRARY_PUBLIC'
    await vm(w).onSubmit()
    expect(lastSave()).toEqual({ dataItemId: 'd1', origin: 'ARBITRARY_PUBLIC' })
  })

  it('sends an explicit null when the origin or the credential flag is cleared', async () => {
    const w = await ready()
    vm(w).origin = null
    vm(w).isCredential = null
    await vm(w).onSubmit()
    expect(lastSave()).toEqual({ dataItemId: 'd1', origin: null, isCredential: null })
  })

  it('sends true when the item is marked a credential', async () => {
    const w = await ready()
    vm(w).isCredential = true
    await vm(w).onSubmit()
    expect(lastSave()).toEqual({ dataItemId: 'd1', isCredential: true })
  })
})

describe('DataDialog — saving attributes', () => {
  const prepare = async (result: object) => {
    mocks.flow.setInstantiationAttributesWithStaleCount.mockResolvedValue(result)
    const w = mountDialog()
    await flushPromises()
    vm(w).dataClass = 'classA'
    vm(w).lastLoadedAttributes = { encrypted: true, owner: 'ops' }
    vm(w).pendingAttributes = { owner: 'ops' }
    vm(w).attributesDirty = true
    return w
  }

  it('sends an answer taken back as null, and makes what was saved the new baseline', async () => {
    const w = await prepare({ success: true, staleFlippedCount: 0 })
    await vm(w).saveAttributes()
    expect(mocks.flow.setInstantiationAttributesWithStaleCount).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { owner: 'ops', encrypted: null } }),
    )
    expect(vm(w).lastLoadedAttributes).toEqual({ owner: 'ops' })
  })

  it('keeps the baseline when the server refuses the save, so a retry sends the cleared answer again', async () => {
    const w = await prepare({ success: false, staleFlippedCount: null })
    await vm(w).saveAttributes()
    expect(vm(w).lastLoadedAttributes).toEqual({ encrypted: true, owner: 'ops' })
    expect(vm(w).attributesDirty).toBe(true)
    expect(w.emitted('update:snackBar')?.at(-1)?.[0]).toMatchObject({ color: 'error' })
  })

  it('keeps an answer cleared while a save is in flight unsaved, and sends its clearing on the next save', async () => {
    const w = await prepare({ success: true, staleFlippedCount: 0 })
    let finish: (v: unknown) => void = () => {}
    mocks.flow.setInstantiationAttributesWithStaleCount.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const saving = vm(w).saveAttributes()
    vm(w).onAttributesChanged({})
    finish({ success: true, staleFlippedCount: 0 })
    await saving
    expect(vm(w).lastLoadedAttributes).toEqual({ owner: 'ops' })
    expect(vm(w).attributesDirty).toBe(true)
    await vm(w).saveAttributes()
    expect(mocks.flow.setInstantiationAttributesWithStaleCount).toHaveBeenLastCalledWith(
      expect.objectContaining({ attributes: { owner: null } }),
    )
    expect(vm(w).attributesDirty).toBe(false)
  })
})
