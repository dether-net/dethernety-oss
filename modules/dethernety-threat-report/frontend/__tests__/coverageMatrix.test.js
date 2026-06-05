// coverageMatrix.test.js — the coverage presentation/honesty lib.
import { describe, it, expect } from 'vitest'
import { buildCoverageView, buildExposureTechniqueIndex, coverageSummaryLines, filterByTier } from '../lib/coverageMatrix.js'

// --- fixture builders -------------------------------------------------------
const tier = (t, fn, cms = ['cm1'], controls = ['k1']) => ({
  tier: t, function: fn, countermeasureIds: cms, controlIds: controls,
})
const exposure = (over = {}) => ({
  exposureId: 'e1', elementId: 'c1', elementKind: 'Component', soft: false, techniques: [], ...over,
})
const technique = (id, tactics = ['Initial Access'], tiers = []) => ({ techniqueId: id, tactics, covered: tiers.length > 0, tiers })
const coverage = (exposures, over = {}) => ({ modelId: 'm', generatedAt: '2026-06-04T00:00:00Z', exposures, meta: {}, ...over })
const ledgerEl = (over = {}) => ({ id: 'c1', name: 'C1', type: 'Component', findings: [], supportingControls: [], ...over })

describe('buildCoverageView — availability', () => {
  it('coverage null ⇒ available:false (render no-coverage affordance, not an empty grid)', () => {
    expect(buildCoverageView(null, []).available).toBe(false)
    expect(buildCoverageView(undefined, []).available).toBe(false)
  })
  it('coverage present ⇒ available:true', () => {
    expect(buildCoverageView(coverage([]), []).available).toBe(true)
  })
})

describe('buildCoverageView — live-only disposition filter', () => {
  const cov = coverage([
    exposure({ exposureId: 'live1', techniques: [technique('T1190', ['Initial Access'], [tier('DIRECT', 'PREVENT')])] }),
    exposure({ exposureId: 'disp1', techniques: [technique('T1059', ['Execution'], [tier('DIRECT', 'PREVENT')])] }),
  ])
  const ledger = [ledgerEl({
    findings: [
      { id: 'live1', dispositionKind: null },
      { id: 'disp1', dispositionKind: 'RISK_ACCEPTED' },
    ],
  })]
  it('excludes dispositioned exposures from the grid but COUNTS them (never silently dropped)', () => {
    const v = buildCoverageView(cov, ledger)
    expect(v.rows.map((r) => r.techniqueId)).toEqual(['T1190']) // T1059 (disposed) excluded
    expect(v.offGrid.dispositionedExcluded).toBe(1)
  })
  it('an exposure absent from the snapshot ledger defaults to live (staleness banner owns drift)', () => {
    const v = buildCoverageView(cov, []) // empty ledger
    expect(v.rows.map((r) => r.techniqueId).sort()).toEqual(['T1059', 'T1190'])
  })
})

describe('buildCoverageView — element-scope routing', () => {
  it('Data exposures are off-grid; ATT&CK-mapped Data counted for the completeness banner', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'd1', elementId: 'data1', elementKind: 'Data', techniques: [technique('T1530')] }),
    ]), [{ id: 'data1', type: 'Data', findings: [{ id: 'd1', dispositionKind: null }], supportingControls: [] }])
    expect(v.rows).toEqual([])
    expect(v.offGrid.dataMappedCount).toBe(1)
  })
  it('Data → ATT&CK mapping is disclosed off-grid: one drillable entry per Data element, techniques resolved + deduped + id-sorted', () => {
    const v = buildCoverageView(coverage([
      // two exposures on ONE Data element → grouped, techniques unioned + deduped
      exposure({ exposureId: 'd1', elementId: 'data1', elementKind: 'Data', techniques: [technique('T1213'), technique('T1530')] }),
      exposure({ exposureId: 'd2', elementId: 'data1', elementKind: 'Data', techniques: [technique('T1530')] }),
      exposure({ exposureId: 'd3', elementId: 'data2', elementKind: 'Data', techniques: [technique('T1005')] }),
    ], { techniques: { T1530: { name: 'Data from Cloud Storage', description: 'd-1530' }, T1213: { name: 'Data from Info Repos', description: 'd' }, T1005: { name: 'Data from Local System', description: 'd' } } }), [
      { id: 'data1', name: 'PII store', type: 'Data', findings: [{ id: 'd1', dispositionKind: null }, { id: 'd2', dispositionKind: null }], supportingControls: [] },
      { id: 'data2', name: 'Card data', type: 'Data', findings: [{ id: 'd3', dispositionKind: null }], supportingControls: [] },
    ])
    expect(v.offGrid.dataMappedCount).toBe(3) // exposure count unchanged
    // …but the disclosure groups per element (sorted by name): Card data, then PII store
    expect(v.offGrid.dataMapped.map((d) => [d.elementId, d.elementName])).toEqual([
      ['data2', 'Card data'],
      ['data1', 'PII store'],
    ])
    const pii = v.offGrid.dataMapped.find((d) => d.elementId === 'data1')
    expect(pii.techniques.map((t) => t.techniqueId)).toEqual(['T1213', 'T1530']) // unioned, deduped, id-sorted
    expect(pii.techniques.find((t) => t.techniqueId === 'T1530')).toMatchObject({ name: 'Data from Cloud Storage', tactics: ['Initial Access'] })
  })
  it('a dispositioned Data exposure does not enter the off-grid disclosure (live-only, like the grid)', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'd1', elementId: 'data1', elementKind: 'Data', techniques: [technique('T1530')] }),
    ]), [{ id: 'data1', name: 'PII', type: 'Data', findings: [{ id: 'd1', dispositionKind: 'RISK_ACCEPTED' }], supportingControls: [] }])
    expect(v.offGrid.dataMappedCount).toBe(0)
    expect(v.offGrid.dataMapped).toEqual([])
    expect(v.offGrid.dispositionedExcluded).toBe(1)
  })
  it('SecurityBoundary exposures fold into Posture Summary counts but get no matrix row', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'b1', elementId: 'bnd1', elementKind: 'SecurityBoundary',
        techniques: [technique('T1190', ['Initial Access'], [tier('INDIRECT_MITIGATION', 'PREVENT')])] }),
    ]), [{ id: 'bnd1', type: 'SecurityBoundary', findings: [{ id: 'b1', dispositionKind: null }], supportingControls: [] }])
    expect(v.rows).toEqual([]) // no boundary row
    expect(v.summary.mitigation).toBe(1) // but counted in the Posture Summary
  })
})

describe('buildCoverageView — detect-only reduction + best tier', () => {
  it('PREVENT at any tier ⇒ PREVENT', () => {
    const v = buildCoverageView(coverage([
      exposure({ techniques: [technique('T1', ['Execution'], [tier('INDIRECT_D3FEND', 'DETECT'), tier('INDIRECT_MITIGATION', 'PREVENT')])] }),
    ]), [ledgerEl({ findings: [{ id: 'e1', dispositionKind: null }] })])
    const row = v.rows[0]
    expect(row.status).toBe('PREVENT')
    expect(row.bestTier).toBe('INDIRECT_MITIGATION') // best of {D3FEND, Mitigation}
  })
  it('only detective edges (no prevent anywhere) ⇒ DETECT_ONLY', () => {
    const v = buildCoverageView(coverage([
      exposure({ techniques: [technique('T1', ['Execution'], [tier('INDIRECT_D3FEND', 'DETECT')])] }),
    ]), [ledgerEl({ findings: [{ id: 'e1', dispositionKind: null }] })])
    expect(v.rows[0].status).toBe('DETECT_ONLY')
    expect(v.summary.detectOnly).toBe(1)
  })
  it('no covering edge ⇒ UNCOVERED', () => {
    const v = buildCoverageView(coverage([
      exposure({ techniques: [technique('T1', ['Execution'], [])] }),
    ]), [ledgerEl({ findings: [{ id: 'e1', dispositionKind: null }] })])
    expect(v.rows[0].status).toBe('UNCOVERED')
    expect(v.summary.uncovered).toBe(1)
  })
  it('a covered pair never returns the impossible covered+UNCOVERED state (unknown function ⇒ detect-only, never over-claims prevent)', () => {
    // a future/foreign function value must default to detect-only (seen-not-stopped),
    // never silently fall out of every Posture Summary bucket.
    const v = buildCoverageView(coverage([
      exposure({ techniques: [technique('T1', ['Execution'], [{ tier: 'INDIRECT_D3FEND', function: 'RESPOND', countermeasureIds: ['c'], controlIds: ['k'] }])] }),
    ]), [ledgerEl({ findings: [{ id: 'e1', dispositionKind: null }] })])
    expect(v.rows[0].covered).toBe(true)
    expect(v.rows[0].status).toBe('DETECT_ONLY')
    expect(v.summary.detectOnly).toBe(1)
    expect(v.summary.uncovered).toBe(0) // not silently dropped, not double-counted
  })
})

describe('buildCoverageView — residual element breakdown (cell title)', () => {
  it('aggregates a technique across elements: covered for X of Y', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'e1', elementId: 'c1', techniques: [technique('T1190', ['Initial Access'], [tier('DIRECT', 'PREVENT')])] }),
      exposure({ exposureId: 'e2', elementId: 'c2', techniques: [technique('T1190', ['Initial Access'], [])] }),
    ]), [
      ledgerEl({ id: 'c1', findings: [{ id: 'e1', dispositionKind: null }] }),
      ledgerEl({ id: 'c2', findings: [{ id: 'e2', dispositionKind: null }] }),
    ])
    const row = v.rows.find((r) => r.techniqueId === 'T1190')
    expect(row.elementsTotal).toBe(2)
    expect(row.elementsCovered).toBe(1)
  })
  it('names each impacted element with its covered status (gaps first), each a drill target', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'e1', elementId: 'c1', techniques: [technique('T1190', ['Initial Access'], [tier('DIRECT', 'PREVENT')])] }),
      exposure({ exposureId: 'e2', elementId: 'c2', techniques: [technique('T1190', ['Initial Access'], [])] }),
    ]), [
      ledgerEl({ id: 'c1', name: 'API Gateway', findings: [{ id: 'e1', dispositionKind: null }] }),
      ledgerEl({ id: 'c2', name: 'Redis', findings: [{ id: 'e2', dispositionKind: null }] }),
    ])
    const row = v.rows.find((r) => r.techniqueId === 'T1190')
    // uncovered (Redis) leads; covered (API Gateway) follows; names resolved from the ledger
    expect(row.elements).toEqual([
      { id: 'c2', name: 'Redis', covered: false },
      { id: 'c1', name: 'API Gateway', covered: true },
    ])
  })
})

describe('buildCoverageView — tactic columns', () => {
  it('columns are the reached tactics in canonical ATT&CK order; a technique fills multiple', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'e1', techniques: [technique('T1078', ['Persistence', 'Initial Access'], [tier('DIRECT', 'PREVENT')])] }),
      exposure({ exposureId: 'e2', elementId: 'c2', techniques: [technique('T1071', ['Command and Control'], [])] }),
    ]), [
      ledgerEl({ id: 'c1', findings: [{ id: 'e1', dispositionKind: null }] }),
      ledgerEl({ id: 'c2', findings: [{ id: 'e2', dispositionKind: null }] }),
    ])
    expect(v.tactics).toEqual(['Initial Access', 'Persistence', 'Command and Control']) // canonical order
    expect(v.rows.find((r) => r.techniqueId === 'T1078').tactics).toEqual(['Initial Access', 'Persistence'])
  })
})

describe('buildCoverageView — soft / structural / defense-in-depth honesty', () => {
  it('live soft exposures counted off-grid, never a row', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 's1', soft: true, techniques: [] }),
    ]), [ledgerEl({ findings: [{ id: 's1', dispositionKind: null }] })])
    expect(v.rows).toEqual([])
    expect(v.offGrid.softCount).toBe(1)
    expect(v.summary.soft).toBe(1)
  })
  it('an element CLASS with zero supporting controls model-wide is ONE structural line, not N cells', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'e1', elementId: 'df1', elementKind: 'DataFlow',
        techniques: [technique('T1', ['Execution'], []), technique('T2', ['Impact'], [])] }),
    ]), [
      { id: 'df1', type: 'DataFlow', findings: [{ id: 'e1', dispositionKind: null }], supportingControls: [] },
      { id: 'c1', type: 'Component', findings: [], supportingControls: [{ id: 'k1' }] },
    ])
    expect(v.structuralGaps).toContain('DataFlow') // DataFlow class has no supporting control anywhere
    expect(v.structuralGaps).not.toContain('Component')
  })
  it('defense-in-depth = supporting controls covering nothing, on its own count', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'e1', elementId: 'c1',
        techniques: [technique('T1', ['Execution'], [tier('DIRECT', 'PREVENT', ['cm1'], ['kCover'])])] }),
    ]), [ledgerEl({ id: 'c1', findings: [{ id: 'e1', dispositionKind: null }], supportingControls: [{ id: 'kCover' }, { id: 'kIdle' }] })])
    expect(v.summary.defenseInDepth).toBe(1) // kIdle supports but covers nothing
  })
})

describe('buildCoverageView — Residual Risk configured-mismatch', () => {
  it('a control supporting an element but covering none of its gaps is mismatched', () => {
    const v = buildCoverageView(coverage([
      exposure({ exposureId: 'e1', elementId: 'c1',
        techniques: [technique('T1', ['Execution'], [tier('DIRECT', 'PREVENT', ['cm1'], ['kCover'])])] }),
    ]), [ledgerEl({ id: 'c1', findings: [{ id: 'e1', dispositionKind: null }], supportingControls: [{ id: 'kCover' }, { id: 'kMismatch' }] })])
    expect(v.mismatchByElement.c1).toEqual(['kMismatch'])
  })
})

describe('filterByTier — the Tier control partitions rows (parts sum to "all")', () => {
  const rows = [
    { techniqueId: 'T1', covered: true, bestTier: 'DIRECT' },
    { techniqueId: 'T2', covered: true, bestTier: 'DIRECT' },
    { techniqueId: 'T3', covered: true, bestTier: 'INDIRECT_MITIGATION' },
    { techniqueId: 'T4', covered: true, bestTier: 'INDIRECT_D3FEND' },
    { techniqueId: 'T5', covered: false, bestTier: null },
    { techniqueId: 'T6', covered: false, bestTier: null },
    { techniqueId: 'T7', covered: false, bestTier: null },
  ]
  it("'all' returns every row", () => {
    expect(filterByTier(rows, 'all')).toHaveLength(7)
  })
  it('each tier option selects only its best-tier rows; uncovered selects the rest', () => {
    expect(filterByTier(rows, 'DIRECT').map((r) => r.techniqueId)).toEqual(['T1', 'T2'])
    expect(filterByTier(rows, 'INDIRECT_MITIGATION').map((r) => r.techniqueId)).toEqual(['T3'])
    expect(filterByTier(rows, 'INDIRECT_D3FEND').map((r) => r.techniqueId)).toEqual(['T4'])
    expect(filterByTier(rows, 'UNCOVERED').map((r) => r.techniqueId)).toEqual(['T5', 'T6', 'T7'])
  })
  it('the four parts sum to "all" with no overlap and no orphan (the reported bug)', () => {
    const parts = ['DIRECT', 'INDIRECT_MITIGATION', 'INDIRECT_D3FEND', 'UNCOVERED']
      .flatMap((t) => filterByTier(rows, t).map((r) => r.techniqueId))
    expect(parts.length).toBe(filterByTier(rows, 'all').length) // 7 = 7, not 4 ≪ 7
    expect(new Set(parts).size).toBe(parts.length) // no row counted twice
  })
})

describe('coverage view — no percentage / no rollup (honesty lint)', () => {
  it('the view-model carries no percentage and no single "covered" aggregate', () => {
    const v = buildCoverageView(coverage([
      exposure({ techniques: [technique('T1', ['Execution'], [tier('DIRECT', 'PREVENT')])] }),
    ]), [ledgerEl({ findings: [{ id: 'e1', dispositionKind: null }] })])
    const json = JSON.stringify(v)
    expect(json).not.toMatch(/coveragePct|percent|"covered"\s*:\s*\d/i)
  })
  it('coverageSummaryLines is tier-segregated with D3FEND flagged broad/inferred', () => {
    const lines = coverageSummaryLines({ directPrevent: 3, directDetect: 1, mitigation: 5, d3fend: 6, detectOnly: 2, uncovered: 4, soft: 3 })
    const d3 = lines.find((l) => l.key === 'd3fend')
    expect(d3.note).toBe('broad/inferred')
    expect(lines.some((l) => /covered:\s*\d/i.test(l.label))).toBe(false)
  })
})

describe('buildExposureTechniqueIndex — per-exposure technique chips', () => {
  it('coverage null/unavailable ⇒ {} (chips simply do not render, never a false "no techniques")', () => {
    expect(buildExposureTechniqueIndex(null)).toEqual({})
    expect(buildExposureTechniqueIndex(undefined)).toEqual({})
    expect(buildExposureTechniqueIndex({})).toEqual({})
  })

  it('resolves each exposure to its techniques with name + tactics + description', () => {
    const cov = coverage(
      [exposure({ exposureId: 'x1', techniques: [technique('T1190', ['Initial Access'])] })],
      { techniques: { T1190: { name: 'Exploit Public-Facing Application', description: 'desc-1190' } } },
    )
    const idx = buildExposureTechniqueIndex(cov)
    expect(idx.x1).toEqual([
      { techniqueId: 'T1190', name: 'Exploit Public-Facing Application', tactics: ['Initial Access'], description: 'desc-1190' },
    ])
  })

  it('is disposition-AGNOSTIC — a dispositioned exposure still gets its techniques (a mapping is a fact about the exposure)', () => {
    // No ledger is consulted at all; the index is built purely from coverage.exposures.
    const cov = coverage([exposure({ exposureId: 'disp1', techniques: [technique('T1059')] })],
      { techniques: { T1059: { name: 'Command and Scripting Interpreter', description: 'd' } } })
    expect(buildExposureTechniqueIndex(cov).disp1).toHaveLength(1)
  })

  it('sorts techniques by id and dedupes a repeated technique on one exposure', () => {
    const cov = coverage([
      exposure({ exposureId: 'm1', techniques: [technique('T1110'), technique('T1078'), technique('T1078')] }),
    ], { techniques: { T1078: { name: 'Valid Accounts', description: 'a' }, T1110: { name: 'Brute Force', description: 'b' } } })
    expect(buildExposureTechniqueIndex(cov).m1.map((t) => t.techniqueId)).toEqual(['T1078', 'T1110'])
  })

  it('soft / unmapped exposures yield NO entry (additive — no key, not an empty array)', () => {
    const cov = coverage([
      exposure({ exposureId: 'soft1', soft: true, techniques: [] }),
      exposure({ exposureId: 'none1', techniques: [] }),
    ])
    const idx = buildExposureTechniqueIndex(cov)
    expect(idx.soft1).toBeUndefined()
    expect(idx.none1).toBeUndefined()
  })

  it('missing technique-dict entry ⇒ name/description null (id + tactics still usable)', () => {
    const cov = coverage([exposure({ exposureId: 'x1', techniques: [technique('T9999', ['Impact'])] })], { techniques: {} })
    expect(buildExposureTechniqueIndex(cov).x1[0]).toEqual({ techniqueId: 'T9999', name: null, tactics: ['Impact'], description: null })
  })
})
