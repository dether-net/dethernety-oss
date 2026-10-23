import { describe, it, expect, vi, afterEach } from 'vitest'
import { timingMark, timingMeasure } from '../userTiming'

const measures = (name: string) => performance.getEntriesByName(name, 'measure') as PerformanceMeasure[]

describe('userTiming', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    performance.clearMarks()
    performance.clearMeasures()
  })

  it('measures from a mark name to now, ok by default', () => {
    timingMark('t:start')
    timingMeasure('t:span', 't:start')
    const [m] = measures('t:span')
    expect(m.duration).toBeGreaterThanOrEqual(0)
    expect(m.detail).toEqual({ ok: true })
  })

  it('measures from a performance.now() value and records a failure as ok: false', () => {
    const start = performance.now()
    timingMeasure('t:failed', start, false)
    const [m] = measures('t:failed')
    expect(m.startTime).toBe(start)
    expect(m.detail).toEqual({ ok: false })
  })

  it('never throws: an unknown start mark records nothing', () => {
    expect(() => timingMeasure('t:orphan', 't:no-such-mark')).not.toThrow()
    expect(measures('t:orphan')).toHaveLength(0)
  })

  it('never throws when the timing API itself throws', () => {
    vi.spyOn(performance, 'mark').mockImplementation(() => { throw new Error('boom') })
    vi.spyOn(performance, 'measure').mockImplementation(() => { throw new Error('boom') })
    expect(() => timingMark('t:x')).not.toThrow()
    expect(() => timingMeasure('t:y', 0)).not.toThrow()
  })
})
