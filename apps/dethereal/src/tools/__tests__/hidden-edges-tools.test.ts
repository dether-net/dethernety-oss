/**
 * hidden_edges and manage_hidden_edges together, against a stub platform: a review opened on a synced model,
 * replied to and closed, then prepared and committed; and the take-back of an accepted edge. Every reply and
 * answer is recorded before it counts, and a plan writes only while what it rests on is unchanged.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CombinedGraphQLErrors } from '@apollo/client'
import type { ToolContext } from '../base-tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { hiddenEdgeReviews } from '../../hidden-edges/review.js'
import { flowIdOf } from '../../hidden-edges/apply.js'
import { answerOf, candidate, markSynced, moduleByName, PLATFORM, platformModel, rawExposure, syncedModel } from '../../hidden-edges/__tests__/fixture.js'

const writes = vi.fn()
vi.mock('../../triage/dispositions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../triage/dispositions.js')>()
  return { ...real, writeOperations: (...args: unknown[]) => writes(...args) }
})

const { hiddenEdgesTool } = await import('../hidden-edges.tool.js')
const { manageHiddenEdgesTool } = await import('../manage-hidden-edges.tool.js')

const URL_SAVED = process.env.DETHERNETY_URL
const realHome = process.env.HOME
let tmp: string
let repo: string
let seq = 0
let answer: string
let moduleMissing = false
let classesMissing = false
const queries: Array<{ name: string; variables?: Record<string, unknown> }> = []
let exposures: { seg: unknown[]; web: unknown[] }

const query = async (o: { query: { definitions: Array<{ kind: string; name?: { value: string } }> }; variables?: Record<string, unknown> }) => {
  const name = o.query.definitions.find((d) => d.kind === 'OperationDefinition')?.name?.value ?? '?'
  queries.push({ name, variables: o.variables })
  if (name === 'TriageModelExposures') return { data: { models: [platformModel(exposures)] } }
  if (name === 'HiddenEdgeCandidates') {
    if (moduleMissing) throw new CombinedGraphQLErrors({ errors: [{ message: 'Cannot query field "hiddenEdgeCandidates" on type "Query".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })
    return { data: { hiddenEdgeCandidates: answer } }
  }
  if (name === 'GetModuleByName') return { data: classesMissing ? { modules: [] } : moduleByName() }
  throw new Error(`unexpected query ${name}`)
}
const context = { debug: false, apolloClient: { query } } as unknown as ToolContext

type R = { success: boolean; error?: string; data?: any }
const open = async (dir: string) => (await hiddenEdgesTool.run({ action: 'open', directory_path: dir }, context)) as R
const reply = async (dir: string, review_id: string, text: string) => (await hiddenEdgesTool.run({ action: 'reply', directory_path: dir, review_id, reply: text }, context)) as R
const prepare = async (dir: string, review_id: string) => (await manageHiddenEdgesTool.run({ action: 'prepare', directory_path: dir, review_id }, context)) as R
const commit = async (dir: string, plan_id: string, lines: string[], text: string) => (await manageHiddenEdgesTool.run({ action: 'commit', directory_path: dir, plan_id, lines, reply: text }, context)) as R
const codes = (r: R) => r.data?.codes as string[] | undefined

beforeAll(() => {
  process.env.HOME = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'he-tools-home-')))
})
afterAll(() => {
  fs.rmSync(process.env.HOME!, { recursive: true, force: true })
  process.env.HOME = realHome
})
beforeEach(() => {
  process.env.DETHERNETY_URL = PLATFORM
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'he-tools-')))
  repo = path.join(tmp, 'repo')
  fs.mkdirSync(repo)
  initProjectRoot({ cwd: repo, env: {} })
  hiddenEdgeReviews.clear()
  manageHiddenEdgesTool.plans.clear()
  exposures = { seg: [rawExposure('e2', { dispositionKind: 'AFFIRMED', dispositionedBy: 'someone' })], web: [rawExposure('e1')] }
  answer = answerOf([candidate('remote-service', 'A', 'B', ['e2']), candidate('remote-service', 'B', 'A', ['e1'])])
  moduleMissing = false
  classesMissing = false
  queries.length = 0
  writes.mockReset()
  writes.mockImplementation(async (_c: unknown, ops: Array<{ index: number; exposure_id: string; op: string; status: string }>) =>
    ops.filter((o) => o.status === 'ready').map((o) => ({ index: o.index, exposure_id: o.exposure_id, op: o.op, status: 'applied' })))
})
afterEach(() => {
  resetProjectRoot()
  if (URL_SAVED === undefined) delete process.env.DETHERNETY_URL
  else process.env.DETHERNETY_URL = URL_SAVED
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('hidden_edges open', () => {
  it('refuses a model with local changes or never synced, before any platform call', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    fs.writeFileSync(path.join(dir, 'dataflows.json'), JSON.stringify({ dataFlows: [] }))
    expect(codes(await open(dir))).toEqual(['push_first'])
    fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify({ platform_model_id: 'model-1', platform_url: `${PLATFORM}/` }))
    expect(codes(await open(dir))).toEqual(['sync_first'])
    expect(queries).toEqual([])
  })

  it('opens a review of the validated candidates, with the four counts, the regime and the ask', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    answer = answerOf([candidate('remote-service', 'A', 'B', ['e2']), candidate('remote-service', 'B', 'A', ['e1']), candidate('remote-service', 'A', 'Z', ['e2'])])
    const r = await open(dir)
    expect(r.success, r.error).toBe(true)
    expect(r.data.header.counts).toEqual({ candidates: 2, dropped_by_caps: 1, excluded_by_decision: 2, dropped_by_validation: 1 })
    expect(r.data.header.regime).toEqual({ kg: 'kg_absent', reason: 'unavailable' })
    expect(r.data.header.kg_marker).toBe('[no knowledge-graph evidence]')
    expect(r.data.rows.map((x: any) => [x.n, x.edge, x.in_accept_all])).toEqual([[1, 'api → web', true], [2, 'web → api', false]])
    expect(r.data.ask).toMatch(/^\[prompt: hidden-edges-review\] /)
    expect(JSON.parse(queries.find((q) => q.name === 'HiddenEdgeCandidates')!.variables!.options as string)).toEqual({ excluded: [], include_pending: true })
  })

  it('says when the platform has no hidden-edges module, and opens nothing', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    moduleMissing = true
    const r = await open(dir)
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ total: 0, header: { module: { status: 'module_not_loaded' } } })
    expect(r.data.review_id).toBeUndefined()
  })

  it('says the module failed when its classes cannot be read from the platform, and opens nothing', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    answer = answerOf([candidate('remote-service', 'A', 'B', ['e2'])])
    classesMissing = true
    const r = await open(dir)
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ total: 0, header: { module: { status: 'module_failed' } } })
    expect(r.data.review_id).toBeUndefined()
  })
})

describe('the review, prepared and committed', () => {
  it('records each reply before it counts, then writes the accepted flow, its signed decision and the affirmation of a one-by-one accept', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    const id = o.data.review_id
    expect((await reply(dir, id, 'accept 2')).success).toBe(true)
    expect(codes(await reply(dir, id, 'reject 9'))).toEqual(['candidate_unknown'])
    expect((await reply(dir, id, 'done')).data.closed).toBe(true)
    const log = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-log.json'), 'utf8'))
    expect(log.reviews[0].replies.map((x: any) => x.outcome)).toEqual([{ verb: 'accept' }, { refused: 'candidate_unknown' }, { verb: 'done' }])

    const p = await prepare(dir, id)
    expect(p.success, p.error).toBe(true)
    expect(p.data.count).toBe(2)
    expect(codes(await commit(dir, p.data.plan_id, p.data.lines.slice(1), 'yes'))).toEqual(['lines_differ'])
    const c = await commit(dir, p.data.plan_id, p.data.lines, 'yes')
    expect(c.success, c.error).toBe(true)
    expect(c.data).toMatchObject({ flows: 1, written: 2, failed: 0 })
    expect(writes.mock.calls[0]![1].filter((x: any) => x.status === 'ready').map((x: any) => [x.exposure_id, x.kind])).toEqual([['e1', 'AFFIRMED']])
    const flowId = flowIdOf(o.data.rows[1].id)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')).dataFlows.map((f: any) => f.id)).toEqual(['f1', flowId])
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), 'utf8')).decisions[0]).toMatchObject({ verb: 'accepted', flow_id: flowId })
    expect(codes(await commit(dir, p.data.plan_id, p.data.lines, 'yes'))).toEqual(['plan_used'])
  })

  it('lets a review go when its record is too large to take a reply', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    const file = path.join(dir, '.dethereal', 'hidden-edges-log.json')
    const log = JSON.parse(fs.readFileSync(file, 'utf8'))
    log.reviews[0].replies = Array.from({ length: 60 }, () => ({ at: 'T', reply: 'r'.repeat(16_000), outcome: { verb: 'skip' } }))
    fs.writeFileSync(file, JSON.stringify(log))
    expect(codes(await reply(dir, o.data.review_id, 'accept 1'))).toEqual(['record_too_large'])
    expect(codes(await reply(dir, o.data.review_id, 'done'))).toEqual(['review_not_found'])
  })

  it('writes nothing when the files changed after prepare, or on cancel', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    await reply(dir, id, 'accept 1')
    await reply(dir, id, 'done')
    const p = await prepare(dir, id)
    expect((await commit(dir, p.data.plan_id, p.data.lines, 'cancel')).data).toMatchObject({ cancelled: true, written: 0 })
    const p2 = await prepare(dir, id)
    fs.writeFileSync(path.join(dir, 'structure.json'), fs.readFileSync(path.join(dir, 'structure.json'), 'utf8').replace('"web"', '"web2"'))
    expect(codes(await commit(dir, p2.data.plan_id, p2.data.lines, 'yes'))).toEqual(['plan_stale'])
    expect(fs.existsSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'))).toBe(false)
  })

  it('excludes what stands next run, and takes an accepted edge back as a reject on record', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'accept 1')
    await reply(dir, o.data.review_id, 'reject 2')
    await reply(dir, o.data.review_id, 'done')
    const p = await prepare(dir, o.data.review_id)
    expect((await commit(dir, p.data.plan_id, p.data.lines, 'yes')).success).toBe(true)
    await markSynced(dir)
    queries.length = 0
    await open(dir)
    const excluded = JSON.parse(queries.find((q) => q.name === 'HiddenEdgeCandidates')!.variables!.options as string).excluded
    expect(excluded.sort()).toEqual([o.data.rows[0].id, o.data.rows[1].id].sort())

    const flowId = flowIdOf(o.data.rows[0].id)
    expect(codes((await manageHiddenEdgesTool.run({ action: 'record', directory_path: dir, flow_id: 'f1' }, context)) as R)).toEqual(['not_hidden_edge'])
    const rec = (await manageHiddenEdgesTool.run({ action: 'record', directory_path: dir, flow_id: flowId }, context)) as R
    expect(rec.success, rec.error).toBe(true)
    expect((await commit(dir, rec.data.plan_id, rec.data.lines, 'yes')).success).toBe(true)
    const decisions = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), 'utf8')).decisions
    expect(decisions.map((d: any) => [d.id, d.verb])).toEqual([[o.data.rows[0].id, 'accepted'], [o.data.rows[1].id, 'rejected'], [o.data.rows[0].id, 'rejected']])
  })
})
