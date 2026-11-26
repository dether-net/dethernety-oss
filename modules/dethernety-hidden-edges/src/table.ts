/**
 * The edge-kind table: which exposure techniques, on which elements, suggest which hidden edge; how the peer is
 * found; and which attributes or controls break or weaken the path.
 *
 * The table is data (`edge-kinds.json` beside this file, compiled into the build). This file validates it
 * strictly: a table that fails validation is refused as a whole, never used in part, because a half-read row
 * would propose edges its author did not write.
 *
 * Rows are keyed on technique ids, element kinds and class names (as the platform stores them), never on
 * class ids. One technique may have several rows, one per kind of element it is found on; a row naming classes
 * wins over a row for any class of that kind.
 */

export const EDGE_KINDS = ['remote-service', 'credential-reuse', 'credential-capture', 'host-escape'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * `target`: the anchored end is reached; edges run foothold → anchor.
 * `source`: the anchor is the foothold; edges run anchor → reached peer.
 * `capture`: a credential crossing a flow is taken next to it; edges run foothold → the flow's responder.
 * `credential`: a credential item is held at one end and accepted at another; edges run holder → acceptor.
 */
export const ROLES = ['target', 'source', 'capture', 'credential'] as const;
export type Role = (typeof ROLES)[number];

export const PEER_RELATIONS = [
  /** the other components under the anchoring zone boundary, with its same-segment peers */
  'in-zone',
  /** both ends under the nearest common separating network boundary */
  'same-segment',
  /** footholds: same-segment peers outside the anchoring boundary (a host) */
  'segment-outside-anchor',
  /** reached: the components in the segments the anchor's declared flows land in */
  'landing-segment',
  /** reached: components under separating boundaries outside the anchoring zone */
  'zone-egress',
  /** holder and acceptor of the same credential item */
  'shared-credential',
  /** reached: the cloud services that any workload on the anchor's host reaches */
  'instance-role-reach',
  /** the principals of one Kerberos realm (initiators of Kerberos flows to the same responder) */
  'kerberos-realm',
  /** footholds: the same-segment peers of either end of the captured flow */
  'capture-footholds',
  /** reached: components on the same host, outside the anchoring container */
  'same-host-outside-container',
] as const;
export type PeerRelation = (typeof PEER_RELATIONS)[number];

/** The relations each role may use: a relation computes peers in one direction only. */
export const ROLE_RELATIONS: Readonly<Record<string, readonly PeerRelation[]>> = {
  target: ['in-zone', 'same-segment', 'segment-outside-anchor', 'kerberos-realm'],
  source: ['landing-segment', 'zone-egress', 'instance-role-reach', 'kerberos-realm', 'same-host-outside-container'],
  capture: ['capture-footholds'],
  credential: ['shared-credential'],
};

export const ELEMENT_KINDS = ['component', 'securityBoundary', 'dataFlow', 'data'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Where a breaker attribute is read. The `*_ancestor` and `shared_*` reads name the boundary classes they look for. */
export const READ_FROM = [
  /** the boundary the relation is computed under */
  'shared_boundary',
  /** the nearest boundary of the named classes that holds both ends */
  'shared_ancestor',
  'reached_end',
  'reached_ancestor',
  'foothold',
  'foothold_ancestor',
  /** the element the cited exposure is on */
  'anchor',
  'anchor_ancestor',
  /** the captured flow, the anchoring flow, or a flow carrying the credential into the acceptor */
  'flow',
  /** the responder of that flow (a listener that refuses cleartext protects its whole flow) */
  'flow_responder',
  'credential_item',
] as const;
export type ReadFrom = (typeof READ_FROM)[number];
const ANCESTOR_READS: readonly ReadFrom[] = ['shared_boundary', 'shared_ancestor', 'reached_ancestor', 'foothold_ancestor', 'anchor_ancestor'];

/** Where a control must be attached (SUPPORTS) to count. */
export const CONTROL_SUPPORTS = ['reached_end', 'reached_end_or_ancestor', 'flow', 'anchor'] as const;
export type ControlSupports = (typeof CONTROL_SUPPORTS)[number];

export const COMPONENT_TYPES = ['PROCESS', 'STORE', 'EXTERNAL_ENTITY'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const CAPABILITIES = ['opportunistic', 'targeted', 'advanced'] as const;
export const PRIVILEGES = ['none', 'user', 'admin', 'system'] as const;
export const TIERS = ['high', 'medium', 'low'] as const;
export type Tier = (typeof TIERS)[number];

export interface Anchor {
  kind: ElementKind;
  /** Class names; empty means any class of the kind. */
  classes: string[];
  /** For a flow anchor of a target or source row: which end of the flow is anchored. */
  flow_end?: 'initiator' | 'responder';
}

/** An attribute (or a group of them) that breaks, or with `true_enables` strengthens, the path. */
export interface AttributeBreaker {
  /** More than one attribute is a group: it applies (lowers or removes) only when all are true, counted once. */
  attributes: string[];
  read_from: ReadFrom;
  /** For ancestor reads, the boundary classes looked for; for element reads, the classes it is read on (empty: any). */
  classes: string[];
  polarity: 'true_breaks' | 'true_enables';
  /** Only for `true_breaks`. */
  strength?: 'removes' | 'lowers';
  /**
   * How the breaker gates the high tier: `all_false`, when every attribute is explicitly false; `any_false`, when
   * one is (a group whose members are each enough on their own); `ignored`, when it only lowers.
   */
  high_when: 'all_false' | 'any_false' | 'ignored';
  /**
   * The findings (by class and exposure name) that fire on this attribute being absent or false: when the cited
   * exposure is one of them and the attribute is read on the element it sits on, the attribute cannot be true, so
   * the breaker can only gate the tier there, never remove.
   */
  own_condition: Array<{ class: string; exposure: string }>;
  /**
   * Of the own conditions, the findings that fire only on these attributes: every rule body of the finding tests
   * one of them as false or absent, so stating the group true clears the finding. A finding with any other body
   * may keep firing, and is not listed.
   */
  clears: Array<{ class: string; exposure: string }>;
  /** The row techniques it applies to; empty means all. */
  techniques: string[];
}

/** A control of one of `control_classes` supporting the named element counts once; with `attributes_true`, only when one of them is true on it. */
export interface ControlBreaker {
  control_classes: string[];
  attributes_true: string[];
  /** For credential rows: the credential item classes it applies to (MFA protects a person's password, not a machine credential); empty means any. */
  credential_item_classes: string[];
  supports: ControlSupports;
  strength: 'removes' | 'lowers';
  techniques: string[];
}

export interface EdgeKindRow {
  id: string;
  edge_kind: EdgeKind;
  techniques: string[];
  anchors: Anchor[];
  exposed_role: Role;
  peer_relation: PeerRelation;
  /**
   * For a credential row, how a component anchor uses the items on its flows: `outbound`, as holder of what it sends;
   * `both`, also as acceptor of what it receives (an exposed stored credential); `received`, as holder of what it sends
   * and of what it receives (dumped or stored logons).
   */
  credential_flows?: 'outbound' | 'both' | 'received';
  /** For target and source rows: the component types a reached end (and a component anchor of a target row) may have. */
  reached_types: ComponentType[];
  /**
   * The component types a starting point (the pair's source) may have; empty when the row needs none (the starting
   * point is the anchor itself or the item's holder). Sniffing, escaping or fetching needs code running there.
   */
  foothold_types: ComponentType[];
  /**
   * `low`: a starting point under a Managed Runtime caps the pair at low, where host-level access is the vendor's
   * (capture, dumping, escape); `keep`: such a starting point is judged as any other.
   */
  managed_foothold: 'low' | 'keep';
  /**
   * The technique written to the flow's `technique_ids`: the cited one when it is in `from_cited`'s families; else the
   * technique named for the credential item's class; else `default`.
   */
  path: { default: string; from_cited: string[]; by_item_class: Array<{ item_class: string; technique: string }> };
  attribute_breakers: AttributeBreaker[];
  control_breakers: ControlBreaker[];
  defaults: {
    required_capability: (typeof CAPABILITIES)[number];
    required_privilege: (typeof PRIVILEGES)[number];
    granted_privilege: (typeof PRIVILEGES)[number];
  };
  tier_cap: Tier;
  provenance: string;
  /** `policies.rego` locators (with the line of the finding's definition) of the classes that emit this row's techniques. */
  emitters: string[];
}

export interface KindFields {
  kind: EdgeKind;
  /** Kind-specific template fields: enums the module sets from stated facts. */
  fields: Array<{ name: string; values: string[] }>;
}

export interface EdgeKindTable {
  version: number;
  status: 'draft' | 'settled';
  kinds: KindFields[];
  rows: EdgeKindRow[];
}

export const ATTACK_ID = /^T\d{4}(\.\d{3})?$/;
const ROW_ID = /^[a-z0-9-]{1,40}\/[a-z0-9][a-z0-9-]{0,39}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CLASS_NAME = /^[A-Za-z0-9][A-Za-z0-9 &/.()-]{0,63}$/;
const EMITTER = /^dethernety-general\/(component|securityBoundary|dataFlow|data)\/[a-z0-9-]{1,64}\/policies\.rego(:\d{1,5})?$/;
const PROVENANCE = /^[\x20-\x7E]+$/;
export const PROVENANCE_MAX = 500;
/** The relations that offer only reached ends of the row's reached types. */
const PREFILTERED: readonly string[] = ['same-segment', 'in-zone', 'segment-outside-anchor', 'landing-segment', 'zone-egress', 'instance-role-reach', 'kerberos-realm', 'same-host-outside-container'];
/** The table format this module reads. */
export const TABLE_VERSION = 3;
export const MAX_ROWS = 200;

export class TableError extends Error {
  constructor(message: string) {
    super(`edge-kind table: ${message}`);
    this.name = 'TableError';
  }
}

type Json = Record<string, unknown>;

function obj(v: unknown, where: string, keys: readonly string[], optional: readonly string[] = []): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TableError(`${where} is not an object`);
  const o = v as Json;
  for (const k of Object.keys(o)) {
    if (!keys.includes(k) && !optional.includes(k)) throw new TableError(`${where} has an unknown key "${k.slice(0, 80)}"`);
  }
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) throw new TableError(`${where} lacks "${k}"`);
  }
  return o;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new TableError(`${where} must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

function strings(v: unknown, where: string, pattern: RegExp, { min = 0, max = 64 } = {}): string[] {
  if (!Array.isArray(v)) throw new TableError(`${where} is not an array`);
  if (v.length < min || v.length > max) throw new TableError(`${where} must hold ${min} to ${max} entries`);
  const seen = new Set<string>();
  for (const s of v) {
    if (typeof s !== 'string' || !pattern.test(s)) {
      throw new TableError(`${where} holds an invalid entry ${typeof s === 'string' ? JSON.stringify(s.slice(0, 80)) : typeof s}`);
    }
    if (seen.has(s)) throw new TableError(`${where} repeats ${s}`);
    seen.add(s);
  }
  return [...(v as string[])];
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') throw new TableError(`${where} must be true or false`);
  return v;
}

const TIER_RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

/**
 * The highest tier a row's breakers can support for one technique (or for any, when none is given; a filter naming
 * the technique's parent covers it): high needs a breaker that gates high (an attribute that breaks the path and
 * whose explicit false can be stated); medium, any breaker that breaks the path (an attribute or a control); with
 * none, or with only `true_enables` attributes, low.
 */
export function derivedTierCap(row: Pick<EdgeKindRow, 'attribute_breakers' | 'control_breakers' | 'techniques'>, technique?: string): Tier {
  const ts = technique === undefined ? row.techniques : [technique];
  const applies = (techniques: string[]) => techniques.length === 0 || ts.some((t) => techniques.includes(t) || techniques.includes(t.split('.')[0]));
  const breaking = row.attribute_breakers.filter((b) => b.polarity === 'true_breaks' && applies(b.techniques));
  if (breaking.some((b) => b.high_when !== 'ignored')) return 'high';
  if (breaking.length > 0 || row.control_breakers.some((b) => applies(b.techniques))) return 'medium';
  return 'low';
}

function subsetOf(list: string[], of: string[], where: string): string[] {
  for (const t of list) if (!of.includes(t)) throw new TableError(`${where} names ${t}, which the row does not list`);
  return list;
}

const EXPOSURE_NAME = /^[\x20-\x7E]{1,200}$/;

function ownConditions(v: unknown, where: string): Array<{ class: string; exposure: string }> {
  if (!Array.isArray(v) || v.length > 64) throw new TableError(`${where} must be an array of at most 64`);
  const seen = new Set<string>();
  return v.map((e, j) => {
    const o = obj(e, `${where}[${j}]`, ['class', 'exposure']);
    if (typeof o.class !== 'string' || !CLASS_NAME.test(o.class)) throw new TableError(`${where}[${j}].class is invalid`);
    if (typeof o.exposure !== 'string' || !EXPOSURE_NAME.test(o.exposure)) throw new TableError(`${where}[${j}].exposure is invalid`);
    const key = `${o.class}\u0000${o.exposure}`;
    if (seen.has(key)) throw new TableError(`${where} repeats ${o.class}: ${o.exposure}`);
    seen.add(key);
    return { class: o.class, exposure: o.exposure };
  });
}

function attributeBreaker(v: unknown, where: string, techniques: string[], role: Role): AttributeBreaker {
  const o = obj(v, where, ['attributes', 'read_from', 'classes', 'polarity', 'high_when', 'own_condition', 'clears', 'techniques'], ['strength']);
  if (role !== 'credential' && role !== 'capture' && o.read_from === 'credential_item') throw new TableError(`${where}: only credential and capture rows read a credential item`);
  const b: AttributeBreaker = {
    attributes: strings(o.attributes, `${where}.attributes`, NAME, { min: 1, max: 8 }),
    read_from: oneOf(o.read_from, READ_FROM, `${where}.read_from`),
    classes: strings(o.classes, `${where}.classes`, CLASS_NAME, { max: 16 }),
    polarity: oneOf(o.polarity, ['true_breaks', 'true_enables'] as const, `${where}.polarity`),
    high_when: oneOf(o.high_when, ['all_false', 'any_false', 'ignored'] as const, `${where}.high_when`),
    own_condition: ownConditions(o.own_condition, `${where}.own_condition`),
    clears: ownConditions(o.clears, `${where}.clears`),
    techniques: subsetOf(strings(o.techniques, `${where}.techniques`, ATTACK_ID, { max: 32 }), techniques, where),
  };
  if (b.polarity === 'true_breaks') {
    b.strength = oneOf(o.strength, ['removes', 'lowers'] as const, `${where}.strength`);
  } else {
    if (o.strength !== undefined) throw new TableError(`${where}: a true_enables breaker has no strength`);
    if (b.high_when !== 'ignored') throw new TableError(`${where}: a true_enables breaker never gates high`);
  }
  if (ANCESTOR_READS.includes(b.read_from) && b.classes.length === 0) throw new TableError(`${where}: ${b.read_from} names the boundary classes it looks for`);
  if (b.high_when === 'any_false' && b.attributes.length < 2) throw new TableError(`${where}: any_false is for a group of two or more attributes`);
  const own = new Set(b.own_condition.map((x) => `${x.class}\u0000${x.exposure}`));
  if (!b.clears.every((x) => own.has(`${x.class}\u0000${x.exposure}`))) throw new TableError(`${where}.clears names a finding its own_condition does not`);
  return b;
}

function controlBreaker(v: unknown, where: string, techniques: string[]): ControlBreaker {
  const o = obj(v, where, ['control_classes', 'attributes_true', 'credential_item_classes', 'supports', 'strength', 'techniques']);
  return {
    control_classes: strings(o.control_classes, `${where}.control_classes`, CLASS_NAME, { min: 1, max: 8 }),
    attributes_true: strings(o.attributes_true, `${where}.attributes_true`, NAME, { max: 8 }),
    credential_item_classes: strings(o.credential_item_classes, `${where}.credential_item_classes`, CLASS_NAME, { max: 8 }),
    supports: oneOf(o.supports, CONTROL_SUPPORTS, `${where}.supports`),
    strength: oneOf(o.strength, ['removes', 'lowers'] as const, `${where}.strength`),
    techniques: subsetOf(strings(o.techniques, `${where}.techniques`, ATTACK_ID, { max: 32 }), techniques, where),
  };
}

function anchor(v: unknown, where: string, role: Role): Anchor {
  const o = obj(v, where, ['kind', 'classes'], ['flow_end']);
  const a: Anchor = {
    kind: oneOf(o.kind, ELEMENT_KINDS, `${where}.kind`),
    classes: strings(o.classes, `${where}.classes`, CLASS_NAME, { max: 16 }),
  };
  const endNeeded = a.kind === 'dataFlow' && (role === 'target' || role === 'source');
  if (endNeeded) a.flow_end = oneOf(o.flow_end, ['initiator', 'responder'] as const, `${where}.flow_end`);
  else if (o.flow_end !== undefined) throw new TableError(`${where}: flow_end is only for a flow anchor of a target or source row`);
  return a;
}

function row(v: unknown, i: number): EdgeKindRow {
  const where = `rows[${i}]`;
  const o = obj(
    v,
    where,
    ['id', 'edge_kind', 'techniques', 'anchors', 'exposed_role', 'peer_relation', 'reached_types', 'foothold_types', 'managed_foothold', 'path', 'attribute_breakers', 'control_breakers', 'defaults', 'tier_cap', 'provenance', 'emitters'],
    ['credential_flows'],
  );
  if (typeof o.id !== 'string' || !ROW_ID.test(o.id)) throw new TableError(`${where}.id is invalid`);
  const edge_kind = oneOf(o.edge_kind, EDGE_KINDS, `${where}.edge_kind`);
  if (!o.id.startsWith(`${edge_kind}/`)) throw new TableError(`${where}.id must start with its edge_kind`);
  const role = oneOf(o.exposed_role, ROLES, `${where}.exposed_role`);
  const techniques = strings(o.techniques, `${where}.techniques`, ATTACK_ID, { min: 1, max: 32 });
  if (!Array.isArray(o.anchors) || o.anchors.length < 1 || o.anchors.length > 8) throw new TableError(`${where}.anchors must hold 1 to 8 anchors`);
  if (!Array.isArray(o.attribute_breakers) || o.attribute_breakers.length > 24) throw new TableError(`${where}.attribute_breakers must be an array of at most 24`);
  if (!Array.isArray(o.control_breakers) || o.control_breakers.length > 8) throw new TableError(`${where}.control_breakers must be an array of at most 8`);
  if (typeof o.provenance !== 'string' || o.provenance.length === 0 || o.provenance.length > PROVENANCE_MAX || !PROVENANCE.test(o.provenance)) {
    throw new TableError(`${where}.provenance must be 1 to ${PROVENANCE_MAX} printable ASCII characters`);
  }
  const p = obj(o.path, `${where}.path`, ['default', 'from_cited', 'by_item_class']);
  if (!Array.isArray(p.by_item_class) || p.by_item_class.length > 4) throw new TableError(`${where}.path.by_item_class must hold at most 4 entries`);
  if (typeof p.default !== 'string' || !ATTACK_ID.test(p.default)) throw new TableError(`${where}.path.default is not an ATT&CK id`);
  const d = obj(o.defaults, `${where}.defaults`, ['required_capability', 'required_privilege', 'granted_privilege']);
  const r: EdgeKindRow = {
    id: o.id,
    edge_kind,
    techniques,
    anchors: o.anchors.map((a, j) => anchor(a, `${where}.anchors[${j}]`, role)),
    exposed_role: role,
    peer_relation: oneOf(o.peer_relation, PEER_RELATIONS, `${where}.peer_relation`),
    reached_types: strings(o.reached_types, `${where}.reached_types`, /^(PROCESS|STORE|EXTERNAL_ENTITY)$/, { max: 3 }) as ComponentType[],
    foothold_types: strings(o.foothold_types, `${where}.foothold_types`, /^(PROCESS|STORE|EXTERNAL_ENTITY)$/, { max: 3 }) as ComponentType[],
    managed_foothold: oneOf(o.managed_foothold, ['low', 'keep'] as const, `${where}.managed_foothold`),
    path: {
      default: p.default,
      from_cited: strings(p.from_cited, `${where}.path.from_cited`, ATTACK_ID, { max: 8 }),
      by_item_class: p.by_item_class.map((e, j) => {
        const eo = obj(e, `${where}.path.by_item_class[${j}]`, ['item_class', 'technique']);
        if (typeof eo.item_class !== 'string' || !CLASS_NAME.test(eo.item_class)) throw new TableError(`${where}.path.by_item_class[${j}].item_class is invalid`);
        if (typeof eo.technique !== 'string' || !ATTACK_ID.test(eo.technique)) throw new TableError(`${where}.path.by_item_class[${j}].technique is not an ATT&CK id`);
        return { item_class: eo.item_class, technique: eo.technique };
      }),
    },
    attribute_breakers: o.attribute_breakers.map((b, j) => attributeBreaker(b, `${where}.attribute_breakers[${j}]`, techniques, role)),
    control_breakers: o.control_breakers.map((b, j) => controlBreaker(b, `${where}.control_breakers[${j}]`, techniques)),
    defaults: {
      required_capability: oneOf(d.required_capability, CAPABILITIES, `${where}.defaults.required_capability`),
      required_privilege: oneOf(d.required_privilege, PRIVILEGES, `${where}.defaults.required_privilege`),
      granted_privilege: oneOf(d.granted_privilege, PRIVILEGES, `${where}.defaults.granted_privilege`),
    },
    tier_cap: oneOf(o.tier_cap, TIERS, `${where}.tier_cap`),
    provenance: o.provenance,
    emitters: strings(o.emitters, `${where}.emitters`, EMITTER, { max: 64 }),
  };
  if (!ROLE_RELATIONS[r.exposed_role].includes(r.peer_relation)) throw new TableError(`${where}: a ${r.exposed_role} row cannot use ${r.peer_relation}`);
  const families = new Set(r.techniques.map((t) => t.split('.')[0]));
  for (const f of r.path.from_cited) {
    if (!families.has(f.split('.')[0])) throw new TableError(`${where}.path.from_cited names ${f}, outside the row's technique families`);
  }
  const peerReached = r.exposed_role === 'target' || r.exposed_role === 'source';
  if (peerReached && r.reached_types.length === 0) throw new TableError(`${where}: a ${r.exposed_role} row names its reached_types`);
  if (!peerReached && r.reached_types.length !== 0) throw new TableError(`${where}: reached_types is only for target and source rows`);
  // the relations that offer only reached ends of the row's types need them named, or the recheck would type nothing
  if (PREFILTERED.includes(r.peer_relation) && r.reached_types.length === 0) throw new TableError(`${where}: a ${r.peer_relation} row names its reached_types`);
  // zone egress keeps processes as its starting points in code; a row may not claim more
  if (r.peer_relation === 'zone-egress' && !r.foothold_types.every((x) => x === 'PROCESS')) throw new TableError(`${where}: a zone-egress row's starting points are processes`);
  if (r.exposed_role === 'credential') {
    r.credential_flows = oneOf(o.credential_flows, ['outbound', 'both', 'received'] as const, `${where}.credential_flows`);
  } else if (o.credential_flows !== undefined) {
    throw new TableError(`${where}: credential_flows is only for credential rows`);
  }
  // The row's cap must be reachable for some technique; each technique is held to its own at run time.
  const best = derivedTierCap(r);
  if (TIER_RANK[r.tier_cap] > TIER_RANK[best]) throw new TableError(`${where}: tier_cap ${r.tier_cap} is above what its breakers support (${best})`);
  // a control counts for the first breaker it meets: a removing breaker after a lowering one that shares a class
  // would never be reached by a control of that class
  r.control_breakers.forEach((b, j) => {
    const prior = r.control_breakers.slice(0, j).find((x) => x.strength === 'lowers' && x.control_classes.some((c) => b.control_classes.includes(c)));
    if (b.strength === 'removes' && prior) {
      throw new TableError(`${where}.control_breakers[${j}]: a removing breaker comes before a lowering one for the same control classes`);
    }
  });
  return r;
}

function kindFields(v: unknown, i: number): KindFields {
  const where = `kinds[${i}]`;
  const o = obj(v, where, ['kind', 'fields']);
  if (!Array.isArray(o.fields) || o.fields.length > 4) throw new TableError(`${where}.fields must hold at most 4 fields`);
  const seen = new Set<string>();
  return {
    kind: oneOf(o.kind, EDGE_KINDS, `${where}.kind`),
    fields: o.fields.map((f, j) => {
      const fo = obj(f, `${where}.fields[${j}]`, ['name', 'values']);
      if (typeof fo.name !== 'string' || !NAME.test(fo.name)) throw new TableError(`${where}.fields[${j}].name is invalid`);
      if (seen.has(fo.name)) throw new TableError(`${where} repeats the field ${fo.name}`);
      seen.add(fo.name);
      return { name: fo.name, values: strings(fo.values, `${where}.fields[${j}].values`, NAME, { min: 2, max: 8 }) };
    }),
  };
}

/** The key a row answers for: one technique on one element kind, of one class or of any (`*`). */
const selector = (technique: string, kind: ElementKind, cls: string) => `${technique}\u0000${kind}\u0000${cls}`;

/** Validate a parsed table. Throws `TableError` on the first defect; returns the typed table otherwise. */
export function validateTable(raw: unknown): EdgeKindTable {
  const o = obj(raw, 'the table', ['version', 'status', 'kinds', 'rows']);
  if (o.version !== TABLE_VERSION) throw new TableError(`version must be ${TABLE_VERSION}`);
  const status = oneOf(o.status, ['draft', 'settled'] as const, 'status');
  if (!Array.isArray(o.kinds) || o.kinds.length !== EDGE_KINDS.length) throw new TableError('kinds must list every edge kind once');
  const kinds = o.kinds.map(kindFields);
  if (kinds.map((k) => k.kind).sort().join() !== [...EDGE_KINDS].sort().join()) throw new TableError('kinds must list every edge kind once');
  if (!Array.isArray(o.rows) || o.rows.length === 0 || o.rows.length > MAX_ROWS) throw new TableError(`rows must hold 1 to ${MAX_ROWS} rows`);
  const rows = o.rows.map(row);
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  for (const r of rows) {
    if (ids.has(r.id)) throw new TableError(`row id ${r.id} is repeated`);
    ids.add(r.id);
    for (const t of r.techniques) {
      for (const a of r.anchors) {
        for (const cls of a.classes.length > 0 ? a.classes : ['*']) {
          const key = selector(t, a.kind, cls);
          const prior = owner.get(key);
          if (prior === r.id) throw new TableError(`${r.id} names ${t} on ${a.kind} ${cls} twice`);
          if (prior) throw new TableError(`${t} on ${a.kind} ${cls} is in two rows (${prior}, ${r.id}); it selects one row`);
          owner.set(key, r.id);
        }
      }
    }
    if (status === 'settled' && r.emitters.length === 0) throw new TableError(`${r.id}: a settled row names its emitters`);
  }
  return deepFreeze({ version: TABLE_VERSION, status, kinds, rows });
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

/** A row chosen for an exposure: the row, the anchor that matched, and the cited techniques that selected it. */
export interface Selection {
  row: EdgeKindRow;
  anchor: Anchor;
  /** The cited techniques that chose this row; a breaker or path filter compares against these and their parents. */
  matched: string[];
}

function selectOne(table: EdgeKindTable, technique: string, kind: ElementKind, className: string | null): { row: EdgeKindRow; anchor: Anchor } | undefined {
  const dot = technique.indexOf('.');
  for (const t of dot < 0 ? [technique] : [technique, technique.slice(0, dot)]) {
    for (const r of table.rows) {
      if (!r.techniques.includes(t)) continue;
      const a = r.anchors.find((x) => x.kind === kind && className !== null && x.classes.includes(className));
      if (a) return { row: r, anchor: a };
    }
    for (const r of table.rows) {
      if (!r.techniques.includes(t)) continue;
      const a = r.anchors.find((x) => x.kind === kind && x.classes.length === 0);
      if (a) return { row: r, anchor: a };
    }
  }
  return undefined;
}

/**
 * The row one technique on an element selects: by the technique itself, then by its parent; at each step a row
 * naming the element's class wins over a row for any class of its kind. Undefined when none exists.
 */
export function rowFor(table: EdgeKindTable, technique: string, kind: ElementKind, className: string | null): EdgeKindRow | undefined {
  return selectOne(table, technique, kind, className)?.row;
}

/**
 * The rows one exposure selects, from all its techniques. A bare parent technique cited beside one of its own
 * sub-techniques that selects a row is the sub-technique's context, not a finding of its own, so it selects
 * nothing (a host's instance-metadata finding cites T1552.005 and T1552). Each row appears once, with every
 * technique that chose it, in table order.
 */
export function selectRows(table: EdgeKindTable, techniques: string[], kind: ElementKind, className: string | null): Selection[] {
  const cited = [...new Set(techniques)].sort();
  const chosen = new Map(cited.map((t) => [t, selectOne(table, t, kind, className)] as const));
  const out = new Map<string, Selection>();
  for (const t of cited) {
    const pick = chosen.get(t);
    if (!pick) continue;
    const isParent = !t.includes('.');
    if (isParent && cited.some((s) => s.startsWith(`${t}.`) && chosen.get(s))) continue;
    const prior = out.get(pick.row.id);
    if (prior) prior.matched.push(t);
    else out.set(pick.row.id, { row: pick.row, anchor: pick.anchor, matched: [t] });
  }
  return table.rows.flatMap((r) => (out.has(r.id) ? [out.get(r.id)!] : []));
}

/** Every technique the table answers: the constant set the knowledge-graph read asks for, whatever the model. */
export function tableTechniques(table: EdgeKindTable): string[] {
  return [...new Set(table.rows.flatMap((r) => r.techniques))].sort();
}
