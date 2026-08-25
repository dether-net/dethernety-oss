/**
 * fetchData's `openedEmpty` load-time fact and the starting posture it drives.
 *
 * Guarantees under test:
 *  - `openedEmpty` records whether THIS model loaded with no elements, and
 *    resetStore clears it so a model switch re-decides from scratch.
 *  - A model that loads with no elements opens UNLOCKED (editMode true), so the
 *    first component can be dropped without hunting for the lock toggle.
 *  - A model that loads with elements stays LOCKED — the default is not a
 *    blanket unlock.
 *  - The rule is one-shot per load, not a rule over `nodes`: adding the first
 *    element to an unlocked empty model must not re-lock it, and a user who
 *    locks an empty canvas stays locked.
 *  - `components`/`boundaries` from dumpModelData are descendants of the root
 *    boundary, so the default boundary itself must not count as an element.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const dumpModelDataMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class {},
  DtClass: class {},
  DtComponent: class {},
  DtControl: class {},
  DtDataflow: class {},
  DtDataItem: class {},
  DtExposure: class {},
  DtMitreAttack: class {},
  DtModel: class { dumpModelData = dumpModelDataMock },
  DtModule: class {},
  DtUtils: class { handleError = vi.fn(); deepMerge = (t: any) => t },
  executeSupersedeFlow: vi.fn(),
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFlowStore: typeof import('../flowStore').useFlowStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../flowStore')
  useFlowStore = mod.useFlowStore
})

// dumpModelData returns descendants of the root boundary; `defaultBoundary` is
// carried separately and is NOT part of components/boundaries.
const dump = (over: any = {}) => ({
  currentModel: { id: 'm1', name: 'M' },
  components: [],
  boundaries: [],
  dataFlows: [],
  dataItems: [],
  modules: [],
  defaultBoundary: { id: 'root', type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { label: 'root' } },
  ...over,
})

const component = (id: string) => ({
  id, type: 'PROCESS', position: { x: 0, y: 0 }, parentNode: '', data: { label: id },
})

describe('flowStore.fetchData — openedEmpty + empty-model starting posture', () => {
  it('records openedEmpty for a model that loads with no elements', async () => {
    dumpModelDataMock.mockResolvedValue(dump())
    const store = useFlowStore()
    expect(store.openedEmpty).toBe(false)

    await store.fetchData({ model: 'm1' })

    expect(store.openedEmpty).toBe(true)
  })

  it('leaves openedEmpty false for a model that loads with elements', async () => {
    dumpModelDataMock.mockResolvedValue(dump({ components: [component('c1')] }))
    const store = useFlowStore()

    await store.fetchData({ model: 'm1' })

    expect(store.openedEmpty).toBe(false)
  })

  it('resetStore clears openedEmpty so a model switch re-decides', async () => {
    dumpModelDataMock.mockResolvedValue(dump())
    const store = useFlowStore()
    await store.fetchData({ model: 'm1' })
    expect(store.openedEmpty).toBe(true)

    // openModel resets before loading the next model.
    store.resetStore()
    expect(store.openedEmpty).toBe(false)
    expect(store.editMode).toBe(false)

    // Switching to a populated model must not inherit the empty posture.
    dumpModelDataMock.mockResolvedValue(dump({ components: [component('c1')] }))
    await store.fetchData({ model: 'm2' })

    expect(store.openedEmpty).toBe(false)
    expect(store.editMode).toBe(false)
  })

  it('unlocks a model that loads with no elements', async () => {
    dumpModelDataMock.mockResolvedValue(dump())
    const store = useFlowStore()
    expect(store.editMode).toBe(false)

    await store.fetchData({ model: 'm1' })

    expect(store.nodes).toHaveLength(0)
    expect(store.editMode).toBe(true)
  })

  it('does not count the default boundary as an element', async () => {
    // The root boundary exists but owns no descendants — still an empty model.
    dumpModelDataMock.mockResolvedValue(dump())
    const store = useFlowStore()

    await store.fetchData({ model: 'm1' })

    expect(store.defaultBoundaryId).toBe('root')
    expect(store.editMode).toBe(true)
  })

  it('leaves a model that loads with elements locked', async () => {
    dumpModelDataMock.mockResolvedValue(dump({ components: [component('c1')] }))
    const store = useFlowStore()

    await store.fetchData({ model: 'm1' })

    expect(store.nodes).toHaveLength(1)
    expect(store.editMode).toBe(false)
  })

  it('counts a non-default boundary as an element', async () => {
    dumpModelDataMock.mockResolvedValue(dump({
      boundaries: [{ id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { label: 'b1' } }],
    }))
    const store = useFlowStore()

    await store.fetchData({ model: 'm1' })

    expect(store.editMode).toBe(false)
  })

  it('does not re-lock when the first element is added to an unlocked empty model', async () => {
    dumpModelDataMock.mockResolvedValue(dump())
    const store = useFlowStore()
    await store.fetchData({ model: 'm1' })
    expect(store.editMode).toBe(true)

    // Simulate the first drop landing on the canvas.
    store.nodes = [component('c1') as any]

    // One-shot at load — not a computed over `nodes`.
    expect(store.editMode).toBe(true)
  })

  it('respects a user who locks an empty canvas after load', async () => {
    dumpModelDataMock.mockResolvedValue(dump())
    const store = useFlowStore()
    await store.fetchData({ model: 'm1' })
    expect(store.editMode).toBe(true)

    store.editMode = false

    expect(store.editMode).toBe(false)
  })
})
