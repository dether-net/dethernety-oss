/**
 * Claude Code: install and uninstall the plugin through Claude's own CLI.
 *
 * Claude keeps the plugin, its marketplace and its platform URL in its own
 * settings, so every change goes through `claude plugin …`; the installer writes
 * no Claude file itself. What it records is what it did, so an uninstall undoes
 * exactly that:
 * - the marketplace and the URL are user-wide, recorded once in the manifest's
 *   shared Claude record (the first install's values are kept), and removed or put
 *   back only when the last Claude entry goes;
 * - the plugin is recorded per scope. A plugin that was already installed is
 *   adopted, never owned: uninstall leaves it installed and puts back whether it
 *   was enabled;
 * - each part is recorded `pending` right before its CLI step, so an interrupted
 *   install is still uninstallable.
 * Everything runs under one install lock. Commands that act on a project run in
 * it; every other command runs from the neutral root, so no project file can
 * steer them. Every CLI answer is held to its exact shape, and after the install
 * the plugin must be listed, enabled, at this package's version, with this
 * package's own server files.
 */
import { createHash } from 'node:crypto'
import { promises as fs, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { canonical, refusedBaseReason, within } from '../../../utils/project-root.js'
import { InstallerError } from '../../core/errors.js'
import { cliFailed, type HarnessCliOptions, inputArg, runHarnessCli, runHarnessJson } from '../../core/harness-cli.js'
import {
  type ClaudePluginState, type ClaudeShared, entryKey, type InstallEntry, type Manifest, MARKETPLACE_NAME, type MarketplaceSource, OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_REPO, readManifest, withStateLock,
} from '../../core/manifest.js'
import { type InstallerEnv, resolveRoot } from '../../core/paths.js'
import { type AllowedTarget, readTarget, resolveTarget, sha256 } from '../../core/safe-write.js'
import { dropCliRecords, mutateManifest, recordCliFile, type TxContext } from '../../core/transaction.js'

export const PLUGIN_NAME = 'dethereal'
export const PACKAGE_NAME = '@dether.net/dethereal'

/** Per command: generous for a clone or an npm fetch; a list or a version answers fast. */
const STEP_TIMEOUT_MS = 150_000
const QUERY_TIMEOUT_MS = 30_000
/** The whole install or uninstall, well inside the install lock's ten-minute hold limit. */
const SEQUENCE_DEADLINE_MS = 8 * 60_000
/** What the plugin ships, compared between this package and the installed copy. */
const SHIPPED_PARTS = ['dist', '.claude-plugin', 'bundles/claude']

export type ClaudeScope = 'user' | 'project'

export interface ClaudeInstallOptions {
  ctx: TxContext
  /** This package's root: its version, its plugin manifest's default URL, its own `dist/`. */
  packageRoot: string
  scope: ClaudeScope
  /** The project for a project-scope install (absolute). */
  project?: string
  /** The platform URL to set; unset keeps a configured one, or sets the plugin's default on a first install. */
  platformUrl?: string
  /** A local marketplace directory instead of the official one (release candidates and tests only). */
  marketplaceDir?: string
}

export interface ClaudeInstallReport {
  id: string
  scope: ClaudeScope
  project?: string
  version: string
  marketplace: { name: string; added: boolean }
  plugin: 'installed' | 'updated' | 'up_to_date'
  adopted: boolean
  url: { value: string; source: 'flag' | 'kept' | 'default' } | { value: null; source: 'unchanged' }
  notes: string[]
}

export interface ClaudeUninstallReport {
  id: string
  scope: ClaudeScope
  plugin: 'uninstalled' | 'kept' | 'already_gone'
  marketplace: 'removed' | 'kept' | 'not_ours'
  notes: string[]
}

// ── the CLI's answers, held to their shape ───────────────────────────────────────────────────────

const ok = <T extends z.ZodRawShape>(shape: T) => z.object({ outcome: z.literal('ok'), ...shape }).passthrough()
const MarketplaceList = z.array(z.object({
  name: z.string(), source: z.string(), repo: z.string().optional(), path: z.string().optional(),
}).passthrough())
const PluginList = z.array(z.object({
  id: z.string(), version: z.string(), scope: z.string(), enabled: z.boolean(),
  installPath: z.string().optional(), projectPath: z.string().optional(),
}).passthrough())
const MarketplaceAdded = ok({ marketplace: z.string() })
const Installed = ok({ configApplied: z.boolean().optional() })
const Updated = ok({ updateOutcome: z.enum(['updated', 'up_to_date']), newVersion: z.string().optional() })
const Done = ok({})

type Listed = z.infer<typeof PluginList>[number]

const VERSION_LINE = /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/
/**
 * The oldest Claude Code that blocks a call when a guard hook fails or runs out of time (`onFailure`); an older one runs
 * the call. Its `claude plugin` commands all answer in JSON too, as from 2.1.287.
 */
export const CLAUDE_FLOOR = '2.1.295'
/** Why a Claude Code is refused, naming the version it needs. */
export const claudeFloorMessage = (version: string) => `Claude Code ${version} is older than ${CLAUDE_FLOOR}, the first that blocks a call when a guard hook fails; update Claude Code`
export const olderThanFloor = (version: string) => older(version, CLAUDE_FLOOR)
function older(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x![i] !== y![i]) return x![i]! < y![i]!
  return false
}

/** Refuse a Claude Code older than the floor, before any command that changes something; its version otherwise. */
async function assertFloor(cli: Cli): Promise<string> {
  const version = await cli.version()
  if (older(version, CLAUDE_FLOOR)) throw new InstallerError('harness_version', claudeFloorMessage(version))
  return version
}

/** The Claude Code version, as `claude --version` gives it (for doctor). */
export const claudeCliVersion = (env: InstallerEnv): Promise<string> => cliFor(env).version()
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

// ── inputs ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The platform URL as Claude will store it: http(s), no user info, no query or
 * fragment, none of the characters a `KEY=VALUE` option or a settings file could
 * misread; normalised to origin + path.
 */
export function normalisePlatformUrl(raw: string): string {
  // eslint-disable-next-line no-control-regex
  if (raw.length > 2048 || /[\s\u0000-\u001f\u007f,"'`\\]/.test(raw)) throw new InstallerError('argument_refused', 'platform URL')
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new InstallerError('argument_refused', 'platform URL')
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || raw.includes('?') || raw.includes('#')) {
    throw new InstallerError('argument_refused', 'platform URL')
  }
  const pathname = u.pathname.replace(/\/+$/, '')
  return `${u.origin}${pathname}`
}

/** The project for a project-scope install: a real directory the user owns, not the home or the filesystem root. */
export async function checkProject(dir: string, env: InstallerEnv): Promise<string> {
  if (!path.isAbsolute(dir)) throw new InstallerError('argument_refused', 'project')
  const real = canonical(dir)
  const st = await fs.stat(real).catch(() => null)
  if (!st?.isDirectory()) throw new InstallerError('not_a_directory', 'project')
  if (st.uid !== env.euid) throw new InstallerError('not_owned', 'project')
  if (refusedBaseReason(real)) throw new InstallerError('argument_refused', 'project')
  // Claude writes `<project>/.claude/settings.json` and would follow a link there.
  for (const p of [path.join(real, '.claude'), path.join(real, '.claude', 'settings.json')]) {
    const l = await fs.lstat(p).catch(() => null)
    if (l?.isSymbolicLink()) throw new InstallerError('symlink', path.relative(real, p))
  }
  return real
}

const TEMP_DIRS = () => [os.tmpdir(), '/tmp', '/var/tmp', '/dev/shm'].map((d) => canonical(d))

/** The real path, also of a path that does not exist: the nearest existing folder above it, resolved, with the rest appended. */
function realPathOf(p: string): string {
  const rest: string[] = []
  for (let cur = path.resolve(p); ;) {
    try {
      return path.join(realpathSync.native(cur), ...rest.reverse())
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return path.resolve(p)
      rest.push(path.basename(cur))
      cur = parent
    }
  }
}

/** A tree the user owns, nobody else can write, with no link anywhere in it. */
async function checkOwnedTree(dir: string, env: InstallerEnv, label: string, depth = 0): Promise<void> {
  const st = await fs.lstat(dir).catch(() => null)
  if (!st) throw new InstallerError('not_a_directory', label)
  if (st.isSymbolicLink()) throw new InstallerError('symlink', label)
  if (st.uid !== env.euid) throw new InstallerError('not_owned', label)
  if ((st.mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', label)
  if (!st.isDirectory()) {
    if (!st.isFile()) throw new InstallerError('not_regular', label)
    return
  }
  if (depth > 12) throw new InstallerError('too_large', label)
  for (const e of await fs.readdir(dir)) await checkOwnedTree(path.join(dir, e), env, `${label}/${e}`, depth + 1)
}

const LocalMarketplace = z.object({
  name: z.string(),
  plugins: z.array(z.object({
    name: z.string(),
    source: z.union([
      z.string(),
      z.object({ source: z.literal('npm'), package: z.literal(PACKAGE_NAME), version: z.string() }).strict(),
    ]),
  }).passthrough()),
}).passthrough()

/**
 * A local marketplace a release candidate or a test installs from. Claude loads
 * a directory plugin in place, so whoever can write that directory runs code in
 * every later session: it must be the user's alone, link-free, outside the temp
 * directories, and hold exactly one plugin, ours, from a path inside it or from
 * npm at an exact version.
 */
export async function checkMarketplaceDir(dir: string, env: InstallerEnv): Promise<{ name: string; path: string }> {
  if (!path.isAbsolute(dir)) throw new InstallerError('argument_refused', 'marketplace')
  // A folder that does not exist is placed by the nearest one above it that does: /tmp/x is under /private/tmp too.
  if (TEMP_DIRS().some((t) => within(realPathOf(dir), t))) throw new InstallerError('argument_refused', 'marketplace')
  const real = canonical(dir)
  await checkOwnedTree(real, env, 'marketplace')
  let parsed: z.infer<typeof LocalMarketplace>
  try {
    parsed = LocalMarketplace.parse(JSON.parse(await fs.readFile(path.join(real, '.claude-plugin', 'marketplace.json'), 'utf8')))
  } catch {
    throw new InstallerError('parse_error', 'marketplace/.claude-plugin/marketplace.json')
  }
  if (!MARKETPLACE_NAME.test(parsed.name) || parsed.name === OFFICIAL_MARKETPLACE_NAME) throw new InstallerError('argument_refused', 'marketplace name')
  if (parsed.plugins.length !== 1 || parsed.plugins[0]!.name !== PLUGIN_NAME) throw new InstallerError('argument_refused', 'marketplace plugins')
  const source = parsed.plugins[0]!.source
  if (typeof source === 'string') {
    const inside = path.resolve(real, source)
    if (!within(inside, real) || inside === real) throw new InstallerError('argument_refused', 'marketplace plugin source')
  } else if (!SEMVER.test(source.version)) {
    throw new InstallerError('argument_refused', 'marketplace plugin version')
  }
  return { name: parsed.name, path: real }
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Claude's user settings: `$CLAUDE_CONFIG_DIR/settings.json`, or `~/.claude/settings.json`. */
export function claudeDir(env: InstallerEnv): { root: string; pattern: string } {
  const configured = env.vars.CLAUDE_CONFIG_DIR
  return configured && path.isAbsolute(configured) ? { root: configured, pattern: 'settings.json' } : { root: env.home, pattern: '.claude/settings.json' }
}

export async function readSettings(file: string): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const configuredUrl = (settings: Record<string, unknown>, id: string): string | null => {
  const v = (settings.pluginConfigs as Record<string, { options?: Record<string, unknown> }> | undefined)?.[id]?.options?.platform_url
  return typeof v === 'string' && v.length > 0 && v.length <= 2048 ? v : null
}

export async function packageVersion(packageRoot: string): Promise<string> {
  const v = (JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }).version
  if (typeof v !== 'string' || !SEMVER.test(v)) throw new InstallerError('runtime_invalid', 'package.json version')
  return v
}

export async function defaultUrl(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, '.claude-plugin', 'plugin.json'), 'utf8')) as {
    userConfig?: { platform_url?: { default?: unknown } }
  }
  const d = manifest.userConfig?.platform_url?.default
  if (typeof d !== 'string') throw new InstallerError('runtime_invalid', 'plugin.json userConfig')
  return normalisePlatformUrl(d)
}

/** One hash over what the plugin ships: its server build, its manifest and its Claude bundle, every file by path and content. */
export async function shippedHash(root: string): Promise<string | null> {
  const files: string[] = []
  const walk = async (d: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) throw new Error('link')
      if (e.isDirectory()) await walk(path.join(d, e.name), path.posix.join(rel, e.name))
      else if (e.isFile()) files.push(path.posix.join(rel, e.name))
    }
  }
  try {
    for (const part of SHIPPED_PARTS) await walk(path.join(root, part), part)
    const h = createHash('sha256')
    for (const f of files.sort()) h.update(`${f}\0${sha256(await fs.readFile(path.join(root, f)))}\n`)
    return h.digest('hex')
  } catch {
    return null
  }
}

const atScope = (list: Listed[], id: string, scope: ClaudeScope, project?: string) =>
  list.find((p) => p.id === id && p.scope === scope && (scope === 'user' || (p.projectPath !== undefined && canonical(p.projectPath) === project)))

/** Text from the CLI, safe to show: printable ASCII only, short. */
const shown = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, 64)

/**
 * Steps of one install or uninstall: each runs only while the lock is still ours
 * (a broken lock never lets two installs interleave) and while the whole sequence
 * is inside its deadline, which keeps it well under the lock's hold limit.
 */
type Step = <T>(fn: () => Promise<T>) => Promise<T>
function stepper(tx: TxContext): Step {
  const deadline = Date.now() + SEQUENCE_DEADLINE_MS
  return async (fn) => {
    if (Date.now() > deadline) throw new InstallerError('harness_cli_failed', 'the install took too long; run it again')
    await tx.lock?.assertHeld()
    return fn()
  }
}

interface Cli {
  json<T>(args: string[], schema: z.ZodType<T>, label: string, inProject?: boolean, timeoutMs?: number): Promise<T>
  version(): Promise<string>
  plugins(): Promise<Listed[]>
  marketplaces(): Promise<z.infer<typeof MarketplaceList>>
}

function cliFor(env: InstallerEnv, project?: string): Cli {
  const opts = (inProject: boolean, timeoutMs: number): HarnessCliOptions => ({
    env, timeoutMs, ...(inProject && project ? { cwd: project, projectRoot: project } : project ? { projectRoot: project } : {}),
  })
  const json = <T>(args: string[], schema: z.ZodType<T>, label: string, inProject = false, timeoutMs = STEP_TIMEOUT_MS) =>
    runHarnessJson('claude', args, schema, label, opts(inProject, timeoutMs))
  return {
    json,
    async version() {
      const r = await runHarnessCli('claude', ['--version'], opts(false, QUERY_TIMEOUT_MS))
      const m = r.code === 0 && !r.failure ? VERSION_LINE.exec(r.stdout.trim()) : null
      if (r.failure === 'spawn') throw new InstallerError('harness_cli_missing', 'claude --version')
      if (!m) throw cliFailed('claude --version', r)
      return m[1]!
    },
    plugins: () => json(['plugin', 'list', '--json'], PluginList, 'plugin list', false, QUERY_TIMEOUT_MS),
    marketplaces: () => json(['plugin', 'marketplace', 'list', '--json'], MarketplaceList, 'plugin marketplace list', false, QUERY_TIMEOUT_MS),
  }
}

/** An entry's Claude plugin record, when it holds one. */
const claudeOf = (e: InstallEntry | undefined): ClaudePluginState | undefined => (e?.cli?.harness === 'claude' ? e.cli : undefined)
/** Claude's own list of installed plugins, held to its shape (for doctor). */
export const claudePlugins = (env: InstallerEnv): Promise<Listed[]> => cliFor(env).plugins()
export type ClaudeListed = Listed

const claudeEntries = (m: Manifest) => Object.entries(m.installs).filter(([k, e]) => k.startsWith('claude:') && claudeOf(e))
const hasClaudeEntries = async (paths: TxContext['paths'], env: InstallerEnv) => claudeEntries((await readManifest(paths, env)).manifest).length > 0

const sourceMatches = (listed: z.infer<typeof MarketplaceList>[number], source: MarketplaceSource) =>
  source.kind === 'github'
    ? listed.source === 'github' && listed.repo === source.repo
    : listed.source === 'directory' && listed.path !== undefined && canonical(listed.path) === source.path

export const userSettingsFile = async (env: InstallerEnv) => {
  const user = claudeDir(env)
  return path.join(await resolveRoot(user.root, env, 'Claude settings'), user.pattern)
}

/**
 * Undo one entry's plugin: one this installer added is uninstalled; one it
 * adopted stays installed and is disabled again if it was. Then the entry goes.
 */
async function undoEntry(tx: TxContext, step: Step, key: string, plugin: ClaudePluginState, scope: ClaudeScope, project: string | undefined,
  notes: string[]): Promise<ClaudeUninstallReport['plugin']> {
  const cli = cliFor(tx.env, project)
  const scopeArgs = ['--scope', scope]
  const listed = atScope(await cli.plugins(), plugin.id, scope, project)
  let outcome: ClaudeUninstallReport['plugin'] = 'already_gone'
  if (plugin.preexisting === false) {
    if (listed) {
      await step(() => cli.json(['plugin', 'uninstall', inputArg(plugin.id, 'plugin'), ...scopeArgs, '--json'], Done, 'plugin uninstall', true))
      outcome = 'uninstalled'
    }
  } else {
    outcome = 'kept'
    if (listed && plugin.preexisting.enabled === false && listed.enabled) {
      await step(() => cli.json(['plugin', 'disable', inputArg(plugin.id, 'plugin'), ...scopeArgs, '--json'], Done, 'plugin disable', true))
    }
    if (listed && listed.version !== plugin.preexisting.version) {
      notes.push(`the plugin stays at ${SEMVER.test(listed.version) ? listed.version : 'another version'}; it was ${plugin.preexisting.version} before, and Claude cannot go back a version`)
    }
  }
  await dropCliRecords(tx, key)
  await step(() => mutateManifest(tx, (m) => { delete m.installs[key] }))
  return outcome
}

/**
 * The shared part, once no Claude entry is left: the URL put back where the
 * plugin stays installed, then the marketplace removed if this installer added it
 * and nothing installed comes from it, then the record. The record goes only
 * after every step completed, so a step that fails is tried again by the next
 * uninstall.
 */
async function teardownShared(tx: TxContext, step: Step, notes: string[]): Promise<ClaudeUninstallReport['marketplace']> {
  const { env, paths } = tx
  const shared = (await readManifest(paths, env)).manifest.shared?.claude
  if (!shared || (await hasClaudeEntries(paths, env))) return 'kept'
  const id = `${PLUGIN_NAME}@${shared.marketplace.name}`
  const cli = cliFor(env)
  // Claude keeps listing a project-scope copy after its project is deleted; such a copy uses nothing.
  const live = async (p: Listed) => p.scope !== 'project' || !p.projectPath || !!(await fs.stat(p.projectPath).catch(() => null))?.isDirectory()
  const after: Listed[] = []
  for (const p of await cli.plugins()) if (await live(p)) after.push(p)
  const copies = after.filter((p) => p.id === id)
  if (shared.config.current !== null && copies.length > 0 && configuredUrl(await readSettings(await userSettingsFile(env)), id) === shared.config.current) {
    if (shared.config.previous === null) {
      notes.push('the platform URL this installer set stays: Claude cannot unset it; change it with /plugin configure')
    } else {
      // The URL is user-wide: set it through a user-scope copy, or a project copy that passes the project checks.
      const user = copies.find((p) => p.scope === 'user')
      let where: { scope: ClaudeScope; project?: string } | null = user ? { scope: 'user' } : null
      for (const p of copies) {
        if (where || p.scope !== 'project' || !p.projectPath) continue
        const checked = await checkProject(p.projectPath, env).catch(() => null)
        if (checked) where = { scope: 'project', project: checked }
      }
      if (where) {
        const restore = cliFor(env, where.project)
        await step(() => restore.json(['plugin', 'install', inputArg(id, 'plugin'), '--scope', where.scope,
          '--config', `platform_url=${inputArg(shared.config.previous!, 'platform URL')}`, '--json'], Installed, 'plugin install', where.project !== undefined))
      } else {
        notes.push('the platform URL could not be put back: the plugin stays installed only where this installer will not act; change it with /plugin configure')
      }
    }
  }
  let marketplace: ClaudeUninstallReport['marketplace'] = 'kept'
  if (!shared.marketplace.added) {
    marketplace = 'not_ours'
  } else {
    const listed = (await cli.marketplaces()).find((m) => m.name === shared.marketplace.name)
    if (!listed) {
      marketplace = 'removed'
    } else if (!sourceMatches(listed, shared.marketplace.source)) {
      notes.push(`the ${shared.marketplace.name} marketplace now comes from somewhere else, so it stays`)
    } else if (after.some((p) => p.id.endsWith(`@${shared.marketplace.name}`))) {
      notes.push(`the ${shared.marketplace.name} marketplace stays: a plugin from it is still installed`)
    } else {
      await step(() => cli.json(['plugin', 'marketplace', 'remove', inputArg(shared.marketplace.name, 'marketplace'), '--json'], Done, 'plugin marketplace remove'))
      marketplace = 'removed'
    }
  }
  await step(() => mutateManifest(tx, (m) => { if (m.shared) delete m.shared.claude }))
  return marketplace
}

// ── install ──────────────────────────────────────────────────────────────────────────────────────

export async function installClaude(opts: ClaudeInstallOptions): Promise<ClaudeInstallReport> {
  const { env, paths } = opts.ctx
  const version = await packageVersion(opts.packageRoot)
  const project = opts.scope === 'project' ? await checkProject(opts.project ?? '', env) : undefined
  // Another user who can write the project could swap `.claude` for a link between the check and Claude's write.
  if (project && ((await fs.stat(project)).mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', 'project (chmod go-w it first)')
  const url = opts.platformUrl !== undefined ? normalisePlatformUrl(opts.platformUrl) : undefined
  const local = opts.marketplaceDir !== undefined ? await checkMarketplaceDir(opts.marketplaceDir, env) : undefined
  const source: MarketplaceSource = local ? { kind: 'directory', path: local.path } : { kind: 'github', repo: OFFICIAL_MARKETPLACE_REPO }
  const name = local ? local.name : OFFICIAL_MARKETPLACE_NAME
  const id = `${PLUGIN_NAME}@${name}`
  const key = entryKey('claude', project ? { project } : 'user')
  const cli = cliFor(env, project)
  const notes: string[] = []
  const mine = await shippedHash(opts.packageRoot)
  if (!mine) throw new InstallerError('runtime_invalid', 'package files')

  return withStateLock(paths, env, async (lock) => {
    const tx: TxContext = { ...opts.ctx, lock }
    const step = stepper(tx)
    const claudeVersion = await assertFloor(cli)

    // What Claude holds before this install touches anything.
    const user = claudeDir(env)
    const userRoot = await resolveRoot(user.root, env, 'Claude settings')
    const userSettingsPath = path.join(userRoot, user.pattern)
    const allowed: AllowedTarget[] = [{ root: userRoot, pattern: user.pattern }, ...(project ? [{ root: project, pattern: '.claude/settings.json' }] : [])]
    const preOf = async (file: string) => (await readTarget(resolveTarget(file, allowed), env).catch(() => null))?.sha256 ?? 'absent'
    const watched = [userSettingsPath, ...(project ? [path.join(project, '.claude', 'settings.json')] : [])]
    const pre = new Map<string, string>()
    for (const f of watched) pre.set(f, await preOf(f))

    let plugins = await cli.plugins()
    const other = plugins.find((p) => p.id.startsWith(`${PLUGIN_NAME}@`) && p.id !== id)
    // Two copies would run every hook twice.
    if (other) throw new InstallerError('harness_cli_refused', `another copy is installed (${shown(other.id)}, ${shown(other.scope)} scope); uninstall it first`)

    const markets = await cli.marketplaces()
    const sameName = markets.find((m) => m.name === name)
    if (sameName && !sourceMatches(sameName, source)) throw new InstallerError('harness_cli_refused', `a marketplace named ${name} comes from somewhere else`)

    // The shared record: created once, by the first Claude install, and never repointed.
    await step(() => mutateManifest(tx, (m) => {
      const shared = m.shared?.claude
      if (shared) {
        if (shared.marketplace.name !== name || JSON.stringify(shared.marketplace.source) !== JSON.stringify(source)) {
          throw new InstallerError('harness_cli_refused', `installed from ${shared.marketplace.name} before; uninstall that first`)
        }
        shared.claudeVersion = claudeVersion
        // Gone since (removed by hand): this install adds it again, so it is ours to remove.
        if (!sameName) shared.marketplace = { ...shared.marketplace, added: true, state: 'pending' }
        return
      }
      const record: ClaudeShared = {
        claudeVersion,
        marketplace: { name, source, added: !sameName, state: sameName ? 'done' : 'pending' },
        config: { previous: null, current: null },
      }
      m.shared = { ...m.shared, claude: record }
    }))

    try {
      return await installPlugin()
    } catch (err) {
      // A failed first install leaves no shared state of its own; a teardown that cannot finish keeps the record for uninstall.
      await teardownShared(tx, step, []).catch(() => undefined)
      throw err
    }

    async function installPlugin(): Promise<ClaudeInstallReport> {
      if (!sameName) {
        const added = await step(() => cli.json(['plugin', 'marketplace', 'add', inputArg(local ? local.path : OFFICIAL_MARKETPLACE_REPO, 'marketplace'), '--json'],
          MarketplaceAdded, 'plugin marketplace add'))
        if (added.marketplace !== name) throw new InstallerError('harness_cli_refused', 'the marketplace added under another name')
        const listed = (await cli.marketplaces()).find((m) => m.name === name)
        if (!listed || !sourceMatches(listed, source)) throw new InstallerError('harness_cli_refused', 'the marketplace is not listed from its source')
      } else if (source.kind === 'github') {
        // The update path reads the newest marketplace.
        await step(() => cli.json(['plugin', 'marketplace', 'update', inputArg(name, 'marketplace'), '--json'], Done, 'plugin marketplace update'))
      }
      await step(() => mutateManifest(tx, (m) => { m.shared!.claude!.marketplace.state = 'done' }))

      // The plugin, at this scope.
      plugins = await cli.plugins()
      const listedBefore = atScope(plugins, id, opts.scope, project)
      const urlBefore = configuredUrl(await readSettings(userSettingsPath), id)
      const { ours, existed } = await step(() => mutateManifest(tx, (m) => {
        const entry = m.installs[key] ?? { version, files: [] }
        const existed = claudeOf(entry) !== undefined
        const recorded = claudeOf(entry)
        if (!recorded) {
          entry.cli = {
            harness: 'claude', id,
            preexisting: listedBefore ? { version: SEMVER.test(listedBefore.version) ? listedBefore.version : '0.0.0', enabled: listedBefore.enabled } : false,
            state: 'pending',
          }
        } else {
          recorded.state = 'pending'
        }
        entry.version = version
        m.installs[key] = entry
        // The URL as it was before any install set one: kept from the first time.
        const shared = m.shared!.claude!
        if (shared.config.current === null && shared.config.previous === null) shared.config.previous = urlBefore
        return { ours: claudeOf(entry)!, existed }
      }))

      // A scope the plugin is new at is installed with a URL. Claude keeps it for every project of this user, so the
      // one it already has is given again; the package default only when it has none it can use.
      const kept = listedBefore || url !== undefined || !urlBefore ? null : (() => { try { return normalisePlatformUrl(urlBefore) } catch { return null } })()
      const urlToSet = url ?? (listedBefore ? undefined : kept ?? await defaultUrl(opts.packageRoot))
      const configArgs = urlToSet ? ['--config', `platform_url=${inputArg(urlToSet, 'platform URL')}`] : []
      const scopeArgs = ['--scope', opts.scope]
      let outcome: ClaudeInstallReport['plugin']
      try {
        if (!listedBefore) {
          const r = await step(() => cli.json(['plugin', 'install', inputArg(id, 'plugin'), ...scopeArgs, ...configArgs, '--json'], Installed, 'plugin install', true))
          if (r.configApplied !== true) throw new InstallerError('harness_cli_refused', 'Claude did not apply the platform URL')
          outcome = 'installed'
        } else {
          const r = await step(() => cli.json(['plugin', 'update', inputArg(id, 'plugin'), ...scopeArgs, '--json'], Updated, 'plugin update', true))
          outcome = r.updateOutcome
          // Installing means enabled; uninstall puts a plugin that was disabled back that way.
          if (!listedBefore.enabled) await step(() => cli.json(['plugin', 'enable', inputArg(id, 'plugin'), ...scopeArgs, '--json'], Done, 'plugin enable', true))
          if (configArgs.length) {
            const c = await step(() => cli.json(['plugin', 'install', inputArg(id, 'plugin'), ...scopeArgs, ...configArgs, '--json'], Installed, 'plugin install', true))
            if (c.configApplied !== true) throw new InstallerError('harness_cli_refused', 'Claude did not apply the platform URL')
          }
        }
        if (urlToSet) await step(() => mutateManifest(tx, (m) => { m.shared!.claude!.config.current = urlToSet }))

        // The result, as Claude reports it and as its settings hold it.
        const after = atScope(await cli.plugins(), id, opts.scope, project)
        if (!after || !after.enabled) throw new InstallerError('harness_cli_refused', 'the plugin is not listed as enabled')
        if (after.version !== version) {
          throw new InstallerError('harness_cli_refused', `the marketplace serves ${SEMVER.test(after.version) ? after.version : 'another version'}, this installer is ${version}`)
        }
        const enabledIn = await readSettings(project ? path.join(project, '.claude', 'settings.json') : userSettingsPath)
        if ((enabledIn.enabledPlugins as Record<string, unknown> | undefined)?.[id] !== true) throw new InstallerError('harness_cli_refused', 'the settings do not enable the plugin')
        const installed = after.installPath ? await shippedHash(after.installPath) : null
        if (!installed || installed !== mine) throw new InstallerError('harness_cli_refused', 'the installed plugin files are not this package\'s')
      } catch (err) {
        if (existed) {
          // A re-install that failed leaves the earlier install in place, still recorded.
          await mutateManifest(tx, (m) => { const c = m.installs[key]?.cli; if (c) c.state = 'done' }).catch(() => undefined)
        } else {
          // A first install that failed is undone: a plugin it added is uninstalled, one it adopted is put back.
          await undoEntry(tx, step, key, ours, opts.scope, project, []).catch(() => undefined)
        }
        throw err
      }

      await step(() => mutateManifest(tx, (m) => { m.installs[key]!.cli!.state = 'done' }))
      for (const f of watched) {
        try {
          const now = await preOf(f)
          if (now !== pre.get(f)) await recordCliFile(tx, key, version, resolveTarget(f, allowed), 'json', pre.get(f)!)
        } catch {
          notes.push(`${f === userSettingsPath ? 'Claude settings' : 'project settings'} could not be recorded (a link, or unreadable); doctor will not track them`)
        }
      }
      if (ours.preexisting) notes.push(`the plugin was already installed (${ours.preexisting.version}); uninstall will leave it installed`)
      return {
        id, scope: opts.scope, ...(project ? { project } : {}), version,
        marketplace: { name, added: !sameName },
        plugin: outcome,
        adopted: ours.preexisting !== false,
        url: urlToSet ? { value: urlToSet, source: url ? 'flag' : kept ? 'kept' : 'default' } : { value: null, source: 'unchanged' },
        notes,
      }
    }
  })
}

/**
 * A project as install keyed it: its real path, or, for a folder that is gone, the real path of its
 * nearest existing parent with the rest appended (a link above the project still resolves the same).
 */
function keyedPath(p: string): string {
  const rest: string[] = []
  for (let head = path.resolve(p); ; head = path.dirname(head)) {
    try {
      return path.join(realpathSync.native(head), ...rest.reverse())
    } catch {
      if (path.dirname(head) === head) return path.resolve(p)
      rest.push(path.basename(head))
    }
  }
}

// ── uninstall ────────────────────────────────────────────────────────────────────────────────────

export async function uninstallClaude(opts: { ctx: TxContext; scope: ClaudeScope; project?: string; forgetMissingProject?: boolean }): Promise<ClaudeUninstallReport | null> {
  const { env, paths } = opts.ctx
  if (opts.scope === 'project' && !path.isAbsolute(opts.project ?? '')) throw new InstallerError('argument_refused', 'project')
  const project = opts.scope === 'project' ? keyedPath(opts.project!) : undefined
  const key = entryKey('claude', project ? { project } : 'user')

  return withStateLock(paths, env, async (lock) => {
    const tx: TxContext = { ...opts.ctx, lock }
    const step = stepper(tx)
    const { manifest } = await readManifest(paths, env)
    const entry = manifest.installs[key]
    const shared = manifest.shared?.claude
    const notes: string[] = []
    const recorded = claudeOf(entry)
    if (!recorded) {
      // Nothing at this scope; a shared record no entry needs any more (an earlier uninstall stopped short) is finished here.
      if (!shared || claudeEntries(manifest).length > 0) return null
      await assertFloor(cliFor(env))
      const marketplace = await teardownShared(tx, step, notes)
      return { id: `${PLUGIN_NAME}@${shared.marketplace.name}`, scope: opts.scope, plugin: 'already_gone', marketplace, notes }
    }
    await assertFloor(cliFor(env))
    const id = recorded.id
    let plugin: ClaudeUninstallReport['plugin']
    if (project && !(await fs.stat(project).catch(() => null))?.isDirectory()) {
      if (!opts.forgetMissingProject) throw new InstallerError('not_a_directory', 'project (gone; its entry stays recorded)')
      // The project is gone, and with it the setting Claude wrote there: forget the entry, run nothing in it.
      await dropCliRecords(tx, key)
      await step(() => mutateManifest(tx, (m) => { delete m.installs[key] }))
      notes.push('the project is gone; its entry is forgotten')
      plugin = 'already_gone'
    } else {
      // The project is checked again before any command runs in it.
      const checked = project ? await checkProject(project, env) : undefined
      plugin = await undoEntry(tx, step, key, recorded, opts.scope, checked, notes)
    }
    const marketplace = await teardownShared(tx, step, notes)
    return { id, scope: opts.scope, plugin, marketplace, notes }
  })
}
