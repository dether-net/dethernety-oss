/**
 * A hidden-edge review: the candidates `open` showed, numbered, and what the operator decided for each. Held in
 * this process only, as triage's reviews are; nothing here writes a file or calls the platform.
 *
 * The grammar is triage's, with `reject`:
 *   accept <n>[,<n>…] · skip <n>… · reject <n>… · show <n> · show rejected · accept-all · done ·
 *   edit <n> capability: <v> | required: <v> | granted: <v> | <the candidate's field>: <v> | rationale: <text>
 *
 * `accept-all` accepts only the candidates that may be accepted in bulk (not on pending exposures only, not edited);
 * `accept-all` and `done` close the review.
 */
import { randomBytes } from 'node:crypto'
import type { ExposureState } from '../triage/exposures.js'
import { textProblem } from '../triage/review.js'
import { CAPABILITIES, PRIVILEGES, type BaseValues } from './contract.js'
import type { Candidate } from './answer.js'
import type { LocalModel } from './local.js'
import type { Seen } from './open.js'
import type { ReadDecision } from './records.js'

export const REVIEW_STORE = { reviews: 20, idleMs: 2 * 60 * 60 * 1000 } as const
export const REVIEW_LIMITS = { rationaleChars: 1000, evidence: 10 } as const

export type Choice = 'open' | 'accept' | 'skip' | 'reject'

export interface ReviewCandidate extends Candidate {
  n: number
  choice: Choice
  /** The operator's rationale, from an edit */
  rationale: string | null
  /** The base values the edge is written with: the defaults, as the operator edited them */
  base: BaseValues
  /** The analyst's locators for it */
  evidence: string[]
  /** The operator changed it: never in accept-all */
  edited: boolean
  /** Accepted through accept-all: it affirms nothing (a pending exposure is affirmed only by its own accept) */
  bulk: boolean
}

export interface HiddenEdgeReview {
  id: string
  dir: string
  model_id: string
  model_name: string
  opened_at: string
  candidates: ReviewCandidate[]
  local: LocalModel
  exposures: Map<string, ExposureState>
  decisions: ReadDecision[]
  seen: Seen
  header: Record<string, unknown>
  closed: boolean
  touched: number
}

// =============================================================================
// The store
// =============================================================================

class ReviewStore {
  private readonly reviews = new Map<string, HiddenEdgeReview>()
  /** Tests only: shifts the clock this store reads. */
  clockOffsetMs = 0
  private now = () => Date.now() + this.clockOffsetMs

  put(r: HiddenEdgeReview): void {
    this.sweep()
    while (this.reviews.size >= REVIEW_STORE.reviews) this.reviews.delete(this.reviews.keys().next().value!)
    r.touched = this.now()
    this.reviews.set(r.id, r)
  }

  get(id: string): HiddenEdgeReview | undefined {
    this.sweep()
    const r = this.reviews.get(id)
    if (!r) return undefined
    r.touched = this.now()
    this.reviews.delete(id)
    this.reviews.set(id, r)
    return r
  }

  /** Forget review `id`: one whose record can take nothing more is closed for good. */
  drop(id: string): void {
    this.reviews.delete(id)
  }

  clear(): void {
    this.reviews.clear()
  }

  private sweep(): void {
    const t = this.now()
    for (const [id, r] of this.reviews) if (t - r.touched > REVIEW_STORE.idleMs) this.reviews.delete(id)
  }
}

export const hiddenEdgeReviews = new ReviewStore()
export const newReviewId = (): string => randomBytes(16).toString('hex')

// =============================================================================
// The grammar
// =============================================================================

export class ReplyRefusal extends Error {
  constructor(readonly code: 'review_closed' | 'reply_unparsed' | 'argument_invalid' | 'candidate_unknown', message: string) {
    super(message)
  }
}

export type ReplyEffect =
  | { verb: 'accept' | 'skip' | 'reject'; ns: number[] }
  | { verb: 'edit'; n: number; field: string }
  | { verb: 'show'; n: number }
  | { verb: 'show_rejected'; rejected: Array<{ id: string; kind: string; source: string; target: string }> }
  | { verb: 'accept-all'; accepted: number[]; held: number[] }
  | { verb: 'done' }

/** Whether a candidate may be accepted in bulk. */
export const bulkAcceptable = (c: ReviewCandidate) => !c.pending_only && !c.edited

function numbers(text: string, count: number): number[] {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  if (!parts.length || !parts.every((p) => /^\d{1,3}$/.test(p))) throw new ReplyRefusal('reply_unparsed', 'name candidates by their numbers')
  const ns = [...new Set(parts.map(Number))]
  const unknown = ns.filter((n) => n < 1 || n > count)
  if (unknown.length) throw new ReplyRefusal('candidate_unknown', `no candidate ${unknown.join(', ')}`)
  return ns
}

const BASE_EDITS: Record<string, keyof BaseValues> = { capability: 'required_capability', required: 'required_privilege', granted: 'granted_privilege' }

/**
 * Apply one reply to an open review. Throws a ReplyRefusal for a reply it cannot take; otherwise changes the review
 * and returns what the reply did.
 */
export function applyHiddenEdgeReply(r: HiddenEdgeReview, reply: string): ReplyEffect {
  if (r.closed) throw new ReplyRefusal('review_closed', 'the review is closed: prepare the apply, or open a new review')
  const text = reply.trim()
  const verb = (text.split(/\s+/, 1)[0] ?? '').toLowerCase()
  const rest = text.slice(verb.length).trim()
  const count = r.candidates.length
  switch (verb) {
    case 'accept':
    case 'skip':
    case 'reject': {
      const ns = numbers(rest, count)
      for (const n of ns) Object.assign(r.candidates[n - 1]!, { choice: verb, bulk: false })
      return { verb, ns }
    }
    case 'show': {
      if (/^rejected$/i.test(rest)) {
        return { verb: 'show_rejected', rejected: r.decisions.filter((d) => d.verb === 'rejected').map((d) => ({ id: d.id, kind: d.kind, source: d.source, target: d.target })) }
      }
      const [n] = numbers(rest, count)
      return { verb: 'show', n: n! }
    }
    case 'accept-all': {
      if (rest) throw new ReplyRefusal('reply_unparsed', 'accept-all takes no argument')
      const accepted: number[] = []
      const held: number[] = []
      for (const c of r.candidates) {
        if (c.choice !== 'open') continue
        if (bulkAcceptable(c)) {
          Object.assign(c, { choice: 'accept', bulk: true })
          accepted.push(c.n)
        } else held.push(c.n)
      }
      r.closed = true
      return { verb: 'accept-all', accepted, held }
    }
    case 'done':
      if (rest) throw new ReplyRefusal('reply_unparsed', 'done takes no argument')
      r.closed = true
      return { verb: 'done' }
    case 'edit': {
      const m = /^(\d{1,3})\s+([a-z][a-z0-9_]{0,63}):\s*(.*)$/is.exec(rest)
      if (!m) throw new ReplyRefusal('reply_unparsed', 'edit <n> <field>: <value>')
      const [n] = numbers(m[1]!, count)
      const c = r.candidates[n! - 1]!
      const field = m[2]!.toLowerCase()
      const value = m[3]!.trim()
      if (field === 'rationale') {
        const problem = textProblem(value, 'rationale') ?? (value.length > REVIEW_LIMITS.rationaleChars ? `the rationale is over ${REVIEW_LIMITS.rationaleChars} characters` : null)
        if (problem || !value) throw new ReplyRefusal('argument_invalid', problem ?? 'the rationale is empty')
        Object.assign(c, { rationale: value, edited: true })
        return { verb: 'edit', n: n!, field }
      }
      const base = BASE_EDITS[field]
      if (!base && Object.prototype.hasOwnProperty.call(c.fields, field)) {
        // A field the module set for this candidate: a value of the same shape (the class checks it on push).
        if (!/^[a-z0-9_-]{1,64}$/.test(value)) throw new ReplyRefusal('argument_invalid', `${field} takes a value of lower-case letters, digits, _ and -`)
        Object.assign(c, { fields: { ...c.fields, [field]: value }, edited: true })
        return { verb: 'edit', n: n!, field }
      }
      if (!base) throw new ReplyRefusal('argument_invalid', "edit capability, required, granted, rationale or one of the candidate's fields")
      const allowed: readonly string[] = base === 'required_capability' ? CAPABILITIES : PRIVILEGES
      if (!allowed.includes(value)) throw new ReplyRefusal('argument_invalid', `${field} is one of ${allowed.join(', ')}`)
      Object.assign(c, { base: { ...c.base, [base]: value }, edited: true })
      return { verb: 'edit', n: n!, field }
    }
    default:
      throw new ReplyRefusal('reply_unparsed', 'the reply starts with accept, skip, reject, edit, show, accept-all or done')
  }
}

/** The candidates a closed review applies: accepted and rejected ones. */
export const decided = (r: HiddenEdgeReview) => r.candidates.filter((c) => c.choice === 'accept' || c.choice === 'reject')
