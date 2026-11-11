/**
 * Checkpoints of an acceptance run, to resume a later run from a workflow step
 * instead of from the start. Development tooling: never part of the shipped
 * bundle.
 *
 * A run directory holds `project/` (the scratch project the harness works in)
 * and `run.json` (the run record, outside the project). A snapshot copies the
 * project only: model directories with their `.dethereal/`, the project's model
 * registry, the project files and `.git` (so a resumed run has the same commit).
 * Nothing from any home directory is ever read. A project that holds something
 * a restored run must not carry — a credential file, a symlink, git credentials,
 * git configuration that runs programs — is refused, not filtered. Git hooks
 * other than samples are left out and listed in the manifest.
 *
 * Platform state is recorded by reference (model id, export hash) and never
 * restored. Records sealed with the sandbox's own key (today: waivers) cannot be
 * verified under a new sandbox home: the resumed run grants them again. Keys are
 * never copied. A resumed run's record says where it came from, and it never
 * counts as a clean end-to-end run.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sha256Hex } from '../utils/hash.js'
import { modesProblem } from './score/run-dir.js'

export const SNAPSHOT_SCHEMA_VERSION = 1

/** File names that hold credentials; never in a project a run can be resumed from. */
const CREDENTIAL_NAMES = new Set([
  'tokens.json', 'auth.json', 'waiver.key', 'credentials.json', '.credentials.json', '.netrc', '_netrc', '.git-credentials', '.env', '.pgpass', '.npmrc',
  'id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa',
])
/** What the project's registry directory may hold. */
const REGISTRY_FILES = new Set(['models.json', 'config.json'])

/** Private keys and certificate bundles, and environment files other than the documented templates. */
const CREDENTIAL_PATTERN = /\.(pem|key|p12|pfx|jks|keystore)$|^\.env\.(?!(example|sample|template)$).+$/i

export class SnapshotRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SnapshotRefusal'
  }
}

export interface SnapshotFile {
  path: string
  sha256: string
  mode: number
}

export interface SnapshotManifest {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION
  label: string
  runId: string
  takenAt: string
  bundleHash: string
  distHash: string
  platform: { modelId: string | null; exportHash: string | null }
  files: SnapshotFile[]
  /** Paths left out on purpose (git hooks other than samples) */
  skipped: string[]
  /** What the run measures and how it is answered, as its run record will say; absent in older snapshots */
  runModes?: RunModes
}

/** The run record's mode fields: a resumed run is scored as the run it resumes. */
export interface RunModes {
  run_mode?: string
  sheet_mode?: string
  baseline_version?: string
  settlement?: string
}
const RUN_MODE_KEYS = ['run_mode', 'sheet_mode', 'baseline_version', 'settlement'] as const

export interface RunRecord {
  runId: string
  resumed_from?: { snapshot: string; label: string; runId: string }
  [key: string]: unknown
}

const sha256 = sha256Hex
/** Byte order, so a manifest and a tree hash do not depend on the locale. */
const byName = (a: fs.Dirent, b: fs.Dirent) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const posix = (p: string) => p.split(path.sep).join('/')

/** A tree hash over a directory: sorted relative paths and file contents. */
export function treeHash(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort(byName)) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        h.update(`${posix(path.relative(dir, p))}\0`)
        h.update(sha256(fs.readFileSync(p)))
        h.update('\0')
      }
    }
  }
  walk(dir)
  return h.digest('hex')
}

/** A gitfile's target (`gitdir: <path>`), resolved against the project. */
function gitfileTarget(file: string): string | null {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(file, 'utf8'))
  return m ? path.resolve(path.dirname(file), m[1]!) : null
}

/**
 * Git settings that make git run a program, read more configuration, or hold credentials. A clean
 * `git init` sets none of them.
 */
const GIT_CONFIG_EXEC = /^\s*(hookspath|fsmonitor|sshcommand|askpass|pager|editor|textconv|clean|smudge|process|driver|program|helper|path|command|cmd|gitproxy|external|alternaterefscommand|receivepack|uploadpack|worktree)\s*=/im
const GIT_CONFIG_EXEC_SECTION = /^\s*\[\s*(include|includeif|alias|filter|credential|protocol|gpg)\b/im
/** A remote that runs a program instead of connecting (`ext::`), or reads a local helper (`fd::`). */
const GIT_REMOTE_EXEC = /^\s*(?:url|pushurl)\s*=\s*(?:ext|fd)::/im

/** Refuse remote URLs with a user name or password. */
function checkRemoteUrls(file: string, rel: string, text = fs.readFileSync(file, 'utf8')): void {
  for (const m of text.matchAll(/^\s*(?:url|pushurl)\s*=\s*(\S+)/gim)) {
    try {
      const u = new URL(m[1]!)
      if (u.username || u.password) throw new SnapshotRefusal('git_credentials', `${rel} has a remote URL with a user name or password`)
    } catch (err) {
      if (err instanceof SnapshotRefusal) throw err
    }
  }
}

/** Refuse a git config that holds credentials or makes git run a program. */
function checkGitConfig(file: string, rel: string): void {
  const text = fs.readFileSync(file, 'utf8')
  if (/^\s*\[\s*credential\b/im.test(text)) throw new SnapshotRefusal('git_credentials', `${rel} has a credential section`)
  if (GIT_CONFIG_EXEC_SECTION.test(text) || GIT_CONFIG_EXEC.test(text) || GIT_REMOTE_EXEC.test(text)) {
    throw new SnapshotRefusal('git_config_exec', `${rel} makes git run a program or read more configuration`)
  }
  checkRemoteUrls(file, rel, text)
}

/**
 * Every file of the project to copy, after the refusals; hooks other than samples are skipped. Paths
 * are project-relative. Throws SnapshotRefusal on anything a resumed run must not carry.
 */
export function collectProject(project: string, homes: string[] = []): { files: Array<{ rel: string; abs: string; mode: number }>; skipped: string[] } {
  const root = fs.realpathSync(project)
  for (const home of homes) {
    const h = fs.existsSync(home) ? fs.realpathSync(home) : path.resolve(home)
    if (root === h || root.startsWith(`${h}${path.sep}`) || h.startsWith(`${root}${path.sep}`)) {
      throw new SnapshotRefusal('home_overlap', 'the project and a sandbox home overlap')
    }
  }
  const files: Array<{ rel: string; abs: string; mode: number }> = []
  const skipped: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort(byName)) {
      const abs = path.join(d, e.name)
      const rel = posix(path.relative(root, abs))
      if (e.isSymbolicLink()) throw new SnapshotRefusal('symlink', `${rel} is a symbolic link`)
      if (CREDENTIAL_NAMES.has(e.name) || (e.isFile() && CREDENTIAL_PATTERN.test(e.name))) throw new SnapshotRefusal('credential_file', `${rel} is a credential file`)
      if (e.isDirectory()) {
        walk(abs)
        continue
      }
      if (!e.isFile()) throw new SnapshotRefusal('special_file', `${rel} is not a regular file`)
      const parts = rel.split('/')
      if (parts[0] === '.dethernety' && (parts.length !== 2 || !REGISTRY_FILES.has(parts[1]!))) {
        throw new SnapshotRefusal('registry_content', `${rel} does not belong in the model registry`)
      }
      if (parts.includes('.git')) {
        // Every repository inside `.git` (the project's, and each submodule's under `modules/`) counts.
        if (parts[parts.length - 2] === 'hooks' && !e.name.endsWith('.sample')) {
          skipped.push(rel)
          continue
        }
        if (e.name === 'config' || e.name === 'config.worktree') checkGitConfig(abs, rel)
      }
      // Submodule URLs are git configuration too: no user name or password in them.
      if (e.name === '.gitmodules') checkRemoteUrls(abs, rel)
      // A `.git` file (a worktree or submodule link) must point inside the project.
      if (e.name === '.git') {
        const target = gitfileTarget(abs)
        if (!target || !(target === root || target.startsWith(`${root}${path.sep}`))) throw new SnapshotRefusal('gitfile_outside', `${rel} points outside the project`)
      }
      files.push({ rel, abs, mode: fs.statSync(abs).mode & 0o777 })
    }
  }
  walk(root)
  return { files, skipped }
}

export interface SnapshotOptions {
  store: string
  runId: string
  bundleHash: string
  distHash: string
  platformModelId?: string | null
  exportHash?: string | null
  /** Sandbox homes the run used: the project must not overlap any of them */
  homes?: string[]
  now?: Date
  /** The run's mode fields, carried into the record of a run resumed from the snapshot */
  runModes?: RunModes
}

/** Snapshot `<runDir>/project` under `<store>/<runId>/<label>/`. Returns the snapshot directory. */
export function takeSnapshot(runDir: string, label: string, options: SnapshotOptions): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(label) || label.startsWith('.')) throw new SnapshotRefusal('bad_label', 'a label is 1-64 letters, digits, dots, dashes or underscores')
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.runId) || options.runId.startsWith('.')) throw new SnapshotRefusal('bad_run_id', 'a run id is 1-64 letters, digits, dots, dashes or underscores')
  const modes = options.runModes && modesProblem(modesOf(options.runModes) as Record<string, unknown>)
  if (modes) throw new SnapshotRefusal('bad_modes', modes)
  const project = path.join(runDir, 'project')
  const { files, skipped } = collectProject(project, options.homes ?? [])
  const target = path.join(options.store, options.runId, label)
  if (fs.existsSync(target)) throw new SnapshotRefusal('exists', 'a snapshot with that label exists')
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const tmp = `${target}.tmp-${process.pid}`
  fs.mkdirSync(path.join(tmp, 'project'), { recursive: true, mode: 0o700 })
  const manifestFiles: SnapshotFile[] = []
  for (const f of files) {
    const data = fs.readFileSync(f.abs)
    const dest = path.join(tmp, 'project', f.rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
    fs.writeFileSync(dest, data, { mode: 0o600, flag: 'wx' })
    manifestFiles.push({ path: f.rel, sha256: sha256(data), mode: f.mode })
  }
  const manifest: SnapshotManifest = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    label,
    runId: options.runId,
    takenAt: (options.now ?? new Date()).toISOString(),
    bundleHash: options.bundleHash,
    distHash: options.distHash,
    platform: { modelId: options.platformModelId ?? null, exportHash: options.exportHash ?? null },
    files: manifestFiles,
    skipped,
    ...(options.runModes ? { runModes: modesOf(options.runModes) } : {}),
  }
  fs.writeFileSync(path.join(tmp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(tmp, target)
  return target
}

export interface RestoreResult {
  runDir: string
  record: RunRecord
  warnings: string[]
}

/** The mode fields alone, each a string; the run directory's check judges their values. */
function modesOf(m: RunModes): RunModes {
  const out: RunModes = {}
  for (const k of RUN_MODE_KEYS) if (typeof m[k] === 'string') out[k] = m[k]
  return out
}

/** Restore a snapshot into a new run directory. The run record says the run was resumed, and keeps the run's modes. */
export function restoreSnapshot(snapshot: string, newRunDir: string, options: { newRunId: string; liveExportHash?: string }): RestoreResult {
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')) as SnapshotManifest
  if (manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) throw new SnapshotRefusal('schema', 'unknown snapshot schema')
  if (fs.existsSync(newRunDir)) throw new SnapshotRefusal('exists', 'the new run directory exists')
  // Verify the snapshot before copying anything.
  const listed = new Set<string>()
  for (const f of manifest.files) {
    if (f.path.split('/').some((s) => s === '..' || s === '') || path.isAbsolute(f.path)) throw new SnapshotRefusal('bad_path', `${f.path} is not a project path`)
    const src = path.join(snapshot, 'project', f.path)
    if (fs.lstatSync(src).isSymbolicLink() || sha256(fs.readFileSync(src)) !== f.sha256) throw new SnapshotRefusal('corrupt', `${f.path} does not match the snapshot manifest`)
    listed.add(f.path)
  }
  const { files } = collectProject(path.join(snapshot, 'project'))
  for (const f of files) if (!listed.has(f.rel)) throw new SnapshotRefusal('corrupt', `${f.rel} is not in the snapshot manifest`)

  fs.mkdirSync(path.join(newRunDir, 'project'), { recursive: true, mode: 0o700 })
  try {
    for (const f of manifest.files) {
      const dest = path.join(newRunDir, 'project', f.path)
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
      fs.copyFileSync(path.join(snapshot, 'project', f.path), dest, fs.constants.COPYFILE_EXCL)
      fs.chmodSync(dest, f.mode & 0o755)
      if (sha256(fs.readFileSync(dest)) !== f.sha256) throw new SnapshotRefusal('corrupt', `${f.path} changed while it was restored`)
    }
  } catch (err) {
    // Leave nothing half-restored.
    fs.rmSync(newRunDir, { recursive: true, force: true })
    throw err
  }
  const warnings: string[] = []
  if (!options.liveExportHash) warnings.push('the platform export was not checked against the snapshot')
  else if (!manifest.platform.exportHash) warnings.push('the snapshot recorded no platform export to compare with')
  else if (options.liveExportHash !== manifest.platform.exportHash) {
    warnings.push("the platform model's export differs from the one the snapshot recorded")
  }
  const record: RunRecord = {
    runId: options.newRunId, ...modesOf(manifest.runModes ?? {}),
    resumed_from: { snapshot: path.basename(snapshot), label: manifest.label, runId: manifest.runId },
  }
  fs.writeFileSync(path.join(newRunDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return { runDir: newRunDir, record, warnings }
}

/** A run counts as clean end to end only when it was not resumed from a snapshot. */
export function isCleanRun(record: RunRecord): boolean {
  return record.resumed_from === undefined
}
