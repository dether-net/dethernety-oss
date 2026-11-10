/**
 * auth_status: the one place prompts learn the session state from.
 *
 * Mocked only at the process edges — the platform config endpoint and the token
 * endpoint (`cross-fetch`). The token store runs for real in a sandbox HOME, so
 * "refreshed" means a record was actually rewritten, and "no token in the output"
 * is checked against the values the store really holds.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'

const { mockHome, harness } = vi.hoisted(() => ({
  mockHome: { dir: `${process.cwd()}/.test-auth-status-home-${process.pid}` },
  harness: {
    /** What getCachedPlatformConfig returns; null = the platform was never reached. */
    cached: null as Record<string, unknown> | null,
    /** What fetchPlatformConfig resolves to, or the error it rejects with. */
    served: null as Record<string, unknown> | Error | null,
    fetchConfigCalls: [] as { signal?: AbortSignal }[],
    /** The token endpoint's answer. */
    token: { status: 200, body: '{}' },
    tokenCalls: 0,
  },
}))

vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

vi.mock('../../auth/platform-config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../auth/platform-config.js')
  return {
    ...actual,
    getCachedPlatformConfig: vi.fn(() => harness.cached),
    isAuthDisabled: vi.fn(() => harness.cached?.authDisabled === true),
    fetchPlatformConfig: vi.fn(async (_url?: string, options: { signal?: AbortSignal } = {}) => {
      harness.fetchConfigCalls.push(options)
      if (harness.served instanceof Error) throw harness.served
      harness.cached = harness.served
      return harness.served
    }),
  }
})

vi.mock('cross-fetch', () => ({
  default: vi.fn(async () => {
    harness.tokenCalls += 1
    return {
      ok: harness.token.status >= 200 && harness.token.status < 300,
      status: harness.token.status,
      json: async () => JSON.parse(harness.token.body),
      text: async () => harness.token.body,
    }
  }),
}))

import { authStatusTool } from '../auth/auth-status.tool.js'
import { saveTokens, loadStoredTokens, getTokenStoragePath, type StoredTokens } from '../../auth/token-store.js'
import { redactSecrets } from '../../auth/redact.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'

const BASE_URL = 'http://127.0.0.1:43127'

/** An unsigned JWT carrying `claims`. */
function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.`
}

const ID_TOKEN = jwt({ email: 'analyst@example.test', sub: 'user-1' })
const ACCESS_TOKEN = 'opaque-access-token-0123456789abcdef'
const REFRESH_TOKEN = 'opaque-refresh-token-fedcba9876543210'

function platform(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oidcIssuer: 'https://issuer.invalid',
    oidcClientId: 'test-client',
    oidcDomain: 'auth.invalid',
    oidcRedirectUri: 'https://app.invalid/callback',
    oidcProvider: 'generic',
    graphqlUrl: '/graphql',
    graphqlWsUrl: '/graphql',
    subscriptionTransport: 'sse',
    appUrl: BASE_URL,
    appBaseUrl: '/',
    apiBaseUrl: '',
    ...overrides,
  }
}

async function seed(overrides: Partial<StoredTokens> = {}): Promise<void> {
  await saveTokens({
    accessToken: ACCESS_TOKEN,
    idToken: ID_TOKEN,
    refreshToken: REFRESH_TOKEN,
    grantedScope: 'openid profile email',
    expiresAt: Date.now() + 3600_000,
    baseUrl: BASE_URL,
    storedAt: Date.now(),
    ...overrides,
  })
}

async function status(input: Record<string, unknown> = {}) {
  const result = await authStatusTool.run(input, { debug: false })
  expect(result.success).toBe(true)
  return { data: result.data!, text: JSON.stringify(result) }
}

function expectNoSecrets(text: string): void {
  for (const secret of [ACCESS_TOKEN, ID_TOKEN, REFRESH_TOKEN, 'tokens.json', mockHome.dir]) {
    expect(text).not.toContain(secret)
  }
}

describe('auth_status', () => {
  const savedUrl = process.env.DETHERNETY_URL

  beforeEach(async () => {
    process.env.DETHERNETY_URL = BASE_URL
    harness.cached = platform()
    harness.served = platform()
    harness.fetchConfigCalls = []
    harness.token = { status: 200, body: '{}' }
    harness.tokenCalls = 0
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  afterEach(async () => {
    if (savedUrl === undefined) delete process.env.DETHERNETY_URL
    else process.env.DETHERNETY_URL = savedUrl
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  it('reports a missing session without touching the network', async () => {
    const { data } = await status()
    expect(data).toMatchObject({
      platformUrl: BASE_URL,
      urlSource: 'env',
      projectRoot: process.cwd(),
      authDisabled: false,
      authenticated: false,
      pending: false,
      detail: 'not signed in',
    })
    expect(harness.fetchConfigCalls).toHaveLength(0)
    expect(harness.tokenCalls).toBe(0)
  })

  it('reports a live session with the user and time left, and no credential or path', async () => {
    await seed()
    const { data, text } = await status()
    expect(data.authenticated).toBe(true)
    expect(data.email).toBe('analyst@example.test')
    expect(data.secondsRemaining).toBeGreaterThan(3500)
    expect(data.secondsRemaining).toBeLessThanOrEqual(3600)
    expect(new Date(data.expiresAt!).toISOString()).toBe(data.expiresAt)
    expect(data.scopeShortfall).toBeUndefined()
    expect(data.detail).toBeUndefined()
    expectNoSecrets(text)
    expect(text).not.toContain(getTokenStoragePath())
  })

  it('does not refresh an expired session unless asked', async () => {
    await seed({ expiresAt: Date.now() - 1000 })
    const { data } = await status()
    expect(data.authenticated).toBe(false)
    expect(data.secondsRemaining).toBe(0)
    expect(data.detail).toMatch(/verify: true/)
    expect(harness.tokenCalls).toBe(0)
  })

  it('refreshes an expired session with verify, and persists the result', async () => {
    await seed({ expiresAt: Date.now() - 1000 })
    const fresh = jwt({ email: 'analyst@example.test', v: 2 })
    harness.token = {
      status: 200,
      body: JSON.stringify({
        access_token: 'opaque-access-token-second-generation',
        id_token: fresh,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid profile email',
      }),
    }
    const { data, text } = await status({ verify: true })
    expect(harness.tokenCalls).toBe(1)
    expect(data.authenticated).toBe(true)
    expect(data.secondsRemaining).toBeGreaterThan(3500)
    expect(text).not.toContain('opaque-access-token-second-generation')
    expect(text).not.toContain(fresh)
    // A refreshed bearer is what an hour-old session sends; it must be redactable
    // from the moment it is saved, before any request can echo it. Checked before
    // the store is read back below, which would register it a second way.
    expect(redactSecrets('x opaque-access-token-second-generation y')).toBe('x [redacted] y')
    expect(redactSecrets(`x ${fresh} y`)).toBe('x [redacted] y')
    const stored = await loadStoredTokens(BASE_URL)
    expect(stored?.accessToken).toBe('opaque-access-token-second-generation')
    expect(stored?.refreshToken).toBe(REFRESH_TOKEN)
  })

  it('registers tokens for redaction even when saving them fails', async () => {
    // A home the store directory cannot be created in.
    await fs.mkdir(mockHome.dir, { recursive: true, mode: 0o500 })
    await fs.chmod(mockHome.dir, 0o500)
    try {
      await expect(
        saveTokens({
          accessToken: 'opaque-access-token-unsaved-0001',
          idToken: ID_TOKEN,
          refreshToken: REFRESH_TOKEN,
          expiresAt: Date.now() + 3600_000,
          baseUrl: BASE_URL,
          storedAt: Date.now(),
        })
      ).rejects.toThrow(/Failed to save tokens: E[A-Z]+/)
    } finally {
      await fs.chmod(mockHome.dir, 0o700)
    }
    expect(redactSecrets('opaque-access-token-unsaved-0001')).toBe('[redacted]')
  })

  it('does not echo credentials in the userinfo of the platform URL', async () => {
    process.env.DETHERNETY_URL = 'https://user:hunter2hunter2@platform.example.test'
    harness.cached = null
    harness.served = new Error(`Failed to fetch platform config from ${process.env.DETHERNETY_URL}/config: refused`)
    const { data, text } = await status({ verify: true })
    expect(data.detail).toMatch(/^configuration error: DETHERNETY_URL must not contain a user name or password/)
    expect(text).not.toContain('hunter2')
  })

  it('reports a failed refresh by status and OAuth code only, and keeps the session', async () => {
    await seed({ expiresAt: Date.now() - 1000 })
    harness.token = {
      status: 503,
      body: JSON.stringify({ error: 'temporarily_unavailable', error_description: `bad token ${REFRESH_TOKEN}` }),
    }
    const { data, text } = await status({ verify: true })
    expect(data.authenticated).toBe(false)
    expect(data.detail).toBe('refresh failed: Token refresh failed: HTTP 503 (temporarily_unavailable)')
    expectNoSecrets(text)
    expect(text).not.toContain('bad token')
    // A provider that is down says nothing about the session: it is tried again next time.
    expect((await loadStoredTokens(BASE_URL))?.refreshRejected).toBeUndefined()
  })

  it('says sign in again when the provider rejects the refresh token, and never tries it again', async () => {
    await seed({ expiresAt: Date.now() - 1000 })
    harness.token = { status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: `bad ${REFRESH_TOKEN}` }) }
    const first = await status({ verify: true })
    expect(first.data.authenticated).toBe(false)
    expect(first.data.detail).toBe('session expired; sign in again')
    expectNoSecrets(first.text)
    expect(harness.tokenCalls).toBe(1)
    // Kept, marked: only a logout removes a session.
    expect((await loadStoredTokens(BASE_URL))?.refreshRejected).toBe(true)

    const second = await status({ verify: true })
    expect(second.data.detail).toBe('session expired; sign in again')
    expect(harness.tokenCalls).toBe(1)
  })

  it('drops an OAuth error code that is not shaped like one', async () => {
    await seed({ expiresAt: Date.now() - 1000 })
    harness.token = { status: 401, body: JSON.stringify({ error: `x ${REFRESH_TOKEN}` }) }
    const { data, text } = await status({ verify: true })
    expect(data.detail).toBe('refresh failed: Token refresh failed: HTTP 401')
    expectNoSecrets(text)
  })

  it('refreshes an old session: only the provider decides whether it is still valid', async () => {
    // Stored long ago, by an older version that also recorded when the token was issued.
    await seed({ expiresAt: Date.now() - 1000, storedAt: 0, issuedAt: 0 })
    harness.token = {
      status: 200,
      body: JSON.stringify({ access_token: 'opaque-access-token-after-a-month', id_token: ID_TOKEN, expires_in: 3600, token_type: 'Bearer' }),
    }
    const { data } = await status({ verify: true })
    expect(harness.tokenCalls).toBe(1)
    expect(data.authenticated).toBe(true)
  })

  it('counts an auth-disabled platform as authenticated', async () => {
    harness.cached = platform({ authDisabled: true })
    const { data } = await status()
    expect(data).toMatchObject({ authDisabled: true, authenticated: true, pending: false })
  })

  it('reports an unreached platform as unknown, and fetches it only with verify', async () => {
    harness.cached = null
    const offline = await status()
    expect(offline.data.authDisabled).toBeNull()
    expect(harness.fetchConfigCalls).toHaveLength(0)

    const verified = await status({ verify: true })
    expect(verified.data.authDisabled).toBe(false)
    expect(harness.fetchConfigCalls).toHaveLength(1)
    // The verify path is bounded: the fetch gets an abort signal.
    expect(harness.fetchConfigCalls[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports a timeout as a timeout', async () => {
    harness.cached = null
    harness.served = Object.assign(new Error('Failed to fetch platform config'), {
      cause: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    })
    const { data } = await status({ verify: true })
    expect(data.detail).toBe('platform unreachable: timeout')
    expect(data.authDisabled).toBeNull()
  })

  it('names the scopes the session lacks', async () => {
    harness.cached = platform({ oidcScope: 'openid profile email platform/api' })
    await seed()
    const { data } = await status()
    expect(data.scopeShortfall).toBe('platform/api')
  })

  it('omits an email it cannot read instead of echoing the token', async () => {
    await seed({ idToken: 'not-a-jwt-but-long-enough-to-register' })
    const { data, text } = await status()
    expect(data.authenticated).toBe(true)
    expect(data.email).toBeUndefined()
    expect(text).not.toContain('not-a-jwt-but-long-enough-to-register')
  })

  it('treats a malformed stored record as no session', async () => {
    await fs.mkdir(`${mockHome.dir}/.dethernety`, { recursive: true })
    await fs.writeFile(
      getTokenStoragePath(),
      JSON.stringify({ version: 1, tokens: { [BASE_URL]: { accessToken: ACCESS_TOKEN, expiresAt: 'soon', baseUrl: BASE_URL } } })
    )
    const { data, text } = await status()
    expect(data.authenticated).toBe(false)
    expect(data.detail).toBe('not signed in')
    expectNoSecrets(text)
  })

  it('reports only the origin of the platform URL', async () => {
    process.env.DETHERNETY_URL = 'https://user:secret@platform.example.test/app/'
    const { data, text } = await status()
    expect(data.platformUrl).toBe('https://platform.example.test')
    expect(text).not.toContain('secret')
  })

  it('reports the default URL source when none is configured', async () => {
    delete process.env.DETHERNETY_URL
    const { data } = await status()
    expect(data.urlSource).toBe('default')
  })
})

describe('auth_status: configuration and project root', () => {
  const saved = { url: process.env.DETHERNETY_URL, userConfig: process.env.DETHERNETY_PLATFORM_URL }
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  beforeEach(async () => {
    harness.cached = platform()
    harness.served = platform()
    harness.fetchConfigCalls = []
    harness.tokenCalls = 0
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })
  afterEach(async () => {
    resetProjectRoot()
    restore('DETHERNETY_URL', saved.url)
    restore('DETHERNETY_PLATFORM_URL', saved.userConfig)
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  it('reports the Claude user config as the URL source when the shell sets none', async () => {
    process.env.DETHERNETY_URL = '${DETHERNETY_URL}'
    process.env.DETHERNETY_PLATFORM_URL = BASE_URL
    const { data } = await status()
    expect(data).toMatchObject({ platformUrl: BASE_URL, urlSource: 'user_config' })
  })

  it('reports an unusable configuration without any network or store access', async () => {
    process.env.DETHERNETY_URL = 'http://someone:hunter2@platform.example.test'
    harness.cached = null
    await seed()
    const { data, text } = await status({ verify: true })
    expect(data).toMatchObject({ urlSource: 'env', authDisabled: null, authenticated: false, pending: false })
    expect(data.detail).toMatch(/^configuration error: DETHERNETY_URL must use HTTPS/)
    expect(harness.fetchConfigCalls).toHaveLength(0)
    expect(harness.tokenCalls).toBe(0)
    expect(text).not.toMatch(/hunter2|someone/)
    expectNoSecrets(text)
  })

  it('reports the project root resolved at startup', async () => {
    process.env.DETHERNETY_URL = BASE_URL
    const root = initProjectRoot({ cwd: process.cwd(), env: { DETHEREAL_PROJECT_ROOT: process.cwd() } })
    const { data } = await status()
    expect(root.root).not.toBeNull()
    expect(data.projectRoot).toBe(root.root)
    expect(data).not.toHaveProperty('projectRootDetail')
  })

  it('reports a refused project root as null, with a reason that names no path', async () => {
    process.env.DETHERNETY_URL = BASE_URL
    initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: 'not/absolute' } })
    const { data, text } = await status()
    expect(data.projectRoot).toBeNull()
    expect(data.projectRootDetail).toMatch(/DETHEREAL_PROJECT_ROOT must be an absolute path/)
    expect(text).not.toContain('not/absolute')
    expect(text).not.toContain(process.cwd())
  })
})
