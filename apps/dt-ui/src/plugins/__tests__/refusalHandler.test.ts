/**
 * The refusal handler, driven the way ErrorLink drives it: an UNAUTHENTICATED result, an operation that
 * carries the headers the request went out with, and a `forward` that answers the retry.
 *
 * The case that made this exist: a token the browser believed current, refused because its session had
 * simply expired, sent the person to "This deployment does not admit your account". Pressing "Check
 * again" then worked — which is exactly the refresh-and-retry this now does on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Observable, CombinedGraphQLErrors } from '@apollo/client/core'
import { createRefusalHandler, type RefusalAuth } from '../refusalHandler'

const REFUSED = { data: null, errors: [{ message: 'Internal server error', extensions: { code: 'UNAUTHENTICATED' } }] }
const OK = { data: { models: [] } }

let auth: RefusalAuth
let leave: ReturnType<typeof vi.fn<(href: string) => void>>

function operationWith(bearer: string) {
  let context: Record<string, unknown> = { headers: { Authorization: `Bearer ${bearer}` } }
  return {
    getContext: () => context,
    setContext: (next: Record<string, unknown>) => { context = { ...context, ...next } },
  } as any
}

// A forward whose every call answers with the next scripted result.
function forwardAnswering(...results: unknown[]) {
  const forward = vi.fn(() => {
    const result = results.shift()
    return new Observable((o) => { o.next(result as any); o.complete() })
  })
  return forward as any
}

function run(handler: ReturnType<typeof createRefusalHandler>, args: { operation: any; forward: any }) {
  const error = new CombinedGraphQLErrors(REFUSED as any)
  const retried = handler({ error, operation: args.operation, forward: args.forward })
  if (!retried) return Promise.resolve<{ retried: boolean; results: unknown[]; error?: unknown }>({ retried: false, results: [] })
  return new Promise<{ retried: boolean; results: unknown[]; error?: unknown }>((resolve) => {
    const results: unknown[] = []
    retried.subscribe({
      next: (r) => results.push(r),
      error: (e) => resolve({ retried: true, results, error: e }),
      complete: () => resolve({ retried: true, results }),
    })
  })
}

beforeEach(() => {
  leave = vi.fn<(href: string) => void>()
  auth = {
    authDisabled: false,
    isAuthenticated: true,
    token: 'old',
    performTokenRefresh: vi.fn(async () => { auth.token = 'fresh' }),
    clearState: vi.fn(),
  }
})

const handlerFor = () => createRefusalHandler({ auth: () => auth, leave, basePath: '/' })

describe('the refusal handler', () => {
  it('an expired session that the browser thought current: refreshes, retries, and says nothing', async () => {
    const forward = forwardAnswering(OK)
    const out = await run(handlerFor(), { operation: operationWith('old'), forward })

    expect(auth.performTokenRefresh).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(out.results).toEqual([OK])
    // The whole point: nobody was sent anywhere.
    expect(leave).not.toHaveBeenCalled()
  })

  it('a freshly issued token refused again is the deployment refusing the account', async () => {
    const forward = forwardAnswering(REFUSED)
    const out = await run(handlerFor(), { operation: operationWith('old'), forward })

    expect(auth.performTokenRefresh).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledTimes(1) // once, and not again
    expect(leave).toHaveBeenCalledWith('/auth/not-admitted')
    expect(leave).not.toHaveBeenCalledWith('/login')
    // The refused result still reaches its caller.
    expect(out.results).toEqual([REFUSED])
  })

  it('a refresh the identity provider refuses means the session is over: the ordinary sign-in', async () => {
    auth.performTokenRefresh = vi.fn(async () => { throw new Error('refresh token expired') })
    const forward = forwardAnswering()
    const out = await run(handlerFor(), { operation: operationWith('old'), forward })

    expect(forward).not.toHaveBeenCalled()
    expect(auth.clearState).toHaveBeenCalled()
    expect(leave).toHaveBeenCalledWith('/login')
    expect(leave).not.toHaveBeenCalledWith('/auth/not-admitted')
    expect(out.error).toBeDefined()
  })

  // Several queries of one page load are refused together; the ones that come back after the refresh
  // has landed find their token already replaced, and must not ask for another.
  it('a refused token already replaced by a refresh is retried without refreshing again', async () => {
    auth.token = 'fresh'
    const forward = forwardAnswering(OK)
    await run(handlerFor(), { operation: operationWith('old'), forward })

    expect(auth.performTokenRefresh).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledTimes(1)
    expect(leave).not.toHaveBeenCalled()
  })

  it('marks the retry, so a refusal of the retry itself is not retried again', async () => {
    const operation = operationWith('old')
    const forward = forwardAnswering(OK)
    await run(handlerFor(), { operation, forward })
    expect(operation.getContext().retriedAfterRefusal).toBe(true)

    // Handed the marked operation — however that refusal reaches it — the handler decides, not retries.
    auth.token = 'old'
    const again = forwardAnswering()
    const out = await run(handlerFor(), { operation, forward: again })
    expect(out.retried).toBe(false)
    expect(again).not.toHaveBeenCalled()
    expect(leave).toHaveBeenCalledWith('/auth/not-admitted')
  })

  it('a stale token gets the ordinary sign-in without a retry', async () => {
    auth.isAuthenticated = false
    const forward = forwardAnswering()
    const out = await run(handlerFor(), { operation: operationWith('old'), forward })

    expect(out.retried).toBe(false)
    expect(auth.clearState).toHaveBeenCalled()
    expect(leave).toHaveBeenCalledWith('/login')
  })

  it('does nothing on a deployment with authentication off', async () => {
    auth.authDisabled = true
    const forward = forwardAnswering()
    const out = await run(handlerFor(), { operation: operationWith('old'), forward })

    expect(out.retried).toBe(false)
    expect(auth.performTokenRefresh).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
  })
})
