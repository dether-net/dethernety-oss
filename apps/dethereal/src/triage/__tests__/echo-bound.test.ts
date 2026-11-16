/**
 * The echo bound: whatever a review's operator decides, and whatever the platform does to its exposures before
 * prepare, the plan's echo is never larger than the bound the review was checked against.
 */
import { describe, it, expect } from 'vitest'
import { applyReply, openReview, operationsOf, ReviewRefusal, type Review, type ReviewGroup } from '../review.js'
import { echoOf, echoSize, planOperations, reviewEchoBound, type PrepareInput } from '../dispositions.js'
import { row, viewOf } from './fixtures.js'
import type { ExposureState } from '../exposures.js'

const DATE = '2026-11-11'

/** A small deterministic generator, so a failure reproduces. */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 0x100000000
  }
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
const words = (r: () => number, max: number) => Array.from({ length: 1 + Math.floor(r() * max) }, () => pick(r, ['scan', 'port', 'closed', '"quoted"', 'back\\\\slash', 'ünï', 'firewall', '漢字'])).join(' ')

function randomReview(r: () => number, mode: 'review' | 'stale'): { review: Review; rows: ExposureState[] } {
  const rows: ExposureState[] = []
  const groups: ReviewGroup[] = []
  const nGroups = 1 + Math.floor(r() * 6)
  let k = 0
  for (let g = 1; g <= nGroups; g++) {
    const ids = Array.from({ length: 1 + Math.floor(r() * 5) }, () => `e${k++}`)
    for (const id of ids) {
      const disposed = mode === 'stale' || r() < 0.3
      rows.push(row(id, {
        name: words(r, 6),
        disposition_kind: disposed ? pick(r, ['NOT_APPLICABLE', 'FALSE_POSITIVE', 'RISK_ACCEPTED', 'AFFIRMED', ...(mode === 'stale' ? ['SUPERSEDED'] : [])]) : null,
        disposition_stale: mode === 'stale' ? true : null,
        full_reason: disposed ? words(r, 30) : null,
      }))
    }
    if (mode === 'stale') groups.push({ group: g, exposure_ids: ids, ...(r() < 0.7 ? { proposal: { op: pick(r, ['reaffirm', 'clear'] as const) } } : {}) })
    else if (r() < 0.2) groups.push({ group: g, exposure_ids: ids, needs_human: true })
    else if (r() < 0.3) {
      for (const id of ids) rows.find((x) => x.exposure_id === id)!.disposition_kind = null
      groups.push({ group: g, exposure_ids: ids, proposal: { op: 'supersede', modifications: { score: Math.floor(r() * 10), description: words(r, 20) } } })
    } else groups.push({ group: g, exposure_ids: ids, proposal: { op: 'dispose', kind: pick(r, ['FALSE_POSITIVE', 'NOT_APPLICABLE', 'AFFIRMED']), reason: words(r, 40) }, ...(r() < 0.2 ? { per_row_only: true } : {}) })
  }
  return { review: openReview('a'.repeat(32), '/m', mode, groups, viewOf(rows)), rows }
}

/** Apply `reply` as the tool does: a reply is refused, changing nothing, when it would put the review over `budget`. */
function reply(review: Review, text: string, budget: number): void {
  const before = new Map(review.decisions)
  const closed = review.closed
  try {
    applyReply(review, text)
    if (reviewEchoBound(review, DATE) > budget) {
      review.decisions = before
      review.closed = closed
    }
  } catch (err) {
    if (!(err instanceof ReviewRefusal)) throw err
  }
}

describe('the echo bound', () => {
  it('holds every plan prepare can make, for random reviews, decisions and platform changes', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed)
      const mode = r() < 0.3 ? 'stale' : 'review'
      const { review, rows } = randomReview(r, mode)
      const budget = reviewEchoBound(review, DATE)
      const verbs = mode === 'stale' ? ['reaffirm', 'clear', 'skip'] : ['accept', 'skip', 'edit']
      for (let i = 0; i < 12; i++) {
        const n = 1 + Math.floor(r() * review.groups.size)
        const verb = pick(r, verbs)
        if (verb === 'edit') reply(review, `edit ${n} kind: ${pick(r, ['AFFIRMED', 'COMPENSATING_CONTROL', 'FALSE_POSITIVE'])} rationale: ${words(r, 120)}`, budget)
        else reply(review, `${verb} ${n}`, budget)
      }
      reply(review, pick(r, mode === 'stale' ? ['done'] : ['done', 'accept-all']), budget)
      expect(review.closed, `seed ${seed}`).toBe(true)
      // Every taken reply kept the review within the budget it was opened with: the plan is too.
      const bound = budget
      // The platform, before prepare: some exposures gone, some changed, some renamed, some on a renamed element.
      const changed = (x: ExposureState): ExposureState => {
        const roll = r()
        if (roll < 0.1) return { ...x, def_hash: 'changed' }
        if (roll < 0.2) return { ...x, name: 'renamed '.repeat(60) }
        if (roll < 0.3) return { ...x, element_name: 'element renamed '.repeat(40) }
        return x
      }
      const state = new Map(rows.filter(() => r() > 0.1).map((x) => [x.exposure_id, changed(x)]))
      const input: PrepareInput = { operations: operationsOf(review), state, seen: review.seen, evidence: review.evidence, techniques: review.techniques, date: DATE }
      const actual = echoSize(echoOf(review, planOperations(input)))
      expect(actual, `seed ${seed}`).toBeLessThanOrEqual(bound)
    }
  })

  it('holds a plan prepared against an unchanged platform', () => {
    const { review } = randomReview(rng(7), 'review')
    applyReply(review, 'done')
    const planned = planOperations({ operations: operationsOf(review), state: review.seen, seen: review.seen, evidence: review.evidence, techniques: review.techniques, date: DATE })
    expect(echoSize(echoOf(review, planned))).toBeLessThanOrEqual(reviewEchoBound(review, DATE))
  })

  it('holds when the platform renames the exposures or their element before prepare', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(`e${i}`, { name: `exposure ${i}`, element_name: 'api' }))
    const groups: ReviewGroup[] = [{ group: 1, exposure_ids: rows.map((x) => x.exposure_id), proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'the scan misread it' } }]
    const review = openReview('a'.repeat(32), '/m', 'review', groups, viewOf(rows))
    applyReply(review, 'accept-all')
    const bound = reviewEchoBound(review, DATE)
    for (const rename of [{ element_name: 'a renamed element '.repeat(30) }, { name: 'a renamed exposure '.repeat(30) }]) {
      const state = new Map(rows.map((x) => [x.exposure_id, { ...x, ...rename }]))
      const planned = planOperations({ operations: operationsOf(review), state, seen: review.seen, evidence: review.evidence, techniques: review.techniques, date: DATE })
      expect(echoSize(echoOf(review, planned)), JSON.stringify(Object.keys(rename))).toBeLessThanOrEqual(bound)
    }
  })
})
