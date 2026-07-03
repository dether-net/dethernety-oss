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
    { id: 'c1', name: 'API', type: 'process', boundaryId: 'dmz', crownJewel: true, description: 'Public API gateway', className: 'API Gateway', classDescription: 'A public-facing reverse proxy.' },
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
  { id: 'f1', name: 'req', type: 'DataFlow', findings: [live('ef', 'MITM', 6)], supportingControls: [] },
]

const doc = { ledger: LEDGER, modelGraph: MODEL_GRAPH }

describe('computeComponentProfile — Component target', () => {
  const p = computeComponentProfile('c1', doc)
  it('resolves identity incl. crown-jewel', () => {
    expect(p.element).toMatchObject({ id: 'c1', name: 'API', type: 'Component', crownJewel: true, found: true })
  })
  it('surfaces the element description + class name/description from the model graph node', () => {
    expect(p.element).toMatchObject({
      description: 'Public API gateway',
      className: 'API Gateway',
      classDescription: 'A public-facing reverse proxy.',
    })
  })
  it('leaves description/class null when the model graph node has none', () => {
    const p2 = computeComponentProfile('c2', doc)
    expect(p2.element).toMatchObject({ description: null, className: null, classDescription: null })
  })
  it('reuses the Boundary Crossings ancestor stack (innermost-first, ROOT dropped) with per-boundary posture', () => {
    expect(p.boundaryContext.map((b) => b.id)).toEqual(['dmz', 'outer'])
    const dmz = p.boundaryContext[0]
    expect(dmz).toMatchObject({ name: 'DMZ', liveCount: 1, worstBand: 'high', hasControl: false })
    expect(p.boundaryContext[1]).toMatchObject({ id: 'outer', liveCount: 0, worstBand: null })
  })
  it('own exposures match the Residual Risk partition; uncovered (no control) flagged', () => {
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
  it('highlights itself on the minimap (no edge highlight for a node element)', () => {
    expect(p.highlightIds).toEqual(['c1'])
    expect(p.highlightEdgeIds).toEqual([])
    expect(p.highlightBoundaryIds).toEqual([])
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
  it('highlights its rectangle on the minimap (boundary channel), not a node', () => {
    expect(p.highlightBoundaryIds).toEqual(['dmz'])
    expect(p.highlightIds).toEqual([]) // a boundary is a rect, not a node
    expect(p.highlightEdgeIds).toEqual([])
  })
})

// Trust-zoning fixture: outer(INTERNAL,core) ⊃ dmz(EXPOSED,WORKLOAD,edge; conduit→data) ⊃ pod
// (no own zone → inherits EXPOSED) ; outer ⊃ data(RESTRICTED, WORKLOAD+MANAGEMENT).
const ZMODEL = {
  boundaries: [
    { id: 'outer', name: 'Outer', parentBoundaryId: null, zone: 'INTERNAL', planes: [], domains: ['core'], conduits: [] },
    { id: 'dmz', name: 'DMZ', parentBoundaryId: 'outer', zone: 'EXPOSED', planes: ['WORKLOAD'], domains: ['edge'], conduits: [{ peerId: 'data', direction: 'OUTBOUND', justification: 'approved WAF path' }] },
    { id: 'data', name: 'Data', parentBoundaryId: 'outer', zone: 'RESTRICTED', planes: ['WORKLOAD', 'MANAGEMENT'], domains: [], conduits: [] },
    { id: 'pod', name: 'Pod', parentBoundaryId: 'dmz', zone: null, planes: [], domains: [], conduits: [] },
  ],
  components: [{ id: 'zc', name: 'API', type: 'process', boundaryId: 'pod', crownJewel: false }],
  flows: [],
  dataNodes: [],
}
const ZONING = {
  effectiveZones: {
    outer: { zone: 'INTERNAL', source: 'declared' },
    dmz: { zone: 'EXPOSED', source: 'declared' },
    data: { zone: 'RESTRICTED', source: 'declared' },
    pod: { zone: 'EXPOSED', source: 'inherited', from: 'dmz' },
  },
}
const zdoc = { ledger: [], modelGraph: ZMODEL, zoning: ZONING }

describe('computeComponentProfile — trust zoning', () => {
  it('annotates each ancestor boundary with its effective zone + declared planes/domains', () => {
    const p = computeComponentProfile('zc', zdoc)
    expect(p.boundaryContext.map((b) => b.id)).toEqual(['pod', 'dmz', 'outer'])
    expect(p.boundaryContext[0]).toMatchObject({ id: 'pod', zone: 'EXPOSED', zoneSource: 'inherited', planes: [], domains: [] })
    expect(p.boundaryContext[1]).toMatchObject({ id: 'dmz', zone: 'EXPOSED', zoneSource: 'declared', planes: ['WORKLOAD'], domains: ['edge'] })
    expect(p.boundaryContext[2]).toMatchObject({ id: 'outer', zone: 'INTERNAL', zoneSource: 'declared', domains: ['core'] })
  })
  it('a SecurityBoundary target gets a full zoning block (zone + source, planes, domains, outbound conduits)', () => {
    const p = computeComponentProfile('dmz', zdoc)
    expect(p.zoning).toMatchObject({
      effectiveZone: 'EXPOSED', zoneSource: 'declared', declaredZone: 'EXPOSED',
      planes: ['WORKLOAD'], domains: ['edge'],
    })
    expect(p.zoning.outboundConduits).toEqual([
      { peerId: 'data', peerName: 'Data', peerResolved: true, justification: 'approved WAF path' },
    ])
    expect(p.zoning.inboundConduits).toEqual([])
  })
  it('surfaces the INBOUND conduit mirror on the peer boundary (who declared a channel to it)', () => {
    const p = computeComponentProfile('data', zdoc)
    expect(p.zoning).toMatchObject({ effectiveZone: 'RESTRICTED', planes: ['WORKLOAD', 'MANAGEMENT'] })
    expect(p.zoning.inboundConduits).toEqual([
      { peerId: 'dmz', peerName: 'DMZ', peerResolved: true, justification: 'approved WAF path' },
    ])
    expect(p.zoning.outboundConduits).toEqual([])
  })
  it('resolves the inherited-from name for an inheriting boundary target', () => {
    const p = computeComponentProfile('pod', zdoc)
    expect(p.zoning).toMatchObject({
      effectiveZone: 'EXPOSED', zoneSource: 'inherited', inheritedFromId: 'dmz', inheritedFromName: 'DMZ',
      declaredZone: null,
    })
  })
  it('non-boundary targets carry no zoning block', () => {
    expect(computeComponentProfile('zc', zdoc).zoning).toBeNull()
  })
  it('degrades on a pre-zoning snapshot: declared tags/conduits still show, effective zone is null', () => {
    const p = computeComponentProfile('dmz', { ledger: [], modelGraph: ZMODEL }) // no zoning block
    expect(p.zoning).toMatchObject({
      effectiveZone: null, zoneSource: null, declaredZone: 'EXPOSED', planes: ['WORKLOAD'], domains: ['edge'],
    })
    expect(p.zoning.outboundConduits).toHaveLength(1)
    expect(p.boundaryContext[0].zone).toBeNull() // ancestor stack chips omitted without zoning
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
  it('surfaces the elements that HANDLE it (inverse of dataHandled), typed + sorted + drillable, with posture', () => {
    // d1.handledBy = ['c1','f1'] → a Component (API) and a DataFlow (req), sorted by type then name
    expect(p.handledByElements.map((h) => [h.id, h.type, h.name, h.resolved])).toEqual([
      ['c1', 'Component', 'API', true],
      ['f1', 'DataFlow', 'req', true],
    ])
    // posture carried per handler (c1 has live e1 @ score 8 → high band, no control)
    expect(p.handledByElements.find((h) => h.id === 'c1')).toMatchObject({ liveCount: 1, worstBand: 'high', hasControl: false })
  })
  it('highlights its HANDLERS on the minimap, each on its matching channel (Data has no shape of its own)', () => {
    // d1.handledBy = ['c1' (Component), 'f1' (DataFlow)] → component→node, flow→edge, no boundary
    expect(p.highlightIds).toEqual(['c1']) // component handler → node
    expect(p.highlightEdgeIds).toEqual(['f1']) // data-flow handler → edge
    expect(p.highlightBoundaryIds).toEqual([]) // no boundary handler
  })
  it('non-Data targets carry an empty handledByElements', () => {
    expect(computeComponentProfile('c1', doc).handledByElements).toEqual([])
    expect(computeComponentProfile('f1', doc).handledByElements).toEqual([])
    expect(computeComponentProfile('dmz', doc).handledByElements).toEqual([])
  })
  it('a Data node with a since-removed handler marks it unresolved (non-clickable), never a dead link', () => {
    const docGone = {
      ledger: LEDGER,
      modelGraph: { ...MODEL_GRAPH, dataNodes: [{ id: 'd9', name: 'Secret', sensitivity: 'RESTRICTED', handledBy: ['c1', 'ghost'] }] },
    }
    const pg = computeComponentProfile('d9', docGone)
    const ghost = pg.handledByElements.find((h) => h.id === 'ghost')
    expect(ghost).toMatchObject({ resolved: false, name: '(not in snapshot)' })
  })
})

describe('computeComponentProfile — DataFlow target', () => {
  const p = computeComponentProfile('f1', doc)
  it('resolves identity as a DataFlow with its own on-flow exposures', () => {
    expect(p.element).toMatchObject({ id: 'f1', name: 'req', type: 'DataFlow', found: true })
    expect(p.ownExposures.live.map((f) => f.id)).toEqual(['ef'])
  })
  it('neighbours are its two endpoints (source + target), each drillable', () => {
    expect(p.neighbours.map((n) => [n.direction, n.neighbourId])).toEqual([
      ['source', 'c1'],
      ['target', 'c2'],
    ])
    expect(p.neighbours.every((n) => n.neighbourResolved)).toBe(true)
  })
  it('highlights its ENDPOINTS as nodes + its OWN edge (flow id) so the line is traceable', () => {
    expect(p.highlightIds).toEqual(['c1', 'c2'])
    expect(p.highlightEdgeIds).toEqual(['f1'])
    expect(p.highlightBoundaryIds).toEqual([])
  })
  it('has no boundary stack (flows are not boundary members)', () => {
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
    // c2 has ctrlA AND live e2 → not "uncovered", but coverage is unknown
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
