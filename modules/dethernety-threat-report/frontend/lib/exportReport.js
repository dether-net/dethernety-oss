// frontend/lib/exportReport.js — JSON + self-contained printable HTML export of
// a threat-report snapshot. Module-owned (the download/HTML pattern is
// reimplemented here, NOT imported from any other module). The HTML is fully
// self-contained: inline <style>, hard-coded hex colors (never var(--v-theme-*),
// which a standalone file can't resolve), no external assets — open it anywhere,
// browser Print → PDF.
//
// buildJsonExport / buildHtmlExport are pure (string in, string out) → unit
// tested. downloadBlob is the only DOM touch.

import { aggregateLedger, dispositionKindLabel, lifecycleStatus } from './aggregateLedger.js'
import { buildCoverageView } from './coverageMatrix.js'
import { modeAReachability } from './reachability.js'
import { cleanProse } from './exposureDetail.js'
import { computeCrossings, sensitivityLabel } from './boundaryCrossings.js'

// The Coverage & Gaps view for export, or null when coverage-tools wasn't deployed (the
// matrix simply doesn't appear in the export). Built from the LIVE coverage facts
// joined to the snapshot ledger — the same honesty layer the UI uses.
function coverageForExport(doc, coverage) {
  if (!coverage) return null
  const v = buildCoverageView(coverage, doc?.ledger ?? [])
  return v.available ? v : null
}

// Hex band colors (self-contained — no theme variables).
const BAND_HEX = {
  critical: '#c0392b',
  high: '#e67e22',
  medium: '#c9a200',
  low: '#7f8c8d',
  unknown: '#95a5a6',
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Trigger a browser download of `content` as `filename`. The single DOM touch.
export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// The provenance footer fields shared by both formats — honest about what the
// snapshot is and is not.
function provenanceFooter(doc, totals) {
  return {
    artifact: 'Dethernety Threat Report — residual-risk ledger',
    modelId: doc.modelId ?? '',
    generatedAt: doc.generatedAt ?? '',
    fingerprint: doc.fingerprint ?? '',
    note:
      'Point-in-time snapshot of the modeled threat model (modeled posture, not a live or deployed-state scan). ' +
      'Findings are not risk-scored into a single number and no coverage percentage is implied.',
    counts: {
      findings: totals.findings,
      live: totals.live,
      dispositioned: totals.dispositioned,
      stale: totals.stale,
      byProvenance: totals.byProvenance,
    },
  }
}

// The coverage export payload — TIER-SEGREGATED, never a rolled-up "covered" and
// never a percentage (the JSON is exactly where that conflation would leak back
// in). Carries the per-technique tier + function + bucket and the off-grid
// caveat counts.
function coverageExport(view) {
  if (!view) return null
  return {
    generatedAt: view.generatedAt,
    // tier-segregated, function-classified counts (NOT a single total, NOT a %)
    bucketsByTier: view.summary,
    tactics: view.tactics,
    techniques: view.rows.map((r) => ({
      techniqueId: r.techniqueId,
      tactics: r.tactics,
      bestTier: r.bestTier,
      function: r.status, // PREVENT | DETECT_ONLY | UNCOVERED
      elementsCovered: r.elementsCovered,
      elementsTotal: r.elementsTotal,
    })),
    offGrid: view.offGrid,
    structuralGaps: view.structuralGaps,
    caveat:
      'Tier-segregated coverage facts (DIRECT / Mitigation / D3FEND). D3FEND is artifact-bridged ' +
      '(broad / low-specificity). No coverage percentage and no single "covered" total are implied; ' +
      'Data and soft/unmapped exposures are off-grid (see offGrid).',
  }
}

// The Reachability export payload — the mode-A (external entry) crown-jewel
// rollup, computed client-side from the snapshot's modelGraph + ledger. Routes
// are serialised as `flowRoutes`, NEVER `attackPaths`; an unreachable jewel
// serialises as "no modeled flow route", never "segmented/safe".
function reachabilityExport(doc) {
  const mg = doc?.modelGraph
  if (!mg || !Array.isArray(mg.components) || mg.components.length === 0) return null
  const a = modeAReachability(mg, doc?.ledger ?? [], { kind: 'external' })
  if (!a.hasCrownJewels) {
    return { hasCrownJewels: false, note: 'No components marked as crown jewels — reachability not assessed.' }
  }
  return {
    hasCrownJewels: true,
    origin: a.originLabel, // "from external entry" (structural; trustLevel dormant)
    hasExternalEntry: a.hasOrigin,
    jewelCount: a.jewelCount,
    reachableCount: a.reachableCount,
    unreachableCount: a.unreachableCount,
    flowRoutes: a.jewels.map((j) => ({
      jewel: j.jewelName,
      reachable: j.reachable,
      route: j.reachable ? { minHops: j.minHops, crossings: j.crossingCount } : 'no modeled flow route',
      worstOnRoute: j.reachable ? (j.worstOnRoute.band ?? null) : null,
      riskAcceptedOnRoute: j.riskAccepted,
      staleRiskAcceptedOnRoute: j.staleRiskAccepted,
    })),
    caveat:
      'Flow routes and the threats on them — NOT attack paths. Topological (does not model credential reuse or ' +
      'token theft). Unreachable = no modeled flow route (a modeling gap), never "segmented/safe". From external ' +
      'entry-points (structural; trustLevel is dormant, never a trust comparison).',
  }
}

// Zone-chip ramp (self-contained hex — the ordinal exposure ramp blue→violet;
// VENDOR off-gradient warm, UNTRUSTED cool). Mirrors the in-app `.trd-zone--*`
// palette. A zone is a DECLARED exposure position, never a safety verdict.
const ZONE_HEX = {
  UNTRUSTED: '#5b8bb0',
  PUBLIC: '#5877bd',
  EXPOSED: '#6168c4',
  INTERNAL: '#7a5fc0',
  RESTRICTED: '#9455bb',
  VENDOR: '#a08154',
}

// Verdict → accent hex. Allowed / no-verdict crossings carry NO accent (absence
// is the encoding — never a green "pass"). Error shares the violation tone.
const VERDICT_HEX = { violation: '#a02020', error: '#a02020', warning: '#8a5a00', advisory: '#7f7f7f' }

// The chip label the in-app view shows for a flow's carried sensitivity: a known
// level, the honest "unclassified in motion" gap, or "no data". Null sensitivity
// NEVER reads as low. Mirrors BoundaryCrossings.vue's sensChipLabel.
function crossingSensText(g) {
  if (g.sensitivityKnown) return sensitivityLabel(g.maxSensitivity)
  if (g.unclassifiedInMotion) return 'unclassified data'
  return 'no data'
}

// The Boundary-Crossings export payload — the DECLARED-zone data-flow policy
// (per-flow verdicts) + the structural EXIT/ENTER membrane path per crossing,
// computed client-side from the snapshot's modelGraph + ledger + declared zoning.
// A verdict means the model AS DRAWN encodes an illegal crossing — declared
// intent, never a verified-enforcement claim; allowed / no-verdict crossings
// carry no verdict word (absence is the encoding, never a "pass"). Returns null
// when there are no boundaries or flows to evaluate (section omitted).
function boundaryCrossingsExport(doc) {
  const mg = doc?.modelGraph
  if (!mg || !Array.isArray(mg.flows) || !Array.isArray(mg.boundaries)) return null
  if (mg.flows.length === 0 || mg.boundaries.length === 0) return null
  const r = computeCrossings(mg, doc?.ledger ?? [], doc?.zoning ?? { findings: [], effectiveZones: {} })
  const nameOf = ((byId) => (id) => byId.get(id)?.name ?? '(unknown)')(
    new Map((mg.components ?? []).map((c) => [c.id, c])),
  )
  const caveat =
    'DECLARED-zone data-flow policy: per-flow verdicts over the operator’s declared zones / domains / planes / ' +
    'conduits. A verdict means the model AS DRAWN encodes an illegal crossing — declared intent, not verified ' +
    'enforcement, and never a claim the flow cannot occur. Allowed / no-verdict crossings carry no verdict ' +
    '(absence is the encoding, never a “pass”). EXIT/ENTER membranes are containment (boundary nesting), not a ' +
    'trust comparison. No single risk score, no coverage %.'
  // Nothing crosses a membrane, and no declared conduit is in error/dead — an
  // honest "topology, not a segmentation assessment" note (never "segmented/safe").
  if (r.totals.crossingFlows === 0 && r.conduitErrors.length === 0 && r.deadConduits.length === 0) {
    return {
      crossingFlows: 0,
      note: 'No modeled flow crosses a boundary membrane as drawn. This reflects the model’s current topology, not a segmentation assessment.',
      flags: r.flags,
      caveat,
    }
  }
  const mapFlow = (g) => ({
    flow: g.flowName || '(unnamed flow)',
    source: nameOf(g.sourceId),
    target: nameOf(g.targetId),
    sensitivity: crossingSensText(g),
    verdict: g.verdict
      ? {
          verdict: g.verdict.verdict, // violation | warning | advisory | allowed | null
          declaredZonePair: `${g.verdict.srcZone} ↦ ${g.verdict.tgtZone}`,
          srcZone: g.verdict.srcZone,
          tgtZone: g.verdict.tgtZone,
          domainRel: g.verdict.domainRel,
          planeClass: g.verdict.planeClass,
          conduitClause: g.verdict.conduitClause,
          // Rationale only on escalated rows — allowed rows stay silent.
          detail: g.verdictRank > 0 ? g.verdict.detail || '' : '',
        }
      : null,
    membranes: g.membranes.map((m) => ({
      direction: m.direction, // EXIT | ENTER (containment, never trust)
      boundary: m.boundaryName,
      liveOnBoundary: m.boundaryLiveCount,
      boundaryControl: m.boundaryHasControl,
    })),
    hiddenMembranes: g.hiddenMembranes,
    onFlowLive: g.flowLiveCount,
    onFlowWorstBand: g.flowWorstBand,
    onFlowControl: g.flowHasControl,
  })
  return {
    // Per-flow verdict rollup (counts, never a score). `fails` = any violation or
    // conduit error — the model-level pass/advisory framing.
    policy: r.policy,
    totals: r.totals,
    // Signal- or verdict-bearing crossings, verdict-severity-first ranked.
    worklist: r.crossings.map(mapFlow),
    // Zero-signal, allowed/no-verdict crossings (the muted tail) — present, never dropped.
    underModeled: { count: r.underModeledCount, flows: r.underModeled.map((g) => g.flowName || '(unnamed flow)') },
    // Declared conduits that authorize an illegal crossing (fail-closed — a conduit
    // never legalizes a violation).
    conduitErrors: r.conduitErrors.map((c) => ({
      source: c.sourceName,
      peer: c.peerName,
      declaredZonePair: `${c.srcZone} ↦ ${c.tgtZone}`,
      dead: c.dead,
      detail: c.detail,
    })),
    // Legally declared conduits with no matching modeled flow (dead intent — muted).
    deadConduits: r.deadConduits.map((c) => ({
      source: c.sourceName,
      peer: c.peerName,
      justification: c.unreviewable ? null : c.justification,
      unreviewable: c.unreviewable,
    })),
    flags: r.flags,
    caveat,
  }
}

// JSON export: the raw snapshot doc + a provenance footer + the tier-segregated
// coverage facts + the Reachability rollup + the Boundary-Crossings / data-flow
// policy (each when available).
export function buildJsonExport(doc, coverage = null) {
  const { totals } = aggregateLedger(doc?.ledger ?? [])
  const cov = coverageExport(coverageForExport(doc, coverage))
  const reach = reachabilityExport(doc)
  const boundaryCrossings = boundaryCrossingsExport(doc)
  return JSON.stringify(
    {
      snapshot: doc,
      coverage: cov,
      reachability: reach,
      boundaryCrossings,
      provenance: provenanceFooter(doc, totals),
    },
    null,
    2,
  )
}

function findingRowHtml(f, muted) {
  const color = BAND_HEX[f.band] ?? BAND_HEX.unknown
  const prov = f.provenance === 'USER' ? 'USER' : 'SYSTEM'
  const disp = muted
    ? `<td>${esc(dispositionKindLabel(f.dispositionKind))}${
        f.stale ? ' <span class="stale">⚠ stale</span>' : ''
      }${f.dispositionReason ? `<div class="reason">${esc(f.dispositionReason)}</div>` : ''}</td>`
    : ''
  // Live-confirmed (AFFIRMED) findings stay in the 5-column live table (no Disposition
  // column). Surface their affirmation reason + stale flag INLINE in the Finding cell —
  // otherwise a stale affirmed row silently contradicts totals.stale and reads as fresh.
  const liveNote =
    !muted && f.dispositionKind === 'AFFIRMED'
      ? `${f.stale ? ' <span class="stale">⚠ stale</span>' : ''}${
          f.dispositionReason ? `<div class="reason">${esc(f.dispositionReason)}</div>` : ''
        }`
      : ''
  // A reviewed-and-confirmed (AFFIRMED + attributed) live row earns a Confirmed marker
  // so it reads distinctly from an un-triaged pending row, mirroring the in-app chip.
  const confirmedTag =
    !muted && lifecycleStatus(f) === 'confirmed'
      ? ' <span class="confirmed">Confirmed</span>'
      : ''
  // The exposure's own description, baked into the snapshot, rendered as a muted
  // sub-line so the flat HTML report carries the same narrative the dialog shows.
  // (The full structured detail — mitigations / detection / references / tags —
  // travels in the complete JSON export, which serialises the raw snapshot.)
  const desc = cleanProse(f.description)
  const descLine = desc ? `<div class="fdesc">${esc(desc)}</div>` : ''
  return `<tr class="${muted ? 'disposed' : ''}">
    <td><span class="band" style="background:${color}">${esc(f.band)}</span></td>
    <td class="score">${f.score == null ? '—' : esc(f.score)}</td>
    <td>${esc(f.name)}${confirmedTag}${liveNote}${descLine}</td>
    <td class="vector">${esc(f.attackVector ?? '')}</td>
    <td class="prov">${prov}</td>
    ${disp}
  </tr>`
}

function groupHtml(g) {
  const controls = g.supportingControls.length
    ? `<p class="controls">Controls present (${g.supportingControls.length}): ${g.supportingControls
        .map((c) => esc(c.name))
        .join(', ')}</p>`
    : ''
  const liveRows = g.live.map((f) => findingRowHtml(f, false)).join('')
  const dispRows = g.dispositioned.map((f) => findingRowHtml(f, true)).join('')
  return `<section class="element">
    <h3>${esc(g.name)} <span class="etype">${esc(g.type)}</span></h3>
    ${controls}
    ${
      g.live.length
        ? `<table><thead><tr><th>Band</th><th>Score</th><th>Finding</th><th>Vector</th><th>Source</th></tr></thead><tbody>${liveRows}</tbody></table>`
        : '<p class="none">No open findings.</p>'
    }
    ${
      g.dispositioned.length
        ? `<h4>Dispositioned (${g.dispositioned.length})</h4>
           <table class="disposed-table"><thead><tr><th>Band</th><th>Score</th><th>Finding</th><th>Vector</th><th>Source</th><th>Disposition</th></tr></thead><tbody>${dispRows}</tbody></table>`
        : ''
    }
  </section>`
}

// Coverage section HTML — tier-segregated counts + a per-technique table carrying
// tier + function, plus the off-grid caveat. Never a % or a single "covered".
function coverageHtml(view) {
  if (!view) return ''
  const s = view.summary
  const rows = view.rows
    .map(
      (r) => `<tr>
        <td>${esc(r.techniqueId)}</td>
        <td>${esc(r.tactics.join(', '))}</td>
        <td>${esc(r.bestTier ?? 'UNCOVERED')}</td>
        <td>${esc(r.status)}</td>
        <td class="score">${r.elementsCovered}/${r.elementsTotal}</td>
      </tr>`,
    )
    .join('')
  const offgrid = []
  if (view.offGrid.softCount) offgrid.push(`${view.offGrid.softCount} soft/unmapped (no ATT&CK mapping)`)
  if (view.offGrid.dataMappedCount) offgrid.push(`${view.offGrid.dataMappedCount} Data exposures (off-grid — not assessable)`)
  if (view.offGrid.dispositionedExcluded) offgrid.push(`${view.offGrid.dispositionedExcluded} dispositioned (excluded from live grid)`)
  for (const cls of view.structuralGaps) offgrid.push(`structural gap: no control supports any ${esc(cls)}`)
  return `<h2>MITRE Coverage &amp; Gaps</h2>
  <div class="summary">
    <p>Tier-segregated (never a % or a single “covered”): <strong>${s.directPrevent}</strong> DIRECT-prevent ·
      <strong>${s.directDetect}</strong> DIRECT-detect · <strong>${s.mitigation}</strong> Mitigation ·
      <strong>${s.d3fend}</strong> D3FEND (broad/inferred) · <strong>${s.detectOnly}</strong> detect-only ·
      <strong>${s.uncovered}</strong> uncovered · <strong>${s.soft}</strong> soft/unmapped</p>
    ${offgrid.length ? `<p class="none">Off-grid: ${offgrid.map(esc).join(' · ')}</p>` : ''}
  </div>
  ${
    rows
      ? `<table><thead><tr><th>Technique</th><th>Tactics</th><th>Best tier</th><th>Function</th><th>Covered/Total</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="none">No live Component/DataFlow exposure maps to an ATT&amp;CK technique.</p>'
  }`
}

// Reachability section HTML — the mode-A crown-jewel rollup. Routes are "flow
// routes", unreachable reads "no modeled flow route" (never "safe"); hex-only.
function reachabilityHtml(doc) {
  const r = reachabilityExport(doc)
  if (!r) return ''
  if (r.hasCrownJewels === false) {
    return `<h2>Crown-Jewel Reachability</h2><p class="none">${esc(r.note)}</p>`
  }
  const rows = r.flowRoutes
    .map(
      (fr) => `<tr>
        <td>${esc(fr.jewel)}</td>
        <td>${fr.reachable ? 'reachable' : 'no modeled flow route'}</td>
        <td class="score">${fr.reachable ? fr.route.minHops : '—'}</td>
        <td class="score">${fr.reachable ? fr.route.crossings : '—'}</td>
        <td>${fr.worstOnRoute ? esc(fr.worstOnRoute) : '—'}</td>
        <td>${fr.riskAcceptedOnRoute ? esc(fr.riskAcceptedOnRoute) + (fr.staleRiskAcceptedOnRoute ? ' (stale)' : '') : '—'}</td>
      </tr>`,
    )
    .join('')
  return `<h2>Crown-Jewel Reachability</h2>
  <div class="summary">
    <p><strong>${r.reachableCount}</strong> of <strong>${r.jewelCount}</strong> crown jewels reachable ${esc(r.origin)}${r.unreachableCount ? ` · ${r.unreachableCount} with no modeled flow route` : ''}</p>
    <p class="none">${esc(r.caveat)}</p>
  </div>
  <table><thead><tr><th>Crown jewel</th><th>Reachability</th><th>Min hops</th><th>Crossings</th><th>Worst on route</th><th>Risk-accepted on route</th></tr></thead><tbody>${rows}</tbody></table>`
}

// A declared zone chip — outlined, hex-only (self-contained), uppercase. A
// position marker on the exposure ramp, never a safety verdict / never green.
function zoneChipHtml(z) {
  const hex = ZONE_HEX[z] ?? '#777'
  return `<span class="zone" style="color:${hex};border-color:${hex}">${esc(z)}</span>`
}

// A completeness/honesty flag line (warning/error). Mirrors the in-app flags.
function flagHtml(f) {
  const cls = f.severity === 'error' ? 'flag-error' : 'flag-warn'
  return `<p class="${cls}">⚠ ${esc(f.label)}</p>`
}

// One worklist crossing block: the declared policy line (zone-pair + verdict +
// conduit token) over the structural EXIT/ENTER membrane path. A left accent bar
// only on non-clean rows (allowed stays neutral — absence is the encoding).
function crossingHtml(x) {
  const v = x.verdict
  const word = v && VERDICT_HEX[v.verdict] ? v.verdict.toUpperCase() : ''
  const accent = v && VERDICT_HEX[v.verdict] ? VERDICT_HEX[v.verdict] : ''
  const accentStyle = accent ? ` style="border-left:3px solid ${accent}"` : ''
  const verdictBadge = word
    ? ` <span class="verdict" style="color:${accent};border-color:${accent}">${esc(word)}</span>`
    : ''
  const conduitTok =
    v && (v.conduitClause === 'error' || v.conduitClause === 'required-missing')
      ? ` <span class="conduit-tok">conduit: ${v.conduitClause === 'error' ? 'error' : 'missing'}</span>`
      : ''
  const dim = []
  if (v && v.domainRel && v.domainRel !== 'n/a') dim.push(v.domainRel === 'same' ? 'same-domain' : 'cross-domain')
  if (v && v.planeClass === 'management') dim.push('management plane')
  const dimHtml = dim.length ? ` <span class="pdim">· ${dim.map(esc).join(' · ')}</span>` : ''
  const policyLine = v
    ? `<div class="xpolicy"><span class="plabel">declared</span> ${zoneChipHtml(v.srcZone)} <span class="zarrow">↦</span> ${zoneChipHtml(v.tgtZone)}${dimHtml}${verdictBadge}${conduitTok}</div>`
    : ''
  const detail = v && v.detail ? `<div class="xdetail">${esc(v.detail)}</div>` : ''
  const onflow = []
  if (x.onFlowLive > 0) onflow.push(`flow: ${x.onFlowLive} live${x.onFlowWorstBand ? ` (${esc(x.onFlowWorstBand)})` : ''}`)
  if (x.onFlowControl) onflow.push('flow control present')
  const onflowHtml = onflow.length ? ` <span class="onflow">${onflow.map(esc).join(' · ')}</span>` : ''
  const membranes = x.membranes
    .map((m) => {
      const weaken = m.liveOnBoundary > 0 ? ` <span class="weaken">⚠ ${m.liveOnBoundary} live on boundary</span>` : ''
      const harden = m.boundaryControl ? ' <span class="harden">✓ boundary control</span>' : ''
      return `<li><span class="dir dir-${esc(m.direction.toLowerCase())}">${esc(m.direction)}</span> ${esc(m.boundary)}${weaken}${harden}</li>`
    })
    .join('')
  const collapsed = x.hiddenMembranes > 0
    ? `<p class="collapsed-note">+${x.hiddenMembranes} outer shared-context membrane${x.hiddenMembranes === 1 ? '' : 's'} collapsed</p>`
    : ''
  return `<section class="xflow"${accentStyle}>
    <div class="xhead"><strong>${esc(x.flow)}</strong>
      <span class="xep">${esc(x.source)} → ${esc(x.target)}</span>
      <span class="xsens">${esc(x.sensitivity)}</span>${onflowHtml}</div>
    ${policyLine}
    ${detail}
    <ul class="membranes">${membranes}</ul>
    ${collapsed}
  </section>`
}

// Boundary-Crossings section HTML — the declared-zone data-flow policy worklist +
// structural membranes, the conduit-error / dead-conduit surfaces, and the honesty
// caveat. Hex-only, self-contained; omitted when there are no boundaries/flows.
function boundaryCrossingsHtml(doc) {
  const x = boundaryCrossingsExport(doc)
  if (!x) return ''
  const flags = (x.flags ?? []).map(flagHtml).join('')
  if (x.crossingFlows === 0) {
    return `<h2>Boundary Crossings</h2>${flags}<p class="none">${esc(x.note)}</p>
      <p class="none">${esc(x.caveat)}</p>`
  }
  const p = x.policy
  const counts = []
  if (p.violations) counts.push(`<span style="color:#a02020">${p.violations} violation${p.violations === 1 ? '' : 's'}</span>`)
  if (p.warnings) counts.push(`<span style="color:#8a5a00">${p.warnings} warning${p.warnings === 1 ? '' : 's'}</span>`)
  if (p.advisories) counts.push(`${p.advisories} advisor${p.advisories === 1 ? 'y' : 'ies'}`)
  counts.push(`<span class="none">${x.totals.underModeledFlows} under-modeled</span>`)
  const conduitErrs = x.conduitErrors.length
    ? `<h3 class="cerr-h">${x.conduitErrors.length} declared conduit${x.conduitErrors.length === 1 ? '' : 's'} authorize an illegal crossing — a conduit does not legalize a policy violation</h3>
       ${x.conduitErrors
         .map(
           (c) => `<p class="cerr"><span class="verdict" style="color:#a02020;border-color:#a02020">CONDUIT ERROR</span>
             ${esc(c.source)} <span class="zarrow">${esc(c.declaredZonePair)}</span> ${esc(c.peer)}${c.dead ? ' <span class="dead-tag">dead (no live flow)</span>' : ''}
             <span class="cerr-detail">${esc(c.detail)}</span></p>`,
         )
         .join('')}`
    : ''
  const worklist = x.worklist.map(crossingHtml).join('')
  const underModeled = x.underModeled.count
    ? `<p class="none">Under-modeled (no classified data, no exposures, no controls): ${x.underModeled.flows.map(esc).join(', ')}</p>`
    : ''
  const deadConduits = x.deadConduits.length
    ? `<h3>${x.deadConduits.length} declared conduit${x.deadConduits.length === 1 ? '' : 's'} with no matching modeled flow (dead intent)</h3>
       ${x.deadConduits
         .map(
           (c) => `<p class="deadc">${esc(c.source)} → ${esc(c.peer)} — ${
             c.unreviewable ? '<span class="unrev">no justification — unreviewable</span>' : esc(c.justification)
           }</p>`,
         )
         .join('')}`
    : ''
  return `<h2>Boundary Crossings</h2>
  ${flags}
  <div class="summary">
    <p><strong>${x.totals.crossingFlows}</strong> flows pierce membranes · ${counts.join(' · ')}</p>
    <p class="none">${esc(x.caveat)}</p>
  </div>
  ${conduitErrs}
  ${worklist || '<p class="none">No signal-bearing or policy-flagged crossing.</p>'}
  ${underModeled}
  ${deadConduits}`
}

// Self-contained printable HTML. Pure: (doc, coverage) → string.
export function buildHtmlExport(doc, coverage = null) {
  const { totals, groups } = aggregateLedger(doc?.ledger ?? [])
  const footer = provenanceFooter(doc, totals)
  const covSection = coverageHtml(coverageForExport(doc, coverage))
  const reachSection = reachabilityHtml(doc)
  const boundarySection = boundaryCrossingsHtml(doc)
  const bandSummary = ['critical', 'high', 'medium', 'low', 'unknown']
    .filter((b) => totals.byBand[b])
    .map(
      (b) =>
        `<span class="band" style="background:${BAND_HEX[b]}">${b}: ${totals.byBand[b]}</span>`,
    )
    .join(' ')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Threat Report — Residual-Risk Ledger</title>
<style>
  body { font-family: system-ui, 'Segoe UI', sans-serif; max-width: 980px; margin: 2rem auto; color: #1a1a1a; padding: 0 1rem; }
  h1 { border-bottom: 3px solid #34495e; padding-bottom: .3rem; }
  h3 { margin: 1.4rem 0 .3rem; }
  .etype { font-size: .7rem; font-weight: 400; color: #777; border: 1px solid #ccc; border-radius: 3px; padding: 1px 5px; vertical-align: middle; }
  table { border-collapse: collapse; width: 100%; margin: .3rem 0 1rem; font-size: .85rem; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  .band { display: inline-block; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: .72rem; text-transform: capitalize; }
  .score { text-align: right; font-variant-numeric: tabular-nums; }
  .prov, .vector { font-size: .75rem; color: #555; }
  tr.disposed { opacity: .6; }
  .reason { font-size: .75rem; color: #666; font-style: italic; }
  .fdesc { font-size: .78rem; color: #555; margin: .25rem 0 0; white-space: pre-wrap; }
  .stale { color: #c77700; font-weight: 600; }
  .confirmed { font-size: .7rem; color: #0892ad; border: 1px solid #0892ad; border-radius: 3px; padding: 0 .3rem; margin-left: .35rem; vertical-align: middle; }
  .controls { font-size: .8rem; color: #2c7; margin: .2rem 0; }
  .none { color: #888; font-size: .85rem; }
  .summary { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; padding: .6rem 1rem; }
  footer { margin-top: 2rem; border-top: 1px solid #ddd; padding-top: .6rem; font-size: .72rem; color: #777; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
  /* Boundary Crossings — declared-zone policy + structural membranes (hex-only). */
  .flag-warn { color: #8a5a00; background: rgba(199,119,0,.1); font-size: .8rem; padding: .3rem .6rem; border-radius: 4px; margin: .3rem 0; }
  .flag-error { color: #a02020; background: rgba(192,57,43,.1); font-size: .8rem; padding: .3rem .6rem; border-radius: 4px; margin: .3rem 0; }
  .xflow { border: 1px solid #e0e0e0; border-radius: 5px; padding: .5rem .7rem; margin: 0 0 .55rem; }
  .xhead { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .xep { font-size: .78rem; color: #555; }
  .xsens { border: 1px solid #999; color: #555; border-radius: 10px; padding: 0 7px; font-size: .7rem; text-transform: capitalize; }
  .onflow { font-size: .74rem; color: #8a5a00; }
  .xpolicy { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin: .35rem 0 0; font-size: .78rem; }
  .plabel { text-transform: uppercase; letter-spacing: .06em; font-size: .62rem; color: #999; }
  .pdim { color: #888; }
  .zone { display: inline-block; border: 1px solid; border-radius: 10px; padding: 0 7px; font-size: .66rem; letter-spacing: .04em; text-transform: uppercase; }
  .zarrow { color: #999; }
  .verdict { font-size: .64rem; font-weight: 700; letter-spacing: .05em; padding: 0 5px; border: 1px solid; border-radius: 3px; }
  .conduit-tok { font-size: .68rem; color: #a02020; }
  .xdetail { font-size: .76rem; color: #555; margin: .25rem 0 0; line-height: 1.45; }
  .membranes { list-style: none; margin: .4rem 0 0; padding: 0; }
  .membranes li { font-size: .82rem; padding: .15rem 0; }
  .dir { display: inline-block; min-width: 3.2rem; text-align: center; border: 1px solid; border-radius: 3px; padding: 0 5px; font-size: .66rem; font-weight: 600; }
  .dir-exit { color: #b9651b; }
  .dir-enter { color: #2c6fbb; }
  .weaken { font-size: .74rem; color: #8a5a00; }
  .harden { font-size: .74rem; color: #4a6a55; }
  .collapsed-note { font-size: .72rem; color: #999; margin: .3rem 0 0; }
  .cerr-h { color: #a02020; }
  .cerr { font-size: .76rem; margin: .35rem 0; }
  .cerr-detail { display: block; color: #666; font-size: .72rem; }
  .dead-tag { color: #8a5a00; border: 1px solid #8a5a00; border-radius: 10px; padding: 0 6px; font-size: .66rem; }
  .deadc { font-size: .78rem; color: #555; margin: .3rem 0; }
  .unrev { color: #8a5a00; }
</style></head>
<body>
  <h1>Threat Report — Residual-Risk Ledger</h1>
  <div class="summary">
    <p><strong>${totals.findings}</strong> findings · <strong>${totals.live}</strong> open · <strong>${totals.dispositioned}</strong> dispositioned${totals.stale ? ` · <span class="stale">${totals.stale} stale</span>` : ''}</p>
    <p>${bandSummary || '<span class="none">No findings.</span>'}</p>
    <p class="prov">Provenance — USER: ${totals.byProvenance.USER} · SYSTEM: ${totals.byProvenance.SYSTEM}</p>
  </div>
  ${covSection}
  ${reachSection}
  ${boundarySection}
  <h2>Residual-Risk Ledger</h2>
  ${groups.map(groupHtml).join('\n') || '<p class="none">No findings in this model.</p>'}
  <footer>
    <div>${esc(footer.artifact)}</div>
    <div>Model: <code>${esc(footer.modelId)}</code> · Generated: ${esc(footer.generatedAt)} · Fingerprint: <code>${esc(footer.fingerprint)}</code></div>
    <div>${esc(footer.note)}</div>
  </footer>
</body></html>`
}

// Build + download helpers (the verbs the UI calls). `coverage` is the live
// graded-coverage facts (or null) — included in both formats when available.
export function exportJson(doc, coverage = null) {
  const stamp = (doc?.generatedAt ?? '').replace(/[:.]/g, '-') || 'snapshot'
  downloadBlob(buildJsonExport(doc, coverage), `threat-report-${stamp}.json`, 'application/json')
}

export function exportHtml(doc, coverage = null) {
  const stamp = (doc?.generatedAt ?? '').replace(/[:.]/g, '-') || 'snapshot'
  downloadBlob(buildHtmlExport(doc, coverage), `threat-report-${stamp}.html`, 'text/html')
}
