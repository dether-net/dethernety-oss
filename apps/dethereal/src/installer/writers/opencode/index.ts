/**
 * The OpenCode writer: Dethereal's skills, agents, commands and plugin in an OpenCode config folder
 * (`<project>/.opencode/`, or `$XDG_CONFIG_HOME/opencode/` for the user), and its MCP server, the
 * questions its tools ask and the denies on the server's own folder in that scope's `opencode.json`
 * (or `.jsonc`). OpenCode has no command for any of this, so every file goes through the core's
 * path-safe, recorded writes.
 *
 * Before anything is written, an install is refused when:
 *  - the OpenCode version is older than the floor, or newer than the versions checked, unless the
 *    operator allows an unverified one;
 *  - the project is the home directory or holds it (a project there would be user-wide, and its
 *    `.dethernety/` is the server's own folder);
 *  - a Dethereal plugin sits in any other folder OpenCode loads plugins from (it would run every hook
 *    twice), or another scope of the same worktree is installed;
 *  - a target file exists that the installer did not write;
 *  - the configuration cannot take our keys without changing what the user set (a permission given
 *    as one word, a key of ours already holding another value), or both `opencode.json` and
 *    `opencode.jsonc` exist;
 *  - a value written into the configuration holds `{` or `}`, which OpenCode would read as a
 *    substitution;
 *  - the denies would not cover the server's folder as OpenCode matches it.
 *
 * The plugin is written first and the configuration last; an uninstall goes the other way, so the
 * MCP server is never configured without the plugin that guards its sessions.
 *
 * What this protects against is a model acting on prompt injection, not a hostile repository: a
 * project's own OpenCode plugins, MCP entries, `{file:…}` substitutions and instructions run with
 * the user's rights, and nothing here can see them.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, type ParseError } from 'jsonc-parser'
import { ownedModified, unmergeRecord } from '../../core/editors.js'
import { entryKey, readManifest, updateManifest, type FileRecord, type Manifest } from '../../core/manifest.js'
import { mergeJsonAll } from '../../core/merge-jsonc.js'
import { resolveRoot, stateRootProbes, type InstallerEnv, type StatePaths } from '../../core/paths.js'
import { readTarget, removeTarget, resolveTarget, sha256, type AllowedTarget, type Target } from '../../core/safe-write.js'
import { applyFileChange, inspectOwned, revertFile, type RevertOutcome, type TxContext } from '../../core/transaction.js'
import { expandHome, lastMatch, versionGate, versionStatus, wildcard, type Rule } from './rules.js'

export { OPENCODE_FLOOR, OPENCODE_VERIFIED, lastMatch, versionGate, versionStatus, wildcard } from './rules.js'

/** The schema OpenCode writes into a configuration file that names none. */
const CONFIG_SCHEMA = 'https://opencode.ai/config.json'

/** The line the plugin carries, by which another copy of it is recognised whatever its file name. */
export const PLUGIN_MARKER = '// dethereal-opencode-plugin'
const NAME = 'dethereal'
const PLUGIN_FILE = `${NAME}.ts`
const MAX_PLUGIN_READ = 1024 * 1024

/** An install the writer will not make, with a code and a message for the operator. */
export class OpenCodeRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'OpenCodeRefusal'
  }
}

export type Scope = 'user' | { project: string }

export interface OpenCodeInput {
  env: InstallerEnv
  paths: StatePaths
  scope: Scope
  /** The installed runtime: its version and folder (holding `dist/` and `bundles/`). */
  runtime: { version: string; runtimePath: string }
  /** The Node binary the runtime is recorded to run with. */
  execPath: string
  /** The platform URL, already validated. */
  url: string
  /** What `opencode --version` printed, or null when OpenCode was not found. */
  openCodeVersion: string | null
  allowUnverified?: boolean
  /** Other spellings of the home directory (a HOME reached through a link). */
  homeAliases?: readonly string[]
}

interface Layout {
  readonly root: string
  /** The config folder, relative to the root, ending in `/`. */
  readonly prefix: string
  /** The config file names OpenCode reads there, relative to the root: `.json`, then `.jsonc`. */
  readonly configs: readonly [string, string]
  readonly key: string
  readonly realHome: string
}

export interface PlannedFile {
  readonly target: Target
  readonly next: Buffer
}

export interface OpenCodePlan {
  readonly key: string
  readonly version: string
  readonly layout: Layout
  readonly allowed: readonly AllowedTarget[]
  /** Plugin first, then agents, commands and skills, in install order. */
  readonly files: readonly PlannedFile[]
  readonly config: { readonly target: Target; readonly entries: ReadonlyArray<{ path: string[]; value: unknown }> }
  readonly notes: readonly string[]
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

async function exists(p: string): Promise<boolean> {
  return fs.lstat(p).then(
    () => true,
    () => false,
  )
}

async function layoutOf(input: OpenCodeInput): Promise<Layout> {
  const realHome = await fs.realpath(input.env.home)
  if (input.scope === 'user') {
    // OpenCode reads XDG_CONFIG_HOME whenever it is set, existing or not: so does the install.
    const xdg = input.env.vars.XDG_CONFIG_HOME
    const useXdg = !!xdg && path.isAbsolute(xdg)
    let root: string
    let prefix: string
    if (!useXdg) [root, prefix] = [await resolveRoot(input.env.home, input.env, 'home'), '.config/opencode/']
    else if (await exists(xdg)) [root, prefix] = [await resolveRoot(xdg, input.env, 'XDG_CONFIG_HOME'), 'opencode/']
    else if (within(path.resolve(xdg), path.resolve(input.env.home))) {
      // Not there yet, but in the home folder: written from the home, the folder created on the way.
      root = await resolveRoot(input.env.home, input.env, 'home')
      prefix = `${path.relative(path.resolve(input.env.home), path.resolve(xdg)).split(path.sep).join('/')}/opencode/`
    } else {
      throw new OpenCodeRefusal('xdg_missing', `XDG_CONFIG_HOME (${xdg}) does not exist and is outside your home folder; create it, or unset it, and install again.`)
    }
    return { root, prefix, configs: [`${prefix}opencode.json`, `${prefix}opencode.jsonc`], key: entryKey('opencode', 'user'), realHome }
  }
  const root = await resolveRoot(input.scope.project, input.env, 'project')
  if (within(realHome, root)) {
    throw new OpenCodeRefusal('project_at_home', 'This project is your home directory or holds it: OpenCode would load it everywhere, and its .dethernety/ is the server\'s own folder. Install for the user instead, or from the project\'s own folder.')
  }
  return { root, prefix: '.opencode/', configs: ['opencode.json', 'opencode.jsonc'], key: entryKey('opencode', { project: root }), realHome }
}

function allowedOf(l: Layout): AllowedTarget[] {
  return [
    `${l.prefix}plugins/${PLUGIN_FILE}`,
    `${l.prefix}agents/${NAME}-*.md`,
    `${l.prefix}commands/${NAME}-*.md`,
    `${l.prefix}skills/${NAME}-*/**`,
    ...l.configs,
  ].map((pattern) => ({ root: l.root, pattern }))
}

/** The bundle's files under `bundles/opencode/<part>/`, relative to the bundle; links and special files refused. */
async function bundleFiles(bundle: string): Promise<Array<{ rel: string; bytes: Buffer }>> {
  const out: Array<{ rel: string; bytes: Buffer }> = []
  const walk = async (rel: string): Promise<void> => {
    const abs = path.join(bundle, rel)
    const st = await fs.lstat(abs)
    if (st.isDirectory()) {
      for (const name of (await fs.readdir(abs)).sort()) await walk(path.posix.join(rel, name))
    } else if (st.isFile()) out.push({ rel, bytes: await fs.readFile(abs) })
    else throw new OpenCodeRefusal('bundle_invalid', `The runtime's OpenCode bundle holds ${rel}, which is not a plain file.`)
  }
  for (const part of ['plugins', 'agents', 'commands', 'skills']) if (await exists(path.join(bundle, part))) await walk(part)
  return out
}

/** A value OpenCode reads as text inside its configuration: never one it would substitute into. */
function safeValue(v: string, what: string): string {
  if (/[{}]/.test(v) || [...v].some((c) => c.charCodeAt(0) < 0x20)) {
    throw new OpenCodeRefusal('unsafe_value', `The ${what} holds a brace or a control character, which OpenCode's configuration would read as a substitution; install from a path without them.`)
  }
  return v
}

/** The plugin with the runtime's node and entry written in, each placeholder exactly once. */
export function fillPlugin(template: string, execPath: string, entry: string, url: string): string {
  const node = '"<node-abs>"'
  const runtime = '"<runtime>/dist/index.js"'
  const platform = '"<platform-url>"'
  const count = (s: string) => template.split(s).length - 1
  if (count(node) !== 1 || count(runtime) !== 1 || count(platform) !== 1 || !template.includes(PLUGIN_MARKER)) {
    throw new OpenCodeRefusal('bundle_invalid', "The runtime's OpenCode plugin is not the one this installer fills in.")
  }
  const out = template.replace(node, () => JSON.stringify(execPath)).replace(runtime, () => JSON.stringify(entry)).replace(platform, () => JSON.stringify(url))
  if (/<node-abs>|<runtime>|<ask-tools>|<platform-url>/.test(out)) throw new OpenCodeRefusal('bundle_invalid', "The runtime's OpenCode plugin has a placeholder left.")
  return out
}

/**
 * The denies on the server's own folder, as OpenCode matches them (`~` written out by OpenCode, `*`
 * spanning folders): the home-relative form and the absolute one for each spelling of the home.
 */
export function stateRootPatterns(realHome: string, aliases: readonly string[] = []): string[] {
  const homes = [...new Set([realHome, ...aliases])]
  return ['~/.dethernety', '~/.dethernety/*', ...homes.flatMap((h) => [path.join(h, '.dethernety'), `${path.join(h, '.dethernety')}/*`])]
}

/**
 * Whether the denies cover every place in the server's folder as OpenCode asks about it (the folder
 * of the file, followed by `*`). Letter case is not covered: OpenCode's patterns cannot say "any
 * case", and the guard is the layer that matches in any case.
 */
export function coversStateRootAsOpenCode(patterns: readonly string[], realHome: string, aliases: readonly string[] = []): string[] {
  const root = path.join(realHome, '.dethernety')
  const missed: string[] = []
  for (const probe of stateRootProbes(realHome, aliases)) {
    const abs = expandHome(probe, realHome)
    if (abs === root || aliases.some((a) => abs === path.join(a, '.dethernety'))) continue
    const request = `${path.dirname(abs)}/*`
    if (!patterns.some((p) => wildcard(request, expandHome(p, realHome)))) missed.push(probe)
  }
  return missed
}

const getAt = (doc: unknown, keys: readonly string[]): { found: boolean; value?: unknown } => {
  let cur: unknown = doc
  for (const k of keys) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !(k in (cur as Record<string, unknown>))) return { found: false }
    cur = (cur as Record<string, unknown>)[k]
  }
  return { found: true, value: cur }
}

/**
 * The configuration keys this install owns, without those the file already holds with the same
 * value (left to the user, and noted); a key of ours holding another value, or a block given as one
 * word, refuses the install.
 */
function configEntries(text: string | null, wanted: ReadonlyArray<{ path: string[]; value: unknown }>, label: string, notes: string[],
  ours: ReadonlySet<string> = new Set()): Array<{ path: string[]; value: unknown }> {
  if (text === null) return [...wanted]
  const errors: ParseError[] = []
  const doc = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length || !doc || typeof doc !== 'object' || Array.isArray(doc)) throw new OpenCodeRefusal('config_unreadable', `${label} cannot be read as a JSON object; fix it and install again.`)
  for (const block of [['permission'], ['permission', 'external_directory'], ['agent', 'explore', 'permission'], ['mcp']]) {
    const at = getAt(doc, block)
    if (at.found && (typeof at.value !== 'object' || at.value === null || Array.isArray(at.value))) {
      throw new OpenCodeRefusal('config_conflict', `${label} sets "${block.join('.')}" as a single value; Dethereal adds rules to it only as an object. Write it as an object (e.g. { "*": "${String(at.value)}" }) and install again.`)
    }
  }
  const out: Array<{ path: string[]; value: unknown }> = []
  for (const e of wanted) {
    const at = getAt(doc, e.path)
    // A key this scope's previous install owns is taken out and set again on apply.
    if (!at.found || ours.has(e.path.join('\u0000'))) out.push(e)
    else if (JSON.stringify(at.value) === JSON.stringify(e.value)) notes.push(`${label}: "${e.path.join('.')}" was already set as Dethereal sets it; it stays yours.`)
    else throw new OpenCodeRefusal('config_conflict', `${label} already sets "${e.path.join('.')}" to another value; Dethereal will not change it. Remove it and install again.`)
  }
  return out
}

/** The folders OpenCode loads plugins from, for this scope: the global one, `.opencode` from the project up to its worktree, `~/.opencode`, OPENCODE_CONFIG_DIR. */
async function pluginFolders(input: OpenCodeInput, l: Layout): Promise<string[]> {
  const xdg = input.env.vars.XDG_CONFIG_HOME
  const folders = [path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(input.env.home, '.config'), 'opencode'), path.join(input.env.home, '.opencode')]
  if (input.env.vars.OPENCODE_CONFIG_DIR && path.isAbsolute(input.env.vars.OPENCODE_CONFIG_DIR)) folders.push(input.env.vars.OPENCODE_CONFIG_DIR)
  if (input.scope !== 'user') {
    let dir = l.root
    for (;;) {
      folders.push(path.join(dir, '.opencode'))
      if (await exists(path.join(dir, '.git'))) break
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return [...new Set(folders)]
}

/** Every Dethereal plugin OpenCode would load for this scope, by its marker line, wherever it sits. */
export async function detherealPlugins(input: OpenCodeInput, l: Layout): Promise<string[]> {
  const found: string[] = []
  for (const folder of await pluginFolders(input, l)) {
    for (const sub of ['plugin', 'plugins']) {
      const dir = path.join(folder, sub)
      const names = await fs.readdir(dir).catch(() => [] as string[])
      for (const name of names) {
        if (!/\.(ts|js)$/.test(name)) continue
        const file = path.join(dir, name)
        const handle = await fs.open(file, 'r').catch(() => null)
        if (!handle) continue
        try {
          const buf = Buffer.alloc(MAX_PLUGIN_READ)
          const { bytesRead } = await handle.read(buf, 0, MAX_PLUGIN_READ, 0)
          if (buf.subarray(0, bytesRead).toString('utf8').includes(PLUGIN_MARKER)) found.push(await fs.realpath(file).catch(() => file))
        } finally {
          await handle.close()
        }
      }
    }
  }
  return [...new Set(found)]
}

/** The worktree a project sits in: the nearest folder holding `.git`, or the filesystem root. */
async function worktreeOf(dir: string): Promise<string> {
  for (let d = dir; ; d = path.dirname(d)) {
    if (await exists(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) return d
  }
}

/** Plans an install: everything checked, nothing written. */
export async function planOpenCode(input: OpenCodeInput): Promise<OpenCodePlan> {
  const notes: string[] = []
  const gate = versionGate(input.openCodeVersion, input.allowUnverified)
  if (!gate.install) throw new OpenCodeRefusal('opencode_version', gate.reason)
  if (gate.note) notes.push(gate.note)

  const l = await layoutOf(input)
  const allowed = allowedOf(l)
  const entry = path.join(input.runtime.runtimePath, 'dist', 'index.js')
  safeValue(input.execPath, 'Node path')
  safeValue(entry, 'runtime path')
  safeValue(input.url, 'platform URL')

  // One Dethereal plugin per OpenCode session: any other copy it would load refuses the install.
  const own = path.join(l.root, ...`${l.prefix}plugins/${PLUGIN_FILE}`.split('/'))
  const others = (await detherealPlugins(input, l)).filter((p) => p !== own)
  if (others.length) throw new OpenCodeRefusal('second_plugin', `A Dethereal plugin is already in ${others.length === 1 ? 'another folder' : 'other folders'} OpenCode loads (${others.map((p) => path.basename(path.dirname(path.dirname(p)))).join(', ')}); every hook would run twice. Uninstall that one first.`)
  const { manifest } = await readManifest(input.paths, input.env)
  const tree = input.scope === 'user' ? null : await worktreeOf(l.root)
  for (const key of Object.keys(manifest.installs)) {
    if (!key.startsWith('opencode:') || key === l.key) continue
    const other = key.startsWith('opencode:project:') ? key.slice('opencode:project:'.length) : null
    // A user install is loaded in every project; a project install of the same worktree is loaded with this one.
    if (input.scope === 'user' || key === 'opencode:user' || (tree && other && (within(other, tree) || within(tree, other)))) {
      throw new OpenCodeRefusal('second_scope', `Dethereal is already installed for OpenCode ${key === 'opencode:user' ? 'for the user' : 'in a project'}${input.scope === 'user' ? '' : ' that this one would load with it'}; one install per OpenCode session. Uninstall it first.`)
    }
  }
  const previous = manifest.installs[l.key]?.files ?? []

  // The bundle, from the installed runtime.
  const bundle = path.join(input.runtime.runtimePath, 'bundles', 'opencode')
  const files: PlannedFile[] = []
  for (const f of await bundleFiles(bundle)) {
    const next = f.rel === `plugins/${PLUGIN_FILE}` ? Buffer.from(fillPlugin(f.bytes.toString('utf8'), input.execPath, entry, input.url)) : f.bytes
    files.push({ target: resolveTarget(path.join(l.root, ...`${l.prefix}${f.rel}`.split('/')), allowed), next })
  }
  if (!files.some((f) => f.target.rel.endsWith(`plugins/${PLUGIN_FILE}`))) throw new OpenCodeRefusal('bundle_invalid', "The runtime's OpenCode bundle has no plugin.")
  // A file at a target that this scope's install did not write is never overwritten.
  for (const f of files) {
    if (previous.some((r) => r.path === f.target.abs)) continue
    if (await readTarget(f.target, input.env)) throw new OpenCodeRefusal('unowned_file', `${f.target.rel} exists and was not written by Dethereal; it is never overwritten. Move it aside and install again.`)
  }
  const order = (rel: string) => ['plugins/', 'agents/', 'commands/', 'skills/'].findIndex((p) => rel.startsWith(l.prefix + p))
  files.sort((a, b) => order(a.target.rel) - order(b.target.rel) || (a.target.rel < b.target.rel ? -1 : 1))

  // The configuration: which file, and what it gains.
  const [jsonRel, jsoncRel] = l.configs
  const hasJson = await exists(path.join(l.root, ...jsonRel.split('/')))
  const hasJsonc = await exists(path.join(l.root, ...jsoncRel.split('/')))
  if (hasJson && hasJsonc) throw new OpenCodeRefusal('config_conflict', `Both ${jsonRel} and ${jsoncRel} exist; OpenCode reads both. Keep one and install again.`)
  const configTarget = resolveTarget(path.join(l.root, ...(hasJsonc ? jsoncRel : jsonRel).split('/')), allowed)
  if (input.scope === 'user') {
    const configJson = await fs.readFile(path.join(l.root, ...`${l.prefix}config.json`.split('/')), 'utf8').catch(() => null)
    if (configJson !== null) configEntries(configJson, [], `${l.prefix}config.json`, notes)
  }
  const fragment = JSON.parse((await fs.readFile(path.join(bundle, 'mcp.fragment.json'))).toString('utf8')) as {
    mcp: Record<string, Record<string, unknown>>
    permission: Record<string, string>
  }
  const server = fragment.mcp[NAME]
  if (!server) throw new OpenCodeRefusal('bundle_invalid', "The runtime's OpenCode bundle has no MCP entry.")
  const patterns = stateRootPatterns(l.realHome, input.homeAliases)
  const missed = coversStateRootAsOpenCode(patterns, l.realHome, input.homeAliases)
  if (missed.length) throw new OpenCodeRefusal('state_root_uncovered', `The denies would not cover ${missed[0]} as OpenCode matches it; nothing was written.`)
  const wanted = [
    // The install URL is a default: a DETHERNETY_URL in OpenCode's environment still wins over it.
    { path: ['mcp', NAME], value: { ...server, command: [input.execPath, entry], environment: { DETHERNETY_PLATFORM_URL: input.url } } },
    ...Object.entries(fragment.permission).filter(([, a]) => a === 'ask').map(([tool]) => ({ path: ['permission', tool], value: 'ask' })),
    { path: ['agent', 'explore', 'permission', `${NAME}_*`], value: 'deny' },
    ...patterns.map((p) => ({ path: ['permission', 'external_directory', p], value: 'deny' })),
  ]
  const current = await readTarget(configTarget, input.env)
  const ours = new Set(previous.filter((r) => r.path === configTarget.abs).flatMap((r) => (r.owned ?? []).map((o) => o.path.join('\u0000'))))
  const entries = configEntries(current ? current.bytes.toString('utf8') : null, wanted, configTarget.rel, notes, ours)
  notes.push('The OpenCode plugin runs inside OpenCode with your rights and no trust prompt; it starts only Dethereal\'s own runtime.')
  if (input.scope !== 'user') notes.push('The installed files hold absolute paths of this machine: do not commit .opencode/ files whose names start with dethereal, or opencode.json\'s Dethereal entries.')
  return { key: l.key, version: input.runtime.version, layout: l, allowed, files, config: { target: configTarget, entries }, notes }
}

/** Whether this owned key path is one the OpenCode writer may own (the manifest is data, not authority). */
function ownable(p: readonly string[]): boolean {
  if (p.length === 2 && p[0] === 'mcp' && p[1] === NAME) return true
  if (p.length === 2 && p[0] === 'permission' && p[1]!.startsWith(`${NAME}_`)) return true
  if (p.length === 4 && p.join('\u0000') === ['agent', 'explore', 'permission', `${NAME}_*`].join('\u0000')) return true
  return p.length === 3 && p[0] === 'permission' && p[1] === 'external_directory' && /\.dethernety(\/\*)?$/.test(p[2]!)
}

function unmergeOf(target: Target) {
  return (bytes: Buffer, record: FileRecord): Buffer | null => {
    const paths = (record.owned ?? []).map((o) => o.path).filter(ownable)
    return unmergeRecord(bytes, record, target.rel, { format: target.rel.endsWith('.jsonc') ? 'jsonc' : 'json', paths })
  }
}

export type OpenCodeOutcome = { status: 'installed' | 'unchanged'; records: FileRecord[]; notes: readonly string[] }

/**
 * Applies a plan. A previous install of the same scope is undone first (its configuration keys
 * taken out, its files restored or removed), unless nothing would change; a file of it the user
 * changed stops the upgrade before anything is touched.
 */
export async function applyOpenCode(ctx: TxContext, plan: OpenCodePlan): Promise<OpenCodeOutcome> {
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  const previous = manifest.installs[plan.key]
  if (previous) {
    if (await sameInstall(ctx, plan, previous.files)) return { status: 'unchanged', records: previous.files, notes: plan.notes }
    for (const r of previous.files) {
      if (r.format !== 'file') continue
      const cur = await readTarget(resolveTarget(r.path, plan.allowed), ctx.env).catch(() => undefined)
      if (cur && cur.sha256 !== r.post) throw new OpenCodeRefusal('user_edited', `${path.relative(plan.layout.root, r.path)} was changed after Dethereal installed it; move your change elsewhere, then install again.`)
    }
    await undo(ctx, plan.key, previous.files, plan.allowed)
  }
  const records: FileRecord[] = []
  for (const f of plan.files) {
    const cur = await readTarget(f.target, ctx.env)
    if (cur) throw new OpenCodeRefusal('unowned_file', `${f.target.rel} exists and was not written by Dethereal; it is never overwritten. Move it aside and install again.`)
    records.push(await applyFileChange(ctx, { key: plan.key, version: plan.version, target: f.target, format: 'file', expectPre: 'absent', next: f.next }))
  }
  if (plan.config.entries.length) {
    const cur = await readTarget(plan.config.target, ctx.env)
    const format = plan.config.target.rel.endsWith('.jsonc') ? 'jsonc' : 'json'
    // A file created here starts with the schema line, which OpenCode would otherwise write into it on
    // its first start, changing what was installed.
    const base = cur ? cur.bytes : Buffer.from(`{\n  "$schema": "${CONFIG_SCHEMA}"\n}\n`)
    const merged = mergeJsonAll(base, plan.config.entries, format, plan.config.target.rel)
    records.push(await applyFileChange(ctx, { key: plan.key, version: plan.version, target: plan.config.target, format, expectPre: cur ? cur.sha256 : 'absent', next: merged.bytes, owned: merged.owned }))
  }
  return { status: 'installed', records, notes: plan.notes }
}

/** Whether the scope already holds exactly this install, every file and key untouched. */
async function sameInstall(ctx: TxContext, plan: OpenCodePlan, records: readonly FileRecord[]): Promise<boolean> {
  const files = records.filter((r) => r.format === 'file')
  if (files.length !== plan.files.length || records.some((r) => r.state !== 'committed')) return false
  for (const f of plan.files) {
    const r = files.find((x) => x.path === f.target.abs)
    if (!r || r.post !== sha256(f.next)) return false
    const cur = await readTarget(f.target, ctx.env)
    if (!cur || cur.sha256 !== r.post) return false
  }
  const config = records.find((r) => r.format !== 'file')
  if (!plan.config.entries.length) return !config
  const owned = (config?.owned ?? []).map((o) => o.path.join('\u0000')).sort()
  if (JSON.stringify(owned) !== JSON.stringify(plan.config.entries.map((e) => e.path.join('\u0000')).sort())) return false
  // The same keys holding other values (another URL, an entry an earlier version wrote) is a change.
  for (const e of plan.config.entries) {
    const o = config!.owned!.find((x) => x.path.join('\u0000') === e.path.join('\u0000'))
    if (o!.valueSha256 !== sha256(JSON.stringify(e.value))) return false
  }
  const cur = config ? await readTarget(resolveTarget(config.path, plan.allowed), ctx.env) : null
  return !!cur && cur.sha256 === config!.post
}

/** Undoes records in the reverse of their install order: configuration first, the plugin last. */
async function undo(ctx: TxContext, key: string, records: readonly FileRecord[], allowed: readonly AllowedTarget[]): Promise<Array<{ path: string; outcome: RevertOutcome }>> {
  const out: Array<{ path: string; outcome: RevertOutcome }> = []
  for (const r of [...records].reverse()) {
    let target: Target | null
    try {
      target = resolveTarget(r.path, allowed)
    } catch {
      target = null
    }
    const outcome = target ? await revertFile(ctx, key, r.path, allowed, r.format === 'file' ? undefined : unmergeOf(target)) : 'refused'
    out.push({ path: r.path, outcome })
  }
  return out
}

/** Uninstalls a scope: what Dethereal wrote is undone, a file the user changed is reported and kept. */
export async function uninstallOpenCode(ctx: TxContext, input: Pick<OpenCodeInput, 'env' | 'paths' | 'scope'> & { forgetMissingProject?: boolean }): Promise<Array<{ path: string; outcome: RevertOutcome }>> {
  if (input.scope !== 'user' && !(await exists(input.scope.project))) {
    // The project folder is gone, and the files written there with it: its entry is forgotten (only on
    // request), nothing is run or written in the missing folder.
    if (!input.forgetMissingProject) throw new OpenCodeRefusal('project_missing', 'The project folder is gone; its install stays recorded. Run uninstall with --forget-missing-project to forget it.')
    return forgetProject(ctx, input.scope.project)
  }
  const l = await layoutOf({ ...input, runtime: { version: '', runtimePath: '' }, execPath: '', url: '', openCodeVersion: null } as OpenCodeInput)
  const allowed = allowedOf(l)
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  const entry = manifest.installs[l.key]
  if (!entry) return []
  const out = await undo(ctx, l.key, entry.files, allowed)
  // A configuration file the install created, holding nothing else of the user's once our keys are out
  // (OpenCode may have written its schema line into it), goes too.
  for (const r of entry.files) {
    if (r.format === 'file' || r.pre !== 'absent' || out.find((o) => o.path === r.path)?.outcome !== 'unmerged') continue
    const target = resolveTarget(r.path, allowed)
    const cur = await readTarget(target, ctx.env)
    const errors: ParseError[] = []
    const doc = cur ? parse(cur.bytes.toString('utf8'), errors, { allowTrailingComma: true }) : null
    const keys = doc && typeof doc === 'object' && !Array.isArray(doc) && !errors.length ? Object.keys(doc as object) : null
    // Nothing the user wrote: no other key, and no comment outside a string.
    const bare = cur ? cur.bytes.toString('utf8').replace(/"(?:[^"\\]|\\.)*"/g, '""') : ''
    if (cur && keys && keys.every((k) => k === '$schema') && !/\/\/|\/\*/.test(bare)) {
      await removeTarget(target, cur.sha256, ctx.env)
      out.find((o) => o.path === r.path)!.outcome = 'deleted'
    }
  }
  // Folders left empty go too, deepest first; a folder holding anything else stays.
  const rmEmpty = async (dir: string) => {
    const st = await fs.lstat(dir).catch(() => null)
    if (st?.isDirectory() && !st.isSymbolicLink()) await fs.rmdir(dir).catch(() => undefined)
  }
  const config = path.join(l.root, ...l.prefix.split('/').filter(Boolean))
  const skills = path.join(config, 'skills')
  for (const name of await fs.readdir(skills).catch(() => [] as string[])) if (name.startsWith(`${NAME}-`)) await rmEmpty(path.join(skills, name))
  for (const part of ['skills', 'agents', 'commands', 'plugins']) await rmEmpty(path.join(config, part))
  await rmEmpty(config)
  return out
}

/** A path written out through its nearest existing folder's real path (the install keyed projects by real path). */
async function realish(p: string): Promise<string> {
  const tail: string[] = []
  let head = path.resolve(p)
  while (!(await exists(head))) {
    const parent = path.dirname(head)
    if (parent === head) break
    tail.unshift(path.basename(head))
    head = parent
  }
  return path.join(await fs.realpath(head).catch(() => head), ...tail)
}

/** Forgets the install of a project folder that no longer exists: its entry and records, nothing else. */
async function forgetProject(ctx: TxContext, project: string): Promise<Array<{ path: string; outcome: RevertOutcome }>> {
  const keys = new Set([entryKey('opencode', { project: path.resolve(project) }), entryKey('opencode', { project: await realish(project) })])
  return updateManifest(ctx.paths, ctx.env, (m) => {
    const out: Array<{ path: string; outcome: RevertOutcome }> = []
    for (const key of keys) {
      const entry = m.installs[key]
      if (!entry) continue
      out.push(...entry.files.map((f) => ({ path: f.path, outcome: 'missing' as RevertOutcome })))
      delete m.installs[key]
    }
    return out
  })
}

/** Files OpenCode itself keeps in a config folder (it installs its plugin package there): never Dethereal's, never removed. */
const OPENCODE_OWN = ['package.json', 'package-lock.json', 'bun.lock', 'bun.lockb', '.gitignore', 'node_modules']

/**
 * The platform URL of this scope's install, so that installing again without a URL keeps it: the
 * entry's DETHERNETY_PLATFORM_URL, or the DETHERNETY_URL an earlier version wrote. Null when there is
 * no install, or its entry is not exactly as the install wrote it. Not normalised.
 */
export async function installedOpenCodeUrl(input: Pick<OpenCodeInput, 'env' | 'paths' | 'scope'>): Promise<string | null> {
  if (input.scope !== 'user' && !(await exists(input.scope.project))) return null
  const l = await layoutOf({ ...input, runtime: { version: '', runtimePath: '' }, execPath: '', url: '', openCodeVersion: null } as OpenCodeInput)
  const { manifest } = await readManifest(input.paths, input.env)
  const record = (manifest.installs[l.key]?.files ?? []).find((r) => r.format !== 'file' && r.state === 'committed')
  const mcp = ['mcp', NAME]
  if (!record?.owned?.some((o) => o.path.join('\u0000') === mcp.join('\u0000'))) return null
  const cur = await readTarget(resolveTarget(record.path, allowedOf(l)), input.env).catch(() => null)
  if (!cur || ownedModified(cur.bytes, record).some((p) => p.join('\u0000') === mcp.join('\u0000'))) return null
  const errors: ParseError[] = []
  const doc = parse(cur.bytes.toString('utf8'), errors, { allowTrailingComma: true, disallowComments: false })
  const environment = getAt(doc, [...mcp, 'environment']).value as Record<string, unknown> | undefined
  const url = environment && typeof environment === 'object' ? (environment.DETHERNETY_PLATFORM_URL ?? environment.DETHERNETY_URL) : undefined
  return typeof url === 'string' ? url : null
}

/** What OpenCode left in the scope's config folder, for the uninstall report: not removed, since it is OpenCode's. */
export async function openCodeLeftovers(input: Pick<OpenCodeInput, 'env' | 'paths' | 'scope'>): Promise<string[]> {
  if (input.scope !== 'user' && !(await exists(input.scope.project))) return []
  const l = await layoutOf({ ...input, runtime: { version: '', runtimePath: '' }, execPath: '', url: '', openCodeVersion: null } as OpenCodeInput)
  const config = path.join(l.root, ...l.prefix.split('/').filter(Boolean))
  const names = await fs.readdir(config).catch(() => [] as string[])
  return OPENCODE_OWN.filter((n) => names.includes(n)).map((n) => path.join(config, n))
}

/**
 * Whether OpenCode loads the installed plugin, for doctor's live check: `config` is `opencode debug
 * config`'s JSON, `logs` the stderr of `opencode debug agent build --print-logs` run without --pure (a
 * pure run loads no plugin). The plugin must be registered by its file URL and load without error.
 */
export function pluginLoadProblems(config: unknown, logs: string, pluginPath: string): string[] {
  const problems: string[] = []
  const url = pathToFileURL(pluginPath).href
  const plugins = config && typeof config === 'object' && Array.isArray((config as { plugin?: unknown }).plugin) ? (config as { plugin: unknown[] }).plugin : []
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === url)) problems.push('OpenCode does not register the Dethereal plugin')
  if (/failed to load plugin|plugin config hook failed/i.test(logs)) problems.push('OpenCode reported a plugin that failed to load or configure')
  return problems
}

export interface OpenCodeCheck {
  /** False only for a failure; a warning is ok. */
  readonly ok: boolean
  readonly status: 'ok' | 'warn' | 'fail'
  readonly label: string
  readonly detail?: string
}

const mk = (label: string, status: OpenCodeCheck['status'], detail?: string): OpenCodeCheck => ({ ok: status !== 'fail', status, label, ...(detail ? { detail } : {}) })

/**
 * Checks for doctor that need no OpenCode run: the installed files and keys against the manifest,
 * another Dethereal plugin OpenCode would load, configuration layers that can override ours, the
 * OpenCode version, and the Node the plugin starts.
 */
export async function checkOpenCode(ctx: TxContext, input: Pick<OpenCodeInput, 'env' | 'paths' | 'scope' | 'openCodeVersion' | 'allowUnverified'>): Promise<OpenCodeCheck[]> {
  const l = await layoutOf({ ...input, runtime: { version: '', runtimePath: '' }, execPath: '', url: '', openCodeVersion: input.openCodeVersion } as OpenCodeInput)
  const allowed = allowedOf(l)
  const checks: OpenCodeCheck[] = []
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  const entry: Manifest['installs'][string] | undefined = manifest.installs[l.key]
  checks.push(mk('installed', entry ? 'ok' : 'fail', entry ? undefined : 'no Dethereal install for this scope'))
  if (entry) {
    const drift = (await inspectOwned(ctx, allowed)).filter((d) => d.key === l.key)
    checks.push(mk('configuration as installed', drift.length ? 'fail' : 'ok', drift.length ? drift.map((d) => `${path.relative(l.root, d.path)}: ${Array.isArray(d.changed) ? d.changed.map((k) => k.join('.')).join(', ') : d.changed}`).join('; ') : undefined))
    const edited: string[] = []
    for (const r of entry.files.filter((x) => x.format === 'file')) {
      const cur = await readTarget(resolveTarget(r.path, allowed), ctx.env).catch(() => null)
      if (!cur || cur.sha256 !== r.post) edited.push(path.relative(l.root, r.path))
    }
    checks.push(mk('files as installed', edited.length ? 'fail' : 'ok', edited.length ? edited.join(', ') : undefined))
    const plugin = entry.files.find((r) => r.path.endsWith(`/plugins/${PLUGIN_FILE}`))
    const node = plugin ? /^const NODE: string = (".*")$/m.exec((await fs.readFile(plugin.path, 'utf8').catch(() => '')))?.[1] : undefined
    const nodePath = node ? (JSON.parse(node) as string) : null
    const runs = nodePath ? await fs.access(nodePath, fs.constants.X_OK).then(() => true, () => false) : false
    checks.push(mk("the plugin's Node", runs ? 'ok' : 'fail', runs ? undefined : nodePath ? `${nodePath} cannot be run: the guard cannot start (reinstall after a Node upgrade)` : 'the plugin names no Node'))
  }
  const own = path.join(l.root, ...`${l.prefix}plugins/${PLUGIN_FILE}`.split('/'))
  const others = (await detherealPlugins(input as OpenCodeInput, l)).filter((p) => p !== own)
  checks.push(mk('one Dethereal plugin', others.length ? 'fail' : 'ok', others.length ? `also loaded: ${others.join(', ')}` : undefined))
  const overrides = ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_PERMISSION', 'OPENCODE_CONFIG_DIR', 'OPENCODE_PURE'].filter((v) => input.env.vars[v])
  // A later layer is the user's to set (a warning); OPENCODE_PURE runs OpenCode without the plugin's guard (a failure).
  checks.push(mk('no overriding configuration', overrides.includes('OPENCODE_PURE') ? 'fail' : overrides.length ? 'warn' : 'ok',
    overrides.length ? `${overrides.join(', ')} set: a later layer can change what Dethereal set${overrides.includes('OPENCODE_PURE') ? ', and OPENCODE_PURE runs OpenCode without the plugin' : ''}` : undefined))
  const version = versionStatus(input.openCodeVersion)
  checks.push(mk('OpenCode version', version.status, version.detail))
  return checks
}

/**
 * What a live `opencode debug agent <name>` ruleset gets wrong, for doctor: a tool that must ask
 * that would not, and a place in the server's folder OpenCode would not refuse.
 */
export function effectiveRuleProblems(rules: readonly Rule[], askTools: readonly string[], realHome: string): string[] {
  const problems: string[] = []
  for (const t of askTools) {
    const action = lastMatch(rules, t, '*')
    if (action !== 'ask') problems.push(`${t} is ${action}, not ask`)
  }
  for (const probe of ['tokens.json', 'runtime/current.json', 'runtime/0.0.0/dist/index.js']) {
    const request = `${path.dirname(path.join(realHome, '.dethernety', probe))}/*`
    const action = lastMatch(rules.map((r) => ({ ...r, pattern: expandHome(r.pattern, realHome) })), 'external_directory', request)
    if (action !== 'deny') problems.push(`external_directory ${request} is ${action}, not deny`)
  }
  return problems
}
