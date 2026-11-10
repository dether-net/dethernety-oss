/**
 * The Claude writer against a fake `claude` that behaves as Claude Code did when
 * probed. Every folder sits inside the package (the runner never takes a binary
 * from a temp directory, and a local marketplace may not live in one).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readManifest } from '../../../core/manifest.js'
import { ensureStateRoot, type InstallerEnv } from '../../../core/paths.js'
import { sha256 } from '../../../core/safe-write.js'
import type { TxContext } from '../../../core/transaction.js'
import { runInstaller } from '../../../cli/index.js'
import { checkMarketplaceDir, installClaude, normalisePlatformUrl, uninstallClaude } from '../index.js'
import { fakeCalls, fakeState, installFakeClaude, setControl, setState } from './fake-claude.js'

let root: string
let seq = 0
let home: string
let pkg: string
let env: InstallerEnv
let ctx: TxContext
const savedPath = process.env.PATH

/** A package as the installer ships in: a version, a plugin manifest with its default URL, a server build. */
async function makePackage(dir: string, version: string, server = 'export const server = 1\n'): Promise<string> {
  await fs.mkdir(path.join(dir, 'dist'), { recursive: true, mode: 0o755 })
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true, mode: 0o755 })
  await fs.mkdir(path.join(dir, 'bundles', 'claude', 'hooks'), { recursive: true, mode: 0o755 })
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@dether.net/dethereal', version }))
  await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dethereal', version, userConfig: { platform_url: { type: 'string', default: 'http://localhost:3003' } } }))
  await fs.writeFile(path.join(dir, 'dist', 'index.js'), server)
  await fs.writeFile(path.join(dir, 'bundles', 'claude', 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [], PostToolUse: [], PreToolUse: [] } }))
  return dir
}

/** A local marketplace with our plugin in it, loaded in place. */
async function makeMarketplace(dir: string, name = 'local-rc', plugin: unknown = { name: 'dethereal', source: './dethereal' }): Promise<string> {
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true, mode: 0o755 })
  await fs.writeFile(path.join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name, owner: { name: 't' }, plugins: [plugin] }))
  await makePackage(path.join(dir, 'dethereal'), '0.5.0')
  return dir
}

const manifest = async () => (await readManifest(ctx.paths, env)).manifest
const settings = async () => JSON.parse(await fs.readFile(path.join(home, '.claude', 'settings.json'), 'utf8').catch(() => '{}'))
const mutating = (calls: Array<{ args: string[] }>) => calls.filter((c) => !['--version', 'list'].some((x) => c.args.includes(x)) && !(c.args[1] === 'marketplace' && c.args[2] === 'list'))

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(process.cwd(), '.test-claude-')))
  await installFakeClaude(path.join(root, 'bin'))
  process.env.PATH = [path.join(root, 'bin'), savedPath].join(path.delimiter)
})

afterAll(async () => {
  process.env.PATH = savedPath
  await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  const t = path.join(root, `t${seq++}`)
  home = path.join(t, 'home')
  await fs.mkdir(home, { recursive: true, mode: 0o700 })
  pkg = await makePackage(path.join(t, 'pkg'), '0.5.0')
  env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
  ctx = { paths: (await ensureStateRoot(env)).paths, env }
  // The official marketplace serves this package's version, from an npm copy of it.
  await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg } })
})

describe('installing from the official marketplace', () => {
  it('adds the marketplace, installs at the default URL, records it, and undoes exactly that', async () => {
    const report = await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    expect(report).toMatchObject({ id: 'dethereal@dether.net', plugin: 'installed', adopted: false, marketplace: { name: 'dether.net', added: true }, url: { value: 'http://localhost:3003', source: 'default' } })
    const m = await manifest()
    expect(m.shared?.claude).toMatchObject({ claudeVersion: '2.1.287', marketplace: { name: 'dether.net', source: { kind: 'github', repo: 'dether-net/claude-plugins' }, added: true, state: 'done' }, config: { previous: null, current: 'http://localhost:3003' } })
    expect(m.installs['claude:user']).toMatchObject({ version: '0.5.0', cli: { harness: 'claude', id: 'dethereal@dether.net', preexisting: false, state: 'done' } })
    // The settings file Claude wrote is recorded as Claude's, from its state before the install.
    const settingsFile = path.join(home, '.claude', 'settings.json')
    expect(m.installs['claude:user']!.files).toEqual([expect.objectContaining({ path: settingsFile, writer: 'cli', pre: 'absent', post: sha256(await fs.readFile(settingsFile)) })])
    expect(await settings()).toMatchObject({ enabledPlugins: { 'dethereal@dether.net': true }, pluginConfigs: { 'dethereal@dether.net': { options: { platform_url: 'http://localhost:3003' } } } })

    const calls = await fakeCalls(home)
    expect(mutating(calls).map((c) => c.args)).toEqual([
      ['plugin', 'marketplace', 'add', 'dether-net/claude-plugins', '--json'],
      ['plugin', 'install', 'dethereal@dether.net', '--scope', 'user', '--config', 'platform_url=http://localhost:3003', '--json'],
    ])
    // No user-scope command runs inside a project.
    expect(new Set(calls.map((c) => c.cwd))).toEqual(new Set([path.parse(process.cwd()).root]))

    const un = await uninstallClaude({ ctx, scope: 'user' })
    expect(un).toMatchObject({ plugin: 'uninstalled', marketplace: 'removed' })
    expect(await manifest()).toEqual({ schemaVersion: 1, installs: {}, shared: {} })
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
    expect(await settings()).toEqual({ extraKnownMarketplaces: {}, enabledPlugins: {}, pluginConfigs: {} })
  })

  it('keeps the first install\'s record on a second one, so uninstall still removes everything it added', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    const again = await installClaude({ ctx, packageRoot: pkg, scope: 'user', platformUrl: 'https://platform.example/' })
    expect(again).toMatchObject({ plugin: 'up_to_date', adopted: false, marketplace: { added: false }, url: { value: 'https://platform.example', source: 'flag' } })
    const m = await manifest()
    expect(m.shared?.claude?.marketplace.added).toBe(true)
    expect(m.shared?.claude?.config).toEqual({ previous: null, current: 'https://platform.example' })
    expect(m.installs['claude:user']!.cli).toMatchObject({ preexisting: false })
    expect(m.installs['claude:user']!.files[0]!.pre).toBe('absent')
    await uninstallClaude({ ctx, scope: 'user' })
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
    expect((await manifest()).installs).toEqual({})
  })

  it('leaves an earlier install working when a re-install fails, still recorded and uninstallable', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { 'plugin update': 'exit' } })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_failed' })
    expect((await fakeState(home)).plugins).toEqual([expect.objectContaining({ id: 'dethereal@dether.net', scope: 'user', enabled: true })])
    expect((await manifest()).installs['claude:user']!.cli).toMatchObject({ preexisting: false, state: 'done' })
    expect(Object.keys((await fakeState(home)).marketplaces)).toEqual(['dether.net'])
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg } })
    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ plugin: 'uninstalled', marketplace: 'removed' })
  })

  it('records the marketplace as its own again when a later install has to add it back', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    const project = path.join(home, '..', 'p2')
    await fs.mkdir(project)
    await setState(home, { ...(await fakeState(home)), marketplaces: {} })
    const m = JSON.parse(await fs.readFile(ctx.paths.manifest, 'utf8'))
    m.shared.claude.marketplace.added = false
    await fs.writeFile(ctx.paths.manifest, JSON.stringify(m))
    expect((await installClaude({ ctx, packageRoot: pkg, scope: 'project', project })).marketplace.added).toBe(true)
    expect((await manifest()).shared!.claude!.marketplace.added).toBe(true)
  })

  it('shares the marketplace and the URL across scopes, and lets them go with the last entry', async () => {
    const project = path.join(home, '..', 'project')
    await fs.mkdir(project)
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    await installClaude({ ctx, packageRoot: pkg, scope: 'project', project })
    const calls = await fakeCalls(home)
    const projectCalls = calls.filter((c) => c.args.includes('project'))
    expect(projectCalls.map((c) => c.cwd)).toEqual(projectCalls.map(() => project))
    // The user-wide commands of a project install (the version, the lists, the marketplace) never run in the project.
    expect(new Set(calls.filter((c) => !c.args.includes('project')).map((c) => c.cwd))).toEqual(new Set([path.parse(process.cwd()).root]))
    expect(calls.some((c) => c.args.join(' ') === 'plugin marketplace update dether.net --json')).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(project, '.claude', 'settings.json'), 'utf8'))).toEqual({ enabledPlugins: { 'dethereal@dether.net': true } })

    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ plugin: 'uninstalled', marketplace: 'kept' })
    expect(Object.keys((await fakeState(home)).marketplaces)).toEqual(['dether.net'])
    expect((await manifest()).shared?.claude).toBeDefined()
    expect(await uninstallClaude({ ctx, scope: 'project', project })).toMatchObject({ plugin: 'uninstalled', marketplace: 'removed' })
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
    expect((await manifest()).shared).toEqual({})
  })
})

describe('a plugin that was already there', () => {
  beforeEach(async () => {
    const cache = path.join(home, '.claude', 'plugins', 'cache', 'dether.net', 'dethereal', '0.4.9')
    await fs.cp(pkg, cache, { recursive: true })
    await setState(home, {
      marketplaces: { 'dether.net': { source: 'github', repo: 'dether-net/claude-plugins' } },
      plugins: [{ id: 'dethereal@dether.net', scope: 'user', version: '0.4.9', enabled: false, installPath: cache }],
    })
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'dethereal@dether.net': false }, pluginConfigs: { 'dethereal@dether.net': { options: { platform_url: 'http://mine.example' } } } }))
  })

  it('is adopted: updated, its URL set, and on uninstall left installed, disabled again, with its own URL back', async () => {
    const report = await installClaude({ ctx, packageRoot: pkg, scope: 'user', platformUrl: 'http://new.example' })
    expect(report).toMatchObject({ plugin: 'updated', adopted: true, marketplace: { added: false } })
    expect((await manifest()).installs['claude:user']!.cli).toMatchObject({ preexisting: { version: '0.4.9', enabled: false } })
    expect((await manifest()).shared!.claude!.config).toEqual({ previous: 'http://mine.example', current: 'http://new.example' })
    // Updated and re-enabled by the install: the settings must say enabled for the install to count.
    const un = await uninstallClaude({ ctx, scope: 'user' })
    expect(un).toMatchObject({ plugin: 'kept', marketplace: 'not_ours' })
    expect(un!.notes.join(' ')).toMatch(/stays at 0\.5\.0; it was 0\.4\.9/)
    const st = await fakeState(home)
    expect(st.marketplaces).toHaveProperty('dether.net')
    expect(st.plugins).toEqual([expect.objectContaining({ id: 'dethereal@dether.net', enabled: false })])
    expect((await settings()).pluginConfigs['dethereal@dether.net'].options.platform_url).toBe('http://mine.example')
  })

  it('is put back when the install fails: disabled again, its own URL back, nothing recorded', async () => {
    await setControl(home, { npmLatest: '0.4.8', npmPackages: { '0.4.8': await makePackage(path.join(home, '..', 'pkg-048'), '0.4.8') } })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user', platformUrl: 'http://new.example' })).rejects.toMatchObject({ code: 'harness_cli_refused' })
    expect((await fakeState(home)).plugins).toEqual([expect.objectContaining({ id: 'dethereal@dether.net', enabled: false })])
    expect((await settings()).pluginConfigs['dethereal@dether.net'].options.platform_url).toBe('http://mine.example')
    expect((await manifest()).installs).toEqual({})
    expect((await manifest()).shared?.claude).toBeUndefined()
    expect(Object.keys((await fakeState(home)).marketplaces)).toEqual(['dether.net'])
  })

  for (const step of ['plugin update', 'plugin enable'] as const) {
    it(`is put back when ${step} fails`, async () => {
      await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { [step]: 'exit' } })
      await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_failed' })
      expect((await fakeState(home)).plugins).toEqual([expect.objectContaining({ id: 'dethereal@dether.net', enabled: false })])
      expect((await manifest()).installs).toEqual({})
    })
  }

  it('keeps its URL when none is given', async () => {
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'dethereal@dether.net': true }, pluginConfigs: { 'dethereal@dether.net': { options: { platform_url: 'http://mine.example' } } } }))
    await setState(home, { ...(await fakeState(home)), plugins: (await fakeState(home)).plugins.map((p) => ({ ...p, enabled: true })) })
    const report = await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    expect(report.url).toEqual({ value: null, source: 'unchanged' })
    expect(mutating(await fakeCalls(home)).some((c) => c.args.includes('--config'))).toBe(false)
    expect((await settings()).pluginConfigs['dethereal@dether.net'].options.platform_url).toBe('http://mine.example')
  })
})

describe('what it refuses, and what a refusal leaves', () => {
  it('a second copy from another marketplace, before changing anything', async () => {
    await setState(home, { marketplaces: { other: { source: 'directory', path: '/x' } }, plugins: [{ id: 'dethereal@other', scope: 'user', version: '0.4.0', enabled: true, installPath: '/x' }] })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_refused' })
    expect(mutating(await fakeCalls(home))).toEqual([])
    expect((await manifest()).shared?.claude).toBeUndefined()
  })

  it('a marketplace of the same name from another source', async () => {
    await setState(home, { marketplaces: { 'dether.net': { source: 'github', repo: 'someone/else' } }, plugins: [] })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_refused' })
    expect(mutating(await fakeCalls(home))).toEqual([])
  })

  for (const [what, control, extra] of [
    ['a URL Claude did not apply', { configNotApplied: true }, {}],
    ['a version other than this installer\'s', { npmLatest: '0.4.9' }, { '0.4.9': 'pkg' }],
    ['server files that are not this package\'s', { npmLatest: '0.5.0' }, { '0.5.0': 'other' }],
    ['an install that fails', { fail: { 'plugin install': 'exit' } }, {}],
    ['an answer that is not whole JSON', { fail: { 'plugin install': 'badjson' } }, {}],
    ['a marketplace added under another name', { addName: 'evil' }, {}],
    ['settings that do not enable the plugin', { skipEnabledSettings: true }, {}],
  ] as const) {
    it(`${what}: nothing of the attempt stays`, async () => {
      const packages: Record<string, string> = { '0.5.0': pkg }
      for (const [v, kind] of Object.entries(extra)) packages[v] = kind === 'other' ? await makePackage(path.join(home, '..', 'other'), v, 'export const tampered = 1\n') : await makePackage(path.join(home, '..', `pkg-${v}`), v)
      await setControl(home, { npmLatest: '0.5.0', npmPackages: packages, ...control })
      await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: expect.stringMatching(/^harness_cli_(refused|failed)$/) })
      expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
      expect(await manifest()).toMatchObject({ installs: {} })
      expect((await manifest()).shared?.claude).toBeUndefined()
    })
  }

  it('names the version a marketplace serves when it is not this installer\'s', async () => {
    await setControl(home, { npmLatest: '0.4.9', npmPackages: { '0.5.0': pkg, '0.4.9': await makePackage(path.join(home, '..', 'pkg-049'), '0.4.9') } })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toThrow(/the marketplace serves 0\.4\.9, this installer is 0\.5\.0/)
  })

  it('a failed first install whose cleanup also fails keeps the record, so uninstall can finish it', async () => {
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { 'plugin install': 'exit', 'plugin marketplace remove': 'exit' } })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_failed' })
    expect((await manifest()).shared?.claude).toMatchObject({ marketplace: { added: true } })
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg } })
    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ marketplace: 'removed' })
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
  })

  it('a marketplace that cannot be added', async () => {
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { 'plugin marketplace add': 'exit' } })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_failed' })
    expect((await manifest()).shared?.claude).toBeUndefined()
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
  })

  it('plugin files other than this package\'s, with the same server build', async () => {
    const twin = await makePackage(path.join(home, '..', 'twin'), '0.5.0')
    await fs.writeFile(path.join(twin, 'bundles', 'claude', 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'evil' }] }] } }))
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': twin } })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_refused' })
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
  })

  it('a URL Claude or a settings file could misread', () => {
    expect(normalisePlatformUrl('https://platform.example/base/')).toBe('https://platform.example/base')
    expect(normalisePlatformUrl('http://localhost:3000')).toBe('http://localhost:3000')
    for (const bad of ['ftp://x', 'http://u:p@x', 'http://x/?a=1', 'http://x/#f', 'http://x/a,b', 'http://x/"', 'http://x/ y', 'not a url', `http://x/${'a'.repeat(2048)}`]) {
      expect(() => normalisePlatformUrl(bad), bad).toThrow(expect.objectContaining({ code: 'argument_refused' }))
    }
  })

  it('a project that is the home, not a directory, or has a linked .claude', async () => {
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'project', project: path.join(home, 'nope') })).rejects.toMatchObject({ code: 'not_a_directory' })
    const project = path.join(home, '..', 'linked')
    await fs.mkdir(project)
    await fs.symlink(home, path.join(project, '.claude'))
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'project', project })).rejects.toMatchObject({ code: 'symlink' })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'project', project: 'relative' })).rejects.toMatchObject({ code: 'argument_refused' })
    // One another user can write: `.claude` could be swapped for a link between the check and Claude's write.
    const shared = path.join(home, '..', 'shared')
    await fs.mkdir(shared)
    await fs.chmod(shared, 0o775)
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'project', project: shared })).rejects.toMatchObject({ code: 'group_or_world_writable' })
    // A project that became writable by others after its install still uninstalls: only installing writes into it.
    const later = path.join(home, '..', 'later-shared')
    await fs.mkdir(later)
    await installClaude({ ctx, packageRoot: pkg, scope: 'project', project: later })
    await fs.chmod(later, 0o775)
    await expect(uninstallClaude({ ctx, scope: 'project', project: later })).resolves.toMatchObject({ plugin: 'uninstalled' })
  })

  // 2.1.286's marketplace add, update and remove take no --json; 2.1.287 is the first whose every command the writer runs does.
  it.each(['2.1.200', '2.1.283', '2.1.286'])('refuses Claude Code %s by name, saying which version it needs, before changing anything', async (version) => {
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, version })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toMatchObject({
      code: 'harness_version', message: `Claude Code ${version} is older than 2.1.287, the first whose plugin commands all answer in JSON; update Claude Code: harness version`,
    })
    expect(mutating(await fakeCalls(home))).toEqual([])
  })

  it.each(['2.1.287', '2.1.288', '2.2.0', '3.0.0'])('installs with Claude Code %s', async (version) => {
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, version })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).resolves.toMatchObject({ plugin: 'installed' })
  })

  it('refuses to uninstall with a Claude Code below the floor, before changing anything', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    const before = (await fakeCalls(home)).length
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, version: '2.1.286' })
    await expect(uninstallClaude({ ctx, scope: 'user' })).rejects.toMatchObject({ code: 'harness_version' })
    expect(mutating((await fakeCalls(home)).slice(before))).toEqual([])
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg } })
    await expect(uninstallClaude({ ctx, scope: 'user' })).resolves.toMatchObject({ plugin: 'uninstalled' })
  })

  it('says what Claude Code answered when a command fails', async () => {
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { 'plugin marketplace add': 'exit' }, stderr: "error: unknown option '--json'" })
    await expect(installClaude({ ctx, packageRoot: pkg, scope: 'user' })).rejects.toThrow("plugin marketplace add: harness cli failed: error: unknown option '--json'")
  })
})

describe('a local marketplace (release candidates and tests)', () => {
  it('installs from it in place, and removes it with the last entry', async () => {
    const mkt = await makeMarketplace(path.join(home, '..', 'mkt'))
    const report = await installClaude({ ctx, packageRoot: pkg, scope: 'user', marketplaceDir: mkt })
    expect(report).toMatchObject({ id: 'dethereal@local-rc', marketplace: { name: 'local-rc', added: true } })
    expect((await manifest()).shared!.claude!.marketplace.source).toEqual({ kind: 'directory', path: mkt })
    expect(mutating(await fakeCalls(home))[0]!.args).toEqual(['plugin', 'marketplace', 'add', mkt, '--json'])
    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ marketplace: 'removed' })
  })

  it('refuses one another user could change, or that is not exactly our plugin', async () => {
    const check = (dir: string) => checkMarketplaceDir(dir, env)
    const fresh = async (name: string) => makeMarketplace(path.join(home, '..', name))
    // A temporary folder, whether it exists or not (/tmp is a link on some systems, and cleared on restart).
    const missing = path.join('/tmp', `dethereal-missing-${process.pid}-${Date.now()}`, 'mkt')
    await expect(fs.access(missing)).rejects.toThrow()
    await expect(check(missing)).rejects.toMatchObject({ code: 'argument_refused' })
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-mkt-'))
    try {
      await expect(check(temp)).rejects.toMatchObject({ code: 'argument_refused' })
    } finally {
      await fs.rm(temp, { recursive: true, force: true })
    }
    const writable = await fresh('w')
    await fs.chmod(path.join(writable, 'dethereal'), 0o775)
    await expect(check(writable)).rejects.toMatchObject({ code: 'group_or_world_writable' })
    const linked = await fresh('l')
    await fs.symlink('/etc/hosts', path.join(linked, 'dethereal', 'hosts'))
    await expect(check(linked)).rejects.toMatchObject({ code: 'symlink' })
    for (const [name, plugin, mname, code] of [
      ['official', { name: 'dethereal', source: './dethereal' }, 'dether.net', 'argument_refused'],
      ['escape', { name: 'dethereal', source: '../elsewhere' }, 'local', 'argument_refused'],
      ['other', { name: 'evil', source: './dethereal' }, 'local', 'argument_refused'],
      ['range', { name: 'dethereal', source: { source: 'npm', package: '@dether.net/dethereal', version: '^0.5.0' } }, 'local', 'argument_refused'],
      ['pkg', { name: 'dethereal', source: { source: 'npm', package: 'evil-package', version: '0.5.0' } }, 'local', 'parse_error'],
      ['registry', { name: 'dethereal', source: { source: 'npm', package: '@dether.net/dethereal', version: '0.5.0', registry: 'http://evil' } }, 'local', 'parse_error'],
    ] as const) {
      const dir = await makeMarketplace(path.join(home, '..', `m-${name}`), mname, plugin)
      await expect(check(dir), name).rejects.toMatchObject({ code })
    }
    await expect(check(await makeMarketplace(path.join(home, '..', 'm-npm'), 'local', { name: 'dethereal', source: { source: 'npm', package: '@dether.net/dethereal', version: '0.5.0' } }))).resolves.toMatchObject({ name: 'local' })
  })
})

describe('uninstall edges', () => {
  it('keeps the marketplace while a plugin from it is still installed, by hand, elsewhere', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    const elsewhere = path.join(home, '..', 'elsewhere')
    await fs.mkdir(elsewhere)
    const st = await fakeState(home)
    st.plugins.push({ id: 'dethereal@dether.net', scope: 'project', projectPath: elsewhere, version: '0.5.0', enabled: true, installPath: pkg })
    await setState(home, st)
    const un = await uninstallClaude({ ctx, scope: 'user' })
    expect(un).toMatchObject({ plugin: 'uninstalled', marketplace: 'kept' })
    expect(un!.notes.join(' ')).toMatch(/marketplace stays: a plugin from it is still installed/)
    expect(Object.keys((await fakeState(home)).marketplaces)).toEqual(['dether.net'])
    expect((await manifest()).shared?.claude).toBeUndefined()
  })

  it('finds nothing to do where this installer installed nothing', async () => {
    expect(await uninstallClaude({ ctx, scope: 'user' })).toBeNull()
  })

  it('forgets a project that is gone only when asked', async () => {
    const project = path.join(home, '..', 'gone')
    await fs.mkdir(project)
    await installClaude({ ctx, packageRoot: pkg, scope: 'project', project })
    await fs.rm(project, { recursive: true })
    await expect(uninstallClaude({ ctx, scope: 'project', project })).rejects.toMatchObject({ code: 'not_a_directory' })
    expect(await uninstallClaude({ ctx, scope: 'project', project, forgetMissingProject: true })).toMatchObject({ plugin: 'already_gone', marketplace: 'removed' })
    expect((await manifest()).installs).toEqual({})
    expect((await manifest()).shared?.claude).toBeUndefined()
    expect((await fakeState(home)).marketplaces).toEqual({})
  })

  it('finds a gone project by the key install gave it, through a linked parent', async () => {
    const real = path.join(home, '..', 'real-parent')
    await fs.mkdir(path.join(real, 'proj'), { recursive: true })
    const linked = path.join(home, '..', 'linked-parent')
    await fs.symlink(real, linked)
    await installClaude({ ctx, packageRoot: pkg, scope: 'project', project: path.join(linked, 'proj') })
    await fs.rm(path.join(real, 'proj'), { recursive: true })
    expect(await uninstallClaude({ ctx, scope: 'project', project: path.join(linked, 'proj'), forgetMissingProject: true })).toMatchObject({ plugin: 'already_gone' })
    expect((await manifest()).installs).toEqual({})
  })

  it('runs no command in a project whose .claude became a link after the install', async () => {
    const project = path.join(home, '..', 'later-linked')
    await fs.mkdir(project)
    await installClaude({ ctx, packageRoot: pkg, scope: 'project', project })
    await fs.rm(path.join(project, '.claude'), { recursive: true })
    await fs.symlink(home, path.join(project, '.claude'))
    const before = (await fakeCalls(home)).length
    await expect(uninstallClaude({ ctx, scope: 'project', project })).rejects.toMatchObject({ code: 'symlink' })
    expect(mutating((await fakeCalls(home)).slice(before))).toEqual([])
  })

  it('leaves a marketplace of that name that now comes from somewhere else', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    const st = await fakeState(home)
    st.marketplaces['dether.net'] = { source: 'github', repo: 'someone/else' }
    await setState(home, st)
    const un = await uninstallClaude({ ctx, scope: 'user' })
    expect(un).toMatchObject({ plugin: 'uninstalled', marketplace: 'kept' })
    expect(un!.notes.join(' ')).toMatch(/now comes from somewhere else/)
    expect((await fakeState(home)).marketplaces).toHaveProperty('dether.net')
    expect((await manifest()).shared?.claude).toBeUndefined()
  })

  it('finishes a teardown an earlier uninstall could not, and keeps the record until it can', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { 'plugin marketplace remove': 'exit' } })
    await expect(uninstallClaude({ ctx, scope: 'user' })).rejects.toMatchObject({ code: 'harness_cli_failed' })
    expect((await manifest()).installs).toEqual({})
    expect((await manifest()).shared?.claude).toBeDefined()
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg } })
    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ plugin: 'already_gone', marketplace: 'removed' })
    expect((await manifest()).shared?.claude).toBeUndefined()
    expect(await fakeState(home)).toEqual({ marketplaces: {}, plugins: [] })
  })

  it('uninstalls a plugin an interrupted install left recorded as pending', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user' })
    const m = JSON.parse(await fs.readFile(ctx.paths.manifest, 'utf8'))
    m.installs['claude:user'].cli.state = 'pending'
    await fs.writeFile(ctx.paths.manifest, JSON.stringify(m))
    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ plugin: 'uninstalled', marketplace: 'removed' })
  })

  it('installs at a new scope with the URL Claude already has, never the package default over it', async () => {
    await installClaude({ ctx, packageRoot: pkg, scope: 'user', platformUrl: 'https://platform.example' })
    const project = path.join(home, '..', 'kept-url-project')
    await fs.mkdir(project)
    const before = (await fakeCalls(home)).length
    const r = await installClaude({ ctx, packageRoot: pkg, scope: 'project', project })
    expect(r.url).toEqual({ value: 'https://platform.example', source: 'kept' })
    expect(mutating((await fakeCalls(home)).slice(before)).map((c) => c.args)).toContainEqual(expect.arrayContaining(['--config', 'platform_url=https://platform.example']))
    expect((await settings()).pluginConfigs['dethereal@dether.net'].options.platform_url).toBe('https://platform.example')
    // The user's own URL, from before any install, is kept the same way.
    await uninstallClaude({ ctx, scope: 'project', project })
    await uninstallClaude({ ctx, scope: 'user' })
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ pluginConfigs: { 'dethereal@dether.net': { options: { platform_url: 'http://mine.example' } } } }))
    expect((await installClaude({ ctx, packageRoot: pkg, scope: 'user' })).url).toEqual({ value: 'http://mine.example', source: 'kept' })
    expect((await settings()).pluginConfigs['dethereal@dether.net'].options.platform_url).toBe('http://mine.example')
  })

  it('puts the URL back only through a copy it may act on: never by installing a local-scope copy at user scope', async () => {
    await fs.mkdir(path.join(home, '.claude'), { recursive: true })
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ pluginConfigs: { 'dethereal@dether.net': { options: { platform_url: 'http://mine.example' } } } }))
    await setState(home, { marketplaces: {}, plugins: [{ id: 'dethereal@dether.net', scope: 'local', version: '0.5.0', enabled: true, installPath: pkg }] })
    await installClaude({ ctx, packageRoot: pkg, scope: 'user', platformUrl: 'http://new.example' })
    const before = (await fakeCalls(home)).length
    const un = await uninstallClaude({ ctx, scope: 'user' })
    expect(un!.notes.join(' ')).toMatch(/platform URL could not be put back/)
    expect(mutating((await fakeCalls(home)).slice(before)).map((c) => c.args.slice(0, 2).join(' '))).not.toContain('plugin install')
    expect((await fakeState(home)).plugins).toEqual([expect.objectContaining({ scope: 'local' })])
  })
})

describe('the command line', () => {
  const io = () => {
    const out: string[] = []
    const err: string[] = []
    return { io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) }, out, err }
  }

  it('refuses what it cannot do, before touching anything', async () => {
    for (const args of [[], ['--harness', 'gemini'], ['--harness', 'claude', '--scope', 'project'], ['--harness', 'claude', '--bogus', 'x'], ['--harness', 'claude', '--harness', 'claude'], ['--harness', 'claude', 'extra']]) {
      const r = io()
      expect(await runInstaller('install', args, r.io, { env, packageRoot: pkg, tty: false }), args.join(' ')).toBe(2)
    }
    const r = io()
    expect(await runInstaller('install', ['--harness', 'claude', '--scope', 'user', '--claude-marketplace', '/x'], r.io, { env, packageRoot: pkg, tty: false })).toBe(2)
    expect(r.err.join('')).toMatch(/DETHEREAL_TEST_MARKETPLACE=1/)
    expect(await fakeCalls(home)).toEqual([])
  })

  it('says what it will do, does it, and undoes it', async () => {
    const r = io()
    expect(await runInstaller('install', ['--harness', 'claude', '--scope', 'user', '--platform-url', 'http://localhost:3000'], r.io, { env, packageRoot: pkg, tty: false })).toBe(0)
    expect(r.out[0]).toMatch(/hooks on PostToolUse, PreToolUse, SessionStart/)
    expect(r.out[0]).toMatch(/the plugin's approve hook lets Claude Code run Dethereal's read-only tools and the ones whose changes the server checks/)
    expect(r.out[1]).toMatch(/dethereal@dether\.net installed at 0\.5\.0/)
    const u = io()
    expect(await runInstaller('uninstall', ['--harness', 'claude', '--scope', 'user'], u.io, { env, packageRoot: pkg, tty: false })).toBe(0)
    expect(u.out.join('')).toMatch(/uninstalled/)
    const again = io()
    expect(await runInstaller('uninstall', ['--harness', 'claude', '--scope', 'user'], again.io, { env, packageRoot: pkg, tty: false })).toBe(0)
    expect(again.out.join('')).toMatch(/Claude Code: nothing to do\./)
  })

  it('reports a refusal by its code, never with a path from the message of a lower layer, and exits 1', async () => {
    // Claude's own error line is shown, its paths replaced.
    await setControl(home, { npmLatest: '0.5.0', npmPackages: { '0.5.0': pkg }, fail: { 'plugin install': 'exit' }, stderr: `Error: cannot write ${home}/.claude/settings.json` })
    const r = io()
    expect(await runInstaller('install', ['--harness', 'claude', '--scope', 'user'], r.io, { env, packageRoot: pkg, tty: false })).toBe(1)
    expect(r.out.join('')).toMatch(/Claude Code: failed\.\n {2}plugin install: harness cli failed: Error: cannot write <path>\n/)
    expect(r.out.join('') + r.err.join('')).not.toContain(home)
    expect(r.out.join('')).toMatch(/Retry the failed one alone: npx @dether\.net\/dethereal@0\.5\.0 install --harness claude/)
  })
})
