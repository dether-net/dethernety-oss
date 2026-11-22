/**
 * A triage review: the proposals the operator reviews, and the deterministic reading of each reply.
 *
 * The skill opens a review with the proposals it showed (one per group of exposures) and passes every reply
 * the operator gives, verbatim. The review keeps what the platform held for each exposure when it was opened, which
 * a disposition plan is checked against. One reply is one command; a later decision on a group replaces an earlier one;
 * `accept-all` and `done` close the review. What a closed review decided is the operation list a disposition
 * plan is prepared from: the skill neither adds to it nor reorders it.
 *
 * Pure: no I/O. The tool keeps reviews in memory and records every reply.
 */
import { replyProblem } from '../utils/settlement.js'
import type { ExposureEvidence, ExposureState } from './exposures.js'
import type { KnownTechniques } from './dispositions.js'

/** Disposition kinds a proposal or an edit may name (the platform's pickable set without SUPERSEDED). */
export const PICKABLE_KINDS = ['AFFIRMED', 'NOT_APPLICABLE', 'FALSE_POSITIVE', 'COMPENSATING_CONTROL', 'RISK_ACCEPTED'] as const
export type PickableKind = (typeof PICKABLE_KINDS)[number]
/** Kinds only the operator may choose, in an `edit`, with a rationale. */
export const OPERATOR_ONLY_KINDS: ReadonlySet<string> = new Set(['COMPENSATING_CONTROL', 'RISK_ACCEPTED'])

/** At most this many exposures across one review's groups, and this many characters in one text. */
export const REVIEW_LIMITS = { operations: 200, textChars: 1800 } as const

export type ReviewMode = 'review' | 'stale'
export type ProposalOp = 'dispose' | 'supersede' | 'reaffirm' | 'clear'

export interface Modifications {
  name?: string
  description?: string
  score?: number
  attackVector?: string
  category?: string
  /** Internal technique node ids, as `search_mitre_attack lookup` returns them */
  techniques?: { add: string[]; remove: string[] }
}

export interface Proposal {
  op: ProposalOp
  kind?: string
  reason?: string
  modifications?: Modifications
  verified_technique_ids?: string[]
}

export interface ReviewGroup {
  group: number
  exposure_ids: string[]
  proposal?: Proposal
  needs_human?: boolean
  per_row_only?: boolean
  stale_superseded?: boolean
}

export type DecisionKind = 'pending' | 'accept' | 'skip' | 'edit' | 'reaffirm' | 'clear'

export interface Decision {
  decision: DecisionKind
  /** For an edit: the kind the operator chose, if any */
  kind?: string
  /** For an edit: the operator's rationale, if any */
  rationale?: string
}

/** The platform model a review is opened on, as read then: its exposures by id, a supersede target's evidence, and the techniques a supersede adds. */
export interface ModelView {
  model_id: string
  model_name: string
  seen: Map<string, ExposureState>
  evidence: Map<string, ExposureEvidence>
  techniques: KnownTechniques
}

export interface Review {
  id: string
  dir: string
  model_id: string
  model_name: string
  /** The exposures of the review's groups, and the others on their elements, as the platform held them at open */
  seen: Map<string, ExposureState>
  evidence: Map<string, ExposureEvidence>
  techniques: KnownTechniques
  mode: ReviewMode
  groups: Map<number, ReviewGroup>
  decisions: Map<number, Decision>
  closed: boolean
  replies: number
}

/** A refusal of an open or a reply: a code and a message; nothing changed. */
export class ReviewRefusal extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ReviewRefusal'
  }
}

const refuse = (code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new ReviewRefusal(code, message, details)
}

/** The form every agent-written or typed text must have: one line, no invisible or control characters, bounded. */
export function textProblem(text: string, what: string): string | null {
  if (typeof text !== 'string' || text.trim() === '') return `${what} is empty`
  if (text.length > REVIEW_LIMITS.textChars) return `${what} is ${text.length} characters; at most ${REVIEW_LIMITS.textChars}`
  if (/[\r\n]/.test(text)) return `${what} must be one line`
  if (replyProblem(text)) return `${what} holds an invisible or control character`
  return null
}

const checkText = (text: string | undefined, what: string): void => {
  if (text === undefined) return
  const problem = textProblem(text, what)
  if (problem) refuse('text_invalid', problem)
}

/** Check the groups of an open on their own, before anything is read: their numbers, exposures, proposals and texts. */
export function checkGroups(mode: ReviewMode, groups: ReviewGroup[]): { byNumber: Map<number, ReviewGroup>; named: Set<string> } {
  if (!groups.length) refuse('argument_invalid', 'a review needs at least one group')
  const byNumber = new Map<number, ReviewGroup>()
  const named = new Set<string>()
  let operations = 0
  for (const g of groups) {
    if (byNumber.has(g.group)) refuse('argument_invalid', `group ${g.group} is named twice`)
    for (const id of g.exposure_ids) {
      if (named.has(id)) refuse('argument_invalid', `exposure ${id} is in more than one group`)
      named.add(id)
    }
    operations += g.exposure_ids.length
    const p = g.proposal
    if (mode === 'review') {
      if (!p && !g.needs_human) refuse('argument_invalid', `group ${g.group} has no proposal and is not marked needs_human`)
      if (p?.op === 'supersede' && g.needs_human) refuse('argument_invalid', `group ${g.group}: a supersede proposal is accepted or skipped, so it cannot need the operator's decision`)
      if (p && p.op !== 'dispose' && p.op !== 'supersede') refuse('argument_invalid', `group ${g.group}: a review proposes dispose or supersede, not ${p.op}`)
      if (p?.op === 'dispose') {
        if (!p.kind || !(PICKABLE_KINDS as readonly string[]).includes(p.kind)) refuse('argument_invalid', `group ${g.group}: a dispose proposal names one of ${PICKABLE_KINDS.join(', ')}`)
        if (OPERATOR_ONLY_KINDS.has(p.kind!)) refuse('argument_invalid', `group ${g.group}: ${p.kind} is the operator's to choose, with an edit; it is never proposed`)
        if (p.reason === undefined) refuse('argument_invalid', `group ${g.group}: a dispose proposal carries its reason`)
      }
      if (p?.op === 'supersede' && !p.modifications) refuse('argument_invalid', `group ${g.group}: a supersede proposal carries its modifications`)
      if (g.stale_superseded) refuse('argument_invalid', `group ${g.group}: stale_superseded belongs to a stale review`)
    } else {
      if (p && p.op !== 'reaffirm' && p.op !== 'clear') refuse('argument_invalid', `group ${g.group}: a stale review proposes reaffirm or clear, not ${p.op}`)
      if (g.needs_human || g.per_row_only) refuse('argument_invalid', `group ${g.group}: needs_human and per_row_only belong to a review`)
    }
    checkText(p?.reason, `group ${g.group}'s reason`)
    const m = p?.modifications
    if (m) for (const key of ['name', 'description', 'attackVector', 'category'] as const) checkText(m[key], `group ${g.group}'s ${key}`)
    // The platform finds a copy's source by the copy's name in single quotes: the name cannot hold one.
    if (m?.name?.includes("'")) refuse('text_invalid', `group ${g.group}'s name holds a single quote, which a copy's name cannot`)
    byNumber.set(g.group, g)
  }
  if (operations > REVIEW_LIMITS.operations) refuse('review_too_long', `a review holds at most ${REVIEW_LIMITS.operations} exposures; this one names ${operations}: open it in parts`)
  return { byNumber, named }
}

/**
 * Check the groups of an open against the model as just read, and build the review. A review takes only the
 * triage set as it is now, pending and not created by USER; a stale review only stale dispositions. In a stale
 * review a group is marked superseded when any of its exposures is.
 */
export function openReview(id: string, dir: string, mode: ReviewMode, groups: ReviewGroup[], view: ModelView): Review {
  const { byNumber, named } = checkGroups(mode, groups)
  const missing = [...named].filter((e) => !view.seen.has(e))
  if (missing.length) refuse('not_in_model', `exposure ${missing.join(', ')} is not in this model on the platform: list the model again`, { exposures: missing })
  if (mode === 'stale') {
    const fresh = [...named].filter((e) => view.seen.get(e)!.disposition_stale !== true)
    if (fresh.length) refuse('target_changed', `exposure ${fresh.join(', ')} is not stale now: list the model again`, { exposures: fresh })
  } else {
    // Decided since it was listed, or created by USER: a proposal for it would replace a decision nobody reviewed.
    const outside = [...named].filter((e) => {
      const row = view.seen.get(e)!
      return row.lifecycle !== 'pending' || row.created_by === 'USER'
    })
    if (outside.length) refuse('target_changed', `exposure ${outside.join(', ')} is not pending triage now: list the model again`, { exposures: outside })
  }
  const elements = new Set([...named].map((e) => view.seen.get(e)!.element_id))
  const ordered = new Map([...byNumber.entries()].sort(([a], [b]) => a - b).map(([n, g]) => [n, mode === 'stale'
    ? { ...g, stale_superseded: g.exposure_ids.some((e) => view.seen.get(e)!.disposition_kind === 'SUPERSEDED') }
    : g]))
  return {
    id,
    dir,
    model_id: view.model_id,
    model_name: view.model_name,
    seen: new Map([...view.seen].filter(([, row]) => elements.has(row.element_id))),
    evidence: new Map([...view.evidence].filter(([e]) => named.has(e))),
    techniques: view.techniques,
    mode,
    groups: ordered,
    decisions: new Map([...ordered.keys()].map((n) => [n, { decision: 'pending' as const }])),
    closed: false,
    replies: 0,
  }
}

const VERBS: Record<ReviewMode, readonly string[]> = {
  review: ['accept', 'skip', 'show', 'edit', 'accept-all', 'done'],
  stale: ['reaffirm', 'clear', 'skip', 'show', 'done'],
}

/** The grammar, as a refusal states it, with the commands that close the review. */
export function grammarOf(mode: ReviewMode): string {
  return mode === 'review'
    ? 'one command per reply: accept <n> [<n> …] · skip <n> [<n> …] · show <n> · edit <n> rationale: <text> · edit <n> kind: <KIND> [rationale: <text>] · accept-all · done (KIND: ' + PICKABLE_KINDS.join(', ') + '); accept-all and done close the review'
    : 'one command per reply: reaffirm <n> [<n> …] · clear <n> [<n> …] · skip <n> [<n> …] · show <n> · done; done closes the review'
}

export interface Command {
  verb: string
  groups: number[]
  fields?: { kind?: string; rationale?: string }
}

export interface ReplyResult {
  command: Command
  /** A group as it was opened, for `show` */
  show?: ReviewGroup & { decision: Decision }
}

function groupNumbers(review: Review, verb: string, rest: string, single = false): number[] {
  const parts = rest.split(/[\s,]+/).filter(Boolean)
  if (!parts.length) refuse('argument_invalid', `${verb} needs ${single ? 'one group number' : 'one or more group numbers'}; ${grammarOf(review.mode)}`)
  if (single && parts.length !== 1) refuse('argument_invalid', `${verb} takes one group number; ${grammarOf(review.mode)}`)
  const bad = parts.filter((p) => !/^\d{1,3}$/.test(p))
  if (bad.length) refuse('argument_invalid', `${verb}: ${bad.join(', ')} is not a group number; ${grammarOf(review.mode)}`)
  const numbers = [...new Set(parts.map(Number))]
  const unknown = numbers.filter((n) => !review.groups.has(n))
  if (unknown.length) refuse('group_unknown', `no group ${unknown.join(', ')} in this review (groups ${[...review.groups.keys()].join(', ')})`, { groups: unknown })
  return numbers
}

/**
 * Read one reply and apply it to the review. Returns what it did; a refusal changes nothing. The reply's form
 * (length, invisible characters) is the caller's to check first, as the record needs it either way.
 */
export function applyReply(review: Review, reply: string): ReplyResult {
  if (review.closed) refuse('review_closed', 'this review is closed: prepare it, or open a new one')
  const text = reply.trim()
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text)
  const verb = (m?.[1] ?? '').toLowerCase()
  const rest = (m?.[2] ?? '').trim()
  if (!VERBS[review.mode].includes(verb)) {
    const other: ReviewMode = review.mode === 'review' ? 'stale' : 'review'
    if (VERBS[other].includes(verb)) refuse('verb_not_in_mode', `${verb} belongs to a ${other} review; ${grammarOf(review.mode)}`)
    refuse('reply_unparsed', `the reply is not a command; ${grammarOf(review.mode)}`)
  }
  switch (verb) {
    case 'accept': {
      const groups = groupNumbers(review, verb, rest)
      const needing = groups.filter((n) => review.groups.get(n)!.needs_human)
      if (needing.length) refuse('needs_operator_decision', `group ${needing.join(', ')} needs your decision: edit it with a kind (edit <n> kind: <KIND> rationale: <text>)`, { groups: needing })
      for (const n of groups) review.decisions.set(n, { decision: 'accept' })
      return { command: { verb, groups } }
    }
    case 'skip':
    case 'reaffirm':
    case 'clear': {
      const groups = groupNumbers(review, verb, rest)
      if (verb === 'reaffirm') {
        const superseded = groups.filter((n) => review.groups.get(n)!.stale_superseded)
        if (superseded.length) refuse('argument_invalid', `group ${superseded.join(', ')} was superseded: it can be cleared or skipped, not reaffirmed`, { groups: superseded })
      }
      for (const n of groups) review.decisions.set(n, { decision: verb })
      return { command: { verb, groups } }
    }
    case 'show': {
      const [n] = groupNumbers(review, verb, rest, true)
      return { command: { verb, groups: [n!] }, show: { ...review.groups.get(n!)!, decision: review.decisions.get(n!)! } }
    }
    case 'edit':
      return applyEdit(review, rest)
    case 'accept-all':
    case 'done': {
      if (rest) refuse('argument_invalid', `${verb} takes no argument; ${grammarOf(review.mode)}`)
      const accepted: number[] = []
      for (const [n, d] of review.decisions) {
        if (d.decision !== 'pending') continue
        const g = review.groups.get(n)!
        if (verb === 'accept-all' && !g.needs_human && !g.per_row_only) {
          review.decisions.set(n, { decision: 'accept' })
          accepted.push(n)
        } else review.decisions.set(n, { decision: 'skip' })
      }
      review.closed = true
      return { command: { verb, groups: accepted } }
    }
  }
  return refuse('reply_unparsed', `the reply is not a command; ${grammarOf(review.mode)}`)
}

/** The earlier edit of group n, if its decision is one. */
function priorEdit(review: Review, n: number): Decision | undefined {
  const d = review.decisions.get(n)
  return d?.decision === 'edit' ? d : undefined
}

function applyEdit(review: Review, rest: string): ReplyResult {
  const m = /^(\d{1,3})\s+([\s\S]+)$/.exec(rest)
  if (!m) refuse('argument_invalid', `edit takes a group number and a field; ${grammarOf(review.mode)}`)
  const [n] = groupNumbers(review, 'edit', m![1]!, true)
  const body = m![2]!.trim()
  const f = /^(?:kind:\s*([A-Za-z_]+)(?:\s+rationale:\s*([\s\S]+))?|rationale:\s*([\s\S]+))$/i.exec(body)
  if (!f) refuse('edit_invalid', `edit ${n} takes kind: <KIND> and/or rationale: <text>; ${grammarOf(review.mode)}`)
  const kind = f![1]?.toUpperCase()
  const rationale = (f![2] ?? f![3])?.trim()
  if (rationale !== undefined && new RegExp(`\\bkind:\\s*(${PICKABLE_KINDS.join('|')})\\b`, 'i').test(rationale)) {
    refuse('edit_invalid', `edit ${n}: kind: comes before rationale: (edit ${n} kind: <KIND> rationale: <text>)`)
  }
  const g = review.groups.get(n!)!
  if (g.proposal?.op === 'supersede') refuse('edit_invalid', `group ${n} is a supersede proposal: its reason is the fixed supersede record, so accept or skip it`)
  if (kind !== undefined && !(PICKABLE_KINDS as readonly string[]).includes(kind)) refuse('edit_invalid', `${kind} is not a kind; one of ${PICKABLE_KINDS.join(', ')}`)
  const priorRationale = priorEdit(review, n!)?.rationale
  if (g.needs_human && kind === undefined) {
    const prior = priorEdit(review, n!)?.kind
    refuse('needs_operator_decision', prior
      ? `group ${n} needs your decision with its kind: edit ${n} kind: ${prior} rationale: <text>`
      : `group ${n} needs your decision: edit ${n} kind: <KIND> rationale: <text>`, { groups: [n] })
  }
  // The operator decides a needs-human group: the reason is theirs too, never the proposal's.
  if (g.needs_human && !rationale && !priorRationale) {
    refuse('needs_operator_decision', `group ${n} needs your decision with your rationale: edit ${n} kind: ${kind} rationale: <text>`, { groups: [n] })
  }
  if (kind !== undefined && OPERATOR_ONLY_KINDS.has(kind) && !rationale && !priorRationale) refuse('edit_invalid', `${kind} needs your rationale: edit ${n} kind: ${kind} rationale: <text>`)
  if (rationale !== undefined) {
    const problem = textProblem(rationale, 'the rationale')
    if (problem) refuse('text_invalid', problem)
  }
  const prior = review.decisions.get(n!)!
  const decision: Decision = { decision: 'edit' }
  const keptKind = kind ?? (prior.decision === 'edit' ? prior.kind : undefined)
  const keptRationale = rationale ?? (prior.decision === 'edit' ? prior.rationale : undefined)
  if (keptKind !== undefined) decision.kind = keptKind
  if (keptRationale !== undefined) decision.rationale = keptRationale
  review.decisions.set(n!, decision)
  return { command: { verb: 'edit', groups: [n!], fields: { ...(kind !== undefined ? { kind } : {}), ...(rationale !== undefined ? { rationale } : {}) } } }
}

/** The decisions as the tool reports them, in group order. */
export function decisionsOf(review: Review): Array<{ group: number } & Decision> {
  return [...review.decisions.entries()].map(([group, d]) => ({ group, ...d }))
}

/** One operation a closed review decided, before it is checked against the platform. */
export interface ReviewOperation {
  group: number
  exposure_id: string
  op: ProposalOp
  kind?: string
  /** The reason as proposed or as the operator wrote it, without the marker */
  reason?: string
  /** The operator changed the proposal (an edit) */
  edited: boolean
  /** The reason is the operator's own rationale, not the proposal's */
  operator_reason?: boolean
  /** The marker the reason ends with, when the write is not triage's (triage's own otherwise) */
  marker?: string
  modifications?: Modifications
  verified_technique_ids?: string[]
}

/** The operation list of a closed review: accepted, edited, reaffirmed and cleared groups, in group then exposure order. */
export function operationsOf(review: Review): ReviewOperation[] {
  const out: ReviewOperation[] = []
  for (const [n, g] of review.groups) {
    const d = review.decisions.get(n)!
    if (d.decision === 'pending' || d.decision === 'skip') continue
    for (const exposure_id of g.exposure_ids) {
      if (d.decision === 'reaffirm' || d.decision === 'clear') {
        out.push({ group: n, exposure_id, op: d.decision, edited: false })
        continue
      }
      const p = g.proposal
      if (p?.op === 'supersede') {
        out.push({ group: n, exposure_id, op: 'supersede', edited: false, modifications: p.modifications, verified_technique_ids: p.verified_technique_ids ?? [] })
        continue
      }
      const edited = d.decision === 'edit'
      const kind = (edited ? d.kind : undefined) ?? p?.kind
      const own = edited && d.rationale !== undefined
      const reason = own ? d.rationale : p?.reason
      out.push({ group: n, exposure_id, op: 'dispose', edited, operator_reason: own, ...(kind !== undefined ? { kind } : {}), ...(reason !== undefined ? { reason } : {}) })
    }
  }
  return out
}
