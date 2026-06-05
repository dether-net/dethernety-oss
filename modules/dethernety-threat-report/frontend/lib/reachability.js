// frontend/lib/reachability.js — the ② Flow-Route / Reachability engine.
//
// Pure, synchronous, client-side compute over the snapshot doc's `modelGraph`
// (topology + per-flow carried sensitivity, gathered backend-side) joined with
// the RAW `ledger` (every element's findings + supporting controls — reused for
// on-route posture, exactly as ③/⑥ do). No Vue, no network, no Cypher — the
// simple-path invariant is enforced HERE by a TS visited-set, NOT by Memgraph
// variable-length semantics (func §13). Unit-tested with fixtures.
//
// HONESTY (spec §5): these are FLOW ROUTES and the threats sitting on them —
// NEVER "attack paths". The model is TOPOLOGICAL: hop count is proximity, not
// attacker effort; it does NOT model credential reuse or token theft. An
// unreachable crown jewel is reported as "no modeled flow route" (a modeling
// gap, tie to the §4.3 completeness banner) — NEVER "segmented" or "safe".
// `trustLevel` is dormant: the entry set is STRUCTURAL (external entities / a
// chosen assumed-breach node), never "untrusted". No score, no coverage %.
//
// Reuse, not reinvention: the ancestor-boundary stack (EXIT/ENTER crossings) is
// the SAME `makeStackResolver` ③ uses; on-route posture is the SAME `postureOf`
// + `isLive` + `scoreBand`; the per-hop neighbour walk generalises ⑥'s 1-hop
// loop to a bounded multi-hop DFS over the identical `sourceId`/`targetId` edges.

import { isLive, scoreBand } from './aggregateLedger.js'
import {
  makeStackResolver,
  postureOf,
  ROOT,
  maxSensitivity,
  sensitivityLabel,
  SENSITIVITY_RANK,
} from './boundaryCrossings.js'

const BAND_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 }

// Mode-B enumeration bounds. Component hops (a hop = one Component→Component
// step; the intermediate DataFlow node is collapsed into the labeled edge).
export const DEFAULT_MAX_HOPS = 6
// K-cap on COLLECTED routes (display); total is still counted up to the hard
// ceiling so the "of N" banner is honest.
export const DEFAULT_MAX_ROUTES = 25
// Completed-route ceiling: past this many FOUND routes we stop and say "more
// exist" (nulls the total).
export const HARD_TOTAL_CEILING = 2000
// TRAVERSAL-step budget: the real exponential guard. The completed-route ceiling
// alone does NOT bound a dense/hub graph — the DFS can explore O(V^maxHops)
// PARTIAL simple paths before any completes (or with an unreachable target,
// none complete). So we also cap edge-expansions; tripping it sets ceilingHit
// ("more exist, enumeration stopped"). Sized to keep the synchronous compute well
// under ~50ms on the main thread while never falsely tripping on a real model.
export const STEP_CEILING = 100000

// The structural entry class (DFD type, lower-cased in modelGraph). `trustLevel`
// is dormant, so "entry" is external-entity OR a chosen assumed-breach node —
// never a trust comparison.
export const EXTERNAL_ENTITY_TYPE = 'external_entity'

// ─── Topology projection ─────────────────────────────────────────────────────

/**
 * Project the model's `Component-[:FLOWS]->DataFlow-[:FLOWS]->Component` graph
 * onto a directed component-to-component adjacency (each logical hop = one
 * labeled edge carrying the DataFlow's id/name/sensitivities). Dangling-endpoint
 * and non-component-endpoint flows are dropped (same guard as ⑥).
 *
 * @param {{components:Array,flows:Array}} modelGraph
 * @returns {{ forward:Map, backward:Map, componentById:Map, flowById:Map, components:Array, flows:Array }}
 */
export function buildProjection(modelGraph) {
  const mg = modelGraph && typeof modelGraph === 'object' ? modelGraph : {}
  const components = Array.isArray(mg.components) ? mg.components : []
  const flows = Array.isArray(mg.flows) ? mg.flows : []
  const componentById = new Map(components.map((c) => [c.id, c]))
  const flowById = new Map(flows.map((f) => [f.id, f]))

  const forward = new Map() // sourceId → [{ flowId, flowName, sensitivities, to }]
  const backward = new Map() // targetId → [{ flowId, flowName, sensitivities, from }]
  for (const f of flows) {
    if (!f.sourceId || !f.targetId) continue
    // Endpoints must resolve to components in this snapshot (a since-removed or
    // non-component endpoint is not a traversable hop).
    if (!componentById.has(f.sourceId) || !componentById.has(f.targetId)) continue
    const sensitivities = Array.isArray(f.sensitivities) ? f.sensitivities : []
    const base = { flowId: f.id, flowName: f.name ?? '', sensitivities }
    if (!forward.has(f.sourceId)) forward.set(f.sourceId, [])
    forward.get(f.sourceId).push({ ...base, to: f.targetId })
    if (!backward.has(f.targetId)) backward.set(f.targetId, [])
    backward.get(f.targetId).push({ ...base, from: f.sourceId })
  }
  return { forward, backward, componentById, flowById, components, flows }
}

/** BFS reachability closure from a start set over `adjMap`, following `next(e)`
 *  (e.to for forward, e.from for backward). Returns the set of reachable
 *  component ids (INCLUDING the starts). Near-linear in V+E (uses Array.shift,
 *  so technically O(V·E) worst-case — negligible at report scale). */
function closure(adjMap, startIds, next) {
  const seen = new Set(startIds)
  const queue = [...startIds]
  while (queue.length) {
    const cur = queue.shift()
    for (const e of adjMap.get(cur) ?? []) {
      const nxt = next(e)
      if (!seen.has(nxt)) {
        seen.add(nxt)
        queue.push(nxt)
      }
    }
  }
  return seen
}

/**
 * Single-pass BFS for existence + min hop count + a representative shortest
 * route from ANY origin in `originSet` to `targetId`. Cheap — drives mode-A's
 * per-jewel list (no full enumeration). Returns the reconstructed shortest
 * `{ nodes, edges }` (component ids / flow ids) for crossing/threat annotation.
 *
 * @returns {{ reachable:boolean, hops:(number|null), nodes:string[], edges:string[] }}
 */
export function bfsShortest(forward, originSet, targetId) {
  if (originSet.has(targetId)) {
    return { reachable: true, hops: 0, nodes: [targetId], edges: [] }
  }
  const prev = new Map() // compId → { from, flowId }
  const seen = new Set(originSet)
  const queue = [...originSet]
  while (queue.length) {
    const cur = queue.shift()
    for (const e of forward.get(cur) ?? []) {
      if (seen.has(e.to)) continue
      seen.add(e.to)
      prev.set(e.to, { from: cur, flowId: e.flowId })
      if (e.to === targetId) {
        const nodes = [targetId]
        const edges = []
        let c = targetId
        while (prev.has(c)) {
          const p = prev.get(c)
          edges.unshift(p.flowId)
          nodes.unshift(p.from)
          c = p.from
        }
        return { reachable: true, hops: nodes.length - 1, nodes, edges }
      }
      queue.push(e.to)
    }
  }
  return { reachable: false, hops: null, nodes: [], edges: [] }
}

/**
 * Enumerate directed SIMPLE flow routes originId → targetId, depth-capped at
 * `maxHops` component hops and K-capped at `maxRoutes` COLLECTED routes. The
 * simple-path invariant is the per-path `visited` set (no node twice → cycles
 * terminate). `total` keeps counting past the K-cap (up to HARD_TOTAL_CEILING)
 * so "showing X of N" is honest; if the ceiling is hit, `ceilingHit` is set and
 * `total` is null (we stopped counting — "more exist", never a silent number).
 * A separate `stepCeiling` budget bounds EDGE-EXPANSIONS (not just completed
 * routes) — the real guard against the O(V^maxHops) partial-path explosion on a
 * dense/hub graph; tripping it also sets `ceilingHit` (honest "more exist").
 *
 * @returns {{ routes:Array<{nodes:string[],edges:string[]}>, displayed:number,
 *   total:(number|null), capped:boolean, ceilingHit:boolean }}
 */
export function enumerateRoutes(forward, originId, targetId, opts = {}) {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS
  const maxRoutes = opts.maxRoutes ?? DEFAULT_MAX_ROUTES
  const ceiling = opts.hardCeiling ?? HARD_TOTAL_CEILING
  const stepCeiling = opts.stepCeiling ?? STEP_CEILING

  const routes = []
  let total = 0
  let ceilingHit = false
  let steps = 0 // edge-expansion budget — the true exponential guard

  if (!originId || !targetId || originId === targetId) {
    return { routes, displayed: 0, total: 0, capped: false, ceilingHit: false }
  }

  const visited = new Set([originId])
  const nodes = [originId]
  const edges = []

  const dfs = (cur) => {
    if (ceilingHit) return
    if (cur === targetId) {
      total++
      if (routes.length < maxRoutes) routes.push({ nodes: [...nodes], edges: [...edges] })
      if (total >= ceiling) ceilingHit = true
      return
    }
    if (nodes.length - 1 >= maxHops) return // depth cap (component hops)
    for (const e of forward.get(cur) ?? []) {
      // Charge every edge-expansion (incl. cycle-skips) to the traversal budget —
      // this is what actually bounds the partial-path explosion on a dense graph.
      if (++steps > stepCeiling) { ceilingHit = true; return }
      if (visited.has(e.to)) continue // simple-path invariant
      visited.add(e.to)
      nodes.push(e.to)
      edges.push(e.flowId)
      dfs(e.to)
      visited.delete(e.to)
      nodes.pop()
      edges.pop()
      if (ceilingHit) return
    }
  }
  dfs(originId)

  return {
    routes,
    displayed: routes.length,
    total: ceilingHit ? null : total,
    capped: ceilingHit || routes.length < total,
    ceilingHit,
  }
}

// ─── Route annotation (the mode-B subway strip view-model) ───────────────────

/** EXIT/ENTER membranes pierced going src→dst, reusing ③'s ancestor stacks. */
function crossingsForHop(stackOfComponent, boundaryById, srcId, dstId) {
  const stackSrc = stackOfComponent(srcId)
  const stackDst = stackOfComponent(dstId)
  const setSrc = new Set(stackSrc)
  const setDst = new Set(stackDst)
  const exit = stackSrc.filter((b) => b !== ROOT && !setDst.has(b))
  const enter = stackDst.filter((b) => b !== ROOT && !setSrc.has(b)).reverse()
  return [
    ...exit.map((b) => ({ boundaryId: b, boundaryName: boundaryById.get(b)?.name ?? '(unknown boundary)', direction: 'EXIT' })),
    ...enter.map((b) => ({ boundaryId: b, boundaryName: boundaryById.get(b)?.name ?? '(unknown boundary)', direction: 'ENTER' })),
  ]
}

/**
 * Annotate one route ({ nodes, edges }) into the linearised subway-strip view
 * model: per-node live posture + sensitive Data handled, per-hop carried
 * sensitivity + on-flow posture + EXIT/ENTER crossings. Pure join over
 * `modelGraph` + `ledger`.
 */
export function annotateRoute(modelGraph, ledger, route) {
  const mg = modelGraph && typeof modelGraph === 'object' ? modelGraph : {}
  const components = Array.isArray(mg.components) ? mg.components : []
  const dataNodes = Array.isArray(mg.dataNodes) ? mg.dataNodes : []
  const componentById = new Map(components.map((c) => [c.id, c]))
  const flowById = new Map((Array.isArray(mg.flows) ? mg.flows : []).map((f) => [f.id, f]))
  const ledgerById = new Map((Array.isArray(ledger) ? ledger : []).map((e) => [e.id, e]))
  const { stackOfComponent, boundaryById } = makeStackResolver(mg)

  const routeNodes = Array.isArray(route?.nodes) ? route.nodes : []
  const routeEdges = Array.isArray(route?.edges) ? route.edges : []

  const dataByHandler = (id) =>
    dataNodes
      .filter((d) => Array.isArray(d.handledBy) && d.handledBy.includes(id))
      .map((d) => ({ id: d.id, name: d.name, sensitivity: d.sensitivity ?? null, sensitivityLabel: sensitivityLabel(d.sensitivity ?? null) }))
      .sort((a, b) => (SENSITIVITY_RANK[b.sensitivity] ?? 0) - (SENSITIVITY_RANK[a.sensitivity] ?? 0) || String(a.name).localeCompare(String(b.name)))

  const nodes = routeNodes.map((id) => {
    const c = componentById.get(id)
    const p = postureOf(ledgerById.get(id))
    return {
      id,
      name: c?.name ?? ledgerById.get(id)?.name ?? '(not in snapshot)',
      type: c?.type ?? null,
      crownJewel: c?.crownJewel === true,
      liveCount: p.liveCount,
      worstBand: p.worstBand,
      hasControl: p.hasControl,
      dataHandled: dataByHandler(id),
    }
  })

  let crossingCount = 0
  const hops = routeEdges.map((flowId, i) => {
    const f = flowById.get(flowId)
    const srcId = routeNodes[i]
    const dstId = routeNodes[i + 1]
    const crossings = crossingsForHop(stackOfComponent, boundaryById, srcId, dstId)
    crossingCount += crossings.length
    const sensitivities = Array.isArray(f?.sensitivities) ? f.sensitivities : []
    const top = maxSensitivity(sensitivities)
    const fp = postureOf(ledgerById.get(flowId))
    return {
      flowId,
      flowName: f?.name ?? '',
      sourceId: srcId,
      targetId: dstId,
      sensitivities,
      maxSensitivity: top,
      sensitivityLabel: sensitivityLabel(top),
      unclassifiedInMotion: top == null && (f?.dataItemCount ?? 0) > 0,
      liveCount: fp.liveCount,
      worstBand: fp.worstBand,
      hasControl: fp.hasControl,
      crossings,
    }
  })

  return { nodes, hops, hopCount: routeEdges.length, crossingCount }
}

// ─── Mode B: pick-two enumerated + annotated routes ──────────────────────────

/** Enumerate + annotate routes between two chosen nodes (the mode-B surface).
 *  Routes ordered shortest-first (enumeration yields them by increasing depth
 *  along each DFS branch; we sort by hop count then by node names for stability). */
export function modeBRoutes(modelGraph, ledger, originId, targetId, opts = {}) {
  const proj = buildProjection(modelGraph)
  const { routes, displayed, total, capped, ceilingHit } = enumerateRoutes(
    proj.forward,
    originId,
    targetId,
    opts,
  )
  const annotated = routes
    .map((r) => annotateRoute(modelGraph, ledger, r))
    .sort(
      (a, b) =>
        a.hopCount - b.hopCount ||
        a.nodes.map((n) => n.name).join('>').localeCompare(b.nodes.map((n) => n.name).join('>')),
    )
  return { routes: annotated, displayed, total, capped, ceilingHit, originId, targetId }
}

// ─── Mode A: crown-jewel reachability from a (selectable) origin ─────────────

function worstBandOf(ids, ledgerById) {
  let worst = null
  let worstRank = -1
  let liveCount = 0
  for (const id of ids) {
    const p = postureOf(ledgerById.get(id))
    liveCount += p.liveCount
    if (p.worstBand) {
      const r = BAND_RANK[p.worstBand] ?? 0
      if (r > worstRank) {
        worstRank = r
        worst = p.worstBand
      }
    }
  }
  return { band: worst, liveCount }
}

// Count RISK_ACCEPTED (and stale-among-them) dispositioned findings across a set
// of elements — fuels mode-A's "1 RISK_ACCEPTED ⚠" and the ④ louder-if-stale.
function riskAcceptedOf(ids, ledgerById) {
  let riskAccepted = 0
  let staleRiskAccepted = 0
  for (const id of ids) {
    for (const f of ledgerById.get(id)?.findings ?? []) {
      if (f.dispositionKind === 'RISK_ACCEPTED') {
        riskAccepted++
        if (f.dispositionStale === true) staleRiskAccepted++
      }
    }
  }
  return { riskAccepted, staleRiskAccepted }
}

/** External-entity component ids (the default mode-A origin set + minimap entry styling). */
export function externalEntryIds(modelGraph) {
  const components = Array.isArray(modelGraph?.components) ? modelGraph.components : []
  return components.filter((c) => (c.type ?? '').toLowerCase() === EXTERNAL_ENTITY_TYPE).map((c) => c.id)
}

/** Crown-jewel component ids (the mode-A target set + minimap jewel styling). */
export function crownJewelIds(modelGraph) {
  const components = Array.isArray(modelGraph?.components) ? modelGraph.components : []
  return components.filter((c) => c.crownJewel === true).map((c) => c.id)
}

/**
 * Mode-A reachability: from a SELECTABLE origin (default = external entry-points;
 * or a single assumed-breach node) → every crown-jewel component. Per jewel:
 * reachable yes/no, min hops, boundary crossings on the shortest route, worst
 * live threat sitting on ANY route to it. Unreachable ⇒ "no modeled flow route"
 * (not "safe"). Cheap: BFS closures only — NO enumeration.
 *
 * @param {object} modelGraph
 * @param {Array}  ledger
 * @param {{kind:'external'}|{kind:'node',id:string}} originSpec
 * @returns view model consumed by ②, ⑤, and ④ alike.
 */
export function modeAReachability(modelGraph, ledger, originSpec = { kind: 'external' }) {
  const proj = buildProjection(modelGraph)
  const ledgerById = new Map((Array.isArray(ledger) ? ledger : []).map((e) => [e.id, e]))
  const { stackOfComponent, boundaryById } = makeStackResolver(modelGraph || {})

  // Origin set (structural — never a trust filter).
  let originIds
  let originLabel
  let originKind
  if (originSpec?.kind === 'node' && originSpec.id) {
    originIds = new Set([originSpec.id])
    originKind = 'node'
    const c = proj.componentById.get(originSpec.id)
    originLabel = c ? `assuming ${c.name} is breached` : 'assuming the selected node is breached'
  } else {
    originIds = new Set(externalEntryIds(modelGraph))
    originKind = 'external'
    originLabel = 'from external entry'
  }

  const jewels = proj.components.filter((c) => c.crownJewel === true)
  const fwdClosure = closure(proj.forward, originIds, (e) => e.to)

  // elementId → Set(jewelName) for every element on SOME reachable origin→jewel
  // route (the ④ killer cross-ref join + the minimap route paint set).
  const routeElementToJewels = new Map()
  const addRouteElement = (id, jewelName) => {
    if (!routeElementToJewels.has(id)) routeElementToJewels.set(id, new Set())
    routeElementToJewels.get(id).add(jewelName)
  }

  const jewelsView = jewels
    .map((j) => {
      const isOrigin = originIds.has(j.id)
      const sp = bfsShortest(proj.forward, originIds, j.id)
      const reachable = sp.reachable

      // On-route element set for THIS jewel: forward-reachable-from-origin ∩
      // can-reach-this-jewel (backward closure). Depth-unbounded structural
      // membership — the honest "what sits between entry and this jewel".
      let onRouteComps = []
      let onRouteFlows = []
      let crossingCount = 0
      let worst = { band: null, liveCount: 0 }
      let risk = { riskAccepted: 0, staleRiskAccepted: 0 }
      if (reachable && !isOrigin) {
        const bwd = closure(proj.backward, new Set([j.id]), (e) => e.from)
        onRouteComps = proj.components.filter((c) => fwdClosure.has(c.id) && bwd.has(c.id)).map((c) => c.id)
        onRouteFlows = proj.flows
          .filter((f) => f.sourceId && f.targetId && fwdClosure.has(f.sourceId) && bwd.has(f.targetId))
          .map((f) => f.id)
        const elementIds = [...onRouteComps, ...onRouteFlows]
        worst = worstBandOf(elementIds, ledgerById)
        risk = riskAcceptedOf(elementIds, ledgerById)
        for (const id of elementIds) addRouteElement(id, j.name)
        // Crossings reported from the representative SHORTEST route (a single,
        // legible number — labeled "shortest route" in the view).
        for (let i = 0; i < sp.edges.length; i++) {
          crossingCount += crossingsForHop(stackOfComponent, boundaryById, sp.nodes[i], sp.nodes[i + 1]).length
        }
      }

      return {
        jewelId: j.id,
        jewelName: j.name ?? '',
        reachable,
        isOrigin,
        minHops: reachable ? sp.hops : null,
        crossingCount,
        worstOnRoute: worst, // { band, liveCount }
        riskAccepted: risk.riskAccepted,
        staleRiskAccepted: risk.staleRiskAccepted,
        shortestPath: { nodes: sp.nodes, edges: sp.edges },
      }
    })
    .sort((a, b) => {
      // reachable first, then by worst band desc, then min hops asc, then name.
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1
      const w = (BAND_RANK[b.worstOnRoute.band] ?? -1) - (BAND_RANK[a.worstOnRoute.band] ?? -1)
      if (w !== 0) return w
      const h = (a.minHops ?? Infinity) - (b.minHops ?? Infinity)
      if (h !== 0) return h
      return String(a.jewelName).localeCompare(String(b.jewelName))
    })

  const reachableCount = jewelsView.filter((j) => j.reachable).length

  return {
    originKind,
    originLabel,
    originIds: [...originIds],
    jewelCount: jewels.length,
    reachableCount,
    unreachableCount: jewels.length - reachableCount,
    hasCrownJewels: jewels.length > 0,
    hasOrigin: originIds.size > 0,
    jewels: jewelsView,
    // In-memory join maps (NOT serialized through GraphQL — consumed by ④/minimap).
    routeElementToJewels,
    entryPointIds: externalEntryIds(modelGraph),
    crownJewelIds: jewels.map((j) => j.id),
  }
}

/** The set of element ids (components + flows) on ANY reachable crown-jewel
 *  route, mapped to the jewel name(s) reached through them — the ④ killer
 *  cross-ref join. Convenience accessor over a mode-A result. */
export function crownJewelRouteElements(modeAResult) {
  return modeAResult?.routeElementToJewels ?? new Map()
}

/** Band label helper (presentation aid; never a verdict). */
export function bandLabel(band) {
  if (!band) return null
  return band.charAt(0).toUpperCase() + band.slice(1)
}
