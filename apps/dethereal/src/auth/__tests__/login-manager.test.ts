/**
 * The login manager: a browser sign-in that never blocks a tool call for long,
 * one per process, cancellable without leaving a session behind.
 *
 * The callback server is real, on an ephemeral port (the manager's test-only port
 * option); the browser is a recorder; the platform config and the token endpoint are
 * stubbed at the process edges; the session store runs for real in a sandbox HOME.
 * The provider's redirect is played by the test: it follows `/start` to read the
 * state, then calls `/callback` with it, as a browser would.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { promises as fs } from 'node:fs'

const { mockHome, harness } = vi.hoisted(() => ({
  mockHome: { // Unique per run: two runs of one checkout must not share a sandbox.
  dir: `${process.cwd()}/.test-login-manager-home-${process.pid}-${Math.random().toString(36).slice(2, 10)}` },
  harness: {
    opened: [] as string[],
    tokenBodies: [] as string[],
    /** The token endpoint's next answer; a promise holds the response back. */
    tokenReply: undefined as undefined | (() => Promise<{ status: number; body: unknown }>),
    idClaims: { email: 'analyst@example.test', sub: 'user-1' } as Record<string, unknown>,
    /** Changes to the served platform config. */
    config: {} as Record<string, unknown>,
    /** How long the platform config takes to arrive. */
    configDelayMs: 20,
  },
}))

vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

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
    ...harness.config,
  })
  return {
    ...actual,
    // Honours the caller's signal, as the real fetch does.
    fetchPlatformConfig: vi.fn(async (_url?: string, options: { signal?: AbortSignal } = {}) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, harness.configDelayMs)
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
      return served()
    }),
    getCachedPlatformConfig: vi.fn(() => served()),
  }
})

vi.mock('../browser.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../browser.js')
  return { ...actual, openBrowser: vi.fn(async (url: string) => void harness.opened.push(url)) }
})

vi.mock('cross-fetch', () => ({
  default: vi.fn(async (_url: string, init?: { body?: string; signal?: AbortSignal }) => {
    harness.tokenBodies.push(init?.body ?? '')
    const reply = harness.tokenReply ? harness.tokenReply() : Promise.resolve({ status: 200, body: grant() })
    const aborted = new Promise<never>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
    const { status, body } = await Promise.race([reply, aborted])
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
  }),
}))

import { login, isLoginPending, lastLoginSummary, cancelPendingLogin, resetLoginManager, type LoginAnswer } from '../login-manager.js'
import { saveTokens, loadStoredTokens, clearAllTokens, getTokenStoragePath } from '../token-store.js'
import { acquireFileLock } from '../../utils/file-lock.js'
import path from 'node:path'

const BASE_URL = 'http://localhost:3003'

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.`
}

function grant(): Record<string, unknown> {
  return {
    access_token: jwt({ scope: 'openid profile email' }),
    id_token: jwt(harness.idClaims),
    refresh_token: 'refresh-token-from-grant',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'openid profile email',
  }
}

function request(url: string, path: string): Promise<{ status: number; location?: string }> {
  const { hostname, port } = new URL(url)
  return new Promise((resolve, reject) => {
    // As a browser opening a link: /start redirects only a top-level document navigation.
    const headers = { Host: `${hostname}:${port}`, 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }
    const req = http.request({ host: hostname, port, path, method: 'GET', headers }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Play the provider's redirect: read the state through /start, then call back with it. */
async function signIn(answer: LoginAnswer, query = 'code=the-code'): Promise<number> {
  expect(answer.status).toBe('pending')
  const openUrl = (answer as { openUrl: string }).openUrl
  const start = await request(openUrl, '/start')
  expect(start.status).toBe(302)
  const state = new URL(start.location!).searchParams.get('state')!
  return (await request(openUrl, `/callback?${query}&state=${encodeURIComponent(state)}`)).status
}

const until = async (predicate: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!predicate()) {
    if (Date.now() - t0 > ms) throw new Error('condition not reached')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const OPTS = { port: 0 }
const now = { waitMs: 0, forceNew: false }

describe('login manager', () => {
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => rejections.push(reason)

  beforeEach(async () => {
    process.env.DETHERNETY_URL = BASE_URL
    harness.opened = []
    harness.tokenBodies = []
    harness.tokenReply = undefined
    harness.idClaims = { email: 'analyst@example.test', sub: 'user-1' }
    harness.config = {}
    harness.configDelayMs = 20
    rejections.length = 0
    process.on('unhandledRejection', onRejection)
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })
  afterEach(async () => {
    await resetLoginManager()
    process.off('unhandledRejection', onRejection)
    await fs.rm(mockHome.dir, { recursive: true, force: true })
    // No flow outcome may ever be left rejected.
    expect(rejections).toEqual([])
  })

  it('returns pending at once, then completes in the background and reports it once', async () => {
    const t0 = Date.now()
    const first = await login(now, OPTS)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(first).toMatchObject({ status: 'pending', newFlow: true, browserOpened: true })
    expect((first as { openUrl: string }).openUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/start$/)
    expect(harness.opened).toEqual([(first as { openUrl: string }).openUrl])
    expect(isLoginPending()).toBe(true)

    expect(await signIn(first)).toBe(200)
    await until(() => !isLoginPending())
    expect(await loadStoredTokens(BASE_URL)).not.toBeNull()

    const next = await login(now, OPTS)
    expect(next.status).toBe('authenticated')
    expect((next as { result: { fromCache?: boolean } }).result.fromCache).toBeUndefined()
    const after = await login(now, OPTS)
    expect(after).toMatchObject({ status: 'authenticated', result: { fromCache: true } })
  })

  it('finishes within the call when the sign-in completes during the wait', async () => {
    const answer = login({ waitMs: 5000, forceNew: false }, OPTS)
    await until(() => harness.opened.length === 1)
    await signIn({ status: 'pending', openUrl: harness.opened[0]! } as LoginAnswer)
    expect(await answer).toMatchObject({ status: 'authenticated' })
  })

  it('reuses a pending sign-in, and shares one between concurrent calls', async () => {
    const [a, b] = await Promise.all([login(now, OPTS), login(now, OPTS)])
    const c = await login(now, OPTS)
    expect(harness.opened).toHaveLength(1)
    for (const x of [a, b, c]) expect((x as { openUrl: string }).openUrl).toBe(harness.opened[0])
    expect(c).toMatchObject({ newFlow: false })
  })

  it('replaces a pending sign-in on force_new, freeing the old listener first', async () => {
    const first = (await login(now, OPTS)) as { openUrl: string }
    const second = (await login({ waitMs: 0, forceNew: true }, OPTS)) as { openUrl: string; replaced: boolean }
    expect(second).toMatchObject({ status: 'pending', replaced: true })
    expect(second.openUrl).not.toBe(first.openUrl)
    await expect(request(first.openUrl, '/start')).rejects.toThrow()
    expect(harness.opened).toHaveLength(2)
  })

  it('rebinds the same fixed port immediately after force_new', async () => {
    const probe = net.createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as net.AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))
    await login(now, { port })
    const again = await login({ waitMs: 0, forceNew: true }, { port })
    expect(again).toMatchObject({ status: 'pending', replaced: true })
  })

  it('expires a sign-in nobody finished, reports that once, then starts afresh', async () => {
    await login(now, { port: 0, lifetimeMs: 150 })
    await until(() => !isLoginPending())
    expect(lastLoginSummary()).toMatchObject({ status: 'expired' })
    expect(await login(now, OPTS)).toMatchObject({ status: 'failed', error: expect.stringMatching(/expired/) })
    expect(await login(now, OPTS)).toMatchObject({ status: 'pending', newFlow: true })
  })

  it('reports a provider refusal once, without reopening the browser on that call', async () => {
    const first = await login(now, OPTS)
    expect(await signIn(first, 'error=access_denied')).toBe(400)
    await until(() => !isLoginPending())
    expect(await login(now, OPTS)).toEqual({ status: 'failed', error: 'OAuth error: access_denied' })
    expect(harness.opened).toHaveLength(1)
  })

  it('reports a busy port without any URL, telling another program apart', async () => {
    const holder = net.createServer()
    await new Promise<void>((r) => holder.listen(0, '127.0.0.1', r))
    const port = (holder.address() as net.AddressInfo).port
    try {
      const busy = await login(now, { port })
      expect(busy).toMatchObject({ status: 'busy', message: expect.stringMatching(/another Dethereal session.*or another program/) })
      expect(JSON.stringify(busy)).not.toMatch(/http:\/\/|\/start/)
    } finally {
      await new Promise<void>((r) => holder.close(() => r()))
    }
    const v6 = net.createServer()
    const bound = await new Promise<boolean>((r) => {
      v6.once('error', () => r(false))
      v6.listen(0, '::1', () => r(true))
    })
    if (!bound) return
    try {
      const busy = await login(now, { port: (v6.address() as net.AddressInfo).port })
      expect(busy).toMatchObject({ status: 'busy', message: expect.stringMatching(/another program; sign-in cannot start/) })
    } finally {
      await new Promise<void>((r) => v6.close(() => r()))
    }
  })

  describe('identity', () => {
    const storePrevious = (claims: Record<string, unknown>) =>
      saveTokens({
        accessToken: jwt({ scope: 'openid profile email' }),
        idToken: jwt(claims),
        refreshToken: 'old-refresh',
        expiresAt: Date.now() - 60_000,
        baseUrl: BASE_URL,
        storedAt: Date.now(),
        grantedScope: 'openid profile email',
        issuedAt: 0,
      } as never)

    it('warns when the new session belongs to someone else', async () => {
      await storePrevious({ email: 'previous@example.test', sub: 'user-0' })
      harness.tokenReply = undefined
      // The expired session cannot be refreshed (refresh window over): a browser sign-in follows.
      const first = await login({ waitMs: 0, forceNew: true }, OPTS)
      await signIn(first)
      await until(() => !isLoginPending())
      expect(await login(now, OPTS)).toMatchObject({
        status: 'authenticated',
        identityChanged: { previousEmail: 'previous@example.test' },
      })
    })

    it('stays quiet for the same user, compared by sub before email', async () => {
      await storePrevious({ email: 'OLD-ADDRESS@example.test', sub: 'user-1' })
      const first = await login({ waitMs: 0, forceNew: true }, OPTS)
      await signIn(first)
      await until(() => !isLoginPending())
      const answer = await login(now, OPTS)
      expect(answer.status).toBe('authenticated')
      expect((answer as { identityChanged?: unknown }).identityChanged).toBeUndefined()
    })
  })

  describe('cancellation', () => {
    it('frees the port and forgets the sign-in when cancelled', async () => {
      const first = (await login(now, OPTS)) as { openUrl: string }
      await cancelPendingLogin()
      expect(isLoginPending()).toBe(false)
      await expect(request(first.openUrl, '/start')).rejects.toThrow()
      // A cancelled sign-in is not reported as an outcome.
      expect(await login(now, OPTS)).toMatchObject({ status: 'pending', newFlow: true })
    })

    it('never writes the store when cancelled during the code exchange', async () => {
      let release!: () => void
      harness.tokenReply = () => new Promise((r) => (release = () => r({ status: 200, body: grant() })))
      const first = await login(now, OPTS)
      await signIn(first)
      await until(() => harness.tokenBodies.length === 1)
      await cancelPendingLogin()
      release?.()
      await new Promise((r) => setTimeout(r, 50))
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
    })

    it('never lets a replaced sign-in write its tokens', async () => {
      let release!: () => void
      harness.tokenReply = () => new Promise((r) => (release = () => r({ status: 200, body: grant() })))
      const first = await login(now, OPTS)
      await signIn(first)
      await until(() => harness.tokenBodies.length === 1)
      harness.tokenReply = undefined
      await login({ waitMs: 0, forceNew: true }, OPTS)
      release?.()
      await new Promise((r) => setTimeout(r, 50))
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
      expect(isLoginPending()).toBe(true)
    })
  })

  describe('the session store', () => {
    const revoked = () => harness.tokenBodies.filter((b) => !b.includes('grant_type')).map((b) => new URLSearchParams(b).get('token'))

    it('does not save a sign-in that a logout in another session overtook, and ends that session', async () => {
      const first = await login(now, OPTS)
      // Another Dethereal session signs out while this sign-in is pending.
      await clearAllTokens()
      await signIn(first)
      await until(() => !isLoginPending())
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
      expect(await login(now, OPTS)).toEqual({
        status: 'failed',
        error: 'You signed out in another session while this sign-in was pending; sign in again',
      })
      await until(() => revoked().length === 1)
      expect(revoked()).toEqual(['refresh-token-from-grant'])
    })

    it('ends the session a new sign-in replaced', async () => {
      await saveTokens({
        accessToken: jwt({ scope: 'openid profile email' }),
        idToken: jwt(harness.idClaims),
        refreshToken: 'refresh-token-being-replaced',
        expiresAt: Date.now() + 3600_000,
        baseUrl: BASE_URL,
        storedAt: Date.now(),
        grantedScope: 'openid profile email',
      })
      const first = await login({ waitMs: 0, forceNew: true }, OPTS)
      await signIn(first)
      await until(() => !isLoginPending())
      expect((await loadStoredTokens(BASE_URL))?.refreshToken).toBe('refresh-token-from-grant')
      await until(() => revoked().length === 1)
      expect(revoked()).toEqual(['refresh-token-being-replaced'])
    })

    it('records the issuer with the session, for revocation', async () => {
      const first = await login(now, OPTS)
      await signIn(first)
      await until(() => !isLoginPending())
      expect(await loadStoredTokens(BASE_URL)).toMatchObject({ oidcDomain: 'auth.example', oidcClientId: 'test-client' })
    })

    it('still serves the stored session with wait 0 while another process briefly holds the store', async () => {
      await saveTokens({
        accessToken: jwt({ scope: 'openid profile email' }),
        idToken: jwt(harness.idClaims),
        refreshToken: 'refresh-me',
        expiresAt: Date.now() - 60_000,
        baseUrl: BASE_URL,
        storedAt: Date.now(),
        grantedScope: 'openid profile email',
      })
      const held = await acquireFileLock(path.join(path.dirname(getTokenStoragePath()), 'tokens.lock'))
      setTimeout(() => void held.release(), 100)
      expect(await login(now, OPTS)).toMatchObject({ status: 'authenticated', result: { refreshed: true } })
      expect(harness.opened).toEqual([])
      expect((await loadStoredTokens(BASE_URL))?.refreshToken).toBe('refresh-token-from-grant')
    })
  })

  it('still checks the stored session when asked not to wait', async () => {
    await saveTokens({
      accessToken: jwt({ scope: 'openid profile email' }),
      idToken: jwt(harness.idClaims),
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      baseUrl: BASE_URL,
      storedAt: Date.now(),
      grantedScope: 'openid profile email',
    } as never)
    harness.configDelayMs = 200
    expect(await login(now, OPTS)).toMatchObject({ status: 'authenticated', result: { fromCache: true } })
    expect(harness.opened).toEqual([])
  })

  it('starts a new sign-in on force_new even when one finished in the background', async () => {
    const first = await login(now, OPTS)
    await signIn(first)
    await until(() => !isLoginPending())
    const again = await login({ waitMs: 0, forceNew: true }, OPTS)
    expect(again).toMatchObject({ status: 'pending', newFlow: true })
    expect(harness.opened).toHaveLength(2)
  })

  it('answers auth-disabled when the platform turns out to need no sign-in, and binds nothing', async () => {
    harness.config = { authDisabled: true, oidcDomain: undefined, oidcClientId: undefined }
    expect(await login(now, OPTS)).toEqual({ status: 'auth-disabled' })
    expect(await login({ waitMs: 0, forceNew: true }, OPTS)).toEqual({ status: 'auth-disabled' })
    expect(harness.opened).toEqual([])
    expect(isLoginPending()).toBe(false)
  })

  it('frees the port when a sign-in fails to start', async () => {
    const probe = net.createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as net.AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))
    // A domain no URL can hold: the authorization URL cannot be built.
    harness.config = { oidcDomain: 'bad domain' }
    expect(await login(now, { port })).toMatchObject({ status: 'failed' })
    harness.config = {}
    expect(await login(now, { port })).toMatchObject({ status: 'pending', newFlow: true })
  })

  it('bounds a hanging refresh by the session-step floor, well inside a harness timeout', async () => {
    await saveTokens({
      accessToken: jwt({ scope: 'openid profile email' }),
      idToken: jwt(harness.idClaims),
      refreshToken: 'refresh-me',
      expiresAt: Date.now() - 60_000,
      baseUrl: BASE_URL,
      storedAt: Date.now(),
      grantedScope: 'openid profile email',
    } as never)
    // The token endpoint never answers; only the abort ends the request.
    harness.tokenReply = () => new Promise(() => {})
    const t0 = Date.now()
    const answer = await login({ waitMs: 800, forceNew: false }, OPTS)
    // The stored-session check gets at least its floor (3 s), then the call returns.
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(answer.status).toBe('pending')
  })

  it('keeps the provider URL, state, challenge and code out of every answer', async () => {
    const answers: LoginAnswer[] = []
    answers.push(await login(now, OPTS))
    answers.push(await login(now, OPTS))
    await signIn(answers[0]!, 'error=access_denied')
    await until(() => !isLoginPending())
    answers.push(await login(now, OPTS))
    answers.push(await login(now, OPTS))
    await signIn(answers[3]!)
    await until(() => !isLoginPending())
    answers.push(await login(now, OPTS))
    const text = JSON.stringify(answers) + JSON.stringify(lastLoginSummary())
    expect(text).not.toMatch(/state=|code_challenge|code_verifier|redirect_uri|the-code|auth\.example|oauth2|Location/i)
  })
})
