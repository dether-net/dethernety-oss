import { describe, it, expect, vi } from 'vitest'
import { deriveLifecycle } from '../composables/useThreatReportState.js'
import { fetchLiveFingerprint } from '../composables/useThreatReportData.js'

describe('deriveLifecycle', () => {
  it('is "generating" whenever a run is in flight — overriding all else', () => {
    expect(deriveLifecycle({ generated: false, stored: '', live: null, generating: true })).toBe('generating')
    expect(deriveLifecycle({ generated: true, stored: 'a', live: 'b', generating: true })).toBe('generating')
  })

  it('is "never" when no snapshot has been generated', () => {
    expect(deriveLifecycle({ generated: false, stored: '', live: 'a', generating: false })).toBe('never')
  })

  it('is "stale" when a snapshot exists and the live fingerprint differs', () => {
    expect(deriveLifecycle({ generated: true, stored: 'aaa', live: 'bbb', generating: false })).toBe('stale')
  })

  it('is "fresh" when the snapshot matches the live model', () => {
    expect(deriveLifecycle({ generated: true, stored: 'aaa', live: 'aaa', generating: false })).toBe('fresh')
  })

  it('assumes fresh (never false-stale) when live evidence is missing', () => {
    // live not yet fetched / fetch failed → null: do not cry stale.
    expect(deriveLifecycle({ generated: true, stored: 'aaa', live: null, generating: false })).toBe('fresh')
    // stored empty but generated true (defensive): no comparison possible → fresh.
    expect(deriveLifecycle({ generated: true, stored: '', live: 'bbb', generating: false })).toBe('fresh')
  })
})

describe('fetchLiveFingerprint', () => {
  // A fake dtUtils: withCancellableLatest just runs the thunk; performQuery is stubbed.
  const makeDtUtils = (performQuery) => ({
    withCancellableLatest: (_key, fn) => fn(),
    performQuery,
  })

  it('returns null without a dtUtils or modelId (no throw)', async () => {
    expect(await fetchLiveFingerprint(null, 'm1')).toBeNull()
    expect(await fetchLiveFingerprint(makeDtUtils(vi.fn()), '')).toBeNull()
  })

  it('unwraps the threatReportFingerprint field from the query result', async () => {
    const performQuery = vi.fn().mockResolvedValue({ threatReportFingerprint: 'abc123' })
    const dtUtils = makeDtUtils(performQuery)
    expect(await fetchLiveFingerprint(dtUtils, 'm1')).toBe('abc123')
    expect(performQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { modelId: 'm1' }, action: 'threatReportFingerprint' }),
    )
  })

  it('routes through withCancellableLatest keyed by model (cancel-on-replace)', async () => {
    const calls = []
    const dtUtils = {
      withCancellableLatest: (key, fn) => {
        calls.push(key)
        return fn()
      },
      performQuery: vi.fn().mockResolvedValue({ threatReportFingerprint: 'x' }),
    }
    await fetchLiveFingerprint(dtUtils, 'model-7')
    expect(calls).toEqual(['threat-report-fingerprint:model-7'])
  })

  it('swallows a superseded CancelledError to null', async () => {
    const err = new Error('superseded')
    err.name = 'CancelledError'
    const dtUtils = {
      withCancellableLatest: (_key, fn) => fn(),
      performQuery: vi.fn().mockRejectedValue(err),
    }
    expect(await fetchLiveFingerprint(dtUtils, 'm1')).toBeNull()
  })

  it('does not fabricate staleness on a real failure — falls back to null', async () => {
    const dtUtils = {
      withCancellableLatest: (_key, fn) => fn(),
      performQuery: vi.fn().mockRejectedValue(new Error('network down')),
    }
    expect(await fetchLiveFingerprint(dtUtils, 'm1')).toBeNull()
  })
})
