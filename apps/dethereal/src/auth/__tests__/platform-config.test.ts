/**
 * The platform /config request: bounded in time, refused before any connection when
 * the URL may not be used, and never quoting URL userinfo back.
 *
 * Every platform here is a local server on an ephemeral port.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import http from 'node:http'
import {
  fetchPlatformConfig,
  clearPlatformConfigCache,
  getGraphQLEndpoint,
  PLATFORM_CONFIG_TIMEOUT_MS,
  type PlatformConfig,
} from '../platform-config.js'

interface Listening {
  url: string
  connections: () => number
  close: () => Promise<void>
}

/** A TCP server that accepts connections and never answers. */
async function hangingPlatform(): Promise<Listening> {
  const sockets = new Set<net.Socket>()
  let count = 0
  const server = net.createServer((socket) => {
    count += 1
    sockets.add(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => count,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}

/** An HTTP server answering /config with `body`, or sending headers and then stalling the body. */
async function httpPlatform(body: Record<string, unknown> | 'stall'): Promise<Listening> {
  let count = 0
  const server = http.createServer((_req, res) => {
    count += 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (body === 'stall') res.write('{"oidcClientId":')
    else res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => count,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

const CONFIG: Record<string, unknown> = {
  oidcIssuer: 'https://issuer.invalid',
  oidcClientId: 'client',
  oidcDomain: 'auth.invalid',
  oidcRedirectUri: 'https://app.invalid/cb',
  oidcProvider: 'cognito',
  graphqlUrl: '/graphql',
  graphqlWsUrl: '',
  subscriptionTransport: 'sse',
  appUrl: '',
  appBaseUrl: '/',
  apiBaseUrl: '',
}

async function elapsed<T>(p: Promise<T>): Promise<{ ms: number; error?: Error }> {
  const t0 = Date.now()
  const error = await p.then(() => undefined, (e: Error) => e)
  return { ms: Date.now() - t0, error }
}

describe('fetchPlatformConfig', () => {
  const savedUrl = process.env.DETHERNETY_URL
  let platform: Listening | undefined

  beforeEach(() => clearPlatformConfigCache())
  afterEach(async () => {
    await platform?.close()
    platform = undefined
    if (savedUrl === undefined) delete process.env.DETHERNETY_URL
    else process.env.DETHERNETY_URL = savedUrl
  })

  it('is bounded at a few seconds by default', () => {
    expect(PLATFORM_CONFIG_TIMEOUT_MS).toBe(3_000)
  })

  it('gives up on a platform that accepts and never answers', async () => {
    platform = await hangingPlatform()
    const { ms, error } = await elapsed(fetchPlatformConfig(platform.url, { timeoutMs: 200 }))
    expect(error?.message).toMatch(/Failed to fetch platform config/)
    expect(ms).toBeLessThan(2_000)
    expect(platform.connections()).toBe(1)
  })

  it('gives up on a response whose body stalls', async () => {
    platform = await httpPlatform('stall')
    const { ms, error } = await elapsed(fetchPlatformConfig(platform.url, { timeoutMs: 200 }))
    expect(error).toBeDefined()
    expect(ms).toBeLessThan(2_000)
  })

  it('stops at the caller signal when it fires first', async () => {
    platform = await hangingPlatform()
    const { ms, error } = await elapsed(
      fetchPlatformConfig(platform.url, { timeoutMs: 10_000, signal: AbortSignal.timeout(100) })
    )
    expect(error).toBeDefined()
    expect(ms).toBeLessThan(2_000)
  })

  it('stops at once for a caller signal that has already fired', async () => {
    platform = await hangingPlatform()
    const controller = new AbortController()
    controller.abort()
    const { ms, error } = await elapsed(fetchPlatformConfig(platform.url, { timeoutMs: 10_000, signal: controller.signal }))
    expect(error).toBeDefined()
    expect(ms).toBeLessThan(500)
  })

  it('loads and caches a reachable platform', async () => {
    platform = await httpPlatform(CONFIG)
    const first = await fetchPlatformConfig(platform.url)
    const second = await fetchPlatformConfig(platform.url)
    expect(second).toBe(first)
    expect(platform.connections()).toBe(1)
  })

  it('refuses a URL the HTTPS rule rejects before connecting', async () => {
    platform = await hangingPlatform()
    const port = new URL(platform.url).port
    // `localhost.` reaches the loopback interface but is not a loopback name.
    process.env.DETHERNETY_URL = `http://localhost.:${port}`
    await expect(fetchPlatformConfig()).rejects.toThrow(/HTTPS/)
    await expect(fetchPlatformConfig(`http://localhost.:${port}`)).rejects.toThrow(/HTTPS/)
    expect(platform.connections()).toBe(0)
  })

  it('refuses URL userinfo before connecting, and never quotes it', async () => {
    platform = await hangingPlatform()
    const withUserinfo = platform.url.replace('http://', 'http://someone:hunter2@')
    const { error } = await elapsed(fetchPlatformConfig(withUserinfo, { timeoutMs: 100 }))
    expect(error?.message).toMatch(/must not contain a user name or password/)
    expect(error?.message).not.toMatch(/hunter2|someone/)
    expect(platform.connections()).toBe(0)
  })
})

describe('getGraphQLEndpoint', () => {
  const platform = (overrides: Record<string, unknown>) => ({ ...CONFIG, ...overrides }) as unknown as PlatformConfig

  it('refuses a plain-HTTP remote endpoint named by the platform', () => {
    expect(() => getGraphQLEndpoint(platform({ graphqlUrl: 'http://example.com/graphql' }))).toThrow(/HTTPS/)
    expect(() => getGraphQLEndpoint(platform({ apiBaseUrl: 'http://example.com' }))).toThrow(/HTTPS/)
  })

  it('accepts HTTPS and loopback endpoints', () => {
    expect(getGraphQLEndpoint(platform({ graphqlUrl: 'https://api.example.com/graphql' }))).toBe(
      'https://api.example.com/graphql'
    )
    expect(getGraphQLEndpoint(platform({ apiBaseUrl: 'http://127.0.0.1:3003' }))).toBe('http://127.0.0.1:3003/graphql')
  })
})
