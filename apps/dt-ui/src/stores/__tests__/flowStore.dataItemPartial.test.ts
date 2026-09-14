/**
 * A data-item update is partial by the time it leaves the store, and three states have to stay distinct
 * all the way down: a value writes the field, an explicit `null` CLEARS it, and an absence leaves it
 * alone. The store used to flatten the middle one into the last — `sensitivity ?? undefined` — which was
 * harmless only while an absence meant a clear at the writer. It does not any more, so that flattening
 * would have turned "clear the classification" into a no-op.
 *
 * The validator is the other thing that travels with a partial contract: it cannot demand a name that is
 * not being written, and it must still demand one where a name is genuinely required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const updateDataItemMock = vi.fn()
const createDataItemMock = vi.fn()

class DtUtilsStub {
  handleError = vi.fn()
  deepMerge(target: any) { return target }
}

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class {},
  DtClass: class {},
  DtComponent: class {},
  DtControl: class {},
  DtDataflow: class {},
  DtDataItem: class {
    updateDataItem = updateDataItemMock
    createDataItem = createDataItemMock
  },
  DtExposure: class {},
  DtMitreAttack: class {},
  DtModel: class {},
  DtModule: class {},
  DtUtils: DtUtilsStub,
  executeSupersedeFlow: vi.fn(),
}))
vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFlowStore: typeof import('../flowStore').useFlowStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useFlowStore = (await import('../flowStore')).useFlowStore
  updateDataItemMock.mockResolvedValue({
    dataItem: { id: 'd1', name: 'D' }, bindingResult: null, residualOk: true,
  })
  createDataItemMock.mockResolvedValue({ id: 'd1' })
})

const argsOf = () => updateDataItemMock.mock.calls[0][0]

describe('flowStore.updateDataItem — only what it is given crosses the boundary', () => {
  it('passes a single field through and nothing else', async () => {
    const store = useFlowStore()
    await store.updateDataItem({ dataItemId: 'd1', name: 'renamed' })

    expect(argsOf()).toEqual({ dataItemId: 'd1', name: 'renamed' })
  })

  it('does not pass a key that was not supplied, even as undefined', async () => {
    const store = useFlowStore()
    await store.updateDataItem({ dataItemId: 'd1', description: 'edited' })

    for (const key of ['name', 'classId', 'sensitivity', 'regulatoryFlags']) {
      expect(argsOf()).not.toHaveProperty(key)
    }
  })

  // The one the store used to lose. `null` is an edit; `undefined` is a caller that is not writing.
  it('keeps a cleared sensitivity as an explicit null rather than dropping it', async () => {
    const store = useFlowStore()
    await store.updateDataItem({ dataItemId: 'd1', sensitivity: null })

    expect(argsOf()).toEqual({ dataItemId: 'd1', sensitivity: null })
  })

  it('keeps a cleared flag list as an explicit empty list', async () => {
    const store = useFlowStore()
    await store.updateDataItem({ dataItemId: 'd1', regulatoryFlags: [] })

    expect(argsOf()).toEqual({ dataItemId: 'd1', regulatoryFlags: [] })
  })

  it('still carries a class change, including an unassign', async () => {
    const store = useFlowStore()
    await store.updateDataItem({ dataItemId: 'd1', classId: null })

    expect(argsOf()).toEqual({ dataItemId: 'd1', classId: null })
  })
})

describe('flowStore — validation follows the partial contract', () => {
  it('accepts an update that does not write the name at all', async () => {
    const store = useFlowStore()
    expect(await store.updateDataItem({ dataItemId: 'd1', sensitivity: 'HIGH' })).toBe(true)
    expect(updateDataItemMock).toHaveBeenCalled()
  })

  it('still refuses a name that is supplied and blank', async () => {
    const store = useFlowStore()
    expect(await store.updateDataItem({ dataItemId: 'd1', name: '  ' })).toBe(false)
    expect(updateDataItemMock).not.toHaveBeenCalled()
  })

  // The control on the shared validator: create still demands a name, because create is where one is
  // genuinely required and the two paths run through the same function.
  it('still refuses a create with no name', async () => {
    const store = useFlowStore()

    // Create reports a validation failure as a null return, not a rejection — the point here is that
    // the writer is never reached, and that the guard survived the update path becoming partial.
    expect(await store.createDataItem({ description: '', classId: null, elementId: 'el1' } as any)).toBeNull()
    expect(createDataItemMock).not.toHaveBeenCalled()
    expect(store.errors.createDataItem).toBeDefined()
  })
})
