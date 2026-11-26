/**
 * hidden_edges and manage_hidden_edges together, against a stub platform: a review opened on a synced model,
 * replied to and closed, then prepared and committed; the take-back of an accepted edge; and a review published to
 * the review workspace instead, with what became of it read back. Every reply and answer is recorded before it
 * counts, and a plan writes or sends only while what it rests on is unchanged.
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
/** Runs before each record write, when a test sets it: it may change the review, or fail the write. */
let beforeRecord: (() => Promise<void>) | null = null
vi.mock('../../triage/log.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../triage/log.js')>()
  return { ...real, recordReviewIn: async (...args: Parameters<typeof real.recordReviewIn>) => (await beforeRecord?.(), real.recordReviewIn(...args)) }
})
vi.mock('../../triage/dispositions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../triage/dispositions.js')>()
  return { ...real, writeOperations: (...args: unknown[]) => writes(...args) }
})
// The platform model against the last pull or push: unchanged, unless a test says otherwise
const livePrints = vi.fn()
const platformChanges = vi.fn()
vi.mock('../../utils/platform-baseline.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../utils/platform-baseline.js')>()
  return {
    ...real,
    exportPlatformPrints: (...args: unknown[]) => livePrints(...args),
    checkPlatformChanges: (...args: unknown[]) => platformChanges(...args),
  }
})

const { hiddenEdgesTool } = await import('../hidden-edges.tool.js')
const { manageHiddenEdgesTool } = await import('../manage-hidden-edges.tool.js')
const { deterministicAnalysisId } = await import('../../review-module/platform.js')
const { registerSecret, redactSecrets } = await import('../../auth/redact.js')
const { RecordError } = await import('../../triage/log.js')
const { TAKE_BACK_ASK, WHERE_ASK } = await import('../../hidden-edges/asks.js')

const URL_SAVED = process.env.DETHERNETY_URL
const realHome = process.env.HOME
let tmp: string
let repo: string
let seq = 0
let answer: string
let moduleMissing = false
/** What the module answers when asked for contract 2: the released module's refusal, unless a test says otherwise. */
let contractTwo: string | null = null
let classesMissing = false
const queries: Array<{ name: string; variables?: Record<string, unknown> }> = []
let exposures: { seg: unknown[]; web: unknown[] }

const FP = `sha256:${'b'.repeat(64)}`
const HE_CLASS = 'class-he'
/** The review module, when a test installs one: its Hidden edges analyses, its entries and states, and what its publish answers. */
let ws: null | {
  analyses: Array<{ id: string; createdAt: string | null; model: Array<{ id: string }> }>
  signedOut?: boolean
  states: Record<string, Record<string, unknown>>
  entries: Record<string, Record<string, unknown>>
  publish?: (payload: string) => unknown
  sent: Array<{ name: string; variables: Record<string, unknown> }>
}
const query = async (o: { query: { definitions: Array<{ kind: string; name?: { value: string } }> }; variables?: Record<string, unknown> }) => {
  const name = o.query.definitions.find((d) => d.kind === 'OperationDefinition')?.name?.value ?? '?'
  queries.push({ name, variables: o.variables })
  if (name === 'TriageModelExposures') return { data: { models: [platformModel(exposures)] } }
  if (name === 'HiddenEdgeCandidates') {
    if (moduleMissing) throw new CombinedGraphQLErrors({ errors: [{ message: 'Cannot query field "hiddenEdgeCandidates" on type "Query".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })
    if ('contract' in JSON.parse(String(o.variables?.options ?? '{}')) && contractTwo !== null) return { data: { hiddenEdgeCandidates: contractTwo } }
    // the released module reads no contract option: it refuses it, in contract 1
    if ('contract' in JSON.parse(String(o.variables?.options ?? '{}'))) {
      return { data: { hiddenEdgeCandidates: JSON.stringify({ contract: 1, module: 'dethernety-hidden-edges', version: '0.1.2', refusal: { code: 'options_invalid', detail: 'options has an unknown key' } }) } }
    }
    return { data: { hiddenEdgeCandidates: answer } }
  }
  if (name === 'GetModuleByName') return { data: classesMissing ? { modules: [] } : moduleByName() }
  if (ws) {
    const w = ws
    if (name === 'ReviewCapability') return { data: { reviewCapability: JSON.stringify({ ok: true, moduleVersion: '0.2.0', triageClassId: 'class-triage', hiddenEdgesClassId: HE_CLASS }) } }
    if (name === 'TriageReviewAnalyses' && w.signedOut) throw new CombinedGraphQLErrors({ errors: [{ message: 'signed out', extensions: { code: 'UNAUTHENTICATED' } }] })
    if (name === 'TriageReviewAnalyses') return { data: { analyses: w.analyses } }
    if (name === 'ReviewEdgeStates') {
      const edges = JSON.parse(o.variables!.edges as string).edges as Array<{ candidateId: string }>
      return { data: { reviewEdgeStates: JSON.stringify({ ok: true, states: edges.map((e) => ({ candidateId: e.candidateId, fingerprint: FP, fpVersion: 1, inModel: false, rejected: false, ...w.states[e.candidateId] })) }) } }
    }
    if (name === 'ReviewEdgeProposals') return { data: { reviewEdgeProposals: JSON.stringify({ ok: true, entries: (o.variables!.candidateIds as string[]).map((id) => (w.entries[id] ? { candidateId: id, ...w.entries[id] } : { candidateId: id, none: true })) }) } }
  }
  // a platform without the review module: its field fails validation
  if (name === 'ReviewCapability') throw new CombinedGraphQLErrors({ errors: [{ message: 'Cannot query field "reviewCapability" on type "Query".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })
  throw new Error(`unexpected query ${name}`)
}
const mutate = async (o: { mutation: { definitions: Array<{ kind: string; name?: { value: string } }> }; variables?: Record<string, unknown> }) => {
  const name = o.mutation.definitions.find((d) => d.kind === 'OperationDefinition')?.name?.value ?? '?'
  queries.push({ name, variables: o.variables })
  if (!ws) throw new Error(`unexpected mutation ${name}`)
  ws.sent.push({ name, variables: o.variables ?? {} })
  if (name === 'CreateTriageAnalysis') {
    ws.analyses.push({ id: o.variables!.id as string, createdAt: '2026-11-23T00:00:00Z', model: [{ id: 'model-1' }] })
    return { data: { createAnalysisIdempotent: { id: o.variables!.id } } }
  }
  if (name === 'ReviewPublishEdgeProposals') {
    const payload = o.variables!.payload as string
    const out = (await ws.publish?.(payload)) ?? { ok: true, results: (JSON.parse(payload).edges as Array<{ candidateId: string }>).map((e) => ({ candidateId: e.candidateId, result: 'stored' })) }
    return { data: { reviewPublishEdgeProposals: JSON.stringify(out) } }
  }
  throw new Error(`unexpected mutation ${name}`)
}
const context = { debug: false, apolloClient: { query, mutate } } as unknown as ToolContext

type R = { success: boolean; error?: string; data?: any }
const open = async (dir: string) => (await hiddenEdgesTool.run({ action: 'open', directory_path: dir }, context)) as R
const reply = async (dir: string, review_id: string, text: string) => (await hiddenEdgesTool.run({ action: 'reply', directory_path: dir, review_id, reply: text }, context)) as R
const prepare = async (dir: string, review_id: string) => (await manageHiddenEdgesTool.run({ action: 'prepare', directory_path: dir, review_id }, context)) as R
const commit = async (dir: string, plan_id: string, lines: string[], text: string) => (await manageHiddenEdgesTool.run({ action: 'commit', directory_path: dir, plan_id, lines, reply: text }, context)) as R
const record = async (dir: string, flow_id: string) => (await manageHiddenEdgesTool.run({ action: 'record', directory_path: dir, flow_id }, context)) as R
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
  contractTwo = null
  classesMissing = false
  ws = null
  livePrints.mockReset()
  livePrints.mockResolvedValue({})
  platformChanges.mockReset()
  platformChanges.mockResolvedValue({ baseline: { state: 'verified', elements: {} } })
  queries.length = 0
  beforeRecord = null
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
    // the extended answer is asked for first; a module that does not read the option is asked once more without it
    expect(queries.filter((q) => q.name === 'HiddenEdgeCandidates').map((q) => JSON.parse(q.variables!.options as string))).toEqual([
      { excluded: [], include_pending: true, contract: 2 },
      { excluded: [], include_pending: true },
    ])
  })

  it('takes the extended answer when the module gives it, with one call', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const limits = { per_kind_budget: 50, max_peers: 20, by_kind: { 'remote-service': { listed: 0, not_listed: 3, pairs_capped: 0, anchors_over_budget: 0 } }, explain_trimmed: 0, remedies_skipped: 0 }
    contractTwo = JSON.stringify({ ...JSON.parse(answerOf([])), contract: 2, mode: 'candidates', rationale: {}, limits })
    const r = await open(dir)
    expect(r.success, r.error).toBe(true)
    expect(r.data.header.module.status).toBe('answered')
    // where the caps left the list short, in the header
    expect(r.data.header.limits).toEqual([expect.stringMatching(/^The list is incomplete: Remote service 0 listed, 3 not\./)])
    expect(queries.filter((q) => q.name === 'HiddenEdgeCandidates')).toHaveLength(1)
  })

  it('shows the same rows from the extended answer, and holds the findings its explanation names to the review', async () => {
    const explained = (c: any) => ({
      ...c,
      explain: {
        parts: [{
          row: 'remote-service/rs-1', role: 'target', relation: 'in-zone', exposure: 'e2', anchor: 'SEG', matched: ['T1021'], path: 'T1021', foothold: 'A', reached: 'B',
          anchored_end: null, shared: 'SEG', flow: null, item: null, low: null, tier: 'medium',
          basis: { confirmed: true, gates: 1, gates_stated: 0, raises: 0, lowers: 0, high_reachable: true, caps: ['zone_without_own_finding'] }, facts: [], facts_total: 0,
        }],
        parts_total: 1,
        crown_jewel: { source: false, target: false },
        // a finding the candidate does not cite, named by its remedy
        remedies: [{ set: [{ at: 'attributes:B#hardened' }], outcome: 'removes', clears_finding: 'e1' }],
        remedies_total: 1,
      },
    })
    const one = candidate('remote-service', 'A', 'B', ['e2'])
    answer = answerOf([one])
    const plain = await open(await syncedModel(repo, `m${seq++}`))
    const limits = { per_kind_budget: 50, max_peers: 20, by_kind: {}, explain_trimmed: 0, remedies_skipped: 0 }
    contractTwo = JSON.stringify({ ...JSON.parse(answerOf([explained(one)])), contract: 2, mode: 'candidates', rationale: { 'remote-service/rs-1': 'a flat tier' }, limits })
    const dir = await syncedModel(repo, `m${seq++}`)
    const extended = await open(dir)
    expect(extended.success, extended.error).toBe(true)
    // the same rows, each with how the attacker moves and why its evidence is what it is
    expect(extended.data.rows.map(({ path: _p, evidence_why: _e, removes_if: _r, ...row }: any) => row)).toEqual(plain.data.rows)
    expect(extended.data.rows[0].removes_if).toBe('The edge goes if the model states hardened = true on "web", which also clears "exp e1".')
    expect(extended.data.rows[0].path).toMatch(/^From api \(Application Service\), in "Segment", an attacker uses T1021 against web, where "exp e2" was found/)
    expect(extended.data.rows[0].evidence_why).toMatch(/^Evidence: /)
    expect(plain.data.rows[0].path).toBeUndefined()
    // show <n>: its findings numbered, the remedy in words, the rule's rationale
    const shown = await reply(dir, extended.data.review_id, 'show 1')
    expect(shown.data.row).toMatchObject({ findings: [{ k: 1, finding: 'exp e2' }], rationale: 'a flat tier', rule: 'remote-service/rs-1' })
    expect(shown.data.row.remedies).toEqual(['The edge goes if the model states hardened = true on "web", which also clears "exp e1".'])
    await reply(dir, extended.data.review_id, 'accept 1')
    await reply(dir, extended.data.review_id, 'done')
    // the finding only the explanation names changes: the review no longer shows what is true
    exposures = { ...exposures, web: [rawExposure('e1', { dispositionKind: 'AFFIRMED', dispositionedBy: 'someone' })] }
    expect(codes(await prepare(dir, extended.data.review_id))).toEqual(['review_stale'])
  })

  it("takes a registered credential out of the platform text a row's path carries, and the server boundary's redaction finds none left", async () => {
    const secret = `bearer-${'9f'.repeat(12)}`
    registerSecret(secret)
    // a finding named by the platform with the session's credential in it: the story quotes the finding's name
    exposures = { ...exposures, seg: [rawExposure('e2', { dispositionKind: 'AFFIRMED', dispositionedBy: 'someone', name: `token ${secret}` })] }
    const one = candidate('remote-service', 'A', 'B', ['e2'])
    const limits = { per_kind_budget: 50, max_peers: 20, by_kind: {}, explain_trimmed: 0, remedies_skipped: 0 }
    const explain = {
      parts: [{
        row: 'remote-service/rs-1', role: 'target', relation: 'in-zone', exposure: 'e2', anchor: 'SEG', matched: ['T1021'], path: 'T1021', foothold: 'A', reached: 'B',
        anchored_end: null, shared: 'SEG', flow: null, item: null, low: null, tier: 'medium',
        basis: { confirmed: true, gates: 1, gates_stated: 0, raises: 0, lowers: 0, high_reachable: true, caps: ['zone_without_own_finding'] }, facts: [], facts_total: 0,
      }],
      parts_total: 1, crown_jewel: { source: false, target: false }, remedies: [], remedies_total: 0,
    }
    contractTwo = JSON.stringify({ ...JSON.parse(answerOf([{ ...one, explain }])), contract: 2, mode: 'candidates', rationale: {}, limits })
    const r = await open(await syncedModel(repo, `m${seq++}`))
    expect(r.success, r.error).toBe(true)
    // the story quotes the finding's name, its credential taken out before any cut
    expect(r.data.rows[0].path).toContain('"token [redacted]"')
    expect(r.data.rows[0].evidence_why).toMatch(/^Evidence: /)
    expect(JSON.stringify(r.data)).not.toContain(secret)
    // the text the server sends back passes through this redaction as well (server.ts, every tool result): the second net
    expect(redactSecrets(JSON.stringify(r.data))).toBe(JSON.stringify(r.data))
  })

  it('asks only once when the module refuses for another reason than the option', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    contractTwo = JSON.stringify({ contract: 2, module: 'dethernety-hidden-edges', version: '0.2.0', refusal: { code: 'busy' } })
    const r = await open(dir)
    expect(r.success, r.error).toBe(true)
    expect(r.data.header.module.status).toBe('module_busy')
    expect(queries.filter((q) => q.name === 'HiddenEdgeCandidates')).toHaveLength(1)
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
    expect((await reply(dir, id, 'accept 2 affirm 1')).success).toBe(true)
    expect(codes(await reply(dir, id, 'reject 9'))).toEqual(['candidate_unknown'])
    expect((await reply(dir, id, 'done')).data.closed).toBe(true)
    const log = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-log.json'), 'utf8'))
    expect(log.reviews[0].replies.map((x: any) => x.outcome)).toEqual([{ verb: 'accept' }, { refused: 'candidate_unknown' }, { verb: 'done' }])
    // the affirm grammar under the released module's answer: it does not depend on the extended one

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
    expect(codes(await record(dir, 'f1'))).toEqual(['not_hidden_edge'])
    const rec = await record(dir, flowId)
    expect(rec.success, rec.error).toBe(true)
    expect(rec.data.ask).toBe(`[prompt: hidden-edges-take-back] ${TAKE_BACK_ASK}`)
    expect(rec.data.lines.slice(2, 5)).toEqual([
      '  reject: the edge was never real; it is kept as a reject, and is not proposed again',
      '  release: it was fixed, or is no longer wanted; it is not kept out, and if its grounds return the module proposes it again',
      '  cancel: nothing is recorded, and the flow stays, accepted',
    ])
    // a take-back is answered by what it records: yes says neither
    const yes = await commit(dir, rec.data.plan_id, rec.data.lines, 'yes')
    expect(codes(yes)).toEqual(['reply_not_answer'])
    expect(yes.data.ask).toBe(rec.data.ask)
    const c = await commit(dir, rec.data.plan_id, rec.data.lines, 'reject')
    expect(c.data).toMatchObject({ written: 1, recorded: 'rejected' })
    const decisions = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), 'utf8')).decisions
    expect(decisions.map((d: any) => [d.id, d.verb])).toEqual([[o.data.rows[0].id, 'accepted'], [o.data.rows[1].id, 'rejected'], [o.data.rows[0].id, 'rejected']])
    // kept as a reject: still out of the next run, and its flow is an ordinary one
    queries.length = 0
    await open(dir)
    expect(JSON.parse(queries.find((q) => q.name === 'HiddenEdgeCandidates')!.variables!.options as string).excluded).toContain(o.data.rows[0].id)
    expect(codes(await record(dir, flowId))).toEqual(['not_hidden_edge'])
  })

  it('releases an edge that was fixed: the accept is dropped, and the next run proposes it again', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'accept 1')
    await reply(dir, o.data.review_id, 'done')
    const p = await prepare(dir, o.data.review_id)
    expect((await commit(dir, p.data.plan_id, p.data.lines, 'yes')).success).toBe(true)
    await markSynced(dir)
    const flowId = flowIdOf(o.data.rows[0].id)
    const rec = await record(dir, flowId)
    const c = await commit(dir, rec.data.plan_id, rec.data.lines, 'release')
    expect(c.data).toMatchObject({ written: 1, recorded: 'released' })
    const decisions = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), 'utf8')).decisions
    expect(decisions.map((d: any) => [d.verb, d.flow_id, d.mac])).toEqual([['accepted', flowId, expect.any(String)], ['released', null, null]])
    // not kept out: the module is asked with nothing excluded, and the edge is a candidate again
    queries.length = 0
    const again = await open(dir)
    expect(JSON.parse(queries.find((q) => q.name === 'HiddenEdgeCandidates')!.variables!.options as string).excluded).toEqual([])
    expect(again.data.rows.map((r: any) => r.id)).toContain(o.data.rows[0].id)
    expect(again.data.header.decisions).toMatchObject({ accepted: 0, rejected: 0, malformed: 0 })
    expect(codes(await record(dir, flowId))).toEqual(['not_hidden_edge'])
  })

  it('on cancel records nothing and says the flow stays: no accept stands without its flow', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'accept 1')
    await reply(dir, o.data.review_id, 'done')
    const p = await prepare(dir, o.data.review_id)
    await commit(dir, p.data.plan_id, p.data.lines, 'yes')
    await markSynced(dir)
    const flowId = flowIdOf(o.data.rows[0].id)
    const flows = fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')
    const decisionsBefore = fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), 'utf8')
    const rec = await record(dir, flowId)
    expect((await commit(dir, rec.data.plan_id, rec.data.lines, 'cancel')).data).toMatchObject({ cancelled: true, written: 0, flow_kept: true })
    // the accept and its flow are both still there: the take-back is asked again when the flow is removed
    expect(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), 'utf8')).toBe(decisionsBefore)
    expect(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')).toBe(flows)
    expect((await record(dir, flowId)).success).toBe(true)
  })

  it('takes an edge back signed out, or with the platform unreachable, saying the affirmed findings could not be listed', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'accept 1')
    await reply(dir, o.data.review_id, 'done')
    const p = await prepare(dir, o.data.review_id)
    await commit(dir, p.data.plan_id, p.data.lines, 'yes')
    await markSynced(dir)
    const flowId = flowIdOf(o.data.rows[0].id)
    const signedOut = { debug: false } as ToolContext
    // what needs the platform says so
    expect((await manageHiddenEdgesTool.run({ action: 'prepare', directory_path: dir, review_id: o.data.review_id }, signedOut)).success).toBe(false)
    const rec = (await manageHiddenEdgesTool.run({ action: 'record', directory_path: dir, flow_id: flowId }, signedOut)) as R
    expect(rec.success, rec.error).toBe(true)
    expect(rec.data.lines).toContain('The findings this edge affirmed could not be listed (not signed in); check them in /dethereal:triage')
    const c = (await manageHiddenEdgesTool.run({ action: 'commit', directory_path: dir, plan_id: rec.data.plan_id, lines: rec.data.lines, reply: 'reject' }, signedOut)) as R
    expect(c.data).toMatchObject({ written: 1, recorded: 'rejected' })
    // the accept no longer stands: the remove skill removes the flow as it does any other
    expect(codes((await manageHiddenEdgesTool.run({ action: 'record', directory_path: dir, flow_id: flowId }, signedOut)) as R)).toEqual(['not_hidden_edge'])
    // with a client the platform does not answer
    const dir2 = await syncedModel(repo, `m${seq++}`)
    const o2 = await open(dir2)
    await reply(dir2, o2.data.review_id, 'accept 1')
    await reply(dir2, o2.data.review_id, 'done')
    const p2 = await prepare(dir2, o2.data.review_id)
    await commit(dir2, p2.data.plan_id, p2.data.lines, 'yes')
    await markSynced(dir2)
    const offline = { debug: false, apolloClient: { query: async () => { throw new Error('connect ECONNREFUSED') }, mutate } } as unknown as ToolContext
    const rec2 = (await manageHiddenEdgesTool.run({ action: 'record', directory_path: dir2, flow_id: flowIdOf(o2.data.rows[0].id) }, offline)) as R
    expect(rec2.data.lines).toContain('The findings this edge affirmed could not be listed (the platform could not be reached); check them in /dethereal:triage')
    expect(((await manageHiddenEdgesTool.run({ action: 'commit', directory_path: dir2, plan_id: rec2.data.plan_id, lines: rec2.data.lines, reply: 'release' }, offline)) as R).data).toMatchObject({ recorded: 'released' })
  })

  it('checks the platform only for a review that accepts: one that only rejects is never refused for a pull', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'reject 1')
    await reply(dir, o.data.review_id, 'done')
    const changedThere = { baseline: { state: 'verified', elements: {} }, refusal: { message: 'x', data: { code: 'PLATFORM_CHANGED_SINCE_SYNC', baseline: 'verified', changes_total: 1, changes: [] } } }
    platformChanges.mockClear()
    platformChanges.mockResolvedValue(changedThere)
    const p = await prepare(dir, o.data.review_id)
    expect(p.success, p.error).toBe(true)
    const c = await commit(dir, p.data.plan_id, p.data.lines, 'yes')
    expect(c.data).toMatchObject({ written: 1, failed: 0 })
    expect(platformChanges).not.toHaveBeenCalled()
  })

  it('refuses a prepare, and a commit, while the platform holds an edge accepted in the review workspace since the review', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'accept 1')
    await reply(dir, o.data.review_id, 'done')
    const accepted = { baseline: { state: 'verified', elements: {} }, refusal: { message: 'x', data: { code: 'PLATFORM_CHANGED_SINCE_SYNC', baseline: 'verified', changes_total: 1, changes: [{ id: 'hf', kind: 'added_on_platform' }] } } }
    platformChanges.mockResolvedValueOnce(accepted)
    expect(codes(await prepare(dir, o.data.review_id))).toEqual(['pull_first'])
    const p = await prepare(dir, o.data.review_id)
    expect(p.success, p.error).toBe(true)
    platformChanges.mockResolvedValueOnce(accepted)
    const c = await commit(dir, p.data.plan_id, p.data.lines, 'yes')
    expect(codes(c)).toEqual(['pull_first'])
    expect(c.error).toMatch(/nothing was written$/)
    expect(fs.existsSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')).dataFlows.map((f: any) => f.id)).toEqual(['f1'])
    expect(codes(await commit(dir, p.data.plan_id, p.data.lines, 'yes'))).toEqual(['plan_stale'])
  })

  it('never refuses an open or a take-back for old published reviews in the record', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await reply(dir, o.data.review_id, 'accept 1')
    await reply(dir, o.data.review_id, 'done')
    const p = await prepare(dir, o.data.review_id)
    await commit(dir, p.data.plan_id, p.data.lines, 'yes')
    await markSynced(dir)
    const file = path.join(dir, '.dethereal', 'hidden-edges-log.json')
    const published = Array.from({ length: 25 }, (_, i) => ({
      review_id: `old${i}`, mode: 'hidden-edges', opened_at: 't', groups: 1, replies: [{ at: 't', reply: 'skip 1', outcome: { verb: 'skip' } }], applies: [],
      published_edges: [{ at: 't', plan_id: 'p', analysis_id: 'a', edges: {}, not_stored: [], results: { stored: 1 }, fingerprints: 'open' }],
    }))
    fs.writeFileSync(file, JSON.stringify({ reviews: published }))
    expect((await open(dir)).success).toBe(true)
    const rec = await record(dir, flowIdOf(o.data.rows[0].id))
    expect((await commit(dir, rec.data.plan_id, rec.data.lines, 'release')).success).toBe(true)
    const log = JSON.parse(fs.readFileSync(file, 'utf8')).reviews
    // every publish kept, whole: the count does not apply to published reviews, and the bytes are fine
    expect(log.filter((r: any) => r.published_edges)).toEqual(published)
  })
})

describe('the platform model against the files', () => {
  it('refuses an open while the platform holds changes since the last pull or push, before the module is asked', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    platformChanges.mockResolvedValue({ baseline: { state: 'verified', elements: {} }, refusal: { message: 'x', data: { code: 'PLATFORM_CHANGED_SINCE_SYNC', baseline: 'verified', changes_total: 1, changes: [{ id: 'hf', kind: 'added_on_platform' }] } } })
    const r = await open(dir)
    expect(codes(r)).toEqual(['pull_first'])
    expect(r.error).toMatch(/changed since your last pull or push \(1 element\(s\)\).*pull first/)
    expect(r.data).toMatchObject({ changes_total: 1, changes: [{ id: 'hf', kind: 'added_on_platform' }] })
    // every element added on the platform counts: an edge accepted in the review workspace among them
    expect(platformChanges.mock.calls[0]![3]).toMatchObject({ includeAdded: true })
    expect(queries.map((q) => q.name)).not.toContain('HiddenEdgeCandidates')
    livePrints.mockResolvedValue(null)
    expect(codes(await open(dir))).toEqual(['platform_unread'])
  })

  it('says when this machine cannot keep the record at all, after a pull that recorded nothing; with no key yet, a pull makes one', async () => {
    const real = await vi.importActual<typeof import('../../utils/platform-baseline.js')>('../../utils/platform-baseline.js')
    platformChanges.mockImplementation(real.checkPlatformChanges as (...args: unknown[]) => unknown)
    livePrints.mockResolvedValue({ A: { k: 'component', n: 'api', f: { properties: 'p' } } })
    const dir = await syncedModel(repo, `m${seq++}`)
    // no key on this machine yet: a pull would make one and record the model
    expect(codes(await open(dir))).toEqual(['pull_first'])
    // a key folder inside the project is refused: the pull records nothing, and every open after it would ask for a pull again
    const home = process.env.HOME
    process.env.HOME = path.join(repo, 'home')
    fs.mkdirSync(process.env.HOME)
    try {
      const pulled = await real.baselineForSync(dir, 'model-1', await livePrints())
      expect(pulled.record).toBeNull()
      await real.recordSyncBaseline(dir, {}, pulled, 'pull')
      const r = await open(dir)
      expect(codes(r)).toEqual(['baseline_unavailable'])
      expect(r.error).toContain("this machine's key folder, in the home directory, lies inside the project")
    } finally {
      process.env.HOME = home
    }
  })
})

describe("the analyst's arguments", () => {
  it('holds the stance and a one-line reason on the candidate, with locators or none, and shows them in the row', async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    const ev = (await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: id, evidence: [{ n: 1, stance: 'against', reason: 'the policy\ndenies it' }, { n: 2, stance: 'unclear', locators: ['kg:x'] }] }, context)) as R
    expect(ev.success, ev.error).toBe(true)
    const rows = ((await hiddenEdgesTool.run({ action: 'get', directory_path: dir, review_id: id }, context)) as R).data.rows
    expect(rows.map((r: any) => r.argument)).toEqual([{ stance: 'against', reason: 'the policy denies it' }, { stance: 'unclear' }])
  })

  it("refuses a reason holding this session's credentials, or longer than one line of 300, and never echoes it", async () => {
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    const secret = 'sess-0123456789abcdef-secret'
    registerSecret(secret)
    const r = (await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: id, evidence: [{ n: 1, stance: 'for', reason: `the token ${secret} works` }] }, context)) as R
    expect(codes(r)).toEqual(['reason_invalid'])
    expect(JSON.stringify(r)).not.toContain(secret)
    expect(codes((await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: id, evidence: [{ n: 1, stance: 'for', reason: 'x'.repeat(301) }] }, context)) as R)).toEqual(['reason_invalid'])
    // one split by an invisible character, which cleaning would join up again
    const split = `the token ${secret.slice(0, 8)}\u200b${secret.slice(8)} works`
    expect(codes((await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: id, evidence: [{ n: 1, stance: 'for', reason: split }] }, context)) as R)).toEqual(['reason_invalid'])
    // all or nothing: nothing was held
    expect(((await hiddenEdgesTool.run({ action: 'get', directory_path: dir, review_id: id }, context)) as R).data.rows[0].argument).toBeUndefined()
  })
})

describe('a note holding a credential', () => {
  it('is refused, and its reply is recorded only by its hash, the start redacted', async () => {
    const secret = `bearer-${'7e'.repeat(12)}`
    registerSecret(secret)
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    expect(codes(await reply(dir, o.data.review_id, `accept 2 affirm 1 note: ${secret}`))).toEqual(['argument_invalid'])
    const log = fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-log.json'), 'utf8')
    expect(log).not.toContain(secret)
    expect(JSON.parse(log).reviews[0].replies[0]).toMatchObject({ reply_start: expect.stringContaining('[redacted]'), outcome: { refused: 'argument_invalid' } })
  })
})

describe('a review published to the Hidden edges workspace', () => {
  type PubPlan = R & { data: { plan_id: string; lines: string[]; ask: string; count: number; not_sent: unknown[] } }
  const preparePublish = async (dir: string, review_id: string) => (await manageHiddenEdgesTool.run({ action: 'prepare_publish', directory_path: dir, review_id }, context)) as PubPlan
  const publish = async (dir: string, plan_id: string, lines: string[], text: string) => (await manageHiddenEdgesTool.run({ action: 'publish', directory_path: dir, plan_id, lines, reply: text }, context)) as R
  const install = (analyses: Array<{ id: string; createdAt: string | null; model: Array<{ id: string }> }> = []) => {
    ws = { analyses, states: {}, entries: {}, sent: [] }
    return ws
  }
  const argue = (dir: string, id: string) =>
    hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: id, evidence: [{ n: 1, stance: 'against', reason: 'the network policy denies it', locators: ['source:deploy/netpol.yaml:12', 'source:.env:1', 'source:other/file.ts:3', 'kg:kgrule:x'] }] }, context)
  const discovered = (dir: string) => fs.writeFileSync(path.join(dir, '.dethereal', 'discovery.json'), JSON.stringify({ elements: [{ sources: [{ file: 'deploy/netpol.yaml' }] }] }))
  const sentPayload = () => JSON.parse(ws!.sent.find((x) => x.name === 'ReviewPublishEdgeProposals')!.variables.payload as string)

  it('opens with the workspace and the where question; with no analysis yet, yes creates it, reads the states, then sends', async () => {
    const w = install()
    const dir = await syncedModel(repo, `m${seq++}`)
    discovered(dir)
    const o = await open(dir)
    expect(o.data.review_workspace).toEqual({ status: 'present', module_version: '0.2.0', fingerprints: 'none' })
    expect(o.data.where_ask).toBe(`[prompt: hidden-edges-where] ${WHERE_ASK}`)
    const id = o.data.review_id
    await argue(dir, id)
    const plan = await preparePublish(dir, id)
    expect(plan.success, plan.error).toBe(true)
    expect(plan.data.ask).toBe('[prompt: hidden-edges-publish] Publish 1 edge(s) to the Hidden edges workspace? Type yes or cancel.')
    expect(plan.data.lines[0]).toBe('Publish 1 edge to the Hidden edges workspace of "Shop", under your name, with the stances and reasons as Dethereal\'s analyst drafted them, for a person to decide there. Edges: 0 proposes accepting · 1 proposes rejecting · 0 left to a person.')
    expect(plan.data.lines).toContain('Edge 1: Remote service, "api" → "web" — the analyst proposes rejecting it')
    expect(plan.data.lines).toContain('  Locators: source:deploy/netpol.yaml:12, kg:kgrule:x')
    // a secret file's locator, and a source discovery did not read, never leave this machine
    expect(plan.data.lines).toContain('2 locators left out: a secret file, or a source file discovery did not read, never leaves this machine.')
    expect(plan.data.lines).toContain("  Edge 2: the analyst returned no argument for it: decide it here")
    expect(plan.data.lines.at(-2)).toBe("Creates the model's Hidden edges analysis on the platform (none exists yet).")
    expect(codes(await manageHiddenEdgesTool.run({ action: 'commit', directory_path: dir, plan_id: plan.data.plan_id, lines: plan.data.lines, reply: 'yes' }, context) as R)).toEqual(['plan_kind'])
    expect(codes(await publish(dir, plan.data.plan_id, plan.data.lines, 'maybe'))).toEqual(['reply_not_answer'])
    const sent = await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    expect(sent.success, sent.error).toBe(true)
    const analysisId = deterministicAnalysisId('model-1', HE_CLASS, 'dethereal-hidden-edges')
    expect(sent.data).toMatchObject({ analysis_id: analysisId, created: true, edges: 1, results: { stored: 1 }, not_stored: [] })
    expect(w.sent.map((x) => x.name)).toEqual(['CreateTriageAnalysis', 'ReviewPublishEdgeProposals'])
    expect(w.sent[0]!.variables).toMatchObject({ id: analysisId, name: 'Hidden edges', elementId: 'model-1', analysisClassId: HE_CLASS })
    expect(queries.filter((q) => q.name === 'ReviewEdgeStates').length).toBe(1)
    expect(sentPayload()).toEqual({
      reviewId: id,
      edges: [{ candidateId: o.data.rows[0].id, kind: 'remote-service', source: 'A', target: 'B', exposureIds: ['e2'], stance: 'against', reason: 'the network policy denies it', locators: ['source:deploy/netpol.yaml:12', 'kg:kgrule:x'], fingerprint: FP, fpVersion: 1 }],
    })
    const log = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-log.json'), 'utf8'))
    const entry = log.reviews.find((r: any) => r.review_id === id)
    expect(entry.published_edges).toEqual([expect.objectContaining({ analysis_id: analysisId, edges: { [o.data.rows[0].id]: { n: 1, kind: 'remote-service', source: 'A', target: 'B' } }, results: { stored: 1 }, fingerprints: 'publish' })])
    expect(entry.applies.map((a: any) => a.outcome)).toEqual([{ refused: 'reply_not_answer' }, { published: 1, not_stored: 0 }])
    // a published review is decided in the workspace: never applied here, never published twice
    expect(codes(await preparePublish(dir, id))).toEqual(['review_published'])
    expect(codes((await manageHiddenEdgesTool.run({ action: 'prepare', directory_path: dir, review_id: id }, context)) as R)).toEqual(['review_published'])
    expect(codes(await reply(dir, id, 'accept 1'))).toEqual(['review_closed'])
  })

  it("uses the model's analysis and the states open read; what the workspace holds as a flow or rejected is not sent", async () => {
    const w = install([{ id: 'he-analysis', createdAt: '2026-01-01T00:00:00Z', model: [{ id: 'model-1' }] }])
    const dir = await syncedModel(repo, `m${seq++}`)
    const pre = await open(dir)
    w.states[pre.data.rows[1].id] = { inModel: true }
    hiddenEdgeReviews.clear()
    const o = await open(dir)
    expect(o.data.review_workspace).toEqual({ status: 'present', module_version: '0.2.0', analysis_id: 'he-analysis', fingerprints: 'read', in_model: 1, rejected_there: 0 })
    await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: o.data.review_id, evidence: [{ n: 1, stance: 'for' }, { n: 2, stance: 'for' }] }, context)
    const plan = await preparePublish(dir, o.data.review_id)
    expect(plan.data.lines).toContain('  Edge 2: it is in the model already as a flow')
    expect(plan.data.lines.at(-2)).toBe("To the model's Hidden edges analysis he-analysis.")
    const statesRead = queries.filter((q) => q.name === 'ReviewEdgeStates').length
    expect((await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')).success).toBe(true)
    // the fingerprints open read are the ones sent: none read again
    expect(queries.filter((q) => q.name === 'ReviewEdgeStates').length).toBe(statesRead)
    expect(w.sent.map((x) => x.name)).toEqual(['ReviewPublishEdgeProposals'])
    expect(sentPayload().edges.map((e: any) => [e.candidateId, e.stance, e.locators])).toEqual([[o.data.rows[0].id, 'for', []]])
  })

  it("past 30 minutes with the states still to read, nothing is prepared; a review decided here is not published; the workspace's refusal stores nothing", async () => {
    const w = install()
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    await argue(dir, id)
    hiddenEdgeReviews.get(id)!.workspace!.opened_at_ms -= 31 * 60 * 1000
    expect(codes(await preparePublish(dir, id))).toEqual(['review_late'])
    hiddenEdgeReviews.get(id)!.workspace!.opened_at_ms += 31 * 60 * 1000
    w.publish = () => ({ ok: false, reason: 'invalid', field: 'edges[0].locators' })
    const plan = await preparePublish(dir, id)
    const r = await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    expect(codes(r)).toEqual(['publish_refused'])
    expect(r.data).toMatchObject({ field: 'edges[0].locators' })
    expect(hiddenEdgeReviews.get(id)!.published).toBeUndefined()
    const id2 = (await open(dir)).data.review_id
    await reply(dir, id2, 'skip 1')
    expect(codes(await preparePublish(dir, id2))).toEqual(['review_has_replies'])
    // a decision made here after prepare: the plan no longer holds, and nothing is sent
    const id3 = (await open(dir)).data.review_id
    await argue(dir, id3)
    const p3 = await preparePublish(dir, id3)
    await reply(dir, id3, 'reject 1')
    const sentBefore = w.sent.length
    expect(codes(await publish(dir, p3.data.plan_id, p3.data.lines, 'yes'))).toEqual(['plan_stale'])
    expect(w.sent.length).toBe(sentBefore)
    expect(hiddenEdgeReviews.get(id3)!.published).toBeUndefined()
  })

  it('a reply landing while the edges are sent is refused, never overridden; a refused publish opens the review again', async () => {
    const w = install()
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    await argue(dir, id)
    let during: R | undefined
    w.publish = async () => {
      during = await reply(dir, id, 'accept 1')
      return { ok: false, reason: 'busy' }
    }
    const plan = await preparePublish(dir, id)
    expect(codes(await publish(dir, plan.data.plan_id, plan.data.lines, 'yes'))).toEqual(['publish_refused'])
    expect(codes(during!)).toEqual(['review_closed'])
    // nothing stored: the review is open again, untouched, and takes the reply now
    expect(hiddenEdgeReviews.get(id)!.candidates.every((c) => c.choice === 'open')).toBe(true)
    expect((await reply(dir, id, 'accept 1')).success).toBe(true)
    // stored: the reply that tried to land meanwhile changed nothing
    const id2 = (await open(dir)).data.review_id
    await argue(dir, id2)
    w.publish = async (payload: string) => {
      during = await reply(dir, id2, 'reject 1')
      return { ok: true, results: (JSON.parse(payload).edges as Array<{ candidateId: string }>).map((e) => ({ candidateId: e.candidateId, result: 'stored' })) }
    }
    const p2 = await preparePublish(dir, id2)
    expect((await publish(dir, p2.data.plan_id, p2.data.lines, 'yes')).success).toBe(true)
    expect(codes(during!)).toEqual(['review_closed'])
    expect(hiddenEdgeReviews.get(id2)!.candidates.every((c) => c.choice === 'open')).toBe(true)
  })

  it('a reply whose record fails never opens a review a publish closed meanwhile', async () => {
    install()
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    // the publish closes the review while the reply's record is written, and the write fails
    beforeRecord = async () => {
      beforeRecord = null
      hiddenEdgeReviews.get(id)!.closed = true
      throw new RecordError('record_unwritable', 'the hidden-edge record could not be written (busy); nothing was taken: try again')
    }
    expect(codes(await reply(dir, id, 'reject 9'))).toEqual(['record_unwritable'])
    expect(hiddenEdgeReviews.get(id)!.closed).toBe(true)
    // a closing reply whose record fails is taken back: the review is open again
    const id2 = (await open(dir)).data.review_id
    beforeRecord = async () => {
      beforeRecord = null
      throw new RecordError('record_unwritable', 'x')
    }
    expect(codes(await reply(dir, id2, 'done'))).toEqual(['record_unwritable'])
    expect(hiddenEdgeReviews.get(id2)!.closed).toBe(false)
  })

  it('a publish whose answer never came closes the review, and is sent again safely', async () => {
    const w = install()
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    await argue(dir, id)
    w.publish = () => {
      throw new Error('connection reset')
    }
    const plan = await preparePublish(dir, id)
    const lost = await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    expect(codes(lost)).toEqual(['write_error'])
    expect(hiddenEdgeReviews.get(id)).toMatchObject({ closed: true, published: { unconfirmed: true } })
    expect(codes(await reply(dir, id, 'accept 1'))).toEqual(['review_closed'])
    w.publish = undefined
    const again = await preparePublish(dir, id)
    expect(again.success, again.error).toBe(true)
    const sent = await publish(dir, again.data.plan_id, again.data.lines, 'yes')
    expect(sent.success, sent.error).toBe(true)
    expect(hiddenEdgeReviews.get(id)!.published).toEqual({ at: expect.any(String), analysis_id: sent.data.analysis_id })
    const log = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'hidden-edges-log.json'), 'utf8'))
    expect(log.reviews.find((r: any) => r.review_id === id).published_edges.map((p: any) => p.unconfirmed ?? false)).toEqual([true, false])
  })

  it('leaves out an edge whose finding changed since the review; a lost session keeps the plan for the same call', async () => {
    const w = install()
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: o.data.review_id, evidence: [{ n: 1, stance: 'for' }, { n: 2, stance: 'against' }] }, context)
    // edge 1 rests on e2: dismissed since the review, so the analyst judged it on other facts
    exposures.seg = [rawExposure('e2', { dispositionKind: 'FALSE_POSITIVE', dispositionedBy: 'someone' })]
    const plan = await preparePublish(dir, o.data.review_id)
    expect(plan.success, plan.error).toBe(true)
    expect(plan.data.lines).toContain('  Edge 1: a finding it rests on changed since the review: open a new review to judge it again')
    w.publish = () => {
      throw new CombinedGraphQLErrors({ errors: [{ message: 'signed out', extensions: { code: 'UNAUTHENTICATED' } }] })
    }
    expect(codes(await publish(dir, plan.data.plan_id, plan.data.lines, 'yes'))).toEqual(['session_refused'])
    expect(hiddenEdgeReviews.get(o.data.review_id)!.published).toBeUndefined()
    w.publish = undefined
    const sent = await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    expect(sent.success, sent.error).toBe(true)
    expect(sentPayload().edges.map((e: any) => e.candidateId)).toEqual([o.data.rows[1].id])
  })

  it('a session lost while the analysis is looked up keeps the plan; the same call sends it after signing in', async () => {
    const w = install()
    const dir = await syncedModel(repo, `m${seq++}`)
    const id = (await open(dir)).data.review_id
    await argue(dir, id)
    const plan = await preparePublish(dir, id)
    w.signedOut = true
    expect(codes(await publish(dir, plan.data.plan_id, plan.data.lines, 'yes'))).toEqual(['session_refused'])
    expect(w.sent).toEqual([])
    w.signedOut = false
    const sent = await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    expect(sent.success, sent.error).toBe(true)
    expect(w.sent.map((x) => x.name)).toEqual(['CreateTriageAnalysis', 'ReviewPublishEdgeProposals'])
  })

  it("says so when the latest publish never landed and an earlier one is what the workspace holds", async () => {
    const w = install([{ id: 'he-analysis', createdAt: '2026-01-01T00:00:00Z', model: [{ id: 'model-1' }] }])
    const dir = await syncedModel(repo, `m${seq++}`)
    const a = await open(dir)
    await argue(dir, a.data.review_id)
    const pa = await preparePublish(dir, a.data.review_id)
    await publish(dir, pa.data.plan_id, pa.data.lines, 'yes')
    const b = await open(dir)
    await argue(dir, b.data.review_id)
    w.publish = () => {
      throw new Error('connection reset')
    }
    const pb = await preparePublish(dir, b.data.review_id)
    expect(codes(await publish(dir, pb.data.plan_id, pb.data.lines, 'yes'))).toEqual(['write_error'])
    w.entries[a.data.rows[0].id] = { status: 'open', reviewId: a.data.review_id, verb: 'reject', proposedBy: 'alice' }
    const r = (await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R
    expect(r.data.rows.map((x: any) => [x.review_id, x.what])).toEqual([[b.data.review_id, 'Waiting; proposed to reject (this publish never confirmed: an earlier publish by alice is what the workspace holds)']])
  })

  it('says an accepted edge is in the files once pulled, and an earlier proposal the module no longer makes is no longer proposed', async () => {
    const w = install([{ id: 'he-analysis', createdAt: '2026-01-01T00:00:00Z', model: [{ id: 'model-1' }] }])
    const dir = await syncedModel(repo, `m${seq++}`)
    const o = await open(dir)
    await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: o.data.review_id, evidence: [{ n: 1, stance: 'for' }, { n: 2, stance: 'for' }] }, context)
    const plan = await preparePublish(dir, o.data.review_id)
    await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    const [first, second] = [o.data.rows[0].id, o.data.rows[1].id]
    const read = async () => (((await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R).data.rows as any[]).map((x) => [x.n, x.status, x.what])
    w.entries[first] = { status: 'accepted', reviewId: o.data.review_id, verb: 'accept' }
    w.entries[second] = { status: 'stale', reviewId: o.data.review_id, verb: 'accept' }
    // the module still answers the second, but its caps left some out: the read-back cannot tell, and says stale
    expect(await read()).toEqual([
      [2, 'stale', 'Waiting, but its facts changed since publish: run hidden edges again and publish, to refresh it'],
      [1, 'accepted', 'In the model as a flow: pull it to have it in the files'],
    ])
    // pulled: the accepted edge's flow is in the files; the module answers in full, and no longer proposes the second
    const flows = JSON.parse(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8'))
    flows.dataFlows.push({ id: 'pf-1', name: 'Remote service: api → web', source: { id: 'A' }, target: { id: 'B' }, classData: { id: 'class-he-remote', name: 'Hidden Edge: Remote Service', module: { id: 'mod-hidden-edges', name: 'dethernety-hidden-edges' } } })
    fs.writeFileSync(path.join(dir, 'dataflows.json'), JSON.stringify(flows))
    fs.mkdirSync(path.join(dir, 'attributes', 'dataFlows'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'attributes', 'dataFlows', 'pf-1.json'), JSON.stringify({ elementId: 'pf-1', elementType: 'dataFlow', attributes: { hidden_edge_kind: 'remote-service', technique_ids: ['T1021'] } }))
    answer = answerOf([], { counts: { kind_budget_dropped: 0, peers_capped: 0 } })
    expect(await read()).toEqual([
      [1, 'accepted', 'In the model and in the files'],
      [2, 'not_proposed', 'No longer proposed by the module: its grounds no longer hold, so publishing again cannot bring it back'],
    ])
    // the edges in the files are left out of the module's call, as the workspace leaves them out
    const asked = queries.filter((q) => q.name === 'HiddenEdgeCandidates').at(-1)!
    expect(JSON.parse(asked.variables!.options as string)).toEqual({ excluded: [first], include_pending: true })
    // an entry still waiting for an edge whose flow is in the files: the module leaves it out, which says nothing of it
    w.entries[first] = { status: 'open', reviewId: o.data.review_id, verb: 'accept' }
    expect((await read()).find((x) => x[0] === 1)).toEqual([1, 'open', 'Waiting; proposed to accept'])
    // nothing waits on the module: it is not asked
    w.entries[first] = { status: 'accepted', reviewId: o.data.review_id, verb: 'accept' }
    w.entries[second] = { status: 'rejected', reviewId: o.data.review_id, verb: 'accept', rejectedBy: 'bob', rejectedAt: null, rejectedNote: null }
    queries.length = 0
    expect((await read()).map((x) => x[1])).toEqual(['rejected', 'accepted'])
    expect(queries.map((q) => q.name)).not.toContain('HiddenEdgeCandidates')
  })

  it('reads back what became of each published edge, in words, what needs action first', async () => {
    const w = install([{ id: 'he-analysis', createdAt: '2026-01-01T00:00:00Z', model: [{ id: 'model-1' }] }])
    const dir = await syncedModel(repo, `m${seq++}`)
    expect(((await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R).data).toMatchObject({ publishes: 0, rows: [] })
    const o = await open(dir)
    await hiddenEdgesTool.run({ action: 'evidence', directory_path: dir, review_id: o.data.review_id, evidence: [{ n: 1, stance: 'against' }, { n: 2, stance: 'for' }] }, context)
    const plan = await preparePublish(dir, o.data.review_id)
    await publish(dir, plan.data.plan_id, plan.data.lines, 'yes')
    const [first, second] = [o.data.rows[0].id, o.data.rows[1].id]
    w.entries[first] = { status: 'accepted', reviewId: o.data.review_id, verb: 'reject' }
    w.entries[second] = { status: 'rejected', reviewId: o.data.review_id, verb: 'accept', rejectedBy: 'bob', rejectedAt: '2026-11-23T10:00:00Z', rejectedNote: 'no route "at all"' }
    const r = (await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R
    expect(r.success, r.error).toBe(true)
    expect(r.data.counts).toEqual({ accepted: 1, rejected: 1 })
    expect(r.data.rows.map((x: any) => [x.n, x.edge, x.status, x.what])).toEqual([
      [2, 'Remote service: web → api', 'rejected', 'Rejected by bob, 2026-11-23: "no route \\"at all\\""'],
      [1, 'Remote service: api → web', 'accepted', 'In the model as a flow: pull it to have it in the files'],
    ])
    // accepted in the workspace, then its flow gone: by a take-back because it no longer held, or deleted elsewhere
    w.entries[first] = { status: 'recorded', reviewId: o.data.review_id, verb: 'reject', acceptedBy: 'carol', acceptedAt: '2026-11-22T10:00:00Z', retiredBy: 'dan', retiredAt: '2026-11-24T09:00:00Z' }
    w.entries[second] = { status: 'recorded', reviewId: o.data.review_id, verb: 'accept', acceptedBy: 'carol', acceptedAt: '2026-11-22T10:00:00Z' }
    const recorded = (await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R
    expect(recorded.data.rows.map((x: any) => [x.n, x.status, x.what])).toEqual([
      [1, 'recorded', 'Taken back by dan, 2026-11-24: it no longer held, so its flow was deleted from the model; pull to have the files match'],
      [2, 'recorded', 'Accepted by carol, 2026-11-22; the flow was deleted outside this workspace; pull to have the files match'],
    ])
    // taken back, then accepted again, then its flow gone: the accept is newer
    w.entries[first] = { status: 'recorded', reviewId: o.data.review_id, verb: 'reject', acceptedBy: 'erin', acceptedAt: '2026-11-25T10:00:00Z', retiredBy: 'dan', retiredAt: '2026-11-24T09:00:00Z' }
    const again = (await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R
    expect(again.data.rows.find((x: any) => x.n === 1).what).toBe('Accepted by erin, 2026-11-25; the flow was deleted outside this workspace; pull to have the files match')
    // an analysis no longer this model's is said so, never read
    w.analyses.length = 0
    expect(((await hiddenEdgesTool.run({ action: 'published', directory_path: dir }, context)) as R).data.counts).toEqual({ unconfirmed_analysis: 2 })
  })
})
