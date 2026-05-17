/**
 * Bundled-method partial-failure + retry short-circuit.
 *
 * Verifies the controlsStore.updateControl rollback semantics across all
 * three failure modes the partial-failure UX depends on:
 *
 *   1. Binding ok, residual ok       → controls.value reflects the update,
 *                                       store returns full UpdateControlResult.
 *   2. Binding fails (errorCode set) → optimistic update is rolled back,
 *                                       store returns the binding-error
 *                                       result so the caller can render the
 *                                       error toast.
 *   3. Binding ok, residual fails    → optimistic update is rolled back,
 *                                       store surfaces residualOk=false so
 *                                       the caller can render the composite
 *                                       warning toast (binding receipt +
 *                                       residual-failure).
 *
 * Plus the documented retry path: after a residual-failure rollback the user
 * clicks Save again; the backend identity short-circuit returns a success
 * result with all-zero deltas + residualOk=true, and the store applies the
 * residual update cleanly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  ChangeElementBindingResult,
  Control,
  UpdateControlResult,
} from '@dethernety/dt-core'

const updateControlMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtUtils: class {
    handleError = vi.fn()
  },
  DtControl: class {
    updateControl = updateControlMock
  },
  DtClass: class {},
  DtCountermeasure: class {},
  DtMitreAttack: class {},
  DtMitreDefend: class {},
  DtModule: class {},
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useControlsStore: typeof import('../controlsStore').useControlsStore

const SEED_CONTROL: Control = {
  id: 'ctl-1',
  name: 'Original Name',
  description: 'Original description that is long enough',
  controlClasses: [],
  countermeasures: [],
} as unknown as Control

const BINDING_SUCCESS: ChangeElementBindingResult = {
  success: true,
  elementId: 'ctl-1',
  targetBinding: { __typename: 'ClassBinding', classIds: ['ctlc-A'] } as any,
  deltas: {
    deletedDerivedExposures: 0,
    instantiatedDerivedExposures: 0,
    preservedCustomExposures: 0,
    deletedDerivedCountermeasures: 1,
    instantiatedDerivedCountermeasures: 2,
    preservedCustomCountermeasures: 0,
  },
  errorCode: null,
  errorMessage: null,
}

const BINDING_IDENTITY: ChangeElementBindingResult = {
  ...BINDING_SUCCESS,
  deltas: {
    deletedDerivedExposures: 0,
    instantiatedDerivedExposures: 0,
    preservedCustomExposures: 0,
    deletedDerivedCountermeasures: 0,
    instantiatedDerivedCountermeasures: 0,
    preservedCustomCountermeasures: 0,
  },
}

const BINDING_FAIL: ChangeElementBindingResult = {
  success: false,
  elementId: 'ctl-1',
  targetBinding: { __typename: 'NoBinding' } as any,
  deltas: BINDING_IDENTITY.deltas,
  errorCode: 'CLASS_NOT_FOUND',
  errorMessage: 'The selected class is no longer available.',
}

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../controlsStore')
  useControlsStore = mod.useControlsStore
})

async function seedStoreWithControl(store: ReturnType<typeof useControlsStore>): Promise<void> {
  store.$patch({ controls: [{ ...SEED_CONTROL }] })
}

describe('controlsStore.updateControl — partial-failure rollback semantics', () => {
  it('binding ok + residual ok → no rollback, store reflects update', async () => {
    const store = useControlsStore()
    await seedStoreWithControl(store)

    const updatedControl: Control = { ...SEED_CONTROL, name: 'New Name' }
    const happyResult: UpdateControlResult = {
      control: updatedControl,
      bindingResult: BINDING_SUCCESS,
      residualOk: true,
    }
    updateControlMock.mockResolvedValueOnce(happyResult)

    const result = await store.updateControl({
      controlId: 'ctl-1',
      name: 'New Name',
      description: 'A longer description that passes validation',
      controlClasses: ['ctlc-A'],
      folderId: undefined,
    })

    expect(result).toEqual(happyResult)
    expect(store.controls).toHaveLength(1)
    expect(store.controls[0].name).toBe('New Name')
  })

  it('binding fails → rollback to original; store returns binding-error result for toast', async () => {
    const store = useControlsStore()
    await seedStoreWithControl(store)

    const bindingFailResult: UpdateControlResult = {
      control: null,
      bindingResult: BINDING_FAIL,
      residualOk: false,
    }
    updateControlMock.mockResolvedValueOnce(bindingFailResult)

    const result = await store.updateControl({
      controlId: 'ctl-1',
      name: 'Should Not Persist',
      description: 'A longer description that passes validation',
      controlClasses: ['ctlc-A'],
      folderId: undefined,
    })

    expect(result.bindingResult?.errorCode).toBe('CLASS_NOT_FOUND')
    expect(result.residualOk).toBe(false)
    // Rollback: name reverts to the original.
    expect(store.controls[0].name).toBe('Original Name')
    expect(store.controls[0].description).toBe(SEED_CONTROL.description)
  })

  it('binding ok + residual fails → rollback; surfaces composite-warning signal', async () => {
    const store = useControlsStore()
    await seedStoreWithControl(store)

    const residualFailResult: UpdateControlResult = {
      control: null,
      bindingResult: BINDING_SUCCESS,
      residualOk: false,
    }
    updateControlMock.mockResolvedValueOnce(residualFailResult)

    const result = await store.updateControl({
      controlId: 'ctl-1',
      name: 'Should Not Persist',
      description: 'A longer description that passes validation',
      controlClasses: ['ctlc-A'],
      folderId: undefined,
    })

    // Caller renders composite warning: bindingResult.success=true tells the
    // delta-receipt half ("3 countermeasures changed"), residualOk=false
    // tells the residual-failure half ("Could not save name/description").
    expect(result.bindingResult?.errorCode).toBeNull()
    expect(result.bindingResult?.deltas.instantiatedDerivedCountermeasures).toBe(2)
    expect(result.residualOk).toBe(false)
    // Rollback: optimistic name update reverted.
    expect(store.controls[0].name).toBe('Original Name')
  })

  it('retry after residual-failure: identity short-circuit (I8) + clean residual → store applies update', async () => {
    const store = useControlsStore()
    await seedStoreWithControl(store)

    // First save: binding ok, residual fails.
    updateControlMock.mockResolvedValueOnce({
      control: null,
      bindingResult: BINDING_SUCCESS,
      residualOk: false,
    })
    await store.updateControl({
      controlId: 'ctl-1',
      name: 'Retry Save',
      description: 'A longer description that passes validation',
      controlClasses: ['ctlc-A'],
      folderId: undefined,
    })
    expect(store.controls[0].name).toBe('Original Name') // rolled back

    // Second save (the retry): backend sees the binding is already in place
    // (target equals current binding), short-circuits via I8 — zero deltas,
    // success=true. Residual runs cleanly this time.
    const retriedControl: Control = { ...SEED_CONTROL, name: 'Retry Save' }
    updateControlMock.mockResolvedValueOnce({
      control: retriedControl,
      bindingResult: BINDING_IDENTITY,
      residualOk: true,
    })

    const retryResult = await store.updateControl({
      controlId: 'ctl-1',
      name: 'Retry Save',
      description: 'A longer description that passes validation',
      controlClasses: ['ctlc-A'],
      folderId: undefined,
    })

    expect(retryResult.bindingResult?.errorCode).toBeNull()
    expect(retryResult.bindingResult?.deltas).toEqual(BINDING_IDENTITY.deltas)
    expect(retryResult.residualOk).toBe(true)
    expect(store.controls[0].name).toBe('Retry Save')

    // Both calls observed — the retry was not coalesced.
    expect(updateControlMock).toHaveBeenCalledTimes(2)
  })
})
