/**
 * Unit tests for the `withCancellableLatest` primitive on `DtUtils`.
 *
 * The primitive supports fast-typing UX (autocomplete, search) where only the
 * latest query's result is relevant. Mirrors the lock-helper test style:
 * real promises + manual deferred resolvers (no fake timers).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtUtils } from '../dt-utils.js'
import { CancelledError } from '../errors.js'

/** Drain all pending microtasks (and 0ms timers) under real timers. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** A DtUtils whose Apollo client is a bare `mutate` spy — lets the real
 *  withMutex/withDeduplication/executeActualMutation run and asserts at the
 *  network boundary (mirrors the below-the-seam style of the entity tests). */
function mutateHarness() {
  const mutate = vi.fn()
  const utils = new DtUtils({ mutate } as unknown as Apollo.ApolloClient)
  return { utils, mutate }
}

function defer<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('DtUtils.performMutation — a legitimate boolean false is not "no data"', () => {
  it('resolves to false (does not throw "No data returned")', async () => {
    const { utils, mutate } = mutateHarness()
    mutate.mockResolvedValueOnce({ data: { deleteOrphanedClass: false } })

    const result = await utils.performMutation<boolean>({
      mutation: {} as any,
      variables: {},
      dataPath: 'deleteOrphanedClass',
      action: 'deleteOrphanedClass',
      deduplicationKey: false,
    })

    expect(result).toBe(false)
  })

  it('still throws when the resolver genuinely returns null/undefined', async () => {
    const { utils, mutate } = mutateHarness()
    mutate.mockResolvedValueOnce({ data: { someAction: null } })

    await expect(
      utils.performMutation({ mutation: {} as any, variables: {}, dataPath: 'someAction', action: 'someAction', deduplicationKey: false }),
    ).rejects.toThrow('No data returned')
  })
})

describe('DtUtils.withCancellableLatest', () => {
  let utils: DtUtils

  beforeEach(() => {
    utils = new DtUtils({} as Apollo.ApolloClient)
  })

  it('resolves a single call normally', async () => {
    const result = await utils.withCancellableLatest('k', async () => 7)
    expect(result).toBe(7)
  })

  it('does not interfere across different keys', async () => {
    const dA = defer<number>()
    const dB = defer<number>()
    const pA = utils.withCancellableLatest('keyA', () => dA.promise)
    const pB = utils.withCancellableLatest('keyB', () => dB.promise)
    dA.resolve(1)
    dB.resolve(2)
    await expect(pA).resolves.toBe(1)
    await expect(pB).resolves.toBe(2)
  })

  it('cancels the older call when a newer call with the same key arrives', async () => {
    const dFirst = defer<number>()
    const dSecond = defer<number>()
    const pFirst = utils.withCancellableLatest('k', () => dFirst.promise)
    const pSecond = utils.withCancellableLatest('k', () => dSecond.promise)
    dFirst.resolve(11)
    dSecond.resolve(22)
    await expect(pFirst).rejects.toBeInstanceOf(CancelledError)
    await expect(pSecond).resolves.toBe(22)
  })

  it('cancels all but the last of three rapid calls', async () => {
    const d1 = defer<string>()
    const d2 = defer<string>()
    const d3 = defer<string>()
    const p1 = utils.withCancellableLatest('k', () => d1.promise)
    const p2 = utils.withCancellableLatest('k', () => d2.promise)
    const p3 = utils.withCancellableLatest('k', () => d3.promise)
    d1.resolve('a')
    d2.resolve('b')
    d3.resolve('c')
    await expect(p1).rejects.toBeInstanceOf(CancelledError)
    await expect(p2).rejects.toBeInstanceOf(CancelledError)
    await expect(p3).resolves.toBe('c')
  })

  it('propagates the underlying error when the call is the latest', async () => {
    const original = new Error('boom')
    await expect(
      utils.withCancellableLatest('k', async () => { throw original })
    ).rejects.toBe(original)
  })

  it('reports CancelledError when a superseded call rejects', async () => {
    const dFirst = defer<number>()
    const dSecond = defer<number>()
    const pFirst = utils.withCancellableLatest('k', () => dFirst.promise)
    const pSecond = utils.withCancellableLatest('k', () => dSecond.promise)
    dFirst.reject(new Error('network blip'))
    dSecond.resolve(42)
    await expect(pFirst).rejects.toBeInstanceOf(CancelledError)
    await expect(pSecond).resolves.toBe(42)
  })

  it('exposes the cancellation key on CancelledError', async () => {
    const dFirst = defer<number>()
    const dSecond = defer<number>()
    const pFirst = utils.withCancellableLatest('matchClasses:COMPONENT:PROCESS', () => dFirst.promise)
    const pSecond = utils.withCancellableLatest('matchClasses:COMPONENT:PROCESS', () => dSecond.promise)
    dFirst.resolve(1)
    dSecond.resolve(2)
    try {
      await pFirst
      throw new Error('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(CancelledError)
      expect((err as CancelledError).name).toBe('CancelledError')
      expect((err as CancelledError).key).toBe('matchClasses:COMPONENT:PROCESS')
    }
    await expect(pSecond).resolves.toBe(2)
  })

  it('cleans up its token map after settlement', async () => {
    const d1 = defer<number>()
    const d2 = defer<number>()
    const p1 = utils.withCancellableLatest('k', () => d1.promise)
    const p2 = utils.withCancellableLatest('k', () => d2.promise)
    d1.resolve(1)
    d2.resolve(2)
    await expect(p1).rejects.toBeInstanceOf(CancelledError)
    await expect(p2).resolves.toBe(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((utils as any).cancellableLatestTokens.size).toBe(0)
  })
})

describe('DtUtils.withMutex (real FIFO mutex)', () => {
  it('runs contenders on the same key strictly serially (never >1 in flight), preserving order', async () => {
    const utils = new DtUtils({} as Apollo.ApolloClient)
    let inFlight = 0
    let maxInFlight = 0
    const order: number[] = []
    const d1 = defer<void>()
    const d2 = defer<void>()
    const d3 = defer<void>()
    const op = (n: number, d: { promise: Promise<void> }) => async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await d.promise
      order.push(n)
      inFlight--
      return n
    }

    const p1 = utils.withMutex('k', op(1, d1))
    const p2 = utils.withMutex('k', op(2, d2))
    const p3 = utils.withMutex('k', op(3, d3))

    await flush()
    expect(inFlight).toBe(1) // only the first holder has started

    d1.resolve()
    d2.resolve()
    d3.resolve()
    const results = await Promise.all([p1, p2, p3])

    expect(results).toEqual([1, 2, 3])
    expect(order).toEqual([1, 2, 3]) // FIFO order preserved
    expect(maxInFlight).toBe(1) // strict mutual exclusion — never two at once
  })

  it('does not leak a rejected holder\'s error into the next waiter', async () => {
    const utils = new DtUtils({} as Apollo.ApolloClient)
    const dA = defer<number>()
    let bRan = false
    const pA = utils.withMutex('k', () => dA.promise)
    const pB = utils.withMutex('k', async () => {
      bRan = true
      return 99
    })

    dA.reject(new Error('A failed'))

    await expect(pA).rejects.toThrow('A failed')
    await expect(pB).resolves.toBe(99) // B ran its own fn and got its own result
    expect(bRan).toBe(true)
  })

  it('does not cross-delete: a later waiter\'s entry survives an earlier holder\'s cleanup', async () => {
    const utils = new DtUtils({} as Apollo.ApolloClient)
    const dA = defer<number>()
    const dB = defer<number>()
    const pA = utils.withMutex('k', () => dA.promise)
    const pB = utils.withMutex('k', () => dB.promise)

    dA.resolve(1)
    await pA
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((utils as any).mutex.has('k')).toBe(true) // B still owns the key
    dB.resolve(2)
    await pB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((utils as any).mutex.has('k')).toBe(false) // cleaned up after the last waiter
  })
})

describe('DtUtils.performMutation (dedup outer / mutex inner / awaited catch)', () => {
  const boundaryOk = { data: { updateBoundaries: { boundaries: [{ id: 'b1' }] } } }
  const baseOpts = {
    mutation: {},
    dataPath: 'updateBoundaries.boundaries[0]',
    action: 'updateBoundary',
    deduplicationKey: 'update-boundary-b1',
  }

  it('does NOT collapse two distinct-variable writes that share an id-only dedup key (lost-write regression)', async () => {
    const { utils, mutate } = mutateHarness()
    mutate.mockResolvedValue(boundaryOk)

    const write = (name: string) =>
      utils.performMutation({
        ...baseOpts,
        variables: { id: 'b1', input: { name: { set: name } } },
      })

    await Promise.all([write('Alpha'), write('Beta')])

    expect(mutate).toHaveBeenCalledTimes(2) // neither write silently dropped
    const sentNames = mutate.mock.calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c) => (c[0] as any).variables.input.name.set)
      .sort()
    expect(sentNames).toEqual(['Alpha', 'Beta'])
  })

  it('collapses two identical concurrent submits into a single network call', async () => {
    const { utils, mutate } = mutateHarness()
    const d = defer<typeof boundaryOk>()
    mutate.mockReturnValue(d.promise)

    const variables = { id: 'b1', input: { name: { set: 'Alpha' } } }
    const p1 = utils.performMutation({ ...baseOpts, variables })
    const p2 = utils.performMutation({ ...baseOpts, variables: { ...variables, input: { name: { set: 'Alpha' } } } })

    await flush()
    expect(mutate).toHaveBeenCalledTimes(1) // second joined the first's in-flight promise

    d.resolve(boundaryOk)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(r2)
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('routes a rejected mutation through handleError and rethrows (the awaited catch)', async () => {
    const { utils, mutate } = mutateHarness()
    const handleError = vi.spyOn(utils, 'handleError')
    mutate.mockRejectedValue(new Error('boom'))

    await expect(
      utils.performMutation({
        mutation: {},
        variables: { id: 'x' },
        dataPath: '',
        action: 'updateThing',
        deduplicationKey: false,
      })
    ).rejects.toThrow('boom')

    expect(handleError).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((handleError.mock.calls[0][0] as any).action).toBe('updateThing')
  })

  it('does not retry a failed mutation on a timeout-shaped error', async () => {
    const { utils, mutate } = mutateHarness()
    mutate.mockRejectedValue(new Error('network timeout'))

    await expect(
      utils.performMutation({
        mutation: {},
        variables: { id: 'x' },
        dataPath: '',
        action: 'updateThing',
        deduplicationKey: false,
      })
    ).rejects.toThrow('timeout')

    expect(mutate).toHaveBeenCalledTimes(1) // no auto-retry (old code re-sent up to 4x)
  })
})

describe('DtUtils.performQuery still retries on network errors', () => {
  it('retries a failed query on a timeout-shaped error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('network timeout'))
    const utils = new DtUtils({ query } as unknown as Apollo.ApolloClient)

    await expect(
      utils.performQuery({
        query: {},
        action: 'q',
        retryConfig: { maxRetries: 2, baseDelay: 0, maxDelay: 0 },
      })
    ).rejects.toThrow('timeout')

    expect(query).toHaveBeenCalledTimes(3) // 1 initial + 2 retries — queries keep retrying
  })
})

describe('DtUtils.withDeduplication TTL (identity-checked, cleared on settle)', () => {
  it('removes its entry and clears the TTL timer on settle', async () => {
    vi.useFakeTimers()
    try {
      const { utils, mutate } = mutateHarness()
      mutate.mockResolvedValueOnce({ data: { r: { x: [{ id: '1' }] } } })

      await utils.performMutation({
        mutation: {},
        variables: { n: 1 },
        dataPath: 'r.x[0]',
        action: 'a',
        deduplicationKey: 'dk',
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((utils as any).requestDeduplicator.size).toBe(0) // entry gone on settle
      expect(vi.getTimerCount()).toBe(0) // TTL timer cleared, not left pending
    } finally {
      vi.useRealTimers()
    }
  })

  it('TTL backstop evicts only its own stuck entry (identity-checked)', async () => {
    vi.useFakeTimers()
    try {
      const { utils, mutate } = mutateHarness()
      const stuck = defer<{ data: unknown }>()
      mutate.mockReturnValue(stuck.promise)

      const p = utils.performMutation({
        mutation: {},
        variables: { n: 1 },
        dataPath: 'r.x[0]',
        action: 'a',
        deduplicationKey: 'dk',
      })
      await Promise.resolve()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((utils as any).requestDeduplicator.size).toBe(1)

      vi.advanceTimersByTime(15000) // fire the backstop while still in flight
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((utils as any).requestDeduplicator.size).toBe(0) // evicted its own entry

      stuck.resolve({ data: { r: { x: [{ id: '1' }] } } })
      await p
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DtUtils.deepMerge (own-keys only)', () => {
  afterEach(() => {
    // Defensive: if the own-keys guard ever regressed, the inherited-key test
    // below would write onto the shared Object.prototype.toString. Scrub it so a
    // regression fails that one test cleanly instead of poisoning the whole run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Object.prototype.toString as any).hacked
  })

  it('merges nested own objects exactly as before', () => {
    const utils = new DtUtils({} as Apollo.ApolloClient)
    const target: Record<string, unknown> = { a: { x: 1 }, b: 2 }
    utils.deepMerge(target, { a: { y: 3 }, c: 4 })
    expect(target).toEqual({ a: { x: 1, y: 3 }, b: 2, c: 4 })
  })

  it('never resolves or writes through an inherited key onto a shared built-in', () => {
    const utils = new DtUtils({} as Apollo.ApolloClient)
    const target: Record<string, unknown> = {}
    // `toString` is inherited from Object.prototype, not an own key of target.
    utils.deepMerge(target, { toString: { hacked: true } })

    // The old `target[key] || {}` would resolve the inherited function and merge
    // `hacked` onto the SHARED Object.prototype.toString. It must stay clean.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((Object.prototype.toString as any).hacked).toBeUndefined()
    // A fresh own key is created on the target instead.
    expect(target.toString).toEqual({ hacked: true })
  })
})
