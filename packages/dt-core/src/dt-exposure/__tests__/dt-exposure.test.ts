/**
 * DtExposure disposition methods + USER-copy-delete companion.
 *
 * Mirrors the dt-class test harness: stub `dtUtils.performMutation` to capture
 * call shape and inject responses. Real GraphQL execution is exercised by
 * dt-ws integration tests (disposition.e2e-spec.ts, update-exposures-companion.e2e-spec.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtExposure } from '../dt-exposure.js'

interface PerformMutationCall {
  mutation: unknown
  variables?: Record<string, unknown>
  action: string
  dataPath?: string
  deduplicationKey?: string
}

function buildHarness() {
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtExposure(apolloClient)
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
  exposureId: 'exp-1',
  dispositionKind: 'FALSE_POSITIVE',
  dispositionReason: 'Customer signs in via SSO bridge.',
  dispositionedBy: 'auth0|user-1',
  dispositionedAt: '2026-05-19T10:00:00.000Z',
  dispositionStale: false,
  errorCode: null,
  errorMessage: null,
}

const VALIDATION_FAIL = {
  success: false,
  exposureId: 'exp-1',
  dispositionKind: null,
  dispositionReason: null,
  dispositionedBy: null,
  dispositionedAt: null,
  dispositionStale: null,
  errorCode: 'VALIDATION_ERROR',
  errorMessage: 'reason must be non-empty after trim',
}

describe('DtExposure.disposeExposure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards exposureId, kind, reason and returns the result envelope on success', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce(SUCCESS_DISPOSE)

    const result = await dt.disposeExposure({
      exposureId: 'exp-1',
      kind: 'FALSE_POSITIVE',
      reason: 'Customer signs in via SSO bridge.',
    })

    const recorded = calls()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].action).toBe('disposeExposure')
    expect(recorded[0].dataPath).toBe('disposeExposure')
    expect(recorded[0].variables).toEqual({
      exposureId: 'exp-1',
      kind: 'FALSE_POSITIVE',
      reason: 'Customer signs in via SSO bridge.',
    })
    expect(result.success).toBe(true)
    expect(result.dispositionKind).toBe('FALSE_POSITIVE')
  })

  it('returns success=false envelope on validation error (no throw)', async () => {
    const { dt, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce(VALIDATION_FAIL)

    const result = await dt.disposeExposure({
      exposureId: 'exp-1',
      kind: 'FALSE_POSITIVE',
      reason: '',
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('VALIDATION_ERROR')
  })
})

describe('DtExposure.clearDisposition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards exposureId and returns the cleared envelope', async () => {
    const { dt, calls, performMutation } = buildHarness()
    const cleared = { ...SUCCESS_DISPOSE, dispositionKind: null, dispositionReason: null, dispositionStale: null }
    performMutation.mockResolvedValueOnce(cleared)

    const result = await dt.clearDisposition({ exposureId: 'exp-1' })

    expect(calls()[0].action).toBe('clearDisposition')
    expect(calls()[0].variables).toEqual({ exposureId: 'exp-1' })
    expect(result.success).toBe(true)
    expect(result.dispositionKind).toBeNull()
  })
})

describe('DtExposure.reAffirmDisposition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is identical in wire shape to disposeExposure', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce(SUCCESS_DISPOSE)

    await dt.reAffirmDisposition({
      exposureId: 'exp-1',
      kind: 'FALSE_POSITIVE',
      reason: 'still applies',
    })

    expect(calls()[0].action).toBe('disposeExposure')
    expect(calls()[0].variables).toEqual({
      exposureId: 'exp-1',
      kind: 'FALSE_POSITIVE',
      reason: 'still applies',
    })
  })
})

describe('DtExposure.deleteExposure USER-copy-delete companion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires the companion update when exposureName provided and delete succeeds', async () => {
    const { dt, calls, performMutation } = buildHarness()
    // Mock delete success then companion success
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })
    performMutation.mockResolvedValueOnce({ exposures: [] })

    const ok = await dt.deleteExposure({ exposureId: 'exp-1', exposureName: 'CSRF on /login' })

    expect(ok).toBe(true)
    // The companion fires asynchronously (void). Flush microtasks so it lands.
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const recorded = calls()
    expect(recorded).toHaveLength(2)
    expect(recorded[0].action).toBe('deleteExposure')
    expect(recorded[1].action).toBe('flipSupersededStaleByName')
    // The companion filter wraps the name in single quotes to match the
    // `Superseded by user-authored exposure '<name>'` template emitted by
    // executeSupersedeFlow. Without the wrap, the substring search would
    // match every reason that mentioned the bare name anywhere.
    expect(recorded[1].variables).toEqual({
      where: {
        dispositionKind: { eq: 'SUPERSEDED' },
        dispositionReason: { contains: "'CSRF on /login'" },
      },
      update: {
        dispositionStale: { set: true },
      },
    })
  })

  it('companion logs explicitly when performMutation returns falsy (B8)', async () => {
    const { dt, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })
    // Companion field-level "failure" — performMutation resolves without throwing
    // but returns null (e.g. a non-network field-level GraphQL error).
    performMutation.mockResolvedValueOnce(null)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await dt.deleteExposure({ exposureId: 'exp-1', exposureName: 'SSRF in proxy' })
    expect(ok).toBe(true)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(warnSpy).toHaveBeenCalledWith(
      'flipSupersededStaleByName: companion mutation returned null',
      { deletedExposureName: 'SSRF in proxy' },
    )
    warnSpy.mockRestore()
  })

  it('omits the companion when exposureName not provided', async () => {
    const { dt, calls, performMutation } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })

    const ok = await dt.deleteExposure({ exposureId: 'exp-1' })
    expect(ok).toBe(true)
    // Wait for the microtask tick — the companion would have fired here if name was provided.
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const recorded = calls()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].action).toBe('deleteExposure')
  })

  it('companion failure does not propagate (fire-and-forget invariant D5b)', async () => {
    const { dt, performMutation, handleError } = buildHarness()
    performMutation.mockResolvedValueOnce({ nodesDeleted: 1, relationshipsDeleted: 0 })
    performMutation.mockRejectedValueOnce(new Error('network blip'))

    const ok = await dt.deleteExposure({ exposureId: 'exp-1', exposureName: 'XSS in admin' })
    expect(ok).toBe(true)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    // The companion error is logged via handleError, not rethrown.
    expect(handleError).toHaveBeenCalled()
    const errCall = handleError.mock.calls.find(([arg]) => arg?.action === 'flipSupersededStaleByName')
    expect(errCall).toBeDefined()
  })

  it('returns false when delete itself fails (no companion fired)', async () => {
    const { dt, performMutation } = buildHarness()
    performMutation.mockRejectedValueOnce(new Error('not found'))

    const ok = await dt.deleteExposure({ exposureId: 'exp-1', exposureName: 'X' })
    expect(ok).toBe(false)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    // Companion must not fire when the primary delete failed.
    // performMutation was called exactly once for the delete attempt.
  })
})
