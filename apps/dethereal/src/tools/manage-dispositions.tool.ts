/**
 * manage_dispositions: write what a closed triage review decided, in two steps, the operator's answer between them.
 *
 * `prepare` checks the review's operations against the platform (one read of the model) and against what the
 * review saw when it was opened, writes nothing, and returns a plan: the operations ready to write, those rejected
 * with why, and the lines the operator is shown, the platform model first. `commit` takes the plan, the lines, and
 * the operator's answer to the apply question: on `yes` it records the answer, reads the model again, and writes
 * only if no exposure of the plan changed since `prepare`; on `cancel` it writes nothing. A plan is held in this
 * process only, expires, and commits at most once; the commits to one platform model run one at a time in this
 * process (another process is not held back: the re-read before writing is the guard there).
 *
 * `prepare_publish` and `publish` send an untouched review's proposals to the platform's review workspace instead,
 * for a person to decide there; no disposition is written. A plan is one kind or the other, refused across, and a
 * published review is never committed here.
 */
import { z } from 'zod'
import { ClientDependentTool, type ToolContext, type ToolResult } from './base-tool.js'
import { coded, need, only, PLAN_ID, REPLY_INPUT_MAX, REVIEW_ID } from './input-rules.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { SettlePlanStore } from '../utils/settle-plans.js'
import { operationsOf } from '../triage/review.js'
import { reviewStore } from '../triage/store.js'
import { LOG_LIMITS, recordedText, recordReview, RecordError, refuseWhenFull, type LoggedApply, type LoggedReview } from '../triage/log.js'
import { platformModelOf, TriageModelError } from '../triage/model.js'
import { ModelReadError, readExposureEvidence, readModelExposures, type ExposureEvidence, type ExposureState } from '../triage/exposures.js'
import {
  applyAnswer,
  changedSince,
  ECHO_BUDGET,
  echoOf,
  echoSize,
  fingerprintOf,
  planOperations,
  readTechniques,
  todayIso,
  writeOperations,
  type PlannedOperation,
} from '../triage/dispositions.js'
import { Turns } from '../triage/turns.js'
import { applyAsk, publishAsk } from '../triage/asks.js'
import type { LoggedPublish } from '../triage/log.js'
import { WAITING_STATUSES, REVIEW_LIMITS } from '../review-module/contract.js'
import { createTriageAnalysis, findTriageAnalysis, probe, publishProposals, readProposals, readStates, type FindingState } from '../review-module/platform.js'
import { buildPublish, LATE_FINGERPRINT_MS, NOT_STORED_WORDS, payloadOf, publishLines, withFingerprints, type Built } from '../review-module/payload.js'


const InputSchema = z.object({
  action: z.enum(['prepare', 'commit', 'prepare_publish', 'publish']).describe("'prepare' checks a closed review and returns a plan; 'commit' writes it after the operator's answer; 'prepare_publish' and 'publish' send an untouched review's proposals to the Triage workspace instead"),
  directory_path: z.string().max(4096).describe('The model directory'),
  review_id: REVIEW_ID.optional().describe("For 'prepare' and 'prepare_publish': the review"),
  plan_id: PLAN_ID.optional().describe("For 'commit' and 'publish': the plan its prepare returned"),
  lines: z.array(z.string().max(ECHO_BUDGET)).max(400).optional().describe("For 'commit' and 'publish': the plan's lines, exactly as its prepare returned them"),
  reply: z.string().max(REPLY_INPUT_MAX).optional().describe("For 'commit' and 'publish': the operator's answer to the question, exactly as given (yes or cancel)"),
}).strict().superRefine((d, ctx) => {
  const preparing = d.action === 'prepare' || d.action === 'prepare_publish'
  if (preparing) need(ctx, !!d.review_id, 'review_id', d.action)
  else {
    need(ctx, !!d.plan_id, 'plan_id', d.action)
    need(ctx, !!d.lines, 'lines', d.action)
    need(ctx, d.reply !== undefined, 'reply', d.action)
  }
  only(ctx, !preparing && d.review_id !== undefined, 'review_id', "'prepare' and 'prepare_publish'")
  only(ctx, preparing && (d.plan_id !== undefined || d.lines !== undefined || d.reply !== undefined), 'plan_id, lines and reply', "'commit' and 'publish'")
})
type Input = z.infer<typeof InputSchema>

/** A publish plan: the payload to send, where it goes, and when its findings' fingerprints were or will be read. */
interface PublishPlan {
  built: Built
  model_name: string
  triage_class_id: string
  /** The analysis found, or null when the publish creates the model's Triage analysis */
  analysis_id: string | null
  fingerprints: Map<string, { fingerprint: string; fpVersion: number }> | null
  source: LoggedPublish['fingerprints']
  opened_at_ms: number
  late: boolean
  /** Proposals waiting there that this publish replaces, as the question said; null when they could not be counted */
  pending: number | null
}

/** What a plan holds: the review it came from, the model, the operations, and the state prepare checked them against. */
interface PlanInput {
  kind: 'dispositions' | 'publish'
  publish?: PublishPlan
  review_id: string
  mode: string
  model_id: string
  operations: PlannedOperation[]
  state: Map<string, ExposureState>
  evidence: Map<string, ExposureEvidence>
}
type DispositionPlanEnd = 'committed' | 'stale' | 'failed' | 'cancelled' | 'published' | 'refused' | 'unconfirmed'

/** What the refused-answers count is called in its record_full refusal. */
const REFUSED_ANSWERS = 'refused answers'

class Refusal extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message)
  }
}

const SPENT: Record<DispositionPlanEnd, string> = {
  committed: 'the plan was committed already: nothing to redo',
  failed: 'the plan was committed already, and some of its writes failed: see that commit\'s outcomes; prepare again for what is left',
  cancelled: 'the plan was cancelled: prepare again',
  stale: 'the plan was found stale and nothing was written: prepare again',
  published: "the proposals were published already: 'triage_review published' shows what the workspace holds",
  refused: 'the Triage workspace refused the publish and nothing was stored: prepare again',
  unconfirmed: "the publish was sent and its answer never came: 'triage_review published' shows what the Triage workspace holds; prepare_publish again to send it once more",
}

/** Ready operations for the exposures a publish sends, so the plan is bound to them as a disposition plan is. */
const readyOf = (ids: string[]): PlannedOperation[] => ids.map((exposure_id, index) => ({ index, group: 0, exposure_id, name: null, element: null, op: 'affirm', status: 'ready' }) as unknown as PlannedOperation)

const idsOf = (built: Built): string[] => built.groups.flatMap((g) => g.findings.map((f) => f.exposureId))
const groupOf = (built: Built): Record<string, number> => Object.fromEntries(built.groups.flatMap((g) => g.findings.map((f) => [f.exposureId, Number(g.groupId)])))

/** A module refusal in the operator's words. */
const refusalWords = (reason: string, field?: string): string =>
  reason === 'not_triage'
    ? "the Triage workspace refused it (not_triage): the model's Triage analysis is linked to more than one model; create one from the model in the platform and publish again"
    : reason === 'busy' || reason === 'deadline'
    ? `the Triage workspace is busy (${reason}): try again in a moment`
    : `the Triage workspace refused it (${reason}${field ? `, field ${field}` : ''})${field ? ': this Dethereal and the workspace module disagree; decide here instead' : ''}`

export class ManageDispositionsTool extends ClientDependentTool<Input, Record<string, unknown>> {
  readonly name = 'manage_dispositions'
  readonly description =
    "Write the dispositions a closed triage review decided, in two steps. 'prepare' (review_id) checks every " +
    'operation against the platform and against what the review saw when it was opened, writes nothing, and returns ' +
    '{plan_id, expires_at, count, operations, lines, ask?}: count is the operations ready to write; each operation is ready ' +
    'or rejected with its code; the lines (the platform model first) say what each write does and why a rejected one ' +
    "is not applied. Show the operator the lines, then ask: the apply question, its tag first, given when count is at " +
    "least 1, to end the message with exactly as returned. A commit refused for an answer that is neither 'yes' nor " +
    "'cancel' carries the same ask. 'commit' (plan_id, the lines exactly " +
    "as returned, and the operator's answer exactly as given) writes only on 'yes', and only if no exposure of the " +
    "plan changed since prepare, returning {written, failed, outcomes}; 'cancel' writes nothing. 'prepare_publish' " +
    "(review_id, an open review with no replies) instead shows what would go to the platform's Triage workspace for a " +
    "person to decide, returning {plan_id, groups, findings, not_sent, lines, ask?}; 'publish' (plan_id, the lines " +
    "exactly as returned, the answer exactly as given) sends it on 'yes', returning {analysis_id, results, not_stored}; " +
    'no disposition is written, and a published review is never committed. Call it from the main session only.'
  readonly inputSchema = InputSchema
  readonly plans = new SettlePlanStore<PlanInput, DispositionPlanEnd>()
  private readonly turns = new Turns()

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      if (input.action === 'prepare') return await this.prepare(dir, input.review_id!, context)
      if (input.action === 'prepare_publish') return await this.preparePublish(dir, input.review_id!, context)
      return await this.commit(dir, input, context)
    } catch (err) {
      if (err instanceof Refusal) return coded(err.code, err.message, err.details)
      if (err instanceof TriageModelError || err instanceof ModelReadError) return coded(err.code, err.message)
      if (err instanceof RecordError) return coded(err.code, err.message)
      return { success: false, error: err instanceof Error ? err.message : 'manage_dispositions failed' }
    }
  }

  private async prepare(dir: string, reviewId: string, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const review = reviewStore.get(reviewId)
    if (!review) throw new Refusal('review_not_found', 'no such review in this session (a restart forgets reviews; one unused for two hours expires): open it again')
    if (review.dir !== dir) throw new Refusal('other_model', 'the review was opened for another model directory')
    if (review.published) throw new Refusal('review_published', review.published.unconfirmed
      ? "the review's publish was sent but never confirmed: 'triage_review published' shows whether it landed; run triage again to decide here instead"
      : "the review was published to the Triage workspace, where a person decides it: nothing is written here; 'triage_review published' shows what became of it")
    if (!review.closed) throw new Refusal('review_open', "the review is still open: it closes with 'accept-all' or 'done'")
    const client = context.apolloClient!
    const modelId = await platformModelOf(dir)
    if (modelId !== review.model_id) throw new Refusal('other_model', 'the model directory now names another platform model than the review was opened on: open a new review')
    const read = await readModelExposures(client, modelId)
    const state = new Map(read.rows.map((r) => [r.exposure_id, r]))
    const operations = operationsOf(review)
    const evidence = new Map<string, ExposureEvidence>()
    for (const o of operations) {
      if (o.op === 'supersede' && state.has(o.exposure_id) && !evidence.has(o.exposure_id)) {
        const e = await readExposureEvidence(client, o.exposure_id)
        if (e) evidence.set(o.exposure_id, e)
      }
    }
    const adds = [...new Set(operations.flatMap((o) => o.modifications?.techniques?.add ?? []))]
    const techniques = await readTechniques(client, adds)
    const planned = planOperations({ operations, state, seen: review.seen, evidence, techniques, date: todayIso() })
    const echo = echoOf(review, planned)
    // Bounded at open and at every edit; this holds unless the platform changed in a way the review is not bound to.
    if (echoSize(echo) > ECHO_BUDGET) throw new Refusal('echo_too_large', `the plan is too large to show whole (${planned.length} operations): open a review of fewer groups`)
    const plan = this.plans.add(dir, { kind: 'dispositions', review_id: reviewId, mode: review.mode, model_id: modelId, operations: planned, state, evidence }, null, fingerprintOf(planned, state), echo.lines)
    return { success: true, data: { plan_id: plan.id, expires_at: plan.expiresAtIso, ...echo, ...(echo.count > 0 ? { ask: applyAsk(echo.count) } : {}) } }
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
    const wanted = input.action === 'publish' ? 'publish' : 'dispositions'
    if (plan.input.kind !== wanted) {
      this.plans.release(plan)
      throw new Refusal('plan_kind', wanted === 'publish' ? 'the plan is a disposition plan: commit it, or prepare_publish for the workspace' : "the plan is a publish plan: 'publish' it, or prepare a disposition plan")
    }
    const reply = input.reply!
    const at = new Date().toISOString()
    const record = (change: (applies: LoggedApply[]) => void) =>
      recordReview(dir, plan.input.review_id, (): LoggedReview => ({ review_id: plan.input.review_id, mode: plan.input.mode, opened_at: at, groups: 0, replies: [], applies: [] }), (entry) => change(entry.applies))
    // Refused answers are bounded on their own, so a yes or a cancel can still be given after them.
    const append = (outcome: LoggedApply['outcome']) =>
      record((applies) => {
        // The total first: once it is reached no answer is taken, so the refusal must not invite one.
        refuseWhenFull(applies, LOG_LIMITS.answers, 'answers', 'open a new review')
        if ('refused' in outcome) refuseWhenFull(applies.filter((a) => 'refused' in a.outcome), LOG_LIMITS.refusedAnswers, REFUSED_ANSWERS, "answer 'yes' or 'cancel', or open a new review")
        applies.push({ at, plan_id: plan.id, ...recordedText(reply), outcome })
      })

    const differs = !sameLines(plan.lines, input.lines!)
    const answer = applyAnswer(reply)
    if (differs || answer === null) {
      // The question is asked again after an answer that is not one, while yes and cancel can still be taken.
      const ready = plan.input.operations.filter((o) => o.status === 'ready').length
      const pub = plan.input.publish
      // No ready operation: prepare asked nothing, so neither does a refusal of the answer.
      const ask = ready > 0 ? { ask: pub ? publishAsk(pub.built.groups.length, ready, pub.pending) : applyAsk(ready) } : {}
      try {
        await append({ refused: differs ? 'lines_differ' : 'reply_not_answer' })
      } catch (err) {
        if (!differs && err instanceof RecordError && err.code === 'record_full' && err.what === REFUSED_ANSWERS) throw new Refusal(err.code, err.message, ask)
        throw err
      } finally {
        this.plans.release(plan)
      }
      if (differs) throw new Refusal('lines_differ', "the plan's lines go back exactly as prepare returned them, as the operator was shown them; nothing was written")
      throw new Refusal('reply_not_answer', "the answer is 'yes' or 'cancel'; nothing was written", ask)
    }
    if (answer === 'cancel') {
      try {
        await append({ cancelled: true })
      } catch (err) {
        this.plans.release(plan)
        throw err
      }
      this.plans.consume(plan, 'cancelled')
      return { success: true, data: { plan_id: plan.id, cancelled: true, ...(plan.input.publish ? { sent: 0 } : { written: 0 }) } }
    }
    // The answer is recorded before anything is written: an answer the record does not hold writes nothing.
    try {
      await append({ answer: 'yes' })
    } catch (err) {
      this.plans.release(plan)
      throw err
    }
    if (plan.input.publish) return this.turns.run(plan.input.model_id, () => this.send(dir, plan, record, context))
    // One at a time per platform model, not per directory: two directories synced to one model share its exposures.
    return this.turns.run(plan.input.model_id, async () => {
      // inside the turn, so a publish queued before it is seen
      if (reviewStore.get(plan.input.review_id)?.published) {
        this.plans.consume(plan, 'stale')
        const warnings = await this.settle(record, plan.id, { refused: 'review_published' })
        throw new Refusal('review_published', 'the review was published to the Triage workspace, where a person decides it: nothing was written here', warned(warnings))
      }
      let after: Map<string, ExposureState>
      try {
        const modelId = await platformModelOf(dir)
        if (modelId !== plan.input.model_id) {
          this.plans.consume(plan, 'stale')
          const warnings = await this.settle(record, plan.id, { refused: 'plan_stale' })
          throw new Refusal('plan_stale', 'the model directory now names another platform model; nothing was written: open a new review', warned(warnings))
        }
        after = new Map((await readModelExposures(context.apolloClient!, modelId)).rows.map((r) => [r.exposure_id, r]))
      } catch (err) {
        if (err instanceof Refusal) throw err
        // Nothing was written: the plan may be committed again.
        this.plans.release(plan)
        await this.settle(record, plan.id, { refused: err instanceof TriageModelError || err instanceof ModelReadError ? err.code : 'model_unread' }).catch(() => [])
        throw err
      }
      // A copy a supersede would create, named on its element since prepare, is a change too; so is a source whose row
      // is on another element now than the one its copy goes on.
      const copied = plan.input.operations
        .filter((o) => o.status === 'ready' && o.clone && ([...after.values()].some((r) => r.element_id === o.clone!.element_id && r.name === o.clone!.name) || after.get(o.exposure_id)?.element_id !== o.clone.element_id))
        .map((o) => o.exposure_id)
      if (fingerprintOf(plan.input.operations, after) !== plan.fingerprint || copied.length) {
        const changed = [...new Set([...changedSince(plan.input.operations, plan.input.state, after), ...copied])]
        this.plans.consume(plan, 'stale')
        const warnings = await this.settle(record, plan.id, { refused: 'plan_stale' })
        throw new Refusal('plan_stale', `the plan no longer holds (${changed.length} exposure(s) changed since prepare); nothing was written: prepare again`, { changed, ...warned(warnings) })
      }
      let outcomes: Awaited<ReturnType<typeof writeOperations>>
      try {
        outcomes = await writeOperations(context.apolloClient!, plan.input.operations, plan.input.evidence)
      } catch (err) {
        // Writes may have started: the plan is not committed again.
        this.plans.consume(plan, 'failed')
        await this.settle(record, plan.id, { write_error: true }).catch(() => [])
        throw err
      }
      const failed = outcomes.filter((o) => o.status !== 'applied').length
      const written = outcomes.length - failed
      this.plans.consume(plan, failed ? 'failed' : 'committed')
      const warnings = await this.settle(record, plan.id, { written, failed })
      return { success: true, data: { plan_id: plan.id, written, failed, outcomes, ...warned(warnings) } }
    })
  }

  /**
   * Prepare a publish of an untouched review's proposals: checked against the model as it is now (a finding that
   * changed since the review is not sent), built as the workspace takes them, and shown whole. Nothing is written.
   */
  private async preparePublish(dir: string, reviewId: string, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const review = reviewStore.get(reviewId)
    if (!review) throw new Refusal('review_not_found', 'no such review in this session (a restart forgets reviews; one unused for two hours expires): open it again')
    if (review.dir !== dir) throw new Refusal('other_model', 'the review was opened for another model directory')
    if (review.published && !review.published.unconfirmed) throw new Refusal('review_published', "the review was published already: 'triage_review published' shows what became of it")
    if (review.replies > 0) throw new Refusal('review_has_replies', 'this review has decisions made here in the chat: finish it here, or open a new review to publish')
    const client = context.apolloClient!
    const modelId = await platformModelOf(dir)
    if (modelId !== review.model_id) throw new Refusal('other_model', 'the model directory now names another platform model than the review was opened on: open a new review')
    // The workspace as open found it, or as it is now when open could not ask
    let ws = review.workspace
    if (ws?.status !== 'present') {
      const p = await probe(client)
      if (p.status !== 'present') throw new Refusal(p.status === 'module_not_loaded' ? 'module_not_loaded' : 'workspace_unavailable', `the Triage workspace is not available: ${p.detail}`)
      ws = { status: 'present', module_version: p.moduleVersion, triage_class_id: p.triageClassId, fingerprints: 'none', opened_at_ms: review.workspace?.opened_at_ms ?? Date.now() }
    }
    const read = await readModelExposures(client, modelId)
    const state = new Map(read.rows.map((r) => [r.exposure_id, r]))
    const named = [...review.groups.values()].flatMap((g) => g.exposure_ids)
    const drifted = new Set(changedSince(readyOf(named), review.seen, state))
    // The analysis and the fingerprints: from open, or read now; with no analysis yet, at the publish
    let analysisId = ws.analysis_id ?? null
    if (!analysisId) {
      const a = await findTriageAnalysis(client, modelId, ws.triage_class_id!)
      if (a.status === 'found') analysisId = a.id
      else if (a.status !== 'none') throw new Refusal('workspace_unavailable', `the model's Triage analysis could not be looked up: ${a.detail}`)
    }
    let fingerprints: PublishPlan['fingerprints'] = ws.fingerprints === 'read' && ws.states ? ws.states : null
    let source: LoggedPublish['fingerprints'] = fingerprints ? 'open' : analysisId ? 'prepare' : 'publish'
    if (!fingerprints && analysisId) {
      const st = await readStates(client, analysisId, named)
      if (st.status !== 'answer') throw new Refusal('workspace_unavailable', `the findings' state in the Triage workspace could not be read: ${st.status === 'refused' ? refusalWords(st.reason) : st.detail}`)
      fingerprints = statesOf(st.states)
      source = 'prepare'
    }
    const late = source !== 'open' && Date.now() - ws.opened_at_ms > LATE_FINGERPRINT_MS
    let built = buildPublish({ review, drifted, late })
    if (fingerprints) built = withFingerprints(built, fingerprints)
    // the proposals still waiting there, or null when they could not be counted: the question says so either way
    let pending: number | null = 0
    if (analysisId) {
      const pr = await readProposals(client, analysisId, idsOf(built))
      pending = pr.status === 'answer' ? [...pr.proposals.values()].filter((x) => 'status' in x && WAITING_STATUSES.has(x.status)).length : null
    }
    if (!built.groups.length) throw new Refusal('nothing_to_publish', 'nothing in this review can go to the Triage workspace (see not_sent): decide it here', { not_sent: built.left })
    const lines = publishLines(review, built, { modelName: review.model_name, analysisId, pending, late })
    if (lines.length > MAX_LINES || lines.reduce((n, l) => n + l.length + 1, 0) > ECHO_BUDGET) throw new Refusal('echo_too_large', 'the publish is too large to show whole: open a review of fewer groups')
    const ids = idsOf(built)
    // Every publish is recorded: a record that cannot take one more is refused now, before the question
    await recordReview(dir, review.id, freshOf(review), (entry) => refuseWhenFull(entry.published ?? [], 5, 'publishes', 'open a new review'))
    const plan = this.plans.add(dir, {
      kind: 'publish',
      review_id: reviewId,
      mode: review.mode,
      model_id: modelId,
      operations: readyOf(ids),
      state,
      evidence: new Map(),
      publish: { built, model_name: review.model_name, triage_class_id: ws.triage_class_id!, analysis_id: analysisId, fingerprints, source, opened_at_ms: ws.opened_at_ms, late, pending },
    }, null, fingerprintOf(readyOf(ids), state), lines)
    const groups = built.groups.length
    return { success: true, data: { plan_id: plan.id, expires_at: plan.expiresAtIso, groups, findings: ids.length, not_sent: built.left, lines, ask: publishAsk(groups, ids.length, pending) } }
  }

  /** Send a publish plan after its yes: the model read again, the analysis found or created, one call, the record. */
  private async send(dir: string, plan: ReturnType<typeof this.plans.take> & { status: 'ok' } extends { plan: infer P } ? P : never, record: (change: (applies: LoggedApply[]) => void) => Promise<{ warnings: string[] }>, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const pub = plan.input.publish!
    const client = context.apolloClient!
    const stop = async (end: DispositionPlanEnd, code: string, message: string, details: Record<string, unknown> = {}) => {
      this.plans.consume(plan, end)
      const warnings = await this.settle(record, plan.id, { refused: code })
      throw new Refusal(code, message, { ...details, ...warned(warnings) })
    }
    let after: Map<string, ExposureState>
    try {
      const modelId = await platformModelOf(dir)
      if (modelId !== plan.input.model_id) return await stop('stale', 'plan_stale', 'the model directory now names another platform model; nothing was sent: open a new review')
      after = new Map((await readModelExposures(client, modelId)).rows.map((r) => [r.exposure_id, r]))
    } catch (err) {
      if (err instanceof Refusal) throw err
      this.plans.release(plan)
      await this.settle(record, plan.id, { refused: err instanceof TriageModelError || err instanceof ModelReadError ? err.code : 'model_unread' }).catch(() => [])
      throw err
    }
    if (fingerprintOf(plan.input.operations, after) !== plan.fingerprint) {
      const changed = changedSince(plan.input.operations, plan.input.state, after)
      return await stop('stale', 'plan_stale', `the plan no longer holds (${changed.length} finding(s) changed since prepare); nothing was sent: prepare again`, { changed })
    }
    // The review as prepared: untouched since, and not published by another plan
    const now = reviewStore.get(plan.input.review_id)
    if (!now || now.replies > 0 || (now.published && !now.published.unconfirmed)) return await stop('stale', 'plan_stale', 'the review changed since prepare (a reply here, or another publish); nothing was sent')
    // Before any write: something to send, within one call's size (each finding's fingerprint still to add)
    if (!pub.built.groups.length) return await stop('refused', 'nothing_to_publish', 'nothing in this review can go to the Triage workspace; nothing was sent')
    if (Buffer.byteLength(payloadOf(plan.input.review_id, pub.built), 'utf8') + idsOf(pub.built).length * 100 > REVIEW_LIMITS.payloadBytes) return await stop('refused', 'payload_too_large', 'the proposals are too large for one publish: open a review of fewer groups')
    // Fingerprints still to read past the window since open: the question said otherwise, so prepare again, before any write
    if (!pub.fingerprints && Date.now() - pub.opened_at_ms > LATE_FINGERPRINT_MS && !pub.late) return await stop('stale', 'plan_stale', 'more than 30 minutes have passed since the review opened, so every proposal now goes flagged for a person and no edited copy is sent; nothing was sent: prepare again to see it as it will go')
    // The analysis the question named: the same one now, or none when it said one is created
    let analysisId: string | null = null
    const found = await findTriageAnalysis(client, plan.input.model_id, pub.triage_class_id)
    if (found.status === 'found') analysisId = found.id
    else if (found.status !== 'none') return await stop('refused', 'workspace_unavailable', `the model's Triage analysis could not be looked up: ${found.detail}; nothing was sent`)
    if (analysisId !== pub.analysis_id) return await stop('stale', 'plan_stale', "the model's Triage analysis changed since prepare; nothing was sent: prepare again, to see where the proposals go")
    let created = false
    if (!analysisId) {
      const c = await createTriageAnalysis(client, plan.input.model_id, pub.triage_class_id)
      if (c.status !== 'created') return await stop('refused', 'workspace_unavailable', `the model's Triage analysis could not be created: ${c.detail}; nothing was sent`)
      analysisId = c.id
      created = true
    }
    let built = pub.built
    let source = pub.source
    if (!pub.fingerprints) {
      const st = await readStates(client, analysisId, idsOf(built))
      if (st.status !== 'answer') return await stop('refused', 'workspace_unavailable', `the findings' state in the Triage workspace could not be read: ${st.status === 'refused' ? refusalWords(st.reason) : st.detail}; nothing was sent`)
      built = withFingerprints(built, statesOf(st.states))
      source = 'publish'
    }
    const payload = payloadOf(plan.input.review_id, built)
    if (Buffer.byteLength(payload, 'utf8') > REVIEW_LIMITS.payloadBytes) return await stop('refused', 'payload_too_large', 'the proposals are too large for one publish: open a review of fewer groups')
    const ids = idsOf(built)
    const review = reviewStore.get(plan.input.review_id)
    const at = new Date().toISOString()
    const answer = await publishProposals(client, analysisId, payload)
    if (answer.status === 'refused' || answer.status === 'module_not_loaded' || answer.status === 'session_refused') {
      const why = answer.status === 'refused' ? refusalWords(answer.reason, answer.field) : answer.detail
      return await stop('refused', answer.status === 'refused' ? 'publish_refused' : answer.status, `${why}; nothing was stored`, answer.status === 'refused' && answer.field ? { field: answer.field } : {})
    }
    if (answer.status !== 'answer') {
      // No answer: the workspace may hold the proposals. The review is not committed here; publishing again is safe.
      this.plans.consume(plan, 'unconfirmed')
      if (review) {
        review.published = { at, analysis_id: analysisId, unconfirmed: true }
        review.closed = true
        reviewStore.put(review)
      }
      await this.settle(record, plan.id, { write_error: true }).catch(() => [])
      await this.logPublish(dir, plan, { at, plan_id: plan.id, analysis_id: analysisId, exposure_ids: ids, group_of: groupOf(built), not_stored: [], results: {}, fingerprints: source, unconfirmed: true }).catch(() => [])
      throw new Refusal('write_error', `not confirmed: ${answer.detail}. The Triage workspace may have stored it; 'triage_review published' shows what it holds, and prepare_publish again sends it once more, safely`)
    }
    const results: Record<string, number> = {}
    for (const r of answer.results) results[r.result] = (results[r.result] ?? 0) + 1
    const notStored = answer.results.filter((r) => r.result !== 'stored' && r.result !== 'stored_stale').map((r) => ({ exposure_id: r.exposureId, result: r.result }))
    this.plans.consume(plan, 'published')
    if (review) {
      review.published = { at, analysis_id: analysisId }
      review.closed = true
      reviewStore.put(review)
    }
    const stored = (results.stored ?? 0) + (results.stored_stale ?? 0)
    const warnings = [
      ...(await this.settle(record, plan.id, { published: stored, not_stored: notStored.length })),
      ...(await this.logPublish(dir, plan, { at, plan_id: plan.id, analysis_id: analysisId, exposure_ids: ids, group_of: groupOf(built), not_stored: notStored, results, fingerprints: source })),
    ]
    return {
      success: true,
      data: {
        plan_id: plan.id,
        analysis_id: analysisId,
        ...(created ? { created: true } : {}),
        groups: built.groups.length,
        findings: ids.length,
        results,
        not_stored: notStored.map((r) => ({ ...r, why: `not stored: ${NOT_STORED_WORDS[r.result] ?? r.result}` })),
        ...(built.left.length > pub.built.left.length ? { not_sent: built.left.slice(pub.built.left.length) } : {}),
        ...warned(warnings),
      },
    }
  }

  /** Record a publish beside the review's answers: what left this machine, where it went, and the answer. */
  private async logPublish(dir: string, plan: { input: PlanInput }, entry: LoggedPublish): Promise<string[]> {
    try {
      return (await recordReview(dir, plan.input.review_id, freshOfIds(plan.input.review_id, plan.input.mode), (r) => {
        r.published = [...(r.published ?? []), entry]
      })).warnings
    } catch (err) {
      if (err instanceof RecordError) return [`the publish was not recorded: ${err.message}`]
      throw err
    }
  }

  /** Set the outcome of this commit's recorded yes. The writes stand when the record cannot be updated: that is a warning. */
  private async settle(record: (change: (applies: LoggedApply[]) => void) => Promise<{ warnings: string[] }>, planId: string, outcome: LoggedApply['outcome']): Promise<string[]> {
    try {
      return (await record((applies) => {
        const yes = [...applies].reverse().find((a) => a.plan_id === planId && 'answer' in a.outcome)
        if (yes) yes.outcome = outcome
      })).warnings
    } catch (err) {
      if (err instanceof RecordError) return [`the outcome was not recorded: ${err.message}`]
      throw err
    }
  }
}

const warned = (warnings: string[]) => (warnings.length ? { warnings } : {})

/** The fingerprints of the findings the module still holds. */
function statesOf(states: Map<string, FindingState>): Map<string, { fingerprint: string; fpVersion: number }> {
  const out = new Map<string, { fingerprint: string; fpVersion: number }>()
  for (const [id, st] of states) if (!('gone' in st)) out.set(id, { fingerprint: st.fingerprint, fpVersion: st.fpVersion })
  return out
}

/** At most this many lines go back with a publish, as its input takes them. */
const MAX_LINES = 400

const freshOfIds = (reviewId: string, mode: string) => (): LoggedReview => ({ review_id: reviewId, mode, opened_at: new Date().toISOString(), groups: 0, replies: [], applies: [] })
const freshOf = (review: { id: string; mode: string }) => freshOfIds(review.id, review.mode)

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

export const manageDispositionsTool = new ManageDispositionsTool()
