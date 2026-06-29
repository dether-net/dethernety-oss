import { describe, it, expect } from 'vitest'
import type { Zone } from '@dethernety/dt-core'
import type { EffectiveZone } from '../effectiveZone'
import type { Plane } from '@dethernety/dt-core'
import {
  ZONE_ORDER,
  ZONE_PILL_WORD,
  ZONE_LABEL,
  ZONE_COLOR,
  ZONE_HINT,
  zonePill,
  ROLE_ORDER,
  roleToPlanes,
  planesToRole,
} from '../zoneColor'

const ALL_ZONES: Zone[] = ['UNTRUSTED', 'PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED', 'VENDOR']

describe('zoneColor maps', () => {
  it('every map covers exactly the six zones with non-empty values', () => {
    for (const map of [ZONE_PILL_WORD, ZONE_LABEL, ZONE_COLOR]) {
      expect(Object.keys(map).sort()).toEqual([...ALL_ZONES].sort())
      for (const z of ALL_ZONES) expect(map[z]).toBeTruthy()
    }
    expect([...ZONE_ORDER].sort()).toEqual([...ALL_ZONES].sort())
  })

  it('palette reserves severity hues and uses no green (colourblind/word-always convention)', () => {
    for (const color of Object.values(ZONE_COLOR)) {
      expect(color).not.toMatch(/green|red|orange|amber/)
    }
  })
})

describe('zonePill', () => {
  const ez = (over: Partial<EffectiveZone>): EffectiveZone => ({ zone: 'PUBLIC', source: 'declared', ...over })

  it('returns null for a default fallback (no pill clutter on untouched boundaries)', () => {
    expect(zonePill(ez({ source: 'default' }))).toBeNull()
    expect(zonePill(null)).toBeNull()
    expect(zonePill(undefined)).toBeNull()
  })

  it('returns a solid pill (inherited:false) for a declared zone with the right word/color', () => {
    expect(zonePill(ez({ zone: 'RESTRICTED', source: 'declared' }))).toEqual({
      word: 'Restricted',
      color: 'teal-darken-4',
      inherited: false,
    })
  })

  it('marks an inherited zone for dimming', () => {
    expect(zonePill(ez({ zone: 'EXPOSED', source: 'inherited', from: 'p1' }))).toEqual({
      word: 'DMZ',
      color: 'indigo',
      inherited: true,
    })
  })
})

describe('ZONE_HINT', () => {
  it('covers exactly the six zones with non-empty hints', () => {
    expect(Object.keys(ZONE_HINT).sort()).toEqual([...ALL_ZONES].sort())
    for (const z of ALL_ZONES) expect(ZONE_HINT[z]).toBeTruthy()
  })
})

describe('Role ↔ planes mapping', () => {
  it('covers the four role states', () => {
    expect([...ROLE_ORDER].sort()).toEqual(['BOTH', 'MANAGEMENT', 'UNDECIDED', 'WORKLOAD'])
  })

  it('roleToPlanes maps each role to its canonical planes array', () => {
    expect(roleToPlanes('UNDECIDED')).toEqual([])
    expect(roleToPlanes('WORKLOAD')).toEqual(['WORKLOAD'])
    expect(roleToPlanes('MANAGEMENT')).toEqual(['MANAGEMENT'])
    expect(roleToPlanes('BOTH')).toEqual(['WORKLOAD', 'MANAGEMENT'])
  })

  it('planesToRole is the inverse and order-insensitive', () => {
    expect(planesToRole([])).toBe('UNDECIDED')
    expect(planesToRole(null)).toBe('UNDECIDED')
    expect(planesToRole(undefined)).toBe('UNDECIDED')
    expect(planesToRole(['WORKLOAD'])).toBe('WORKLOAD')
    expect(planesToRole(['MANAGEMENT'])).toBe('MANAGEMENT')
    expect(planesToRole(['WORKLOAD', 'MANAGEMENT'])).toBe('BOTH')
    expect(planesToRole(['MANAGEMENT', 'WORKLOAD'] as Plane[])).toBe('BOTH')
  })

  it('round-trips every role through planes and back', () => {
    for (const r of ROLE_ORDER) expect(planesToRole(roleToPlanes(r))).toBe(r)
  })
})
