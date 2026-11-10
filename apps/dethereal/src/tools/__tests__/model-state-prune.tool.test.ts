/**
 * model_state_prune: the attribute files of elements the model no longer has, deleted with the
 * operator's approval of the exact list. Registrations are not touched: the baseline is re-signed
 * with the same values, and the gone elements' values stay orphaned until settle acknowledges them.
 *
 * Every test runs with its own HOME, so this machine's key and pointer never carry over.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Hooks to act between the server's scan and its writes, and to fail the pointer update.
const hooks = vi.hoisted(() => ({ afterScan: null as null | (() => Promise<void>), pointerFails: false }))
vi.mock('../../utils/settlement-state.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/settlement-state.js')
  return {
    ...actual,
    settlementState: async (...args: Parameters<typeof actual.settlementState>) => {
      const st = await actual.settlementState(...args)
      if (hooks.afterScan) await hooks.afterScan()
      return st
    },
  }
})
vi.mock('../../utils/gates.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/gates.js')
  return {
    ...actual,
    updateBaselinePointers: async (...args: Parameters<typeof actual.updateBaselinePointers>) => {
      if (hooks.pointerFails) throw new Error('pointer write failed')
      return actual.updateBaselinePointers(...args)
    },
  }
})

const { modelStateTool } = await import('../model-state.tool.js')
const { modelStateSettleTool } = await import('../model-state-settle.tool.js')
const { modelStatePruneTool } = await import('../model-state-prune.tool.js')
const { validateModelTool } = await import('../validate-model.tool.js')
const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
const { registerAll } = await import('./helpers/settle.js')

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-prune-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-prune-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  const h = path.join(homes, `h${seq++}`)
  await fs.mkdir(h)
  process.env.HOME = h
  hooks.afterScan = null
  hooks.pointerFails = false
  modelStatePruneTool.storeOptions = {}
})

const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir }, context)) as any).data
const prune = (dir: string, files: string[]) => modelStatePruneTool.run({ directory_path: dir, files }, context) as Promise<any>
const gates = async (dir: string) => ((await validateModelTool.run({ action: 'gates', directory_path: dir }, context)) as any).data
const baselineOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, '.dethereal', 'settlement-baseline.json'), 'utf8'))
const attr = (dir: string, group: string, id: string) => path.join(dir, 'attributes', group, `${id}.json`)

/** A registered model, then one component removed from the structure: its attribute file is orphaned. */
async function modelWithOrphan(): Promise<{ dir: string; gone: string }> {
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, gateModel())
  await registerAll(dir)
  const structure = JSON.parse(readFileSync(path.join(dir, 'structure.json'), 'utf8'))
  let gone = ''
  const walk = (b: any) => {
    if (!gone && Array.isArray(b?.components) && b.components.length) {
      const i = b.components.findIndex((c: any) => existsSync(attr(dir, 'components', c.id)))
      if (i >= 0) gone = b.components.splice(i, 1)[0].id
    }
    for (const n of b?.boundaries ?? []) walk(n)
  }
  walk(structure.defaultBoundary)
  await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure, null, 2))
  return { dir, gone }
}

describe('model_state_prune', () => {
  it('deletes exactly the orphaned files, logs them, and keeps the registered values byte for byte', async () => {
    const { dir, gone } = await modelWithOrphan()
    const rel = `attributes/components/${gone}.json`
    const before = baselineOf(dir)
    const orphanedBefore = (await get(dir)).orphaned_registrations.total
    expect(orphanedBefore).toBeGreaterThan(0)
    const live = (await fs.readdir(path.join(dir, 'attributes', 'components'))).filter((f) => f !== `${gone}.json`)

    const r = await prune(dir, [rel])
    expect(r.success, r.error).toBe(true)
    expect(r.data.deleted).toEqual([rel])
    expect(existsSync(attr(dir, 'components', gone))).toBe(false)
    expect((await fs.readdir(path.join(dir, 'attributes', 'components'))).sort()).toEqual(live.sort())

    const after = baselineOf(dir)
    expect(JSON.stringify(after.values)).toBe(JSON.stringify(before.values))
    expect(after.revision).toBe(before.revision + 1)
    expect(after.log_digest).not.toBe(before.log_digest)

    const state = await get(dir)
    expect(state.baseline).toBe('verified')
    expect(state.settlements_verified).toBe(true)
    expect(state.settlements_recent.at(-1)).toMatchObject({ action: 'prune', files: [rel], element_ids: [gone] })
    expect(state.settlements_recent.at(-1).reply).toBeUndefined()
    // The gone element's values stay orphaned until settle acknowledges them.
    expect(state.orphaned_registrations.total).toBe(orphanedBefore)
    const ack = await modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: 'Drop them.', items: [], orphaned_acknowledged: orphanedBefore } as never, context) as any
    // A call that only drops the orphaned registrations is a decision on its own.
    expect(ack.success, JSON.stringify(ack)).toBe(true)
    expect(ack.data).toMatchObject({ orphaned_dropped: orphanedBefore })
    expect((await get(dir)).orphaned_registrations.total).toBe(0)
    expect((await gates(dir)).gate2.checks.no_orphan_attribute_files.verdict).toBe('PASS')
  })

  it('refuses any list but the orphaned set, naming it, and changes nothing', async () => {
    const { dir, gone } = await modelWithOrphan()
    const before = readFileSync(path.join(dir, '.dethereal', 'settlement-baseline.json'))
    for (const files of [['attributes/components/c-web.json'], [`attributes/components/${gone}.json`, 'attributes/components/c-web.json']]) {
      const r = await prune(dir, files)
      expect(r.success, files.join()).toBe(false)
      expect(r.data.codes).toEqual(['files_differ'])
      expect(r.data.orphaned_files).toEqual([`attributes/components/${gone}.json`])
    }
    expect(existsSync(attr(dir, 'components', gone))).toBe(true)
    expect(readFileSync(path.join(dir, '.dethereal', 'settlement-baseline.json')).equals(before)).toBe(true)
  })

  it('lists and never deletes a file named for another id; a flat file blocks the call, named', async () => {
    const { dir, gone } = await modelWithOrphan()
    await fs.writeFile(attr(dir, 'components', 'renamed'), JSON.stringify({ elementId: 'other-id', attributes: {} }))
    const refused = await prune(dir, ['attributes/components/renamed.json'])
    expect(refused.data.codes).toEqual(['files_differ'])
    expect(refused.data.not_deleted.map((a: { file: string }) => a.file)).toEqual(['attributes/components/renamed.json'])
    const r = await prune(dir, [`attributes/components/${gone}.json`])
    expect(r.success, r.error).toBe(true)
    expect(existsSync(attr(dir, 'components', 'renamed'))).toBe(true)

    const other = await modelWithOrphan()
    await fs.writeFile(attr(other.dir, 'components', 'flat-gone'), JSON.stringify({ name: 'Old thing', some_attribute: 'x' }))
    const blocked = await prune(other.dir, [`attributes/components/${other.gone}.json`])
    expect(blocked.data.codes).toEqual(['attribute_issues'])
    expect(blocked.data.files).toEqual(['attributes/components/flat-gone.json'])
    expect(existsSync(attr(other.dir, 'components', other.gone))).toBe(true)
    expect(existsSync(attr(other.dir, 'components', 'flat-gone'))).toBe(true)
  })

  it('refuses a file changed after the scan, writing nothing', async () => {
    const { dir, gone } = await modelWithOrphan()
    const log = path.join(dir, '.dethereal', 'settlements.json')
    const logBefore = readFileSync(log)
    hooks.afterScan = async () => {
      hooks.afterScan = null
      await fs.writeFile(attr(dir, 'components', gone), JSON.stringify({ elementId: gone, attributes: { changed: true } }))
    }
    const r = await prune(dir, [`attributes/components/${gone}.json`])
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['changed'])
    expect(existsSync(attr(dir, 'components', gone))).toBe(true)
    expect(readFileSync(log).equals(logBefore)).toBe(true)
  })

  it('never follows or deletes a link: a symbolic or hard link at the name is refused, its target untouched', async () => {
    for (const kind of ['symlink', 'hardlink'] as const) {
      const { dir, gone } = await modelWithOrphan()
      const outside = path.join(root, `outside-${seq++}.json`)
      await fs.writeFile(outside, JSON.stringify({ elementId: gone, attributes: { keep: 'me' } }))
      await fs.rm(attr(dir, 'components', gone))
      if (kind === 'symlink') await fs.symlink(outside, attr(dir, 'components', gone))
      else await fs.link(outside, attr(dir, 'components', gone))
      const r = await prune(dir, [`attributes/components/${gone}.json`])
      expect(r.success, kind).toBe(false)
      expect(JSON.parse(readFileSync(outside, 'utf8')).attributes.keep).toBe('me')
    }
  })

  it('fails closed on a crash between the log and the baseline, and between the baseline and the deletes', async () => {
    // Log written, baseline not: the log no longer matches the signed digest.
    const a = await modelWithOrphan()
    modelStatePruneTool.storeOptions = { failAfterReplaces: 1 }
    expect((await prune(a.dir, [`attributes/components/${a.gone}.json`])).success).toBe(false)
    expect(existsSync(attr(a.dir, 'components', a.gone))).toBe(true)
    expect((await get(a.dir)).settlements_verified).toBe(false)
    // Log and baseline written, no delete: logged, verified, and the orphan still blocks Gate 2.
    const b = await modelWithOrphan()
    modelStatePruneTool.storeOptions = { failAfterReplaces: 2 }
    expect((await prune(b.dir, [`attributes/components/${b.gone}.json`])).success).toBe(false)
    expect(existsSync(attr(b.dir, 'components', b.gone))).toBe(true)
    expect((await get(b.dir)).settlements_verified).toBe(true)
    expect((await gates(b.dir)).gate2.checks.no_orphan_attribute_files.verdict).not.toBe('PASS')
    // A fresh approval then deletes it.
    modelStatePruneTool.storeOptions = {}
    expect((await prune(b.dir, [`attributes/components/${b.gone}.json`])).success).toBe(true)
  })

  it('reports a pointer it could not update, and the next settlement catches it up', async () => {
    const { dir, gone } = await modelWithOrphan()
    hooks.pointerFails = true
    const r = await prune(dir, [`attributes/components/${gone}.json`])
    expect(r.success, r.error).toBe(true)
    expect(r.data.warning).toContain('pointer could not be updated')
    hooks.pointerFails = false
    expect((await get(dir)).baseline).toBe('verified')
  })

  it('never re-signs a baseline this machine saw and is now gone (rolled back)', async () => {
    const { dir, gone } = await modelWithOrphan()
    await fs.rm(path.join(dir, '.dethereal', 'settlement-baseline.json'))
    expect((await get(dir)).baseline_code).toBe('rolled_back')
    const r = await prune(dir, [`attributes/components/${gone}.json`])
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['baseline_unverified'])
    expect(existsSync(path.join(dir, '.dethereal', 'settlement-baseline.json'))).toBe(false)
    expect((await get(dir)).baseline_code).toBe('rolled_back')
    expect(existsSync(attr(dir, 'components', gone))).toBe(true)
  })

  /** A model with `n` orphaned component attribute files named gone-<i>, zero-padded to `width`. */
  async function modelWithOrphans(n: number, width: number): Promise<{ dir: string; name: (i: number) => string }> {
    const dir = path.join(root, `m${seq++}`)
    await writeGateModel(dir, gateModel())
    const id = (i: number) => `gone-${String(i).padStart(width, '0')}`
    for (let i = 0; i < n; i++) {
      await fs.writeFile(attr(dir, 'components', id(i)), JSON.stringify({ elementId: id(i), attributes: {} }))
    }
    return { dir, name: (i) => `attributes/components/${id(i)}.json` }
  }

  it('prunes more orphans than one call takes, a page at a time, each page naming the next', async () => {
    const { dir, name } = await modelWithOrphans(51, 2)
    const first = await prune(dir, [name(0)])
    expect(first.data.codes).toEqual(['files_differ'])
    expect(first.data.orphaned_files).toHaveLength(50)
    expect(first.data.orphaned_files_total).toBe(51)
    const page1 = await prune(dir, first.data.orphaned_files)
    expect(page1.success, page1.error).toBe(true)
    expect(page1.data.remaining).toBe(1)
    expect(page1.data.next_files).toEqual([name(50)])
    expect(page1.data.hint).toMatch(/^1 more orphaned attribute file\(s\): ask the operator to approve next_files/)
    // The next page straight from next_files: no refused call in between.
    const page2 = await prune(dir, page1.data.next_files)
    expect(page2.success, page2.error).toBe(true)
    expect(page2.data.deleted).toEqual([name(50)])
    expect(page2.data).not.toHaveProperty('remaining')
    expect(page2.data).not.toHaveProperty('next_files')
    expect(page2.data.hint).toBe('validate the model with validate_model_json (action "gates")')
    expect((await fs.readdir(path.join(dir, 'attributes', 'components'))).filter((f) => f.startsWith('gone-'))).toEqual([])
  })

  it('next_files is the next page exactly, at most one page, never a file that only looks orphaned', async () => {
    const { dir, name } = await modelWithOrphans(120, 3)
    // Sorts inside the second page, but holds another element's id: listed, never deleted.
    await fs.writeFile(attr(dir, 'components', 'gone-075x'), JSON.stringify({ elementId: 'someone-else', attributes: {} }))
    const first = await prune(dir, [name(0)])
    const page1 = await prune(dir, first.data.orphaned_files)
    expect(page1.success, page1.error).toBe(true)
    expect(page1.data.remaining).toBe(70)
    expect(page1.data.next_files).toEqual(Array.from({ length: 50 }, (_, i) => name(50 + i)))
    expect(page1.data.not_deleted).toEqual([expect.objectContaining({ file: 'attributes/components/gone-075x.json' })])
    const page2 = await prune(dir, page1.data.next_files)
    expect(page2.success, page2.error).toBe(true)
    expect(page2.data.next_files).toEqual(Array.from({ length: 20 }, (_, i) => name(100 + i)))
  })

  it('next_files is never trusted: an element restored since is refused, and nothing is written', async () => {
    const { dir, name } = await modelWithOrphans(51, 2)
    const first = await prune(dir, [name(0)])
    const page1 = await prune(dir, first.data.orphaned_files)
    // gone-50 is an element again.
    const structure = JSON.parse(readFileSync(path.join(dir, 'structure.json'), 'utf8'))
    structure.defaultBoundary.boundaries[0].components.push({ id: 'gone-50', name: 'Back again', type: 'PROCESS', positionX: 0, positionY: 0 })
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure, null, 2))
    const log = readFileSync(path.join(dir, '.dethereal', 'settlements.json'))
    const r = await prune(dir, page1.data.next_files)
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['files_differ'])
    expect(r.data.orphaned_files).toEqual([])
    expect(existsSync(attr(dir, 'components', 'gone-50'))).toBe(true)
    expect(readFileSync(path.join(dir, '.dethereal', 'settlements.json')).equals(log)).toBe(true)
  })

  it('a forged prune entry fails the signed log', async () => {
    const { dir, gone } = await modelWithOrphan()
    expect((await prune(dir, [`attributes/components/${gone}.json`])).success).toBe(true)
    const file = path.join(dir, '.dethereal', 'settlements.json')
    const log = JSON.parse(readFileSync(file, 'utf8'))
    log.entries.push({ at: new Date().toISOString(), action: 'prune', files: ['attributes/components/c-web.json'], element_ids: ['c-web'] })
    log.total += 1
    await fs.writeFile(file, `${JSON.stringify(log, null, 2)}\n`)
    expect((await get(dir)).settlements_verified).toBe(false)
  })
})
