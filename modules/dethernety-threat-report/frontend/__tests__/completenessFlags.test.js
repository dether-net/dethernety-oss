import { describe, it, expect } from 'vitest'
import { computeCompletenessFlags } from '../lib/completenessFlags.js'

const comp = (id, name, extra = {}) => ({ id, name, type: 'process', boundaryId: 'b1', crownJewel: false, ...extra })
const led = (id, findings = []) => ({ id, name: id, type: 'Component', findings, supportingControls: [] })
const finding = (id) => ({ id, name: id, score: 7, dispositionKind: null })

describe('computeCompletenessFlags — silent-green guards (§4.3)', () => {
  it('flags a crown jewel with NO modeled exposures (under-analyzed, not safe)', () => {
    const mg = {
      components: [comp('c1', 'Vault', { crownJewel: true }), comp('c2', 'Web')],
      dataNodes: [],
    }
    const ledger = [led('c2', [finding('e1')])] // c1 (crown jewel) has no ledger entry / no findings
    const flags = computeCompletenessFlags(mg, ledger)
    const f = flags.find((x) => x.key === 'under-analyzed-high-value')
    expect(f).toBeTruthy()
    expect(f.label).toMatch(/Vault/)
    expect(f.severity).toBe('warning')
  })

  it('does NOT flag a crown jewel that HAS exposures', () => {
    const mg = { components: [comp('c1', 'Vault', { crownJewel: true })], dataNodes: [] }
    const ledger = [led('c1', [finding('e1')])]
    expect(computeCompletenessFlags(mg, ledger).find((x) => x.key === 'under-analyzed-high-value')).toBeUndefined()
  })

  it('flags classified Data with no exposures; ignores unclassified Data', () => {
    const mg = {
      components: [],
      dataNodes: [
        { id: 'd1', name: 'PII', sensitivity: 'RESTRICTED', handledBy: ['c1'] },
        { id: 'd2', name: 'Logs', sensitivity: null, handledBy: ['c1'] },
      ],
    }
    const flags = computeCompletenessFlags(mg, [])
    const f = flags.find((x) => x.key === 'under-analyzed-high-value')
    expect(f.label).toMatch(/PII/)
    expect(f.label).not.toMatch(/Logs/) // unclassified data is not "high-value" here
  })

  it('flags orphan components (outside any boundary)', () => {
    const mg = {
      components: [comp('c1', 'A'), comp('c2', 'Orphan', { boundaryId: null })],
      dataNodes: [],
    }
    const f = computeCompletenessFlags(mg, []).find((x) => x.key === 'orphan-components')
    expect(f).toBeTruthy()
    expect(f.label).toMatch(/1 component/)
  })

  it('returns no flags for a fully-analyzed, well-placed model', () => {
    const mg = { components: [comp('c1', 'Web', { crownJewel: true })], dataNodes: [] }
    const ledger = [led('c1', [finding('e1')])]
    expect(computeCompletenessFlags(mg, ledger)).toEqual([])
  })

  it('is defensive against empty / missing input', () => {
    expect(computeCompletenessFlags(undefined, undefined)).toEqual([])
    expect(computeCompletenessFlags({}, [])).toEqual([])
  })
})
