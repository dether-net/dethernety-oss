import { buildSchema, GraphQLError, parse, validate } from 'graphql';
import {
  assertComplexityWithinLimit,
  buildGuardedValidate,
  buildValidationRules,
  depthLimitRule,
} from '../query-guards';

/**
 * Pins for the shared query guards used by BOTH transports (Apollo plugin
 * and the graphql-sse handler). One implementation — these tests are the
 * contract both surfaces rely on.
 */

const schema = buildSchema(`
  type Child { name: String, child: Child }
  type Query { root: Child, items: [Child] }
`);

describe('buildValidationRules / buildGuardedValidate (depth)', () => {
  const config = { queryDepthLimit: 2, queryComplexityLimit: 0 };

  const DEEP = parse('{ root { child { child { name } } } }'); // depth 4
  const SHALLOW = parse('{ root { name } }'); // depth 2

  it('rejects an over-deep query and passes a shallow one (raw rules)', () => {
    const rules = buildValidationRules(config);
    expect(rules).toHaveLength(1);
    expect(validate(schema, DEEP, rules).length).toBeGreaterThan(0);
    expect(validate(schema, SHALLOW, rules)).toHaveLength(0);
  });

  it('guarded validate appends depth rules to the spec rules (the SSE shape)', () => {
    const guarded = buildGuardedValidate(config);
    const errors = guarded(schema, DEEP);
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0].message)).toMatch(/exceeds maximum operation depth/i);
    expect(guarded(schema, SHALLOW)).toHaveLength(0);
    // Spec rules still active: unknown field is caught too.
    expect(guarded(schema, parse('{ nope }')).length).toBeGreaterThan(0);
  });

  it('a disabled limit yields no extra rules', () => {
    expect(buildValidationRules({ queryDepthLimit: 0, queryComplexityLimit: 0 })).toHaveLength(0);
  });
});

describe('depthLimitRule', () => {
  const depthSchema = buildSchema(`
    type Child { name: String, child: Child }
    type Query { root: Child, items: [Child] }
    type Mutation { touch: Child }
  `);
  const refused = (source: string, limit: number) => validate(depthSchema, parse(source), [depthLimitRule(limit)]).length > 0;

  // The lowest limit each document passes at, as graphql-depth-limit 1.1.0 answered them: refused below it, let through
  // from it on.
  it.each([
    ["leaf", "{ root { name } }", 1],
    ["deep", "{ root { child { child { name } } } }", 3],
    ["scalarOnly", "{ __typename }", 1],
    ["fragment", "query Q { ...F } fragment F on Query { root { child { name } } }", 2],
    ["fragmentInField", "{ root { ...C } } fragment C on Child { child { child { name } } }", 3],
    ["inline", "{ root { ... on Child { child { name } } } }", 2],
    ["introspection", "{ __schema { types { fields { type { name } } } } }", 1],
    ["typenameMixed", "{ __typename root { child { name } } }", 2],
    ["twoOps", "query A { root { name } } query B { root { child { child { child { name } } } } }", 4],
    ["mutation", "mutation { touch { child { child { name } } } }", 3],
    ["chain", "{ root { ...A } } fragment A on Child { child { ...B } } fragment B on Child { child { name } }", 3],
    ["wide", "{ root { name child { name } } items { child { child { name } } } }", 3],
  ])('answers %s as graphql-depth-limit did', (_label, source, lowestPassing) => {
    for (let limit = 1; limit <= 5; limit++) expect(refused(source, limit)).toBe(limit < lowestPassing);
  });

  it("names the operation and the limit, once per operation", () => {
    const errors = validate(depthSchema, parse('query Deep { root { child { child { name } } } }'), [depthLimitRule(1)]);
    expect(errors.map((error) => error.message)).toEqual(["'Deep' exceeds maximum operation depth of 1"]);
  });

  // Each fragment spreads the next one twice: graphql-depth-limit expanded 2^30 spreads here.
  const fanOut = (levels: number, last: string) =>
    `{ ...F0 } ${Array.from({ length: levels }, (_, i) => `fragment F${i} on Query { ...F${i + 1} ...F${i + 1} }`).join(' ')} ` +
    `fragment F${levels} on Query { ${last} }`;

  it('measures a fragment once, however often it is spread', () => {
    const started = Date.now();
    expect(refused(fanOut(30, 'root { name }'), 10)).toBe(false);
    expect(refused(fanOut(30, 'root { child { child { name } } }'), 2)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  // graphql's validate stops at 100 errors by throwing; it catches that only while it visits the document.
  it('reports from the visit, so the error cap ends validation with errors rather than a throw', () => {
    const many = Array.from({ length: 150 }, (_, i) => `query q${i} { root { child { name } } }`).join(' ');
    let errors: readonly GraphQLError[] = [];
    expect(() => (errors = validate(depthSchema, parse(many), [depthLimitRule(1)]))).not.toThrow();
    expect(errors.length).toBe(101);
    expect(errors[100].message).toMatch(/Too many validation errors/);
  });

  it('measures a fragment cycle and an unknown fragment as 0, and leaves them to the specified rules', () => {
    expect(refused('{ ...A } fragment A on Query { ...B } fragment B on Query { ...A root { name } }', 1)).toBe(false);
    expect(refused('{ root { ...Missing } }', 1)).toBe(false);
  });
});

describe('assertComplexityWithinLimit', () => {
  it('throws over the limit, naming both numbers', () => {
    expect(() =>
      assertComplexityWithinLimit({
        schema,
        document: parse('{ root { name child { name } } }'), // complexity 4
        limit: 3,
      }),
    ).toThrow('Query too complex: 4. Maximum allowed: 3');
  });

  it('is refused as BAD_USER_INPUT, HTTP 400', () => {
    try {
      assertComplexityWithinLimit({ schema, document: parse('{ root { name child { name } } }'), limit: 3 });
      throw new Error('not refused');
    } catch (error) {
      expect(error).toBeInstanceOf(GraphQLError);
      expect((error as GraphQLError).extensions).toEqual({ code: 'BAD_USER_INPUT', http: { status: 400 } });
    }
  });

  it('passes under the limit and no-ops when disabled', () => {
    const document = parse('{ root { name } }');
    expect(() =>
      assertComplexityWithinLimit({ schema, document, limit: 10 }),
    ).not.toThrow();
    expect(() =>
      assertComplexityWithinLimit({ schema, document, limit: 0 }),
    ).not.toThrow();
  });

  it('exactly-at-limit passes (the gate is strictly greater-than)', () => {
    expect(() =>
      assertComplexityWithinLimit({
        schema,
        document: parse('{ root { name } }'), // complexity 2
        limit: 2,
      }),
    ).not.toThrow();
  });
});
