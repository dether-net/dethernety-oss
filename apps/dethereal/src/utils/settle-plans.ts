/**
 * Prepared settlements, held in this server process only: a plan is never written to disk, so nothing on disk can
 * forge or replay one. `prepare` checks a settle call and stores its input; `commit` runs that input once, under the
 * settlement lock, and writes only when the model is still what the plan was checked against.
 *
 * A plan is bound to its model directory, to the baseline revision and the pending file it was checked against,
 * and to a fingerprint of everything it would write. It expires after `PLAN_LIMITS.ttlMs`, commits at most once,
 * and the oldest no commit is running is dropped past `PLAN_LIMITS.plans`.
 */
import { randomBytes } from 'node:crypto'

/** At most this many plans are held, the oldest dropped first; each holds for 30 minutes. */
export const PLAN_LIMITS = { plans: 20, ttlMs: 30 * 60 * 1000 } as const

/** A plan's id: 128 random bits, in hex. */
export const PLAN_ID = /^[0-9a-f]{32}$/

/** What a plan was checked against: a commit writes only while these are unchanged. */
export interface PlanBound {
  baseline_revision: number | null
  pending_digest: string | null
}

export interface SettlePlan<I> {
  id: string
  /** The model directory, as the path confinement resolved it */
  dir: string
  /** The settle input without its reply: the reply comes with the commit */
  input: I
  bound: PlanBound
  /** sha256 over everything the call would write and register */
  fingerprint: string
  /** The lines prepare returned: the commit passes them back, verbatim */
  lines: string[]
  /** Monotonic, in milliseconds */
  expiresAt: number
  /** The same moment on the wall clock, as the result shows it */
  expiresAtIso: string
  /** A commit of it is running */
  running: boolean
}

/** Why a plan is spent: recorded, found stale (nothing written), or failed after part of its write. */
export type PlanEnd = 'committed' | 'stale' | 'failed'

export type PlanTake<I> =
  | { status: 'ok'; plan: SettlePlan<I> }
  | { status: 'not_found' | 'expired' | 'other_model' | 'running' }
  | { status: 'spent'; end: PlanEnd }

/** The process clock in milliseconds, immune to wall-clock changes. */
const now = (): number => Number(process.hrtime.bigint() / 1_000_000n)

export class SettlePlanStore<I> {
  private readonly plans = new Map<string, SettlePlan<I>>()
  /** Plans a commit ran, kept by id until they would have expired, with how they ended: a second commit is told which. */
  private readonly spent = new Map<string, { until: number; end: PlanEnd }>()

  /** Tests only: shifts the clock this store reads. */
  clockOffsetMs = 0

  private time(): number {
    return now() + this.clockOffsetMs
  }

  add(dir: string, input: I, bound: PlanBound, fingerprint: string, lines: string[]): SettlePlan<I> {
    this.sweep()
    // The oldest plan no commit is running goes first: a running commit keeps its plan to the end.
    while (this.plans.size >= PLAN_LIMITS.plans) {
      const oldest = [...this.plans.values()].find((p) => !p.running)
      if (!oldest) break
      this.plans.delete(oldest.id)
    }
    const plan: SettlePlan<I> = {
      id: randomBytes(16).toString('hex'), dir, input, bound, fingerprint, lines,
      expiresAt: this.time() + PLAN_LIMITS.ttlMs, expiresAtIso: new Date(Date.now() + PLAN_LIMITS.ttlMs).toISOString(), running: false,
    }
    this.plans.set(plan.id, plan)
    return plan
  }

  /**
   * Take a plan for a commit, synchronously: it is marked running before the caller awaits anything, so two commits of
   * one plan never both run it. An expired plan is dropped; one for another directory is left as it is.
   */
  take(id: string, dir: string): PlanTake<I> {
    const spent = this.spent.get(id)
    if (spent) return { status: 'spent', end: spent.end }
    const plan = this.plans.get(id)
    if (!plan) return { status: 'not_found' }
    // A commit of it is running now: this one waits for its end.
    if (plan.running) return { status: 'running' }
    if (this.time() >= plan.expiresAt) {
      this.plans.delete(id)
      return { status: 'expired' }
    }
    if (plan.dir !== dir) return { status: 'other_model' }
    plan.running = true
    return { status: 'ok', plan }
  }

  /** A commit that wrote nothing and found the plan still sound (a lock held elsewhere, a file changed): it may run again. */
  release(plan: SettlePlan<I>): void {
    if (this.plans.get(plan.id) === plan) plan.running = false
  }

  /** A commit ran to an end: the plan is gone, and its id is kept with how it ended. */
  consume(plan: SettlePlan<I>, end: PlanEnd): void {
    if (this.plans.get(plan.id) !== plan) return
    this.plans.delete(plan.id)
    this.spent.set(plan.id, { until: plan.expiresAt, end })
  }

  get size(): number {
    return this.plans.size
  }

  clear(): void {
    this.plans.clear()
    this.spent.clear()
  }

  private sweep(): void {
    const t = this.time()
    // A plan whose commit is running is kept to its end, so the end is recorded.
    for (const [id, plan] of this.plans) if (t >= plan.expiresAt && !plan.running) this.plans.delete(id)
    for (const [id, spent] of this.spent) if (t >= spent.until) this.spent.delete(id)
  }
}
