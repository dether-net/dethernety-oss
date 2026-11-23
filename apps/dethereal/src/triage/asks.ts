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

/** The publish question, `G` groups and `F` findings going to the review workspace. */
export const PUBLISH_ASK = 'Publish G groups (F findings) to the Triage workspace? Type yes or cancel.'

const counted = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/**
 * The publish question for a plan of `groups` groups holding `findings` findings; when it replaces proposals still
 * waiting in the workspace, the question says so too.
 */
export const publishAsk = (groups: number, findings: number, replacing: number | null = 0): string =>
  tagged('triage-publish', PUBLISH_ASK.replace('G groups', counted(groups, 'group')).replace('F findings', counted(findings, 'finding')).replace('Type yes',
    replacing === null ? 'It replaces any proposals still waiting there, which could not be counted. Type yes' : replacing > 0 ? `It replaces ${counted(replacing, 'proposal')} still waiting there. Type yes` : 'Type yes'))

/** The apply question for a plan of `count` ready operations. */
export const applyAsk = (count: number): string => tagged('triage-apply', APPLY_ASK.replace('N', String(count)))
