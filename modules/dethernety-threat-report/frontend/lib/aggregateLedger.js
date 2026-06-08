// frontend/lib/aggregateLedger.js — pure presentation aggregation over the
// snapshot doc's `ledger` (gathered backend-side at generate time). No Vue, no
// network — pure functions, unit-tested with fixtures.
//
// Honesty contracts: dispositioned findings are NEVER
// dropped (they move to a muted partition); live = `dispositionKind == null` OR
// `AFFIRMED` (the one kind that keeps a finding live — reviewed + confirmed real);
// USER/SYSTEM provenance is surfaced (null createdBy ⇒ SYSTEM, per the schema's
// legacy-data note); NO single risk score, NO coverage %, NO "Covered: N".
// Controls are context only — never coverage math.

export const DISPOSITION_KIND_LABELS = {
  NOT_APPLICABLE: 'Not Applicable',
  FALSE_POSITIVE: 'False Positive',
  COMPENSATING_CONTROL: 'Compensating Control',
  RISK_ACCEPTED: 'Risk Accepted',
  WAIVED: 'Waived',
  SUPERSEDED: 'Superseded',
  AFFIRMED: 'Affirmed',
}

export function dispositionKindLabel(kind) {
  if (!kind) return ''
  return DISPOSITION_KIND_LABELS[kind] ?? kind
}

// Score band on the platform's 0–10 (CVSS-like) exposure score. A presentation
// sort/group aid ONLY — not a risk verdict. null score ⇒ 'unknown' (never
// silently treated as low).
export function scoreBand(score) {
  if (score == null || Number.isNaN(score)) return 'unknown'
  if (score >= 9) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

export const BAND_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 }

// A dispositionKind is live (not muted) when absent, or explicitly AFFIRMED.
export function isLiveKind(kind) {
  return kind == null || kind === 'AFFIRMED'
}

export function isLive(finding) {
  return isLiveKind(finding?.dispositionKind)
}

// Defensive de-duplication of ledger ELEMENTS by `id`. A model can carry duplicate
// element nodes (the same `id` property on distinct graph nodes — a data-integrity
// artefact, e.g. a re-imported flow), and the gather's `collect(DISTINCT node)`
// dedupes by node identity, NOT by id property — so the same logical element can be
// emitted more than once. Left unchecked that double-counts its findings in every
// total AND collides Vue `:key`s. Keep the FIRST occurrence per id so each element
// is presented (and counted) exactly once. Elements without an id are kept as-is.
export function dedupeLedgerElements(ledger) {
  const els = Array.isArray(ledger) ? ledger : []
  const seen = new Set()
  const out = []
  for (const el of els) {
    const id = el?.id
    if (id != null) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(el)
  }
  return out
}

// USER vs SYSTEM provenance; null/empty ⇒ SYSTEM (schema: legacy data is SYSTEM).
export function provenanceOf(finding) {
  return finding?.createdBy === 'USER' ? 'USER' : 'SYSTEM'
}

// Derived lifecycle — never stored. Mirrors the dt-ui composable; this module
// is a standalone bundle and can't import it. `confirmed`/`pending` are both LIVE.
//   - AFFIRMED + a server-stamped actor ⇒ confirmed; AFFIRMED with no actor ⇒ pending
//     (forensic guard: an unattributed direct-GraphQL affirm is not a real confirmation).
//   - any other kind ⇒ disposed.
//   - no kind: USER-authored ⇒ confirmed (born confirmed, D3); SYSTEM/legacy ⇒ pending.
export function lifecycleStatus(finding) {
  const k = finding?.dispositionKind ?? null
  if (k === 'AFFIRMED') return finding?.dispositionedBy ? 'confirmed' : 'pending'
  if (k != null) return 'disposed'
  return provenanceOf(finding) === 'USER' ? 'confirmed' : 'pending'
}

function annotate(finding) {
  return {
    ...finding,
    band: scoreBand(finding.score),
    provenance: provenanceOf(finding),
    live: isLive(finding),
    lifecycle: lifecycleStatus(finding),
    stale: finding.dispositionStale === true,
  }
}

// Sort live findings by band severity (desc) then score (desc) then name.
export function bySeverity(a, b) {
  const r = (BAND_RANK[b.band] ?? 0) - (BAND_RANK[a.band] ?? 0)
  if (r !== 0) return r
  const s = (b.score ?? -1) - (a.score ?? -1)
  if (s !== 0) return s
  return String(a.name).localeCompare(String(b.name))
}

/**
 * Aggregate the ledger into the Residual Risk view model.
 *
 * @param {Array} ledger  the snapshot doc's `ledger` (LedgerElement[])
 * @returns {{ totals, groups }}
 *   totals: { findings, live, dispositioned, stale, byKind, byProvenance, byBand, byLifecycle }
 *   groups: one per finding-bearing element, each
 *     { id, name, type, live[], dispositioned[], supportingControls,
 *       liveCount, dispositionedCount } — live sorted by severity, dispositioned
 *     kept (muted) and sorted by kind then name. Elements ordered: those with
 *     live findings first, then by worst live band, then name.
 */
export function aggregateLedger(ledger) {
  const els = Array.isArray(ledger) ? ledger : []

  const totals = {
    findings: 0,
    live: 0,
    dispositioned: 0,
    stale: 0,
    byKind: {},
    byProvenance: { USER: 0, SYSTEM: 0 },
    byBand: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    // Lifecycle split of the LIVE set (exposures-only, which the ledger already is —
    // findings come solely from HAS_EXPOSURE). `confirmed` = reviewed & kept open;
    // `pending` = not yet reviewed. The number a lead reads to size the real backlog.
    byLifecycle: { confirmed: 0, pending: 0 },
  }

  const groups = []

  for (const el of els) {
    const findings = (el.findings ?? []).map(annotate)
    if (findings.length === 0) continue // the Residual Risk view is finding-focused

    const live = []
    const dispositioned = []
    for (const f of findings) {
      totals.findings++
      totals.byProvenance[f.provenance]++
      totals.byBand[f.band] = (totals.byBand[f.band] ?? 0) + 1
      if (f.stale) totals.stale++
      if (f.live) {
        totals.live++
        // Live set splits into confirmed (reviewed, kept open) vs pending (unreviewed).
        if (f.lifecycle === 'confirmed') totals.byLifecycle.confirmed++
        else totals.byLifecycle.pending++
        live.push(f)
      } else {
        totals.dispositioned++
        totals.byKind[f.dispositionKind] = (totals.byKind[f.dispositionKind] ?? 0) + 1
        dispositioned.push(f)
      }
    }

    live.sort(bySeverity)
    dispositioned.sort(
      (a, b) =>
        String(a.dispositionKind).localeCompare(String(b.dispositionKind)) ||
        String(a.name).localeCompare(String(b.name)),
    )

    // Auditable consistency check (NOT coverage math): a finding consciously
    // accepted as COMPENSATING_CONTROL asserts a control compensates for it — so
    // a COMPENSATING_CONTROL disposition on an element with ZERO supporting
    // controls is a claim with nothing backing it. Surface it for the reviewer.
    const supportingControls = el.supportingControls ?? []
    const compensatingClaimNoControl =
      supportingControls.length === 0 &&
      dispositioned.some((f) => f.dispositionKind === 'COMPENSATING_CONTROL')

    groups.push({
      id: el.id,
      name: el.name ?? '',
      type: el.type,
      live,
      dispositioned,
      supportingControls,
      liveCount: live.length,
      dispositionedCount: dispositioned.length,
      compensatingClaimNoControl,
    })
  }

  const worstBand = (g) =>
    g.live.reduce((max, f) => Math.max(max, BAND_RANK[f.band] ?? 0), 0)

  groups.sort((a, b) => {
    // elements with live findings first
    const hasLive = (g) => (g.liveCount > 0 ? 1 : 0)
    const h = hasLive(b) - hasLive(a)
    if (h !== 0) return h
    const w = worstBand(b) - worstBand(a)
    if (w !== 0) return w
    return String(a.name).localeCompare(String(b.name))
  })

  return { totals, groups }
}
