import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireFileLock, withFileLock, LockBusyError, LockLostError } from '../file-lock.js'
import { buildWorker, deadPid, holdLock, removeWorker, runWorker } from './fixtures/worker-harness.js'

const HOST = os.hostname()
const BOOT = Math.round(Date.now() / 1000 - os.uptime())

function payload(fields: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, pid: 1, nonce: randomBytes(16).toString('hex'), host: HOST, boot: BOOT, ...fields })
}

/** Places a lock file the way a writer would (link, never overwrite). */
async function plant(target: string, content: string, mtime?: Date): Promise<boolean> {
  const tmp = `${target}.plant.${randomBytes(4).toString('hex')}`
  await fs.writeFile(tmp, content)
  if (mtime) await fs.utimes(tmp, mtime, mtime)
  try {
    await fs.link(tmp, target)
    return true
  } catch {
    return false
  } finally {
    await fs.unlink(tmp)
  }
}

const OLD = new Date(Date.now() - 3600_000)

describe('file-lock', () => {
  let worker: string
  let dir: string
  let lock: string

  beforeAll(async () => {
    worker = await buildWorker()
  }, 120_000)
  afterAll(() => removeWorker(worker))

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-lock-'))
    lock = path.join(dir, 'state.lock')
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('acquires, fences and releases', async () => {
    const h = await acquireFileLock(lock)
    await expect(h.assertHeld()).resolves.toBeUndefined()
    await h.release()
    expect(existsSync(lock)).toBe(false)
    await expect(h.assertHeld()).rejects.toBeInstanceOf(LockLostError)
  })

  it('never lets two processes hold the lock at once, with stale locks injected', async () => {
    const log = path.join(dir, 'log')
    const pid = await deadPid()
    let running = true
    const injector = (async () => {
      while (running) {
        await plant(lock, payload({ pid }))
        await new Promise((r) => setTimeout(r, 5))
      }
    })()
    const results = await Promise.all([0, 1, 2, 3].map(() => runWorker(worker, ['stress', lock, log, '40'])))
    running = false
    await injector
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0])

    const lines = readFileSync(log, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(4 * 40 * 2)
    for (let i = 0; i < lines.length; i += 2) {
      const [enter, a] = lines[i]!.split(' ')
      const [exit, b] = lines[i + 1]!.split(' ')
      expect(`${enter}/${exit}`).toBe('enter/exit')
      expect(b).toBe(a)
    }
  }, 120_000)

  it('never overlaps two holders in one process', async () => {
    const events: string[] = []
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withFileLock(lock, async () => {
          events.push(`in${i}`)
          await new Promise((r) => setTimeout(r, 2))
          events.push(`out${i}`)
        }),
      ),
    )
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]!.replace('in', '')).toBe(events[i + 1]!.replace('out', ''))
    }
  })

  it('takes over a lock whose holder is dead', async () => {
    await plant(lock, payload({ pid: await deadPid() }))
    const h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })

  it.each([
    ['a bare pid 1', JSON.stringify({ pid: 1 })],
    ['pid 0', payload({ pid: 0 })],
    ['pid -1', payload({ pid: -1 })],
    ['a string pid', payload({ pid: '1' })],
    ['a huge pid', payload({ pid: 2 ** 40 })],
    ['another boot', payload({ pid: process.ppid, boot: BOOT - 3600 })],
    ['garbage', 'not json at all'],
  ])('takes over a committed lock with %s', async (_label, content) => {
    await plant(lock, content)
    const h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })

  it('waits on a fresh lock from another host, and takes over an old one', async () => {
    await plant(lock, payload({ pid: process.ppid, host: 'another-host' }))
    await expect(acquireFileLock(lock, { waitMs: 300 })).rejects.toBeInstanceOf(LockBusyError)
    await fs.unlink(lock)
    await plant(lock, payload({ pid: process.ppid, host: 'another-host' }), OLD)
    const h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })

  it('takes over a lock from another host whose modification time is in the future', async () => {
    const future = new Date(Date.now() + 3600_000)
    await plant(lock, payload({ pid: process.ppid, host: 'another-host' }), future)
    const h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })

  it('takes over a same-host lock whose modification time is far in the future', async () => {
    await plant(lock, payload({ pid: 1 }), new Date(Date.now() + 3600_000))
    const h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })

  it('respects a live holder in another process', async () => {
    const holder = await holdLock(worker, lock, 3000)
    try {
      const err = await acquireFileLock(lock, { waitMs: 300, label: '.dethereal/state.lock' }).catch((e) => e)
      expect(err).toBeInstanceOf(LockBusyError)
      expect(err.code).toBe('busy')
      expect(err.message).toContain('.dethereal/state.lock')
      expect(err.message).not.toContain(dir)
      expect(err.message).not.toMatch(/delete|remove|rm /i)
    } finally {
      holder.kill()
    }
  })

  it('respects pid 1 on this host and boot (containers run as pid 1)', async () => {
    await plant(lock, payload({ pid: 1 }))
    await expect(acquireFileLock(lock, { waitMs: 300 })).rejects.toBeInstanceOf(LockBusyError)
  })

  it('breaks a live holder only past maxHoldMs', async () => {
    const holder = await holdLock(worker, lock, 5000)
    try {
      await new Promise((r) => setTimeout(r, 250))
      const h = await acquireFileLock(lock, { waitMs: 2000, maxHoldMs: 200 })
      await h.release()
    } finally {
      holder.kill()
    }
  })

  it('clears an abandoned break claim beside a dead lock', async () => {
    const pid = await deadPid()
    await plant(lock, payload({ pid }))
    await plant(`${lock}.breaking`, payload({ pid }))
    const h = await acquireFileLock(lock, { waitMs: 2000 })
    await h.release()
    expect(existsSync(`${lock}.breaking`)).toBe(false)
  })

  it('waits on a live breaker', async () => {
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' })
    try {
      await plant(lock, payload({ pid: await deadPid() }))
      await plant(`${lock}.breaking`, payload({ pid: sleeper.pid }))
      await expect(acquireFileLock(lock, { waitMs: 300 })).rejects.toBeInstanceOf(LockBusyError)
    } finally {
      sleeper.kill()
    }
  })

  it('treats a lock left by an earlier call of this process as stale', async () => {
    await plant(lock, payload({ pid: process.pid }))
    const h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })

  it('does not remove a lock it no longer holds', async () => {
    const h = await acquireFileLock(lock)
    await fs.unlink(lock)
    const foreign = payload({ pid: process.ppid })
    await plant(lock, foreign)
    await expect(h.assertHeld()).rejects.toBeInstanceOf(LockLostError)
    await h.release()
    expect(readFileSync(lock, 'utf8')).toBe(foreign)
  })

  it('clears a symlink at the lock path without touching its target', async () => {
    const target = path.join(dir, 'target.json')
    await fs.writeFile(target, 'untouched')
    await fs.symlink(target, lock)
    await fs.symlink(target, `${lock}.breaking`)
    const h = await acquireFileLock(lock, { waitMs: 2000 })
    expect((await fs.lstat(lock)).isFile()).toBe(true)
    await h.release()
    expect(readFileSync(target, 'utf8')).toBe('untouched')
  })

  it('clears a dangling symlink and an oversized file at the lock path', async () => {
    await fs.symlink(path.join(dir, 'nowhere'), lock)
    let h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
    await fs.writeFile(path.join(dir, 'big'), Buffer.alloc(5 * 1024 * 1024, 120))
    await fs.link(path.join(dir, 'big'), lock)
    h = await acquireFileLock(lock, { waitMs: 1000 })
    await h.release()
  })
})
