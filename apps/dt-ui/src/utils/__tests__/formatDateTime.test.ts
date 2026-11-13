import { describe, it, expect, afterEach, vi } from 'vitest'
import { VuetifyDateAdapter } from 'vuetify/date/adapters/vuetify'
import { dateSortValue, formatDateTime, NO_DATE } from '../formatDateTime'

// The real adapter behind `useDate()`: its `format` falls back to the current time for a value it cannot read,
// which is what made an analysis created without a timestamp read "now".
const adapter = new VuetifyDateAdapter({ locale: 'en-US' })
const ISO = '2026-11-13T09:30:00.000Z'
const parsed = adapter.date(ISO) as Date

describe('formatDateTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats an ISO timestamp as the adapter does', () => {
    expect(formatDateTime(adapter, ISO)).toBe(adapter.format(parsed, 'fullDateTime24h'))
    expect(formatDateTime(adapter, ISO)).not.toBe(NO_DATE)
  })

  it('formats a Date, and passes the format through', () => {
    expect(formatDateTime(adapter, new Date(ISO), 'keyboardDate')).toBe(adapter.format(parsed, 'keyboardDate'))
  })

  it.each([[''], [null], [undefined], ['not a date'], [1731490200000], [new Date('nope')]])(
    'reads %p as "—", never the current time',
    (value) => {
      expect(formatDateTime(adapter, value)).toBe(NO_DATE)
    },
  )

  it("guards against Vuetify's format, which reads an empty value as now", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-02T03:04:05Z'))
    expect(adapter.format('' as unknown as Date, 'keyboardDate')).toBe(
      adapter.format(new Date('2030-01-02T03:04:05Z'), 'keyboardDate'),
    )
    expect(formatDateTime(adapter, '', 'keyboardDate')).toBe(NO_DATE)
  })
})

describe('dateSortValue', () => {
  it('returns epoch milliseconds, so offsets and precision sort in time order', () => {
    const utc = dateSortValue('2026-11-13T09:30:00Z')
    const offset = dateSortValue('2026-11-13T10:00:00+01:00') // 09:00 UTC: earlier, though it reads later
    const micro = dateSortValue('2026-11-13T09:30:00.000001Z')
    expect(utc).toBe(Date.parse('2026-11-13T09:30:00Z'))
    expect(offset).toBeLessThan(utc as number)
    expect(micro).toBeGreaterThanOrEqual(utc as number)
  })

  it('reads a Date', () => {
    expect(dateSortValue(new Date(ISO))).toBe(Date.parse(ISO))
  })

  it.each([[''], [null], [undefined], ['not a date'], [42]])("returns '' for %p", (value) => {
    expect(dateSortValue(value)).toBe('')
  })
})
