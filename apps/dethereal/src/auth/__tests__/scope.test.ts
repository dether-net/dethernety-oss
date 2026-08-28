import { describe, it, expect } from 'vitest'
import { parseScopes, scopeSatisfies, scopeClaimOf, grantedScopeOf } from '../scope.js'

// Placeholder scope values. The real resource-server scope belongs in the
// deployment's platform config, never in a test fixture.
const BASE = 'openid profile email'
const RESOURCE = 'https://api.example/content.access'
const REQUIRED = `${BASE} ${RESOURCE}`

/**
 * Hand-build an UNSIGNED JWT.
 *
 * `scopeClaimOf` decodes the payload without verifying the signature on
 * purpose, so an unsigned token is a faithful fixture here: the signature is
 * never consulted, and a real one would only add noise.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature-is-never-checked`
}

describe('scopeSatisfies', () => {
  it('accepts a grant returned in a DIFFERENT ORDER from the request', () => {
    // Providers do not promise request order. Comparing the strings would
    // report a mismatch forever and re-open a browser on every login.
    expect(scopeSatisfies('email openid profile', BASE)).toBe(true)
    expect(scopeSatisfies(`${RESOURCE} email profile openid`, REQUIRED)).toBe(true)
  })

  it('accepts a strict superset — sufficiency, not equality', () => {
    expect(scopeSatisfies(`${REQUIRED} aws.cognito.signin.user.admin`, REQUIRED)).toBe(true)
    expect(scopeSatisfies(REQUIRED, BASE)).toBe(true)
  })

  it('REJECTS a grant that merely contains a required scope as a substring', () => {
    // The dangerous direction: `granted.includes(required)` is true for every
    // one of these, and the resource server rejects all of them. A substring
    // test would be the failure that looks like it works.
    expect(scopeSatisfies(`openid ${RESOURCE}.readonly`, RESOURCE)).toBe(false)
    expect(scopeSatisfies(`${RESOURCE}-staging`, RESOURCE)).toBe(false)
    expect(scopeSatisfies('openid profile email-verified', 'email')).toBe(false)
  })

  it('tolerates tabs, runs of spaces, and surrounding whitespace', () => {
    expect(scopeSatisfies('openid\tprofile   email', BASE)).toBe(true)
    expect(scopeSatisfies(BASE, '  openid\t\temail  ')).toBe(true)
    // Splitting on a single space would leave empty members that match nothing.
    expect(parseScopes('  openid\t profile  ')).toEqual(['openid', 'profile'])
  })

  it('treats an empty requirement as vacuously satisfied', () => {
    expect(scopeSatisfies(undefined, '')).toBe(true)
    expect(scopeSatisfies('', '')).toBe(true)
    expect(scopeSatisfies(BASE, '   ')).toBe(true)
  })

  it('never satisfies a non-empty requirement from an unreadable grant', () => {
    // An unprovable grant is not a grant.
    expect(scopeSatisfies(undefined, BASE)).toBe(false)
    expect(scopeSatisfies('', BASE)).toBe(false)
    expect(scopeSatisfies('   ', 'openid')).toBe(false)
  })

  it('reports a session minted before the platform widened its scope as insufficient', () => {
    // The reason performLogin refuses to reuse the stored session: a refresh
    // cannot widen this grant, so only a fresh authorization can.
    expect(scopeSatisfies(BASE, REQUIRED)).toBe(false)
  })
})

describe('scopeClaimOf', () => {
  it('reads the scope claim out of an access token', () => {
    expect(scopeClaimOf(makeJwt({ token_use: 'access', scope: REQUIRED }))).toBe(REQUIRED)
    expect(scopeClaimOf(makeJwt({ scope: RESOURCE }))).toBe(RESOURCE)
  })

  it('returns undefined for anything that is not a JWT carrying a non-empty string scope', () => {
    expect(scopeClaimOf(undefined)).toBeUndefined()
    expect(scopeClaimOf('')).toBeUndefined()
    expect(scopeClaimOf('opaque-access-token')).toBeUndefined()
    expect(scopeClaimOf(makeJwt({ token_use: 'access', sub: 'user-1' }))).toBeUndefined()
    expect(scopeClaimOf(makeJwt({ scope: '' }))).toBeUndefined()
    expect(scopeClaimOf(makeJwt({ scope: ['openid', 'profile'] }))).toBeUndefined()
    expect(scopeClaimOf('header.@@not-decodable@@.signature')).toBeUndefined()
  })
})

describe('grantedScopeOf', () => {
  it('prefers the recorded grant over the token claim', () => {
    const tokens = {
      grantedScope: BASE,
      accessToken: makeJwt({ scope: REQUIRED }),
    }
    expect(grantedScopeOf(tokens)).toBe(BASE)
  })

  it('falls back to the token claim when grantedScope is absent', () => {
    // THE upgrade path: sessions written before `grantedScope` existed have no
    // such field. Re-authenticating every operator to learn something already
    // written in their access token would be a gratuitous interruption.
    expect(grantedScopeOf({ accessToken: makeJwt({ scope: REQUIRED }) })).toBe(REQUIRED)

    // And the fallback is load-bearing end to end: a legacy record whose token
    // carries only the base scopes must still be recognised as stale.
    const legacy = { accessToken: makeJwt({ scope: BASE }) }
    expect(scopeSatisfies(grantedScopeOf(legacy), REQUIRED)).toBe(false)
  })

  it('returns undefined when neither source is readable', () => {
    expect(grantedScopeOf({})).toBeUndefined()
    expect(grantedScopeOf({ accessToken: 'opaque-access-token' })).toBeUndefined()
    expect(grantedScopeOf({ accessToken: makeJwt({ sub: 'user-1' }) })).toBeUndefined()
  })
})
