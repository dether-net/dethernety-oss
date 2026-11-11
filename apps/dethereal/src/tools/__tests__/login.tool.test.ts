/**
 * The login tool's contract: bounded wait, a pending answer that tells the model
 * what to do (and not to open the URL itself), busy without a URL, and auth_status
 * following a pending sign-in.
 *
 * The callback server is the real one, moved to an ephemeral port.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import net from 'node:net'
import { promises as fs } from 'node:fs'

const { mockHome } = vi.hoisted(() => ({ mockHome: { dir: `${process.cwd()}/.test-login-tool-home-${process.pid}` } }))

vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

vi.mock('../../auth/oauth-server.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../auth/oauth-server.js')
  return {
    ...actual,
    // Never the real callback port in a test.
    startCallbackServer: (options: Parameters<typeof actual.startCallbackServer>[0]) =>
      actual.startCallbackServer({ ...options, port: portOverride.value }),
  }
})

const portOverride = vi.hoisted(() => ({ value: 0 }))

vi.mock('../../auth/platform-config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../auth/platform-config.js')
  const served = (): import('../../auth/platform-config.js').PlatformConfig => ({
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
  })
  return {
    ...actual,
    fetchPlatformConfig: vi.fn(async () => served()),
    getCachedPlatformConfig: vi.fn(() => served()),
    isAuthDisabled: vi.fn(() => false),
  }
})

vi.mock('../../auth/browser.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../auth/browser.js')
  return { ...actual, openBrowser: vi.fn(async () => {}) }
})

import { loginTool, MAX_WAIT_SECONDS } from '../auth/login.tool.js'
import { authStatusTool } from '../auth/auth-status.tool.js'
import { resetLoginManager } from '../../auth/login-manager.js'

describe('login tool', () => {
  beforeEach(async () => {
    process.env.DETHERNETY_URL = 'http://localhost:3003'
    portOverride.value = 0
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })
  afterEach(async () => {
    await resetLoginManager()
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  it('accepts a wait of 0 to 45 seconds and rejects anything else', async () => {
    expect(MAX_WAIT_SECONDS).toBe(45)
    for (const wait of [46, -1, 1.5]) {
      const result = await loginTool.run({ wait }, { debug: false })
      expect(result.success, String(wait)).toBe(false)
    }
  })

  it('answers pending with the local URL and says not to open it itself', async () => {
    const result = await loginTool.run({ wait: 0 }, { debug: false })
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ status: 'pending', authenticated: false })
    const data = result.data as { openUrl: string; message: string }
    expect(data.openUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/start$/)
    expect(data.message).toMatch(/^Not signed in yet\./)
    expect(data.message).toMatch(/do not open or fetch it yourself/)
    expect(JSON.stringify(result)).not.toMatch(/state=|code_challenge|redirect_uri|auth\.example|oauth2/)
  })

  it('shows a pending sign-in in auth_status', async () => {
    await loginTool.run({ wait: 0 }, { debug: false })
    expect((await authStatusTool.run({}, { debug: false })).data).toMatchObject({ pending: true, authenticated: false })
    await resetLoginManager()
    expect((await authStatusTool.run({}, { debug: false })).data).toMatchObject({ pending: false })
  })

  it('answers busy without a URL when the port is taken', async () => {
    const holder = net.createServer()
    await new Promise<void>((r) => holder.listen(0, '127.0.0.1', r))
    portOverride.value = (holder.address() as net.AddressInfo).port
    try {
      const result = await loginTool.run({ wait: 0 }, { debug: false })
      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ status: 'busy', authenticated: false })
      expect(result.data).not.toHaveProperty('openUrl')
    } finally {
      await new Promise<void>((r) => holder.close(() => r()))
    }
  })

  it('describes the non-blocking contract to the model', () => {
    expect(loginTool.description).toMatch(/never open or fetch it yourself/)
    expect(loginTool.description).toMatch(/identityChanged/)
    expect(Object.keys(loginTool.inputSchema.shape).sort()).toEqual(['force_new', 'wait'])
  })
})
