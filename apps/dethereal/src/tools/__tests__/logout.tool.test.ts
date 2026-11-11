/**
 * logout: remove the stored sessions, then revoke each one at its own platform.
 *
 * Mocked only at the network edge (`cross-fetch`): every platform's /config, and
 * each identity provider's token and revocation endpoints, are routed by URL. The
 * token store, the lock and the platform-config code run for real in a sandbox HOME.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, existsSync } from 'fs'
import path from 'path'

const { mockHome, net } = vi.hoisted(() => ({
  mockHome: { dir: `${process.cwd()}/.test-logout-home-${process.pid}` },
  net: {
    /** /config answers by platform origin; an Error means unreachable. */
    configs: new Map<string, Record<string, unknown> | Error>(),
    /** Revocation answers by identity-provider host; default 200. */
    revoke: new Map<string, { status: number; body: string } | Error>(),
    /** The token endpoint's answer, optionally held until `release` is called. */
    token: { status: 200, body: '{}' } as { status: number; body: string },
    tokenGate: null as Promise<void> | null,
    calls: [] as { url: string; form: Record<string, string>; redirect?: string }[],
    /** Fetches made while the token store's lock was held. */
    underLock: [] as string[],
    lockPath: '',
  },
}))

vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

vi.mock('cross-fetch', () => ({
  default: vi.fn(async (url: string, init: { body?: string; redirect?: string } = {}) => {
    if (net.lockPath && existsSync(net.lockPath)) net.underLock.push(url)
    const form = Object.fromEntries(new URLSearchParams(init.body ?? ''))
    net.calls.push({ url, form, redirect: init.redirect })
    const reply = (status: number, body: string) => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      json: async () => JSON.parse(body),
      text: async () => body,
    })
    const u = new URL(url)
    if (u.pathname === '/config') {
      const config = net.configs.get(u.origin)
      if (!config) throw new Error(`connect ECONNREFUSED ${url}`)
      if (config instanceof Error) throw config
      return reply(200, JSON.stringify(config))
    }
    if (u.pathname === '/oauth2/revoke') {
      const answer = net.revoke.get(u.host) ?? { status: 200, body: '' }
      if (answer instanceof Error) throw answer
      return reply(answer.status, answer.body)
    }
    if (u.pathname === '/oauth2/token') {
      if (net.tokenGate) await net.tokenGate
      return reply(net.token.status, net.token.body)
    }
    throw new Error(`unexpected request ${url}`)
  }),
}))

import { logoutTool } from '../auth/logout.tool.js'
import {
  saveTokens,
  loadStoredTokens,
  getTokenStoragePath,
  beginSignInEpoch,
  saveSignIn,
  type StoredTokens,
} from '../../auth/token-store.js'
import { refreshStoredSession, SignedOutError, SessionExpiredError } from '../../auth/oauth-flow.js'
import {
  fetchPlatformConfig,
  getCachedPlatformConfig,
  clearPlatformConfigCache,
  isHostOnly,
} from '../../auth/platform-config.js'

const A = 'http://127.0.0.1:43211'
const B = 'https://b.example.test'

function config(domain: string, clientId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oidcIssuer: `https://${domain}`,
    oidcClientId: clientId,
    oidcDomain: domain,
    oidcRedirectUri: 'https://app.invalid/callback',
    oidcProvider: 'cognito',
    graphqlUrl: '/graphql',
    graphqlWsUrl: '/graphql',
    subscriptionTransport: 'sse',
    appUrl: 'https://app.invalid',
    appBaseUrl: '/',
    apiBaseUrl: '',
    ...extra,
  }
}

const RT_A = 'refresh-token-of-platform-a-0123456789'
const RT_B = 'refresh-token-of-platform-b-9876543210'

function session(baseUrl: string, refreshToken: string, overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: `access-${refreshToken}`,
    idToken: `id-${refreshToken}`,
    refreshToken,
    expiresAt: Date.now() + 3600_000,
    baseUrl,
    storedAt: Date.now(),
    ...overrides,
  }
}

async function logout(input: Record<string, unknown> = {}) {
  const result = await logoutTool.run(input, { debug: false })
  expect(result.success).toBe(true)
  return { data: result.data as { message: string; revocation: { platform: string; result: string; reason?: string }[] }, text: JSON.stringify(result) }
}

const revokeCalls = () => net.calls.filter((c) => c.url.endsWith('/oauth2/revoke'))
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('logout', () => {
  const savedUrl = process.env.DETHERNETY_URL
  const savedDebug = process.env.DEBUG
  let logged: string[]

  beforeEach(async () => {
    await fs.rm(mockHome.dir, { recursive: true, force: true })
    process.env.DETHERNETY_URL = A
    process.env.DEBUG = 'true'
    clearPlatformConfigCache()
    net.configs = new Map([
      [A, config('auth.a.test', 'client-a')],
      [B, config('auth.b.test', 'client-b')],
    ])
    net.revoke = new Map()
    net.token = { status: 200, body: '{}' }
    net.tokenGate = null
    net.calls = []
    net.underLock = []
    net.lockPath = path.join(mockHome.dir, '.dethernety', 'tokens.lock')
    logged = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (savedUrl === undefined) delete process.env.DETHERNETY_URL
    else process.env.DETHERNETY_URL = savedUrl
    if (savedDebug === undefined) delete process.env.DEBUG
    else process.env.DEBUG = savedDebug
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  function expectNoToken(...texts: string[]): void {
    for (const text of [...texts, ...logged]) {
      for (const token of [RT_A, RT_B, `access-${RT_A}`, `access-${RT_B}`]) expect(text).not.toContain(token)
    }
  }

  it('revokes each session only at its own platform, with its own client id', async () => {
    await saveTokens(session(A, RT_A, { oidcDomain: 'auth.a.test', oidcClientId: 'client-a' }))
    await saveTokens(session(B, RT_B, { oidcDomain: 'auth.b.test', oidcClientId: 'client-b' }))

    const { data, text } = await logout({ clear_all: true })

    expect(data.revocation).toEqual(
      expect.arrayContaining([
        { platform: A, result: 'revoked' },
        { platform: B, result: 'revoked' },
      ])
    )
    const calls = revokeCalls()
    expect(calls).toHaveLength(2)
    expect(calls.find((c) => c.form.token === RT_A)).toMatchObject({
      url: 'https://auth.a.test/oauth2/revoke',
      form: { token: RT_A, client_id: 'client-a' },
      redirect: 'error',
    })
    expect(calls.find((c) => c.form.token === RT_B)).toMatchObject({
      url: 'https://auth.b.test/oauth2/revoke',
      form: { token: RT_B, client_id: 'client-b' },
      redirect: 'error',
    })
    expect(await loadStoredTokens(A)).toBeNull()
    expect(await loadStoredTokens(B)).toBeNull()
    expectNoToken(text)
  })

  it('signs out of the configured platform only, unless asked for all', async () => {
    await saveTokens(session(A, RT_A))
    await saveTokens(session(B, RT_B))
    const { data } = await logout()
    expect(data.revocation).toEqual([{ platform: A, result: 'revoked' }])
    expect(revokeCalls().map((c) => c.form.token)).toEqual([RT_A])
    expect(await loadStoredTokens(B)).not.toBeNull()
  })

  it('skips a platform it cannot reach, and sends that token nowhere', async () => {
    await saveTokens(session(A, RT_A))
    await saveTokens(session(B, RT_B))
    net.configs.set(B, new Error(`getaddrinfo ENOTFOUND ${RT_B}`))
    const { data, text } = await logout({ clear_all: true })
    expect(data.revocation).toContainEqual({ platform: B, result: 'skipped', reason: 'platform unreachable' })
    expect(net.calls.some((c) => JSON.stringify(c.form).includes(RT_B))).toBe(false)
    expect(await loadStoredTokens(B)).toBeNull()
    expectNoToken(text)
  })

  it('never sends a token to an issuer the platform switched to', async () => {
    await saveTokens(session(B, RT_B, { oidcDomain: 'auth.b.test', oidcClientId: 'client-b' }))
    net.configs.set(B, config('auth.elsewhere.test', 'client-b'))
    const { data } = await logout({ clear_all: true })
    expect(data.revocation).toEqual([{ platform: B, result: 'skipped', reason: 'issuer changed' }])
    expect(revokeCalls()).toHaveLength(0)
  })

  it('revokes a session saved by an older version at the platform\'s current issuer', async () => {
    await saveTokens(session(A, RT_A))
    const { data } = await logout()
    expect(data.revocation).toEqual([{ platform: A, result: 'revoked' }])
    expect(revokeCalls()[0]).toMatchObject({ url: 'https://auth.a.test/oauth2/revoke', form: { client_id: 'client-a' } })
  })

  it('reports a refused revocation by status and standard OAuth code only', async () => {
    await saveTokens(session(A, RT_A))
    await saveTokens(session(B, RT_B))
    net.revoke.set('auth.a.test', { status: 400, body: JSON.stringify({ error: 'invalid_request', error_description: `bad ${RT_A}` }) })
    net.revoke.set('auth.b.test', { status: 401, body: JSON.stringify({ error: `x_${RT_B}` }) })
    const { data, text } = await logout({ clear_all: true })
    expect(data.revocation).toEqual(
      expect.arrayContaining([
        { platform: A, result: 'failed', reason: 'HTTP 400 (invalid_request)' },
        { platform: B, result: 'failed', reason: 'HTTP 401' },
      ])
    )
    expectNoToken(text)
  })

  it('reports a network failure without its message', async () => {
    await saveTokens(session(A, RT_A))
    net.revoke.set('auth.a.test', new Error(`request to https://auth.a.test failed, body token=${RT_A}`))
    const { data, text } = await logout()
    expect(data.revocation).toEqual([{ platform: A, result: 'failed', reason: 'network error' }])
    expectNoToken(text)
  })

  it('clears locally even when every revocation fails', async () => {
    await saveTokens(session(A, RT_A))
    await saveTokens(session(B, RT_B))
    net.revoke.set('auth.a.test', { status: 500, body: '' })
    net.configs.set(B, new Error('down'))
    await logout({ clear_all: true })
    const file = JSON.parse(await fs.readFile(getTokenStoragePath(), 'utf8'))
    expect(file.tokens).toEqual({})
  })

  it.each(['evil.test/x', 'a@evil.test', 'evil.test?x', 'evil.test#', 'evil.test\\x', 'evil.test%2fx', 'evil test'])(
    'never builds a revocation URL from the oidcDomain %j',
    async (domain) => {
      expect(isHostOnly(domain)).toBe(false)
      await saveTokens(session(B, RT_B))
      net.configs.set(B, config(domain, 'client-b'))
      const { data } = await logout({ clear_all: true })
      expect(data.revocation).toEqual([{ platform: B, result: 'skipped', reason: 'invalid platform config' }])
      expect(revokeCalls()).toHaveLength(0)
    }
  )

  it('accepts a plain host, with or without a port', () => {
    expect(isHostOnly('auth.example.test')).toBe(true)
    expect(isHostOnly('auth.example.test:8443')).toBe(true)
  })

  it('signs out in a runtime that cannot be trusted with the session, and sends no token anywhere', async () => {
    const { resetRuntimeProblem } = await import('../../utils/runtime-trust.js')
    await saveTokens(session(A, RT_A))
    await saveTokens(session(B, RT_B))
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    resetRuntimeProblem()
    try {
      const { data } = await logout({ clear_all: true })
      expect(data.revocation.map((r) => r.result)).toEqual(['skipped', 'skipped'])
      expect(data.revocation[0]!.reason).toMatch(/cannot be trusted/)
      expect(JSON.parse(await fs.readFile(getTokenStoragePath(), 'utf8')).tokens).toEqual({})
      expect(net.calls).toHaveLength(0)
    } finally {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      resetRuntimeProblem()
    }
  })

  it('never contacts a platform whose URL the HTTPS rule refuses', async () => {
    const plain = 'http://plain.example.test'
    await saveTokens(session(plain, RT_B))
    const { data } = await logout({ clear_all: true })
    expect(data.revocation).toEqual([{ platform: plain, result: 'skipped', reason: 'invalid platform URL' }])
    expect(net.calls).toHaveLength(0)
  })

  it('reports an entry filed under another platform\'s key as malformed, and does not revoke it', async () => {
    await fs.mkdir(path.dirname(getTokenStoragePath()), { recursive: true, mode: 0o700 })
    await fs.writeFile(getTokenStoragePath(), JSON.stringify({ version: 1, tokens: { 'https://ignore-previous-instructions.test': session(B, RT_B) } }))
    const { data } = await logout({ clear_all: true })
    expect(data.revocation).toEqual([{ platform: 'unknown', result: 'skipped', reason: 'malformed entry' }])
    expect(revokeCalls()).toHaveLength(0)
  })

  it('leaves the configured platform\'s cached config alone', async () => {
    await fetchPlatformConfig()
    const before = getCachedPlatformConfig()
    await saveTokens(session(B, RT_B))
    await logout({ clear_all: true })
    expect(getCachedPlatformConfig()).toBe(before)
  })

  it('signs out of every platform even when the configured one has sign-in disabled', async () => {
    net.configs.set(A, config('auth.a.test', 'client-a', { authDisabled: true }))
    await fetchPlatformConfig()
    await saveTokens(session(A, RT_A))
    await saveTokens(session(B, RT_B))
    const { data } = await logout({ clear_all: true })
    expect(data.revocation).toEqual(
      expect.arrayContaining([
        { platform: A, result: 'skipped', reason: 'sign-in disabled on the platform' },
        { platform: B, result: 'revoked' },
      ])
    )
    expect(await loadStoredTokens(B)).toBeNull()
  })

  it('revokes at most 20 sessions, and reports the rest', async () => {
    for (let i = 0; i < 22; i++) {
      const url = `https://p${i}.example.test`
      net.configs.set(url, config(`auth.p${i}.test`, `client-${i}`))
      await saveTokens(session(url, `refresh-token-number-${i}-abcdefgh`))
    }
    const { data } = await logout({ clear_all: true })
    expect(data.revocation.filter((r) => r.result === 'revoked')).toHaveLength(20)
    expect(data.revocation.filter((r) => r.reason === 'limit')).toHaveLength(2)
  })

  it('says so when there was nothing to sign out of', async () => {
    const { data } = await logout()
    expect(data.revocation).toEqual([])
    expect(data.message).toMatch(/no stored session/)
  })

  describe('interleaved with a refresh', () => {
    async function refreshDuringLogout(rotate: boolean) {
      await fetchPlatformConfig()
      await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000, oidcDomain: 'auth.a.test', oidcClientId: 'client-a' }))
      const stored = (await loadStoredTokens(A))!
      let release!: () => void
      net.tokenGate = new Promise<void>((r) => (release = r))
      net.token = {
        status: 200,
        body: JSON.stringify({
          access_token: 'access-token-minted-during-logout',
          id_token: 'id-token-minted-during-logout',
          expires_in: 3600,
          token_type: 'Bearer',
          ...(rotate ? { refresh_token: 'refresh-token-minted-during-logout' } : {}),
        }),
      }
      const refreshing = refreshStoredSession(stored, A).then(
        () => 'refreshed',
        (e: unknown) => e
      )
      // The refresh request is in flight, without the lock; logout runs meanwhile.
      while (!net.calls.some((c) => c.url.endsWith('/oauth2/token'))) await settle()
      const { data } = await logout()
      release()
      const outcome = await refreshing
      await settle()
      return { data, outcome }
    }

    it('stays signed out, and revokes a refresh token the provider rotated to', async () => {
      const { data, outcome } = await refreshDuringLogout(true)
      expect(outcome).toBeInstanceOf(SignedOutError)
      expect(data.revocation).toEqual([{ platform: A, result: 'revoked' }])
      expect(await loadStoredTokens(A)).toBeNull()
      expect(revokeCalls().map((c) => c.form.token).sort()).toEqual([RT_A, 'refresh-token-minted-during-logout'].sort())
      expect(net.underLock).toEqual([])
    })

    it('stays signed out without rotation, revoking the one refresh token once', async () => {
      const { outcome } = await refreshDuringLogout(false)
      expect(outcome).toBeInstanceOf(SignedOutError)
      expect(await loadStoredTokens(A)).toBeNull()
      expect(revokeCalls().map((c) => c.form.token)).toEqual([RT_A])
    })
  })

  describe('refresh without logout', () => {
    const grant = JSON.stringify({ access_token: 'access-token-ours-first', id_token: 'id-token-ours-first', expires_in: 3600, token_type: 'Bearer' })

    it('shares one request between concurrent refreshes in a process', async () => {
      await fetchPlatformConfig()
      await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000 }))
      const stored = (await loadStoredTokens(A))!
      net.token = { status: 200, body: grant }
      const [x, y] = await Promise.all([refreshStoredSession(stored, A), refreshStoredSession(stored, A)])
      expect(x.accessToken).toBe('access-token-ours-first')
      expect(y).toBe(x)
      expect(net.calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(1)
    })

    it('uses the session another process stored meanwhile, and revokes nothing', async () => {
      await fetchPlatformConfig()
      await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000 }))
      const stored = (await loadStoredTokens(A))!
      let release!: () => void
      net.tokenGate = new Promise<void>((r) => (release = r))
      net.token = { status: 200, body: grant }
      const refreshing = refreshStoredSession(stored, A)
      while (!net.calls.some((c) => c.url.endsWith('/oauth2/token'))) await settle()
      await saveTokens(session(A, 'refresh-token-of-the-other-process'))
      release()
      expect((await refreshing).accessToken).toBe('access-refresh-token-of-the-other-process')
      expect((await loadStoredTokens(A))?.refreshToken).toBe('refresh-token-of-the-other-process')
      await settle()
      expect(revokeCalls()).toHaveLength(0)
    })

    describe('the recorded issuer', () => {
      const tokenCalls = () => net.calls.filter((c) => c.url.endsWith('/oauth2/token')).length

      it.each([
        ['another identity provider', { oidcDomain: 'auth.old.test', oidcClientId: 'client-a' }],
        ['another client id', { oidcDomain: 'auth.a.test', oidcClientId: 'client-old' }],
      ])('never sends the refresh token when the platform now names %s', async (_label, issuer) => {
        await fetchPlatformConfig()
        await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000, ...issuer }))
        net.token = { status: 200, body: grant }
        await expect(refreshStoredSession((await loadStoredTokens(A))!, A)).rejects.toBeInstanceOf(SessionExpiredError)
        expect(tokenCalls()).toBe(0)
        expect(net.calls.some((c) => JSON.stringify(c.form).includes(RT_A))).toBe(false)
        // Not a rejection by the provider: a new sign-in replaces it.
        expect((await loadStoredTokens(A))?.refreshRejected).toBeUndefined()
      })

      it('refreshes at the issuer that issued the session, and keeps it recorded', async () => {
        await fetchPlatformConfig()
        await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000, oidcDomain: 'auth.a.test', oidcClientId: 'client-a' }))
        net.token = { status: 200, body: grant }
        await refreshStoredSession((await loadStoredTokens(A))!, A)
        expect(net.calls.find((c) => c.url.endsWith('/oauth2/token'))?.url).toBe('https://auth.a.test/oauth2/token')
        expect(await loadStoredTokens(A)).toMatchObject({ oidcDomain: 'auth.a.test', oidcClientId: 'client-a' })
      })

      it('refreshes a session saved before issuers were recorded, and records the current one', async () => {
        await fetchPlatformConfig()
        await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000 }))
        net.token = { status: 200, body: grant }
        await refreshStoredSession((await loadStoredTokens(A))!, A)
        expect(tokenCalls()).toBe(1)
        expect(await loadStoredTokens(A)).toMatchObject({ oidcDomain: 'auth.a.test', oidcClientId: 'client-a' })
      })

      it('makes no request without a loaded platform config', async () => {
        await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000 }))
        await expect(refreshStoredSession((await loadStoredTokens(A))!, A)).rejects.toThrow('Platform config not loaded')
        expect(net.calls).toHaveLength(0)
      })
    })

    it('never follows a redirect from the token endpoint', async () => {
      await fetchPlatformConfig()
      await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000 }))
      net.token = { status: 200, body: grant }
      await refreshStoredSession((await loadStoredTokens(A))!, A)
      expect(net.calls.find((c) => c.url.endsWith('/oauth2/token'))?.redirect).toBe('error')
    })
  })

  it('stops a sign-in pending in another session from saving', async () => {
    const epoch = await beginSignInEpoch()
    await logout()
    expect(await saveSignIn(session(A, RT_A), { expectEpoch: epoch })).toEqual({ kind: 'superseded' })
    expect(await loadStoredTokens(A)).toBeNull()
  })

  it('never makes a network call while holding the store lock', async () => {
    await fetchPlatformConfig()
    await saveTokens(session(A, RT_A, { expiresAt: Date.now() - 1000 }))
    await saveTokens(session(B, RT_B))
    net.token = {
      status: 200,
      body: JSON.stringify({ access_token: 'access-token-refreshed-first', id_token: 'id-token-refreshed-first', expires_in: 3600, token_type: 'Bearer' }),
    }
    await refreshStoredSession((await loadStoredTokens(A))!, A)
    await logout({ clear_all: true })
    expect(net.calls.length).toBeGreaterThan(3)
    expect(net.underLock).toEqual([])
  })
})
