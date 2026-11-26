/**
 * The answer `hiddenEdgeCandidates` returns, in the contract the caller asked for.
 *
 * Contract 1 is the envelope every client reads: contract, module, version, table hash, regime, candidates, counts.
 * Contract 2 adds, per candidate, `explain` (the parts that give it its tier, ordered, each with its facts and the
 * reasons beside its tier), and on the envelope `mode`, the rules' `rationale` and the `limits` the caps set. The
 * explanation is worked out after the walk, for the listed candidates only, so contract 1 costs what it did. The
 * remedies (remedies.ts) have their own budget; past it, a candidate's are `null`, counted as `remedies_skipped`. The
 * explanation gives the event loop a turn between candidates, and the remedies within one.
 *
 * A contract-2 answer is held under `ANSWER_CHARS_MAX` characters (the unit clients read in): over it, each
 * candidate keeps only its primary part, then explanations are left out from the lowest-ordered candidate up. The
 * answer is never refused for its size.
 */
import type { Deadline } from './bounds';
import type { KindClass } from './classes';
import { Contract, MODULE_NAME, MODULE_VERSION } from './contract';
import type { FoldedModel } from './fold';
import { Basis, Candidate, ExplainFact, explainPart, Matched, MAX_PEERS, Part, PER_KIND_BUDGET } from './generate';
import type { RecheckResult } from './recheck';
import type { KgRegime } from './kg';
import { nextTurn, Remedy, RemedyBudget, remediesFor } from './remedies';
import { EDGE_KINDS, EdgeKind, EdgeKindTable } from './table';

/** A contract-2 answer's size cap, in UTF-16 units: under the 1 MiB a client reads, with room to spare. */
export const ANSWER_CHARS_MAX = 900 * 1024;
/** Parts explained per candidate. */
export const MAX_PARTS = 3;
/** Facts per part. */
export const MAX_PART_FACTS = 12;
/** Of those, the knowledge graph's on the primary part: its evidence is said, never crowding out the model's facts. */
export const MAX_KG_FACTS = 2;
/** The largest count a limit carries. */
const COUNT_MAX = 1e9;

const TIER_RANK = { low: 0, medium: 1, high: 2 } as const;

export interface ExplainedPart {
  row: string;
  role: string;
  relation: string;
  exposure: string;
  anchor: string;
  matched: string[];
  path: string;
  foothold: string;
  reached: string;
  anchored_end: string | null;
  shared: string | null;
  flow: string | null;
  item: string | null;
  low: string | null;
  tier: string;
  basis: Basis;
  facts: ExplainFact[];
  facts_total: number;
}

export type Explain =
  | { parts: ExplainedPart[]; parts_total: number; crown_jewel: { source: boolean; target: boolean }; remedies: Remedy[] | null; remedies_total: number }
  | { omitted: 'size' };

export interface AnswerInput {
  contract: Contract;
  model: FoldedModel;
  table: EdgeKindTable;
  tableHash: string;
  classes: Readonly<Record<EdgeKind, KindClass>>;
  /** The walk's result: every matched candidate, the kept parts, the per-kind tallies, the counts. */
  matched: Matched;
  /** The listed candidates, after the knowledge graph, in the answer's order. */
  candidates: Candidate[];
  /** The knowledge graph's own evidence for each candidate it lowered, whole (from applyKg). */
  kgEvidence?: ReadonlyMap<string, string[]>;
  regime: KgRegime;
  classesCapped: number;
  /** The call's deadline, which the remedies leave room in. */
  deadline?: Deadline;
  /** The remedies' budget of pairs judged again (tests). */
  remedyJudges?: number;
}

/** The kept parts that give a candidate its tier, in the order the explanation uses: confirmed findings first. */
export function primaryOrder(model: FoldedModel, parts: Part[]): Part[] {
  const top = Math.max(...parts.map((p) => TIER_RANK[p.tier]));
  const confirmed = (p: Part) => Number(model.exposures.get(p.exposures[0])?.lifecycle === 'confirmed');
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return parts
    .filter((p) => TIER_RANK[p.tier] === top)
    .sort((a, b) => confirmed(b) - confirmed(a) || cmp(a.exposures[0], b.exposures[0]) || cmp(a.row.id, b.row.id) || cmp(a.pair.item ?? '', b.pair.item ?? ''));
}

async function explainOf(input: AnswerInput, c: Candidate, budget: RemedyBudget): Promise<Explain> {
  const { model, matched } = input;
  const ordered = primaryOrder(model, matched.parts?.get(c.id) ?? []);
  const kgFacts: ExplainFact[] = c.kg ? (input.kgEvidence?.get(c.id) ?? []).map((f) => ({ at: [f], value: null, effect: 'kg_lowered' as const })) : [];
  const parts = ordered.slice(0, MAX_PARTS).map((p, i): ExplainedPart => {
    const e = model.exposures.get(p.exposures[0])!;
    const judged = explainPart(matched.topology!, p, e);
    // the knowledge graph's step is the candidate's, said once, on its primary part, after the model's facts and
    // within its own room
    const kg = i === 0 ? kgFacts : [];
    const shownKg = kg.slice(0, MAX_KG_FACTS);
    const facts = [...judged.facts.slice(0, MAX_PART_FACTS - shownKg.length), ...shownKg];
    return {
      row: p.row.id,
      role: p.row.exposed_role,
      relation: p.row.peer_relation,
      exposure: e.id,
      anchor: e.elementId,
      matched: [...p.matched],
      path: p.path,
      foothold: p.pair.source,
      reached: p.pair.target,
      anchored_end: p.pair.anchoredEnd,
      shared: p.pair.shared,
      flow: p.pair.flow,
      item: p.pair.item,
      low: p.pair.lowReason,
      tier: judged.tier,
      basis: judged.basis,
      facts,
      facts_total: judged.facts.length + kg.length,
    };
  });
  const remedies = await remediesFor(matched.topology!, model, matched.parts?.get(c.id) ?? [], matched.pastCap?.get(c.id) ?? [], budget);
  return {
    parts,
    parts_total: ordered.length,
    crown_jewel: { source: !!model.components.get(c.source)?.crownJewel, target: !!model.components.get(c.target)?.crownJewel },
    remedies: remedies ? remedies.remedies : null,
    remedies_total: remedies ? remedies.total : 0,
  };
}

/** A recheck's answer (contract 2): one verdict per rechecked edge, in the order asked, and no candidates. */
export function recheckAnswerOf(tableHash: string, recheck: RecheckResult[]): Record<string, unknown> {
  return { contract: 2, module: MODULE_NAME, version: MODULE_VERSION, table_hash: tableHash, mode: 'recheck', candidates: [], recheck };
}

/** The answer in the contract asked for. */
export async function answerOf(input: AnswerInput, { sizeLimit = ANSWER_CHARS_MAX }: { sizeLimit?: number } = {}): Promise<Record<string, unknown>> {
  const { model, matched } = input;
  const counts = {
    ...model.counts,
    ...matched.counts,
    kg_classes_capped: input.classesCapped,
    boundaries: model.boundaries.size,
    components: model.components.size,
    flows: model.flows.size,
    dataItems: model.dataItems.size,
    exposures: model.exposures.size,
    controls: model.controls.size,
  };
  const head = { contract: input.contract, module: MODULE_NAME, version: MODULE_VERSION, table_hash: input.tableHash, regime: input.regime };
  const withClass = (c: Candidate) => ({ ...c, class: input.classes[c.kind as EdgeKind] });
  if (input.contract === 1) return { ...head, candidates: input.candidates.map(withClass), counts };

  const budget = new RemedyBudget(input.deadline, input.remedyJudges);
  const explains: Explain[] = [];
  for (const c of input.candidates) {
    explains.push(await explainOf(input, c, budget));
    await nextTurn();
  }
  const byKind: Record<string, { listed: number; not_listed: number; pairs_capped: number; anchors_over_budget: number }> = {};
  for (const kind of EDGE_KINDS) {
    const listed = input.candidates.filter((c) => c.kind === kind).length;
    const tally = matched.byKind.get(kind) ?? { pairs_capped: 0, anchors_over_budget: 0 };
    const bound = (n: number) => Math.min(n, COUNT_MAX);
    byKind[kind] = {
      listed,
      not_listed: bound(matched.candidates.filter((c) => c.kind === kind).length - listed),
      pairs_capped: bound(tally.pairs_capped),
      anchors_over_budget: bound(tally.anchors_over_budget),
    };
  }
  const used = new Set(input.candidates.flatMap((c) => c.rows));
  const rationale = Object.fromEntries(input.table.rows.filter((r) => used.has(r.id)).map((r) => [r.id, r.provenance]));
  // the candidates shown without remedies for the budget (one left out for size is counted there instead)
  const skippedIn = (ex: Explain[]) => ex.filter((x) => 'parts' in x && x.remedies === null).length;
  const limits = { per_kind_budget: PER_KIND_BUDGET, max_peers: MAX_PEERS, by_kind: byKind, explain_trimmed: 0, remedies_skipped: skippedIn(explains) };
  const build = (ex: Explain[]) => ({
    ...head,
    mode: 'candidates',
    candidates: input.candidates.map((c, i) => ({ ...withClass(c), explain: ex[i] })),
    counts,
    rationale,
    limits,
  });

  // the size trim: each explanation is measured once, in each form it can take; the rest of the answer once
  const OMITTED: Explain = { omitted: 'size' };
  const omittedChars = JSON.stringify(OMITTED).length;
  const base = JSON.stringify(build(explains.map(() => OMITTED))).length + 32; // room for explain_trimmed's digits
  const full = explains.map((x) => JSON.stringify(x).length);
  const primaryOnly = explains.map((x) => ('parts' in x && x.parts.length > 1 ? { ...x, parts: x.parts.slice(0, 1) } : x));
  const primaryChars = primaryOnly.map((x) => JSON.stringify(x).length);
  let total = base + full.reduce((n, x) => n + x - omittedChars, 0);
  if (total <= sizeLimit) return build(explains);
  const chosen: Explain[] = [...primaryOnly];
  const trimmed = new Set<number>(explains.flatMap((x, i) => ('parts' in x && x.parts.length > 1 ? [i] : [])));
  total = base + primaryChars.reduce((n, x) => n + x - omittedChars, 0);
  for (let i = chosen.length - 1; i >= 0 && total > sizeLimit; i--) {
    total -= primaryChars[i] - omittedChars;
    chosen[i] = OMITTED;
    trimmed.add(i);
  }
  limits.explain_trimmed = trimmed.size;
  limits.remedies_skipped = skippedIn(chosen);
  return build(chosen);
}
