// frontend/lib/componentProfile.js — the ⑥ Component Profile synthesis.
//
// ⑥ is a DRILL TARGET, not a top-level report (func §6.⑥): it earns its place by
// SYNTHESISING residual risk per element rather than re-skinning the canvas
// inspector. Reachable for a Component, a SecurityBoundary, or a Data node (all
// finding-bearing) — same drill, applied to whichever element. Pure composition
// over the snapshot doc (`ledger` + `modelGraph`, both gathered at generate
// time) — no Vue, no network, unit-tested.
//
// Reuse, not reinvention: the ancestor-boundary stack comes from the SAME
// `makeStackResolver` ③ uses (cycle / dangling-parent handling included), and
// the per-element exposure partition + control consistency come from
// `aggregateLedger` (run over the single element) — so ⑥'s posture is identical
// to ④'s by construction. The data sub-block joins `modelGraph.dataNodes`
// (HANDLES topology + sensitivity, gathered backend-side) to each Data's OWN
// ledger exposures; coverage is attributed to the handling element (func §6.④),
// never to the Data node. Controls are muted defense-in-depth context — the
// technique-set intent partition needs the P2 coverage engine and is NOT here.

import { aggregateLedger } from './aggregateLedger.js'
import {
  makeStackResolver,
  postureOf,
  ROOT,
  maxSensitivity,
  sensitivityLabel,
  SENSITIVITY_RANK,
} from './boundaryCrossings.js'

// Aggregate a single ledger element through the ④ aggregator and return its
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
 * Synthesise the ⑥ profile for an element.
 *
 * @param {string} elementId
 * @param {{ ledger: Array, modelGraph: object }} doc
 * @returns {object} the ⑥ view model (see fields below)
 */
export function computeComponentProfile(elementId, { ledger, modelGraph } = {}) {
  const mg = modelGraph && typeof modelGraph === 'object' ? modelGraph : {}
  const components = Array.isArray(mg.components) ? mg.components : []
  const boundaries = Array.isArray(mg.boundaries) ? mg.boundaries : []
  const flows = Array.isArray(mg.flows) ? mg.flows : []
  const dataNodes = Array.isArray(mg.dataNodes) ? mg.dataNodes : []
  const ledgerArr = Array.isArray(ledger) ? ledger : []
  const ledgerById = new Map(ledgerArr.map((e) => [e.id, e]))

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

  const element = {
    id: elementId,
    name,
    type,
    crownJewel: comp?.crownJewel === true,
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
      return {
        id: bid,
        name: boundaryById.get(bid)?.name ?? '(unknown boundary)',
        liveCount: p.liveCount,
        worstBand: p.worstBand,
        hasControl: p.hasControl,
      }
    })

  // The element's own exposure posture — identical partition to ④.
  const own = singleGroup(ledgerEl)
  const ownUncovered = own.supportingControls.length === 0
  const ownExposures = {
    live: own.live,
    dispositioned: own.dispositioned,
    liveCount: own.liveCount,
    dispositionedCount: own.dispositionedCount,
    uncovered: ownUncovered, // coarse element-level proxy: no supporting control
    // Honesty for the coarse model: an element WITH a control AND live exposures
    // is NOT "covered" — P1 has no control→exposure edge, so whether the control
    // mitigates these exposures is simply unknown. Surface that, so the absence
    // of an "uncovered" flag is never misread as "covered".
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
        name: d.name,
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

  // 1-hop flow neighbours. For a Component: every flow with this element as an
  // endpoint → the OTHER endpoint, with direction + carried sensitivity. For a
  // DataFlow target: its two endpoints. Boundary / Data ⇒ none (flows connect
  // components). Each neighbour is drillable to its own ⑥ — UNLESS it can't be
  // resolved in the snapshot (a since-removed / non-component endpoint), in which
  // case it's marked unresolved so the view renders it as non-clickable rather
  // than a dead "(unknown)" link. Resolve across every element type, not just
  // components, so a boundary/data endpoint isn't silently mislabeled.
  const nameById = new Map([
    ...components.map((c) => [c.id, c.name]),
    ...boundaries.map((b) => [b.id, b.name]),
    ...dataNodes.map((d) => [d.id, d.name]),
    ...ledgerArr.map((e) => [e.id, e.name]),
  ])
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

  return {
    element,
    boundaryContext,
    ownExposures,
    dataHandled,
    controls: own.supportingControls,
    neighbours,
    highlightIds: [elementId],
  }
}
