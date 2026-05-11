import { describe, it, expect } from 'vitest'
import {
  cascadeState,
  CASCADE_CAP,
  NEAR_CAP_THRESHOLD
} from '../cascadeState'

describe('cascadeState', () => {
  it('returns no-dependents for 0 or negative counts', () => {
    expect(cascadeState(0)).toBe('no-dependents')
    expect(cascadeState(-1)).toBe('no-dependents')
  })

  it('returns under-cap for 1..(NEAR_CAP_THRESHOLD - 1)', () => {
    expect(cascadeState(1)).toBe('has-dependents-under-cap')
    expect(cascadeState(NEAR_CAP_THRESHOLD - 1)).toBe('has-dependents-under-cap')
  })

  it('returns near-cap at NEAR_CAP_THRESHOLD inclusive through CASCADE_CAP inclusive', () => {
    expect(cascadeState(NEAR_CAP_THRESHOLD)).toBe('has-dependents-near-cap')
    expect(cascadeState(CASCADE_CAP)).toBe('has-dependents-near-cap')
  })

  it('returns over-cap above CASCADE_CAP', () => {
    expect(cascadeState(CASCADE_CAP + 1)).toBe('has-dependents-over-cap')
    expect(cascadeState(50_000)).toBe('has-dependents-over-cap')
  })
})
