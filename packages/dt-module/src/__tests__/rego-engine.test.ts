import { Engine } from '@dethernety/regorus-wasm';
import { describe, expect, it } from 'vitest';

import {
  POLICY_LENGTH_CONFIG,
  RegoEngine,
  RegoEvalError,
  RegoPolicyError,
  extractPackage,
  isolationViolations,
  stripNonCode,
} from '../rego-engine';

/**
 * These tests exist to stop a refactor quietly reintroducing a fail-open. Every case where
 * the engine could return `[]` instead of raising is asserted explicitly, because an empty
 * result is indistinguishable from "this element is secure".
 */

const EXPOSURES = `package fixture.exposures.thing

exposures contains finding if {
	input.public == true
	finding := {"name": "publicly reachable", "score": 7.5}
}
`;

const COUNTERMEASURES = `package fixture.countermeasures.thing

countermeasures contains finding if {
	input.encrypted == true
	finding := {"name": "encryption at rest"}
}
`;

const TYPE_ERROR = `package fixture.typeerror

exposures contains finding if {
	count(input.items) == 0
	finding := {"name": "unreachable"}
}
`;

const longLine = (columns: number) => `package fixture.longline

exposures contains finding if {
	description := "${'x'.repeat(columns)}"
	finding := {"name": description}
}
`;

const register = (source: string, key = 'k') => {
  const engine = new RegoEngine();
  engine.register(key, source);
  return engine;
};

describe('stripNonCode', () => {
  it('does not treat # inside a string as a comment', () => {
    expect(stripNonCode('a := "x # y"\nb := 1').split('\n')[1]).toBe('b := 1');
    expect(stripNonCode('a := "x # y"')).not.toContain('y');
  });

  it('does not treat a quote inside a comment as a string', () => {
    expect(stripNonCode('# he said "hi\nreal := 1')).toContain('real := 1');
  });

  it('blanks raw backtick strings', () => {
    expect(stripNonCode('a := `data.foo`')).not.toContain('data.foo');
  });

  it('preserves line structure so line numbers survive', () => {
    const source = 'one\n# two\n"three"\nfour';
    expect(stripNonCode(source).split('\n')).toHaveLength(4);
  });
});

describe('extractPackage', () => {
  it('reads the package name', () => {
    expect(extractPackage(EXPOSURES)).toBe('fixture.exposures.thing');
  });

  it('ignores a package keyword inside a string', () => {
    expect(extractPackage('x := "package not.real"\n')).toBeUndefined();
  });
});

describe('isolation guard', () => {
  const cases: Array<[string, string]> = [
    ['import data.helpers\n', 'imports another package'],
    ['x := true with data.foo as 1\n', 'overrides the data document'],
    ['x := count(data)\n', 'references the whole data document'],
    ['x := data.other.helper\n', 'references a foreign package'],
  ];

  it.each(cases)('rejects %s', (snippet, reason) => {
    const source = `package own.pkg\n\n${snippet}`;
    expect(isolationViolations(source, 'own.pkg').join('; ')).toContain(reason);
  });

  it('allows a reference to the policy\'s own package', () => {
    const source = 'package own.pkg\n\nhelper := 1\n\nx := data.own.pkg.helper\n';
    expect(isolationViolations(source, 'own.pkg')).toEqual([]);
  });

  it('is not fooled by `data` appearing inside a string or as a field name', () => {
    const source = 'package own.pkg\n\nx := input.data\n\ny := "see data.other.thing"\n';
    expect(isolationViolations(source, 'own.pkg')).toEqual([]);
  });

  it('throws at register, rather than letting the policy under-report at eval time', () => {
    const foreign = `package own.pkg

exposures contains finding if {
	data.shared.helpers.risky
	finding := {"name": "cross-package"}
}
`;
    expect(() => register(foreign)).toThrow(RegoPolicyError);
    expect(() => register(foreign)).toThrow(/not self-contained/);
  });

  it('WITHOUT the guard the same policy silently returns [] — this is what the guard prevents', () => {
    // Drives the raw binding directly, bypassing RegoEngine, to demonstrate the fail-open.
    const raw = new Engine();
    raw.setPolicyLengthConfig({ ...POLICY_LENGTH_CONFIG });
    raw.addPolicy(
      'p.rego',
      'package own.pkg\n\nexposures contains f if {\n\tdata.shared.helpers.risky\n\tf := {"name": "x"}\n}\n',
    );
    raw.setInputJson('{}');
    const value = JSON.parse(raw.evalQuery('data.own.pkg.exposures')).result?.[0]?.expressions?.[0]?.value;
    expect(value).toEqual([]); // no error, no finding — undetectable at runtime
    raw.free();
  });
});

describe('register', () => {
  it('returns the package path', () => {
    expect(new RegoEngine().register('k', EXPOSURES)).toBe('data.fixture.exposures.thing');
  });

  it('throws on a policy with no package declaration', () => {
    expect(() => register('x := 1\n')).toThrow(RegoPolicyError);
  });

  it('throws on a parse error, loudly, at registration time', () => {
    expect(() => register('package p\n\nthis is not rego\n')).toThrow(RegoPolicyError);
  });

  it('throws on an empty key', () => {
    expect(() => new RegoEngine().register('', EXPOSURES)).toThrow(RegoPolicyError);
  });

  it('parses a 1025-column line — proving maxCol was actually raised above the 1024 default', () => {
    expect(() => register(longLine(1025))).not.toThrow();
  });

  it('rejects a line beyond the configured maxCol of 8192', () => {
    expect(() => register(longLine(8300))).toThrow(RegoPolicyError);
  });

  it('rejects a package already claimed by a different key', () => {
    const engine = new RegoEngine();
    engine.register('a', EXPOSURES);
    expect(() => engine.register('b', EXPOSURES)).toThrow(/already registered by "a"/);
  });

  it('is idempotent for the same key and identical source', () => {
    const engine = new RegoEngine();
    const first = engine.register('k', EXPOSURES);
    const second = engine.register('k', EXPOSURES);
    expect(second).toBe(first);
    expect(engine.size).toBe(1);
    expect(engine.evaluate('k', 'exposures', { public: true })).toHaveLength(1);
  });

  it('replaces the engine when the same key is registered with changed source', () => {
    const engine = new RegoEngine();
    engine.register('k', EXPOSURES);
    const changed = EXPOSURES.replace('publicly reachable', 'renamed finding');
    engine.register('k', changed);
    expect(engine.size).toBe(1);
    const findings = engine.evaluate<{ name: string }>('k', 'exposures', { public: true });
    expect(findings.map((f) => f.name)).toEqual(['renamed finding']);
  });

  it('leaves the registry intact when a replacement policy is rejected', () => {
    const engine = new RegoEngine();
    engine.register('k', EXPOSURES);
    expect(() => engine.register('k', 'package fixture.exposures.thing\n\nbroken rego here\n')).toThrow();
    expect(engine.evaluate('k', 'exposures', { public: true })).toHaveLength(1);
  });
});

describe('evaluate — fail-loud contract', () => {
  it('returns the matching findings, unfiltered', () => {
    const engine = register(EXPOSURES);
    expect(engine.evaluate('k', 'exposures', { public: true })).toEqual([
      { name: 'publicly reachable', score: 7.5 },
    ]);
  });

  it('returns [] when no clause matches', () => {
    expect(register(EXPOSURES).evaluate('k', 'exposures', { public: false })).toEqual([]);
  });

  it('returns [] for a rule the policy does not define', () => {
    // A control class asked for `exposures` — no rule, so no findings, not an error.
    expect(register(COUNTERMEASURES).evaluate('k', 'exposures', {})).toEqual([]);
  });

  it('throws — never returns [] — when a clause type-errors', () => {
    const engine = register(TYPE_ERROR);
    expect(() => engine.evaluate('k', 'exposures', { items: false })).toThrow(RegoEvalError);
    expect(() => engine.evaluate('k', 'exposures', { items: false })).toThrow(/count/);
  });

  it('tolerates a missing input key (undefined, not an error)', () => {
    expect(register(TYPE_ERROR).evaluate('k', 'exposures', {})).toEqual([]);
  });

  it('throws on an unregistered key rather than failing open to []', () => {
    expect(() => register(EXPOSURES).evaluate('typo', 'exposures', {})).toThrow(RegoEvalError);
    expect(() => register(EXPOSURES).evaluate('typo', 'exposures', {})).toThrow(/no policy registered/);
  });

  it.each(['exposures; 1 == 1', 'exposures with input as {}', 'a.b', 'a b', '1abc', '', 'ex-posures'])(
    'rejects the rule name %j, which is interpolated into a Rego expression',
    (rule) => {
      expect(() => register(EXPOSURES).evaluate('k', rule, {})).toThrow(RegoEvalError);
    },
  );

  it('throws when a rule evaluates to a non-array', () => {
    const engine = register('package p\n\nexposures := {"name": "solo"}\n');
    expect(() => engine.evaluate('k', 'exposures', {})).toThrow(/expected an array/);
  });

  it('throws when a rule evaluates to null', () => {
    const engine = register('package p\n\nexposures := null\n');
    expect(() => engine.evaluate('k', 'exposures', {})).toThrow(/null, expected an array/);
  });

  it('throws when the input cannot be serialised, rather than evaluating against nothing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => register(EXPOSURES).evaluate('k', 'exposures', circular)).toThrow(RegoEvalError);
    expect(() => register(EXPOSURES).evaluate('k', 'exposures', { n: 1n })).toThrow(RegoEvalError);
  });

  it('treats undefined input as an empty object', () => {
    expect(register(EXPOSURES).evaluate('k', 'exposures', undefined)).toEqual([]);
  });

  it('is unaffected by a previous throw — the engine is not poisoned', () => {
    const engine = new RegoEngine();
    engine.register('good', EXPOSURES);
    engine.register('bad', TYPE_ERROR);
    expect(() => engine.evaluate('bad', 'exposures', { items: false })).toThrow();
    expect(engine.evaluate('good', 'exposures', { public: true })).toHaveLength(1);
    expect(() => engine.evaluate('bad', 'exposures', { items: false })).toThrow();
    expect(engine.evaluate('good', 'exposures', { public: true })).toHaveLength(1);
  });

  it('holds no input state across calls', () => {
    const engine = register(EXPOSURES);
    expect(engine.evaluate('k', 'exposures', { public: true })).toHaveLength(1);
    expect(engine.evaluate('k', 'exposures', {})).toEqual([]);
    expect(engine.evaluate('k', 'exposures', { public: true })).toHaveLength(1);
  });
});

describe('lifecycle', () => {
  it('never lets an in-flight evaluation touch a freed engine', async () => {
    const engine = new RegoEngine();
    engine.register('a', EXPOSURES);
    engine.register('b', COUNTERMEASURES);

    // Mimics getExposures: it awaits the database, then evaluates. A concurrent reload
    // replaces both policies in between. `evaluate` resolves the engine at call time, so
    // it can never be holding a pointer that `register` has already freed.
    const inFlight = (async () => {
      await Promise.resolve();
      return engine.evaluate<{ name: string }>('b', 'countermeasures', { encrypted: true });
    })();

    engine.register('a', EXPOSURES.replace('publicly reachable', 'v2'));
    engine.register('b', COUNTERMEASURES.replace('encryption at rest', 'v2'));

    expect((await inFlight).map((f) => f.name)).toEqual(['v2']);
  });

  it('prune frees only the keys that are gone', () => {
    const engine = new RegoEngine();
    engine.register('keep', EXPOSURES);
    engine.register('drop', COUNTERMEASURES);
    expect(engine.prune(['keep'])).toBe(1);
    expect(engine.size).toBe(1);
    expect(engine.has('drop')).toBe(false);
    expect(engine.evaluate('keep', 'exposures', { public: true })).toHaveLength(1);
  });

  it('frees the package name too, so a pruned key\'s package can be re-registered', () => {
    const engine = new RegoEngine();
    engine.register('old', EXPOSURES);
    engine.prune([]);
    expect(() => engine.register('new', EXPOSURES)).not.toThrow();
  });

  it('reports a clear error after dispose, not a raw wasm null-pointer panic', () => {
    const engine = register(EXPOSURES);
    engine.dispose();
    expect(() => engine.evaluate('k', 'exposures', {})).toThrow(RegoEvalError);
    expect(() => engine.evaluate('k', 'exposures', {})).toThrow(/disposed/);
    expect(() => engine.evaluate('k', 'exposures', {})).not.toThrow(/null pointer/);
    expect(() => engine.register('k2', COUNTERMEASURES)).toThrow(RegoPolicyError);
  });

  it('dispose is idempotent', () => {
    const engine = register(EXPOSURES);
    engine.dispose();
    expect(() => engine.dispose()).not.toThrow();
  });
});

describe('keyFor', () => {
  it('normalises separators so both call sites derive the identical key', () => {
    expect(RegoEngine.keyFor('mod/component/thing')).toBe('mod/component/thing');
    expect(RegoEngine.keyFor('mod\\component\\thing')).toBe('mod/component/thing');
    expect(RegoEngine.keyFor('/mod//component/thing/')).toBe('mod/component/thing');
  });

  it('round-trips: a key derived from either side addresses the same policy', () => {
    const engine = new RegoEngine();
    engine.register(RegoEngine.keyFor('mod/component/thing/'), EXPOSURES);
    expect(engine.evaluate(RegoEngine.keyFor('mod\\component\\thing'), 'exposures', { public: true })).toHaveLength(1);
  });

  it('rejects an empty path', () => {
    expect(() => RegoEngine.keyFor('')).toThrow(RegoPolicyError);
    expect(() => RegoEngine.keyFor('///')).toThrow(RegoPolicyError);
  });
});
