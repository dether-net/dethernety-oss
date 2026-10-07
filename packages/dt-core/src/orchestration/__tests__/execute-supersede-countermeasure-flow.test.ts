/**
 * executeSupersedeCountermeasureFlow unit tests.
 *
 * Mirrors execute-supersede-flow.test.ts. Verifies the clone is attached to the
 * originating Control (controlId passed through), the " (custom)" suffix +
 * source-note description, and the single-quote-wrapped disposition reason
 * (load-bearing for the USER-copy-delete companion match), and that every MITRE
 * link of the original, every link field with each edge's justification, reaches
 * the copy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { executeSupersedeCountermeasureFlow } from '../execute-supersede-countermeasure-flow.js'
import type { DtCountermeasure } from '../../dt-countermeasure/dt-countermeasure.js'
import { COUNTERMEASURE_TECHNIQUE_LINK_FIELDS } from '../../interfaces/core-types-interface.js'
import type { Countermeasure, CountermeasureTechniqueLinks } from '../../interfaces/core-types-interface.js'

// Every MITRE link field of a countermeasure, each with a justified and a bare edge.
const LINKS: CountermeasureTechniqueLinks = Object.fromEntries(
  COUNTERMEASURE_TECHNIQUE_LINK_FIELDS.map(field => [
    field,
    [
      { id: `${field}-a`, justification: `because ${field}` },
      { id: `${field}-b`, justification: null },
    ],
  ]),
)

function buildMockDtCountermeasure() {
  const createCountermeasure = vi.fn()
  const disposeCountermeasure = vi.fn()
  const getCountermeasureTechniqueLinks = vi.fn().mockResolvedValue(LINKS)
  const dtCountermeasure = {
    createCountermeasure,
    disposeCountermeasure,
    getCountermeasureTechniqueLinks,
  } as unknown as DtCountermeasure
  return { dtCountermeasure, createCountermeasure, disposeCountermeasure, getCountermeasureTechniqueLinks }
}

const SYSTEM_CM: Countermeasure = {
  id: 'sys-cm-1',
  name: 'Multi-factor authentication',
  description: 'Module-instantiated control.',
  type: 'preventive',
  category: 'Identity',
  score: 8,
  references: '',
  addressedExposures: ['exp-1'],
  tags: [],
  createdBy: 'SYSTEM',
}

describe('executeSupersedeCountermeasureFlow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('copies every MITRE link of the original, with each justification, onto the copy', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure, getCountermeasureTechniqueLinks } =
      buildMockDtCountermeasure()
    createCountermeasure.mockResolvedValueOnce({ ...SYSTEM_CM, id: 'user-cm-1' })
    disposeCountermeasure.mockResolvedValueOnce({ success: true })

    await executeSupersedeCountermeasureFlow({
      systemCountermeasureId: 'sys-cm-1',
      systemCountermeasure: SYSTEM_CM,
      controlId: 'ctl-1',
      dtCountermeasure,
    })

    expect(getCountermeasureTechniqueLinks).toHaveBeenCalledWith({ countermeasureId: 'sys-cm-1' })
    expect(createCountermeasure.mock.calls[0][0].techniqueLinks).toEqual(LINKS)
    expect(Object.keys(createCountermeasure.mock.calls[0][0].techniqueLinks)).toHaveLength(COUNTERMEASURE_TECHNIQUE_LINK_FIELDS.length)
    expect(createCountermeasure.mock.calls[0][0].techniqueLinks.evictsAtlas).toEqual(LINKS.evictsAtlas)
  })

  it('creates nothing and disposes nothing when the original is gone', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure, getCountermeasureTechniqueLinks } =
      buildMockDtCountermeasure()
    getCountermeasureTechniqueLinks.mockResolvedValueOnce(null)

    await expect(
      executeSupersedeCountermeasureFlow({
        systemCountermeasureId: 'sys-cm-1',
        systemCountermeasure: SYSTEM_CM,
        controlId: 'ctl-1',
        dtCountermeasure,
      }),
    ).rejects.toThrow(/not found/)
    expect(createCountermeasure).not.toHaveBeenCalled()
    expect(disposeCountermeasure).not.toHaveBeenCalled()
  })

  it('clones the SYSTEM countermeasure onto the originating Control with " (custom)" suffix + source note', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    createCountermeasure.mockResolvedValueOnce({
      ...SYSTEM_CM,
      id: 'user-cm-1',
      name: 'Multi-factor authentication (custom)',
    })
    disposeCountermeasure.mockResolvedValueOnce({ success: true })

    await executeSupersedeCountermeasureFlow({
      systemCountermeasureId: 'sys-cm-1',
      systemCountermeasure: SYSTEM_CM,
      controlId: 'ctl-1',
      dtCountermeasure,
    })

    expect(createCountermeasure).toHaveBeenCalledOnce()
    const createArgs = createCountermeasure.mock.calls[0][0]
    expect(createArgs.controlId).toBe('ctl-1')
    expect(createArgs.countermeasure.name).toBe('Multi-factor authentication (custom)')
    expect(createArgs.countermeasure.description).toContain("(custom of 'Multi-factor authentication')")
    expect(createArgs.countermeasure.id).toBe('') // id stripped; server assigns the real id
  })

  it('uses single-quote-wrapped clone name in the disposition reason (load-bearing for companion)', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    createCountermeasure.mockResolvedValueOnce({ ...SYSTEM_CM, id: 'user-cm-1', name: 'Multi-factor authentication (custom)' })
    disposeCountermeasure.mockResolvedValueOnce({ success: true })

    await executeSupersedeCountermeasureFlow({
      systemCountermeasureId: 'sys-cm-1',
      systemCountermeasure: SYSTEM_CM,
      controlId: 'ctl-1',
      dtCountermeasure,
    })

    expect(disposeCountermeasure).toHaveBeenCalledOnce()
    expect(disposeCountermeasure.mock.calls[0][0]).toEqual({
      countermeasureId: 'sys-cm-1',
      kind: 'SUPERSEDED',
      reason: "Superseded by user-authored countermeasure 'Multi-factor authentication (custom)'",
    })
  })

  it('honors cloneNameSuffix override', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    createCountermeasure.mockResolvedValueOnce({ ...SYSTEM_CM, id: 'user-cm-1', name: 'Multi-factor authentication – customized' })
    disposeCountermeasure.mockResolvedValueOnce({ success: true })

    await executeSupersedeCountermeasureFlow({
      systemCountermeasureId: 'sys-cm-1',
      systemCountermeasure: SYSTEM_CM,
      controlId: 'ctl-1',
      cloneNameSuffix: ' – customized',
      dtCountermeasure,
    })

    expect(createCountermeasure.mock.calls[0][0].countermeasure.name).toBe('Multi-factor authentication – customized')
  })

  it('does not call disposeCountermeasure if createCountermeasure throws', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    createCountermeasure.mockRejectedValueOnce(new Error('create failed'))

    await expect(
      executeSupersedeCountermeasureFlow({
        systemCountermeasureId: 'sys-cm-1',
        systemCountermeasure: SYSTEM_CM,
        controlId: 'ctl-1',
        dtCountermeasure,
      }),
    ).rejects.toThrow('create failed')
    expect(disposeCountermeasure).not.toHaveBeenCalled()
  })

  it('throws (no dispose) when createCountermeasure resolves null', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    createCountermeasure.mockResolvedValueOnce(null)

    await expect(
      executeSupersedeCountermeasureFlow({
        systemCountermeasureId: 'sys-cm-1',
        systemCountermeasure: SYSTEM_CM,
        controlId: 'ctl-1',
        dtCountermeasure,
      }),
    ).rejects.toThrow('createCountermeasure returned null')
    expect(disposeCountermeasure).not.toHaveBeenCalled()
  })

  it('surfaces dispose result on partial failure (USER copy created, disposition failed)', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    createCountermeasure.mockResolvedValueOnce({ ...SYSTEM_CM, id: 'user-cm-1', name: 'Multi-factor authentication (custom)' })
    disposeCountermeasure.mockResolvedValueOnce({
      success: false,
      errorCode: 'DATABASE_ERROR',
      errorMessage: 'transient backend failure',
    })

    const result = await executeSupersedeCountermeasureFlow({
      systemCountermeasureId: 'sys-cm-1',
      systemCountermeasure: SYSTEM_CM,
      controlId: 'ctl-1',
      dtCountermeasure,
    })

    expect(result.userCopy.id).toBe('user-cm-1')
    expect(result.systemDispositionResult.success).toBe(false)
    expect(result.systemDispositionResult.errorCode).toBe('DATABASE_ERROR')
  })

  it('handles SYSTEM countermeasure with no description (still appends sourceNote)', async () => {
    const { dtCountermeasure, createCountermeasure, disposeCountermeasure } = buildMockDtCountermeasure()
    const noDesc = { ...SYSTEM_CM, description: '' }
    createCountermeasure.mockResolvedValueOnce({ ...noDesc, id: 'user-cm-1', name: 'Multi-factor authentication (custom)' })
    disposeCountermeasure.mockResolvedValueOnce({ success: true })

    await executeSupersedeCountermeasureFlow({
      systemCountermeasureId: 'sys-cm-1',
      systemCountermeasure: noDesc,
      controlId: 'ctl-1',
      dtCountermeasure,
    })

    expect(createCountermeasure.mock.calls[0][0].countermeasure.description).toBe("(custom of 'Multi-factor authentication')")
  })
})
