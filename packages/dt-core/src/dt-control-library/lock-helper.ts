/**
 * File-based advisory lock for control-library writes (Sprint 4 F-03).
 *
 * The control-library subsystem performs read-modify-write sequences across
 * three on-disk artefacts: the per-control file (`controls/<id>.json`), the
 * WAL journal (`.dethereal/pending-id-rewrite.json`), and the audit log
 * (`.dethereal/control-audit.log`). None of these are protected by an
 * OS-level lock. Two concurrent `manage_controls` invocations against the
 * same model directory race:
 *
 *   - Each WAL `appendOperation` reads the journal, mutates in memory,
 *     atomically renames a tmp file. Last-writer wins; first writer's
 *     operation silently lost.
 *   - Each `writeControlFile` is similarly read-modify-write through the
 *     atomic-rename helper; concurrent edits to the same control are racy.
 *   - Each `appendAuditEntry` opens with `'a'` (true POSIX append, atomic
 *     for writes ≤ PIPE_BUF ~4 KB), but entries with `previousAttributes`
 *     can exceed PIPE_BUF and have bytes interleave between writers.
 *
 * This helper provides a coarse model-dir-scoped lock so that any one MCP
 * action serialises against another. The lock is HELD for the duration of
 * the MCP action, not per-file — broad enough that the WAL journal +
 * control file + audit log all stay consistent within the transaction.
 *
 * **Implementation:** `fs.open(.dethereal/.control-library.lock, 'wx')`
 * (exclusive create — atomic). On success we own the lock; we write a
 * small JSON payload with our PID + timestamp to make stale locks
 * recoverable. On EEXIST we read the existing payload, signal-zero
 * (`process.kill(pid, 0)`) the holder; if the holder is dead we unlink
 * and retry once. After retry, EEXIST is fatal — the second writer
 * surfaces the holder's PID so the operator can investigate.
 *
 * **Bundle safety:** like wal-helper.ts and audit-log-writer.ts, `node:fs/promises`
 * is lazy-loaded so this module can be re-exported through the
 * `@dethernety/dt-core` barrel without dragging Node-only APIs into the
 * studio frontend bundle.
 *
 * **Not protected:** crashes mid-transaction leave a stale lock file. The
 * stale-lock recovery (PID-alive check) handles this on the next acquire.
 * Worst case: a process whose PID was recycled to a still-alive unrelated
 * PID would falsely report the lock as held — operator must manually
 * unlink. Acceptable trade-off for a dev workflow tool.
 */

type FsModule = typeof import('node:fs/promises');
let _fs: FsModule | undefined;
async function loadFs(): Promise<FsModule> {
  if (!_fs) _fs = await import('node:fs/promises');
  return _fs;
}

/** POSIX-style path join — see wal-helper.ts for why we don't use `node:path`,
 *  and for the CodeQL js/polynomial-redos rationale behind the regex-free form. */
function join(...parts: string[]): string {
  return parts
    .map((p, i) => {
      let start = 0;
      let end = p.length;
      while (end > start && p.charCodeAt(end - 1) === 47 /* '/' */) end--;
      if (i !== 0) {
        while (start < end && p.charCodeAt(start) === 47 /* '/' */) start++;
      }
      return p.slice(start, end);
    })
    .filter(p => p.length > 0)
    .join('/');
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  if (idx < 0) return '.';
  if (idx === 0) return '/';
  return p.slice(0, idx);
}

const LOCK_RELATIVE_PATH = '.dethereal/.control-library.lock';

interface LockPayload {
  pid: number;
  acquiredAt: string;
}

export interface LockHandle {
  /** Absolute path to the lock file. Mostly for diagnostics. */
  readonly path: string;
}

/**
 * Thrown when {@link acquireLock} cannot acquire the lock because another
 * live process holds it. Carries the holder's PID so callers can render
 * a useful diagnostic.
 */
export class LockBusyError extends Error {
  readonly holderPid: number;
  readonly holderAcquiredAt: string;

  constructor(modelDir: string, holderPid: number, holderAcquiredAt: string) {
    super(
      `Control-library lock held by PID ${holderPid} (acquired ${holderAcquiredAt}) ` +
        `on ${modelDir}. A concurrent /dethereal:sync or other manage_controls ` +
        `action is in progress. Wait for it to finish or, if you believe it has ` +
        `crashed, manually delete .dethereal/.control-library.lock.`,
    );
    this.holderPid = holderPid;
    this.holderAcquiredAt = holderAcquiredAt;
    this.name = 'LockBusyError';
  }
}

/**
 * True if `pid` corresponds to a live process owned by the current user.
 * Uses `process.kill(pid, 0)` which sends no signal but raises if the
 * target PID is invalid (ESRCH) or not owned by us (EPERM treated as
 * "alive but not ours" — we still refuse to break the lock).
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH (no such process) → dead. Anything else (EPERM = permission
    // denied, indicating the process exists) → treat as alive.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Acquire the control-library lock for `modelDir`. Returns a handle the
 * caller MUST release in `finally` (or via try-with-resources idiom).
 *
 * Throws {@link LockBusyError} if a live holder owns the lock. Throws on
 * other I/O errors (caller should not catch broadly).
 */
export async function acquireLock(modelDir: string): Promise<LockHandle> {
  const fs = await loadFs();
  const lockPath = join(modelDir, LOCK_RELATIVE_PATH);
  await fs.mkdir(dirname(lockPath), { recursive: true });

  const payload: LockPayload = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  const payloadStr = JSON.stringify(payload);

  // First attempt — exclusive create.
  try {
    const handle = await fs.open(lockPath, 'wx');
    try {
      await handle.write(payloadStr, 0, 'utf-8');
      await handle.datasync();
    } finally {
      await handle.close();
    }
    return { path: lockPath };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // EEXIST — inspect holder. If dead, unlink and retry once.
  let holder: LockPayload | undefined;
  try {
    const raw = await fs.readFile(lockPath, 'utf-8');
    holder = JSON.parse(raw) as LockPayload;
  } catch {
    // Lockfile present but unreadable / corrupt — treat as stale and break.
    holder = undefined;
  }

  if (holder && isPidAlive(holder.pid)) {
    throw new LockBusyError(modelDir, holder.pid, holder.acquiredAt);
  }

  // Stale lock — unlink and retry. If retry also fails with EEXIST a third
  // process beat us to it; surface that as LockBusyError too.
  try {
    await fs.unlink(lockPath);
  } catch (err) {
    // Race: someone else unlinked between our read and unlink. Continue
    // to the retry; if it succeeds the race resolved in our favour.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  try {
    const handle = await fs.open(lockPath, 'wx');
    try {
      await handle.write(payloadStr, 0, 'utf-8');
      await handle.datasync();
    } finally {
      await handle.close();
    }
    return { path: lockPath };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Another writer landed during our recover window. Re-read holder for
      // the diagnostic; if still dead, give up rather than loop.
      let raceHolder: LockPayload | undefined;
      try {
        const raw = await fs.readFile(lockPath, 'utf-8');
        raceHolder = JSON.parse(raw) as LockPayload;
      } catch {
        raceHolder = undefined;
      }
      throw new LockBusyError(
        modelDir,
        raceHolder?.pid ?? -1,
        raceHolder?.acquiredAt ?? 'unknown',
      );
    }
    throw err;
  }
}

/**
 * Release the lock. Idempotent — releasing an already-released handle is a
 * no-op. Releases happen in `finally` blocks so a thrown caller never
 * leaves the lock in place.
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
  const fs = await loadFs();
  try {
    await fs.unlink(handle.path);
  } catch (err) {
    // ENOENT is fine — already released or never existed.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Run `fn` while holding the lock for `modelDir`. The lock is acquired
 * before `fn` runs and released after `fn` resolves or throws. Convenience
 * wrapper — callers that prefer explicit acquire/release can use
 * {@link acquireLock} + {@link releaseLock} directly.
 */
export async function withLock<T>(modelDir: string, fn: () => Promise<T>): Promise<T> {
  const handle = await acquireLock(modelDir);
  try {
    return await fn();
  } finally {
    await releaseLock(handle);
  }
}

/** Resolve the absolute lock-file path. Exposed for tests + diagnostics. */
export function getLockPath(modelDir: string): string {
  return join(modelDir, LOCK_RELATIVE_PATH);
}
