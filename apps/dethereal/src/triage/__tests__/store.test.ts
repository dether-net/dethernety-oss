/**
 * The review store: reviews held in memory, the least recently used dropped first, and an idle one expiring.
 */
import { describe, it, expect } from 'vitest'
import { REVIEW_STORE, ReviewStore } from '../store.js'
import { openReview } from '../review.js'
import { viewFor } from './fixtures.js'

const GROUPS = [{ group: 1, exposure_ids: ['e'], proposal: { op: 'dispose' as const, kind: 'AFFIRMED', reason: 'r' } }]
const make = (n: number) => openReview(n.toString(16).padStart(32, '0'), '/m', 'review', GROUPS, viewFor(GROUPS))

describe('ReviewStore', () => {
  it('returns a review put, and nothing for an unknown id', () => {
    const s = new ReviewStore()
    const r = make(1)
    s.put(r)
    expect(s.get(r.id)).toBe(r)
    expect(s.get(make(2).id)).toBeUndefined()
  })

  it('replaces a review put again under its id', () => {
    const s = new ReviewStore()
    const r = make(1)
    s.put(r)
    const changed = { ...r, closed: true }
    s.put(changed)
    expect(s.get(r.id)).toBe(changed)
    expect(s.size).toBe(1)
  })

  it(`holds ${REVIEW_STORE.reviews}, dropping the least recently put first`, () => {
    const s = new ReviewStore()
    const reviews = Array.from({ length: REVIEW_STORE.reviews + 1 }, (_, i) => make(i))
    for (const r of reviews.slice(0, REVIEW_STORE.reviews)) s.put(r)
    s.put(reviews[0]!)
    s.put(reviews[REVIEW_STORE.reviews]!)
    expect(s.size).toBe(REVIEW_STORE.reviews)
    expect(s.get(reviews[0]!.id)).toBeDefined()
    expect(s.get(reviews[1]!.id)).toBeUndefined()
  })

  it('expires a review unused for the idle time', () => {
    const s = new ReviewStore()
    const r = make(1)
    s.put(r)
    s.clockOffsetMs = REVIEW_STORE.idleMs - 1000
    expect(s.get(r.id)).toBe(r)
    s.clockOffsetMs = REVIEW_STORE.idleMs + 1000
    expect(s.get(r.id)).toBeUndefined()
    expect(s.size).toBe(0)
  })
})
