import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { modelStateTool, MAX_STALE } from '../model-state.tool.js'
import type { ToolContext } from '../base-tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { buildWorker, removeWorker, runWorker } from '../../utils/__tests__/fixtures/worker-harness.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { registerAll } from './helpers/settle.js'

// Tests register whole models (several settle calls): slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

const context: ToolContext = { debug: false }
const base = process.cwd()
let root: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(base, '.test-model-state-'))
  // A model's first state registers it: the registry goes under this test's own project root.
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
})
afterAll(async () => {
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
})

async function model(mutate?: (m: GateModel) => void, state?: Record<string, unknown>): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  // The operator's values, registered as the workflow registers them.
  await registerAll(dir)
  if (state) await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(state))
  return dir
}

const call = (input: Record<string, unknown>) => modelStateTool.run(input, context) as Promise<{ success: boolean; data?: any; error?: string }>
const stateOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8'))
const transition = (dir: string, to: string, add?: string[]) => call({ action: 'transition', directory_path: dir, to, ...(add ? { add } : {}) })

const failGate3 = (m: GateModel) => { delete m.scope!.crown_jewel_elements }
const enriching = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const reviewed = { currentState: 'REVIEWED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED'], staleElements: [] }

describe('model_state — input', () => {
  it('refuses keys it does not know, including a caller-supplied pull state', async () => {
    const dir = await model()
    const r = await call({ action: 'merge_pulled', directory_path: dir, pulled: { currentState: 'REVIEWED' } })
    expect(r.success).toBe(false)
    expect(existsSync(path.join(dir, '.dethereal', 'state.json'))).toBe(false)
  })

  it('refuses element ids outside the charset', async () => {
    const dir = await model(undefined, enriching)
    for (const id of ['../x', 'a b', 'a.b', '']) {
      expect((await call({ action: 'stale', directory_path: dir, add: [id] })).success, id).toBe(false)
    }
  })

  it('refuses a directory outside the project', async () => {
    expect((await call({ action: 'get', directory_path: path.dirname(base) })).success).toBe(false)
  })
})

describe('model_state — transitions', () => {
  it('creates the state only at INITIALIZED or SCOPE_DEFINED, and only in a model directory', async () => {
    const dir = await model()
    expect((await transition(dir, 'STRUCTURE_COMPLETE')).success).toBe(false)
    const r = await transition(dir, 'SCOPE_DEFINED')
    expect(r.success).toBe(true)
    expect(stateOf(dir)).toMatchObject({ currentState: 'SCOPE_DEFINED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED'], revision: 1 })

    const bare = path.join(root, `bare${seq++}`)
    await fs.mkdir(bare)
    expect((await transition(bare, 'SCOPE_DEFINED')).success).toBe(false)
    expect(existsSync(path.join(bare, '.dethereal'))).toBe(false)
  })

  it('walks forward one milestone at a time to REVIEWED on a model that passes the gates', async () => {
    const dir = await model()
    const steps: Array<[string, string[]]> = [
      ['SCOPE_DEFINED', ['INITIALIZED', 'SCOPE_DEFINED']],
      ['DISCOVERED', ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED']],
      ['STRUCTURE_COMPLETE', ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE']],
      ['ENRICHING', ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE']],
      ['REVIEWED', ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED']],
    ]
    let revision = 0
    for (const [to, completed] of steps) {
      const r = await transition(dir, to)
      expect(r.success, `${to}: ${r.error}`).toBe(true)
      expect(stateOf(dir)).toMatchObject({ currentState: to, completedStates: completed, revision: ++revision })
    }
    const promoted = await call({ action: 'get', directory_path: dir })
    expect(promoted.data).toMatchObject({ state: 'REVIEWED', claimed_state: 'REVIEWED', gates: { gate2: 'PASS', gate3: 'PASS' } })
  })

  it('lets DISCOVERED be skipped, and nothing else', async () => {
    const dir = await model(undefined, { currentState: 'SCOPE_DEFINED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED'] })
    expect((await transition(dir, 'ENRICHING')).success).toBe(false)
    expect((await transition(dir, 'STRUCTURE_COMPLETE')).success).toBe(true)
    expect(stateOf(dir).completedStates).toEqual(['INITIALIZED', 'SCOPE_DEFINED', 'STRUCTURE_COMPLETE'])
    expect((await transition(dir, 'REVIEWED')).success).toBe(false)
  })

  it('needs components and flows before STRUCTURE_COMPLETE', async () => {
    const dir = await model((m) => { m.dataFlows = []; m.attributes.dataFlows = {} }, { currentState: 'DISCOVERED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED'] })
    const r = await transition(dir, 'STRUCTURE_COMPLETE')
    expect(r.success).toBe(false)
    expect(r.error).toContain('SCOPE_DEFINED')
  })

  it('refuses REVIEWED while Gate 3 fails, and says what the state reads as', async () => {
    const dir = await model(failGate3, enriching)
    const r = await transition(dir, 'REVIEWED')
    expect(r.success).toBe(false)
    expect(r.error).toContain('Gate 3 fails (C6)')
    expect(r.data).toMatchObject({ effective_state: 'ENRICHING', failing_criteria: ['C6'] })
    expect(stateOf(dir).currentState).toBe('ENRICHING')
  })

  it('refuses REVIEWED while Gate 2 fails, even with Gate 3 passing', async () => {
    const dir = await model((m) => { m.attributes.components['c-gone'] = { elementId: 'c-gone', elementType: 'component', attributes: {} } }, enriching)
    const r = await transition(dir, 'REVIEWED')
    expect(r.success).toBe(false)
    expect(r.error).toContain('Gate 2 fails')
  })

  it('refuses REVIEWED while a queued stale element still exists, not for one that is gone', async () => {
    const queued = await model(undefined, { ...enriching, staleElements: ['c-web'] })
    expect((await transition(queued, 'REVIEWED')).error).toContain('1 queued stale elements still exist')
    const gone = await model(undefined, { ...enriching, staleElements: ['c-removed'] })
    expect((await transition(gone, 'REVIEWED')).success).toBe(true)
  })

  it('recomputes a REVIEWED the file already claims, and refuses a forged one', async () => {
    const dir = await model(failGate3, { ...reviewed, model_signed_off: true, gate3Waiver: { reason: 'accepted' } })
    const r = await transition(dir, 'REVIEWED')
    expect(r.success).toBe(false)
    expect(r.data.effective_state).toBe('ENRICHING')
    const got = (await call({ action: 'get', directory_path: dir })).data
    expect(got).toMatchObject({
      state: 'ENRICHING', claimed_state: 'REVIEWED',
      legacy: { gate3Waiver: { present: true, honoured: false }, model_signed_off: { present: true, honoured: false } },
    })
    expect(got.completed_states).toEqual(['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'])
  })

  it('applies a backward transition with all its side effects, and never blocks on its stale ids', async () => {
    const target = path.join(root, `outside-quality-${seq++}.json`)
    await fs.writeFile(target, '{"keep":true}')
    const dir = await model(undefined, { ...reviewed, model_signed_off: true, custom: { a: 1 } })
    await fs.symlink(target, path.join(dir, '.dethereal', 'quality.json'))
    const r = await transition(dir, 'STRUCTURE_COMPLETE', ['c-web', 'c-deleted'])
    expect(r.success).toBe(true)
    expect(r.data.rejected_ids).toEqual([{ id: 'c-deleted', reason: 'no such element' }])
    const s = stateOf(dir)
    expect(s).toMatchObject({
      currentState: 'STRUCTURE_COMPLETE',
      completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'],
      staleElements: ['c-web'],
      custom: { a: 1 },
    })
    expect(s.model_signed_off).toBeUndefined()
    expect(existsSync(path.join(dir, '.dethereal', 'quality.json'))).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('{"keep":true}')
  })

  it('takes ENRICHING off the completed list when the model drops back to it', async () => {
    const dir = await model(undefined, reviewed)
    await fs.writeFile(path.join(dir, '.dethereal', 'quality.json'), '{}')
    expect((await transition(dir, 'ENRICHING')).success).toBe(true)
    expect(stateOf(dir).completedStates).toEqual(['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'])
    expect(existsSync(path.join(dir, '.dethereal', 'quality.json'))).toBe(false)
  })

  it('treats the same state as a no-op, except that queued ids still land', async () => {
    const dir = await model(undefined, enriching)
    const r = await transition(dir, 'ENRICHING')
    expect(r.data.unchanged).toBe(true)
    expect(stateOf(dir).revision).toBeUndefined()
    expect((await transition(dir, 'ENRICHING', ['c-web'])).success).toBe(true)
    expect(stateOf(dir)).toMatchObject({ staleElements: ['c-web'], revision: 1 })
  })

  it('repairs a state without a valid currentState only through the first two states', async () => {
    const dir = await model(undefined, { currentState: 'DONE', note: 'x' })
    expect((await call({ action: 'get', directory_path: dir })).data).toMatchObject({ claimed_state: null, claimed_state_invalid: true, state: null })
    expect((await transition(dir, 'ENRICHING')).success).toBe(false)
    expect((await transition(dir, 'SCOPE_DEFINED')).success).toBe(true)
    expect(stateOf(dir)).toMatchObject({ currentState: 'SCOPE_DEFINED', note: 'x' })
  })
})

describe('model_state — stale queue', () => {
  it('adds existing elements, removes any well-formed id, and reports the rest', async () => {
    const dir = await model(undefined, { ...enriching, staleElements: ['c-old', 42, '../x'] })
    const r = await call({ action: 'stale', directory_path: dir, add: ['c-web', 'c-nope'], remove: ['c-old'] })
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ rejected_ids: [{ id: 'c-nope', reason: 'no such element' }], stale_dropped_invalid: 2 })
    expect(stateOf(dir).staleElements).toEqual(['c-web'])
  })

  it('caps the queue', async () => {
    const full = Array.from({ length: MAX_STALE }, (_, i) => `gone-${i}`)
    const dir = await model(undefined, { ...enriching, staleElements: full })
    const r = await call({ action: 'stale', directory_path: dir, add: ['c-web'] })
    expect(r.data.rejected_ids).toEqual([{ id: 'c-web', reason: 'stale queue full' }])
  })

  it('demotes a REVIEWED model when an element is queued', async () => {
    const dir = await model(undefined, reviewed)
    const r = await call({ action: 'stale', directory_path: dir, add: ['c-db'] })
    expect(r.data.demoted).toEqual({ from: 'REVIEWED', to: 'ENRICHING' })
    expect(stateOf(dir)).toMatchObject({ currentState: 'ENRICHING', staleElements: ['c-db'] })
  })
})

describe('model_state — merge_pulled', () => {
  it.each([
    ['ENRICHING', undefined, ['INITIALIZED', 'SCOPE_DEFINED', 'STRUCTURE_COMPLETE']],
    ['STRUCTURE_COMPLETE', (m: GateModel) => {
      const strip = (b: any) => { for (const c of b.components ?? []) delete c.classData; (b.boundaries ?? []).forEach(strip) }
      strip(m.structure.defaultBoundary)
      m.attributes = { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} }
    }, ['INITIALIZED', 'SCOPE_DEFINED', 'STRUCTURE_COMPLETE']],
    ['SCOPE_DEFINED', (m: GateModel) => { m.dataFlows = []; m.attributes.dataFlows = {} }, ['INITIALIZED', 'SCOPE_DEFINED']],
    ['INITIALIZED', (m: GateModel) => { m.structure.defaultBoundary.boundaries = []; m.dataFlows = []; m.attributes = { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} } }, ['INITIALIZED']],
  ])('creates the state a fresh pull supports: %s', async (inferred, mutate, completed) => {
    const dir = await model(mutate as ((m: GateModel) => void) | undefined)
    const r = await call({ action: 'merge_pulled', directory_path: dir })
    expect(r.data).toMatchObject({ created: true, inferred })
    expect(stateOf(dir)).toMatchObject({ currentState: inferred, completedStates: completed, inferredFromContent: true, revision: 1 })
  })

  it('never changes an existing state, a REVIEWED on a failing model included', async () => {
    const dir = await model(failGate3, { ...reviewed, lastReconcileCommit: 'abc1234', custom: 1 })
    const r = await call({ action: 'merge_pulled', directory_path: dir })
    expect(r.data).toMatchObject({ created: false, claimed: 'REVIEWED', effective: 'ENRICHING', inferred: 'ENRICHING' })
    expect(stateOf(dir)).toMatchObject({ ...reviewed, lastReconcileCommit: 'abc1234', custom: 1 })
  })

  it('rebuilds the state-machine keys of a state without a valid currentState, and keeps the rest', async () => {
    const dir = await model(undefined, { currentState: 'REVIEWED!', lastReconcileCommit: 'abc1234' })
    await call({ action: 'merge_pulled', directory_path: dir })
    expect(stateOf(dir)).toMatchObject({ currentState: 'ENRICHING', lastReconcileCommit: 'abc1234', inferredFromContent: true })
  })
})

describe('model_state — get', () => {
  it('reports unknown keys by name only, and dates only when they are ISO-8601', async () => {
    const secret = 'unknown-value-that-must-stay-inside'
    const keys = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, secret]))
    const dir = await model(undefined, { ...enriching, lastModified: 'yesterday', ['bad key!']: secret, ...keys })
    const r = await call({ action: 'get', directory_path: dir })
    const text = JSON.stringify(r)
    expect(text).not.toContain(secret)
    expect(r.data.unknown_keys).toHaveLength(20)
    expect(r.data.unknown_keys).not.toContain('bad key!')
    expect(r.data.unknown_keys_total).toBe(26)
    expect(r.data.last_modified).toBeNull()
  })

  it('says when there is no state yet, with the content state as advice', async () => {
    const dir = await model()
    expect((await call({ action: 'get', directory_path: dir })).data).toMatchObject({ exists: false, content_state: 'ENRICHING' })
  })
})

describe('model_state — set_baseline', () => {
  const gitIn = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString().trim()

  async function repo(): Promise<{ repoDir: string; dir: string; first: string; second: string }> {
    const repoDir = path.join(root, `repo${seq++}`)
    await fs.mkdir(repoDir)
    gitIn(repoDir, 'init', '-q')
    const dir = path.join(repoDir, 'model')
    await writeGateModel(dir, gateModel())
    await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(enriching))
    gitIn(repoDir, 'add', '-A')
    gitIn(repoDir, 'commit', '-q', '-m', 'one')
    const first = gitIn(repoDir, 'rev-parse', 'HEAD')
    await fs.writeFile(path.join(repoDir, 'more.txt'), 'x')
    gitIn(repoDir, 'add', 'more.txt')
    gitIn(repoDir, 'commit', '-q', '-m', 'two')
    const second = gitIn(repoDir, 'rev-parse', 'HEAD')
    return { repoDir, dir, first, second }
  }

  it('stores the full id of an ancestor commit', async () => {
    const { dir, first } = await repo()
    const r = await call({ action: 'set_baseline', directory_path: dir, commit: first })
    expect(r.success, r.error).toBe(true)
    expect(stateOf(dir).lastReconcileCommit).toBe(first)
  })

  it('takes only a full commit id, so no branch or tag can stand in for it', async () => {
    const { repoDir, dir, first, second } = await repo()
    // A tag named like the abbreviation of one commit, pointing at another ancestor.
    gitIn(repoDir, 'tag', second.slice(0, 8), first)
    const r = await call({ action: 'set_baseline', directory_path: dir, commit: second.slice(0, 8) })
    expect(r.success).toBe(false)
    expect(stateOf(dir).lastReconcileCommit).toBeUndefined()
  })

  it('refuses an unknown commit and one that is not an ancestor of HEAD', async () => {
    const { repoDir, dir, first, second } = await repo()
    const unknown = await call({ action: 'set_baseline', directory_path: dir, commit: 'd'.repeat(40) })
    expect(unknown.error).toBe('unknown commit')
    expect(unknown.data).toEqual({ codes: ['unknown_commit'] })
    gitIn(repoDir, 'checkout', '-q', first)
    const later = await call({ action: 'set_baseline', directory_path: dir, commit: second })
    expect(later.error).toContain('not an ancestor')
    expect(later.data).toEqual({ codes: ['not_ancestor'] })
  })

  it('runs nothing a planted repository asks for', async () => {
    const { dir, first } = await repo()
    const marker = path.join(root, `marker-${seq++}`)
    const script = path.join(root, `evil-${seq++}.sh`)
    await fs.writeFile(script, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 })
    // A bare-repository layout inside the model directory, configured to run a program.
    await fs.mkdir(path.join(dir, 'objects'), { recursive: true })
    await fs.mkdir(path.join(dir, 'refs'), { recursive: true })
    await fs.writeFile(path.join(dir, 'HEAD'), 'ref: refs/heads/main\n')
    await fs.writeFile(path.join(dir, 'config'), [
      '[core]', '\trepositoryformatversion = 1', '\tbare = true', `\tfsmonitor = ${script}`, `\tsshCommand = ${script}`,
      '[extensions]', '\tpartialClone = origin',
      '[remote "origin"]', '\turl = ssh://example.invalid/x.git', '\tpromisor = true',
    ].join('\n'))
    for (const commit of ['d'.repeat(40), first, undefined]) await call({ action: 'set_baseline', directory_path: dir, ...(commit ? { commit } : {}) })
    expect(existsSync(marker)).toBe(false)

    // Control: the same lookup with git's defaults does run the planted program,
    // so the clean result above is the hardening's doing.
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${'d'.repeat(40)}^{commit}`], {
        cwd: dir, stdio: 'ignore', timeout: 5000, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: '0' },
      })
    } catch {
      // The lookup fails either way; only the marker matters.
    }
    expect(existsSync(marker)).toBe(true)
  })

  /** A ref file written as it is on disk: git may refuse to create a ref named HEAD itself. */
  const plantRef = async (repoDir: string, ref: string, sha: string) => {
    const file = path.join(repoDir, '.git', ...ref.split('/'))
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${sha}\n`)
  }

  it("records the branch's commit", async () => {
    const { dir, second } = await repo()
    const r = await call({ action: 'set_baseline', directory_path: dir })
    expect(r.success, r.error).toBe(true)
    expect(r.data.baseline_commit).toBe(second)
    expect(stateOf(dir).lastReconcileCommit).toBe(second)
  })

  it('records a detached HEAD, which a ref named HEAD does not stand in for', async () => {
    const { repoDir, dir, first, second } = await repo()
    gitIn(repoDir, 'checkout', '-q', first)
    await plantRef(repoDir, 'refs/tags/HEAD', second)
    const r = await call({ action: 'set_baseline', directory_path: dir })
    expect(r.success, r.error).toBe(true)
    expect(stateOf(dir).lastReconcileCommit).toBe(first)
  })

  it('records the branch, not a ref named HEAD', async () => {
    const { repoDir, dir, first, second } = await repo()
    await plantRef(repoDir, 'refs/tags/HEAD', first)
    const r = await call({ action: 'set_baseline', directory_path: dir })
    expect(r.success, r.error).toBe(true)
    expect(stateOf(dir).lastReconcileCommit).toBe(second)
  })

  it('refuses a branch with no commit yet, even when a ref named HEAD names one', async () => {
    for (const ref of [null, 'refs/tags/HEAD', 'refs/heads/HEAD', 'refs/remotes/HEAD/HEAD']) {
      const { repoDir, dir, first } = await repo()
      gitIn(repoDir, 'checkout', '-q', '--orphan', 'fresh')
      if (ref) await plantRef(repoDir, ref, first)
      const before = readFileSync(path.join(dir, '.dethereal', 'state.json'))
      const r = await call({ action: 'set_baseline', directory_path: dir })
      expect(r.success, String(ref)).toBe(false)
      expect(r.error).toBe('the repository has no commit yet')
      expect(r.data).toEqual({ codes: ['no_commits'] })
      expect(readFileSync(path.join(dir, '.dethereal', 'state.json')).equals(before), String(ref)).toBe(true)
    }
  })

  it('refuses a repository with no commit at all', async () => {
    const repoDir = path.join(root, `empty${seq++}`)
    await fs.mkdir(repoDir)
    gitIn(repoDir, 'init', '-q')
    const dir = path.join(repoDir, 'model')
    await writeGateModel(dir, gateModel())
    await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(enriching))
    const r = await call({ action: 'set_baseline', directory_path: dir })
    expect(r.data).toEqual({ codes: ['no_commits'] })
    expect(stateOf(dir).lastReconcileCommit).toBeUndefined()
  })
})

describe('model_state — two processes', () => {
  let worker: string
  beforeAll(async () => { worker = await buildWorker() }, 120_000)
  afterAll(() => removeWorker(worker))

  it('serialises transitions and queue updates into one chain of revisions', async () => {
    const dir = await model(undefined, { ...enriching, revision: 0 })
    const log = path.join(root, `chain-${seq++}.log`)
    const a = Array.from({ length: 15 }, (_, i) => JSON.stringify({ action: 'transition', directory_path: dir, to: i % 2 ? 'ENRICHING' : 'STRUCTURE_COMPLETE' }))
    const ids = ['c-web', 'c-db', 'c-orders', 'c-jobs', 'c-report']
    const b = Array.from({ length: 15 }, (_, i) => JSON.stringify({ action: 'stale', directory_path: dir, ...(i % 3 === 2 ? { remove: [ids[i % 5]] } : { add: [ids[i % 5]] }) }))
    const results = await Promise.all([runWorker(worker, ['model-state', log, ...a], base), runWorker(worker, ['model-state', log, ...b], base)])
    expect(results.map((r) => r.code), results.map((r) => r.stderr).join('\n')).toEqual([0, 0])

    const entries = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const applied = entries.filter((e) => e.result.success && !e.result.data.unchanged)
    for (const e of entries.filter((x) => !x.result.success)) expect(e.result.error).toMatch(/changed while this call|not the next state/)
    const revisions = applied.map((e) => e.result.data.revision).sort((x: number, y: number) => x - y)
    expect(revisions).toEqual(Array.from({ length: applied.length }, (_, i) => i + 1))
    expect(stateOf(dir).revision).toBe(applied.length)
    // Transitions form one chain in revision order.
    let current = 'ENRICHING'
    for (const e of applied.sort((x, y) => x.result.data.revision - y.result.data.revision)) {
      if (e.input.action !== 'transition') continue
      expect(e.result.data.from).toBe(current)
      current = e.result.data.to
    }
    expect(stateOf(dir).currentState).toBe(current)
  }, 120_000)
})

describe('model_state — pending enrichment', () => {
  const entry = (extra: Record<string, unknown> = {}) => ({
    batch: 'b-1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema', source: 'app.py:1', previous: 'null', ...extra,
  })
  const writePending = (dir: string, doc: unknown) =>
    fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), typeof doc === 'string' ? doc : JSON.stringify(doc))

  it('reports the pending rows and refuses REVIEWED with a code until they are cleared', async () => {
    const dir = await model(undefined, enriching)
    await writePending(dir, { version: 1, entries: [entry(), entry({ element_id: 'c-db', field: 'backups_encrypted', value: true })] })
    const got = (await call({ action: 'get', directory_path: dir })).data
    expect(got.pending_enrichment).toMatchObject({ state: 'present', blocks: true, blocking: 2, rows_total: 2 })
    expect(got.display_state).toBe('ENRICHING (2 pending enrichment)')
    const refused = await transition(dir, 'REVIEWED')
    expect(refused.success).toBe(false)
    expect(refused.data.codes).toEqual(['pending_enrichment'])
    expect(refused.data.pending_rows).toHaveLength(2)
    expect(refused.error).toMatch(/only their reply to a row clears it/)
    expect(stateOf(dir).currentState).toBe('ENRICHING')

    await writePending(dir, { version: 1, entries: [] })
    const ok = await transition(dir, 'REVIEWED')
    expect(ok.success).toBe(true)
    expect(stateOf(dir).currentState).toBe('REVIEWED')
  })

  it('refuses REVIEWED on an unreadable file, with its own code', async () => {
    const dir = await model(undefined, enriching)
    await writePending(dir, '{"version": 1, "entries": [ canary-secret-value')
    const got = (await call({ action: 'get', directory_path: dir })).data
    expect(got.display_state).toBe('ENRICHING (pending enrichment unreadable)')
    const refused = await transition(dir, 'REVIEWED')
    expect(refused.data.codes).toEqual(['pending_enrichment_unreadable'])
    expect(JSON.stringify(got) + JSON.stringify(refused)).not.toContain('canary-secret-value')
  })

  it('reads a claimed REVIEWED as ENRICHING while anything is pending, and REVIEWED again once cleared, with no restamp', async () => {
    const dir = await model(undefined, enriching)
    expect((await transition(dir, 'REVIEWED')).success).toBe(true)
    const hash = stateOf(dir).reviewHash
    await writePending(dir, { version: 1, entries: [entry()] })
    const got = (await call({ action: 'get', directory_path: dir })).data
    expect(got).toMatchObject({ state: 'ENRICHING', claimed_state: 'REVIEWED', display_state: 'ENRICHING (1 pending enrichment)' })
    expect(got.note).toMatch(/pending enrichment/)
    const pulled = (await call({ action: 'merge_pulled', directory_path: dir })).data
    expect(pulled.effective).toBe('ENRICHING')
    await fs.rm(path.join(dir, '.dethereal', 'enrichment-pending.json'))
    const again = (await call({ action: 'get', directory_path: dir })).data
    expect(again).toMatchObject({ state: 'REVIEWED', reviewed_stale: false })
    expect(stateOf(dir).reviewHash).toBe(hash)
  })

  it('codes every other REVIEWED refusal too', async () => {
    const dir = await model(failGate3, enriching)
    expect((await transition(dir, 'REVIEWED')).data.codes).toEqual(['gate3_fails'])
    const early = await model(undefined, { ...enriching, currentState: 'STRUCTURE_COMPLETE' })
    expect((await transition(early, 'REVIEWED')).data.codes).toEqual(['wrong_source_state'])
    const clean = await model(undefined, enriching)
    expect((await transition(clean, 'REVIEWED', ['c-web'])).data.codes).toEqual(['stale_ids_on_review'])
  })

  it('reports pending enrichment even when the model cannot be read', async () => {
    const dir = await model(undefined, enriching)
    await writePending(dir, { version: 1, entries: [entry()] })
    await fs.writeFile(path.join(dir, 'structure.json'), 'not json')
    const got = (await call({ action: 'get', directory_path: dir })).data
    expect(got.pending_enrichment).toMatchObject({ state: 'present', blocks: true, blocking: 1 })
  })
})

describe('model_state — display_state parts', () => {
  it('shows waivers, then stale, then pending enrichment, on any state', async () => {
    const { displayState } = await import('../model-state.tool.js')
    const waivers = [{ criterion: 'C3', id: 'f-a', status: 'in_use' }, { criterion: 'C3', id: 'f-b', status: 'in_use' }] as any
    const pending = { state: 'present', blocking: 3 } as any
    expect(displayState('REVIEWED', { waivers, pending }, true)).toBe('REVIEWED (2 waivers: C3×2, stale, 3 pending enrichment)')
    expect(displayState('STRUCTURE_COMPLETE', { waivers: [], pending }, false)).toBe('STRUCTURE_COMPLETE (3 pending enrichment)')
    expect(displayState('ENRICHING', { waivers: [], pending: { state: 'unreadable', blocking: 0 } as any }, false)).toBe('ENRICHING (pending enrichment unreadable)')
  })
})

describe('model_state — codes and the created flag', () => {
  it('refuses a state with an invalid currentState with a code, and merge_pulled repairs it without claiming to create it', async () => {
    const dir = await model(undefined, { currentState: 'DONE', completedStates: [] })
    const r = await call({ action: 'transition', directory_path: dir, to: 'ENRICHING' })
    expect(r.success).toBe(false)
    expect(r.data).toEqual({ codes: ['invalid_current_state'] })
    const merged = await call({ action: 'merge_pulled', directory_path: dir })
    expect(merged.success, merged.error).toBe(true)
    expect(merged.data.created).toBe(false)
  })

  it('reports created only when there was no state file', async () => {
    const dir = await model(undefined)
    const merged = await call({ action: 'merge_pulled', directory_path: dir })
    expect(merged.success, merged.error).toBe(true)
    expect(merged.data.created).toBe(true)
  })
})
