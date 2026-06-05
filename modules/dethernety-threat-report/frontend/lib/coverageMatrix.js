// frontend/lib/coverageMatrix.js — the coverage PRESENTATION / HONESTY layer.
//
// Pure functions over two inputs:
//   - `coverage`: the parsed, RAW, disposition-AGNOSTIC graded-coverage facts from
//     the `dethernety-coverage-tools` module (fetched live via fetchGradedCoverage);
//     the ONLY source of per-exposure ATT&CK technique + tactic + tier data.
//   - `ledger`: the snapshot ledger (SnapshotDoc.ledger) — the source of each
//     finding's dispositionKind and each element's supportingControls.
// They join on exposureId === ledger.findings[].id.
//
// This layer is where the honesty rules live:
//   - LIVE-ONLY disposition filter — only `dispositionKind == null` exposures enter
//     the live grid/counts; dispositioned ones are excluded but COUNTED (never
//     silently dropped — they still render in the Residual Risk view).
//   - Data exposures OFF the grid (controls can't SUPPORTS Data → permanent-UNCOVERED
//     would be a false catastrophe); ATT&CK-mapped Data feeds the completeness count.
//   - SecurityBoundary exposures fold into the Posture Summary counts, NOT matrix rows.
//   - tier-segregated, function-classified counts — NEVER a percentage, NEVER a
//     single "Covered: N", NEVER a cross-tier rollup.
//   - detect-only = covered but no PREVENT edge at ANY tier (a reduction).
//   - structural gap (an element CLASS with zero supporting controls model-wide) is
//     ONE completeness line, not N per-technique UNCOVERED cells.
//
// Drift: coverage is live, the ledger is the snapshot. When in sync (the common,
// non-stale case) the join is exact; an exposure present live but absent from the
// snapshot ledger defaults to live (the staleness banner owns that drift).

export const TIER_RANK = { DIRECT: 3, INDIRECT_MITIGATION: 2, INDIRECT_D3FEND: 1 }
export const TIER_LABEL = {
  DIRECT: 'DIRECT',
  INDIRECT_MITIGATION: 'Mitigation',
  INDIRECT_D3FEND: 'D3FEND',
}

// Canonical ATT&CK enterprise tactic order, for stable matrix columns. Tactics
// not in this list (or future additions) sort after, alphabetically — never dropped.
const TACTIC_ORDER = [
  'Reconnaissance',
  'Resource Development',
  'Initial Access',
  'Execution',
  'Persistence',
  'Privilege Escalation',
  'Defense Evasion',
  'Credential Access',
  'Discovery',
  'Lateral Movement',
  'Collection',
  'Command and Control',
  'Exfiltration',
  'Impact',
]

const GRID_KINDS = new Set(['Component', 'DataFlow'])
const ELEMENT_CLASSES = ['Component', 'DataFlow', 'SecurityBoundary']

function tacticSort(a, b) {
  const ia = TACTIC_ORDER.indexOf(a)
  const ib = TACTIC_ORDER.indexOf(b)
  if (ia !== -1 && ib !== -1) return ia - ib
  if (ia !== -1) return -1
  if (ib !== -1) return 1
  return a.localeCompare(b)
}

/**
 * Reduce one technique's tier facts (across one or more covering elements) to a
 * best tier + a prevent/detect status.
 *   status: 'PREVENT'    — a preventive edge survives at some tier
 *           'DETECT_ONLY' — covered, but only detective edges (see it, can't stop it)
 *           'UNCOVERED'   — no covering edge
 */
function reduceTiers(tierFacts) {
  if (!tierFacts.length) return { covered: false, status: 'UNCOVERED', bestTier: null }
  let hasPrevent = false
  let bestTier = null
  for (const tf of tierFacts) {
    if (tf.function === 'PREVENT') hasPrevent = true
    if (!bestTier || TIER_RANK[tf.tier] > TIER_RANK[bestTier]) bestTier = tf.tier
  }
  // Covered means ≥1 covering edge exists. If NO preventive edge survives at any
  // tier it is detect-only ("see it, can't stop it") — and we DEFAULT a covered
  // pair with any non-PREVENT function (today only DETECT; a future D3FEND verb
  // would land here too) to detect-only rather than ever returning the impossible
  // covered+UNCOVERED state. Never over-claim prevention.
  return {
    covered: true,
    status: hasPrevent ? 'PREVENT' : 'DETECT_ONLY',
    bestTier,
  }
}

/**
 * Build the full coverage view-model consumed by the Coverage & Gaps matrix, the
 * Posture Summary coverage block, and the Residual Risk configured-mismatch column.
 *
 * @param {object|null} coverage  parsed gradedCoverage (or null when unavailable)
 * @param {Array}       ledger    SnapshotDoc.ledger (elements with findings + controls)
 * @returns {object} view-model (see fields inline). `available:false` ⇒ render the
 *   no-coverage affordance, never an empty/green grid.
 */
export function buildCoverageView(coverage, ledger) {
  if (!coverage || !Array.isArray(coverage.exposures)) {
    return { available: false }
  }
  const ledgerEls = Array.isArray(ledger) ? ledger : []
  // attack_id -> { name, description } (deduped upstream) so each row can carry the
  // human-readable technique name + description for the info dialog/tooltip.
  const techInfo = coverage.techniques ?? {}

  // disposition by finding id; an exposure absent from the snapshot ledger defaults
  // to live (the staleness banner owns coverage-vs-snapshot drift).
  const dispositionById = new Map()
  // element id -> display name, so the matrix can name the impacted element(s)
  // inline (rather than only on drill-through).
  const nameById = new Map()
  for (const el of ledgerEls) {
    if (el && el.id) nameById.set(el.id, el.name || el.id)
    for (const f of el.findings ?? []) {
      if (f && f.id) dispositionById.set(f.id, f.dispositionKind ?? null)
    }
  }
  const isLive = (exposureId) => (dispositionById.get(exposureId) ?? null) == null

  // --- per-technique accumulation over the GRID universe (live, Component/DataFlow) ---
  // techniqueId -> { tactics:Set, elementsTotal:Set, elementsCovered:Set,
  //                  cms:Set, controls:Set, tierFacts:[] }
  const grid = new Map()
  // Posture Summary tier-segregated bucket sets, over LIVE non-Data exposures
  // (Component+DataFlow+SecurityBoundary). Keyed by (exposureId|techniqueId) so a
  // pair is counted once.
  const bucket = {
    directPrevent: new Set(),
    directDetect: new Set(),
    mitigation: new Set(),
    d3fend: new Set(),
    detectOnly: new Set(),
    uncovered: new Set(),
  }
  // per-element covering controls (controlIds that cover ≥1 of the element's gaps)
  const coveringControlsByElement = new Map()
  const allCoveringControls = new Set()

  let softCount = 0
  let dataMappedCount = 0
  let dispositionedExcluded = 0
  // Data exposures are OFF the coverage grid (a control can't SUPPORTS Data, so
  // coverage is not assessable) — but the ATT&CK mapping itself IS a known fact
  // about the exposure. Collect it, grouped by the Data element, so Coverage & Gaps
  // can reveal (off-grid, no tier encoding) WHICH techniques each Data element maps
  // to — never a coverage claim, just the mapping the banner used to only count.
  const dataMappedByElement = new Map()

  for (const e of coverage.exposures) {
    const live = isLive(e.exposureId)
    if (!live) {
      dispositionedExcluded++
      continue
    }
    if (e.soft) {
      // live exposure with no ATT&CK mapping — off-grid, coverage unprovable
      softCount++
      continue
    }
    if (e.elementKind === 'Data') {
      // off the grid (controls can't SUPPORTS Data); count toward completeness
      dataMappedCount++
      // …and retain the technique mapping (deduped, resolved) so Coverage & Gaps can
      // disclose it without ever charting Data as covered/uncovered. Grouped per Data
      // element.
      for (const t of e.techniques ?? []) {
        if (!t || !t.techniqueId) continue
        let d = dataMappedByElement.get(e.elementId)
        if (!d) dataMappedByElement.set(e.elementId, (d = { seen: new Set(), techs: [] }))
        if (d.seen.has(t.techniqueId)) continue
        d.seen.add(t.techniqueId)
        d.techs.push({
          techniqueId: t.techniqueId,
          name: techInfo[t.techniqueId]?.name ?? null,
          tactics: Array.isArray(t.tactics) ? t.tactics : [],
          description: techInfo[t.techniqueId]?.description ?? null,
        })
      }
      continue
    }
    const inGrid = GRID_KINDS.has(e.elementKind)
    for (const t of e.techniques ?? []) {
      const tiers = t.tiers ?? []
      const red = reduceTiers(tiers)
      const pairKey = `${e.exposureId}|${t.techniqueId}`

      // Posture Summary counts (non-Data live universe — incl. SecurityBoundary)
      for (const tf of tiers) {
        if (tf.tier === 'DIRECT' && tf.function === 'PREVENT') bucket.directPrevent.add(pairKey)
        if (tf.tier === 'DIRECT' && tf.function === 'DETECT') bucket.directDetect.add(pairKey)
        if (tf.tier === 'INDIRECT_MITIGATION') bucket.mitigation.add(pairKey)
        if (tf.tier === 'INDIRECT_D3FEND') bucket.d3fend.add(pairKey)
      }
      if (!red.covered) bucket.uncovered.add(pairKey)
      else if (red.status === 'DETECT_ONLY') bucket.detectOnly.add(pairKey)

      // Covering controls for this element. "Covering" here means contributing
      // ANY covering edge (preventive OR detective) — a detect-only control is
      // still doing something on this element, so it is NOT "configured-but-
      // mismatched" (mismatch = covers none of the element's modeled threats at
      // all). The prevent/detect distinction is preserved where it matters: the
      // tier facts, the detect-only reduction, and the Posture Summary block.
      if (red.covered) {
        let set = coveringControlsByElement.get(e.elementId)
        if (!set) coveringControlsByElement.set(e.elementId, (set = new Set()))
        for (const tf of tiers) for (const c of tf.controlIds ?? []) { set.add(c); allCoveringControls.add(c) }
      }

      // Coverage & Gaps grid rows (Component + DataFlow only)
      if (!inGrid) continue
      let g = grid.get(t.techniqueId)
      if (!g) grid.set(t.techniqueId, (g = {
        tactics: new Set(), elementsTotal: new Set(), elementsCovered: new Set(),
        cms: new Set(), controls: new Set(), facts: [],
      }))
      for (const tac of t.tactics ?? []) g.tactics.add(tac)
      g.elementsTotal.add(e.elementId)
      if (red.covered) g.elementsCovered.add(e.elementId)
      for (const tf of tiers) {
        g.facts.push(tf)
        for (const c of tf.countermeasureIds ?? []) g.cms.add(c)
        for (const c of tf.controlIds ?? []) g.controls.add(c)
      }
    }
  }

  // --- materialise grid rows ---
  const rows = []
  const tacticSet = new Set()
  for (const [techniqueId, g] of grid) {
    const red = reduceTiers(g.facts)
    const tactics = [...g.tactics].sort(tacticSort)
    tactics.forEach((t) => tacticSet.add(t))
    rows.push({
      techniqueId,
      name: techInfo[techniqueId]?.name ?? null,
      description: techInfo[techniqueId]?.description ?? null,
      tactics,
      bestTier: red.bestTier,
      status: red.status, // PREVENT | DETECT_ONLY | UNCOVERED
      covered: red.covered,
      elementsTotal: g.elementsTotal.size,
      elementsCovered: g.elementsCovered.size,
      // The impacted elements, NAMED, each an independent drill target — so the row
      // shows WHICH elements the technique hits and a click lands on the right one
      // (the technique aggregates across all of these; there is no single element).
      // Sorted gaps-first (uncovered before covered) then by name, so the actionable
      // elements lead.
      elements: [...g.elementsTotal]
        .map((id) => ({ id, name: nameById.get(id) ?? id, covered: g.elementsCovered.has(id) }))
        .sort((a, b) => Number(a.covered) - Number(b.covered) || a.name.localeCompare(b.name)),
      // technique-scoped (unioned across the covering elements) — NOT per-element
      // attributed; the drill goes to the Component Profile, which recomputes
      // per-element controls from the ledger, so no element-level mis-attribution is
      // possible here.
      countermeasureIds: [...g.cms].sort(),
      controlIds: [...g.controls].sort(),
    })
  }
  rows.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId))
  const tactics = [...tacticSet].sort(tacticSort)

  // --- off-grid Data → ATT&CK disclosure: one drillable entry per Data element,
  //     its techniques deduped + id-sorted (the chips the Coverage & Gaps banner
  //     reveals) ---
  const dataMapped = [...dataMappedByElement.entries()]
    .map(([elementId, d]) => ({
      elementId,
      elementName: nameById.get(elementId) ?? elementId,
      techniques: d.techs.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId)),
    }))
    .sort((a, b) => a.elementName.localeCompare(b.elementName))

  // --- structural gaps: element CLASSES with zero supporting controls model-wide ---
  const classHasControl = {}
  const classHasElement = {}
  for (const el of ledgerEls) {
    if (!ELEMENT_CLASSES.includes(el.type)) continue
    classHasElement[el.type] = true
    if ((el.supportingControls ?? []).length > 0) classHasControl[el.type] = true
  }
  const structuralGaps = ELEMENT_CLASSES.filter((c) => classHasElement[c] && !classHasControl[c])

  // --- defense-in-depth: supporting controls model-wide that cover NOTHING ---
  const allSupportingControls = new Set()
  for (const el of ledgerEls) for (const c of el.supportingControls ?? []) if (c?.id) allSupportingControls.add(c.id)
  const defenseInDepth = [...allSupportingControls].filter((c) => !allCoveringControls.has(c)).length

  // --- mismatched controls per element: supports the element, covers none of its gaps ---
  const mismatchByElement = {}
  for (const el of ledgerEls) {
    const supporting = (el.supportingControls ?? []).map((c) => c?.id).filter(Boolean)
    if (!supporting.length) continue
    const covering = coveringControlsByElement.get(el.id) ?? new Set()
    const mismatched = supporting.filter((c) => !covering.has(c))
    if (mismatched.length) mismatchByElement[el.id] = mismatched
  }

  return {
    available: true,
    generatedAt: coverage.generatedAt ?? null,
    tactics,
    rows,
    offGrid: { softCount, dataMappedCount, dispositionedExcluded, dataMapped },
    structuralGaps,
    summary: {
      directPrevent: bucket.directPrevent.size,
      directDetect: bucket.directDetect.size,
      mitigation: bucket.mitigation.size,
      d3fend: bucket.d3fend.size,
      detectOnly: bucket.detectOnly.size,
      uncovered: bucket.uncovered.size,
      soft: softCount,
      defenseInDepth,
    },
    mismatchByElement,
  }
}

/**
 * Per-exposure ATT&CK technique index for the Component Profile + Residual Risk
 * ledger technique chips. The coverage payload is the ONLY source of
 * exposure→technique mappings
 * (the snapshot ledger carries none), so this resolves each exposure's techniques
 * to the full { techniqueId, name, tactics, description } the shared
 * TechniqueInfoDialog renders.
 *
 * Disposition-AGNOSTIC by design — a technique mapping is a fact about the
 * exposure regardless of disposition — so it lights up live AND reviewed findings
 * alike. Keyed by exposureId, which equals the ledger finding id (the same join
 * buildCoverageView uses). Soft (unmapped) exposures yield no entry, so chips are
 * purely additive: an exposure with no entry renders no chips — never a false
 * "no techniques".
 *
 * @param {object|null} coverage parsed gradedCoverage (or null when unavailable)
 * @returns {Object<string, Array<{techniqueId:string,name:?string,tactics:string[],description:?string}>>}
 *   empty object when coverage is unavailable.
 */
export function buildExposureTechniqueIndex(coverage) {
  const out = {}
  if (!coverage || !Array.isArray(coverage.exposures)) return out
  const techInfo = coverage.techniques ?? {}
  for (const e of coverage.exposures) {
    const techs = e.techniques ?? []
    if (!techs.length) continue
    const seen = new Set()
    const list = []
    for (const t of techs) {
      if (!t || !t.techniqueId || seen.has(t.techniqueId)) continue
      seen.add(t.techniqueId)
      list.push({
        techniqueId: t.techniqueId,
        name: techInfo[t.techniqueId]?.name ?? null,
        tactics: Array.isArray(t.tactics) ? t.tactics : [],
        description: techInfo[t.techniqueId]?.description ?? null,
      })
    }
    list.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId))
    if (list.length) out[e.exposureId] = list
  }
  return out
}

/**
 * Filter matrix rows by the Tier control. The options form a COMPLETE PARTITION of
 * the rows so the individual selections sum to "all": each covered row falls under
 * exactly one of DIRECT / INDIRECT_MITIGATION / INDIRECT_D3FEND (its BEST tier), and
 * every uncovered row falls under 'UNCOVERED'. ('all' returns everything.)
 */
export function filterByTier(rows, tier) {
  if (!Array.isArray(rows) || tier === 'all' || !tier) return rows ?? []
  if (tier === 'UNCOVERED') return rows.filter((r) => !r.covered)
  return rows.filter((r) => r.bestTier === tier)
}

/**
 * The exact Posture Summary coverage-block lines — tier-segregated +
 * function-classified, with D3FEND carried as "(broad/inferred)" so a screenshot
 * can't show a flattering aggregate. NEVER a percentage, NEVER a single
 * "Covered: N". Defense-in-depth is its own line. Returns an array of
 * {label, value, note?} so the
 * component renders deep-links; a pure string form is available for the export.
 */
export function coverageSummaryLines(summary) {
  if (!summary) return []
  return [
    { key: 'directPrevent', label: 'DIRECT-prevent', value: summary.directPrevent },
    { key: 'directDetect', label: 'DIRECT-detect', value: summary.directDetect },
    { key: 'mitigation', label: 'Mitigation', value: summary.mitigation },
    { key: 'd3fend', label: 'D3FEND', value: summary.d3fend, note: 'broad/inferred' },
    { key: 'detectOnly', label: 'detect-only', value: summary.detectOnly },
    { key: 'uncovered', label: 'uncovered', value: summary.uncovered },
    { key: 'soft', label: 'soft/unmapped', value: summary.soft },
  ]
}
