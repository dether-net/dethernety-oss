/**
 * Cross-process advisory file lock.
 *
 * Several processes of the same user can write the same file at once: one MCP
 * server per harness session (Codex starts one per spawned agent), hooks and the
 * CLI. This lock serialises their read-modify-write sequences.
 *
 * **Acquire.** The payload `{v, pid, nonce, host, boot}` is written to a private
 * tmp file and hard-linked into place. `link()` is atomic and fails with EEXIST
 * when the lock exists, and a linked lock is never partially written, so a
 * reader never mistakes a half-written live lock for a corrupt one.
 *
 * **Liveness.** A lock is judged by identity, never by a payload timestamp:
 * - our own pid with a nonce this process holds → live;
 * - unparsable, invalid fields, a symlink, a special file or an oversized file → stale;
 * - another host → stale only once the lock file's mtime is older than
 *   `foreignHostStaleMs` (a live holder on a shared mount is waited on; a lock
 *   committed to a repository gets its mtime from the checkout and clears soon after);
 * - another boot of this host → stale (every process of an earlier boot is dead);
 * - our own pid with a nonce we do not hold → stale (left by a crashed earlier call);
 * - a live pid (signal 0 succeeds or EPERM) → live, until the lock is older than
 *   `maxHoldMs`; a dead pid → stale.
 * A live holder is broken only past `maxHoldMs`, the last-resort bound for a
 * suspended or wedged process. Writers call `assertHeld()` immediately before
 * their commit step, so a holder whose lock was broken aborts instead of
 * overwriting the new holder's work; the gap between that check and the commit
 * itself remains.
 *
 * **Break.** A stale lock is broken under an exclusive claim `<lock>.breaking`,
 * also placed with `link()`. Under the claim the lock must still exist with the
 * identity inspected before the claim (device, inode and a hash of its bytes);
 * anything else means it was released or re-taken, and the breaker yields. On a
 * match the breaker unlinks the lock and links its own while still holding the
 * claim, then drops the claim. A claim left by a crashed breaker is stale by the
 * same rules; it is removed and the acquirer yields to its retry loop. Removing
 * an abandoned claim is read-then-unlink, so a fresh claim landing in that
 * syscall-wide window could be removed; the breaker re-checks its claim right
 * before unlinking the lock, which narrows this further.
 *
 * Unlinking a symlink at the lock path removes the link, never its target.
 * Errors name the lock by the caller's label (a path relative to the model
 * directory), never by an absolute path.
 */
import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PAYLOAD_VERSION = 1
const MAX_PAYLOAD_BYTES = 4096
const BOOT_TOLERANCE_S = 60

const HOST = os.hostname()
const BOOT = Math.round(Date.now() / 1000 - os.uptime())

/** Nonces of locks and claims this process holds, shared by every copy of this module in the process. */
const HELD_KEY = Symbol.for('dethereal.file-lock.held')
const held: Set<string> = ((globalThis as Record<symbol, unknown>)[HELD_KEY] as Set<string> | undefined) ??
  ((globalThis as Record<symbol, unknown>)[HELD_KEY] = new Set<string>()) as Set<string>

export interface FileLockOptions {
  /** How long to wait for a live holder before failing. */
  waitMs?: number
  /** A live holder older than this is treated as wedged and broken. */
  maxHoldMs?: number
  /** A lock written on another host is stale once older than this. */
  foreignHostStaleMs?: number
  /** Name used in errors, e.g. `.dethereal/state.lock`. Defaults to the file name. */
  label?: string
}

const DEFAULTS = { waitMs: 5000, maxHoldMs: 10 * 60 * 1000, foreignHostStaleMs: 30 * 1000 }

export interface FileLockHandle {
  readonly nonce: string
  /** Throws LockLostError unless the lock is still ours. Call right before committing a write. */
  assertHeld(): Promise<void>
  /** Removes the lock if it is still ours. Idempotent. */
  release(): Promise<void>
}

export class LockBusyError extends Error {
  readonly code = 'busy'
  constructor(readonly lockName: string) {
    super(`${lockName} is held by another process; try again shortly`)
    this.name = 'LockBusyError'
  }
}

export class LockLostError extends Error {
  readonly code = 'lost'
  constructor(readonly lockName: string) {
    super(`${lockName} was taken over by another process before this write finished`)
    this.name = 'LockLostError'
  }
}

interface Payload {
  v: number
  pid: number
  nonce: string
  host: string
  boot: number
}

type Inspection =
  | { exists: false }
  | { exists: true; ident: string; ageMs: number; payload?: Payload }

function isPayload(x: unknown): x is Payload {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return p.v === PAYLOAD_VERSION &&
    Number.isSafeInteger(p.pid) && (p.pid as number) >= 1 &&
    typeof p.nonce === 'string' && /^[0-9a-f]{32}$/.test(p.nonce) &&
    typeof p.host === 'string' && p.host.length > 0 && p.host.length <= 255 &&
    Number.isSafeInteger(p.boot)
}

async function inspect(target: string): Promise<Inspection> {
  let st
  try {
    st = await fs.lstat(target, { bigint: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw err
  }
  const ageMs = Date.now() - Number(st.mtimeMs)
  const base = `${st.dev}:${st.ino}`
  if (st.isSymbolicLink()) {
    const text = await fs.readlink(target).catch(() => '')
    return { exists: true, ident: `${base}:link:${text}`, ageMs }
  }
  if (!st.isFile() || st.size > BigInt(MAX_PAYLOAD_BYTES)) {
    return { exists: true, ident: `${base}:other:${st.size}`, ageMs }
  }
  let fh
  try {
    fh = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    return { exists: true, ident: `${base}:unreadable`, ageMs }
  }
  try {
    const fst = await fh.stat({ bigint: true })
    if (fst.dev !== st.dev || fst.ino !== st.ino || !fst.isFile()) {
      return { exists: true, ident: `${base}:changed`, ageMs }
    }
    const buf = Buffer.alloc(MAX_PAYLOAD_BYTES + 1)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const bytes = buf.subarray(0, bytesRead)
    const ident = `${base}:${createHash('sha256').update(bytes).digest('hex')}`
    if (bytesRead > MAX_PAYLOAD_BYTES) return { exists: true, ident, ageMs }
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      return { exists: true, ident, ageMs }
    }
    return { exists: true, ident, ageMs, payload: isPayload(parsed) ? parsed : undefined }
  } finally {
    await fh.close()
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isLive(insp: Extract<Inspection, { exists: true }>, opts: Required<Omit<FileLockOptions, 'label'>>): boolean {
  const p = insp.payload
  if (!p) return false
  if (p.pid === process.pid && held.has(p.nonce)) return true
  // Another host's pid cannot be checked, so age decides. A modification time
  // well in the future (a clock ahead on a shared mount, a copy that kept
  // mtimes) would otherwise never age; treat it as stale.
  if (p.host !== HOST) return insp.ageMs >= -BOOT_TOLERANCE_S * 1000 && insp.ageMs <= opts.foreignHostStaleMs
  if (Math.abs(p.boot - BOOT) > BOOT_TOLERANCE_S) return false
  if (p.pid === process.pid) return false
  if (!pidAlive(p.pid)) return false
  return insp.ageMs >= -BOOT_TOLERANCE_S * 1000 && insp.ageMs <= opts.maxHoldMs
}

async function place(target: string, payload: string, nonce: string): Promise<boolean> {
  const tmp = `${target}.tmp.${nonce}`
  await fs.writeFile(tmp, payload, { flag: 'wx', mode: 0o600 })
  try {
    await fs.link(tmp, target)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  } finally {
    await fs.unlink(tmp).catch(() => {})
  }
}

/** Unlinks `target` only if it still has the inspected identity. */
async function unlinkIfSame(target: string, ident: string): Promise<void> {
  const now = await inspect(target)
  if (now.exists && now.ident === ident) await fs.unlink(target).catch(() => {})
}

async function ownedBy(target: string, nonce: string): Promise<string | undefined> {
  const insp = await inspect(target)
  return insp.exists && insp.payload?.nonce === nonce ? insp.ident : undefined
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Acquire the lock at `lockPath`. Waits up to `waitMs` for a live holder, then
 * throws LockBusyError. The caller must `release()` the handle (use withFileLock).
 */
export async function acquireFileLock(lockPath: string, options: FileLockOptions = {}): Promise<FileLockHandle> {
  const opts = { ...DEFAULTS, ...options }
  const label = options.label ?? path.basename(lockPath)
  const claimPath = `${lockPath}.breaking`
  const nonce = randomBytes(16).toString('hex')
  const payload = JSON.stringify({ v: PAYLOAD_VERSION, pid: process.pid, nonce, host: HOST, boot: BOOT })
  const deadline = Date.now() + opts.waitMs
  let delay = 10

  held.add(nonce)
  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 })
    for (;;) {
      if (await place(lockPath, payload, nonce)) return handleFor(lockPath, nonce, label)

      const insp = await inspect(lockPath)
      if (insp.exists && !isLive(insp, opts)) {
        if (await breakStale(lockPath, claimPath, insp.ident, payload, nonce, opts)) {
          return handleFor(lockPath, nonce, label)
        }
      }
      if (Date.now() >= deadline) throw new LockBusyError(label)
      if (!insp.exists) continue
      await sleep(delay + Math.floor(Math.random() * delay))
      delay = Math.min(delay * 2, 250)
    }
  } catch (err) {
    held.delete(nonce)
    throw err
  }
}

/** Returns true when the stale lock was replaced by ours. */
async function breakStale(
  lockPath: string,
  claimPath: string,
  staleIdent: string,
  payload: string,
  nonce: string,
  opts: Required<Omit<FileLockOptions, 'label'>>,
): Promise<boolean> {
  if (!(await place(claimPath, payload, nonce))) {
    const claim = await inspect(claimPath)
    if (claim.exists && !isLive(claim, opts)) await unlinkIfSame(claimPath, claim.ident)
    return false
  }
  try {
    const current = await inspect(lockPath)
    if (!current.exists || current.ident !== staleIdent) return false
    if (!(await ownedBy(claimPath, nonce))) return false
    await unlinkIfSame(lockPath, staleIdent)
    return await place(lockPath, payload, nonce)
  } finally {
    const claimIdent = await ownedBy(claimPath, nonce)
    if (claimIdent) await unlinkIfSame(claimPath, claimIdent)
  }
}

function handleFor(lockPath: string, nonce: string, label: string): FileLockHandle {
  let released = false
  return {
    nonce,
    async assertHeld() {
      if (released || !(await ownedBy(lockPath, nonce))) throw new LockLostError(label)
    },
    async release() {
      if (released) return
      released = true
      try {
        const ident = await ownedBy(lockPath, nonce)
        if (ident) await unlinkIfSame(lockPath, ident)
      } finally {
        held.delete(nonce)
      }
    },
  }
}

/** Run `fn` while holding the lock at `lockPath`; the lock is released afterwards. */
export async function withFileLock<T>(
  lockPath: string,
  fn: (handle: FileLockHandle) => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const handle = await acquireFileLock(lockPath, options)
  try {
    return await fn(handle)
  } finally {
    await handle.release()
  }
}
