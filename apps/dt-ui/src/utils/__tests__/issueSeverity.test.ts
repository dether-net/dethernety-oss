import { describe, it, expect } from 'vitest'
import { severityOf, SEVERITY_COLOR, SEVERITY_ORDER } from '../issueSeverity'

describe('severityOf', () => {
  it('reads severity from the known syncedAttributes.attributes path', () => {
    expect(severityOf({ syncedAttributes: { attributes: { severity: 'critical' } } })).toBe('critical')
  })

  it('normalizes case', () => {
    expect(severityOf({ syncedAttributes: { attributes: { severity: 'HIGH' } } })).toBe('high')
  })

  it('reads severity alongside the detail-resolved _metadata sibling', () => {
    expect(
      severityOf({ syncedAttributes: { attributes: { severity: 'medium' }, _metadata: { synced: false } } }),
    ).toBe('medium')
  })

  it('returns null when severity is absent', () => {
    expect(severityOf({ syncedAttributes: { attributes: {} } })).toBeNull()
  })

  it('returns null for an unknown severity value', () => {
    expect(severityOf({ syncedAttributes: { attributes: { severity: 'bogus' } } })).toBeNull()
  })

  it('returns null when syncedAttributes is missing', () => {
    expect(severityOf({})).toBeNull()
  })

  it('returns null for a null/undefined issue', () => {
    expect(severityOf(null)).toBeNull()
    expect(severityOf(undefined)).toBeNull()
  })

  it('does NOT deep-walk an unrelated nested severity', () => {
    // severity only lives under a sibling, not at attributes.severity → no match.
    expect(severityOf({ syncedAttributes: { attributes: { nested: { severity: 'critical' } } } })).toBeNull()
  })
})

describe('SEVERITY_COLOR', () => {
  it('has a colour for every severity in SEVERITY_ORDER', () => {
    for (const sev of SEVERITY_ORDER) {
      expect(typeof SEVERITY_COLOR[sev]).toBe('string')
      expect(SEVERITY_COLOR[sev].length).toBeGreaterThan(0)
    }
  })
})

describe('SEVERITY_ORDER', () => {
  it('runs most- to least-severe (triage order)', () => {
    expect(SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low'])
  })
})
