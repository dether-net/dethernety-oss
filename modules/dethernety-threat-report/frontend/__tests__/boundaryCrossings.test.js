import { describe, it, expect } from 'vitest'
import {
  computeCrossings,
  maxSensitivity,
  sensitivityLabel,
  dataItemSensitivity,
} from '../lib/boundaryCrossings.js'

describe('dataItemSensitivity — per-item chip (existing item ⇒ unclassified, not unknown)', () => {
  it('null/undefined ⇒ unclassified gap (amber), never "unknown"', () => {
    expect(dataItemSensitivity(null)).toEqual({ label: 'unclassified', key: 'unclassified' })
    expect(dataItemSensitivity(undefined)).toEqual({ label: 'unclassified', key: 'unclassified' })
  })
  it('a known level ⇒ its label + lowercased key', () => {
    expect(dataItemSensitivity('RESTRICTED')).toEqual({ label: 'Restricted', key: 'restricted' })
    expect(dataItemSensitivity('PUBLIC')).toEqual({ label: 'Public', key: 'public' })
  })
})

// --- fixtures -------------------------------------------------------------
// Nesting:  Outer ⊃ DMZ ⊃ Inner ; Outer ⊃ Left ; Outer ⊃ Right ; Cyc1 ⇄ Cyc2.
const MG = {
  boundaries: [
    { id: 'outer', name: 'Outer', parentBoundaryId: null, positionX: 0, positionY: 0, width: 800, height: 600 },
    { id: 'dmz', name: 'DMZ', parentBoundaryId: 'outer', positionX: 20, positionY: 20, width: 400, height: 300 },
    { id: 'inner', name: 'Inner', parentBoundaryId: 'dmz', positionX: 10, positionY: 10, width: 150, height: 100 },
    { id: 'left', name: 'Left', parentBoundaryId: 'outer', positionX: 450, positionY: 20, width: 150, height: 100 },
    { id: 'right', name: 'Right', parentBoundaryId: 'outer', positionX: 620, positionY: 20, width: 150, height: 100 },
    { id: 'cyc1', name: 'Cyc1', parentBoundaryId: 'cyc2' }, // malformed: mutual parent
    { id: 'cyc2', name: 'Cyc2', parentBoundaryId: 'cyc1' },
  ],
  components: [
    { id: 'A', name: 'A', boundaryId: 'inner', type: 'process', crownJewel: false },
    { id: 'D', name: 'D', boundaryId: 'inner', type: 'process' },
    { id: 'B', name: 'B', boundaryId: 'dmz', type: 'store' },
    { id: 'C', name: 'C', boundaryId: 'outer', type: 'external_entity' },
    { id: 'L', name: 'L', boundaryId: 'left', type: 'process' },
    { id: 'R', name: 'R', boundaryId: 'right', type: 'process' },
    { id: 'O', name: 'O', boundaryId: null, type: 'external_entity' }, // orphan
    { id: 'O2', name: 'O2', boundaryId: null, type: 'external_entity' }, // orphan
    { id: 'CY', name: 'CY', boundaryId: 'cyc1', type: 'process' },
  ],
  flows: [
    { id: 'f_same', name: 'same', sourceId: 'A', targetId: 'D', sensitivities: [], dataItemCount: 0 },
    { id: 'f_exit_inner', name: 'exit', sourceId: 'A', targetId: 'B', sensitivities: [], dataItemCount: 0 },
    { id: 'f_enter_inner', name: 'enter', sourceId: 'B', targetId: 'A', sensitivities: [], dataItemCount: 0 },
    { id: 'f_orphan_in', name: 'orphan-in', sourceId: 'O', targetId: 'A', sensitivities: [], dataItemCount: 0 },
    { id: 'f_sibling', name: 'sibling', sourceId: 'L', targetId: 'R', sensitivities: [], dataItemCount: 0 },
    { id: 'f_restricted', name: 'restricted', sourceId: 'C', targetId: 'B', sensitivities: ['INTERNAL', 'RESTRICTED'], dataItemCount: 2 },
    { id: 'f_unclassified', name: 'unclassified', sourceId: 'O2', targetId: 'C', sensitivities: [], dataItemCount: 2 },
    { id: 'f_cycle', name: 'cycle', sourceId: 'CY', targetId: 'C', sensitivities: [], dataItemCount: 0 },
    { id: 'f_orphan_orphan', name: 'oo', sourceId: 'O', targetId: 'O2', sensitivities: [], dataItemCount: 0 },
  ],
}

// Raw ledger: Inner boundary has a live exposure (weakening);
// Right boundary is finding-FREE but has a supporting control (hardening) —
// proves the engine reads controls from the raw ledger even with no findings.
const LEDGER = [
  { id: 'inner', name: 'Inner', type: 'SecurityBoundary', findings: [{ id: 'ex1', name: 'weak seg', score: 8, dispositionKind: null }], supportingControls: [] },
  { id: 'right', name: 'Right', type: 'SecurityBoundary', findings: [], supportingControls: [{ id: 'c1', name: 'WAF', type: null, category: null }] },
]

const allGroups = (r) => [...r.crossings, ...r.underModeled]
const groupFor = (r, flowId) => allGroups(r).find((g) => g.flowId === flowId)
const seq = (g) => (g ? g.membranes.map((m) => `${m.direction}:${m.boundaryId}`) : null)

// --- sensitivity helpers --------------------------------------------------
describe('sensitivity helpers', () => {
  it('maxSensitivity picks the highest rank; null when none known', () => {
    expect(maxSensitivity(['INTERNAL', 'RESTRICTED', 'PUBLIC'])).toBe('RESTRICTED')
    expect(maxSensitivity(['PUBLIC', 'CONFIDENTIAL'])).toBe('CONFIDENTIAL')
    expect(maxSensitivity([])).toBe(null)
    expect(maxSensitivity(undefined)).toBe(null)
  })
  it('null sensitivity renders as "unknown", never "low"', () => {
    expect(sensitivityLabel(null)).toBe('unknown')
    expect(sensitivityLabel('RESTRICTED')).toBe('Restricted')
  })
})

// --- symmetric difference + ordering -------------------------------------
describe('crossing detection — symmetric difference + EXIT/ENTER ordering', () => {
  const r = computeCrossings(MG, LEDGER)

  it('same-boundary flow produces no crossing', () => {
    expect(groupFor(r, 'f_same')).toBeUndefined()
  })

  it('child→ancestor EXITs the inner membrane only', () => {
    expect(seq(groupFor(r, 'f_exit_inner'))).toEqual(['EXIT:inner'])
  })

  it('ancestor→child ENTERs the inner membrane only', () => {
    expect(seq(groupFor(r, 'f_enter_inner'))).toEqual(['ENTER:inner'])
  })

  it('orphan→deeply-nested ENTERs outermost-first, preserving operational order', () => {
    // containment traversal: enter Outer, then DMZ, then Inner
    expect(seq(groupFor(r, 'f_orphan_in'))).toEqual(['ENTER:outer', 'ENTER:dmz', 'ENTER:inner'])
  })

  it('sibling→sibling EXITs source-inner then ENTERs target-inner', () => {
    expect(seq(groupFor(r, 'f_sibling'))).toEqual(['EXIT:left', 'ENTER:right'])
  })

  it('orphan→orphan produces no crossing (both normalize to {Root})', () => {
    expect(groupFor(r, 'f_orphan_orphan')).toBeUndefined()
  })

  it('never emits the synthetic root as a membrane', () => {
    expect(allGroups(r).some((g) => g.membranes.some((m) => m.boundaryId === '__ROOT__'))).toBe(false)
  })

  it('only flows that actually cross count as crossing flows', () => {
    // 7 of 9: f_same and f_orphan_orphan do not cross.
    expect(r.totals.crossingFlows).toBe(7)
  })
})

// --- posture join + signal partition -------------------------------------
describe('posture join + signal-bearing partition', () => {
  const r = computeCrossings(MG, LEDGER)

  it('a flow crossing a boundary with a live exposure is in the worklist', () => {
    const g = r.crossings.find((x) => x.flowId === 'f_exit_inner')
    expect(g).toBeTruthy()
    expect(g.membranes[0].boundaryLiveCount).toBe(1)
    expect(g.membranes[0].signal).toBe(true)
  })

  it('reads a control on a FINDING-FREE crossed boundary (from raw ledger)', () => {
    const g = r.crossings.find((x) => x.flowId === 'f_sibling')
    const right = g.membranes.find((m) => m.boundaryId === 'right')
    expect(right.boundaryHasControl).toBe(true)
    expect(right.signal).toBe(true)
  })

  it('keeps zero-signal context membranes inside a worklist flow (not dropped)', () => {
    // f_sibling: Right is signal (control); Left is bare context — still shown.
    const g = r.crossings.find((x) => x.flowId === 'f_sibling')
    const left = g.membranes.find((m) => m.boundaryId === 'left')
    expect(left).toBeTruthy()
    expect(left.signal).toBe(false)
  })

  it('a flow with no data, no exposure, no control anywhere falls to the under-modeled tail', () => {
    // f_cycle (CY→C): carries no data, crosses boundaries with no posture.
    expect(r.underModeled.some((g) => g.flowId === 'f_cycle')).toBe(true)
    expect(r.crossings.some((g) => g.flowId === 'f_cycle')).toBe(false)
  })

  it('a flow carrying UNCLASSIFIED data is in the worklist (a flagged gap, not buried)', () => {
    // under-modeled = "zero DATA and zero exposures and zero controls".
    // Unclassified data is non-zero data → worklist, even with no classified
    // sensitivity and no exposures/controls.
    expect(r.crossings.some((g) => g.flowId === 'f_unclassified')).toBe(true)
    expect(r.underModeled.some((g) => g.flowId === 'f_unclassified')).toBe(false)
  })

  it('a flow with any signal membrane stays in the worklist with its full containment context', () => {
    // f_orphan_in: Inner is signal; Outer + DMZ are context — flow is worklist, all 3 shown.
    const g = r.crossings.find((x) => x.flowId === 'f_orphan_in')
    expect(g).toBeTruthy()
    expect(g.membranes.map((m) => m.boundaryId)).toEqual(['outer', 'dmz', 'inner'])
  })
})

// --- ranking + sensitivity ------------------------------------------------
describe('ranking (no trust, no score)', () => {
  const r = computeCrossings(MG, LEDGER)

  it('carried RESTRICTED data ranks that flow to the top of the worklist', () => {
    expect(r.crossings[0].flowId).toBe('f_restricted')
    expect(r.crossings[0].maxSensitivity).toBe('RESTRICTED')
  })

  it('a flow with no classified data reports maxSensitivity null (unknown)', () => {
    const g = groupFor(r, 'f_exit_inner')
    expect(g.maxSensitivity).toBe(null)
  })
})

// --- completeness flags ---------------------------------------------------
describe('completeness flags', () => {
  it('flags unclassified data in motion (never silently low)', () => {
    const r = computeCrossings(MG, LEDGER)
    expect(r.flags.some((f) => f.key === 'unclassified-in-motion')).toBe(true)
    const g = groupFor(r, 'f_unclassified')
    expect(g.unclassifiedInMotion).toBe(true)
    expect(g.maxSensitivity).toBe(null)
  })

  it('detects a nesting cycle, truncates at the first repeat with the correct stack, and flags it', () => {
    const r = computeCrossings(MG, LEDGER)
    expect(r.flags.some((f) => f.key === 'nesting-cycle')).toBe(true)
    // CY ∈ cyc1; cyc1⇄cyc2 → walk visits cyc1, cyc2, then repeats → truncate.
    // C ∈ outer. Exact truncated membranes (not just "non-zero"):
    expect(seq(groupFor(r, 'f_cycle'))).toEqual(['EXIT:cyc1', 'EXIT:cyc2', 'ENTER:outer'])
  })

  it('flags a dangling parent reference (malformed data, never a silent drop)', () => {
    const mg = {
      boundaries: [{ id: 'b1', name: 'b1', parentBoundaryId: 'ghost' }], // ghost not in set
      components: [
        { id: 's', name: 's', boundaryId: 'b1' },
        { id: 't', name: 't', boundaryId: null },
      ],
      flows: [{ id: 'f', name: 'f', sourceId: 's', targetId: 't', sensitivities: [], dataItemCount: 0 }],
    }
    const r = computeCrossings(mg, [])
    expect(r.flags.some((f) => f.key === 'dangling-parent')).toBe(true)
    // b1's chain truncates at the dangling ref but still emits b1 (not dropped)
    expect(seq(groupFor(r, 'f'))).toEqual(['EXIT:b1'])
  })

  it('flags zero boundaries when none are modeled', () => {
    const r = computeCrossings({ boundaries: [], components: MG.components, flows: [] }, [])
    expect(r.flags.some((f) => f.key === 'no-boundaries')).toBe(true)
  })
})

// --- per-flow display cap -------------------------------------------------
describe('per-flow membrane cap (deep nests)', () => {
  it('caps membranes per flow, keeping innermost on each side, and reports the hidden count', () => {
    // 9-deep linear nest b0 ⊃ b1 ⊃ … ⊃ b8; src in b8, dst orphan → crosses all 9.
    const deep = {
      boundaries: Array.from({ length: 9 }, (_, i) => ({
        id: `b${i}`, name: `b${i}`, parentBoundaryId: i === 0 ? null : `b${i - 1}`,
      })),
      components: [
        { id: 'deepC', name: 'deepC', boundaryId: 'b8', type: 'process' },
        { id: 'rootC', name: 'rootC', boundaryId: null, type: 'process' },
      ],
      flows: [{ id: 'fdeep', name: 'deep', sourceId: 'deepC', targetId: 'rootC', sensitivities: ['RESTRICTED'], dataItemCount: 1 }],
    }
    const r = computeCrossings(deep, [])
    const g = groupFor(r, 'fdeep')
    expect(g.membranes.length).toBe(6) // MAX_MEMBRANES_PER_FLOW
    expect(g.hiddenMembranes).toBe(3) // 9 crossed − 6 shown
    expect(r.totals.hiddenByCap).toBe(3)
  })
})

// --- forest topology + two-sided cap -------------------------------------
describe('forest (disjoint roots) + two-sided deep cap', () => {
  it('a flow between two disjoint root subtrees EXITs its whole chain then ENTERs the other', () => {
    const mg = {
      boundaries: [
        { id: 'rA', name: 'rA', parentBoundaryId: null },
        { id: 'rB', name: 'rB', parentBoundaryId: null },
        { id: 'a1', name: 'a1', parentBoundaryId: 'rA' },
        { id: 'b1', name: 'b1', parentBoundaryId: 'rB' },
      ],
      components: [
        { id: 'cA', name: 'cA', boundaryId: 'a1' },
        { id: 'cB', name: 'cB', boundaryId: 'b1' },
      ],
      flows: [{ id: 'f', name: 'f', sourceId: 'cA', targetId: 'cB', sensitivities: [], dataItemCount: 0 }],
    }
    const r = computeCrossings(mg, [])
    // EXIT innermost→outer of source chain, then ENTER outermost→innermost of dest chain
    expect(seq(groupFor(r, 'f'))).toEqual(['EXIT:a1', 'EXIT:rA', 'ENTER:rB', 'ENTER:b1'])
  })

  it('caps a two-sided deep crossing keeping the innermost membranes on BOTH sides', () => {
    const chain = (prefix, n) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, parentBoundaryId: i === 0 ? null : `${prefix}${i - 1}` }))
    const mg = {
      boundaries: [...chain('a', 5), ...chain('b', 5)], // two disjoint 5-deep chains
      components: [
        { id: 'sA', name: 'sA', boundaryId: 'a4' }, // deepest in A
        { id: 'tB', name: 'tB', boundaryId: 'b4' }, // deepest in B
      ],
      flows: [{ id: 'f', name: 'f', sourceId: 'sA', targetId: 'tB', sensitivities: ['RESTRICTED'], dataItemCount: 1 }],
    }
    const r = computeCrossings(mg, [])
    const g = groupFor(r, 'f')
    expect(g.membranes.length).toBe(6) // 10 crossed − cap
    expect(g.hiddenMembranes).toBe(4)
    // innermost EXIT (a4) kept at the front; innermost ENTER (b4) kept at the back
    expect(g.membranes[0]).toMatchObject({ direction: 'EXIT', boundaryId: 'a4' })
    expect(g.membranes[g.membranes.length - 1]).toMatchObject({ direction: 'ENTER', boundaryId: 'b4' })
  })
})

// --- ranking discrimination + unranked framing ---------------------------
describe('ranking discrimination beyond sensitivity', () => {
  it('orders two same-sensitivity flows by crossed-boundary posture (term 3/4)', () => {
    const mg = {
      boundaries: [
        { id: 'outer', name: 'Outer', parentBoundaryId: null },
        { id: 'bx', name: 'Bx', parentBoundaryId: 'outer' },
        { id: 'by', name: 'By', parentBoundaryId: 'outer' },
      ],
      components: [
        { id: 'o', name: 'o', boundaryId: 'outer' },
        { id: 'x', name: 'x', boundaryId: 'bx' },
        { id: 'y', name: 'y', boundaryId: 'by' },
      ],
      flows: [
        { id: 'fy', name: 'fy', sourceId: 'o', targetId: 'y', sensitivities: [], dataItemCount: 0 },
        { id: 'fx', name: 'fx', sourceId: 'o', targetId: 'x', sensitivities: [], dataItemCount: 0 },
      ],
    }
    // Bx has a live exposure (weakening); By has only a control (hardening).
    const ledger = [
      { id: 'bx', name: 'Bx', type: 'SecurityBoundary', findings: [{ id: 'e', score: 9, dispositionKind: null }], supportingControls: [] },
      { id: 'by', name: 'By', type: 'SecurityBoundary', findings: [], supportingControls: [{ id: 'c', name: 'fw' }] },
    ]
    const r = computeCrossings(mg, ledger)
    expect(r.crossings.map((g) => g.flowId)).toEqual(['fx', 'fy']) // fx (live boundary) ranks first
    expect(r.worklistUnranked).toBe(false)
  })

  it('marks the worklist unranked when nothing differentiates it', () => {
    const mg = {
      boundaries: [
        { id: 'outer', name: 'Outer', parentBoundaryId: null },
        { id: 'inner', name: 'Inner', parentBoundaryId: 'outer' },
      ],
      components: [
        { id: 'o', name: 'o', boundaryId: 'outer' },
        { id: 'i', name: 'i', boundaryId: 'inner' },
      ],
      // carries (unclassified) data → worklist, but no sensitivity/exposure/control
      flows: [{ id: 'f', name: 'f', sourceId: 'o', targetId: 'i', sensitivities: [], dataItemCount: 1 }],
    }
    const r = computeCrossings(mg, []) // empty ledger ⇒ no posture
    expect(r.crossings.length).toBe(1)
    expect(r.worklistUnranked).toBe(true)
  })
})

// --- empty / malformed input ---------------------------------------------
describe('honest handling of empty/missing input', () => {
  it('empty model graph yields no crossings and no crash', () => {
    for (const empty of [undefined, null, {}, { boundaries: [], components: [], flows: [] }]) {
      const r = computeCrossings(empty, [])
      expect(r.crossings).toEqual([])
      expect(r.underModeled).toEqual([])
      expect(r.totals.crossingFlows).toBe(0)
    }
  })

  it('skips flows with a dangling endpoint', () => {
    const r = computeCrossings(
      { boundaries: MG.boundaries, components: MG.components, flows: [{ id: 'x', name: 'x', sourceId: 'A', targetId: null, sensitivities: [], dataItemCount: 0 }] },
      [],
    )
    expect(r.totals.crossingFlows).toBe(0)
  })
})
