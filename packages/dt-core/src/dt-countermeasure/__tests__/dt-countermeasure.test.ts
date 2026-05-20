/**
 * DtCountermeasure disposition methods.
 *
 * Mirrors the dt-exposure test harness: stub `dtUtils.performMutation` to
 * capture call shape and inject responses. Real GraphQL execution is exercised
 * by dt-ws integration tests (disposition.e2e-spec.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtCountermeasure } from '../dt-countermeasure.js'

interface PerformMutationCall {
  mutation: unknown
  variables?: Record<string, unknown>
  action: string
  dataPath?: string
  deduplicationKey?: string | false
}

function buildHarness() {
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtCountermeasure(apolloClient)
  const performMutation = vi.fn<(input: PerformMutationCall) => Promise<unknown>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performMutation = performMutation
  const handleError = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.handleError = handleError
  const calls = (): PerformMutationCall[] =>
    performMutation.mock.calls.map(([input]) => input)
  return { dt, calls, performMutation, handleError }
}

const SUCCESS_DISPOSE = {
  success: true,
  exposureId: 'cm-1',
  dispositionKind: 'WAIVED',
  dispositionReason: 'Internal-only admin tool; MFA waived.',
  dispositionedBy: 'auth0|user-1',
  dispositionedAt: '2026-05-20T10:00:00.000Z',
  dispositionStale: false,
  errorCode: null,
  errorMessage: null,
}

const VALIDATION_FAIL = {
  success: false,
  exposureId: 'cm-1',
  dispositionKind: null,
  dispositionReason: null,
  dispositionedBy: null,
  dispositionedAt: null,
  dispositionStale: null,
  errorCode: 'VALIDATION_ERROR',
  errorMessage: 'reason must be non-empty after trim',
}

describe('DtCountermeasure.disposeCountermeasure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards countermeasureId, kind, reason and returns the result envelope on success', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce(SUCCESS_DISPOSE)

    const result = await dt.disposeCountermeasure({
      countermeasureId: 'cm-1',
      kind: 'WAIVED',
      reason: 'Internal-only admin tool; MFA waived.',
    })

    const recorded = calls()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].action).toBe('disposeCountermeasure')
    expect(recorded[0].dataPath).toBe('disposeCountermeasure')
    expect(recorded[0].variables).toEqual({
      countermeasureId: 'cm-1',
      kind: 'WAIVED',
      reason: 'Internal-only admin tool; MFA waived.',
    })
    expect(result.success).toBe(true)
    expect(result.dispositionKind).toBe('WAIVED')
  })

  it('returns success=false envelope on validation error (no throw)', async () => {
    const { dt, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce(VALIDATION_FAIL)

    const result = await dt.disposeCountermeasure({
      countermeasureId: 'cm-1',
      kind: 'WAIVED',
      reason: '',
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })
})

describe('DtCountermeasure.clearCountermeasureDisposition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards countermeasureId and returns the cleared envelope', async () => {
    const { dt, calls, performMutation } = buildHarness()
    const cleared = { ...SUCCESS_DISPOSE, dispositionKind: null, dispositionReason: null, dispositionStale: null }
    performMutation.mockResolvedValueOnce(cleared)

    const result = await dt.clearCountermeasureDisposition({ countermeasureId: 'cm-1' })

    expect(calls()[0].action).toBe('clearCountermeasureDisposition')
    expect(calls()[0].dataPath).toBe('clearCountermeasureDisposition')
    expect(calls()[0].variables).toEqual({ countermeasureId: 'cm-1' })
    expect(result.success).toBe(true)
    expect(result.dispositionKind).toBeNull()
  })
})

describe('DtCountermeasure.deleteCountermeasure USER-copy-delete companion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires the companion update when countermeasureName provided and delete succeeds', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })
    performMutation.mockResolvedValueOnce({ countermeasures: [] })

    const ok = await dt.deleteCountermeasure({ countermeasureId: 'cm-1', countermeasureName: 'Custom MFA' })
    expect(ok).toBe(true)
    // The companion fires asynchronously (void). Flush microtasks so it lands.
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const recorded = calls()
    expect(recorded).toHaveLength(2)
    expect(recorded[0].action).toBe('deleteCountermeasure')
    expect(recorded[1].action).toBe('flipSupersededCountermeasureStaleByName')
    // Single-quote wrap matches the `Superseded by user-authored countermeasure '<name>'`
    // template; without it the substring search would over-match.
    expect(recorded[1].variables).toEqual({
      where: {
        dispositionKind: { eq: 'SUPERSEDED' },
        dispositionReason: { contains: "'Custom MFA'" },
      },
      update: {
        dispositionStale: { set: true },
      },
    })
  })

  it('omits the companion when countermeasureName not provided', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })

    const ok = await dt.deleteCountermeasure({ countermeasureId: 'cm-1' })
    expect(ok).toBe(true)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const recorded = calls()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].action).toBe('deleteCountermeasure')
  })

  it('companion failure does not propagate (fire-and-forget)', async () => {
    const { dt, performMutation, handleError } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })
    performMutation.mockRejectedValueOnce(new Error('network blip'))

    const ok = await dt.deleteCountermeasure({ countermeasureId: 'cm-1', countermeasureName: 'Custom MFA' })
    expect(ok).toBe(true)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(handleError).toHaveBeenCalled()
    const errCall = handleError.mock.calls.find(([arg]) => arg?.action === 'flipSupersededCountermeasureStaleByName')
    expect(errCall).toBeDefined()
  })

  it('companion logs explicitly when performMutation returns falsy', async () => {
    const { dt, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })
    performMutation.mockResolvedValueOnce(null)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await dt.deleteCountermeasure({ countermeasureId: 'cm-1', countermeasureName: 'Custom MFA' })
    expect(ok).toBe(true)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(warnSpy).toHaveBeenCalledWith(
      'flipSupersededCountermeasureStaleByName: companion mutation returned null',
      { deletedCountermeasureName: 'Custom MFA' },
    )
    warnSpy.mockRestore()
  })

  it('returns false when delete itself fails (no companion fired)', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockRejectedValueOnce(new Error('not found'))

    const ok = await dt.deleteCountermeasure({ countermeasureId: 'cm-1', countermeasureName: 'X' })
    expect(ok).toBe(false)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(calls()).toHaveLength(1)
  })
})
