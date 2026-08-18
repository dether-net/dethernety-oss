/**
 * Turning a source row into a declared payload — the one copy, shared by both implementations.
 *
 * This is deliberately not written twice. The two clients read from different places (a bolt
 * record, a JSON object off the wire) but owe a caller the *same* object, and "absent becomes
 * null, an unrecognised kind narrows to null, a missing list is an empty array" is exactly the
 * kind of rule that two hand-written copies observe slightly differently six months apart. The
 * modes being indistinguishable is the property this whole seam exists for, so the mapping is
 * shared by construction rather than checked by a test.
 *
 * Each function takes a `get(key)` accessor instead of a container, which is all the two sources
 * have in common. A bolt record's `get` throws for a key the statement did not project; a plain
 * object's returns `undefined`. Both are handled: a required field that is missing throws either
 * way, and an optional one resolves null.
 */
import { coerceNeoInt } from '../db-ops';
import { KgAttribute, KgCorpusEntry, KgRule, KgRuleKind, KgThreat } from '../interfaces/kg-client-interface';

/** Reads one field of a source row. */
export type FieldGetter = (key: string) => unknown;

/** A getter over a plain object — the wire's shape. */
export function fromObject(value: unknown): FieldGetter {
  const record = (value ?? {}) as Record<string, unknown>;
  return (key) => record[key];
}

/** A required string. Absent means the row is malformed, so fail rather than invent. */
export function requireStr(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`knowledge-graph row is missing the required field "${field}"`);
  }
  return v;
}

/**
 * An optional string.
 *
 * Always `null`, never `undefined`: the two are indistinguishable to `toEqual`, so an
 * implementation that dropped a field would pass every equality check written against one that
 * kept it. Making absence explicit is what lets thinning be detected at all.
 */
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export function strList(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
}

/** A projected list. Always a list in practice; never trust it straight into a `.map()`. */
export function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * A score, unboxed.
 *
 * A rule authored with an integer score (the published corpus has them) arrives from a graph as a
 * lossless bolt `Integer`, not a number — `JSON.stringify`-ing one yields `{"low":9,"high":0}`,
 * which is not a score. `coerceNeoInt` is the package's one duck-typed unboxing, shared with the
 * policy-engine seam; a value off the wire is already a number and passes straight through. It
 * preserves anything beyond 2^53 as an exact decimal *string*, which is not assignable here — no
 * real score is near that, so such a row is corrupt and resolves null.
 */
export function score(v: unknown): number | null {
  const c = coerceNeoInt(v);
  return typeof c === 'number' ? c : null;
}

/**
 * Narrow a stored kind to the declared union.
 *
 * Both sources hold a free string. Passing an unrecognised value through would make the returned
 * object disagree with its own type — and doing it in one mode and not the other would make the
 * two answer differently for the same corpus, which is the failure the shared copy prevents.
 */
export function ruleKind(v: unknown): KgRuleKind | null {
  return v === 'exposure' || v === 'countermeasure' ? v : null;
}

export function toAttribute(value: unknown): KgAttribute {
  const get = fromObject(value);
  return {
    name: requireStr(get('name'), 'KgAttribute.name'),
    title: str(get('title')),
    description: str(get('description')),
    category: str(get('category')),
  };
}

export function toCorpusEntry(value: unknown): KgCorpusEntry {
  const get = fromObject(value);
  return {
    id: requireStr(get('id'), 'KgCorpusEntry.id'),
    kind: str(get('kind')),
    title: str(get('title')),
    canonicalUrl: str(get('canonicalUrl')),
    synthesis: str(get('synthesis')),
    accessed: str(get('accessed')),
    resolved: bool(get('resolved')),
  };
}

export function toRule(get: FieldGetter): KgRule {
  return {
    id: requireStr(get('id'), 'KgRule.id'),
    ruleId: requireStr(get('ruleId'), 'KgRule.ruleId'),
    classId: requireStr(get('classId'), 'KgRule.classId'),
    name: str(get('name')),
    kind: ruleKind(get('kind')),
    description: str(get('description')),
    criticality: str(get('criticality')),
    score: score(get('score')),
    attackVector: str(get('attackVector')),
    conditionGroups: str(get('conditionGroups')),
    mitreRefs: str(get('mitreRefs')),
    reads: list(get('reads')).map(toAttribute),
  };
}

export function toThreat(get: FieldGetter): KgThreat {
  return {
    id: requireStr(get('id'), 'KgThreat.id'),
    slug: requireStr(get('slug'), 'KgThreat.slug'),
    name: str(get('name')),
    description: str(get('description')),
    attackSurface: str(get('attackSurface')),
    techniqueIds: strList(get('techniqueIds')),
    techniqueProvenance: str(get('techniqueProvenance')),
    derivedFrom: list(get('derivedFrom')).map(toCorpusEntry),
  };
}
