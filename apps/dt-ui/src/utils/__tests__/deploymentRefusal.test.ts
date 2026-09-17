/**
 * The API answers a missing, stale and unlisted credential with one code. What that code means for
 * the person in front of the screen is decided from what the browser knows about its own token, and
 * this pins each arm — including the one that must never fire, a no-auth deployment.
 */
import { describe, it, expect } from 'vitest'
import { refusalMeaning, isUnauthenticated } from '../deploymentRefusal'

const refused = [{ message: 'Internal server error', extensions: { code: 'UNAUTHENTICATED' } }]
const crashed = [{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
const mixed = [...crashed, ...refused]

describe('refusalMeaning', () => {
  it('a current token that is still refused means the deployment does not admit the account', () => {
    expect(refusalMeaning(refused, { authDisabled: false, isAuthenticated: true })).toBe('not-admitted')
  })

  it('a stale or absent token gets the ordinary answer, a sign-in', () => {
    expect(refusalMeaning(refused, { authDisabled: false, isAuthenticated: false })).toBe('sign-in')
  })

  it('a crash is not a refusal, whatever the token', () => {
    expect(refusalMeaning(crashed, { authDisabled: false, isAuthenticated: true })).toBeNull()
    expect(refusalMeaning(crashed, { authDisabled: false, isAuthenticated: false })).toBeNull()
    expect(refusalMeaning([], { authDisabled: false, isAuthenticated: true })).toBeNull()
  })

  it('one refusal among several errors is enough', () => {
    expect(refusalMeaning(mixed, { authDisabled: false, isAuthenticated: true })).toBe('not-admitted')
  })

  // A no-auth deployment has no identity to refuse, and sending anyone to a sign-in there would open
  // a flow the deployment does not have.
  it('never fires on a deployment with authentication off', () => {
    expect(refusalMeaning(refused, { authDisabled: true, isAuthenticated: false })).toBeNull()
    expect(refusalMeaning(refused, { authDisabled: true, isAuthenticated: true })).toBeNull()
  })

  it('reads the code, not the message — the message is scrubbed in production', () => {
    expect(isUnauthenticated([{ message: 'Unauthenticated', extensions: { code: 'INTERNAL_SERVER_ERROR' } }])).toBe(false)
    expect(isUnauthenticated([{ message: 'Internal server error', extensions: { code: 'UNAUTHENTICATED' } }])).toBe(true)
    expect(isUnauthenticated([{ message: 'x' }])).toBe(false)
    expect(isUnauthenticated([{ message: 'x', extensions: null }])).toBe(false)
  })
})
