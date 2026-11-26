/**
 * The analyst's evidence for the module's candidates: locators, never quoted values — `source:<file>:<line>`,
 * `attributes:<file>#<key>`, `platform:<id>`, `kg:<id>`. The analyst argues for and against the candidates the
 * module proposes; it adds none of its own.
 */
import { redactSecrets } from '../auth/redact.js'
import { cleanText } from '../triage/tasks.js'
import { textProblem } from '../triage/review.js'
import { REVIEW_LIMITS, type HiddenEdgeReview, type Stance } from './review.js'

const FILE = /^[A-Za-z0-9_.@+-]{1,128}(\/[A-Za-z0-9_.@+-]{1,128}){0,15}$/
const relativeFile = (p: string) => p.length <= 300 && FILE.test(p) && !p.split('/').some((seg) => seg === '.' || seg === '..')

/** A locator: a place in the project, the model or the platform, never a value. */
export function isLocator(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 400) return false
  let m = /^source:(.+):(\d{1,7})$/.exec(s)
  if (m) return relativeFile(m[1]!)
  m = /^attributes:(.+)#([A-Za-z0-9_.-]{1,128})$/.exec(s)
  if (m) return relativeFile(m[1]!)
  return /^(platform:[A-Za-z0-9_-]{1,128}|kg:[\w:.-]{1,128})$/.test(s)
}

export interface EvidenceItem {
  n: number
  stance: Stance
  reason?: string
  locators?: string[]
}

export class EvidenceRefusal extends Error {
  constructor(readonly code: 'review_closed' | 'candidate_unknown' | 'locator_invalid' | 'reason_invalid', message: string) {
    super(message)
  }
}

/**
 * The analyst's reason as it is held, and may leave this machine with a publish: cleaned to one line, at most 300
 * characters, and never holding this session's credentials. Why it is refused, or the text; its words never echo.
 */
export function reasonOf(text: string | undefined, n: number): { reason: string | null } | { problem: string } {
  if (text === undefined) return { reason: null }
  const one = cleanText(text)
  // checked as written and as cleaned: cleaning removes invisible characters and normalises, which could join one up
  if (redactSecrets(text) !== text || redactSecrets(one) !== one) return { problem: `candidate ${n}: the reason holds this session's credentials; nothing was taken: return it without them` }
  if (one === '') return { reason: null }
  const problem = textProblem(one, `candidate ${n}'s reason`) ?? (one.length > REVIEW_LIMITS.reasonChars ? `candidate ${n}'s reason is ${one.length} characters; at most ${REVIEW_LIMITS.reasonChars}` : null)
  return problem ? { problem } : { reason: one }
}

/**
 * Attach the analyst's arguments to candidates: the stance and reason (a later one replaces an earlier), and the
 * locators added to those held. All or nothing; returns how many locators were new.
 */
export function attachEvidence(r: HiddenEdgeReview, items: EvidenceItem[]): number {
  if (r.closed) throw new EvidenceRefusal('review_closed', 'the review is closed')
  const reasons: Array<string | null> = []
  for (const it of items) {
    if (!r.candidates[it.n - 1]) throw new EvidenceRefusal('candidate_unknown', `no candidate ${it.n}`)
    const bad = (it.locators ?? []).findIndex((l) => !isLocator(l))
    if (bad >= 0) throw new EvidenceRefusal('locator_invalid', `candidate ${it.n}: locator ${bad + 1} is no locator (source:<file>:<line>, attributes:<file>#<key>, platform:<id>, kg:<id>)`)
    const reason = reasonOf(it.reason, it.n)
    if ('problem' in reason) throw new EvidenceRefusal('reason_invalid', reason.problem)
    reasons.push(reason.reason)
  }
  let attached = 0
  items.forEach((it, i) => {
    const c = r.candidates[it.n - 1]!
    const before = c.evidence.length
    c.evidence = [...new Set([...c.evidence, ...(it.locators ?? [])])].slice(0, REVIEW_LIMITS.evidence)
    c.argument = { stance: it.stance, reason: reasons[i]! }
    attached += c.evidence.length - before
  })
  return attached
}
