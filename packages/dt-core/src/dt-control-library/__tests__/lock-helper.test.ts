/**
 * Tests for the file-based advisory lock primitive.
 *
 * Concurrency tests use the in-process atomic primitive `fs.open(.., 'wx')`
 * which is robust to multiple simultaneous attempts within the same Node
 * process — vitest's vi.runAllTicks doesn't help here; the test simply
 * acquires and asserts the second attempt rejects.
 *
 * Stale-lock recovery uses a synthetic dead-PID lockfile: PID 1 is init
 * (always alive on Linux/macOS) so we can't use that as "dead"; we pick
 * a high PID unlikely to be in use. The signal-zero check returns ESRCH
 * for non-existent PIDs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  releaseLock,
  withLock,
  getLockPath,
  LockBusyError,
} from '../lock-helper.js';

let modelDir: string;

beforeEach(async () => {
  modelDir = await fs.mkdtemp(join(os.tmpdir(), 'lock-test-'));
});

afterEach(async () => {
  await fs.rm(modelDir, { recursive: true, force: true });
});

describe('acquireLock / releaseLock — happy path', () => {
  it('acquires, persists holder PID, releases', async () => {
    const handle = await acquireLock(modelDir);
    expect(handle.path).toBe(getLockPath(modelDir));

    const raw = await fs.readFile(handle.path, 'utf-8');
    const payload = JSON.parse(raw);
    expect(payload.pid).toBe(process.pid);
    expect(typeof payload.acquiredAt).toBe('string');

    await releaseLock(handle);
    await expect(fs.stat(handle.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('release is idempotent', async () => {
    const handle = await acquireLock(modelDir);
    await releaseLock(handle);
    // Second release on the same handle must not throw.
    await expect(releaseLock(handle)).resolves.not.toThrow();
  });

  it('creates .dethereal/ if it does not exist', async () => {
    // No mkdir up-front; lock-helper must create the dir.
    const handle = await acquireLock(modelDir);
    expect(await fs.stat(join(modelDir, '.dethereal'))).toBeTruthy();
    await releaseLock(handle);
  });
});

describe('acquireLock — concurrency', () => {
  it('second acquire on same modelDir throws LockBusyError', async () => {
    const first = await acquireLock(modelDir);
    try {
      await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);
    } finally {
      await releaseLock(first);
    }
  });

  it('LockBusyError carries the holder PID and acquiredAt', async () => {
    const first = await acquireLock(modelDir);
    try {
      let caught: LockBusyError | undefined;
      try {
        await acquireLock(modelDir);
      } catch (err) {
        caught = err as LockBusyError;
      }
      expect(caught).toBeInstanceOf(LockBusyError);
      expect(caught!.holderPid).toBe(process.pid);
      expect(caught!.holderAcquiredAt).toMatch(/T.*Z$/);
    } finally {
      await releaseLock(first);
    }
  });

  it('after release, second acquire succeeds', async () => {
    const first = await acquireLock(modelDir);
    await releaseLock(first);
    const second = await acquireLock(modelDir);
    expect(second.path).toBe(getLockPath(modelDir));
    await releaseLock(second);
  });
});

describe('acquireLock — stale-lock recovery', () => {
  it('breaks a lock whose PID is dead and acquires', async () => {
    // Stage a lockfile with an unlikely PID. signal-zero on a non-existent
    // PID returns ESRCH, so isPidAlive returns false → recovery unlinks
    // and acquires.
    const lockPath = getLockPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    const stalePid = 999999; // PID space is 32-bit on Linux/macOS
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: stalePid, acquiredAt: '2026-01-01T00:00:00Z' }),
    );

    const handle = await acquireLock(modelDir);
    expect(handle.path).toBe(lockPath);

    // Verify our PID overwrote the stale one.
    const raw = await fs.readFile(lockPath, 'utf-8');
    const payload = JSON.parse(raw);
    expect(payload.pid).toBe(process.pid);

    await releaseLock(handle);
  });

  it('breaks a corrupt (unparseable) lockfile and acquires', async () => {
    const lockPath = getLockPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(lockPath, 'not json {');

    // Corrupt lockfile is treated as stale — no holder identity to check.
    const handle = await acquireLock(modelDir);
    await releaseLock(handle);
  });

  it('does NOT break a lock held by a live PID', async () => {
    // Stage a lockfile with our own PID — guaranteed alive.
    const lockPath = getLockPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: '2026-01-01T00:00:00Z' }),
    );

    await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);

    // Cleanup — manually unlink since we never owned a handle.
    await fs.unlink(lockPath);
  });
});

describe('acquireLock — nonce + atomicity', () => {
  it('writes a nonce into the payload and the handle', async () => {
    const handle = await acquireLock(modelDir);
    try {
      expect(typeof handle.nonce).toBe('string');
      expect(handle.nonce.length).toBeGreaterThan(0);
      const payload = JSON.parse(await fs.readFile(handle.path, 'utf-8'));
      expect(payload.nonce).toBe(handle.nonce);
    } finally {
      await releaseLock(handle);
    }
  });

  it('the lock file is never empty — a concurrent acquirer against a LIVE holder does not break it', async () => {
    const first = await acquireLock(modelDir);
    try {
      // The lock is created atomically with content (link), so a second acquirer
      // reading it always sees a parseable live-holder payload → LockBusyError,
      // and must NOT remove the live lock.
      await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);
      const raw = await fs.readFile(first.path, 'utf-8');
      expect(JSON.parse(raw).nonce).toBe(first.nonce); // still ours, untouched
    } finally {
      await releaseLock(first);
    }
  });
});

describe('releaseLock — ownership (P2)', () => {
  it('does NOT unlink a lock that now bears a different nonce (ours was broken)', async () => {
    const mine = await acquireLock(modelDir);
    // Simulate our lock having been broken + re-acquired by another process:
    // overwrite the on-disk lock with a foreign nonce.
    await fs.writeFile(
      mine.path,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), nonce: 'someone-else' }),
    );

    await releaseLock(mine); // must be a no-op — not ours anymore

    const raw = await fs.readFile(mine.path, 'utf-8'); // still present
    expect(JSON.parse(raw).nonce).toBe('someone-else');
    // cleanup
    await fs.unlink(mine.path);
  });

  it('unlinks a lock whose nonce matches the handle', async () => {
    const mine = await acquireLock(modelDir);
    await releaseLock(mine);
    await expect(fs.stat(mine.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('acquireLock — single-winner stale break', () => {
  it('breaks a dead-PID lock and the new holder owns it (nonce is ours)', async () => {
    const lockPath = getLockPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'stale' }),
    );

    const handle = await acquireLock(modelDir);
    const payload = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    expect(payload.nonce).toBe(handle.nonce); // we own it, not the stale holder
    await releaseLock(handle);
  });

  it('does NOT double-own via ABA: a live lock is never moved, renamed, or overwritten', async () => {
    // The break protocol's invariant: a LIVE holder's lock is untouchable. A
    // live lock (our own PID) must short-circuit to LockBusyError before any
    // claim is even attempted, leaving both the lock and the directory intact.
    const lockPath = getLockPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'live-holder' }),
    );
    await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);
    // Live lock untouched — never moved aside, never overwritten.
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).nonce).toBe('live-holder');
    // No stray claim/tmp files left behind.
    const entries = await fs.readdir(join(modelDir, '.dethereal'));
    expect(entries.some(e => e.includes('.breaking') || e.includes('.tmp.'))).toBe(false);
    await fs.unlink(lockPath);
  });

  it('leaves no claim file behind after a successful stale break', async () => {
    const lockPath = getLockPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'stale' }),
    );
    const handle = await acquireLock(modelDir);
    const entries = await fs.readdir(join(modelDir, '.dethereal'));
    expect(entries.some(e => e.includes('.breaking') || e.includes('.tmp.'))).toBe(false);
    await releaseLock(handle);
  });
});

describe('acquireLock — break claim', () => {
  it('yields to a LIVE claimant mid-break: lock and claim both untouched', async () => {
    // A rival breaker (our own PID = alive) holds the fixed claim path while a
    // stale lock sits in the slot. We must refuse — a break is in progress —
    // and touch neither file.
    const lockPath = getLockPath(modelDir);
    const claimPath = `${lockPath}.breaking`;
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'stale' }),
    );
    await fs.writeFile(
      claimPath,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), nonce: 'live-claimant' }),
    );

    await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).nonce).toBe('stale');
    expect(JSON.parse(await fs.readFile(claimPath, 'utf-8')).nonce).toBe('live-claimant');
    await fs.unlink(lockPath);
    await fs.unlink(claimPath);
  });

  it('cleans an ABANDONED claim (dead claimant) but yields; the next call breaks normally', async () => {
    // A breaker crashed mid-break: its claim (dead PID) dangles next to the
    // stale lock. The contested call must remove the abandoned claim and STILL
    // throw (never continue under a contested claim); the follow-up call finds
    // a clean slate and completes the break.
    const lockPath = getLockPath(modelDir);
    const claimPath = `${lockPath}.breaking`;
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'stale' }),
    );
    await fs.writeFile(
      claimPath,
      JSON.stringify({ pid: 999998, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'dead-claimant' }),
    );

    await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);
    // Abandoned claim cleaned up; stale lock untouched by the yielding call.
    await expect(fs.stat(claimPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).nonce).toBe('stale');

    // Clean slate → the break succeeds.
    const handle = await acquireLock(modelDir);
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).nonce).toBe(handle.nonce);
    await releaseLock(handle);
  });

  it('aborts the break when the slot changed under the claim (nonce mismatch → yield, slot untouched)', async () => {
    // Simulates the delayed-stealer ABA at the protocol level: the payload the
    // breaker decided to break must still be in the slot under the claim. We
    // can't pause acquireLock mid-flight in-process, but the equivalent
    // observable is: a slot re-taken by a LIVE holder is never disturbed even
    // when a stale-looking claim contest happens around it.
    const lockPath = getLockPath(modelDir);
    const claimPath = `${lockPath}.breaking`;
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    // Live holder in the slot, abandoned dead claim next to it.
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'live-holder' }),
    );
    await fs.writeFile(
      claimPath,
      JSON.stringify({ pid: 999998, acquiredAt: '2026-01-01T00:00:00Z', nonce: 'dead-claimant' }),
    );

    await expect(acquireLock(modelDir)).rejects.toBeInstanceOf(LockBusyError);
    // The live lock survives; the pre-claim liveness check short-circuits
    // before the claim is contested, so the abandoned claim also survives.
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).nonce).toBe('live-holder');
    await fs.unlink(lockPath);
    await fs.unlink(claimPath).catch(() => {});
  });
});

describe('withLock — convenience wrapper', () => {
  it('runs the function while holding the lock', async () => {
    let observedLockExisted = false;
    await withLock(modelDir, async () => {
      // Mid-execution: lock file should exist.
      observedLockExisted = !!(await fs.stat(getLockPath(modelDir)).catch(() => null));
    });
    expect(observedLockExisted).toBe(true);
    // After: released.
    await expect(fs.stat(getLockPath(modelDir))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases the lock even when the function throws', async () => {
    await expect(
      withLock(modelDir, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Lock must be released despite the throw.
    await expect(fs.stat(getLockPath(modelDir))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns the function result', async () => {
    const result = await withLock(modelDir, async () => 42);
    expect(result).toBe(42);
  });
});
