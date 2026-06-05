import { describe, it, expect } from 'vitest'
import { computePostureSummary } from '../lib/postureSummary.js'

// --- fixtures -------------------------------------------------------------
const live = (id, name, score, extra = {}) => ({
  id,
  name,
  score,
  attackVector: null,
  createdBy: 'USER',
  dispositionKind: null,
  dispositionStale: null,
  ...extra,
})
const disp = (id, name, score, kind, stale = false) => ({
  id,
  name,
  score,
  createdBy: 'USER',
  dispositionKind: kind,
  dispositionStale: stale,
})
const ctrl = (id) => ({ id, name: id, type: null, category: null })

const LEDGER = [
  // covered=false (no control): a high + an unknown-score live finding
  { id: 'c1', name: 'API', type: 'Component', findings: [live('e1', 'SQLi', 8), live('e2', 'Mystery', null)], supportingControls: [] },
  // a critical live + a stale risk-accepted disposition; HAS a control
  { id: 'c2', name: 'DB', type: 'Component', findings: [live('e3', 'RCE', 9.5), disp('e4', 'XSS', 7, 'RISK_ACCEPTED', true)], supportingControls: [ctrl('ctrlA')] },
  // finding-free with a control → defense-in-depth
  { id: 'c3', name: 'Cache', type: 'Component', findings: [], supportingControls: [ctrl('ctrlB')] },
  // finding-free boundary with a different control → defense-in-depth
  { id: 'b1', name: 'DMZ', type: 'SecurityBoundary', findings: [], supportingControls: [ctrl('ctrlC')] },
  // a Data node with a live medium
  { id: 'd1', name: 'PII', type: 'Data', findings: [live('e5', 'Leak', 5)], supportingControls: [] },
]

const CROSSINGS = { totals: { signalFlows: 2, crossingFlows: 3, membranes: 5, underModeledFlows: 1 } }

describe('computePostureSummary — live bands', () => {
  const s = computePostureSummary(LEDGER, { crossings: CROSSINGS })
  it('counts LIVE exposures by band, dispositioned excluded', () => {
    // critical: e3 ; high: e1 ; medium: e5 ; unknown: e2 ; low: 0
    // e4 (XSS, score 7 → high) is DISPOSITIONED so must NOT inflate high.
    expect(s.liveBands).toEqual({ critical: 1, high: 1, medium: 1, low: 0, unknown: 1 })
    expect(s.liveTotal).toBe(4)
  })
  it('null score ⇒ unknown, never low', () => {
    expect(s.liveBands.unknown).toBe(1)
    expect(s.liveBands.low).toBe(0)
  })
})

describe('computePostureSummary — disposition', () => {
  const s = computePostureSummary(LEDGER, { crossings: CROSSINGS })
  it('splits open vs reviewed and surfaces stale + kinds', () => {
    expect(s.disposition.open).toBe(4)
    expect(s.disposition.reviewed).toBe(1)
    expect(s.disposition.stale).toBe(1)
    expect(s.disposition.byKind).toEqual({ RISK_ACCEPTED: 1 })
  })
})

describe('computePostureSummary — defense-in-depth (never coverage)', () => {
  const s = computePostureSummary(LEDGER, { crossings: CROSSINGS })
  it('counts distinct controls on elements with NO live exposure', () => {
    // c3 (ctrlB) + b1 (ctrlC); c2 has a control but ALSO a live finding ⇒ excluded.
    expect(s.defenseInDepth).toEqual({ controlCount: 2, elementCount: 2 })
  })
})

describe('computePostureSummary — top residuals', () => {
  const s = computePostureSummary(LEDGER, { crossings: CROSSINGS })
  it('ranks live findings band desc, score desc; unknown sorts last', () => {
    expect(s.topResiduals.map((r) => r.findingId)).toEqual(['e3', 'e1', 'e5', 'e2'])
    expect(s.residualTotal).toBe(4)
  })
  it('carries the element link + the coarse uncovered proxy', () => {
    const byId = Object.fromEntries(s.topResiduals.map((r) => [r.findingId, r]))
    expect(byId.e1.elementId).toBe('c1')
    expect(byId.e1.uncovered).toBe(true) // c1 has no control
    expect(byId.e3.uncovered).toBe(false) // c2 has ctrlA
    expect(byId.e4).toBeUndefined() // dispositioned never a residual
  })
})

describe('computePostureSummary — boundary crossings passthrough', () => {
  it('reflects the reused computeCrossings totals', () => {
    const s = computePostureSummary(LEDGER, { crossings: CROSSINGS })
    expect(s.boundaryCrossings).toEqual({ signalFlows: 2, crossingFlows: 3, membranes: 5, underModeledFlows: 1 })
  })
  it('is null when no crossings result is supplied', () => {
    expect(computePostureSummary(LEDGER).boundaryCrossings).toBeNull()
  })
})

describe('computePostureSummary — hollow compensating-control claims', () => {
  it('counts elements whose disposition claims a compensating control with none present', () => {
    const ledger = [
      // COMPENSATING_CONTROL disposition + ZERO controls = a hollow claim
      { id: 'h1', name: 'H', type: 'Component', findings: [disp('e9', 'X', 7, 'COMPENSATING_CONTROL')], supportingControls: [] },
      // same disposition but a control IS present → not hollow
      { id: 'h2', name: 'H2', type: 'Component', findings: [disp('e10', 'Y', 7, 'COMPENSATING_CONTROL')], supportingControls: [ctrl('cc')] },
    ]
    expect(computePostureSummary(ledger).disposition.compensatingNoControl).toBe(1)
  })
  it('is 0 when there are no compensating-control dispositions', () => {
    expect(computePostureSummary(LEDGER, { crossings: CROSSINGS }).disposition.compensatingNoControl).toBe(0)
  })
})

describe('computePostureSummary — attackVector projection', () => {
  it('carries each top residual’s attack vector for in-app triage', () => {
    const ledger = [{ id: 'c', name: 'C', type: 'Component', findings: [live('e1', 'SQLi', 8, { attackVector: 'NETWORK' })], supportingControls: [] }]
    expect(computePostureSummary(ledger).topResiduals[0].attackVector).toBe('NETWORK')
  })
})

describe('computePostureSummary — honesty guards (no silent green)', () => {
  it('an empty model reports no elements / no findings, not a clean summary', () => {
    const s = computePostureSummary([])
    expect(s.hasElements).toBe(false)
    expect(s.hasAnyFindings).toBe(false)
    expect(s.hasLiveFindings).toBe(false)
    expect(s.liveTotal).toBe(0)
    expect(s.topResiduals).toEqual([])
    expect(s.defenseInDepth).toEqual({ controlCount: 0, elementCount: 0 })
  })
  it('a model with elements but zero findings is flagged hasElements && !hasAnyFindings', () => {
    const s = computePostureSummary([{ id: 'x', name: 'X', type: 'Component', findings: [], supportingControls: [] }])
    expect(s.hasElements).toBe(true)
    expect(s.hasAnyFindings).toBe(false)
  })
  it('does NOT emit any coverage/reachability fields (P1 absent, not dead)', () => {
    const s = computePostureSummary(LEDGER, { crossings: CROSSINGS })
    expect(s).not.toHaveProperty('coverage')
    expect(s).not.toHaveProperty('reachability')
    expect(s).not.toHaveProperty('crownJewelReachable')
    // The prohibition is a coverage % / "Covered: N" aggregate — NOT the
    // `uncovered` coarse proxy (which is spec-sanctioned). Match the forbidden
    // forms precisely so `uncovered` doesn't trip it.
    expect(JSON.stringify(s)).not.toMatch(/"covered"|coverage|%/i)
  })
})
