// frontend/lib/postureSummary.js — the Posture Summary roll-up.
//
// Posture Summary is the only aggregating surface and the default landing view.
// It is pure COMPOSITION over already-computed engines — `aggregateLedger`
// (Residual Risk) for exposure bands / dispositions / controls and
// `computeCrossings` (Boundary Crossings) for boundary-crossing counts — so it
// introduces no new analysis, only a roll-up. No Vue, no network — pure,
// unit-tested.
//
// Honesty contracts: NO single risk score, NO coverage %, NO "Covered: N"
// aggregate; live-exposure bands are LIVE-only; null score ⇒ unknown (never
// low); defense-in-depth controls are a SEPARATE positive line, never folded
// into coverage. This roll-up emits exposure bands, dispositions, boundary-
// crossing counts, defense-in-depth, and top residuals; it does not emit a
// coverage block or a crown-jewel reachability tile.

import { aggregateLedger, isLive, BAND_RANK } from './aggregateLedger.js'

const TOP_RESIDUALS_LIMIT = 6

function emptyBands() {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
}

/**
 * Roll up the snapshot into the Posture Summary view model.
 *
 * @param {Array} ledger  the raw snapshot `ledger` (LedgerElement[])
 * @param {object} [opts]
 * @param {object} [opts.crossings]  the computeCrossings(...) result (reused, not recomputed)
 * @returns {{
 *   liveBands, liveTotal, disposition, boundaryCrossings, defenseInDepth,
 *   topResiduals, hasElements, hasLiveFindings, hasAnyFindings
 * }}
 */
export function computePostureSummary(ledger, opts = {}) {
  const els = Array.isArray(ledger) ? ledger : []
  const { totals, groups } = aggregateLedger(els)
  const crossings = opts.crossings ?? null

  // Hollow risk acceptances: elements whose dispositions claim a compensating
  // control while NO control is present (already audited per-element by
  // aggregateLedger). The summary surfaces the count — a dropped one on the
  // landing screen hides exactly the disposition a reviewer most needs to
  // re-examine.
  const compensatingNoControl = groups.filter((g) => g.compensatingClaimNoControl).length

  // Live-only exposure bands — derived from the annotated live findings, NOT
  // totals.byBand (which counts dispositioned findings too). null score ⇒
  // unknown, never low (the band annotation already enforces this).
  const liveBands = emptyBands()
  let liveTotal = 0
  for (const g of groups) {
    for (const f of g.live) {
      liveBands[f.band] = (liveBands[f.band] ?? 0) + 1
      liveTotal++
    }
  }

  // Defense-in-depth: distinct supporting controls on elements that have NO live
  // exposure — i.e. controls present that aren't compensating a modeled live
  // exposure (the honest coarse reading; there is no control→exposure edge, so
  // this is element-level, consistent with Boundary Crossings / Residual Risk).
  // Iterates the RAW ledger because
  // these elements are typically finding-free (aggregateLedger's groups drop
  // finding-free elements). NEVER folded into a coverage number.
  const didControls = new Set()
  let didElements = 0
  for (const el of els) {
    const live = (el.findings ?? []).filter(isLive)
    if (live.length > 0) continue
    const controls = el.supportingControls ?? []
    if (controls.length === 0) continue
    didElements++
    for (const c of controls) didControls.add(c.id)
  }

  // Top residual risks — the ranked live findings across all elements (band desc,
  // score desc, name), each an in-component deep-link to Residual Risk (filtered)
  // or Component Profile. `uncovered` is the coarse proxy: the element carries no
  // supporting control.
  const residuals = []
  for (const g of groups) {
    const uncovered = (g.supportingControls ?? []).length === 0
    for (const f of g.live) {
      residuals.push({
        elementId: g.id,
        elementName: g.name,
        elementType: g.type,
        findingId: f.id,
        findingName: f.name,
        attackVector: f.attackVector ?? null,
        band: f.band,
        score: f.score,
        stale: f.stale,
        uncovered,
      })
    }
  }
  residuals.sort((a, b) => {
    const r = (BAND_RANK[b.band] ?? 0) - (BAND_RANK[a.band] ?? 0)
    if (r !== 0) return r
    const s = (b.score ?? -1) - (a.score ?? -1)
    if (s !== 0) return s
    return String(a.findingName).localeCompare(String(b.findingName))
  })
  const topResiduals = residuals.slice(0, TOP_RESIDUALS_LIMIT)

  const boundaryCrossings = crossings
    ? {
        signalFlows: crossings.totals?.signalFlows ?? 0,
        crossingFlows: crossings.totals?.crossingFlows ?? 0,
        membranes: crossings.totals?.membranes ?? 0,
        underModeledFlows: crossings.totals?.underModeledFlows ?? 0,
      }
    : null

  return {
    liveBands,
    liveTotal,
    disposition: {
      open: totals.live,
      reviewed: totals.dispositioned,
      stale: totals.stale,
      byKind: totals.byKind,
      compensatingNoControl,
    },
    boundaryCrossings,
    defenseInDepth: { controlCount: didControls.size, elementCount: didElements },
    topResiduals,
    residualTotal: residuals.length,
    // Honesty guards for the view's empty states — never silent green.
    hasElements: els.length > 0,
    hasAnyFindings: totals.findings > 0,
    hasLiveFindings: totals.live > 0,
  }
}
