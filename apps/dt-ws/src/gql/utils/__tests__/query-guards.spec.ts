import { buildSchema, parse, validate } from 'graphql';
import {
  assertComplexityWithinLimit,
  buildGuardedValidate,
  buildValidationRules,
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
