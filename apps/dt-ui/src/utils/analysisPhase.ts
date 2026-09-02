import type { Analysis, AnalysisStatus } from '@dethernety/dt-core'

/**
 * The five UI lifecycle phases an analysis row can be in. The phase — not the
 * raw backend status string — drives the Analysis Dialog's labels, icons, and
 * actions. This is the single source of truth for that mapping.
 */
export type AnalysisPhase = 'ready' | 'working' | 'paused' | 'done' | 'failed'

/**
 * Map an analysis status to its UI phase.
 *
 * `hasDocument` (a completed run produced a viewable result) is only consulted
 * when the run is idle, to tell a never-run analysis (ready) from a completed
 * one (done). Any unrecognised status falls through to that idle handling.
 */
export function phaseOf(status?: AnalysisStatus | null): AnalysisPhase {
  const s = status?.status
  if (s === 'interrupted') return 'paused'
  if (s === 'busy' || s === 'running') return 'working'
  if (s === 'error' || s === 'failed') return 'failed'
  return status?.hasDocument ? 'done' : 'ready'
}

/** Human-readable label for each phase, shown in the status column. */
export const PHASE_LABELS: Record<AnalysisPhase, string> = {
  ready: 'Ready',
  working: 'Working',
  paused: 'Paused',
  done: 'Done',
  failed: 'Failed',
}

/**
 * Vuetify colour for the status chip (empty string = default/neutral). Doubles
 * as the Paused row-highlight (warning) and the Failed accent (error).
 */
export const PHASE_COLOR: Record<AnalysisPhase, string> = {
  ready: '',
  working: 'info',
  paused: 'warning',
  done: 'success',
  failed: 'error',
}

/** The five forward actions a row's primary button can perform. */
export type PrimaryAction = 'run' | 'viewProgress' | 'answer' | 'viewResults' | 'retry'

export interface PhasePrimary {
  label: string
  icon: string
  action: PrimaryAction
  /** Mutating actions (Run/Retry) render filled and get optimistic on-click feedback;
   *  navigating actions (View/Answer) render as low-weight text buttons. */
  mutate: boolean
}

/**
 * Phase → primary button. The whole redesign keys off this map — a row presents
 * exactly one forward action, chosen by phase, never by analysis type.
 */
export const PHASE_PRIMARY: Record<AnalysisPhase, PhasePrimary> = {
  ready: { label: 'Run', icon: 'mdi-play', action: 'run', mutate: true },
  working: { label: 'View progress', icon: 'mdi-eye-outline', action: 'viewProgress', mutate: false },
  paused: { label: 'Answer', icon: 'mdi-forum-outline', action: 'answer', mutate: false },
  done: { label: 'View results', icon: 'mdi-arrow-right-bold', action: 'viewResults', mutate: false },
  failed: { label: 'Retry', icon: 'mdi-refresh', action: 'retry', mutate: true },
}

/** Delete is offered only when nothing is in flight (Ready/Done/Failed). */
export function phaseShowsDelete(phase: AnalysisPhase): boolean {
  return phase === 'ready' || phase === 'done' || phase === 'failed'
}

/** Re-run is an overflow action for analyses that have already run (Done/Failed). */
export function phaseShowsRerun(phase: AnalysisPhase): boolean {
  return phase === 'done' || phase === 'failed'
}

/** A run paused at a human-in-the-loop breakpoint badges its primary (a dot, not a count). */
export function phaseShowsBadge(phase: AnalysisPhase): boolean {
  return phase === 'paused'
}

/**
 * Best-effort human-readable failure reason for the Failed phase tooltip.
 *
 * Deliberately conservative about what it surfaces: it reads only a short
 * `metadata.error` string and never the raw `messages[]` stream. Agent/LLM
 * messages can contain stack traces, internal hostnames, or echoed prompt
 * fragments — those belong behind the authenticated run/results view, not in a
 * hover tooltip. Whatever it shows is collapsed to a single line and capped, so
 * a multi-line backend error can't spill into the UI. Always returns a string.
 */
export function errorReason(status?: AnalysisStatus | null): string {
  const fallback = 'Analysis failed. Retry, or check the logs for details.'
  const raw = (status?.metadata as { error?: unknown } | null | undefined)?.error
  if (typeof raw !== 'string' || !raw.trim()) return fallback

  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.length > 160 ? `${oneLine.slice(0, 159)}…` : oneLine
}

/**
 * Phases that earn the canvas rail's ambient badge, most urgent first.
 *
 * `paused` outranks the rest because it is the only phase blocking on the user —
 * a run has stopped at a human-in-the-loop interrupt and will not progress until
 * someone answers. `working` is informational, `failed` is already stale by the
 * time it lands. `ready` and `done` never badge: a dot that never clears stops
 * being read, and both are steady states the user can discover at their leisure.
 */
const BADGE_PRECEDENCE: AnalysisPhase[] = ['paused', 'working', 'failed']

/**
 * The single phase a set of analyses should badge with, or null for no badge.
 *
 * Takes statuses rather than analyses so it stays a pure phase computation; the
 * caller owns filtering the store's global list down to one model. Colour comes
 * from PHASE_COLOR, so the rail dot matches the status chip for the same phase.
 */
export function badgePhaseOf(statuses: Array<AnalysisStatus | null | undefined>): AnalysisPhase | null {
  const present = new Set(statuses.map(s => phaseOf(s)))
  return BADGE_PRECEDENCE.find(phase => present.has(phase)) ?? null
}

/**
 * The badge phase for one element's analyses, picked out of the analysis store's
 * shared global list.
 *
 * Joins on `element`, deliberately — NOT on `model`. The platform declares
 * `model: [Model!]!` on Analysis (a relationship list), and dt-core's
 * findAnalyses passes that array through untouched, deriving the single
 * `element` this reads from its first entry. So `analysis.model.id` is
 * `undefined` on every row and a join through it silently matches nothing.
 * The Analysis interface types `model` as a lone `Model`, so that wrong join
 * type-checks clean — which is exactly how it survived on the model dialog's
 * Analysis tab, where this badge previously (and permanently) failed to light.
 */
export function badgePhaseForElement(
  analyses: Analysis[],
  elementId: string | null,
): AnalysisPhase | null {
  if (!elementId) return null
  return badgePhaseOf(
    analyses.filter(analysis => analysis.element?.id === elementId).map(analysis => analysis.status),
  )
}
