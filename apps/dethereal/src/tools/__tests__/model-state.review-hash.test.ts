/**
 * model_state with a review hash it cannot take: the content hash is null with
 * the reason, a REVIEWED claim reads stale, and REVIEWED is refused, with
 * nothing written.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import { FIXTURE_MODULE, gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { loadGateInput, reviewContentHash } from '../../utils/gates.js'
import { registerAll } from './helpers/settle.js'

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-state-review-hash-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-state-review-hash-homes-')))
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
})

const REVIEWED = ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED']
/** A model whose scope file is a link: its review hash cannot be taken. */
async function linkedScope(state: Record<string, unknown>): Promise<string> {
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, gateModel())
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(state))
  const outside = path.join(root, `scope-${seq++}.json`)
  await fs.rename(path.join(dir, '.dethereal', 'scope.json'), outside)
  await fs.symlink(outside, path.join(dir, '.dethereal', 'scope.json'))
  return dir
}
const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir } as never, context)) as any).data
const review = (dir: string) => modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' } as never, context) as Promise<any>

describe('a review hash that cannot be taken', () => {
  it('reports the content hash as null with why, never a hash over less', async () => {
    const dir = await linkedScope({ currentState: 'ENRICHING', completedStates: REVIEWED.slice(0, 5) })
    const g = await get(dir)
    expect(g.content_hash).toBeNull()
    expect(g.content_hash_unavailable).toEqual({ code: 'state_files_refused', files: ['.dethereal/scope.json'], files_total: 1 })
  })

  it('never reads a REVIEWED claim as current', async () => {
    const dir = await linkedScope({ currentState: 'REVIEWED', completedStates: REVIEWED, reviewHash: 'a'.repeat(64), reviewedAt: '2026-01-01T00:00:00.000Z' })
    const g = await get(dir)
    expect(g.claimed_state).toBe('REVIEWED')
    expect(g.state).not.toBe('REVIEWED')
  })

  it('reads a model the gates and the settlement support as stale, and refuses REVIEWED for the hash alone', async () => {
    // Every data item names its module, so the gates still derive the modules with a data class's cache entry refused.
    const m = gateModel()
    for (const i of m.dataItems) i.classData = { ...i.classData, module: FIXTURE_MODULE }
    const dir = path.join(root, `m${seq++}`)
    await writeGateModel(dir, m)
    await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify({ currentState: 'ENRICHING', completedStates: REVIEWED.slice(0, 5) }))
    await registerAll(dir)
    const hash = reviewContentHash(await loadGateInput(dir))
    const state = path.join(dir, '.dethereal', 'state.json')
    await fs.writeFile(state, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), currentState: 'REVIEWED', completedStates: REVIEWED, reviewHash: hash, reviewedAt: '2026-01-01T00:00:00.000Z' }))
    expect((await get(dir)).reviewed_stale).toBe(false)
    // The cache entry of a data class the model uses, behind a link: the gates pass, the hash cannot be taken.
    const entry = path.join(dir, '.dethereal', 'class-cache', `${m.dataItems[0]!.classData.id}.json`)
    const outside = path.join(root, `entry-${seq++}.json`)
    await fs.rename(entry, outside)
    await fs.symlink(outside, entry)
    const g = await get(dir)
    expect(g.gates).toMatchObject({ gate2: 'PASS', gate3: 'PASS' })
    expect(g.state).toBe('REVIEWED')
    expect(g.reviewed_stale).toBe(true)
    expect(g.reviewed_stale_reason).toBe('review hash unavailable (state_files_refused)')
    const before = readFileSync(state, 'utf8')
    const r = await review(dir)
    expect(r.data.codes).toEqual(['review_hash_unavailable'])
    expect(readFileSync(state, 'utf8')).toBe(before)
  })

  it('refuses REVIEWED, recorded before or not, and writes nothing', async () => {
    for (const stored of [{}, { reviewHash: 'a'.repeat(64), reviewedAt: '2026-01-01T00:00:00.000Z' }]) {
      const dir = await linkedScope({ currentState: 'REVIEWED', completedStates: REVIEWED, revision: 4, ...stored })
      const before = readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8')
      const r = await review(dir)
      expect(r.success).toBe(false)
      expect(r.data.codes).toContain('review_hash_unavailable')
      expect(readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8')).toBe(before)
    }
  })
})
