// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

/**
 * The model dialog sends what the user changed, and nothing else.
 *
 * It seeds itself once when it opens and then saves on every act — the Save button, adding a control,
 * moving to a folder, and on the way out when a model is opened or exported. While every one of those
 * sent the whole seed back, a rename reverted a module somebody else had just assigned and merely
 * opening a model destroyed a control somebody else had just attached.
 *
 * The negative assertions are the ones carrying the finding. Without them every test here is satisfied
 * by a dialog that still sends everything, since everything includes the field being asserted.
 */

const savedModel = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'original',
  description: 'original description',
  complianceDrivers: ['PCI-DSS'],
  controls: [{ id: 'ctl-1', name: 'C1' }],
  ...over,
})

const loadedModel = () => ({
  ...savedModel(),
  modules: [{ id: 'mod-1', name: 'M1' }],
  folder: { id: 'fld-1' },
})

const mockModelsStore = reactive<Record<string, any>>({
  error: '',
  getModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn().mockResolvedValue(true),
})

vi.mock('@/stores/modelsStore', () => ({ useModelsStore: () => mockModelsStore }))
vi.mock('@/stores/issueStore', () => ({
  useIssueStore: () => reactive({ issueClasses: [], setIssueDataClipboard: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { path: '/browser', query: {} } } }),
}))

import ModelDialog from '../ModelDialog.vue'

/** Mount and let the model load, so the seed every assertion is measured against is in place. */
const mountDialog = async () => {
  const w = mount(ModelDialog, {
    props: { show: true, id: 'm1', showFileActions: true },
    shallow: true,
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  mockModelsStore.updateModel.mockClear()
  return w
}

/** The single argument of the most recent save. */
const lastSave = () => mockModelsStore.updateModel.mock.calls.at(-1)[0]

beforeEach(() => {
  vi.clearAllMocks()
  mockModelsStore.getModel.mockResolvedValue(loadedModel())
  mockModelsStore.updateModel.mockResolvedValue(savedModel())
})

describe('a save carries the field that changed', () => {
  it('sends the name and nothing else on a rename', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newName = 'renamed'

    await (w.vm as any).saveModel()

    expect(lastSave()).toEqual({ id: 'm1', name: 'renamed' })
  })

  it('sends the description and nothing else', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newDescription = 'edited'

    await (w.vm as any).saveModel()

    expect(lastSave()).toEqual({ id: 'm1', description: 'edited' })
  })

  it('sends the scope and nothing else when a compliance driver changes', async () => {
    const w = await mountDialog()
    ;(w.vm as any).complianceDrivers = ['PCI-DSS', 'SOC2']

    await (w.vm as any).saveModel()

    expect(Object.keys(lastSave()).sort()).toEqual(['id', 'scope'])
    expect(lastSave().scope.compliance_drivers).toEqual(['PCI-DSS', 'SOC2'])
  })

  it('sends the control list with the baseline it was edited against', async () => {
    const w = await mountDialog()
    ;(w.vm as any).selectedControlIds = ['ctl-1', 'ctl-2']

    await (w.vm as any).saveModel()

    expect(lastSave()).toEqual({
      id: 'm1', controls: ['ctl-1', 'ctl-2'], baselineControls: ['ctl-1'],
    })
  })

  it('sends nothing at all when nothing changed, and still reports saved', async () => {
    const w = await mountDialog()

    await expect((w.vm as any).saveModel()).resolves.toBe(true)

    expect(mockModelsStore.updateModel).not.toHaveBeenCalled()
  })

  // A re-order is not an edit: neither list carries meaning in its order.
  it('does not treat a re-ordered list as a change', async () => {
    const w = await mountDialog()
    ;(w.vm as any).complianceDrivers = ['PCI-DSS']
    ;(w.vm as any).selectedControlIds = ['ctl-1']

    await (w.vm as any).saveModel()

    expect(mockModelsStore.updateModel).not.toHaveBeenCalled()
  })
})

describe('the move', () => {
  it('sends the folder alone when the form is clean', async () => {
    const w = await mountDialog()

    ;(w.vm as any).moveToFolder('fld-2')
    await flushPromises()

    expect(lastSave()).toEqual({ id: 'm1', folderId: 'fld-2' })
  })

  // Pressing Move used to persist a half-typed name along with the move. Losing that would be a new
  // defect rather than a fix, so the move carries whatever edit is still pending — and nothing more.
  it('still carries an edit that is pending on the form', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newName = 'renamed'

    ;(w.vm as any).moveToFolder('fld-2')
    await flushPromises()

    expect(lastSave()).toEqual({ id: 'm1', name: 'renamed', folderId: 'fld-2' })
  })
})

// THE FINDING, as an assertion. The dialog has no module editor at all — it read the list when it
// opened and wrote it back on every save — so a module list it sends can only ever overwrite somebody
// else's assignment with a load-time copy.
describe('the module list this dialog cannot edit is never written', () => {
  it.each([
    ['a rename', (vm: any) => { vm.newName = 'renamed' }],
    ['a description edit', (vm: any) => { vm.newDescription = 'edited' }],
    ['a control change', (vm: any) => { vm.selectedControlIds = ['ctl-1', 'ctl-2'] }],
    ['a driver change', (vm: any) => { vm.complianceDrivers = ['SOC2'] }],
  ])('sends no modules after %s', async (_label, edit) => {
    const w = await mountDialog()
    edit(w.vm as any)

    await (w.vm as any).saveModel()

    expect(lastSave()).not.toHaveProperty('modules')
  })

  it('sends no modules on a folder move either', async () => {
    const w = await mountDialog()

    ;(w.vm as any).moveToFolder('fld-2')
    await flushPromises()

    expect(lastSave()).not.toHaveProperty('modules')
  })
})

// A baseline that drifts re-offers an id that is already attached, and a connect compiles to a bare
// relationship create — so the second save would append a parallel edge. The re-pin reads the server's
// answer rather than what this client believed it sent.
describe('the control baseline is pre-edit, and is re-pinned from the answer', () => {
  it('hands over what was loaded, not what was just selected', async () => {
    const w = await mountDialog()
    ;(w.vm as any).selectedControlIds = ['ctl-1', 'ctl-2']

    await (w.vm as any).saveModel()

    expect(lastSave().baselineControls).toEqual(['ctl-1'])
  })

  it('moves the baseline forward after a save, so a second edit is a delta against what is stored', async () => {
    const w = await mountDialog()

    ;(w.vm as any).selectedControlIds = ['ctl-1', 'ctl-2']
    mockModelsStore.updateModel.mockResolvedValue(
      savedModel({ controls: [{ id: 'ctl-1' }, { id: 'ctl-2' }] }),
    )
    await (w.vm as any).saveModel()

    ;(w.vm as any).selectedControlIds = ['ctl-1', 'ctl-2', 'ctl-3']
    await (w.vm as any).saveModel()

    expect(lastSave()).toEqual({
      id: 'm1',
      controls: ['ctl-1', 'ctl-2', 'ctl-3'],
      baselineControls: ['ctl-1', 'ctl-2'],
    })
  })

  it('does not re-save a list the server has already confirmed', async () => {
    const w = await mountDialog()
    ;(w.vm as any).selectedControlIds = ['ctl-1', 'ctl-2']
    mockModelsStore.updateModel.mockResolvedValue(
      savedModel({ controls: [{ id: 'ctl-1' }, { id: 'ctl-2' }] }),
    )
    await (w.vm as any).saveModel()
    mockModelsStore.updateModel.mockClear()

    await (w.vm as any).saveModel()

    expect(mockModelsStore.updateModel).not.toHaveBeenCalled()
  })
})

// THE SEED MOVED AND THE FORM DID NOT. The re-pin above reads the server's answer into the seed so a
// second edit is a delta against what is stored — but it left the form holding this dialog's
// load-time copy, so a field the user never touched started reading as an edit. The next save then
// asserted the stale value over whatever arrived in that answer.
describe('the form moves with the seed', () => {
  it('takes a rename that arrived in the answer, and does not re-assert the old name', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newDescription = 'edited'

    // Somebody else renamed the model while this dialog had it open; the answer carries their name.
    mockModelsStore.updateModel.mockResolvedValue(
      savedModel({ name: 'renamed by someone else', description: 'edited' }),
    )
    await (w.vm as any).saveModel()

    expect((w.vm as any).newName).toBe('renamed by someone else')

    ;(w.vm as any).newDescription = 'edited again'
    await (w.vm as any).saveModel()

    expect(lastSave()).toEqual({ id: 'm1', description: 'edited again' })
  })

  it('takes a control that arrived in the answer, and does not disconnect it on the next save', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newName = 'renamed'

    // The answer carries a control somebody else attached. Left in the seed alone it becomes the
    // baseline for a list that never grew — and the delta of that is a disconnect.
    mockModelsStore.updateModel.mockResolvedValue(
      savedModel({ name: 'renamed', controls: [{ id: 'ctl-1' }, { id: 'ctl-9' }] }),
    )
    await (w.vm as any).saveModel()

    expect((w.vm as any).selectedControlIds).toEqual(['ctl-1', 'ctl-9'])

    ;(w.vm as any).newDescription = 'edited'
    await (w.vm as any).saveModel()

    expect(lastSave()).toEqual({ id: 'm1', description: 'edited' })
  })

  it('takes a driver list that arrived in the answer', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newName = 'renamed'

    mockModelsStore.updateModel.mockResolvedValue(
      savedModel({ name: 'renamed', complianceDrivers: ['PCI-DSS', 'SOC2'] }),
    )
    await (w.vm as any).saveModel()

    expect((w.vm as any).complianceDrivers).toEqual(['PCI-DSS', 'SOC2'])
  })

  // The other half of the rule, and the one without which the three above are satisfied by a re-pin
  // that simply overwrites the form. A field the user is editing is theirs; the answer does not take
  // it back, whether the edit was made before the save or while it was in flight.
  it('does not overwrite a field the user is editing', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newName = 'mine'

    mockModelsStore.updateModel.mockResolvedValue(savedModel({ name: 'normalised by the platform' }))
    await (w.vm as any).saveModel()

    expect((w.vm as any).newName).toBe('mine')
  })
})

// A move and a Save overlap by construction: the move is driven by another dialog's event and used
// not to be awaited, and nothing disabled the button underneath it. The two writes carry different
// variables, so the mutex does not serialise them and deduplication does not join them — and each
// emits the same control connect, which compiles to a bare relationship create.
describe('one write at a time', () => {
  it('refuses a second save while one is in flight', async () => {
    const w = await mountDialog()
    let release: (v: unknown) => void = () => {}
    mockModelsStore.updateModel.mockReturnValue(new Promise(resolve => { release = resolve }))

    ;(w.vm as any).newName = 'renamed'
    const first = (w.vm as any).saveModel()
    await flushPromises()

    ;(w.vm as any).selectedControlIds = ['ctl-1', 'ctl-2']
    await expect((w.vm as any).saveModel()).resolves.toBe(false)
    expect(mockModelsStore.updateModel).toHaveBeenCalledTimes(1)

    release(savedModel({ name: 'renamed' }))
    await first
  })

  it('lets the next save through once the first has landed', async () => {
    const w = await mountDialog()
    ;(w.vm as any).newName = 'renamed'
    await (w.vm as any).saveModel()

    ;(w.vm as any).newDescription = 'edited'
    await expect((w.vm as any).saveModel()).resolves.toBe(true)
    expect(mockModelsStore.updateModel).toHaveBeenCalledTimes(2)
  })

  // A refused move must not report itself moved. The folder button is disabled while a save is in
  // flight, but the move is driven by another dialog's event, so the refusal is what it actually
  // meets — and a move that emits the folder id it never wrote would move the model in the browser
  // and nowhere else.
  it('a move refused while a save is in flight reports that it did not move', async () => {
    const w = await mountDialog()
    let release: (v: unknown) => void = () => {}
    mockModelsStore.updateModel.mockReturnValue(new Promise(resolve => { release = resolve }))

    ;(w.vm as any).newName = 'renamed'
    const first = (w.vm as any).saveModel()
    await flushPromises()

    await (w.vm as any).moveToFolder('fld-2')

    expect(mockModelsStore.updateModel).toHaveBeenCalledTimes(1)
    expect(w.emitted('model:moved')?.[0]).toEqual([null])

    release(savedModel({ name: 'renamed' }))
    await first
  })

  it('a move with nothing in flight reports the folder it wrote', async () => {
    const w = await mountDialog()

    await (w.vm as any).moveToFolder('fld-2')

    expect(w.emitted('model:moved')?.[0]).toEqual(['fld-2'])
  })
})
