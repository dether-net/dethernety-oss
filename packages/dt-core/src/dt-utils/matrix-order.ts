/**
 * Matrix order for MITRE tactics. The ingest stamps every ATT&CK and ATLAS tactic with its
 * `matrix_order` (its position in the framework's own ordered tactic list). A tactic without
 * one comes from data ingested before that stamp: it sorts after the placed tactics, by its
 * framework id so the order is stable, and the reader is told the data needs re-ingesting.
 */
type MatrixPlaced = { matrix_order?: number | null }

const rank = (tactic: MatrixPlaced): number =>
  typeof tactic.matrix_order === 'number' ? tactic.matrix_order : Number.MAX_SAFE_INTEGER

/** Sort tactics by matrix position, then by framework id. Returns a new array. */
export function sortByMatrixOrder<T extends MatrixPlaced>(tactics: readonly T[], idOf: (tactic: T) => string | null | undefined): T[] {
  return [...tactics].sort((a, b) => rank(a) - rank(b) || (idOf(a) ?? '').localeCompare(idOf(b) ?? ''))
}

/** Warn when some tactics carry no matrix position, so their order is by id, not by the matrix. */
export function warnUnplacedTactics(tactics: readonly MatrixPlaced[], framework: string): void {
  const unplaced = tactics.filter(tactic => typeof tactic.matrix_order !== 'number').length
  if (unplaced > 0) {
    console.warn(
      `[dt-core] ${unplaced} ${framework} tactic(s) have no matrix_order: the MITRE data predates matrix ` +
        'ordering, so they are listed last, by id. Re-ingest the mitre-frameworks module to restore the matrix order.',
    )
  }
}
