/**
 * The knowledge graph's part: it can lower a candidate's tier by one step, never raise it and never remove a
 * candidate (the answer's candidates are chosen before it runs). Without a knowledge graph, tiers come from the
 * model's facts alone.
 *
 * - **Anchor side.** A candidate is lowered when every part that set its tier fails its class's check: the rule the
 *   platform matched to the finding (same class and name, the same policy version) has condition groups that do
 *   not hold on the element's attributes, or threats that cite none of the row's technique families. Only findings
 *   the platform's evaluation created are checked; a user's own assertion is not. This is a consistency check, not
 *   a second source: the class policy and the knowledge-graph rules come from the same research.
 * - **Peer side** (parts where the anchor is the foothold): a reached component whose class the knowledge graph
 *   covers, with no threat of the edge kind's technique families, lowers the candidate.
 *
 * **What leaves the platform.** Two batched reads, after the capability probe: the rules of the model's class
 * inventory (class ids of the modules allowed to be sent, independent of the model's exposures and of the
 * candidates), and the threats of all those rules (rule refs the knowledge graph itself returned). No element id,
 * model id, name, attribute value or finding is sent, and nothing about which classes carry findings.
 *
 * The reads share one timeout, within the call's deadline. Any read that fails or times out leaves the whole call without the knowledge graph
 * (`kg_absent`, `failed`): tiers then come from the model's facts alone.
 */
import {
  CloudSessionExpiredError,
  EvaluationNotEntitledError,
  KgClient,
  KgRule,
  KgThreat,
  KgUnavailableError,
  KG_KEY_SEPARATOR,
  RemoteModuleMisconfiguredError,
  RemoteModuleUnavailableError,
} from '@dethernety/dt-module';
import { evaluateConditionGroups, parseConditionGroups } from '@dethernety/dt-module/condition-groups';
import { Deadline } from './bounds';
import { FoldedModel } from './fold';
import { AnchorRef, Candidate, MAX_LIST_ENTRIES } from './generate';
import { EdgeKindTable } from './table';

/** Classes read per call, at most; the inventory past it is not checked, and counted. */
export const MAX_CLASS_READS = 250;
/** Rule refs whose threats are read per call, at most. */
export const MAX_RULE_REFS = 2_000;
/** The knowledge graph's reads, all of them, within one timeout. */
export const KG_TIMEOUT_MS = 15_000;
/** The class modules whose class ids may be sent when the deployment names none. */
export const DEFAULT_KG_CLASS_MODULES: readonly string[] = ['dethernety-general'];
/** A knowledge-graph id copied into the answer as evidence. */
const EVIDENCE_ID = /^[\w:.-]{1,128}$/;

export const KG_ABSENT_REASONS = ['no_data', 'not_entitled', 'no_session', 'unavailable', 'failed'] as const;
export type KgAbsentReason = (typeof KG_ABSENT_REASONS)[number];
export type KgRegime = { kg: 'kg_present' } | { kg: 'kg_absent'; reason: KgAbsentReason };

/** What the knowledge graph answered for one call. */
export interface KgFacts {
  regime: KgRegime;
  /** Exposure rules per class id read. */
  rules: Map<string, KgRule[]>;
  /** Threats per rule (composite key), for the rules whose threats were read. */
  threats: Map<string, KgThreat[]>;
  /** The class ids the reads covered. */
  classesRead: Set<string>;
  /** Classes of the inventory past the read cap. */
  classesCapped: number;
}

export const absentFacts = (reason: KgAbsentReason): KgFacts => ({
  regime: { kg: 'kg_absent', reason },
  rules: new Map(),
  threats: new Map(),
  classesRead: new Set(),
  classesCapped: 0,
});

function reasonOf(err: unknown): KgAbsentReason {
  if (err instanceof CloudSessionExpiredError) return 'no_session';
  if (err instanceof EvaluationNotEntitledError) return 'not_entitled';
  if (err instanceof KgUnavailableError || err instanceof RemoteModuleUnavailableError || err instanceof RemoteModuleMisconfiguredError) return 'unavailable';
  return 'failed';
}

/** The class modules whose class ids may be sent: the deployment's list (comma-separated), else the open-source catalogue. */
export function kgClassModules(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.MODULE_KG_CLASS_MODULES;
  const names = raw ? raw.split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) : [...DEFAULT_KG_CLASS_MODULES];
  return new Set(names);
}

/**
 * The model's class inventory that may be sent: the classes of its elements held by an allowed module, sorted and
 * capped. It depends on what the model contains, never on its exposures or the candidates.
 */
export function classInventory(m: FoldedModel, allowed: ReadonlySet<string>): { send: string[]; capped: number } {
  const ids = new Set<string>();
  for (const el of [...m.boundaries.values(), ...m.components.values(), ...m.flows.values(), ...m.dataItems.values()]) {
    if (el.cls && el.cls.module && allowed.has(el.cls.module)) ids.add(el.cls.id);
  }
  const sorted = [...ids].sort();
  return { send: sorted.slice(0, MAX_CLASS_READS), capped: Math.max(0, sorted.length - MAX_CLASS_READS) };
}

/** A read inside the knowledge graph's timeout. */
async function within<T>(call: Promise<T>, until: number, now: () => number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the knowledge-graph read passed its timeout')), Math.max(1, until - now()));
  });
  try {
    return await Promise.race([call, expired]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read the inventory's rules and their threats, in two batched calls after the capability probe. */
export async function readKg(client: KgClient, token: string | undefined, inventory: { send: string[]; capped: number }, deadline?: Deadline, now: () => number = Date.now): Promise<KgFacts> {
  const absent = (reason: KgAbsentReason): KgFacts => ({ ...absentFacts(reason), classesCapped: inventory.capped });
  // one timeout for every read, never past the call's own deadline
  const budget = Math.min(KG_TIMEOUT_MS, deadline ? deadline.remaining() : KG_TIMEOUT_MS);
  if (budget <= 0) return absent('failed');
  const until = now() + budget;
  try {
    const cap = await within(client.capability(token), until, now);
    if (!cap.available) return absent('no_data');
    if (!cap.entitled) return absent('not_entitled');
  } catch (err) {
    return absent(reasonOf(err));
  }
  const facts: KgFacts = { regime: { kg: 'kg_present' }, rules: new Map(), threats: new Map(), classesRead: new Set(inventory.send), classesCapped: inventory.capped };
  if (inventory.send.length === 0) return facts;
  try {
    facts.rules = await within(client.rulesByClassId(inventory.send, { kind: 'exposure' }, token), until, now);
    const refs = [...facts.rules.values()]
      .flat()
      .map((r) => ({ classId: r.classId, ruleId: r.ruleId }))
      .sort((a, b) => (a.classId + a.ruleId < b.classId + b.ruleId ? -1 : 1))
      .slice(0, MAX_RULE_REFS);
    if (refs.length > 0) facts.threats = await within(client.threatsByRuleId(refs, token), until, now);
  } catch {
    return absent('failed');
  }
  return facts;
}

type Check = { verdict: 'pass' | 'fail' | 'unknown'; evidence: string[] };
const UNKNOWN: Check = { verdict: 'unknown', evidence: [] };

const families = (techniques: Iterable<string>) => new Set([...techniques].map((t) => t.split('.')[0]));
const cites = (threats: KgThreat[], fam: Set<string>) => threats.some((th) => (th.techniqueIds ?? []).some((t) => fam.has(t.split('.')[0])));
const threatsOf = (facts: KgFacts, rule: KgRule) => facts.threats.get(`${rule.classId}${KG_KEY_SEPARATOR}${rule.ruleId}`) ?? [];
const element = (m: FoldedModel, id: string) => m.boundaries.get(id) ?? m.components.get(id) ?? m.flows.get(id) ?? m.dataItems.get(id);
const evidenceOf = (prefix: string, id: string) => (EVIDENCE_ID.test(id) ? [`${prefix}:${id}`] : []);

/** One anchoring part's check against its finding's rule. */
function anchorCheck(m: FoldedModel, facts: KgFacts, a: AnchorRef): Check {
  const e = m.exposures.get(a.exposure);
  const el = element(m, a.element);
  if (!e || !el || e.name === null || e.createdBy !== 'SYSTEM') return UNKNOWN;
  const classId = e.classId ?? el.cls?.id;
  if (!classId || !facts.classesRead.has(classId)) return UNKNOWN;
  if (e.classId && el.cls && el.cls.id !== e.classId) return UNKNOWN;
  const policyHash = el.cls?.policyHash ?? null;
  const rules = (facts.rules.get(classId) ?? []).filter((r) => r.name === e.name).sort((x, y) => (x.ruleId < y.ruleId ? -1 : 1));
  let failed: string[] = [];
  for (const rule of rules) {
    if (policyHash && rule.policyHash && policyHash !== rule.policyHash) continue;
    const threats = threatsOf(facts, rule);
    if (threats.length === 0) continue;
    const groups = parseConditionGroups(rule.conditionGroups);
    const ev = groups.length > 0 ? evaluateConditionGroups(groups, el.attributes as Record<string, unknown>) : null;
    const holds = !ev || ev.satisfiedGroupIndexes.length > 0 || ev.unevaluableGroupIndexes.length > 0;
    if (holds && cites(threats, families(a.matched))) return { verdict: 'pass', evidence: [] };
    failed = [...failed, ...evidenceOf('kg', rule.id)];
  }
  return failed.length > 0 ? { verdict: 'fail', evidence: failed } : UNKNOWN;
}

/** A reached component's class against the edge kind's technique families. */
function peerCheck(m: FoldedModel, facts: KgFacts, c: Candidate, kindFamilies: Set<string>): Check {
  const classId = m.components.get(c.target)?.cls?.id;
  if (!classId || !facts.classesRead.has(classId)) return UNKNOWN;
  const withThreats = (facts.rules.get(classId) ?? []).filter((r) => threatsOf(facts, r).length > 0);
  if (withThreats.length === 0) return UNKNOWN;
  return withThreats.some((r) => cites(threatsOf(facts, r), kindFamilies)) ? { verdict: 'pass', evidence: [] } : { verdict: 'fail', evidence: evidenceOf('kg-class', classId) };
}

/** The technique families per edge kind: its rows' techniques and path techniques. */
function kindFamilies(table: EdgeKindTable): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of table.rows) {
    const set = out.get(r.edge_kind) ?? new Set<string>();
    for (const f of families([...r.techniques, r.path.default, ...r.path.from_cited, ...r.path.by_item_class.map((x) => x.technique)])) set.add(f);
    out.set(r.edge_kind, set);
  }
  return out;
}

const TIERS = ['low', 'medium', 'high'] as const;

/**
 * Apply the knowledge graph to the answer's candidates: lower by one step where every part that set the tier fails.
 */
export function applyKg(m: FoldedModel, table: EdgeKindTable, candidates: Candidate[], anchors: Map<string, AnchorRef[]>, facts: KgFacts): Candidate[] {
  if (facts.regime.kg !== 'kg_present') return candidates;
  const families = kindFamilies(table);
  return candidates.map((c) => {
    const refs = (anchors.get(c.id) ?? []).filter((a) => a.tier === c.tier);
    if (refs.length === 0) return c;
    const checks = refs.map((a) => anchorCheck(m, facts, a));
    const anchorFails = checks.every((x) => x.verdict === 'fail');
    const peer = refs.every((a) => a.role === 'source') ? peerCheck(m, facts, c, families.get(c.kind) ?? new Set()) : UNKNOWN;
    if (!anchorFails && peer.verdict !== 'fail') return c;
    const rank = TIERS.indexOf(c.tier);
    if (rank === 0) return c;
    const evidence = [...(anchorFails ? checks.flatMap((x) => x.evidence) : []), ...(peer.verdict === 'fail' ? peer.evidence : [])];
    const withEvidence = [...new Set([...evidence, ...c.facts])].sort();
    return {
      ...c,
      tier: TIERS[rank - 1],
      kg: 'lowered' as const,
      facts: withEvidence.slice(0, MAX_LIST_ENTRIES),
      totals: { ...c.totals, facts: Math.max(c.totals.facts, withEvidence.length) },
    };
  });
}
