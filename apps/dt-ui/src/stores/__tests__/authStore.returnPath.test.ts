// @vitest-environment happy-dom
//
// After a successful sign-in the tab returns to the address it asked for before it signed in, once; with none, or
// one that does not qualify, it goes home. A failed callback keeps the address for a retry in the same tab, and
// clearing the session forgets it. Under a base such as /app/ the return carries the base.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/layouts/default.vue', () => ({ default: {} }))
vi.mock('@/config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/environment')>()
  return { ...actual, getConfig: vi.fn() }
})

import { getConfig, getOidcEndpoints, type FrontendConfig } from '@/config/environment'

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
  oidcRedirectUri: 'https://app.test/auth/callback',
  oidcProvider: 'generic',
  oidcEndpoints: getOidcEndpoints('generic'),
  oidcScope: 'openid profile email',
  debugAuth: false,
  enableDevTools: false,
  userProfileUrl: '',
  settingsUrl: '',
})

const RETURN_PATH_KEY = 'auth_return_to'

/** The store and the router, fresh, under one base. */
async function load(base = '/') {
  vi.resetModules()
  vi.stubEnv('BASE_URL', base)
  await import('@/router')
  const { useAuthStore } = await import('../authStore')
  setActivePinia(createPinia())
  return useAuthStore()
}

async function signIn(store: Awaited<ReturnType<typeof load>>, state = 's1') {
  sessionStorage.setItem('auth_state', 's1')
  sessionStorage.setItem('code_verifier', 'v1')
  await store.handleCallback('code', state)
}

describe('the return after sign-in', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    vi.mocked(getConfig).mockResolvedValue(makeConfig())
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('userinfo') ? { sub: 'u1', email: 'a@example.test', name: 'A' } : { access_token: 'at', expires_in: 3600, refresh_token: 'rt' }),
      text: async () => '',
    })))
    Object.defineProperty(window, 'location', { value: { href: '', origin: 'https://app.test', pathname: '/auth/callback', search: '', hash: '' }, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns to the address the tab asked for, once', async () => {
    const store = await load()
    const { rememberReturnPath } = await import('@/router/returnPath')
    rememberReturnPath('/dataflow?id=m&element=e&tab=attributes')
    await signIn(store)
    expect(window.location.href).toBe('/dataflow?id=m&element=e&tab=attributes')
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('goes home with nothing kept, or with a value that does not qualify', async () => {
    const store = await load()
    await signIn(store)
    expect(window.location.href).toBe('/')
    for (const path of ['//evil.example', '/LOGIN/', '/nowhere', 'javascript:alert(1)']) {
      sessionStorage.setItem(RETURN_PATH_KEY, JSON.stringify({ path, at: Date.now() }))
      window.location.href = ''
      await signIn(await load())
      expect(window.location.href, path).toBe('/')
    }
  })

  it('a failed callback keeps the address for a retry; clearing the session forgets it', async () => {
    const store = await load()
    const { rememberReturnPath } = await import('@/router/returnPath')
    rememberReturnPath('/analysisresults?id=a1')
    await expect(signIn(store, 'another-state')).rejects.toThrow()
    expect(JSON.parse(sessionStorage.getItem(RETURN_PATH_KEY)!).path).toBe('/analysisresults?id=a1')
    store.clearState()
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('carries the base, as /app/ in the cloud', async () => {
    const store = await load('/app/')
    const { rememberReturnPath } = await import('@/router/returnPath')
    rememberReturnPath('/dataflow?id=m')
    await signIn(store)
    expect(window.location.href).toBe('/app/dataflow?id=m')
  })
})
