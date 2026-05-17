/**
 * Unit tests for DtClass.changeElementBinding.
 *
 * - Verifies that two consecutive calls on the same elementId from the same
 *   DtClass instance serialise on the `binding_${elementId}` mutex —
 *   same-instance binding-call serialisation. Cross-instance serialisation
 *   is NOT claimed by the mutex; that's covered by the backend
 *   single-transaction guarantee.
 * - Verifies the binding-target shape is correctly coerced for each kind.
 */

import { describe, it, expect, vi } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtClass } from '../dt-class.js'

interface PerformMutationCall {
  mutation: unknown
  variables?: Record<string, unknown>
  action: string
  dataPath?: string
}

function buildHarness() {
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtClass(apolloClient)
  const performMutation = vi.fn<(input: PerformMutationCall) => Promise<unknown>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performMutation = performMutation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realWithMutex = (dt as any).dtUtils.withMutex.bind((dt as any).dtUtils)
  return { dt, performMutation, realWithMutex }
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

const SUCCESS_RESULT = {
  success: true,
  elementId: 'elt-1',
  targetBinding: { __typename: 'ClassBinding', classIds: ['cls-1'] },
  deltas: {
    deletedDerivedExposures: 0,
    instantiatedDerivedExposures: 1,
    preservedCustomExposures: 0,
    deletedDerivedCountermeasures: 0,
    instantiatedDerivedCountermeasures: 0,
    preservedCustomCountermeasures: 0,
  },
  errorCode: null,
  errorMessage: null,
}

describe('DtClass.changeElementBinding mutex (I6)', () => {
  it('serialises two same-elementId calls on the same DtClass instance', async () => {
    const { dt, performMutation } = buildHarness()

    const first = defer<typeof SUCCESS_RESULT>()
    const second = defer<typeof SUCCESS_RESULT>()
    // First call gets the first deferred; second call gets the second.
    // If the mutex doesn't serialise, both calls fire performMutation
    // concurrently (mock.calls.length === 2 before either resolves).
    performMutation
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const p1 = dt.changeElementBinding({
      elementId: 'elt-1',
      target: { kind: 'CLASS', classIds: ['cls-1'] },
    })
    const p2 = dt.changeElementBinding({
      elementId: 'elt-1',
      target: { kind: 'CLASS', classIds: ['cls-2'] },
    })

    // Yield to the event loop a few times so the second call would have a
    // chance to enter performMutation if it weren't serialised.
    await Promise.resolve()
    await Promise.resolve()
    expect(performMutation).toHaveBeenCalledTimes(1)
    expect(performMutation.mock.calls[0][0].variables).toEqual({
      elementId: 'elt-1',
      target: { kind: 'CLASS', classIds: ['cls-1'] },
    })

    first.resolve(SUCCESS_RESULT)
    await p1

    // Now the second call should have entered performMutation.
    await Promise.resolve()
    expect(performMutation).toHaveBeenCalledTimes(2)
    expect(performMutation.mock.calls[1][0].variables).toEqual({
      elementId: 'elt-1',
      target: { kind: 'CLASS', classIds: ['cls-2'] },
    })

    second.resolve({ ...SUCCESS_RESULT, deltas: { ...SUCCESS_RESULT.deltas, instantiatedDerivedExposures: 2 } })
    await p2
  })

  it('does NOT serialise across different elementIds', async () => {
    const { dt, performMutation } = buildHarness()

    const a = defer<typeof SUCCESS_RESULT>()
    const b = defer<typeof SUCCESS_RESULT>()
    performMutation
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => b.promise)

    dt.changeElementBinding({ elementId: 'elt-A', target: { kind: 'CLASS', classIds: ['c1'] } })
    dt.changeElementBinding({ elementId: 'elt-B', target: { kind: 'CLASS', classIds: ['c2'] } })

    await Promise.resolve()
    await Promise.resolve()
    expect(performMutation).toHaveBeenCalledTimes(2)
    a.resolve(SUCCESS_RESULT)
    b.resolve(SUCCESS_RESULT)
  })

  it('coerces target shape correctly per kind', async () => {
    const { dt, performMutation } = buildHarness()
    performMutation.mockResolvedValue(SUCCESS_RESULT)

    await dt.changeElementBinding({ elementId: 'e-1', target: { kind: 'CLASS', classIds: ['c1', 'c2'] } })
    await dt.changeElementBinding({ elementId: 'e-2', target: { kind: 'REPRESENTED_MODEL', modelId: 'm-1' } })
    await dt.changeElementBinding({ elementId: 'e-3', target: { kind: 'NONE' } })

    expect(performMutation).toHaveBeenCalledTimes(3)
    expect(performMutation.mock.calls[0][0].variables).toEqual({
      elementId: 'e-1',
      target: { kind: 'CLASS', classIds: ['c1', 'c2'] },
    })
    expect(performMutation.mock.calls[1][0].variables).toEqual({
      elementId: 'e-2',
      target: { kind: 'REPRESENTED_MODEL', modelId: 'm-1' },
    })
    expect(performMutation.mock.calls[2][0].variables).toEqual({
      elementId: 'e-3',
      target: { kind: 'NONE' },
    })
  })
})
