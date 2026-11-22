/**
 * The review table as the tools return it: one compact row per candidate, names shown as names (cut, cleaned), ids
 * kept for the operator's `show`. Paged by size, so a long table reaches the operator whole across calls.
 */
import { shown } from '../triage/text.js'
import { kindLabel } from './contract.js'
import { bulkAcceptable, type HiddenEdgeReview, type ReviewCandidate } from './review.js'

/** The most characters of rows one result carries. */
export const PAGE_CHARS = 20_000

export function rowOf(r: HiddenEdgeReview, c: ReviewCandidate): Record<string, unknown> {
  const name = (id: string) => shown(r.local.components.get(id)?.name ?? id, 60)
  const exposure = (id: string) => shown(r.exposures.get(id)?.name ?? id, 80)
  return {
    n: c.n,
    id: c.id,
    kind: kindLabel(c.kind),
    edge: `${name(c.source)} → ${name(c.target)}`,
    tier: c.tier,
    ...(c.kg_lowered ? { kg: 'lowered' } : {}),
    techniques: c.technique_ids,
    exposures: c.exposure_ids.map(exposure),
    base: c.base,
    ...(Object.keys(c.fields).length ? { fields: c.fields } : {}),
    ...(c.facts.length ? { facts: c.facts } : {}),
    ...(c.evidence.length ? { evidence: c.evidence } : {}),
    ...(c.pending_only ? { pending_only: true } : {}),
    in_accept_all: bulkAcceptable(c),
    choice: c.choice,
  }
}

/** One page of rows from `offset`, under the page budget; at least one row. */
export function pageOf(r: HiddenEdgeReview, offset: number): { rows: Array<Record<string, unknown>>; next_offset?: number } {
  const rows: Array<Record<string, unknown>> = []
  let size = 0
  let i = offset
  for (; i < r.candidates.length; i++) {
    const row = rowOf(r, r.candidates[i]!)
    const len = JSON.stringify(row).length
    if (rows.length && size + len > PAGE_CHARS) break
    rows.push(row)
    size += len
  }
  return i < r.candidates.length ? { rows, next_offset: i } : { rows }
}
