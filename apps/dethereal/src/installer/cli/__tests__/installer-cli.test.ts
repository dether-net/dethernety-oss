/**
 * The installer command across harnesses: Claude on its own, Codex and OpenCode
 * against one runtime installed and activated once, and a report per harness.
 *
 * The orchestration is driven with writers that record what they are given; one
 * test runs the real Codex and OpenCode writers (with a fake `codex`) and the real
 * Claude writer (with a fake `claude`) end to end. Every folder sits inside the
 * package: the harness runner never takes a binary from a temp directory.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readManifest } from '../../core/manifest.js'
import { ensureStateRoot, type InstallerEnv } from '../../core/paths.js'
import { readCurrentRuntime } from '../../core/runtime.js'
import { TOOL_MANIFEST } from '../../../tools/manifest.js'
import { openCodeVersion, runInstaller, type Writers } from '../index.js'
import { installFakeClaude, setControl } from '../../writers/claude/__tests__/fake-claude.js'
import { PromptAborted, type Prompter } from '../prompt.js'

// Installing a runtime copies the package: seconds under a loaded full run.
vi.setConfig({ testTimeout: 30_000 })

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const realVersion = (JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string }).version

let root: string
let seq = 0
let home: string
let pkg: string
let node: string
let env: InstallerEnv
const savedPath = process.env.PATH

/** A package as the installer ships in, at this package's version, with the real bundles. */
async function makePackage(dir: string, server = 'export const ok = 1\n'): Promise<string> {
  await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@dether.net/dethereal', version: realVersion }))
  await fs.copyFile(path.join(pkgRoot, '.claude-plugin', 'plugin.json'), path.join(dir, '.claude-plugin', 'plugin.json'))
  await fs.writeFile(path.join(dir, 'dist', 'index.js'), server)
  await fs.cp(path.join(pkgRoot, 'bundles'), path.join(dir, 'bundles'), { recursive: true })
  return dir
}

const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) }, out, err, text: () => out.join('') }
}

/** Writers that record their calls; each can be told to fail. */
function recorder(fail: Partial<Record<keyof Writers, string>> = {}) {
  const calls: Array<{ name: keyof Writers; lock: boolean; input: unknown }> = []
  const rec = <K extends keyof Writers>(name: K, result: unknown): Writers[K] =>
    (async (...args: unknown[]) => {
      const first = args[0] as { ctx?: { lock?: unknown }; lock?: unknown }
      calls.push({ name, lock: !!(first?.ctx?.lock ?? first?.lock), input: args.length === 1 ? args[0] : args })
      if (fail[name]) throw Object.assign(new Error(fail[name]), { name: 'InstallerError', code: 'conflict', label: fail[name] })
      return result
    }) as unknown as Writers[K]
  const writers: Writers = {
    installClaude: rec('installClaude', { id: 'dethereal@dether.net', scope: 'user', version: realVersion, marketplace: { name: 'dether.net', added: true }, plugin: 'installed', adopted: false, url: { value: 'http://127.0.0.1:3000', source: 'default' }, notes: [] }),
    uninstallClaude: rec('uninstallClaude', { id: 'dethereal@dether.net', scope: 'user', plugin: 'uninstalled', marketplace: 'removed', notes: [] }),
    installCodex: rec('installCodex', { scope: 'user', codexVersion: '0.157.0', notices: [], reset: [] }),
    uninstallCodex: rec('uninstallCodex', { removed: ['x'], manual: [], hookTrustRemoved: [], hookTrust: [], pluginRemoved: true }),
    planOpenCode: rec('planOpenCode', { key: 'opencode:user', notes: [] }),
    applyOpenCode: rec('applyOpenCode', { status: 'installed', records: [], notes: [] }),
    uninstallOpenCode: rec('uninstallOpenCode', [{ path: '/x', outcome: 'deleted' }]),
    openCodeLeftovers: (async () => []) as Writers['openCodeLeftovers'],
    openCodeVersion: (async () => '1.18.34') as Writers['openCodeVersion'],
    installedCodexUrl: async () => null,
    installedOpenCodeUrl: async () => null,
  }
  return { writers, calls, names: () => calls.map((c) => c.name) }
}

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(pkgRoot, '.test-installer-cli-')))
  // The node a runtime records: under the test's control, never the runner's group-writable one.
  node = path.join(root, 'node-bin', 'node')
  await fs.mkdir(path.dirname(node))
  await fs.writeFile(node, '#!/bin/sh\n')
  await fs.chmod(node, 0o755)
})

/** Remove a tree whose runtime copies are read-only: every folder made writable again, side by side, then removed. */
async function removeTree(dir: string): Promise<void> {
  const unlock = async (d: string): Promise<void> => {
    await fs.chmod(d, 0o700).catch(() => undefined)
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => unlock(path.join(d, e.name))))
  }
  await unlock(dir)
  // A write still landing as the removal runs (a hook cut off by its timeout) is waited out, not reported.
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

// Each test's folder goes as it ends, so no hook has the whole run to remove; whatever is left goes at the end.
afterAll(async () => {
  process.env.PATH = savedPath
  await removeTree(root)
}, 120_000)

let testDir: string
afterEach(async () => {
  await removeTree(testDir)
}, 60_000)

// Each test copies the real bundles into its package: as slow as a test under a loaded full run.
beforeEach(async () => {
  const t = path.join(root, `t${seq++}`)
  testDir = t
  home = path.join(t, 'home')
  await fs.mkdir(home, { recursive: true, mode: 0o700 })
  pkg = await makePackage(path.join(t, 'pkg'))
  env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
}, 60_000)

/** Off a terminal the scope is required; these tests name it unless they pass their own. */
const withScope = (args: string[]) => (args.includes('--scope') ? args : [...args, '--scope', 'user'])
const run = (command: 'install' | 'uninstall', args: string[], writers: Partial<Writers>, r = io()) =>
  runInstaller(command, withScope(args), r.io, { env, packageRoot: pkg, writers, node, tty: false }).then((code) => ({ code, ...r }))

describe('installing across harnesses', () => {
  it('installs Claude on its own, then Codex and OpenCode against one runtime under one lock, activated once', async () => {
    const w = recorder()
    const r = await run('install', ['--harness', 'opencode,codex,claude'], w.writers)
    expect(r.code).toBe(0)
    expect(w.names()).toEqual(['installClaude', 'planOpenCode', 'installCodex', 'applyOpenCode'])
    // Claude takes the lock itself; the runtime writers get the held one.
    expect(w.calls.map((c) => [c.name, c.lock])).toEqual([['installClaude', false], ['planOpenCode', false], ['installCodex', true], ['applyOpenCode', true]])
    const paths = (await ensureStateRoot(env)).paths
    const current = await readCurrentRuntime(paths, env)
    expect(current).toMatchObject({ version: realVersion, execPath: node })
    const codexInput = w.calls.find((c) => c.name === 'installCodex')!.input as { runtime: { version: string }; node: string; platformUrl: string }
    expect(codexInput).toMatchObject({ runtime: { version: realVersion }, node, platformUrl: 'http://127.0.0.1:3000' })
    expect(r.text()).toMatch(/Claude Code: installed\.[\s\S]*Codex: installed\.[\s\S]*OpenCode: installed\./)
    // What each bundle lets run without asking is said before anything is written.
    // In categories, with the count of the rest: the summary names no tool.
    expect(r.out[0]).toContain("Without asking: the plugin's approve hook lets Claude Code run Dethereal's read-only tools and the ones whose changes the server checks; your own deny and ask rules still apply. The other 14 tools ask as your settings say.")
    expect(r.out[0]).toContain("Without asking: Codex runs Dethereal's read-only tools and the ones whose changes the server checks; the other 14 Dethereal tools ask first.")
    expect(r.out[0]).toContain("  Its Dethereal agents get Codex's sandbox settings (read-only for the scouts and the reviewer, which can still read the whole disk; workspace-write for the threat-modeler and the enricher); Codex's sandbox for an agent may not cover its shell commands, so Dethereal's hooks also refuse, best effort, any shell command of the scouts and the reviewer that does more than read. They set no approval policy of their own: Codex's decides whether their shell commands ask.")
    expect(r.out[0]).toContain("  On Codex, Dethereal's guards are best effort: they judge a command by what it names, so an interpreter, or a session fed input later, can get past them; Codex's sandbox is the boundary.")
    expect(r.out[0]).toContain('Without asking, the Dethereal agents: run its read-only tools and the ones whose changes the server checks; read project files, except secret ones; and two of them edit the model files. Their shell commands, and the 14 other tools, ask first. OpenCode\'s own agents keep your settings.')
    expect(TOOL_MANIFEST.filter((t) => t.approval === 'prompt')).toHaveLength(14)
    for (const t of TOOL_MANIFEST) expect(r.out[0], t.name).not.toMatch(new RegExp(`\\b${t.name}\\b`))
  })

  it('says a shell DETHERNETY_URL overrides the install URL, and keeps the URL an untouched install recorded', async () => {
    const shell = 'a DETHERNETY_URL set in your shell overrides it'
    const fresh = await run('install', ['--harness', 'claude,codex,opencode', '--platform-url', 'https://p.example'], recorder().writers)
    expect(fresh.out[0]).toContain(`  Platform URL: https://p.example (default; ${shell}; Claude keeps it for every project of this user).`)
    expect(fresh.out[0]).toContain(`  Platform URL: https://p.example (default; ${shell}). Codex asks you to trust`)
    expect(fresh.out[0]).toContain(`  Platform URL: https://p.example (default; ${shell}).\n`)
    // A re-run without --platform-url keeps each harness's recorded URL, never the package default over it.
    await ensureStateRoot(env)
    const w = recorder()
    const asked: unknown[] = []
    w.writers.installedCodexUrl = async (input) => { asked.push(input); return 'https://codex.example/' }
    w.writers.installedOpenCodeUrl = async () => null
    const rerun = await run('install', ['--harness', 'codex,opencode'], w.writers)
    expect(rerun.code).toBe(0)
    expect(asked).toEqual([expect.objectContaining({ scope: 'user' })])
    expect(rerun.out[0]).toContain(`  Platform URL: keeps https://codex.example (default; ${shell}). Codex asks`)
    expect(rerun.out[0]).toContain(`  Platform URL: http://127.0.0.1:3000 (default; ${shell}).\n`)
    expect(w.calls.find((c) => c.name === 'installCodex')!.input).toMatchObject({ platformUrl: 'https://codex.example' })
    expect(w.calls.find((c) => c.name === 'planOpenCode')!.input).toMatchObject({ url: 'http://127.0.0.1:3000' })
    // --platform-url wins over a recorded URL.
    const flagged = recorder()
    flagged.writers.installedCodexUrl = async () => 'https://codex.example/'
    await run('install', ['--harness', 'codex', '--platform-url', 'https://new.example'], flagged.writers)
    expect(flagged.calls.find((c) => c.name === 'installCodex')!.input).toMatchObject({ platformUrl: 'https://new.example' })
  })

  it('reports each harness on its own: a failed one exits 1, names the retry, and leaves the others installed', async () => {
    const w = recorder({ installCodex: 'codex refused' })
    const r = await run('install', ['--harness', 'codex,opencode', '--platform-url', 'https://platform.example/'], w.writers)
    expect(r.code).toBe(1)
    expect(r.text()).toMatch(/Codex: failed\.\n {2}internal error|Codex: failed\./)
    expect(r.text()).toMatch(/OpenCode: installed\./)
    expect(r.text()).toMatch(/Retry the failed one alone: npx @dether\.net\/dethereal@\S+ install --harness codex/)
    // OpenCode succeeded, so the runtime is active for it.
    expect(await readCurrentRuntime((await ensureStateRoot(env)).paths, env)).toMatchObject({ version: realVersion })
    expect((w.calls.find((c) => c.name === 'planOpenCode')!.input as { url: string }).url).toBe('https://platform.example')
  })

  it('checks OpenCode\'s refusals before writing for either harness', async () => {
    const w = recorder({ planOpenCode: 'opencode refused' })
    const r = await run('install', ['--harness', 'codex,opencode'], w.writers)
    expect(r.code).toBe(1)
    expect(w.names()).toEqual(['planOpenCode', 'installCodex'])
    expect(r.text()).toMatch(/OpenCode: failed\.[\s\S]*Nothing was written for OpenCode\./)
  })

  it('activates nothing when no runtime writer succeeded', async () => {
    const w = recorder({ installCodex: 'x', applyOpenCode: 'y' })
    expect((await run('install', ['--harness', 'codex,opencode'], w.writers)).code).toBe(1)
    await expect(readCurrentRuntime((await ensureStateRoot(env)).paths, env)).rejects.toThrow()
  })

  it('leaves Codex and OpenCode untouched when the runtime cannot be installed, still installs Claude, and exits 1 with the retry', async () => {
    await fs.writeFile(path.join(pkg, 'dist', 'extra.js'), "import x from 'not-bundled'\n")
    const w = recorder()
    const r = await run('install', ['--harness', 'claude,codex,opencode'], w.writers)
    expect(r.code).toBe(1)
    expect(w.names()).toEqual(['installClaude'])
    expect(r.text()).toMatch(/Codex: not touched\.\n {2}The runtime could not be installed/)
    expect(r.text()).toMatch(/OpenCode: not touched\./)
    expect(r.text()).toMatch(/Retry the failed one alone: npx @dether\.net\/dethereal@\S+ install --harness codex,opencode /)
  })

  it('tells the user to restart open sessions when it replaces an earlier version', async () => {
    const paths = (await ensureStateRoot(env)).paths
    // OpenCode's earlier install is this version already: nothing to restart for it. Codex's project install is another scope's.
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: { 'codex:user': { version: '0.4.0', files: [] }, [`codex:project:${home}`]: { version: '0.3.0', files: [] }, 'opencode:user': { version: realVersion, files: [] } } }))
    const r = await run('install', ['--harness', 'codex,opencode'], recorder().writers)
    expect(r.text()).toMatch(/Codex: installed\.[^]*Restart any open Codex session: it keeps running 0\.4\.0 until then\.\nOpenCode: installed\./)
    expect(r.text()).not.toMatch(/Restart any open OpenCode session/)
  })

  it('exits 1 with the retry when the install lock cannot be taken for an uninstall', async () => {
    const paths = (await ensureStateRoot(env)).paths
    // A lock that is never free (the install lock waits five seconds for its holder, then gives up).
    await fs.mkdir(paths.manifestLock)
    const r = await run('uninstall', ['--harness', 'codex'], recorder().writers)
    expect(r.code).toBe(1)
    expect(r.text()).toMatch(/Codex: not touched\.[\s\S]*Retry the failed one alone: \S+ \S+ uninstall --harness codex /)
  }, 30_000)

  it('marks the runtime writers failed when the runtime cannot be activated', async () => {
    const w = recorder()
    await fs.chmod(node, 0o775)
    try {
      const r = await run('install', ['--harness', 'codex'], w.writers)
      expect(r.code).toBe(1)
      expect(r.text()).toMatch(/Codex: failed\.[\s\S]*The runtime could not be activated/)
    } finally {
      await fs.chmod(node, 0o755)
    }
  })

  it('refuses a bad URL before anything runs', async () => {
    const w = recorder()
    const r = await run('install', ['--harness', 'claude,codex', '--platform-url', 'http://u:p@x'], w.writers)
    expect(r.code).toBe(1)
    expect(w.names()).toEqual([])
    expect(r.err.join('')).toMatch(/platform URL: argument refused/)
  })

  it('takes each harness once, in its own order, and refuses an unknown one', async () => {
    const w = recorder()
    expect((await run('install', ['--harness', 'codex,codex'], w.writers)).code).toBe(0)
    expect(w.names()).toEqual(['installCodex'])
    for (const bad of ['gemini', 'claude,', 'claude,kimi']) {
      expect((await run('install', ['--harness', bad], recorder().writers)).code, bad).toBe(2)
    }
    expect((await run('install', ['--harness', 'codex', '--claude-marketplace', '/x'], recorder().writers)).code).toBe(2)
    expect((await run('uninstall', ['--harness', 'codex', '--allow-unverified-opencode'], recorder().writers)).code).toBe(2)
  })

  it('passes --allow-unverified-opencode and the project to OpenCode', async () => {
    const project = path.join(home, '..', 'proj')
    await fs.mkdir(project)
    const w = recorder()
    const asked: unknown[][] = []
    w.writers.openCodeVersion = async (...a) => { asked.push(a); return '1.18.34' }
    await run('install', ['--harness', 'opencode', '--scope', 'project', '--project', project, '--allow-unverified-opencode'], w.writers)
    expect(w.calls[0]!.input).toMatchObject({ scope: { project }, allowUnverified: true, openCodeVersion: '1.18.34', execPath: node })
    // Its version is asked with the project, whose own bin folders are never searched.
    expect(asked).toEqual([[env, project]])
  })

  it('asks OpenCode its version from outside the project, with updates off, and shows only plain text', async () => {
    const project = path.join(root, `oc-project-${seq}`)
    const good = path.join(root, `oc-bin-${seq}`)
    const dump = path.join(root, `oc-env-${seq}`)
    for (const [dir, body] of [[path.join(project, 'bin'), 'printf "9.9.9\\n"'], [good, `env > ${JSON.stringify(dump)}; printf '1.18.34\\033[2J\\n'`]] as const) {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'opencode'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    }
    process.env.PATH = [path.join(project, 'bin'), good, savedPath].join(path.delimiter)
    try {
      expect(await openCodeVersion(env, project)).toBe('1.18.34?[2J')
      expect(await fs.readFile(dump, 'utf8')).toMatch(/^OPENCODE_DISABLE_AUTOUPDATE=1$/m)
    } finally {
      process.env.PATH = savedPath
    }
  })

  it('writes nothing, not even the state folder, when every harness named is refused', async () => {
    const w = recorder()
    w.writers.openCodeVersion = async () => '1.0.0'
    const r = await run('install', ['--harness', 'opencode'], w.writers)
    expect(r.code).toBe(1)
    expect(r.text()).toMatch(/OpenCode: failed\.[\s\S]*older than/)
    expect(w.names()).toEqual([])
    await expect(fs.access(path.join(home, '.dethernety'))).rejects.toThrow()
  })
})

describe('uninstalling across harnesses', () => {
  it('uninstalls each, Codex and OpenCode under one lock, then removes runtimes nothing uses', async () => {
    const w = recorder()
    await run('install', ['--harness', 'codex,opencode'], w.writers)
    const paths = (await ensureStateRoot(env)).paths
    // A runtime nothing names any more: an older version left behind.
    await fs.mkdir(path.join(paths.runtime, '0.0.1'))
    const u = recorder()
    const r = await run('uninstall', ['--harness', 'claude,codex,opencode'], u.writers)
    expect(r.code).toBe(0)
    expect(u.calls.map((c) => [c.name, c.lock])).toEqual([['uninstallClaude', false], ['uninstallCodex', true], ['uninstallOpenCode', true]])
    expect(await fs.readdir(paths.runtime)).not.toContain('0.0.1')
    expect(r.text()).toMatch(/Claude Code: uninstalled\.[\s\S]*Codex: uninstalled\.[\s\S]*OpenCode: uninstalled\./)
  })

  it('keeps the runtime when the last install goes off a terminal, and says gc removes it; gc then removes the current one too', async () => {
    await run('install', ['--harness', 'codex'], recorder().writers)
    const paths = (await ensureStateRoot(env)).paths
    // A full uninstall: no install is recorded any more.
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: {} }))
    const r = await run('uninstall', ['--harness', 'codex', '--yes'], recorder().writers)
    expect(r.code).toBe(0)
    expect(r.text()).toContain('The Dethereal runtime stays in ~/.dethernety/runtime: `dethereal gc` removes it.')
    expect((await fs.readdir(paths.runtime)).sort()).toEqual([realVersion, 'current.json'])
    // gc removes the runtime marked current once nothing uses it, read-only as it is.
    const g = io()
    expect(await runInstaller('gc', ['--yes'], g.io, { env, tty: false })).toBe(0)
    expect(g.text()).toBe(`Removed: ${realVersion}, current.json. Restart any session that was still open.\n`)
    expect(await fs.readdir(paths.runtime)).toEqual([])
  }, 120_000)

  it('asks on a terminal whether to remove the runtime after the last install, and touches nothing beside it', async () => {
    await run('install', ['--harness', 'codex'], recorder().writers)
    const paths = (await ensureStateRoot(env)).paths
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: {} }))
    // The sign-in files live beside the runtime.
    await fs.writeFile(path.join(paths.root, 'tokens.json'), '{"t":1}\n', { mode: 0o600 })
    await fs.writeFile(path.join(paths.root, 'waiver.key'), 'k\n', { mode: 0o600 })
    const uninstall = (s: ReturnType<typeof scripted>, r = io()) =>
      runInstaller('uninstall', ['--harness', 'codex', '--scope', 'user'], r.io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: true, prompter: s.prompter }).then((code) => ({ code, ...r }))
    const question = 'Also remove the Dethereal runtime (in ~/.dethernety/runtime)?'
    const no = scripted({ confirm: [true, false] })
    const kept = await uninstall(no)
    expect(no.asked[1]).toBe(question)
    expect(kept.text()).toContain('The Dethereal runtime stays in ~/.dethernety/runtime: `dethereal gc` removes it.')
    expect(await fs.readdir(paths.runtime)).toContain(realVersion)
    // A quarantined copy stays, and is named.
    await fs.rename(path.join(paths.runtime, realVersion), path.join(paths.runtime, `${realVersion}.quarantine-20260101T000000000Z`))
    await run('install', ['--harness', 'codex'], recorder().writers)
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: {} }))
    const yes = scripted({ confirm: [true, true] })
    const gone = await uninstall(yes)
    expect(gone.code).toBe(0)
    expect(yes.asked[1]).toBe(question)
    expect(gone.text()).toContain(`Runtime removed: ${realVersion}, current.json. Restart any session that was still open.`)
    expect(gone.text()).toContain(`Kept in ~/.dethernety/runtime: ${realVersion}.quarantine-20260101T000000000Z (quarantined copies`)
    expect(await fs.readdir(paths.runtime)).toEqual([`${realVersion}.quarantine-20260101T000000000Z`])
    // Read-only throughout, as the runtime it was: moved out of the way rather than removed here.
    await fs.chmod(path.join(paths.runtime, `${realVersion}.quarantine-20260101T000000000Z`), 0o700)
    await fs.rename(path.join(paths.runtime, `${realVersion}.quarantine-20260101T000000000Z`), path.join(paths.root, '..', '..', 'quarantine-aside'))
    // Nothing left: the folder goes too.
    await run('install', ['--harness', 'codex'], recorder().writers)
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: {} }))
    await uninstall(scripted({ confirm: [true, true] }))
    await expect(fs.access(paths.runtime)).rejects.toThrow()
    expect(await fs.readFile(path.join(paths.root, 'tokens.json'), 'utf8')).toBe('{"t":1}\n')
    expect(await fs.readFile(path.join(paths.root, 'waiver.key'), 'utf8')).toBe('k\n')
    // While an install remains, nothing more is asked.
    await run('install', ['--harness', 'codex'], recorder().writers)
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: { 'opencode:user': { version: realVersion, files: [] } } }))
    const other = scripted({ confirm: [true] })
    const stays = await uninstall(other)
    expect(other.asked).toHaveLength(1)
    expect(stays.text()).not.toMatch(/runtime stays|Runtime removed/)
  }, 120_000)

  it('passes --forget-missing-project to OpenCode, and names the files OpenCode itself left', async () => {
    const w = recorder()
    w.writers.openCodeLeftovers = async () => ['/cfg/opencode/package.json', '/cfg/opencode/node_modules']
    const r = await run('uninstall', ['--harness', 'opencode', '--forget-missing-project'], w.writers)
    expect(r.code).toBe(0)
    expect((w.calls.find((c) => c.name === 'uninstallOpenCode')!.input as unknown[])[1]).toMatchObject({ forgetMissingProject: true })
    expect(r.text()).toMatch(/OpenCode's own files stay \(it installed its plugin package there, not Dethereal\): \/cfg\/opencode\/package\.json, \/cfg\/opencode\/node_modules\./)
  })

  it('reports a failed uninstall per harness, with the retry', async () => {
    const r = await run('uninstall', ['--harness', 'codex,opencode'], recorder({ uninstallOpenCode: 'z' }).writers)
    expect(r.code).toBe(1)
    expect(r.text()).toMatch(/Codex: uninstalled\.[\s\S]*OpenCode: failed\.[\s\S]*dethereal@\S+ uninstall --harness opencode/)
  })
})

describe('end to end with the real writers', () => {
  /** A fake `codex` first on PATH and a Codex home of the test's own. */
  async function fakeCodex(): Promise<string> {
    const bin = path.join(root, `bins${seq}`)
    await fs.mkdir(path.join(bin, 'codex-bin'), { recursive: true })
    await fs.copyFile(path.join(pkgRoot, 'src', 'installer', 'writers', 'codex', '__tests__', 'fake-codex.mjs'), path.join(bin, 'codex-bin', 'codex.mjs'))
    await fs.writeFile(path.join(bin, 'codex-bin', 'codex'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'codex-bin', 'codex.mjs'))} "$@"\n`, { mode: 0o755 })
    process.env.PATH = [path.join(bin, 'codex-bin'), savedPath].join(path.delimiter)
    const codexHome = path.join(home, '.codex')
    await fs.mkdir(codexHome)
    env = { ...env, vars: { CODEX_HOME: codexHome } }
    return codexHome
  }

  it.each(['codex', 'opencode'] as const)('keeps the URL a %s install recorded when install runs again without --platform-url', async (h) => {
    const codexHome = await fakeCodex()
    const deps = { env, packageRoot: pkg, node, writers: { openCodeVersion: async () => '1.18.34' } }
    const urlIn = async () => h === 'codex'
      ? /^env = \{ DETHERNETY_PLATFORM_URL = "([^"]*)" \}$/m.exec(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'))?.[1]
      : (JSON.parse(await fs.readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8')) as { mcp: { dethereal: { environment: Record<string, string> } } }).mcp.dethereal.environment.DETHERNETY_PLATFORM_URL
    try {
      const first = io()
      expect(await runInstaller('install', ['--harness', h, '--scope', 'user', '--platform-url', 'http://localhost:3000'], first.io, deps), first.text()).toBe(0)
      expect(await urlIn()).toBe('http://localhost:3000')
      // The package's own default is another URL: the re-run keeps the recorded one, and says so.
      const again = io()
      expect(await runInstaller('install', ['--harness', h, '--scope', 'user'], again.io, deps), again.text()).toBe(0)
      expect(again.out[0]).toContain('Platform URL: keeps http://localhost:3000 (default; a DETHERNETY_URL set in your shell overrides it)')
      expect(await urlIn()).toBe('http://localhost:3000')
    } finally {
      process.env.PATH = savedPath
    }
  }, 120_000)

  it('installs and uninstalls Claude, Codex and OpenCode from one package', async () => {
    const bin = path.join(root, `bins${seq}`)
    await installFakeClaude(path.join(bin, 'claude-bin'))
    await fs.mkdir(path.join(bin, 'codex-bin'), { recursive: true })
    await fs.copyFile(path.join(pkgRoot, 'src', 'installer', 'writers', 'codex', '__tests__', 'fake-codex.mjs'), path.join(bin, 'codex-bin', 'codex.mjs'))
    await fs.writeFile(path.join(bin, 'codex-bin', 'codex'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'codex-bin', 'codex.mjs'))} "$@"\n`, { mode: 0o755 })
    process.env.PATH = [path.join(bin, 'claude-bin'), path.join(bin, 'codex-bin'), savedPath].join(path.delimiter)
    const codexHome = path.join(home, '.codex')
    await fs.mkdir(codexHome)
    env = { ...env, vars: { CODEX_HOME: codexHome } }
    await setControl(home, { npmLatest: realVersion, npmPackages: { [realVersion]: pkg } })
    try {
      const r = await runInstaller('install', ['--harness', 'claude,codex,opencode', '--scope', 'user', '--platform-url', 'http://localhost:3000'], io().io, {
        env, packageRoot: pkg, node, writers: { openCodeVersion: async () => '1.18.34' },
      })
      expect(r).toBe(0)
      const paths = (await ensureStateRoot(env)).paths
      const m = (await readManifest(paths, env)).manifest
      expect(Object.keys(m.installs).sort()).toEqual(['claude:user', 'codex:user', 'opencode:user'])
      expect(m.shared?.codex?.marketplace.runtimeVersion).toBe(realVersion)
      expect(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).toMatch(/\[mcp_servers\.dethereal\]/)
      expect(await readCurrentRuntime(paths, env)).toMatchObject({ version: realVersion })

      const u = io()
      expect(await runInstaller('uninstall', ['--harness', 'claude,codex,opencode', '--scope', 'user'], u.io, { env, packageRoot: pkg, node }), u.text()).toBe(0)
      const after = (await readManifest(paths, env)).manifest
      expect(after.installs).toEqual({})
      expect(after.shared?.claude).toBeUndefined()
      expect(after.shared?.codex).toBeUndefined()
      expect(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8').catch(() => '')).not.toMatch(/dethereal/)
    } finally {
      process.env.PATH = savedPath
    }
  }, 120_000)
})

/** A prompter that gives scripted answers, and records the questions. */
function scripted(answers: { multi?: string[][]; select?: string[]; text?: string[]; confirm?: boolean[]; abortAt?: number }) {
  const asked: string[] = []
  const offered: string[] = []
  const next = <T>(list: T[] | undefined, question: string): T => {
    asked.push(question)
    if (answers.abortAt !== undefined && asked.length > answers.abortAt) throw new PromptAborted()
    if (!list?.length) throw new PromptAborted()
    return list.shift()!
  }
  const prompter: Prompter = {
    multi: async (q) => next(answers.multi, q) as never,
    select: async (q) => next(answers.select, q) as never,
    text: async (q, fallback) => { offered.push(fallback); return next(answers.text, q) },
    confirm: async (q) => next(answers.confirm, q),
    close: () => undefined,
  }
  return { prompter, asked, offered }
}

describe('on a terminal', () => {
  it('asks for what is not given, shows the summary, and installs only on yes', async () => {
    const w = recorder()
    const s = scripted({ multi: [['codex']], select: ['user'], text: ['https://platform.example/'], confirm: [true] })
    const r = io()
    expect(await runInstaller('install', [], r.io, { env, packageRoot: pkg, writers: w.writers, node, tty: true, prompter: s.prompter })).toBe(0)
    expect(s.asked).toEqual(['Which harnesses?', 'For whom?', 'Platform URL (Enter takes the default)?', 'Install?'])
    expect(s.offered).toEqual(['http://127.0.0.1:3000'])
    expect(w.calls.find((c) => c.name === 'installCodex')!.input).toMatchObject({ platformUrl: 'https://platform.example' })
  })

  it('offers the URL Claude Code already keeps, never the package default over it', async () => {
    const settings = path.join(home, '.claude', 'settings.json')
    await fs.mkdir(path.dirname(settings), { recursive: true })
    // The official marketplace's plugin wins over another one sorted first.
    await fs.writeFile(settings, JSON.stringify({ pluginConfigs: { 'dethereal@aaa': { options: { platform_url: 'https://other.example' } }, 'dethereal@dether.net': { options: { platform_url: 'https://mine.example/' } } } }))
    const s = scripted({ multi: [['claude']], select: ['user'], text: ['https://mine.example'], confirm: [false] })
    expect(await runInstaller('install', [], io().io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: true, prompter: s.prompter })).toBe(0)
    expect(s.offered).toEqual(['https://mine.example'])
    expect(s.asked[2]).toBe('Platform URL (Enter keeps the one Claude Code has; Claude keeps it for every project of this user)?')
    // An unusable value there is not offered.
    await fs.writeFile(settings, JSON.stringify({ pluginConfigs: { 'dethereal@dether.net': { options: { platform_url: 'http://u:p@x' } } } }))
    const bad = scripted({ multi: [['codex']], select: ['user'], text: ['http://127.0.0.1:3000'], confirm: [false] })
    await runInstaller('install', [], io().io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: true, prompter: bad.prompter })
    expect(bad.offered).toEqual(['http://127.0.0.1:3000'])
  })

  it('refuses an OpenCode it will not install before asking, and asks nothing when nothing is left', async () => {
    const w = recorder()
    w.writers.openCodeVersion = async () => '1.99.0'
    const s = scripted({ multi: [['codex', 'opencode']], select: ['user'], text: ['http://127.0.0.1:3000'], confirm: [true] })
    const r = io()
    expect(await runInstaller('install', [], r.io, { env, packageRoot: pkg, writers: w.writers, node, tty: true, prompter: s.prompter })).toBe(1)
    expect(r.out[0]).toMatch(/OpenCode: not installed\. OpenCode 1\.99\.0 is newer than/)
    expect(w.names()).toEqual(['installCodex'])
    expect(r.text()).toMatch(/OpenCode: failed\.\n {2}OpenCode 1\.99\.0 is newer[^\n]*\n {2}Nothing was written for OpenCode\./)
    const only = scripted({ multi: [['opencode']], select: ['user'], text: ['http://127.0.0.1:3000'], confirm: [] })
    const o = io()
    expect(await runInstaller('install', [], o.io, { env, packageRoot: pkg, writers: w.writers, node, tty: true, prompter: only.prompter })).toBe(1)
    expect(only.asked).not.toContain('Install?')
    expect(w.names()).toEqual(['installCodex'])
  })

  it('still asks which harnesses when the installer state cannot be read', async () => {
    const paths = (await ensureStateRoot(env)).paths
    await fs.writeFile(paths.manifest, '{ not json')
    const s = scripted({ multi: [['codex']], select: ['user'], confirm: [false] })
    expect(await runInstaller('uninstall', [], io().io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: true, prompter: s.prompter })).toBe(0)
    expect(s.asked[0]).toBe('Which harnesses to uninstall from?')
  })

  it('names the backup purge in the uninstall question, and reads the state without creating it', async () => {
    const s = scripted({ multi: [['codex']], select: ['user'], confirm: [false] })
    expect(await runInstaller('uninstall', ['--purge-backups'], io().io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: true, prompter: s.prompter })).toBe(0)
    expect(s.asked.at(-1)).toBe("Uninstall Dethereal from Codex (this user), and remove the installer's backups if nothing stays installed?")
    await expect(fs.access(path.join(home, '.dethernety'))).rejects.toThrow()
  })

  it('changes nothing when the answer is no, or the input ends', async () => {
    const w = recorder()
    const no = scripted({ multi: [['codex']], select: ['user'], text: ['http://127.0.0.1:3000'], confirm: [false] })
    const r = io()
    expect(await runInstaller('install', [], r.io, { env, packageRoot: pkg, writers: w.writers, node, tty: true, prompter: no.prompter })).toBe(0)
    expect(r.text()).toMatch(/Nothing changed\./)
    const aborted = io()
    expect(await runInstaller('install', [], aborted.io, { env, packageRoot: pkg, writers: w.writers, node, tty: true, prompter: scripted({ multi: [['codex']], abortAt: 1 }).prompter })).toBe(1)
    expect(aborted.err.join('')).toMatch(/aborted; nothing changed/)
    expect(w.calls).toEqual([])
    await expect(fs.access(path.join(home, '.dethernety', 'runtime'))).rejects.toThrow()
  })

  it('takes --yes as "proceed" only: the harness and the scope must still be named', async () => {
    const r = io()
    expect(await runInstaller('install', ['--harness', 'codex', '--yes'], r.io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: true })).toBe(2)
    expect(r.err.join('')).toMatch(/--scope is required/)
    expect(await runInstaller('install', ['--scope', 'user'], io().io, { env, packageRoot: pkg, writers: recorder().writers, node, tty: false })).toBe(2)
  })
})

describe('gc and backups', () => {
  it('removes runtimes nothing uses, only with --yes off a terminal, and refuses on a manifest it cannot read', async () => {
    const paths = (await ensureStateRoot(env)).paths
    await fs.mkdir(path.join(paths.runtime, '0.0.1'), { recursive: true })
    expect(await runInstaller('gc', [], io().io, { env, tty: false })).toBe(2)
    await fs.writeFile(paths.manifest, '{ not json')
    expect(await runInstaller('gc', ['--yes'], io().io, { env, tty: false })).toBe(1)
    expect(await fs.readdir(paths.runtime)).toContain('0.0.1')
    await fs.rm(paths.manifest)
    const r = io()
    expect(await runInstaller('gc', ['--yes'], r.io, { env, tty: false })).toBe(0)
    expect(r.text()).toMatch(/Removed: 0\.0\.1\. Restart any session/)
    expect(await fs.readdir(paths.runtime)).not.toContain('0.0.1')
  })

  it('removes backups only when nothing is installed any more', async () => {
    const paths = (await ensureStateRoot(env)).paths
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: { 'opencode:user': { version: '0.5.0', files: [] } } }))
    const kept = await run('uninstall', ['--harness', 'codex', '--purge-backups'], recorder().writers)
    expect(kept.text()).toMatch(/Backups kept: other installs remain/)
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: {} }))
    const gone = await run('uninstall', ['--harness', 'codex', '--purge-backups'], recorder().writers)
    expect(gone.text()).toMatch(/Backups removed: \d+\./)
  })
})
