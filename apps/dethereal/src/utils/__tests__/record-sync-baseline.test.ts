/**
 * Writing sync.json with a pull's or push's platform record: when the write fails,
 * an old record must not stay behind unannounced, because the next push would read
 * this sync's own changes as the platform's. It is removed; when even that fails,
 * the warning says the old record was kept, and what that means.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { failures } = vi.hoisted(() => ({ failures: { left: 0 } }))

vi.mock('../sync-utils.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../sync-utils.js')
  return {
    ...actual,
    writeSyncJson: async (...args: Parameters<typeof actual.writeSyncJson>) => {
      if (failures.left > 0) {
        failures.left--
        throw new Error('EACCES')
      }
      return actual.writeSyncJson(...args)
    },
  }
})

const { recordSyncBaseline, baselineForSync, fingerprintSplitModel, loadPlatformBaseline } = await import('../platform-baseline.js')
const { readSyncJson, writeSyncJson } = await import('../sync-utils.js')
const { initProjectRoot, resetProjectRoot } = await import('../project-root.js')
const { richExport } = await import('../../tools/__tests__/fixtures/platform-export.js')

describe('recordSyncBaseline', () => {
  let tmp: string
  let dir: string
  const savedHome = process.env.HOME

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-record-sync-')))
    const project = path.join(tmp, 'project')
    dir = path.join(project, 'model')
    fs.mkdirSync(path.join(dir, '.dethereal'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
    failures.left = 0
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const fresh = () => baselineForSync(dir, 'm-1', fingerprintSplitModel(richExport()))
  const withOldRecord = async () => {
    const old = await fresh()
    await writeSyncJson(dir, { platform_model_id: 'm-1', platform_url: 'x', platform_baseline: old.record })
    expect((await loadPlatformBaseline(dir, 'm-1')).state).toBe('verified')
  }

  it('records the baseline with the other fields', async () => {
    const r = await recordSyncBaseline(dir, { platform_model_id: 'm-1', last_push_at: 'now' }, await fresh(), 'push')
    expect(r).toEqual({ status: 'recorded' })
    expect((await readSyncJson(dir))?.last_push_at).toBe('now')
    expect((await loadPlatformBaseline(dir, 'm-1')).state).toBe('verified')
  })

  it('removes the old record when the write fails, and says the next push treats everything as changed', async () => {
    await withOldRecord()
    failures.left = 1
    const r = await recordSyncBaseline(dir, { last_push_at: 'now' }, await fresh(), 'push')
    expect(r.status).toBe('not_recorded')
    expect(r.warning).toMatch(/not recorded \(unwritable\): the next push treats every element as changed/)
    expect((await readSyncJson(dir))?.platform_baseline).toBeUndefined()
  })

  it.each([
    ['push', /from before this push was kept, so the next push lists this push's own changes as platform changes/],
    ['pull', /from before this pull was kept, so the next push lists the changes this pull brought in as platform changes/],
  ] as const)('says the old record was kept when it cannot be removed either (%s)', async (after, message) => {
    await withOldRecord()
    failures.left = 2
    const r = await recordSyncBaseline(dir, {}, await fresh(), after)
    expect(r).toMatchObject({ status: 'not_recorded' })
    expect(r.warning).toMatch(message)
    expect((await loadPlatformBaseline(dir, 'm-1')).state).toBe('verified')
  })

  it('with no old record, a failed write just says nothing was recorded', async () => {
    failures.left = 2
    const r = await recordSyncBaseline(dir, {}, await fresh(), 'push')
    expect(r.warning).toMatch(/not recorded \(unwritable\)/)
  })

  it('every pull and push writes sync.json only through it', () => {
    const tools = path.join(__dirname, '..', '..', 'tools')
    for (const file of ['import-model.tool.ts', 'create-model.tool.ts', 'export-model.tool.ts', 'update-model.tool.ts', 'update-attributes.tool.ts']) {
      const src = fs.readFileSync(path.join(tools, file), 'utf8')
      expect(src, file).not.toMatch(/\bwriteSyncJson\s*\(/)
      expect(src, file).toMatch(/\brecordSyncBaseline\s*\(/)
    }
  })
})
