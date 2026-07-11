import { createHash } from 'crypto';

import { Engine } from '@dethernety/regorus-wasm';

/**
 * In-process Rego evaluator backed by the vendored Regorus WASM binding.
 *
 * Replaces the external OPA server for policy evaluation. The safety properties of the
 * whole migration live here, so read the contract before changing anything:
 *
 *   - An engine error is NOT "no findings". `evaluate` throws on any Regorus failure and
 *     returns `[]` only for a rule the policy genuinely does not define. Regorus halts an
 *     entire multi-clause set rule when one clause type-errors, so swallowing an error
 *     would silently under-report exposures — the security-relevant direction.
 *   - `evaluate` is synchronous and atomic: `setInputJson` → `evalQuery` → read, with no
 *     `await` in between, so two concurrent analyses cannot interleave inputs.
 *   - One Regorus `Engine` per registered policy. This is not a memory choice: Regorus
 *     merges rules from policies sharing a package, exactly as the OPA server does, so an
 *     engine holding several classes would return the union of their findings. Isolation
 *     also makes `evalQuery` ~23x faster, because its cost is per-query preparation over
 *     every module loaded into that engine.
 */

/**
 * Must stay identical to the config the parity gate applies, or production evaluates
 * under a different lexer than the one that was proven to agree with `opa`. `maxCol` is
 * raised well above Regorus's 1024 default so the corpus's long-line policies parse.
 * All three fields are required and `NonZero` upstream; a misspelled key throws.
 */
export const POLICY_LENGTH_CONFIG = Object.freeze({
  maxCol: 8192,
  maxFileBytes: 4 * 1024 * 1024,
  maxLines: 100_000,
});

/** `evalQuery` evaluates arbitrary Rego, so the rule name is interpolated into an expression. */
export const RULE_NAME = /^[a-z_][a-z0-9_]*$/i;

export class RegoPolicyError extends Error {
  constructor(
    message: string,
    readonly policyKey: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RegoPolicyError';
  }
}

export class RegoEvalError extends Error {
  constructor(
    message: string,
    readonly policyKey: string,
    readonly rule: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RegoEvalError';
  }
}

/**
 * Blank out comments and string literals, preserving offsets and line breaks so callers
 * can still report line numbers. A single pass, because `#` inside a string does not open
 * a comment and `"` inside a comment does not open a string — a regex chain gets both wrong.
 */
export function stripNonCode(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) if (out[j] !== '\n') out[j] = ' ';
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '#') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      const stop = end === -1 ? source.length : end + 1;
      blank(i, stop);
      i = stop;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(j + 1, source.length);
      blank(i, stop);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join('');
}

export function extractPackage(source: string): string | undefined {
  const match = stripNonCode(source).match(/^\s*package\s+(\S+)/m);
  return match ? match[1] : undefined;
}

/**
 * Reasons this policy cannot be evaluated in isolation from the rest of the corpus.
 *
 * A policy that reads another package's `data` document evaluates to *undefined* when that
 * document is absent — not to an error. So an isolated engine would silently drop the
 * clause and under-report, and no runtime contract could catch it. This is the static
 * tripwire that makes per-policy isolation safe. The corpus satisfies it today; the guard
 * is what keeps that true.
 */
export function isolationViolations(source: string, packageName: string): string[] {
  const code = stripNonCode(source);
  const reasons: string[] = [];

  if (/^\s*import\s+data\b/m.test(code)) reasons.push('imports another package (`import data.…`)');
  if (/\bwith\s+data\b/.test(code)) reasons.push('overrides the data document (`with data`)');
  if (/(?<![.\w])data(?![.\w])/.test(code)) reasons.push('references the whole data document (bare `data`)');

  const own = new Set<string>();
  for (const match of code.matchAll(/(?<![.\w])data\.([A-Za-z_][A-Za-z0-9_.]*)/g)) {
    const ref = match[1];
    if (ref === packageName || ref.startsWith(`${packageName}.`)) continue;
    if (!own.has(ref)) {
      own.add(ref);
      reasons.push(`references a foreign package (\`data.${ref}\`)`);
    }
  }
  return reasons;
}

interface Registration {
  engine: Engine;
  packagePath: string;
  sourceHash: string;
}

export class RegoEngine {
  private readonly registrations = new Map<string, Registration>();
  /** packagePath → owning key. Catches two classes claiming the same Rego package. */
  private readonly owners = new Map<string, string>();
  private disposed = false;

  /**
   * The single key derivation, used by both the registration side (which walks class
   * directories) and the evaluation side (which reads the class's `path` attribute back
   * out of the database). If the two ever disagreed by a separator, every analysis would
   * throw "no policy registered".
   */
  static keyFor(classDataPath: string): string {
    // Split-filter-join collapses separator runs and trims both ends in one linear
    // pass — deliberately not the regex-trim idiom, whose end-anchored alternation
    // backtracks polynomially on long separator runs.
    const normalised = classDataPath
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .join('/');
    if (!normalised) throw new RegoPolicyError('class data path must not be empty', classDataPath);
    return normalised;
  }

  get size(): number {
    return this.registrations.size;
  }

  has(key: string): boolean {
    return this.registrations.has(key);
  }

  /**
   * Parse `regoSource` eagerly and hold it in its own engine. Throws on a parse failure, a
   * policy that is not self-contained, or a package already claimed by another key —
   * loudly, at module load, which is the property the old boot-time upload provided.
   *
   * Re-registering the same key with byte-identical source reuses the existing engine, so
   * a module reload allocates nothing. Re-registering with changed source frees the old
   * engine first: the WASM heap is never reclaimed by GC (`FinalizationRegistry` does not
   * see WASM pressure), so without this every reload would leak the whole policy set.
   */
  register(key: string, regoSource: string): string {
    if (this.disposed) throw new RegoPolicyError('RegoEngine has been disposed', key);
    if (!key) throw new RegoPolicyError('policy key must be a non-empty string', key);

    const sourceHash = createHash('sha256').update(regoSource).digest('hex');
    const existing = this.registrations.get(key);
    if (existing && existing.sourceHash === sourceHash) return existing.packagePath;

    // Built before anything is torn down, so a rejected policy leaves the registry intact.
    const { engine, packagePath } = this.compile(key, regoSource);

    const owner = this.owners.get(packagePath);
    if (owner !== undefined && owner !== key) {
      engine.free();
      throw new RegoPolicyError(
        `package "${packagePath}" is already registered by "${owner}". Two policies sharing a ` +
          `package would each land in their own engine and see only half the rules.`,
        key,
      );
    }

    if (existing) {
      this.owners.delete(existing.packagePath);
      existing.engine.free();
    }
    this.registrations.set(key, { engine, packagePath, sourceHash });
    this.owners.set(packagePath, key);
    return packagePath;
  }

  private compile(key: string, regoSource: string): { engine: Engine; packagePath: string } {
    const packageName = extractPackage(regoSource);
    if (!packageName) throw new RegoPolicyError('policy declares no package', key);

    const violations = isolationViolations(regoSource, packageName);
    if (violations.length > 0) {
      throw new RegoPolicyError(
        `policy is not self-contained and would silently under-report if evaluated in ` +
          `isolation: ${violations.join('; ')}`,
        key,
      );
    }

    const engine = new Engine();
    engine.setPolicyLengthConfig({ ...POLICY_LENGTH_CONFIG });
    try {
      return { engine, packagePath: engine.addPolicy(key, regoSource) };
    } catch (err) {
      engine.free();
      throw new RegoPolicyError(`failed to parse policy: ${describe(err)}`, key, { cause: err });
    }
  }

  /**
   * Evaluate one rule of one registered policy. Synchronous and self-contained: the engine
   * is looked up and used within this call, never handed out, so a concurrent `register`
   * cannot free an engine an in-flight evaluation is holding.
   *
   * Returns `[]` only when the policy does not define `rule`. Every failure throws.
   */
  evaluate<T = unknown>(key: string, rule: string, input: unknown): T[] {
    // Using a freed engine otherwise surfaces as an opaque "null pointer passed to rust".
    if (this.disposed) throw new RegoEvalError('RegoEngine has been disposed', key, rule);
    if (!RULE_NAME.test(rule)) {
      throw new RegoEvalError(`invalid rule name "${rule}"`, key, rule);
    }

    // `evalQuery` on an unregistered package yields undefined, not an error, so without
    // this a mistyped key would fail open to "no findings".
    const registration = this.registrations.get(key);
    if (!registration) throw new RegoEvalError('no policy registered for this key', key, rule);

    let inputJson: string;
    try {
      inputJson = JSON.stringify(input ?? {});
    } catch (err) {
      throw new RegoEvalError(`input is not serialisable: ${describe(err)}`, key, rule, { cause: err });
    }
    if (typeof inputJson !== 'string') {
      throw new RegoEvalError(`input serialised to ${typeof inputJson}`, key, rule);
    }

    const query = `${registration.packagePath}.${rule}`;
    let raw: string;
    try {
      registration.engine.setInputJson(inputJson);
      raw = registration.engine.evalQuery(query);
    } catch (err) {
      // Never degrade to []: a halted rule is an under-report, not an empty result.
      throw new RegoEvalError(`evaluation failed: ${describe(err)}`, key, rule, { cause: err });
    }

    const value = JSON.parse(raw).result?.[0]?.expressions?.[0]?.value;
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new RegoEvalError(
        `rule evaluated to ${value === null ? 'null' : typeof value}, expected an array`,
        key,
        rule,
      );
    }
    return value as T[];
  }

  /** Free every engine whose key is absent from `keepKeys`. Returns how many were freed. */
  prune(keepKeys: Iterable<string>): number {
    if (this.disposed) throw new Error('RegoEngine has been disposed');
    const keep = new Set(keepKeys);
    let freed = 0;
    for (const [key, registration] of this.registrations) {
      if (keep.has(key)) continue;
      registration.engine.free();
      this.registrations.delete(key);
      this.owners.delete(registration.packagePath);
      freed++;
    }
    return freed;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const registration of this.registrations.values()) registration.engine.free();
    this.registrations.clear();
    this.owners.clear();
    this.disposed = true;
  }
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim().split('\n').filter(Boolean).pop() ?? 'unknown error';
}
