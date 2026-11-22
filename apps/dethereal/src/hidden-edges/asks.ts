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
