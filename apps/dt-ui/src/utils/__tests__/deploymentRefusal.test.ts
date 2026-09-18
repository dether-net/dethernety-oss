/**
 * The API answers a missing, stale and unlisted credential with one code. What that code means for
 * the person in front of the screen is decided from what the browser can prove about its token — and
 * "not admitted" only after a freshly issued token has been refused too. Each arm is pinned here,
 * including the one that must never fire, a no-auth deployment.
 */
import { describe, it, expect } from 'vitest'
import { refusalAction, isUnauthenticated, bearerOf, type RefusalContext } from '../deploymentRefusal'

const refused = [{ message: 'Internal server error', extensions: { code: 'UNAUTHENTICATED' } }]
const crashed = [{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
const mixed = [...crashed, ...refused]

const current: RefusalContext = {
  authDisabled: false,
  isAuthenticated: true,
  alreadyRetried: false,
  refusedTokenIsCurrent: true,
}

describe('refusalAction', () => {
  // THE DEFECT THIS EXISTS FOR. A token the browser believed current was refused because its session had
  // simply expired — the browser's clock and the server's disagreed at the boundary — and the person was
  // told the deployment does not admit their account. A belief is not a proof; a fresh token is.
  it('a refusal of a token believed current is answered with a fresh token and a retry, not the page', () => {
    expect(refusalAction(refused, current)).toBe('refresh-and-retry')
  })

  it('a retry that is refused again — with a token just issued — means the deployment does not admit the account', () => {
    expect(refusalAction(refused, { ...current, alreadyRetried: true })).toBe('not-admitted')
  })

  // A refresh landed while this request was out, so the token it was refused with is gone and the
  // current one has not been tried: retry without asking for another.
  it('a refused token that has already been replaced is retried without a second refresh', () => {
    expect(refusalAction(refused, { ...current, refusedTokenIsCurrent: false })).toBe('retry')
  })

  it('a stale or absent token gets the ordinary answer, a sign-in', () => {
    expect(refusalAction(refused, { ...current, isAuthenticated: false })).toBe('sign-in')
  })

  it('a crash is not a refusal, whatever the token', () => {
    expect(refusalAction(crashed, current)).toBeNull()
    expect(refusalAction(crashed, { ...current, alreadyRetried: true })).toBeNull()
    expect(refusalAction([], current)).toBeNull()
  })

  it('one refusal among several errors is enough', () => {
    expect(refusalAction(mixed, current)).toBe('refresh-and-retry')
  })

  // A no-auth deployment has no identity to refuse, and sending anyone to a sign-in there would open
  // a flow the deployment does not have.
  it('never fires on a deployment with authentication off', () => {
    expect(refusalAction(refused, { ...current, authDisabled: true })).toBeNull()
    expect(refusalAction(refused, { ...current, authDisabled: true, alreadyRetried: true })).toBeNull()
  })

  it('reads the code, not the message — the message is scrubbed in production', () => {
    expect(isUnauthenticated([{ message: 'Unauthenticated', extensions: { code: 'INTERNAL_SERVER_ERROR' } }])).toBe(false)
    expect(isUnauthenticated([{ message: 'Internal server error', extensions: { code: 'UNAUTHENTICATED' } }])).toBe(true)
    expect(isUnauthenticated([{ message: 'x' }])).toBe(false)
    expect(isUnauthenticated([{ message: 'x', extensions: null }])).toBe(false)
  })
})

describe('bearerOf', () => {
  it('reads the token a request went out with, and nothing else', () => {
    expect(bearerOf({ Authorization: 'Bearer abc' })).toBe('abc')
    expect(bearerOf({ authorization: 'Bearer abc' })).toBe('abc')
    expect(bearerOf({ Authorization: 'Basic abc' })).toBe('')
    expect(bearerOf({})).toBe('')
    expect(bearerOf(undefined)).toBe('')
  })
})
