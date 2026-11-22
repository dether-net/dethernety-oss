/**
 * manage_hidden_edges: write what the operator decided about hidden edges, in two steps, the operator's answer
 * between them, as manage_dispositions does.
 *
 * - `prepare` (a closed review): the accepted edges as new flows in the local files, the decisions, and AFFIRMED
 *   for the pending exposures each one-by-one accept cites;
 * - `record` (a hidden-edge flow being removed): its accepted decision taken back as a reject, with the affirmed
 *   exposures it cites listed for triage.
 *
 * Each returns a plan and its lines; `commit` takes the plan, the lines as shown and the operator's answer. On
 * `yes` the answer is recorded first, the files and the platform are read again, and the plan is written only if
 * nothing it rests on changed. Plans are held in this process only, expire, and commit at most once; commits to
 * one platform model run one at a time here.
 */
import { z } from 'zod'
import { ClientDependentTool, type ToolContext, type ToolResult } from './base-tool.js'
import { coded, need, only, PLAN_ID, REPLY_INPUT_MAX, REVIEW_ID } from './input-rules.js'
import { HIDDEN_EDGE_RECORD } from './hidden-edges.tool.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { SettlePlanStore } from '../utils/settle-plans.js'
import { computeContentHash } from '../utils/sync-utils.js'
import { StateFileError } from '../utils/state-store.js'
import { LOG_LIMITS, recordedText, recordReviewIn, RecordError, refuseWhenFull, type LoggedApply, type LoggedReview } from '../triage/log.js'
import { platformModelOf, TriageModelError } from '../triage/model.js'
import { ModelReadError, readModelExposures, type ExposureState } from '../triage/exposures.js'
import { applyAnswer, writeOperations } from '../triage/dispositions.js'
import { Turns } from '../triage/turns.js'
import { ApplyWriteError, decisionOfFlow, filesBound, planApply, planRecord, writeApply, APPLY_LIMITS, type ApplyPlan, type FilesBound, type RecordPlan } from '../hidden-edges/apply.js'
import { applyAsk } from '../hidden-edges/asks.js'
import { exposureBound } from '../hidden-edges/open.js'
import { decisionsHash, isSigner, readDecisions, replaceDecisions, signDecision, signerFor, type Signer } from '../hidden-edges/records.js'
import { decided, hiddenEdgeReviews } from '../hidden-edges/review.js'

const InputSchema = z.object({
  action: z.enum(['prepare', 'record', 'commit']).describe("'prepare' plans a closed review's writes; 'record' plans taking back the accepted edge of a flow being removed; 'commit' writes a plan after the operator's answer"),
  directory_path: z.string().max(4096).describe('The model directory'),
  review_id: REVIEW_ID.optional().describe("For 'prepare': the closed review"),
  flow_id: z.string().max(128).optional().describe("For 'record': the flow being removed"),
  plan_id: PLAN_ID.optional().describe("For 'commit': the plan returned"),
  lines: z.array(z.string().max(APPLY_LIMITS.echoChars)).max(400).optional().describe("For 'commit': the plan's lines, exactly as returned"),
  reply: z.string().max(REPLY_INPUT_MAX).optional().describe("For 'commit': the operator's answer to the apply question, exactly as given (yes or cancel)"),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'prepare') need(ctx, !!d.review_id, 'review_id', 'prepare')
  if (d.action === 'record') need(ctx, !!d.flow_id, 'flow_id', 'record')
  if (d.action === 'commit') {
    need(ctx, !!d.plan_id, 'plan_id', 'commit')
    need(ctx, !!d.lines, 'lines', 'commit')
    need(ctx, d.reply !== undefined, 'reply', 'commit')
  }
  only(ctx, d.action !== 'prepare' && d.review_id !== undefined, 'review_id', "'prepare'")
  only(ctx, d.action !== 'record' && d.flow_id !== undefined, 'flow_id', "'record'")
  only(ctx, d.action !== 'commit' && (d.plan_id !== undefined || d.lines !== undefined || d.reply !== undefined), 'plan_id, lines and reply', "'commit'")
})
type Input = z.infer<typeof InputSchema>

type PlanInput =
  | { kind: 'apply'; log_id: string; model_id: string; plan: ApplyPlan; files: FilesBound; local_hash: string; exposures: Map<string, ExposureState> }
  | { kind: 'record'; log_id: string; model_id: string; plan: RecordPlan; decisions_hash: string; exposures: Map<string, ExposureState> }
type PlanEnd = 'committed' | 'stale' | 'failed' | 'cancelled'

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
}

const boundOf = (ids: Iterable<string>, state: Map<string, ExposureState>) => new Map([...new Set(ids)].flatMap((id) => (state.has(id) ? [[id, state.get(id)!] as const] : [])))
const changed = (before: Map<string, ExposureState>, after: Map<string, ExposureState>) =>
  [...before.keys()].filter((id) => JSON.stringify(exposureBound(before.get(id))) !== JSON.stringify(exposureBound(after.get(id))))
const warned = (warnings: string[]) => (warnings.length ? { warnings } : {})
const countOf = (p: PlanInput) => (p.kind === 'apply' ? p.plan.decisions.length + p.plan.affirmations.filter((o) => o.status === 'ready').length : 1)

export class ManageHiddenEdgesTool extends ClientDependentTool<Input, Record<string, unknown>> {
  readonly name = 'manage_hidden_edges'
  readonly description =
    "Write what the operator decided about hidden edges, in two steps. 'prepare' (review_id of a closed hidden_edges review) or 'record' " +
    "(flow_id, when a hidden-edge flow is removed) writes nothing and returns {plan_id, expires_at, count, lines, ask}. Show the operator the " +
    "lines, then end the message with the ask exactly as returned. 'commit' (plan_id, the lines exactly as returned, and the operator's answer " +
    "exactly as given) writes only on 'yes', and only if nothing the plan rests on changed since; 'cancel' writes nothing. New flows reach the " +
    'platform with the next push. Call it from the main session only.'
  readonly inputSchema = InputSchema
  readonly plans = new SettlePlanStore<PlanInput, PlanEnd>()
  private readonly turns = new Turns()

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      if (input.action === 'commit') return await this.commit(dir, input, context)
      const prepared = input.action === 'prepare' ? await this.prepare(dir, input.review_id!, context) : await this.record(dir, input.flow_id!, context)
      const count = countOf(prepared)
      const plan = this.plans.add(dir, prepared, null, '', prepared.plan.lines)
      return { success: true, data: { plan_id: plan.id, expires_at: plan.expiresAtIso, count, lines: plan.lines, ask: applyAsk(count) } }
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
    if (!review.closed) throw new Refusal('review_open', "the review is still open: it closes with 'accept-all' or 'done'")
    if (!decided(review).length) throw new Refusal('nothing_to_apply', 'the review accepted and rejected nothing')
    const modelId = await platformModelOf(dir)
    if (modelId !== review.model_id) throw new Refusal('other_model', 'the model directory now names another platform model than the review was opened on: open a new review')
    const localHash = await computeContentHash(dir)
    if (localHash !== review.seen.local_hash || (await decisionsHash(dir)) !== review.seen.decisions_hash) throw new Refusal('review_stale', 'the model files or the decisions changed since the review was opened: open a new review')
    const now = new Map((await readModelExposures(context.apolloClient!, modelId)).rows.map((r) => [r.exposure_id, r]))
    const moved = changed(review.seen.exposures, now)
    if (moved.length) throw new Refusal('review_stale', `${moved.length} exposure(s) the candidates cite changed since the review was opened: open a new review`, { changed: moved })
    const plan = planApply(review, now, new Date().toISOString())
    if (JSON.stringify(plan.lines).length > APPLY_LIMITS.echoChars) throw new Refusal('echo_too_large', 'the plan is too large to show whole: decide fewer candidates in one review')
    const ids = [...decided(review).flatMap((c) => c.exposure_ids)]
    return { kind: 'apply', log_id: review.id, model_id: modelId, plan, files: await filesBound(dir), local_hash: localHash, exposures: boundOf(ids, now) }
  }

  private async record(dir: string, flowId: string, context: ToolContext): Promise<PlanInput> {
    const modelId = await platformModelOf(dir)
    const signer = await signerFor(dir, false)
    const decisions = await readDecisions(dir, isSigner(signer) ? signer : null)
    if (decisions.status !== 'ok') throw new Refusal('decisions_unreadable', `the hidden-edge decisions cannot be read (${decisions.code})`)
    const accepted = decisionOfFlow(decisions.decisions, flowId)
    if (!accepted) throw new Refusal('not_hidden_edge', 'no accepted hidden-edge decision of this machine stands for that flow: it is removed as an ordinary flow')
    const read = await readModelExposures(context.apolloClient!, modelId)
    const now = new Map(read.rows.map((r) => [r.exposure_id, r]))
    const plan = planRecord(accepted, now, { id: modelId, name: read.model_name }, new Date().toISOString())
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
    const answer = applyAnswer(input.reply!)
    if (differs || answer === null) {
      try {
        await append({ refused: differs ? 'lines_differ' : 'reply_not_answer' })
      } finally {
        this.plans.release(plan)
      }
      if (differs) throw new Refusal('lines_differ', "commit passes the plan's lines exactly as returned, as the operator was shown them; nothing was written")
      throw new Refusal('reply_not_answer', "the answer to the apply question is 'yes' or 'cancel'; nothing was written", { ask: applyAsk(countOf(p)) })
    }
    if (answer === 'cancel') {
      try {
        await append({ cancelled: true })
      } catch (err) {
        this.plans.release(plan)
        throw err
      }
      this.plans.consume(plan, 'cancelled')
      return { success: true, data: { plan_id: plan.id, cancelled: true, written: 0 } }
    }
    // The answer is recorded before anything is written.
    try {
      await append({ answer: 'yes' })
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
      const filesMoved = p.kind === 'apply' ? (await computeContentHash(dir)) !== p.local_hash : (await decisionsHash(dir)) !== p.decisions_hash
      if (moved.length || filesMoved) {
        this.plans.consume(plan, 'stale')
        const warnings = await settle({ refused: 'plan_stale' })
        throw new Refusal('plan_stale', `the plan no longer holds (${moved.length} exposure(s)${filesMoved ? ' and the files' : ''} changed since prepare); nothing was written: prepare again`, { changed: moved, ...warned(warnings) })
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
        const data = await this.write(dir, p, signer, context)
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

  /** Write a plan whose bounds held: the local part first, then the platform's. */
  private async write(dir: string, p: PlanInput, signer: Signer | null, context: ToolContext): Promise<{ written: number; failed: number; flows?: number; outcomes?: unknown[] }> {
    if (p.kind === 'record') {
      try {
        await replaceDecisions(dir, p.decisions_hash, (entries) => [...entries, { ...p.plan.decision, mac: null }])
      } catch (err) {
        if (err instanceof StateFileError && err.code === 'changed') throw new ApplyWriteError('files_changed', 'the decisions changed since prepare; nothing was written: prepare again')
        throw err
      }
      return { written: 1, failed: 0 }
    }
    const local = await writeApply(dir, p.plan, signer as Signer, p.files)
    const ready = p.plan.affirmations.filter((o) => o.status === 'ready')
    const outcomes = ready.length ? await writeOperations(context.apolloClient!, p.plan.affirmations, new Map()) : []
    const failed = outcomes.filter((o) => o.status !== 'applied').length
    return { written: local.decisions + outcomes.length - failed, failed, flows: local.flows, outcomes }
  }
}

export const manageHiddenEdgesTool = new ManageHiddenEdgesTool()
