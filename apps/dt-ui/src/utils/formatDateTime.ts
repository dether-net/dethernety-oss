import type { DateInstance } from 'vuetify'

/** What a date cell shows when there is no date to show. */
export const NO_DATE = '—'

/** A date the adapter can read: an ISO string or a Date. Anything else counts as no date. */
function isDateLike(value: unknown): value is string | Date {
  return (typeof value === 'string' && value !== '') || value instanceof Date
}

/**
 * Format a date for display, or `NO_DATE` when there is none.
 *
 * Vuetify's `format` falls back to the current time for a value it cannot read (`''`, for one), so a missing date
 * would read as "now". Only a non-empty string or a Date is passed on, since `isValid` alone also accepts `null` (the
 * epoch) and numbers, which `date` cannot read; anything the adapter cannot parse also reads `NO_DATE`.
 */
export function formatDateTime(
  adapter: Pick<DateInstance, 'date' | 'isValid' | 'format'>,
  value: unknown,
  formatString = 'fullDateTime24h',
): string {
  if (!isDateLike(value) || !adapter.isValid(value)) return NO_DATE
  return adapter.format(adapter.date(value), formatString)
}

/**
 * A table sort key for a date: its epoch milliseconds, so dates compare in time order whatever their offset or
 * precision; `''` for a missing or unreadable date, which a data table sorts first.
 */
export function dateSortValue(value: unknown): number | '' {
  if (!isDateLike(value)) return ''
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(ms) ? '' : ms
}
