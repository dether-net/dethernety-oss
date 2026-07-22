/**
 * flowStore create-path staleness guard.
 *
 * createDataFlow / createDataItem optimistically inject their result AFTER the
 * await. If the model was switched mid-flight, the write would land in the new
 * model's canvas. Both now snapshot modelId before the await (mirroring
 * fetchData's activeModelLoad guard) and skip the local store mutation when the
 * model changed — while still returning the item truthfully (the backend create
 * succeeded).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const createDataFlowMock = vi.fn()
const createDataItemMock = vi.fn()

class DtUtilsStub {
  handleError = vi.fn()
  deepMerge(target: any, updates: any) { return Object.assign(target, updates) }
}

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class {},
  DtClass: class {},
  DtComponent: class {},
  DtControl: class {},
  DtDataflow: class { createDataFlow = createDataFlowMock },
  DtDataItem: class { createDataItem = createDataItemMock },
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
})

describe('flowStore.createDataFlow — model-switch staleness guard', () => {
  it('does not inject the edge when the model switched during the create', async () => {
    let resolveCreate: (v: unknown) => void = () => {}
    createDataFlowMock.mockReturnValueOnce(new Promise(r => { resolveCreate = r }))

    const store = useFlowStore()
    store.setModelId({ newModelId: 'model-A' })
    const pending = store.createDataFlow({ newEdge: { id: 'e-tmp' } as any, classId: 'c1' })

    store.setModelId({ newModelId: 'model-B' })   // user navigated away mid-flight
    resolveCreate({ id: 'edge-1', data: {} })
    const ok = await pending

    expect(ok).toBe(true)                          // the create succeeded — reported truthfully
    expect(store.edges.some(e => e.id === 'edge-1')).toBe(false)  // but not injected into model-B
    expect(store.selectedItem?.id).not.toBe('edge-1')
  })

  it('injects and selects the edge when the model is unchanged', async () => {
    createDataFlowMock.mockResolvedValueOnce({ id: 'edge-2', data: {} })

    const store = useFlowStore()
    store.setModelId({ newModelId: 'model-A' })
    const ok = await store.createDataFlow({ newEdge: { id: 'e-tmp' } as any, classId: 'c1' })

    expect(ok).toBe(true)
    expect(store.edges.some(e => e.id === 'edge-2')).toBe(true)
    expect(store.selectedItem?.id).toBe('edge-2')
  })
})

describe('flowStore.createDataItem — model-switch staleness guard', () => {
  it('does not push the item when the model switched, but still returns it', async () => {
    let resolveCreate: (v: unknown) => void = () => {}
    createDataItemMock.mockReturnValueOnce(new Promise(r => { resolveCreate = r }))

    const store = useFlowStore()
    store.setModelId({ newModelId: 'model-A' })
    const pending = store.createDataItem({
      name: 'Item', description: 'd', classId: null, elementId: 'el-1',
    })

    store.setModelId({ newModelId: 'model-B' })
    resolveCreate({ id: 'di-1' })
    const result = await pending

    expect(result?.id).toBe('di-1')                          // create succeeded
    expect(store.dataItems.some(d => d.id === 'di-1')).toBe(false)  // not injected into model-B
  })

  it('pushes the item when the model is unchanged', async () => {
    createDataItemMock.mockResolvedValueOnce({ id: 'di-2' })

    const store = useFlowStore()
    store.setModelId({ newModelId: 'model-A' })
    const result = await store.createDataItem({
      name: 'Item', description: 'd', classId: null, elementId: 'el-1',
    })

    expect(result?.id).toBe('di-2')
    expect(store.dataItems.some(d => d.id === 'di-2')).toBe(true)
  })
})
