/**
 * User Timing entries for boot and module-load measurements (read them with
 * `performance.getEntriesByType('measure')`). Best effort: a timing call never
 * throws, so it can never change the control flow of the code it measures.
 */

export function timingMark (name: string): void {
  try {
    performance.mark(name)
  } catch {
    // timing is best effort
  }
}

/**
 * A measure from `start` (a mark name or a `performance.now()` value) to now.
 * `ok: false` marks a failed load, so it can be told apart from a fast one.
 */
export function timingMeasure (name: string, start: string | number, ok = true): void {
  try {
    performance.measure(name, { start, detail: { ok } })
  } catch {
    // timing is best effort
  }
}
