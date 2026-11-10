/**
 * Canary for the built CLI: every command runs as a harness would run it, with a
 * seeded session store in a sandbox HOME and a platform that records requests.
 *
 * Positive evidence, not just a clean scan: the store is unreadable (mode 000) and
 * no debug line shows an attempt to read it; the platform counts every request and
 * must see none; stdin stays open and is never written, and every command must
 * still finish promptly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { shippedBuild } from '../../packaging/shipped-build.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const NEEDLES = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex'), randomBytes(24).toString('hex')]

interface Run {
  code: number | null
  stdout: string
  stderr: string
  ms: number
}

function run(entry: string, args: string[], cwd: string, env: Record<string, string>, stdin?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    // stdin is a pipe that is never written or closed, as a harness may leave it.
    const child = spawn(process.execPath, [entry, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    // With an event, stdin is written and closed, as a harness does for a hook.
    if (stdin !== undefined) child.stdin.end(stdin)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(killer)
      resolve({ code, stdout, stderr, ms: Date.now() - t0 })
    })
  })
}

describe('CLI canary (built entry, argv, no shell)', () => {
  let entry: string
  let root: string
  let home: string
  let project: string
  let platform: http.Server
  let platformUrl: string
  let requests = 0

  beforeAll(async () => {
    const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
    await mkdir(cacheDir, { recursive: true })
    const outDir = await mkdtemp(path.join(cacheDir, 'dethereal-cli-'))
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

    root = await realpath(await mkdtemp(path.join(tmpdir(), 'dethereal-cli-canary-')))
    home = path.join(root, 'home')
    project = path.join(root, 'project')
    await mkdir(path.join(home, '.dethernety'), { recursive: true })
    const store = path.join(home, '.dethernety', 'tokens.json')
    await writeFile(
      store,
      JSON.stringify({ version: 1, tokens: { x: { accessToken: NEEDLES[0], idToken: NEEDLES[1], refreshToken: NEEDLES[2] } } })
    )
    await chmod(store, 0o000)

    await mkdir(path.join(project, '.git'), { recursive: true })
    await mkdir(path.join(project, 'models', 'shop', '.dethereal'), { recursive: true })
    await mkdir(path.join(project, 'src'), { recursive: true })
    await mkdir(path.join(project, '.dethernety'), { recursive: true })
    await writeFile(path.join(project, 'models', 'shop', 'manifest.json'), '{}')
    // The stale id names an element the model has, so the server counts it.
    await writeFile(
      path.join(project, 'models', 'shop', 'structure.json'),
      JSON.stringify({ defaultBoundary: { id: 'b', name: 'B', components: [{ id: 'a', name: 'A' }] } })
    )
    await writeFile(
      path.join(project, 'models', 'shop', '.dethereal', 'state.json'),
      JSON.stringify({ currentState: 'ENRICHING', staleElements: ['a'] })
    )
    await writeFile(path.join(project, 'models', 'shop', '.dethereal', 'quality.json'), JSON.stringify({ quality_score: 81 }))
    await writeFile(path.join(project, '.dethernety', 'models.json'), JSON.stringify({ models: [{ name: 'Shop', path: 'models/shop' }] }))

    platform = http.createServer((_req, res) => {
      requests += 1
      res.statusCode = 500
      res.end()
    })
    await new Promise<void>((resolve) => platform.listen(0, '127.0.0.1', resolve))
    platformUrl = `http://127.0.0.1:${(platform.address() as net.AddressInfo).port}`
  }, 120_000)

  afterAll(async () => {
    await new Promise<void>((resolve) => platform?.close(() => resolve()))
    if (root) {
      await chmod(path.join(home, '.dethernety', 'tokens.json'), 0o600).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
    if (entry) await rm(path.dirname(entry), { recursive: true, force: true })
  })

  const env = () => ({ HOME: home, PATH: process.env.PATH ?? '', DETHERNETY_URL: platformUrl, DEBUG: 'true', DETHEREAL_SETTLEMENT: 'on' })
  /** As shipped: the settlement variable unset. */
  const shippedEnv = () => ({ HOME: home, PATH: process.env.PATH ?? '', DETHERNETY_URL: platformUrl, DEBUG: 'true' })

  function assertClean(label: string, r: Run) {
    for (const text of [r.stdout, r.stderr]) {
      for (const needle of NEEDLES) expect(text, label).not.toContain(needle)
      expect(text, label).not.toContain('tokens.json')
      expect(text, label).not.toContain(path.join(home, '.dethernety'))
      expect(text, label).not.toContain(path.join(home.replace(/^\/private/, ''), '.dethernety'))
    }
    expect(r.stderr, label).not.toMatch(/Loading stored tokens|stored tokens|refresh/i)
    expect(r.ms, label).toBeLessThan(2_000)
  }

  it.each(['startup', 'resume', 'clear', 'compact'])('hook session-start --source %s', async (source) => {
    const r = await run(entry, ['hook', 'session-start', '--source', source, '--harness', 'claude'], path.join(project, 'src'), env())
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(out.hookSpecificOutput.additionalContext).toMatch(/model "Shop": ENRICHING \(1 unregistered\), quality 81\/100, 1 stale element/)
    assertClean(source, r)
  })

  it('hook session-start follows the settlement: off as shipped, on by its flag or the exact environment value', async () => {
    const shipped = shippedEnv()
    const context = async (args: string[], e: Record<string, string>) => {
      const r = await run(entry, ['hook', 'session-start', '--source', 'startup', '--harness', 'claude', ...args], path.join(project, 'src'), e)
      expect(r.code).toBe(0)
      return (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
    }
    const off = await context([], shipped)
    expect(off).toMatch(/model "Shop": ENRICHING, quality 81\/100, 1 stale element/)
    expect(off).not.toMatch(/[Ss]ettlement|unregistered/)
    expect(await context([], { ...shipped, DETHEREAL_SETTLEMENT: 'yes' })).not.toMatch(/unregistered/)
    const byFlag = await context(['--settlement'], shipped)
    const byEnv = await context([], env())
    for (const on of [byFlag, byEnv]) {
      expect(on).toMatch(/ENRICHING \(1 unregistered\)/)
      expect(on).toContain('Settlement on')
    }
  })

  it('workspace-status --json', async () => {
    const r = await run(entry, ['workspace-status', '--json'], path.join(project, 'src'), env())
    expect(r.code).toBe(0)
    const data = JSON.parse(r.stdout)
    expect(data.projectRoot).toBe(project)
    expect(data.models[0]).toMatchObject({ name: 'Shop', state: 'ENRICHING', qualityScore: 81, staleElements: 1 })
    expect(data.settlement).toBe('on')
    assertClean('workspace-status', r)
  })

  it('workspace-status --json reports the settlement from the flag or the environment', async () => {
    const mode = async (args: string[]) => {
      const r = await run(entry, ['workspace-status', '--json', ...args], path.join(project, 'src'), shippedEnv())
      expect(r.code).toBe(0)
      return JSON.parse(r.stdout).settlement
    }
    expect(await mode([])).toBe('off')
    expect(await mode(['--settlement'])).toBe('on')
  })

  it('hook post-write names the model a write touched, and nothing else', async () => {
    const event = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(project, 'models', 'shop', 'structure.json'), content: NEEDLES[0] },
      cwd: project,
    })
    const r = await run(entry, ['hook', 'post-write', '--harness', 'claude'], project, env(), event)
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: 'PostToolUse',
      additionalContext: 'Dethereal: model "Shop" changed (1 file). Validate it with mcp__plugin_dethereal_dethereal__validate_model_json once this step\'s writes are done.',
    })
    assertClean('post-write', r)
  })

  it('hook post-write stays silent for other files and gives up on a stdin that never closes', async () => {
    const other = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(project, 'README.md') }, cwd: project })
    const quiet = await run(entry, ['hook', 'post-write'], project, env(), other)
    expect(quiet).toMatchObject({ code: 0, stdout: '' })
    assertClean('post-write other', quiet)
    const open = await run(entry, ['hook', 'post-write'], project, env())
    expect(open).toMatchObject({ code: 0, stdout: '' })
    expect(open.ms).toBeLessThan(5_000)
  }, 20_000)

  it('an unknown command writes nothing to stdout and exits 2', async () => {
    const r = await run(entry, ['--stdio'], project, env())
    expect(r.code).toBe(2)
    expect(r.stdout).toBe('')
    assertClean('unknown', r)
  })

  it('contacted no platform at all', () => {
    expect(requests).toBe(0)
  })
})
