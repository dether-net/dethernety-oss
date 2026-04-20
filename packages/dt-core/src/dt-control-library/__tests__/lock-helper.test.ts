/**
 * Tests for the file-based advisory lock primitive (Sprint 4 F-03).
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
