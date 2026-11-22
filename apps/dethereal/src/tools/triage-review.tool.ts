/**
 * triage_review: the operator's review of triage proposals, read deterministically.
 *
 * `open` takes the proposals the operator is shown, one per group of exposures, reads the model once, and keeps
 * what each exposure was then: a plan later writes only exposures still as the review saw them. It refuses up
 * front a review whose proposals the platform would refuse, or whose plan could not be shown whole. `reply` takes
 * each reply the operator gives, exactly as given, and reads it as one command (or refuses it, changing nothing);
 * `get` shows the decisions so far. Every reply is recorded in `.dethereal/triage-log.json` before it takes
 * effect. A closed review is what `manage_dispositions prepare` checks and plans; nothing here writes the platform.
 * `tasks` checks the remediation task list for the claims it may not make and writes it into the run's scratch
 * directory, in one call; it needs a session only to read the class guides the list quotes.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { lintRemediationText } from '@dethernety/dt-module/remediation-honesty'
import { AUTHENTICATION_REQUIRED, ClientFreeTool, type ToolContext, type ToolResult } from './base-tool.js'
import { coded, need, only, PLATFORM_ID, REPLY_INPUT_MAX, REVIEW_ID } from './input-rules.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { replyProblem, SETTLE_LIMITS } from '../utils/settlement.js'
import {
  applyReply,
  checkGroups,
  decisionsOf,
  grammarOf,
  openReview,
  operationsOf,
  OPERATOR_ONLY_KINDS,
  PICKABLE_KINDS,
  REVIEW_LIMITS,
  ReviewRefusal,
  type Review,
  type ReviewGroup,
} from '../triage/review.js'
import { copyOf, reviewStore } from '../triage/store.js'
import { keepTriageFilesOut, LOG_LIMITS, recordedText, recordReview, RecordError, refuseWhenFull, type LoggedReview } from '../triage/log.js'
import { platformModelOf, TriageModelError } from '../triage/model.js'
import { ModelReadError, readExposureEvidence, readModelExposures, type ExposureEvidence } from '../triage/exposures.js'
import { ECHO_BUDGET, planOperations, readTechniques, reviewEchoBound, todayIso } from '../triage/dispositions.js'
import { ELEMENT_KINDS, GuideReadError, readClassGuide, type GuideEntry } from './get-class-guide.tool.js'
import { checkRunDir, hiddenCharacters, quotableFields, RUN_NAME, TASKS_TEXT_MAX, TasksError, withoutQuotedLines, writeTaskList } from '../triage/tasks.js'
import { readModelDirectory } from '../utils/directory-utils.js'
import { Turns } from '../triage/turns.js'
import { reviewAsk } from '../triage/asks.js'


const Modifications = z.object({
  name: z.string().max(4000).optional().describe("The copy's name, before the ' (custom)' suffix"),
  description: z.string().max(4000).optional().describe("The copy's description"),
  score: z.number().finite().min(0).max(10).optional().describe("The copy's score, 0–10"),
  attackVector: z.string().max(4000).optional().describe("The copy's attack vector"),
  category: z.string().max(4000).optional().describe("The copy's category"),
  techniques: z.object({
    add: z.array(PLATFORM_ID).max(50).describe("Technique node ids to add, as search_mitre_attack 'lookup' returns them"),
    remove: z.array(PLATFORM_ID).max(50).describe('Technique node ids to remove, from the exposure\'s own links'),
  }).strict().optional().describe("The copy's techniques: the source's, with these added and removed"),
}).strict()

const Proposal = z.object({
  op: z.enum(['dispose', 'supersede', 'reaffirm', 'clear']).describe("A review proposes 'dispose' or 'supersede'; a stale review 'reaffirm' or 'clear'"),
  kind: z.string().max(40).optional().describe(`For 'dispose': ${PICKABLE_KINDS.filter((k) => !OPERATOR_ONLY_KINDS.has(k)).join(', ')} (${[...OPERATOR_ONLY_KINDS].join(' and ')} are the operator's, in an edit with a rationale)`),
  reason: z.string().max(4000).optional().describe(`For 'dispose': the reason, one line of at most ${REVIEW_LIMITS.textChars} characters`),
  modifications: Modifications.optional().describe("For 'supersede': what the copy changes; at least one field or technique"),
  verified_technique_ids: z.array(PLATFORM_ID).max(100).optional().describe("For 'supersede': the node ids search_mitre_attack 'lookup' confirmed; every added technique must be one"),
}).strict()

const Group = z.object({
  group: z.number().int().min(1).max(999).describe('The group number, as the operator sees it'),
  exposure_ids: z.array(PLATFORM_ID).min(1).max(200).describe("The group's exposures, each in one group only"),
  proposal: Proposal.optional().describe('The proposal for every exposure of the group; optional when needs_human'),
  needs_human: z.boolean().optional().describe("Review only: the operator decides with an edit naming a kind; 'accept' is refused"),
  per_row_only: z.boolean().optional().describe("Review only: 'accept-all' skips the group; 'accept <n>' still takes it"),
  stale_superseded: z.boolean().optional().describe('Stale only, and derived from the model: a superseded exposure is cleared or skipped, never reaffirmed'),
}).strict()

const Guide = z.object({
  class_id: PLATFORM_ID.describe('A class some element of this model names'),
  element_kind: z.enum(ELEMENT_KINDS).describe('The kind of element the class is for'),
  attribute_keys: z.array(z.string().max(200)).min(1).max(20).describe('The attribute keys whose guidance the list quotes'),
}).strict()

const InputSchema = z.object({
  action: z.enum(['open', 'reply', 'get', 'tasks']).describe("'open' a review of proposals; 'reply' with one of the operator's replies; 'get' the decisions so far; 'tasks' check and write the remediation task list"),
  directory_path: z.string().max(4096).optional().describe("For 'open' and 'tasks': the model directory"),
  mode: z.enum(['review', 'stale']).optional().describe("For 'open': 'review' for new proposals, 'stale' for dispositions the model's changes made stale"),
  groups: z.array(Group).min(1).max(200).optional().describe("For 'open': the proposals, one per group of exposures, numbered as the operator sees them"),
  review_id: REVIEW_ID.optional().describe("For 'reply' and 'get': the review 'open' returned"),
  reply: z.string().max(REPLY_INPUT_MAX).optional().describe("For 'reply': the operator's reply, exactly as given"),
  run: z.string().regex(RUN_NAME, 'a run is its scratch directory name, run-YYYYMMDD-HHMMSS').optional().describe("For 'tasks': the run's scratch directory name, run-YYYYMMDD-HHMMSS"),
  text: z.string().max(TASKS_TEXT_MAX).optional().describe("For 'tasks': the composed task list"),
  guides: z.array(Guide).max(50).optional().describe("For 'tasks': each class guide, by class, element kind and attribute keys, whose text the list quotes"),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'open') {
    need(ctx, !!d.directory_path, 'directory_path', 'open')
    need(ctx, !!d.mode, 'mode', 'open')
    need(ctx, !!d.groups, 'groups', 'open')
  } else if (d.action === 'tasks') {
    need(ctx, !!d.directory_path, 'directory_path', 'tasks')
    need(ctx, !!d.run, 'run', 'tasks')
    need(ctx, d.text !== undefined, 'text', 'tasks')
  } else need(ctx, !!d.review_id, 'review_id', d.action)
  only(ctx, d.action !== 'tasks' && (d.text !== undefined || d.run !== undefined || d.guides !== undefined), 'text, run and guides', "'tasks'")
  only(ctx, d.action === 'tasks' && d.review_id !== undefined, 'review_id', "'reply' and 'get'")
  if (d.action === 'reply') need(ctx, d.reply !== undefined, 'reply', 'reply')
  only(ctx, d.action !== 'open' && (d.mode !== undefined || d.groups !== undefined), 'mode and groups', "'open'")
  only(ctx, d.action !== 'open' && d.action !== 'tasks' && d.directory_path !== undefined, 'directory_path', "'open' and 'tasks'")
  only(ctx, d.action === 'open' && d.review_id !== undefined, 'review_id', "'reply' and 'get'")
  only(ctx, d.action !== 'reply' && d.reply !== undefined, 'reply', "'reply'")
})
type Input = z.infer<typeof InputSchema>

const freshEntry = (review: Review) => (): LoggedReview => ({ review_id: review.id, mode: review.mode, opened_at: new Date().toISOString(), groups: review.groups.size, replies: [], applies: [] })

/** The operations the review would come to if every proposal were accepted as made: what open checks. */
function asProposed(review: Review): ReturnType<typeof operationsOf> {
  const all: Review = { ...copyOf(review), closed: true }
  for (const [n, g] of review.groups) {
    const p = g.proposal
    if (!p || g.needs_human) all.decisions.set(n, { decision: 'skip' })
    else if (review.mode === 'stale') all.decisions.set(n, { decision: p.op === 'reaffirm' && !g.stale_superseded ? 'reaffirm' : 'clear' })
    else all.decisions.set(n, { decision: 'accept' })
  }
  return operationsOf(all)
}

/** The class ids the model's elements name, in its structure, flows, data items and attribute files. */
function modelClassIds(model: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'classData' && x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string') ids.add((x as { id: string }).id)
        else walk(x)
      }
    }
  }
  walk(model)
  return ids
}

export class TriageReviewTool extends ClientFreeTool<Input, Record<string, unknown>> {
  readonly name = 'triage_review'
  readonly description =
    "The operator's review of triage proposals. 'open' takes the proposals as shown (one per numbered group of " +
    'exposures), reads the model once, and returns {review_id, mode, groups (their count), grammar}; it refuses up front ' +
    'exposures not in the model or changed, proposals the platform would refuse, and a review too large to plan ' +
    "at once. 'reply' takes each reply exactly as the operator gave it and reads it as one command, returning " +
    "{command, decisions, closed, show?, ask?}, or refuses it and changes nothing; 'get' returns the groups as opened and " +
    'the decisions. While the review is open, open, reply, get and a refusal the operator can answer carry ask: the ' +
    'review question, its tag first, to end the message with exactly as returned; a refusal that ends the review ' +
    'carries none. Every reply is recorded before it takes effect; once a review has recorded ' + LOG_LIMITS.replies +
    " replies, only 'done' and 'accept-all' are taken. A review closes with 'accept-all' or 'done'; manage_dispositions " +
    "prepare plans a closed review. A second 'open' while a review of the directory is open refuses with its " +
    "review_id, which 'get' resumes. 'tasks' (directory_path, run, text, guides?) checks the remediation task list " +
    'for the claims remediation copy may not make (fixes, closes, reduces and the like) and, only when it holds none, ' +
    "writes it as .dethereal/triage-run/<run>/remediation-tasks-<the run's date>.md, never replacing a file: it " +
    'returns {written, path, chars, quotes_exempted, existing?, warnings?} (existing: the file already there holds ' +
    'exactly this text), or refuses with claims_found {hits, written: false}, or tasks_exist when any other file is ' +
    'at the path. A line that quotes, whole, a field of a class guide ' +
    'named in guides (a class of this model) is not checked as the list\'s own words. Nothing here changes the platform.'
  readonly inputSchema = InputSchema
  private readonly turns = new Turns()

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      if (input.action === 'open') {
        const dir = await validatePathConfinement(input.directory_path!)
        // One open of a directory at a time, so a second one finds the first.
        return await this.turns.run(`open:${dir}`, () => this.open(dir, input, context))
      }
      if (input.action === 'tasks') return await this.tasks(await validatePathConfinement(input.directory_path!), input, context)
      return await this.turns.run(input.review_id!, async () => {
        const review = reviewStore.get(input.review_id!)
        if (!review) return coded('review_not_found', 'no such review in this session (a restart forgets reviews; one unused for two hours expires): open it again')
        if (input.action === 'get') {
          return { success: true, data: { review_id: review.id, mode: review.mode, groups: [...review.groups.values()], decisions: decisionsOf(review), closed: review.closed, ...(review.closed ? {} : { ask: reviewAsk(review.mode) }) } }
        }
        return await this.reply(review, input.reply!)
      })
    } catch (err) {
      if (err instanceof RecordError) return coded(err.code, err.message)
      if (err instanceof ReviewRefusal) return coded(err.code, err.message, err.details)
      if (err instanceof TriageModelError || err instanceof ModelReadError) return coded(err.code, err.message)
      if (err instanceof TasksError) return coded(err.code, err.message, err.code === 'tasks_exist' ? { written: false } : {})
      return { success: false, error: err instanceof Error ? err.message : 'triage_review failed' }
    }
  }

  /**
   * Check the task list, then write it, in that order and in one call: nothing is written unless the run directory
   * is confined, every guide named was read, and the text, without the lines that quote those guides whole, holds
   * no claim the list may not make.
   */
  private async tasks(dir: string, input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const text = input.text!
    const hidden = hiddenCharacters(text)
    if (hidden.length) {
      const where = hidden.map((h) => `${h.code} on line ${h.line}`).join(', ')
      return coded('text_invalid', `the task list holds characters no reader sees, or that can hide inside a word (${where}): compose it with plain line breaks, indent with spaces, and leave out emoji, tabs and invisible characters`, { characters: hidden })
    }
    // Before any read: the run directory must already be there, inside the model directory, and no link.
    await checkRunDir(dir, input.run!)
    const fields = new Set<string>()
    if (input.guides?.length) {
      const client = context.apolloClient
      if (!client) return { success: false, error: context.clientUnavailableReason ?? AUTHENTICATION_REQUIRED }
      const classes = modelClassIds(await readModelDirectory(dir))
      const outside = input.guides.filter((g) => !classes.has(g.class_id)).map((g) => g.class_id)
      if (outside.length) return coded('guide_not_in_model', `no element of this model names ${[...new Set(outside)].join(', ')}: name only the classes of this model's elements`)
      for (const g of input.guides) {
        let entries: GuideEntry[]
        try {
          entries = await readClassGuide(client, g.class_id, g.element_kind, g.attribute_keys)
        } catch (err) {
          if (err instanceof GuideReadError) return coded('guide_unread', err.message)
          throw err
        }
        for (const f of quotableFields(entries)) fields.add(f)
      }
    }
    const { checked, exempted } = withoutQuotedLines(text, fields)
    const hits = [...new Set(checked.flatMap((run) => lintRemediationText(run)))].sort()
    if (hits.length) {
      return coded('claims_found', 'the task list holds words remediation copy may not use; nothing was written', { hits, written: false })
    }
    const warnings = await keepTriageFilesOut(dir)
    const written = await writeTaskList(dir, input.run!, text)
    return {
      success: true,
      data: { written: true, path: written.path, chars: text.length, quotes_exempted: exempted, ...(written.existing ? { existing: true } : {}), ...(warnings.length ? { warnings } : {}) },
    }
  }

  private async open(dir: string, input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    const client = context.apolloClient
    if (!client) return { success: false, error: context.clientUnavailableReason ?? AUTHENTICATION_REQUIRED }
    const active = reviewStore.openFor(dir)
    if (active) return coded('review_open', "a review of this model directory is still open: resume it with 'get', or close it with 'done'", { review_id: active.id })
    const groups = input.groups as ReviewGroup[]
    // What the groups say on their own is refused before anything is read.
    checkGroups(input.mode!, groups)
    const modelId = await platformModelOf(dir)
    const read = await readModelExposures(client, modelId)
    const seen = new Map(read.rows.map((r) => [r.exposure_id, r]))
    const evidence = new Map<string, ExposureEvidence>()
    for (const g of groups) {
      if (g.proposal?.op !== 'supersede') continue
      for (const id of g.exposure_ids) {
        if (!seen.has(id) || evidence.has(id)) continue
        const e = await readExposureEvidence(client, id)
        if (e) evidence.set(id, e)
      }
    }
    const adds = [...new Set(groups.flatMap((g) => g.proposal?.modifications?.techniques?.add ?? []))]
    const techniques = await readTechniques(client, adds)
    const review = openReview(randomBytes(16).toString('hex'), dir, input.mode!, groups, { model_id: read.model_id, model_name: read.model_name, seen, evidence, techniques })
    const date = todayIso()
    const refused = planOperations({ operations: asProposed(review), state: review.seen, evidence, techniques, date }).filter((o) => o.status === 'rejected')
    if (refused.length) {
      return coded(refused[0]!.code!, `the platform would refuse ${refused.length} proposal(s): fix them, then open the review again`, {
        exposures: refused.map((o) => ({ group: o.group, exposure_id: o.exposure_id, code: o.code, why: o.detail })),
      })
    }
    const bound = reviewEchoBound(review, date)
    if (bound > ECHO_BUDGET) {
      return coded('echo_too_large', `this review's plan could take ${bound} characters, over the ${ECHO_BUDGET} that can be shown at once: open it in parts`)
    }
    const { warnings } = await recordReview(dir, review.id, freshEntry(review), () => {})
    reviewStore.put(review)
    return { success: true, data: { review_id: review.id, mode: review.mode, groups: review.groups.size, grammar: grammarOf(review.mode), ask: reviewAsk(review.mode), ...(warnings.length ? { warnings } : {}) } }
  }

  private async reply(review: Review, reply: string): Promise<ToolResult<Record<string, unknown>>> {
    const next = copyOf(review)
    let outcome: { verb: string } | { refused: string }
    let result: ReturnType<typeof applyReply> | undefined
    let refused: ReviewRefusal | undefined
    try {
      if (replyProblem(reply)) throw new ReviewRefusal('text_invalid', `a reply is the operator's words: 1–${SETTLE_LIMITS.replyChars} characters, no invisible or control characters`)
      result = applyReply(next, reply)
      // Any decision can grow the plan (an accept of a skipped group, an edit): the review stays within the budget.
      if (result.command.verb !== 'show') {
        const bound = reviewEchoBound(next, todayIso())
        if (bound > ECHO_BUDGET) throw new ReviewRefusal('echo_too_large', `with this reply the plan could take ${bound} characters, over the ${ECHO_BUDGET} that can be shown at once: shorten a rationale, or skip groups`)
      }
      outcome = { verb: result.command.verb }
    } catch (err) {
      if (!(err instanceof ReviewRefusal)) throw err
      refused = err
      outcome = { refused: err.code }
    }
    const closing = !refused && !review.closed && next.closed
    // Recorded before it counts: a reply the record does not hold changes nothing. A refusal changes nothing either,
    // so once the record is full it is answered unrecorded.
    let full = false
    let warnings: string[] = []
    try {
      ;({ warnings } = await recordReview(review.dir, review.id, freshEntry(review), (entry) => {
        if (!closing) refuseWhenFull(entry.replies, LOG_LIMITS.replies, 'replies', review.mode === 'review' ? "close it with 'done' or 'accept-all', then prepare it" : "close it with 'done', then prepare it")
        entry.replies.push({ at: new Date().toISOString(), ...recordedText(reply), outcome })
      }))
    } catch (err) {
      // The reply count reached: a reply the review would take is refused, and its closing replies are still taken
      // (a reply to a closed review is refused, keeping its own code, and recorded when the record takes it).
      if (err instanceof RecordError && err.code === 'record_full') {
        if (!refused) return coded(err.code, err.message, { ask: reviewAsk(review.mode) })
        full = true
      } else {
        // A record too large takes no reply, a closing one included: an open review is let go, so a new one can be
        // opened. A closed one is kept for prepare.
        if (err instanceof RecordError && err.code === 'record_too_large' && !review.closed) reviewStore.drop(review.id)
        throw err
      }
    }
    // A refusal the operator answers with another reply carries the question; one of a closed review does not.
    const answerable = refused && refused.code !== 'review_closed' && !review.closed
    if (refused) return coded(refused.code, refused.message, { ...refused.details, ...(full ? { recorded: false } : {}), ...(answerable ? { ask: reviewAsk(review.mode) } : {}) })
    const taken: Review = { ...next, replies: next.replies + 1 }
    reviewStore.put(taken)
    return {
      success: true,
      data: {
        review_id: review.id,
        command: result!.command,
        decisions: decisionsOf(taken),
        closed: taken.closed,
        ...(result!.show ? { show: result!.show } : {}),
        ...(taken.closed ? {} : { ask: reviewAsk(taken.mode) }),
        ...(warnings.length ? { warnings } : {}),
      },
    }
  }
}

export const triageReviewTool = new TriageReviewTool()
