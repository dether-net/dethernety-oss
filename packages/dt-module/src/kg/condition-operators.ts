/**
 * The closed vocabulary of knowledge-graph condition operators, and the normalisation of the aliases
 * a rule may carry instead.
 *
 * A knowledge-graph rule states its trigger as `conditionGroups`: an OR of groups, each an AND of
 * predicates `{ attribute, operator, value? }`. The rules are compiled to Rego, and each operator below
 * means what its compiled Rego expression means; `./condition-groups.ts` evaluates them that way.
 *
 * Pure: no imports, so a consumer that needs the vocabulary takes no other dependency with it.
 */

/** The closed 24-operator vocabulary. */
export const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'regex_match',
  'count_eq',
  'count_gt',
  'count_lt',
  'count_gte',
  'count_lte',
  'has_element',
  'not_has_element',
  'is_true',
  'is_false',
  'exists',
  'not_exists',
] as const;

export type Operator = (typeof OPERATORS)[number];

/** Values a condition may carry: the Rego literals a rule can compare against. */
export type RegoValue = string | number | boolean | Array<string | number | boolean>;

const OPERATOR_SET: ReadonlySet<string> = new Set(OPERATORS);

export function isOperator(op: string): op is Operator {
  return OPERATOR_SET.has(op);
}

/** Operators that carry no value. */
export const UNARY: ReadonlySet<Operator> = new Set(['is_true', 'is_false', 'exists', 'not_exists']);

/**
 * Rego `not <…attr…>` operators — the ones whose compiled Rego negates an expression that references
 * the attribute. When the attribute is ABSENT the inner expression is `undefined`, so `not undefined`
 * SUCCEEDS → the predicate is satisfied. Every other operator fails on an absent attribute (its
 * expression is undefined → the rule body fails). This is the absence rule, as the compiled Rego has it:
 * `is_false`/`not_exists` = `not attr`, `not_in` = `not attr in val`,
 * `not_has_element` = `not val in attr`, `not_contains` = `not contains(attr, val)`.
 */
export const NEGATED: ReadonlySet<Operator> = new Set([
  'is_false',
  'not_exists',
  'not_in',
  'not_has_element',
  'not_contains',
]);

/**
 * Map common hallucinated operators to canonical (operator, default value) pairs. A `null` default
 * means no implied value. Rules are normally written with canonical operators, so this is a defence
 * for legacy and edge-case rules.
 */
export const OPERATOR_ALIASES: Readonly<Record<string, readonly [Operator, RegoValue | null]>> = {
  not_empty: ['count_gt', 0],
  empty: ['count_eq', 0],
  is_not_empty: ['count_gt', 0],
  is_empty: ['count_eq', 0],
  not_null: ['exists', null],
  is_null: ['not_exists', null],
  equals: ['eq', null],
  not_equals: ['neq', null],
  not_equal: ['neq', null],
  greater_than: ['gt', null],
  less_than: ['lt', null],
  greater_than_or_equal: ['gte', null],
  less_than_or_equal: ['lte', null],
  true: ['is_true', null],
  false: ['is_false', null],
};

/**
 * Normalise an operator to the canonical vocabulary: valid operators pass through unchanged; known
 * aliases remap (substituting a default value only when no explicit value was supplied); unknown
 * operators pass through so the caller marks the predicate unevaluable. A real `0`/`false` value must
 * survive, so "no value" is `=== undefined || === null`, never falsiness.
 */
export function normalizeOperator(operator: string, value?: RegoValue): [string, RegoValue | undefined] {
  if (isOperator(operator)) {
    return [operator, value];
  }
  // Own keys only: an operator named like an Object.prototype member ("constructor", "toString", "__proto__")
  // is an unknown operator, never an inherited member.
  const alias = Object.prototype.hasOwnProperty.call(OPERATOR_ALIASES, operator) ? OPERATOR_ALIASES[operator] : undefined;
  if (alias !== undefined) {
    const [canonical, defaultValue] = alias;
    if ((value === undefined || value === null) && defaultValue !== null) {
      return [canonical, defaultValue];
    }
    return [canonical, value];
  }
  return [operator, value];
}
