/**
 * The model's topology as the matching reads it: separating boundaries, segments, hosts, members, flows,
 * credential items, exposures and controls by element. Built once per call into maps, so the matching never scans
 * the whole model per pair. Pure; class names as the platform stores them.
 */
import { HIDDEN_EDGE_CATEGORY } from './classes';
import { ancestorsOf, Component, Control, Exposure, Flow, FoldedModel } from './fold';

/** Boundaries that separate network peers: two components are peers only under the same one, with none between. */
export const SEPARATING: ReadonlySet<string> = new Set(['Network Segment', 'Endpoint / Office Environment']);
/** Counted as a segment only when no separating boundary exists above the component, and only at the low tier. */
export const PERIMETER = 'Network Perimeter';
export const HOST = 'Operating System / Host';
export const MANAGED_RUNTIME = 'Managed Runtime';
/** Credential item classes used when the item's `isCredential` is unanswered, never against an answered false. */
export const CREDENTIAL_ITEM_CLASSES: ReadonlySet<string> = new Set(['User Credentials', 'Authentication Tokens']);
/** A flow of this class category is credential-bearing even without a credential item on it. */
export const IDENTITY_FLOW_CATEGORY = 'Identity & Access';
/** Flows whose credential travels in the response (a secret, an issued key, a token): its acceptors are reached too. */
export const RESPONSE_CARRIED: ReadonlySet<string> = new Set(['Secret Retrieval', 'Certificate Enrollment', 'Authentication Exchange']);

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A flow of a hidden-edge class is never a declared flow, a carrier, or a capture target. */
export const isHiddenEdgeFlow = (f: Flow): boolean => f.cls?.category === HIDDEN_EDGE_CATEGORY;

export interface Segment {
  boundary: string;
  perimeterOnly: boolean;
}

/** The per-call index over one folded model. */
export class Topology {
  readonly components: Component[];
  readonly declared: Flow[];
  private readonly ancestors = new Map<string, string[]>();
  private readonly ancestorSets = new Map<string, Set<string>>();
  private readonly segments = new Map<string, Segment | null>();
  private readonly membersOfSegment = new Map<string, Component[]>();
  private readonly underMemo = new Map<string, Component[]>();
  private readonly withinMemo = new Map<string, Component[]>();
  private readonly declaredPairs = new Set<string>();
  readonly flowsFrom = new Map<string, Flow[]>();
  readonly flowsInto = new Map<string, Flow[]>();
  private readonly carriers = new Map<string, Flow[]>();
  readonly exposuresOn = new Map<string, Exposure[]>();
  readonly controlsOn = new Map<string, Control[]>();
  private readonly externalInbound = new Set<string>();

  constructor(readonly m: FoldedModel) {
    this.components = [...m.components.values()].sort(byId);
    this.declared = [...m.flows.values()].filter((f) => !isHiddenEdgeFlow(f)).sort(byId);
    for (const f of this.declared) {
      this.declaredPairs.add(`${f.source}\u0000${f.target}`);
      push(this.flowsFrom, f.source, f);
      push(this.flowsInto, f.target, f);
      for (const d of f.dataItems) push(this.carriers, d, f);
      if (m.components.get(f.source)?.type === 'EXTERNAL_ENTITY') this.externalInbound.add(f.target);
    }
    for (const e of [...m.exposures.values()].sort(byId)) push(this.exposuresOn, e.elementId, e);
    for (const c of [...m.controls.values()].sort(byId)) for (const s of c.supports) push(this.controlsOn, s, c);
    for (const c of this.components) {
      const seg = this.segmentOf(c.id);
      if (seg) push(this.membersOfSegment, seg.boundary, c);
    }
  }

  className(id: string): string | null {
    const m = this.m;
    return m.boundaries.get(id)?.cls?.name ?? m.components.get(id)?.cls?.name ?? m.flows.get(id)?.cls?.name ?? m.dataItems.get(id)?.cls?.name ?? null;
  }

  attributesOf(id: string): Record<string, unknown> | undefined {
    const m = this.m;
    return (m.boundaries.get(id) ?? m.components.get(id) ?? m.flows.get(id) ?? m.dataItems.get(id))?.attributes as Record<string, unknown> | undefined;
  }

  ancestorsOf(id: string): string[] {
    let a = this.ancestors.get(id);
    if (!a) {
      a = ancestorsOf(this.m, id);
      this.ancestors.set(id, a);
      this.ancestorSets.set(id, new Set(a));
    }
    return a;
  }

  isUnder(id: string, boundary: string): boolean {
    this.ancestorsOf(id);
    return this.ancestorSets.get(id)!.has(boundary);
  }

  /** The nearest ancestor boundary of `id` whose class is one of `names`, or undefined. */
  nearestAncestor(id: string, names: ReadonlySet<string> | readonly string[]): string | undefined {
    const set = names instanceof Set ? names : new Set(names);
    return this.ancestorsOf(id).find((b) => set.has(this.m.boundaries.get(b)?.cls?.name ?? ''));
  }

  /** Where a component sits for peering: its nearest separating boundary, else a perimeter (low), else nothing. */
  segmentOf(id: string): Segment | undefined {
    if (!this.segments.has(id)) {
      const seg = this.nearestAncestor(id, SEPARATING);
      const per = seg ? undefined : this.nearestAncestor(id, [PERIMETER]);
      this.segments.set(id, seg ? { boundary: seg, perimeterOnly: false } : per ? { boundary: per, perimeterOnly: true } : null);
    }
    return this.segments.get(id) ?? undefined;
  }

  /** The same-segment peers of a component, in id order, and whether the segment is only a perimeter. */
  sameSegmentPeers(id: string): { peers: Component[]; perimeterOnly: boolean } | undefined {
    const seg = this.segmentOf(id);
    if (!seg) return undefined;
    return { peers: (this.membersOfSegment.get(seg.boundary) ?? []).filter((c) => c.id !== id), perimeterOnly: seg.perimeterOnly };
  }

  /** The components whose segment is `boundary`. */
  segmentMembers(boundary: string): Component[] {
    return this.membersOfSegment.get(boundary) ?? [];
  }

  /** The components under a boundary, at any depth, in id order. */
  componentsUnder(boundary: string): Component[] {
    let r = this.underMemo.get(boundary);
    if (!r) {
      r = this.components.filter((c) => this.isUnder(c.id, boundary));
      this.underMemo.set(boundary, r);
    }
    return r;
  }

  /** The components a boundary anchor stands for: those under it down to the next separating boundary below it. */
  componentsWithin(boundary: string): Component[] {
    let r = this.withinMemo.get(boundary);
    if (!r) {
      r = this.componentsUnder(boundary).filter((c) => {
        const nearest = this.nearestAncestor(c.id, SEPARATING);
        return nearest === undefined || nearest === boundary || !this.isUnder(nearest, boundary);
      });
      this.withinMemo.set(boundary, r);
    }
    return r;
  }

  hasDeclaredFlow(source: string, target: string): boolean {
    return this.declaredPairs.has(`${source}\u0000${target}`);
  }

  hasInboundExternal(id: string): boolean {
    return this.externalInbound.has(id);
  }

  /** Whether a data item is a credential: its `isCredential` answer, else (unanswered) its class. */
  isCredentialItem(id: string): boolean {
    const d = this.m.dataItems.get(id);
    if (!d) return false;
    if (d.isCredential !== null) return d.isCredential;
    return CREDENTIAL_ITEM_CLASSES.has(d.cls?.name ?? '');
  }

  credentialItemsOf(f: Flow): string[] {
    return f.dataItems.filter((d) => this.isCredentialItem(d));
  }

  /** A flow carries a credential when it handles a credential item, or its class is an identity flow. */
  isCredentialBearing(f: Flow): boolean {
    return this.credentialItemsOf(f).length > 0 || f.cls?.category === IDENTITY_FLOW_CATEGORY;
  }

  /** The declared flows carrying an item, and its holders (initiators) and acceptors (responders). */
  item(id: string): { flows: Flow[]; holders: string[]; acceptors: string[] } {
    const flows = this.carriers.get(id) ?? [];
    return { flows, holders: uniq(flows.map((f) => f.source)), acceptors: uniq(flows.map((f) => f.target)) };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export const uniq = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
