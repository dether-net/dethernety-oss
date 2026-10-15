import { describe, expect, it } from 'vitest'
import { suggestModelName } from '../modelNameUtils'

describe('suggestModelName', () => {
  it('keeps the archive name when the folder has no model of that name', () => {
    expect(suggestModelName('Payments', ['Billing', 'Payments v2'])).toBe('Payments')
  })

  it('gives the next free number when the name is taken, comparing trimmed and without case', () => {
    expect(suggestModelName('Payments', ['payments '])).toBe('Payments (2)')
    expect(suggestModelName('Payments', ['Payments', 'Payments (2)', 'Payments (3)'])).toBe('Payments (4)')
  })

  it('counts on from the base of a name that already carries a number', () => {
    expect(suggestModelName('Payments (2)', ['Payments', 'Payments (2)'])).toBe('Payments (3)')
  })

  it('trims the archive name', () => {
    expect(suggestModelName('  Payments  ', [])).toBe('Payments')
  })
})
