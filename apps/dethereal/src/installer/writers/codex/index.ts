/**
 * The Codex writer: installs Dethereal for Codex CLI and takes it out again.
 *
 * What it writes, in this order:
 * - the `[mcp_servers.dethereal]` table, as a managed block in the user's (or a
 *   trusted project's) `config.toml`: the server, its approvals and its URL;
 * - the agent files, into `agents/` beside that config;
 * - through Codex's own CLI, last: the local marketplace (the installed runtime's
 *   read-only `bundles/codex`) and the plugin (skills and hooks) from it.
 *
 * It never grants trust: no `trust_level`, no hook trust. A project counts only
 * when Codex would load its `.codex/` folder (the folder, its git root or its main
 * checkout trusted, by Codex's rule); otherwise the install goes user-wide and says so. The plugin is user-wide in Codex, so every Codex entry
 * shares it, and it goes with the last one.
 *
 * An upgrade reverts the old records first. A failure part-way puts the files back
 * as they were (each only while it still holds what the failed step left) and the
 * marketplace back to its previous runtime.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { unmergeRecord, ownedModified } from '../../core/editors.js'
import { InstallerError } from '../../core/errors.js'
import type { HarnessCliOptions } from '../../core/harness-cli.js'
import { CODEX_MARKETPLACE_NAME, CODEX_PLUGIN_ID, type CodexShared, entryKey, type FileRecord, type Manifest, readManifest } from '../../core/manifest.js'
import { deleteTomlTables, mergeToml, TOML_BEGIN, TOML_END, tomlTreeDiff } from '../../core/merge-toml.js'
import { ensureDirUnder, type InstallerEnv, resolveRoot, type StatePaths } from '../../core/paths.js'
import { type AllowedTarget, readTarget, resolveTarget, sha256, type Target, writeTarget } from '../../core/safe-write.js'
import { applyFileChange, mutateManifest, type RevertOutcome, revertFile, type TxContext } from '../../core/transaction.js'
import { addMarketplace, addPlugin, codexVersion, listPlugins, removeMarketplace, removePlugin } from './cli.js'
import { parse } from 'smol-toml'
import { hasServer, hookStateKeys, marketplaceSource, projectTrusted, readConfig, renderFragment, runtimeOfSource, SERVER_TABLE, serverUrlOf } from './config.js'

export { codexAppServerVersions, codexHookTrust, type CodexHookTrust, HOOK_COUNT } from './config.js'

const sharedOf = (m: Manifest) => (m.shared ??= {})
const marketplaceOf = (ctx: TxContext, runtimeVersion: string, state: 'pending' | 'done'): CodexShared['marketplace'] =>
  ({ name: CODEX_MARKETPLACE_NAME, source: { kind: 'directory', path: path.join(ctx.paths.runtime, runtimeVersion, 'bundles', 'codex') }, runtimeVersion, state })
/** Entries that count for the shared Codex record. */
const codexEntries = (m: Manifest) => Object.entries(m.installs).filter(([k, e]) => k.startsWith('codex:') && e.cli?.harness === 'codex').map(([k]) => k)

export interface CodexInstallInput {
  /** The caller holds the install lock (`ctx.lock`) and activates the runtime afterwards. */
  ctx: TxContext
  scope: 'user' | 'project'
  project?: string
  platformUrl: string
  runtime: { version: string; runtimePath: string }
  /** The Node binary the server runs on, as the runtime records it. */
  node: string
}

export interface CodexInstallResult {
  scope: 'user' | 'project'
  codexVersion: string
  notices: string[]
  /**
   * When the user had changed the installer's part of the config: the values this
   * install set differently from what was there (approvals and the URL included),
   * as dotted paths under the server table.
   */
  reset: string[]
}

export interface CodexUninstallResult {
  removed: string[]
  /** Files left for the user, with why. */
  manual: Array<{ path: string; outcome: RevertOutcome }>
  /** Codex's trust entries for the plugin's hooks that were removed with the plugin. */
  hookTrustRemoved: string[]
  /** Trust entries that could not be removed safely: the user removes them (`config.toml`, `hooks.state`). */
  hookTrust: string[]
  /** The project folder is gone: its entry was dropped without touching files. */
  forgotten?: boolean
  /** Codex CLI steps that failed: what may be left in Codex for the user to remove. */
  cliLeft: string[]
  notices: string[]
  pluginRemoved: boolean
}

const AGENT_FILE = /^dethereal-[a-z0-9-]+\.toml$/
const QUIT_CODEX = 'Quit Codex before this change takes effect: a running Codex, and its background app-server, keep the plugin they started with until they are restarted.'
const DONE: readonly RevertOutcome[] = ['deleted', 'restored', 'unmerged', 'missing']

interface Layout {
  scope: 'user' | 'project'
  codexHome: string
  projectReal?: string
  /** The folder holding the config and `agents/` for this scope. */
  base: string
  allowed: AllowedTarget[]
  config: Target
  agent: (name: string) => Target
  key: string
}

async function codexHomeOf(ctx: TxContext): Promise<string> {
  const set = ctx.env.vars.CODEX_HOME
  if (set) return resolveRoot(set, ctx.env, 'CODEX_HOME')
  return ensureDirUnder(await resolveRoot(ctx.env.home, ctx.env, 'home'), '.codex', ctx.env)
}

function layoutOf(scope: 'user' | 'project', codexHome: string, projectReal?: string): Layout {
  const base = scope === 'user' ? codexHome : path.join(projectReal!, '.codex')
  const allowed: AllowedTarget[] = scope === 'user'
    ? [{ root: codexHome, pattern: 'config.toml' }, { root: codexHome, pattern: 'agents/dethereal-*.toml' }]
    : [{ root: projectReal!, pattern: '.codex/config.toml' }, { root: projectReal!, pattern: '.codex/agents/dethereal-*.toml' }]
  return {
    scope, codexHome, projectReal, base, allowed,
    config: resolveTarget(path.join(base, 'config.toml'), allowed),
    agent: (name) => resolveTarget(path.join(base, 'agents', name), allowed),
    key: entryKey('codex', scope === 'user' ? 'user' : { project: projectReal! }),
  }
}

async function readUserConfig(ctx: TxContext, codexHome: string): Promise<Record<string, unknown>> {
  const t = resolveTarget(path.join(codexHome, 'config.toml'), [{ root: codexHome, pattern: 'config.toml' }])
  return readConfig((await readTarget(t, ctx.env))?.bytes ?? null, 'config.toml')
}

async function readBundle(runtimePath: string): Promise<{ fragment: string; agents: Array<{ name: string; bytes: Buffer }> }> {
  const dir = path.join(runtimePath, 'bundles', 'codex')
  const fragment = await fs.readFile(path.join(dir, 'config.fragment.toml'), 'utf8').catch(() => {
    throw new InstallerError('runtime_invalid', 'bundles/codex/config.fragment.toml')
  })
  const names = (await fs.readdir(path.join(dir, 'agents')).catch(() => [] as string[])).filter((n) => AGENT_FILE.test(n)).sort()
  if (!names.length) throw new InstallerError('runtime_invalid', 'bundles/codex/agents')
  return { fragment, agents: await Promise.all(names.map(async (name) => ({ name, bytes: await fs.readFile(path.join(dir, 'agents', name)) }))) }
}

function validUrl(u: string): string {
  let url: URL
  try {
    url = new URL(u)
  } catch {
    throw new InstallerError('argument_refused', 'platform URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new InstallerError('argument_refused', 'platform URL')
  return u
}

/** The installer's part of a Codex config, taken out of the file as it is now. */
function unmergeOf(bytes: Buffer, record: FileRecord): Buffer | null {
  return unmergeRecord(bytes, record, 'config.toml', { format: 'toml', paths: [[...SERVER_TABLE]], wholeTree: true })
}

const REWRITTEN_AND_CHANGED = 'Dethereal\'s server entry was changed since the install, and its managed-block markers are gone or moved (Codex rewrites the entry when another MCP server is added or removed): remove [mcp_servers.dethereal] and its sub-tables, or put them back as installed, then run the command again'

/** The key orders an install may have written our table in: its runtime's fragment, and `extra` (the current bundle's). */
async function fragmentOrders(paths: StatePaths, version: string | undefined, extra?: string): Promise<unknown[]> {
  const templates = [version ? await fs.readFile(path.join(paths.runtime, version, 'bundles', 'codex', 'config.fragment.toml'), 'utf8').catch(() => null) : null, extra ?? null]
  const orders: unknown[] = []
  for (const t of templates) {
    try {
      const order = t ? (parse(t) as Record<string, Record<string, unknown>>).mcp_servers?.dethereal : undefined
      if (order) orders.push(order)
    } catch {
      // Not a usable order.
    }
  }
  return orders
}

/**
 * Whether the installer's part of the config still holds what the install wrote: by the recorded
 * hash, with the keys taken in an install's order, since Codex rewrites every server table (keys
 * moved, an inline env made a sub-table) when another server is added or removed.
 */
function ownedUnchanged(bytes: Buffer, record: FileRecord, orders: readonly unknown[]): boolean {
  if (!ownedModified(bytes, record).length) return true
  const owned = record.owned?.length === 1 ? record.owned[0]! : null
  if (!owned) return false
  let value: unknown
  try {
    value = owned.path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), parse(bytes.toString('utf8')))
  } catch {
    return false
  }
  return value !== undefined && orders.some((o) => sha256(JSON.stringify(inOrderOf(value, o))) === owned.valueSha256)
}

/** Every table name at and under `prefix` in `value`. */
function tablesUnder(value: unknown, prefix: string[]): string[][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return [prefix, ...Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => tablesUnder(v, [...prefix, k]))]
}

const isMarker = (line: string) => {
  const l = line.replace(/\r$/, '')
  return l === TOML_END || l.startsWith(TOML_BEGIN)
}

/**
 * The installer's part taken out of a config whose markers Codex's rewrite broke, while it still
 * holds what the install wrote: the marker lines go, then every table under ours, and nothing else
 * (the core's table deletion refuses any other change to the document).
 */
function unmergeRewritten(bytes: Buffer, orders: readonly unknown[], record: FileRecord): Buffer | null {
  if (!ownedUnchanged(bytes, record, orders)) return null
  const stripped = bytes.toString('utf8').split('\n').filter((l) => !isMarker(l)).join('\n')
  let value: unknown
  try {
    value = (parse(stripped) as Record<string, Record<string, unknown>>).mcp_servers?.dethereal
  } catch {
    return null
  }
  return value === undefined ? null : deleteTomlTables(Buffer.from(stripped), tablesUnder(value, [...SERVER_TABLE]), 'config.toml')
}

/** Our part taken out by its markers, else by table after Codex's rewrite. */
const unmergeWith = (orders: readonly unknown[]) => (bytes: Buffer, record: FileRecord): Buffer | null =>
  unmergeOf(bytes, record) ?? unmergeRewritten(bytes, orders, record)

/** `value` with its keys in the order `order` has them, at every level; keys `order` lacks come after. */
function inOrderOf(value: unknown, order: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !order || typeof order !== 'object' || Array.isArray(order)) return value
  const v = value as Record<string, unknown>
  const o = order as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o)) if (k in v) out[k] = inOrderOf(v[k], o[k])
  for (const k of Object.keys(v)) if (!(k in out)) out[k] = v[k]
  return out
}

/**
 * The platform URL the last install of this scope set, while the installer's part of the config is
 * as that install left it; null when nothing is installed there, the part was changed, or it cannot
 * be read. A re-run without a URL keeps this one.
 */
export async function installedCodexUrl(input: { env: InstallerEnv; paths: StatePaths; scope: 'user' | { project: string } }): Promise<string | null> {
  try {
    const { env } = input
    const codexHome = env.vars.CODEX_HOME ? await resolveRoot(env.vars.CODEX_HOME, env, 'CODEX_HOME') : path.join(await resolveRoot(env.home, env, 'home'), '.codex')
    const projectReal = input.scope === 'user' ? undefined : await resolveRoot(input.scope.project, env, 'project')
    const lay = layoutOf(projectReal ? 'project' : 'user', codexHome, projectReal)
    const entry = (await readManifest(input.paths, env)).manifest.installs[lay.key]
    const record = entry?.files.find((f) => f.path === lay.config.abs && f.format === 'toml')
    if (!entry || !record) return null
    const cur = await readTarget(lay.config, env)
    if (!cur) return null
    const config = readConfig(cur.bytes, lay.config.rel)
    if (!ownedUnchanged(cur.bytes, record, await fragmentOrders(input.paths, entry.version))) return null
    const url = serverUrlOf(config)?.url
    return url ? validUrl(url) : null
  } catch {
    return null
  }
}

/** Install (or upgrade) Dethereal for Codex. */
export async function installCodex(input: CodexInstallInput): Promise<CodexInstallResult> {
  const { ctx } = input
  // A project-scope run never takes codex from a PATH entry inside the project.
  const cli: HarnessCliOptions = { env: ctx.env, ...(input.scope === 'project' && input.project ? { projectRoot: input.project } : {}) }
  const notices: string[] = []
  const version = await codexVersion(cli)
  const codexHome = await codexHomeOf(ctx)
  const userCfg = await readUserConfig(ctx, codexHome)

  // Scope: a project only when Codex already trusts it.
  let scope = input.scope
  let projectReal: string | undefined
  if (scope === 'project') {
    if (!input.project) throw new InstallerError('argument_refused', 'project')
    projectReal = await resolveRoot(input.project, ctx.env, 'project')
    if (!projectTrusted(userCfg, projectReal)) {
      scope = 'user'
      notices.push('Codex does not trust this project yet, so Dethereal was installed for your user instead. To install it for the project, trust the project in Codex, then install again.')
    }
  }
  const lay = layoutOf(scope, codexHome, projectReal)
  const bundle = await readBundle(input.runtime.runtimePath)
  const fragment = renderFragment(bundle.fragment, { node: input.node, runtime: input.runtime.runtimePath, platformUrl: validUrl(input.platformUrl) })

  // Pre-flight: nothing is written until every refusal has been checked.
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  const entry = manifest.installs[lay.key]
  const recorded = (t: Target) => entry?.files.find((f) => f.path === t.abs)
  const plugins = await listPlugins(cli)
  if (plugins?.some((p) => p.name === 'dethereal' && p.pluginId !== CODEX_PLUGIN_ID)) {
    throw new InstallerError('conflict', 'a Dethereal plugin from another Codex marketplace (remove it first)')
  }
  const source = marketplaceSource(userCfg)
  const previousRuntime = source === null ? null : runtimeOfSource(source, ctx.paths.runtime)
  if (source !== null && previousRuntime === null) throw new InstallerError('conflict', `a Codex marketplace named ${CODEX_MARKETPLACE_NAME} the installer did not add`)
  const cfgNow = await readTarget(lay.config, ctx.env)
  if (!recorded(lay.config) && hasServer(readConfig(cfgNow?.bytes ?? null, lay.config.rel))) {
    throw new InstallerError('conflict', `${lay.config.rel} (mcp_servers.dethereal)`)
  }
  for (const a of bundle.agents) {
    const t = lay.agent(a.name)
    const cur = await readTarget(t, ctx.env)
    if (cur && recorded(t)?.post !== cur.sha256) throw new InstallerError('conflict', t.rel)
  }
  if (scope === 'project' && (await fs.lstat(path.join(projectReal!, '.git')).catch(() => null))) {
    notices.push('The project file .codex/config.toml holds absolute paths of this machine: keep it out of version control.')
  }

  // An upgrade: every old record must come out cleanly before anything is touched (an agent file the
  // user edited, or a config whose part of ours cannot be found, stops it here), and what it sets
  // differently where the user had changed our part is reported.
  const reset: string[] = []
  const restore: Array<{ target: Target; bytes: Buffer; record: FileRecord }> = []
  const expected = (parse(fragment) as Record<string, Record<string, unknown>>).mcp_servers!.dethereal
  const orders = await fragmentOrders(ctx.paths, entry?.version, bundle.fragment)
  const unmerge = unmergeWith(orders)
  for (const record of entry?.files ?? []) {
    const target = resolveTarget(record.path, lay.allowed)
    const cur = await readTarget(target, ctx.env)
    if (!cur) continue
    if (record.format === 'toml') {
      if (unmerge(cur.bytes, record) === null && cur.sha256 !== record.post) {
        throw new InstallerError('conflict', `${target.rel} (${unmergeOf(cur.bytes, record) === null && !ownedUnchanged(cur.bytes, record, orders) ? REWRITTEN_AND_CHANGED : 'our part cannot be taken out'})`)
      }
      if (!ownedUnchanged(cur.bytes, record, orders)) {
        // The command and its arguments follow the runtime on every upgrade; everything else the user may have set.
        reset.push(...tomlTreeDiff(cur.bytes, SERVER_TABLE, expected).map((p) => p.slice(SERVER_TABLE.length)).filter((p) => p[0] !== 'command' && p[0] !== 'args').map((p) => p.join('.')))
      }
    } else if (cur.sha256 !== record.post) {
      throw new InstallerError('conflict', `${target.rel} (changed since the install)`)
    }
    restore.push({ target, bytes: cur.bytes, record })
  }
  const old = entry ? { version: entry.version, runtimes: entry.runtimes, cli: entry.cli } : null

  let cliStarted = false
  try {
    for (const record of entry?.files ?? []) {
      const outcome = await revertFile(ctx, lay.key, record.path, lay.allowed, unmerge)
      if (!DONE.includes(outcome)) throw new InstallerError('conflict', `${record.path.slice(lay.base.length + 1)} (${outcome})`)
    }
    // The entry counts for the shared Codex record from before its first change.
    await mutateManifest(ctx, (m) => {
      const e = (m.installs[lay.key] ??= { version: input.runtime.version, files: [] })
      e.cli = { harness: 'codex', state: 'pending' }
    })
    if (scope === 'project') await ensureDirUnder(projectReal!, '.codex', ctx.env)
    const cfg = await readTarget(lay.config, ctx.env)
    const merged = mergeToml(cfg?.bytes ?? null, SERVER_TABLE, fragment, lay.config.rel)
    await applyFileChange(ctx, {
      key: lay.key, version: input.runtime.version, target: lay.config, format: 'toml', expectPre: cfg?.sha256 ?? 'absent', next: merged.bytes, owned: [merged.owned],
    })
    await ensureDirUnder(lay.base, 'agents', ctx.env)
    for (const a of bundle.agents) {
      const t = lay.agent(a.name)
      await applyFileChange(ctx, { key: lay.key, version: input.runtime.version, target: t, format: 'file', expectPre: (await readTarget(t, ctx.env))?.sha256 ?? 'absent', next: a.bytes })
    }
    await mutateManifest(ctx, (m) => {
      m.installs[lay.key]!.runtimes = [input.runtime.version]
      sharedOf(m).codex = { codexVersion: version, marketplace: marketplaceOf(ctx, input.runtime.version, 'pending'), plugin: { id: CODEX_PLUGIN_ID, state: 'pending' } }
    })

    // The plugin, through Codex's CLI.
    cliStarted = true
    if (source !== null) await removeMarketplace(cli)
    await addMarketplace(path.join(input.runtime.runtimePath, 'bundles', 'codex'), cli)
    await addPlugin(cli)
    if (!(await listPlugins(cli))?.some((p) => p.pluginId === CODEX_PLUGIN_ID && p.enabled !== false)) {
      throw new InstallerError('harness_cli_failed', 'codex plugin list (the plugin is not installed)')
    }
    await mutateManifest(ctx, (m) => {
      const s = sharedOf(m).codex!
      s.marketplace.state = 'done'
      s.plugin.state = 'done'
      m.installs[lay.key]!.cli = { harness: 'codex', state: 'done' }
    })
  } catch (err) {
    await rollback(ctx, lay, restore, old, cli, cliStarted ? previousRuntime : undefined).catch(() => undefined)
    throw err
  }
  if (scope === 'project') notices.push('On Codex the plugin (skills and hooks) is user-wide: it loads in every Codex session of this user. The project install adds only the server settings and the agents for this project.')
  // Codex merges the server's env across layers key by key: an older user install's DETHERNETY_URL would beat this project's URL and the shell's.
  if (scope === 'project' && serverUrlOf(userCfg)?.name === 'DETHERNETY_URL') {
    notices.push('Your user-wide Codex configuration still sets DETHERNETY_URL for Dethereal, which overrides this project\'s platform URL and a DETHERNETY_URL in your shell. To fix: install again for your user (--scope user).')
  }
  notices.push(QUIT_CODEX)
  notices.push('Codex runs the plugin\'s 8 hooks only after you trust them: open Codex (the interactive app, not codex exec) and choose to trust them when it asks, or later with /hooks. Until then the secret and config guards and the agent tool restriction are off.')
  return { scope, codexVersion: version, notices, reset }
}

/**
 * After a failed install or upgrade, in this order: once the CLI step had started,
 * the marketplace goes back to the previous runtime's bundle (or away, after a first
 * install); then the entry's new records go; then the files an upgrade replaced come
 * back as they were, each only while it still holds what the failed step left.
 */
async function rollback(ctx: TxContext, lay: Layout, restore: Array<{ target: Target; bytes: Buffer; record: FileRecord }>,
  old: { version: string; runtimes?: string[]; cli?: Manifest['installs'][string]['cli'] } | null, cli: HarnessCliOptions, previousRuntime: string | null | undefined): Promise<void> {
  if (previousRuntime !== undefined) {
    // Each CLI step is tried on its own: the files below are put back whatever the CLI does.
    await removeMarketplace(cli).catch(() => undefined)
    if (previousRuntime) {
      const back = await addMarketplace(path.join(ctx.paths.runtime, previousRuntime, 'bundles', 'codex'), cli).then(() => addPlugin(cli)).then(() => true, () => false)
      if (back) await mutateManifest(ctx, (m) => {
        const s = sharedOf(m).codex
        if (s) {
          s.marketplace = marketplaceOf(ctx, previousRuntime, 'done')
          s.plugin.state = 'done'
        }
      })
    } else {
      await removePlugin(cli).catch(() => undefined)
      await mutateManifest(ctx, (m) => {
        delete sharedOf(m).codex
      })
    }
  }
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  for (const f of manifest.installs[lay.key]?.files ?? []) await revertFile(ctx, lay.key, f.path, lay.allowed, unmergeOf)
  if (!old) {
    // A first install leaves no entry behind.
    await mutateManifest(ctx, (m) => {
      if (m.installs[lay.key]?.files.length === 0) delete m.installs[lay.key]
    })
    return
  }
  for (const r of restore) {
    const cur = await readTarget(r.target, ctx.env)
    await applyFileChange(ctx, {
      key: lay.key, version: old.version, target: r.target, format: r.record.format, expectPre: cur?.sha256 ?? 'absent', next: r.bytes,
      ...(r.record.owned ? { owned: r.record.owned } : {}),
    }).catch(() => undefined)
  }
  await mutateManifest(ctx, (m) => {
    const e = m.installs[lay.key]
    if (!e) return
    if (old.runtimes) e.runtimes = old.runtimes
    if (old.cli) e.cli = old.cli
  })
}

/** The real path a folder that no longer exists had: the nearest existing folder above it, resolved, with the rest appended. */
async function realpathOfMissing(p: string): Promise<string> {
  const rest: string[] = []
  let cur = path.resolve(p)
  while (true) {
    const real = await fs.realpath(cur).catch(() => null)
    if (real) return path.join(real, ...rest.reverse())
    const parent = path.dirname(cur)
    if (parent === cur) return path.resolve(p)
    rest.push(path.basename(cur))
    cur = parent
  }
}

/** Take Dethereal out of Codex for one scope. The caller holds the install lock (`ctx.lock`). */
export async function uninstallCodex(input: { ctx: TxContext; scope: 'user' | 'project'; project?: string; forgetMissingProject?: boolean }): Promise<CodexUninstallResult> {
  const { ctx } = input
  const cli: HarnessCliOptions = { env: ctx.env, ...(input.scope === 'project' && input.project ? { projectRoot: input.project } : {}) }
  const codexHome = await codexHomeOf(ctx)
  const result: CodexUninstallResult = { removed: [], manual: [], hookTrustRemoved: [], hookTrust: [], pluginRemoved: false, cliLeft: [], notices: [QUIT_CODEX] }
  let projectReal: string | undefined
  if (input.scope === 'project') {
    if (!input.project) throw new InstallerError('argument_refused', 'project')
    projectReal = await fs.realpath(input.project).catch(() => undefined)
    if (!projectReal) {
      if (!input.forgetMissingProject) throw new InstallerError('io', 'project')
      // The folder is gone, and its files with it: forget the entry, found by the real path of the
      // nearest folder above it that still exists, as the install recorded it.
      projectReal = await realpathOfMissing(input.project)
      const key = entryKey('codex', { project: projectReal })
      result.forgotten = await mutateManifest(ctx, (m) => {
        const had = !!m.installs[key]
        delete m.installs[key]
        return had
      })
    }
  }
  const lay = layoutOf(input.scope, codexHome, projectReal)
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  const entry = manifest.installs[lay.key]
  const last = codexEntries(manifest).every((k) => k === lay.key)

  if (last && sharedOf(manifest).codex) {
    // A CLI step that fails (a marketplace folder gone, say) does not stop the files from going.
    result.pluginRemoved = await removePlugin(cli).then(() => true, () => {
      result.cliLeft.push(`the Codex plugin ${CODEX_PLUGIN_ID} (remove it with: codex plugin remove ${CODEX_PLUGIN_ID})`)
      return false
    })
    const source = marketplaceSource(await readUserConfig(ctx, codexHome))
    if (source !== null && runtimeOfSource(source, ctx.paths.runtime) !== null) {
      await removeMarketplace(cli).catch(() => result.cliLeft.push(`the Codex marketplace ${CODEX_MARKETPLACE_NAME} (remove it with: codex plugin marketplace remove ${CODEX_MARKETPLACE_NAME})`))
    }
  }
  const orders = await fragmentOrders(ctx.paths, entry?.version)
  for (const record of entry?.files ?? []) {
    const before = record.format === 'toml' ? await readTarget(resolveTarget(record.path, lay.allowed), ctx.env).catch(() => null) : null
    const outcome = await revertFile(ctx, lay.key, record.path, lay.allowed, unmergeWith(orders))
    if (DONE.includes(outcome)) result.removed.push(record.path)
    else {
      result.manual.push({ path: record.path, outcome })
      if (before && outcome === 'manual' && unmergeOf(before.bytes, record) === null && !ownedUnchanged(before.bytes, record, orders)) {
        result.notices.push(`${path.relative(lay.base, record.path)}: ${REWRITTEN_AND_CHANGED.replace('run the command again', 'uninstall again')}`)
      }
    }
  }
  if (entry && !result.forgotten) {
    // Folders left empty go too (a folder holding anything else stays): `agents/`, and a project's `.codex/`.
    await fs.rmdir(path.join(lay.base, 'agents')).catch(() => undefined)
    if (lay.scope === 'project') await fs.rmdir(lay.base).catch(() => undefined)
  }
  if (last) {
    // Revoke the plugin's hook trust: left behind, it would trust a later plugin of the same name without asking.
    const t = resolveTarget(path.join(codexHome, 'config.toml'), [{ root: codexHome, pattern: 'config.toml' }])
    const cur = await readTarget(t, ctx.env)
    const keys = hookStateKeys(readConfig(cur?.bytes ?? null, 'config.toml'))
    if (cur && keys.length) {
      const next = deleteTomlTables(cur.bytes, keys.map((k) => ['hooks', 'state', k]), 'config.toml')
      if (next && (await writeTarget(t, next, cur.sha256, ctx.env).then(() => true, () => false))) result.hookTrustRemoved = keys
      else result.hookTrust = keys
    }
    await mutateManifest(ctx, (m) => {
      delete sharedOf(m).codex
    })
  }
  return result
}
