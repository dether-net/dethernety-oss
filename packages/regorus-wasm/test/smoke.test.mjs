/**
 * Smoke suite for the vendored Regorus WASM binding.
 *
 * These are not "does wasm work" tests. Each one pins a behaviour that
 * `RegoEngine` (in @dethernety/dt-module) depends on. If one of these breaks
 * after a Regorus bump, RegoEngine's contract is no longer sound.
 *
 * Fixtures are inline on purpose: this package is OSS and must not depend on
 * any module's policy data.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Load the CJS glue natively so its internal __dirname resolves to this
// package directory, where regorusjs_bg.wasm physically sits.
const require = createRequire(import.meta.url);
const regorus = require('../regorusjs.js');
const { Engine } = regorus;

/** Matches what RegoEngine will use. All three fields are required, camelCase, NonZero. */
const LENGTH_CONFIG = { maxCol: 8192, maxFileBytes: 4 * 1024 * 1024, maxLines: 100_000 };

/** Evaluate a rule ref the way RegoEngine will: evalQuery + unwrap. */
function evalRuleViaQuery(rego, ruleRef, input, cfg = LENGTH_CONFIG) {
  const engine = new Engine();
  if (cfg) engine.setPolicyLengthConfig(cfg);
  engine.addPolicy('policy.rego', rego);
  engine.setInputJson(JSON.stringify(input));
  const { result } = JSON.parse(engine.evalQuery(ruleRef));
  return result?.[0]?.expressions?.[0]?.value;
}

const SIMPLE = `package p

_a := {"name": "A"}
_c := {"name": "C"}
s contains _a if { input.x == true }
s contains _c if { input.z == true }
`;

describe('binding shape', () => {
  it('exports Engine from CommonJS', () => {
    expect(typeof Engine).toBe('function');
  });

  it('loads the wasm synchronously (no await, no dynamic import)', () => {
    // If loading were async, RegoEngine.evaluate() could not be synchronous+atomic,
    // and concurrent analyses could interleave set_input/eval.
    const glue = require('node:fs').readFileSync(
      new URL('../regorusjs.js', import.meta.url),
      'utf8',
    );
    expect(glue).toContain('new WebAssembly.Module');
    expect(glue).toContain('new WebAssembly.Instance');
    expect(glue).toContain('readFileSync');
  });
});

describe('rego dialect', () => {
  it('parses Rego v1 syntax (contains/if) with no setRegoV0 call', () => {
    const engine = new Engine();
    expect(engine.addPolicy('policy.rego', SIMPLE)).toBe('data.p');
  });

  it('addPolicy returns the package path (so callers need not regex the source)', () => {
    const engine = new Engine();
    expect(engine.addPolicy('policy.rego', 'package a.b.c\n')).toBe('data.a.b.c');
  });
});

describe('undefined-rule tolerance — why RegoEngine uses evalQuery, not evalRule', () => {
  it('evalQuery on a non-existent rule does NOT throw', () => {
    // Control policies define only `countermeasures`. Querying them for
    // `exposures` must yield "no findings", not an error.
    expect(() => evalRuleViaQuery(SIMPLE, 'data.p.missing', {})).not.toThrow();
    expect(evalRuleViaQuery(SIMPLE, 'data.p.missing', {})).toBeUndefined();
  });

  it('evalRule on a non-existent rule DOES throw (hence it is unusable for us)', () => {
    const engine = new Engine();
    engine.addPolicy('policy.rego', SIMPLE);
    engine.setInputJson('{}');
    expect(() => engine.evalRule('data.p.missing')).toThrow(/not a valid rule path/i);
  });
});

describe('fail-loud: an engine error is not "no findings"', () => {
  const HALT = `package p
s contains "A" if { input.x == true }
s contains "B" if { count(input.y) == 0 }
s contains "C" if { input.z == true }
`;

  it('halts the whole rule when one clause type-errors (it does not return survivors)', () => {
    // OPA would emit ["A","C"] and silently drop clause B. Regorus aborts the
    // query. Mapping this to [] would silently zero a component's exposures.
    expect(() => evalRuleViaQuery(HALT, 'data.p.s', { x: true, y: false, z: true })).toThrow(
      /count.*requires.*argument/i,
    );
  });

  it('still evaluates normally when no clause errors', () => {
    expect(evalRuleViaQuery(HALT, 'data.p.s', { x: true, y: [], z: true }).sort()).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});

describe('policy length config', () => {
  const longLine = `package q
_d := {"name": "L", "description": "${'x'.repeat(1200)}"}
s contains _d if { input.a == true }
`;

  it('rejects a >1024-column line at the default limit', () => {
    const engine = new Engine();
    expect(() => engine.addPolicy('q.rego', longLine)).toThrow(/maximum column width of 1024/);
  });

  it('accepts it once maxCol is raised', () => {
    expect(evalRuleViaQuery(longLine, 'data.q.s', { a: true })[0].name).toBe('L');
  });

  it('requires all three camelCase fields', () => {
    expect(() => new Engine().setPolicyLengthConfig({ maxCol: 8192 })).toThrow(/maxFileBytes/);
    expect(() => new Engine().setPolicyLengthConfig({ max_col: 8192 })).toThrow(/maxCol/);
  });

  it('enforces NonZero', () => {
    expect(() =>
      new Engine().setPolicyLengthConfig({ maxCol: 0, maxFileBytes: 1, maxLines: 1 }),
    ).toThrow();
  });
});

describe('trimmed feature set', () => {
  it('retains regex.match', () => {
    const rego = 'package r\nm if { regex.match("^ab+c$", input.s) }\n';
    expect(evalRuleViaQuery(rego, 'data.r.m', { s: 'abbbc' })).toBe(true);
  });

  it('does NOT expose http.send — a policy cannot make a network call', () => {
    const rego = 'package h\nx := http.send({"method": "get", "url": "http://example.com"})\n';
    expect(() => evalRuleViaQuery(rego, 'data.h.x', {})).toThrow(/could not find function http.send/);
  });
});

describe('golden semantics + field fidelity', () => {
  // Mirrors the shape dt-file-opa-module maps: name/score/attack_vector/exploited_by.
  const GOLDEN = `package golden
_tls := {"name": "Cleartext transport", "score": 7.5, "attack_vector": "NETWORK", "exploited_by": [{"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1040", "attributes": {"justification": "sniffing"}}]}
_auth := {"name": "Missing authentication", "score": 9.1, "attack_vector": "NETWORK", "exploited_by": []}
_log := {"name": "No audit logging", "score": 5.3, "attack_vector": "LOCAL", "exploited_by": []}
tls[_tls] if { input.tls_enabled == false }
auth[_auth] if { not input.auth_required }
lg[_log] if { not input.audit_logging_enabled }
exposures contains _tls if { count(tls) > 0 }
exposures contains _auth if { count(auth) > 0 }
exposures contains _log if { count(lg) > 0 }
`;
  const names = (input) =>
    (evalRuleViaQuery(GOLDEN, 'data.golden.exposures', input) ?? []).map((e) => e.name).sort();

  it('all-insecure fires every exposure', () => {
    expect(names({ tls_enabled: false })).toEqual([
      'Cleartext transport',
      'Missing authentication',
      'No audit logging',
    ]);
  });

  it('all-secure fires none', () => {
    expect(names({ tls_enabled: true, auth_required: true, audit_logging_enabled: true })).toEqual(
      [],
    );
  });

  it('empty input fires the `not`-guarded rules', () => {
    expect(names({})).toEqual(['Missing authentication', 'No audit logging']);
  });

  it('preserves score, attack_vector and nested exploited_by justifications', () => {
    const objs = evalRuleViaQuery(GOLDEN, 'data.golden.exposures', { tls_enabled: false });
    const tls = objs.find((e) => e.name === 'Cleartext transport');
    expect(tls.score).toBe(7.5);
    expect(tls.attack_vector).toBe('NETWORK');
    expect(tls.exploited_by[0].attributes.justification).toBe('sniffing');
  });
});
