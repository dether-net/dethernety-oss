/**
 * The analyst's evidence for the module's candidates: locators, never quoted values — `source:<file>:<line>`,
 * `attributes:<file>#<key>`, `platform:<id>`, `kg:<id>`. The analyst argues for and against the candidates the
 * module proposes; it adds none of its own.
 */
import { REVIEW_LIMITS, type HiddenEdgeReview } from './review.js'

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
  locators: string[]
}

export class EvidenceRefusal extends Error {
  constructor(readonly code: 'review_closed' | 'candidate_unknown' | 'locator_invalid', message: string) {
    super(message)
  }
}

/** Attach the analyst's locators to candidates. All or nothing; returns how many were new. */
export function attachEvidence(r: HiddenEdgeReview, items: EvidenceItem[]): number {
  if (r.closed) throw new EvidenceRefusal('review_closed', 'the review is closed')
  for (const it of items) {
    if (!r.candidates[it.n - 1]) throw new EvidenceRefusal('candidate_unknown', `no candidate ${it.n}`)
    const bad = it.locators.findIndex((l) => !isLocator(l))
    if (bad >= 0) throw new EvidenceRefusal('locator_invalid', `candidate ${it.n}: locator ${bad + 1} is no locator (source:<file>:<line>, attributes:<file>#<key>, platform:<id>, kg:<id>)`)
  }
  let attached = 0
  for (const it of items) {
    const c = r.candidates[it.n - 1]!
    const before = c.evidence.length
    c.evidence = [...new Set([...c.evidence, ...it.locators])].slice(0, REVIEW_LIMITS.evidence)
    attached += c.evidence.length - before
  }
  return attached
}
