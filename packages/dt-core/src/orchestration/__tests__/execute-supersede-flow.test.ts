/**
 * executeSupersedeFlow unit tests.
 *
 * Verifies the clone-name + description annotation + disposition-reason format.
 * The single-quote wrapping in the disposition reason is load-bearing for the
 * USER-copy-delete companion match — a test asserts the literal format.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { executeSupersedeFlow } from '../execute-supersede-flow.js'
import type { DtExposure } from '../../dt-exposure/dt-exposure.js'
import type { Exposure } from '../../interfaces/core-types-interface.js'

function buildMockDtExposure() {
  const createExposure = vi.fn()
  const disposeExposure = vi.fn()
  const dtExposure = { createExposure, disposeExposure } as unknown as DtExposure
  return { dtExposure, createExposure, disposeExposure }
}

const SYSTEM_EXPOSURE: Exposure = {
  id: 'sys-exp-1',
  name: 'Hardcoded credentials',
  description: 'Module-instantiated finding.',
  type: '1',
  category: 'Configuration',
  score: 7,
  attackVector: 'LOCAL',
  exploitedBy: [
    { id: 'tech-1', name: 'OS Credential Dumping', description: '', attack_id: 'T1003' },
  ],
  createdBy: 'SYSTEM',
}

describe('executeSupersedeFlow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clones the SYSTEM exposure with " (custom)" suffix and appends source note to description', async () => {
    const { dtExposure, createExposure, disposeExposure } = buildMockDtExposure()
    createExposure.mockResolvedValueOnce({
      ...SYSTEM_EXPOSURE,
      id: 'user-exp-1',
      name: 'Hardcoded credentials (custom)',
    })
    disposeExposure.mockResolvedValueOnce({ success: true })

    await executeSupersedeFlow({
      systemExposureId: 'sys-exp-1',
      systemExposure: SYSTEM_EXPOSURE,
      elementId: 'elem-1',
      dtExposure,
    })

    expect(createExposure).toHaveBeenCalledOnce()
    const createArgs = createExposure.mock.calls[0][0]
    expect(createArgs.exposure.name).toBe('Hardcoded credentials (custom)')
    expect(createArgs.exposure.description).toContain("(custom of 'Hardcoded credentials')")
    expect(createArgs.exposure.id).toBe('') // id stripped (placeholder satisfies type; server assigns real id)
    expect(createArgs.elementId).toBe('elem-1')
    expect(createArgs.attackTechniqueIds).toEqual(['tech-1'])
  })

  it('uses single-quote-wrapped clone name in disposition reason (load-bearing for companion)', async () => {
    const { dtExposure, createExposure, disposeExposure } = buildMockDtExposure()
    createExposure.mockResolvedValueOnce({ ...SYSTEM_EXPOSURE, id: 'user-exp-1', name: 'Hardcoded credentials (custom)' })
    disposeExposure.mockResolvedValueOnce({ success: true })

    await executeSupersedeFlow({
      systemExposureId: 'sys-exp-1',
      systemExposure: SYSTEM_EXPOSURE,
      elementId: 'elem-1',
      dtExposure,
    })

    expect(disposeExposure).toHaveBeenCalledOnce()
    expect(disposeExposure.mock.calls[0][0]).toEqual({
      exposureId: 'sys-exp-1',
      kind: 'SUPERSEDED',
      reason: "Superseded by user-authored exposure 'Hardcoded credentials (custom)'",
    })
  })

  it('honors cloneNameSuffix override', async () => {
    const { dtExposure, createExposure, disposeExposure } = buildMockDtExposure()
    createExposure.mockResolvedValueOnce({ ...SYSTEM_EXPOSURE, id: 'user-exp-1', name: 'Hardcoded credentials – customized' })
    disposeExposure.mockResolvedValueOnce({ success: true })

    await executeSupersedeFlow({
      systemExposureId: 'sys-exp-1',
      systemExposure: SYSTEM_EXPOSURE,
      elementId: 'elem-1',
      cloneNameSuffix: ' – customized',
      dtExposure,
    })

    expect(createExposure.mock.calls[0][0].exposure.name).toBe('Hardcoded credentials – customized')
  })

  it('does not call disposeExposure if createExposure throws', async () => {
    const { dtExposure, createExposure, disposeExposure } = buildMockDtExposure()
    createExposure.mockRejectedValueOnce(new Error('create failed'))

    await expect(
      executeSupersedeFlow({
        systemExposureId: 'sys-exp-1',
        systemExposure: SYSTEM_EXPOSURE,
        elementId: 'elem-1',
        dtExposure,
      }),
    ).rejects.toThrow('create failed')
    expect(disposeExposure).not.toHaveBeenCalled()
  })

  it('surfaces dispose result on partial failure (USER copy created, disposition failed)', async () => {
    const { dtExposure, createExposure, disposeExposure } = buildMockDtExposure()
    createExposure.mockResolvedValueOnce({ ...SYSTEM_EXPOSURE, id: 'user-exp-1', name: 'Hardcoded credentials (custom)' })
    disposeExposure.mockResolvedValueOnce({
      success: false,
      errorCode: 'DATABASE_ERROR',
      errorMessage: 'transient backend failure',
    })

    const result = await executeSupersedeFlow({
      systemExposureId: 'sys-exp-1',
      systemExposure: SYSTEM_EXPOSURE,
      elementId: 'elem-1',
      dtExposure,
    })

    expect(result.userCopy.id).toBe('user-exp-1')
    expect(result.systemDispositionResult.success).toBe(false)
    expect(result.systemDispositionResult.errorCode).toBe('DATABASE_ERROR')
  })

  it('handles SYSTEM exposure with no description (still appends sourceNote)', async () => {
    const { dtExposure, createExposure, disposeExposure } = buildMockDtExposure()
    const noDesc = { ...SYSTEM_EXPOSURE, description: undefined }
    createExposure.mockResolvedValueOnce({ ...noDesc, id: 'user-exp-1', name: 'Hardcoded credentials (custom)' })
    disposeExposure.mockResolvedValueOnce({ success: true })

    await executeSupersedeFlow({
      systemExposureId: 'sys-exp-1',
      systemExposure: noDesc,
      elementId: 'elem-1',
      dtExposure,
    })

    expect(createExposure.mock.calls[0][0].exposure.description).toBe("(custom of 'Hardcoded credentials')")
  })
})
