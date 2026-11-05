/**
 * Who runs each component and boundary, resolved at generate time and frozen into the snapshot. It reads the operator
 * and product an element's class edges declare and runs dt-core's own rules over them. Two responsibilities, split as
 * in the zoning adapter:
 *   - the reads and the digest signatures are pure and import nothing, so the staleness poll can never fail on a
 *     dynamic import: `operationSignatures` normalises the values itself, and a test holds it to dt-core's reading;
 *   - `resolveOperation` takes the rules as an argument, since the module is CJS and dt-core is ESM-only.
 *
 * Only the operator (with its flattened forms, as the platform stores a list or an object) and the product leave the
 * database. The version the form also holds never reaches this module: the query filters the keys itself.
 */
import type { EffectiveZone, HostingParent, HostingResolution, OperationAttributeBag, OperatorResolution, Zone } from '@dethernety/dt-core';

const OPERATOR_KEY = 'dethernety_operated_by';
const PRODUCT_KEY = 'dethernety_product';
const OPERATOR_VALUES = ['CUSTOMER', 'VENDOR'];

/** The longest product text kept; the field allows 200 characters, and nothing enforces it on a direct write. */
const PRODUCT_MAX = 200;

/** One row per class edge that holds an operator or product key: the element's id and those keys, as pairs. */
export const OPERATION_ROWS_QUERY = `MATCH (m:Model {id: $modelId})
  OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
  WITH m, collect(DISTINCT b) AS bs
  OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
  WITH bs, collect(DISTINCT c) AS cs
  WITH bs + cs AS els
  UNWIND els AS el
  MATCH (el)-[inst:IS_INSTANCE_OF]->()
  WITH el.id AS id, properties(inst) AS ia
  WITH id, [k IN keys(ia) WHERE k = '${OPERATOR_KEY}' OR k STARTS WITH '${OPERATOR_KEY}['
         OR k STARTS WITH '${OPERATOR_KEY}.' OR k = '${PRODUCT_KEY}' | [k, ia[k]]] AS pairs
  WHERE size(pairs) > 0
  RETURN id, pairs`;

export interface OperationRow {
  id: string;
  pairs: [string, unknown][];
}

/** The rows of a run of `OPERATION_ROWS_QUERY`. */
export function operationRows(result: { records: Array<{ get(key: string): unknown }> }): OperationRow[] {
  return result.records.map((r) => ({ id: r.get('id') as string, pairs: r.get('pairs') as OperationRow['pairs'] }));
}

type Bag = Record<string, unknown>;

/** Each element's class-edge bags, in an order that does not depend on the database's. */
export function bagsByElement(rows: readonly OperationRow[]): Map<string, Bag[]> {
  const out = new Map<string, Bag[]>();
  for (const row of rows) {
    const pairs = [...row.pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const bag: Bag = Object.create(null);
    for (const [key, value] of pairs) bag[key] = value;
    out.set(row.id, [...(out.get(row.id) ?? []), bag]);
  }
  for (const bags of out.values()) bags.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return out;
}

const unanswered = (value: unknown): boolean => value === undefined || value === null || value === '';

/** What the bags declare, as dt-core's `readOperator` reads it: a value, `invalid`, or nothing. */
export function declaredOperator(bags: readonly Bag[]): 'CUSTOMER' | 'VENDOR' | 'invalid' | null {
  const values: unknown[] = [];
  let invalid = false;
  for (const bag of bags) {
    for (const key of Object.keys(bag)) {
      if ((key.startsWith(`${OPERATOR_KEY}[`) || key.startsWith(`${OPERATOR_KEY}.`)) && !unanswered(bag[key])) invalid = true;
    }
    if (!unanswered(bag[OPERATOR_KEY])) values.push(bag[OPERATOR_KEY]);
  }
  if (!invalid && values.length === 0) return null;
  const first = values[0];
  if (invalid || typeof first !== 'string' || !OPERATOR_VALUES.includes(first) || values.some((v) => v !== first)) return 'invalid';
  return first as 'CUSTOMER' | 'VENDOR';
}

/** The product the bags name: the first non-empty text, trimmed, in Unicode NFC and cut to `PRODUCT_MAX`. */
export function declaredProduct(bags: readonly Bag[]): string | undefined {
  for (const bag of bags) {
    const value = bag[PRODUCT_KEY];
    if (typeof value === 'string' && value.trim() !== '') return value.trim().normalize('NFC').slice(0, PRODUCT_MAX);
  }
  return undefined;
}

/**
 * One signature per element that declares, over the normalised values: a value cleared, or stored another way that reads
 * the same, does not move the fingerprint. Empty when nothing declares, so such a model's digest does not change.
 */
export function operationSignatures(rows: readonly OperationRow[]): string[] {
  const sigs: string[] = [];
  for (const [id, bags] of bagsByElement(rows)) {
    const operator = declaredOperator(bags);
    const product = declaredProduct(bags);
    if (operator !== null || product !== undefined) sigs.push(JSON.stringify([id, operator ?? '', product ?? '']));
  }
  return sigs.sort();
}

/** The dt-core rules the resolution runs; loaded by the module, since dt-core is ESM-only. */
export interface OperationRules {
  operatorOf(input: { bags: readonly OperationAttributeBag[]; effectiveZone: Zone }): OperatorResolution;
  hostingOf(parent: HostingParent | undefined): HostingResolution;
}

export interface ElementOperation {
  operator: OperatorResolution;
  product?: string;
  /** A component's hosting boundary, when it carries a value. A boundary has none. */
  hosting?: { boundaryId: string; name: string; party: HostingResolution['party']; source: HostingResolution['source'] };
  /** A boundary declared as run by a vendor: the components drawn directly in it. The model's root never hosts. */
  drawnComponents?: number;
}

export interface OperationBlock {
  /** `unavailable`: the rules could not load, or the zones they read could not be worked out. Nothing is shown then. */
  state: 'resolved' | 'unavailable';
  elements: Record<string, ElementOperation>;
}

export const OPERATION_UNAVAILABLE: OperationBlock = { state: 'unavailable', elements: {} };

interface GraphBoundary {
  id: string;
  name: string;
  parentBoundaryId: string | null;
}

interface GraphComponent {
  id: string;
  boundaryId: string | null;
}

const DEFAULT_ZONE: Zone = 'INTERNAL';

/** Resolve every component and boundary. `elements` holds model-controlled ids as keys, so it has no prototype. */
export function resolveOperation(
  rows: readonly OperationRow[],
  graph: { boundaries?: readonly GraphBoundary[]; components?: readonly GraphComponent[] },
  effectiveZones: Readonly<Record<string, EffectiveZone>>,
  rules: OperationRules,
): OperationBlock {
  const bags = bagsByElement(rows);
  const boundaries = graph.boundaries ?? [];
  const components = graph.components ?? [];
  const boundaryById = new Map(boundaries.map((b) => [b.id, b] as const));
  const zoneOf = (id: string | null): Zone => (id ? effectiveZones[id]?.zone : undefined) ?? DEFAULT_ZONE;
  const elements: Record<string, ElementOperation> = Object.create(null);

  for (const b of boundaries) {
    const own = bags.get(b.id) ?? [];
    const operator = rules.operatorOf({ bags: own, effectiveZone: zoneOf(b.id) });
    const product = declaredProduct(own);
    // A top-level boundary is the model's root: `parentBoundaryId` is null only there, and it never hosts.
    const hosts = operator.source === 'declared' && operator.party === 'VENDOR' && b.parentBoundaryId != null;
    elements[b.id] = {
      operator,
      ...(product !== undefined ? { product } : {}),
      ...(hosts ? { drawnComponents: components.filter((c) => c.boundaryId === b.id).length } : {}),
    };
  }

  for (const c of components) {
    const own = bags.get(c.id) ?? [];
    const operator = rules.operatorOf({ bags: own, effectiveZone: zoneOf(c.boundaryId) });
    const product = declaredProduct(own);
    const parent = c.boundaryId ? boundaryById.get(c.boundaryId) : undefined;
    const parentBags = parent ? bags.get(parent.id) ?? [] : [];
    const hosting = rules.hostingOf(
      parent && { id: parent.id, classed: parentBags.length > 0, isDefaultBoundary: parent.parentBoundaryId == null, bags: parentBags },
    );
    elements[c.id] = {
      operator,
      ...(product !== undefined ? { product } : {}),
      ...(parent && hosting.source !== 'undeclared'
        ? { hosting: { boundaryId: parent.id, name: parent.name, party: hosting.party, source: hosting.source } }
        : {}),
    };
  }
  return { state: 'resolved', elements };
}
