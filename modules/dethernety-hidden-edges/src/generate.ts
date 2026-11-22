/**
 * The matching core: from the folded model, the edge-kind table and the caller's options to hidden-edge
 * candidates. Deterministic: the same model, table and options give the same answer, whatever the row order.
 *
 * For each exposure that is not disposed, the table selects rows by its techniques and the element it sits on;
 * each row's role and relation turn the anchor into pairs (foothold → reached end), generated round-robin over the
 * reached ends within a budget; exclusions and breakers remove pairs; breakers and facts set each pair's tier;
 * pairs of one (kind, source, target) merge; caps and order bound the answer.
 *
 * The work is bounded: at most `MAX_PAIRS_PER_ANCHOR` pairs are considered per (exposure, row) and
 * `MAX_PAIRS_PER_CALL` per call (over it, the call is refused as too large); generation yields to the event loop
 * and checks the deadline as it goes.
 */
import { createHash } from 'node:crypto';
import { Deadline } from './bounds';
import { Component, Exposure, Flow, FoldedModel } from './fold';
import { AttributeBreaker, CAPABILITIES, ControlBreaker, derivedTierCap, EDGE_KINDS, EdgeKindRow, EdgeKindTable, PRIVILEGES, selectRows, Selection, Tier } from './table';
import { HOST, isHiddenEdgeFlow, MANAGED_RUNTIME, RESPONSE_CARRIED, Topology, uniq } from './topology';

/** Candidates per kind, a kind's unused share passed on in kind order: at most four kinds × 50 = 200 per answer. */
export const PER_KIND_BUDGET = 50;
/** Peers kept per (exposure, row), the most relevant first. */
export const MAX_PEERS = 20;
/** Pairs considered per (exposure, row) before the peer cap: a bound on the work, round-robin over reached ends. */
export const MAX_PAIRS_PER_ANCHOR = 1_000;
/** Pairs judged per call: over it the call is refused, never answered in part. */
export const MAX_PAIRS_PER_CALL = 200_000;
/** Entries kept per list of one candidate (exposures, facts, cited techniques); the full count is reported beside. */
export const MAX_LIST_ENTRIES = 50;
/** A credential item carried by more flows than this is generic ("an auth token"): it caps the pair at low. */
export const GENERIC_ITEM_CARRIERS = 5;
const YIELD_EVERY = 2_000;

export interface GenerateOptions {
  /** Directional candidate ids the operator accepted or rejected (verified ones only). */
  excluded?: readonly string[];
  /** Whether pending (unconfirmed) exposures feed candidates; they always give a lower tier. Default true. */
  include_pending?: boolean;
}

export interface Candidate {
  id: string;
  kind: string;
  source: string;
  target: string;
  /** The path techniques written to the accepted flow's `technique_ids`. */
  technique_ids: string[];
  /** The cited exposures' techniques that produced it. */
  cited_techniques: string[];
  exposure_ids: string[];
  rows: string[];
  tier: Tier;
  defaults: { required_capability: string; required_privilege: string; granted_privilege: string };
  fields: Record<string, string>;
  /** Locators of the facts behind the tier. */
  facts: string[];
  /** How many exposures and facts there were before the lists were capped. */
  totals: { exposure_ids: number; facts: number; cited_techniques: number };
  /**
   * The knowledge graph's mark: `lowered` (one step, by its rules or threats).
   */
  kg?: 'lowered';
}

/** What anchored a candidate: each exposure, its element, the techniques that selected the row, and the row's role. */
export interface AnchorRef {
  exposure: string;
  element: string;
  matched: string[];
  row: string;
  role: string;
  kind: string;
  /** The tier this part gave the candidate, before merging. */
  tier: Tier;
}

export class MatchingOverBudget extends Error {
  constructor() {
    super('the matching is over its work budget');
    this.name = 'MatchingOverBudget';
  }
}

const COUNT_NAMES = [
  'exposures_read', 'exposures_feeding', 'exposures_without_row', 'hidden_edge_anchors_skipped', 'anchors_without_segment',
  'anchors_without_host', 'containers_without_host', 'landings_without_segment', 'flows_not_credential_bearing', 'items_not_credential',
  'pairs_over_anchor_budget', 'excluded_external_pair', 'excluded_declared_flow', 'excluded_reached_type', 'excluded_by_breaker',
  'excluded_by_decision', 'peers_capped', 'kind_budget_dropped',
] as const;
export type Counts = Record<(typeof COUNT_NAMES)[number], number>;
const zeroCounts = (): Counts => Object.fromEntries(COUNT_NAMES.map((n) => [n, 0])) as Counts;

const TIER_RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };
const TIER_OF = ['low', 'medium', 'high'] as const;
const CAP_RANK: Record<string, number> = Object.fromEntries(CAPABILITIES.map((c, i) => [c, i]));
const PRIV_RANK: Record<string, number> = Object.fromEntries(PRIVILEGES.map((c, i) => [c, i]));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { id: string }>(a: T, b: T) => cmp(a.id, b.id);

/** `he:` plus 16 hex characters of sha256 over the kind, source and target joined by NUL: the same pair, the same id. */
export function candidateId(kind: string, source: string, target: string): string {
  return `he:${createHash('sha256').update(`${kind}\u0000${source}\u0000${target}`).digest('hex').slice(0, 16)}`;
}

/** One way an exposure suggests an edge, before judging. */
interface Pair {
  source: string;
  target: string;
  /** The element the relation is computed under (a segment, a zone, a host), if any. */
  shared: string | null;
  /** The relation alone caps the pair at low (perimeter only, a managed runtime, a generic credential item). */
  lowTier: boolean;
  /** The credential item of a credential or capture pair. */
  item: string | null;
  /** The captured flow, the anchoring flow, or a flow carrying the item into the acceptor. */
  flow: string | null;
  /** For a flow anchor: the anchored end. */
  anchoredEnd: string | null;
  fields: Record<string, string>;
}

interface Part {
  row: EdgeKindRow;
  exposures: string[];
  matched: string[];
  pair: Pair;
  tier: Tier;
  facts: string[];
  path: string;
  order: number;
}

const mk = (source: string, target: string, over: Partial<Pair> = {}): Pair => ({
  source,
  target,
  shared: null,
  lowTier: false,
  item: null,
  flow: null,
  anchoredEnd: null,
  fields: {},
  ...over,
});

/** Pairs round-robin over groups (one per reached end or per foothold), so a budget is shared fairly. */
function* roundRobin(groups: Array<Iterable<Pair>>): Generator<Pair> {
  const its = groups.map((g) => g[Symbol.iterator]());
  while (its.length > 0) {
    for (let i = 0; i < its.length; ) {
      const n = its[i].next();
      if (n.done) its.splice(i, 1);
      else {
        yield n.value;
        i += 1;
      }
    }
  }
}

function* from<T>(xs: Iterable<T>, f: (x: T) => Pair | null): Generator<Pair> {
  for (const x of xs) {
    const p = f(x);
    if (p) yield p;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Anchors and relations
// ---------------------------------------------------------------------------------------------------------------

class Relations {
  constructor(
    private readonly t: Topology,
    private readonly counts: Counts,
  ) {}

  /** The components an anchor stands for as the element itself: a component, a boundary's members, a flow's named end. */
  anchorComponents(e: Exposure, sel: Selection, scope: 'within' | 'under'): Component[] {
    const m = this.t.m;
    if (e.elementKind === 'component') return [m.components.get(e.elementId)!].filter(Boolean);
    if (e.elementKind === 'securityBoundary') return scope === 'within' ? this.t.componentsWithin(e.elementId) : this.t.componentsUnder(e.elementId);
    if (e.elementKind === 'dataFlow') {
      const f = m.flows.get(e.elementId)!;
      return [m.components.get(sel.anchor.flow_end === 'initiator' ? f.source : f.target)!].filter(Boolean);
    }
    return [];
  }

  pairs(e: Exposure, sel: Selection): Iterable<Pair> {
    const t = this.t;
    const m = t.m;
    const row = sel.row;
    const reachedOk = (c: Component | undefined) => !!c && row.reached_types.includes(c.type);
    const anchoredEnd = e.elementKind === 'dataFlow' ? this.anchorComponents(e, sel, 'within')[0]?.id ?? null : null;

    switch (row.peer_relation) {
      case 'same-segment':
      case 'in-zone':
      case 'segment-outside-anchor': {
        const zone = row.peer_relation === 'in-zone' && e.elementKind === 'securityBoundary' ? e.elementId : null;
        const outside = row.peer_relation === 'segment-outside-anchor' ? e.elementId : null;
        const reached = (outside ? t.componentsUnder(outside) : this.anchorComponents(e, sel, 'within')).filter(reachedOk);
        const flow = e.elementKind === 'dataFlow' ? e.elementId : null;
        return roundRobin(
          reached.map((r) => {
            const seg = t.sameSegmentPeers(r.id);
            if (!seg) this.counts.anchors_without_segment += 1;
            const peers = seg?.peers ?? [];
            const zonePeers = zone ? t.componentsWithin(zone) : [];
            const shared = zone ?? t.segmentOf(r.id)?.boundary ?? null;
            return from(uniqComponents(peers, zonePeers), (f) => {
              if (f.id === r.id || (outside && t.isUnder(f.id, outside))) return null;
              const perimeterOnly = !!seg?.perimeterOnly && !(zone && t.isUnder(f.id, zone));
              // a credential-reuse row in a segment is a default account's (the only such rows)
              const fields = row.edge_kind === 'credential-reuse' ? { credential_basis: 'default_account' } : undefined;
              return mk(f.id, r.id, { shared, lowTier: perimeterOnly, flow, anchoredEnd, ...(fields ? { fields } : {}) });
            });
          }),
        );
      }
      case 'landing-segment': {
        if (e.elementKind !== 'component') return [];
        const fh = e.elementId;
        const landed = uniq((t.flowsFrom.get(fh) ?? []).filter((f) => m.components.get(f.target)?.type !== 'EXTERNAL_ENTITY').map((f) => f.target));
        const landedSet = new Set(landed);
        const segs: Array<Iterable<Pair>> = [];
        const seen = new Set<string>();
        for (const y of landed) {
          const seg = t.segmentOf(y);
          if (!seg) {
            this.counts.landings_without_segment += 1;
            continue;
          }
          if (seen.has(seg.boundary)) continue;
          seen.add(seg.boundary);
          segs.push(from(t.segmentMembers(seg.boundary), (c) => (c.id === fh || landedSet.has(c.id) || !reachedOk(c) ? null : mk(fh, c.id, { shared: seg.boundary, lowTier: seg.perimeterOnly }))));
        }
        return roundRobin(segs);
      }
      case 'zone-egress': {
        const zone = e.elementId;
        const footholds = t.componentsUnder(zone).filter((c) => c.type === 'PROCESS');
        const reached = t.components
          .filter((c) => {
            const seg = t.segmentOf(c.id);
            return !!seg && !seg.perimeterOnly && seg.boundary !== zone && !t.isUnder(seg.boundary, zone) && reachedOk(c);
          })
          .sort((a, b) => Number(b.crownJewel) - Number(a.crownJewel) || byId(a, b))
          .slice(0, MAX_PEERS);
        return roundRobin(footholds.map((f) => from(reached, (r) => mk(f.id, r.id))));
      }
      case 'instance-role-reach': {
        const footholds = e.elementKind === 'dataFlow' ? this.anchorComponents(e, sel, 'within') : this.anchorComponents(e, sel, 'under');
        const groups: Array<Iterable<Pair>> = [];
        for (const fh of footholds) {
          const host = t.nearestAncestor(fh.id, [HOST]) ?? t.nearestAncestor(fh.id, [MANAGED_RUNTIME]);
          if (!host) {
            this.counts.anchors_without_host += 1;
            continue;
          }
          const lowTier = m.boundaries.get(host)?.cls?.name === MANAGED_RUNTIME;
          const own = new Set((t.flowsFrom.get(fh.id) ?? []).map((f) => f.target));
          const reached = uniq(
            t.componentsUnder(host).flatMap((c) =>
              (t.flowsFrom.get(c.id) ?? []).filter((f) => ['External Cloud Service', 'Object Storage'].includes(t.className(f.target) ?? '') || f.cls?.name === 'Secret Retrieval').map((f) => f.target),
            ),
          );
          groups.push(from(reached, (r) => (own.has(r) || r === fh.id || !reachedOk(m.components.get(r)) ? null : mk(fh.id, r, { shared: host, lowTier, fields: { credential_basis: 'instance_role' } }))));
        }
        return roundRobin(groups);
      }
      case 'kerberos-realm': {
        const f = m.flows.get(e.elementId);
        if (!f) return [];
        const realm = uniq((t.flowsInto.get(f.target) ?? []).filter((x) => x.cls?.name === 'Kerberos Authentication').map((x) => x.source));
        const fields = { credential_basis: 'kerberos_realm' };
        if (row.exposed_role === 'target') {
          const reached = f.source;
          if (!reachedOk(m.components.get(reached))) return [];
          return from(realm, (mbr) => (mbr === reached ? null : mk(mbr, reached, { flow: f.id, anchoredEnd, fields })));
        }
        const fh = anchoredEnd!;
        return from(realm, (mbr) => (mbr === fh || !reachedOk(m.components.get(mbr)) ? null : mk(fh, mbr, { flow: f.id, anchoredEnd, fields })));
      }
      case 'same-host-outside-container': {
        const container = e.elementId;
        const host = t.nearestAncestor(container, [HOST, MANAGED_RUNTIME]);
        if (!host) {
          this.counts.containers_without_host += 1;
          return [];
        }
        const lowTier = m.boundaries.get(host)?.cls?.name === MANAGED_RUNTIME;
        const reached = t.componentsUnder(host).filter((c) => !t.isUnder(c.id, container) && reachedOk(c));
        const fields = { escape_vector: escapeVector(t, container) };
        return roundRobin(reached.map((r) => from(t.componentsUnder(container), (fh) => mk(fh.id, r.id, { shared: host, lowTier, fields }))));
      }
      case 'capture-footholds':
        return this.capturePairs(e);
      case 'shared-credential':
        return this.credentialPairs(e, row);
    }
  }

  /** The flows a capture row takes the credential from, credential-bearing only. */
  private capturedFlows(e: Exposure): Flow[] {
    const t = this.t;
    const m = t.m;
    let flows: Flow[] = [];
    if (e.elementKind === 'dataFlow') flows = [m.flows.get(e.elementId)!].filter(Boolean);
    else if (e.elementKind === 'component') flows = [...(t.flowsFrom.get(e.elementId) ?? []), ...(t.flowsInto.get(e.elementId) ?? [])];
    else if (e.elementKind === 'data') {
      if (!t.isCredentialItem(e.elementId)) {
        this.counts.items_not_credential += 1;
        return [];
      }
      flows = t.item(e.elementId).flows;
    } else if (e.elementKind === 'securityBoundary') flows = t.componentsUnder(e.elementId).flatMap((c) => t.flowsInto.get(c.id) ?? []);
    const unique = [...new Map(flows.map((f) => [f.id, f])).values()].sort(byId);
    const bearing = unique.filter((f) => !isHiddenEdgeFlow(f) && t.isCredentialBearing(f));
    this.counts.flows_not_credential_bearing += unique.length - bearing.length;
    return bearing;
  }

  private capturePairs(e: Exposure): Iterable<Pair> {
    const t = this.t;
    const groups: Array<Iterable<Pair>> = [];
    for (const f of this.capturedFlows(e)) {
      const ends = new Set([f.source, f.target]);
      const footholds = uniqComponents(...[f.source, f.target].map((end) => {
        const seg = t.sameSegmentPeers(end);
        if (!seg) this.counts.anchors_without_segment += 1;
        return seg?.peers ?? [];
      })).filter((c) => !ends.has(c.id));
      const items = t.credentialItemsOf(f);
      const reachedByItem: Array<{ target: string; item: string | null }> = [];
      if (items.length === 0) reachedByItem.push({ target: f.target, item: null });
      for (const item of items) {
        reachedByItem.push({ target: f.target, item });
        if (RESPONSE_CARRIED.has(f.cls?.name ?? '')) for (const acc of t.item(item).acceptors) if (acc !== f.target) reachedByItem.push({ target: acc, item });
      }
      const transport = transportState(f);
      groups.push(
        roundRobin(
          reachedByItem.map((rb) =>
            from(footholds, (fh) =>
              fh.id === rb.target
                ? null
                : mk(fh.id, rb.target, { shared: t.segmentOf(fh.id)?.boundary ?? null, item: rb.item, flow: f.id, fields: { transport_state: transport, capture_side: captureSide(t, fh.id, f) } }),
            ),
          ),
        ),
      );
    }
    return roundRobin(groups);
  }

  /** Holder → acceptor pairs of the credential items an anchor touches. */
  private credentialPairs(e: Exposure, row: EdgeKindRow): Iterable<Pair> {
    const t = this.t;
    const m = t.m;
    const groups: Array<Iterable<Pair>> = [];
    const pair = (holder: string, acceptor: string, item: string): Pair | null => {
      if (holder === acceptor) return null;
      const info = t.item(item);
      const into = info.flows.filter((f) => f.target === acceptor).sort(byId)[0];
      return mk(holder, acceptor, { item, flow: into?.id ?? null, lowTier: info.flows.length > GENERIC_ITEM_CARRIERS, fields: { credential_basis: 'shared_item' } });
    };
    const asEnd = (c: string) => {
      for (const f of t.flowsFrom.get(c) ?? []) for (const item of t.credentialItemsOf(f)) groups.push(from(t.item(item).acceptors, (acc) => pair(c, acc, item)));
      if (row.credential_flows === 'outbound') return;
      for (const f of t.flowsInto.get(c) ?? []) {
        for (const item of t.credentialItemsOf(f)) {
          // `both`: an exposed stored credential at an acceptor, reached from its holders; `received`: what a host
          // holds after receiving it (cached logons, a store), used at the item's other acceptors
          if (row.credential_flows === 'both') groups.push(from(t.item(item).holders, (h) => pair(h, c, item)));
          else groups.push(from(t.item(item).acceptors, (acc) => pair(c, acc, item)));
        }
      }
    };
    if (e.elementKind === 'component') asEnd(e.elementId);
    else if (e.elementKind === 'securityBoundary') for (const c of t.componentsUnder(e.elementId)) asEnd(c.id);
    else if (e.elementKind === 'dataFlow') {
      const f = m.flows.get(e.elementId)!;
      const items = t.credentialItemsOf(f);
      if (items.length === 0) this.counts.flows_not_credential_bearing += 1;
      for (const item of items) {
        const info = t.item(item);
        // the item leaks wherever the flow's exposure sits: every holder and the flow's receiver can use it
        const users = uniq([...info.holders, f.target]);
        groups.push(roundRobin(info.acceptors.map((acc) => from(users, (u) => (u === f.source && acc === f.target ? null : pair(u, acc, item))))));
      }
    } else if (e.elementKind === 'data') {
      if (!t.isCredentialItem(e.elementId)) this.counts.items_not_credential += 1;
      else {
        const info = t.item(e.elementId);
        const users = uniq([...info.holders, ...info.acceptors]);
        groups.push(roundRobin(info.acceptors.map((acc) => from(users, (u) => pair(u, acc, e.elementId)))));
      }
    }
    return roundRobin(groups);
  }
}

function uniqComponents(...lists: Component[][]): Component[] {
  const map = new Map<string, Component>();
  for (const l of lists) for (const c of l) map.set(c.id, c);
  return [...map.values()].sort(byId);
}

const TRANSPORT = ['flow_tls_encrypted', 'encryption_in_transit_enabled', 'tls_only_transport', 'service_to_service_mtls_enforced'];
function transportState(f: Flow): string {
  const a = f.attributes as Record<string, unknown>;
  if (TRANSPORT.some((k) => a[k] === false)) return 'cleartext';
  if (TRANSPORT.some((k) => a[k] === true) && a.server_certificate_validated === false) return 'tls_unverified';
  return 'unstated';
}

function captureSide(t: Topology, foothold: string, f: Flow): string {
  const s = t.segmentOf(foothold)?.boundary;
  const a = t.segmentOf(f.source)?.boundary === s;
  const b = t.segmentOf(f.target)?.boundary === s;
  return a && b ? 'both' : a ? 'initiator_segment' : 'responder_segment';
}

const CONFIGURATION_GROUP = ['container_privileged_mode_disabled', 'container_capabilities_dropped_to_minimal', 'container_host_namespaces_not_shared', 'container_no_sensitive_host_mounts'];
const KERNEL_GROUP = ['container_seccomp_and_mac_profile_enforced', 'container_no_new_privileges_and_nonroot', 'container_runtime_patch_current'];
function escapeVector(t: Topology, container: string): string {
  const a = t.attributesOf(container) ?? {};
  if (CONFIGURATION_GROUP.some((k) => a[k] === false)) return 'configuration';
  if (KERNEL_GROUP.some((k) => a[k] === false)) return 'kernel_or_runtime';
  return 'unstated';
}

// ---------------------------------------------------------------------------------------------------------------
// Breakers and tiers
// ---------------------------------------------------------------------------------------------------------------

/** Whether a filter of techniques covers what selected the row (the cited techniques or their parents). */
const covers = (techniques: string[], matched: string[]) =>
  techniques.length === 0 || matched.some((t) => techniques.includes(t) || techniques.includes(t.split('.')[0]));

/** The element a breaker reads, if the pair has one. */
function readElement(t: Topology, b: AttributeBreaker, e: Exposure, p: Pair): string | null {
  const classes = new Set(b.classes);
  switch (b.read_from) {
    case 'shared_boundary':
      return p.shared;
    case 'shared_ancestor': {
      const up = new Set(t.ancestorsOf(p.source));
      return t.ancestorsOf(p.target).find((x) => up.has(x) && classes.has(t.m.boundaries.get(x)?.cls?.name ?? '')) ?? null;
    }
    case 'reached_end':
      return p.target;
    case 'reached_ancestor':
      return t.nearestAncestor(p.target, classes) ?? null;
    case 'foothold':
      return p.source;
    case 'foothold_ancestor':
      return t.nearestAncestor(p.source, classes) ?? null;
    case 'anchor':
      return e.elementId;
    case 'anchor_ancestor':
      return t.nearestAncestor(p.anchoredEnd ?? e.elementId, classes) ?? null;
    case 'flow':
      return p.flow;
    case 'flow_responder':
      return p.flow ? t.m.flows.get(p.flow)?.target ?? null : null;
    case 'credential_item':
      return p.item;
  }
}

interface Verdict {
  removed: boolean;
  gates: number;
  gatesFalse: number;
  lowers: number;
  raises: number;
  facts: string[];
}

function judge(t: Topology, row: EdgeKindRow, sel: Selection, e: Exposure, p: Pair): Verdict {
  const v: Verdict = { removed: false, gates: 0, gatesFalse: 0, lowers: 0, raises: 0, facts: [] };
  const anchorClass = t.className(e.elementId);
  for (const b of row.attribute_breakers) {
    if (!covers(b.techniques, sel.matched)) continue;
    const el = readElement(t, b, e, p);
    if (!el || !b.classes.includes(t.className(el) ?? '')) continue;
    const attrs = t.attributesOf(el) ?? {};
    const values = b.attributes.map((a) => attrs[a]);
    const allTrue = values.every((x) => x === true);
    const facts = b.attributes.filter((a) => a in attrs).map((a) => `attributes:${el}#${a}`);
    const own = el === e.elementId && b.own_condition.some((o) => o.class === anchorClass && o.exposure === e.name);
    if (b.polarity === 'true_enables') {
      if (allTrue) {
        v.raises += 1;
        v.facts.push(...facts);
      }
      continue;
    }
    const gating = b.high_when !== 'ignored';
    if (gating) {
      v.gates += 1;
      const stated = b.high_when === 'any_false' ? values.some((x) => x === false) : values.every((x) => x === false);
      if (stated) {
        v.gatesFalse += 1;
        v.facts.push(...facts);
      }
    }
    if (allTrue && !own) {
      v.facts.push(...facts);
      if (b.strength === 'removes') v.removed = true;
      // a gating breaker that is true has already failed the gate: it lowers no further (each breaker counts once)
      else if (!gating) v.lowers += 1;
    }
  }
  // one control class set counts once (the stronger breaker is listed first), and one control counts once
  const setsSeen = new Set<string>();
  const controlsSeen = new Set<string>();
  for (const c of row.control_breakers) {
    if (!covers(c.techniques, sel.matched)) continue;
    const setKey = [...c.control_classes].sort().join('|');
    if (setsSeen.has(setKey)) continue;
    if (c.credential_item_classes.length > 0 && !(p.item && c.credential_item_classes.includes(t.className(p.item) ?? ''))) continue;
    const found = supportTargets(t, c, e, p)
      .flatMap((el) => t.controlsOn.get(el) ?? [])
      .sort(byId)
      .find(
        (ctl) =>
          !controlsSeen.has(ctl.id) &&
          c.control_classes.some((cc) => ctl.classNames.includes(cc) && (c.attributes_true.length === 0 || c.attributes_true.some((a) => ctl.attributesByClass[cc]?.[a] === true))),
      );
    if (!found) continue;
    setsSeen.add(setKey);
    controlsSeen.add(found.id);
    v.facts.push(`control:${found.id}`);
    if (c.strength === 'removes') v.removed = true;
    else v.lowers += 1;
  }
  return v;
}

function supportTargets(t: Topology, c: ControlBreaker, e: Exposure, p: Pair): string[] {
  switch (c.supports) {
    case 'reached_end':
      return [p.target];
    case 'reached_end_or_ancestor':
      return [p.target, ...t.ancestorsOf(p.target)];
    case 'flow':
      return p.flow ? [p.flow] : [];
    case 'anchor':
      return [e.elementId];
  }
}

/** A confirmed exposure on the reached component of the row's technique families, if any. */
function ownExposure(t: Topology, component: string, matched: string[]): Exposure | undefined {
  const families = new Set(matched.map((x) => x.split('.')[0]));
  return (t.exposuresOn.get(component) ?? []).find((x) => x.lifecycle === 'confirmed' && x.techniques.some((tt) => families.has(tt.split('.')[0])));
}

/** The pair's tier from the exposure's lifecycle, the breakers and the relation, within the row's cap for its techniques. */
function tierOf(t: Topology, row: EdgeKindRow, sel: Selection, e: Exposure, p: Pair, v: Verdict, zoneOwn: Exposure | undefined): Tier {
  const confirmed = e.lifecycle === 'confirmed';
  const stated = v.gates > 0 && v.gatesFalse === v.gates;
  let rank = (confirmed ? 1 : 0) + (stated ? 1 : 0);
  // a raise never lifts past medium unless the gating facts are stated
  rank = Math.min(rank - v.lowers + v.raises, stated ? 2 : 1);
  const techniqueCap = Math.max(...sel.matched.map((m) => TIER_RANK[derivedTierCap(row, m)]));
  let cap = Math.min(TIER_RANK[row.tier_cap], techniqueCap);
  if (!confirmed) cap = Math.min(cap, 1);
  if (p.lowTier) cap = 0;
  // a zone anchor shows the target can be reached, not that it exposes the service: high needs its own exposure
  if (isZoneAnchor(row, e) && !zoneOwn) cap = Math.min(cap, 1);
  return TIER_OF[Math.max(0, Math.min(rank, cap))];
}

const isZoneAnchor = (row: EdgeKindRow, e: Exposure) =>
  row.exposed_role === 'target' && e.elementKind === 'securityBoundary' && row.peer_relation === 'in-zone';

/** The technique the accepted flow will carry for this pair. */
function pathOf(t: Topology, row: EdgeKindRow, sel: Selection, p: Pair): string {
  for (const m of sel.matched) if (row.path.from_cited.some((f) => m === f || m.startsWith(`${f}.`))) return m;
  const itemClass = p.item ? t.className(p.item) : null;
  return row.path.by_item_class.find((x) => x.item_class === itemClass)?.technique ?? row.path.default;
}

// ---------------------------------------------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------------------------------------------

export interface Generated {
  candidates: Candidate[];
  counts: Counts;
}

export interface Matched extends Generated {
  /** By candidate id: what anchored it, for the knowledge graph's checks. */
  anchors: Map<string, AnchorRef[]>;
}

/** Match and bound in one step, with no knowledge graph. */
export async function generateCandidates(m: FoldedModel, table: EdgeKindTable, options: GenerateOptions = {}, deadline?: Deadline): Promise<Generated> {
  const matched = await matchCandidates(m, table, options, deadline);
  return { candidates: boundCandidates(matched.candidates, m, matched.counts), counts: matched.counts };
}

/** The candidates before the order and caps: matched and merged. */
export async function matchCandidates(m: FoldedModel, table: EdgeKindTable, options: GenerateOptions = {}, deadline?: Deadline): Promise<Matched> {
  const counts = zeroCounts();
  const t = new Topology(m);
  const rel = new Relations(t, counts);
  const excluded = new Set(options.excluded ?? []);
  const includePending = options.include_pending !== false;
  const parts: Part[] = [];
  let judged = 0;
  let order = 0;
  const footholdRelevance = (id: string) => Number(t.hasInboundExternal(id)) + Number((t.exposuresOn.get(id) ?? []).some((x) => x.lifecycle === 'confirmed'));

  const exposures = [...m.exposures.values()].sort(byId);
  counts.exposures_read = exposures.length;
  for (const e of exposures) {
    deadline?.check();
    if (e.lifecycle === 'disposed' || (e.lifecycle === 'pending' && !includePending)) continue;
    if (e.elementKind === 'dataFlow' && isHiddenEdgeFlow(m.flows.get(e.elementId)!)) {
      counts.hidden_edge_anchors_skipped += 1;
      continue;
    }
    const selections = selectRows(table, e.techniques, e.elementKind, t.className(e.elementId));
    if (selections.length === 0) {
      counts.exposures_without_row += 1;
      continue;
    }
    let fed = false;
    for (const sel of selections) {
      const row = sel.row;
      // a component anchor of a target row must itself be a type the row reaches
      if (row.exposed_role === 'target' && e.elementKind === 'component' && !row.reached_types.includes(m.components.get(e.elementId)?.type ?? 'PROCESS')) continue;
      const kept: Part[] = [];
      const seen = new Set<string>();
      let considered = 0;
      for (const p of rel.pairs(e, sel)) {
        const key = `${p.source}\u0000${p.target}\u0000${p.item ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (considered >= MAX_PAIRS_PER_ANCHOR) {
          counts.pairs_over_anchor_budget += 1;
          break;
        }
        considered += 1;
        judged += 1;
        if (judged > MAX_PAIRS_PER_CALL) throw new MatchingOverBudget();
        if (judged % YIELD_EVERY === 0) {
          await new Promise((resolve) => setImmediate(resolve));
          deadline?.check();
        }
        const src = m.components.get(p.source);
        const tgt = m.components.get(p.target);
        if (!src || !tgt || p.source === p.target) continue;
        if (src.type === 'EXTERNAL_ENTITY' && tgt.type === 'EXTERNAL_ENTITY') {
          counts.excluded_external_pair += 1;
          continue;
        }
        if (row.reached_types.length > 0 && !row.reached_types.includes(tgt.type)) {
          counts.excluded_reached_type += 1;
          continue;
        }
        if (t.hasDeclaredFlow(p.source, p.target)) {
          counts.excluded_declared_flow += 1;
          continue;
        }
        const v = judge(t, row, sel, e, p);
        if (v.removed) {
          counts.excluded_by_breaker += 1;
          continue;
        }
        if (excluded.has(candidateId(row.edge_kind, p.source, p.target))) {
          counts.excluded_by_decision += 1;
          continue;
        }
        const zoneOwn = isZoneAnchor(row, e) ? ownExposure(t, p.target, sel.matched) : undefined;
        const facts = zoneOwn ? [...v.facts, `exposure:${zoneOwn.id}`] : v.facts;
        kept.push({
          row,
          exposures: zoneOwn ? [e.id, zoneOwn.id] : [e.id],
          matched: sel.matched,
          pair: p,
          tier: tierOf(t, row, sel, e, p, v, zoneOwn),
          facts,
          path: pathOf(t, row, sel, p),
          order: order++,
        });
      }
      // at most MAX_PEERS per (exposure, row): tier first, then foothold relevance, then the round-robin order
      const relevanceOf = new Map(kept.map((k) => [k, row.exposed_role === 'target' ? footholdRelevance(k.pair.source) : Number(m.components.get(k.pair.target)?.crownJewel ?? false)]));
      kept.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || relevanceOf.get(b)! - relevanceOf.get(a)! || a.order - b.order);
      counts.peers_capped += Math.max(0, kept.length - MAX_PEERS);
      if (kept.length > 0) fed = true;
      parts.push(...kept.slice(0, MAX_PEERS));
    }
    if (fed) counts.exposures_feeding += 1;
  }

  const anchors = new Map<string, AnchorRef[]>();
  for (const p of parts) {
    const id = candidateId(p.row.edge_kind, p.pair.source, p.pair.target);
    const list = anchors.get(id) ?? [];
    // the anchoring exposure only: an exposure cited to lift a zone cap is evidence, not an anchor
    const ex = p.exposures[0];
    const e = m.exposures.get(ex);
    if (e && !list.some((a) => a.exposure === ex && a.row === p.row.id)) {
      list.push({ exposure: ex, element: e.elementId, matched: p.matched, row: p.row.id, role: p.row.exposed_role, kind: p.row.edge_kind, tier: p.tier });
    }
    anchors.set(id, list);
  }
  return { candidates: merge(parts), counts, anchors };
}

const FIELD_PREFERENCE: Record<string, string[]> = {
  transport_state: ['cleartext', 'tls_unverified', 'unstated'],
  capture_side: ['both', 'initiator_segment', 'responder_segment'],
  escape_vector: ['configuration', 'kernel_or_runtime', 'unstated'],
  credential_basis: ['default_account', 'shared_item', 'instance_role', 'kerberos_realm'],
};

function merge(parts: Part[]): Candidate[] {
  const byKey = new Map<string, Part[]>();
  for (const p of parts) {
    const k = `${p.row.edge_kind}\u0000${p.pair.source}\u0000${p.pair.target}`;
    const list = byKey.get(k);
    if (list) list.push(p);
    else byKey.set(k, [p]);
  }
  const out: Candidate[] = [];
  for (const all of byKey.values()) {
    // The candidate rests on the parts that give it its tier: a lower part's technique, exposure or defaults never
    // ride on a higher one (a technique capped low would otherwise become a high finding of the accepted flow).
    const top = Math.max(...all.map((g) => TIER_RANK[g.tier]));
    const group = all.filter((g) => TIER_RANK[g.tier] === top);
    const first = group[0];
    // the attacker's easiest whole row: lowest requirements, then the most granted; never a mix of rows
    const defaults = group
      .map((g) => g.row.defaults)
      .sort(
        (a, b) =>
          CAP_RANK[a.required_capability] + PRIV_RANK[a.required_privilege] - (CAP_RANK[b.required_capability] + PRIV_RANK[b.required_privilege]) ||
          PRIV_RANK[b.granted_privilege] - PRIV_RANK[a.granted_privilege] ||
          cmp(JSON.stringify(a), JSON.stringify(b)),
      )[0];
    const fields: Record<string, string> = {};
    for (const name of uniq(group.flatMap((g) => Object.keys(g.pair.fields)))) {
      const values = uniq(group.map((g) => g.pair.fields[name]).filter((x): x is string => x !== undefined));
      const pref = FIELD_PREFERENCE[name] ?? [];
      values.sort((a, b) => (pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99) || cmp(a, b));
      fields[name] = values[0];
    }
    out.push({
      id: candidateId(first.row.edge_kind, first.pair.source, first.pair.target),
      kind: first.row.edge_kind,
      source: first.pair.source,
      target: first.pair.target,
      technique_ids: uniq(group.map((g) => g.path)),
      cited_techniques: uniq(group.flatMap((g) => g.matched)),
      exposure_ids: uniq(group.flatMap((g) => g.exposures)),
      totals: { exposure_ids: 0, facts: 0, cited_techniques: 0 },
      rows: uniq(group.map((g) => g.row.id)),
      tier: TIER_OF[top],
      defaults: { ...defaults },
      fields,
      facts: uniq(group.flatMap((g) => g.facts)),
    });
  }
  return out.map(capLists);
}

/** Cap a candidate's lists, keeping their full counts, so one pair fed by thousands of findings stays small. */
export function capLists(c: Candidate): Candidate {
  return {
    ...c,
    exposure_ids: c.exposure_ids.slice(0, MAX_LIST_ENTRIES),
    facts: c.facts.slice(0, MAX_LIST_ENTRIES),
    cited_techniques: c.cited_techniques.slice(0, MAX_LIST_ENTRIES),
    totals: { exposure_ids: c.exposure_ids.length, facts: c.facts.length, cited_techniques: c.cited_techniques.length },
  };
}

/** The answer's order: tier, then a crown jewel reached, then id. */
export function orderCandidates(candidates: Candidate[], m: FoldedModel): Candidate[] {
  const rel = (c: Candidate) => Number(m.components.get(c.target)?.crownJewel ?? false);
  return [...candidates].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || rel(b) - rel(a) || cmp(a.id, b.id));
}

/** The caps: a budget per kind, passed on in kind order. */
export function boundCandidates(candidates: Candidate[], m: FoldedModel, counts: Counts): Candidate[] {
  const rel = (c: Candidate) => Number(m.components.get(c.target)?.crownJewel ?? false);
  const order = (a: Candidate, b: Candidate) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || rel(b) - rel(a) || cmp(a.id, b.id);
  const byKind = new Map<string, Candidate[]>();
  for (const c of [...candidates].sort(order)) {
    const list = byKind.get(c.kind);
    if (list) list.push(c);
    else byKind.set(c.kind, [c]);
  }
  const kept: Candidate[] = [];
  let carry = 0;
  for (const kind of EDGE_KINDS) {
    const list = byKind.get(kind) ?? [];
    const budget = PER_KIND_BUDGET + carry;
    kept.push(...list.slice(0, budget));
    counts.kind_budget_dropped += Math.max(0, list.length - budget);
    carry = Math.max(0, budget - list.length);
  }
  return kept.sort(order);
}
