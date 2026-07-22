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
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [] }))

import DataDialog from '../DataDialog.vue'

interface Exposed {
  onClassChangeDiscard: () => Promise<void>
  sensitivity: string | null
  regulatoryFlags: string[]
  attributesDirty: boolean
  pendingClassId: string | null
  initialState: { name: string; description: string; dataClass: string | null; sensitivity: string | null; regulatoryFlags: string[] }
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

    // Only the class change is persisted — with the ORIGINAL (initialState) sensitivity/flags,
    // never the discarded HIGH / HIPAA edits.
    expect(mocks.flow.updateDataItem).toHaveBeenCalledTimes(1)
    expect(mocks.flow.updateDataItem).toHaveBeenCalledWith(
      expect.objectContaining({
        dataItemId: 'd1',
        classId: 'classB',
        sensitivity: 'LOW',
        regulatoryFlags: ['GDPR'],
      }),
    )
    // The discarded dirty attributes are NOT flushed under the new class.
    expect(mocks.flow.setInstantiationAttributesWithStaleCount).not.toHaveBeenCalled()
  })
})
