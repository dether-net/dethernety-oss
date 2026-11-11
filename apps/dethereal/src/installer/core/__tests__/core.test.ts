/**
 * Installer core: path safety, backups, the manifest transaction and its undo,
 * the runtime copy and current.json. Every test runs in a temporary home; the
 * user's own home is never touched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { InstallerError } from '../errors.js'
import {
  assertSupported, coversStateRoot, ensureDirUnder, ensureStateRoot, type InstallerEnv, resolveRoot, stateRootDenyTargets, statePaths,
} from '../paths.js'
import { matchesTemplate, readTarget, resolveTarget, sha256, writeTarget, type AllowedTarget } from '../safe-write.js'
import { createBackup, KEEP_RECENT, purgeBackups, readBackup } from '../backup.js'
import { entryKey, parseManifest, readManifest, withStateLock } from '../manifest.js'
import { applyFileChange, dropCliRecords, mutateManifest, purgeAllBackups, recordCliFile, recoverPending, revertFile, type Step, type TxContext } from '../transaction.js'
import {
  activateRuntime, assertNode, bareSpecifiers, dynamicLoads, gcRuntimes, installRuntime, maskLiterals, NODE_FLOOR, nodeAtLeast, quarantineRuntime, usesRuntime,
  NODE_BUILTINS, readCurrentRuntime, stableNodePath,
} from '../runtime.js'
import { builtinModules } from 'node:module'
import { inspectOwned } from '../transaction.js'

let tmp: string
let env: InstallerEnv
let home: string
beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-installer-')))
  home = path.join(tmp, 'home')
  await fs.mkdir(home, { mode: 0o700 })
  env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
})
/** Runtime copies are read-only; make the whole tree writable so it can be removed. */
async function writableTree(dir: string): Promise<void> {
  await fs.chmod(dir, 0o700).catch(() => {})
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && !e.isSymbolicLink()) await writableTree(path.join(dir, e.name))
  }
}
afterEach(async () => {
  await writableTree(tmp)
  await fs.rm(tmp, { recursive: true, force: true })
})

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (err) {
    if (err instanceof InstallerError) return err.code
    throw err
  }
  return 'ok'
}

describe('paths and ownership', () => {
  it('refuses root and Windows', () => {
    expect(() => assertSupported({ ...env, euid: 0 })).toThrow(/running as root/)
    expect(() => assertSupported({ ...env, platform: 'win32' })).toThrow(/unsupported platform/)
  })

  it('creates the state root at 0700, and refuses a symlinked, foreign or writable one', async () => {
    const r = await ensureStateRoot(env)
    expect(r.created).toBe(true)
    expect((await fs.stat(r.paths.root)).mode & 0o777).toBe(0o700)
    await fs.rm(r.paths.root, { recursive: true })

    await fs.mkdir(path.join(tmp, 'elsewhere'))
    await fs.symlink(path.join(tmp, 'elsewhere'), r.paths.root)
    expect(await code(ensureStateRoot(env))).toBe('symlink')
    await fs.rm(r.paths.root)

    await fs.mkdir(r.paths.root, { mode: 0o700 })
    await fs.chmod(r.paths.root, 0o777)
    expect(await code(ensureStateRoot(env))).toBe('group_or_world_writable')
    expect(await code(ensureStateRoot({ ...env, euid: env.euid + 1 }))).toBe('not_owned')
  })

  it('tightens a group-readable state root and reports readable secrets, without recursing', async () => {
    const { paths } = await ensureStateRoot(env)
    await fs.writeFile(path.join(paths.root, 'waiver.key'), 'k', { mode: 0o644 })
    await fs.chmod(paths.root, 0o750)
    const r = await ensureStateRoot(env)
    expect(r).toMatchObject({ tightened: true, exposedSecrets: ['waiver.key'] })
    expect((await fs.stat(paths.root)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(path.join(paths.root, 'waiver.key'))).mode & 0o777).toBe(0o644)
  })

  it('creates directories one component at a time and never follows a planted symlink', async () => {
    const root = await resolveRoot(home, env, '~')
    await fs.mkdir(path.join(tmp, 'target'))
    await fs.symlink(path.join(tmp, 'target'), path.join(home, 'planted'))
    expect(await code(ensureDirUnder(root, 'planted/sub', env))).toBe('symlink')
    expect(await code(ensureDirUnder(root, '../escape', env))).toBe('outside_allowed')
    await ensureDirUnder(root, 'a/b/c', env)
    expect((await fs.stat(path.join(home, 'a', 'b', 'c'))).isDirectory()).toBe(true)
  })
})

describe('deny targets for the state root', () => {
  const toRegex = (glob: string, nocase: boolean) => {
    let re = ''
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i]!
      if (c === '\\') { re += '\\' + glob[++i]; continue }
      if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; continue }
      if (c === '*') re += '[^/]*'
      else if (c === '[') { const j = glob.indexOf(']', i); re += glob.slice(i, j + 1); i = j }
      else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
    }
    return new RegExp(`^${re}$`, nocase ? 'i' : '')
  }
  const matcher = (nocase: boolean) => (pattern: string, p: string) => toRegex(pattern, nocase).test(p)

  it('covers the directory, its secrets, runtime, dotfiles and case variants, in both forms', async () => {
    const realHome = await resolveRoot(home, env, '~')
    const t = stateRootDenyTargets(realHome)
    expect(coversStateRoot(matcher(false), [...t.tilde, ...t.absolute, ...t.folded], realHome)).toEqual({ covered: true, missed: [] })
    const onlyTokens = coversStateRoot(matcher(false), ['~/.dethernety/tokens.json'], realHome)
    expect(onlyTokens.covered).toBe(false)
    expect(onlyTokens.missed).toContain('~/.dethernety/waiver.key')
    // Case-comparing matchers need the folded forms.
    expect(coversStateRoot(matcher(false), [...t.tilde, ...t.absolute], realHome).missed.some((m) => m.includes('.Dethernety'))).toBe(true)
  })

  it('covers a case-folded home path and every other spelling of the home it is given', async () => {
    const realHome = await resolveRoot(home, env, '~')
    const alias = path.join('/aliased', 'home')
    const t = stateRootDenyTargets(realHome, [alias])
    const all = [...t.tilde, ...t.absolute, ...t.folded]
    expect(coversStateRoot(matcher(false), all, realHome, [alias])).toEqual({ covered: true, missed: [] })
    const missed = coversStateRoot(matcher(false), [...t.tilde, ...t.absolute], realHome, [alias]).missed
    expect(missed).toContain(`${realHome}/.dethernety/tokens.json`.toUpperCase())
    expect(coversStateRoot(matcher(false), stateRootDenyTargets(realHome).absolute, realHome, [alias]).missed).toContain(`${alias}/.dethernety/waiver.key`)
  })

  it('escapes glob characters in the home path, and never covers a project-level .dethernety', async () => {
    const odd = path.join(tmp, 'we[ir]d*home')
    await fs.mkdir(odd, { mode: 0o700 })
    const realHome = await resolveRoot(odd, env, '~')
    const t = stateRootDenyTargets(realHome)
    expect(coversStateRoot(matcher(false), [...t.tilde, ...t.absolute, ...t.folded], realHome).covered).toBe(true)
    const m = matcher(false)
    expect([...t.tilde, ...t.absolute, ...t.folded].some((p) => m(p, '/work/project/.dethernety/models.json'))).toBe(false)
  })
})

describe('the path-safe writer', () => {
  let allowed: AllowedTarget[]
  beforeEach(async () => {
    allowed = [{ root: await resolveRoot(home, env, '~'), pattern: '.codex/**/*.toml' }]
  })

  it('matches templates segment by segment', () => {
    expect(matchesTemplate('agents/dethereal-a.toml', 'agents/dethereal-*.toml')).toBe(true)
    expect(matchesTemplate('agents/x/dethereal-a.toml', 'agents/dethereal-*.toml')).toBe(false)
    expect(matchesTemplate('a/b/c.toml', '**/*.toml')).toBe(true)
  })

  it('refuses paths outside the templates or climbing out', () => {
    expect(() => resolveTarget(path.join(home, 'other.toml'), allowed)).toThrow(/outside allowed/)
    expect(() => resolveTarget(path.join(home, '.codex', '..', '..', 'x.toml'), allowed)).toThrow(/outside allowed/)
  })

  it('writes a new file at 0600 and keeps an existing file\'s mode', async () => {
    const t = resolveTarget(path.join(home, '.codex', 'config.toml'), allowed)
    await writeTarget(t, Buffer.from('a = 1\n'), 'absent', env)
    expect((await fs.stat(t.abs)).mode & 0o777).toBe(0o600)
    await fs.chmod(t.abs, 0o640)
    await writeTarget(t, Buffer.from('a = 2\n'), sha256('a = 1\n'), env)
    expect((await fs.stat(t.abs)).mode & 0o777).toBe(0o640)
    expect(await fs.readFile(t.abs, 'utf8')).toBe('a = 2\n')
    expect((await fs.readdir(path.dirname(t.abs))).filter((f) => f.startsWith('.dethereal-tmp-'))).toEqual([])
  })

  it('refuses a stale plan, a symlinked or hard-linked target, a symlinked parent and a read-only file', async () => {
    const t = resolveTarget(path.join(home, '.codex', 'config.toml'), allowed)
    await writeTarget(t, Buffer.from('a = 1\n'), 'absent', env)
    expect(await code(writeTarget(t, Buffer.from('x'), 'absent', env))).toBe('changed')
    expect(await fs.readFile(t.abs, 'utf8')).toBe('a = 1\n')

    await fs.rm(t.abs)
    await fs.writeFile(path.join(tmp, 'secret'), 's')
    await fs.symlink(path.join(tmp, 'secret'), t.abs)
    expect(await code(writeTarget(t, Buffer.from('x'), 'absent', env))).toBe('symlink')
    await fs.rm(t.abs)
    await fs.link(path.join(tmp, 'secret'), t.abs)
    expect(await code(readTarget(t, env))).toBe('hardlinked')
    await fs.rm(t.abs)

    await fs.writeFile(t.abs, 'ro', { mode: 0o444 })
    expect(await code(readTarget(t, env))).toBe('not_writable')
    await fs.rm(t.abs, { force: true })

    await fs.rm(path.join(home, '.codex'), { recursive: true })
    await fs.mkdir(path.join(tmp, 'codex-real'))
    await fs.symlink(path.join(tmp, 'codex-real'), path.join(home, '.codex'))
    expect(await code(writeTarget(t, Buffer.from('x'), 'absent', env))).toBe('symlink')
    expect(await fs.readdir(path.join(tmp, 'codex-real'))).toEqual([])
  })
})

describe('backups', () => {
  it('names backups by id and hash, keeps the first and the last few, and checks bytes before use', async () => {
    const { paths } = await ensureStateRoot(env)
    const ids: string[] = []
    for (let i = 0; i < 6; i++) ids.push(await createBackup(paths, env, '/x/config.toml', Buffer.from(`v${i}`), new Set(), new Date(Date.UTC(2026, 0, 1, 0, 0, i))))
    for (const id of ids) expect(id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}\/[0-9a-f]{64}\.bak$/)
    const kept = (await fs.readdir(paths.backups)).filter((d) => d !== 'index.json')
    expect(kept.length).toBe(1 + KEEP_RECENT)
    expect(await readBackup(paths, env, ids[0]!, sha256('v0'))).toEqual(Buffer.from('v0'))
    expect(await code(readBackup(paths, env, ids[5]!, sha256('v4')))).toBe('backup_mismatch')
    expect(await code(readBackup(paths, env, '../../etc/passwd', sha256('v0')))).toBe('backup_invalid')
    const [dir, file] = ids[5]!.split('/')
    await fs.writeFile(path.join(paths.backups, dir!, file!), 'tampered')
    expect(await code(readBackup(paths, env, ids[5]!, sha256('v5')))).toBe('backup_mismatch')
    const st = await fs.stat(path.join(paths.backups, dir!))
    expect(st.mode & 0o777).toBe(0o700)
    expect(await purgeBackups(paths, env)).toBeGreaterThan(0)
  })

  it('never prunes a backup a live record references', async () => {
    const { paths } = await ensureStateRoot(env)
    const first = await createBackup(paths, env, '/x/a', Buffer.from('0'))
    const second = await createBackup(paths, env, '/x/a', Buffer.from('1'))
    for (let i = 2; i < 8; i++) await createBackup(paths, env, '/x/a', Buffer.from(String(i)), new Set([second]))
    expect(await readBackup(paths, env, second, sha256('1'))).toEqual(Buffer.from('1'))
    expect(await readBackup(paths, env, first, sha256('0'))).toEqual(Buffer.from('0'))
  })
})

describe('the manifest', () => {
  it('refuses anything off shape', () => {
    const good = { schemaVersion: 1, installs: { 'codex:user': { version: '0.5.0', files: [] } } }
    expect(parseManifest(Buffer.from(JSON.stringify(good)))).toEqual(good)
    for (const bad of [
      { ...good, schemaVersion: 2 },
      { schemaVersion: 1, installs: { 'evil:user': { version: '0.5.0', files: [] } } },
      { schemaVersion: 1, installs: { 'codex:user': { version: '0.5.0', files: [{ path: 'relative', format: 'toml', writer: 'installer', pre: 'absent', post: '0'.repeat(64), backupId: null, state: 'committed' }] } } },
      { schemaVersion: 1, installs: { 'codex:user': { version: '0.5.0', files: [{ path: '/a', format: 'toml', writer: 'installer', pre: '1'.repeat(64), post: '0'.repeat(64), backupId: null, state: 'committed' }] } } },
    ]) expect(() => parseManifest(Buffer.from(JSON.stringify(bad)))).toThrow(/manifest invalid/)
    expect(() => parseManifest(Buffer.from('{'))).toThrow(/manifest invalid/)
    expect(entryKey('opencode', { project: '/p/q' })).toBe('opencode:project:/p/q')
  })

  // Values in these records become arguments to a harness CLI on uninstall, so each is held to its exact shape.
  it('holds the harness CLI state to its exact shape', () => {
    const claude = {
      claudeVersion: '2.1.287',
      marketplace: { name: 'dether.net', source: { kind: 'github', repo: 'dether-net/claude-plugins' }, added: true, state: 'done' },
      config: { previous: null, current: 'http://localhost:3000' },
    }
    const plugin = { harness: 'claude', id: 'dethereal@dether.net', preexisting: false, state: 'done' }
    const good = {
      schemaVersion: 1, shared: { claude },
      installs: {
        'claude:user': { version: '0.5.0', files: [], cli: plugin },
        'claude:project:/p': { version: '0.5.0', files: [], cli: { ...plugin, preexisting: { version: '0.4.8', enabled: false } } },
        'opencode:user': { version: '0.5.0', files: [], runtimes: ['0.4.9', '0.5.0'] },
      },
    }
    expect(parseManifest(Buffer.from(JSON.stringify(good)))).toEqual(good)
    const dir = { ...claude, marketplace: { ...claude.marketplace, name: 'local-rc', source: { kind: 'directory', path: '/abs/mkt' } } }
    expect(() => parseManifest(Buffer.from(JSON.stringify({ ...good, shared: { claude: dir }, installs: { 'claude:user': { version: '0.5.0', files: [], cli: { ...plugin, id: 'dethereal@local-rc' } } } })))).not.toThrow()
    const withShared = (c: unknown) => ({ ...good, shared: { claude: c } })
    const withPlugin = (cli: unknown) => ({ ...good, installs: { 'claude:user': { version: '0.5.0', files: [], cli } } })
    for (const bad of [
      withShared({ ...claude, claudeVersion: 'latest' }),
      withShared({ ...claude, marketplace: { ...claude.marketplace, name: '-x' } }),
      withShared({ ...claude, marketplace: { ...claude.marketplace, name: 'other' } }),
      withShared({ ...claude, marketplace: { ...claude.marketplace, source: { kind: 'github', repo: 'evil/plugins' } } }),
      withShared({ ...dir, marketplace: { ...dir.marketplace, source: { kind: 'directory', path: 'relative' } } }),
      withShared({ ...dir, marketplace: { ...dir.marketplace, source: { kind: 'directory', path: '/a/../b' } } }),
      withShared({ ...dir, marketplace: { ...dir.marketplace, name: 'dether.net' } }),
      withShared({ ...claude, config: { previous: 'x'.repeat(2049), current: null } }),
      withShared({ ...claude, marketplace: { ...claude.marketplace, state: 'maybe' } }),
      withPlugin({ ...plugin, id: 'other@dether.net' }),
      withPlugin({ ...plugin, id: 'dethereal@elsewhere' }),
      withPlugin({ ...plugin, preexisting: { version: 'x', enabled: true } }),
      withPlugin({ ...plugin, preexisting: true }),
      { ...good, shared: undefined },
      { ...good, installs: { 'codex:user': { version: '0.5.0', files: [], cli: plugin } } },
      { ...good, installs: { 'opencode:user': { version: '0.5.0', files: [], cli: plugin } } },
      { ...good, installs: { 'opencode:user': { version: '0.5.0', files: [], runtimes: ['../x'] } } },
    ]) expect(() => parseManifest(Buffer.from(JSON.stringify(bad)))).toThrow(/manifest invalid/)
  })

  it('records an unverified OpenCode override only on an OpenCode entry, for one version', () => {
    const ok = { schemaVersion: 1, installs: { 'opencode:user': { version: '0.5.0', files: [], allowUnverified: { openCodeVersion: '1.19.0' } } } }
    expect(parseManifest(Buffer.from(JSON.stringify(ok)))).toEqual(ok)
    for (const bad of [
      { schemaVersion: 1, installs: { 'codex:user': { version: '0.5.0', files: [], allowUnverified: { openCodeVersion: '1.19.0' } } } },
      { schemaVersion: 1, installs: { 'opencode:user': { version: '0.5.0', files: [], allowUnverified: { openCodeVersion: 'latest' } } } },
      { schemaVersion: 1, installs: { 'opencode:user': { version: '0.5.0', files: [], allowUnverified: { openCodeVersion: '1.19.0', extra: 1 } } } },
      { schemaVersion: 1, installs: { 'opencode:user': { version: '0.5.0', files: [], allowUnverified: true } } },
    ]) expect(() => parseManifest(Buffer.from(JSON.stringify(bad)))).toThrow(/manifest invalid/)
  })

  it('holds the shared Codex record and its entries to their exact shape', () => {
    const codex = {
      codexVersion: '0.157.0',
      marketplace: { name: 'dethereal-local', source: { kind: 'directory', path: '/home/u/.dethernety/runtime/0.5.0/bundles/codex' }, runtimeVersion: '0.5.0', state: 'done' },
      plugin: { id: 'dethereal@dethereal-local', state: 'done' },
    }
    const good = { schemaVersion: 1, shared: { codex }, installs: { 'codex:user': { version: '0.5.0', files: [], runtimes: ['0.5.0'], cli: { harness: 'codex', state: 'done' } } } }
    expect(parseManifest(Buffer.from(JSON.stringify(good)))).toEqual(good)
    const withCodex = (c: unknown) => ({ ...good, shared: { codex: c } })
    const market = (m: Record<string, unknown>) => withCodex({ ...codex, marketplace: { ...codex.marketplace, ...m } })
    for (const bad of [
      withCodex({ ...codex, codexVersion: 'x' }),
      market({ name: 'other' }),
      market({ runtimeVersion: '0.4.9' }),
      market({ source: { kind: 'directory', path: '/home/u/elsewhere/bundles/codex' } }),
      market({ source: { kind: 'directory', path: 'home/u/.dethernety/runtime/0.5.0/bundles/codex' } }),
      market({ source: { kind: 'directory', path: '/home/u/.dethernety/runtime/0.5.0/../0.4.0/bundles/codex' } }),
      market({ source: { kind: 'github', repo: 'x/y' } }),
      withCodex({ ...codex, plugin: { id: 'dethereal@other', state: 'done' } }),
      { ...good, installs: { 'codex:user': { version: '0.5.0', files: [], cli: { harness: 'codex', state: 'done', id: 'x' } } } },
      { ...good, installs: { 'codex:user': { version: '0.5.0', files: [], cli: { harness: 'claude', id: 'dethereal@dether.net', preexisting: false, state: 'done' } } } },
      { ...good, installs: { 'claude:user': { version: '0.5.0', files: [], cli: { harness: 'codex', state: 'done' } } } },
      { ...good, installs: { 'opencode:user': { version: '0.5.0', files: [], cli: { harness: 'codex', state: 'done' } } } },
    ]) expect(() => parseManifest(Buffer.from(JSON.stringify(bad)))).toThrow(/manifest invalid/)
  })
})

describe('the transaction and its undo', () => {
  let ctx: TxContext
  let allowed: AllowedTarget[]
  let file: string
  const key = 'codex:user'
  const OWN = '\n# >>> dethereal managed >>>\n[mcp_servers.dethereal]\ncommand = "node"\n# <<< dethereal managed <<<\n'
  // A stand-in for the TOML editor: remove the sentinel span, or report it gone.
  const unmerge = (b: Buffer) => { const s = b.toString(); const i = s.indexOf(OWN); return i < 0 ? null : Buffer.from(s.slice(0, i) + s.slice(i + OWN.length)) }
  const install = async (onStep?: TxContext['onStep']) => {
    const t = resolveTarget(file, allowed)
    const cur = await readTarget(t, env)
    const base = cur ? cur.bytes.toString() : ''
    return applyFileChange({ ...ctx, onStep }, { key, version: '0.5.0', target: t, format: 'toml', expectPre: cur ? cur.sha256 : 'absent', next: Buffer.from(base + OWN) })
  }
  const uninstall = () => revertFile(ctx, key, file, allowed, unmerge)

  beforeEach(async () => {
    const { paths } = await ensureStateRoot(env)
    ctx = { paths, env }
    allowed = [{ root: await resolveRoot(home, env, '~'), pattern: '.codex/config.toml' }]
    file = path.join(allowed[0]!.root, '.codex', 'config.toml')
    await fs.mkdir(path.dirname(file), { mode: 0o700 })
  })

  it('creates a file and deletes it again when nobody changed it', async () => {
    const r = await install()
    expect(r).toMatchObject({ pre: 'absent', backupId: null, state: 'committed' })
    expect(await uninstall()).toBe('deleted')
    await expect(fs.stat(file)).rejects.toThrow()
    expect((await readManifest(ctx.paths, env)).manifest.installs).toEqual({})
  })

  it('restores an existing file byte for byte from the backup taken before this write', async () => {
    const original = '# user config\r\nmodel = "x"\r\n'
    await fs.writeFile(file, original, { mode: 0o640 })
    const r = await install()
    expect(r.backupId).toMatch(/\.bak$/)
    expect(await uninstall()).toBe('restored')
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640)
  })

  it('keeps the user\'s edits across install, uninstall, edit, reinstall, uninstall', async () => {
    await fs.writeFile(file, 'a = 1\n')
    await install()
    await uninstall()
    await fs.writeFile(file, 'a = 1\nb = 2\n')
    await install()
    expect(await uninstall()).toBe('restored')
    expect(await fs.readFile(file, 'utf8')).toBe('a = 1\nb = 2\n')
  })

  it('keeps an edit made between two versions (the upgrade reverts, then merges again)', async () => {
    await fs.writeFile(file, 'a = 1\n')
    await install()
    await fs.appendFile(file, 'c = 3\n')
    expect(await uninstall()).toBe('unmerged')
    await install()
    expect(await uninstall()).toBe('restored')
    expect(await fs.readFile(file, 'utf8')).toBe('a = 1\nc = 3\n')
  })

  it('reports a user-edited file whose owned part is gone, and keeps the record', async () => {
    await fs.writeFile(file, 'a = 1\n')
    await install()
    await fs.writeFile(file, 'rewritten = true\n')
    expect(await uninstall()).toBe('manual')
    expect(await fs.readFile(file, 'utf8')).toBe('rewritten = true\n')
    expect((await readManifest(ctx.paths, env)).manifest.installs[key]!.files).toHaveLength(1)
  })

  it('refuses a second write to a recorded file (an upgrade must revert first)', async () => {
    await install()
    expect(await code(install())).toBe('conflict')
  })

  for (const step of ['backup', 'pending', 'write', 'commit'] as Step[]) {
    it(`recovers from a crash before "${step}", then uninstalls and reinstalls cleanly`, async () => {
      const original = 'a = 1\n'
      await fs.writeFile(file, original)
      const crash = (s: Step) => { if (s === step) throw new Error('crash') }
      await expect(install(crash)).rejects.toThrow('crash')
      const settled = await recoverPending(ctx, allowed)
      const expected = step === 'backup' || step === 'pending' ? [] : [{ path: file, outcome: step === 'write' ? 'dropped' : 'committed' }]
      expect(settled).toEqual(expected)
      const out = await uninstall()
      expect(out).toBe(step === 'commit' ? 'restored' : 'missing')
      expect(await fs.readFile(file, 'utf8')).toBe(original)
      await install()
      expect(await uninstall()).toBe('restored')
      expect(await fs.readFile(file, 'utf8')).toBe(original)
    })
  }

  it('refuses a record whose path a tampered manifest points elsewhere, and never restores a tampered backup', async () => {
    await fs.writeFile(file, 'a = 1\n')
    const rec = await install()
    const victim = path.join(home, 'victim.txt')
    await fs.writeFile(victim, 'keep me')
    const m = JSON.parse(await fs.readFile(ctx.paths.manifest, 'utf8'))
    m.installs[key].files[0].path = victim
    await fs.writeFile(ctx.paths.manifest, JSON.stringify(m))
    expect(await revertFile(ctx, key, victim, allowed, unmerge)).toBe('refused')
    expect(await fs.readFile(victim, 'utf8')).toBe('keep me')

    m.installs[key].files[0].path = file
    await fs.writeFile(ctx.paths.manifest, JSON.stringify(m))
    const [dir, name] = rec.backupId!.split('/')
    await fs.writeFile(path.join(ctx.paths.backups, dir!, name!), 'command = "evil"\n')
    // Reported for the user, not restored and not a stop for the rest of the uninstall.
    expect(await uninstall()).toBe('manual')
    expect((await fs.readFile(file, 'utf8')).endsWith(OWN)).toBe(true)
  })

  it('leaves a harness CLI\'s file to that CLI, and a CLI record flipped to the installer is refused', async () => {
    await fs.writeFile(file, 'model = "x"\n')
    const pre = sha256('model = "x"\n')
    await fs.appendFile(file, '[mcp_servers.dethereal]\n')
    const rec = await recordCliFile(ctx, key, '0.5.0', resolveTarget(file, allowed), 'toml', pre)
    expect(rec).toMatchObject({ writer: 'cli', pre, backupId: null })
    expect(await uninstall()).toBe('cli_owned')
    const m = JSON.parse(await fs.readFile(ctx.paths.manifest, 'utf8'))
    m.installs[key].files[0].writer = 'installer'
    expect(() => parseManifest(Buffer.from(JSON.stringify(m)))).toThrow(/manifest invalid/)
  })

  it('keeps the first pre-image of a CLI-written file, and drops CLI records on request', async () => {
    await fs.writeFile(file, 'model = "x"\n')
    const first = sha256('model = "x"\n')
    await fs.appendFile(file, '[a]\n')
    await recordCliFile(ctx, key, '0.5.0', resolveTarget(file, allowed), 'toml', first)
    const between = sha256(await fs.readFile(file))
    await fs.appendFile(file, '[b]\n')
    const again = await recordCliFile(ctx, key, '0.5.1', resolveTarget(file, allowed), 'toml', between)
    expect(again.pre).toBe(first)
    expect((await readManifest(ctx.paths, env)).manifest.installs[key]!.files).toHaveLength(1)
    expect(await dropCliRecords(ctx, key)).toBe(1)
    expect((await readManifest(ctx.paths, env)).manifest.installs[key]!.files).toEqual([])
  })

  it('runs a whole sequence under one held lock, which every step reuses', async () => {
    await fs.writeFile(file, 'model = "x"\n')
    const pre = sha256('model = "x"\n')
    const t0 = Date.now()
    await withStateLock(ctx.paths, env, async (lock) => {
      const held = { ...ctx, lock }
      await recordCliFile(held, key, '0.5.0', resolveTarget(file, allowed), 'toml', pre)
      await mutateManifest(held, (m) => { m.installs[key]!.runtimes = ['0.5.0'] })
      await dropCliRecords(held, key)
    })
    // A nested acquisition would wait out the lock's 5 s and fail.
    expect(Date.now() - t0).toBeLessThan(4000)
    expect((await readManifest(ctx.paths, env)).manifest.installs[key]).toEqual({ version: '0.5.0', files: [], runtimes: ['0.5.0'] })
  })

  it('drops the record of a write that failed before landing', async () => {
    await fs.writeFile(file, 'a = 1\n')
    const dir = path.dirname(file)
    await expect(install(async (s) => { if (s === 'write') await fs.chmod(dir, 0o500) })).rejects.toThrow(/io/)
    await fs.chmod(dir, 0o700)
    expect((await readManifest(ctx.paths, env)).manifest.installs).toEqual({})
    expect(await fs.readFile(file, 'utf8')).toBe('a = 1\n')
  })

  it('keeps a record pending when the file was edited after an interrupted install', async () => {
    await fs.writeFile(file, 'a = 1\n')
    await expect(install((s) => { if (s === 'commit') throw new Error('crash') })).rejects.toThrow('crash')
    await fs.appendFile(file, 'z = 26\n')
    expect(await recoverPending(ctx, allowed)).toEqual([{ path: file, outcome: 'user_edited' }])
    expect((await readManifest(ctx.paths, env)).manifest.installs[key]!.files[0]!.state).toBe('pending')
  })

  it('purges backups only while no record needs one', async () => {
    await fs.writeFile(file, 'a = 1\n')
    await install()
    expect(await code(purgeAllBackups(ctx))).toBe('backup_referenced')
    expect(await uninstall()).toBe('restored')
    expect(await purgeAllBackups(ctx)).toBeGreaterThan(0)
  })

  it('removes nothing that replaced the checked file in between', async () => {
    const r = await install()
    expect(r.pre).toBe('absent')
    // A save that lands between the check and the removal is put back, not deleted.
    const realRename = fs.rename
    let swapped = false
    ;(fs as { rename: typeof fs.rename }).rename = async (from, to) => {
      if (!swapped && String(from) === file) {
        swapped = true
        await fs.writeFile(`${file}.new`, 'saved = true\n')
        await realRename(`${file}.new`, file)
      }
      return realRename(from, to)
    }
    try {
      expect(await uninstall()).toBe('manual')
    } finally {
      (fs as { rename: typeof fs.rename }).rename = realRename
    }
    expect(await fs.readFile(file, 'utf8')).toBe('saved = true\n')
  })
})

describe('the Node floor', () => {
  it('is 20.11.1, and compares whole versions', () => {
    expect(NODE_FLOOR).toBe('20.11.1')
    for (const v of ['20.11.1', '20.11.2', '20.12.0', '21.0.0', '22.14.0', '24.0.0-pre']) expect(nodeAtLeast(v), v).toBe(true)
    for (const v of ['20.11.0', '20.10.9', '19.99.99', '18.20.4', '', 'x', '20.11']) expect(nodeAtLeast(v), v).toBe(false)
    expect(() => assertNode({ name: 'node' }, '20.11.0')).toThrow(InstallerError)
    expect(() => assertNode({ name: 'bun' }, '22.0.0')).toThrow(InstallerError)
    expect(() => assertNode({ name: 'node' }, '20.11.1')).not.toThrow()
  })
})

describe('the runtime', () => {
  let source: string
  const write = async (rel: string, text: string, mode = 0o644) => {
    const p = path.join(source, rel)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, text, { mode })
  }
  beforeEach(async () => {
    source = path.join(tmp, 'pkg')
    await write('dist/index.js', "import { readFileSync } from 'node:fs'\nimport './chunk.js'\nexport const ok = typeof readFileSync\nconsole.log('runtime ok')\n")
    await write('dist/chunk.js', "export const x = 1\n")
    await write('bundles/claude/plugin.json', '{}')
    await write('bundles/claude/hook.sh', '#!/bin/sh\n', 0o755)
    await write('dist/index.js.map', '{}')
    // The node a hook would run, under the test's control: the runner's own binary may sit in a
    // group-writable tool cache, which the check rightly refuses.
    node = path.join(tmp, 'bin', 'node')
    await fs.mkdir(path.dirname(node))
    await fs.writeFile(node, '#!/bin/sh\n')
    await fs.chmod(node, 0o755)
  })
  let node: string
  const writable = async (dir: string) => {
    for (const d of [dir, path.join(dir, 'dist')]) await fs.chmod(d, 0o700)
  }

  it('finds bare imports a copy could not resolve, and ignores import-like text', () => {
    expect(bareSpecifiers("import x from 'zod'\nimport y from 'node:fs'\nimport z from 'fs'\nconst s = \"from '${a.b}'\"")).toEqual(['zod'])
  })

  it('sees imports only in code position: not in comments, strings, templates or regular expressions', () => {
    // Text an unminified bundle carries: documentation examples, generated-code strings, messages.
    const quiet = [
      "/**\n * import { GraphQLError } from 'graphql/error'\n */\nexport {}",
      "// import x from 'zod'\nexport {}",
      "const gen = 'require(\"ajv/dist/runtime/equal\").default'",
      'const help = "before import (default) of a model"',
      "const t = `import x from 'zod'`",
      "const t = html`<p>from 'lit'</p>`",
      "const re = /from 'q'|require\\('r'\\)/g",
      "if (a) x = b / 2, y = c / 3; const s = 'import(name)'",
    ]
    for (const code of quiet) expect([...bareSpecifiers(code), ...dynamicLoads(code)], code).toEqual([])
    // The same shapes in code position still count, including a bundler's own require helper.
    expect(bareSpecifiers('__require("encoding")')).toEqual(['encoding'])
    expect(bareSpecifiers('import"side-effect"')).toEqual(['side-effect'])
    expect(bareSpecifiers("const t = `${require('zod')}`")).toEqual(['zod'])
    expect(dynamicLoads('const t = `a ${import(name)} b`')).toEqual(['import(…)'])
    expect(dynamicLoads("x = a / b; import(n)")).toEqual(['import(…)'])
  })

  it('leaves text in place where it cannot tell a literal apart, so the scan sees more, never less', () => {
    // After `)` a slash is taken as division, so the rest of the line stays visible.
    expect(bareSpecifiers("if (a) /x/.test(s); import y from 'zod'")).toEqual(['zod'])
    // An unterminated literal or comment stops the masking.
    expect(maskLiterals("'abc")).toBe("'abc")
    expect(bareSpecifiers("/* never closed import x from 'zod'")).toEqual(['zod'])
    expect(bareSpecifiers("const s = 'open\nimport x from 'zod'")).toEqual(['zod'])
    const code = "a = 'x' + `y${b}z` /* c */ + /d/g // e\n"
    expect(maskLiterals(code)).toHaveLength(code.length)
  })

  it('copies a self-contained package, marks it as ES modules, and runs it under a hostile package.json above it', async () => {
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    expect(rt).toMatchObject({ version: '0.5.0', runtimePath: path.join(paths.runtime, '0.5.0'), reused: false })
    expect(await fs.readFile(path.join(rt.runtimePath, 'package.json'), 'utf8')).toBe('{"type":"module"}\n')
    // Read-only once in place.
    expect((await fs.stat(path.join(rt.runtimePath, 'dist', 'index.js'))).mode & 0o777).toBe(0o400)
    expect((await fs.stat(path.join(rt.runtimePath, 'bundles', 'claude', 'hook.sh'))).mode & 0o777).toBe(0o500)
    expect((await fs.stat(rt.runtimePath)).mode & 0o777).toBe(0o500)
    expect(rt.files.some((f) => f.rel.endsWith('.map'))).toBe(false)
    await fs.writeFile(path.join(home, 'package.json'), '{"type":"commonjs"}')
    expect(execFileSync(process.execPath, [path.join(rt.runtimePath, 'dist', 'index.js')], { encoding: 'utf8' })).toBe('runtime ok\n')
    expect((await installRuntime(paths, env, source, '0.5.0')).reused).toBe(true)
  })

  it('refuses a package that is not self-contained, a symlink in it, and a bad version', async () => {
    const { paths } = await ensureStateRoot(env)
    await write('dist/extra.js', "import { z } from 'zod'\n")
    expect(await code(installRuntime(paths, env, source, '0.5.0'))).toBe('runtime_not_self_contained')
    await fs.rm(path.join(source, 'dist', 'extra.js'))
    await fs.symlink('/etc/hosts', path.join(source, 'dist', 'hosts'))
    expect(await code(installRuntime(paths, env, source, '0.5.0'))).toBe('symlink')
    await fs.rm(path.join(source, 'dist', 'hosts'))
    expect(await code(installRuntime(paths, env, source, '0.5.0/../x'))).toBe('runtime_invalid')
  })

  it('refuses to reuse a tampered runtime, and installs again after quarantine', async () => {
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    await writable(rt.runtimePath)
    await fs.writeFile(path.join(rt.runtimePath, 'dist', 'extra.js'), 'x')
    expect(await code(installRuntime(paths, env, source, '0.5.0'))).toBe('runtime_tampered')
    await fs.chmod(rt.runtimePath, 0o700)
    await quarantineRuntime(paths, env, '0.5.0')
    expect((await installRuntime(paths, env, source, '0.5.0')).reused).toBe(false)
  })

  it('writes current.json that the hook shim can validate, and rejects every tampering', async () => {
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    const cur = await activateRuntime(paths, env, rt, node)
    expect(await readCurrentRuntime(paths, env)).toEqual(cur)
    expect((await fs.stat(paths.current)).mode & 0o777).toBe(0o600)

    const saved = await fs.readFile(paths.current, 'utf8')
    const tamper = async (edit: (c: any) => void, want: string) => {
      const c = JSON.parse(saved)
      edit(c)
      await fs.writeFile(paths.current, JSON.stringify(c))
      expect(await code(readCurrentRuntime(paths, env))).toBe(want)
    }
    await tamper((c) => { c.runtimePath = path.join(tmp, 'elsewhere') }, 'runtime_invalid')
    await tamper((c) => { c.version = '0.5.0/../../x' }, 'runtime_invalid')
    await tamper((c) => { c.execPath = 'node' }, 'runtime_invalid')
    await tamper((c) => { c.setSha256 = '0'.repeat(64) }, 'runtime_tampered')
    await tamper((c) => { c.installedAt = 'yesterday' }, 'runtime_invalid')
    await tamper((c) => { c.nodeVersion = 22 }, 'runtime_invalid')
    await tamper((c) => { c.schemaVersion = 1 }, 'runtime_invalid')
    await fs.writeFile(paths.current, saved)
    await fs.chmod(paths.current, 0o622)
    expect(await code(readCurrentRuntime(paths, env))).toBe('group_or_world_writable')
    await fs.chmod(paths.current, 0o600)
    await fs.chmod(path.join(rt.runtimePath, 'dist'), 0o777)
    expect(await code(readCurrentRuntime(paths, env))).toBe('runtime_tampered')
  })

  it('refuses a runtime file with a second hard link, and a current.json that is a link', async () => {
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    await activateRuntime(paths, env, rt, node)
    await fs.link(path.join(rt.runtimePath, 'dist', 'chunk.js'), path.join(tmp, 'second-link'))
    expect(await code(readCurrentRuntime(paths, env))).toBe('runtime_tampered')
    await fs.rm(path.join(tmp, 'second-link'))
    expect(await readCurrentRuntime(paths, env)).toMatchObject({ version: '0.5.0' })
    await fs.rename(paths.current, path.join(paths.runtime, 'real.json'))
    await fs.symlink(path.join(paths.runtime, 'real.json'), paths.current)
    expect(await code(readCurrentRuntime(paths, env))).toBe('symlink')
  })

  it('refuses a node that is group- or world-writable, at activation and when read back', async () => {
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    for (const mode of [0o775, 0o757]) {
      await fs.chmod(node, mode)
      expect(await code(activateRuntime(paths, env, rt, node))).toBe('group_or_world_writable')
    }
    await fs.chmod(node, 0o755)
    await activateRuntime(paths, env, rt, node)
    await fs.chmod(node, 0o775)
    expect(await code(readCurrentRuntime(paths, env))).toBe('group_or_world_writable')
  })

  it('records a Homebrew node by its formula\'s stable link, never by the Cellar version a brew upgrade deletes', async () => {
    const brew = path.join(tmp, 'brew')
    const cellar = path.join(brew, 'Cellar', 'node', '22.1.0', 'bin', 'node')
    await fs.mkdir(path.dirname(cellar), { recursive: true })
    await fs.writeFile(cellar, '#!/bin/sh\n', { mode: 0o755 })
    await fs.chmod(cellar, 0o755)
    await fs.mkdir(path.join(brew, 'bin'))
    await fs.symlink(path.join('..', 'Cellar', 'node', '22.1.0', 'bin', 'node'), path.join(brew, 'bin', 'node'))
    // No opt link: the prefix's bin/node is not taken (brew link can repoint it), so the Cellar path stays.
    expect(await stableNodePath(cellar)).toBe(cellar)
    await fs.mkdir(path.join(brew, 'opt'))
    await fs.symlink(path.join('..', 'Cellar', 'node', '22.1.0'), path.join(brew, 'opt', 'node'))
    expect(await stableNodePath(cellar)).toBe(path.join(brew, 'opt', 'node', 'bin', 'node'))
    expect(await stableNodePath(path.join(brew, 'bin', 'node'))).toBe(path.join(brew, 'opt', 'node', 'bin', 'node'))
    // An opt link to another file (another version) is not the same node.
    await fs.rm(path.join(brew, 'opt', 'node'))
    const other = path.join(brew, 'Cellar', 'node', '20.0.0', 'bin', 'node')
    await fs.mkdir(path.dirname(other), { recursive: true })
    await fs.writeFile(other, '#!/bin/sh\n', { mode: 0o755 })
    await fs.symlink(path.join('..', 'Cellar', 'node', '20.0.0'), path.join(brew, 'opt', 'node'))
    expect(await stableNodePath(cellar)).toBe(cellar)
    await fs.rm(path.join(brew, 'opt', 'node'))
    // Anything that is not a Cellar node is kept as given.
    expect(await stableNodePath(node)).toBe(node)
    // Activation records the stable link.
    await fs.symlink(path.join('..', 'Cellar', 'node', '22.1.0'), path.join(brew, 'opt', 'node'))
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    expect((await activateRuntime(paths, env, rt, cellar)).execPath).toBe(path.join(brew, 'opt', 'node', 'bin', 'node'))
  })

  it('checks every file of the runtime, not just its entry point', async () => {
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '0.5.0')
    await activateRuntime(paths, env, rt, node)
    await writable(rt.runtimePath)
    const chunk = path.join(rt.runtimePath, 'dist', 'chunk.js')
    await fs.chmod(chunk, 0o600)
    for (const change of [
      () => fs.writeFile(chunk, 'export const x = 2\n'),
      () => fs.writeFile(path.join(rt.runtimePath, 'dist', 'added.js'), ''),
      () => fs.rm(chunk),
    ]) {
      await fs.writeFile(chunk, 'export const x = 1\n', { mode: 0o600 })
      await fs.rm(path.join(rt.runtimePath, 'dist', 'added.js'), { force: true })
      expect(await readCurrentRuntime(paths, env)).toMatchObject({ version: '0.5.0' })
      await change()
      expect(await code(readCurrentRuntime(paths, env))).toBe('runtime_tampered')
    }
  })

  it('knows every public built-in module of the running Node', () => {
    expect([...NODE_BUILTINS].sort()).toEqual(builtinModules.filter((m) => !m.startsWith('_') && !m.startsWith('node:')).sort())
  })

  it('refuses code that loads a module by a computed name', async () => {
    expect(dynamicLoads("import('./a.js'); import(`./b.js`); require('./c.cjs')")).toEqual([])
    expect(dynamicLoads('const m = await import(name)')).toEqual(['import(…)'])
    expect(dynamicLoads('import(`./${x}.js`)')).toEqual(['import(…)'])
    expect(dynamicLoads("import { createRequire } from 'node:module'")).toEqual(['createRequire'])
    expect(dynamicLoads('process.dlopen(m, f)')).toEqual(['process.dlopen'])
    expect(dynamicLoads('import.meta.resolve(spec)')).toEqual(['import.meta.resolve(…)'])
    expect(dynamicLoads('__require(name)')).toEqual(['__require(…)'])
    // A bundler's CommonJS wrapper declares a function named __require; declaring it, or calling it bare, loads nothing.
    expect(dynamicLoads('var __commonJS = (cb, mod) => function __require() { return mod }; init()')).toEqual([])
    expect(dynamicLoads('function require(id) { return id }')).toEqual([])
    expect(dynamicLoads(`var __require = () => { throw Error('Dynamic require of "' + x + '" is not supported') }`)).toEqual(['dynamic require'])
    expect(dynamicLoads('const p = __dirname + __filename')).toEqual(['__dirname', '__filename'])
    expect(dynamicLoads('const __dirname = d; use(__dirname)')).toEqual([])
    expect(dynamicLoads('// createRequire, process.dlopen, __dirname\nexport {}')).toEqual([])
    const { paths } = await ensureStateRoot(env)
    await write('bundles/claude/loader.mjs', 'export const f = (n) => import(n)\n')
    expect(await code(installRuntime(paths, env, source, '0.5.0'))).toBe('runtime_not_self_contained')
  })

  it('keeps the current, the previous and every version the manifest names or still launches, and clears leftovers', async () => {
    const { paths } = await ensureStateRoot(env)
    const old = await installRuntime(paths, env, source, '0.4.7')
    await activateRuntime(paths, env, old, node)
    const b = await installRuntime(paths, env, source, '0.4.9')
    const cur = await activateRuntime(paths, env, b, node)
    expect(cur.previous).toBe('0.4.7')
    await installRuntime(paths, env, source, '0.4.8')
    await installRuntime(paths, env, source, '0.4.6')
    // A manifest entry names 0.4.6; another's harness files still launch 0.4.3.
    await fs.writeFile(paths.manifest, JSON.stringify({
      schemaVersion: 1,
      installs: { 'codex:user': { version: '0.4.6', files: [] }, 'opencode:user': { version: '0.4.9', files: [], runtimes: ['0.4.3'] } },
      // The Codex marketplace is runtime 0.4.2's own bundle.
      shared: { codex: { codexVersion: '0.157.0', marketplace: { name: 'dethereal-local', source: { kind: 'directory', path: path.join(paths.runtime, '0.4.2', 'bundles', 'codex') }, runtimeVersion: '0.4.2', state: 'done' }, plugin: { id: 'dethereal@dethereal-local', state: 'done' } } },
    }))
    await installRuntime(paths, env, source, '0.4.3')
    await installRuntime(paths, env, source, '0.4.2')
    await fs.mkdir(path.join(paths.runtime, '.0.5.0.tmp-0123456789ab'))
    await fs.mkdir(path.join(paths.runtime, '0.4.5.quarantine-20260101T000000000Z'))
    expect(await gcRuntimes(paths, env)).toEqual(['.0.5.0.tmp-0123456789ab', '0.4.8'])
    expect((await fs.readdir(paths.runtime)).sort()).toEqual(['0.4.2', '0.4.3', '0.4.5.quarantine-20260101T000000000Z', '0.4.6', '0.4.7', '0.4.9', 'current.json'])
    // A current.json that no longer fully validates still protects the version it names.
    await fs.chmod(path.join(paths.runtime, '0.4.9'), 0o700)
    await fs.writeFile(path.join(paths.runtime, '0.4.9', 'stray.js'), '')
    expect(await code(readCurrentRuntime(paths, env))).toBe('runtime_tampered')
    expect(await gcRuntimes(paths, env)).toEqual([])
  })

  it('removes the current and previous runtime on an explicit gc once no install uses it; a Claude install never does', async () => {
    const { paths } = await ensureStateRoot(env)
    await activateRuntime(paths, env, await installRuntime(paths, env, source, '0.4.7'), node)
    await activateRuntime(paths, env, await installRuntime(paths, env, source, '0.4.8'), node)
    const tokens = path.join(paths.root, 'tokens.json')
    await fs.writeFile(tokens, '{}\n', { mode: 0o600 })
    // An install that runs the runtime keeps both, explicit gc or not.
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: { 'opencode:user': { version: '0.4.6', files: [] } } }))
    expect(await gcRuntimes(paths, env, { keepCurrent: 'while-used' })).toEqual([])
    // Claude Code runs its own plugin copy: its entry keeps no runtime, not even one of its own version.
    expect(usesRuntime('claude:user')).toBe(false)
    expect(usesRuntime('codex:user')).toBe(true)
    await fs.writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, installs: { 'claude:user': { version: '0.4.8', files: [] } } }))
    // Uninstall's own clean-up keeps what current.json names.
    expect(await gcRuntimes(paths, env)).toEqual([])
    // An explicit gc does not, and current.json goes with the version it names; the copies are read-only.
    // A quarantined copy is kept, a prerelease's too, though its name also reads as a version.
    await fs.mkdir(path.join(paths.runtime, '0.5.0-rc.1.quarantine-20260101T000000000Z'))
    await fs.mkdir(path.join(paths.runtime, '0.4.5.quarantine-20260101T000000000Z'))
    expect(await gcRuntimes(paths, env, { keepCurrent: 'while-used' })).toEqual(['0.4.7', '0.4.8', 'current.json'])
    expect((await fs.readdir(paths.runtime)).sort()).toEqual(['0.4.5.quarantine-20260101T000000000Z', '0.5.0-rc.1.quarantine-20260101T000000000Z'])
    expect(await fs.readFile(tokens, 'utf8')).toBe('{}\n')
  })
})

describe('templates and modes', () => {
  it('matches two stars only as whole segments', () => {
    expect(matchesTemplate('.codex/myconfig.toml', '.codex/**/config.toml')).toBe(false)
    expect(matchesTemplate('.codex/config.toml', '.codex/**/config.toml')).toBe(true)
    expect(matchesTemplate('.codex/a/b/config.toml', '.codex/**/config.toml')).toBe(true)
    expect(matchesTemplate('y', '**/y')).toBe(true)
    expect(matchesTemplate('a/b/c', 'a/**')).toBe(true)
    expect(matchesTemplate('a\nb/c', '**/c')).toBe(true)
    expect(() => matchesTemplate('x', 'a**b')).toThrow(/outside allowed/)
  })

  it('never carries setuid, setgid or sticky bits to a rewrite', async () => {
    const root = await resolveRoot(home, env, '~')
    const file = path.join(root, 'tool.sh')
    await fs.writeFile(file, 'a')
    await fs.chmod(file, 0o4755)
    const t = resolveTarget(file, [{ root, pattern: 'tool.sh' }])
    await writeTarget(t, Buffer.from('b'), sha256('a'), env)
    expect((await fs.stat(file)).mode & 0o7777).toBe(0o755)
  })
})

describe('doctor: our own records', () => {
  it('reports owned keys changed since the install, and missing files', async () => {
    const { paths } = await ensureStateRoot(env)
    const ctx = { paths, env }
    const root = await resolveRoot(home, env, '~')
    const allowed = [{ root, pattern: '.config/opencode/opencode.json' }]
    const file = path.join(root, '.config', 'opencode', 'opencode.json')
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await fs.writeFile(file, '{}')
    const { mergeJson } = await import('../merge-jsonc.js')
    const m = mergeJson(Buffer.from('{}'), ['mcp', 'dethereal'], { command: ['node', 'a.js'] }, 'jsonc', 'opencode.json')
    await applyFileChange(ctx, { key: 'opencode:user', version: '0.5.0', target: resolveTarget(file, allowed), format: 'jsonc', expectPre: sha256('{}'), next: m.bytes, owned: [m.owned] })
    expect(await inspectOwned(ctx, allowed)).toEqual([])
    await fs.writeFile(file, m.bytes.toString().replace('a.js', 'evil.js'))
    expect(await inspectOwned(ctx, allowed)).toEqual([{ key: 'opencode:user', path: file, changed: [['mcp', 'dethereal']] }])
    await fs.rm(file)
    expect(await inspectOwned(ctx, allowed)).toEqual([{ key: 'opencode:user', path: file, changed: 'missing' }])
  })
})

describe('guarding the real home', () => {
  it('uses only the temporary home in these tests', () => {
    expect(env.home.startsWith(tmp)).toBe(true)
    expect(statePaths(home).root.startsWith(tmp)).toBe(true)
  })
})
