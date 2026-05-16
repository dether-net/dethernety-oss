/**
 * Unit tests for the `withCancellableLatest` primitive on `DtUtils`.
 *
 * The primitive supports fast-typing UX (autocomplete, search) where only the
 * latest query's result is relevant. Mirrors the lock-helper test style:
 * real promises + manual deferred resolvers (no fake timers).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtUtils } from '../dt-utils.js'
import { CancelledError } from '../errors.js'

function defer<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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
