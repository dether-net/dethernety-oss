/**
 * The login flow's scope contract.
 *
 * Four things are pinned, each failing a different way when the corresponding
 * production line is reverted:
 *
 * 1. The authorize request carries the scope the PLATFORM advertises, and
 *    exactly the base scopes when it advertises none — so a deployment that
 *    never configured `oidcScope` sends a byte-identical request to the one it
 *    sent before any of this existed.
 * 2. A stored session whose grant no longer covers the requirement forces a
 *    fresh authorization, because a refresh cannot widen a grant.
 * 3. A session written before `grantedScope` existed is upgraded from the
 *    access token's own claim rather than being thrown away.
 * 4. What the provider granted is persisted, so the next login short-circuits
 *    instead of re-opening a browser forever.
 *
 * Everything is mocked at the process edges the flow talks to — the platform
 * config endpoint, the browser, the callback server, the token endpoint — and
 * NOT at the seams under test. `buildAuthorizationUrl`, `getRequiredScope`,
 * `getOAuthUrls`, `scopeSatisfies`/`grantedScopeOf` and the real token store
 * all run for real; a stub in any of those places would assert the test's own
 * arithmetic instead of the product's.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'

// Everything the mock factories touch has to be hoisted with them: the
// factories run during the import phase, before module-scope consts exist.
const { mockHome, harness } = vi.hoisted(() => ({
  // Redirect the token store's hardcoded ~/.dethernety into a sandbox dir.
  // CONFIG_DIR is computed at module load, so the mock must be in place first.
  mockHome: { dir: `${process.cwd()}/.test-oauth-scope-home` },
  harness: {
    /** What the platform advertises as `oidcScope`; undefined = advertises none. */
    oidcScope: undefined as string | undefined,
    /** The authorization URL production actually opened. */
    authUrl: undefined as string | undefined,
    /** How many times a browser was opened. */
    browserOpens: 0,
    /** Every form body POSTed to the token endpoint, in order. */
    tokenBodies: [] as string[],
    /** What the token endpoint returns. */
    tokenResponse: {} as Record<string, unknown>,
  },
}))

vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

// Only the two network-backed accessors are stubbed. getRequiredScope and
// getOAuthUrls stay REAL — the base-scope fallback is one of the assertions.
vi.mock('../platform-config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../platform-config.js')
  const served = (): import('../platform-config.js').PlatformConfig => ({
    oidcIssuer: 'https://issuer.example',
    oidcClientId: 'test-client',
    oidcDomain: 'auth.example',
    oidcRedirectUri: 'https://app.example/callback',
    oidcProvider: 'generic',
    graphqlUrl: '/graphql',
    graphqlWsUrl: '/graphql',
    subscriptionTransport: 'sse',
    appUrl: 'https://app.example',
    appBaseUrl: '/',
    apiBaseUrl: '',
    // Omitted entirely, not set to undefined — an older platform has no such key.
    ...(harness.oidcScope === undefined ? {} : { oidcScope: harness.oidcScope }),
  })
  return {
    ...actual,
    fetchPlatformConfig: vi.fn(async () => served()),
    getCachedPlatformConfig: vi.fn(() => served()),
  }
})

// buildAuthorizationUrl stays real: the URL under assertion must be the one
// production builds, not one the test assembles to match its own expectation.
vi.mock('../browser.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../browser.js')
  return {
    ...actual,
    openBrowser: vi.fn(async (url: string) => {
      harness.browserOpens += 1
      harness.authUrl = url
    }),
  }
})

vi.mock('../oauth-server.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../oauth-server.js')
  return {
    ...actual,
    startCallbackServer: vi.fn(async () => ({
      port: 9876,
      callbackUrl: 'http://localhost:9876/callback',
      // Echo the state back off the URL production opened, so the flow's own
      // CSRF check passes without this test ever knowing the state value.
      waitForCallback: async () => ({
        code: 'test-authorization-code',
        state: new URL(harness.authUrl!).searchParams.get('state') ?? '',
      }),
      close: () => {},
    })),
  }
})

vi.mock('cross-fetch', () => ({
  default: vi.fn(async (_url: string, init?: { body?: string }) => {
    harness.tokenBodies.push(init?.body ?? '')
    return {
      ok: true,
      status: 200,
      json: async () => harness.tokenResponse,
      text: async () => JSON.stringify(harness.tokenResponse),
    }
  }),
}))

import { performLogin } from '../oauth-flow.js'
import { saveTokens, loadStoredTokens, type StoredTokens } from '../token-store.js'

const BASE_URL = 'http://localhost:3003'

/** Base scopes — the value every pre-existing session was minted under. */
const BASE_SCOPE = 'openid profile email'
/** Neutral stand-in for a resource-server scope. Never write a real one here. */
const EXTRA_SCOPE = 'https://api.example/content.access'
/** What a platform that fronts a resource server advertises. */
const WIDE_SCOPE = `${BASE_SCOPE} ${EXTRA_SCOPE}`

/** An unsigned JWT — scopeClaimOf decodes without verifying, by design. */
function unsignedJwt(payload: Record<string, unknown>): string {
  const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${seg({ alg: 'none', typ: 'JWT' })}.${seg(payload)}.`
}

function tokenEndpointGrants(scope: string): Record<string, unknown> {
  return {
    access_token: unsignedJwt({ scope, token_use: 'access' }),
    id_token: unsignedJwt({ token_use: 'id' }),
    refresh_token: 'fresh-refresh',
    expires_in: 3600,
    token_type: 'Bearer',
    scope,
  }
}

async function seedStoredSession(overrides: Partial<StoredTokens> = {}): Promise<void> {
  await saveTokens({
    accessToken: 'stored-access',
    idToken: 'stored-id',
    refreshToken: 'stored-refresh',
    expiresAt: Date.now() + 3600_000,
    baseUrl: BASE_URL,
    storedAt: Date.now(),
    ...overrides,
  })
}

/** The `scope` parameter on the authorization request production actually made. */
function requestedScope(): string | null {
  return new URL(harness.authUrl!).searchParams.get('scope')
}

const sentRefreshGrant = () => harness.tokenBodies.some((b) => b.includes('grant_type=refresh_token'))
const sentCodeGrant = () => harness.tokenBodies.some((b) => b.includes('grant_type=authorization_code'))

describe('performLogin — OAuth scope', () => {
  let originalUrl: string | undefined

  beforeEach(async () => {
    originalUrl = process.env.DETHERNETY_URL
    process.env.DETHERNETY_URL = BASE_URL
    harness.oidcScope = undefined
    harness.authUrl = undefined
    harness.browserOpens = 0
    harness.tokenBodies = []
    harness.tokenResponse = tokenEndpointGrants(WIDE_SCOPE)
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  afterEach(async () => {
    if (originalUrl === undefined) delete process.env.DETHERNETY_URL
    else process.env.DETHERNETY_URL = originalUrl
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  describe('the scope is requested', () => {
    it('sends the advertised oidcScope verbatim', async () => {
      harness.oidcScope = WIDE_SCOPE

      const result = await performLogin()

      expect(result.success).toBe(true)
      expect(requestedScope()).toBe(WIDE_SCOPE)
    })

    it('sends exactly the base scopes when the platform advertises none', async () => {
      // The whole point of the fallback: a deployment that never configured a
      // scope must send the byte-identical request it sent before this existed.
      harness.oidcScope = undefined

      const result = await performLogin()

      expect(result.success).toBe(true)
      expect(requestedScope()).toBe('openid profile email')
    })
  })

  describe('a stale grant forces a new authorization', () => {
    it('re-authorizes an unexpired session whose grant is too narrow', async () => {
      harness.oidcScope = WIDE_SCOPE
      await seedStoredSession({ grantedScope: BASE_SCOPE })

      const result = await performLogin()

      expect(harness.browserOpens).toBe(1)
      expect(result.fromCache).toBeFalsy()
      expect(requestedScope()).toBe(WIDE_SCOPE)
    })

    it('leaves a session alone when its grant already covers the requirement', async () => {
      // The guard must not force a login it need not: an over-eager version of
      // this check re-opens a browser on every single invocation.
      harness.oidcScope = WIDE_SCOPE
      await seedStoredSession({ grantedScope: WIDE_SCOPE })

      const result = await performLogin()

      expect(harness.browserOpens).toBe(0)
      expect(result.fromCache).toBe(true)
    })

    it('re-authorizes an EXPIRED-but-refreshable session instead of refreshing a stale grant', async () => {
      // THE PLACEMENT TEST. A scope guard written inside the `!isTokenExpired`
      // branch gates the cache hit only; it still passes both cases above, and
      // fails only here — the expired session slips into the refresh arm and
      // goes on minting under-scoped tokens forever, because the refresh grant
      // takes no scope parameter and re-issues the ORIGINAL grant. Same bug,
      // visible an hour later. The guard must sit above the refresh arm.
      harness.oidcScope = WIDE_SCOPE
      await seedStoredSession({
        grantedScope: BASE_SCOPE,
        expiresAt: Date.now() - 1000, // expired
        // saveTokens stamps a fresh issuedAt, so the refresh token is valid —
        // the refresh arm is genuinely reachable and genuinely declined.
      })

      const result = await performLogin()

      expect(harness.browserOpens).toBe(1)
      expect(sentRefreshGrant()).toBe(false)
      expect(sentCodeGrant()).toBe(true)
      expect(result.fromCache).toBeFalsy()
      expect(result.refreshed).toBeFalsy()
    })
  })

  describe('a session predating grantedScope is read, not discarded', () => {
    const legacySession = () =>
      seedStoredSession({
        accessToken: unsignedJwt({ scope: BASE_SCOPE, token_use: 'access' }),
        // grantedScope deliberately absent — this is what is on disk today.
      })

    it('keeps a legacy session whose token claim already satisfies the requirement', async () => {
      // The assertion that protects the entire existing user base. Reading the
      // grant off the access token instead of treating its absence as a
      // mismatch is what stops every operator being re-authenticated to learn
      // something already written in the token they hold.
      harness.oidcScope = undefined
      await legacySession()

      const result = await performLogin()

      expect(harness.browserOpens).toBe(0)
      expect(result.fromCache).toBe(true)
    })

    it('re-authorizes a legacy session whose token claim falls short', async () => {
      harness.oidcScope = WIDE_SCOPE
      await legacySession()

      const result = await performLogin()

      expect(harness.browserOpens).toBe(1)
      expect(result.fromCache).toBeFalsy()
    })

    it('re-authorizes when the grant is unreadable — an unprovable grant is not a grant', async () => {
      harness.oidcScope = undefined
      await seedStoredSession({ accessToken: 'not-a-jwt' })

      const result = await performLogin()

      expect(harness.browserOpens).toBe(1)
      expect(result.fromCache).toBeFalsy()
    })
  })

  describe('the granted scope is persisted', () => {
    it('records what the provider granted and short-circuits the next login', async () => {
      // Without this write the guard above re-opens a browser on every single
      // login — it would keep reading a record that never learned its grant.
      harness.oidcScope = WIDE_SCOPE
      harness.tokenResponse = tokenEndpointGrants(WIDE_SCOPE)

      const first = await performLogin()
      expect(first.success).toBe(true)
      expect(first.scopeShortfall).toBeUndefined()
      expect(harness.browserOpens).toBe(1)

      const stored = await loadStoredTokens(BASE_URL)
      expect(stored?.grantedScope).toBe(WIDE_SCOPE)

      const second = await performLogin()
      expect(second.fromCache).toBe(true)
      expect(harness.browserOpens).toBe(1)
    })
  })
})
