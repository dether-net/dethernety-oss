/**
 * Cascade-delete state classifier for the operator-facing CascadeDeleteDialog.
 *
 * The server caps cascade deletes at CASCADE_CAP nodes — anything above is
 * rejected with a "manual cleanup required" error. Below the cap we still
 * escalate UX friction near the limit (slow + may be partially rolled back
 * under contention) by surfacing a 'near-cap' warning state.
 *
 * The thresholds are mirrored on the server (deleteOrphanedClass resolver),
 * but kept here as pure constants so the UI doesn't have to await a
 * round-trip to know which dialog state to render.
 */

export type CascadeState =
  | 'no-dependents'
  | 'has-dependents-under-cap'
  | 'has-dependents-near-cap'
  | 'has-dependents-over-cap'

export const CASCADE_CAP = 1000
export const NEAR_CAP_THRESHOLD = 800

export function cascadeState(count: number): CascadeState {
  if (count <= 0) return 'no-dependents'
  if (count > CASCADE_CAP) return 'has-dependents-over-cap'
  if (count >= NEAR_CAP_THRESHOLD) return 'has-dependents-near-cap'
  return 'has-dependents-under-cap'
}
