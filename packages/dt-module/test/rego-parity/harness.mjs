/**
 * Rego parity harness — shared logic for the OPA-vs-Regorus conformance gate.
 *
 * Deliberately has no `.test.` infix: vitest's default include glob would otherwise
 * pick it up and every `pnpm test` would need the `opa` binary on PATH.
 *
 * Two consumers:
 *   - `run.mjs`          the CI gate (needs `opa`)
 *   - `contract.test.mjs` a vitest suite over this file's pure logic (needs nothing)
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '@dethernety/regorus-wasm';

/**
 * Must stay identical to the config `RegoEngine` applies in production, or the gate
 * exercises a different lexer than the one that ships. `maxCol` is raised well above
 * Regorus's 1024 default so the long-line policies in the corpus parse.
 */
export const POLICY_LENGTH_CONFIG = Object.freeze({
  maxCol: 8192,
  maxFileBytes: 4 * 1024 * 1024,
  maxLines: 100_000,
});

/** The two rule paths `DtFileOpaModule` queries. Evaluated separately, never batched. */
export const RULE_NAMES = Object.freeze(['exposures', 'countermeasures']);

export const OUTCOME = Object.freeze({
  VALUE: 'VALUE',
  UNDEFINED: 'UNDEFINED',
  ERROR: 'ERROR',
  THROW: 'THROW',
});

const SKIP_DIRS = new Set(['dist', 'node_modules', '.git']);

// ── discovery ──────────────────────────────────────────────────────────────────

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, acc);
    } else if (entry.name === 'policies.rego') {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * A policy's owning module is the first path segment under its discovery root:
 * `<root>/<module>/data/<module>/<classType>/<slug>/policies.rego`.
 */
export function moduleOf(policyPath, root) {
  const rel = policyPath.startsWith(root + sep) ? policyPath.slice(root.length + 1) : policyPath;
  return join(root, rel.split(sep)[0]);
}

/** Discover every `policies.rego` under `roots`, with its sibling `tests.json` if present. */
export function discoverPolicies(roots) {
  const found = [];
  for (const root of roots) {
    for (const policyPath of walk(root, []).sort()) {
      const testsPath = policyPath.replace(/policies\.rego$/, 'tests.json');
      let hasTests = false;
      try {
        hasTests = statSync(testsPath).isFile();
      } catch {
        hasTests = false;
      }
      found.push({
        policyPath,
        testsPath: hasTests ? testsPath : null,
        root,
        module: moduleOf(policyPath, root),
      });
    }
  }
  return found;
}

export function parsePackage(source) {
  const match = source.match(/^package\s+(\S+)/m);
  return match ? match[1] : null;
}

/**
 * Read a `tests.json` and return its case array. A file that exists but cannot be
 * parsed (or is not an array) THROWS rather than degrading the policy to the
 * empty-input-only cohort: silently dropping a file's vectors is exactly the kind of
 * pass-while-testing-nothing failure the gate's floors exist to prevent, and the
 * aggregate floor is a frozen lower bound that a grown corpus can absorb one file into.
 */
export function readCases(testsPath) {
  let raw;
  try {
    raw = readFileSync(testsPath, 'utf8');
  } catch (err) {
    throw new Error(`unreadable tests.json at ${testsPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`malformed tests.json at ${testsPath}: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`tests.json at ${testsPath} is not an array of cases`);
  }
  return parsed;
}

// ── canonicalisation ───────────────────────────────────────────────────────────

/**
 * Sort object keys recursively. Arrays keep their order on purpose: only the
 * top-level findings array is a Rego set (genuinely unordered). Nested arrays such
 * as `exploited_by` carry meaningful order, and sorting them would hide a real diff.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

const bySerialised = (a, b) => {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

/**
 * Canonical form of a rule's value. The top-level array is a Rego set, so it is
 * sorted by serialised element — which also makes the comparison a multiset keyed
 * by the whole finding, not by `name`. Two findings sharing a name but differing in
 * body therefore cannot compare equal (a name-set diff would miss that).
 */
export function canonicalResult(value) {
  if (!Array.isArray(value)) return canonicalize(value);
  return value.map(canonicalize).sort(bySerialised);
}

/** What `DtFileOpaModule`'s mapper sees: an absent rule and an empty set are both `[]`. */
function normalise(outcome) {
  if (outcome.kind === OUTCOME.UNDEFINED) return [];
  return outcome.value;
}

// ── evaluation ─────────────────────────────────────────────────────────────────

export function makeEngine(source) {
  const engine = new Engine();
  engine.setPolicyLengthConfig(POLICY_LENGTH_CONFIG);
  engine.addPolicy('policies.rego', source);
  return engine;
}

/**
 * A Regorus throw is ALWAYS an error and never degrades to `[]`. That is the
 * fail-open regression this whole gate exists to prevent.
 */
export function regorusOutcome(engine, ruleRef, inputJson) {
  try {
    engine.setInputJson(inputJson);
    const parsed = JSON.parse(engine.evalQuery(ruleRef));
    const value = parsed.result?.[0]?.expressions?.[0]?.value;
    return value === undefined ? { kind: OUTCOME.UNDEFINED } : { kind: OUTCOME.VALUE, value };
  } catch (err) {
    return { kind: OUTCOME.THROW, message: String(err?.message ?? err).trim() };
  }
}

export class OpaUnavailableError extends Error {}

function spawnOpa(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'opa',
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: 30_000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') {
          reject(new OpaUnavailableError('`opa` was not found on PATH'));
          return;
        }
        if (err && (err.killed || err.signal)) {
          reject(new Error(`opa timed out or was killed: ${args.join(' ')}`));
          return;
        }
        resolve({ exitCode: err ? (err.code ?? 1) : 0, stdout, stderr });
      },
    );
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new OpaUnavailableError('`opa` was not found on PATH'));
      else reject(err);
    });
    child.stdin.end(stdin);
  });
}

/** Resolve the `opa` version string, or throw `OpaUnavailableError`. Never skips. */
export async function opaVersion() {
  const { stdout } = await spawnOpa(['version'], '');
  const match = stdout.match(/^Version:\s*(\S+)/m);
  if (!match) throw new Error(`could not parse \`opa version\` output:\n${stdout}`);
  return match[1];
}

/**
 * Three-way classification. A non-zero exit, an `errors` key, or unparseable output
 * is an ERROR — never silently folded into UNDEFINED, which is how the under-fire
 * class would get scored as agreement.
 */
export async function opaOutcome(policyPath, ruleRef, inputJson) {
  const { exitCode, stdout, stderr } = await spawnOpa(
    ['eval', '-f', 'json', '-d', policyPath, '-I', ruleRef],
    inputJson,
  );
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: OUTCOME.ERROR, message: (stderr || stdout).trim().slice(0, 400) };
  }
  if (parsed.errors || exitCode !== 0) {
    return { kind: OUTCOME.ERROR, message: JSON.stringify(parsed.errors ?? stderr).slice(0, 400) };
  }
  const value = parsed.result?.[0]?.expressions?.[0]?.value;
  return value === undefined ? { kind: OUTCOME.UNDEFINED } : { kind: OUTCOME.VALUE, value };
}

// ── comparison ─────────────────────────────────────────────────────────────────

/**
 *              │ regorus VALUE │ UNDEFINED │ THROW
 *   opa VALUE  │ deep-compare  │   diff    │ diff  ← the aggregate under-fire class
 *   UNDEFINED  │     diff      │   agree   │ diff
 *   ERROR      │     diff      │   diff    │ agree
 *
 * `rawShape` flags an UNDEFINED-vs-VALUE([]) disagreement that survives the mapper's
 * normalisation. It is reported, not gated: both reach `dt-ws` as `[]`.
 */
export function compareOutcomes(opa, regorus) {
  if (opa.kind === OUTCOME.ERROR || regorus.kind === OUTCOME.THROW) {
    const agree = opa.kind === OUTCOME.ERROR && regorus.kind === OUTCOME.THROW;
    return {
      agree,
      rawShape: false,
      reason: agree ? 'both-error' : `${opa.kind}-vs-${regorus.kind}`,
    };
  }

  const opaCanon = canonicalResult(normalise(opa));
  const regorusCanon = canonicalResult(normalise(regorus));
  const rawShape = opa.kind !== regorus.kind;

  if (JSON.stringify(opaCanon) === JSON.stringify(regorusCanon)) {
    return { agree: true, rawShape, reason: 'equal' };
  }
  // Canonical values are returned whole. Truncating them here would produce invalid
  // JSON in the report and make a real divergence untriageable.
  return { agree: false, rawShape, reason: 'deep-object', opaCanon, regorusCanon };
}

/** Finding names present on one side only — the first thing you want when triaging a diff. */
export function nameDelta(opaCanon, regorusCanon) {
  const names = (value) => (Array.isArray(value) ? value.map((f) => f?.name).filter(Boolean) : []);
  const opaNames = names(opaCanon);
  const regorusNames = names(regorusCanon);
  return {
    onlyInOpa: opaNames.filter((n) => !regorusNames.includes(n)),
    onlyInRegorus: regorusNames.filter((n) => !opaNames.includes(n)),
    sameNames: JSON.stringify([...opaNames].sort()) === JSON.stringify([...regorusNames].sort()),
  };
}

// ── static census ──────────────────────────────────────────────────────────────

/**
 * Every `count(input.…)` / `regex.match(…, input.…)` site. On a wrong-typed argument
 * OPA propagates undefined while Regorus throws, halting the whole set rule. A
 * `tests.json`-driven cohort cannot see this, so the site set is frozen instead:
 * a NEW site fails the gate and forces an `is_array`/`object.get` guard.
 */
export function builtinInputSites(source) {
  const sites = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bcount\(\s*input\./.test(line)) sites.push({ line: i + 1, builtin: 'count' });
    if (/\bregex\.match\([^)]*\binput\./.test(line)) sites.push({ line: i + 1, builtin: 'regex.match' });
  }
  return sites;
}

/**
 * Rego package names that more than one module defines. OPA merges same-package rules
 * into a single `data` document, so a collision means an element receives the UNION of
 * both classes' findings. Per-module engines do not — which is why one engine per
 * module is a correctness requirement, and why a new collision must fail the gate.
 */
export function packageCollisions(entries) {
  const byPackage = new Map();
  for (const { pkg, module } of entries) {
    if (!pkg) continue;
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
    byPackage.get(pkg).add(module);
  }
  return [...byPackage]
    .filter(([, modules]) => modules.size > 1)
    .map(([pkg, modules]) => ({ package: pkg, modules: [...modules].sort() }))
    .sort((a, b) => (a.package < b.package ? -1 : 1));
}

// ── engine adapters ────────────────────────────────────────────────────────────
//
// Two ways to reach the same WASM blob.
//
//   raw     — the binding directly, one `Engine` per policy. Can report all three
//             outcomes, so it is the only mode that exercises UNDEFINED-vs-VALUE([]).
//   wrapper — through the compiled `RegoEngine` that production calls. Its contract maps
//             an undefined rule to `[]`, so it can never emit UNDEFINED. It tests strictly
//             less than raw mode, and it tests the thing that actually ships.
//
// Both expose the same three-outcome interface, so the comparison logic is identical.

export function createRawAdapter() {
  const engines = new Map();
  return {
    mode: 'raw',
    register(key, source) {
      const engine = new Engine();
      engine.setPolicyLengthConfig({ ...POLICY_LENGTH_CONFIG });
      engines.set(key, { engine, packagePath: engine.addPolicy(key, source) });
    },
    evaluate(key, rule, inputJson) {
      const { engine, packagePath } = engines.get(key);
      return regorusOutcome(engine, `${packagePath}.${rule}`, inputJson);
    },
  };
}

/**
 * One `RegoEngine` per module, mirroring production: the duplicate-package check is
 * per-instance, and two modules legitimately declare the same Rego package.
 */
export function createWrapperAdapter(RegoEngine) {
  const byModule = new Map();
  const moduleOfKey = new Map();
  return {
    mode: 'wrapper',
    register(key, source, moduleId) {
      if (!byModule.has(moduleId)) byModule.set(moduleId, new RegoEngine());
      byModule.get(moduleId).register(key, source);
      moduleOfKey.set(key, moduleId);
    },
    evaluate(key, rule, inputJson) {
      try {
        const value = byModule.get(moduleOfKey.get(key)).evaluate(key, rule, JSON.parse(inputJson));
        return { kind: OUTCOME.VALUE, value };
      } catch (err) {
        // A throw is always an error. Folding it into [] is the regression this gate exists
        // to catch, so the adapter must not be more forgiving than the wrapper it wraps.
        return { kind: OUTCOME.THROW, message: String(err?.message ?? err).trim() };
      }
    },
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const WRAPPER_SOURCE = join(HERE, '..', '..', 'src', 'rego-engine.ts');
export const WRAPPER_DIST = join(HERE, '..', '..', 'dist', 'rego-engine.js');

/**
 * Load the compiled wrapper, refusing a stale build. A gate that silently evaluates an old
 * `dist/` reports green for code that no longer exists — precisely the false-green this
 * harness is built to make impossible.
 */
export function loadWrapper() {
  let distStat;
  try {
    distStat = statSync(WRAPPER_DIST);
  } catch {
    throw new Error(`wrapper mode needs a build: ${WRAPPER_DIST} does not exist.\nRun: pnpm --filter @dethernety/dt-module build`);
  }
  const srcStat = statSync(WRAPPER_SOURCE);
  if (srcStat.mtimeMs > distStat.mtimeMs) {
    throw new Error(
      `wrapper mode would test a stale build: src/rego-engine.ts is newer than dist/rego-engine.js.\n` +
        `Run: pnpm --filter @dethernety/dt-module build`,
    );
  }
  const required = createRequire(import.meta.url)(WRAPPER_DIST);
  // Two sources of truth for the lexer limits would let the gate parse policies production
  // rejects, or vice versa.
  const theirs = required.POLICY_LENGTH_CONFIG;
  for (const [field, value] of Object.entries(POLICY_LENGTH_CONFIG)) {
    if (theirs?.[field] !== value) {
      throw new Error(`RegoEngine.POLICY_LENGTH_CONFIG.${field} is ${theirs?.[field]}, harness expects ${value}`);
    }
  }
  return required.RegoEngine;
}

// ── concurrency ────────────────────────────────────────────────────────────────

/** Bounded pool. Keeps ~4.7k `opa` spawns from exhausting file handles. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
