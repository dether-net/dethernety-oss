/**
 * The open reviews of this server process. Held in memory only: a review is never written to disk (the record is,
 * its replies), so nothing on disk can forge one. A restart forgets them. At most `REVIEW_STORE.reviews` are held,
 * the least recently used dropped first, and one unused for `REVIEW_STORE.idleMs` expires.
 */
import type { Review } from './review.js'

export const REVIEW_STORE = { reviews: 20, idleMs: 2 * 60 * 60 * 1000 } as const

/** The process clock in milliseconds, immune to wall-clock changes. */
const now = (): number => Number(process.hrtime.bigint() / 1_000_000n)

export class ReviewStore {
  private readonly reviews = new Map<string, { review: Review; usedAt: number }>()

  /** Tests only: shifts the clock this store reads. */
  clockOffsetMs = 0

  private time(): number {
    return now() + this.clockOffsetMs
  }

  /** A review by id, or undefined when there is none (never opened, dropped, expired, or forgotten by a restart). */
  get(id: string): Review | undefined {
    const held = this.reviews.get(id)
    if (!held) return undefined
    if (this.time() - held.usedAt > REVIEW_STORE.idleMs) {
      this.reviews.delete(id)
      return undefined
    }
    return held.review
  }

  /** Keep `review` (new, or a changed copy of one held), as the most recently used. */
  put(review: Review): void {
    this.reviews.delete(review.id)
    while (this.reviews.size >= REVIEW_STORE.reviews) {
      const oldest = this.reviews.keys().next().value
      if (oldest === undefined) break
      this.reviews.delete(oldest)
    }
    this.reviews.set(review.id, { review, usedAt: this.time() })
  }

  /** The review of `dir` still open, if this process holds one. */
  openFor(dir: string): Review | undefined {
    for (const id of [...this.reviews.keys()]) {
      const r = this.get(id)
      if (r && r.dir === dir && !r.closed) return r
    }
    return undefined
  }

  clear(): void {
    this.reviews.clear()
  }

  get size(): number {
    return this.reviews.size
  }
}

/** The reviews of this process, shared by the review and disposition tools. */
export const reviewStore = new ReviewStore()

/** A copy of a review whose decisions can change without changing the held one. */
export function copyOf(review: Review): Review {
  return { ...review, decisions: new Map([...review.decisions].map(([n, d]) => [n, { ...d }])) }
}
