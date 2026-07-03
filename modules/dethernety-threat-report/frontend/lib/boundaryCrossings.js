// frontend/lib/boundaryCrossings.js — the Boundary-Crossing engine.
//
// Pure presentation logic over the snapshot doc's `modelGraph` (topology +
// geometry + per-flow carried sensitivity, gathered backend-side) joined with
// the RAW `ledger` (every element's findings + supporting controls — reused for
// on-flow and crossed-boundary posture, so this engine needs no separate posture
// query). No Vue, no network — pure functions, unit-tested with fixtures.
//
// Boundary Crossings has TWO layers, kept distinct:
//   - STRUCTURAL (membranes): the symmetric difference of the two endpoints'
//     ancestor-boundary stacks. Direction is containment (EXIT/ENTER), never a
//     trust comparison; membranes carry the crossed boundary's own posture.
//   - POLICY (per flow): the DECLARED-zone data-flow verdict from
//     evaluateDataFlowPolicy (zoningPolicy.js) — one zone-pair per flow, judged
//     against the operator's declared zones/domains/planes/conduits. A verdict
//     means "the model as drawn encodes an illegal crossing," NOT "we verified the
//     flow cannot occur." Verdict severity is the PRIMARY worklist rank (a
//     violation on an unclassified flow must surface, not sink), with the data
//     sensitivity + boundary posture as secondary signals. Still no single risk
//     score, no coverage %.

import { isLive, scoreBand } from './aggregateLedger.js'
import { evaluateDataFlowPolicy } from './zoningPolicy.js'

// SensitivityLevel ordering (schema enum). null/absent ⇒ unknown (rank 0) —
// NEVER silently treated as low; an unclassified flow in motion is a modeling
// gap surfaced as a flag, not a safe crossing.
export const SENSITIVITY_RANK = { PUBLIC: 1, INTERNAL: 2, CONFIDENTIAL: 3, RESTRICTED: 4 }
export const SENSITIVITY_LABELS = {
  PUBLIC: 'Public',
  INTERNAL: 'Internal',
  CONFIDENTIAL: 'Confidential',
  RESTRICTED: 'Restricted',
}

const BAND_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 }

// Synthetic root sentinel: every ancestor stack terminates here (orphan ⇒
// [ROOT]) so the symmetric diff is well-defined for orphan↔nested and
// orphan↔orphan flows. Because ROOT is in BOTH stacks it is never in the
// symmetric difference — it is excluded from emitted rows by construction
// (we also filter it defensively).
export const ROOT = '__ROOT__'

// Cap displayed membrane rows per flow in the worklist (the UI concern on
// deeply-nested models — compute is cheap, row count is not). When a flow
// crosses more than this, keep the INNERMOST membranes on each side and collapse
// the OUTER shared-context ones.
const MAX_MEMBRANES_PER_FLOW = 6

/**
 * The highest-rank sensitivity in a list, or null if none known.
 * @param {string[]} sensitivities
 * @returns {string|null}
 */
export function maxSensitivity(sensitivities) {
  let best = null
  let bestRank = 0
  for (const s of sensitivities ?? []) {
    const r = SENSITIVITY_RANK[s] ?? 0
    if (r > bestRank) {
      bestRank = r
      best = s
    }
  }
  return best
}

/**
 * Build a memoized resolver for component → ancestor-boundary stack
 * (INNERMOST-first; synthetic ROOT last). Walks the single `parentBoundaryId`
 * chain with a defensive visited-set: on a repeated boundary it TRUNCATES at the
 * first repeat and records the truncation (never a silent drop — this resolution
 * is the single source for the diff; a silent corruption would hit every
 * consumer identically).
 *
 * Exported so the Component Profile reuses the EXACT same ancestor walk (cycle /
 * dangling-parent handling included) rather than re-implementing it — the stack
 * is the single structural truth shared by the Boundary Crossings and Component
 * Profile engines.
 */
export function makeStackResolver(modelGraph) {
  const boundaryById = new Map((modelGraph.boundaries ?? []).map((b) => [b.id, b]))
  const componentById = new Map((modelGraph.components ?? []).map((c) => [c.id, c]))
  const cache = new Map()
  const truncatedBoundaries = new Set()

  const danglingParents = new Set()
  const stackOfBoundaryId = (startId) => {
    const chain = [] // innermost → outer
    const visited = new Set()
    let cursor = startId
    while (cursor != null) {
      if (visited.has(cursor)) {
        truncatedBoundaries.add(cursor)
        break // cycle — truncate at the first repeat
      }
      visited.add(cursor)
      const b = boundaryById.get(cursor)
      if (!b) {
        // Dangling parent ref (id not in the boundary set) — malformed data,
        // same class of corruption as a cycle: the true ancestors above this id
        // are lost. Record it for a completeness flag (never a silent drop) and
        // stop the walk (treated as reaching root for the diff).
        danglingParents.add(cursor)
        break
      }
      chain.push(cursor)
      cursor = b.parentBoundaryId ?? null
    }
    // innermost-first, ROOT appended as the outermost sentinel
    return [...chain, ROOT]
  }

  const stackOfComponent = (componentId) => {
    if (cache.has(componentId)) return cache.get(componentId)
    const comp = componentById.get(componentId)
    const stack = stackOfBoundaryId(comp?.boundaryId ?? null)
    cache.set(componentId, stack)
    return stack
  }

  return {
    stackOfComponent,
    // Ancestor stack starting AT a boundary (the boundary itself + its ancestors,
    // innermost-first, ROOT last) — the Component Profile uses this for a
    // SecurityBoundary target's own boundary context.
    stackOfBoundary: stackOfBoundaryId,
    boundaryById,
    componentById,
    truncatedBoundaries,
    danglingParents,
  }
}

/** Posture lens over a raw ledger element (or undefined): live findings, the
 *  worst live score band, and whether a supporting control is present. */
export function postureOf(ledgerEl) {
  const findings = ledgerEl?.findings ?? []
  const live = findings.filter(isLive)
  let worstBand = 'unknown'
  let worstRank = -1
  for (const f of live) {
    const band = scoreBand(f.score)
    const rank = BAND_RANK[band] ?? 0
    if (rank > worstRank) {
      worstRank = rank
      worstBand = band
    }
  }
  return {
    liveCount: live.length,
    worstBand: live.length ? worstBand : null,
    hasControl: (ledgerEl?.supportingControls ?? []).length > 0,
  }
}

// Ranking tuple (no trust, no score): max sensitivity carried, on-flow live
// exposure band, crossed-boundary live exposure present, crossed-boundary
// covering-control ABSENT, on-flow supporting-control ABSENT. Higher = louder.
// Applied at the FLOW level using the worst (max) per-membrane boundary signals.
function flowRankKey(g) {
  let worstBoundaryLive = 0
  let worstControlAbsent = 0
  for (const m of g.membranes) {
    if (m.boundaryLiveCount > 0) worstBoundaryLive = 1
    if (!m.boundaryHasControl) worstControlAbsent = 1
  }
  // Verdict severity is the PRIMARY term (correctness, not cosmetic): a policy
  // violation can ride on a flow with NO data classification and must surface to
  // the top, not sink into the muted tail behind classified-but-allowed flows.
  // NB: remaining term positions intentionally mix scales — the sensitivity term is
  // a rank (0–4), the rest are presence bits (0/1). Lexicographic comparison never
  // weighs one term against another, so the mix is safe. Do NOT "normalise" a rank
  // term to a presence bit — it would silently flatten ranking.
  return [
    g.verdictRank ?? 0, // policy severity: violation(3) > warning(2) > advisory(1) > allowed/none(0)
    SENSITIVITY_RANK[g.maxSensitivity] ?? 0, // unknown ⇒ 0 (sorts low, never "low")
    g.flowLiveCount > 0 ? BAND_RANK[g.flowWorstBand] ?? 0 : 0,
    worstBoundaryLive,
    worstControlAbsent,
    g.flowHasControl ? 0 : 1,
  ]
}

// Does the worklist carry ANY signal that the ranking tuple can actually order
// by (a known sensitivity, an on-flow/boundary exposure, or a control)? If not
// — e.g. a model where data is modeled but unclassified and no exposures exist —
// every tuple is identical and the "ranked" order is just the flow-name
// tiebreaker. The view uses this to drop the misleading ranked framing.
function worklistHasDifferentiator(crossings) {
  return crossings.some(
    (g) =>
      (g.verdictRank ?? 0) > 0 ||
      (SENSITIVITY_RANK[g.maxSensitivity] ?? 0) > 0 ||
      g.flowLiveCount > 0 ||
      g.flowHasControl ||
      g.membranes.some((m) => m.boundaryLiveCount > 0 || m.boundaryHasControl),
  )
}

function byFlowRankDesc(a, b) {
  const ka = flowRankKey(a)
  const kb = flowRankKey(b)
  for (let i = 0; i < ka.length; i++) {
    if (kb[i] !== ka[i]) return kb[i] - ka[i]
  }
  return String(a.flowName).localeCompare(String(b.flowName))
}

/**
 * Compute the boundary-crossing ledger, GROUPED BY FLOW so each flow's
 * containment story stays intact (the whole point of the operational EXIT/ENTER
 * ordering). Partition is flow-level: a flow is in the worklist if ANY of its
 * membranes is signal-bearing (carries classified data, OR a live on-flow /
 * crossed-boundary exposure, OR a control present); a flow whose every membrane
 * has zero data + zero exposure + zero control falls to the under-modeled tail
 * (present, never green, never dropped). Worklist flows are ranked by their worst
 * membrane's tuple.
 *
 * A flow is also in the worklist if it carries a POLICY verdict (warning /
 * violation / advisory) even with zero structural signal — the declared-zone
 * policy is a first-class reason to surface a crossing. Allowed + zero-signal
 * flows fall to the single muted tail.
 *
 * @param {{boundaries:Array,components:Array,flows:Array}} modelGraph
 * @param {Array} ledger  the RAW snapshot `ledger` (LedgerElement[])
 * @param {{effectiveZones?:Object}} [zoning]  the snapshot zoning block (declared effective zones)
 * @returns {{ crossings, underModeled, underModeledCount, worklistUnranked, totals, flags,
 *             conduitErrors, deadConduits, policy }}
 *   crossings: worklist flow groups (signal- OR verdict-bearing), ranked desc.
 *   underModeled: allowed + zero-signal flow groups (one muted tail).
 *   worklistUnranked: worklist exists but nothing differentiates its ranking.
 *   totals: { crossingFlows, membranes, signalFlows, underModeledFlows, hiddenByCap }
 *   conduitErrors: declared conduits authorizing an illegal crossing.
 *   deadConduits: legally-declared conduits with no matching modeled flow (dead intent).
 *   policy: { fails, violations, warnings, advisories } (per-flow verdict rollup).
 *   flags: completeness flags ({ key, label, severity }).
 */
export function computeCrossings(modelGraph, ledger, zoning) {
  const mg = modelGraph && typeof modelGraph === 'object' ? modelGraph : {}
  const boundaries = Array.isArray(mg.boundaries) ? mg.boundaries : []
  const flows = Array.isArray(mg.flows) ? mg.flows : []
  const ledgerById = new Map((Array.isArray(ledger) ? ledger : []).map((e) => [e.id, e]))

  // Declared-zone data-flow policy — per-flow verdicts keyed by flowId, computed
  // over the same modelGraph + the snapshot's declared effective zones.
  const { byFlow: verdictByFlow, conduitErrors, deadConduits, rollup } = evaluateDataFlowPolicy(mg, zoning)

  const { stackOfComponent, boundaryById, truncatedBoundaries, danglingParents } =
    makeStackResolver(mg)

  const groups = [] // one per flow that crosses ≥1 membrane
  let membraneCount = 0
  let unclassifiedInMotion = 0
  let hiddenByCap = 0

  for (const flow of flows) {
    if (!flow.sourceId || !flow.targetId) continue // dangling endpoint — not a crossing
    const stackSrc = stackOfComponent(flow.sourceId)
    const stackDst = stackOfComponent(flow.targetId)
    const setSrc = new Set(stackSrc)
    const setDst = new Set(stackDst)

    // EXIT = stackSrc \ stackDst, in stackSrc order (innermost-first).
    const exit = stackSrc.filter((b) => b !== ROOT && !setDst.has(b))
    // ENTER = stackDst \ stackSrc, in reverse stackDst order (outermost-first).
    const enter = stackDst.filter((b) => b !== ROOT && !setSrc.has(b)).reverse()

    if (exit.length === 0 && enter.length === 0) continue // shares all membranes — no crossing

    const flowSensitivities = Array.isArray(flow.sensitivities) ? flow.sensitivities : []
    const topSensitivity = maxSensitivity(flowSensitivities)
    const sensitivityKnown = topSensitivity != null
    const unclassified = !sensitivityKnown && (flow.dataItemCount ?? 0) > 0
    if (unclassified) unclassifiedInMotion++

    const flowPosture = postureOf(ledgerById.get(flow.id))

    const ordered = [
      ...exit.map((b) => ({ boundaryId: b, direction: 'EXIT' })),
      ...enter.map((b) => ({ boundaryId: b, direction: 'ENTER' })),
    ]

    // A flow CARRIES DATA if it has any data items — classified OR not. The
    // under-modeled tail is "zero data AND zero exposures AND zero controls",
    // so a flow carrying *unclassified* data is NOT under-modeled:
    // it is a flagged modeling gap that belongs in the worklist (it ranks low —
    // unknown sensitivity — but it is surfaced, not buried in a muted accordion).
    const carriesData = (flow.dataItemCount ?? 0) > 0

    let membranes = ordered.map((m) => {
      const bPosture = postureOf(ledgerById.get(m.boundaryId))
      const boundary = boundaryById.get(m.boundaryId)
      const signal =
        carriesData ||
        flowPosture.liveCount > 0 ||
        flowPosture.hasControl ||
        bPosture.liveCount > 0 ||
        bPosture.hasControl
      return {
        direction: m.direction,
        boundaryId: m.boundaryId,
        boundaryName: boundary?.name ?? '(unknown boundary)',
        boundaryLiveCount: bPosture.liveCount,
        boundaryHasControl: bPosture.hasControl,
        signal,
      }
    })
    membraneCount += membranes.length

    // Per-flow display cap: keep the innermost membranes on each side, collapse
    // the outer shared-context ones in the middle (EXIT is innermost-first,
    // ENTER outermost-first ⇒ innermost membranes sit at the two ends).
    let cappedHidden = 0
    if (membranes.length > MAX_MEMBRANES_PER_FLOW) {
      const head = Math.ceil(MAX_MEMBRANES_PER_FLOW / 2)
      const tail = MAX_MEMBRANES_PER_FLOW - head
      cappedHidden = membranes.length - MAX_MEMBRANES_PER_FLOW
      hiddenByCap += cappedHidden
      membranes = [...membranes.slice(0, head), ...membranes.slice(membranes.length - tail)]
    }

    // Per-flow declared-zone policy verdict (null when the flow doesn't cross a
    // zone boundary the policy judges — e.g. intra-boundary or a down-gradient
    // response). `escalated` = a warning / violation / advisory (rank > 0); an
    // allowed / no verdict does not escalate a flow out of the muted tail.
    const verdict = verdictByFlow[flow.id] ?? null
    const verdictRank = verdict?.verdictRank ?? 0

    groups.push({
      flowId: flow.id,
      flowName: flow.name ?? '',
      sourceId: flow.sourceId,
      targetId: flow.targetId,
      maxSensitivity: topSensitivity, // null ⇒ unknown (rendered "unknown", never "low")
      sensitivityKnown,
      unclassifiedInMotion: unclassified,
      flowLiveCount: flowPosture.liveCount,
      flowWorstBand: flowPosture.worstBand,
      flowHasControl: flowPosture.hasControl,
      membranes,
      hiddenMembranes: cappedHidden,
      verdict,
      verdictRank,
      escalated: verdictRank > 0,
      signal: membranes.some((m) => m.signal),
    })
  }

  // Worklist = structural signal OR a policy escalation; one muted tail for the rest.
  const crossings = groups.filter((g) => g.signal || g.escalated).sort(byFlowRankDesc)
  const underModeled = groups.filter((g) => !(g.signal || g.escalated)).sort(byFlowRankDesc)

  const flags = []
  if (boundaries.length === 0) {
    flags.push({
      key: 'no-boundaries',
      label: 'No security boundaries modeled — boundary-crossing analysis not applicable',
      severity: 'warning',
    })
  }
  if (unclassifiedInMotion > 0) {
    flags.push({
      key: 'unclassified-in-motion',
      label: `${unclassifiedInMotion} flow${unclassifiedInMotion === 1 ? '' : 's'} carry unclassified data across a boundary (a modeling gap, not a safe crossing)`,
      severity: 'warning',
    })
  }
  if (truncatedBoundaries.size > 0) {
    flags.push({
      key: 'nesting-cycle',
      label: 'Boundary nesting cycle detected — ancestor resolution was truncated; crossings may be incomplete',
      severity: 'error',
    })
  }
  if (danglingParents.size > 0) {
    flags.push({
      key: 'dangling-parent',
      label: 'A boundary references a missing parent — ancestor resolution was truncated; crossings may be incomplete',
      severity: 'error',
    })
  }

  // Per-flow verdict rollup for the summary line (counts, never a score).
  const policy = { fails: rollup?.fails ?? false, violations: 0, warnings: 0, advisories: 0 }
  for (const g of groups) {
    if (g.verdict?.verdict === 'violation') policy.violations++
    else if (g.verdict?.verdict === 'warning') policy.warnings++
    else if (g.verdict?.verdict === 'advisory') policy.advisories++
  }

  return {
    crossings,
    underModeled,
    underModeledCount: underModeled.length,
    // True when the worklist exists but nothing in it can be meaningfully ranked
    // (no verdict, no known sensitivity, no exposures, no controls anywhere) — the
    // view drops the "ranked" framing and states the order is just by name.
    worklistUnranked: crossings.length > 0 && !worklistHasDifferentiator(crossings),
    // Declared conduits authorizing an illegal crossing (dead or live) — the
    // fail-closed allowlist surface, rendered separately from the per-flow worklist.
    conduitErrors: conduitErrors ?? [],
    // Legally-declared conduits with no matching modeled flow (dead intent — a
    // muted review surface, never alarming).
    deadConduits: deadConduits ?? [],
    policy,
    totals: {
      crossingFlows: groups.length,
      membranes: membraneCount,
      signalFlows: crossings.length,
      underModeledFlows: underModeled.length,
      hiddenByCap,
    },
    flags,
  }
}

/** Label for a sensitivity value; null ⇒ "unknown" (never "low"). */
export function sensitivityLabel(level) {
  if (level == null) return 'unknown'
  return SENSITIVITY_LABELS[level] ?? level
}

/**
 * Sensitivity chip for a DATA ITEM that exists (a named Data node, or the data a
 * flow/element handles). Because the item is definitely present, a null/absent
 * level is an UNCLASSIFIED modeling gap — surfaced as the amber "unclassified"
 * chip, NOT the neutral grey "unknown" (which means "no information"). This mirrors
 * the Boundary Crossings "unclassified data in motion" treatment so every per-item
 * sensitivity chip reads consistently across the report.
 *
 * @param {?string} level a SensitivityLevel value, or null/undefined
 * @returns {{ label: string, key: string }} key feeds the `.trd-sens--<key>` class
 */
export function dataItemSensitivity(level) {
  if (level == null) return { label: 'unclassified', key: 'unclassified' }
  return { label: sensitivityLabel(level), key: String(level).toLowerCase() }
}
