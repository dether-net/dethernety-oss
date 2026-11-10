/**
 * The project root: the directory model paths are confined to.
 *
 * Harnesses start this server in different places — Claude passes the project
 * directory in `CLAUDE_PROJECT_DIR`, Codex starts it in the session directory,
 * OpenCode in whatever subdirectory it was launched from — so the root is resolved,
 * never taken to be the working directory as such. In order:
 *
 * 1. `DETHEREAL_PROJECT_ROOT` — an explicit setting; must be an absolute path to an
 *    existing directory, and a bad value is an error rather than a fall-through.
 * 2. `CLAUDE_PROJECT_DIR`, when it names an existing directory.
 * 3. The nearest directory at or above the working directory that holds a
 *    `.dethernety/` directory or a `.git` entry.
 * 4. The working directory.
 *
 * The filesystem root, the home directory and its parents, and the session store
 * under the home directory are never a root: a confinement base there would admit
 * nearly every file the user has. A refused candidate ends resolution — it never
 * falls through to a weaker source.
 *
 * Markers are only ever `lstat`ed, never opened or followed, and git is never run:
 * repository configuration can make git execute programs. The walk only trusts
 * directories owned by the current user, so a marker planted in a shared directory
 * such as a temp directory cannot widen the root, and it never looks at the home
 * directory or above.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { debug, envValue } from '../config.js'

export type ProjectRootSource = 'explicit' | 'claude_project_dir' | 'marker' | 'cwd'

export type ProjectRootResult =
  | { root: string; source: ProjectRootSource }
  | { root: null; reason: string }

export interface ProjectRootInput {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Home directories to keep out of reach (default: protectedHomes()). */
  homes?: ProtectedHome[]
  /** Owner a walked directory must have; null skips the check (defaults to the process uid). */
  uid?: number | null
}

const SESSION_STORE_DIR = '.dethernety'

/** Canonical form of `p`: symlinks resolved and, on case-insensitive volumes, the on-disk case. */
export function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return path.resolve(p)
  }
}

/** Canonical form of `p` when it is an existing directory, otherwise null. */
function existingDirectory(p: string): string | null {
  try {
    const real = fs.realpathSync.native(p)
    return fs.statSync(real).isDirectory() ? real : null
  } catch {
    return null
  }
}

/**
 * A home directory to keep out of reach. With `ancestors`, its parents are refused too
 * (a base at `/Users` would admit every account's home).
 */
export interface ProtectedHome {
  dir: string
  ancestors: boolean
}

/**
 * The home directories to protect: the account's own home and everything above it,
 * and `$HOME` itself when it points elsewhere (a sandbox home is often placed inside
 * a project, whose directory must stay usable). Without an account entry (some
 * containers) `$HOME` is all there is, so its parents are refused too.
 */
export function protectedHomes(): ProtectedHome[] {
  let account: string | undefined
  try {
    account = os.userInfo().homedir || undefined
  } catch {
    account = undefined
  }
  const envHome = os.homedir()
  const homes: ProtectedHome[] = []
  if (account) homes.push({ dir: canonical(account), ancestors: true })
  if (envHome) homes.push({ dir: canonical(envHome), ancestors: !account })
  return homes
}

/** Whether `child` is `parent` or inside it (both already canonical). */
export function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
}

/**
 * Why `dir` (canonical) cannot be a confinement base, or null when it can.
 * The reason names the kind of directory, never the path.
 */
export function refusedBaseReason(dir: string, homes: ProtectedHome[] = protectedHomes()): string | null {
  if (path.parse(dir).root === dir) return 'the filesystem root'
  for (const home of homes) {
    if (home.ancestors ? within(home.dir, dir) : dir === home.dir) return 'the home directory or one of its parents'
    if (within(dir, path.join(home.dir, SESSION_STORE_DIR))) return 'the session store directory'
  }
  return null
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p)
  } catch {
    return null
  }
}

function hasMarker(dir: string): boolean {
  if (lstatOrNull(path.join(dir, SESSION_STORE_DIR))?.isDirectory()) return true
  const git = lstatOrNull(path.join(dir, '.git'))
  return Boolean(git && (git.isDirectory() || git.isFile()))
}

function findMarkedAncestor(start: string, homes: ProtectedHome[], uid: number | null): string | null {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (refusedBaseReason(dir, homes)) return null
    const st = lstatOrNull(dir)
    if (!st || (uid !== null && st.uid !== uid)) return null
    if (hasMarker(dir)) return dir
    if (path.dirname(dir) === dir) return null
  }
}

function accept(dir: string, source: ProjectRootSource, homes: ProtectedHome[]): ProjectRootResult {
  const refused = refusedBaseReason(dir, homes)
  if (refused) return { root: null, reason: `refused: the project root would be ${refused}` }
  return { root: dir, source }
}

/** Resolve the project root. Reads the filesystem (stat and realpath only); never throws. */
export function resolveProjectRoot(input: ProjectRootInput = {}): ProjectRootResult {
  const env = input.env ?? process.env
  const homes = (input.homes ?? protectedHomes()).map((h) => ({ ...h, dir: canonical(h.dir) }))
  const uid = input.uid !== undefined ? input.uid : (process.getuid?.() ?? null)

  const explicit = envValue('DETHEREAL_PROJECT_ROOT', env)
  if (explicit !== undefined) {
    if (!path.isAbsolute(explicit)) return { root: null, reason: 'DETHEREAL_PROJECT_ROOT must be an absolute path' }
    const dir = existingDirectory(explicit)
    if (!dir) return { root: null, reason: 'DETHEREAL_PROJECT_ROOT is not an existing directory' }
    return accept(dir, 'explicit', homes)
  }

  const cwd = existingDirectory(input.cwd ?? process.cwd())

  const claudeDir = envValue('CLAUDE_PROJECT_DIR', env)
  if (claudeDir !== undefined) {
    const dir = path.isAbsolute(claudeDir) ? existingDirectory(claudeDir) : null
    if (dir) {
      if (cwd && !within(cwd, dir)) debug('CLAUDE_PROJECT_DIR does not contain the working directory; using it anyway')
      return accept(dir, 'claude_project_dir', homes)
    }
    debug('CLAUDE_PROJECT_DIR is not an existing absolute directory; ignored')
  }

  if (!cwd) return { root: null, reason: 'the working directory cannot be resolved' }
  const marked = findMarkedAncestor(cwd, homes, uid)
  return marked ? accept(marked, 'marker', homes) : accept(cwd, 'cwd', homes)
}

let current: ProjectRootResult | undefined

/** Resolve the root once for this process; the server calls it at startup. */
export function initProjectRoot(input?: ProjectRootInput): ProjectRootResult {
  current = resolveProjectRoot(input)
  return current
}

/** The root resolved at startup, or undefined when nothing resolved one (library and test use). */
export function getProjectRoot(): ProjectRootResult | undefined {
  return current
}

/** Forget the resolved root (tests). */
export function resetProjectRoot(): void {
  current = undefined
}
