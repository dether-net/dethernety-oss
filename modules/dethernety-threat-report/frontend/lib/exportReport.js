// frontend/lib/exportReport.js — JSON + self-contained printable HTML export of
// a threat-report snapshot. Module-owned (the download/HTML pattern is
// reimplemented here, NOT imported from any other module). The HTML is fully
// self-contained: inline <style>, hard-coded hex colors (never var(--v-theme-*),
// which a standalone file can't resolve), no external assets — open it anywhere,
// browser Print → PDF.
//
// buildJsonExport / buildHtmlExport are pure (string in, string out) → unit
// tested. downloadBlob is the only DOM touch.

import { aggregateLedger, dispositionKindLabel } from './aggregateLedger.js'
import { buildCoverageView } from './coverageMatrix.js'
import { modeAReachability } from './reachability.js'

// The ① coverage view for export, or null when coverage-tools wasn't deployed (the
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
// never a percentage (the JSON is exactly where that conflation would leak back in,
// ux §5.①). Carries the per-technique tier + function + bucket and the off-grid
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

// The ② reachability export payload — the mode-A (external entry) crown-jewel
// rollup, computed client-side from the snapshot's modelGraph + ledger. Routes
// are serialised as `flowRoutes`, NEVER `attackPaths` (spec §5); an unreachable
// jewel serialises as "no modeled flow route", never "segmented/safe".
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

// JSON export: the raw snapshot doc + a provenance footer + the tier-segregated
// coverage facts + the ② reachability rollup (each when available).
export function buildJsonExport(doc, coverage = null) {
  const { totals } = aggregateLedger(doc?.ledger ?? [])
  const cov = coverageExport(coverageForExport(doc, coverage))
  const reach = reachabilityExport(doc)
  return JSON.stringify(
    { snapshot: doc, coverage: cov, reachability: reach, provenance: provenanceFooter(doc, totals) },
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
  return `<tr class="${muted ? 'disposed' : ''}">
    <td><span class="band" style="background:${color}">${esc(f.band)}</span></td>
    <td class="score">${f.score == null ? '—' : esc(f.score)}</td>
    <td>${esc(f.name)}</td>
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

// Self-contained printable HTML. Pure: (doc, coverage) → string.
export function buildHtmlExport(doc, coverage = null) {
  const { totals, groups } = aggregateLedger(doc?.ledger ?? [])
  const footer = provenanceFooter(doc, totals)
  const covSection = coverageHtml(coverageForExport(doc, coverage))
  const reachSection = reachabilityHtml(doc)
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
  .stale { color: #c77700; font-weight: 600; }
  .controls { font-size: .8rem; color: #2c7; margin: .2rem 0; }
  .none { color: #888; font-size: .85rem; }
  .summary { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; padding: .6rem 1rem; }
  footer { margin-top: 2rem; border-top: 1px solid #ddd; padding-top: .6rem; font-size: .72rem; color: #777; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
</style></head>
<body>
  <h1>Threat Report — Residual-Risk Ledger</h1>
  <div class="summary">
    <p><strong>${totals.findings}</strong> findings · <strong>${totals.live}</strong> open · <strong>${totals.dispositioned}</strong> reviewed${totals.stale ? ` · <span class="stale">${totals.stale} stale</span>` : ''}</p>
    <p>${bandSummary || '<span class="none">No findings.</span>'}</p>
    <p class="prov">Provenance — USER: ${totals.byProvenance.USER} · SYSTEM: ${totals.byProvenance.SYSTEM}</p>
  </div>
  ${covSection}
  ${reachSection}
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
