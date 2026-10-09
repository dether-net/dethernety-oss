/**
 * A client configured with `errorPolicy: 'all'` makes Apollo resolve
 * `{ data: undefined, error }` instead of throwing. DtUtils must turn that into
 * a rejection that carries the server's message (and nothing else from the
 * request), rather than handing callers `undefined` to dereference.
 */

import { describe, it, expect, vi } from 'vitest'
import * as Apollo from '@apollo/client'
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors'

import { DtUtils } from '../dt-utils.js'
import { DtRequestError } from '../errors.js'

const FAST_RETRY = { maxRetries: 2, baseDelay: 1, maxDelay: 1 }
const SECRET = 'tok-should-never-surface'
const INVALID_VARIABLE =
  'Variable "$input" got invalid value "dataFlow" at "input.elements[0].type"; ' +
  'Value "dataFlow" does not exist in "ComponentType" enum.'

function graphQLError(message = INVALID_VARIABLE) {
  return new CombinedGraphQLErrors({ errors: [{ message }] })
}

function serverError(status: number) {
  const bodyText = JSON.stringify({ echoed: SECRET })
  return new ServerError(`Response not successful: Received status code ${status}`, {
    response: new Response(bodyText, { status }),
    bodyText,
  })
}

function queryHarness() {
  const query = vi.fn()
  const mutate = vi.fn()
  const utils = new DtUtils({ query, mutate } as unknown as Apollo.ApolloClient)
  return { utils, query, mutate }
}

function runQuery(utils: DtUtils) {
  return utils.performQuery({
    query: {} as any,
    variables: { input: { token: SECRET } },
    action: 'matchClasses',
    retryConfig: FAST_RETRY,
  })
}

/** Everything a caller (or a model reading a tool result) could see. */
function surface(err: unknown): string {
  const e = err as Record<string, unknown>
  return JSON.stringify({ ...e, message: e.message, cause: e.cause, stack: e.stack })
}

describe('DtUtils.performQuery — errors resolved under errorPolicy "all"', () => {
  it('rejects with the GraphQL message instead of resolving undefined', async () => {
    const { utils, query } = queryHarness()
    query.mockResolvedValue({ data: undefined, error: graphQLError() })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const err = await runQuery(utils).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DtRequestError)
    expect((err as Error).message).toContain('got invalid value "dataFlow"')
  })

  it('does not retry a GraphQL error', async () => {
    const { utils, query } = queryHarness()
    query.mockResolvedValue({ data: undefined, error: graphQLError('connection to the store failed') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runQuery(utils)).rejects.toBeInstanceOf(DtRequestError)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 4xx server error', async () => {
    const { utils, query } = queryHarness()
    query.mockResolvedValue({ data: undefined, error: serverError(400) })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runQuery(utils)).rejects.toBeInstanceOf(DtRequestError)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx server error like any transport failure', async () => {
    const { utils, query } = queryHarness()
    query.mockResolvedValue({ data: undefined, error: serverError(503) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(runQuery(utils)).rejects.toBeInstanceOf(DtRequestError)
    expect(query).toHaveBeenCalledTimes(FAST_RETRY.maxRetries + 1)
  })

  it('carries neither the request variables nor the response body', async () => {
    const { utils, query } = queryHarness()
    query.mockResolvedValueOnce({ data: undefined, error: graphQLError() })
    query.mockResolvedValueOnce({ data: undefined, error: serverError(400) })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    for (let i = 0; i < 2; i++) {
      const err = await runQuery(utils).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(DtRequestError)
      expect(surface(err)).not.toContain(SECRET)
      expect((err as Error).cause).toBeUndefined()
    }
  })

  it('caps a very long server message', async () => {
    const { utils, query } = queryHarness()
    query.mockResolvedValue({ data: undefined, error: graphQLError(`bad: ${'x'.repeat(5000)}`) })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const err = (await runQuery(utils).catch((e: unknown) => e)) as Error
    expect(err.message.length).toBeLessThanOrEqual(1000)
    expect(err.message.startsWith('bad: ')).toBe(true)
  })

  it('passes partial data with errors through unchanged', async () => {
    const { utils, query } = queryHarness()
    const data = { matchClasses: { matches: [], unmatched: ['a'], vectorAvailable: true } }
    query.mockResolvedValue({ data, error: graphQLError('one field failed') })

    await expect(runQuery(utils)).resolves.toEqual(data)
  })
})

describe('DtUtils.performMutation — errors resolved under errorPolicy "all"', () => {
  it('rejects with the GraphQL message, not "No data returned"', async () => {
    const { utils, mutate } = queryHarness()
    mutate.mockResolvedValue({ data: undefined, error: graphQLError('Authorization denied') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const err = await utils
      .performMutation({
        mutation: {} as any,
        variables: { input: { token: SECRET } },
        dataPath: 'createThing',
        action: 'createThing',
        deduplicationKey: false,
      })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DtRequestError)
    expect((err as Error).message).toBe('Authorization denied')
    expect(surface(err)).not.toContain(SECRET)
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
