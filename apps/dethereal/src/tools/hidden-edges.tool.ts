/**
 * hidden_edges: a review of the hidden edges the platform's hidden-edges module proposes for a synced model.
 *
 * `open` checks the model is in sync with no local changes, reads this machine's hidden-edge decisions and the
 * model's exposures, calls the platform's hidden-edges module, validates its answer as untrusted input, and opens a
 * review of the candidates. `evidence` attaches the analyst's locators; `reply` takes the operator's commands; `get`
 * pages the table. Nothing here writes a model file or a disposition: manage_hidden_edges does.
 */
import { z } from 'zod'
import { ClientFreeTool, AUTHENTICATION_REQUIRED, type ToolContext, type ToolResult } from './base-tool.js'
import { coded, need, only, REPLY_INPUT_MAX, REVIEW_ID } from './input-rules.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { replyProblem, SETTLE_LIMITS } from '../utils/settlement.js'
import { LOG_LIMITS, recordedText, recordReviewIn, RecordError, refuseWhenFull, type LoggedReview } from '../triage/log.js'
import { TriageModelError } from '../triage/model.js'
import { ModelReadError } from '../triage/exposures.js'
import { shown } from '../triage/text.js'
import { KG_ABSENT_MARKER, KG_NO_DATA_NOTICE, KG_NOT_AVAILABLE_NOTICE } from '../triage/notices.js'
import { Turns } from '../triage/turns.js'
import { edgeLifecycle } from '../hidden-edges/answer.js'
import { attachEvidence, EvidenceRefusal, type EvidenceItem } from '../hidden-edges/analyst.js'
import { reviewAsk } from '../hidden-edges/asks.js'
import { openRun, OpenRefusal, type OpenRun } from '../hidden-edges/open.js'
import { LOG_FILE, standing } from '../hidden-edges/records.js'
import { applyHiddenEdgeReply, hiddenEdgeReviews, newReviewId, ReplyRefusal, type HiddenEdgeReview, type ReviewCandidate } from '../hidden-edges/review.js'
import { rowOf } from '../hidden-edges/views.js'
import { pageOf } from '../hidden-edges/views.js'

export const HIDDEN_EDGE_RECORD = { file: LOG_FILE, name: 'hidden-edge record' } as const

const LOCATORS = z.array(z.string().max(400)).min(1).max(10)

const InputSchema = z.object({
  action: z.enum(['open', 'evidence', 'reply', 'get']).describe("'open' reads and validates the candidates and opens a review; 'evidence' adds the analyst's locators; 'reply' takes one operator command; 'get' pages the table"),
  directory_path: z.string().max(4096).describe('The model directory'),
  review_id: REVIEW_ID.optional().describe("For 'evidence', 'reply' and 'get': the review"),
  reply: z.string().max(REPLY_INPUT_MAX).optional().describe("For 'reply': the operator's command, exactly as given"),
  offset: z.number().int().min(0).max(1000).optional().describe("For 'get': the row to start from (a result's next_offset)"),
  evidence: z.array(z.object({ n: z.number().int().min(1).max(999), locators: LOCATORS }).strict()).max(250).optional()
    .describe("For 'evidence': locators per candidate number (source:<file>:<line>, attributes:<file>#<key>, platform:<id>, kg:<id>), never quoted values"),
}).strict().superRefine((d, ctx) => {
  if (d.action !== 'open') need(ctx, !!d.review_id, 'review_id', d.action)
  if (d.action === 'reply') need(ctx, d.reply !== undefined, 'reply', 'reply')
  if (d.action === 'evidence') need(ctx, !!d.evidence?.length, 'evidence', 'evidence')
  only(ctx, d.action === 'open' && d.review_id !== undefined, 'review_id', "'evidence', 'reply' and 'get'")
  only(ctx, d.action !== 'reply' && d.reply !== undefined, 'reply', "'reply'")
  only(ctx, d.action !== 'get' && d.offset !== undefined, 'offset', "'get'")
  only(ctx, d.action !== 'evidence' && d.evidence !== undefined, 'evidence', "'evidence'")
})
type Input = z.infer<typeof InputSchema>

const GRAMMAR =
  'accept <n>[,<n>…] · skip <n>… · reject <n>… · show <n> · show rejected · edit <n> capability: <v> | required: <v> | granted: <v> | <field>: <v> | rationale: <text> · accept-all · done'

const fresh = (r: HiddenEdgeReview) => (): LoggedReview => ({ review_id: r.id, mode: 'hidden-edges', opened_at: r.opened_at, groups: r.candidates.length, replies: [], applies: [] })

/** The header the operator sees before the table: the knowledge graph, the module, the four counts, what stands. */
function headerOf(run: OpenRun): Record<string, unknown> {
  const standingDecisions = [...standing(run.decisions).values()]
  const notes: string[] = []
  if (![...run.exposures.values()].some((e) => edgeLifecycle(e) === 'confirmed')) notes.push('No exposure of this model is confirmed (affirmed or risk-accepted) yet: candidates rest on pending or compensated findings only. Run /dethereal:triage first for firmer candidates.')
  const regime = run.header?.regime
  return {
    model: { id: run.model_id, name: shown(run.model_name, 120) },
    module: run.module,
    ...(regime ? { regime } : {}),
    ...(regime?.kg === 'kg_absent' ? { kg_marker: KG_ABSENT_MARKER, kg_notice: regime.reason === 'no_data' ? KG_NO_DATA_NOTICE : KG_NOT_AVAILABLE_NOTICE } : {}),
    ...(run.header ? { table_hash: run.header.table_hash } : {}),
    counts: run.counts,
    decisions: {
      accepted: standingDecisions.filter((d) => d.verb === 'accepted').length,
      rejected: standingDecisions.filter((d) => d.verb === 'rejected').length,
      not_verified_here: run.decisions.filter((d) => d.verb === 'accepted' && !d.verified).length,
      malformed: run.invalid_decisions,
    },
    ...(notes.length ? { notes } : {}),
  }
}

function reviewOf(dir: string, run: OpenRun): HiddenEdgeReview {
  const candidates: ReviewCandidate[] = run.candidates.map((c, i) => ({ ...c, n: i + 1, choice: 'open', rationale: null, base: { ...c.defaults }, evidence: [], edited: false, bulk: false }))
  return {
    id: newReviewId(), dir, model_id: run.model_id, model_name: run.model_name, opened_at: new Date().toISOString(), candidates, local: run.local, exposures: run.exposures,
    decisions: run.decisions, seen: run.seen, header: headerOf(run), closed: false, touched: 0,
  }
}

export class HiddenEdgesTool extends ClientFreeTool<Input, Record<string, unknown>> {
  readonly name = 'hidden_edges'
  readonly description =
    "Review the hidden edges (inferred attack paths) the platform's hidden-edges module proposes for a synced model with no local " +
    "changes. 'open' (directory_path) validates the module's candidates and returns {review_id, header, total, rows, next_offset?, grammar, ask}: " +
    "show the header and the table first, then end the message with the ask exactly as returned. 'reply' (review_id, the operator's command " +
    "exactly as given) applies one command; 'get' (review_id, offset) pages the table; 'evidence' (review_id, evidence) adds the analyst's " +
    "locators to candidates. Nothing is written here: manage_hidden_edges prepares and commits a closed review. Call it from " +
    'the main session only.'
  readonly inputSchema = InputSchema
  private readonly turns = new Turns()

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      if (input.action === 'open') return await this.turns.run(`open:${dir}`, () => this.open(dir, context))
      const review = hiddenEdgeReviews.get(input.review_id!)
      if (!review) return coded('review_not_found', 'no such review in this session (a restart forgets reviews; one unused for two hours expires): open it again. Replies given to a lost review are not carried over: show the new review\'s table and ask the operator again')
      if (review.dir !== dir) return coded('other_model', 'the review was opened for another model directory')
      if (input.action === 'get') return { success: true, data: { review_id: review.id, closed: review.closed, total: review.candidates.length, ...pageOf(review, input.offset ?? 0) } }
      if (input.action === 'evidence') return this.evidence(review, input.evidence!)
      return await this.turns.run(`reply:${review.id}`, () => this.reply(review, input.reply!))
    } catch (err) {
      if (err instanceof OpenRefusal) return coded(err.code, err.message)
      if (err instanceof TriageModelError || err instanceof ModelReadError || err instanceof RecordError) return coded(err.code, err.message)
      return { success: false, error: err instanceof Error ? err.message : 'hidden_edges failed' }
    }
  }

  private async open(dir: string, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const client = context.apolloClient
    if (!client) return { success: false, error: context.clientUnavailableReason ?? AUTHENTICATION_REQUIRED }
    const run = await openRun(dir, client)
    const review = reviewOf(dir, run)
    if (!review.candidates.length) return { success: true, data: { header: review.header, total: 0, rows: [] } }
    const { warnings } = await recordReviewIn(dir, HIDDEN_EDGE_RECORD, review.id, fresh(review), () => {})
    hiddenEdgeReviews.put(review)
    return {
      success: true,
      data: { review_id: review.id, header: review.header, total: review.candidates.length, ...pageOf(review, 0), grammar: GRAMMAR, ask: reviewAsk(), ...(warnings.length ? { warnings } : {}) },
    }
  }

  private evidence(review: HiddenEdgeReview, items: EvidenceItem[]): ToolResult<Record<string, unknown>> {
    try {
      return { success: true, data: { review_id: review.id, attached: attachEvidence(review, items) } }
    } catch (err) {
      if (err instanceof EvidenceRefusal) return coded(err.code, err.message)
      throw err
    }
  }

  private async reply(review: HiddenEdgeReview, reply: string): Promise<ToolResult<Record<string, unknown>>> {
    // The reply changes the review only once it is recorded: keep what it changes, to put back on a refused record.
    const before = { candidates: structuredClone(review.candidates), closed: review.closed }
    let outcome: { verb: string } | { refused: string }
    let effect: ReturnType<typeof applyHiddenEdgeReply> | undefined
    let refused: ReplyRefusal | undefined
    try {
      if (replyProblem(reply)) throw new ReplyRefusal('argument_invalid', `a reply is the operator's words: 1–${SETTLE_LIMITS.replyChars} characters, no invisible or control characters`)
      effect = applyHiddenEdgeReply(review, reply)
      outcome = { verb: effect.verb }
    } catch (err) {
      if (!(err instanceof ReplyRefusal)) throw err
      refused = err
      outcome = { refused: err.code }
    }
    const closing = !refused && !before.closed && review.closed
    let warnings: string[]
    try {
      ;({ warnings } = await recordReviewIn(review.dir, HIDDEN_EDGE_RECORD, review.id, fresh(review), (entry) => {
        if (!closing) refuseWhenFull(entry.replies, LOG_LIMITS.replies, 'replies', "close it with 'done' or 'accept-all', then prepare it")
        entry.replies.push({ at: new Date().toISOString(), ...recordedText(reply), outcome })
      }))
    } catch (err) {
      review.candidates = before.candidates
      review.closed = before.closed
      if (err instanceof RecordError && err.code === 'record_full' && refused) return coded(refused.code, refused.message, { recorded: false })
      // A record too large takes no reply, a closing one included: an open review is let go; a closed one is kept for prepare.
      if (err instanceof RecordError && err.code === 'record_too_large' && !before.closed) hiddenEdgeReviews.drop(review.id)
      throw err
    }
    if (refused) return coded(refused.code, refused.message, refused.code !== 'review_closed' && !review.closed ? { ask: reviewAsk() } : {})
    const choices = review.candidates.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.choice]: (acc[c.choice] ?? 0) + 1 }), {})
    return {
      success: true,
      data: {
        review_id: review.id, effect, choices, closed: review.closed,
        ...(effect!.verb === 'show' ? { row: rowOf(review, review.candidates[effect!.n - 1]!) } : {}),
        ...(review.closed ? {} : { ask: reviewAsk() }), ...(warnings.length ? { warnings } : {}),
      },
    }
  }
}

export const hiddenEdgesTool = new HiddenEdgesTool()
