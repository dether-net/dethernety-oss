// The OIDC scope is carried from the backend /config payload into the
// runtime FrontendConfig (the courier's frontend half). Proves fetchRuntimeConfig
// maps `oidcScope`, defaulting to the base scopes when the payload omits it.
//
// loadConfig() reaches fetchRuntimeConfig only when import.meta.env.DEV is false
// (otherwise it takes getDevelopmentConfig), so DEV is stubbed off per case and
// global.fetch is mocked before the (fresh) module import triggers its eager load.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockFetch = (payload: Record<string, unknown>) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch

describe('environment getConfig — /config oidcScope carry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('DEV', false) // force the fetchRuntimeConfig (/config) branch
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('maps oidcScope from /config verbatim', async () => {
    vi.stubGlobal('fetch', mockFetch({ authDisabled: true, oidcScope: 'openid profile email api.read' }))
    const { getConfig } = await import('../environment')
    const config = await getConfig()
    expect(config.oidcScope).toBe('openid profile email api.read')
  })

  it('defaults oidcScope to the base scopes when /config omits it', async () => {
    vi.stubGlobal('fetch', mockFetch({ authDisabled: true }))
    const { getConfig } = await import('../environment')
    const config = await getConfig()
    expect(config.oidcScope).toBe('openid profile email')
  })
})
