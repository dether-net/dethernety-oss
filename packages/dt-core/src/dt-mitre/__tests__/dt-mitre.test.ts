/**
 * DtMitre.matchTechniques unit tests.
 *
 * Mirrors dt-class.test harness — stub `dtUtils.performQuery`, capture call
 * shape, inject responses. Cancel-on-replace cases verify the
 * `withCancellableLatest` wiring at the method-call layer; the primitive
 * itself is covered in dt-utils tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtMitre } from '../dt-mitre.js'
import { CancelledError } from '../../dt-utils/errors.js'

interface PerformQueryCall {
  query: unknown
  variables?: Record<string, unknown>
  action: string
  fetchPolicy?: string
}

function buildHarness() {
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtMitre(apolloClient)
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
  matchMitreTechniques: {
    matches: [
      {
        query: 'credential dumping',
        candidates: [
          {
            mitreId: 'T1003',
            name: 'OS Credential Dumping',
            description: 'Adversaries may attempt to dump credentials.',
            tactic: 'Credential Access',
            kind: 'ATTACK_TECHNIQUE',
            matchType: 'VECTOR_SIMILARITY',
            similarityScore: 0.87,
          },
        ],
      },
    ],
    unmatched: [],
    vectorAvailable: true,
    vectorDisabledReason: null,
  },
}

const VECTOR_DISABLED_RESPONSE = {
  matchMitreTechniques: {
    matches: [{ query: 'foo', candidates: [] }],
    unmatched: ['foo'],
    vectorAvailable: false,
    vectorDisabledReason: 'NO_VECTORS',
  },
}

describe('DtMitre.matchTechniques', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns matchMitreTechniques envelope with vectorAvailable + reason', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE)

    const result = await dt.matchTechniques({
      queries: ['credential dumping'],
      kind: 'ATTACK_TECHNIQUE',
      topN: 5,
    })

    expect(result.vectorAvailable).toBe(true)
    expect(result.vectorDisabledReason).toBeNull()
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].candidates[0].mitreId).toBe('T1003')
    expect(result.matches[0].candidates[0].similarityScore).toBeCloseTo(0.87)
  })

  it('wraps bare string queries into TechniqueQueryInput[]', async () => {
    const { dt, calls, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE)

    await dt.matchTechniques({
      queries: ['a', 'b'],
      kind: 'DEFEND_TECHNIQUE',
    })

    expect(calls()[0].variables).toEqual({
      input: {
        queries: [{ query: 'a' }, { query: 'b' }],
        kind: 'DEFEND_TECHNIQUE',
      },
    })
    expect(calls()[0].action).toBe('matchMitreTechniques')
    expect(calls()[0].fetchPolicy).toBe('network-only')
  })

  it('omits topN from variables when not provided', async () => {
    const { dt, calls, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE)

    await dt.matchTechniques({ queries: ['x'], kind: 'ATTACK_MITIGATION' })

    expect(calls()[0].variables).toEqual({
      input: {
        queries: [{ query: 'x' }],
        kind: 'ATTACK_MITIGATION',
      },
    })
  })

  it('propagates vectorAvailable=false with the disabled reason verbatim', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(VECTOR_DISABLED_RESPONSE)

    const result = await dt.matchTechniques({ queries: ['foo'], kind: 'ATTACK_TECHNIQUE' })
    expect(result.vectorAvailable).toBe(false)
    expect(result.vectorDisabledReason).toBe('NO_VECTORS')
  })

  it('cancels older calls when a newer call shares kind', async () => {
    const { dt, performQuery } = buildHarness()
    const dFirst = defer<typeof MATCH_RESPONSE>()
    const dSecond = defer<typeof MATCH_RESPONSE>()
    performQuery.mockReturnValueOnce(dFirst.promise).mockReturnValueOnce(dSecond.promise)

    const pFirst = dt.matchTechniques({ queries: ['a'], kind: 'ATTACK_TECHNIQUE' })
    const pSecond = dt.matchTechniques({ queries: ['ab'], kind: 'ATTACK_TECHNIQUE' })
    dFirst.resolve(MATCH_RESPONSE)
    dSecond.resolve(MATCH_RESPONSE)

    await expect(pFirst).rejects.toBeInstanceOf(CancelledError)
    await expect(pSecond).resolves.toMatchObject({ vectorAvailable: true })
  })

  it('does not cancel calls with different kinds (parallel pickers proceed independently)', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValueOnce(MATCH_RESPONSE).mockResolvedValueOnce(MATCH_RESPONSE)

    const [a, b] = await Promise.all([
      dt.matchTechniques({ queries: ['x'], kind: 'ATTACK_TECHNIQUE' }),
      dt.matchTechniques({ queries: ['y'], kind: 'DEFEND_TECHNIQUE' }),
    ])
    expect(a.vectorAvailable).toBe(true)
    expect(b.vectorAvailable).toBe(true)
  })
})
