/**
 * The live suites' platform rule, against a local stub: off unless switched on; once on, only a platform named in
 * DETHERNETY_URL whose GraphQL is its own, with authentication disabled or a live session for it, and a writing
 * suite only with that URL named twice.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
// The session check is the product's own auth_status; stubbed here, so no test reads a session store.
const status = vi.hoisted(() => ({ value: { success: true, data: { authenticated: false, platformUrl: '' } } as { success: boolean; data: { authenticated: boolean; platformUrl: string; scopeShortfall?: string } } }))
const run = vi.hoisted(() => vi.fn(async (_input: unknown, _context: unknown) => status.value))
vi.mock('../../tools/auth/auth-status.tool.js', () => ({ authStatusTool: { run } }))

const { getGraphQLEndpoint } = await import('../../auth/platform-config.js')
const { livePlatform } = await import('./live-platform.js')

const KEYS = ['DETHEREAL_TRIAGE_LIVE', 'DETHERNETY_URL', 'DETHEREAL_TRIAGE_LIVE_WRITE'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

/** A stub platform answering /config with the given authDisabled, and GraphQL at its own origin unless told another. */
async function stub(authDisabled: boolean, graphqlUrl = '/graphql'): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    const auth = authDisabled ? { authDisabled } : { authDisabled, oidcClientId: 'client', oidcDomain: 'idp.example.test' }
    res.end(JSON.stringify(req.url === '/config' ? { ...auth, graphqlUrl } : {}))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(() => r())) }
}

describe('livePlatform', () => {
  let open: Awaited<ReturnType<typeof stub>>
  let closed: Awaited<ReturnType<typeof stub>>
  let elsewhere: Awaited<ReturnType<typeof stub>>
  beforeAll(async () => {
    open = await stub(true)
    closed = await stub(false)
    elsewhere = await stub(true, 'http://127.0.0.1:1/graphql')
  })
  afterAll(async () => {
    await open.close()
    await closed.close()
    await elsewhere.close()
  })

  it('is off unless switched on, whatever the URL', async () => {
    delete process.env.DETHEREAL_TRIAGE_LIVE
    process.env.DETHERNETY_URL = open.url
    expect(await livePlatform()).toEqual({ enabled: false, problem: null })
  })

  it('runs on a platform named in DETHERNETY_URL with authentication disabled, asking for no session', async () => {
    process.env.DETHEREAL_TRIAGE_LIVE = '1'
    process.env.DETHERNETY_URL = open.url
    run.mockClear()
    expect(await livePlatform()).toEqual({ enabled: true, problem: null })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses no URL, one with a path, and a platform that requires authentication', async () => {
    process.env.DETHEREAL_TRIAGE_LIVE = '1'
    delete process.env.DETHERNETY_URL
    expect((await livePlatform()).problem).toMatch(/must name the platform/)
    process.env.DETHERNETY_URL = `${open.url}/graphql`
    expect((await livePlatform()).problem).toMatch(/platform origin/)
    process.env.DETHERNETY_URL = `${open.url}?x`
    expect((await livePlatform()).problem).toMatch(/platform origin/)
    process.env.DETHERNETY_URL = 'http://127.0.0.1:1'
    expect((await livePlatform()).problem).toMatch(/^http:\/\/127\.0\.0\.1:1: /)
    process.env.DETHERNETY_URL = closed.url
    status.value = { success: true, data: { authenticated: false, platformUrl: closed.url } }
    expect((await livePlatform()).problem).toMatch(/requires authentication and this HOME holds no live session/)
  })

  it('runs on a platform with authentication when the server holds a live session for that same platform', async () => {
    process.env.DETHEREAL_TRIAGE_LIVE = '1'
    process.env.DETHERNETY_URL = closed.url
    status.value = { success: true, data: { authenticated: true, platformUrl: closed.url } }
    run.mockClear()
    expect(await livePlatform()).toEqual({ enabled: true, problem: null })
    // The server's own check, refreshing an expired session first.
    expect(run).toHaveBeenCalledWith({ verify: true }, expect.anything())
    status.value = { success: true, data: { authenticated: true, platformUrl: closed.url, scopeShortfall: 'models:write' } }
    expect((await livePlatform()).problem).toMatch(/lacks scopes/)
    status.value = { success: true, data: { authenticated: true, platformUrl: open.url } }
    expect((await livePlatform()).problem).toMatch(/no live session/)
    status.value = { success: false, data: { authenticated: false, platformUrl: closed.url } }
    expect((await livePlatform()).problem).toMatch(/no live session/)
  })

  it('refuses a platform whose /config sends GraphQL to another origin', async () => {
    process.env.DETHEREAL_TRIAGE_LIVE = '1'
    process.env.DETHERNETY_URL = elsewhere.url
    expect((await livePlatform()).problem).toMatch(/sends GraphQL to http:\/\/127\.0\.0\.1:1, another platform/)
  })

  it('leaves the config it read for the suite\'s client', async () => {
    process.env.DETHEREAL_TRIAGE_LIVE = '1'
    process.env.DETHERNETY_URL = open.url
    expect(await livePlatform()).toEqual({ enabled: true, problem: null })
    expect(getGraphQLEndpoint()).toBe(`${open.url}/graphql`)
  })

  it('lets a writing suite run only with the same URL named again', async () => {
    process.env.DETHEREAL_TRIAGE_LIVE = '1'
    process.env.DETHERNETY_URL = open.url
    delete process.env.DETHEREAL_TRIAGE_LIVE_WRITE
    expect((await livePlatform({ write: true })).problem).toMatch(/DETHEREAL_TRIAGE_LIVE_WRITE/)
    process.env.DETHEREAL_TRIAGE_LIVE_WRITE = closed.url
    expect((await livePlatform({ write: true })).problem).toMatch(/DETHEREAL_TRIAGE_LIVE_WRITE/)
    process.env.DETHEREAL_TRIAGE_LIVE_WRITE = open.url
    expect(await livePlatform({ write: true })).toEqual({ enabled: true, problem: null })
  })
})
