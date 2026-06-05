// frontend/lib/completenessFlags.js — model-wide completeness/honesty flags.
//
// The scope-honesty contract: a clean-looking report must NEVER read as an
// all-clear when the truth is "we didn't analyse the risky parts." These are the
// model-wide silent-green guards that the per-view honesty (untriaged counts,
// empty-state guards, Boundary Crossings' own flags, the freshness banner)
// doesn't cover. Pure over the snapshot doc — no Vue, no network, unit-tested.
// Surfaced banner-first (the shell folds them into the ScopeBanner) so a
// reviewer learns them BEFORE reading a reassuring count.

/**
 * @param {object} modelGraph  the snapshot doc's modelGraph (components + dataNodes)
 * @param {Array}  ledger      the raw snapshot ledger (LedgerElement[])
 * @returns {Array<{key,label,severity}>}  same flag shape ScopeBanner / Boundary Crossings use
 */
export function computeCompletenessFlags(modelGraph, ledger) {
  const mg = modelGraph && typeof modelGraph === 'object' ? modelGraph : {}
  const components = Array.isArray(mg.components) ? mg.components : []
  const dataNodes = Array.isArray(mg.dataNodes) ? mg.dataNodes : []
  const els = Array.isArray(ledger) ? ledger : []

  const findingCount = new Map(els.map((e) => [e.id, (e.findings ?? []).length]))
  const hasFindings = (id) => (findingCount.get(id) ?? 0) > 0

  const flags = []

  // Silent-green guard: a HIGH-VALUE element (author-flagged crown jewel, or
  // classified Data) with ZERO modeled exposures is UNDER-ANALYSED, not safe —
  // exactly the case where a green-looking report misleads. Name a few.
  const highValue = [
    ...components.filter((c) => c.crownJewel && !hasFindings(c.id)).map((c) => c.name || '(unnamed)'),
    ...dataNodes.filter((d) => d.sensitivity != null && !hasFindings(d.id)).map((d) => d.name || '(unnamed)'),
  ]
  if (highValue.length > 0) {
    const shown = highValue.slice(0, 3).join(', ')
    flags.push({
      key: 'under-analyzed-high-value',
      severity: 'warning',
      label: `${highValue.length} high-value element${highValue.length === 1 ? '' : 's'} (crown jewel / classified data) with no modeled exposures — under-analyzed, not an all-clear: ${shown}${highValue.length > 3 ? '…' : ''}`,
    })
  }

  // Orphan components — outside any security boundary: segmentation / boundary-
  // crossing analysis can't place them, so their crossings are invisible to the
  // Boundary Crossings view.
  const orphans = components.filter((c) => c.boundaryId == null)
  if (orphans.length > 0) {
    flags.push({
      key: 'orphan-components',
      severity: 'warning',
      label: `${orphans.length} component${orphans.length === 1 ? '' : 's'} outside any security boundary — boundary-crossing analysis can't place ${orphans.length === 1 ? 'it' : 'them'}`,
    })
  }

  return flags
}
