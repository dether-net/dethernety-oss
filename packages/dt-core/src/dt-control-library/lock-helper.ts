/**
 * File-based advisory lock for control-library writes.
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
 * **Implementation:** the payload (PID + timestamp + a random **nonce**) is
 * written to a private tmp file, then hard-linked into place at
 * `.dethereal/.control-library.lock`. `fs.link` is atomic and fails EEXIST if
 * the target exists, and the linked lock file is never empty — so a concurrent
 * acquirer can never read a half-written lock and mistake a live holder for a
 * corrupt/stale one. On EEXIST we read the holder and signal-zero
 * (`process.kill(pid, 0)`) it; a live holder is refused.
 *
 * **Stale-lock breaking** upholds one invariant: *a live holder's lock is never
 * moved, renamed, or overwritten on any path.* (An earlier rename-aside design
 * could move a freshly re-acquired LIVE lock aside on a stale read and then
 * clobber-restore over a third acquirer — double-ownership.) A dead/corrupt
 * holder is instead broken under an exclusive BREAK CLAIM: the breaker
 * link-creates a claim file at a fixed path (`<lock>.breaking`) carrying its
 * OWN identity — `fs.link`'s EEXIST admits exactly one claimant. Under the
 * claim it re-reads the lock and proceeds only if the slot still bears the
 * exact stale payload it originally decided to break (nonce match); any change
 * means a live holder re-took the slot → yield, lock untouched. Only then is
 * the dead lock unlinked (safe under the claim: fresh acquirers get EEXIST off
 * the dead file, the dead holder cannot release, rival breakers are excluded)
 * and ours link-created. An abandoned claim (crashed breaker) is detected by
 * claimant-PID liveness, cleaned up, and the acquire yields — the NEXT call
 * finds a clean slate; we never continue under a possibly-recreated claim.
 * The nonce is the ownership arbiter:
 * `releaseLock` removes the lock only if the on-disk nonce still matches the
 * handle's, so a process whose lock was broken never deletes the current
 * holder's lock.
 *
 * **Bundle safety:** like wal-helper.ts and audit-log-writer.ts, `node:fs/promises`
 * is lazy-loaded so this module can be re-exported through the
 * `@dethernety/dt-core` barrel without dragging Node-only APIs into the
 * studio frontend bundle.
 *
 * **Liveness.** A holder is judged by identity. The payload carries the
 * holder's host and boot (as the plugin's cross-process file lock does):
 *   - our host and our boot (within a minute) → live while its pid is alive,
 *     with no age limit (writes are not fenced, so a slow or suspended holder
 *     must never be broken); our own pid is live only with a nonce this
 *     process holds (a release that failed leaves a stale lock, not a stuck one);
 *   - another host, another boot, or no identity at all → stale. A lock
 *     committed to a repository (`{"pid":1}`) never blocks anyone.
 *   - a payload from an older version (a pid and a timestamp, no host or boot)
 *     → live only while its pid is alive and its timestamp is recent (at most
 *     10 minutes old, at most a minute ahead).
 * The break claim is judged the same way.
 *
 * **Not protected:** crashes mid-transaction leave a stale lock file. The
 * stale-lock recovery (PID-alive check) handles this on the next acquire.
 * Worst case: a process whose PID was recycled to a still-alive unrelated
 * PID would falsely report the lock as held — operator must manually
 * unlink. Another host sharing the model directory (a network mount, a
 * container and its host) is always judged stale: two hosts can break each
 * other's live locks. A second exotic residual: cleaning an ABANDONED claim is a
 * read-then-unlink, so a fresh claim landing in that syscall-wide gap could
 * be wrongly removed — it requires a crashed breaker PLUS two more racers
 * interleaving within microseconds, and the cleanup path always yields
 * (never proceeds to break), so no one continues under a stolen claim.
 * Acceptable trade-offs for a dev workflow tool.
 */

import { ensureRealDirs, readLeafNoFollow } from './wal-helper.js';

/** A lock payload is a few dozen bytes. */
const MAX_LOCK_BYTES = 4096;

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
  /** The holder's host name; absent in locks written by older versions. */
  host?: string;
  /** The holder's boot time (seconds since the epoch); absent in older locks. */
  boot?: number;
  /** Per-acquisition random token — the ownership arbiter. Distinguishes a lock
   *  WE hold from one another process re-created after breaking ours, so a
   *  broken loser never removes the current holder's lock, and two racers
   *  breaking the same stale lock resolve to a single winner. */
  nonce: string;
}

export interface LockHandle {
  /** Absolute path to the lock file. Mostly for diagnostics. */
  readonly path: string;
  /** The nonce we wrote when acquiring — checked on release so we only ever
   *  remove a lock we still own. */
  readonly nonce: string;
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
/** A boot time computed at different moments drifts with clock steps; within this, it is the same boot. */
const BOOT_TOLERANCE_S = 60;
/** An older-version lock (no host or boot) counts as live only this long after it was taken. */
const LEGACY_MAX_AGE_MS = 10 * 60 * 1000;
const LEGACY_MAX_SKEW_MS = 60 * 1000;

/** Nonces of locks this process holds. */
const heldNonces = new Set<string>();

let identity: { host: string; boot: number } | undefined;
async function localIdentity(): Promise<{ host: string; boot: number }> {
  if (!identity) {
    const os = await import('node:os');
    identity = { host: os.hostname(), boot: Math.round(Date.now() / 1000 - os.uptime()) };
  }
  return identity;
}

/** Whether `holder` (a lock or a break claim) belongs to a process that may still be using it. */
async function isLive(holder: LockPayload | undefined): Promise<boolean> {
  if (!holder || typeof holder !== 'object' || !Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  const ours = () => typeof holder.nonce === 'string' && heldNonces.has(holder.nonce);
  if (holder.host !== undefined || holder.boot !== undefined) {
    const me = await localIdentity();
    if (holder.host !== me.host || typeof holder.boot !== 'number' || Math.abs(holder.boot - me.boot) > BOOT_TOLERANCE_S) {
      return false;
    }
    return holder.pid === process.pid ? ours() : isPidAlive(holder.pid);
  }
  const at = typeof holder.acquiredAt === 'string' ? Date.parse(holder.acquiredAt) : NaN;
  if (!Number.isFinite(at) || Date.now() - at > LEGACY_MAX_AGE_MS || at - Date.now() > LEGACY_MAX_SKEW_MS) return false;
  return holder.pid === process.pid ? ours() : isPidAlive(holder.pid);
}

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
  // Never create the lock through a linked `.dethereal/`.
  await ensureRealDirs(modelDir, dirname(LOCK_RELATIVE_PATH));

  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const { host, boot } = await localIdentity();
  const payload: LockPayload = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    nonce,
    host,
    boot,
  };
  const payloadStr = JSON.stringify(payload);

  // Atomically create a file at `target` WITH our payload already in place:
  // write the payload to a private tmp, then hard-link it to the target.
  // `fs.link` is atomic and fails EEXIST if the target exists, and the linked
  // file is never empty — so a concurrent reader can never observe a
  // half-written (empty) lock/claim and wrongly treat a live holder as
  // corrupt/stale (the old open('wx')-then-write left exactly that window).
  // Returns true iff we created the target.
  const placeOurPayload = async (target: string): Promise<boolean> => {
    const tmpPath = `${target}.tmp.${nonce}`;
    await fs.writeFile(tmpPath, payloadStr);
    try {
      await fs.link(tmpPath, target);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  };

  const readHolder = async (path = lockPath): Promise<LockPayload | undefined> => {
    try {
      // No-follow and non-blocking: a lock committed as a link to a FIFO or
      // `/dev/stdin` reads as corrupt, and is broken by unlinking the link itself.
      const raw = await readLeafNoFollow(path, LOCK_RELATIVE_PATH, MAX_LOCK_BYTES);
      return raw === null ? undefined : (JSON.parse(raw) as LockPayload);
    } catch {
      // Absent, unreadable, or corrupt. With atomic-link creation a lock is
      // never mid-write, so "unparseable" now means genuinely corrupt, not a
      // live holder caught between open and write.
      return undefined;
    }
  };

  // First attempt — exclusive create-with-content.
  if (await placeOurPayload(lockPath)) {
    heldNonces.add(nonce);
    return { path: lockPath, nonce };
  }

  // EEXIST — inspect the holder. A live PID owns it: refuse.
  const holder = await readHolder();
  if (holder && (await isLive(holder))) {
    throw new LockBusyError(modelDir, holder.pid, holder.acquiredAt);
  }

  // Stale (dead PID) or corrupt. Break it under an exclusive BREAK CLAIM at a
  // fixed path, holding OUR identity — `fs.link`'s EEXIST admits exactly one
  // claimant, so rival breakers are serialised without ever touching the lock
  // slot itself. The invariant: a live holder's lock is never moved, renamed,
  // or overwritten on any path below.
  const claimPath = `${lockPath}.breaking`;
  if (!(await placeOurPayload(claimPath))) {
    // Another breaker holds the claim. A live claimant means a break is
    // genuinely in progress — yield to it. A dead/corrupt claimant is an
    // abandoned claim from a crashed breaker: clean it up (best-effort) and
    // STILL yield — continuing under a claim we just contested is exactly the
    // stolen-claim race we refuse to run. The next acquireLock call finds a
    // clean slate and breaks normally.
    const claimant = await readHolder(claimPath);
    if (claimant && (await isLive(claimant))) {
      throw new LockBusyError(modelDir, claimant.pid, claimant.acquiredAt);
    }
    await fs.unlink(claimPath).catch(() => {});
    throw new LockBusyError(modelDir, holder?.pid ?? -1, holder?.acquiredAt ?? 'unknown');
  }

  try {
    // Under the claim, re-verify the slot still bears the EXACT stale payload
    // we decided to break (nonce match; corrupt matches corrupt — nothing
    // creates corrupt locks, since creation is atomic-link-with-content, and
    // rival breakers are excluded by the claim). Any change means the slot was
    // released and re-taken by a live holder between our read and our claim —
    // yield without touching it.
    const current = await readHolder();
    if (current?.nonce !== holder?.nonce) {
      throw new LockBusyError(modelDir, current?.pid ?? -1, current?.acquiredAt ?? 'unknown');
    }
    // Same dead/corrupt lock — remove it. Safe while the claim is held: a
    // fresh acquirer cannot replace it (its link fails EEXIST off the dead
    // file), the dead holder cannot release it, rival breakers are excluded.
    await fs.unlink(lockPath).catch(() => {});
    // Take the freed slot. A fresh acquirer that slips in between the unlink
    // and our link legitimately wins; yield to it.
    if (await placeOurPayload(lockPath)) {
      // Defense-in-depth: confirm our nonce actually landed.
      const confirmed = await readHolder();
      if (confirmed?.nonce === nonce) {
        heldNonces.add(nonce);
        return { path: lockPath, nonce };
      }
    }
    const raceHolder = await readHolder();
    throw new LockBusyError(modelDir, raceHolder?.pid ?? -1, raceHolder?.acquiredAt ?? 'unknown');
  } finally {
    await fs.unlink(claimPath).catch(() => {});
  }
}

/**
 * Release the lock. Idempotent — releasing an already-released handle is a
 * no-op. Releases happen in `finally` blocks so a thrown caller never
 * leaves the lock in place.
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
  const fs = await loadFs();
  heldNonces.delete(handle.nonce);
  // Ownership check: only remove the lock if WE still hold it. If our lock was
  // broken as stale and another process legitimately re-acquired, its nonce
  // differs — unlinking it would remove the current holder's lock and cascade
  // the breach (the old unconditional unlink-by-path did exactly that).
  try {
    const raw = await readLeafNoFollow(handle.path, LOCK_RELATIVE_PATH, MAX_LOCK_BYTES);
    if (raw === null) return;
    const holder = JSON.parse(raw) as LockPayload;
    if (holder.nonce !== handle.nonce) return; // not ours anymore — leave it
  } catch {
    // ENOENT → already released (idempotent). Corrupt/unreadable → not
    // confidently ours; leave it for the stale-break path rather than risk
    // removing a foreign lock.
    return;
  }
  try {
    await fs.unlink(handle.path);
  } catch (err) {
    // ENOENT is fine — already released between our read and unlink.
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
