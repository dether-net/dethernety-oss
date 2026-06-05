import { describe, it, expect } from 'vitest'
import { computeComponentProfile } from '../lib/componentProfile.js'

const live = (id, name, score) => ({ id, name, score, createdBy: 'USER', dispositionKind: null, dispositionStale: null })
const disp = (id, name, score, kind) => ({ id, name, score, createdBy: 'USER', dispositionKind: kind, dispositionStale: false })
const ctrl = (id) => ({ id, name: id, type: null, category: null })

const MODEL_GRAPH = {
  boundaries: [
    { id: 'outer', name: 'Outer', parentBoundaryId: null },
    { id: 'dmz', name: 'DMZ', parentBoundaryId: 'outer' },
  ],
  components: [
    { id: 'c1', name: 'API', type: 'process', boundaryId: 'dmz', crownJewel: true },
    { id: 'c2', name: 'DB', type: 'store', boundaryId: 'outer', crownJewel: false },
    { id: 'c3', name: 'Ext', type: 'external_entity', boundaryId: null, crownJewel: false },
  ],
  flows: [
    { id: 'f1', name: 'req', sourceId: 'c1', targetId: 'c2', sensitivities: ['RESTRICTED'], dataItemCount: 2 },
    { id: 'f2', name: 'resp', sourceId: 'c2', targetId: 'c1', sensitivities: [], dataItemCount: 1 },
  ],
  dataNodes: [
    { id: 'd1', name: 'PII', sensitivity: 'RESTRICTED', handledBy: ['c1', 'f1'] },
    { id: 'd2', name: 'Logs', sensitivity: null, handledBy: ['c2'] },
  ],
}

const LEDGER = [
  { id: 'c1', name: 'API', type: 'Component', findings: [live('e1', 'SQLi', 8)], supportingControls: [] },
  { id: 'c2', name: 'DB', type: 'Component', findings: [live('e2', 'Leak', 5), disp('e3', 'Noise', 4, 'FALSE_POSITIVE')], supportingControls: [ctrl('ctrlA')] },
  { id: 'dmz', name: 'DMZ', type: 'SecurityBoundary', findings: [live('eb', 'WeakSeg', 7)], supportingControls: [] },
  { id: 'd1', name: 'PII', type: 'Data', findings: [live('ed', 'Exfil', 9)], supportingControls: [] },
]

const doc = { ledger: LEDGER, modelGraph: MODEL_GRAPH }

describe('computeComponentProfile — Component target', () => {
  const p = computeComponentProfile('c1', doc)
  it('resolves identity incl. crown-jewel', () => {
    expect(p.element).toMatchObject({ id: 'c1', name: 'API', type: 'Component', crownJewel: true, found: true })
  })
  it('reuses the ③ ancestor stack (innermost-first, ROOT dropped) with per-boundary posture', () => {
    expect(p.boundaryContext.map((b) => b.id)).toEqual(['dmz', 'outer'])
    const dmz = p.boundaryContext[0]
    expect(dmz).toMatchObject({ name: 'DMZ', liveCount: 1, worstBand: 'high', hasControl: false })
    expect(p.boundaryContext[1]).toMatchObject({ id: 'outer', liveCount: 0, worstBand: null })
  })
  it('own exposures match ④ partition; uncovered (no control) flagged', () => {
    expect(p.ownExposures.liveCount).toBe(1)
    expect(p.ownExposures.live[0].id).toBe('e1')
    expect(p.ownExposures.uncovered).toBe(true)
  })
  it('data sub-block joins HANDLES → Data sensitivity + the Data’s OWN exposures', () => {
    expect(p.dataHandled.map((d) => d.id)).toEqual(['d1'])
    expect(p.dataHandled[0]).toMatchObject({ sensitivity: 'RESTRICTED', sensitivityLabel: 'Restricted', liveCount: 1 })
    expect(p.dataHandled[0].live[0].id).toBe('ed')
  })
  it('1-hop neighbours both directions, sorted; resolved + drillable', () => {
    expect(p.neighbours.map((n) => [n.direction, n.neighbourId, n.flowId])).toEqual([
      ['inbound', 'c2', 'f2'],
      ['outbound', 'c2', 'f1'],
    ])
    expect(p.neighbours.every((n) => n.neighbourResolved)).toBe(true)
  })
  it('highlights itself on the minimap', () => {
    expect(p.highlightIds).toEqual(['c1'])
  })
})

describe('computeComponentProfile — SecurityBoundary target', () => {
  const p = computeComponentProfile('dmz', doc)
  it('boundary context includes itself + ancestors', () => {
    expect(p.element.type).toBe('SecurityBoundary')
    expect(p.boundaryContext.map((b) => b.id)).toEqual(['dmz', 'outer'])
  })
  it('surfaces its own exposures, no flow neighbours', () => {
    expect(p.ownExposures.live.map((f) => f.id)).toEqual(['eb'])
    expect(p.neighbours).toEqual([])
  })
})

describe('computeComponentProfile — Data target', () => {
  const p = computeComponentProfile('d1', doc)
  it('resolves sensitivity + its own exposures; no data sub-block, no boundary stack', () => {
    expect(p.element).toMatchObject({ type: 'Data', sensitivity: 'RESTRICTED', sensitivityLabel: 'Restricted' })
    expect(p.ownExposures.live.map((f) => f.id)).toEqual(['ed'])
    expect(p.dataHandled).toEqual([])
    expect(p.boundaryContext).toEqual([])
  })
})

describe('computeComponentProfile — coarse-control & unclassified data honesty', () => {
  it('controls pass through as defense-in-depth context (muted)', () => {
    const p = computeComponentProfile('c2', doc)
    expect(p.controls.map((c) => c.id)).toEqual(['ctrlA'])
    expect(p.ownExposures.uncovered).toBe(false)
  })
  it('flags control-relevance-unassessed when an element has BOTH a control and a live exposure', () => {
    // c2 has ctrlA AND live e2 → not "uncovered", but coverage is unknown in P1
    const p = computeComponentProfile('c2', doc)
    expect(p.ownExposures.controlRelevanceUnassessed).toBe(true)
    // c1 has no control → genuinely uncovered, not "unassessed"
    const p1 = computeComponentProfile('c1', doc)
    expect(p1.ownExposures.uncovered).toBe(true)
    expect(p1.ownExposures.controlRelevanceUnassessed).toBe(false)
  })
  it('handled Data with null sensitivity reads "unknown", never "low"', () => {
    const p = computeComponentProfile('c2', doc)
    const logs = p.dataHandled.find((d) => d.id === 'd2')
    expect(logs).toMatchObject({ sensitivity: null, sensitivityLabel: 'unknown' })
  })
})

describe('computeComponentProfile — defensive', () => {
  it('a finding-free element is still profile-able (resolved from modelGraph)', () => {
    const p = computeComponentProfile('outer', doc)
    expect(p.element).toMatchObject({ id: 'outer', type: 'SecurityBoundary', found: true })
    expect(p.ownExposures.liveCount).toBe(0)
    expect(p.boundaryContext.map((b) => b.id)).toEqual(['outer'])
  })
  it('an orphan component (no boundary) yields an empty boundary context, not a throw', () => {
    const p = computeComponentProfile('c3', doc)
    expect(p.element).toMatchObject({ id: 'c3', type: 'Component', found: true })
    expect(p.boundaryContext).toEqual([])
  })
  it('an unknown element id returns a found=false shell without throwing', () => {
    const p = computeComponentProfile('nope', doc)
    expect(p.element.found).toBe(false)
    expect(p.ownExposures.liveCount).toBe(0)
    expect(p.dataHandled).toEqual([])
    expect(p.neighbours).toEqual([])
  })
})
