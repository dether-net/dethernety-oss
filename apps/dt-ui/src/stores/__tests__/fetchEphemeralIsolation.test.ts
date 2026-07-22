/**
 * Ephemeral / non-publishing fetch isolation.
 *
 * `ContentSelectDialog` calls `fetchModels({ ephemeral: true })` / `fetchControls({ ephemeral: true })`
 * purely for the returned array. Those calls must NOT participate in the publish-generation race,
 * or an ephemeral fetch would bump the gen counter and suppress an in-flight grid fetch's write —
 * blanking the grid on a *successful* load — and an ephemeral failure would poison the grid error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const getModelsMock = vi.fn()
const getControlsMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtModel: class { getModels = getModelsMock },
  DtModule: class {},
  DtControl: class { getControls = getControlsMock },
  DtClass: class {},
  DtCountermeasure: class {},
  DtMitreAttack: class {},
  DtMitreDefend: class {},
  DtUtils: class {},
  executeSupersedeCountermeasureFlow: vi.fn(),
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useModelsStore: typeof import('../modelsStore').useModelsStore
let useControlsStore: typeof import('../controlsStore').useControlsStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useModelsStore = (await import('../modelsStore')).useModelsStore
  useControlsStore = (await import('../controlsStore')).useControlsStore
})

describe('modelsStore.fetchModels — ephemeral isolation', () => {
  it('an ephemeral fetch does not supersede an in-flight grid publish', async () => {
    let resolveGrid: (v: unknown) => void = () => {}
    getModelsMock
      .mockReturnValueOnce(new Promise(r => { resolveGrid = r })) // grid (gen 1), still pending
      .mockResolvedValueOnce([{ id: 'E' }])                        // ephemeral, resolves now

    const store = useModelsStore()
    const grid = store.fetchModels({ folderId: 'A' })              // publishing, in flight
    const eph = store.fetchModels({ folderId: 'A', ephemeral: true })

    expect(await eph).toEqual([{ id: 'E' }])
    expect(store.models).toEqual([])                               // ephemeral did not publish

    resolveGrid([{ id: 'G' }])
    await grid
    expect(store.models).toEqual([{ id: 'G' }])                    // grid publish NOT superseded
  })

  it('an ephemeral fetch failure does not touch shared grid error state', async () => {
    getModelsMock.mockRejectedValueOnce(new Error('boom'))
    const store = useModelsStore()
    const result = await store.fetchModels({ folderId: 'A', ephemeral: true })
    expect(result).toEqual([])
    expect(store.error).toBe('')
    expect(store.fetchModelsError).toBe('')
  })
})

describe('controlsStore.fetchControls — ephemeral isolation', () => {
  it('an ephemeral fetch does not supersede an in-flight grid publish', async () => {
    let resolveGrid: (v: unknown) => void = () => {}
    getControlsMock
      .mockReturnValueOnce(new Promise(r => { resolveGrid = r }))
      .mockResolvedValueOnce([{ id: 'E' }])

    const store = useControlsStore()
    const grid = store.fetchControls({ folderId: 'A' })
    const eph = store.fetchControls({ folderId: 'A', ephemeral: true })

    expect(await eph).toEqual([{ id: 'E' }])
    expect(store.controls).toEqual([])

    resolveGrid([{ id: 'G' }])
    await grid
    expect(store.controls).toEqual([{ id: 'G' }])
  })
})
