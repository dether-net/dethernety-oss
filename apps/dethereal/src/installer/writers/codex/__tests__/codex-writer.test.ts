/**
 * The Codex writer against a fake `codex` (fake-codex.mjs) that keeps its state in
 * the config file as Codex does, with runtimes installed by the installer core from
 * the package's own Codex bundle.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { PACKAGE_GOLDENS } from '../../../../generator/cli.js'
import { withStateLock } from '../../../core/manifest.js'
import { readManifest } from '../../../core/manifest.js'
import { ensureStateRoot, type InstallerEnv, type StatePaths } from '../../../core/paths.js'
import { installRuntime, type InstalledRuntime } from '../../../core/runtime.js'
import { codexAppServerVersions, codexHookTrust, installCodex, installedCodexUrl, uninstallCodex } from '../index.js'
import { projectTrusted } from '../config.js'
import { listMcpServers } from '../cli.js'

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', '..')
let root: string
let bin: string
let home: string
let codexHome: string
let env: InstallerEnv
let paths: StatePaths
const savedPath = process.env.PATH

async function writeControl(c: Record<string, unknown>) {
  await fs.writeFile(path.join(bin, 'control.json'), JSON.stringify(c))
}
const calls = async () => (await fs.readFile(path.join(bin, 'log.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[])
const cfgPath = () => path.join(codexHome, 'config.toml')
const cfg = () => fs.readFile(cfgPath(), 'utf8').catch(() => '')

/** A runtime source: a trivial dist and the package's Codex bundle with its plugin at `version`. */
async function runtimeSource(version: string, name = `src-${version}`): Promise<string> {
  const src = path.join(root, name)
  await fs.mkdir(path.join(src, 'dist'), { recursive: true })
  await fs.writeFile(path.join(src, 'dist', 'index.js'), 'export {}\n')
  await fs.cp(path.join(PACKAGE_GOLDENS, 'codex', 'bundles', 'codex'), path.join(src, 'bundles', 'codex'), { recursive: true })
  const pj = path.join(src, 'bundles', 'codex', 'plugins', 'dethereal', '.codex-plugin', 'plugin.json')
  await fs.writeFile(pj, (await fs.readFile(pj, 'utf8')).replace(/"version": "[^"]+"/, `"version": "${version}"`))
  return src
}
/**
 * What Codex 0.157 does to our table on `codex mcp add zz -- /usr/bin/true`, as captured: the opening
 * marker dropped, the table re-serialized where it was (env as a sub-table, the timeouts as floats,
 * the approvals after it), and the new server right after it, inside our block.
 */
function codexRewrite(text: string): string {
  const d = (parseToml(text) as { mcp_servers: { dethereal: Record<string, unknown> } }).mcp_servers.dethereal
  const out: string[] = []
  let ours = false
  let at = -1
  for (const l of text.split('\n')) {
    if (l === '# >>> dethereal managed >>>') continue
    const h = /^\[(.+)\]\s*$/.exec(l)
    if (h) {
      ours = h[1]!.startsWith('mcp_servers.dethereal')
      if (ours && at < 0) at = out.length
    } else if (l.startsWith('# <<<')) ours = false
    if (!ours) out.push(l)
  }
  const list = (a: unknown) => `[${(a as string[]).map((x) => JSON.stringify(x)).join(', ')}]`
  const float = (n: unknown) => (Number.isInteger(n) ? `${n as number}.0` : String(n))
  const tools = d.tools as Record<string, Record<string, string>>
  out.splice(at, 0,
    '[mcp_servers.dethereal]', `command = ${JSON.stringify(d.command)}`, `args = ${list(d.args)}`, `env_vars = ${list(d.env_vars)}`,
    `startup_timeout_sec = ${float(d.startup_timeout_sec)}`, `tool_timeout_sec = ${float(d.tool_timeout_sec)}`, `default_tools_approval_mode = ${JSON.stringify(d.default_tools_approval_mode)}`, '',
    '[mcp_servers.dethereal.env]', ...Object.entries(d.env as Record<string, string>).map(([k, v]) => `${k} = ${JSON.stringify(v)}`), '',
    ...Object.keys(tools).flatMap((t) => [`[mcp_servers.dethereal.tools.${t}]`, `approval_mode = ${JSON.stringify(tools[t]!.approval_mode)}`, '']),
    '[mcp_servers.zz]', 'command = "/usr/bin/true"', '')
  return out.join('\n')
}

/** A Codex bundle whose server table is the shape an older install wrote: the URL pinned in DETHERNETY_URL. */
async function oldShapeSource(version: string): Promise<string> {
  const src = await runtimeSource(version, `src-old-${version}`)
  const f = path.join(src, 'bundles', 'codex', 'config.fragment.toml')
  const text = await fs.readFile(f, 'utf8')
  const old = text.replace('env = { DETHERNETY_PLATFORM_URL = "<platform-url>" }', 'env = { DETHERNETY_URL = "<platform-url>" }').replace(', "DETHERNETY_URL"]', ']')
  if (old === text || old.includes('DETHERNETY_PLATFORM_URL')) throw new Error('the fragment changed shape: update this helper')
  await fs.writeFile(f, old)
  return src
}
const runtimes = new Map<string, InstalledRuntime>()
async function runtime(version: string): Promise<InstalledRuntime> {
  if (!runtimes.has(version)) runtimes.set(version, await installRuntime(paths, env, await runtimeSource(version), version))
  return runtimes.get(version)!
}

const install = (version: string, extra: Partial<{ scope: 'user' | 'project'; project: string; platformUrl: string }> = {}) =>
  runtime(version).then((rt) => withStateLock(paths, env, (lock) => installCodex({
    ctx: { paths, env, lock }, scope: extra.scope ?? 'user', project: extra.project, platformUrl: extra.platformUrl ?? 'https://platform.example',
    runtime: { version: rt.version, runtimePath: rt.runtimePath }, node: process.execPath,
  })))
const uninstall = (scope: 'user' | 'project' = 'user', project?: string) => withStateLock(paths, env, (lock) => uninstallCodex({ ctx: { paths, env, lock }, scope, project }))
const agentsIn = (dir: string) => fs.readdir(dir).then((n) => n.filter((x) => x.startsWith('dethereal-')).sort(), () => [] as string[])

beforeAll(async () => {
  // Inside the package: the harness runner never takes a binary from a temp directory.
  root = await fs.realpath(await fs.mkdtemp(path.join(PKG_ROOT, '.test-codex-writer-')))
  bin = path.join(root, 'bin')
  await fs.mkdir(bin)
  await fs.copyFile(path.join(path.dirname(new URL(import.meta.url).pathname), 'fake-codex.mjs'), path.join(bin, 'codex.mjs'))
  await fs.writeFile(path.join(bin, 'codex'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'codex.mjs'))} "$@"\n`, { mode: 0o755 })
  process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`
})
afterAll(async () => {
  process.env.PATH = savedPath
  await fs.chmod(root, 0o700)
  if (process.env.KEEP_CODEX_WRITER) return
  await fs.rm(root, { recursive: true, force: true }).catch(async () => {
    // runtime copies are read-only
    await fs.chmod(root, 0o700)
  })
})

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codex-writer-home-')))
  codexHome = path.join(home, '.codex')
  await fs.mkdir(codexHome, { mode: 0o700 })
  env = { home, vars: { HOME: home, CODEX_HOME: codexHome }, euid: process.geteuid!(), platform: process.platform }
  paths = (await ensureStateRoot(env)).paths
  runtimes.clear()
  await fs.rm(path.join(bin, "log.jsonl"), { force: true }); await fs.rm(path.join(bin, "errors.log"), { force: true })
  await writeControl({})
})
afterEach(async () => {
  for (const p of [paths.runtime]) await fs.chmod(p, 0o700).catch(() => undefined)
  const { execFileSync } = await import('node:child_process')
  execFileSync('chmod', ['-R', 'u+w', home])
  await fs.rm(home, { recursive: true, force: true })
})

describe('the Codex writer', { timeout: 60_000 }, () => {
  it('installs user-wide: the server block, the agents, then the plugin through the CLI', async () => {
    const before = 'model = "x"\n'
    await fs.writeFile(cfgPath(), before)
    const r = await install('0.5.0')
    expect(r.scope).toBe('user')
    const text = await cfg()
    expect(text.startsWith(before)).toBe(true)
    expect(text).toContain('# >>> dethereal managed >>>')
    expect(text).toContain('[mcp_servers.dethereal]')
    expect(text).toContain(`command = ${JSON.stringify(process.execPath)}`)
    expect(text).toContain(`${path.join(paths.runtime, '0.5.0')}/dist/index.js`)
    // The install URL is a default: a DETHERNETY_URL in Codex's environment passes through and wins.
    expect(text).toContain('env = { DETHERNETY_PLATFORM_URL = "https://platform.example" }')
    expect(text).toMatch(/env_vars = \[[^\]]*"DETHERNETY_URL"[^\]]*\]/)
    expect(text).not.toMatch(/DETHERNETY_URL = /)
    expect(text).toContain('[plugins."dethereal@dethereal-local"]')
    expect(text).toContain(`source = "${path.join(paths.runtime, '0.5.0', 'bundles', 'codex')}"`)
    expect(await agentsIn(path.join(codexHome, 'agents'))).toHaveLength(6)
    const { manifest } = await readManifest(paths, env)
    expect(manifest.installs['codex:user']?.runtimes).toEqual(['0.5.0'])
    expect((manifest.shared as Record<string, unknown>).codex).toMatchObject({ marketplace: { runtimeVersion: '0.5.0', state: 'done' }, plugin: { state: 'done' } })
    // the CLI ran last, and only through the plugin commands
    const order = (await calls()).map((a) => ((w) => w.slice(0, w[1] === 'marketplace' ? 3 : 2).join(' '))(a.filter((x) => !x.startsWith('--'))))
    expect(order.slice(-3)).toEqual(['plugin marketplace add', 'plugin add', 'plugin list'])
  })

  it('uninstalls back to the file as it was, with the plugin and agents gone', async () => {
    const before = 'model = "x"\n\n[projects."/tmp/a"]\ntrust_level = "trusted"\n'
    await fs.writeFile(cfgPath(), before)
    await install('0.5.0')
    const r = await uninstall()
    expect(r.manual).toEqual([])
    expect(r.pluginRemoved).toBe(true)
    expect(await cfg()).toBe(before)
    expect(await fs.readdir(codexHome)).toEqual(['config.toml'])
    const { manifest } = await readManifest(paths, env)
    expect(manifest.installs['codex:user']).toBeUndefined()
    expect((manifest.shared as Record<string, unknown> | undefined)?.codex).toBeUndefined()
  })

  it('upgrades: one block, the marketplace moved to the new runtime, user edits to owned values reported', async () => {
    await install('0.5.0')
    await fs.writeFile(cfgPath(), (await cfg()).replace('tool_timeout_sec = 120', 'tool_timeout_sec = 300'))
    const r = await install('0.5.1')
    expect(r.reset).toEqual(['tool_timeout_sec'])
    const text = await cfg()
    expect(text.match(/# >>> dethereal managed >>>/g)).toHaveLength(1)
    expect(text).toContain('tool_timeout_sec = 120')
    expect(text).toContain(`source = "${path.join(paths.runtime, '0.5.1', 'bundles', 'codex')}"`)
    const order = (await calls()).map((a) => ((w) => w.slice(0, w[1] === 'marketplace' ? 3 : 2).join(' '))(a.filter((x) => !x.startsWith('--'))))
    expect(order).toContain('plugin marketplace remove')
    const { manifest } = await readManifest(paths, env)
    expect(manifest.installs['codex:user']?.runtimes).toEqual(['0.5.1'])
  })

  it.each([['plugin marketplace add'], ['plugin add']])('rolls an upgrade back when `codex %s` fails', async (failing) => {
    await install('0.5.0')
    const configBefore = await cfg()
    const agentsBefore = await Promise.all((await agentsIn(path.join(codexHome, 'agents'))).map((n) => fs.readFile(path.join(codexHome, 'agents', n), 'utf8')))
    await runtime('0.5.1')
    await writeControl({ fail: [failing], once: true })
    await expect(install('0.5.1')).rejects.toMatchObject({ code: 'harness_cli_failed' })
    await writeControl({})
    expect(await cfg()).toBe(configBefore)
    expect(await Promise.all((await agentsIn(path.join(codexHome, 'agents'))).map((n) => fs.readFile(path.join(codexHome, 'agents', n), 'utf8')))).toEqual(agentsBefore)
    const { manifest } = await readManifest(paths, env)
    expect(manifest.installs['codex:user']?.version).toBe('0.5.0')
    expect(manifest.installs['codex:user']?.runtimes).toEqual(['0.5.0'])
    // and it still uninstalls cleanly
    expect((await uninstall()).manual).toEqual([])
  })

  it('rolls a first install back to nothing when the plugin step fails', async () => {
    const before = 'model = "x"\n'
    await fs.writeFile(cfgPath(), before)
    await writeControl({ fail: ['plugin add'] })
    await expect(install('0.5.0')).rejects.toMatchObject({ code: 'harness_cli_failed' })
    expect(await cfg()).toBe(before)
    expect(await agentsIn(path.join(codexHome, 'agents'))).toEqual([])
    const { manifest } = await readManifest(paths, env)
    expect(manifest.installs['codex:user']).toBeUndefined()
  })

  it('refuses what it did not write: a server table, an agent file, a marketplace of the same name, another Dethereal plugin', async () => {
    await fs.writeFile(cfgPath(), '[mcp_servers.dethereal]\ncommand = "x"\n')
    await expect(install('0.5.0')).rejects.toMatchObject({ code: 'conflict' })
    await fs.writeFile(cfgPath(), '')
    await fs.mkdir(path.join(codexHome, 'agents'), { recursive: true })
    await fs.writeFile(path.join(codexHome, 'agents', 'dethereal-model-reviewer.toml'), 'name = "mine"\n')
    await expect(install('0.5.0')).rejects.toMatchObject({ code: 'conflict' })
    await fs.rm(path.join(codexHome, 'agents'), { recursive: true })
    await fs.writeFile(cfgPath(), '[marketplaces.dethereal-local]\nsource_type = "local"\nsource = "/somewhere/else"\n')
    await expect(install('0.5.0')).rejects.toMatchObject({ code: 'conflict' })
    await fs.writeFile(cfgPath(), '')
    await writeControl({ otherPlugins: [{ pluginId: 'dethereal@elsewhere', name: 'dethereal', marketplaceName: 'elsewhere' }] })
    await expect(install('0.5.0')).rejects.toMatchObject({ code: 'conflict' })
    expect(await cfg()).toBe('')
  })

  it('refuses a Codex older than the version it was checked against', async () => {
    await writeControl({ version: '0.156.1' })
    await expect(install('0.5.0')).rejects.toMatchObject({ code: 'harness_cli_refused' })
  })

  it('installs into a project only when Codex trusts it, and shares the plugin', async () => {
    const proj = path.join(home, 'work', 'proj')
    await fs.mkdir(proj, { recursive: true })
    const untrusted = await install('0.5.0', { scope: 'project', project: proj })
    expect(untrusted.scope).toBe('user')
    expect(untrusted.notices.join(' ')).toMatch(/does not trust this project/)
    await uninstall()
    // Trust on a folder above a project that is not a git root does not reach it: Codex would not load its .codex/.
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(path.join(home, 'work'))}]\ntrust_level = "trusted"\n`)
    const above = await install('0.5.0', { scope: 'project', project: proj })
    expect(above.scope).toBe('user')
    expect(above.notices.join(' ')).toMatch(/does not trust this project/)
    await uninstall()
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(proj)}]\ntrust_level = "trusted"\n`)
    await install('0.5.0')
    const trusted = await install('0.5.0', { scope: 'project', project: proj })
    expect(trusted.scope).toBe('project')
    expect(await fs.readFile(path.join(proj, '.codex', 'config.toml'), 'utf8')).toContain('[mcp_servers.dethereal]')
    expect(await agentsIn(path.join(proj, '.codex', 'agents'))).toHaveLength(6)
    // removing the project keeps the plugin the user entry still uses, and leaves no empty folders behind
    const r = await uninstall('project', proj)
    expect(r.pluginRemoved).toBe(false)
    expect(await fs.readdir(proj)).toEqual([])
    expect(await cfg()).toContain('[plugins."dethereal@dethereal-local"]')
    expect((await uninstall()).pluginRemoved).toBe(true)
  })

  it('takes over its own marketplace whose runtime folder is gone', async () => {
    await install('0.5.0')
    const gone = path.join(paths.runtime, '0.5.0')
    const { execFileSync } = await import('node:child_process')
    execFileSync('chmod', ['-R', 'u+w', gone])
    await fs.rm(gone, { recursive: true })
    runtimes.clear()
    await install('0.5.1')
    expect(await cfg()).toContain(`source = "${path.join(paths.runtime, '0.5.1', 'bundles', 'codex')}"`)
  })

  it('counts the hook trust Codex keeps, and revokes only ours with the last uninstall', async () => {
    const before = 'model = "x"\n\n[hooks.state."other@market:hooks/hooks.json:session_start:0:0"]\ntrusted_hash = "sha256:other"\n'
    await fs.writeFile(cfgPath(), before)
    await install('0.5.0')
    const keys = ['startup', 'resume'].map((s, i) => `[hooks.state."dethereal@dethereal-local:hooks/hooks.json:session_start:${i}:0"]\ntrusted_hash = "sha256:${s}"\n`)
    await fs.appendFile(cfgPath(), `\n${keys.join('\n')}`)
    expect(codexHookTrust(Buffer.from(await cfg()))).toMatchObject({ trusted: 2, expected: 8 })
    const r = await uninstall()
    expect(r.hookTrustRemoved).toHaveLength(2)
    expect(r.hookTrust).toEqual([])
    // the blank lines around entries Codex added are not ours to take out
    const solid = (t: string) => t.split('\n').filter((l) => l.trim()).join('\n')
    expect(solid(await cfg())).toBe(solid(before))
    expect(codexHookTrust(null)).toMatchObject({ trusted: 0, expected: 8 })
  })

  it('never runs a codex found on a PATH entry inside the project', async () => {
    const proj = path.join(home, 'planted')
    await fs.mkdir(path.join(proj, 'bin'), { recursive: true })
    const marker = path.join(home, 'planted-ran')
    await fs.writeFile(path.join(proj, 'bin', 'codex'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 })
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(proj)}]\ntrust_level = "trusted"\n`)
    process.env.PATH = `${path.join(proj, 'bin')}${path.delimiter}${bin}${path.delimiter}${savedPath ?? ''}`
    try {
      expect((await install('0.5.0', { scope: 'project', project: proj })).scope).toBe('project')
      await uninstall('project', proj)
    } finally {
      process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`
    }
    await expect(fs.stat(marker)).rejects.toThrow()
  })

  it('forgets a project whose folder is gone, and keeps the user entry', async () => {
    const proj = path.join(home, 'gone-proj')
    await fs.mkdir(proj)
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(proj)}]\ntrust_level = "trusted"\n`)
    await install('0.5.0')
    expect((await install('0.5.0', { scope: 'project', project: proj })).scope).toBe('project')
    await fs.rm(proj, { recursive: true })
    await expect(uninstall('project', proj)).rejects.toMatchObject({ code: 'io' })
    const r = await withStateLock(paths, env, (lock) => uninstallCodex({ ctx: { paths, env, lock }, scope: 'project', project: proj, forgetMissingProject: true }))
    expect(r.forgotten).toBe(true)
    expect(r.pluginRemoved).toBe(false)
    const { manifest } = await readManifest(paths, env)
    expect(Object.keys(manifest.installs)).toEqual(['codex:user'])
  })

  it('reads hook trust as Codex keeps it: switched-off hooks, the feature flags, and profiles on their own', () => {
    const entry = (i: number, extra = '') => `[hooks.state."dethereal@dethereal-local:hooks/hooks.json:session_start:${i}:0"]\ntrusted_hash = "sha256:x"\n${extra}`
    const all = Array.from({ length: 8 }, (_, i) => entry(i)).join('\n')
    expect(codexHookTrust(Buffer.from(all))).toMatchObject({ trusted: 8, disabled: 0, featuresOff: false, hashesVerified: false, profiles: [] })
    expect(codexHookTrust(Buffer.from(all.replace(entry(0), entry(0, 'enabled = false\n'))))).toMatchObject({ trusted: 7, disabled: 1 })
    expect(codexHookTrust(Buffer.from(`[features]\nhooks = false\n\n${all}`))).toMatchObject({ trusted: 0, featuresOff: true })
    expect(codexHookTrust(Buffer.from(`[features]\nplugins = false\n\n${all}`))).toMatchObject({ trusted: 0, featuresOff: true })
    // trust saved by a run with a profile counts only for that profile
    expect(codexHookTrust(Buffer.from(''), [{ name: 'work', bytes: Buffer.from(all) }])).toMatchObject({ trusted: 0, profiles: [{ name: 'work', trusted: 8, disabled: 0 }] })
  })

  it('lists the app-server versions Codex installed for this user, from folder names only', async () => {
    expect(codexAppServerVersions(codexHome)).toEqual([])
    for (const n of ['0.160.0-aarch64-apple-darwin', '0.157.0-x86_64-apple-darwin', 'junk']) await fs.mkdir(path.join(codexHome, 'packages', 'app-server-daemon', 'releases', n), { recursive: true })
    expect(codexAppServerVersions(codexHome)).toEqual(['0.157.0', '0.160.0'])
  })

  describe('project trust, by the rule Codex uses to load a project\'s .codex/ folder', () => {
    let t: string
    const level = (entries: Record<string, 'trusted' | 'untrusted'>, extra: Record<string, unknown> = {}) =>
      ({ ...extra, projects: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { trust_level: v }])) })
    beforeEach(async () => {
      t = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codex-trust-')))
      // repo/ is a git root with a subfolder; wt/ is a linked worktree of repo/; plain/ is no git folder at all.
      await fs.mkdir(path.join(t, 'repo', '.git', 'worktrees', 'wt'), { recursive: true })
      await fs.mkdir(path.join(t, 'repo', 'sub', 'deep'), { recursive: true })
      await fs.mkdir(path.join(t, 'wt'), { recursive: true })
      await fs.writeFile(path.join(t, 'wt', '.git'), `gitdir: ${path.join(t, 'repo', '.git', 'worktrees', 'wt')}\n`)
      await fs.writeFile(path.join(t, 'repo', '.git', 'worktrees', 'wt', 'commondir'), '../..\n')
      await fs.mkdir(path.join(t, 'plain', 'child'), { recursive: true })
    })
    afterEach(() => fs.rm(t, { recursive: true, force: true }))

    it('the folder\'s own setting decides, either way', () => {
      expect(projectTrusted(level({ [path.join(t, 'repo')]: 'trusted' }), path.join(t, 'repo'))).toBe(true)
      expect(projectTrusted(level({ [path.join(t, 'repo')]: 'trusted', [path.join(t, 'repo', 'sub')]: 'untrusted' }), path.join(t, 'repo', 'sub'))).toBe(false)
      expect(projectTrusted(level({ [path.join(t, 'plain', 'child')]: 'trusted' }), path.join(t, 'plain', 'child'))).toBe(true)
    })
    it('a subfolder of a git root follows the root', () => {
      expect(projectTrusted(level({ [path.join(t, 'repo')]: 'trusted' }), path.join(t, 'repo', 'sub', 'deep'))).toBe(true)
      expect(projectTrusted(level({ [path.join(t, 'repo')]: 'untrusted' }), path.join(t, 'repo', 'sub'))).toBe(false)
    })
    it('a setting on a folder above the git root, or below the folder, does not count', () => {
      expect(projectTrusted(level({ [t]: 'trusted' }), path.join(t, 'repo'))).toBe(false)
      expect(projectTrusted(level({ [path.join(t, 'repo', 'sub', 'deep')]: 'trusted' }), path.join(t, 'repo'))).toBe(false)
    })
    it('a folder that is no git root never inherits from a folder above', () => {
      expect(projectTrusted(level({ [path.join(t, 'plain')]: 'trusted' }), path.join(t, 'plain', 'child'))).toBe(false)
    })
    it('a linked worktree follows its main checkout, unless it has its own setting', () => {
      expect(projectTrusted(level({}), path.join(t, 'wt'))).toBe(false)
      expect(projectTrusted(level({ [path.join(t, 'repo')]: 'trusted' }), path.join(t, 'wt'))).toBe(true)
      expect(projectTrusted(level({ [path.join(t, 'wt')]: 'trusted' }), path.join(t, 'wt'))).toBe(true)
      expect(projectTrusted(level({ [path.join(t, 'repo')]: 'trusted', [path.join(t, 'wt')]: 'untrusted' }), path.join(t, 'wt'))).toBe(false)
    })
    it('matches a setting written through a symlinked path', async () => {
      await fs.symlink(path.join(t, 'repo'), path.join(t, 'link'))
      expect(projectTrusted(level({ [path.join(t, 'link')]: 'trusted' }), path.join(t, 'repo'))).toBe(true)
    })
    it('assumes nothing with project root markers other than Codex\'s default', () => {
      const trusted = { [path.join(t, 'repo')]: 'trusted' } as const
      expect(projectTrusted(level(trusted, { project_root_markers: ['.git'] }), path.join(t, 'repo', 'sub'))).toBe(true)
      expect(projectTrusted(level(trusted, { project_root_markers: ['.hg'] }), path.join(t, 'repo'))).toBe(false)
      expect(projectTrusted(level(trusted, { project_root_markers: [] }), path.join(t, 'repo'))).toBe(false)
    })
  })

  it('says the Codex plugin is user-wide, and to quit Codex, when it installs', async () => {
    const proj = path.join(home, 'notice-proj')
    await fs.mkdir(proj)
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(proj)}]\ntrust_level = "trusted"\n`)
    const r = await install('0.5.0', { scope: 'project', project: proj })
    expect(r.notices.join('\n')).toMatch(/user-wide/)
    expect(r.notices.join('\n')).toMatch(/Quit Codex/)
    expect(r.notices.join('\n')).toMatch(/\/hooks/)
    expect((await uninstall('project', proj)).notices.join('\n')).toMatch(/Quit Codex/)
  })

  it('still removes its files when Codex cannot remove the plugin, and says what is left', async () => {
    await install('0.5.0')
    await writeControl({ fail: ['plugin remove', 'plugin marketplace remove'] })
    const r = await uninstall()
    expect(r.pluginRemoved).toBe(false)
    expect(r.cliLeft.join('\n')).toMatch(/codex plugin remove dethereal@dethereal-local/)
    expect(r.cliLeft.join('\n')).toMatch(/codex plugin marketplace remove dethereal-local/)
    expect(r.manual).toEqual([])
    expect(await cfg()).not.toContain('[mcp_servers.dethereal]')
    expect(await agentsIn(path.join(codexHome, 'agents'))).toEqual([])
  })

  it('refuses an upgrade over an agent file the user edited, before touching anything', async () => {
    await install('0.5.0')
    const agent = path.join(codexHome, 'agents', 'dethereal-model-reviewer.toml')
    await fs.appendFile(agent, '\n# mine\n')
    const before = await cfg()
    await expect(install('0.5.1')).rejects.toMatchObject({ code: 'conflict' })
    expect(await cfg()).toBe(before)
    expect(await fs.readFile(agent, 'utf8')).toMatch(/# mine/)
    const { manifest } = await readManifest(paths, env)
    expect(manifest.installs['codex:user']?.version).toBe('0.5.0')
    expect(manifest.installs['codex:user']?.cli).toEqual({ harness: 'codex', state: 'done' })
  })

  it('forgets a missing project found through a symlinked parent, as the install recorded it', async () => {
    const real = path.join(home, 'real-parent')
    await fs.mkdir(path.join(real, 'proj'), { recursive: true })
    await fs.symlink(real, path.join(home, 'link-parent'))
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(path.join(real, 'proj'))}]\ntrust_level = "trusted"\n`)
    await install('0.5.0')
    expect((await install('0.5.0', { scope: 'project', project: path.join(home, 'link-parent', 'proj') })).scope).toBe('project')
    await fs.rm(path.join(real, 'proj'), { recursive: true })
    const r = await withStateLock(paths, env, (lock) => uninstallCodex({ ctx: { paths, env, lock }, scope: 'project', project: path.join(home, 'link-parent', 'proj'), forgetMissingProject: true }))
    expect(r.forgotten).toBe(true)
    const { manifest } = await readManifest(paths, env)
    expect(Object.keys(manifest.installs)).toEqual(['codex:user'])
  })

  it('lists the MCP servers as Codex sees them from a folder, its project layers merged key by key', async () => {
    const work = path.join(home, 'work')
    const redefined = path.join(work, 'redefined')
    const disabled = path.join(work, 'disabled')
    for (const d of [redefined, disabled]) await fs.mkdir(path.join(d, '.codex'), { recursive: true })
    // work/ is the project root its subfolders' layers are trusted through
    await fs.mkdir(path.join(work, '.git'))
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(work)}]\ntrust_level = "trusted"\n`)
    await install('0.5.0')
    await fs.writeFile(path.join(redefined, '.codex', 'config.toml'), '[mcp_servers.dethereal]\ncommand = "/elsewhere/node"\n')
    await fs.writeFile(path.join(disabled, '.codex', 'config.toml'), '[mcp_servers.dethereal]\nenabled = false\n')
    const at = async (cwd: string) => (await listMcpServers({ env, cwd })).find((s) => s.name === 'dethereal')
    expect(await at(home)).toMatchObject({ enabled: true, transport: { command: process.execPath, env: { DETHERNETY_PLATFORM_URL: 'https://platform.example' } } })
    expect(await at(redefined)).toMatchObject({ enabled: true, transport: { command: '/elsewhere/node', env: { DETHERNETY_PLATFORM_URL: 'https://platform.example' } } })
    expect(await at(disabled)).toMatchObject({ enabled: false, transport: { command: process.execPath } })
  })

  it('re-runs at the same version: an older install\'s pinned DETHERNETY_URL becomes the default', async () => {
    const old = await installRuntime(paths, env, await oldShapeSource('0.5.0'), '0.5.0')
    await withStateLock(paths, env, (lock) => installCodex({
      ctx: { paths, env, lock }, scope: 'user', platformUrl: 'https://old.example', runtime: { version: old.version, runtimePath: old.runtimePath }, node: process.execPath,
    }))
    expect(await cfg()).toContain('env = { DETHERNETY_URL = "https://old.example" }')
    // The same version again, from the current bundle: nothing short-circuits the rewrite.
    const current = await runtimeSource('0.5.0', 'src-current-0.5.0')
    const r = await withStateLock(paths, env, (lock) => installCodex({
      ctx: { paths, env, lock }, scope: 'user', platformUrl: 'https://old.example', runtime: { version: '0.5.0', runtimePath: current }, node: process.execPath,
    }))
    expect(r.reset).toEqual([])
    const text = await cfg()
    expect(text).toContain('env = { DETHERNETY_PLATFORM_URL = "https://old.example" }')
    expect(text).not.toMatch(/DETHERNETY_URL = /)
    expect(text.match(/# >>> dethereal managed >>>/g)).toHaveLength(1)
  })

  it('re-runs at the same version with another URL: the new one replaces the old', async () => {
    await install('0.6.0', { platformUrl: 'https://new.example' })
    await install('0.6.0', { platformUrl: 'https://newer.example' })
    const text = await cfg()
    expect(text).toContain('env = { DETHERNETY_PLATFORM_URL = "https://newer.example" }')
    expect(text).not.toContain('new.example"')
    expect((await uninstall()).manual).toEqual([])
  })

  it('reads back the URL an install set, only while the installer\'s part of the config is untouched', async () => {
    expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBeNull()
    await install('0.5.0', { platformUrl: 'https://kept.example' })
    expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBe('https://kept.example')
    await fs.writeFile(cfgPath(), (await cfg()).replace('tool_timeout_sec = 120', 'tool_timeout_sec = 300'))
    expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBeNull()
    // An older install's DETHERNETY_URL is read as its URL too.
    await uninstall()
    const old = await installRuntime(paths, env, await oldShapeSource('0.4.0'), '0.4.0')
    await withStateLock(paths, env, (lock) => installCodex({
      ctx: { paths, env, lock }, scope: 'user', platformUrl: 'https://older.example', runtime: { version: old.version, runtimePath: old.runtimePath }, node: process.execPath,
    }))
    expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBe('https://older.example')
    // A project: by its own entry, never the user's.
    const proj = path.join(home, 'work', 'proj')
    await fs.mkdir(proj, { recursive: true })
    expect(await installedCodexUrl({ env, paths, scope: { project: proj } })).toBeNull()
    // Codex rewrites the table when another server is added (an inline env becomes a sub-table, at the end): same values, still the install's.
    await install('0.5.0', { platformUrl: 'https://kept.example' })
    await fs.writeFile(cfgPath(), (await cfg()).replace('env = { DETHERNETY_PLATFORM_URL = "https://kept.example" }\n', '').replace(/(# <<< dethereal managed <<<)/, '[mcp_servers.dethereal.env]\nDETHERNETY_PLATFORM_URL = "https://kept.example"\n$1'))
    expect(await cfg()).toContain('[mcp_servers.dethereal.env]')
    expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBe('https://kept.example')
    await fs.writeFile(cfgPath(), (await cfg()).replace('DETHERNETY_PLATFORM_URL = "https://kept.example"', 'DETHERNETY_PLATFORM_URL = "https://edited.example"'))
    expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBeNull()
  })

  it('tells a project install when the user install still pins DETHERNETY_URL, which Codex would merge over the project\'s URL', async () => {
    const proj = path.join(home, 'work', 'proj')
    await fs.mkdir(proj, { recursive: true })
    await fs.writeFile(cfgPath(), `[projects.${JSON.stringify(proj)}]\ntrust_level = "trusted"\n`)
    const old = await installRuntime(paths, env, await oldShapeSource('0.4.0'), '0.4.0')
    await withStateLock(paths, env, (lock) => installCodex({
      ctx: { paths, env, lock }, scope: 'user', platformUrl: 'https://older.example', runtime: { version: old.version, runtimePath: old.runtimePath }, node: process.execPath,
    }))
    const NOTICE = /still sets DETHERNETY_URL .* install again for your user/
    const project = await install('0.5.0', { scope: 'project', project: proj, platformUrl: 'https://project.example' })
    expect(project.scope).toBe('project')
    expect(project.notices.join(' ')).toMatch(NOTICE)
    expect(await installedCodexUrl({ env, paths, scope: { project: proj } })).toBe('https://project.example')
    await install('0.5.0')
    expect((await install('0.5.0', { scope: 'project', project: proj })).notices.join(' ')).not.toMatch(NOTICE)
  })

  describe('after Codex rewrote its table (another MCP server added)', () => {
    const before = 'model = "x"\n'
    const rewritten = async () => {
      await fs.writeFile(cfgPath(), before)
      await install('0.5.0', { platformUrl: 'https://kept.example' })
      await fs.writeFile(cfgPath(), codexRewrite(await cfg()))
      const text = await cfg()
      expect(text).not.toContain('# >>> dethereal managed >>>')
      expect(text).toContain('[mcp_servers.dethereal.env]')
      expect(text).toContain('startup_timeout_sec = 30.0')
    }
    const others = async () => {
      const doc = parseToml(await cfg()) as Record<string, Record<string, unknown>>
      return { model: doc.model, servers: Object.keys(doc.mcp_servers ?? {}).sort() }
    }

    it('re-installs: its table taken out by name, the other server kept, nothing reported as the user\'s edit', async () => {
      await rewritten()
      expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBe('https://kept.example')
      const r = await install('0.5.1', { platformUrl: 'https://kept.example' })
      expect(r.reset).toEqual([])
      const text = await cfg()
      expect(text.match(/# >>> dethereal managed >>>/g)).toHaveLength(1)
      expect(text.match(/# <<< dethereal managed <<</g)).toHaveLength(1)
      expect(text.match(/^\[mcp_servers\.dethereal\]$/gm)).toHaveLength(1)
      expect(await others()).toEqual({ model: 'x', servers: ['dethereal', 'zz'] })
      expect((await uninstall()).manual).toEqual([])
      expect(await others()).toEqual({ model: 'x', servers: ['zz'] })
    })

    it('uninstalls: its table and both marker lines go, the other server and the user\'s lines stay', async () => {
      await rewritten()
      const r = await uninstall()
      expect(r.manual).toEqual([])
      const text = await cfg()
      expect(text).not.toMatch(/dethereal/)
      expect(text.startsWith(before)).toBe(true)
      expect(await others()).toEqual({ model: 'x', servers: ['zz'] })
    })

    it('refuses, and says what to do, when the rewritten table was also changed', async () => {
      await rewritten()
      await fs.writeFile(cfgPath(), (await cfg()).replace('tool_timeout_sec = 120.0', 'tool_timeout_sec = 300.0'))
      const changed = await cfg()
      expect(await installedCodexUrl({ env, paths, scope: 'user' })).toBeNull()
      await expect(install('0.5.1')).rejects.toMatchObject({ code: 'conflict', label: expect.stringMatching(/changed since the install, and its managed-block markers are gone or moved .* remove \[mcp_servers\.dethereal\] and its sub-tables/) })
      expect(await cfg()).toBe(changed)
      const u = await uninstall()
      expect(u.manual).toEqual([expect.objectContaining({ path: cfgPath(), outcome: 'manual' })])
      expect(u.notices.join(' ')).toMatch(/config\.toml: .*changed since the install.* then uninstall again/)
      // the table is left to the user as it was (the plugin's own tables went through Codex's CLI)
      const table = (t: string) => (parseToml(t) as { mcp_servers: Record<string, unknown> }).mcp_servers.dethereal
      expect(table(await cfg())).toEqual(table(changed))
    })
  })

  it('never takes the codex binary from a node_modules folder on PATH', () => {
    expect(readFileSync(path.join(bin, 'codex'), 'utf8')).toContain('codex.mjs')
  })
})
