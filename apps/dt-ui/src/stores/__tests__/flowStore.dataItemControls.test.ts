/**
 * A data item's controls in the store.
 *
 * The store's data items are replaced wholesale: by the item a data-item save returns, and by the `dataItems` an
 * element save returns. So the controls survive an element edit only because the platform returns them there too,
 * and these pin that the store keeps what it is handed. A data-item save hands the writer the controls and the
 * baseline it was given, and the control catalogue is left alone: a data item's controls name only id and name, and
 * splicing them into the catalogue would strip the classes the control panels show.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const updateComponentMock = vi.fn()
const updateBoundaryNodeMock = vi.fn()
const updateDataFlowMock = vi.fn()
const updateDataItemMock = vi.fn()

class DtUtilsStub {
  handleError = vi.fn()
  deepMerge(target: any, updates: any) {
    for (const key in updates) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        target[key] = target[key] || {}
        this.deepMerge(target[key], updates[key])
      } else {
        target[key] = updates[key]
      }
    }
    return target
  }
}

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class { updateBoundaryNode = updateBoundaryNodeMock },
  DtClass: class {},
  DtComponent: class { updateComponent = updateComponentMock },
  DtControl: class {},
  DtDataflow: class { updateDataFlow = updateDataFlowMock },
  DtDataItem: class { updateDataItem = updateDataItemMock },
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

const item = (controls: { id: string; name: string }[]) => ({ id: 'di-1', name: 'Cards', description: '', controls })
const catalogueControl = { id: 'ctl-1', name: 'Field encryption', controlClasses: [{ id: 'cc-1', name: 'Encryption' }] }

describe('a data item\'s controls in the store', () => {
  it('hands the writer the controls and the baseline, and keeps the item the platform returns', async () => {
    const store = useFlowStore()
    store.$patch({ dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }])] as any, controls: [catalogueControl] as any })
    const saved = item([{ id: 'ctl-1', name: 'Field encryption' }, { id: 'ctl-2', name: 'Tokenisation' }])
    updateDataItemMock.mockResolvedValue({ dataItem: saved, bindingResult: null, residualOk: true })

    expect(await store.updateDataItem({ dataItemId: 'di-1', controls: ['ctl-1', 'ctl-2'], baselineLinks: { controls: ['ctl-1'] } })).toBe(true)

    expect(updateDataItemMock.mock.calls[0][0]).toMatchObject({
      dataItemId: 'di-1',
      controls: ['ctl-1', 'ctl-2'],
      baselineLinks: { controls: ['ctl-1'] },
    })
    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual(saved.controls)
    expect(store.controls).toEqual([catalogueControl])
  })

  it('keeps the item busy until the last of two overlapping saves answers', async () => {
    // The data dialog refuses a save while the item is busy; the flag must not drop when the first save answers.
    const store = useFlowStore()
    store.$patch({ dataItems: [item([])] as any })
    const answers: Array<(v: unknown) => void> = []
    updateDataItemMock.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
    const answer = () => answers.shift()!({ dataItem: item([]), bindingResult: null, residualOk: true })

    const first = store.updateDataItem({ dataItemId: 'di-1', name: 'A' })
    const second = store.updateDataItem({ dataItemId: 'di-1', name: 'B' })
    expect(store.isOperationLoading('updateDataItem-di-1')).toBe(true)
    answer()
    await first
    expect(store.isOperationLoading('updateDataItem-di-1')).toBe(true)
    answer()
    await second
    expect(store.isOperationLoading('updateDataItem-di-1')).toBe(false)
  })

  it('leaves an item alone when an element save returns it while the item\'s own save is in flight', async () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [{ id: 'c1', type: 'PROCESS', position: { x: 1, y: 2 }, parentNode: 'b1', data: { label: 'C', dataItems: ['di-1'] } }] as any,
      dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }])] as any,
      defaultBoundaryId: 'root',
    })
    let answer!: (v: unknown) => void
    updateDataItemMock.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    const saved = item([{ id: 'ctl-1', name: 'Field encryption' }, { id: 'ctl-2', name: 'Tokenisation' }])
    // The element save answers with a copy of the item from before the item's own save.
    updateComponentMock.mockResolvedValue({
      id: 'c1', name: 'Renamed', type: 'PROCESS', description: '', positionX: 1, positionY: 2,
      parentBoundary: [{ id: 'b1' }], controls: [], dataItems: [item([])],
    })

    const pending = store.updateDataItem({ dataItemId: 'di-1', controls: ['ctl-1', 'ctl-2'], baselineLinks: { controls: ['ctl-1'] } })
    await store.updateNode({ nodeId: 'c1', updates: { data: { label: 'Renamed' } } })
    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual([{ id: 'ctl-1', name: 'Field encryption' }])

    answer({ dataItem: saved, bindingResult: null, residualOk: true })
    await pending
    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual(saved.controls)
  })

  // A component that handles di-1, and an element save whose answer is held until the test releases it.
  const seedHandler = (store: ReturnType<typeof useFlowStore>, controls: { id: string; name: string }[]) => {
    store.$patch({
      nodes: [{ id: 'c1', type: 'PROCESS', position: { x: 1, y: 2 }, parentNode: 'b1', data: { label: 'C', dataItems: ['di-1'] } }] as any,
      dataItems: [item(controls)] as any,
      defaultBoundaryId: 'root',
    })
    let release!: () => void
    updateComponentMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({
        id: 'c1', name: 'Renamed', type: 'PROCESS', description: '', positionX: 1, positionY: 2,
        parentBoundary: [{ id: 'b1' }], controls: [], dataItems: [item([])],
      })
    }))
    return () => release()
  }
  const answered = (controls: { id: string; name: string }[]) => ({ dataItem: item(controls), bindingResult: null, residualOk: true })
  const both = [{ id: 'ctl-1', name: 'Field encryption' }, { id: 'ctl-2', name: 'Tokenisation' }]

  it('leaves an item alone when an element save sent before its save answers after it', async () => {
    const store = useFlowStore()
    const releaseElement = seedHandler(store, [{ id: 'ctl-1', name: 'Field encryption' }])
    updateDataItemMock.mockResolvedValue(answered(both))

    const element = store.updateNode({ nodeId: 'c1', updates: { data: { label: 'Renamed' } } })
    await store.updateDataItem({ dataItemId: 'di-1', controls: both.map((c) => c.id), baselineLinks: { controls: ['ctl-1'] } })
    releaseElement()
    await element

    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual(both)
  })

  it('leaves an item alone when its save was in flight as the element save was sent', async () => {
    const store = useFlowStore()
    const releaseElement = seedHandler(store, [{ id: 'ctl-1', name: 'Field encryption' }])
    let answer!: (v: unknown) => void
    updateDataItemMock.mockImplementation(() => new Promise((resolve) => { answer = resolve }))

    const save = store.updateDataItem({ dataItemId: 'di-1', controls: both.map((c) => c.id), baselineLinks: { controls: ['ctl-1'] } })
    const element = store.updateNode({ nodeId: 'c1', updates: { data: { label: 'Renamed' } } })
    answer(answered(both))
    await save
    releaseElement()
    await element

    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual(both)
  })

  it('adds an item an element save returns when the cache does not hold it yet, its save in flight or not', async () => {
    const store = useFlowStore()
    const releaseElement = seedHandler(store, [])
    store.$patch({ dataItems: [] as any })
    updateDataItemMock.mockImplementation(() => new Promise(() => {}))

    void store.updateDataItem({ dataItemId: 'di-1', name: 'A' })
    const element = store.updateNode({ nodeId: 'c1', updates: { data: { label: 'Renamed' } } })
    releaseElement()
    await element

    expect(store.getDataItem({ dataItemId: 'di-1' })).toBeDefined()
  })

  it('applies an element save\'s copy of an item whose own save finished before the element save was sent', async () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [{ id: 'c1', type: 'PROCESS', position: { x: 1, y: 2 }, parentNode: 'b1', data: { label: 'C', dataItems: ['di-1'] } }] as any,
      dataItems: [item([])] as any,
      defaultBoundaryId: 'root',
    })
    updateDataItemMock.mockResolvedValue(answered([{ id: 'ctl-1', name: 'Field encryption' }]))
    await store.updateDataItem({ dataItemId: 'di-1', controls: ['ctl-1'], baselineLinks: { controls: [] } })
    updateComponentMock.mockResolvedValue({
      id: 'c1', name: 'Renamed', type: 'PROCESS', description: '', positionX: 1, positionY: 2,
      parentBoundary: [{ id: 'b1' }], controls: [], dataItems: [item(both)],
    })

    await store.updateNode({ nodeId: 'c1', updates: { data: { label: 'Renamed' } } })

    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual(both)
  })

  it.each([
    ['a boundary', 'node'],
    ['a data flow', 'edge'],
  ] as const)('leaves an item alone when a save of %s, sent before the item\'s save, answers after it', async (_label, kind) => {
    const store = useFlowStore()
    store.$patch({
      nodes: [{ id: 'b1', type: 'BOUNDARY', position: { x: 0, y: 0 }, parentNode: '', data: { label: 'B', dataItems: ['di-1'] } }] as any,
      edges: [{ id: 'f1', source: 'A', target: 'B', label: 'F', data: { description: '', dataItems: ['di-1'] } }] as any,
      dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }])] as any,
      defaultBoundaryId: 'root',
    })
    let release!: () => void
    const held = (value: unknown) => () => new Promise((resolve) => { release = () => resolve(value) })
    updateBoundaryNodeMock.mockImplementation(held({
      id: 'b1', name: 'B', description: '', controls: [], dataItems: [item([])], parentBoundary: [],
      zone: null, domains: [], planes: [], conduits: [], positionX: 0, positionY: 0,
    }))
    updateDataFlowMock.mockImplementation(held({
      id: 'f1', name: 'F', description: '', source: { id: 'A' }, target: { id: 'B' },
      sourceHandle: null, targetHandle: null, controls: [], dataItems: [item([])],
    }))
    updateDataItemMock.mockResolvedValue(answered(both))

    const element = kind === 'node'
      ? store.updateNode({ nodeId: 'b1', updates: { data: { label: 'Renamed' } } })
      : store.updateDataFlow({ edgeId: 'f1', updates: { data: { description: 'changed' } } })
    await store.updateDataItem({ dataItemId: 'di-1', controls: both.map((c) => c.id), baselineLinks: { controls: ['ctl-1'] } })
    release()
    await element

    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual(both)
  })

  it('lets a save from before a reset touch nothing of the store after it, on the same model reopened', async () => {
    const store = useFlowStore()
    store.$patch({ dataItems: [item([])] as any })
    const answers: Array<(v: unknown) => void> = []
    updateDataItemMock.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))

    const before = store.updateDataItem({ dataItemId: 'di-1', name: 'A' })
    store.resetStore()
    store.$patch({ dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }])] as any })
    const after = store.updateDataItem({ dataItemId: 'di-1', name: 'B' })

    answers[0](answered([]))
    await before
    expect(store.isOperationLoading('updateDataItem-di-1')).toBe(true)
    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual([{ id: 'ctl-1', name: 'Field encryption' }])

    answers[1](answered([{ id: 'ctl-1', name: 'Field encryption' }]))
    await after
    expect(store.isOperationLoading('updateDataItem-di-1')).toBe(false)
  })

  it('records no error from a save that fails after a reset', async () => {
    const store = useFlowStore()
    store.$patch({ dataItems: [item([])] as any })
    let fail!: (e: Error) => void
    updateDataItemMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))

    const before = store.updateDataItem({ dataItemId: 'di-1', name: 'A' })
    store.resetStore()
    fail(new Error('network'))
    await before

    expect(store.errors['updateDataItem-di-1']).toBeUndefined()
  })

  it('forgets the saves in flight when the store is reset', async () => {
    const store = useFlowStore()
    store.$patch({ dataItems: [item([])] as any })
    // A save that never answers, then a model switch.
    updateDataItemMock.mockImplementationOnce(() => new Promise(() => {}))
    void store.updateDataItem({ dataItemId: 'di-1', name: 'A' })
    store.resetStore()

    store.$patch({ dataItems: [item([])] as any })
    updateDataItemMock.mockResolvedValueOnce({ dataItem: item([]), bindingResult: null, residualOk: true })
    await store.updateDataItem({ dataItemId: 'di-1', name: 'B' })
    expect(store.isOperationLoading('updateDataItem-di-1')).toBe(false)
  })

  it('sends no controls when the save does not touch them', async () => {
    const store = useFlowStore()
    store.$patch({ dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }])] as any })
    updateDataItemMock.mockResolvedValue({ dataItem: item([{ id: 'ctl-1', name: 'Field encryption' }]), bindingResult: null, residualOk: true })

    await store.updateDataItem({ dataItemId: 'di-1', name: 'Card numbers' })

    expect(updateDataItemMock.mock.calls[0][0]).not.toHaveProperty('controls')
    expect(updateDataItemMock.mock.calls[0][0]).not.toHaveProperty('baselineLinks')
  })

  it('keeps a data item\'s controls through an edit of the component that handles it', async () => {
    const store = useFlowStore()
    store.$patch({
      nodes: [{ id: 'c1', type: 'PROCESS', position: { x: 1, y: 2 }, parentNode: 'b1', data: { label: 'C', dataItems: ['di-1'] } }] as any,
      dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }])] as any,
      defaultBoundaryId: 'root',
    })
    updateComponentMock.mockResolvedValue({
      id: 'c1', name: 'Renamed', type: 'PROCESS', description: '', positionX: 1, positionY: 2,
      parentBoundary: [{ id: 'b1' }], controls: [],
      // The platform's answer carries a control the cache has not seen yet, so it shows the item was replaced.
      dataItems: [item([{ id: 'ctl-1', name: 'Field encryption' }, { id: 'ctl-2', name: 'Tokenisation' }])],
    })

    await store.updateNode({ nodeId: 'c1', updates: { data: { label: 'Renamed' } } })

    expect(store.getDataItem({ dataItemId: 'di-1' })?.controls).toEqual([
      { id: 'ctl-1', name: 'Field encryption' },
      { id: 'ctl-2', name: 'Tokenisation' },
    ])
  })
})
