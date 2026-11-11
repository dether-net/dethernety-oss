/**
 * `~/.dethernety/installs.json`: what the installer wrote, so it can be undone.
 *
 * One entry per harness and scope (`codex:user`, `opencode:project:<realpath>`).
 * Each file record carries the content it held before the write (`pre`, or
 * `absent`), the content written (`post`), the backup taken right before the
 * write, and who wrote it (the installer, or a harness CLI it ran). A record is
 * written `pending` before its file is touched and `committed` after, so an
 * interrupted install can always be classified and undone.
 *
 * The manifest is data, not authority: the paths it names are checked against
 * the caller's allowed templates before anything is removed or restored.
 */
import path from 'node:path'
import { type FileLockHandle, withFileLock } from '../../utils/file-lock.js'
import { BACKUP_ID } from './backup.js'
import { InstallerError } from './errors.js'
import { type InstallerEnv, STATE_DIR_NAME, type StatePaths, verifyDirectory } from './paths.js'
import { readTarget, resolveTarget, type Target, writeTarget } from './safe-write.js'

export const HARNESSES = ['claude', 'codex', 'opencode'] as const
export type Harness = (typeof HARNESSES)[number]
export type FileFormat = 'json' | 'jsonc' | 'toml' | 'file'
export type Writer = 'installer' | 'cli'

/** A key the installer owns inside a shared config file. */
export interface OwnedKey {
  /** JSON(C): the key path; TOML: the dotted table name. */
  path: string[]
  /** sha256 of the canonical owned value, so a later user change to it can be reported. */
  valueSha256: string
  /**
   * JSON(C): how many parent objects above the key the install created. On
   * removal each goes too, but only while it holds nothing else.
   */
  created?: number
}

export interface FileRecord {
  path: string
  format: FileFormat
  writer: Writer
  pre: string | 'absent'
  post: string
  backupId: string | null
  state: 'pending' | 'committed'
  owned?: OwnedKey[]
}

/**
 * A Claude Code plugin installed through Claude's own CLI, for one scope. Its
 * `id` names the marketplace the shared record holds. A plugin that was already
 * installed is adopted, never owned: uninstall leaves it installed and puts back
 * whether it was enabled. A part is `pending` from just before its CLI step to
 * just after, so an interrupted install can be told apart from one that finished.
 */
export interface ClaudePluginState {
  harness: 'claude'
  id: string
  preexisting: false | { version: string; enabled: boolean }
  state: 'pending' | 'done'
}

/**
 * A Codex entry that counts for the shared Codex record: `pending` before the
 * writer's first change, `done` at the end. The plugin and its marketplace go
 * with the last such entry.
 */
export interface CodexEntryState {
  harness: 'codex'
  state: 'pending' | 'done'
}

/** What a harness CLI installed for one entry. */
export type CliState = ClaudePluginState | CodexEntryState

export interface InstallEntry {
  version: string
  files: FileRecord[]
  /** Runtime versions this entry's harness files still launch; garbage collection keeps them. */
  runtimes?: string[]
  cli?: CliState
  /** OpenCode only: installed for a version newer than the verified ones, with the operator's override, for that version. */
  allowUnverified?: { openCodeVersion: string }
}

/** The official marketplace, or (tests and release candidates only) a local directory. */
export type MarketplaceSource = { kind: 'github'; repo: typeof OFFICIAL_MARKETPLACE_REPO } | { kind: 'directory'; path: string }

export const OFFICIAL_MARKETPLACE_REPO = 'dether-net/claude-plugins'
export const OFFICIAL_MARKETPLACE_NAME = 'dether.net'
export const MARKETPLACE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * Claude Code state every Claude entry shares, since Claude keeps it user-wide:
 * the marketplace and the plugin's platform URL. Recorded once, by the first
 * install (`added`, `previous` never change after), and undone when the last
 * Claude entry goes.
 */
export interface ClaudeShared {
  claudeVersion: string
  marketplace: { name: string; source: MarketplaceSource; added: boolean; state: 'pending' | 'done' }
  /** The URL before the first install changed it (null: unset), and the URL the installer last set (null: never set one). */
  config: { previous: string | null; current: string | null }
}

export const CODEX_MARKETPLACE_NAME = 'dethereal-local'
export const CODEX_PLUGIN_ID = 'dethereal@dethereal-local'

/**
 * The Codex plugin, user-wide, shared by every Codex entry: its local
 * marketplace is the Codex bundle of one installed runtime (garbage collection
 * keeps that runtime), and the plugin installed from it. The Codex writer never
 * adopts a marketplace or a plugin it cannot prove is its own, so there is no
 * record of what was there before.
 */
export interface CodexShared {
  codexVersion: string
  marketplace: { name: typeof CODEX_MARKETPLACE_NAME; source: { kind: 'directory'; path: string }; runtimeVersion: string; state: 'pending' | 'done' }
  plugin: { id: typeof CODEX_PLUGIN_ID; state: 'pending' | 'done' }
}

export interface Manifest {
  schemaVersion: 1
  installs: Record<string, InstallEntry>
  shared?: { claude?: ClaudeShared; codex?: CodexShared }
}

const SHA = /^[0-9a-f]{64}$/
const KEY = /^(claude|codex|opencode):(user|project:\/.+)$/
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

export function entryKey(harness: Harness, scope: 'user' | { project: string }): string {
  return scope === 'user' ? `${harness}:user` : `${harness}:project:${scope.project}`
}

function validRecord(r: unknown): r is FileRecord {
  if (!r || typeof r !== 'object') return false
  const f = r as FileRecord
  return typeof f.path === 'string' && path.isAbsolute(f.path) &&
    ['json', 'jsonc', 'toml', 'file'].includes(f.format) && ['installer', 'cli'].includes(f.writer) &&
    (f.pre === 'absent' || (typeof f.pre === 'string' && SHA.test(f.pre))) && typeof f.post === 'string' && SHA.test(f.post) &&
    (f.backupId === null || (typeof f.backupId === 'string' && BACKUP_ID.test(f.backupId))) &&
    (f.state === 'pending' || f.state === 'committed') &&
    // The installer backs up every file it replaces; a CLI step leaves no backup of its own.
    (f.writer === 'cli' ? f.backupId === null : (f.pre === 'absent') === (f.backupId === null)) &&
    (f.owned === undefined || (Array.isArray(f.owned) && f.owned.every((o) => Array.isArray(o?.path) && o.path.length > 0 &&
      o.path.every((p) => typeof p === 'string') && typeof o.valueSha256 === 'string' && SHA.test(o.valueSha256) &&
      (o.created === undefined || (Number.isInteger(o.created) && o.created >= 0 && o.created < o.path.length)))))
}

const MAX_URL = 2048
const isState = (s: unknown) => s === 'pending' || s === 'done'
const isUrlOrNull = (u: unknown) => u === null || (typeof u === 'string' && u.length > 0 && u.length <= MAX_URL)

function validCli(c: unknown, key: string, shared: ClaudeShared | undefined): boolean {
  if (c === undefined) return true
  if (!c || typeof c !== 'object') return false
  // An entry holds only its own harness's state.
  if (key.startsWith('codex:')) return (c as CodexEntryState).harness === 'codex' && isState((c as CodexEntryState).state) && Object.keys(c).length === 2
  if (!key.startsWith('claude:')) return false
  const p = c as ClaudePluginState
  if (p.harness !== 'claude' || !isState(p.state)) return false
  // The plugin's id is exactly ours, in the marketplace the shared record names.
  if (!shared || p.id !== `dethereal@${shared.marketplace.name}`) return false
  return p.preexisting === false || (!!p.preexisting && typeof p.preexisting === 'object' &&
    typeof p.preexisting.version === 'string' && VERSION.test(p.preexisting.version) && typeof p.preexisting.enabled === 'boolean')
}

function validShared(s: unknown): s is ClaudeShared {
  const c = s as ClaudeShared
  if (!c || typeof c !== 'object' || typeof c.claudeVersion !== 'string' || !VERSION.test(c.claudeVersion)) return false
  const m = c.marketplace
  if (!m || typeof m !== 'object' || typeof m.name !== 'string' || !MARKETPLACE_NAME.test(m.name) || typeof m.added !== 'boolean' || !isState(m.state)) return false
  const src = m.source
  const sourceOk = !!src && typeof src === 'object' && (
    (src.kind === 'github' && src.repo === OFFICIAL_MARKETPLACE_REPO && m.name === OFFICIAL_MARKETPLACE_NAME) ||
    (src.kind === 'directory' && typeof src.path === 'string' && path.isAbsolute(src.path) && path.normalize(src.path) === src.path &&
      !src.path.includes('\0') && m.name !== OFFICIAL_MARKETPLACE_NAME))
  return sourceOk && !!c.config && typeof c.config === 'object' && isUrlOrNull(c.config.previous) && isUrlOrNull(c.config.current)
}

function validCodexShared(s: unknown): s is CodexShared {
  const c = s as CodexShared
  if (!c || typeof c !== 'object' || typeof c.codexVersion !== 'string' || !VERSION.test(c.codexVersion)) return false
  const m = c.marketplace
  if (!m || typeof m !== 'object' || m.name !== CODEX_MARKETPLACE_NAME || !isState(m.state) || typeof m.runtimeVersion !== 'string' || !VERSION.test(m.runtimeVersion)) return false
  const p = m.source?.path
  // Exactly the Codex bundle of the runtime it names, under a state root.
  const tail = path.join(STATE_DIR_NAME, 'runtime', m.runtimeVersion, 'bundles', 'codex')
  if (m.source?.kind !== 'directory' || typeof p !== 'string' || !path.isAbsolute(p) || path.normalize(p) !== p || !p.endsWith(path.sep + tail)) return false
  return !!c.plugin && typeof c.plugin === 'object' && c.plugin.id === CODEX_PLUGIN_ID && isState(c.plugin.state)
}

/** Parse and validate the manifest; anything off shape is refused as a whole. */
export function parseManifest(bytes: Buffer): Manifest {
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InstallerError('manifest_invalid', 'installs.json')
  }
  const m = raw as Manifest
  const sharedOk = m?.shared === undefined || (!!m.shared && typeof m.shared === 'object' && (m.shared.claude === undefined || validShared(m.shared.claude)) &&
    (m.shared.codex === undefined || validCodexShared(m.shared.codex)))
  const ok = !!m && typeof m === 'object' && m.schemaVersion === 1 && !!m.installs && typeof m.installs === 'object' && !Array.isArray(m.installs) && sharedOk &&
    Object.entries(m.installs).every(([k, e]) => KEY.test(k) && !!e && typeof e === 'object' && typeof e.version === 'string' && VERSION.test(e.version) &&
      Array.isArray(e.files) && e.files.every(validRecord) &&
      (e.runtimes === undefined || (Array.isArray(e.runtimes) && e.runtimes.length <= 16 && e.runtimes.every((r) => typeof r === 'string' && VERSION.test(r)))) &&
      validCli(e.cli, k, m.shared?.claude) &&
      (e.allowUnverified === undefined || (k.startsWith('opencode:') && !!e.allowUnverified && typeof e.allowUnverified === 'object' &&
        Object.keys(e.allowUnverified).length === 1 && typeof e.allowUnverified.openCodeVersion === 'string' && VERSION.test(e.allowUnverified.openCodeVersion))))
  if (!ok) throw new InstallerError('manifest_invalid', 'installs.json')
  return m
}

const manifestTarget = (paths: StatePaths): Target =>
  resolveTarget(paths.manifest, [{ root: paths.root, pattern: 'installs.json' }])

export async function readManifest(paths: StatePaths, env: InstallerEnv): Promise<{ manifest: Manifest; sha: string | 'absent' }> {
  const cur = await readTarget(manifestTarget(paths), env)
  if (!cur) return { manifest: { schemaVersion: 1, installs: {} }, sha: 'absent' }
  return { manifest: parseManifest(cur.bytes), sha: cur.sha256 }
}

/**
 * Run `fn` under the install lock: every change to the manifest, the backups
 * and the runtime directory happens under it. The state root is re-checked
 * first, since taking the lock creates a file inside it.
 */
export async function withStateLock<T>(paths: StatePaths, env: InstallerEnv, fn: (lock: FileLockHandle) => Promise<T>): Promise<T> {
  await verifyDirectory(paths.root, env, '~/.dethernety')
  return withFileLock(paths.manifestLock, fn, { label: 'installs.lock' })
}

/** Change the manifest under the install lock. */
export async function updateManifest<T>(paths: StatePaths, env: InstallerEnv, fn: (m: Manifest) => T | Promise<T>): Promise<T> {
  return withStateLock(paths, env, async (lock) => {
    const { manifest, sha } = await readManifest(paths, env)
    const result = await fn(manifest)
    await lock.assertHeld()
    await writeManifest(paths, env, manifest, sha)
    return result
  })
}

/** Write the manifest (caller holds the lock) provided it still holds `expect`; returns the new sha256. */
export async function writeManifest(paths: StatePaths, env: InstallerEnv, manifest: Manifest, expect: string | 'absent'): Promise<string> {
  parseManifest(Buffer.from(JSON.stringify(manifest)))
  return writeTarget(manifestTarget(paths), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), expect, env, 0o600)
}

/** Every backup id a record still points at; these are never pruned. */
export function referencedBackups(m: Manifest): Set<string> {
  return new Set(Object.values(m.installs).flatMap((e) => e.files.map((f) => f.backupId).filter((b): b is string => b !== null)))
}

export type Recovery = 'drop' | 'commit' | 'user_edited'

/**
 * How to settle a record left `pending` by an interrupted write: the target
 * still holds its old content (drop the record), holds what was about to be
 * written (commit it), or holds something else (keep it pending: whether the
 * write landed before the edit is unknown, so an uninstall only takes out an
 * owned part it still finds exactly as written).
 */
export function classifyPending(record: FileRecord, current: string | 'absent'): Recovery {
  if (current === record.pre) return 'drop'
  if (current === record.post) return 'commit'
  return 'user_edited'
}
