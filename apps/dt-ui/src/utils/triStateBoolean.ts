/**
 * A boolean attribute as three choices: Yes, No and Not answered. The pure half of TriStateBooleanRenderer.vue: what
 * a stored value shows, what a choice stores, and when the renderer applies.
 */
import { isBooleanControl, rankWith } from '@jsonforms/core'

/** Above the stock checkbox (rank 1) and toggle (rank 3) renderers: every boolean control answers in three states. */
export const triStateBooleanTester = rankWith(4, isBooleanControl)

export type TriState = 'yes' | 'no' | 'unanswered'

/** The choice a stored value shows: true is Yes, false is No, and anything else (absent, null) is Not answered. */
export function triStateOf (value: unknown): TriState {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return 'unanswered'
}

/** The value a choice stores; Not answered (or no choice) stores nothing. */
export function valueOfTriState (choice: unknown): boolean | undefined {
  if (choice === 'yes') return true
  if (choice === 'no') return false
  return undefined
}
