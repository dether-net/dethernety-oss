/**
 * Startup: the built server, driven over stdio, answers the handshake without
 * waiting for the platform, resolves the project root wherever it is launched, and
 * turns an unreachable platform or an unusable URL into tool errors — never into a
 * missing server.
 *
 * The platform here accepts connections and never answers, on an ephemeral port.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import net from 'node:net'
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { shippedBuild } from '../packaging/shipped-build.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { PLATFORM_CONFIG_TIMEOUT_MS } from '../auth/platform-config.js'
import { manifestTool } from '../tools/manifest.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

interface Hanging {
  url: string
  connections: () => number
  close: () => Promise<void>
}

async function hangingPlatform(): Promise<Hanging> {
  const sockets = new Set<net.Socket>()
  let count = 0
  const server = net.createServer((socket) => {
    count += 1
    sockets.add(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    connections: () => count,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}

interface Session {
  client: Client
  stderr: () => string
  errors: Error[]
  handshakeMs: number
  close: () => Promise<void>
}

async function start(entry: string, cwd: string, home: string, env: Record<string, string>): Promise<Session> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd,
    // A minimal environment: nothing from the developer's shell leaks in.
    env: { HOME: home, PATH: process.env.PATH ?? '', DEBUG: 'true', ...env },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const client = new Client({ name: 'startup-test', version: '0.0.0' })
  // Anything on stdout that is not JSON-RPC surfaces here.
  const errors: Error[] = []
  client.onerror = (error) => errors.push(error)
  const t0 = Date.now()
  await client.connect(transport)
  await client.listTools()
  const handshakeMs = Date.now() - t0
  return { client, stderr: () => stderr, errors, handshakeMs, close: () => client.close() }
}

function resultOf(result: unknown): { isError: boolean; body: Record<string, unknown>; text: string } {
  const r = result as { isError?: boolean; content?: { text?: string }[] }
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n')
  return { isError: r.isError === true, body: JSON.parse(text), text }
}

describe('startup (built server over stdio)', () => {
  let entry: string
  let root: string
  let home: string
  let project: string
  let launchDir: string
  let platform: Hanging

  beforeAll(async () => {
    const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
    await mkdir(cacheDir, { recursive: true })
    // Unique per run: parallel sessions share this checkout.
    const outDir = await mkdtemp(path.join(cacheDir, 'dethereal-startup-'))
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

    root = await realpath(await mkdtemp(path.join(tmpdir(), 'dethereal-startup-')))
    home = path.join(root, 'home')
    project = path.join(root, 'project')
    launchDir = path.join(project, 'src', 'deep')
    await mkdir(home, { recursive: true })
    await mkdir(path.join(project, '.dethernety'), { recursive: true })
    await mkdir(launchDir, { recursive: true })
    platform = await hangingPlatform()
  }, 120_000)

  afterAll(async () => {
    await platform?.close()
    if (root) await rm(root, { recursive: true, force: true })
    if (entry) await rm(path.dirname(entry), { recursive: true, force: true })
  })

  it('answers the handshake at once with an unreachable platform and reports the project root', async () => {
    const s = await start(entry, launchDir, home, { DETHERNETY_URL: platform.url })
    try {
      expect(s.handshakeMs).toBeLessThan(2_000)

      const status = resultOf(await s.client.callTool({ name: 'auth_status', arguments: {} }))
      expect(status.body).toMatchObject({ projectRoot: project, urlSource: 'env', platformUrl: platform.url })

      // A platform tool waits for the bounded config fetch, then fails as a tool error.
      const t0 = Date.now()
      const listed = resultOf(await s.client.callTool({ name: 'list_models', arguments: {} }))
      expect(Date.now() - t0).toBeLessThan(PLATFORM_CONFIG_TIMEOUT_MS + 2_000)
      expect(listed.isError).toBe(true)

      // The background load has failed by now; the server must still be serving.
      const waitUntil = t0 + 2 * PLATFORM_CONFIG_TIMEOUT_MS + 500
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitUntil - Date.now())))
      const { tools } = await s.client.listTools()
      expect(tools.map((t) => t.name)).toContain('auth_status')
    } finally {
      await s.close()
    }
    expect(s.stderr()).toMatch(/Platform config not loaded yet/)
    expect(s.stderr()).not.toMatch(/Fatal/)
    expect(s.errors).toEqual([])
  }, 60_000)

  it('refuses a platform URL with userinfo at startup, without quoting it or connecting', async () => {
    const withUserinfo = platform.url.replace('http://', 'http://someone:hunter2@')
    const s = await start(entry, launchDir, home, { DETHERNETY_URL: withUserinfo })
    try {
      const listed = resultOf(await s.client.callTool({ name: 'list_models', arguments: {} }))
      expect(listed.isError).toBe(true)
      expect(listed.text).toMatch(/must not contain a user name or password/)
      expect(listed.text).not.toMatch(/hunter2|someone/)
    } finally {
      await s.close()
    }
    expect(s.stderr()).toMatch(/must not contain a user name or password/)
    expect(s.stderr()).not.toMatch(/hunter2|someone|Fatal/)
    expect(s.errors).toEqual([])
  }, 60_000)

  it('lists the interaction hint on exactly the tools whose manifest entry requires the user', async () => {
    const s = await start(entry, launchDir, home, { DETHERNETY_URL: platform.url })
    try {
      const { tools } = await s.client.listTools()
      const flagged = tools.filter((t) => manifestTool(t.name)?.requiresUser === true)
      expect(flagged.map((t) => t.name)).toEqual(
        expect.arrayContaining(['model_state_waive', 'import_model', 'update_model', 'update_attributes', 'create_threat_model'])
      )
      for (const t of tools) {
        if (flagged.includes(t)) expect(t._meta).toEqual({ 'anthropic/requiresUserInteraction': true })
        else expect(t._meta).toBeUndefined()
      }
    } finally {
      await s.close()
    }
    expect(s.errors).toEqual([])
  }, 30_000)

  it('records the quality result itself, and status reads the score from it', async () => {
    const { gateModel, writeGateModel } = await import('../utils/__tests__/fixtures/gate-model.js')
    const dir = path.join(project, 'models', 'quality-probe')
    await writeGateModel(dir, gateModel())
    const s = await start(entry, launchDir, home, { DETHERNETY_URL: platform.url })
    try {
      const q = resultOf(await s.client.callTool({ name: 'validate_model_json', arguments: { action: 'quality', directory_path: dir } }))
      expect(q.body).toMatchObject({ quality_recorded: true })
      const recorded = JSON.parse(await readFile(path.join(dir, '.dethereal', 'quality.json'), 'utf8'))
      expect(recorded.quality_score).toBe(q.body.quality_score)
      const status = resultOf(await s.client.callTool({ name: 'workspace_status', arguments: { directory_path: dir } }))
      expect((status.body as { model?: { qualityScore?: number } }).model?.qualityScore).toBe(Math.round(recorded.quality_score))
    } finally {
      await s.close()
      await rm(path.join(project, 'models'), { recursive: true, force: true })
    }
    expect(s.errors).toEqual([])
  }, 30_000)

  it('treats an unexpanded shell placeholder as unset and uses the plugin user config', async () => {
    const s = await start(entry, launchDir, home, {
      DETHERNETY_URL: '${DETHERNETY_URL}',
      DETHERNETY_PLATFORM_URL: platform.url,
    })
    try {
      const status = resultOf(await s.client.callTool({ name: 'auth_status', arguments: {} }))
      expect(status.body).toMatchObject({ urlSource: 'user_config', platformUrl: platform.url })
    } finally {
      await s.close()
    }
    expect(s.errors).toEqual([])
  }, 30_000)

  it('starts with an unusable URL, reports it from every tool, and never connects', async () => {
    const before = platform.connections()
    const port = new URL(platform.url).port
    const s = await start(entry, launchDir, home, { DETHERNETY_URL: `http://localhost.:${port}` })
    try {
      for (const name of ['list_models', 'login']) {
        const r = resultOf(await s.client.callTool({ name, arguments: {} }))
        expect(r.isError).toBe(true)
        expect(r.body).toMatchObject({ error: 'Configuration error' })
        expect(r.body.message).toMatch(/DETHERNETY_URL must use HTTPS/)
      }
      // Signing out stays possible: the local session goes, and nothing is sent.
      const out = resultOf(await s.client.callTool({ name: 'logout', arguments: {} }))
      expect(out.isError).toBeFalsy()
      expect(out.body.message).toMatch(/^Signed out/)
      const status = resultOf(await s.client.callTool({ name: 'auth_status', arguments: { verify: true } }))
      expect(status.body.detail).toMatch(/^configuration error: /)
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      await s.close()
    }
    expect(platform.connections()).toBe(before)
    expect(s.errors).toEqual([])
  }, 30_000)

  it('refuses the network in a runtime that cannot be trusted with the session, and still signs out', async () => {
    const before = platform.connections()
    const s = await start(entry, launchDir, home, { DETHERNETY_URL: platform.url, NODE_TLS_REJECT_UNAUTHORIZED: '0' })
    try {
      const r = resultOf(await s.client.callTool({ name: 'list_models', arguments: {} }))
      expect(r.isError).toBe(true)
      expect(r.body).toMatchObject({ error: 'Configuration error' })
      expect(r.body.message).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/)
      const out = resultOf(await s.client.callTool({ name: 'logout', arguments: {} }))
      expect(out.isError).toBeFalsy()
      const status = resultOf(await s.client.callTool({ name: 'workspace_status', arguments: {} }))
      expect(JSON.stringify(status.body)).toMatch(/untrusted_runtime/)
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      await s.close()
    }
    // No background /config fetch, no call: nothing reached the platform.
    expect(platform.connections()).toBe(before)
  }, 30_000)

  it('exits when the harness closes stdin, instead of lingering', async () => {
    const child = spawn(process.execPath, [entry], {
      cwd: launchDir,
      env: { HOME: home, PATH: process.env.PATH ?? '', DETHERNETY_URL: platform.url },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    await new Promise((r) => setTimeout(r, 500))
    const t0 = Date.now()
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
    child.stdin.end()
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    const code = await exited
    clearTimeout(timer)
    expect(code).toBe(0)
    expect(Date.now() - t0).toBeLessThan(3000)
  }, 30_000)

  it('reports a refused project root instead of confining to the home directory', async () => {
    const s = await start(entry, home, home, { DETHERNETY_URL: platform.url })
    try {
      const status = resultOf(await s.client.callTool({ name: 'auth_status', arguments: {} }))
      expect(status.body.projectRoot).toBeNull()
      expect(status.body.projectRootDetail).toMatch(/^refused: /)
      expect(status.text).not.toContain(home)
    } finally {
      await s.close()
    }
  }, 30_000)
})
