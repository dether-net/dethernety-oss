// @vitest-environment happy-dom
//
// Token refresh is guarded by a single entry point (ensureValidToken ->
// performTokenRefresh, behind the refreshPromise mutex): there is no second,
// unmutexed refresh path, so concurrent triggers coalesce into one token POST.
// Token expiry is always finite — it prefers the JWT's own `exp`, falls back to
// `expires_in`, and applies a conservative fallback when both are absent, never
// writing NaN (a NaN expiry would wedge the session un-refreshably).
//
// happy-dom supplies window / sessionStorage / crypto / btoa, which the store
// and this test's JWT builder require. Fake timers keep the success-path
// scheduleTokenRefresh setTimeout from leaking across tests; the happy path is
// otherwise timer-free (retryWithBackoff only arms a timer on a retryable error).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Control only getConfig; keep the real getOidcEndpoints / presets / types.
vi.mock('@/config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/environment')>()
  return { ...actual, getConfig: vi.fn() }
})

import { getConfig, getOidcEndpoints, type FrontendConfig } from '@/config/environment'
import { useAuthStore } from '../authStore'

// A complete, auth-usable runtime config: valid issuer/redirect URLs so
// validateAuthConfig passes, real oidcEndpoints so the token URL resolves.
const makeConfig = (): FrontendConfig => ({
  nodeEnv: 'development',
  appUrl: 'https://app.test',
  appBaseUrl: '/',
  apiBaseUrl: '',
  graphqlUrl: '/graphql',
  subscriptionTransport: 'sse',
  authDisabled: false,
  oidcIssuer: 'https://issuer.test',
  oidcClientId: 'cid',
  oidcRedirectUri: 'https://app.test/callback',
  oidcProvider: 'generic',
  oidcEndpoints: getOidcEndpoints('generic'),
  oidcScope: 'openid profile email',
  debugAuth: false,
  enableDevTools: false,
  userProfileUrl: '',
})

// Build a real 3-segment JWT whose payload carries `exp` (seconds). jwtDecode is
// unmocked and only reads the payload segment, so the signature can be anything.
const b64url = (obj: object): string =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const makeJwt = (expSeconds: number): string =>
  `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ exp: expSeconds })}.sig`

// A fetch stub that returns one token response as { ok, status, json }.
const stubTokenFetch = (tokens: Record<string, unknown>) => {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => tokens }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('authStore token refresh — single entry point & finite expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    setActivePinia(createPinia())
    vi.mocked(getConfig).mockResolvedValue(makeConfig())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces concurrent ensureValidToken calls into exactly one token POST', async () => {
    const fetchMock = stubTokenFetch({ access_token: 'new-access', expires_in: 3600, refresh_token: 'rt2' })
    const store = useAuthStore()
    store.setToken('old-access')
    store.setRefreshToken('rt1')
    // Already-expired (not merely expiring-soon): scheduleTokenRefresh fires
    // neither branch during setup, so the only refresh triggers are our two calls.
    store.setTokenExpiry(Date.now() - 1000)

    await Promise.all([store.ensureValidToken(), store.ensureValidToken()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sets a finite expiry from the JWT exp when the refresh omits expires_in', async () => {
    const exp = Math.floor(Date.now() / 1000) + 100_000 // ~27h out
    stubTokenFetch({ access_token: makeJwt(exp), refresh_token: 'rt2' }) // no expires_in
    const store = useAuthStore()
    store.setRefreshToken('rt1')

    await store.performTokenRefresh()

    expect(Number.isFinite(store.tokenExpiry)).toBe(true)
    expect(store.tokenExpiry).toBe(exp * 1000)
    expect(store.isAuthenticated).toBe(true)
  })

  it('applies a finite conservative fallback when both exp and expires_in are absent', async () => {
    stubTokenFetch({ access_token: 'opaque-not-a-jwt', refresh_token: 'rt2' }) // no expires_in, not a JWT
    const store = useAuthStore()
    store.setRefreshToken('rt1')

    await store.performTokenRefresh()

    expect(Number.isFinite(store.tokenExpiry)).toBe(true)
    expect(Number.isNaN(store.tokenExpiry)).toBe(false)
    expect(store.tokenExpiry).toBeGreaterThan(Date.now())
    expect(store.isAuthenticated).toBe(true)
  })

  it('no longer exposes the removed refreshTokenIfNeeded path', () => {
    const store = useAuthStore()
    expect((store as unknown as Record<string, unknown>).refreshTokenIfNeeded).toBeUndefined()
  })
})
