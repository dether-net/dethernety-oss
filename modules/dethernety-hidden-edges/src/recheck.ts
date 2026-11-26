/**
 * The recheck (contract 2, `options.recheck`): whether edges a person accepted, rejected or took back still hold,
 * with a positive reason when they do not.
 *
 * An accepted edge's flow is never a declared flow, so its candidate is still generated; but a missing candidate is
 * ambiguous (a budget, a cap, an exclusion may each have left it out). So the recheck walks the rechecked kinds'
 * rows with none of those (see `recheckWalk`) and answers per edge, the first verdict that matches:
 *
 *   end_gone          an end is no longer a component of the model
 *   declared_flow     the path is drawn as an ordinary flow
 *   holds             some way in is kept: its tier (facts only, no knowledge graph), whether only pending findings
 *                     carry it, and whether a kept way rests on one of the findings the edge was shown with
 *   removed           every way in was removed by a breaker or a control (the facts that removed it)
 *   end_type          every way in failed a type check (reached end, starting point, or a target row's anchor)
 *   mixed             ways in were found and none kept, for different reasons (the parts say which)
 *   grounds_disposed  no way in; a finding the edge was shown with is still there and disposed, and every other is
 *                     disposed or gone
 *   not_derived       no way in at all: among them, every finding it was shown with gone (it stopped firing)
 */
import type { FoldedModel } from './fold';
import { candidateId, RecheckEntry, RecheckPart } from './generate';
import type { Tier } from './table';

export const RECHECK_VERDICTS = ['end_gone', 'declared_flow', 'holds', 'removed', 'end_type', 'mixed', 'grounds_disposed', 'not_derived'] as const;
export type RecheckVerdict = (typeof RECHECK_VERDICTS)[number];
/** Ways in listed per rechecked edge. */
export const MAX_RECHECK_PARTS = 10;
/** Removing facts listed per rechecked edge. */
export const MAX_RECHECK_FACTS = 12;

export interface RecheckResult {
  id: string;
  verdict: RecheckVerdict;
  tier?: Tier;
  pending_only?: boolean;
  in_given?: boolean;
  parts: Array<{ row: string; exposure: string; reason: string }>;
  facts?: string[];
}

const TIER_OF = ['low', 'medium', 'high'] as const;
const RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

const REASON_ORDER = ['kept', 'removed', 'end_type', 'declared_flow'];

/**
 * The ways in to list: one per (row, finding, reason), kept ones first, then taken in turn from each reason, so a
 * cut list still shows every reason behind a verdict.
 */
function listed(found: RecheckPart[]): Array<{ row: string; exposure: string; reason: string }> {
  const byReason = new Map<string, Array<{ row: string; exposure: string; reason: string }>>();
  const seen = new Set<string>();
  const sorted = [...found].sort((a, b) => (a.exposure < b.exposure ? -1 : a.exposure > b.exposure ? 1 : 0) || (a.row < b.row ? -1 : a.row > b.row ? 1 : 0));
  for (const p of sorted) {
    const key = `${p.row}\u0000${p.exposure}\u0000${p.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byReason.get(p.reason) ?? [];
    list.push({ row: p.row, exposure: p.exposure, reason: p.reason });
    byReason.set(p.reason, list);
  }
  const queues = REASON_ORDER.map((r) => byReason.get(r) ?? []).filter((q) => q.length > 0);
  const out: Array<{ row: string; exposure: string; reason: string }> = [...(byReason.get('kept') ?? []).splice(0, MAX_RECHECK_PARTS)];
  for (let i = 0; out.length < MAX_RECHECK_PARTS && queues.some((q) => q.length > 0); i = (i + 1) % queues.length) {
    const next = queues[i].shift();
    if (next) out.push(next);
  }
  return out;
}

/** The verdict for one rechecked edge, from the ways in the walk found for it. */
export function verdictOf(m: FoldedModel, hasDeclaredFlow: (s: string, t: string) => boolean, entry: RecheckEntry, found: RecheckPart[]): RecheckResult {
  const id = candidateId(entry.kind, entry.source, entry.target);
  const parts = listed(found);
  if (!m.components.has(entry.source) || !m.components.has(entry.target)) return { id, verdict: 'end_gone', parts: [] };
  if (hasDeclaredFlow(entry.source, entry.target)) return { id, verdict: 'declared_flow', parts };
  const kept = found.filter((p) => p.reason === 'kept');
  if (kept.length > 0) {
    const given = new Set(entry.exposure_ids);
    return {
      id,
      verdict: 'holds',
      tier: TIER_OF[Math.max(...kept.map((p) => RANK[p.tier!]))],
      pending_only: kept.every((p) => p.pending === true),
      // with no findings given there is nothing to compare: said neither way
      ...(given.size > 0 ? { in_given: kept.some((p) => given.has(p.exposure)) } : {}),
      parts,
    };
  }
  if (found.length > 0) {
    const reasons = new Set(found.map((p) => p.reason));
    if (reasons.size === 1 && reasons.has('removed')) {
      const facts = [...new Set(found.flatMap((p) => p.facts ?? []))].sort().slice(0, MAX_RECHECK_FACTS);
      return { id, verdict: 'removed', parts, facts };
    }
    if (reasons.size === 1 && reasons.has('end_type')) return { id, verdict: 'end_type', parts };
    return { id, verdict: 'mixed', parts };
  }
  // a person disposed a finding it rested on (one still there); one only gone stopped firing, which no one decided
  const disposed = (x: string) => m.exposures.get(x)?.lifecycle === 'disposed';
  const grounds = entry.exposure_ids;
  if (grounds.some(disposed) && grounds.every((x) => !m.exposures.has(x) || disposed(x))) return { id, verdict: 'grounds_disposed', parts: [] };
  return { id, verdict: 'not_derived', parts: [] };
}
