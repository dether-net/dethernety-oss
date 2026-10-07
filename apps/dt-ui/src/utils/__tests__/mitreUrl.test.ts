import { describe, it, expect } from 'vitest'
import { mitreUrl } from '../mitreUrl'

describe('mitreUrl', () => {
  it.each([
    ['T1003', 'https://attack.mitre.org/techniques/T1003'],
    ['T1003.001', 'https://attack.mitre.org/techniques/T1003/001'],
    ['M1041', 'https://attack.mitre.org/mitigations/M1041'],
    ['AML.T0051', 'https://atlas.mitre.org/techniques/AML.T0051'],
    ['AML.T0051.000', 'https://atlas.mitre.org/techniques/AML.T0051.000'],
    ['AML.M0015', 'https://atlas.mitre.org/mitigations/AML.M0015'],
  ])('%s → %s', (id, url) => {
    expect(mitreUrl(id)).toBe(url)
  })

  it.each([['D3-PMAD'], ['TA0001'], ['AML.TA0000'], ['aml.t0051'], ['T1003.1'], [''], [null], [undefined]])(
    'returns null for %s',
    id => {
      expect(mitreUrl(id as string | null | undefined)).toBeNull()
    },
  )
})
