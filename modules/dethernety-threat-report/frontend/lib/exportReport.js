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

// JSON export: the raw snapshot doc + a provenance footer.
export function buildJsonExport(doc) {
  const { totals } = aggregateLedger(doc?.ledger ?? [])
  return JSON.stringify({ snapshot: doc, provenance: provenanceFooter(doc, totals) }, null, 2)
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

// Self-contained printable HTML. Pure: doc → string.
export function buildHtmlExport(doc) {
  const { totals, groups } = aggregateLedger(doc?.ledger ?? [])
  const footer = provenanceFooter(doc, totals)
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
  ${groups.map(groupHtml).join('\n') || '<p class="none">No findings in this model.</p>'}
  <footer>
    <div>${esc(footer.artifact)}</div>
    <div>Model: <code>${esc(footer.modelId)}</code> · Generated: ${esc(footer.generatedAt)} · Fingerprint: <code>${esc(footer.fingerprint)}</code></div>
    <div>${esc(footer.note)}</div>
  </footer>
</body></html>`
}

// Build + download helpers (the verbs the UI calls).
export function exportJson(doc) {
  const stamp = (doc?.generatedAt ?? '').replace(/[:.]/g, '-') || 'snapshot'
  downloadBlob(buildJsonExport(doc), `threat-report-${stamp}.json`, 'application/json')
}

export function exportHtml(doc) {
  const stamp = (doc?.generatedAt ?? '').replace(/[:.]/g, '-') || 'snapshot'
  downloadBlob(buildHtmlExport(doc), `threat-report-${stamp}.html`, 'text/html')
}
