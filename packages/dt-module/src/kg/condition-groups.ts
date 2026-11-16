/**
 * The pure, Rego-faithful condition-group evaluator. Given a knowledge-graph rule's OR-of-AND
 * `conditionGroups` and an element's SPARSE attribute map, it decides which groups trip, which are
 * undecidable, and what attribute change would falsify each holding group. No I/O: the attribute map
 * always comes from the caller.
 *
 * Each operator reproduces the boolean meaning of its compiled Rego expression EXACTLY. The two
 * load-bearing subtleties:
 *   - `is_false`/`not_exists` both compile to `not attr` — satisfied by an ABSENT attribute OR a
 *     present `false`; NOT by present `0`/`null`/`""`/truthy. The five `not …attr…` operators
 *     (see NEGATED) all succeed on absent. Every other operator FAILS on absent.
 *   - Never coerce a missing attribute to `false`/`0`. Absent is handled BEFORE any type check.
 * Type mismatch on a present value, an unknown operator, and `regex_match` → `unevaluable`
 * (fail-closed): excluded from both the "condition met" claim and any count.
 *
 * Pure: it imports only `./condition-operators`.
 */

import { isOperator, normalizeOperator, NEGATED, type RegoValue } from './condition-operators';

/** One predicate of a group: an attribute, an operator and the value it compares against (if any). */
export interface Predicate {
  attribute: string;
  operator: string; // one of OPERATORS, or an alias normalizeOperator maps onto one
  value?: unknown;
}
/** An AND of predicates; the groups of a rule OR together. */
export type PredicateGroup = Predicate[];

export type DeltaRelation =
  | 'set' // exact new value in `target` (is_false→true, is_true→false, neq→val)
  | 'clear' // unset / make absent (exists)
  | 'raise' // numeric up past the bound in `target` (lt→≥, lte→>)
  | 'lower' // numeric down past the bound in `target` (gt→≤, gte→<)
  | 'add' // add `target` (not_has_element / not_contains / not_in membership)
  | 'remove' // remove `target` (has_element / contains)
  | 'change'; // no single target — move away (eq / in / starts_with / ends_with / count_*)

/** The attribute change that would make one holding group fail. */
export interface Delta {
  attribute: string;
  operator: string; // the operator being falsified (canonical)
  currentValue?: unknown; // the current value (undefined when absent)
  relation: DeltaRelation;
  target?: unknown; // the operand where one is meaningful (bound, member, element, substring)
  sufficientAlone: boolean; // false whenever >1 group holds — this flip alone does not clear the exposure
  groupIndex: number; // the holding group this delta breaks
}

export type PredicateVerdict = 'satisfied' | 'unsatisfied' | 'unevaluable';
export type AttributeMap = Record<string, unknown>;

// ── value helpers ─────────────────────────────────────────────────────────────────────────────────
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isArr = (x: unknown): x is unknown[] => Array.isArray(x);

/** Structural equality over Rego literals (primitives + arrays of primitives). Objects → identity. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  return false;
}
const arrayContains = (arr: unknown[], x: unknown): boolean => arr.some((e) => deepEqual(e, x));

// ── evaluatePredicate — the Rego mirror ─────────────────────────────────────────────────────────────

/**
 * Evaluate one predicate against the sparse attribute map. Returns the three-valued verdict; never
 * throws. `attrs` distinguishes ABSENT (key not present) from a present `false`/`null`/`0` — the
 * absence distinction the whole evaluator rests on.
 */
export function evaluatePredicate(pred: Predicate, attrs: AttributeMap): PredicateVerdict {
  const [op, val] = normalizeOperator(pred.operator, pred.value as RegoValue | undefined);
  if (!isOperator(op)) return 'unevaluable'; // unknown operator, fail-closed
  if (op === 'regex_match') return 'unevaluable'; // not evaluated (a scope decision): fail-closed

  const has = Object.prototype.hasOwnProperty.call(attrs, pred.attribute);
  if (!has) {
    // Absent short-circuits BEFORE any type check — a missing attribute has no type. The Rego
    // `not …attr…` operators succeed on absent (`not undefined`); everything else fails.
    return NEGATED.has(op) ? 'satisfied' : 'unsatisfied';
  }
  const v = attrs[pred.attribute];

  switch (op) {
    case 'is_true':
      return v === true ? 'satisfied' : 'unsatisfied';
    case 'is_false':
    case 'not_exists': // identical Rego `not attr`; present-`false` satisfies, any other present value does not
      return v === false ? 'satisfied' : 'unsatisfied';
    case 'exists': // Rego bare `attr`: defined and not false
      return v !== false ? 'satisfied' : 'unsatisfied';
    case 'eq':
      return deepEqual(v, val) ? 'satisfied' : 'unsatisfied';
    case 'neq':
      return !deepEqual(v, val) ? 'satisfied' : 'unsatisfied';
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (!isNum(v) || !isNum(val)) return 'unevaluable';
      return numCompare(op, v, val) ? 'satisfied' : 'unsatisfied';
    case 'in': // `attr in val` — val is the collection, attr the element
      if (!isArr(val)) return 'unevaluable';
      return arrayContains(val, v) ? 'satisfied' : 'unsatisfied';
    case 'not_in':
      if (!isArr(val)) return 'unevaluable';
      return arrayContains(val, v) ? 'unsatisfied' : 'satisfied';
    case 'has_element': // `val in attr` — attr is the collection, val the element
      if (!isArr(v)) return 'unevaluable';
      return arrayContains(v, val) ? 'satisfied' : 'unsatisfied';
    case 'not_has_element':
      if (!isArr(v)) return 'unevaluable';
      return arrayContains(v, val) ? 'unsatisfied' : 'satisfied';
    case 'count_eq':
    case 'count_gt':
    case 'count_lt':
    case 'count_gte':
    case 'count_lte':
      if (!isArr(v) || !isNum(val)) return 'unevaluable';
      return countCompare(op, v.length, val) ? 'satisfied' : 'unsatisfied';
    case 'contains':
      if (!isStr(v) || !isStr(val)) return 'unevaluable';
      return v.includes(val) ? 'satisfied' : 'unsatisfied';
    case 'not_contains':
      if (!isStr(v) || !isStr(val)) return 'unevaluable';
      return v.includes(val) ? 'unsatisfied' : 'satisfied';
    case 'starts_with':
      if (!isStr(v) || !isStr(val)) return 'unevaluable';
      return v.startsWith(val) ? 'satisfied' : 'unsatisfied';
    case 'ends_with':
      if (!isStr(v) || !isStr(val)) return 'unevaluable';
      return v.endsWith(val) ? 'satisfied' : 'unsatisfied';
    default:
      return 'unevaluable'; // regex_match is handled above; defensive
  }
}

function numCompare(op: 'gt' | 'gte' | 'lt' | 'lte', a: number, b: number): boolean {
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
  }
}

function countCompare(op: 'count_eq' | 'count_gt' | 'count_lt' | 'count_gte' | 'count_lte', n: number, b: number): boolean {
  switch (op) {
    case 'count_eq':
      return n === b;
    case 'count_gt':
      return n > b;
    case 'count_lt':
      return n < b;
    case 'count_gte':
      return n >= b;
    case 'count_lte':
      return n <= b;
  }
}

// ── evaluateConditionGroups — OR of AND ─────────────────────────────────────────────────────────────

export interface GroupEvaluation {
  satisfiedGroupIndexes: number[];
  unevaluableGroupIndexes: number[];
}

/**
 * Evaluate every group. A group (AND) is `unevaluable` if ANY predicate is unevaluable (a
 * knowable subset must not masquerade as the whole group); otherwise `satisfied` iff ALL predicates
 * are satisfied. Indexes are original positions, sorted ascending. Unsatisfied groups appear in
 * neither array.
 */
export function evaluateConditionGroups(groups: PredicateGroup[], attrs: AttributeMap): GroupEvaluation {
  const satisfiedGroupIndexes: number[] = [];
  const unevaluableGroupIndexes: number[] = [];
  groups.forEach((group, i) => {
    let anyUnevaluable = false;
    let allSatisfied = true;
    for (const pred of group) {
      const verdict = evaluatePredicate(pred, attrs);
      if (verdict === 'unevaluable') {
        anyUnevaluable = true;
        break;
      }
      if (verdict !== 'satisfied') allSatisfied = false;
    }
    if (anyUnevaluable) unevaluableGroupIndexes.push(i);
    else if (allSatisfied && group.length > 0) satisfiedGroupIndexes.push(i);
  });
  return { satisfiedGroupIndexes, unevaluableGroupIndexes };
}

// ── dedupeSubsumedGroups ────────────────────────────────────────────────────────────────────────────

// NUL separates the fields, so names that a space or other printable separator would join (attribute
// "a b" with operator "eq", attribute "a" with operator "b eq") keep different keys. A missing value and
// `value: null` get different keys too: `eq` with no value and `eq null` evaluate differently, so one must
// not subsume a group holding the other.
const predKey = (p: Predicate): string =>
  `${p.attribute}\0${p.operator}\0${p.value === undefined ? '' : JSON.stringify(p.value)}`;

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Drop groups whose predicate SET is a superset of another group's — a superset can never hold
 * independently (if it holds, its subset holds too), so counting it as a distinct root cause would
 * over-report ("2 of 2 hold" where there is one cause). Identical sets → keep the lower index.
 * Pure pairwise rule (order-independent except the tie-break). Returns kept indexes + a map from each
 * dropped group to the (a) subset it was subsumed into.
 */
export function dedupeSubsumedGroups(groups: PredicateGroup[]): {
  keptIndexes: number[];
  subsumedInto: Record<number, number>;
} {
  const sets = groups.map((g) => new Set(g.map(predKey)));
  const subsumedInto: Record<number, number> = {};
  for (let i = 0; i < groups.length; i++) {
    for (let j = 0; j < groups.length; j++) {
      if (i === j) continue;
      // An empty group names no condition and never holds, so it subsumes nothing.
      if (sets[j].size === 0) continue;
      const strictSubset = isSubset(sets[j], sets[i]) && sets[j].size < sets[i].size;
      const identicalDuplicate = sets[i].size === sets[j].size && isSubset(sets[i], sets[j]) && isSubset(sets[j], sets[i]) && j < i;
      if (strictSubset || identicalDuplicate) {
        subsumedInto[i] = j;
        break;
      }
    }
  }
  const keptIndexes = groups.map((_, i) => i).filter((i) => !(i in subsumedInto));
  return { keptIndexes, subsumedInto };
}

// ── deriveDeltas ────────────────────────────────────────────────────────────────────────────────────

// Cost order for choosing which predicate in a holding AND-group to flip (cheapest wins; ties → lowest
// predicate index). Concrete, direct flips are preferred over open-ended "change it somehow".
function flipCost(op: string): number {
  if (op === 'is_false' || op === 'not_exists' || op === 'is_true' || op === 'exists') return 0;
  if (op === 'neq' || op === 'not_in' || op === 'not_has_element' || op === 'not_contains') return 1;
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') return 2;
  if (op === 'count_eq' || op === 'count_gt' || op === 'count_lt' || op === 'count_gte' || op === 'count_lte') return 2;
  if (op === 'regex_match') return Infinity; // never flippable (unevaluable — can't be in a holding group)
  return 3; // eq, in, has_element, contains, starts_with, ends_with — open-ended
}

// The value/relation that makes a *satisfied* predicate *unsatisfied*.
function falsify(op: string, val: unknown): { relation: DeltaRelation; target?: unknown } {
  switch (op) {
    case 'is_false':
    case 'not_exists':
      return { relation: 'set', target: true };
    case 'is_true':
      return { relation: 'set', target: false };
    case 'exists':
      return { relation: 'clear' };
    case 'neq':
      return { relation: 'set', target: val };
    case 'not_in':
      return { relation: 'add', target: Array.isArray(val) && val.length ? val[0] : val };
    case 'not_has_element':
    case 'not_contains':
      return { relation: 'add', target: val };
    case 'gt':
    case 'gte':
      return { relation: 'lower', target: val };
    case 'lt':
    case 'lte':
      return { relation: 'raise', target: val };
    case 'has_element':
    case 'contains':
      return { relation: 'remove', target: val };
    default:
      // eq, in, starts_with, ends_with, count_eq/gt/lt/gte/lte — no single concrete target
      return { relation: 'change', target: val };
  }
}

/**
 * One delta per KEPT, HOLDING group (post-dedupe ∩ satisfied): the cheapest predicate to flip so the
 * group fails. `sufficientAlone` is false on EVERY delta whenever more than one group holds — clearing
 * one group does not clear the exposure. Deterministic: cheapest cost, ties by predicate index.
 */
export function deriveDeltas(
  groups: PredicateGroup[],
  keptHoldingIndexes: number[],
  attrs: AttributeMap,
): Delta[] {
  const sufficientAlone = keptHoldingIndexes.length === 1;
  const deltas: Delta[] = [];
  for (const gi of keptHoldingIndexes) {
    const group = groups[gi];
    if (!group || group.length === 0) continue;
    const ranked = group
      .map((pred, pi) => ({ pred, pi, cost: flipCost(normalizeOperator(pred.operator, pred.value as RegoValue | undefined)[0]) }))
      .filter((x) => x.cost !== Infinity)
      .sort((a, b) => a.cost - b.cost || a.pi - b.pi);
    if (ranked.length === 0) continue;
    const { pred } = ranked[0];
    const [op, val] = normalizeOperator(pred.operator, pred.value as RegoValue | undefined);
    const has = Object.prototype.hasOwnProperty.call(attrs, pred.attribute);
    const { relation, target } = falsify(op, val);
    deltas.push({
      attribute: pred.attribute,
      operator: op,
      currentValue: has ? attrs[pred.attribute] : undefined,
      relation,
      target,
      sufficientAlone,
      groupIndex: gi,
    });
  }
  return deltas;
}

// ── tolerant parser ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse a knowledge-graph `conditionGroups` JSON string into typed groups. Never throws; malformed → [].
 * A group left with no predicate (empty, or none well-formed) is dropped: it names no condition.
 */
export function parseConditionGroups(raw: string | null | undefined): PredicateGroup[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Array.isArray)
      .map((group) =>
        group
          .filter((p: unknown): p is { attribute: string; operator: string; value?: unknown } => {
            const o = p as { attribute?: unknown; operator?: unknown };
            return !!p && typeof o.attribute === 'string' && typeof o.operator === 'string';
          })
          .map((p) => ({ attribute: p.attribute, operator: p.operator, value: p.value })),
      )
      .filter((group) => group.length > 0);
  } catch {
    return [];
  }
}

// ── explainConditionGroups — evaluation, dedupe and deltas in one call ───────────────────────────────

export interface GroupVerdict {
  groupIndex: number;
  verdict: 'holds' | 'fails' | 'unevaluable';
}

export interface ConditionGroupsEvaluation {
  /** Every group's own verdict, by groupIndex (before the dedupe). */
  verdicts: GroupVerdict[];
  /** The holding groups that remain after the dedupe: one root cause each. */
  satisfied: number[];
  /** The groups that cannot be decided (fail-closed). */
  unevaluable: number[];
  /** One falsifying delta per remaining holding group. */
  deltas: Delta[];
}

/**
 * Evaluate the groups, drop the subsumed ones, and derive the falsifying deltas. `verdicts` reports
 * every group as it evaluates; `satisfied` and `deltas` reflect the deduped root causes (a holding group
 * subsumed by another holding group is in neither).
 */
export function explainConditionGroups(groups: PredicateGroup[], attrs: AttributeMap): ConditionGroupsEvaluation {
  const { satisfiedGroupIndexes, unevaluableGroupIndexes } = evaluateConditionGroups(groups, attrs);
  const satisfiedSet = new Set(satisfiedGroupIndexes);
  const unevaluableSet = new Set(unevaluableGroupIndexes);
  const verdicts: GroupVerdict[] = groups.map((_, i) => ({
    groupIndex: i,
    verdict: unevaluableSet.has(i) ? 'unevaluable' : satisfiedSet.has(i) ? 'holds' : 'fails',
  }));
  const kept = new Set(dedupeSubsumedGroups(groups).keptIndexes);
  const satisfied = satisfiedGroupIndexes.filter((i) => kept.has(i));
  const deltas = deriveDeltas(groups, satisfied, attrs);
  return { verdicts, satisfied, unevaluable: unevaluableGroupIndexes, deltas };
}
