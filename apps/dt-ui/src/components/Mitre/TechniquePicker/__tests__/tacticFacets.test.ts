import { describe, it, expect } from 'vitest'
import { tacticFacetsOf } from '../tacticFacets'

describe('tacticFacetsOf', () => {
  it('orders ATT&CK facets by matrix position, not by name or a built-in list', () => {
    const entries = [
      { tactic: 'Defense Impairment', tacticOrder: 7 },
      { tactic: 'Stealth', tacticOrder: 6 },
      { tactic: 'Credential Access', tacticOrder: 8 },
      { tactic: 'Stealth', tacticOrder: 6 },
    ]
    expect(tacticFacetsOf(entries, 'ATTACK_TECHNIQUE')).toEqual([
      { value: 'Stealth', count: 2 },
      { value: 'Defense Impairment', count: 1 },
      { value: 'Credential Access', count: 1 },
    ])
  })

  it('orders ATLAS facets by the ATLAS matrix; a tactic without a position goes last, by name', () => {
    const entries = [
      { tactic: 'Execution', tacticOrder: 5 },
      { tactic: 'Zeta', tacticOrder: null },
      { tactic: 'AI Model Access', tacticOrder: 4 },
      { tactic: 'Alpha' },
    ]
    expect(tacticFacetsOf(entries, 'ATLAS_TECHNIQUE').map(f => f.value)).toEqual(['AI Model Access', 'Execution', 'Alpha', 'Zeta'])
  })

  it('keeps D3FEND tactics in D3FEND order', () => {
    const entries = [{ tactic: 'Detect' }, { tactic: 'Harden' }, { tactic: 'Model' }]
    expect(tacticFacetsOf(entries, 'DEFEND_TECHNIQUE').map(f => f.value)).toEqual(['Model', 'Harden', 'Detect'])
  })

  it('has no facets for mitigations', () => {
    expect(tacticFacetsOf([{ tactic: 'x', tacticOrder: 1 }], 'ATTACK_MITIGATION')).toEqual([])
    expect(tacticFacetsOf([{ tactic: 'x', tacticOrder: 1 }], 'ATLAS_MITIGATION')).toEqual([])
  })
})
