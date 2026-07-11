import { describe, expect, it } from 'vitest';

import { checkRegoSource, evaluateRegoAdHoc } from '../rego-adhoc';

const CLEAN_POLICY = `package a.b

exposures contains x if {
  input.enabled == true
  x := {"name": "open_port", "score": 7}
}
`;

/** Every result must satisfy: findings === null ⟺ errors !== null. */
function assertShape(result: { findings: unknown[] | null; errors: string[] | null }) {
  if (result.findings === null) {
    expect(result.errors).not.toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  } else {
    expect(result.errors).toBeNull();
  }
}

describe('checkRegoSource', () => {
  it('accepts a clean policy', () => {
    const result = checkRegoSource(CLEAN_POLICY);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports a syntax error with the position token from the real engine', () => {
    const result = checkRegoSource('package a.b\n\nx := {');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('error:') && /adhoc\.rego:\d+:\d+/.test(e))).toBe(true);
  });

  it('reports a call to a builtin absent from the vendored engine, with a line number', () => {
    const policy = `package a.b\n\nexposures contains x if {\n  r := http.send({"url": "http://x"})\n  x := r\n}\n`;
    const result = checkRegoSource(policy);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('http.send') && e.startsWith('line 4:'))).toBe(true);
  });

  it('reports an unknown function name as an error', () => {
    const policy = `package a.b\n\nexposures contains x if {\n  x := totally_made_up(input.y)\n}\n`;
    const result = checkRegoSource(policy);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('totally_made_up'))).toBe(true);
  });

  it('reports a foreign data reference as an isolation error', () => {
    const policy = `package a.b\n\nexposures contains x if {\n  x := data.other.thing\n}\n`;
    const result = checkRegoSource(policy);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('foreign package'))).toBe(true);
  });

  it('reports a missing package declaration', () => {
    const result = checkRegoSource('x := 1\n');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('no package'))).toBe(true);
  });

  it('reports count-on-input as a warning, not an error', () => {
    const policy = `package a.b\n\nexposures contains x if {\n  count(input.items) > 0\n  x := {"name": "n"}\n}\n`;
    const result = checkRegoSource(policy);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('count'))).toBe(true);
  });

  it('rejects a line beyond the engine lexer limit', () => {
    const policy = `package a.b\n# ${'y'.repeat(9000)}\n`;
    const result = checkRegoSource(policy);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('columns'))).toBe(true);
  });
});

describe('evaluateRegoAdHoc', () => {
  it('returns the fired findings with their fields intact', () => {
    const result = evaluateRegoAdHoc(CLEAN_POLICY, 'exposures', { enabled: true });
    assertShape(result);
    expect(result.findings).toEqual([{ name: 'open_port', score: 7 }]);
  });

  it('serves a rule with a custom name — nothing pins the corpus convention', () => {
    const policy = `package a.b\n\nmatches contains x if {\n  input.k == 1\n  x := {"name": "hit"}\n}\n`;
    const result = evaluateRegoAdHoc(policy, 'matches', { k: 1 });
    assertShape(result);
    expect(result.findings).toEqual([{ name: 'hit' }]);
  });

  it('returns [] when no clause matches', () => {
    const result = evaluateRegoAdHoc(CLEAN_POLICY, 'exposures', { enabled: false });
    assertShape(result);
    expect(result.findings).toEqual([]);
  });

  it('returns [] for a rule the policy does not define', () => {
    const result = evaluateRegoAdHoc(CLEAN_POLICY, 'countermeasures', { enabled: true });
    assertShape(result);
    expect(result.findings).toEqual([]);
  });

  it('contains an invalid rule name instead of interpolating it into a query', () => {
    for (const rule of ['foo.bar', 'x;drop', '', '1x']) {
      const result = evaluateRegoAdHoc(CLEAN_POLICY, rule, {});
      assertShape(result);
      expect(result.errors![0]).toContain('invalid rule name');
    }
  });

  it('contains a parse error — never throws', () => {
    const result = evaluateRegoAdHoc('package a.b\n\nx := {', 'exposures', {});
    assertShape(result);
    expect(result.errors!.some((e) => e.includes('error:') && /adhoc\.rego:\d+:\d+/.test(e))).toBe(true);
  });

  it('contains an empty-string policy', () => {
    const result = evaluateRegoAdHoc('', 'exposures', {});
    assertShape(result);
    expect(result.findings).toBeNull();
  });

  it('contains a comments-only policy', () => {
    const result = evaluateRegoAdHoc('# just a comment\n', 'exposures', {});
    assertShape(result);
    expect(result.findings).toBeNull();
  });

  it('contains a source with two package declarations', () => {
    const result = evaluateRegoAdHoc('package a.b\n\npackage c.d\n', 'exposures', {});
    assertShape(result);
    expect(result.findings).toBeNull();
  });

  it('contains an evaluation type error — never degrades it to []', () => {
    const policy = `package a.b\n\nexposures contains x if {\n  count(input.items) > 0\n  x := {"name": "n"}\n}\n`;
    const result = evaluateRegoAdHoc(policy, 'exposures', { items: 42 });
    assertShape(result);
    expect(result.findings).toBeNull();
    expect(result.errors![0]).toContain('count');
  });

  it('rejects a foreign-data policy rather than false-passing with []', () => {
    const policy = `package a.b\n\nexposures contains x if {\n  x := data.other.thing\n}\n`;
    const result = evaluateRegoAdHoc(policy, 'exposures', {});
    assertShape(result);
    expect(result.findings).toBeNull();
    expect(result.errors![0]).toContain('not self-contained');
  });

  it('contains a non-serialisable input', () => {
    const result = evaluateRegoAdHoc(CLEAN_POLICY, 'exposures', { big: 1n });
    assertShape(result);
    expect(result.findings).toBeNull();
  });

  it('treats undefined input as an empty object', () => {
    const result = evaluateRegoAdHoc(CLEAN_POLICY, 'exposures', undefined);
    assertShape(result);
    expect(result.findings).toEqual([]);
  });

  it('contains a rule that evaluates to a non-array', () => {
    const policy = `package a.b\n\ntotal := 5\n`;
    const result = evaluateRegoAdHoc(policy, 'total', {});
    assertShape(result);
    expect(result.errors![0]).toContain('expected an array');
  });

  it('is not poisoned by a previous failure', () => {
    evaluateRegoAdHoc('package a.b\n\nx := {', 'exposures', {});
    const result = evaluateRegoAdHoc(CLEAN_POLICY, 'exposures', { enabled: true });
    expect(result.findings).toEqual([{ name: 'open_port', score: 7 }]);
  });
});

describe('free() discipline', () => {
  it(
    'holds RSS flat across 10k evaluations and 500 checks — the throwaway engines really are freed',
    { timeout: 120_000 },
    () => {
      const policyFor = (i: number) =>
        `package a.b\n\n# distinct-${i}-${'pad'.repeat(20)}\nexposures contains x if {\n  input.enabled == true\n  x := {"name": "n${i}"}\n}\n`;

      // Warm-up: the first eval grows WASM linear-memory pages; baseline after it.
      evaluateRegoAdHoc(policyFor(-1), 'exposures', { enabled: true });
      const baseline = process.memoryUsage().rss;

      for (let i = 0; i < 10_000; i++) {
        const result = evaluateRegoAdHoc(policyFor(i), 'exposures', { enabled: true });
        if (result.findings === null) throw new Error(`iteration ${i}: ${result.errors}`);
      }
      for (let i = 0; i < 500; i++) {
        checkRegoSource(i % 2 === 0 ? policyFor(i) : 'package a.b\n\nx := {');
      }

      const growth = process.memoryUsage().rss - baseline;
      // A leak is unambiguous here: the WASM heap is never reclaimed by GC, so 10.5k
      // leaked engines would dwarf this bound rather than brush against it.
      expect(growth).toBeLessThan(150 * 1024 * 1024);
    },
  );
});
