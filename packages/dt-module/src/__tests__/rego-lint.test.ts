/**
 * The package-time Rego lint.
 *
 * Two of these tests exist because the checks they cover were BROKEN during planning and
 * passed everything: treating `contains` as a keyword hid the corpus's one real
 * `contains(a, b)` call, and a sloppy definition pattern registered every `count(` body
 * line as a "local function". A lint that cannot fail is worse than no lint.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { callSites, localFunctionNames, builtinInputSites, lintPolicySource } from '../rego-lint';
import { SUPPORTED_BUILTINS, UNSUPPORTED_BUILTINS } from '../rego-builtins';
import { builtinInputSites as harnessBuiltinInputSites } from '../../test/rego-parity/harness.mjs';

const OK_POLICY = `package t.ok

_def := {"name": "E", "type": "misconfiguration"}

exposures contains _def if {
    input.public == true
    count(input.ports) > 0
}
`;

const errorsOf = (source: string) => lintPolicySource(source).errors.map((e) => e.message).join('\n');

describe('lintPolicySource — clean policy', () => {
  it('reports nothing on a representative policy', () => {
    const { errors, warnings } = lintPolicySource(OK_POLICY);
    expect(errors).toEqual([]);
    // count(input.ports) is a warn-class site, and must be visible as one.
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('count');
  });
});

describe('lintPolicySource — length limits (the engine lexer bounds)', () => {
  it('rejects a line over 8192 columns and accepts one over the old 1024 default', () => {
    const long = (n: number) => `package t\n\nx := "${'a'.repeat(n)}"\n`;
    expect(errorsOf(long(8300))).toContain('8192');
    // 1025+ passing proves the lint uses the raised production bound, not Regorus's default.
    expect(lintPolicySource(long(1025)).errors).toEqual([]);
  });
});

describe('lintPolicySource — structural errors', () => {
  it('rejects a policy that declares no package', () => {
    expect(errorsOf('exposures contains {"name": "E"} if {\n    input.x == true\n}\n')).toContain('no package');
  });

  it('rejects the isolation violations, same wording as the load-time guard', () => {
    expect(errorsOf('package t\nimport data.other\nx := 1\n')).toContain('import');
    expect(errorsOf('package t\n\nx := data.other.helper\n')).toContain('foreign package');
  });
});

describe('lintPolicySource — the builtin allowlist', () => {
  it('rejects a call to a builtin absent from the vendored blob', () => {
    expect(errorsOf('package t\n\nx := http.send({"url": "http://a"})\n')).toContain('absent from the vendored engine');
    expect(errorsOf('package t\n\nx := walk(input)\n')).toContain('absent from the vendored engine');
  });

  it('rejects a typo — unknown names fail at eval exactly like missing builtins', () => {
    const msg = errorsOf('package t\n\nx if { startswit(input.a, "b") }\n');
    expect(msg).toContain('startswit');
    expect(msg).toContain('not a supported builtin');
  });

  it('accepts a locally-defined function and rejects a misspelling of it', () => {
    const def = 'package t\n\nhelper(a) := a + 1\n';
    expect(lintPolicySource(`${def}\nx := helper(1)\n`).errors).toEqual([]);
    expect(errorsOf(`${def}\nx := helpr(1)\n`)).toContain('helpr');
  });
});

describe('the extractor traps (each hid real defects during planning)', () => {
  it('`contains(a, b)` is a builtin call, never skipped as the set-rule keyword', () => {
    // The corpus has exactly one such call; a keyword-skip made it invisible.
    const names = callSites('package t\n\nx if { contains(input.host, "*") }\n').map((s) => s.name);
    expect(names).toContain('contains');
    expect(SUPPORTED_BUILTINS.has('contains')).toBe(true);
    expect(lintPolicySource('package t\n\nx if { contains(input.host, "*") }\n').errors).toEqual([]);
  });

  it('a body line starting with `count(` is not mistaken for a function definition', () => {
    // The broken pattern registered `count` as a local for all 4746 corpus sites,
    // which would have allowlisted any name appearing at the start of a line.
    const source = 'package t\n\nx if {\ncount(input.list) == 0\n}\n';
    expect(localFunctionNames(source).has('count')).toBe(false);
    expect(lintPolicySource(source).errors).toEqual([]);
  });

  it('calls inside strings and comments are not calls', () => {
    const source = 'package t\n\n# http.send(x) in a comment\nx := "call http.send(y) in a string"\n';
    expect(callSites(source)).toEqual([]);
    expect(lintPolicySource(source).errors).toEqual([]);
  });

  it('`not (…)` and other keywords followed by parens are not calls', () => {
    expect(callSites('package t\n\nx if { not (input.a == input.b) }\n')).toEqual([]);
  });
});

describe('partition drift guard — the frozen 81/124 must match the actual blob', () => {
  it('re-probing every candidate reproduces the generated partition exactly', () => {
    // A rebuilt blob with a different feature set must fail HERE, not in production.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Engine } = require('@dethernety/regorus-wasm');
    const misclassified: string[] = [];
    for (const name of [...SUPPORTED_BUILTINS, ...UNSUPPORTED_BUILTINS]) {
      const engine = new Engine();
      engine.setPolicyLengthConfig({ maxCol: 8192, maxFileBytes: 4 * 1024 * 1024, maxLines: 100_000 });
      let missing = false;
      try {
        const pkg = engine.addPolicy('probe.rego', `package probe\n\nx := ${name}()\n`);
        engine.setInputJson('{}');
        engine.evalQuery(`${pkg}.x`);
      } catch (err) {
        missing = String((err as Error)?.message ?? err).includes('could not find function');
      } finally {
        engine.free();
      }
      if (missing !== UNSUPPORTED_BUILTINS.has(name)) misclassified.push(name);
    }
    expect(misclassified).toEqual([]);
    expect(SUPPORTED_BUILTINS.size + UNSUPPORTED_BUILTINS.size).toBe(205);
  });
});

/**
 * Corpus roots for the whole-corpus assertions below. The repo's own `modules/` is
 * always covered; additional trees are injected by environment, mirroring the parity
 * gate's posture — nothing under this package may name a path outside it:
 *
 *   REGO_LINT_TEST_EXTRA_ROOTS      comma-separated dirs (resolved from cwd) to scan too
 *   REGO_LINT_TEST_NONGATING_ROOTS  subset of those whose warnings are characterised,
 *                                   not asserted to be zero
 */
function corpusPolicies(): { policy: string; gating: boolean }[] {
  const fromEnv = (name: string) =>
    (process.env[name] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => path.resolve(entry));
  const roots = [path.join(__dirname, '..', '..', '..', '..', 'modules'), ...fromEnv('REGO_LINT_TEST_EXTRA_ROOTS')];
  const nonGating = fromEnv('REGO_LINT_TEST_NONGATING_ROOTS');

  const policies: { policy: string; gating: boolean }[] = [];
  const walk = (dir: string, gating: boolean) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, gating && !nonGating.some((n) => full.startsWith(n + path.sep) || full === n));
      else if (entry.name === 'policies.rego') policies.push({ policy: full, gating });
    }
  };
  for (const root of roots.filter((r) => fs.existsSync(r))) {
    walk(root, !nonGating.some((n) => root.startsWith(n + path.sep) || root === n));
  }
  return policies;
}

describe('agreement with the parity gate census', () => {
  it('builtinInputSites matches the harness site-for-site over every reachable policy', () => {
    const policies = corpusPolicies();
    expect(policies.length).toBeGreaterThan(70);

    let sites = 0;
    for (const { policy } of policies) {
      const source = fs.readFileSync(policy, 'utf8');
      const mine = builtinInputSites(source);
      const harness = harnessBuiltinInputSites(source);
      expect({ policy, sites: mine }).toEqual({ policy, sites: harness });
      sites += mine.length;
    }
    // With extra roots injected the census has real positives to agree on; agreement
    // proven only over empty outputs would be vacuous.
    if (process.env.REGO_LINT_TEST_NONGATING_ROOTS) expect(sites).toBeGreaterThan(100);
  });
});

describe('the corpus itself', () => {
  it('every reachable policy lints clean, and gating policies carry zero warnings', () => {
    const errorPolicies: string[] = [];
    let gatingWarnings = 0;
    for (const { policy, gating } of corpusPolicies()) {
      const { errors, warnings } = lintPolicySource(fs.readFileSync(policy, 'utf8'));
      if (errors.length > 0) errorPolicies.push(`${policy}: ${errors[0].message}`);
      if (gating) gatingWarnings += warnings.length;
    }
    expect(errorPolicies).toEqual([]);
    // Zero everywhere in the gating corpus — any new count/regex.match-on-input site
    // shows up here before it can reach a build.
    expect(gatingWarnings).toBe(0);
  });
});
