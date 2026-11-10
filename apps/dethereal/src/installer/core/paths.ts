/**
 * Where the installer may read and write, and who must own it.
 *
 * Every function takes an `InstallerEnv`; nothing here reads `os.homedir()` or
 * `process.env` except `defaultEnv`, which only the CLI edge calls. The roots a
 * write may land under (HOME, CODEX_HOME, the XDG config home, a project) are
 * realpath-ed once and owner-checked; below them no symlink is followed.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { InstallerError } from './errors.js'

export interface InstallerEnv {
  /** The user's home directory (absolute). */
  home: string
  /** Environment used to resolve harness roots (CODEX_HOME, XDG_CONFIG_HOME). */
  vars: Readonly<Record<string, string | undefined>>
  /** Effective uid the installer runs as. */
  euid: number
  platform: NodeJS.Platform
}

export function defaultEnv(): InstallerEnv {
  return { home: os.homedir(), vars: { ...process.env }, euid: process.geteuid?.() ?? -1, platform: process.platform }
}

/** The installer runs only as a normal user on a POSIX system. */
export function assertSupported(env: InstallerEnv): void {
  if (env.platform === 'win32') throw new InstallerError('unsupported_platform', env.platform)
  if (env.euid === 0) throw new InstallerError('running_as_root', 'installer')
  if (env.euid < 0) throw new InstallerError('unsupported_platform', 'no effective uid')
}

export const STATE_DIR_NAME = '.dethernety'

export interface StatePaths {
  root: string
  runtime: string
  backups: string
  backupIndex: string
  manifest: string
  manifestLock: string
  current: string
}

/** Paths under the state root, for an already-resolved (realpath) home. */
export function statePaths(realHome: string): StatePaths {
  const root = path.join(realHome, STATE_DIR_NAME)
  return {
    root,
    runtime: path.join(root, 'runtime'),
    backups: path.join(root, 'backups'),
    backupIndex: path.join(root, 'backups', 'index.json'),
    manifest: path.join(root, 'installs.json'),
    manifestLock: path.join(root, 'installs.lock'),
    current: path.join(root, 'runtime', 'current.json'),
  }
}

/** A root the installer writes under: realpath-ed, a directory, owned by euid, not group- or world-writable. */
export async function resolveRoot(dir: string, env: InstallerEnv, label: string): Promise<string> {
  let real: string
  try {
    real = await fs.realpath(dir)
  } catch {
    throw new InstallerError('io', label)
  }
  const st = await fs.stat(real).catch(() => { throw new InstallerError('io', label) })
  if (!st.isDirectory()) throw new InstallerError('not_a_directory', label)
  if (st.uid !== env.euid) throw new InstallerError('not_owned', label)
  if ((st.mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', label)
  return real
}

export interface StateRootReport {
  paths: StatePaths
  created: boolean
  /** Set when a readable-but-not-writable directory was tightened to 0700. */
  tightened: boolean
  /** Secret files that were readable by group or others before this run. */
  exposedSecrets: string[]
}

const SECRET_FILES = ['tokens.json', 'waiver.key']

/**
 * Make sure `~/.dethernety` is a real directory owned by euid at 0700.
 *
 * Refused: a symlink, a non-directory, another owner, or group/world write
 * access (someone else may have planted files; tightening would not undo it).
 * Tightened and reported: group/world read or search only. Never recursive.
 */
export async function ensureStateRoot(env: InstallerEnv): Promise<StateRootReport> {
  assertSupported(env)
  const home = await resolveRoot(env.home, env, '~')
  const paths = statePaths(home)
  let st
  try {
    st = await fs.lstat(paths.root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new InstallerError('io', '~/.dethernety')
    await fs.mkdir(paths.root, { mode: 0o700 }).catch(() => { throw new InstallerError('io', '~/.dethernety') })
    await verifyDirectory(paths.root, env, '~/.dethernety')
    return { paths, created: true, tightened: false, exposedSecrets: [] }
  }
  if (st.isSymbolicLink()) throw new InstallerError('symlink', '~/.dethernety')
  if (!st.isDirectory()) throw new InstallerError('not_a_directory', '~/.dethernety')
  if (st.uid !== env.euid) throw new InstallerError('not_owned', '~/.dethernety')
  if ((st.mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', '~/.dethernety')
  let tightened = false
  if ((st.mode & 0o077) !== 0) {
    await fs.chmod(paths.root, 0o700).catch(() => { throw new InstallerError('io', '~/.dethernety') })
    tightened = true
  }
  const exposedSecrets: string[] = []
  for (const name of SECRET_FILES) {
    const f = await fs.lstat(path.join(paths.root, name)).catch(() => null)
    if (f && (f.mode & 0o077) !== 0) exposedSecrets.push(name)
  }
  return { paths, created: false, tightened, exposedSecrets }
}

/**
 * The state root's paths for a reader (doctor, a question's default): the
 * same refusals as `ensureStateRoot`, but nothing is created or tightened. An
 * absent root reads as nothing installed.
 */
export async function inspectStateRoot(env: InstallerEnv): Promise<{ paths: StatePaths; exists: boolean; loose: string[] }> {
  assertSupported(env)
  const paths = statePaths(await resolveRoot(env.home, env, '~'))
  const st = await fs.lstat(paths.root).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw new InstallerError('io', '~/.dethernety')
  })
  if (!st) return { paths, exists: false, loose: [] }
  if (st.isSymbolicLink()) throw new InstallerError('symlink', '~/.dethernety')
  if (!st.isDirectory()) throw new InstallerError('not_a_directory', '~/.dethernety')
  if (st.uid !== env.euid) throw new InstallerError('not_owned', '~/.dethernety')
  if ((st.mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', '~/.dethernety')
  // Reported, not tightened: `.` is the folder itself.
  const loose = (st.mode & 0o077) !== 0 ? ['.'] : []
  for (const name of SECRET_FILES) {
    const f = await fs.lstat(path.join(paths.root, name)).catch(() => null)
    if (f && (f.mode & 0o077) !== 0) loose.push(name)
  }
  return { paths, exists: true, loose }
}

/** A directory the installer made or uses: real, owned by euid, not group/world writable. */
export async function verifyDirectory(dir: string, env: InstallerEnv, label: string): Promise<void> {
  const st = await fs.lstat(dir).catch(() => { throw new InstallerError('io', label) })
  if (st.isSymbolicLink()) throw new InstallerError('symlink', label)
  if (!st.isDirectory()) throw new InstallerError('not_a_directory', label)
  if (st.uid !== env.euid) throw new InstallerError('not_owned', label)
  if ((st.mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', label)
}

/**
 * Create `sub` (relative, no `..`) under the resolved root one component at a
 * time, re-checking each with lstat, so no symlink planted on the way is followed.
 */
export async function ensureDirUnder(root: string, sub: string, env: InstallerEnv, mode = 0o700): Promise<string> {
  const parts = sub.split('/').filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..')) throw new InstallerError('outside_allowed', sub)
  let dir = root
  for (let i = 0; i < parts.length; i++) {
    dir = path.join(dir, parts[i]!)
    const label = parts.slice(0, i + 1).join('/')
    try {
      await fs.mkdir(dir, { mode })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw new InstallerError('io', label)
    }
    await verifyDirectory(dir, env, label)
  }
  return dir
}

// =============================================================================
// Deny targets for the state root
// =============================================================================

/**
 * What a deny rule must cover to keep an agent away from the state root: the
 * directory itself and everything under it (tokens.json and waiver.key live
 * there, and runtime/current.json decides what the hook shim runs). Both the
 * home-anchored and the absolute form are given, the absolute one for the
 * resolved home and for every other spelling of it in `homeAliases` (a HOME
 * reached through a symlink, such as `/var` for `/private/var`); the
 * project-level `.dethernety/` model registry is never covered, since patterns
 * are anchored.
 */
export function stateRootDenyTargets(realHome: string, homeAliases: readonly string[] = []): { tilde: string[]; absolute: string[]; folded: string[] } {
  const homes = [...new Set([realHome, ...homeAliases])]
  const abs = homes.map((h) => escapeGlob(path.join(h, STATE_DIR_NAME)))
  // The default macOS filesystem folds case, so `~/.Dethernety/waiver.key` and
  // `/users/me/.dethernety/waiver.key` open the same file; the folded forms cover
  // that for matchers that compare case.
  const tildeFolded = `~/${foldGlob(STATE_DIR_NAME)}`
  const absFolded = abs.map(foldGlob)
  return {
    tilde: [`~/${STATE_DIR_NAME}`, `~/${STATE_DIR_NAME}/**`],
    absolute: abs.flatMap((a) => [a, `${a}/**`]),
    folded: [tildeFolded, `${tildeFolded}/**`, ...absFolded.flatMap((a) => [a, `${a}/**`])],
  }
}

/** Every letter as a two-case class, for matchers that compare case. */
function foldGlob(p: string): string {
  return p.replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`)
}

/** Escape glob metacharacters in a literal path. */
export function escapeGlob(p: string): string {
  return p.replace(/[*?[\]{}()!\\]/g, '\\$&')
}

/** Paths a deny list must match for it to cover the whole state root. */
export function stateRootProbes(realHome: string, homeAliases: readonly string[] = []): string[] {
  const rel = ['', '/tokens.json', '/waiver.key', '/runtime/0.5.0/dist/index.js', '/runtime/current.json', '/.hidden', '/backups/x/y.bak']
  const homes = [...new Set([realHome, ...homeAliases])]
  return rel.flatMap((r) => [`~/${STATE_DIR_NAME}${r}`, ...homes.map((h) => `${path.join(h, STATE_DIR_NAME)}${r}`)])
}

/**
 * Does a writer's deny list cover the state root? `matches(pattern, path)` is
 * the harness's own matcher (with dotfiles matched). Case variants of the state
 * directory and of the whole absolute path are included, because the default
 * macOS filesystem folds case; `homeAliases` are other spellings of the home.
 */
export function coversStateRoot(matches: (pattern: string, p: string) => boolean, patterns: readonly string[], realHome: string,
  homeAliases: readonly string[] = []): { covered: boolean; missed: string[] } {
  const probes = stateRootProbes(realHome, homeAliases)
  const caseVariants = probes.flatMap((p) => {
    const dir = p.replace(`/${STATE_DIR_NAME}`, '/.Dethernety')
    return p.startsWith('~') ? [dir] : [dir, p.toUpperCase(), p.toLowerCase()]
  })
  const missed = [...new Set([...probes, ...caseVariants])].filter((p) => !patterns.some((pat) => matches(pat, p)))
  return { covered: missed.length === 0, missed }
}
