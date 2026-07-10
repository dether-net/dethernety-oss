/**
 * Contract tests for the Rego parity harness.
 *
 * Runs in the default `pnpm --filter @dethernety/dt-module test` suite: no `opa`
 * binary, no module corpus, inline fixtures only. The corpus gate itself lives in
 * `run.mjs` and is invoked by CI.
 *
 * What it pins down is the comparison logic — because a harness that canonicalises
 * too aggressively, or that scores a Regorus throw as agreement, would pass the whole
 * corpus while proving nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  OUTCOME,
  builtinInputSites,
  canonicalResult,
  canonicalize,
  compareOutcomes,
  makeEngine,
  packageCollisions,
  regorusOutcome,
} from './harness.mjs';

const value = (v) => ({ kind: OUTCOME.VALUE, value: v });
const undef = () => ({ kind: OUTCOME.UNDEFINED });
const error = () => ({ kind: OUTCOME.ERROR, message: 'boom' });
const threw = () => ({ kind: OUTCOME.THROW, message: 'boom' });

describe('canonicalisation', () => {
  it('sorts object keys recursively', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } }))).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves nested array order — exploited_by order is meaningful', () => {
    const left = canonicalResult([{ name: 'x', exploited_by: [{ id: 'T1' }, { id: 'T2' }] }]);
    const right = canonicalResult([{ name: 'x', exploited_by: [{ id: 'T2' }, { id: 'T1' }] }]);
    expect(JSON.stringify(left)).not.toBe(JSON.stringify(right));
  });

  it('sorts the top-level findings array — a Rego set is unordered', () => {
    const left = canonicalResult([{ name: 'b' }, { name: 'a' }]);
    const right = canonicalResult([{ name: 'a' }, { name: 'b' }]);
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it('compares as a multiset keyed by the whole finding, not by name', () => {
    const left = value([{ name: 'dup', score: 1 }, { name: 'dup', score: 2 }]);
    const right = value([{ name: 'dup', score: 1 }, { name: 'dup', score: 1 }]);
    expect(compareOutcomes(left, right).agree).toBe(false);
  });

  it('does not unicode-normalise — a Go/Rust encoding divergence must surface', () => {
    const composed = value([{ name: 'é' }]); // é
    const decomposed = value([{ name: 'é' }]); // e + combining acute
    expect(compareOutcomes(composed, decomposed).agree).toBe(false);
  });
});

describe('outcome matrix', () => {
  it('agrees when both engines return equal values', () => {
    expect(compareOutcomes(value([{ name: 'a' }]), value([{ name: 'a' }])).agree).toBe(true);
  });

  it('agrees when both are undefined', () => {
    expect(compareOutcomes(undef(), undef()).agree).toBe(true);
  });

  it('agrees when opa errors and regorus throws', () => {
    expect(compareOutcomes(error(), threw()).agree).toBe(true);
  });

  it('treats a regorus throw against an opa value as a divergence — the under-fire class', () => {
    const result = compareOutcomes(value([{ name: 'a' }]), threw());
    expect(result.agree).toBe(false);
    expect(result.reason).toBe('VALUE-vs-THROW');
  });

  it('never folds a regorus throw into an empty result', () => {
    expect(compareOutcomes(undef(), threw()).agree).toBe(false);
    expect(compareOutcomes(value([]), threw()).agree).toBe(false);
  });

  it('treats an opa error against a regorus value as a divergence', () => {
    expect(compareOutcomes(error(), value([])).agree).toBe(false);
    expect(compareOutcomes(error(), undef()).agree).toBe(false);
  });

  it('normalises undefined and empty-set to [] the way the mapper does, but flags the raw shape', () => {
    const result = compareOutcomes(undef(), value([]));
    expect(result.agree).toBe(true);
    expect(result.rawShape).toBe(true);
  });

  it('reports differing values as a deep-object divergence', () => {
    const result = compareOutcomes(value([{ name: 'a', score: 1 }]), value([{ name: 'a', score: 2 }]));
    expect(result.agree).toBe(false);
    expect(result.reason).toBe('deep-object');
  });
});

describe('fail-loud contract (committed WASM blob)', () => {
  const GOOD = `package fixture.good

exposures contains finding if {
	input.enabled == true
	finding := {"name": "ok"}
}
`;

  const TYPE_ERROR = `package fixture.typeerror

exposures contains finding if {
	count(input.items) == 0
	finding := {"name": "unreachable"}
}
`;

  const LONG_LINE = `package fixture.longline

exposures contains finding if {
	description := "${'x'.repeat(9000)}"
	finding := {"name": description}
}
`;

  it('evaluates a valid policy', () => {
    const outcome = regorusOutcome(makeEngine(GOOD), 'data.fixture.good.exposures', '{"enabled":true}');
    expect(outcome.kind).toBe(OUTCOME.VALUE);
    expect(outcome.value).toEqual([{ name: 'ok' }]);
  });

  it('throws — never returns [] — when count() gets a wrong-typed argument', () => {
    const outcome = regorusOutcome(makeEngine(TYPE_ERROR), 'data.fixture.typeerror.exposures', '{"items":false}');
    expect(outcome.kind).toBe(OUTCOME.THROW);
    expect(outcome.message).toMatch(/count/);
  });

  it('tolerates a missing input key — undefined, not an error', () => {
    const outcome = regorusOutcome(makeEngine(TYPE_ERROR), 'data.fixture.typeerror.exposures', '{}');
    expect(outcome.kind).not.toBe(OUTCOME.THROW);
  });

  it('returns [] for a rule the policy does not define, rather than throwing', () => {
    const outcome = regorusOutcome(makeEngine(GOOD), 'data.fixture.good.countermeasures', '{}');
    expect(outcome.kind).toBe(OUTCOME.UNDEFINED);
  });

  it('rejects a line beyond the production maxCol of 8192', () => {
    expect(() => makeEngine(LONG_LINE)).toThrow();
  });
});

describe('static census', () => {
  it('finds count(input.…) and regex.match(…, input.…) sites with their line numbers', () => {
    const source = `package fixture.sites

rule contains x if {
	count(input.items) == 0
	x := 1
}

other contains y if {
	regex.match("^a", input.name)
	y := 2
}

guarded contains z if {
	count(["a"]) == 1
	z := 3
}
`;
    expect(builtinInputSites(source)).toEqual([
      { line: 4, builtin: 'count' },
      { line: 9, builtin: 'regex.match' },
    ]);
  });

  it('reports a package declared by more than one module', () => {
    const collisions = packageCollisions([
      { pkg: 'a.b.shared', module: 'modules/one' },
      { pkg: 'a.b.shared', module: 'modules/two' },
      { pkg: 'a.b.unique', module: 'modules/one' },
    ]);
    expect(collisions).toEqual([{ package: 'a.b.shared', modules: ['modules/one', 'modules/two'] }]);
  });
});
