/**
 * The only read/write API for a model's `.dethereal/state.json`, and the
 * checked way to read or rewrite the other committed files under `.dethereal/`.
 *
 * Model directories live in repositories, and `.dethereal/` is committed
 * content, so everything under it is treated as untrusted input:
 * - the model directory is confined (`validatePathConfinement` against a
 *   realpath'd base the server chooses, never a tool input) and its real path is
 *   used for everything after;
 * - `.dethereal`, the state file and the lock must be a real directory and real
 *   regular files — symlinks and special files are refused, never followed;
 * - files are opened with no-follow and non-blocking flags, checked to be the
 *   same file that was inspected, single-linked and within a size cap;
 * - errors carry a code and a path relative to the model directory, never file
 *   content, parser text or absolute paths.
 * Node has no `openat`, so a directory component swapped between the checks and
 * the open is not fully excluded; the checks narrow that window to a race.
 *
 * Writes happen under a cross-process lock, atomically (tmp file, fsync, rename,
 * directory fsync), keep every key they do not change, and are skipped when the
 * content is unchanged.
 */
import { randomBytes } from 'node:crypto'
import { type BigIntStats, constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isModelDirectory, validatePathConfinement } from './path-confinement.js'
import { type FileLockHandle, type FileLockOptions, LockLostError, withFileLock } from './file-lock.js'

const DETHEREAL_DIR = '.dethereal'
const STATE_FILE = 'state.json'
const LOCK_FILE = 'state.lock'
const DEFAULT_MAX_BYTES = 1024 * 1024
/** Attempts at a lock-free read that keeps meeting a concurrent replace. */
const READ_ATTEMPTS = 5

/** Workflow state of one model. Unknown keys are kept as they are. */
export interface ModelState {
  currentState?: string
  completedStates?: string[]
  lastModified?: string
  staleElements?: string[]
  lastReconcileCommit?: string
  model_signed_off?: boolean
  inferredFromContent?: boolean
  [key: string]: unknown
}

export type StateFileErrorCode =
  | 'outside_root'
  | 'not_model_dir'
  | 'symlink'
  | 'not_regular'
  | 'hardlinked'
  | 'too_large'
  | 'changed'
  | 'invalid_json'
  | 'not_object'
  | 'io'
  | 'pointer_unavailable'

export class StateFileError extends Error {
  constructor(readonly code: StateFileErrorCode, readonly file: string) {
    super(`${file}: ${code.replaceAll('_', ' ')}`)
    this.name = 'StateFileError'
  }
}

export interface StoreOptions {
  /** Confinement base. Set by the server (project root), never from tool input. Defaults to cwd. */
  baseDir?: string
}

async function confine(modelDir: string, baseDir?: string): Promise<string> {
  // No base given: the confinement check applies its own default, so the store
  // follows the same project root as every other tool.
  const base = baseDir === undefined
    ? undefined
    : await fs.realpath(baseDir).catch(() => {
      throw new StateFileError('io', '.')
    })
  try {
    return await validatePathConfinement(modelDir, base)
  } catch {
    throw new StateFileError('outside_root', '.')
  }
}

/** Refuses anything but a real directory at `abs`; returns false when absent. */
async function realDirectory(abs: string, rel: string): Promise<boolean> {
  try {
    const st = await fs.lstat(abs)
    if (st.isSymbolicLink()) throw new StateFileError('symlink', rel)
    if (!st.isDirectory()) throw new StateFileError('not_regular', rel)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    if (err instanceof StateFileError) throw err
    throw new StateFileError('io', rel)
  }
}

/** Refuses anything but a single-linked regular file at `abs`; returns false when absent. */
async function regularFile(abs: string, rel: string): Promise<boolean> {
  try {
    const st = await fs.lstat(abs)
    if (st.isSymbolicLink()) throw new StateFileError('symlink', rel)
    if (!st.isFile()) throw new StateFileError('not_regular', rel)
    if (st.nlink !== 1) throw new StateFileError('hardlinked', rel)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    if (err instanceof StateFileError) throw err
    throw new StateFileError('io', rel)
  }
}

/**
 * Reads a checked regular file; `null` when absent. No symlink, a single link,
 * the same file from inspection to read, and at most `maxBytes`; errors carry
 * `rel`, never the absolute path.
 */
export async function readChecked(abs: string, rel: string, maxBytes: number): Promise<Buffer | null> {
  return (await readCheckedStat(abs, rel, maxBytes))?.bytes ?? null
}

/** `readChecked`, plus the stat of the descriptor the bytes were read through. */
export async function readCheckedStat(abs: string, rel: string, maxBytes: number): Promise<{ bytes: Buffer; stat: BigIntStats } | null> {
  let before
  try {
    before = await fs.lstat(abs, { bigint: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new StateFileError('io', rel)
  }
  if (before.isSymbolicLink()) throw new StateFileError('symlink', rel)
  if (!before.isFile()) throw new StateFileError('not_regular', rel)
  if (before.nlink !== 1n) throw new StateFileError('hardlinked', rel)
  if (before.size > BigInt(maxBytes)) throw new StateFileError('too_large', rel)

  let fh
  try {
    fh = await fs.open(abs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw new StateFileError(code === 'ELOOP' ? 'symlink' : 'io', rel)
  }
  try {
    const st = await fh.stat({ bigint: true })
    if (st.dev !== before.dev || st.ino !== before.ino) throw new StateFileError('changed', rel)
    if (!st.isFile()) throw new StateFileError('not_regular', rel)
    // No links left: an atomic write replaced the file while it was being opened.
    if (st.nlink === 0n) throw new StateFileError('changed', rel)
    if (st.nlink !== 1n) throw new StateFileError('hardlinked', rel)
    if (st.size > BigInt(maxBytes)) throw new StateFileError('too_large', rel)
    // Sized from the descriptor; the one spare byte shows a file that grew while it was read.
    const buf = Buffer.alloc(Number(st.size) + 1)
    let total = 0
    for (;;) {
      const { bytesRead } = await fh.read(buf, total, buf.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
      if (total === buf.length) throw new StateFileError(total > maxBytes ? 'too_large' : 'changed', rel)
    }
    return { bytes: buf.subarray(0, total), stat: st }
  } finally {
    await fh.close()
  }
}

function parseObject(bytes: Buffer, rel: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new StateFileError('invalid_json', rel)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new StateFileError('not_object', rel)
  return parsed as Record<string, unknown>
}

/**
 * Read a JSON object from a file under the model directory with the same
 * checks as the state file. `relPath` must stay inside the model directory and
 * every directory on the way must be a real directory. Returns `null` when absent.
 */
export async function readRepoJson(
  modelDir: string,
  relPath: string,
  options: StoreOptions & { maxBytes?: number } = {},
): Promise<Record<string, unknown> | null> {
  const parts = relPath.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..') || path.isAbsolute(relPath)) {
    throw new StateFileError('outside_root', relPath)
  }
  const root = await confine(modelDir, options.baseDir)
  let dir = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = path.join(dir, parts[i]!)
    if (!(await realDirectory(dir, parts.slice(0, i + 1).join('/')))) return null
  }
  const rel = parts.join('/')
  return retryTransient(async () => {
    const bytes = await readChecked(path.join(root, ...parts), rel, options.maxBytes ?? DEFAULT_MAX_BYTES)
    return bytes === null ? null : parseObject(bytes, rel)
  })
}

/**
 * Reads and existence checks take no lock, so another process's atomic replace
 * can land in the middle: the file changes under the open, or the rename is
 * seen half-done with two links. Both clear within moments; a real hard link
 * or a file that keeps changing is still refused after the last attempt.
 */
export async function retryTransient<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const transient = err instanceof StateFileError && (err.code === 'changed' || err.code === 'hardlinked')
      if (!transient || attempt >= READ_ATTEMPTS) throw err
      await new Promise((resolve) => setTimeout(resolve, 5 * attempt))
    }
  }
}

const STATE_REL = `${DETHEREAL_DIR}/${STATE_FILE}`

/** Read the model's state; `null` when the model has none yet. */
export async function readState(modelDir: string, options: StoreOptions = {}): Promise<ModelState | null> {
  return (await readRepoJson(modelDir, STATE_REL, options)) as ModelState | null
}

export interface UpdateOptions extends StoreOptions {
  /** Create the file when absent. Otherwise an absent file is left absent. */
  createIfMissing?: boolean
  lock?: Omit<FileLockOptions, 'label'>
}

/**
 * Read-modify-write the model's state under the state lock.
 *
 * `mutate` receives a copy of the current state (`{}` when creating) and
 * returns the new state. Returns the stored state, or `null` when the state is
 * absent and `createIfMissing` is false — in that case nothing is created, not
 * even `.dethereal/` or the lock.
 */
export async function updateState(
  modelDir: string,
  mutate: (state: ModelState) => ModelState,
  options: UpdateOptions = {},
): Promise<ModelState | null> {
  return updateDetherealJson(modelDir, STATE_FILE, mutate as (doc: Record<string, unknown>) => Record<string, unknown>, options)
}

/** The `.dethereal/` files the store may rewrite. */
const WRITABLE_FILES: ReadonlySet<string> = new Set([STATE_FILE, 'scope.json', 'quality.json', 'loop-back.json'])

/**
 * Read-modify-write one JSON object file directly under `.dethereal/`, with the
 * guarantees of {@link updateState}: confined model directory, no symlinked or
 * special files, the state lock held throughout, an atomic write, unknown keys
 * kept as `mutate` returns them, and no write when nothing changed.
 *
 * `file` is `state.json`, `scope.json` or `quality.json`; anything else is refused. The lock is
 * not reentrant: never call this from inside another store update.
 */
export async function updateDetherealJson(
  modelDir: string,
  file: string,
  mutate: (doc: Record<string, unknown>) => Record<string, unknown>,
  options: UpdateOptions = {},
): Promise<Record<string, unknown> | null> {
  const rel = `${DETHEREAL_DIR}/${file}`
  if (!WRITABLE_FILES.has(file)) throw new StateFileError('outside_root', rel)
  const root = await confine(modelDir, options.baseDir)
  const dir = path.join(root, DETHEREAL_DIR)
  const target = path.join(dir, file)
  const lockPath = path.join(dir, LOCK_FILE)

  const dirExists = await realDirectory(dir, DETHEREAL_DIR)
  const fileExists = dirExists && (await retryTransient(() => regularFile(target, rel)))
  if (!fileExists && !options.createIfMissing) return null
  if (!(await isModelDirectory(root))) throw new StateFileError('not_model_dir', '.')

  if (!dirExists) {
    await fs.mkdir(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw new StateFileError('io', DETHEREAL_DIR)
    })
    if (!(await realDirectory(dir, DETHEREAL_DIR))) throw new StateFileError('io', DETHEREAL_DIR)
  }
  const lockRel = `${DETHEREAL_DIR}/${LOCK_FILE}`
  return withFileLock(
    lockPath,
    async (handle) => {
      const bytes = await readChecked(target, rel, DEFAULT_MAX_BYTES)
      if (bytes === null && !options.createIfMissing) return null
      const current = bytes === null ? {} : parseObject(bytes, rel)
      const next = mutate(structuredClone(current))
      if (bytes !== null && isDeepStrictEqual(next, current)) return current
      await writeAtomic(dir, target, rel, JSON.stringify(next, null, 2), handle)
      return next
    },
    { ...options.lock, label: lockRel },
  ).catch((err: unknown) => {
    // A system error from taking the lock carries an absolute path; keep only the code.
    if ((err as NodeJS.ErrnoException).syscall) throw new StateFileError('io', lockRel)
    throw err
  })
}

async function writeAtomic(dir: string, target: string, rel: string, content: string, handle: FileLockHandle): Promise<void> {
  const tmp = `${target}.tmp.${randomBytes(8).toString('hex')}`
  // Keep the permissions of the file being replaced; a new file gets the usual 0644.
  const mode = await fs.lstat(target).then((st) => st.mode & 0o777, () => 0o644)
  try {
    const fh = await fs.open(tmp, 'wx', mode)
    try {
      await fh.chmod(mode)
      await fh.writeFile(content, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    await handle.assertHeld()
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err instanceof LockLostError ? err : new StateFileError('io', rel)
  }
  // The file is replaced: syncing its folder is best effort, and never reports the write as failed.
  const dfh = await fs.open(dir, fsConstants.O_RDONLY).catch(() => undefined)
  if (dfh) {
    await dfh.sync().catch(() => {})
    await dfh.close().catch(() => {})
  }
}

/** The `.dethereal/` files the store may delete. */
const DELETABLE_FILES: ReadonlySet<string> = new Set(['quality.json', 'loop-back.json'])

/**
 * Delete one file directly under `.dethereal/` under the state lock. Returns
 * whether a file was removed. The entry itself is unlinked: a symlink is
 * removed, never followed. `.dethereal` must be a real directory; when it is
 * absent nothing happens and no lock is taken. `file` is `quality.json`;
 * anything else is refused. The lock is not reentrant: never call this from
 * inside a store update.
 */
export async function deleteDetherealFile(modelDir: string, file: string, options: UpdateOptions = {}): Promise<boolean> {
  const rel = `${DETHEREAL_DIR}/${file}`
  if (!DELETABLE_FILES.has(file)) throw new StateFileError('outside_root', rel)
  const root = await confine(modelDir, options.baseDir)
  const dir = path.join(root, DETHEREAL_DIR)
  if (!(await realDirectory(dir, DETHEREAL_DIR))) return false
  const target = path.join(dir, file)
  const lockRel = `${DETHEREAL_DIR}/${LOCK_FILE}`
  return withFileLock(
    path.join(dir, LOCK_FILE),
    async () => {
      let st
      try {
        st = await fs.lstat(target)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw new StateFileError('io', rel)
      }
      if (!st.isFile() && !st.isSymbolicLink()) throw new StateFileError('not_regular', rel)
      try {
        await fs.unlink(target)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw new StateFileError('io', rel)
      }
      return true
    },
    { ...options.lock, label: lockRel },
  ).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).syscall) throw new StateFileError('io', lockRel)
    throw err
  })
}

// =============================================================================
// Settlement writes
// =============================================================================

/**
 * Files a settlement may replace: one element's attribute file, the structure or data-items file (a record value
 * the operator set), or a settlement file under `.dethereal/`.
 */
const SETTLEMENT_TARGET = /^(attributes\/(components|dataFlows|dataItems|boundaries)\/[A-Za-z0-9_-]{1,256}\.json|structure\.json|data-items\.json|\.dethereal\/(settlement-baseline|settlements|enrichment-pending)\.json|\.dethereal\/\.gitignore)$/
/** Largest file a settlement reads back to check it is unchanged. */
const SETTLEMENT_MAX_BYTES = 8 * 1024 * 1024

/** What a settlement may do while it holds the state lock. */
/** Files a settlement may remove: one element's attribute file, never anything else. */
const REMOVABLE_TARGET = /^attributes\/(components|dataFlows|dataItems|boundaries)\/[A-Za-z0-9_-]{1,256}\.json$/

export interface SettlementIO {
  /** The bytes of a file under the model directory, with the store's checks; `null` when absent. */
  read(rel: string): Promise<Buffer | null>
  /**
   * Replace a file under the model directory atomically, refusing (`changed`)
   * unless its bytes still equal `expected` (`null`: it must still be absent).
   */
  replace(rel: string, content: string, expected: Buffer | null): Promise<void>
  /**
   * Remove one element's attribute file, refusing (`changed`) unless it is still
   * a regular file with a single link whose bytes equal `expected`. A link, a
   * hard link, a directory or anything else at the name is refused; the entry
   * itself is removed, never what a link would point at.
   */
  remove(rel: string, expected: Buffer): Promise<void>
}

export interface SettlementOptions extends StoreOptions {
  lock?: Omit<FileLockOptions, 'label'>
  /** Tests only: fail after this many replaces and removes, to prove a retry converges. */
  failAfterReplaces?: number
}

/**
 * Run a settlement under the state lock: `fn` reads what it needs, decides,
 * and replaces files through `io`. Every replace re-reads its target and
 * refuses when it changed since `fn` read it, so a concurrent writer is never
 * overwritten. The lock is not reentrant: never call this from inside another
 * store update, or call another store update from `fn`.
 */
export async function withSettlementLock<T>(modelDir: string, fn: (io: SettlementIO) => Promise<T>, options: SettlementOptions = {}): Promise<T> {
  const root = await confine(modelDir, options.baseDir)
  if (!(await isModelDirectory(root))) throw new StateFileError('not_model_dir', '.')
  const dir = path.join(root, DETHEREAL_DIR)
  if (!(await realDirectory(dir, DETHEREAL_DIR))) {
    await fs.mkdir(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw new StateFileError('io', DETHEREAL_DIR)
    })
    if (!(await realDirectory(dir, DETHEREAL_DIR))) throw new StateFileError('io', DETHEREAL_DIR)
  }
  const lockRel = `${DETHEREAL_DIR}/${LOCK_FILE}`
  let replaces = 0
  return withFileLock(
    path.join(dir, LOCK_FILE),
    async (handle) => {
      const locate = async (rel: string) => {
        if (!SETTLEMENT_TARGET.test(rel)) throw new StateFileError('outside_root', rel)
        const parts = rel.split('/')
        let d = root
        for (const part of parts.slice(0, -1)) {
          d = path.join(d, part)
          if (!(await realDirectory(d, part))) throw new StateFileError('io', rel)
        }
        return { parent: d, abs: path.join(root, ...parts) }
      }
      const io: SettlementIO = {
        async read(rel) {
          const { abs } = await locate(rel)
          return readChecked(abs, rel, SETTLEMENT_MAX_BYTES)
        },
        async replace(rel, content, expected) {
          if (options.failAfterReplaces !== undefined && replaces >= options.failAfterReplaces) throw new StateFileError('io', rel)
          const { parent, abs } = await locate(rel)
          const current = await readChecked(abs, rel, SETTLEMENT_MAX_BYTES)
          if (expected === null ? current !== null : current === null || !current.equals(expected)) throw new StateFileError('changed', rel)
          await writeAtomic(parent, abs, rel, content, handle)
          replaces++
        },
        async remove(rel, expected) {
          if (!REMOVABLE_TARGET.test(rel)) throw new StateFileError('outside_root', rel)
          if (options.failAfterReplaces !== undefined && replaces >= options.failAfterReplaces) throw new StateFileError('io', rel)
          const { abs } = await locate(rel)
          const current = await readChecked(abs, rel, SETTLEMENT_MAX_BYTES)
          if (current === null || !current.equals(expected)) throw new StateFileError('changed', rel)
          await fs.unlink(abs).catch(() => {
            throw new StateFileError('io', rel)
          })
          replaces++
        },
      }
      return fn(io)
    },
    { ...options.lock, label: lockRel },
  ).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).syscall) throw new StateFileError('io', lockRel)
    throw err
  })
}
