// @vitest-environment happy-dom
/**
 * ExposureDialog save must not be falsely blocked, and the Score field is dirty-tracked.
 *
 * 1. saveExposure converts the exposure's technique mitreIds → internal ids against the
 *    ATTACK_TECHNIQUE catalog. That catalog is only hydrated by the (lazily-mounted)
 *    TechniquePicker, so editing an information-tab field on an exposure that already has
 *    techniques used to block Save forever. saveExposure now awaits hydrateCatalog first.
 * 2. The Score field is now bound; a score-only edit must flip isDirty (Save is gated on it
 *    in edit mode), and snapshotInitialState must capture score.
 *
 * Harness mirrors ControlDialog.test.ts: no Pinia, stores mocked directly, shallowMount
 * auto-stubs children, internals reached via ControlDialog's defineExpose seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  flow: {
    getExposure: vi.fn().mockResolvedValue({ name: 'X', description: '', score: 0, exploitedBy: [] }),
    createExposure: vi.fn().mockResolvedValue({ id: 'e1' }),
    updateExposure: vi.fn().mockResolvedValue({ id: 'e1' }),
    modelId: 'm1',
  },
  tech: {
    // Starts EMPTY: the mitreId→internalId lookup reads this map, so an empty catalog is
    // what makes the "save blocked until hydrated" path real. Tests populate it via hydrateCatalog.
    catalog: new Map<string, Array<{ mitreId: string; internalId: string }>>(),
    hydrateCatalog: vi.fn().mockResolvedValue(undefined),
    matchTechniques: vi.fn().mockResolvedValue(undefined),
    isCatalogReady: { ATTACK_TECHNIQUE: true, DEFEND_TECHNIQUE: false, ATTACK_MITIGATION: false },
    catalogError: '',
    vectorAvailable: null,
    vectorDisabledReason: null,
  },
}))

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => mocks.flow }))
vi.mock('@/stores/techniqueSuggestionsStore', () => ({ useTechniqueSuggestionsStore: () => mocks.tech }))

import ExposureDialog from '../ExposureDialog.vue'

interface Exposed {
  saveExposure: () => Promise<void>
  isDirty: boolean
  exposure: { name: string; description: string; score: number }
  selectedTechniqueMitreIds: string[]
  snapshotInitialState: () => void
  initialState: { name: string; description: string; score: number; techniqueMitreIds: string[] }
}

const mountDialog = (props: Record<string, unknown>) =>
  shallowMount(ExposureDialog, {
    props: { elementId: 'el1', exposureId: undefined, showDialog: true, action: 'create', ...props },
  })

const vm = (w: ReturnType<typeof mountDialog>) => w.vm as unknown as Exposed

beforeEach(() => {
  vi.clearAllMocks()
  // Every test starts from an empty catalog + a no-op hydrate, so the tests that assert
  // "save proceeds" only pass because hydrate genuinely populates the catalog mid-save.
  mocks.tech.catalog.clear()
  mocks.tech.hydrateCatalog.mockReset().mockResolvedValue(undefined)
})

describe('ExposureDialog — save is never falsely blocked by an unhydrated catalog', () => {
  it('hydrates the empty catalog mid-save, so a save with techniques proceeds', async () => {
    // Catalog is empty on mount (the lookup would return null and block save); hydrateCatalog
    // populates it, so the subsequent lookup succeeds within the same saveExposure call.
    mocks.tech.hydrateCatalog.mockImplementation(async () => {
      mocks.tech.catalog.set('ATTACK_TECHNIQUE', [{ mitreId: 'T1059', internalId: 'int-1' }])
    })

    const wrapper = mountDialog({ action: 'edit', exposureId: 'e1' })
    await flushPromises() // let loadExposure settle

    vm(wrapper).selectedTechniqueMitreIds = ['T1059']
    expect(mocks.tech.catalog.get('ATTACK_TECHNIQUE')).toBeUndefined() // empty before save
    await vm(wrapper).saveExposure()

    // Hydrate ran before the mitreId→internalId conversion...
    expect(mocks.tech.hydrateCatalog).toHaveBeenCalledWith('ATTACK_TECHNIQUE')
    // ...and the save proceeds with the mapped internal id (blocked path NOT taken).
    expect(mocks.flow.updateExposure).toHaveBeenCalledTimes(1)
    expect(mocks.flow.updateExposure).toHaveBeenCalledWith(
      expect.objectContaining({ exposureId: 'e1', attackTechniqueIds: ['int-1'] }),
    )
  })

  it('blocks save when hydration leaves the catalog empty (genuine hydration failure)', async () => {
    // hydrateCatalog resolves without populating → mitreIdsToInternalIds returns null → the
    // null-guard fires and the save must NOT proceed. This is the branch the old test never hit.
    const wrapper = mountDialog({ action: 'edit', exposureId: 'e1' })
    await flushPromises()

    vm(wrapper).selectedTechniqueMitreIds = ['T1059']
    await vm(wrapper).saveExposure()

    expect(mocks.tech.hydrateCatalog).toHaveBeenCalledWith('ATTACK_TECHNIQUE')
    expect(mocks.flow.updateExposure).not.toHaveBeenCalled()
  })
})

describe('ExposureDialog — Score field dirty tracking', () => {
  it('flips isDirty on a score-only edit and snapshots score', () => {
    const wrapper = mountDialog({ action: 'create' })
    // create mode snapshots the empty exposure on setup — clean to start.
    expect(vm(wrapper).isDirty).toBe(false)

    vm(wrapper).exposure.score = 5
    expect(vm(wrapper).isDirty).toBe(true)

    // snapshotInitialState captures score → dialog reads clean again after a "save".
    vm(wrapper).snapshotInitialState()
    expect(vm(wrapper).initialState.score).toBe(5)
    expect(vm(wrapper).isDirty).toBe(false)
  })
})
