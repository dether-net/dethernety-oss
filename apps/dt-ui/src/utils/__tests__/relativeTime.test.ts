import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatRelative } from '../relativeTime'

const NOW = new Date('2026-05-10T12:00:00.000Z').getTime()

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Never" for null/undefined/empty input', () => {
    expect(formatRelative(undefined)).toBe('Never')
    expect(formatRelative(null)).toBe('Never')
    expect(formatRelative('')).toBe('Never')
  })

  it('returns "unknown" for unparseable input', () => {
    expect(formatRelative('not-a-date')).toBe('unknown')
  })

  it('returns "just now" for future timestamps', () => {
    expect(formatRelative(new Date(NOW + 1000).toISOString())).toBe('just now')
  })

  it('formats seconds for sub-minute deltas', () => {
    expect(formatRelative(new Date(NOW - 5_000).toISOString())).toBe('5s ago')
    expect(formatRelative(new Date(NOW - 30_000).toISOString())).toBe('30s ago')
  })

  it('formats minutes for sub-hour deltas', () => {
    expect(formatRelative(new Date(NOW - 60_000).toISOString())).toBe('1m ago')
    expect(formatRelative(new Date(NOW - 30 * 60_000).toISOString())).toBe('30m ago')
  })

  it('formats hours for sub-day deltas', () => {
    expect(formatRelative(new Date(NOW - 60 * 60_000).toISOString())).toBe('1h ago')
    expect(formatRelative(new Date(NOW - 5 * 60 * 60_000).toISOString())).toBe('5h ago')
  })

  it('formats days for sub-week deltas', () => {
    expect(formatRelative(new Date(NOW - 24 * 60 * 60_000).toISOString())).toBe('1d ago')
    expect(formatRelative(new Date(NOW - 6 * 24 * 60 * 60_000).toISOString())).toBe('6d ago')
  })

  it('formats weeks for older deltas', () => {
    expect(formatRelative(new Date(NOW - 7 * 24 * 60 * 60_000).toISOString())).toBe('1w ago')
    expect(formatRelative(new Date(NOW - 4 * 7 * 24 * 60 * 60_000).toISOString())).toBe('4w ago')
  })
})
