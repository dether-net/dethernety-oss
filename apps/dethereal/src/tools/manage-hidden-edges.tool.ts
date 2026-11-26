/**
 * manage_hidden_edges: write what the operator decided about hidden edges, in two steps, the operator's answer
 * between them, as manage_dispositions does.
 *
 * - `prepare` (a closed review): the accepted edges as new flows in the local files, the decisions, and AFFIRMED
 *   for the pending exposures an accept names (`accept <n> affirm <k>`);
 * - `record` (a hidden-edge flow being removed): its accepted decision taken back, as a reject or a release by the
 *   operator's answer, with the affirmed exposures it cites listed for triage. The decision is written before the
 *   flow is removed: on cancel the flow stays, accepted, so no accept stands without its flow;
 * - `prepare_publish` (an untouched review): the candidates with the analyst's arguments, sent to the review
 *   workspace's Hidden edges analysis for a person to decide there; `publish` sends them after the typed yes. Nothing
 *   is written to the model or the files.
 *
 * Each returns a plan and its lines; `commit` takes the plan, the lines as shown and the operator's answer. On
 * `yes` (a take-back: `reject` or `release`) the answer is recorded first, the files and the platform are read
 * again, and the plan is written only if nothing it rests on changed: an apply also only while the platform model
 * holds no change since the last pull or push (an edge accepted in the review workspace would be a second flow). Plans are held in this process only, expire, and commit at most once; commits to
 * one platform model run one at a time here.
 */
import { z } from 'zod'
import { AUTHENTICATION_REQUIRED, ClientFreeTool, type ToolContext, type ToolResult } from './base-tool.js'
import { coded, need, only, PLAN_ID, REPLY_INPUT_MAX, REVIEW_ID } from './input-rules.js'
import { HIDDEN_EDGE_RECORD } from './hidden-edges.tool.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { SettlePlanStore, type SettlePlan } from '../utils/settle-plans.js'
import { computeContentHash } from '../utils/sync-utils.js'
import { StateFileError } from '../utils/state-store.js'
import { LOG_LIMITS, readLocalJson, recordedText, recordReviewIn, RecordError, refuseWhenFull, type LoggedApply, type LoggedEdgePublish, type LoggedReview } from '../triage/log.js'
import { platformModelOf, TriageModelError } from '../triage/model.js'
import { graphQLErrorCode } from '../triage/kg.js'
import { ModelReadError, readModelExposures, type ExposureState } from '../triage/exposures.js'
import { applyAnswer, writeOperations } from '../triage/dispositions.js'
import { Turns } from '../triage/turns.js'
import { ApplyWriteError, decisionOfFlow, filesBound, planApply, planRecord, writeApply, APPLY_LIMITS, TAKE_BACK_VERBS, type ApplyPlan, type FilesBound, type RecordPlan, type TakeBack } from '../hidden-edges/apply.js'
import { applyAsk, publishAsk, takeBackAsk } from '../hidden-edges/asks.js'
import { buildEdgePublish, edgePayloadOf, edgePublishLines, EDGE_NOT_STORED_WORDS, withEdgeStates, type EdgeBuilt } from '../hidden-edges/publish.js'
import { edgeRefOf } from '../hidden-edges/workspace.js'
import { discoveredSources } from '../review-module/citations.js'
import { REVIEW_LIMITS } from '../review-module/contract.js'
import { LATE_FINGERPRINT_MS } from '../review-module/payload.js'
import { createAnalysis, deterministicAnalysisId, findAnalysis, HIDDEN_EDGES_ANALYSIS, probe, publishEdges, readEdgeStates } from '../review-module/platform.js'
import { join } from 'node:path'
import { exposureBound, OpenRefusal, platformChangeRefusal } from '../hidden-edges/open.js'
import { decisionsHash, isSigner, readDecisions, replaceDecisions, signDecision, signerFor, type Signer } from '../hidden-edges/records.js'
import { decided, hiddenEdgeReviews, type HiddenEdgeReview } from '../hidden-edges/review.js'

const InputSchema = z.object({
  action: z.enum(['prepare', 'record', 'commit', 'prepare_publish', 'publish']).describe("'prepare' plans a closed review's writes; 'record' plans taking back the accepted edge of a flow being removed; 'commit' writes a plan after the operator's answer; 'prepare_publish' and 'publish' send an untouched review's candidates, with the analyst's arguments, to the Hidden edges workspace instead"),
  directory_path: z.string().max(4096).describe('The model directory'),
  review_id: REVIEW_ID.optional().describe("For 'prepare' and 'prepare_publish': the review"),
  flow_id: z.string().max(128).optional().describe("For 'record': the flow being removed"),
  plan_id: PLAN_ID.optional().describe("For 'commit' and 'publish': the plan returned"),
  lines: z.array(z.string().max(APPLY_LIMITS.echoChars)).max(400).optional().describe("For 'commit' and 'publish': the plan's lines, exactly as returned"),
  reply: z.string().max(REPLY_INPUT_MAX).optional().describe("For 'commit' and 'publish': the operator's answer to the question, exactly as given (yes or cancel; for a take-back, reject, release or cancel)"),
}).strict().superRefine((d, ctx) => {
  const preparing = d.action === 'prepare' || d.action === 'prepare_publish'
  const answering = d.action === 'commit' || d.action === 'publish'
  if (preparing) need(ctx, !!d.review_id, 'review_id', d.action)
  if (d.action === 'record') need(ctx, !!d.flow_id, 'flow_id', 'record')
  if (answering) {
    need(ctx, !!d.plan_id, 'plan_id', d.action)
    need(ctx, !!d.lines, 'lines', d.action)
    need(ctx, d.reply !== undefined, 'reply', d.action)
  }
  only(ctx, !preparing && d.review_id !== undefined, 'review_id', "'prepare' and 'prepare_publish'")
  only(ctx, d.action !== 'record' && d.flow_id !== undefined, 'flow_id', "'record'")
  only(ctx, !answering && (d.plan_id !== undefined || d.lines !== undefined || d.reply !== undefined), 'plan_id, lines and reply', "'commit' and 'publish'")
})
type Input = z.infer<typeof InputSchema>

/** A publish plan: what goes, where, and when the edges' fingerprints were or will be read. */
interface PublishPlan {
  lines: string[]
  built: EdgeBuilt
  class_id: string
  /** The analysis found, or null when the publish creates the model's Hidden edges analysis */
  analysis_id: string | null
  source: LoggedEdgePublish['fingerprints']
  opened_at_ms: number
}

type PlanInput =
  | { kind: 'apply'; log_id: string; model_id: string; plan: ApplyPlan; files: FilesBound; local_hash: string; exposures: Map<string, ExposureState> }
  | { kind: 'record'; log_id: string; model_id: string; plan: RecordPlan; decisions_hash: string; exposures: Map<string, ExposureState> }
  | { kind: 'publish'; log_id: string; model_id: string; plan: PublishPlan; exposures: Map<string, ExposureState> }
type PlanEnd = 'committed' | 'stale' | 'failed' | 'cancelled' | 'published' | 'refused' | 'unconfirmed'

class Refusal extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message)
  }
}

const SPENT: Record<PlanEnd, string> = {
  committed: 'the plan was committed already: nothing to redo',
  failed: "the plan was committed already, and some of its writes failed: see that commit's outcomes",
  cancelled: 'the plan was cancelled: prepare again',
  stale: 'the plan was found stale and nothing was written: prepare again',
  published: "the edges were published already: 'hidden_edges published' shows what the workspace holds",
  refused: 'the Hidden edges workspace refused the publish and nothing was stored: prepare_publish again',
  unconfirmed: "the publish was sent and its answer never came: 'hidden_edges published' shows what the workspace holds; prepare_publish again to send it once more",
}

/** At most this many publishes are recorded for one review. */
const PUBLISHES_MAX = 5

/** A module refusal in the operator's words. */
const refusalWords = (reason: string, field?: string): string =>
  reason === 'busy' || reason === 'deadline'
    ? `the Hidden edges workspace is busy (${reason}): try again in a moment`
    : reason === 'too_large'
      ? 'the Hidden edges workspace holds too many proposals to take these (too_large): a person decides or rejects some there first'
      : `the Hidden edges workspace refused it (${reason}${field ? `, field ${field}` : ''})${field ? ': this Dethereal and the workspace module disagree; decide here instead' : ''}`

const boundOf = (ids: Iterable<string>, state: Map<string, ExposureState>) => new Map([...new Set(ids)].flatMap((id) => (state.has(id) ? [[id, state.get(id)!] as const] : [])))
const changed = (before: Map<string, ExposureState>, after: Map<string, ExposureState>) =>
  [...before.keys()].filter((id) => JSON.stringify(exposureBound(before.get(id))) !== JSON.stringify(exposureBound(after.get(id))))
const warned = (warnings: string[]) => (warnings.length ? { warnings } : {})
const noClient = (context: ToolContext): ToolResult<Record<string, unknown>> => ({ success: false, error: context.clientUnavailableReason ?? AUTHENTICATION_REQUIRED })
const freshOf = (r: HiddenEdgeReview) => (): LoggedReview => ({ review_id: r.id, mode: 'hidden-edges', opened_at: r.opened_at, groups: r.candidates.length, replies: [], applies: [] })
const countOf = (p: PlanInput) => (p.kind === 'apply' ? p.plan.decisions.length + p.plan.affirmations.filter((o) => o.status === 'ready').length : p.kind === 'publish' ? p.plan.built.edges.length : 1)
const askOf = (p: PlanInput) => (p.kind === 'publish' ? publishAsk(countOf(p)) : p.kind === 'record' ? takeBackAsk() : applyAsk(countOf(p)))
/** A take-back's answer: reject or release records, cancel writes nothing; anything else is no answer. */
function takeBackAnswer(reply: string): TakeBack | 'cancel' | null {
  const t = reply.trim().toLowerCase()
  return t === 'reject' || t === 'release' || t === 'cancel' ? t : null
}

export class ManageHiddenEdgesTool extends ClientFreeTool<Input, Record<string, unknown>> {
  readonly name = 'manage_hidden_edges'
  readonly description =
    "Write what the operator decided about hidden edges, in two steps. 'prepare' (review_id of a closed hidden_edges review) or 'record' " +
    "(flow_id, when a hidden-edge flow is removed, before it is removed) writes nothing and returns {plan_id, expires_at, count, lines, ask}. " +
    "Show the operator the lines, then end the message with the ask exactly as returned. 'commit' (plan_id, the lines exactly as returned, and " +
    "the operator's answer exactly as given) writes only on 'yes' (a take-back: 'reject' or 'release'), and only if nothing the plan rests on " +
    "changed since; 'cancel' writes nothing (a take-back: keep the flow). New flows reach the " +
    "platform with the next push. 'prepare_publish' (review_id of a review with no reply) instead returns {plan_id, expires_at, count, lines, " +
    "ask} for sending its candidates, with the analyst's arguments, to the review workspace's Hidden edges analysis; 'publish' (plan_id, the " +
    "lines exactly as returned, the operator's answer) sends them on 'yes' and returns {analysis_id, created?, results, not_stored}. Nothing " +
    'is written to the model or the files then. Call it from the main session only.'
  readonly inputSchema = InputSchema
  readonly plans = new SettlePlanStore<PlanInput, PlanEnd>()
  private readonly turns = new Turns()

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      // A take-back is recorded without the platform: only its list of affirmed findings needs it
      if ((input.action === 'prepare' || input.action === 'prepare_publish') && !context.apolloClient) return noClient(context)
      if (input.action === 'commit' || input.action === 'publish') return await this.commit(dir, input, context)
      const prepared = input.action === 'prepare' ? await this.prepare(dir, input.review_id!, context) : input.action === 'prepare_publish' ? await this.preparePublish(dir, input.review_id!, context) : await this.record(dir, input.flow_id!, context)
      const count = countOf(prepared)
      const plan = this.plans.add(dir, prepared, null, '', prepared.plan.lines)
      return {
        success: true,
        data: { plan_id: plan.id, expires_at: plan.expiresAtIso, count, lines: plan.lines, ...(prepared.kind === 'publish' ? { not_sent: prepared.plan.built.left } : {}), ask: askOf(prepared) },
      }
    } catch (err) {
      if (err instanceof Refusal) return coded(err.code, err.message, err.details)
      if (err instanceof TriageModelError || err instanceof ModelReadError || err instanceof RecordError || err instanceof ApplyWriteError) return coded(err.code, err.message)
      if (err instanceof StateFileError) return coded(err.code, `a model file could not be used (${err.code}); nothing was written`)
      return { success: false, error: err instanceof Error ? err.message : 'manage_hidden_edges failed' }
    }
  }

  private async prepare(dir: string, reviewId: string, context: ToolContext): Promise<PlanInput> {
    const review = hiddenEdgeReviews.get(reviewId)
    if (!review) throw new Refusal('review_not_found', 'no such review in this session (a restart forgets reviews; one unused for two hours expires): open it again')
    if (review.dir !== dir) throw new Refusal('other_model', 'the review was opened for another model directory')
    if (review.published && !review.published.unconfirmed) throw new Refusal('review_published', "the review was published to the Hidden edges workspace: it is decided there; 'hidden_edges published' shows what became of it")
    if (!review.closed) throw new Refusal('review_open', "the review is still open: it closes with 'accept-all' or 'done'")
    if (!decided(review).length) throw new Refusal('nothing_to_apply', 'the review accepted and rejected nothing')
    const modelId = await platformModelOf(dir)
    if (modelId !== review.model_id) throw new Refusal('other_model', 'the model directory now names another platform model than the review was opened on: open a new review')
    const localHash = await computeContentHash(dir)
    if (localHash !== review.seen.local_hash || (await decisionsHash(dir)) !== review.seen.decisions_hash) throw new Refusal('review_stale', 'the model files or the decisions changed since the review was opened: open a new review')
    // An edge accepted in the review workspace since open is a flow the files lack: an accept here would make a second
    // one. A review that rejects only writes no flow.
    const platform = decided(review).some((c) => c.choice === 'accept') ? await platformChangeRefusal(dir, modelId, context.apolloClient!) : null
    if (platform) throw new Refusal(platform.code, platform.message, platform.details)
    const now = new Map((await readModelExposures(context.apolloClient!, modelId)).rows.map((r) => [r.exposure_id, r]))
    const moved = changed(review.seen.exposures, now)
    if (moved.length) throw new Refusal('review_stale', `${moved.length} exposure(s) the candidates cite changed since the review was opened: open a new review`, { changed: moved })
    const plan = planApply(review, now, new Date().toISOString())
    if (JSON.stringify(plan.lines).length > APPLY_LIMITS.echoChars) throw new Refusal('echo_too_large', 'the plan is too large to show whole: decide fewer candidates in one review')
    const ids = [...decided(review).flatMap((c) => c.exposure_ids)]
    return { kind: 'apply', log_id: review.id, model_id: modelId, plan, files: await filesBound(dir), local_hash: localHash, exposures: boundOf(ids, now) }
  }

  /**
   * Prepare a publish of an untouched review: its candidates with the analyst's arguments, built as the workspace
   * takes them (a locator naming a secret file, or a source discovery did not read, left out), and shown whole.
   * Nothing is written.
   */
  private async preparePublish(dir: string, reviewId: string, context: ToolContext): Promise<PlanInput> {
    const review = hiddenEdgeReviews.get(reviewId)
    if (!review) throw new Refusal('review_not_found', 'no such review in this session (a restart forgets reviews; one unused for two hours expires): open it again')
    if (review.dir !== dir) throw new Refusal('other_model', 'the review was opened for another model directory')
    if (review.published && !review.published.unconfirmed) throw new Refusal('review_published', "the review was published already: 'hidden_edges published' shows what became of it")
    // a publish that never confirmed closed the review, and may be sent again
    const unconfirmed = review.published?.unconfirmed === true
    if ((review.closed && !unconfirmed) || review.candidates.some((c) => c.choice !== 'open' || c.edited)) throw new Refusal('review_has_replies', 'this review has decisions made here in the chat: finish it here, or open a new review to publish')
    const client = context.apolloClient!
    const modelId = await platformModelOf(dir)
    if (modelId !== review.model_id) throw new Refusal('other_model', 'the model directory now names another platform model than the review was opened on: open a new review')
    // The workspace as open found it, or as it is now when open could not ask
    let ws = review.workspace
    if (ws?.status !== 'present') {
      const p = await probe(client)
      if (p.status !== 'present') throw new Refusal(p.status === 'failed' ? 'workspace_unavailable' : p.status, `the Hidden edges workspace is not available: ${p.detail}`)
      if (!p.hiddenEdgesClassId) throw new Refusal('module_not_loaded', 'the Hidden edges workspace is not available: this version of the review module has none')
      ws = { status: 'present', module_version: p.moduleVersion, hidden_edges_class_id: p.hiddenEdgesClassId, fingerprints: 'none', opened_at_ms: review.workspace?.opened_at_ms ?? Date.parse(review.opened_at) }
    }
    const classId = ws.hidden_edges_class_id!
    let analysisId = ws.analysis_id ?? null
    if (!analysisId) {
      const a = await findAnalysis(client, modelId, classId, HIDDEN_EDGES_ANALYSIS)
      if (a.status === 'found') analysisId = a.id
      else if (a.status !== 'none') throw new Refusal('workspace_unavailable', `the model's Hidden edges analysis could not be looked up: ${a.detail}`)
    }
    // The fingerprints: from open, or read now while the review is young; with no analysis yet, at the publish
    let states = ws.fingerprints === 'read' && ws.states ? ws.states : null
    let source: LoggedEdgePublish['fingerprints'] = states ? 'open' : analysisId ? 'prepare' : 'publish'
    if (!states && Date.now() - ws.opened_at_ms > LATE_FINGERPRINT_MS) throw new Refusal('review_late', "more than 30 minutes have passed since the review opened, so the edges' state can no longer be read as the analyst saw it: open a new review to publish")
    if (!states && analysisId) {
      const st = await readEdgeStates(client, analysisId, review.candidates.map(edgeRefOf))
      if (st.status !== 'answer') throw new Refusal('workspace_unavailable', `the edges' state in the Hidden edges workspace could not be read: ${st.status === 'refused' ? refusalWords(st.reason) : st.detail}`)
      states = new Map([...st.states].flatMap(([id, s]) => ('gone' in s ? [] : [[id, s] as const])))
      source = 'prepare'
    }
    // A finding an edge rests on that changed since the review: that edge was judged on other facts, so it is not sent
    const now = new Map((await readModelExposures(client, modelId)).rows.map((r) => [r.exposure_id, r]))
    const drifted = new Set(changed(review.seen.exposures, now))
    const sources = discoveredSources(await readLocalJson(join(dir, '.dethereal', 'discovery.json')))
    const built = buildEdgePublish(review, sources, states, drifted)
    if (!built.edges.length) throw new Refusal('nothing_to_publish', 'nothing in this review can go to the Hidden edges workspace (see not_sent): decide it here', { not_sent: built.left })
    const lines = edgePublishLines(review, built, { analysisId })
    if (lines.length > 400 || JSON.stringify(lines).length > APPLY_LIMITS.echoChars) throw new Refusal('echo_too_large', 'the publish is too large to show whole: decide these edges here instead')
    // Every publish is recorded: a record that cannot take one more is refused now, before the question
    await recordReviewIn(dir, HIDDEN_EDGE_RECORD, review.id, freshOf(review), (entry) => refuseWhenFull(entry.published_edges ?? [], PUBLISHES_MAX, 'publishes', 'open a new review'))
    return {
      kind: 'publish', log_id: review.id, model_id: modelId,
      plan: { lines, built, class_id: classId, analysis_id: analysisId, source, opened_at_ms: ws.opened_at_ms },
      exposures: boundOf(built.edges.flatMap((e) => e.exposureIds), now),
    }
  }

  private async record(dir: string, flowId: string, context: ToolContext): Promise<PlanInput> {
    const modelId = await platformModelOf(dir)
    const signer = await signerFor(dir, false)
    const decisions = await readDecisions(dir, isSigner(signer) ? signer : null)
    if (decisions.status !== 'ok') throw new Refusal('decisions_unreadable', `the hidden-edge decisions cannot be read (${decisions.code})`)
    const accepted = decisionOfFlow(decisions.decisions, flowId)
    if (!accepted) throw new Refusal('not_hidden_edge', 'no accepted hidden-edge decision of this machine stands for that flow: it is removed as an ordinary flow')
    // The findings this edge's accept affirmed, best effort: signed out or offline, the take-back is still recorded
    let read: Awaited<ReturnType<typeof readModelExposures>> | null = null
    let unread: string | undefined
    if (!context.apolloClient) unread = context.clientUnavailableReason ? 'the platform could not be reached' : 'not signed in'
    else {
      try {
        read = await readModelExposures(context.apolloClient, modelId)
      } catch (err) {
        unread = graphQLErrorCode(err) === 'UNAUTHENTICATED' ? 'not signed in' : err instanceof ModelReadError ? `the platform model could not be read: ${err.code}` : 'the platform could not be reached'
      }
    }
    const now = new Map((read?.rows ?? []).map((r) => [r.exposure_id, r]))
    const plan = planRecord(accepted, now, { id: modelId, name: read?.model_name ?? null }, new Date().toISOString(), unread)
    return { kind: 'record', log_id: '', model_id: modelId, plan, decisions_hash: await decisionsHash(dir), exposures: new Map() }
  }

  private async commit(dir: string, input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const taken = this.plans.take(input.plan_id!, dir)
    if (taken.status === 'spent') throw new Refusal(taken.end === 'stale' ? 'plan_stale' : 'plan_used', SPENT[taken.end])
    if (taken.status !== 'ok') {
      if (taken.status === 'expired') throw new Refusal('plan_expired', 'the plan is older than 30 minutes: prepare again')
      if (taken.status === 'other_model') throw new Refusal('plan_other_model', 'the plan was prepared for another model directory')
      if (taken.status === 'running') throw new Refusal('busy', 'a commit of this plan is running now')
      throw new Refusal('plan_not_found', 'no such plan in this session (a restart forgets plans): prepare again')
    }
    const plan = taken.plan
    const p = plan.input
    if (p.kind !== 'record' && !context.apolloClient) {
      this.plans.release(plan)
      return noClient(context)
    }
    if ((input.action === 'publish') !== (p.kind === 'publish')) {
      this.plans.release(plan)
      throw new Refusal('plan_kind', p.kind === 'publish' ? "the plan is a publish plan: 'publish' it, or prepare a plan to apply here" : "the plan is not a publish plan: 'commit' it, or prepare_publish for the workspace")
    }
    const logId = p.log_id || plan.id
    const at = new Date().toISOString()
    const record = (change: (applies: LoggedApply[]) => void) =>
      recordReviewIn(dir, HIDDEN_EDGE_RECORD, logId, (): LoggedReview => ({ review_id: logId, mode: `hidden-edges-${p.kind}`, opened_at: at, groups: 0, replies: [], applies: [] }), (entry) => change(entry.applies))
    const append = (outcome: LoggedApply['outcome']) =>
      record((applies) => {
        refuseWhenFull(applies, LOG_LIMITS.answers, 'answers', 'prepare again')
        applies.push({ at, plan_id: plan.id, ...recordedText(input.reply!), outcome })
      })
    const settle = async (outcome: LoggedApply['outcome']): Promise<string[]> => {
      try {
        return (await record((applies) => {
          const yes = [...applies].reverse().find((a) => a.plan_id === plan.id && 'answer' in a.outcome)
          if (yes) yes.outcome = outcome
        })).warnings
      } catch (err) {
        if (err instanceof RecordError) return [`the outcome was not recorded: ${err.message}`]
        throw err
      }
    }

    const lines = input.lines!
    const differs = !(lines.length === plan.lines.length && lines.every((l, i) => l === plan.lines[i]))
    const answer = p.kind === 'record' ? takeBackAnswer(input.reply!) : applyAnswer(input.reply!)
    if (differs || answer === null) {
      try {
        await append({ refused: differs ? 'lines_differ' : 'reply_not_answer' })
      } finally {
        this.plans.release(plan)
      }
      if (differs) throw new Refusal('lines_differ', "commit passes the plan's lines exactly as returned, as the operator was shown them; nothing was written")
      throw new Refusal('reply_not_answer', p.kind === 'record' ? "the answer to the question is 'reject', 'release' or 'cancel'; nothing was written" : "the answer to the question is 'yes' or 'cancel'; nothing was written or sent", { ask: askOf(p) })
    }
    if (answer === 'cancel') {
      try {
        await append({ cancelled: true })
      } catch (err) {
        this.plans.release(plan)
        throw err
      }
      this.plans.consume(plan, 'cancelled')
      return { success: true, data: { plan_id: plan.id, cancelled: true, ...(p.kind === 'publish' ? { sent: 0 } : { written: 0 }), ...(p.kind === 'record' ? { flow_kept: true } : {}) } }
    }
    // The answer is recorded before anything is written.
    try {
      await append({ answer })
    } catch (err) {
      this.plans.release(plan)
      throw err
    }
    return this.turns.run(p.model_id, async () => {
      let after: Map<string, ExposureState>
      try {
        if ((await platformModelOf(dir)) !== p.model_id) {
          this.plans.consume(plan, 'stale')
          const warnings = await settle({ refused: 'plan_stale' })
          throw new Refusal('plan_stale', 'the model directory now names another platform model; nothing was written', warned(warnings))
        }
        after = p.exposures.size ? new Map((await readModelExposures(context.apolloClient!, p.model_id)).rows.map((r) => [r.exposure_id, r])) : new Map()
      } catch (err) {
        if (err instanceof Refusal) throw err
        this.plans.release(plan)
        await settle({ refused: err instanceof TriageModelError || err instanceof ModelReadError ? err.code : 'model_unread' }).catch(() => [])
        throw err
      }
      const moved = changed(p.exposures, after)
      const filesMoved = p.kind === 'apply' ? (await computeContentHash(dir)) !== p.local_hash : p.kind === 'record' ? (await decisionsHash(dir)) !== p.decisions_hash : false
      if (moved.length || filesMoved) {
        this.plans.consume(plan, 'stale')
        const warnings = await settle({ refused: 'plan_stale' })
        throw new Refusal('plan_stale', `the plan no longer holds (${moved.length} exposure(s)${filesMoved ? ' and the files' : ''} changed since prepare); nothing was written: prepare again`, { changed: moved, ...warned(warnings) })
      }
      if (p.kind === 'publish') return this.send(dir, plan, p, settle, context)
      // The platform model as the plan was prepared on: an edge accepted in the review workspace since is a flow the
      // files lack, and an accept of it here would plan a second one.
      if (p.kind === 'apply' && p.plan.decisions.some((d) => d.verb === 'accepted')) {
        let platform: OpenRefusal | null
        try {
          platform = await platformChangeRefusal(dir, p.model_id, context.apolloClient!)
        } catch (err) {
          this.plans.release(plan)
          await settle({ refused: 'platform_unread' }).catch(() => [])
          throw err
        }
        if (platform) {
          // an unread platform may read next time: the plan stands; any other refusal needs a pull, which moves the files
          if (platform.code === 'platform_unread') this.plans.release(plan)
          else this.plans.consume(plan, 'stale')
          const warnings = await settle({ refused: platform.code }).catch(() => [])
          throw new Refusal(platform.code, `${platform.message}; nothing was written`, { ...platform.details, ...warned(warnings) })
        }
      }
      // An accept is written signed: without this machine's key (created here, once the plan holds) nothing is written.
      let signer: Signer | null = null
      if (p.kind === 'apply' && p.plan.decisions.some((d) => d.verb === 'accepted')) {
        const s = await signerFor(dir, true)
        if (!isSigner(s)) {
          this.plans.release(plan)
          await settle({ refused: 'key_unavailable' }).catch(() => [])
          throw new Refusal('key_unavailable', `this machine's signing key cannot be used (${s.code}); nothing was written: an accepted decision is never written unsigned`)
        }
        signer = s
      }
      try {
        const data = await this.write(dir, p, signer, context, answer)
        this.plans.consume(plan, data.failed ? 'failed' : 'committed')
        const warnings = await settle({ written: data.written, failed: data.failed })
        return { success: true, data: { plan_id: plan.id, ...data, ...warned(warnings) } }
      } catch (err) {
        // A refusal before the first write wrote nothing: the plan is stale. Anything else may follow writes.
        this.plans.consume(plan, err instanceof ApplyWriteError ? 'stale' : 'failed')
        await settle({ write_error: true }).catch(() => [])
        throw err
      }
    })
  }

  /**
   * Send a publish plan whose bounds held: the review still untouched, the analysis the question named (or created
   * now, when it said so), the fingerprints read now if not before, one call, then the record.
   */
  private async send(
    dir: string,
    plan: SettlePlan<PlanInput>,
    p: Extract<PlanInput, { kind: 'publish' }>,
    settle: (outcome: LoggedApply['outcome']) => Promise<string[]>,
    context: ToolContext,
  ): Promise<ToolResult<Record<string, unknown>>> {
    const pub = p.plan
    const client = context.apolloClient!
    const stop = async (end: PlanEnd, code: string, message: string, details: Record<string, unknown> = {}): Promise<never> => {
      this.plans.consume(plan, end)
      const warnings = await settle({ refused: code })
      throw new Refusal(code, message, { ...details, ...warned(warnings) })
    }
    // A lost session before anything is sent keeps the plan: the same call, after signing in again
    const lostSession = async (detail: string): Promise<never> => {
      this.plans.release(plan)
      await settle({ refused: 'session_refused' }).catch(() => [])
      throw new Refusal('session_refused', `${detail}; nothing was sent, and the plan stands: publish it again after signing in`)
    }
    const review = hiddenEdgeReviews.get(p.log_id)
    // untouched: no reply here and no other publish (one never confirmed may be sent again)
    const untouched = (r: HiddenEdgeReview) => !(r.published ? !r.published.unconfirmed : r.closed) && !r.candidates.some((c) => c.choice !== 'open' || c.edited)
    const changedHere = 'the review changed since prepare (a reply here, or another publish); nothing was sent'
    if (!review || !untouched(review)) return stop('stale', 'plan_stale', changedHere)
    if (!pub.built.edges.length) return stop('refused', 'nothing_to_publish', 'nothing in this review can go to the Hidden edges workspace; nothing was sent')
    // Fingerprints still to read past the window since open: nothing goes
    if (pub.source === 'publish' && Date.now() - pub.opened_at_ms > LATE_FINGERPRINT_MS) return stop('stale', 'review_late', "more than 30 minutes have passed since the review opened, so the edges' state can no longer be read as the analyst saw it; nothing was sent: open a new review to publish")
    // The analysis the question named: the same one now, or none when it said one is created
    const found = await findAnalysis(client, p.model_id, pub.class_id, HIDDEN_EDGES_ANALYSIS)
    if (found.status === 'session_refused') return lostSession(found.detail)
    if (found.status !== 'found' && found.status !== 'none') return stop('refused', 'workspace_unavailable', `the model's Hidden edges analysis could not be looked up: ${found.detail}; nothing was sent`)
    let analysisId = found.status === 'found' ? found.id : null
    // the one the question said is created, made by an earlier attempt of this plan or another machine, is the same
    const holds = pub.analysis_id !== null ? analysisId === pub.analysis_id : analysisId === null || analysisId === deterministicAnalysisId(p.model_id, pub.class_id, HIDDEN_EDGES_ANALYSIS.prefix)
    if (!holds) return stop('stale', 'plan_stale', "the model's Hidden edges analysis changed since prepare; nothing was sent: prepare_publish again, to see where the edges go")
    let created = false
    if (!analysisId) {
      const c = await createAnalysis(client, p.model_id, pub.class_id, HIDDEN_EDGES_ANALYSIS)
      if (c.status === 'session_refused') return lostSession(c.detail)
      if (c.status !== 'created') return stop('refused', 'workspace_unavailable', `the model's Hidden edges analysis could not be created: ${c.detail}; nothing was sent`)
      analysisId = c.id
      created = true
    }
    let built = pub.built
    if (pub.source === 'publish') {
      const st = await readEdgeStates(client, analysisId, built.edges.map((e) => ({ candidateId: e.candidateId, kind: e.kind, source: e.source, target: e.target, exposureIds: e.exposureIds })))
      if (st.status === 'session_refused') return lostSession(st.detail)
      if (st.status !== 'answer') return stop('refused', 'workspace_unavailable', `the edges' state in the Hidden edges workspace could not be read: ${st.status === 'refused' ? refusalWords(st.reason) : st.detail}; nothing was sent`)
      built = withEdgeStates(built, new Map([...st.states].flatMap(([id, s]) => ('gone' in s ? [] : [[id, s] as const]))), review)
      if (!built.edges.length) return stop('refused', 'nothing_to_publish', 'nothing in this review can go to the Hidden edges workspace now (see not_sent); nothing was sent', { not_sent: built.left })
    }
    const payload = edgePayloadOf(p.log_id, built)
    if (Buffer.byteLength(payload, 'utf8') > REVIEW_LIMITS.payloadBytes) return stop('refused', 'payload_too_large', 'the edges are too large for one publish: decide some here')
    const at = new Date().toISOString()
    const edges = Object.fromEntries(built.edges.map((e) => [e.candidateId, { n: review.candidates.find((c) => c.id === e.candidateId)!.n, kind: e.kind, source: e.source, target: e.target }]))
    // Compare and close, in one step with no wait between: a reply that landed while the workspace was asked is not
    // overridden, and one landing from here on finds the review closed. Nothing stored opens it again.
    if (!untouched(review)) return stop('stale', 'plan_stale', changedHere)
    const wasClosed = review.closed
    review.closed = true
    let answer: Awaited<ReturnType<typeof publishEdges>>
    try {
      answer = await publishEdges(client, analysisId, payload)
    } catch (err) {
      review.closed = wasClosed
      throw err
    }
    if (answer.status === 'session_refused' || answer.status === 'refused' || answer.status === 'module_not_loaded') review.closed = wasClosed
    if (answer.status === 'session_refused') return lostSession(answer.detail)
    if (answer.status === 'refused' || answer.status === 'module_not_loaded') {
      const why = answer.status === 'refused' ? refusalWords(answer.reason, answer.field) : answer.detail
      return stop('refused', answer.status === 'refused' ? 'publish_refused' : answer.status, `${why}; nothing was stored`, answer.status === 'refused' && answer.field ? { field: answer.field } : {})
    }
    if (answer.status !== 'answer') {
      // No answer: the workspace may hold the edges. Publishing again is safe: each edge's entry is replaced.
      this.plans.consume(plan, 'unconfirmed')
      review.published = { at, analysis_id: analysisId, unconfirmed: true }
      review.closed = true
      hiddenEdgeReviews.put(review)
      await settle({ write_error: true }).catch(() => [])
      await this.logPublish(dir, review, { at, plan_id: plan.id, analysis_id: analysisId, edges, not_stored: [], results: {}, fingerprints: pub.source, unconfirmed: true }).catch(() => [])
      throw new Refusal('write_error', `not confirmed: ${answer.detail}. The Hidden edges workspace may have stored it; 'hidden_edges published' shows what it holds, and prepare_publish again sends it once more, safely`)
    }
    const results: Record<string, number> = {}
    for (const r of answer.results) results[r.result] = (results[r.result] ?? 0) + 1
    const notStored = answer.results.filter((r) => r.result !== 'stored' && r.result !== 'stored_stale').map((r) => ({ candidate_id: r.candidateId, result: r.result }))
    this.plans.consume(plan, 'published')
    review.published = { at, analysis_id: analysisId }
    review.closed = true
    hiddenEdgeReviews.put(review)
    const stored = (results.stored ?? 0) + (results.stored_stale ?? 0)
    const warnings = [
      ...(await settle({ published: stored, not_stored: notStored.length })),
      ...(await this.logPublish(dir, review, { at, plan_id: plan.id, analysis_id: analysisId, edges, not_stored: notStored, results, fingerprints: pub.source })),
    ]
    return {
      success: true,
      data: {
        plan_id: plan.id,
        analysis_id: analysisId,
        ...(created ? { created: true } : {}),
        edges: built.edges.length,
        results,
        not_stored: notStored.map((r) => ({ ...r, why: `not stored: ${EDGE_NOT_STORED_WORDS[r.result] ?? r.result}` })),
        ...(built.left.length > pub.built.left.length ? { not_sent: built.left.filter((l) => !pub.built.left.some((x) => x.candidate_id === l.candidate_id)) } : {}),
        ...warned(warnings),
      },
    }
  }

  /** Record a publish beside the review's replies: what left this machine, where it went, and the answer. */
  private async logPublish(dir: string, review: HiddenEdgeReview, entry: LoggedEdgePublish): Promise<string[]> {
    try {
      return (await recordReviewIn(dir, HIDDEN_EDGE_RECORD, review.id, freshOf(review), (r) => {
        r.published_edges = [...(r.published_edges ?? []), entry]
      })).warnings
    } catch (err) {
      if (err instanceof RecordError) return [`the publish was not recorded: ${err.message}`]
      throw err
    }
  }

  /** Write a plan whose bounds held: the local part first, then the platform's. */
  private async write(dir: string, p: Exclude<PlanInput, { kind: 'publish' }>, signer: Signer | null, context: ToolContext, answer: string): Promise<{ written: number; failed: number; flows?: number; outcomes?: unknown[]; recorded?: string }> {
    if (p.kind === 'record') {
      const verb = TAKE_BACK_VERBS[answer as TakeBack]
      try {
        await replaceDecisions(dir, p.decisions_hash, (entries) => [...entries, { ...p.plan.decision, verb, mac: null }])
      } catch (err) {
        if (err instanceof StateFileError && err.code === 'changed') throw new ApplyWriteError('files_changed', 'the decisions changed since prepare; nothing was written: prepare again')
        throw err
      }
      return { written: 1, failed: 0, recorded: verb }
    }
    const local = await writeApply(dir, p.plan, signer as Signer, p.files)
    const ready = p.plan.affirmations.filter((o) => o.status === 'ready')
    const outcomes = ready.length ? await writeOperations(context.apolloClient!, p.plan.affirmations, new Map()) : []
    const failed = outcomes.filter((o) => o.status !== 'applied').length
    return { written: local.decisions + outcomes.length - failed, failed, flows: local.flows, outcomes }
  }
}

export const manageHiddenEdgesTool = new ManageHiddenEdgesTool()
