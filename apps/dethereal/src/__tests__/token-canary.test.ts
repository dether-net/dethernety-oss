/**
 * Canary: the built server, driven over stdio, never lets a session credential out.
 *
 * A real session is seeded in a sandbox HOME and the server is pointed at a hostile
 * platform that echoes the request's `Authorization` header into every GraphQL
 * error and every HTTP 500 body. Every registered tool is then called, and every
 * channel the model or a log can see — `tools/list`, server info, each result and
 * error, stderr with DEBUG on — is scanned for any piece of the seeded credentials.
 *
 * The positive controls matter as much as the scan: the platform must actually
 * have received the bearer, and the echo must actually have come back through a
 * tool result and through stderr, or a clean scan proves nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { randomBytes } from 'crypto'
import { fileURLToPath, pathToFileURL } from 'url'
import { build } from 'tsup'
import { shippedBuild } from '../packaging/shipped-build.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const ECHO = 'CANARY-ECHO'
const EMAIL = 'canary@example.test'

/** An unsigned JWT carrying `claims`. */
function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.`
}

// Opaque access and refresh tokens: only the exact-value registry can catch them,
// so a clean scan proves registration works rather than a JWT-shaped pattern.
const ACCESS = `canary-access-${randomBytes(16).toString('hex')}`
const REFRESH = `canary-refresh-${randomBytes(16).toString('hex')}`
const ID = jwt({ email: EMAIL, nonce: randomBytes(8).toString('hex') })

/** Every substring whose appearance anywhere would be a leak. */
const NEEDLES = [
  ACCESS,
  ACCESS.slice(10, 26),
  REFRESH,
  REFRESH.slice(12, 28),
  ...ID.split('.').filter((segment) => segment.length > 0),
]

interface Platform {
  url: string
  server: Server
  /** `Authorization` headers the GraphQL endpoint received, in order. */
  bearers: string[]
  graphqlRequests: number
  /** 'alternate' by request count; 'graphql' forces the form a tool result carries back. */
  echoForm: 'alternate' | 'graphql'
}

async function startHostilePlatform(): Promise<Platform> {
  const platform = { bearers: [] as string[], graphqlRequests: 0, echoForm: 'alternate' } as Platform
  platform.server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/config') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          oidcIssuer: 'https://issuer.canary.invalid',
          oidcClientId: 'canary-client',
          // Nothing may ever reach a real identity provider from this test.
          oidcDomain: 'auth.canary.invalid',
          oidcRedirectUri: 'https://app.canary.invalid/callback',
          oidcProvider: 'generic',
          graphqlUrl: `${platform.url}/graphql`,
          graphqlWsUrl: `${platform.url}/graphql`,
          subscriptionTransport: 'sse',
          appUrl: platform.url,
          appBaseUrl: '/',
          apiBaseUrl: '',
        })
      )
      return
    }
    if (req.url?.startsWith('/graphql')) {
      req.resume()
      req.on('end', () => {
        const auth = String(req.headers.authorization ?? '')
        platform.bearers.push(auth)
        platform.graphqlRequests += 1
        // Alternate the two ways a platform can echo: a GraphQL error message,
        // and an HTTP error body. The echo text avoids words the GraphQL layer
        // treats as transient (it would retry with backoff).
        const echo = `${ECHO} saw ${auth}`
        if (platform.echoForm === 'graphql' || platform.graphqlRequests % 2 === 1) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ data: null, errors: [{ message: echo, extensions: { authorization: auth } }] }))
        } else {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain')
          res.end(echo)
        }
      })
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => platform.server.listen(0, '127.0.0.1', resolve))
  platform.url = `http://127.0.0.1:${(platform.server.address() as AddressInfo).port}`
  return platform
}

interface Session {
  client: Client
  stderr: () => string
  close: () => Promise<void>
}

interface Sandbox {
  home: string
  cwd: string
  browserMarker: string
  preload: string
}

/**
 * A preload for the server process: any start of a browser launcher (by any
 * path, through any child_process function) leaves a marker and fails, before a
 * process starts. Git and every other program run as usual.
 */
function launcherTrap(marker: string): string {
  return `import cp from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const LAUNCHERS = new Set(['open', 'xdg-open', 'rundll32.exe', 'rundll32'])
const isLauncher = (file) => typeof file === 'string' && LAUNCHERS.has(file.split(/[\\\\/]/).pop().toLowerCase())
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const original = cp[name]
  cp[name] = function (file, ...rest) {
    const cmd = typeof file === 'string' ? file.trim().split(/\\s+/)[0] : file
    if (isLauncher(file) || isLauncher(cmd)) {
      fs.writeFileSync(${JSON.stringify(marker)}, 'launched')
      throw Object.assign(new Error('launcher refused'), { code: 'ENOENT' })
    }
    return original.call(this, file, ...rest)
  }
}
syncBuiltinESMExports()
`
}

/**
 * A sandbox under `root`. The preload is test tooling, so it sits with the built server under
 * `node_modules` (`toolDir`): the server refuses a preload from a temporary directory or the project,
 * where an agent could have written one.
 */
async function makeSandbox(root: string, name: string, toolDir: string): Promise<Sandbox> {
  const home = path.join(root, name, 'home')
  const cwd = path.join(root, name, 'project')
  const browserMarker = path.join(root, name, 'browser-opened')
  const preload = path.join(toolDir, `launcher-trap-${name}.mjs`)
  await mkdir(path.join(home, '.dethernety'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  // A browser launch is a failure here: login must be served from the stored session.
  await writeFile(preload, launcherTrap(browserMarker))
  return { home, cwd, browserMarker, preload }
}

/** A one-component model, so the settle call gets past the store and records its item. */
async function writeSettleModel(sandbox: Sandbox): Promise<void> {
  const dir = path.join(sandbox.cwd, 'canary-settle')
  await mkdir(path.join(dir, 'attributes', 'components'), { recursive: true })
  const component = { id: 'canary-element', name: 'Canary', type: 'PROCESS', positionX: 0, positionY: 0 }
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'canary settle' }))
  await writeFile(path.join(dir, 'structure.json'), JSON.stringify({ defaultBoundary: { id: 'canary-root', name: 'root', components: [component], boundaries: [] } }))
  await writeFile(path.join(dir, 'dataflows.json'), '[]')
  await writeFile(path.join(dir, 'data-items.json'), '[]')
  await writeFile(path.join(dir, 'attributes', 'components', 'canary-element.json'),
    JSON.stringify({ elementId: 'canary-element', elementName: 'Canary', elementType: 'PROCESS', attributes: { authentication_type: 'canary value' } }))
}

async function writeStore(sandbox: Sandbox, content: string): Promise<void> {
  await writeFile(path.join(sandbox.home, '.dethernety', 'tokens.json'), content, { mode: 0o600 })
}

function storeWith(platformUrl: string, record: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, tokens: { [new URL(platformUrl).origin]: record } })
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accessToken: ACCESS,
    idToken: ID,
    refreshToken: REFRESH,
    grantedScope: 'openid profile email',
    expiresAt: Date.now() + 3600_000,
    baseUrl: '',
    storedAt: Date.now(),
    issuedAt: Date.now(),
    ...overrides,
  }
}

async function connect(entry: string, sandbox: Sandbox, platformUrl: string): Promise<Session> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', pathToFileURL(sandbox.preload).href, entry],
    cwd: sandbox.cwd,
    // A minimal environment: nothing from the developer's shell leaks in.
    env: {
      HOME: sandbox.home,
      PATH: process.env.PATH ?? '',
      // The temporary directory as this system names it, so the server's checks see the same places on every OS.
      TMPDIR: tmpdir(),
      DETHERNETY_URL: platformUrl,
      DEBUG: 'true',
      // Placeholders for planned tools are listed and called too.
      DETHEREAL_REGISTER_STUBS: '1',
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const client = new Client({ name: 'token-canary', version: '0.0.0' })
  await client.connect(transport)
  return { client, stderr: () => stderr, close: () => client.close() }
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('\n')
}

function leaksIn(label: string, text: string): string[] {
  return NEEDLES.filter((needle) => text.includes(needle)).map((needle) => `${label}: ${needle.slice(0, 12)}…`)
}

/** Arguments that let each tool get as far as the platform. */
const ARGS: Record<string, Record<string, unknown>> = {
  login: {},
  auth_status: { verify: true },
  validate_model_json: { action: 'quality', assets: 'full', model_id: 'canary-model' },
  import_model: { directory_path: 'canary-model' },
  export_model: { model_id: 'canary-model', directory_path: 'canary-export' },
  update_model: { model_id: 'canary-model', directory_path: 'canary-model' },
  create_threat_model: { model: { name: 'Canary' } },
  update_attributes: { model_id: 'canary-model', directory_path: 'canary-model' },
  search_mitre_attack: { action: 'tactics' },
  get_mitre_defend: { action: 'tactics' },
  // The manage tools keep only their write actions; reading is the query_* tools'.
  manage_controls: { action: 'delete', control_id: 'canary-control' },
  manage_countermeasures: { action: 'delete', countermeasure_id: 'canary-countermeasure' },
  manage_analyses: { action: 'list', element_id: 'canary-element' },
  query_controls: { action: 'list', folder_id: 'all' },
  query_exposures: { action: 'list', element_id: 'canary-element' },
  query_countermeasures: { action: 'list', control_id: 'canary-control' },
  generate_attribute_stubs: { directory_path: 'canary-model' },
  get_classes: { fields: ['id', 'name', 'module'] },
  match_classes: { elements: [{ name: 'web server', description: 'nginx reverse proxy' }], classLabel: 'COMPONENT', topN: 1 },
  get_control_gaps: { model_id: 'canary-model', top_n: 1, limit: 1 },
  // Local tools: no platform call, but their results and errors are scanned all the same.
  detect_drift: { directory_path: 'canary-model' },
  model_state: { action: 'get', directory_path: 'canary-model' },
  model_state_waive: { directory_path: 'canary-model', criterion: 'C3', element_ids: ['canary-element'], reason: 'canary waiver reason', basis: 'not_applicable' },
  model_state_prune: { directory_path: 'canary-settle', files: ['attributes/components/canary-gone.json'] },
  model_state_settle: { action: 'settle', directory_path: 'canary-settle', reply: 'canary settle reply', items: [{ group: 'components', element_id: 'canary-element', field: 'authentication_type', decision: 'confirm', value: 'canary value' }] },
}

/** Tools that must have reached the hostile platform, or the echo channel was never exercised. */
const MUST_REACH_PLATFORM = ['list_models', 'get_classes', 'search_mitre_attack', 'manage_controls', 'export_model', 'query_controls']

describe('token canary (built server over stdio)', () => {
  let root: string
  let entry: string
  let platform: Platform

  beforeAll(async () => {
    const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
    await mkdir(cacheDir, { recursive: true })
    // Unique per run: parallel sessions share this checkout.
    const outDir = await mkdtemp(path.join(cacheDir, 'dethereal-canary-'))
    await build({
      config: false,
      entry: { index: path.join(pkgRoot, 'src', 'index.ts') },
      ...shippedBuild,
      outDir,
      clean: false,
      silent: true,
    })
    entry = path.join(outDir, 'index.js')
    expect(existsSync(entry)).toBe(true)
    root = await mkdtemp(path.join(tmpdir(), 'dethereal-canary-'))
    platform = await startHostilePlatform()
  }, 120_000)

  afterAll(async () => {
    await new Promise<void>((resolve) => platform?.server.close(() => resolve()))
    if (root) await rm(root, { recursive: true, force: true })
    if (entry) await rm(path.dirname(entry), { recursive: true, force: true })
  })

  it('no credential reaches any tool result, error, listing or stderr', async () => {
    const sandbox = await makeSandbox(root, 'live', path.dirname(entry))
    await writeStore(sandbox, storeWith(platform.url, session({ baseUrl: platform.url })))
    await writeSettleModel(sandbox)
    const s = await connect(entry, sandbox, platform.url)
    const leaks: string[] = []
    const reached: string[] = []
    try {
      leaks.push(...leaksIn('server info', JSON.stringify(s.client.getServerVersion() ?? {})))
      const { tools } = await s.client.listTools()
      leaks.push(...leaksIn('tools/list', JSON.stringify(tools)))
      expect(tools.map((t) => t.name)).toContain('auth_status')
      expect(tools.map((t) => t.name)).not.toContain('refresh_token')

      // Positive control: the seeded session is live and attributed.
      const statusText = textOf(await s.client.callTool({ name: 'auth_status', arguments: {} }))
      const status = JSON.parse(statusText)
      expect(status).toMatchObject({ authenticated: true, email: EMAIL, pending: false })

      // Positive control: a platform call's result carries the platform's echo of the bearer, scrubbed.
      // Only the GraphQL-error form reaches a tool result, so it is forced for this call: which tools the
      // alternation hands that form depends on every request before them, and under load that count moves.
      platform.echoForm = 'graphql'
      const control = textOf(await s.client.callTool({ name: 'list_models', arguments: {} }))
      platform.echoForm = 'alternate'
      leaks.push(...leaksIn('list_models (control)', control))
      expect(control).toContain(ECHO)
      expect(control).toContain('[redacted]')

      // login last-but-one, logout last: both touch the store the others read.
      const names = tools.map((t) => t.name).filter((n) => n !== 'login' && n !== 'logout')
      for (const name of [...names, 'login', 'logout']) {
        const before = platform.graphqlRequests
        const result = await s.client.callTool({ name, arguments: ARGS[name] ?? {} })
        const text = textOf(result)
        if (platform.graphqlRequests > before) reached.push(name)
        leaks.push(...leaksIn(name, text))
        if (text.includes('tokens.json') || text.includes(sandbox.home)) leaks.push(`${name}: token store path`)
        if (name === 'model_state_settle') {
          // Past the schema and the store: the item was recorded.
          expect(JSON.parse(text)).toMatchObject({ recorded: 1, decisions: { confirm: 1 } })
        }
        if (name === 'login') {
          expect(JSON.parse(text)).toMatchObject({ fromCache: true, email: EMAIL })
        }
      }
    } finally {
      await s.close()
    }
    leaks.push(...leaksIn('stderr', s.stderr()))

    // The platform really was sent the bearer, so every echo carried it.
    expect(platform.bearers.length).toBeGreaterThan(0)
    expect(platform.bearers.every((b) => b === `Bearer ${ACCESS}`)).toBe(true)
    expect(reached).toEqual(expect.arrayContaining(MUST_REACH_PLATFORM))
    // The echo also came back through stderr, scrubbed (the tool-result channel is the control above).
    expect(s.stderr()).toContain('[redacted]')
    expect(existsSync(sandbox.browserMarker)).toBe(false)
    expect(leaks).toEqual([])
  }, 120_000)

  // Doctor starts the installed server and reads auth_status: its result and its report show who is signed in, never a credential.
  it('doctor\'s server probe and report carry no credential, and a DEBUG it is handed never reaches the server', async () => {
    const sandbox = await makeSandbox(root, 'doctor', path.dirname(entry))
    await writeStore(sandbox, storeWith(platform.url, session({ baseUrl: platform.url })))
    const { probeServer } = await import('../installer/core/server-probe.js')
    const { probeChecks } = await import('../installer/doctor/index.js')
    // A node the test owns: the runner's own may sit in a group-writable cache.
    const node = path.join(root, 'doctor-node')
    await writeFile(node, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 })
    const env = { home: sandbox.home, vars: {}, euid: process.geteuid!(), platform: process.platform }
    // The probe starts only a server's dist/index.js.
    const served = path.join(root, 'doctor-server')
    await mkdir(served, { recursive: true })
    await symlink(path.dirname(entry), path.join(served, 'dist'))
    const r = await probeServer({ node, entry: path.join(served, 'dist', 'index.js'), cwd: sandbox.cwd, env: { HOME: sandbox.home, PATH: process.env.PATH ?? '', DETHERNETY_URL: platform.url, DEBUG: 'true' } }, env)
    // Positive control: the server read the session and says whose it is.
    expect(r.auth).toMatchObject({ authenticated: true, email: EMAIL })
    const report = JSON.stringify([r, probeChecks('doctor', r, null)])
    expect(leaksIn('doctor', report)).toEqual([])
    expect(report).not.toContain('tokens.json')
    expect(report).not.toContain(sandbox.home)
  }, 60_000)

  it('auth_status does not refresh an expired session unless asked', async () => {
    const sandbox = await makeSandbox(root, 'expired', path.dirname(entry))
    await writeStore(sandbox, storeWith(platform.url, session({ baseUrl: platform.url, expiresAt: Date.now() - 60_000 })))
    const s = await connect(entry, sandbox, platform.url)
    try {
      const status = JSON.parse(textOf(await s.client.callTool({ name: 'auth_status', arguments: {} })))
      expect(status.authenticated).toBe(false)
      expect(status.detail).toMatch(/verify: true/)
    } finally {
      await s.close()
    }
    expect(s.stderr()).not.toMatch(/transparent refresh|attempting refresh/i)
    expect(leaksIn('stderr', s.stderr())).toEqual([])
  }, 60_000)

  it.each([
    ['truncated JSON', (url: string) => storeWith(url, session({ baseUrl: url })).slice(0, 120)],
    ['wrongly typed fields', (url: string) => storeWith(url, session({ baseUrl: url, expiresAt: 'later', refreshToken: 42 }))],
    ['wrong top-level shape', () => JSON.stringify({ version: 1, tokens: null, leaked: ACCESS })],
  ])('a malformed store (%s) reads as signed out and is never echoed', async (label, content) => {
    const sandbox = await makeSandbox(root, `malformed-${label.replace(/\W+/g, '-')}`, path.dirname(entry))
    await writeStore(sandbox, content(platform.url))
    const s = await connect(entry, sandbox, platform.url)
    const leaks: string[] = []
    try {
      const statusText = textOf(await s.client.callTool({ name: 'auth_status', arguments: { verify: true } }))
      leaks.push(...leaksIn('auth_status', statusText))
      expect(JSON.parse(statusText).authenticated).toBe(false)
      const listText = textOf(await s.client.callTool({ name: 'list_models', arguments: {} }))
      leaks.push(...leaksIn('list_models', listText))
    } finally {
      await s.close()
    }
    leaks.push(...leaksIn('stderr', s.stderr()))
    expect(leaks).toEqual([])
  }, 60_000)
})
