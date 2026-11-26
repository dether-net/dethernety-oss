/**
 * What would remove or lower a candidate edge, true for the whole edge (contract 2).
 *
 * A candidate is the merge of several parts: an (exposure, row) way into one (kind, source, target). A breaker on
 * one part says nothing about the edge. So each change the parts' breakers suggest — an attribute group stated
 * true on the element a breaker reads, or a control of a breaker's class on the element it supports — is judged
 * again over every part of the edge, those the peer cap set aside included, on a topology that states that one
 * thing more. The edge goes when every part goes; it drops to a lower evidence when the best surviving part is
 * lower; a change that closes some parts but not the tier closes "this way in only".
 *
 * The work has its own budget, beside the call's deadline: past either, the candidates left get no remedies
 * (`null`), counted on the envelope, and the answer still arrives. It gives the event loop a turn every
 * `REMEDY_YIELD_EVERY` steps, so a long search never holds the process.
 */
import type { Deadline } from './bounds';
import type { Control, FoldedModel } from './fold';
import { controlChecks, covers, Part, readElement, rejudge, supportTargets } from './generate';
import { RESPONSE_CARRIED } from './topology';
import type { ControlBreaker, Tier } from './table';
import type { Topology } from './topology';

/** Remedies kept per candidate, the strongest first. */
export const MAX_REMEDIES = 5;
/** Pairs judged again for remedies, per call. */
export const REMEDY_JUDGES_MAX = 100_000;
/** The remedies stop when less than this is left of the call's deadline, so the answer still arrives. */
export const REMEDY_DEADLINE_RESERVE_MS = 5_000;
/** Steps (a part read for its changes, or a pair judged again) between two turns given to the event loop. */
export const REMEDY_YIELD_EVERY = 2_000;

/** Resolves on the event loop's next turn. */
export const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export type RemedyOutcome = 'removes' | 'lowers_to:low' | 'lowers_to:medium' | 'this_path_only';

export type Remedy =
  | { set: Array<{ at: string }>; outcome: RemedyOutcome; clears_finding?: string }
  | { control_classes: string[]; attributes_true: string[]; item_classes: string[]; on: string; outcome: RemedyOutcome };

const TIER_RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };
const RANK_OF: Record<RemedyOutcome, number> = { removes: 0, 'lowers_to:low': 1, 'lowers_to:medium': 2, this_path_only: 3 };

/** The remedies' share of a call: how many pairs they may judge again, and the deadline they must leave room in. */
export class RemedyBudget {
  judged = 0;
  private steps = 0;
  constructor(
    private readonly deadline?: Deadline,
    private readonly max: number = REMEDY_JUDGES_MAX,
  ) {}

  /** Whether the call's deadline still leaves the remedies room. */
  inTime(): boolean {
    return !(this.deadline && this.deadline.remaining() < REMEDY_DEADLINE_RESERVE_MS);
  }

  /** Whether the budget has room left, without spending any. */
  open(): boolean {
    return this.judged < this.max && this.inTime();
  }

  /** Whether one more pair may be judged. */
  take(): boolean {
    if (!this.open()) return false;
    this.judged += 1;
    return true;
  }

  /** Counts one step of work: true when the event loop is due a turn. */
  due(): boolean {
    this.steps += 1;
    return this.steps % REMEDY_YIELD_EVERY === 0;
  }
}

type Change =
  /** `clears`: the findings on the element that fire on these attributes, gone once they are stated true. */
  | { kind: 'attributes'; el: string; attributes: string[]; clears: Set<string> }
  | { kind: 'control'; breaker: ControlBreaker; on: string };

/**
 * The topology with one more thing stated: an attribute group true on an element (and the findings that fired on
 * it gone, so none of them lifts a target's cap either), or one more control on an element.
 */
function stating(t: Topology, change: Change): Topology {
  const o = Object.create(t) as Topology;
  if (change.kind === 'attributes') {
    const stated = { ...(t.attributesOf(change.el) ?? {}), ...Object.fromEntries(change.attributes.map((a) => [a, true])) };
    Object.defineProperty(o, 'attributesOf', { value: (id: string) => (id === change.el ? stated : t.attributesOf(id)) });
    if (change.clears.size > 0) {
      Object.defineProperty(o, 'exposuresOn', { value: { get: (id: string) => t.exposuresOn.get(id)?.filter((x) => !change.clears.has(x.id)) } });
    }
  } else {
    const cls = change.breaker.control_classes[0];
    const attribute = change.breaker.attributes_true[0];
    const control: Control = { id: '~remedy', classNames: [cls], attributesByClass: { [cls]: attribute ? { [attribute]: true } : {} }, supports: [change.on] };
    const on = [...(t.controlsOn.get(change.on) ?? []), control];
    Object.defineProperty(o, 'controlsOn', { value: { get: (id: string) => (id === change.on ? on : t.controlsOn.get(id)) } });
  }
  return o;
}

const keyOf = (c: Change) =>
  c.kind === 'attributes'
    ? `a|${c.el}|${[...c.attributes].sort().join(',')}`
    : `c|${c.on}|${[...c.breaker.control_classes].sort().join(',')}|${[...c.breaker.attributes_true].sort().join(',')}|${[...c.breaker.credential_item_classes].sort().join(',')}`;

/**
 * The changes the parts' breakers suggest: what is not stated yet, on an element the pair has. Reading the parts is
 * part of the remedies' work: `null` once the call's deadline leaves no room.
 */
async function changesOf(t: Topology, m: FoldedModel, parts: Part[], budget: RemedyBudget): Promise<Change[] | null> {
  const out = new Map<string, Change>();
  for (const p of parts) {
    if (!budget.inTime()) return null;
    if (budget.due()) await nextTurn();
    const e = m.exposures.get(p.exposures[0]);
    if (!e) continue;
    for (const b of p.row.attribute_breakers) {
      if (b.polarity !== 'true_breaks' || !covers(b.techniques, p.matched)) continue;
      const el = readElement(t, b, e, p.pair);
      if (!el || !b.classes.includes(t.className(el) ?? '')) continue;
      const attrs = t.attributesOf(el) ?? {};
      if (b.attributes.every((a) => attrs[a] === true)) continue;
      // the findings on the element that fire only on these attributes clear when they hold; one that may keep
      // firing on something else (another rule body) stays, and so does every way in it anchors
      const cls = t.className(el);
      const clears = (t.exposuresOn.get(el) ?? []).filter((x) => b.clears.some((o) => o.class === cls && o.exposure === x.name)).map((x) => x.id);
      const change: Change = { kind: 'attributes', el, attributes: [...b.attributes], clears: new Set(clears) };
      const prior = out.get(keyOf(change));
      if (prior?.kind === 'attributes') for (const id of clears) prior.clears.add(id);
      else out.set(keyOf(change), change);
    }
    // a control breaker the pair's own judging finds unmet, where it reads its controls
    for (const { breaker: c, found } of controlChecks(t, p.row, p.matched, e, p.pair)) {
      if (found) continue;
      const targets = supportTargets(t, c, e, p.pair);
      if (targets.length === 0) continue;
      const change: Change = { kind: 'control', breaker: c, on: targets[0] };
      if (!out.has(keyOf(change))) out.set(keyOf(change), change);
    }
  }
  return [...out.values()];
}

/** Whether the model states a flow encrypted, with its server certificate not stated unchecked. */
const statedEncrypted = (a: Record<string, unknown>) =>
  ['flow_tls_encrypted', 'encryption_in_transit_enabled', 'tls_only_transport', 'service_to_service_mtls_enforced'].some((k) => a[k] === true) && a.server_certificate_validated !== false;

/** Whether a change is stated on the flow a part names. */
const changesFlowOf = (change: Change, p: Part) => p.pair.flow !== null && (change.kind === 'attributes' ? change.el : change.on) === p.pair.flow;

/**
 * Whether another credential-bearing flow than the one a part names carries its credential to the edge's reached
 * end: one into it, or one out of it whose class carries the credential back in its response, with the same item
 * when the part names one; for a capture, also one the starting point shares a segment with and the model does
 * not state encrypted. The walk keeps one flow per pair, so a change on that flow alone does not close the edge.
 */
function anotherFlowCarries(t: Topology, p: Part): boolean {
  const named = p.pair.flow;
  const reached = p.pair.target;
  const capture = p.row.exposed_role === 'capture';
  const seg = capture ? t.segmentOf(p.pair.source)?.boundary : undefined;
  const responses = (t.flowsFrom.get(reached) ?? []).filter((g) => RESPONSE_CARRIED.has(g.cls?.name ?? ''));
  // the topology indexes declared flows only, so no hidden-edge flow is among these
  for (const g of [...(t.flowsInto.get(reached) ?? []), ...responses]) {
    if (g.id === named || !t.isCredentialBearing(g)) continue;
    if (p.pair.item && !t.credentialItemsOf(g).includes(p.pair.item)) continue;
    if (capture && !(seg && (t.segmentOf(g.source)?.boundary === seg || t.segmentOf(g.target)?.boundary === seg))) continue;
    if (capture && statedEncrypted(g.attributes)) continue;
    return true;
  }
  return false;
}

/**
 * The remedies for one candidate, from its kept parts and those past the peer cap; `null` when the budget ran out
 * on it. The outcome compares against the candidate's tier as its kept parts give it, before the knowledge graph:
 * a way in past the cap that survives a change keeps the edge, but never raises the tier it is judged against.
 */
export async function remediesFor(t: Topology, m: FoldedModel, kept: Part[], pastCap: Part[], budget: RemedyBudget): Promise<{ remedies: Remedy[]; total: number } | null> {
  if (!budget.open()) return null;
  const all = [...kept, ...pastCap];
  if (kept.length === 0) return { remedies: [], total: 0 };
  const current = Math.max(...kept.map((p) => TIER_RANK[p.tier]));
  const found: Array<{ remedy: Remedy; key: string }> = [];
  const changes = await changesOf(t, m, all, budget);
  if (changes === null) return null;
  for (const change of changes) {
    const stated = stating(t, change);
    let survivors = 0;
    let closed = 0;
    let best = -1;
    for (const p of all) {
      if (!budget.take()) return null;
      if (budget.due()) await nextTurn();
      const e = m.exposures.get(p.exposures[0])!;
      // a finding the change clears no longer anchors anything
      if (change.kind === 'attributes' && change.clears.has(p.exposures[0])) {
        closed += 1;
        continue;
      }
      const r = rejudge(stated, p, e);
      const changed = r.removed || TIER_RANK[r.tier] < TIER_RANK[p.tier];
      // the story names one flow carrying the credential; when another carries it too, a change on the named one
      // closes this way in only, and the edge stays as it was
      if (changed && changesFlowOf(change, p) && anotherFlowCarries(t, p)) {
        closed += 1;
        survivors += 1;
        best = Math.max(best, TIER_RANK[p.tier]);
        continue;
      }
      if (r.removed) {
        closed += 1;
        continue;
      }
      survivors += 1;
      best = Math.max(best, TIER_RANK[r.tier]);
    }
    const outcome: RemedyOutcome | null =
      survivors === 0 ? 'removes' : best < current ? (best === 0 ? 'lowers_to:low' : 'lowers_to:medium') : closed > 0 ? 'this_path_only' : null;
    if (!outcome) continue;
    const remedy: Remedy =
      change.kind === 'attributes'
        ? { set: change.attributes.map((a) => ({ at: `attributes:${change.el}#${a}` })), outcome, ...(change.clears.size > 0 ? { clears_finding: [...change.clears].sort()[0] } : {}) }
        : {
            control_classes: [...change.breaker.control_classes],
            attributes_true: [...change.breaker.attributes_true],
            item_classes: [...change.breaker.credential_item_classes],
            on: change.on,
            outcome,
          };
    found.push({ remedy, key: keyOf(change) });
  }
  found.sort((a, b) => RANK_OF[a.remedy.outcome] - RANK_OF[b.remedy.outcome] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { remedies: found.slice(0, MAX_REMEDIES).map((x) => x.remedy), total: found.length };
}
