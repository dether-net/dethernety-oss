/** The store of prepared settlements: a plan is given once, to its own directory, for a while, and says how it ended. */
import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS, SettlePlanStore } from '../settle-plans.js'

const bound = { baseline_revision: 3, pending_digest: 'd' }

describe('the plan store', () => {
  it('gives a plan once, to its own directory only, and then says how it ended', () => {
    const store = new SettlePlanStore<string>()
    for (const end of ['committed', 'stale', 'failed'] as const) {
      const p = store.add('/m', 'input', bound, 'f', ['line'])
      expect(store.take(p.id, '/other')).toEqual({ status: 'other_model' })
      expect(store.take(p.id, '/m')).toMatchObject({ status: 'ok', plan: { input: 'input', bound, fingerprint: 'f', lines: ['line'] } })
      // A commit of it is running: another cannot take it.
      expect(store.take(p.id, '/m')).toEqual({ status: 'running' })
      store.consume(p, end)
      expect(store.take(p.id, '/m')).toEqual({ status: 'spent', end })
    }
    expect(store.take('0'.repeat(32), '/m')).toEqual({ status: 'not_found' })
  })

  it('gives back a plan whose commit wrote nothing', () => {
    const store = new SettlePlanStore<string>()
    const p = store.add('/m', 'input', bound, 'f', [])
    expect(store.take(p.id, '/m').status).toBe('ok')
    store.release(p)
    expect(store.take(p.id, '/m').status).toBe('ok')
  })

  it('lets a plan expire, and keeps at most the newest plans', () => {
    const store = new SettlePlanStore<number>()
    const old = store.add('/m', 0, bound, 'f', [])
    store.clockOffsetMs = PLAN_LIMITS.ttlMs
    expect(store.take(old.id, '/m')).toEqual({ status: 'expired' })
    store.clockOffsetMs = 0
    const ids = Array.from({ length: PLAN_LIMITS.plans + 1 }, (_, i) => store.add('/m', i, bound, 'f', []).id)
    expect(store.size).toBe(PLAN_LIMITS.plans)
    expect(store.take(ids[0]!, '/m')).toEqual({ status: 'not_found' })
    expect(store.take(ids.at(-1)!, '/m').status).toBe('ok')
  })

  it('never drops a plan whose commit is running to make room', () => {
    const store = new SettlePlanStore<number>()
    const running = store.add('/m', 0, bound, 'f', [])
    expect(store.take(running.id, '/m').status).toBe('ok')
    const ids = Array.from({ length: PLAN_LIMITS.plans }, (_, i) => store.add('/m', i + 1, bound, 'f', []).id)
    expect(store.size).toBe(PLAN_LIMITS.plans)
    expect(store.take(ids[0]!, '/m')).toEqual({ status: 'not_found' })
    // Past its time, too: the end of its commit is still told.
    store.clockOffsetMs = PLAN_LIMITS.ttlMs
    store.add('/m', 99, bound, 'f', [])
    store.consume(running, 'committed')
    store.clockOffsetMs = 0
    expect(store.take(running.id, '/m')).toEqual({ status: 'spent', end: 'committed' })
  })
})
