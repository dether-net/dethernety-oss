/**
 * The doctor tests' shared setup: a package carrying the real shipped server and bundles, installed
 * for Claude Code, Codex and OpenCode through fake `claude` and `codex` CLIs and the real writers, then
 * checked. Every folder sits inside the package (the harness runner never takes a binary from a temp
 * directory), and the node the runtime records is a 0755 wrapper the test owns.
 *
 * Each doctor test file calls `doctorSuite()` once. The files run side by side, each in its own worker
 * with its own PATH: a doctor run spends most of its time waiting, about 10 s per probed server for a
 * platform that never answers, so one file alone took over ten minutes.
 */
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { shippedBuild } from '../../../packaging/shipped-build.js'
import type { InstallerEnv } from '../../core/paths.js'
import { runInstaller } from '../../cli/index.js'
import { installFakeClaude, setControl } from '../../writers/claude/__tests__/fake-claude.js'

export const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
export const version = (JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string }).version

export let root: string
export let pkg: string
export let nodeBin: string
export let node: string
export let seq = 0
export let home: string
export let codexHome: string
export let env: InstallerEnv
/** For a test that changes the installer's environment after the install. */
export const setEnv = (next: InstallerEnv) => { env = next }
const savedPath = process.env.PATH

export const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) }, text: () => out.join(''), err: () => err.join('') }
}
/** OpenCode's `mcp list` as it prints it, from the installed user configuration (status from its `enabled`). */
export const fakeMcpList = async (): Promise<string> => {
  const cfg = JSON.parse(await fs.readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8').catch(() => '{}')) as { mcp?: Record<string, { command?: string[]; enabled?: boolean }> }
  const s = cfg.mcp?.dethereal
  return s ? `\x1b[0m\n\u250c  MCP Servers\n\u2502\n\u25cf  \u2713 dethereal \x1b[90m${s.enabled === false ? 'disabled' : 'connected'}\n\u2502      \x1b[90m${(s.command ?? []).join(' ')}\n\u2502\n\u2514  1 server(s)\n` : '\u250c  MCP Servers\n\u2514  0 server(s)\n'
}
export const deps = (extra: Record<string, unknown> = {}) => ({ env, packageRoot: pkg, node, tty: false, writers: { openCodeVersion: async () => '1.18.34' }, openCodeMcpList: fakeMcpList, ...extra })
export const doctor = async (args: string[] = [], extra: Record<string, unknown> = {}) => {
  const r = io()
  const code = await runInstaller('doctor', ['--json', ...args], r.io, deps(extra) as never)
  return { code, checks: JSON.parse(r.text() || '[]') as Array<{ subject: string; label: string; status: string; detail?: string; fix?: string }>, err: r.err() }
}
export const find = (checks: Awaited<ReturnType<typeof doctor>>['checks'], subject: string, label: string) => checks.find((c) => c.subject.startsWith(subject) && c.label === label)

/** The folder each run makes in the package, and the file in it naming the process that made it. */
const PREFIX = '.test-doctor-'
const OWNER = 'owner.pid'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Remove a run's folder. Its homes hold runtimes installed read-only (0o500 folders): each folder the
 * owner cannot write is unlocked first, side by side.
 */
async function removeRun(dir: string): Promise<void> {
  const unlock = async (d: string): Promise<void> => {
    const st = await fs.stat(d).catch(() => null)
    if (st && (st.mode & 0o700) !== 0o700) await fs.chmod(d, 0o700).catch(() => undefined)
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => unlock(path.join(d, e.name))))
  }
  await unlock(dir)
  await fs.rm(dir, { recursive: true, force: true })
}

/**
 * The folders a killed run left behind: one whose process is gone, or, when it names none, one not
 * touched for an hour. A live run's folder, this file's or another's, is left alone.
 */
export async function sweepStale(parent: string = pkgRoot): Promise<void> {
  const names = (await fs.readdir(parent)).filter((n) => n.startsWith(PREFIX))
  for (const name of names) {
    const dir = path.join(parent, name)
    const pid = Number((await fs.readFile(path.join(dir, OWNER), 'utf8').catch(() => '')).trim())
    if (pid > 0 ? alive(pid) : Date.now() - ((await fs.stat(dir).catch(() => null))?.mtimeMs ?? Date.now()) < 3_600_000) continue
    await removeRun(dir)
  }
}

export function doctorSuite(): void {
  // Measured alone, the slowest test takes 75 s and the slowest file about 190 s; a full parallel run
  // on a busy host has taken several times that.
  vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 })

  beforeAll(async () => {
    await sweepStale()
    root = await fs.realpath(await fs.mkdtemp(path.join(pkgRoot, PREFIX)))
    await fs.writeFile(path.join(root, OWNER), `${process.pid}\n`)
    // The package: the real shipped server, the generated plugin roots and bundles.
    pkg = path.join(root, 'pkg')
    await build({ ...shippedBuild, config: false, entry: { index: path.join(pkgRoot, 'src', 'index.ts') }, outDir: path.join(pkg, 'dist'), clean: false, silent: true })
    for (const f of ['package.json', '.claude-plugin', 'bundles']) await fs.cp(path.join(pkgRoot, f), path.join(pkg, f), { recursive: true })
    // The node: a wrapper the test owns, which is also the first `node` on PATH (Claude runs a bare `node`).
    nodeBin = path.join(root, 'node-bin')
    await fs.mkdir(nodeBin)
    node = path.join(nodeBin, 'node')
    await fs.writeFile(node, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`)
    await fs.chmod(node, 0o755)
    const bins = path.join(root, 'bins')
    await installFakeClaude(path.join(bins, 'claude-bin'))
    await fs.mkdir(path.join(bins, 'codex-bin'), { recursive: true })
    await fs.copyFile(path.join(pkgRoot, 'src', 'installer', 'writers', 'codex', '__tests__', 'fake-codex.mjs'), path.join(bins, 'codex-bin', 'codex.mjs'))
    await fs.writeFile(path.join(bins, 'codex-bin', 'codex'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bins, 'codex-bin', 'codex.mjs'))} "$@"\n`, { mode: 0o755 })
    process.env.PATH = [nodeBin, path.join(bins, 'claude-bin'), path.join(bins, 'codex-bin'), savedPath].join(path.delimiter)
  })

  afterAll(async () => {
    process.env.PATH = savedPath
    if (root) await removeRun(root)
  })

  beforeEach(async () => {
    home = path.join(root, `h${seq++}`)
    await fs.mkdir(home, { mode: 0o700 })
    codexHome = path.join(home, '.codex')
    await fs.mkdir(codexHome)
    env = { home, vars: { CODEX_HOME: codexHome }, euid: process.geteuid!(), platform: process.platform }
    await setControl(home, { npmLatest: version, npmPackages: { [version]: pkg } })
  })
}

export const installAll = async (extra: string[] = []) => {
  const r = io()
  const code = await runInstaller('install', ['--harness', 'claude,codex,opencode', '--scope', 'user', '--platform-url', 'http://127.0.0.1:9', ...extra], r.io, deps() as never)
  expect(code, r.text() + r.err()).toBe(0)
}

export const FIXED_URL = 'installed by an earlier Dethereal: the install URL overrides a shell DETHERNETY_URL; re-run install to update'
export const opencodeJson = () => path.join(home, '.config', 'opencode', 'opencode.json')

/** Whether the writers recorded the URL fixed (`DETHERNETY_URL`), as an earlier Dethereal did, rather than as a default. */
export const fixedUrl = async (h: 'codex' | 'opencode') => h === 'codex'
  ? /^env = \{ DETHERNETY_URL = /m.test(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'))
  : 'DETHERNETY_URL' in ((JSON.parse(await fs.readFile(opencodeJson(), 'utf8')) as { mcp: { dethereal: { environment: Record<string, string> } } }).mcp.dethereal.environment)
export const entryVerdict = async (h: 'codex' | 'opencode') => (await fixedUrl(h)) ? { status: 'warn', detail: FIXED_URL } : { status: 'ok' }

/** Rewrite the installed Codex and OpenCode entries' URL to one shape: a default the shell overrides, or fixed. */
export async function setUrlShape(shape: 'default' | 'fixed'): Promise<void> {
  const key = shape === 'default' ? 'DETHERNETY_PLATFORM_URL' : 'DETHERNETY_URL'
  const toml = path.join(codexHome, 'config.toml')
  const vars = ['NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'DEBUG', ...(shape === 'default' ? ['DETHERNETY_URL'] : [])]
  await fs.writeFile(toml, (await fs.readFile(toml, 'utf8'))
    .replace(/^env = \{ DETHERNETY_(?:PLATFORM_)?URL = ("[^"]*") \}$/m, `env = { ${key} = $1 }`)
    .replace(/^env_vars = \[.*\]$/m, `env_vars = ${JSON.stringify(vars).replaceAll(',', ', ')}`))
  const cfg = JSON.parse(await fs.readFile(opencodeJson(), 'utf8')) as { mcp: { dethereal: { environment: Record<string, string> } } }
  cfg.mcp.dethereal.environment = { [key]: Object.values(cfg.mcp.dethereal.environment)[0]! }
  await fs.writeFile(opencodeJson(), JSON.stringify(cfg, null, 2))
}

/** Codex's own record that the user trusted the plugin's hooks. */
export async function trustHooks(): Promise<void> {
  const file = path.join(codexHome, 'config.toml')
  const events = ['session_start:0:0', 'session_start:0:1', 'session_start:0:2', 'session_start:0:3', 'pre_tool_use:0:0', 'pre_tool_use:1:0', 'pre_tool_use:2:0', 'post_tool_use:0:0']
  const tables = events.map((e) => `\n[hooks.state."dethereal@dethereal-local:hooks/hooks.json:${e}"]\ntrusted_hash = "abc"\n`).join('')
  await fs.appendFile(file, tables)
}
