/**
 * The questions the triage tools return as `ask`: the registered question the operator is asked next, its tag
 * first, on one line. The skill ends its message with it as returned, so the model copies a string rather than
 * recalling one. The texts equal the skill's registered questions; a generator test holds the two together.
 */
import type { ReviewMode } from './review.js'

export const REVIEW_ASK = 'Your command? One command per reply: accept, skip, show, edit, accept-all or done, as the hint above shows.'
export const STALE_REVIEW_ASK = 'Your command? One command per reply: reaffirm, clear, skip, show or done, as the hint above shows.'
/** The apply question, `N` standing for the count of ready operations. */
export const APPLY_ASK = 'Apply N dispositions? Type yes or cancel.'

/** A question as asked: its tag, then its text. */
export const tagged = (id: string, text: string): string => `[prompt: ${id}] ${text}`

/** The review question of a review in `mode`. */
export const reviewAsk = (mode: ReviewMode): string =>
  mode === 'review' ? tagged('triage-review', REVIEW_ASK) : tagged('triage-stale-review', STALE_REVIEW_ASK)

/** The apply question for a plan of `count` ready operations. */
export const applyAsk = (count: number): string => tagged('triage-apply', APPLY_ASK.replace('N', String(count)))
