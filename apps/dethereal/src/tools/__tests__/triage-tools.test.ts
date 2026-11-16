/**
 * triage_review and manage_dispositions together, against a stub platform: a review opened on the model as read
 * then, replied to and closed, then prepared and committed. Every reply and every apply answer is recorded before
 * it counts, and a plan writes only exposures still as the review saw them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ToolContext } from '../base-tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { reviewStore } from '../../triage/store.js'
import { ECHO_BUDGET, MARKER_APPROVED, reviewEchoBound, todayIso } from '../../triage/dispositions.js'
import { LOG_LIMITS } from '../../triage/log.js'
import { reviewAsk } from '../../triage/asks.js'

const writes = vi.fn()
vi.mock('../../triage/dispositions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../triage/dispositions.js')>()
  return { ...real, writeOperations: (...args: unknown[]) => writes(...args) }
})

const { triageReviewTool } = await import('../triage-review.tool.js')
const { manageDispositionsTool } = await import('../manage-dispositions.tool.js')

const PLATFORM = 'http://127.0.0.1:9'
const URL_SAVED = process.env.DETHERNETY_URL
let tmp: string
let repo: string
let seq = 0

const raw = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `exp ${id}`, description: 'desc', type: '1', category: 'cat', score: 5, attackVector: 'NETWORK',
  createdBy: 'SYSTEM', authoredBy: null, dispositionKind: null, dispositionReason: null, dispositionedBy: null,
  dispositionedAt: null, dispositionStale: null, unresolvedReferences: null,
  exploitedBy: [{ attack_id: 'T1040' }], exploitedByAtlas: [], ...over,
})

/** The platform: exposures on one component, by id, which a test may change between calls. */
let exposures: Record<string, Record<string, unknown>>
const platformModel = () => ({
  id: 'model-1',
  name: 'Shop',
  dataItems: [],
  defaultBoundary: [{
    id: 'b-1', name: 'Edge', securityBoundaryClass: [], exposures: [], allDescendantBoundaries: [], allDescendantDataFlows: [],
    allDescendantComponents: [{ id: componentId, name: componentName, componentClass: [], exposures: Object.values(exposures) }],
  }],
})
/** The component's id and name, which a test may change between calls. */
let componentId = 'c-1'
let componentName = 'api'
/** What a platform may return for an exposure's element interface, which the evidence read neither asks for nor keeps. */
const PHANTOM_ELEMENTS = [{ id: 'other-1', name: 'Customer' }, { id: 'c-1', name: 'api' }]
const evidenceOf = (id: string) => {
  const e = exposures[id]
  return e && {
    ...e, references: 'ref', mitigationSuggestions: ['m'], detectionMethods: ['d'], tags: ['t'], techniques: ['T1040'],
    exploitedBy: [{ id: 'n-t1040', attack_id: 'T1040', name: 'Network Sniffing', description: null }], exploitedByAtlas: [],
    element: PHANTOM_ELEMENTS,
  }
}
const queries: string[] = []
let down = false
const query = async (o: { query: { definitions: Array<{ kind: string; name?: { value: string } }> }; variables?: Record<string, unknown> }) => {
  const name = o.query.definitions.find((d) => d.kind === 'OperationDefinition')?.name?.value ?? '?'
  queries.push(name)
  if (down) throw new Error('platform down')
  if (name === 'TriageModelExposures') return { data: { models: [platformModel()] } }
  if (name === 'TriageExposureEvidence') return { data: { exposures: [evidenceOf(o.variables!.exposureId as string)].filter(Boolean) } }
  if (name === 'TriageTechniqueIds') return { data: { mitreAttackTechniques: (o.variables!.ids as string[]).filter((id) => id === 'n-t1059').map((id) => ({ id, attack_id: 'T1059' })), mitreAtlasTechniques: [] } }
  throw new Error(`unexpected query ${name}`)
}
const context = { debug: false, apolloClient: { query } } as unknown as ToolContext

function modelDir(sync: Record<string, unknown> | null = { platform_model_id: 'model-1', platform_url: `${PLATFORM}/` }): string {
  const dir = path.join(repo, `model${seq++}`)
  fs.mkdirSync(path.join(dir, '.dethereal'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ model: { id: 'local', name: 'M' } }))
  if (sync) fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify(sync))
  return dir
}

const log = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'triage-log.json'), 'utf8'))
const codes = (r: { data?: unknown }) => (r.data as { codes?: string[] } | undefined)?.codes

const groups = [
  { group: 1, exposure_ids: ['e1', 'e2'], proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'the scanner misread it' } },
  { group: 2, exposure_ids: ['e3'], proposal: { op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'no listener' } },
  { group: 3, exposure_ids: ['e4'], needs_human: true },
]

const openInput = (dir: string, g: unknown[] = groups, mode = 'review') => ({ action: 'open', directory_path: dir, mode, groups: g })
async function open(dir: string, g: unknown[] = groups, mode = 'review'): Promise<string> {
  const r = await triageReviewTool.run(openInput(dir, g, mode), context)
  expect(r.success, r.error).toBe(true)
  return (r.data as { review_id: string }).review_id
}
const reply = (review_id: string, text: string) => triageReviewTool.run({ action: 'reply', review_id, reply: text }, context)

async function closedReview(dir: string, replies: string[] = ['accept 1', 'done']): Promise<string> {
  const id = await open(dir)
  for (const text of replies) expect((await reply(id, text)).success).toBe(true)
  return id
}

type Prepared = { success: boolean; error?: string; data: { plan_id: string; count: number; lines: string[]; operations: Array<{ status: string; code?: string }>; codes?: string[] } }
const prepare = async (dir: string, review_id: string) => (await manageDispositionsTool.run({ action: 'prepare', directory_path: dir, review_id }, context)) as Prepared
const commit = (dir: string, plan_id: string, lines: string[], text: string) =>
  manageDispositionsTool.run({ action: 'commit', directory_path: dir, plan_id, lines, reply: text }, context)

type Op = { index: number; exposure_id: string; op: string; status: string }
const applied = async (_client: unknown, ops: Op[]) =>
  ops.filter((o) => o.status === 'ready').map((o) => ({ index: o.index, exposure_id: o.exposure_id, op: o.op, status: 'applied' }))

beforeEach(() => {
  process.env.DETHERNETY_URL = PLATFORM
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-tools-')))
  repo = path.join(tmp, 'repo')
  fs.mkdirSync(repo)
  initProjectRoot({ cwd: repo, env: {} })
  reviewStore.clear()
  manageDispositionsTool.plans.clear()
  manageDispositionsTool.plans.clockOffsetMs = 0
  exposures = Object.fromEntries(['e1', 'e2', 'e3', 'e4'].map((id) => [id, raw(id)]))
  queries.length = 0
  down = false
  componentId = 'c-1'
  componentName = 'api'
  writes.mockReset()
  writes.mockImplementation(applied)
})
afterEach(() => {
  resetProjectRoot()
  if (URL_SAVED === undefined) delete process.env.DETHERNETY_URL
  else process.env.DETHERNETY_URL = URL_SAVED
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('triage_review open', () => {
  it('reads the model once, records the review, and states the grammar', async () => {
    const dir = modelDir()
    const r = await triageReviewTool.run(openInput(dir), context)
    expect(r.success, r.error).toBe(true)
    const data = r.data as { review_id: string; groups: number; grammar: string }
    expect(data.review_id).toMatch(/^[0-9a-f]{32}$/)
    expect(data.groups).toBe(3)
    expect(data.grammar).toMatch(/^one command per reply: accept/)
    expect(queries).toEqual(['TriageModelExposures'])
    expect(log(dir).reviews).toEqual([expect.objectContaining({ review_id: data.review_id, mode: 'review', groups: 3, replies: [], applies: [] })])
    expect(fs.readFileSync(path.join(dir, '.dethereal', '.gitignore'), 'utf8')).toContain('triage-log.json')
  })

  it('reads a supersede target\'s evidence and the techniques it adds', async () => {
    const dir = modelDir()
    await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { techniques: { add: ['n-t1059'], remove: [] } }, verified_technique_ids: ['n-t1059'] } }])
    expect(queries).toEqual(['TriageModelExposures', 'TriageExposureEvidence', 'TriageTechniqueIds'])
  })

  it('refuses an exposure not in the model, naming it, and holds nothing', async () => {
    const dir = modelDir()
    const r = await triageReviewTool.run(openInput(dir, [{ group: 1, exposure_ids: ['e1', 'nope'], proposal: groups[0]!.proposal }]), context)
    expect(codes(r)).toEqual(['not_in_model'])
    expect(r.data).toMatchObject({ exposures: ['nope'] })
    expect(reviewStore.size).toBe(0)
  })

  it('refuses a stale review of an exposure that is not stale', async () => {
    const dir = modelDir()
    exposures.e1 = raw('e1', { dispositionKind: 'NOT_APPLICABLE', dispositionStale: true, dispositionReason: 'r', dispositionedBy: 'op' })
    const r = await triageReviewTool.run(openInput(dir, [{ group: 1, exposure_ids: ['e1', 'e2'], proposal: { op: 'clear' } }], 'stale'), context)
    expect(codes(r)).toEqual(['target_changed'])
    expect(r.data).toMatchObject({ exposures: ['e2'] })
  })

  it('refuses proposals the platform would refuse, with each one and why', async () => {
    const dir = modelDir()
    const r = await triageReviewTool.run(openInput(dir, [{ group: 1, exposure_ids: ['e2'], proposal: { op: 'supersede', modifications: { techniques: { add: [], remove: ['n-not-on-it'] } } } }]), context)
    expect(codes(r)).toEqual(['remove_not_present'])
    expect(r.data).toMatchObject({ exposures: [{ group: 1, exposure_id: 'e2', code: 'remove_not_present' }] })
  })

  it.each([
    ['decided since it was listed', { dispositionKind: 'SUPERSEDED', dispositionReason: 'copied', dispositionedBy: 'op' }],
    ['affirmed by someone', { dispositionKind: 'AFFIRMED', dispositionReason: 'seen', dispositionedBy: 'op' }],
    ['created by USER', { createdBy: 'USER', dispositionKind: 'AFFIRMED', dispositionedBy: null }],
  ])('refuses a review of an exposure not pending triage now (%s), opening nothing', async (_label, over) => {
    const dir = modelDir()
    exposures.e2 = raw('e2', over)
    const r = await triageReviewTool.run(openInput(dir), context)
    expect(codes(r)).toEqual(['target_changed'])
    expect(r.data).toMatchObject({ exposures: ['e2'] })
    expect(r.data).not.toHaveProperty('ask')
    expect(reviewStore.size).toBe(0)
  })

  it('refuses groups that are wrong on their own before reading anything', async () => {
    const r = await triageReviewTool.run(openInput(modelDir(), [groups[0], { ...groups[1], group: 1 }]), context)
    expect(codes(r)).toEqual(['argument_invalid'])
    expect(queries).toEqual([])
  })

  it('refuses a directory that names no platform model, or another platform, before reading anything', async () => {
    expect(codes(await triageReviewTool.run(openInput(modelDir(null)), context))).toEqual(['not_synced'])
    expect(codes(await triageReviewTool.run(openInput(modelDir({ platform_model_id: 'model-1', platform_url: 'https://platform.example.test' })), context))).toEqual(['other_platform'])
    expect(queries).toEqual([])
  })

  it('refuses a second open while a review of the directory is open, naming it; get resumes it', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const again = await triageReviewTool.run(openInput(dir), context)
    expect(codes(again)).toEqual(['review_open'])
    expect(again.data).toMatchObject({ review_id: id })
    expect((await triageReviewTool.run({ action: 'get', review_id: id }, context)).success).toBe(true)
    await reply(id, 'done')
    expect((await triageReviewTool.run(openInput(dir), context)).success).toBe(true)
  })

  it(`refuses a review of more than 200 exposures at open`, async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `y${i}`)
    for (const id of ids) exposures[id] = raw(id)
    const r = await triageReviewTool.run(openInput(modelDir(), [{ group: 1, exposure_ids: ids.slice(0, 200), proposal: groups[0]!.proposal }, { group: 2, exposure_ids: ids.slice(200), proposal: groups[0]!.proposal }]), context)
    expect(codes(r)).toEqual(['review_too_long'])
  })

  it('needs a signed-in session to open', async () => {
    const r = await triageReviewTool.run(openInput(modelDir()), { debug: false })
    expect(r.error).toMatch(/login/)
  })

  it('refuses a directory outside the project, or one that is not a model', async () => {
    const outside = fs.mkdtempSync(path.join(tmp, 'outside-'))
    expect((await triageReviewTool.run(openInput(outside), context)).success).toBe(false)
    const plain = path.join(repo, 'plain')
    fs.mkdirSync(path.join(plain, '.dethereal'), { recursive: true })
    fs.writeFileSync(path.join(plain, '.dethereal', 'sync.json'), JSON.stringify({ platform_model_id: 'model-1', platform_url: PLATFORM }))
    expect(codes(await triageReviewTool.run(openInput(plain), context))).toEqual(['not_model_dir'])
    expect(reviewStore.size).toBe(0)
  })

  describe('at the echo budget', () => {
    const ids = Array.from({ length: 140 }, (_, i) => `x${i}`)
    const big = (reasonChars: number) => [{ group: 1, exposure_ids: ids, proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'r'.repeat(reasonChars) } }]
    /** The reason length whose review's bound is exactly the budget, found with the bound itself. */
    async function atBudget(dir: string): Promise<number> {
      const probe = await open(dir, big(100))
      const bound = reviewEchoBound(reviewStore.get(probe)!, todayIso())
      reviewStore.clear()
      return 100 + (ECHO_BUDGET - bound)
    }

    beforeEach(() => {
      for (const id of ids) exposures[id] = raw(id, { name: `exposure number ${id}` })
    })

    it('opens a review whose plan takes the budget exactly, and refuses one character more', async () => {
      const dir = modelDir()
      const chars = await atBudget(dir)
      expect(chars).toBeGreaterThan(100)
      expect(chars).toBeLessThanOrEqual(1800)
      const fits = await triageReviewTool.run(openInput(dir, big(chars)), context)
      expect(fits.success, fits.error).toBe(true)
      expect(reviewEchoBound(reviewStore.get((fits.data as { review_id: string }).review_id)!, todayIso())).toBe(ECHO_BUDGET)
      reviewStore.clear()
      const over = await triageReviewTool.run(openInput(dir, big(chars + 1)), context)
      expect(codes(over)).toEqual(['echo_too_large'])
    })

    it('prepares the review it opened within the budget', async () => {
      const dir = modelDir()
      const id = await open(dir, big(await atBudget(dir)))
      await reply(id, 'accept-all')
      const p = await prepare(dir, id)
      expect(p.success, p.error).toBe(true)
      expect(JSON.stringify({ count: p.data.count, operations: p.data.operations, lines: p.data.lines }).length).toBeLessThanOrEqual(ECHO_BUDGET)
    })

    it('refuses an accept of a skipped group that would take the plan over the budget', async () => {
      const dir = modelDir()
      const two = (firstReason: number) => [
        { group: 1, exposure_ids: ids.slice(0, 80), proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'r'.repeat(firstReason) } },
        { group: 2, exposure_ids: ids.slice(80), proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'short' } },
      ]
      const probe = await open(dir, two(100))
      const firstReason = 100 + (ECHO_BUDGET - reviewEchoBound(reviewStore.get(probe)!, todayIso())) - 100
      reviewStore.clear()
      const id = await open(dir, two(firstReason))
      // Group 1 skipped leaves room for a long rationale on group 2; taking group 1 back would not fit.
      expect((await reply(id, 'skip 1')).success).toBe(true)
      expect((await reply(id, `edit 2 kind: NOT_APPLICABLE rationale: ${'q'.repeat(1800)}`)).success).toBe(true)
      const r = await reply(id, 'accept 1')
      expect(codes(r)).toEqual(['echo_too_large'])
      expect(reviewStore.get(id)!.decisions.get(1)).toEqual({ decision: 'skip' })
      expect(reviewEchoBound(reviewStore.get(id)!, todayIso())).toBeLessThanOrEqual(ECHO_BUDGET)
    })

    it('refuses an edit that would take the plan over the budget, changing nothing', async () => {
      const dir = modelDir()
      const chars = await atBudget(dir)
      const id = await open(dir, big(chars - 20))
      // The rationale with its (shorter) marker outgrows the proposed reason with its own by more than the 20 left.
      const r = await reply(id, `edit 1 kind: FALSE_POSITIVE rationale: ${'q'.repeat(chars + 10)}`)
      expect(codes(r)).toEqual(['echo_too_large'])
      expect(reviewStore.get(id)!.decisions.get(1)).toEqual({ decision: 'pending' })
      expect(log(dir).reviews.find((x: { review_id: string }) => x.review_id === id).replies.at(-1).outcome).toEqual({ refused: 'echo_too_large' })
    })
  })
})

describe('triage_review tasks: the input', () => {
  it('has no lint action left, and takes run, text and guides only with tasks', async () => {
    expect((await triageReviewTool.run({ action: 'lint', text: 'x' }, context)).error).toMatch(/^Invalid input/)
    for (const input of [
      { action: 'tasks', run: 'run-20261115-001500', text: 'x' },
      { action: 'tasks', directory_path: '.', text: 'x' },
      { action: 'tasks', directory_path: '.', run: 'run-20261115-001500' },
      { action: 'tasks', directory_path: '.', run: '../run-20261115-001500', text: 'x' },
      { action: 'tasks', directory_path: '.', run: 'run-2026111-001500', text: 'x' },
      { action: 'tasks', directory_path: '.', run: 'run-20261115-001500', text: 'x'.repeat(65_537) },
      { action: 'tasks', directory_path: '.', run: 'run-20261115-001500', text: 'x', review_id: 'a'.repeat(32) },
      { action: 'tasks', directory_path: '.', run: 'run-20261115-001500', text: 'x', guides: [{ class_id: 'c', element_kind: 'router', attribute_keys: ['a'] }] },
      { action: 'tasks', directory_path: '.', run: 'run-20261115-001500', text: 'x', guides: [{ class_id: 'c', element_kind: 'component', attribute_keys: Array.from({ length: 21 }, (_, i) => `k${i}`) }] },
      { action: 'tasks', directory_path: '.', run: 'run-20261115-001500', text: 'x', guides: Array.from({ length: 51 }, () => ({ class_id: 'c', element_kind: 'component', attribute_keys: ['a'] })) },
      { action: 'get', review_id: 'a'.repeat(32), text: 'x' },
      { action: 'get', review_id: 'a'.repeat(32), run: 'run-20261115-001500' },
      { action: 'reply', review_id: 'a'.repeat(32), reply: 'x', directory_path: '.' },
    ]) expect((await triageReviewTool.run(input, context)).error, JSON.stringify(input).slice(0, 80)).toMatch(/^Invalid input/)
  })
})

describe('triage_review reply', () => {
  it('records every reply verbatim, taken or refused, and counts only the taken ones', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const taken = await reply(id, '  Accept 1  ')
    expect(taken.success).toBe(true)
    expect(taken.data).toMatchObject({ command: { verb: 'accept', groups: [1] }, closed: false })
    const refused = await reply(id, 'looks fine to me')
    expect(codes(refused)).toEqual(['reply_unparsed'])
    expect(log(dir).reviews[0].replies).toEqual([
      { at: expect.any(String), reply: '  Accept 1  ', outcome: { verb: 'accept' } },
      { at: expect.any(String), reply: 'looks fine to me', outcome: { refused: 'reply_unparsed' } },
    ])
    expect(reviewStore.get(id)!.replies).toBe(1)
  })

  it('refuses a reply holding a control character, and records it by its start, length and hash', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const r = await reply(id, 'accept 1\x07')
    expect(codes(r)).toEqual(['text_invalid'])
    expect(log(dir).reviews[0].replies[0]).toMatchObject({ reply_start: 'accept 1\x07', reply_length: 9, outcome: { refused: 'text_invalid' } })
    expect(reviewStore.get(id)!.decisions.get(1)!.decision).toBe('pending')
  })

  it('takes nothing when the reply cannot be recorded', async () => {
    const dir = modelDir()
    const id = await open(dir)
    fs.writeFileSync(path.join(dir, '.dethereal', 'triage-log.json'), '{broken')
    expect(codes(await reply(id, 'accept 1'))).toEqual(['record_unwritable'])
    expect(reviewStore.get(id)!.decisions.get(1)!.decision).toBe('pending')
    expect(reviewStore.get(id)!.replies).toBe(0)
  })

  it('takes replies to one review one at a time, so none is lost', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const results = await Promise.all([reply(id, 'accept 1'), reply(id, 'skip 2'), reply(id, 'done')])
    expect(results.map((r) => r.success)).toEqual([true, true, true])
    expect(reviewStore.get(id)!.decisions.get(1)!.decision).toBe('accept')
    expect(reviewStore.get(id)!.decisions.get(2)!.decision).toBe('skip')
    expect(reviewStore.get(id)!.closed).toBe(true)
  })

  it('refuses a reply once the record of the review is full, but still takes a closing one', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const entry = log(dir)
    entry.reviews[0].replies = Array.from({ length: LOG_LIMITS.replies }, () => ({ at: 'T', reply: 'skip 1', outcome: { verb: 'skip' } }))
    fs.writeFileSync(path.join(dir, '.dethereal', 'triage-log.json'), JSON.stringify(entry))
    expect(codes(await reply(id, 'accept 1'))).toEqual(['record_full'])
    expect(log(dir).reviews[0].replies).toHaveLength(LOG_LIMITS.replies)
    // A refusal changes nothing, so it keeps its own code, unrecorded.
    const refused = await reply(id, 'hello')
    expect(codes(refused)).toEqual(['reply_unparsed'])
    expect(refused.data).toMatchObject({ recorded: false })
    expect((await reply(id, 'done')).success).toBe(true)
    expect(log(dir).reviews[0].replies).toHaveLength(LOG_LIMITS.replies + 1)
  })

  it('returns the decisions, and refuses an unknown review', async () => {
    const dir = modelDir()
    const id = await open(dir)
    await reply(id, 'skip 2')
    const got = await triageReviewTool.run({ action: 'get', review_id: id }, context)
    expect(got.data).toEqual({ review_id: id, mode: 'review', closed: false, groups, decisions: [{ group: 1, decision: 'pending' }, { group: 2, decision: 'skip' }, { group: 3, decision: 'pending' }], ask: reviewAsk('review') })
    expect(codes(await triageReviewTool.run({ action: 'get', review_id: 'f'.repeat(32) }, context))).toEqual(['review_not_found'])
  })

  it.each([
    [{ action: 'open', mode: 'review', groups }],
    [{ action: 'reply', review_id: 'a'.repeat(32) }],
    [{ action: 'get', review_id: 'not-hex' }],
    [{ action: 'get', review_id: 'a'.repeat(32), reply: 'x' }],
    [{ action: 'reply', review_id: 'a'.repeat(32), reply: 'x', mode: 'review' }],
    [{ action: 'open', directory_path: '.', mode: 'review', groups, review_id: 'a'.repeat(32) }],
    [{ action: 'get', review_id: 'a'.repeat(32), extra: 1 }],
    [{ action: 'open', directory_path: '.', mode: 'review', groups: [{ group: 1, exposure_ids: ['a'], proposal: { op: 'supersede', modifications: { score: 11 } } }] }],
  ])('refuses the input %j', async (input) => {
    const r = await triageReviewTool.run(input, context)
    expect(r.error).toMatch(/^Invalid input/)
  })
})

describe('manage_dispositions prepare', () => {
  it('plans a closed review: the model line first, the ready count, every operation', async () => {
    const dir = modelDir()
    const id = await closedReview(dir)
    queries.length = 0
    const r = await prepare(dir, id)
    expect(r.success, r.error).toBe(true)
    expect(r.data.plan_id).toMatch(/^[0-9a-f]{32}$/)
    expect(r.data.count).toBe(2)
    expect(r.data.lines).toEqual([
      'Platform model "Shop" (model-1)',
      '2 write(s): 2 dispose, 0 supersede, 0 clear, 0 reaffirm; 0 replace a disposition; 0 set COMPENSATING_CONTROL or RISK_ACCEPTED; 0 not applied',
      `Group 1: dispose as FALSE_POSITIVE with "the scanner misread it${MARKER_APPROVED}": "exp e1" on "api" #e1; "exp e2" on "api" #e2`,
    ])
    expect(queries).toEqual(['TriageModelExposures'])
  })

  it('rejects an exposure changed since the review was opened, or gone, listing it apart', async () => {
    const dir = modelDir()
    const id = await closedReview(dir)
    exposures.e1 = raw('e1', { dispositionKind: 'AFFIRMED', dispositionReason: 'someone else', dispositionedBy: 'op' })
    delete exposures.e2
    const r = await prepare(dir, id)
    expect(r.data.count).toBe(0)
    expect(r.data.operations.map((o) => [o.status, o.code])).toEqual([['rejected', 'target_changed'], ['rejected', 'not_in_model']])
    expect(r.data.lines.slice(2)).toEqual([
      'Not applied (target_changed): the exposure changed since the review was opened: open a new review: "exp e1" on "api" #e1',
      'Not applied (not_in_model): the exposure is not in this model on the platform: "exp e2" on "api" #e2',
    ])
  })

  it('plans a review that decided nothing: zero operations', async () => {
    const dir = modelDir()
    const r = await prepare(dir, await closedReview(dir, ['done']))
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ count: 0, operations: [] })
    expect(r.data.lines).toHaveLength(2)
  })

  it('plans a supersede from fresh evidence', async () => {
    const dir = modelDir()
    const id = await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { score: 2 } } }])
    await reply(id, 'accept 1')
    await reply(id, 'done')
    queries.length = 0
    const r = await prepare(dir, id)
    expect(queries).toEqual(['TriageModelExposures', 'TriageExposureEvidence'])
    expect(r.data.lines[2]).toMatch(/^Group 1: supersede "exp e1" on "api" #e1: create "exp e1 \(custom\)" on "api"; score 5 → 2;/)
  })

  it('rejects a supersede whose element was renamed since the review was opened, so the echo stays within its bound', async () => {
    const dir = modelDir()
    const id = await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { score: 2 } } }])
    await reply(id, 'accept 1')
    await reply(id, 'done')
    componentName = 'a'.repeat(400)
    const r = await prepare(dir, id)
    expect(r.data.operations).toMatchObject([{ status: 'rejected', code: 'target_changed' }])
    expect(JSON.stringify({ count: r.data.count, operations: r.data.operations, lines: r.data.lines }).length).toBeLessThanOrEqual(reviewEchoBound(reviewStore.get(id)!, todayIso()))
  })

  it('plans a supersede\'s copy on the element of the model read, whatever the platform lists over the element interface', async () => {
    const dir = modelDir()
    const id = await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { score: 2 } } }])
    await reply(id, 'accept 1')
    await reply(id, 'done')
    const r = await prepare(dir, id)
    expect(r.data.operations).toMatchObject([{ status: 'ready', clone: { element_id: 'c-1', element_name: 'api' } }])
    expect(r.data.lines.join('\n')).not.toContain('Customer')
  })

  it('keeps the echo within the bound open measured when fewer exposures are written, their short ids shorter', async () => {
    const dir = modelDir()
    const ids = ['p-x11112222', 'p-y11112222']
    for (const e of ids) exposures[e] = raw(e)
    const id = await open(dir, ids.map((e, i) => ({ group: i + 1, exposure_ids: [e], proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'r' } })))
    const bound = reviewEchoBound(reviewStore.get(id)!, todayIso())
    await reply(id, 'accept 1')
    await reply(id, 'done')
    const r = await prepare(dir, id)
    expect(r.data.lines.join('\n')).toContain('"exp p-x11112222" on "api" #…11112222')
    expect(JSON.stringify({ count: r.data.count, operations: r.data.operations, lines: r.data.lines }).length).toBeLessThanOrEqual(bound)
  })

  it('refuses an unknown review, an open one, and one opened for another directory', async () => {
    const dir = modelDir()
    expect(codes(await prepare(dir, 'f'.repeat(32)))).toEqual(['review_not_found'])
    const id = await open(dir)
    expect(codes(await prepare(dir, id))).toEqual(['review_open'])
    await reply(id, 'done')
    expect(codes(await prepare(modelDir(), id))).toEqual(['other_model'])
  })

  it('refuses when the directory now names another platform model than the review', async () => {
    const dir = modelDir()
    const id = await closedReview(dir)
    fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify({ platform_model_id: 'model-2', platform_url: PLATFORM }))
    expect(codes(await prepare(dir, id))).toEqual(['other_model'])
  })
})

describe('manage_dispositions commit', () => {
  async function planned(dir: string) {
    const p = await prepare(dir, await closedReview(dir))
    expect(p.success, p.error).toBe(true)
    return p.data
  }

  it('records the yes before writing, then its outcome, and commits only once', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    let recordedFirst: unknown
    writes.mockImplementationOnce(async (client: unknown, ops: Op[]) => {
      recordedFirst = log(dir).reviews[0].applies.at(-1)
      return applied(client, ops)
    })
    const r = await commit(dir, p.plan_id, p.lines, 'Yes (Recommended)')
    expect(r.success, r.error).toBe(true)
    expect(r.data).toMatchObject({ plan_id: p.plan_id, written: 2, failed: 0 })
    expect(recordedFirst).toEqual({ at: expect.any(String), plan_id: p.plan_id, reply: 'Yes (Recommended)', outcome: { answer: 'yes' } })
    expect(log(dir).reviews[0].applies).toEqual([{ at: expect.any(String), plan_id: p.plan_id, reply: 'Yes (Recommended)', outcome: { written: 2, failed: 0 } }])
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['plan_used'])
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('writes nothing on a yes it cannot record, and keeps the plan', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    const file = path.join(dir, '.dethereal', 'triage-log.json')
    const saved = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, '{broken')
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['record_unwritable'])
    expect(writes).not.toHaveBeenCalled()
    fs.writeFileSync(file, saved)
    expect((await commit(dir, p.plan_id, p.lines, 'yes')).success).toBe(true)
  })

  it('writes nothing on cancel, and ends the plan', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    const r = await commit(dir, p.plan_id, p.lines, 'cancel')
    expect(r.data).toMatchObject({ cancelled: true, written: 0 })
    expect(writes).not.toHaveBeenCalled()
    expect(log(dir).reviews[0].applies[0].outcome).toEqual({ cancelled: true })
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['plan_used'])
  })

  it('refuses lines that differ from the plan, and an answer that is neither, keeping the plan', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    expect(codes(await commit(dir, p.plan_id, [...p.lines.slice(1)], 'yes'))).toEqual(['lines_differ'])
    expect(codes(await commit(dir, p.plan_id, p.lines, 'sure'))).toEqual(['reply_not_answer'])
    expect(writes).not.toHaveBeenCalled()
    expect(log(dir).reviews[0].applies.map((a: { reply: string; outcome: unknown }) => [a.reply, a.outcome])).toEqual([
      ['yes', { refused: 'lines_differ' }],
      ['sure', { refused: 'reply_not_answer' }],
    ])
    expect((await commit(dir, p.plan_id, p.lines, 'yes')).success).toBe(true)
  })

  it('refuses refused answers past their limit, and still takes a yes', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    for (let i = 0; i < LOG_LIMITS.refusedAnswers; i++) expect(codes(await commit(dir, p.plan_id, p.lines, 'sure'))).toEqual(['reply_not_answer'])
    expect(codes(await commit(dir, p.plan_id, p.lines, 'sure'))).toEqual(['record_full'])
    expect(writes).not.toHaveBeenCalled()
    expect((await commit(dir, p.plan_id, p.lines, 'yes')).success).toBe(true)
  })

  it('refuses a commit whose supersede copy was created since prepare', async () => {
    const dir = modelDir()
    const id = await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { score: 2 } } }])
    await reply(id, 'accept-all')
    const p = (await prepare(dir, id)).data
    exposures.copy = raw('copy', { name: 'exp e1 (custom)', createdBy: 'USER' })
    const r = await commit(dir, p.plan_id, p.lines, 'yes')
    expect(codes(r)).toEqual(['plan_stale'])
    expect((r.data as { changed: string[] }).changed).toEqual(['e1'])
    expect(writes).not.toHaveBeenCalled()
  })

  it('refuses a commit whose supersede source is on another element since prepare', async () => {
    const dir = modelDir()
    const id = await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { score: 2 } } }])
    await reply(id, 'accept-all')
    const p = (await prepare(dir, id)).data
    componentId = 'c-2'
    const r = await commit(dir, p.plan_id, p.lines, 'yes')
    expect(codes(r)).toEqual(['plan_stale'])
    expect((r.data as { changed: string[] }).changed).toEqual(['e1'])
    expect(writes).not.toHaveBeenCalled()
  })

  it('refuses a plan whose exposures changed since prepare, writing nothing, for good', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    exposures.e2 = raw('e2', { dispositionKind: 'AFFIRMED', dispositionReason: 'someone else', dispositionedBy: 'op', dispositionedAt: '2026-11-11T00:00:00Z' })
    const r = await commit(dir, p.plan_id, p.lines, 'yes')
    expect(codes(r)).toEqual(['plan_stale'])
    expect((r.data as { changed: string[] }).changed).toEqual(['e2'])
    expect(writes).not.toHaveBeenCalled()
    expect(log(dir).reviews[0].applies.at(-1).outcome).toEqual({ refused: 'plan_stale' })
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['plan_stale'])
  })

  it('ignores a change to an exposure the plan does not touch', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    exposures.e3 = raw('e3', { dispositionKind: 'AFFIRMED', dispositionedBy: 'op' })
    expect((await commit(dir, p.plan_id, p.lines, 'yes')).success).toBe(true)
  })

  it('ends the plan as failed when a write fails', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    writes.mockResolvedValueOnce([{ index: 0, exposure_id: 'e1', op: 'dispose', status: 'applied' }, { index: 1, exposure_id: 'e2', op: 'dispose', status: 'failed', error: 'refused' }])
    const r = await commit(dir, p.plan_id, p.lines, 'yes')
    expect(r.data).toMatchObject({ written: 1, failed: 1 })
    const again = await commit(dir, p.plan_id, p.lines, 'yes')
    expect(codes(again)).toEqual(['plan_used'])
    expect(again.error).toMatch(/some of its writes failed/)
  })

  it('lets a plan be committed again after the re-read fails', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    down = true
    expect((await commit(dir, p.plan_id, p.lines, 'yes')).error).toMatch(/platform down/)
    down = false
    expect(log(dir).reviews[0].applies.at(-1).outcome).toEqual({ refused: 'model_unread' })
    expect((await commit(dir, p.plan_id, p.lines, 'yes')).success).toBe(true)
  })

  it('refuses a second commit of a plan while the first runs', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    let release!: () => void
    writes.mockImplementationOnce(async (client: unknown, ops: Op[]) => {
      await new Promise<void>((r) => (release = r))
      return applied(client, ops)
    })
    const first = commit(dir, p.plan_id, p.lines, 'yes')
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['busy'])
    release()
    expect((await first).success).toBe(true)
  })

  it('commits two plans of one directory one at a time, so the later finds what the first wrote', async () => {
    const dir = modelDir()
    const id = await closedReview(dir)
    const a = (await prepare(dir, id)).data
    const b = (await prepare(dir, id)).data
    writes.mockImplementation(async (client: unknown, ops: Op[]) => {
      for (const o of ops) if (o.status === 'ready') exposures[o.exposure_id] = raw(o.exposure_id, { dispositionKind: 'FALSE_POSITIVE', dispositionReason: 'x', dispositionedBy: 'op' })
      return applied(client, ops)
    })
    const results = await Promise.all([commit(dir, a.plan_id, a.lines, 'yes'), commit(dir, b.plan_id, b.lines, 'yes')])
    expect(results.map((r) => (r.success ? 'ok' : codes(r)?.[0] ?? r.error)).sort()).toEqual(['ok', 'plan_stale'])
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('commits plans of two directories synced to one model one at a time, so the later finds what the first wrote', async () => {
    const [one, two] = [modelDir(), modelDir()]
    const a = (await prepare(one, await closedReview(one))).data
    const b = (await prepare(two, await closedReview(two))).data
    writes.mockImplementation(async (client: unknown, ops: Op[]) => {
      // A slow write: the other commit would read the model meanwhile, were it not held back.
      await new Promise((resolve) => setTimeout(resolve, 100))
      for (const o of ops) if (o.status === 'ready') exposures[o.exposure_id] = raw(o.exposure_id, { dispositionKind: 'FALSE_POSITIVE', dispositionReason: 'x', dispositionedBy: 'op' })
      return applied(client, ops)
    })
    const results = await Promise.all([commit(one, a.plan_id, a.lines, 'yes'), commit(two, b.plan_id, b.lines, 'yes')])
    expect(results.map((r) => (r.success ? 'ok' : codes(r)?.[0] ?? r.error)).sort()).toEqual(['ok', 'plan_stale'])
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown plan, an expired one, and one for another directory', async () => {
    const dir = modelDir()
    expect(codes(await commit(dir, 'f'.repeat(32), [], 'yes'))).toEqual(['plan_not_found'])
    const p = await planned(dir)
    expect(codes(await commit(modelDir(), p.plan_id, p.lines, 'yes'))).toEqual(['plan_other_model'])
    manageDispositionsTool.plans.clockOffsetMs = 31 * 60 * 1000
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['plan_expired'])
  })

  it('refuses for good a commit when the directory now names another model', async () => {
    const dir = modelDir()
    const p = await planned(dir)
    fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify({ platform_model_id: 'model-2', platform_url: PLATFORM }))
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['plan_stale'])
    expect(writes).not.toHaveBeenCalled()
    fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify({ platform_model_id: 'model-1', platform_url: PLATFORM }))
    expect(codes(await commit(dir, p.plan_id, p.lines, 'yes'))).toEqual(['plan_stale'])
  })

  it.each([
    [{ action: 'prepare', directory_path: '.' }],
    [{ action: 'commit', directory_path: '.', plan_id: 'a'.repeat(32), lines: [] }],
    [{ action: 'commit', directory_path: '.', plan_id: 'a'.repeat(32), reply: 'yes' }],
    [{ action: 'prepare', directory_path: '.', review_id: 'a'.repeat(32), reply: 'yes' }],
    [{ action: 'commit', directory_path: '.', plan_id: 'a'.repeat(32), lines: [], reply: 'yes', review_id: 'a'.repeat(32) }],
  ])('refuses the input %j', async (input) => {
    const r = await manageDispositionsTool.run(input, context)
    expect(r.error).toMatch(/^Invalid input/)
  })
})

describe('the next question, returned as ask', () => {
  const REVIEW_Q = '[prompt: triage-review] Your command? One command per reply: accept, skip, show, edit, accept-all or done, as the hint above shows.'
  const STALE_Q = '[prompt: triage-stale-review] Your command? One command per reply: reaffirm, clear, skip, show or done, as the hint above shows.'
  const askOf = (r: { data?: unknown }) => (r.data as { ask?: string } | undefined)?.ask

  it('open and every reply of an open review carry the review question; a closing reply none', async () => {
    const dir = modelDir()
    const opened = await triageReviewTool.run(openInput(dir), context)
    expect(askOf(opened)).toBe(REVIEW_Q)
    const id = (opened.data as { review_id: string }).review_id
    expect(askOf(await reply(id, 'skip 2'))).toBe(REVIEW_Q)
    expect(askOf(await reply(id, 'show 1'))).toBe(REVIEW_Q)
    const closing = await reply(id, 'accept-all')
    expect(closing.success).toBe(true)
    expect(closing.data).not.toHaveProperty('ask')
    const got = await triageReviewTool.run({ action: 'get', review_id: id }, context)
    expect(got.data).toMatchObject({ closed: true })
    expect(got.data).not.toHaveProperty('ask')
  })

  it('done closes the review with no question', async () => {
    const id = await open(modelDir())
    expect(await reply(id, 'done')).not.toHaveProperty('data.ask')
  })

  it('a stale review carries its own question', async () => {
    const dir = modelDir()
    exposures.e1 = raw('e1', { dispositionKind: 'NOT_APPLICABLE', dispositionStale: true, dispositionReason: 'r', dispositionedBy: 'op' })
    const opened = await triageReviewTool.run(openInput(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'reaffirm' } }], 'stale'), context)
    expect(opened.success, opened.error).toBe(true)
    expect(askOf(opened)).toBe(STALE_Q)
    const id = (opened.data as { review_id: string }).review_id
    expect(askOf(await reply(id, 'hello'))).toBe(STALE_Q)
    expect(askOf(await triageReviewTool.run({ action: 'get', review_id: id }, context))).toBe(STALE_Q)
  })

  it.each([
    ['reply_unparsed', 'hello'],
    ['verb_not_in_mode', 'reaffirm 1'],
    ['argument_invalid', 'accept'],
    ['group_unknown', 'accept 9'],
    ['edit_invalid', 'edit 1 colour: red'],
    ['needs_operator_decision', 'accept 3'],
    ['text_invalid', 'accept 1​'],
  ])('a parser refusal (%s) carries the question in its data', async (code, text) => {
    const id = await open(modelDir())
    const r = await reply(id, text)
    expect(codes(r)).toEqual([code])
    expect(askOf(r)).toBe(REVIEW_Q)
  })

  it('the reply-count record_full carries the question; the byte cap is record_too_large, a stop with none', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const entry = log(dir)
    entry.reviews[0].replies = Array.from({ length: LOG_LIMITS.replies }, () => ({ at: 'T', reply: 'skip 1', outcome: { verb: 'skip' } }))
    fs.writeFileSync(path.join(dir, '.dethereal', 'triage-log.json'), JSON.stringify(entry))
    const full = await reply(id, 'accept 1')
    expect(codes(full)).toEqual(['record_full'])
    expect(askOf(full)).toBe(REVIEW_Q)
    const refused = await reply(id, 'hello')
    expect(refused.data).toMatchObject({ recorded: false, ask: REVIEW_Q })

    const dir2 = path.join(repo, `big-${seq++}`)
    fs.cpSync(dir, dir2, { recursive: true })
    fs.rmSync(path.join(dir2, '.dethereal', 'triage-log.json'))
    const id2 = await open(dir2)
    const big = log(dir2)
    big.reviews[0].replies = Array.from({ length: 60 }, () => ({ at: 'T', reply: 'r'.repeat(16_000), outcome: { verb: 'skip' } }))
    fs.writeFileSync(path.join(dir2, '.dethereal', 'triage-log.json'), JSON.stringify(big))
    for (const text of ['skip 1', 'done']) {
      const r = await reply(id2, text)
      expect(codes(r)).toEqual(['record_too_large'])
      expect(r.data).not.toHaveProperty('ask')
    }
  })

  it('a reply to a review closed at the reply count keeps review_closed, unrecorded, with no question', async () => {
    const dir = modelDir()
    const id = await open(dir)
    const entry = log(dir)
    entry.reviews[0].replies = Array.from({ length: LOG_LIMITS.replies }, () => ({ at: 'T', reply: 'skip 1', outcome: { verb: 'skip' } }))
    fs.writeFileSync(path.join(dir, '.dethereal', 'triage-log.json'), JSON.stringify(entry))
    expect((await reply(id, 'done')).success).toBe(true)
    const after = await reply(id, 'accept 1')
    expect(codes(after)).toEqual(['review_closed'])
    expect(after.data).toMatchObject({ recorded: false })
    expect(after.data).not.toHaveProperty('ask')
  })

  it('a stale review at the reply count names only the command it takes', async () => {
    const dir = modelDir()
    exposures.e1 = raw('e1', { dispositionKind: 'NOT_APPLICABLE', dispositionStale: true, dispositionReason: 'r', dispositionedBy: 'op' })
    const id = await open(dir, [{ group: 1, exposure_ids: ['e1'], proposal: { op: 'reaffirm' } }], 'stale')
    const entry = log(dir)
    entry.reviews[0].replies = Array.from({ length: LOG_LIMITS.replies }, () => ({ at: 'T', reply: 'skip 1', outcome: { verb: 'skip' } }))
    fs.writeFileSync(path.join(dir, '.dethereal', 'triage-log.json'), JSON.stringify(entry))
    const full = await reply(id, 'skip 1')
    expect(codes(full)).toEqual(['record_full'])
    expect(full.error).not.toMatch(/accept-all/)
    expect(askOf(full)).toBe(STALE_Q)
  })

  it('once the record takes no more answers, a non-answer is a stop with no question', async () => {
    const dir = modelDir()
    const p = await prepare(dir, await closedReview(dir))
    const entry = log(dir)
    entry.reviews[0].applies = Array.from({ length: LOG_LIMITS.answers }, (_, i) => ({ at: 'T', plan_id: 'x', reply: 'sure', outcome: i < LOG_LIMITS.refusedAnswers ? { refused: 'reply_not_answer' } : { cancelled: true } }))
    fs.writeFileSync(path.join(dir, '.dethereal', 'triage-log.json'), JSON.stringify(entry))
    const r = await commit(dir, p.data.plan_id, p.data.lines, 'sure')
    expect(codes(r)).toEqual(['record_full'])
    expect(r.data).not.toHaveProperty('ask')
  })

  it('a non-answer to a plan with nothing ready carries no question', async () => {
    const dir = modelDir()
    const p = await prepare(dir, await closedReview(dir, ['done']))
    expect(p.data.count).toBe(0)
    const r = await commit(dir, p.data.plan_id, p.data.lines, 'sure')
    expect(codes(r)).toEqual(['reply_not_answer'])
    expect(r.data).not.toHaveProperty('ask')
  })

  it('the stops carry no question: an unknown review, a closed one, a record that cannot be written', async () => {
    const dir = modelDir()
    const unknown = await reply('f'.repeat(32), 'done')
    expect(codes(unknown)).toEqual(['review_not_found'])
    expect(unknown.data).not.toHaveProperty('ask')
    const id = await closedReview(dir)
    const closed = await reply(id, 'accept 1')
    expect(codes(closed)).toEqual(['review_closed'])
    expect(closed.data).not.toHaveProperty('ask')
    const id2 = await open(modelDir())
    fs.writeFileSync(path.join(reviewStore.get(id2)!.dir, '.dethereal', 'triage-log.json'), '{not json')
    const unwritable = await reply(id2, 'skip 1')
    expect(codes(unwritable)).toEqual(['record_unwritable'])
    expect(unwritable.data).not.toHaveProperty('ask')
    const id3 = await open(modelDir())
    fs.rmSync(path.join(reviewStore.get(id3)!.dir, 'manifest.json'))
    const notModel = await reply(id3, 'skip 1')
    expect(codes(notModel)).toEqual(['not_model_dir'])
    expect(notModel.data).not.toHaveProperty('ask')
  })

  it('prepare carries the apply question with its own count, and none when nothing is ready', async () => {
    const dir = modelDir()
    const p = await prepare(dir, await closedReview(dir, ['accept 1', 'accept 2', 'done']))
    expect(p.data.count).toBe(3)
    expect(p.data).toMatchObject({ ask: '[prompt: triage-apply] Apply 3 dispositions? Type yes or cancel.' })
    const dir2 = modelDir()
    const none = await prepare(dir2, await closedReview(dir2, ['done']))
    expect(none.success, none.error).toBe(true)
    expect(none.data.count).toBe(0)
    expect(none.data).not.toHaveProperty('ask')
    // One operation rejected: the question counts only the ready ones.
    const dir3 = modelDir()
    const id3 = await closedReview(dir3, ['accept 1', 'accept 2', 'done'])
    exposures.e1 = raw('e1', { dispositionKind: 'AFFIRMED', dispositionReason: 'someone else', dispositionedBy: 'op' })
    const partly = await prepare(dir3, id3)
    expect(partly.data.count).toBe(2)
    expect(partly.data).toMatchObject({ ask: '[prompt: triage-apply] Apply 2 dispositions? Type yes or cancel.' })
  })

  it('a commit refused for a non-answer, or for the refused-answer count, carries it; lines that differ do not', async () => {
    const dir = modelDir()
    const p = await prepare(dir, await closedReview(dir))
    const ask = `[prompt: triage-apply] Apply ${p.data.count} dispositions? Type yes or cancel.`
    const differs = await commit(dir, p.data.plan_id, p.data.lines.slice(1), 'yes')
    expect(codes(differs)).toEqual(['lines_differ'])
    expect(differs.data).not.toHaveProperty('ask')
    const sure = await commit(dir, p.data.plan_id, p.data.lines, 'sure')
    expect(codes(sure)).toEqual(['reply_not_answer'])
    expect(askOf(sure)).toBe(ask)
    for (let i = 1; i < LOG_LIMITS.refusedAnswers - 1; i++) await commit(dir, p.data.plan_id, p.data.lines, 'sure')
    const full = await commit(dir, p.data.plan_id, p.data.lines, 'sure')
    expect(codes(full)).toEqual(['record_full'])
    expect(askOf(full)).toBe(ask)
    expect((await commit(dir, p.data.plan_id, p.data.lines, 'yes')).success).toBe(true)
  })
})
