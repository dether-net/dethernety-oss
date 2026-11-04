// A production build takes its configuration, authentication included, only from the backend's GET /config. When that
// cannot be read it fails closed: getConfig rejects with ConfigUnavailableError and never falls back to the VITE_
// values baked in at build time, where a VITE_ENABLE_NOAUTH=true (for example from a developer's .env.local) would
// switch the UI's sign-in off. A failed read is tried once more a second later, then given up.
//
// Every case stubs the build-time auth variables itself, so a local .env.local cannot change the outcome; DEV is
// stubbed per case, and fetch is mocked before the fresh module import triggers its eager load.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const respond = (init: { ok?: boolean; status?: number; json?: () => Promise<unknown> }) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), ...init })) as unknown as typeof fetch

beforeEach(() => {
  vi.resetModules()
  // What a build with a developer's no-auth .env.local bakes in.
  vi.stubEnv('VITE_ENABLE_NOAUTH', 'true')
  vi.stubEnv('VITE_OIDC_ISSUER', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('production build: /config unreadable', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
    vi.useFakeTimers()
  })

  it.each([
    ['the request fails', vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch],
    ['the answer is not OK', respond({ ok: false, status: 502 })],
    ['the answer is not JSON', respond({ json: async () => { throw new SyntaxError('Unexpected token <') } })],
  ])('rejects with ConfigUnavailableError when %s, and never disables auth from the build', async (_, fetch) => {
    vi.stubGlobal('fetch', fetch)
    const { getConfig, getConfigSync, ConfigUnavailableError } = await import('../environment')
    const failed = expect(getConfig()).rejects.toBeInstanceOf(ConfigUnavailableError)
    await vi.advanceTimersByTimeAsync(1000)
    await failed
    await expect(getConfig()).rejects.toMatchObject({ name: 'ConfigUnavailableError', cause: expect.anything() })
    expect(getConfigSync()).toBeNull()
    // Read once more after the wait, and no more than that.
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reads once more a second later, so a platform restart does not show the screen', async () => {
    const fetch = respond({ json: async () => ({ authDisabled: true }) })
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: false, status: 502 }) as Response)
    vi.stubGlobal('fetch', fetch)
    const { getConfig } = await import('../environment')
    const config = getConfig()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await config).authDisabled).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('production build: /config readable', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
  })

  it('takes authDisabled from the backend, not from the build', async () => {
    vi.stubGlobal('fetch', respond({ json: async () => ({ authDisabled: true }) }))
    const { getConfig } = await import('../environment')
    expect((await getConfig()).authDisabled).toBe(true)
  })

  it('keeps auth on when the backend does not disable it, whatever the build says', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        json: async () => ({
          oidcIssuer: 'https://id.example.test',
          oidcClientId: 'dt-ui',
          oidcRedirectUri: 'https://app.example.test/auth/callback',
        }),
      }),
    )
    const { getConfig } = await import('../environment')
    expect((await getConfig()).authDisabled).toBe(false)
  })
})

describe('development build', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true)
  })

  it('reads the VITE_ values and never asks for /config, so no-auth development still works', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { getConfig } = await import('../environment')
    expect((await getConfig()).authDisabled).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps auth on when an OIDC issuer is configured', async () => {
    vi.stubEnv('VITE_OIDC_ISSUER', 'https://id.example.test')
    vi.stubEnv('VITE_OIDC_CLIENT_ID', 'dt-ui')
    vi.stubEnv('VITE_OIDC_REDIRECT_URI', 'http://localhost:3005/auth/callback')
    vi.stubGlobal('fetch', vi.fn())
    const { getConfig } = await import('../environment')
    expect((await getConfig()).authDisabled).toBe(false)
  })
})
