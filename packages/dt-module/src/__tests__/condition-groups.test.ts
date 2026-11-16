/**
 * The condition-group evaluator: every operator × {present-satisfies, present-fails, present-wrong-type,
 * absent}, missing vs false vs null vs 0, fail-closed unevaluable, the subsumed-group dedupe, the
 * per-operator falsification with `sufficientAlone`, tolerant parsing, and `explainConditionGroups`,
 * which composes them.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluatePredicate,
  evaluateConditionGroups,
  dedupeSubsumedGroups,
  deriveDeltas,
  parseConditionGroups,
  explainConditionGroups,
  normalizeOperator,
  type AttributeMap,
  type Predicate,
  type PredicateGroup,
  type PredicateVerdict,
} from '../condition-groups';

const P = (attribute: string, operator: string, value?: unknown): Predicate => ({ attribute, operator, value });

// ── evaluatePredicate: the per-operator 3-state matrix ──────────────────────────────────────────────

describe('evaluatePredicate — Rego-faithful three-valued semantics', () => {
  // [label, predicate, attrs, expected]
  const cases: [string, Predicate, AttributeMap, PredicateVerdict][] = [
    // is_true
    ['is_true present true', P('k', 'is_true'), { k: true }, 'satisfied'],
    ['is_true present false', P('k', 'is_true'), { k: false }, 'unsatisfied'],
    ['is_true present 0', P('k', 'is_true'), { k: 0 }, 'unsatisfied'],
    ['is_true present 1 (no truthy coercion)', P('k', 'is_true'), { k: 1 }, 'unsatisfied'],
    ['is_true absent', P('k', 'is_true'), {}, 'unsatisfied'],

    // is_false = `not attr`: absent OR present-false only
    ['is_false present false', P('k', 'is_false'), { k: false }, 'satisfied'],
    ['is_false ABSENT', P('k', 'is_false'), {}, 'satisfied'],
    ['is_false present true', P('k', 'is_false'), { k: true }, 'unsatisfied'],
    ['is_false present 0 (NOT coerced)', P('k', 'is_false'), { k: 0 }, 'unsatisfied'],
    ['is_false present null (NOT coerced)', P('k', 'is_false'), { k: null }, 'unsatisfied'],
    ['is_false present "" (NOT coerced)', P('k', 'is_false'), { k: '' }, 'unsatisfied'],
    ['is_false present "x"', P('k', 'is_false'), { k: 'x' }, 'unsatisfied'],

    // not_exists is byte-identical to is_false (both compile to `not attr`)
    ['not_exists ABSENT', P('k', 'not_exists'), {}, 'satisfied'],
    ['not_exists present false', P('k', 'not_exists'), { k: false }, 'satisfied'],
    ['not_exists present true', P('k', 'not_exists'), { k: true }, 'unsatisfied'],
    ['not_exists present 0', P('k', 'not_exists'), { k: 0 }, 'unsatisfied'],

    // exists = bare `attr`: present and not false
    ['exists present true', P('k', 'exists'), { k: true }, 'satisfied'],
    ['exists present 0', P('k', 'exists'), { k: 0 }, 'satisfied'],
    ['exists present null', P('k', 'exists'), { k: null }, 'satisfied'],
    ['exists present false', P('k', 'exists'), { k: false }, 'unsatisfied'],
    ['exists absent', P('k', 'exists'), {}, 'unsatisfied'],

    // eq / neq
    ['eq match', P('k', 'eq', 'v'), { k: 'v' }, 'satisfied'],
    ['eq mismatch', P('k', 'eq', 'v'), { k: 'w' }, 'unsatisfied'],
    ['eq absent', P('k', 'eq', 'v'), {}, 'unsatisfied'],
    ['eq number', P('k', 'eq', 3), { k: 3 }, 'satisfied'],
    ['eq array deep', P('k', 'eq', [1, 2]), { k: [1, 2] }, 'satisfied'],
    ['eq array order matters', P('k', 'eq', [1, 'x']), { k: ['x', 1] }, 'unsatisfied'],
    ['eq typed mismatch (5 vs "5")', P('k', 'eq', 5), { k: '5' }, 'unsatisfied'],
    ['neq differs', P('k', 'neq', 'v'), { k: 'w' }, 'satisfied'],
    ['neq equal', P('k', 'neq', 'v'), { k: 'v' }, 'unsatisfied'],
    ['neq absent (fails)', P('k', 'neq', 'v'), {}, 'unsatisfied'],

    // gt/gte/lt/lte
    ['gt true', P('k', 'gt', 5), { k: 6 }, 'satisfied'],
    ['gt false', P('k', 'gt', 5), { k: 5 }, 'unsatisfied'],
    ['gte eq', P('k', 'gte', 5), { k: 5 }, 'satisfied'],
    ['lt true', P('k', 'lt', 5), { k: 4 }, 'satisfied'],
    ['lt eq', P('k', 'lt', 5), { k: 5 }, 'unsatisfied'],
    ['lte eq', P('k', 'lte', 5), { k: 5 }, 'satisfied'],
    ['gt absent', P('k', 'gt', 5), {}, 'unsatisfied'],
    ['gte absent', P('k', 'gte', 5), {}, 'unsatisfied'],
    ['lt absent', P('k', 'lt', 5), {}, 'unsatisfied'],
    ['lte absent', P('k', 'lte', 5), {}, 'unsatisfied'],
    ['gt absent with a non-number operand (absence before the type check)', P('k', 'gt', 'x'), {}, 'unsatisfied'],
    ['gt present non-number', P('k', 'gt', 5), { k: 'x' }, 'unevaluable'],
    ['gt operand non-number', P('k', 'gt', 'x'), { k: 5 }, 'unevaluable'],

    // in / not_in (val is the collection)
    ['in member', P('k', 'in', ['a', 'b']), { k: 'a' }, 'satisfied'],
    ['in non-member', P('k', 'in', ['a', 'b']), { k: 'c' }, 'unsatisfied'],
    ['in absent', P('k', 'in', ['a']), {}, 'unsatisfied'],
    ['in operand non-array', P('k', 'in', 'a'), { k: 'a' }, 'unevaluable'],
    ['not_in non-member', P('k', 'not_in', ['a', 'b']), { k: 'c' }, 'satisfied'],
    ['not_in member', P('k', 'not_in', ['a', 'b']), { k: 'a' }, 'unsatisfied'],
    ['not_in ABSENT (negated)', P('k', 'not_in', ['a']), {}, 'satisfied'],
    ['not_in operand non-array', P('k', 'not_in', 'a'), { k: 'z' }, 'unevaluable'],

    // has_element / not_has_element (attr is the collection)
    ['has_element present', P('k', 'has_element', 'x'), { k: ['x', 'y'] }, 'satisfied'],
    ['has_element absent-member', P('k', 'has_element', 'z'), { k: ['x'] }, 'unsatisfied'],
    ['has_element attr absent', P('k', 'has_element', 'x'), {}, 'unsatisfied'],
    ['has_element attr non-array', P('k', 'has_element', 'x'), { k: 'x' }, 'unevaluable'],
    ['not_has_element missing', P('k', 'not_has_element', 'z'), { k: ['x'] }, 'satisfied'],
    ['not_has_element present', P('k', 'not_has_element', 'x'), { k: ['x'] }, 'unsatisfied'],
    ['not_has_element attr ABSENT (negated)', P('k', 'not_has_element', 'x'), {}, 'satisfied'],
    ['not_has_element attr non-array', P('k', 'not_has_element', 'x'), { k: 'x' }, 'unevaluable'],

    // count_*
    ['count_eq true', P('k', 'count_eq', 2), { k: ['a', 'b'] }, 'satisfied'],
    ['count_eq false', P('k', 'count_eq', 2), { k: ['a'] }, 'unsatisfied'],
    ['count_gt true', P('k', 'count_gt', 1), { k: ['a', 'b'] }, 'satisfied'],
    ['count_lt true', P('k', 'count_lt', 2), { k: ['a'] }, 'satisfied'],
    ['count_gte eq', P('k', 'count_gte', 2), { k: ['a', 'b'] }, 'satisfied'],
    ['count_lte eq', P('k', 'count_lte', 1), { k: ['a'] }, 'satisfied'],
    ['count_eq absent', P('k', 'count_eq', 0), {}, 'unsatisfied'],
    ['count_eq attr non-array', P('k', 'count_eq', 2), { k: 2 }, 'unevaluable'],
    ['count_eq operand non-number', P('k', 'count_eq', 'x'), { k: [] }, 'unevaluable'],

    // string ops
    ['contains true', P('k', 'contains', 'ell'), { k: 'hello' }, 'satisfied'],
    ['contains false', P('k', 'contains', 'zzz'), { k: 'hello' }, 'unsatisfied'],
    ['contains absent', P('k', 'contains', 'x'), {}, 'unsatisfied'],
    ['contains non-string', P('k', 'contains', 'x'), { k: 5 }, 'unevaluable'],
    ['contains operand non-string', P('k', 'contains', 5), { k: 'hello' }, 'unevaluable'],
    ['not_contains missing', P('k', 'not_contains', 'zzz'), { k: 'hello' }, 'satisfied'],
    ['not_contains present', P('k', 'not_contains', 'ell'), { k: 'hello' }, 'unsatisfied'],
    ['not_contains ABSENT (negated)', P('k', 'not_contains', 'x'), {}, 'satisfied'],
    ['starts_with true', P('k', 'starts_with', 'he'), { k: 'hello' }, 'satisfied'],
    ['starts_with false', P('k', 'starts_with', 'lo'), { k: 'hello' }, 'unsatisfied'],
    ['ends_with true', P('k', 'ends_with', 'lo'), { k: 'hello' }, 'satisfied'],
    ['starts_with absent', P('k', 'starts_with', 'he'), {}, 'unsatisfied'],
    ['starts_with non-string', P('k', 'starts_with', 'he'), { k: 5 }, 'unevaluable'],

    // regex_match — always unevaluable (a scope decision), even a would-be match
    ['regex_match present match', P('k', 'regex_match', '^h'), { k: 'hello' }, 'unevaluable'],
    ['regex_match absent', P('k', 'regex_match', '^h'), {}, 'unevaluable'],

    // unknown operator
    ['unknown operator', P('k', 'frobnicate', 1), { k: 1 }, 'unevaluable'],

    // alias normalization
    ['alias equals→eq', P('k', 'equals', 'v'), { k: 'v' }, 'satisfied'],
    ['alias is_null→not_exists absent', P('k', 'is_null'), {}, 'satisfied'],
    ['alias true→is_true', P('k', 'true'), { k: true }, 'satisfied'],
    ['alias is_empty→count_eq 0', P('k', 'is_empty'), { k: [] }, 'satisfied'],
  ];

  for (const [label, pred, attrs, expected] of cases) {
    it(label, () => {
      expect(evaluatePredicate(pred, attrs), label).toBe(expected);
    });
  }
});

describe('normalizeOperator', () => {
  it('keeps an explicit value over an alias default, and a real 0 or false', () => {
    expect(normalizeOperator('is_empty')).toEqual(['count_eq', 0]);
    expect(normalizeOperator('not_empty', 3)).toEqual(['count_gt', 3]);
    expect(normalizeOperator('equals', 0)).toEqual(['eq', 0]);
    expect(normalizeOperator('equals', false)).toEqual(['eq', false]);
    expect(normalizeOperator('frobnicate', 1)).toEqual(['frobnicate', 1]);
  });
});

// ── evaluateConditionGroups: OR of AND ──────────────────────────────────────────────────────────────

describe('evaluateConditionGroups', () => {
  it('a group is satisfied iff ALL its predicates are satisfied', () => {
    const groups: PredicateGroup[] = [
      [P('a', 'is_false'), P('b', 'is_true')], // a=false(absent-ok), b=true → satisfied
      [P('a', 'is_false'), P('b', 'is_false')], // b present true → unsatisfied
    ];
    const r = evaluateConditionGroups(groups, { b: true });
    expect(r.satisfiedGroupIndexes).toEqual([0]);
    expect(r.unevaluableGroupIndexes).toEqual([]);
  });

  it('any unevaluable predicate makes the WHOLE group unevaluable, even alongside satisfied ones', () => {
    const groups: PredicateGroup[] = [
      [P('a', 'is_false'), P('b', 'gt', 'not-a-number')], // second → unevaluable
    ];
    const r = evaluateConditionGroups(groups, { b: 5 });
    expect(r.satisfiedGroupIndexes).toEqual([]);
    expect(r.unevaluableGroupIndexes).toEqual([0]);
  });

  it('returns stable ascending indexes and puts unsatisfied groups in neither list', () => {
    const groups: PredicateGroup[] = [
      [P('a', 'is_true')], // absent → unsatisfied
      [P('b', 'is_false')], // absent → satisfied
      [P('c', 'gt', 1)], // present non-num → unevaluable
      [P('d', 'is_false')], // absent → satisfied
    ];
    const r = evaluateConditionGroups(groups, { c: 'x' });
    expect(r.satisfiedGroupIndexes).toEqual([1, 3]);
    expect(r.unevaluableGroupIndexes).toEqual([2]);
  });

  it('an empty group is neither satisfied nor unevaluable', () => {
    const r = evaluateConditionGroups([[]], {});
    expect(r.satisfiedGroupIndexes).toEqual([]);
    expect(r.unevaluableGroupIndexes).toEqual([]);
  });
});

// ── dedupeSubsumedGroups ────────────────────────────────────────────────────────────────────────────

describe('dedupeSubsumedGroups', () => {
  it('drops a superset group (group 1 ⊇ group 0)', () => {
    const groups: PredicateGroup[] = [
      [P('token_bound_to_client', 'is_false')], // group 0 (subset)
      [P('token_bound_to_client', 'is_false'), P('replay_cache_enabled', 'is_false')], // group 1 ⊇ group 0
    ];
    const r = dedupeSubsumedGroups(groups);
    expect(r.keptIndexes).toEqual([0]);
    expect(r.subsumedInto).toEqual({ 1: 0 });
  });

  it('dedups identical groups, keeping the lower index', () => {
    const groups: PredicateGroup[] = [[P('a', 'is_false')], [P('a', 'is_false')]];
    const r = dedupeSubsumedGroups(groups);
    expect(r.keptIndexes).toEqual([0]);
    expect(r.subsumedInto).toEqual({ 1: 0 });
  });

  it('keeps disjoint groups (independent OR paths)', () => {
    const groups: PredicateGroup[] = [[P('a', 'is_false')], [P('b', 'is_false')]];
    const r = dedupeSubsumedGroups(groups);
    expect(r.keptIndexes).toEqual([0, 1]);
    expect(r.subsumedInto).toEqual({});
  });

  it('keeps apart two predicates whose fields would join into one string', () => {
    // Joined by a space, a tab or a pipe, each pair would read as one predicate; they are different, so neither
    // group subsumes the other.
    for (const sep of ['', ' ', '\t', '|', ':']) {
      const groups: PredicateGroup[] = [[P(`a${sep}b`, 'eq', 1)], [P('a', `b${sep}eq`, 1)]];
      const r = dedupeSubsumedGroups(groups);
      expect(r.keptIndexes, JSON.stringify(sep)).toEqual([0, 1]);
      expect(r.subsumedInto).toEqual({});
    }
  });

  it('tells a missing value from a null one, which evaluate differently', () => {
    // `eq` with no value fails on a present null; `eq null` holds on it. The group that holds must not be
    // dropped as subsumed by the one that fails.
    const groups: PredicateGroup[] = [[{ attribute: 'k', operator: 'eq' }], [P('k', 'eq', null), P('m', 'is_true')]];
    expect(dedupeSubsumedGroups(groups)).toEqual({ keptIndexes: [0, 1], subsumedInto: {} });
    const r = explainConditionGroups(groups, { k: null, m: true });
    expect(r.verdicts).toEqual([
      { groupIndex: 0, verdict: 'fails' },
      { groupIndex: 1, verdict: 'holds' },
    ]);
    expect(r.satisfied).toEqual([1]);
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]).toMatchObject({ groupIndex: 1, sufficientAlone: true });
  });

  it('never takes an empty group as the subset of the others', () => {
    // An empty group names no condition and never holds; it must not hide the real groups.
    const groups: PredicateGroup[] = [[], [P('a', 'is_false')], [P('b', 'is_true')]];
    const r = dedupeSubsumedGroups(groups);
    expect(r.keptIndexes).toEqual([0, 1, 2]);
    expect(r.subsumedInto).toEqual({});
  });
});

// ── deriveDeltas ────────────────────────────────────────────────────────────────────────────────────

describe('deriveDeltas', () => {
  it('one holding group → one delta, sufficientAlone true, correct falsification', () => {
    const groups: PredicateGroup[] = [[P('tls_only_transport', 'is_false')]];
    const deltas = deriveDeltas(groups, [0], {}); // absent → is_false holds
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ attribute: 'tls_only_transport', operator: 'is_false', relation: 'set', target: true, sufficientAlone: true, groupIndex: 0 });
  });

  it('multiple holding groups → every delta sufficientAlone:false (clearing one is not enough)', () => {
    const groups: PredicateGroup[] = [
      [P('internet_exposed', 'is_true')],
      [P('unpatched_rce', 'is_true')],
    ];
    const deltas = deriveDeltas(groups, [0, 1], { internet_exposed: true, unpatched_rce: true });
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.sufficientAlone === false)).toBe(true);
    expect(deltas.map((d) => d.operator)).toEqual(['is_true', 'is_true']);
    expect(deltas[0]).toMatchObject({ relation: 'set', target: false });
  });

  it('picks the CHEAPEST predicate to flip (boolean over open-ended), deterministically', () => {
    const groups: PredicateGroup[] = [
      [P('region', 'eq', 'us'), P('encryption_enabled', 'is_false')], // eq=cost3, is_false=cost0
    ];
    const deltas = deriveDeltas(groups, [0], { region: 'us' }); // encryption_enabled absent → is_false holds
    expect(deltas).toHaveLength(1);
    expect(deltas[0].attribute).toBe('encryption_enabled');
    expect(deltas[0].operator).toBe('is_false');
  });

  it('breaks a tie in flip cost by the predicate\'s position in the group', () => {
    // Both predicates cost the same; the first in the group is flipped, whatever its name.
    const deltas = deriveDeltas([[P('z_second_name', 'is_true'), P('a_first_name', 'is_false')]], [0], { z_second_name: true });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ attribute: 'z_second_name', operator: 'is_true', relation: 'set', target: false });
    const numeric = deriveDeltas([[P('y', 'gt', 1), P('x', 'count_eq', 0)]], [0], { y: 2, x: [] });
    expect(numeric[0].attribute).toBe('y');
  });

  it('derives per-operator falsification targets', () => {
    const one = (pred: Predicate, attrs: AttributeMap) => deriveDeltas([[pred]], [0], attrs)[0];
    expect(one(P('k', 'is_true'), { k: true })).toMatchObject({ relation: 'set', target: false });
    expect(one(P('k', 'not_exists'), {})).toMatchObject({ relation: 'set', target: true });
    expect(one(P('k', 'exists'), { k: 1 })).toMatchObject({ relation: 'clear' });
    expect(one(P('k', 'neq', 'v'), { k: 'w' })).toMatchObject({ relation: 'set', target: 'v' });
    expect(one(P('k', 'gt', 5), { k: 9 })).toMatchObject({ relation: 'lower', target: 5 });
    expect(one(P('k', 'lt', 5), { k: 1 })).toMatchObject({ relation: 'raise', target: 5 });
    expect(one(P('k', 'not_has_element', 'x'), { k: [] })).toMatchObject({ relation: 'add', target: 'x' });
    expect(one(P('k', 'has_element', 'x'), { k: ['x'] })).toMatchObject({ relation: 'remove', target: 'x' });
    expect(one(P('k', 'eq', 'v'), { k: 'v' })).toMatchObject({ relation: 'change', target: 'v' });
  });

  it('records the current value on the delta, and undefined when the attribute is absent', () => {
    expect(deriveDeltas([[P('k', 'is_false')]], [0], { k: false })[0].currentValue).toBe(false);
    expect(deriveDeltas([[P('k', 'is_false')]], [0], {})[0].currentValue).toBeUndefined();
  });
});

// ── tolerant parser ─────────────────────────────────────────────────────────────────────────────────

describe('parseConditionGroups', () => {
  it('parses valid DNF', () => {
    const raw = JSON.stringify([[{ attribute: 'a', operator: 'is_false' }], [{ attribute: 'b', operator: 'eq', value: 2 }]]);
    expect(parseConditionGroups(raw)).toEqual([[{ attribute: 'a', operator: 'is_false', value: undefined }], [{ attribute: 'b', operator: 'eq', value: 2 }]]);
  });
  it('drops members that are not predicates, and groups that are not arrays', () => {
    const raw = JSON.stringify([[{ attribute: 'a', operator: 'eq', value: 1 }, { junk: true }], 'not-a-group']);
    expect(parseConditionGroups(raw)).toEqual([[{ attribute: 'a', operator: 'eq', value: 1 }]]);
  });
  it('drops a group with no predicate, so it cannot hide the real groups from the subsumption dedupe', () => {
    const raw = JSON.stringify([[], [{ attribute: 'a', operator: 'is_true' }], [{ nope: 1 }], [{ attribute: 'b', operator: 'is_false' }]]);
    const groups = parseConditionGroups(raw);
    expect(groups).toEqual([[{ attribute: 'a', operator: 'is_true', value: undefined }], [{ attribute: 'b', operator: 'is_false', value: undefined }]]);
    expect(dedupeSubsumedGroups(groups).keptIndexes).toEqual([0, 1]);
  });
  const bad: [string, string | null | undefined][] = [
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['malformed json', '{not json'],
    ['non-array', '{"a":1}'],
    ['garbage predicates', JSON.stringify([[{ nope: 1 }, 'x']])],
  ];
  for (const [label, raw] of bad) {
    it(`tolerates ${label} → [] and does not throw`, () => {
      expect(() => parseConditionGroups(raw)).not.toThrow();
      expect(parseConditionGroups(raw)).toEqual([]);
    });
  }
});

describe('an operator named like an Object.prototype member', () => {
  // Such a name is not an alias: it reads as an unknown operator (unevaluable), and evaluating its group never
  // throws, so one odd rule cannot empty a whole evaluation.
  for (const op of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    it(`reads "${op}" as unevaluable, and its group as undecided`, () => {
      expect(evaluatePredicate(P('k', op), { k: true })).toBe('unevaluable');
      expect(evaluateConditionGroups([[P('k', op)], [P('k', 'is_true')]], { k: true })).toEqual({ satisfiedGroupIndexes: [1], unevaluableGroupIndexes: [0] });
    });
  }
});

// ── explainConditionGroups: evaluation, dedupe and deltas ───────────────────────────────────────────

describe('explainConditionGroups', () => {
  it('excludes an unevaluable group from the deltas', () => {
    const r = explainConditionGroups([[P('a', 'is_false')], [P('b', 'unknown_op')]], {});
    expect(r.satisfied).toEqual([0]);
    expect(r.unevaluable).toEqual([1]);
    expect(r.verdicts).toEqual([
      { groupIndex: 0, verdict: 'holds' },
      { groupIndex: 1, verdict: 'unevaluable' },
    ]);
    expect(r.deltas.map((d) => d.groupIndex)).toEqual([0]);
  });

  it('keeps a subsumed holding group\'s own verdict, but counts one root cause', () => {
    const r = explainConditionGroups([[P('a', 'is_false')], [P('a', 'is_false'), P('b', 'is_false')]], {});
    expect(r.verdicts).toEqual([
      { groupIndex: 0, verdict: 'holds' },
      { groupIndex: 1, verdict: 'holds' },
    ]);
    expect(r.satisfied).toEqual([0]);
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0].sufficientAlone).toBe(true);
  });

  it('marks every delta not sufficient alone when two independent groups hold, in groupIndex order', () => {
    const r = explainConditionGroups([[P('z', 'is_false')], [P('b', 'is_true')]], { b: true });
    expect(r.satisfied).toEqual([0, 1]);
    expect(r.deltas.map((d) => d.groupIndex)).toEqual([0, 1]);
    expect(r.deltas.every((d) => d.sufficientAlone === false)).toBe(true);
  });

  it('reports a failing group as fails, and an empty group passed directly as fails without hiding the others', () => {
    const r = explainConditionGroups([[], [P('a', 'is_true')], [P('b', 'is_false')]], { a: false });
    expect(r.verdicts.map((v) => v.verdict)).toEqual(['fails', 'fails', 'holds']);
    expect(r.satisfied).toEqual([2]);
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]).toMatchObject({ attribute: 'b', groupIndex: 2, sufficientAlone: true });
  });
});
