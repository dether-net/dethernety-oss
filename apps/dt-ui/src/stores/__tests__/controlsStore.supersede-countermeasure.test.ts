/**
 * controlsStore — countermeasure Supersede wrapper + delete-name threading.
 *
 *   1. supersedeCountermeasure forwards {systemCountermeasureId, controlId,
 *      systemCountermeasure, dtCountermeasure} to the pure dt-core orchestrator
 *      and returns its {userCopy, systemDispositionResult} envelope verbatim.
 *   2. deleteCountermeasure forwards the optional countermeasureName to the
 *      dt-core layer so the USER-copy-delete companion flip can fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Countermeasure, DispositionMutationResult } from '@dethernety/dt-core'

const deleteCountermeasureMock = vi.fn()
const supersedeFlowMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtUtils: class {
    handleError = vi.fn()
  },
  DtControl: class {},
  DtClass: class {},
  DtCountermeasure: class {
    deleteCountermeasure = deleteCountermeasureMock
  },
  DtMitreAttack: class {},
  DtMitreDefend: class {},
  DtModule: class {},
  executeSupersedeCountermeasureFlow: supersedeFlowMock,
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useControlsStore: typeof import('../controlsStore').useControlsStore

const SYSTEM_CM: Countermeasure = {
  id: 'sys-cm-1',
  name: 'MFA',
  description: 'desc',
  type: 'preventive',
  category: 'Identity',
  score: 8,
  references: '',
  addressedExposures: [],
  tags: [],
  createdBy: 'SYSTEM',
} as unknown as Countermeasure

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../controlsStore')
  useControlsStore = mod.useControlsStore
})

describe('controlsStore.supersedeCountermeasure', () => {
  it('forwards args to the orchestrator and returns its envelope', async () => {
    const userCopy = { ...SYSTEM_CM, id: 'user-cm-1', name: 'MFA (custom)', createdBy: 'USER' }
    const systemDispositionResult: DispositionMutationResult = {
      success: true,
      exposureId: 'sys-cm-1',
      dispositionKind: 'SUPERSEDED',
    } as unknown as DispositionMutationResult
    supersedeFlowMock.mockResolvedValueOnce({ userCopy, systemDispositionResult })

    const store = useControlsStore()
    const result = await store.supersedeCountermeasure({
      countermeasureId: 'sys-cm-1',
      controlId: 'ctl-1',
      countermeasure: SYSTEM_CM,
    })

    expect(supersedeFlowMock).toHaveBeenCalledOnce()
    const args = supersedeFlowMock.mock.calls[0][0]
    expect(args.systemCountermeasureId).toBe('sys-cm-1')
    expect(args.controlId).toBe('ctl-1')
    expect(args.systemCountermeasure).toEqual(SYSTEM_CM)
    expect(args.dtCountermeasure).toBeDefined()
    expect(result).toEqual({ userCopy, systemDispositionResult })
  })

  it('propagates a partial-failure envelope unchanged', async () => {
    const userCopy = { ...SYSTEM_CM, id: 'user-cm-1', createdBy: 'USER' }
    supersedeFlowMock.mockResolvedValueOnce({
      userCopy,
      systemDispositionResult: { success: false, errorCode: 'DATABASE_ERROR' },
    })

    const store = useControlsStore()
    const result = await store.supersedeCountermeasure({
      countermeasureId: 'sys-cm-1',
      controlId: 'ctl-1',
      countermeasure: SYSTEM_CM,
    })

    expect(result.systemDispositionResult.success).toBe(false)
    expect(result.userCopy.id).toBe('user-cm-1')
  })
})

describe('controlsStore.deleteCountermeasure — name threading', () => {
  it('forwards countermeasureName to the dt-core layer', async () => {
    deleteCountermeasureMock.mockResolvedValueOnce(true)
    const store = useControlsStore()

    await store.deleteCountermeasure({ countermeasureId: 'user-cm-1', countermeasureName: 'MFA (custom)' })

    expect(deleteCountermeasureMock).toHaveBeenCalledWith({
      countermeasureId: 'user-cm-1',
      countermeasureName: 'MFA (custom)',
    })
  })

  it('passes undefined name when omitted (no companion flip)', async () => {
    deleteCountermeasureMock.mockResolvedValueOnce(true)
    const store = useControlsStore()

    await store.deleteCountermeasure({ countermeasureId: 'cm-x' })

    expect(deleteCountermeasureMock).toHaveBeenCalledWith({
      countermeasureId: 'cm-x',
      countermeasureName: undefined,
    })
  })
})
