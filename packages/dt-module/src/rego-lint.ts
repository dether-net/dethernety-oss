import { POLICY_LENGTH_CONFIG, extractPackage, isolationViolations, stripNonCode } from './rego-engine';
import { SUPPORTED_BUILTINS, UNSUPPORTED_BUILTINS } from './rego-builtins';

/**
 * Static lint for a single `policies.rego`, run at package time.
 *
 * It exists because the one class of defect the engine cannot surface at load is a call
 * to a function it does not have: Regorus resolves function names lazily, so a policy
 * calling `http.send` parses cleanly and fails only when that clause first fires — under
 * the fail-loud contract, aborting the element's whole evaluation in production. The
 * partition in `rego-builtins.ts` is measured against the vendored blob, and every call
 * in a policy must resolve to a keyword, a function the policy itself defines, or a
 * supported builtin. An unknown name is an error too: a typo fails at evaluation exactly
 * the way a missing builtin does.
 *
 * Everything else the lint reports (length limits, missing package, isolation) reuses
 * the engine's own constants and helpers, so lint and load-time guard cannot disagree.
 */

export interface LintFinding {
  message: string;
  line?: number;
}

/** Terms that look like calls but are language syntax (`not (…)`, `some (…)`, …). */
const KEYWORDS = new Set([
  'if', 'in', 'some', 'every', 'not', 'with', 'else', 'package', 'import', 'default', 'as',
]);
// `contains` is deliberately NOT here: as the set-rule keyword it is never followed by
// `(`, so `contains(` is always the two-argument string builtin. Skipping it as a keyword
// would hide real calls (the corpus has one).

const CALL = /(?<![.\w])([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)\s*\(/g;

/**
 * A function DEFINITION head: optionally `default`-prefixed, at the start of a line, with
 * an argument list followed by a rule body or value. Requiring `:=` / `=` / `if` / `{`
 * after the closing paren is what separates `helper(x) := …` from a body line that merely
 * CALLS something — `count(input.x) == 0` must never register `count` as a local.
 */
const FUNCTION_DEF = /^[ \t]*(?:default[ \t]+)?([a-z_][a-z0-9_]*)[ \t]*\([^)\n]*\)[ \t]*(?::=|=(?!=)|if\b|\{)/gm;

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === '\n') line++;
  return line;
}

/** Every call site in the policy, comments and strings excluded. Keywords are not calls. */
export function callSites(source: string): { name: string; line: number }[] {
  const code = stripNonCode(source);
  const sites: { name: string; line: number }[] = [];
  for (const match of code.matchAll(CALL)) {
    if (KEYWORDS.has(match[1])) continue;
    sites.push({ name: match[1], line: lineOf(code, match.index) });
  }
  return sites;
}

/** Names of functions the policy defines itself. */
export function localFunctionNames(source: string): Set<string> {
  const code = stripNonCode(source);
  const names = new Set<string>();
  for (const match of code.matchAll(FUNCTION_DEF)) names.add(match[1]);
  return names;
}

/**
 * Sites where `count`/`regex.match` is applied directly to an `input.` value — the
 * pattern that halts a Regorus rule when the attribute arrives wrong-typed. Same
 * line-based detection as the parity gate's census (`test/rego-parity/harness.mjs`); a
 * test asserts the two stay in agreement.
 */
export function builtinInputSites(source: string): { builtin: string; line: number }[] {
  const sites: { builtin: string; line: number }[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/\bcount\(\s*input\./.test(lines[i])) sites.push({ line: i + 1, builtin: 'count' });
    if (/\bregex\.match\([^)]*\binput\./.test(lines[i])) sites.push({ line: i + 1, builtin: 'regex.match' });
  }
  return sites;
}

export function lintPolicySource(source: string): { errors: LintFinding[]; warnings: LintFinding[] } {
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];

  const lines = source.split('\n');
  if (lines.length > POLICY_LENGTH_CONFIG.maxLines) {
    errors.push({ message: `policy has ${lines.length} lines (limit ${POLICY_LENGTH_CONFIG.maxLines})` });
  }
  if (Buffer.byteLength(source, 'utf8') > POLICY_LENGTH_CONFIG.maxFileBytes) {
    errors.push({ message: `policy exceeds ${POLICY_LENGTH_CONFIG.maxFileBytes} bytes` });
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > POLICY_LENGTH_CONFIG.maxCol) {
      errors.push({
        message: `line is ${lines[i].length} columns (the engine's lexer limit is ${POLICY_LENGTH_CONFIG.maxCol})`,
        line: i + 1,
      });
    }
  }

  const packageName = extractPackage(source);
  if (!packageName) {
    errors.push({ message: 'policy declares no package' });
  } else {
    for (const reason of isolationViolations(source, packageName)) {
      errors.push({ message: reason });
    }
  }

  const locals = localFunctionNames(source);
  const reported = new Set<string>();
  for (const site of callSites(source)) {
    const { name } = site;
    if (locals.has(name) || reported.has(name)) continue;
    // A dotted path rooted in `data`/`input` references a document, not a global
    // function; cross-package `data.` references are already isolation errors above.
    const root = name.split('.')[0];
    if (root === 'data' || root === 'input') continue;
    if (SUPPORTED_BUILTINS.has(name)) continue;
    reported.add(name);
    if (UNSUPPORTED_BUILTINS.has(name)) {
      errors.push({
        message: `\`${name}\` is absent from the vendored engine — it parses, then fails at evaluation`,
        line: site.line,
      });
    } else {
      errors.push({
        message: `\`${name}\` is not a supported builtin nor defined in this policy — it fails at evaluation`,
        line: site.line,
      });
    }
  }

  for (const site of builtinInputSites(source)) {
    warnings.push({
      message: `\`${site.builtin}\` applied directly to an input value — a wrong-typed attribute halts this rule`,
      line: site.line,
    });
  }

  return { errors, warnings };
}
