/**
 * One transition that also records the mode, the last quick step and the drift baseline: the same state as the
 * separate calls, in one write; refused whole, with nothing written, when any part of it is refused.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'

vi.setConfig({ testTimeout: 30_000 })

// With the settlement off only the gates decide: nothing here needs registering.
const context = { debug: false, settlement: 'off' as const }
let root: string
let seq = 0

beforeAll(async () => {
  // Outside this checkout, so a model with no repository of its own is in none.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-state-combined-')))
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
})
afterAll(async () => {
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
})

const BEFORE_ENRICHING = ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE']
const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString().trim()

/** A model in a repository with one commit, in `state`; with `git: false`, outside any repository. */
async function model(state: Record<string, unknown>, { git = true, mutate }: { git?: boolean; mutate?: (m: GateModel) => void } = {}): Promise<{ dir: string; head?: string }> {
  const repoDir = path.join(root, `r${seq++}`)
  await fs.mkdir(repoDir)
  const dir = path.join(repoDir, 'model')
  const m = gateModel()
  mutate?.(m)
  await writeGateModel(dir, m)
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(state))
  if (!git) return { dir }
  gitIn(repoDir, 'init', '-q')
  gitIn(repoDir, 'add', '-A')
  gitIn(repoDir, 'commit', '-q', '-m', 'one')
  return { dir, head: gitIn(repoDir, 'rev-parse', 'HEAD') }
}
/** Two copies of one model, each in its own repository with the same tree. */
async function pair(state: Record<string, unknown>, mutate?: (m: GateModel) => void) {
  return [await model(state, { mutate }), await model(state, { mutate })] as const
}
/** A Tier 1–2 flow without its transit encryption: a gap the last quick step reports. */
const transitGap = (m: GateModel) => { delete m.attributes.dataFlows['f-submit']!.attributes.encryption_in_transit }
const call = (input: Record<string, unknown>) => modelStateTool.run(input, context) as Promise<{ success: boolean; data?: any; error?: string }>
const stateFile = (dir: string) => path.join(dir, '.dethereal', 'state.json')
const stateOf = (dir: string) => JSON.parse(readFileSync(stateFile(dir), 'utf8'))
/** The state as the calls left it, without what only says when and how often it was written. */
const comparable = (dir: string) => {
  const { revision: _r, lastModified: _m, ...rest } = stateOf(dir)
  return rest
}

describe('a transition that also records the mode, the quick step and the baseline', () => {
  it('leaves the state the separate calls leave, in one write', async () => {
    const [one, sep] = await pair({ currentState: 'STRUCTURE_COMPLETE', completedStates: BEFORE_ENRICHING, staleElements: [] })
    const r = await call({ action: 'transition', directory_path: one.dir, to: 'ENRICHING', commit: 'HEAD', mode: 'quick', quick_through: 7 })
    expect(r.success, r.error).toBe(true)
    expect(r.data).toMatchObject({ state: 'ENRICHING', baseline_commit: one.head, mode: 'quick', quick_through: 7 })

    expect((await call({ action: 'transition', directory_path: sep.dir, to: 'ENRICHING' })).success).toBe(true)
    expect((await call({ action: 'set_baseline', directory_path: sep.dir })).success).toBe(true)
    expect((await call({ action: 'mode', directory_path: sep.dir, mode: 'quick', quick_through: 7 })).success).toBe(true)

    expect(comparable(one.dir)).toEqual({ ...comparable(sep.dir), lastReconcileCommit: one.head })
    expect(stateOf(one.dir).revision).toBe(1)
    expect(stateOf(sep.dir).revision).toBe(3)
  })

  it('gives what the mode action gives when the quick step becomes 8', async () => {
    const [one, sep] = await pair({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [], mode: 'quick', quickThrough: 7 }, transitGap)
    const combined = await call({ action: 'transition', directory_path: one.dir, to: 'ENRICHING', quick_through: 8 })
    const separate = await call({ action: 'mode', directory_path: sep.dir, quick_through: 8 })
    expect(combined.success, combined.error).toBe(true)
    const gaps = (d: Record<string, unknown>) => ({ priority_gaps: d.priority_gaps, priority_gaps_unavailable: d.priority_gaps_unavailable })
    expect(gaps(combined.data)).toEqual(gaps(separate.data))
    expect(Object.values(gaps(combined.data)).some((v) => v !== undefined)).toBe(true)
    expect(comparable(one.dir)).toEqual(comparable(sep.dir))
  })

  it('applies only what it also records when the state stays, and changes nothing when there is nothing to record', async () => {
    const { dir, head } = await model({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [] })
    const same = await call({ action: 'transition', directory_path: dir, to: 'ENRICHING', commit: 'HEAD' })
    expect(same.data).toMatchObject({ state: 'ENRICHING', baseline_commit: head })
    expect(stateOf(dir)).toMatchObject({ currentState: 'ENRICHING', lastReconcileCommit: head, revision: 1 })
    const nothing = await call({ action: 'transition', directory_path: dir, to: 'ENRICHING' })
    expect(nothing.data).toMatchObject({ unchanged: true })
    expect(stateOf(dir).revision).toBe(1)
  })

  it('moves back to ENRICHING with a lower quick step, as the backward move clears the old one', async () => {
    const { dir } = await model({ currentState: 'REVIEWED', completedStates: [...BEFORE_ENRICHING, 'REVIEWED'], staleElements: [], quickThrough: 8 })
    const r = await call({ action: 'transition', directory_path: dir, to: 'ENRICHING', mode: 'quick', quick_through: 7 })
    expect(r.success, r.error).toBe(true)
    expect(r.data).toMatchObject({ state: 'ENRICHING', mode: 'quick', quick_through: 7 })
    expect(stateOf(dir)).toMatchObject({ currentState: 'ENRICHING', mode: 'quick', quickThrough: 7 })
  })

  it('reviews a quick model it marks full in the same call, as the two calls would', async () => {
    const [one, sep] = await pair({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [], mode: 'quick', quickThrough: 8 })
    const r = await call({ action: 'transition', directory_path: one.dir, to: 'REVIEWED', mode: 'full' })
    expect(r.success, r.error).toBe(true)
    expect(r.data).toMatchObject({ state: 'REVIEWED', mode: null, quick_through: 8 })
    expect((await call({ action: 'mode', directory_path: sep.dir, mode: 'full' })).success).toBe(true)
    expect((await call({ action: 'transition', directory_path: sep.dir, to: 'REVIEWED' })).success).toBe(true)
    const { reviewedAt: _a, ...a } = comparable(one.dir)
    const { reviewedAt: _b, ...b } = comparable(sep.dir)
    expect(a).toEqual(b)
  })

  it('records a baseline on a review that stands, without stamping it again', async () => {
    const { dir, head } = await model({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [] })
    expect((await call({ action: 'transition', directory_path: dir, to: 'REVIEWED' })).success).toBe(true)
    const reviewedAt = stateOf(dir).reviewedAt
    const r = await call({ action: 'transition', directory_path: dir, to: 'REVIEWED', commit: 'HEAD' })
    expect(r.data).toMatchObject({ state: 'REVIEWED', unchanged: true, baseline_commit: head })
    expect(stateOf(dir)).toMatchObject({ reviewedAt, lastReconcileCommit: head })
  })
})

describe('a combined transition refused', () => {
  it.each([
    ['an unknown commit', { to: 'ENRICHING', commit: 'd'.repeat(40) }, 'unknown_commit', true],
    ['no repository', { to: 'ENRICHING', commit: 'HEAD' }, 'not_a_git_repo', false],
    ['a quick step away from ENRICHING', { to: 'STRUCTURE_COMPLETE', quick_through: 7, mode: 'quick' }, 'wrong_state', true],
    ['a quick step on a model left full', { to: 'ENRICHING', quick_through: 7 }, 'not_quick', true],
    ['a quick model to REVIEWED', { to: 'REVIEWED', mode: 'quick' }, 'reviewed_model', true],
  ] as const)('writes nothing for %s, and removes nothing either', async (_, input, code, git) => {
    const { dir } = await model({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [] }, { git })
    // What a backward transition and a review remove: a refused call leaves them.
    const quality = path.join(dir, '.dethereal', 'quality.json')
    const loopBack = path.join(dir, '.dethereal', 'loop-back.json')
    await fs.writeFile(quality, '{"quality_score": 50}')
    await fs.writeFile(loopBack, '{ not a record')
    const bytes = readFileSync(stateFile(dir), 'utf8')
    const r = await call({ action: 'transition', directory_path: dir, ...input })
    expect(r.success).toBe(false)
    expect(r.data?.codes).toEqual([code])
    expect(readFileSync(stateFile(dir), 'utf8')).toBe(bytes)
    expect(readFileSync(quality, 'utf8')).toBe('{"quality_score": 50}')
    expect(readFileSync(loopBack, 'utf8')).toBe('{ not a record')
  })

  it('keeps the quick mark when the gates refuse the review it was to be cleared for', async () => {
    const { dir } = await model({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [], mode: 'quick' }, { mutate: transitGap })
    const r = await call({ action: 'transition', directory_path: dir, to: 'REVIEWED', mode: 'full' })
    expect(r.success).toBe(false)
    expect(r.data?.codes).toContain('gate3_fails')
    expect(stateOf(dir).mode).toBe('quick')
  })

  it('writes nothing for a quick step that would go back', async () => {
    const { dir } = await model({ currentState: 'ENRICHING', completedStates: BEFORE_ENRICHING, staleElements: [], mode: 'quick', quickThrough: 8 })
    const bytes = readFileSync(stateFile(dir), 'utf8')
    const r = await call({ action: 'transition', directory_path: dir, to: 'ENRICHING', quick_through: 7 })
    expect(r.data?.codes).toEqual(['quick_through_backward'])
    expect(readFileSync(stateFile(dir), 'utf8')).toBe(bytes)
  })
})
