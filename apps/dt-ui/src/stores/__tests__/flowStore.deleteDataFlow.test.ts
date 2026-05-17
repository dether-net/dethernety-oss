/**
 * `deleteDataFlow` defensive-filter invariant.
 *
 * Background: `flowStore.deleteDataFlow` carries a belt-and-suspenders filter
 * at line 818:
 *   controls.value = controls.value.filter(control =>
 *     !control.controlClasses?.some(cls => cls.id === dataFlowId))
 *
 * The predicate looks at a Control's `controlClasses` (each of which is a
 * ControlClass node) and removes the Control if any of its classes happens to
 * have the same id as the just-deleted DataFlow. In correct state this
 * collision is impossible — ControlClass ids and DataFlow ids live in
 * disjoint id-spaces — but the filter was added defensively in response to a
 * prior data-corruption incident. The filter stays in place (don't remove
 * defensive code without understanding the original incident); this test
 * documents the invariant: **in correct store state, the filter must never
 * remove any control.**
 *
 * If this test ever fails, that's the smoke signal — either a real bug
 * regressed (controlClasses got polluted with DataFlow ids) or the filter
 * itself drifted. Either way the on-call should investigate before changing
 * the filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Control } from '@dethernety/dt-core'

const deleteDataFlowMock = vi.fn().mockResolvedValue(true)

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class {},
  DtClass: class {},
  DtComponent: class {},
  DtControl: class {},
  DtDataflow: class {
    deleteDataFlow = deleteDataFlowMock
  },
  DtDataItem: class {},
  DtExposure: class {},
  DtMitreAttack: class {},
  DtModel: class {},
  DtModule: class {},
  DtUtils: class {
    handleError = vi.fn()
  },
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFlowStore: typeof import('../flowStore').useFlowStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../flowStore')
  useFlowStore = mod.useFlowStore
})

function makeControl(id: string, classIds: string[]): Control {
  return {
    id,
    name: `${id}-name`,
    controlClasses: classIds.map((cid) => ({ id: cid, name: cid })),
  } as unknown as Control
}

describe('flowStore.deleteDataFlow — defensive filter invariant (F12)', () => {
  it('deleting a DataFlow does NOT match any control via the controlClasses.id filter when store state is correct', async () => {
    const store = useFlowStore()
    // Seed three controls; their controlClasses carry only legitimate
    // ControlClass ids — `ctlc-A` / `ctlc-B` / `ctlc-C`. None collide with
    // the DataFlow id we are about to delete (`df-1`).
    const ctl1 = makeControl('ctl-1', ['ctlc-A'])
    const ctl2 = makeControl('ctl-2', ['ctlc-B', 'ctlc-C'])
    const ctl3 = makeControl('ctl-3', [])
    store.$patch({ controls: [ctl1, ctl2, ctl3] })

    const before = [...store.controls]
    const ok = await store.deleteDataFlow({ dataFlowId: 'df-1' })

    expect(ok).toBe(true)
    expect(deleteDataFlowMock).toHaveBeenCalledWith({ dataFlowId: 'df-1' })
    // Invariant: in correct state, the defensive controlClasses filter
    // never matches a DataFlow id. All three controls must survive.
    expect(store.controls).toEqual(before)
    expect(store.controls.map((c) => c.id)).toEqual(['ctl-1', 'ctl-2', 'ctl-3'])
  })

  it('also leaves controls intact when there are no controls (no false-positive matches)', async () => {
    const store = useFlowStore()
    store.$patch({ controls: [] })

    const ok = await store.deleteDataFlow({ dataFlowId: 'df-2' })
    expect(ok).toBe(true)
    expect(store.controls).toEqual([])
  })

  it('SMOKE: filter triggers ONLY if a control carries a DataFlow id in controlClasses (documented incident state)', async () => {
    const store = useFlowStore()
    // Synthetic incident state — a control's `controlClasses` carries a
    // DataFlow id. This is what the defensive filter is for. Exercising it
    // here documents the behavior; production should never reach this state.
    const polluted = makeControl('ctl-polluted', ['df-3', 'ctlc-A'])
    const clean = makeControl('ctl-clean', ['ctlc-A'])
    store.$patch({ controls: [polluted, clean] })

    await store.deleteDataFlow({ dataFlowId: 'df-3' })

    // The polluted control is removed by the filter; the clean one survives.
    // If this test fails, the filter behavior itself drifted.
    expect(store.controls.map((c) => c.id)).toEqual(['ctl-clean'])
  })
})
