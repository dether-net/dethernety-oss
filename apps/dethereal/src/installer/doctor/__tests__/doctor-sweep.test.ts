/**
 * The doctor tests' sweep: a folder a killed run left in the package is removed at the next run, its
 * read-only folders unlocked first; a live run's folder is left alone.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sweepStale } from './doctor-harness.js'

const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-doctor-sweep-'))
afterAll(async () => {
  await fs.rm(parent, { recursive: true, force: true })
})

/** A run's folder as the suite leaves it: a home whose runtime is installed read-only. */
async function run(name: string, owner: number | null): Promise<string> {
  const dir = path.join(parent, name)
  const runtime = path.join(dir, 'h0', '.dethernety', 'runtime', 'v', 'dist')
  await fs.mkdir(runtime, { recursive: true })
  await fs.writeFile(path.join(runtime, 'index.js'), '')
  if (owner !== null) await fs.writeFile(path.join(dir, 'owner.pid'), `${owner}\n`)
  for (const d of [runtime, path.dirname(runtime)]) await fs.chmod(d, 0o500)
  return dir
}

describe('doctor test sweep', () => {
  it('removes a run whose process is gone, read-only folders and all, and keeps a live one', async () => {
    // A process that has exited: its pid names no live process.
    const gone = spawnSync(process.execPath, ['-e', '0']).pid!
    const killed = await run('.test-doctor-killed', gone)
    const live = await run('.test-doctor-live', process.pid)
    const fresh = await run('.test-doctor-fresh', null)
    const old = await run('.test-doctor-old', null)
    const hourAgo = new Date(Date.now() - 2 * 3_600_000)
    await fs.utimes(old, hourAgo, hourAgo)
    const other = await run('.test-gates-other', gone)

    await sweepStale(parent)
    expect(existsSync(killed)).toBe(false)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(live)).toBe(true)
    // No owner yet, and touched within the hour: a run that has only just started.
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(other)).toBe(true)
    for (const d of [live, fresh, other]) {
      for (const f of [path.join(d, 'h0', '.dethernety', 'runtime', 'v'), path.join(d, 'h0', '.dethernety', 'runtime', 'v', 'dist')]) await fs.chmod(f, 0o700)
    }
  })
})
