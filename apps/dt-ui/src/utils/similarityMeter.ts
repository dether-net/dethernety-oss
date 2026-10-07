/**
 * The 3-dot similarity meter shared by the class and technique pickers.
 *
 * Anchored to the lowest score the backend returns: the EMBEDDING_SIMILARITY_THRESHOLD
 * default (0.40), tuned for the default embedding model. A returned match therefore always
 * lights at least one dot, and the buckets are derived from the floor rather than separate
 * magic numbers, so neither picker can drift from the threshold on its own.
 */
export const VECTOR_SIMILARITY_FLOOR = 0.4

export function similarityMeterLevel (score?: number | null): number {
  if (score == null) return 0
  const span = 1 - VECTOR_SIMILARITY_FLOOR
  if (score >= VECTOR_SIMILARITY_FLOOR + span * 0.5) return 3 // >= 0.70
  if (score >= VECTOR_SIMILARITY_FLOOR + span * 0.25) return 2 // >= 0.55
  if (score >= VECTOR_SIMILARITY_FLOOR) return 1 // >= 0.40
  return 0
}
