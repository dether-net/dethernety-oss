/**
 * The questions the hidden-edge tools return as `ask`, tagged as triage's are: the skill ends its message with the
 * string as returned, and registers the same texts.
 */
import { tagged } from '../triage/asks.js'

export const REVIEW_ASK = 'Your command? One command per reply: accept, skip, reject, edit, show, accept-all or done, as the hint above shows.'
/** The apply question, `N` standing for the count of changes. */
export const APPLY_ASK = 'Apply N hidden-edge change(s)? Type yes or cancel.'

export const reviewAsk = (): string => tagged('hidden-edges-review', REVIEW_ASK)
export const applyAsk = (count: number): string => tagged('hidden-edges-apply', APPLY_ASK.replace('N', String(count)))
/** Where the edges are decided, asked when the review workspace has a Hidden edges workspace. */
export const WHERE_ASK =
  "Decide these edges here, or publish them to the platform's Hidden edges workspace for a person to decide there? Here: you decide edge by edge, and what you accept is written to the local files after an apply question. Publish: nothing is written here; the edges and the analyst's arguments go to the Hidden edges workspace under your name, and this review closes here. Either way you see everything before it is written or sent. (here / publish)"
/** The publish question, `N` standing for the count of edges sent. */
export const PUBLISH_ASK = 'Publish N edge(s) to the Hidden edges workspace? Type yes or cancel.'

export const whereAsk = (): string => tagged('hidden-edges-where', WHERE_ASK)
export const publishAsk = (count: number): string => tagged('hidden-edges-publish', PUBLISH_ASK.replace('N', String(count)))

/** The take-back question, asked when a hidden-edge flow is removed: the answer decides what is recorded. */
export const TAKE_BACK_ASK = 'Take back this hidden edge? Type reject (it was never real), release (it was fixed, or is no longer wanted) or cancel (the flow stays).'

export const takeBackAsk = (): string => tagged('hidden-edges-take-back', TAKE_BACK_ASK)
