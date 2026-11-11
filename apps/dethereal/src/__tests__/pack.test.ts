/**
 * The packed package, as npm would publish it, loaded by Claude Code.
 *
 * Packs the package for real (its prepack regenerates the plugin root and builds the server),
 * extracts the tarball, and checks what a user would get: the size, the file contract, the
 * version everywhere it is stated, and Claude Code itself validating, listing and loading the
 * plugin from the extracted root, in a fresh home with no sign-in. Then the server's cold start
 * and the post-write hook's latency, on the packed build.
 *
 * It needs the `claude` CLI on PATH and rebuilds dist/, so it runs only with DETHEREAL_PACK_TEST=1.
 * No step reaches a model: the session that counts the plugin's agents has no credentials, and
 * the agents are counted from its debug log before it stops.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { name: string; version: string; files: string[] }

const MAX_TARBALL_BYTES = 3 * 1024 * 1024
const MAX_COLD_START_MS = 1500
const MAX_HOOK_P95_MS = 100
const UNREACHABLE = 'http://127.0.0.1:9'

describe.skipIf(process.env.DETHEREAL_PACK_TEST !== '1')('the packed package', () => {
  let tmp: string
  let tarball: string
  let root: string
  let home: string

  /**
   * Only what the CLI needs: no credentials, no inherited configuration, no traffic that is not
   * needed, and a model endpoint that cannot be reached, should a sign-in be found elsewhere.
   */
  const env = () => ({
    HOME: home, PATH: process.env.PATH ?? '', TMPDIR: tmp, DETHERNETY_URL: UNREACHABLE,
    ANTHROPIC_BASE_URL: UNREACHABLE, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
  })
  const claude = (args: string[]) => spawnSync('claude', args, { cwd: tmp, env: env(), encoding: 'utf8', timeout: 60_000 })

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-pack-')))
    home = path.join(tmp, 'home')
    fs.mkdirSync(home, { mode: 0o700 })
    // Pack with the pnpm running these tests, and let prepack's own pnpm calls reach the same one: a
    // `pnpm` on PATH may be a version manager's shim that resolves another version, or none.
    let packEnv = process.env
    const runner = process.env.npm_execpath
    if (runner && /pnpm/.test(path.basename(runner))) {
      const bin = path.join(tmp, 'bin')
      fs.mkdirSync(bin)
      fs.writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(runner)} "$@"\n`, { mode: 0o755 })
      packEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
    }
    const out = execFileSync('pnpm', ['pack', '--pack-destination', tmp], { cwd: pkgRoot, env: packEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    tarball = path.join(tmp, path.basename(out.trim().split('\n').pop()!))
    fs.mkdirSync(path.join(tmp, 'x'))
    execFileSync('tar', ['-xzf', tarball, '-C', path.join(tmp, 'x')])
    root = path.join(tmp, 'x', 'package')
  }, 300_000)

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('is small enough', () => {
    expect(fs.statSync(tarball).size).toBeLessThanOrEqual(MAX_TARBALL_BYTES)
  })

  it('holds the files contract and states one version', () => {
    // pnpm adds the workspace's LICENSE when the package has none of its own.
    expect(fs.readdirSync(root).sort()).toEqual(['.claude-plugin', 'LICENSE', 'bundles', 'dist', 'package.json', 'src'].sort())
    expect(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')).toMatch(/GNU AFFERO GENERAL PUBLIC LICENSE/)
    expect(fs.readdirSync(path.join(root, 'bundles')).sort()).toEqual(['claude', 'codex', 'opencode'])
    expect(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version).toBe(pkg.version)
    for (const harness of ['claude', 'codex', 'opencode']) {
      expect(JSON.parse(fs.readFileSync(path.join(root, 'bundles', harness, 'bundle.json'), 'utf8')).version, harness).toBe(pkg.version)
    }
    expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version).toBe(pkg.version)
  })

  it('references only files it holds', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>
    const named = [...(manifest.skills as string[]), ...(manifest.agents as string[]), manifest.hooks as string, manifest.mcpServers as string]
    for (const p of named) expect(fs.existsSync(path.join(root, p)), p).toBe(true)
    const commands = JSON.stringify([
      JSON.parse(fs.readFileSync(path.join(root, manifest.hooks as string), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(root, manifest.mcpServers as string), 'utf8')),
    ])
    const paths = [...commands.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)].map((m) => m[1]!)
    expect(paths.length).toBeGreaterThan(0)
    for (const p of new Set(paths)) expect(fs.existsSync(path.join(root, p)), p).toBe(true)
  })

  it('validates as a Claude Code plugin', () => {
    const r = claude(['plugin', 'validate', root, '--json'])
    expect(r.status, r.stderr).toBe(0)
    const result = JSON.parse(r.stdout) as { success: boolean; errors?: unknown[] }
    expect(result.success).toBe(true)
    expect(result.errors ?? []).toEqual([])
  })

  it('is listed, enabled, at the package version', () => {
    const r = claude(['--plugin-dir', root, 'plugin', 'list', '--json'])
    expect(r.status, r.stderr).toBe(0)
    const listed = (JSON.parse(r.stdout) as Array<{ id: string; version: string; enabled: boolean }>).filter((p) => p.id.startsWith('dethereal@'))
    expect(listed).toEqual([expect.objectContaining({ version: pkg.version, enabled: true })])
  })

  it('starts its MCP server', () => {
    const r = claude(['--plugin-dir', root, 'mcp', 'list'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/^plugin:dethereal:dethereal: .*Connected$/m)
  })

  it('loads every agent it ships', () => {
    const agents = fs.readdirSync(path.join(root, 'bundles', 'claude', 'agents')).filter((f) => f.endsWith('.md'))
    const log = path.join(tmp, 'debug.log')
    claude(['--plugin-dir', root, '--debug-file', log, '-p', 'say ok', '--disallowedTools', 'SendMessage,ListAgents'])
    const text = fs.readFileSync(log, 'utf8')
    expect(text.match(/Total plugin agents loaded: (\d+)/)?.[1]).toBe(String(agents.length))
  }, 120_000)

  it('answers a cold start within its budget', async () => {
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist', 'index.js')], cwd: tmp, env: env(), stderr: 'pipe' })
      const client = new Client({ name: 'pack-test', version: '1.0.0' })
      await client.connect(transport)
      try {
        await client.listTools()
        times.push(performance.now() - t0)
      } finally {
        await client.close()
      }
    }
    times.sort((a, b) => a - b)
    expect(times[2]).toBeLessThanOrEqual(MAX_COLD_START_MS)
  }, 120_000)

  it('runs the post-write hook within its budget', async () => {
    const project = path.join(tmp, 'project')
    fs.mkdirSync(project)
    const payload = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(project, 'README.md') }, cwd: project })
    const once = () => new Promise<number>((resolve, reject) => {
      const t0 = performance.now()
      const p = spawn(process.execPath, [path.join(root, 'dist', 'index.js'), 'hook', 'post-write', '--harness', 'claude'], { cwd: project, env: env(), stdio: ['pipe', 'ignore', 'ignore'] })
      p.on('error', reject)
      p.on('exit', (code) => (code === 0 ? resolve(performance.now() - t0) : reject(new Error(`hook exited ${code}`))))
      p.stdin.end(payload)
    })
    const times: number[] = []
    for (let i = 0; i < 40; i++) times.push(await once())
    times.sort((a, b) => a - b)
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(MAX_HOOK_P95_MS)
  }, 120_000)
})
