/**
 * Unit tests for DtClass.matchClasses and DtClass.listClasses. Mirrors the
 * dt-class-identity harness: stub `dtUtils.performQuery` to capture call
 * shape and return prepared results. Real GraphQL execution is exercised
 * via the dt-ws integration tests.
 *
 * Cancel-on-replace cases verify the `withCancellableLatest` wiring at the
 * method-call layer; the primitive itself is covered in dt-utils tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtClass } from '../dt-class.js'
import { CancelledError } from '../../dt-utils/errors.js'

interface PerformQueryCall {
  query: unknown
  variables?: Record<string, unknown>
  action: string
  fetchPolicy?: string
}

function buildHarness() {
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtClass(apolloClient)
  const performQuery = vi.fn<(input: PerformQueryCall) => Promise<unknown>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performQuery = performQuery
  const calls = (): PerformQueryCall[] =>
    performQuery.mock.calls.map(([input]) => input)
  return { dt, calls, performQuery }
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

const MATCH_RESPONSE = {
  matchClasses: {
    matches: [
      {
        elementName: 'auth-service',
        candidates: [
          {
            classId: 'cls-1',
            className: 'AuthService',
            classDescription: 'Handles authentication',
            classCategory: 'Identity',
            classType: 'PROCESS',
            moduleId: 'mod-1',
            moduleName: 'dethernety-module',
            matchType: 'exact_name',
            confidence: 'high',
          },
        ],
      },
    ],
    unmatched: [],
    vectorAvailable: true,
  },
}

const LIST_RESPONSE = {
  listClasses: {
    items: [
      {
        classId: 'cls-1',
        className: 'AuthService',
        classDescription: null,
        classCategory: 'Identity',
        classType: 'PROCESS',
        moduleId: 'mod-1',
        moduleName: 'dethernety-module',
        matchType: 'type_match',
        confidence: 'low',
        similarityScore: null,
      },
    ],
    totalCount: 1,
    facetCounts: {
      categories: [{ value: 'Identity', count: 1 }],
      modules: [{ moduleId: 'mod-1', moduleName: 'dethernety-module', count: 1 }],
      types: [{ value: 'PROCESS', count: 1 }],
    },
  },
}

describe('DtClass.matchClasses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the matchClasses payload including vectorAvailable', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE)

    const result = await dt.matchClasses({
      elements: [{ name: 'auth-service', description: 'login flow' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
      topN: 6,
    })

    expect(result.vectorAvailable).toBe(true)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].candidates[0].classId).toBe('cls-1')
    expect(result.unmatched).toEqual([])
  })

  it('passes input variables and uses network-only fetchPolicy', async () => {
    const { dt, calls, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE)

    await dt.matchClasses({
      elements: [{ name: 'auth-service' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
      moduleIds: ['mod-1'],
      topN: 8,
      fields: ['description', 'category'],
    })

    const recorded = calls()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].action).toBe('matchClasses')
    expect(recorded[0].fetchPolicy).toBe('network-only')
    expect(recorded[0].variables).toEqual({
      input: {
        elements: [{ name: 'auth-service' }],
        classLabel: 'COMPONENT',
        componentType: 'PROCESS',
        moduleIds: ['mod-1'],
        topN: 8,
        fields: ['description', 'category'],
      },
    })
  })

  it('omits optional variables when not provided', async () => {
    const { dt, calls, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE)

    await dt.matchClasses({
      elements: [{ name: 'x' }],
      classLabel: 'CONTROL',
    })

    expect(calls()[0].variables).toEqual({
      input: { elements: [{ name: 'x' }], classLabel: 'CONTROL' },
    })
  })

  it('cancels older calls when a newer call shares classLabel+componentType', async () => {
    const { dt, performQuery } = buildHarness()
    const dFirst = defer<typeof MATCH_RESPONSE>()
    const dSecond = defer<typeof MATCH_RESPONSE>()
    performQuery.mockReturnValueOnce(dFirst.promise).mockReturnValueOnce(dSecond.promise)

    const pFirst = dt.matchClasses({
      elements: [{ name: 'a' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })
    const pSecond = dt.matchClasses({
      elements: [{ name: 'ab' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })
    dFirst.resolve(MATCH_RESPONSE)
    dSecond.resolve(MATCH_RESPONSE)

    await expect(pFirst).rejects.toBeInstanceOf(CancelledError)
    await expect(pSecond).resolves.toMatchObject({ vectorAvailable: true })
  })

  it('does not cancel across different componentType keys', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE).mockResolvedValueOnce(MATCH_RESPONSE)

    const pA = dt.matchClasses({
      elements: [{ name: 'a' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })
    const pB = dt.matchClasses({
      elements: [{ name: 'b' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
    })

    await expect(pA).resolves.toMatchObject({ vectorAvailable: true })
    await expect(pB).resolves.toMatchObject({ vectorAvailable: true })
  })
})

describe('DtClass.listClasses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the listClasses payload unchanged', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(LIST_RESPONSE)

    const result = await dt.listClasses({ classLabel: 'COMPONENT' })

    expect(result.totalCount).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].matchType).toBe('type_match')
    expect(result.facetCounts.modules[0]).toEqual({
      moduleId: 'mod-1',
      moduleName: 'dethernety-module',
      count: 1,
    })
  })

  it('passes input variables and uses network-only fetchPolicy', async () => {
    const { dt, calls, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(LIST_RESPONSE)

    await dt.listClasses({
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
      search: 'auth',
      categories: ['Identity'],
      moduleIds: ['mod-1'],
      offset: 50,
      limit: 25,
    })

    const recorded = calls()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].action).toBe('listClasses')
    expect(recorded[0].fetchPolicy).toBe('network-only')
    expect(recorded[0].variables).toEqual({
      input: {
        classLabel: 'COMPONENT',
        componentType: 'PROCESS',
        search: 'auth',
        categories: ['Identity'],
        moduleIds: ['mod-1'],
        offset: 50,
        limit: 25,
      },
    })
  })

  it('omits optional variables when not provided', async () => {
    const { dt, calls, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(LIST_RESPONSE)

    await dt.listClasses({ classLabel: 'CONTROL' })

    expect(calls()[0].variables).toEqual({ input: { classLabel: 'CONTROL' } })
  })

  it('cancels older calls when a newer call shares classLabel+componentType', async () => {
    const { dt, performQuery } = buildHarness()
    const dFirst = defer<typeof LIST_RESPONSE>()
    const dSecond = defer<typeof LIST_RESPONSE>()
    performQuery.mockReturnValueOnce(dFirst.promise).mockReturnValueOnce(dSecond.promise)

    const pFirst = dt.listClasses({
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
      search: 'ab',
    })
    const pSecond = dt.listClasses({
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
      search: 'abc',
    })
    dFirst.resolve(LIST_RESPONSE)
    dSecond.resolve(LIST_RESPONSE)

    await expect(pFirst).rejects.toBeInstanceOf(CancelledError)
    await expect(pSecond).resolves.toMatchObject({ totalCount: 1 })
  })

  it('does not cancel matchClasses calls and vice versa (different key prefixes)', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery
      .mockResolvedValueOnce(MATCH_RESPONSE)
      .mockResolvedValueOnce(LIST_RESPONSE)

    const pMatch = dt.matchClasses({
      elements: [{ name: 'a' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })
    const pList = dt.listClasses({
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })

    await expect(pMatch).resolves.toMatchObject({ vectorAvailable: true })
    await expect(pList).resolves.toMatchObject({ totalCount: 1 })
  })
})
