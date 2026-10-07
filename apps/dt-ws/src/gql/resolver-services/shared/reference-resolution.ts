import type { ExternalObjectTarget } from '../../interfaces/set-instantiation-attributes.interface';

/**
 * Which kind of node a finding's reference field may point at.
 *   - `technique`: `exploitedBy` and the eight countermeasure verb fields.
 *   - `response`: a countermeasure's `respondsWith`.
 */
export type ReferenceKind = 'technique' | 'response';

export interface ReferencePair {
  label: string;
  property: string;
}

const ATTACK_TECHNIQUE: ReferencePair = { label: 'MitreAttackTechnique', property: 'attack_id' };
const ATLAS_TECHNIQUE: ReferencePair = { label: 'MitreAtlasTechnique', property: 'atlas_id' };
const ATTACK_MITIGATION: ReferencePair = { label: 'MitreAttackMitigation', property: 'attack_id' };
const ATLAS_MITIGATION: ReferencePair = { label: 'MitreAtlasMitigation', property: 'atlas_id' };
const DEFEND_TECHNIQUE: ReferencePair = { label: 'MitreDefendTechnique', property: 'd3fendId' };
const REGULATORY_REQUIREMENT: ReferencePair = { label: 'RegulatoryRequirement', property: 'id' };

/**
 * The closed set of label/key pairs a reference may target, per field kind. These
 * literals are the only labels and keys the writer interpolates into Cypher — a
 * label or key taken from module data never reaches a query.
 */
export const REFERENCE_PAIRS: Record<ReferenceKind, readonly ReferencePair[]> = {
  technique: [ATTACK_TECHNIQUE, ATLAS_TECHNIQUE],
  response: [ATTACK_MITIGATION, ATLAS_MITIGATION, DEFEND_TECHNIQUE, REGULATORY_REQUIREMENT],
};

/** Every distinct pair, in a fixed order; the resolve query has one branch per pair. */
export const ALL_REFERENCE_PAIRS: readonly ReferencePair[] = [
  ATTACK_TECHNIQUE,
  ATLAS_TECHNIQUE,
  ATTACK_MITIGATION,
  ATLAS_MITIGATION,
  DEFEND_TECHNIQUE,
  REGULATORY_REQUIREMENT,
];

/** Bare-string references dispatch by id shape. Anything else is outside the set. */
const BARE_DISPATCH: Record<ReferenceKind, readonly [RegExp, ReferencePair][]> = {
  technique: [
    [/^T\d{4}(\.\d{3})?$/, ATTACK_TECHNIQUE],
    [/^AML\.T\d{4}(\.\d{3})?$/, ATLAS_TECHNIQUE],
  ],
  response: [
    [/^M\d{4}$/, ATTACK_MITIGATION],
    [/^AML\.M\d{4}$/, ATLAS_MITIGATION],
    [/^D3-[A-Za-z0-9]+$/, DEFEND_TECHNIQUE],
  ],
};

/**
 * An unresolved RegulatoryRequirement reference is tolerated (logged, not recorded):
 * a compliance pack can load its requirement nodes after the classes that cite them.
 */
export function isToleratedWhenUnresolved(pair: ReferencePair): boolean {
  return pair.label === REGULATORY_REQUIREMENT.label;
}

export type ClassifiedReference =
  | { status: 'allowed'; pair: ReferencePair; target: ExternalObjectTarget }
  | { status: 'rejected'; display: string };

/**
 * Map a raw reference (bare string or `{label, property, value}` object) onto the
 * closed set for its field kind. The returned target carries the table's own label
 * and property strings, never the input's.
 */
export function classifyReference(kind: ReferenceKind, ref: unknown): ClassifiedReference {
  if (typeof ref === 'string') {
    for (const [pattern, pair] of BARE_DISPATCH[kind]) {
      if (pattern.test(ref)) {
        return { status: 'allowed', pair, target: { label: pair.label, property: pair.property, value: ref } };
      }
    }
    return { status: 'rejected', display: ref };
  }
  if (ref && typeof ref === 'object') {
    const { label, property, value, attributes } = ref as Partial<ExternalObjectTarget>;
    const pair = REFERENCE_PAIRS[kind].find(p => p.label === label && p.property === property);
    if (pair && typeof value === 'string' && value.length > 0) {
      return {
        status: 'allowed',
        pair,
        target: { label: pair.label, property: pair.property, value, attributes },
      };
    }
    return { status: 'rejected', display: `${String(label)}.${String(property)}=${String(value)}` };
  }
  return { status: 'rejected', display: String(ref) };
}

/** Stable key for a resolved target, used to look it up in the resolve result. */
export function referenceKey(pair: ReferencePair, value: string): string {
  return JSON.stringify([pair.label, pair.property, value]);
}

/**
 * One statement that answers, for every pair, which of the given values exist. The
 * labels and keys come from ALL_REFERENCE_PAIRS; the values are parameters `$p0…$pN`.
 */
export const RESOLVE_REFERENCES_CYPHER = ALL_REFERENCE_PAIRS.map(
  (pair, i) =>
    `UNWIND $p${i} AS value
     OPTIONAL MATCH (t:${pair.label} {${pair.property}: value})
     RETURN ${i} AS pairIndex, value, count(t) > 0 AS found`,
).join('\nUNION ALL\n');

/** Group the values to resolve into the `$p0…$pN` parameters of the resolve query. */
export function resolveReferencesParams(
  targets: readonly { pair: ReferencePair; target: ExternalObjectTarget }[],
): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  ALL_REFERENCE_PAIRS.forEach((pair, i) => {
    const values = new Set<string>();
    for (const t of targets) if (t.pair === pair) values.add(t.target.value);
    params[`p${i}`] = [...values];
  });
  return params;
}
