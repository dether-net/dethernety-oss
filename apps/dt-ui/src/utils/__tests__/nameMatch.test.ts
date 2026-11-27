import { describe, it, expect } from 'vitest'
import { normalise, rankName } from '../nameMatch'

describe('normalise', () => {
  it('drops accents, folds case and collapses whitespace', () => {
    expect(normalise('  Café   ORDERS ')).toBe('cafe orders')
    expect(normalise('Ångström')).toBe('angstrom')
  })
})

describe('rankName', () => {
  it('ranks the whole name, then its start, then a word\'s start, then anywhere', () => {
    expect(rankName('api', 'api')).toBe(0)
    expect(rankName('api gateway', 'api')).toBe(1)
    expect(rankName('payment api', 'api')).toBe(2)
    expect(rankName('pay-api', 'api')).toBe(2)
    expect(rankName('rapid', 'api')).toBe(3)
    expect(rankName('web', 'api')).toBeNull()
  })

  it('takes the best place when the query occurs twice', () => {
    expect(rankName('rapid api', 'api')).toBe(2)
  })
})
