/**
 * A model update is partial, and the store has to carry that through in three places.
 *
 * The writer now leaves alone any field it is not given, which is only useful if the store stops
 * supplying every field on every call. Two things travel with that change and are easy to miss: the
 * validator must stop demanding a name that is not being written, and the OPTIMISTIC record must merge
 * rather than rebuild — a rebuilt record blanks on screen exactly the fields the write is preserving.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const updateModelMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtModel: class { updateModel = updateModelMock },
  DtModule: class {},
}))
vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useModelsStore: typeof import('../modelsStore').useModelsStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useModelsStore = (await import('../modelsStore')).useModelsStore
  updateModelMock.mockResolvedValue({ id: 'm1', name: 'saved', controls: [{ id: 'ctl-1' }] })
})

const storedModel = () => ({
  id: 'm1',
  name: 'original',
  description: 'original description',
  modules: [{ id: 'mod-1', name: 'M1' }],
  controls: [{ id: 'ctl-1', name: 'C1' }],
})

const argsOf = () => updateModelMock.mock.calls[0][0]

describe('modelsStore.updateModel — only what it is given crosses the boundary', () => {
  it('passes a single field through and nothing else', async () => {
    const store = useModelsStore()
    await store.updateModel({ id: 'm1', name: 'renamed' })

    expect(argsOf()).toEqual({ id: 'm1', name: 'renamed' })
  })

  it('does not pass a key that was not supplied, even as undefined', async () => {
    // A key present and undefined reads differently from a key that is absent, and the writer branches
    // on presence. The boundary keeps the distinction rather than relying on the reader to.
    const store = useModelsStore()
    await store.updateModel({ id: 'm1', description: 'edited' })

    for (const key of ['name', 'modules', 'controls', 'folderId', 'scope']) {
      expect(argsOf()).not.toHaveProperty(key)
    }
  })

  it('wraps a control baseline into the shape the writer reads', async () => {
    const store = useModelsStore()
    await store.updateModel({ id: 'm1', controls: ['ctl-1', 'ctl-2'], baselineControls: ['ctl-1'] })

    expect(argsOf().baselineLinks).toEqual({ controls: ['ctl-1'] })
  })

  it('returns the updated model, because a caller holding a baseline needs the server answer', async () => {
    const store = useModelsStore()
    const saved = await store.updateModel({ id: 'm1', name: 'renamed' })

    expect(saved).toMatchObject({ id: 'm1', controls: [{ id: 'ctl-1' }] })
  })
})

describe('modelsStore.updateModel — validation follows the partial contract', () => {
  it('accepts an update that does not write the name at all', async () => {
    const store = useModelsStore()
    await store.updateModel({ id: 'm1', description: 'edited' })

    expect(updateModelMock).toHaveBeenCalled()
    expect(store.error).toBe('')
  })

  // The control: a name that IS being written still cannot be blank, or the narrowing would have
  // removed the only thing stopping a model from losing its name.
  it('still refuses a name that is supplied and blank', async () => {
    const store = useModelsStore()
    const saved = await store.updateModel({ id: 'm1', name: '  ' })

    expect(saved).toBeNull()
    expect(updateModelMock).not.toHaveBeenCalled()
    expect(store.error).toContain('Name is required')
  })

  it('still refuses a missing id', async () => {
    const store = useModelsStore()
    expect(await store.updateModel({ id: '' })).toBeNull()
    expect(updateModelMock).not.toHaveBeenCalled()
  })
})

describe('modelsStore.updateModel — the optimistic record merges rather than rebuilds', () => {
  it('leaves a field the write is not touching alone on screen', async () => {
    const store = useModelsStore()
    store.models = [storedModel()] as any
    // Hold the write open so the optimistic state is what is observed.
    let release: (v: unknown) => void = () => {}
    updateModelMock.mockReturnValue(new Promise(resolve => { release = resolve }))

    const pending = store.updateModel({ id: 'm1', name: 'renamed' })

    expect(store.models[0]).toMatchObject({
      name: 'renamed',
      description: 'original description',
      modules: [{ id: 'mod-1', name: 'M1' }],
      controls: [{ id: 'ctl-1', name: 'C1' }],
    })

    release({ id: 'm1', name: 'renamed' })
    await pending
  })

  it('does apply a list the write IS touching (the control)', async () => {
    const store = useModelsStore()
    store.models = [storedModel()] as any
    let release: (v: unknown) => void = () => {}
    updateModelMock.mockReturnValue(new Promise(resolve => { release = resolve }))

    const pending = store.updateModel({ id: 'm1', controls: ['ctl-1', 'ctl-2'] })

    expect((store.models[0] as any).controls.map((c: any) => c.id)).toEqual(['ctl-1', 'ctl-2'])

    release({ id: 'm1' })
    await pending
  })
})
