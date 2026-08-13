// @vitest-environment happy-dom
//
// The OIDC scope reaches the IdP authorize request from RUNTIME config,
// not the compile-time DEFAULT_CONFIG constant. login() must set the authorize
// URL's `scope` param from the runtime FrontendConfig, falling back to the base
// scopes 'openid profile email' when the runtime config omits it.
//
// happy-dom supplies window / sessionStorage / crypto / location, which the
// login() path (generateRandomString, generatePKCE, safeRedirect) requires.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Control only getConfig; keep the real getOidcEndpoints / presets / types.
vi.mock('@/config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/environment')>()
  return { ...actual, getConfig: vi.fn() }
})

import { getConfig, getOidcEndpoints, type FrontendConfig } from '@/config/environment'
import { useAuthStore } from '../authStore'

// A complete, auth-usable runtime config. nodeEnv:'development' forces the plain
// PKCE branch; issuer/redirect are valid URLs so validateAuthConfig passes; a real
// oidcEndpoints so login() can resolve endpoints.authorize.
const makeConfig = (oidcScope?: string): FrontendConfig => ({
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
  oidcScope: oidcScope as string, // undefined simulates an older backend omitting it
  debugAuth: false,
  enableDevTools: false,
  userProfileUrl: '',
  settingsUrl: '',
})

const loginAndReadScope = async (): Promise<string | null> => {
  // Deterministic, capturable location (safeRedirect assigns window.location.href).
  Object.defineProperty(window, 'location', {
    value: { href: '', origin: 'https://app.test' },
    writable: true,
    configurable: true,
  })
  const store = useAuthStore()
  await store.login()
  return new URL(window.location.href).searchParams.get('scope')
}

describe('authStore login — runtime OIDC scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('requests the runtime scope verbatim when configured', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig('openid profile email api.read'))
    expect(await loginAndReadScope()).toBe('openid profile email api.read')
  })

  it('falls back to the base scopes when the runtime config omits oidcScope', async () => {
    vi.mocked(getConfig).mockResolvedValue(makeConfig(undefined))
    expect(await loginAndReadScope()).toBe('openid profile email')
  })
})
