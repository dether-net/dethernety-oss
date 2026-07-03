// frontend/lib/componentProfile.js — the Component Profile synthesis.
//
// The Component Profile is a DRILL TARGET, not a top-level report: it earns its
// place by SYNTHESISING residual risk per element rather than re-skinning the
// canvas inspector. Reachable for a Component, a SecurityBoundary, a Data node, or
// a DataFlow (all finding-bearing) — same drill, applied to whichever element.
// Pure composition
// over the snapshot doc (`ledger` + `modelGraph`, both gathered at generate
// time) — no Vue, no network, unit-tested.
//
// Trust-zoning context is joined in from the snapshot's `zoning.effectiveZones`
// (declared/inherited/default) + the boundary's own declared planes/domains/conduits:
// each ancestor boundary carries a zone chip, and a SecurityBoundary target gets a
// dedicated zoning block (effective zone + source, planes, domains, in/outbound conduits).
//
// Reuse, not reinvention: the ancestor-boundary stack comes from the SAME
// `makeStackResolver` the Boundary Crossings engine uses (cycle / dangling-parent
// handling included), and the per-element exposure partition + control consistency
// come from `aggregateLedger` (run over the single element) — so the Component
// Profile's posture is identical to the Residual Risk view's by construction. The
// data sub-block joins `modelGraph.dataNodes` (HANDLES topology + sensitivity,
// gathered backend-side) to each Data's OWN ledger exposures; coverage is
// attributed to the handling element, never to the Data node. Controls are muted
// defense-in-depth context — the technique-set intent partition needs the coverage
// engine and is NOT here.

import { aggregateLedger } from './aggregateLedger.js'
import {
  makeStackResolver,
  postureOf,
  ROOT,
  maxSensitivity,
  sensitivityLabel,
  SENSITIVITY_RANK,
} from './boundaryCrossings.js'

// Boundary-name sort for the conduit lists.
const byPeerName = (a, b) => String(a.peerName).localeCompare(String(b.peerName))

// Aggregate a single ledger element through the Residual Risk aggregator and return its
// group (the annotated live/dispositioned partition + control consistency), or a
// finding-free shell when the element has no findings (aggregateLedger drops
// finding-free elements from `groups`).
function singleGroup(ledgerEl) {
  if (!ledgerEl) {
    return {
      live: [],
      dispositioned: [],
      supportingControls: [],
      liveCount: 0,
      dispositionedCount: 0,
      compensatingClaimNoControl: false,
    }
  }
  const g = aggregateLedger([ledgerEl]).groups[0]
  return (
    g ?? {
      live: [],
      dispositioned: [],
      supportingControls: ledgerEl.supportingControls ?? [],
      liveCount: 0,
      dispositionedCount: 0,
      compensatingClaimNoControl: false,
    }
  )
}

/**
 * Synthesise the Component Profile for an element.
 *
 * @param {string} elementId
 * @param {{ ledger: Array, modelGraph: object, zoning?: object }} doc
 * @returns {object} the Component Profile view model (see fields below)
 */
export function computeComponentProfile(elementId, { ledger, modelGraph, zoning } = {}) {
  const mg = modelGraph && typeof modelGraph === 'object' ? modelGraph : {}
  const components = Array.isArray(mg.components) ? mg.components : []
  const boundaries = Array.isArray(mg.boundaries) ? mg.boundaries : []
  const flows = Array.isArray(mg.flows) ? mg.flows : []
  const dataNodes = Array.isArray(mg.dataNodes) ? mg.dataNodes : []
  const ledgerArr = Array.isArray(ledger) ? ledger : []
  const ledgerById = new Map(ledgerArr.map((e) => [e.id, e]))

  // Declared effective zone per boundary (the authoritative declared/inherited/default
  // resolution from the snapshot). Absent on a pre-zoning snapshot ⇒ zone chips are simply
  // omitted; the declared planes/domains/conduits still come from the modelGraph node.
  const effectiveZones = zoning && typeof zoning === 'object' ? (zoning.effectiveZones ?? {}) : {}
  const effectiveZoneOf = (bid) => effectiveZones[bid] ?? null // { zone, source, from? } | null

  const comp = components.find((c) => c.id === elementId)
  const bound = boundaries.find((b) => b.id === elementId)
  const dataN = dataNodes.find((d) => d.id === elementId)
  const flow = flows.find((f) => f.id === elementId)
  const ledgerEl = ledgerById.get(elementId)
  const found = Boolean(comp || bound || dataN || flow || ledgerEl)

  const type =
    ledgerEl?.type ??
    (comp ? 'Component' : bound ? 'SecurityBoundary' : dataN ? 'Data' : flow ? 'DataFlow' : '(unknown)')
  const name =
    comp?.name ?? bound?.name ?? dataN?.name ?? flow?.name ?? ledgerEl?.name ?? '(unknown element)'

  // The element's own free-text description and the class it instantiates (name +
  // description), gathered into the modelGraph node at generate time. Any may be
  // absent (no description authored, or no class assigned) — the profile renders
  // these only when present, never an empty "Class · —" line.
  const mgNode = comp ?? bound ?? dataN ?? flow ?? null
  const element = {
    id: elementId,
    name,
    type,
    crownJewel: comp?.crownJewel === true,
    description: mgNode?.description ?? null,
    className: mgNode?.className ?? null,
    classDescription: mgNode?.classDescription ?? null,
    sensitivity: dataN ? (dataN.sensitivity ?? null) : null,
    sensitivityLabel: dataN ? sensitivityLabel(dataN.sensitivity ?? null) : null,
    found,
  }

  const { stackOfComponent, stackOfBoundary, boundaryById } = makeStackResolver(mg)

  // Boundary context — the ancestor stack (innermost-first) + each boundary's own
  // posture. A Component walks from its containing boundary; a SecurityBoundary
  // walks from itself (its own context includes itself); Data / DataFlow have no
  // direct boundary membership ⇒ no stack.
  let stack = []
  if (type === 'Component') stack = stackOfComponent(elementId)
  else if (type === 'SecurityBoundary') stack = stackOfBoundary(elementId)
  const boundaryContext = stack
    .filter((b) => b !== ROOT)
    .map((bid) => {
      const p = postureOf(ledgerById.get(bid))
      const bnode = boundaryById.get(bid)
      const ez = effectiveZoneOf(bid)
      return {
        id: bid,
        name: bnode?.name ?? '(unknown boundary)',
        liveCount: p.liveCount,
        worstBand: p.worstBand,
        hasControl: p.hasControl,
        // Declared trust-zoning context per ancestor boundary. `zone` is the resolved
        // effective zone (null when the snapshot has no zoning block); `planes`/`domains`
        // are the boundary's own declared tags (empty when untagged).
        zone: ez?.zone ?? null,
        zoneSource: ez?.source ?? null, // 'declared' | 'inherited' | 'default'
        planes: Array.isArray(bnode?.planes) ? bnode.planes : [],
        domains: Array.isArray(bnode?.domains) ? bnode.domains : [],
      }
    })

  // The element's own exposure posture — identical partition to the Residual Risk view.
  const own = singleGroup(ledgerEl)
  const ownUncovered = own.supportingControls.length === 0
  const ownExposures = {
    live: own.live,
    dispositioned: own.dispositioned,
    liveCount: own.liveCount,
    dispositionedCount: own.dispositionedCount,
    uncovered: ownUncovered, // coarse element-level proxy: no supporting control
    // Honesty for the coarse model: an element WITH a control AND live exposures
    // is NOT "covered" — this element-level proxy has no control→exposure edge, so
    // whether the control mitigates these exposures is simply unknown. Surface that,
    // so the absence of an "uncovered" flag is never misread as "covered".
    controlRelevanceUnassessed: !ownUncovered && own.liveCount > 0,
    compensatingClaimNoControl: own.compensatingClaimNoControl,
  }

  // Data sub-block — each Data this element HANDLES, with its sensitivity and its
  // OWN exposures (joined from the ledger). Coverage stays attributed to the
  // handling element (this one), never to the Data node. Sorted by sensitivity
  // rank desc, then name. (For a Data target this is empty — the element IS the
  // data; its exposures show in ownExposures.)
  const dataHandled = dataNodes
    .filter((d) => Array.isArray(d.handledBy) && d.handledBy.includes(elementId))
    .map((d) => {
      const g = singleGroup(ledgerById.get(d.id))
      return {
        id: d.id,
        name: d.name ?? '(unnamed)',
        sensitivity: d.sensitivity ?? null,
        sensitivityLabel: sensitivityLabel(d.sensitivity ?? null),
        live: g.live,
        dispositioned: g.dispositioned,
        liveCount: g.liveCount,
        dispositionedCount: g.dispositionedCount,
      }
    })
    .sort((a, b) => {
      const r = (SENSITIVITY_RANK[b.sensitivity] ?? 0) - (SENSITIVITY_RANK[a.sensitivity] ?? 0)
      if (r !== 0) return r
      return String(a.name).localeCompare(String(b.name))
    })

  // Cross-type id → display name (every element class), reused by the handled-by
  // resolver below and the 1-hop neighbour resolver further down.
  const nameById = new Map([
    ...components.map((c) => [c.id, c.name]),
    ...boundaries.map((b) => [b.id, b.name]),
    ...dataNodes.map((d) => [d.id, d.name]),
    ...ledgerArr.map((e) => [e.id, e.name]),
  ])

  // Inverse of the data sub-block: for a DATA target, the elements that HANDLE it
  // (its `handledBy` topology) — components / data flows / security boundaries —
  // each with its own posture, drillable to its Component Profile. This is the
  // relational context a Data profile would otherwise lack (the forward
  // `dataHandled` block above covers
  // the handling element → its Data; this covers Data → its handlers). A
  // since-removed handler that no longer resolves is marked so the view renders it
  // non-clickable rather than a dead link. Empty for non-Data targets.
  const typeOfId = (id) =>
    ledgerById.get(id)?.type ??
    (components.some((c) => c.id === id)
      ? 'Component'
      : boundaries.some((b) => b.id === id)
        ? 'SecurityBoundary'
        : dataNodes.some((d) => d.id === id)
          ? 'Data'
          : flows.some((f) => f.id === id)
            ? 'DataFlow'
            : '(unknown)')
  let handledByElements = []
  if (type === 'Data' && dataN && Array.isArray(dataN.handledBy)) {
    const seen = new Set()
    for (const hid of dataN.handledBy) {
      if (!hid || seen.has(hid)) continue
      seen.add(hid)
      const p = postureOf(ledgerById.get(hid))
      handledByElements.push({
        id: hid,
        name: nameById.get(hid) ?? '(not in snapshot)',
        type: typeOfId(hid),
        resolved: nameById.has(hid),
        liveCount: p.liveCount,
        worstBand: p.worstBand,
        hasControl: p.hasControl,
      })
    }
    handledByElements.sort(
      (a, b) =>
        String(a.type).localeCompare(String(b.type)) ||
        String(a.name).localeCompare(String(b.name)),
    )
  }

  // 1-hop flow neighbours. For a Component: every flow with this element as an
  // endpoint → the OTHER endpoint, with direction + carried sensitivity. For a
  // DataFlow target: its two endpoints. Boundary / Data ⇒ none (flows connect
  // components). Each neighbour is drillable to its own Component Profile — UNLESS it can't be
  // resolved in the snapshot (a since-removed / non-component endpoint), in which
  // case it's marked unresolved so the view renders it as non-clickable rather
  // than a dead "(unknown)" link. Resolve across every element type, not just
  // components, so a boundary/data endpoint isn't silently mislabeled (uses the
  // `nameById` map built above).
  const resolveNeighbour = (id) => ({
    id,
    name: nameById.get(id) ?? '(not in snapshot)',
    resolved: nameById.has(id),
  })
  let neighbours = []
  if (type === 'Component') {
    for (const f of flows) {
      let direction = null
      let neighbourId = null
      if (f.sourceId === elementId && f.targetId) {
        direction = 'outbound'
        neighbourId = f.targetId
      } else if (f.targetId === elementId && f.sourceId) {
        direction = 'inbound'
        neighbourId = f.sourceId
      }
      if (!neighbourId) continue
      const nb = resolveNeighbour(neighbourId)
      neighbours.push({
        flowId: f.id,
        flowName: f.name ?? '',
        direction,
        neighbourId,
        neighbourName: nb.name,
        neighbourResolved: nb.resolved,
        sensitivities: Array.isArray(f.sensitivities) ? f.sensitivities : [],
        maxSensitivity: maxSensitivity(f.sensitivities),
        sensitivityLabel: sensitivityLabel(maxSensitivity(f.sensitivities)),
      })
    }
  } else if (type === 'DataFlow' && flow) {
    for (const [dir, nid] of [
      ['source', flow.sourceId],
      ['target', flow.targetId],
    ]) {
      if (!nid) continue
      const nb = resolveNeighbour(nid)
      neighbours.push({
        flowId: flow.id,
        flowName: flow.name ?? '',
        direction: dir,
        neighbourId: nid,
        neighbourName: nb.name,
        neighbourResolved: nb.resolved,
        sensitivities: Array.isArray(flow.sensitivities) ? flow.sensitivities : [],
        maxSensitivity: maxSensitivity(flow.sensitivities),
        sensitivityLabel: sensitivityLabel(maxSensitivity(flow.sensitivities)),
      })
    }
  }
  neighbours.sort(
    (a, b) => String(a.direction).localeCompare(String(b.direction)) ||
      String(a.neighbourName).localeCompare(String(b.neighbourName)),
  )

  // Minimap highlight, routed to the channel that matches what's actually drawn:
  //   - Component         → its node (highlightIds)
  //   - DataFlow          → its two endpoints (nodes) + its own edge (the line)
  //   - SecurityBoundary  → its rectangle (boundaries are rects, not nodes)
  //   - Data              → it has no shape of its own, so highlight the elements
  //                         that HANDLE it, each on its matching channel
  //                         (components→nodes, flows→edges, boundaries→rects).
  let highlightIds, highlightEdgeIds, highlightBoundaryIds
  if (type === 'DataFlow' && flow) {
    highlightIds = [flow.sourceId, flow.targetId].filter(Boolean)
    highlightEdgeIds = [elementId]
    highlightBoundaryIds = []
  } else if (type === 'SecurityBoundary') {
    highlightIds = []
    highlightEdgeIds = []
    highlightBoundaryIds = [elementId]
  } else if (type === 'Data') {
    highlightIds = handledByElements.filter((h) => h.type === 'Component').map((h) => h.id)
    highlightEdgeIds = handledByElements.filter((h) => h.type === 'DataFlow').map((h) => h.id)
    highlightBoundaryIds = handledByElements.filter((h) => h.type === 'SecurityBoundary').map((h) => h.id)
  } else {
    highlightIds = [elementId]
    highlightEdgeIds = []
    highlightBoundaryIds = []
  }

  // Trust-zoning detail for a SecurityBoundary target: the resolved effective zone + its
  // source (declared / inherited-from / default), the boundary's declared planes + domains,
  // and its declared conduits (approved channels) — OUTBOUND (this boundary → peer) plus the
  // INBOUND mirror (peers that declare a conduit reaching this boundary), each drillable. This
  // is the per-boundary counterpart to the per-flow policy in Boundary Crossings; declared
  // intent, never an enforced permission. Null for non-boundary targets.
  let zoningDetail = null
  if (type === 'SecurityBoundary' && bound) {
    const ez = effectiveZoneOf(elementId)
    const outboundConduits = (Array.isArray(bound.conduits) ? bound.conduits : [])
      .filter((c) => c?.peerId && c.direction === 'OUTBOUND')
      .map((c) => ({
        peerId: c.peerId,
        peerName: boundaryById.get(c.peerId)?.name ?? '(not in snapshot)',
        peerResolved: boundaryById.has(c.peerId),
        justification: c.justification ?? null,
      }))
      .sort(byPeerName)
    const inboundConduits = []
    for (const ob of boundaries) {
      if (ob.id === elementId) continue
      for (const c of ob.conduits ?? []) {
        if (c?.direction === 'OUTBOUND' && c.peerId === elementId) {
          inboundConduits.push({
            peerId: ob.id,
            peerName: ob.name ?? '(unknown boundary)',
            peerResolved: true,
            justification: c.justification ?? null,
          })
        }
      }
    }
    inboundConduits.sort(byPeerName)
    zoningDetail = {
      effectiveZone: ez?.zone ?? null,
      zoneSource: ez?.source ?? null, // 'declared' | 'inherited' | 'default' | null (no zoning block)
      inheritedFromId: ez?.from ?? null,
      inheritedFromName: ez?.from ? (boundaryById.get(ez.from)?.name ?? null) : null,
      declaredZone: bound.zone ?? null, // raw declaration (null ⇒ inherited/default)
      planes: Array.isArray(bound.planes) ? bound.planes : [],
      domains: Array.isArray(bound.domains) ? bound.domains : [],
      outboundConduits,
      inboundConduits,
    }
  }

  return {
    element,
    boundaryContext,
    zoning: zoningDetail,
    ownExposures,
    dataHandled,
    handledByElements,
    controls: own.supportingControls,
    neighbours,
    highlightIds,
    highlightEdgeIds,
    highlightBoundaryIds,
  }
}
