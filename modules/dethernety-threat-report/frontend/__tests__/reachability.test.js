import { describe, it, expect } from 'vitest'
import {
  buildProjection,
  bfsShortest,
  enumerateRoutes,
  annotateRoute,
  modeBRoutes,
  modeAReachability,
  crownJewelRouteElements,
  externalEntryIds,
  crownJewelIds,
  DEFAULT_MAX_HOPS,
} from '../lib/reachability.js'

// --- fixtures -------------------------------------------------------------
// Topology (directed flows):
//   Ext ─▶ Web ─▶ API ─▶ DB(jewel)        Ext ─▶ Web2 ─▶ API
//   API ─▶ Cyc ─▶ API  (cycle)            DB ─▶ Leaf  (directed; no reverse)
//   Vault(jewel): no inbound flow ⇒ unreachable.
// Boundaries: DMZ (Ext, Web, Web2) and App (API, DB, Vault, Cyc, Leaf) are
// siblings, so Web→API crosses EXIT DMZ + ENTER App.
const MG = {
  boundaries: [
    { id: 'dmz', name: 'DMZ', parentBoundaryId: null, positionX: 0, positionY: 0, width: 400, height: 300 },
    { id: 'app', name: 'App', parentBoundaryId: null, positionX: 450, positionY: 0, width: 400, height: 300 },
  ],
  components: [
    { id: 'ext', name: 'Ext', type: 'external_entity', boundaryId: 'dmz', crownJewel: false },
    { id: 'web', name: 'Web', type: 'process', boundaryId: 'dmz', crownJewel: false },
    { id: 'web2', name: 'Web2', type: 'process', boundaryId: 'dmz', crownJewel: false },
    { id: 'api', name: 'API', type: 'process', boundaryId: 'app', crownJewel: false },
    { id: 'db', name: 'DB', type: 'store', boundaryId: 'app', crownJewel: true },
    { id: 'vault', name: 'Vault', type: 'store', boundaryId: 'app', crownJewel: true }, // unreachable jewel
    { id: 'cyc', name: 'Cyc', type: 'process', boundaryId: 'app', crownJewel: false },
    { id: 'leaf', name: 'Leaf', type: 'process', boundaryId: 'app', crownJewel: false },
  ],
  flows: [
    { id: 'f1', name: 'ext-web', sourceId: 'ext', targetId: 'web', sensitivities: [], dataItemCount: 0 },
    { id: 'f2', name: 'web-api', sourceId: 'web', targetId: 'api', sensitivities: ['INTERNAL'], dataItemCount: 1 },
    { id: 'f2b', name: 'ext-web2', sourceId: 'ext', targetId: 'web2', sensitivities: [], dataItemCount: 0 },
    { id: 'f2c', name: 'web2-api', sourceId: 'web2', targetId: 'api', sensitivities: [], dataItemCount: 0 },
    { id: 'f3', name: 'api-db', sourceId: 'api', targetId: 'db', sensitivities: ['RESTRICTED'], dataItemCount: 1 },
    { id: 'f4', name: 'api-cyc', sourceId: 'api', targetId: 'cyc', sensitivities: [], dataItemCount: 0 },
    { id: 'f5', name: 'cyc-api', sourceId: 'cyc', targetId: 'api', sensitivities: [], dataItemCount: 0 },
    { id: 'f6', name: 'db-leaf', sourceId: 'db', targetId: 'leaf', sensitivities: [], dataItemCount: 0 },
    { id: 'fdangle', name: 'dangling', sourceId: 'web', targetId: null, sensitivities: [], dataItemCount: 0 },
  ],
  dataNodes: [
    { id: 'pan', name: 'PAN', sensitivity: 'RESTRICTED', handledBy: ['db'] },
  ],
}

const LEDGER = [
  // API: a live high + a STALE risk-accepted (fuels ④ killer cross-ref + worstOnRoute).
  {
    id: 'api',
    name: 'API',
    type: 'Component',
    findings: [
      { id: 'ax1', name: 'RCE', score: 8, dispositionKind: null },
      { id: 'ax2', name: 'SQLi', score: 9, dispositionKind: 'RISK_ACCEPTED', dispositionStale: true },
    ],
    supportingControls: [],
  },
  // DB jewel: live critical.
  { id: 'db', name: 'DB', type: 'Component', findings: [{ id: 'dx1', name: 'exfil', score: 9.5, dispositionKind: null }], supportingControls: [] },
  // on-flow finding (web→api).
  { id: 'f2', name: 'web-api', type: 'DataFlow', findings: [{ id: 'fx1', name: 'mitm', score: 5, dispositionKind: null }], supportingControls: [] },
  // Web: control only, no findings.
  { id: 'web', name: 'Web', type: 'Component', findings: [], supportingControls: [{ id: 'c1', name: 'WAF' }] },
]

// --- projection -----------------------------------------------------------
describe('buildProjection', () => {
  it('builds directed adjacency, dropping dangling/non-component-endpoint flows', () => {
    const p = buildProjection(MG)
    expect(p.forward.get('ext').map((e) => e.to).sort()).toEqual(['web', 'web2'])
    expect(p.forward.get('api').map((e) => e.to).sort()).toEqual(['cyc', 'db'])
    expect(p.backward.get('api').map((e) => e.from).sort()).toEqual(['cyc', 'web', 'web2'])
    // fdangle (null target) excluded; web has no outgoing real edge.
    expect(p.forward.get('web').map((e) => e.to)).toEqual(['api'])
  })

  it('tolerates a null/empty modelGraph', () => {
    expect(buildProjection(null).forward.size).toBe(0)
    expect(buildProjection({}).flows).toEqual([])
  })
})

// --- BFS shortest ---------------------------------------------------------
describe('bfsShortest', () => {
  const p = buildProjection(MG)
  it('finds the min-hop route from the origin set to the target', () => {
    const r = bfsShortest(p.forward, new Set(['ext']), 'db')
    expect(r.reachable).toBe(true)
    expect(r.hops).toBe(3)
    expect(r.nodes).toEqual(['ext', 'web', 'api', 'db']) // first-discovered shortest
    expect(r.edges).toEqual(['f1', 'f2', 'f3'])
  })

  it('reports unreachable targets honestly (no path)', () => {
    const r = bfsShortest(p.forward, new Set(['ext']), 'vault')
    expect(r.reachable).toBe(false)
    expect(r.hops).toBeNull()
    expect(r.nodes).toEqual([])
  })

  it('respects flow DIRECTION (no reverse routes)', () => {
    // f6 is db→leaf; there is no leaf→db, so leaf cannot reach db.
    expect(bfsShortest(p.forward, new Set(['leaf']), 'db').reachable).toBe(false)
  })

  it('hops=0 when the target is itself an origin', () => {
    expect(bfsShortest(p.forward, new Set(['db']), 'db')).toMatchObject({ reachable: true, hops: 0 })
  })
})

// --- enumeration (simple-path, bounded) -----------------------------------
describe('enumerateRoutes', () => {
  const p = buildProjection(MG)
  it('enumerates all simple routes; the cycle never loops (visited-set)', () => {
    const r = enumerateRoutes(p.forward, 'ext', 'db')
    expect(r.total).toBe(2) // ext-web-api-db and ext-web2-api-db
    expect(r.routes.every((rt) => new Set(rt.nodes).size === rt.nodes.length)).toBe(true)
    expect(r.capped).toBe(false)
  })

  it('depth-caps at maxHops component hops', () => {
    expect(enumerateRoutes(p.forward, 'ext', 'db', { maxHops: 2 }).total).toBe(0) // db is 3 hops
    expect(enumerateRoutes(p.forward, 'ext', 'db', { maxHops: 3 }).total).toBe(2)
    expect(DEFAULT_MAX_HOPS).toBe(6)
  })

  it('K-caps COLLECTED routes but keeps counting the honest total', () => {
    const r = enumerateRoutes(p.forward, 'ext', 'db', { maxRoutes: 1 })
    expect(r.displayed).toBe(1)
    expect(r.total).toBe(2)
    expect(r.capped).toBe(true) // "showing 1 of 2"
  })

  it('flags ceilingHit and nulls the total when the hard ceiling trips', () => {
    const r = enumerateRoutes(p.forward, 'ext', 'db', { hardCeiling: 1 })
    expect(r.ceilingHit).toBe(true)
    expect(r.total).toBeNull()
    expect(r.capped).toBe(true)
  })

  it('returns nothing for origin===target or missing endpoints', () => {
    expect(enumerateRoutes(p.forward, 'ext', 'ext').total).toBe(0)
    expect(enumerateRoutes(p.forward, '', 'db').total).toBe(0)
  })

  it('bounds TRAVERSAL via the step ceiling on a dense graph (no exponential hang)', () => {
    // Complete digraph on 8 nodes + an UNREACHABLE target: the DFS would explore
    // O(8^6) partial simple paths and never complete one — the completed-route
    // ceiling alone would never trip. The step budget must stop it.
    const N = 8
    const components = []
    const flows = []
    for (let i = 0; i < N; i++) components.push({ id: 'n' + i, name: 'n' + i, type: 'process', boundaryId: null, crownJewel: false })
    components.push({ id: 't', name: 't', type: 'process', boundaryId: null, crownJewel: false }) // no inbound edge
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j) flows.push({ id: `e${i}_${j}`, sourceId: 'n' + i, targetId: 'n' + j, sensitivities: [], dataItemCount: 0 })
    const proj = buildProjection({ components, flows })
    const r = enumerateRoutes(proj.forward, 'n0', 't', { stepCeiling: 500 })
    expect(r.ceilingHit).toBe(true) // tripped the traversal budget, not the route ceiling
    expect(r.total).toBeNull() // honest: "more exist", never a silent number
    expect(r.capped).toBe(true)
    expect(r.displayed).toBe(0) // target never reached
  })
})

// --- route annotation (subway strip) --------------------------------------
describe('annotateRoute', () => {
  it('annotates per-node posture + per-hop sensitivity, crossings and threats', () => {
    const route = { nodes: ['ext', 'web', 'api', 'db'], edges: ['f1', 'f2', 'f3'] }
    const a = annotateRoute(MG, LEDGER, route)
    expect(a.nodes.map((n) => n.id)).toEqual(['ext', 'web', 'api', 'db'])
    expect(a.hopCount).toBe(3)

    // crossings only on Web→API (EXIT DMZ + ENTER App); intra-boundary hops none.
    expect(a.hops[0].crossings).toEqual([]) // ext→web (both DMZ)
    expect(a.hops[1].crossings.map((c) => `${c.direction}:${c.boundaryId}`).sort()).toEqual(['ENTER:app', 'EXIT:dmz'])
    expect(a.hops[2].crossings).toEqual([]) // api→db (both App)
    expect(a.crossingCount).toBe(2)

    // carried sensitivity on api→db.
    expect(a.hops[2].maxSensitivity).toBe('RESTRICTED')

    // on-node + on-flow live threats.
    expect(a.nodes.find((n) => n.id === 'api').worstBand).toBe('high')
    expect(a.nodes.find((n) => n.id === 'db').worstBand).toBe('critical')
    expect(a.nodes.find((n) => n.id === 'db').crownJewel).toBe(true)
    expect(a.nodes.find((n) => n.id === 'db').dataHandled.map((d) => d.name)).toEqual(['PAN'])
    expect(a.hops[1].worstBand).toBe('medium') // f2 mitm
  })
})

// --- mode B ---------------------------------------------------------------
describe('modeBRoutes', () => {
  it('returns annotated routes shortest-first with honest totals', () => {
    const r = modeBRoutes(MG, LEDGER, 'ext', 'db')
    expect(r.routes).toHaveLength(2)
    expect(r.total).toBe(2)
    expect(r.capped).toBe(false)
    expect(r.routes[0].hopCount).toBeLessThanOrEqual(r.routes[1].hopCount)
  })

  it('directed: no routes leaf→db', () => {
    expect(modeBRoutes(MG, LEDGER, 'leaf', 'db').routes).toHaveLength(0)
  })
})

// --- mode A (crown-jewel reachability) ------------------------------------
describe('modeAReachability — external entry origin', () => {
  const a = modeAReachability(MG, LEDGER, { kind: 'external' })

  it('labels the origin structurally (never "untrusted")', () => {
    expect(a.originKind).toBe('external')
    expect(a.originLabel).toBe('from external entry')
    expect(a.originIds).toEqual(['ext'])
  })

  it('counts reachable jewels; unreachable = "no modeled flow route"', () => {
    expect(a.jewelCount).toBe(2)
    expect(a.reachableCount).toBe(1)
    expect(a.unreachableCount).toBe(1)
    const db = a.jewels.find((j) => j.jewelId === 'db')
    const vault = a.jewels.find((j) => j.jewelId === 'vault')
    expect(db.reachable).toBe(true)
    expect(db.minHops).toBe(3)
    expect(db.crossingCount).toBe(2)
    expect(vault.reachable).toBe(false)
    expect(vault.minHops).toBeNull()
  })

  it('surfaces the worst live threat + risk-accepted on the route', () => {
    const db = a.jewels.find((j) => j.jewelId === 'db')
    expect(db.worstOnRoute.band).toBe('critical') // DB exfil
    expect(db.riskAccepted).toBe(1) // API SQLi accepted
    expect(db.staleRiskAccepted).toBe(1)
  })

  it('reachable jewels sort before unreachable', () => {
    expect(a.jewels[0].reachable).toBe(true)
    expect(a.jewels[a.jewels.length - 1].reachable).toBe(false)
  })
})

describe('modeAReachability — assumed-breach node origin (onward pivot)', () => {
  it('re-anchors the origin to a chosen node', () => {
    const a = modeAReachability(MG, LEDGER, { kind: 'node', id: 'api' })
    expect(a.originKind).toBe('node')
    expect(a.originLabel).toBe('assuming API is breached')
    const db = a.jewels.find((j) => j.jewelId === 'db')
    expect(db.reachable).toBe(true)
    expect(db.minHops).toBe(1) // api→db directly
    expect(a.jewels.find((j) => j.jewelId === 'vault').reachable).toBe(false)
  })

  it('falls back gracefully when the chosen node is unknown', () => {
    const a = modeAReachability(MG, LEDGER, { kind: 'node', id: 'ghost' })
    expect(a.originLabel).toContain('assuming the selected node')
    expect(a.reachableCount).toBe(0)
  })
})

// --- the ④ killer cross-ref join + ⑤ helpers ------------------------------
describe('crownJewelRouteElements (④ join)', () => {
  it('maps every on-route element to the jewel(s) it leads to — excludes unreachable', () => {
    const a = modeAReachability(MG, LEDGER, { kind: 'external' })
    const map = crownJewelRouteElements(a)
    // API sits on the route to DB.
    expect(map.has('api')).toBe(true)
    expect([...map.get('api')]).toEqual(['DB'])
    // the api→db flow is on-route too.
    expect(map.has('f3')).toBe(true)
    // Leaf is reachable but NOT on a route to a jewel (dead-ends past DB).
    expect(map.has('leaf')).toBe(false)
    // Vault is unreachable ⇒ none of its elements appear.
    expect(map.has('vault')).toBe(false)
  })
})

describe('entry/jewel id helpers (⑤ tile + minimap styling)', () => {
  it('externalEntryIds / crownJewelIds read the structural flags', () => {
    expect(externalEntryIds(MG)).toEqual(['ext'])
    expect(crownJewelIds(MG).sort()).toEqual(['db', 'vault'])
  })
})

// --- honest empty states --------------------------------------------------
describe('honest empty states', () => {
  it('no crown jewels ⇒ hasCrownJewels false, zero reachable (not a flattering green)', () => {
    const mg = { ...MG, components: MG.components.map((c) => ({ ...c, crownJewel: false })) }
    const a = modeAReachability(mg, LEDGER, { kind: 'external' })
    expect(a.hasCrownJewels).toBe(false)
    expect(a.jewelCount).toBe(0)
    expect(a.reachableCount).toBe(0)
  })

  it('no external entities ⇒ hasOrigin false (mode A unavailable, not silently empty)', () => {
    const mg = { ...MG, components: MG.components.map((c) => (c.type === 'external_entity' ? { ...c, type: 'process' } : c)) }
    const a = modeAReachability(mg, LEDGER, { kind: 'external' })
    expect(a.hasOrigin).toBe(false)
    expect(a.reachableCount).toBe(0)
  })
})
