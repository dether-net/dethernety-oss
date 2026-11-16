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
import { applyAsk } from '../triage/asks.js'


const InputSchema = z.object({
  action: z.enum(['prepare', 'commit']).describe("'prepare' checks a closed review and returns a plan; 'commit' writes it after the operator's answer"),
  directory_path: z.string().max(4096).describe('The model directory'),
  review_id: REVIEW_ID.optional().describe("For 'prepare': the closed review"),
  plan_id: PLAN_ID.optional().describe("For 'commit': the plan 'prepare' returned"),
  lines: z.array(z.string().max(ECHO_BUDGET)).max(400).optional().describe("For 'commit': the plan's lines, exactly as 'prepare' returned them"),
  reply: z.string().max(REPLY_INPUT_MAX).optional().describe("For 'commit': the operator's answer to the apply question, exactly as given (yes or cancel)"),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'prepare') need(ctx, !!d.review_id, 'review_id', 'prepare')
  if (d.action === 'commit') {
    need(ctx, !!d.plan_id, 'plan_id', 'commit')
    need(ctx, !!d.lines, 'lines', 'commit')
    need(ctx, d.reply !== undefined, 'reply', 'commit')
  }
  only(ctx, d.action !== 'prepare' && d.review_id !== undefined, 'review_id', "'prepare'")
  only(ctx, d.action !== 'commit' && (d.plan_id !== undefined || d.lines !== undefined || d.reply !== undefined), 'plan_id, lines and reply', "'commit'")
})
type Input = z.infer<typeof InputSchema>

/** What a plan holds: the review it came from, the model, the operations, and the state prepare checked them against. */
interface PlanInput {
  review_id: string
  mode: string
  model_id: string
  operations: PlannedOperation[]
  state: Map<string, ExposureState>
  evidence: Map<string, ExposureEvidence>
}
type DispositionPlanEnd = 'committed' | 'stale' | 'failed' | 'cancelled'

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
}

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
    "plan changed since prepare, returning {written, failed, outcomes}; 'cancel' writes nothing. Call it from the " +
    'main session only.'
  readonly inputSchema = InputSchema
  readonly plans = new SettlePlanStore<PlanInput, DispositionPlanEnd>()
  private readonly turns = new Turns()

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      return input.action === 'prepare' ? await this.prepare(dir, input.review_id!, context) : await this.commit(dir, input, context)
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
    const plan = this.plans.add(dir, { review_id: reviewId, mode: review.mode, model_id: modelId, operations: planned, state, evidence }, null, fingerprintOf(planned, state), echo.lines)
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
      // The apply question is asked again after an answer that is not one, while yes and cancel can still be taken.
      const ready = plan.input.operations.filter((o) => o.status === 'ready').length
      // No ready operation: prepare asked nothing, so neither does a refusal of the answer.
      const ask = ready > 0 ? { ask: applyAsk(ready) } : {}
      try {
        await append({ refused: differs ? 'lines_differ' : 'reply_not_answer' })
      } catch (err) {
        if (!differs && err instanceof RecordError && err.code === 'record_full' && err.what === REFUSED_ANSWERS) throw new Refusal(err.code, err.message, ask)
        throw err
      } finally {
        this.plans.release(plan)
      }
      if (differs) throw new Refusal('lines_differ', "commit passes the plan's lines exactly as prepare returned them, as the operator was shown them; nothing was written")
      throw new Refusal('reply_not_answer', "the answer to the apply question is 'yes' or 'cancel'; nothing was written", ask)
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
    // The answer is recorded before anything is written: an answer the record does not hold writes nothing.
    try {
      await append({ answer: 'yes' })
    } catch (err) {
      this.plans.release(plan)
      throw err
    }
    // One at a time per platform model, not per directory: two directories synced to one model share its exposures.
    return this.turns.run(plan.input.model_id, async () => {
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

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

export const manageDispositionsTool = new ManageDispositionsTool()
