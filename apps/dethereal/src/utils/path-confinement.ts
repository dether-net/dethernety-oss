/**
 * Path confinement: which directories tools may read and write.
 *
 * Kept apart from the model-file readers so that the hooks, which run on every file
 * write, can use it without loading the model library.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { getProjectRoot, protectedHomes, refusedBaseReason } from './project-root.js'

/** The model manifest's file name (the model library's DEFAULT_FILE_NAMES.manifest). */
export const MANIFEST_FILE = 'manifest.json'

/**
 * Load allowed model paths from ~/.dethernety/models.json
 * Returns registered directory paths that are permitted outside the project root.
 */
async function loadAllowedModelPaths(): Promise<string[]> {
  try {
    const modelsJsonPath = path.join(homedir(), '.dethernety', 'models.json')
    const content = await fs.readFile(modelsJsonPath, 'utf-8')
    const data = JSON.parse(content)
    return Array.isArray(data.paths) ? data.paths : []
  } catch {
    return []
  }
}

/**
 * Where `p` really is: the real path of its nearest existing ancestor, with the
 * part that does not exist yet appended. A symlink anywhere in the existing part is
 * resolved, so a path that only looks like it is inside a directory is caught.
 *
 * Fails closed: a link that cannot be resolved (dangling, a loop) or a component
 * that cannot be inspected throws — the path is never judged by its spelling.
 */
export async function realOrResolved(p: string): Promise<string> {
  const resolved = path.resolve(p)
  const missing: string[] = []
  let current = resolved
  for (;;) {
    try {
      await fs.lstat(current)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const parent = path.dirname(current)
      if ((code === 'ENOENT' || code === 'ENOTDIR') && parent !== current) {
        missing.unshift(path.basename(current))
        current = parent
        continue
      }
      throw new Error('path cannot be inspected', { cause: err })
    }
    // The nearest existing component, link or not: native realpath resolves it, or throws.
    const real = await fs.realpath(current)
    return missing.length ? path.join(real, ...missing) : real
  }
}

/**
 * The directory paths are confined to: `baseDir` when given, else the project root
 * resolved at startup, else the working directory. Canonical, so a base reached
 * through a symlink compares equal to the real paths it contains. Null with a reason
 * when that directory may not be a base at all (the filesystem root, the home
 * directory or a parent of it, the session store) — whichever source supplied it.
 */
async function confinementBase(baseDir?: string): Promise<{ base: string } | { base: null; reason: string }> {
  let candidate = baseDir
  if (!candidate) {
    const root = getProjectRoot()
    if (root && root.root === null) return { base: null, reason: root.reason }
    candidate = root?.root ?? process.cwd()
  }
  let base: string
  try {
    base = await realOrResolved(candidate)
  } catch {
    return { base: null, reason: 'refused: the confinement base cannot be resolved' }
  }
  const refused = refusedBaseReason(base, protectedHomes())
  return refused ? { base: null, reason: `refused: the project root would be ${refused}` } : { base }
}

/**
 * Validate that a path is within the allowed base directory.
 * Prevents path traversal attacks via directory_path parameters.
 *
 * Checks (in order):
 * 1. Confinement to the base (see confinementBase); skipped when there is no usable base
 * 2. Registered model paths from ~/.dethernety/models.json
 *
 * Symlink targets are resolved before checking containment. A relative `targetPath`
 * resolves against the working directory, as the harness's model means it.
 */
export async function validatePathConfinement(targetPath: string, baseDir?: string): Promise<string> {
  const confinement = await confinementBase(baseDir)
  let realPath: string
  try {
    realPath = await realOrResolved(targetPath)
  } catch {
    throw new Error(`Path "${targetPath}" is outside the allowed directory`)
  }

  if (confinement.base !== null) {
    const { base } = confinement
    if (realPath.startsWith(base.endsWith(path.sep) ? base : base + path.sep) || realPath === base) {
      return realPath
    }
  }

  // Check models.json allowlist. Each entry must be a legitimate model
  // directory — manifest.json present and parsable — before we honour it.
  // Without this check, anything with write access to
  // ~/.dethernety/models.json (the user's own home dir, /dethereal:create
  // routine flows, any process running as the user) bypasses
  // confinement on every subsequent MCP invocation. Relative entries have no
  // stable meaning, and an entry that is itself a refused base would admit
  // everything under it, so both are ignored.
  const allowedPaths = await loadAllowedModelPaths()
  const homes = protectedHomes()
  for (const allowed of allowedPaths) {
    if (typeof allowed !== 'string' || !path.isAbsolute(allowed)) continue
    const resolvedAllowed = await realOrResolved(allowed).catch(() => null)
    if (resolvedAllowed === null) continue
    if (refusedBaseReason(resolvedAllowed, homes)) continue
    if (realPath.startsWith(resolvedAllowed + path.sep) || realPath === resolvedAllowed) {
      // Verify the allowlist entry itself is a real model directory before
      // trusting it. A poisoned models.json pointing at /tmp would otherwise
      // pass the substring match.
      if (await isModelDirectory(resolvedAllowed)) {
        return realPath
      }
    }
  }

  if (confinement.base === null) {
    throw new Error(
      `No project root (${confinement.reason}); start from the project directory or set DETHEREAL_PROJECT_ROOT`
    )
  }
  throw new Error(`Path "${targetPath}" is outside the allowed directory`)
}

/**
 * Check if a path is a valid model directory (has manifest.json)
 */
export async function isModelDirectory(dirPath: string): Promise<boolean> {
  try {
    const manifestPath = path.join(dirPath, MANIFEST_FILE)
    const stats = await fs.stat(manifestPath)
    return stats.isFile()
  } catch {
    return false
  }
}

// =============================================================================
// The model directory tree
// =============================================================================

/** The fixed directories inside a model directory that writers descend into. */
const MODEL_TREE_DIRS = [
  'attributes',
  'attributes/boundaries',
  'attributes/components',
  'attributes/dataFlows',
  'attributes/dataItems',
  '.dethereal',
  '.dethereal/class-cache',
  '.dethereal/template-fields',
  'controls'
]

/** A model directory whose tree cannot be written safely. The message names a relative path and a code only. */
export class ModelTreeError extends Error {
  constructor(readonly code: 'symlink' | 'not_directory' | 'not_regular' | 'hardlinked' | 'changed' | 'unreadable', readonly rel: string) {
    super(`${rel}: ${code.replaceAll('_', ' ')}`)
    this.name = 'ModelTreeError'
  }
}

async function realDirectoryOrAbsent(abs: string, rel: string): Promise<boolean> {
  let st
  try {
    st = await fs.lstat(abs)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw new ModelTreeError('unreadable', rel)
  }
  if (st.isSymbolicLink()) throw new ModelTreeError('symlink', rel)
  if (!st.isDirectory()) throw new ModelTreeError('not_directory', rel)
  return true
}

/**
 * Refuse a model directory whose writable tree reaches outside it: the directory
 * itself and every fixed directory writers descend into (`attributes/` and its
 * groups, `.dethereal/` and its cache directories) must each be a real directory,
 * or absent. Confinement checks the model directory's path; this checks what is
 * below it, which the repository controls. Files are not checked here: every
 * write to one is no-follow, and the state store checks its own.
 */
export async function assertRealModelTree(dirPath: string): Promise<void> {
  if (!(await realDirectoryOrAbsent(dirPath, '.'))) return
  for (const rel of MODEL_TREE_DIRS) await realDirectoryOrAbsent(path.join(dirPath, rel), rel)
}

/**
 * Refuse a file below `dirPath` at `rel` that is anything but absent or a
 * regular single-link file (a link, a FIFO, a device, a hard link).
 */
export async function assertRegularOrAbsent(dirPath: string, rel: string): Promise<void> {
  let st
  try {
    st = await fs.lstat(path.join(dirPath, rel))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new ModelTreeError('unreadable', rel)
  }
  if (st.isSymbolicLink()) throw new ModelTreeError('symlink', rel)
  if (!st.isFile()) throw new ModelTreeError('not_regular', rel)
  if (st.nlink !== 1) throw new ModelTreeError('hardlinked', rel)
}

/**
 * The identity of every directory from `root` down to `dir` (just `dir` when it
 * is not below `root`): each must be a real directory. Two equal results mean
 * nothing on the way was swapped.
 */
async function directoryChain(root: string, dir: string): Promise<string> {
  const rel = path.relative(root, dir)
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  const steps = inside ? [root, ...rel.split(path.sep).filter(Boolean).map((_, i, parts) => path.join(root, ...parts.slice(0, i + 1)))] : [dir]
  const ids: string[] = []
  for (const step of steps) {
    const st = await fs.lstat(step).catch(() => null)
    const name = path.relative(root, step) || '.'
    if (!st) throw new ModelTreeError('changed', name)
    if (st.isSymbolicLink()) throw new ModelTreeError('symlink', name)
    if (!st.isDirectory()) throw new ModelTreeError('not_directory', name)
    ids.push(`${st.dev}:${st.ino}`)
  }
  return ids.join('/')
}

/**
 * Write a file without following a symlink at its own path: a link planted where a
 * model file goes is refused, never written through.
 *
 * The target is never opened: the data goes to a hidden tmp in the same
 * directory (created exclusively, flushed), and the tmp is renamed over the
 * target. So nothing is truncated before a check, a FIFO is never opened, and a
 * hard link's other name keeps its content. An existing file's mode is kept.
 * Right before the rename, every directory from `root` (the model directory) to
 * the target's is checked again, so a directory swapped for a link meanwhile
 * aborts the write.
 *
 * Residual: Node has no `renameat`, so a swap between that check and the rename
 * syscall still lands, and the tmp is written inside a swapped directory before
 * the check notices it. Windows may refuse to rename over a file another program
 * holds open, and a bind-mounted single file cannot be replaced by a rename.
 */
export async function writeFileNoFollow(abs: string, data: string, root?: string): Promise<void> {
  const dir = path.dirname(abs)
  const name = path.basename(abs)
  let target
  try {
    target = await fs.lstat(abs)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new ModelTreeError('unreadable', name)
  }
  if (target && target.isSymbolicLink()) throw new ModelTreeError('symlink', name)
  if (target && !target.isFile()) throw new ModelTreeError('not_regular', name)

  const chain = await directoryChain(root ?? dir, dir)
  const tmp = path.join(dir, `.${name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  let created = false
  try {
    const handle = await fs.open(tmp, 'wx', 0o600)
    created = true
    try {
      await handle.chmod(target ? target.mode & 0o777 : 0o644)
      await handle.writeFile(data, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if ((await directoryChain(root ?? dir, dir)) !== chain) throw new ModelTreeError('changed', path.relative(root ?? dir, dir) || '.')
    await fs.rename(tmp, abs)
    created = false
  } finally {
    if (created) await fs.unlink(tmp).catch(() => undefined)
  }
}

/** Remove `abs` only if it is a regular file; a link or anything else is left alone. */
export async function unlinkRegularFile(abs: string): Promise<boolean> {
  const st = await fs.lstat(abs).catch(() => null)
  if (!st || !st.isFile()) return false
  await fs.unlink(abs)
  return true
}
