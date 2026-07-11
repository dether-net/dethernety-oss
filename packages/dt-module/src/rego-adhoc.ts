import { Engine } from '@dethernety/regorus-wasm';

import { POLICY_LENGTH_CONFIG, RULE_NAME, isolationViolations } from './rego-engine';
import { lintPolicySource } from './rego-lint';

/**
 * One-shot Rego check and evaluation for authoring-time tooling — linters, editor
 * feedback, generated-policy validation, packaging checks.
 *
 * This is the deliberate inverse of `RegoEngine`'s contract. The runtime engine is
 * fail-LOUD: an engine error there throws, because silently under-reporting exposures is
 * the security-relevant failure. Here everything is fail-CONTAINED: errors come back as
 * data, never as exceptions, because the caller is showing them to the person (or
 * repair loop) that produced the broken policy — the errors ARE the product.
 *
 * Each call builds a throwaway `Engine`, uses it once, and frees it. Nothing is shared
 * and nothing persists, so there is no package-namespace hygiene to manage and two
 * concurrent calls cannot observe each other.
 *
 * No resource bounds: Rego's strong normalization guarantees termination, not bounded
 * time or memory — a small policy can still express expensive work. The caller owns
 * input-size caps, and must consider `worker_threads` isolation (with `resourceLimits`)
 * before wiring this to untrusted policy or input.
 */

export interface RegoCheckResult {
  /** `errors.length === 0`. Warnings do not affect it. */
  ok: boolean;
  /** Parse errors and lint errors, one line per defect, position info preserved. */
  errors: string[];
  /** Lint warnings (patterns that halt a rule at evaluation when data arrives wrong-typed). */
  warnings: string[];
}

export interface RegoAdHocResult {
  /** `null` exactly when `errors` is non-null. `[]` = evaluated clean: nothing fired, or the rule is not defined. */
  findings: unknown[] | null;
  /** `null` exactly when `findings` is non-null. */
  errors: string[] | null;
}

/** The filename associated with the throwaway policy; appears in engine error positions. */
const ADHOC_PATH = 'adhoc.rego';

/**
 * Flatten an engine error to a single line with the position token preserved. The
 * binding throws plain strings shaped like a Rust compiler diagnostic — a `--> file:L:C`
 * span line, caret art, and an `error: …` summary. Downstream consumers (editor markers,
 * repair prompts) key on the `file:L:C` token, so it must survive verbatim.
 */
function formatEngineError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lines = raw
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 'unknown error';
  const pos = lines.find((line) => line.startsWith('-->'))?.slice('-->'.length).trim();
  const summary = lines.filter((line) => line.startsWith('error:')).join('; ') || lines[lines.length - 1];
  return pos ? `${summary} (${pos})` : summary;
}

function formatLintFinding(finding: { message: string; line?: number }): string {
  return finding.line === undefined ? finding.message : `line ${finding.line}: ${finding.message}`;
}

/**
 * Static lint plus a real parse. `lintPolicySource` never parses — it catches what a
 * parse cannot (a call to a builtin the engine does not ship resolves lazily and fails
 * only when the clause first fires), while the parse catches what the lint cannot
 * (actual syntax errors). Passing here is a superset of the packaging-time gate, so a
 * policy accepted by this check cannot later fail packaging for a reason its author
 * never saw.
 */
export function checkRegoSource(policy: string): RegoCheckResult {
  const lint = lintPolicySource(policy);
  const errors = lint.errors.map(formatLintFinding);
  const warnings = lint.warnings.map(formatLintFinding);

  let engine: Engine | undefined;
  try {
    engine = new Engine();
    engine.setPolicyLengthConfig({ ...POLICY_LENGTH_CONFIG });
    engine.addPolicy(ADHOC_PATH, policy);
  } catch (err) {
    errors.push(formatEngineError(err));
  } finally {
    engine?.free();
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Evaluate one rule of `policy` against `input`, once, on a throwaway engine. Never
 * throws: every failure — bad rule name, parse error, isolation violation, unserialisable
 * input, evaluation error, non-array rule value — returns as `errors`.
 *
 * `findings: []` means the policy evaluated cleanly and either no clause matched or the
 * policy does not define `rule` (`evalQuery` answers undefined for both; distinguishing
 * them is `checkRegoSource`'s job, not this one's).
 *
 * A policy that reads another package's `data` document is rejected rather than
 * evaluated: in isolation that document is absent, the clause evaluates to undefined,
 * and the result would silently claim "nothing fired". The runtime registry refuses to
 * load such a policy for the same reason, so accepting it here would make this helper's
 * verdict disagree with the engine that eventually runs the policy.
 */
export function evaluateRegoAdHoc(policy: string, rule: string, input: unknown): RegoAdHocResult {
  const fail = (message: string): RegoAdHocResult => ({ findings: null, errors: [message] });

  try {
    if (!RULE_NAME.test(rule)) return fail(`invalid rule name "${rule}"`);

    const engine = new Engine();
    try {
      engine.setPolicyLengthConfig({ ...POLICY_LENGTH_CONFIG });
      const packagePath = engine.addPolicy(ADHOC_PATH, policy);

      const packageName = packagePath.startsWith('data.') ? packagePath.slice('data.'.length) : packagePath;
      const violations = isolationViolations(policy, packageName);
      if (violations.length > 0) {
        return {
          findings: null,
          errors: violations.map(
            (reason) => `policy is not self-contained and would silently under-report in isolation: ${reason}`,
          ),
        };
      }

      const inputJson = JSON.stringify(input ?? {});
      if (typeof inputJson !== 'string') return fail(`input serialised to ${typeof inputJson}`);
      engine.setInputJson(inputJson);

      const raw = engine.evalQuery(`${packagePath}.${rule}`);
      const value = JSON.parse(raw).result?.[0]?.expressions?.[0]?.value;
      if (value === undefined) return { findings: [], errors: null };
      if (!Array.isArray(value)) {
        return fail(`rule evaluated to ${value === null ? 'null' : typeof value}, expected an array`);
      }
      return { findings: value, errors: null };
    } finally {
      engine.free();
    }
  } catch (err) {
    return fail(formatEngineError(err));
  }
}
