/**
 * The review table as the tools return it: one compact row per candidate, names shown as names (cut, cleaned), ids
 * kept for the operator's `show`. Paged by size, so a long table reaches the operator whole across calls. Under the
 * extended answer, a row says how the attacker moves (its `path`) and why its evidence is what it is; `show <n>` adds
 * the cited findings numbered (the numbers `accept <n> affirm <k>` takes), the other ways in, the facts the module
 * weighed, what would remove or lower the edge, the rule's rationale and its defaults.
 */
import { kindLabel } from './contract.js'
import type { Limits } from './explain.js'
import { bulkAcceptable, type HiddenEdgeReview, type ReviewCandidate } from './review.js'
import { evidenceLine, factsOf, namerOf, remedyLine, said, storyOf } from './story.js'

/** The most characters of rows one result carries. */
export const PAGE_CHARS = 20_000
/** The most characters of a row's path, and of each story `show` gives. */
export const PATH_CHARS = 300
/** The most characters of a row's `removes_if`. */
export const REMOVES_CHARS = 120

const explainedOf = (c: ReviewCandidate) => (c.explain && 'parts' in c.explain ? c.explain : null)

export function rowOf(r: HiddenEdgeReview, c: ReviewCandidate): Record<string, unknown> {
  const name = (id: string) => said(r.local.components.get(id)?.name ?? id, 60)
  const exposure = (id: string) => said(r.exposures.get(id)?.name ?? id, 80)
  const x = explainedOf(c)
  const n = x ? namerOf(r.local, r.exposures) : null
  return {
    n: c.n,
    id: c.id,
    kind: kindLabel(c.kind),
    edge: `${name(c.source)} → ${name(c.target)}`,
    tier: c.tier,
    ...(c.kg_lowered ? { kg: 'lowered' } : {}),
    ...(x ? { path: said(storyOf(x.parts[0]!, c, n!), PATH_CHARS), evidence_why: said(evidenceLine(c, x.parts[0]!, n!)) } : {}),
    // what removes it, as the workspace's first screen says: the module's first remedy, when it gave any
    ...(x?.remedies?.length ? { removes_if: said(remedyLine(x.remedies[0]!, c, n!, r.explained?.limits?.by_kind[c.kind] ?? null), REMOVES_CHARS) } : {}),
    techniques: c.technique_ids,
    exposures: c.exposure_ids.map(exposure),
    base: c.base,
    ...(Object.keys(c.fields).length ? { fields: c.fields } : {}),
    ...(c.facts.length ? { facts: c.facts } : {}),
    ...(c.evidence.length ? { evidence: c.evidence } : {}),
    ...(c.argument ? { argument: { stance: c.argument.stance, ...(c.argument.reason ? { reason: c.argument.reason } : {}) } } : {}),
    ...(c.pending_only ? { pending_only: true } : {}),
    in_accept_all: bulkAcceptable(c),
    choice: c.choice,
  }
}

/** Whether `accept <n> affirm <k>` may name a cited finding: pending, with no disposition. */
export const affirmable = (r: HiddenEdgeReview, id: string) => {
  const e = r.exposures.get(id)
  return !!e && e.lifecycle === 'pending' && e.disposition_kind === null
}

/** A cited finding's state, in words. */
function stateWords(r: HiddenEdgeReview, id: string): string {
  const e = r.exposures.get(id)
  if (!e) return 'not in this read'
  const kind = e.disposition_kind ? `, ${e.disposition_kind.toLowerCase().replace(/_/g, ' ')}${e.dispositioned_by ? '' : ' by no person'}` : ''
  return `${e.lifecycle}${kind}${e.disposition_stale ? ', stale' : ''}`
}

/** What `show <n>` gives: the row, then the details behind it. */
export function showOf(r: HiddenEdgeReview, c: ReviewCandidate): Record<string, unknown> {
  const row = rowOf(r, c)
  const findings = c.exposure_ids.map((id, i) => {
    const e = r.exposures.get(id)
    return { k: i + 1, finding: said(e?.name ?? id, 80), on: said(e?.element_name ?? '', 60), state: stateWords(r, id), ...(affirmable(r, id) ? { affirmable: true } : {}) }
  })
  const rule_defaults = `capability ${c.defaults.required_capability}, requires ${c.defaults.required_privilege}, grants ${c.defaults.granted_privilege}: rule defaults, not checked for this edge`
  const x = explainedOf(c)
  if (!x) {
    return {
      ...row, findings, rule_defaults,
      ...(c.explain && 'omitted' in c.explain ? { explanation: "the module left out this edge's explanation, for size" } : {}),
    }
  }
  const n = namerOf(r.local, r.exposures)
  const primary = x.parts[0]!
  const limits = r.explained?.limits?.by_kind[c.kind] ?? null
  const rationale = r.explained?.rationale ?? {}
  return {
    ...row,
    findings,
    ...(x.parts_total > 1
      ? { other_ways: x.parts.slice(1).map((p) => said(storyOf(p, c, n), PATH_CHARS)), ...(x.parts_total > x.parts.length ? { other_ways_more: x.parts_total - x.parts.length } : {}) }
      : {}),
    facts_weighed: factsOf(primary, n),
    ...(primary.facts_total > primary.facts.length ? { facts_more: primary.facts_total - primary.facts.length } : {}),
    remedies: x.remedies === null
      ? ['The module left out what removes this edge, for time.']
      : x.remedies.length
        ? x.remedies.map((m) => said(remedyLine(m, c, n, limits)))
        : ['The module knows no change in the model that removes or lowers this edge.'],
    ...(x.remedies && x.remedies_total > x.remedies.length ? { remedies_more: x.remedies_total - x.remedies.length } : {}),
    rationale: Object.prototype.hasOwnProperty.call(rationale, primary.row) ? said(rationale[primary.row]!) : 'The module sent no words for this rule.',
    rule: primary.row,
    rule_defaults,
  }
}

/** The limits lines `open` reports: where the module's caps left the list short. */
export function limitsLines(l: Limits | null | undefined): string[] {
  if (!l) return []
  const lines: string[] = []
  const short = Object.entries(l.by_kind).filter(([, k]) => k.not_listed > 0)
  if (short.length) {
    lines.push(`The list is incomplete: ${short.map(([kind, k]) => `${kindLabel(kind)} ${k.listed} listed, ${k.not_listed} not`).join('; ')}. The module lists at most ${l.per_kind_budget} edges of a kind; decide some, then run hidden edges again, to see the rest.`)
  }
  const walked = Object.entries(l.by_kind).filter(([, k]) => k.pairs_capped > 0 || k.anchors_over_budget > 0)
  if (walked.length) {
    lines.push(`The module walked a limited number of starting points (at most ${l.max_peers} peers each): ${walked.map(([kind, k]) => `${kindLabel(kind)} ${k.pairs_capped} pair(s) past the cap, ${k.anchors_over_budget} finding(s) past their budget`).join('; ')}. A change that removes the paths it walked may leave others.`)
  }
  if (l.explain_trimmed > 0) lines.push(`The module left out ${l.explain_trimmed} edge explanation(s), for size.`)
  if (l.remedies_skipped > 0) lines.push(`The module left out what removes ${l.remedies_skipped} edge(s), for time.`)
  return lines
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
