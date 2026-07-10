#!/usr/bin/env node
/**
 * Rego parity gate — the committed Regorus WASM blob vs the `opa` binary, over the
 * whole policy corpus. This is the sole evidence that an in-process engine may serve
 * the security findings the platform emits, so it is built to be unable to lie:
 * every way it could pass while testing nothing is a hard failure.
 *
 * Run from the REPO ROOT (roots resolve against cwd):
 *
 *   REGO_PARITY_ROOTS=modules node packages/dt-module/test/rego-parity/run.mjs
 *
 * Environment:
 *   REGO_PARITY_ROOTS                  required, comma-separated module roots
 *   REGO_PARITY_ENGINE                 raw (the binding) | wrapper (the compiled RegoEngine)
 *   REGO_PARITY_NONGATING_ROOTS        path prefixes reported but never gated
 *   REGO_PARITY_OPA_VERSION            exact `opa` version to require (default 1.18.2)
 *   REGO_PARITY_MIN_MODERN_POLICIES    floor; undershoot is a hard failure
 *   REGO_PARITY_MIN_MODERN_CASES       floor; undershoot is a hard failure
 *   REGO_PARITY_MIN_NONGATING_POLICIES floor for the non-gating cohort
 *   REGO_PARITY_BUILTIN_SITES_FILE     frozen census manifest (absent ⇒ must be empty)
 *   REGO_PARITY_COLLISIONS_FILE        frozen census manifest (absent ⇒ must be empty)
 *   REGO_PARITY_REPORT                 write machine-readable JSON here
 *   REGO_PARITY_CONCURRENCY            opa spawn pool size (default min(8, cpus))
 */

import { cpus } from 'node:os';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';

import {
  OUTCOME,
  OpaUnavailableError,
  builtinInputSites,
  compareOutcomes,
  createRawAdapter,
  createWrapperAdapter,
  discoverPolicies,
  loadWrapper,
  mapWithConcurrency,
  nameDelta,
  opaOutcome,
  opaVersion,
  packageCollisions,
  parsePackage,
  readCases,
} from './harness.mjs';

const DEFAULT_OPA_VERSION = '1.18.2';
const EMPTY_INPUT = '{}';
const PREFLIGHT_MODULE = '__preflight';

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL  ${message}`);
};

const env = (name, fallback) => process.env[name] ?? fallback;
const list = (name) =>
  (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

function die(message) {
  console.error(`\nrego-parity: ${message}`);
  process.exit(1);
}

/**
 * A malformed number must not be read as "no constraint". `Number('abc')` is NaN and
 * every comparison against it is false, so a typo'd floor would silently disable the
 * guard it was written to enforce.
 */
function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    die(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

// ── G1  roots ──────────────────────────────────────────────────────────────────

const roots = list('REGO_PARITY_ROOTS');
if (roots.length === 0) {
  die(
    'REGO_PARITY_ROOTS is required and has no default.\n' +
      'A default would let a mis-wired job silently discover zero policies and report "0 diffs".\n' +
      'Run from the repo root, e.g. REGO_PARITY_ROOTS=modules node packages/dt-module/test/rego-parity/run.mjs',
  );
}
for (const root of roots) {
  try {
    if (!statSync(root).isDirectory()) die(`root is not a directory: ${root}`);
  } catch {
    die(`root does not exist (resolved against cwd ${process.cwd()}): ${root}`);
  }
}

const nonGatingRoots = list('REGO_PARITY_NONGATING_ROOTS');
for (const prefix of nonGatingRoots) {
  try {
    if (!statSync(prefix).isDirectory()) die(`non-gating root is not a directory: ${prefix}`);
  } catch {
    die(`non-gating root does not exist: ${prefix}`);
  }
  if (!roots.some((root) => prefix === root || prefix.startsWith(root + sep))) {
    die(`non-gating root is not inside any discovery root: ${prefix}`);
  }
}
const isNonGating = (path) =>
  nonGatingRoots.some((prefix) => path === prefix || path.startsWith(prefix + sep));

// ── G2/G3  the oracle ──────────────────────────────────────────────────────────

const requiredOpa = env('REGO_PARITY_OPA_VERSION', DEFAULT_OPA_VERSION);
let foundOpa;
try {
  foundOpa = await opaVersion();
} catch (err) {
  if (err instanceof OpaUnavailableError) {
    die(
      '`opa` is not on PATH.\n' +
        'This is a hard failure, never a skip: without the reference oracle the gate proves nothing.\n' +
        `Install OPA v${requiredOpa} and re-run.`,
    );
  }
  die(`could not determine the opa version: ${err.message}`);
}
if (foundOpa !== requiredOpa) {
  die(
    `opa version mismatch: found ${foundOpa}, require ${requiredOpa}.\n` +
      'OPA-version drift changes verdicts, so an unpinned oracle silently measures the wrong thing.',
  );
}

// ── engine under test ──────────────────────────────────────────────────────────

const engineMode = env('REGO_PARITY_ENGINE', 'raw');
if (engineMode !== 'raw' && engineMode !== 'wrapper') {
  die(`REGO_PARITY_ENGINE must be "raw" or "wrapper", got ${JSON.stringify(engineMode)}`);
}
let adapter;
try {
  adapter = engineMode === 'wrapper' ? createWrapperAdapter(loadWrapper()) : createRawAdapter();
} catch (err) {
  die(err.message);
}

// ── G5  fail-loud preflight ────────────────────────────────────────────────────
//
// Before touching the corpus, prove the engine under test surfaces errors instead of
// folding them into `[]`. A gate that cannot see a throw would score the aggregate
// under-fire class as agreement.

const PREFLIGHT_GOOD = `package parity.preflight.good

exposures contains finding if {
	input.enabled == true
	finding := {"name": "ok"}
}
`;

const PREFLIGHT_TYPE_ERROR = `package parity.preflight.typeerror

exposures contains finding if {
	count(input.items) == 0
	finding := {"name": "unreachable"}
}
`;

const PREFLIGHT_LONG_LINE = `package parity.preflight.longline

exposures contains finding if {
	description := "${'x'.repeat(9000)}"
	finding := {"name": description}
}
`;

function preflight() {
  try {
    adapter.register('__preflight/good', PREFLIGHT_GOOD, PREFLIGHT_MODULE);
    adapter.register('__preflight/typeerror', PREFLIGHT_TYPE_ERROR, PREFLIGHT_MODULE);
  } catch (err) {
    fail(`preflight: a valid policy failed to register — engine is not usable: ${err.message}`);
    return;
  }

  const good = adapter.evaluate('__preflight/good', 'exposures', '{"enabled":true}');
  if (good.kind !== OUTCOME.VALUE || good.value?.length !== 1) {
    fail(`preflight: a valid policy did not return a value (got ${good.kind}) — engine is not usable`);
  }

  const typeError = adapter.evaluate('__preflight/typeerror', 'exposures', '{"items":false}');
  if (typeError.kind !== OUTCOME.THROW) {
    fail(`preflight: count() on a boolean returned ${typeError.kind}, expected THROW (fail-loud contract broken)`);
  }

  let longLineThrew = false;
  try {
    adapter.register('__preflight/longline', PREFLIGHT_LONG_LINE, PREFLIGHT_MODULE);
  } catch {
    longLineThrew = true;
  }
  if (!longLineThrew) {
    fail('preflight: a >8192-column policy registered, expected a throw');
  }
}
preflight();
if (failures.length > 0) die('fail-loud preflight failed — refusing to report parity results');

// ── discovery ──────────────────────────────────────────────────────────────────

const discovered = discoverPolicies(roots);
const policies = [];
for (const entry of discovered) {
  const source = readFileSync(entry.policyPath, 'utf8');
  policies.push({
    ...entry,
    source,
    pkg: parsePackage(source),
    gating: !isNonGating(entry.policyPath),
  });
}

const gating = policies.filter((p) => p.gating);
const nonGating = policies.filter((p) => !p.gating);
const gatingWithTests = gating.filter((p) => p.testsPath);
const gatingCaseCount = gatingWithTests.reduce((sum, p) => sum + readCases(p.testsPath).length, 0);

// ── G4  floors ─────────────────────────────────────────────────────────────────
//
// Zero cases and zero diffs are otherwise indistinguishable.

if (policies.length === 0) die(`discovered 0 policies under ${roots.join(', ')}`);

const floor = (name, actual, label) => {
  const expected = positiveInt(name, 1);
  if (actual < expected) fail(`${label}: found ${actual}, floor is ${expected} (${name})`);
};
floor('REGO_PARITY_MIN_MODERN_POLICIES', gating.length, 'gating policies');
floor('REGO_PARITY_MIN_MODERN_CASES', gatingCaseCount, 'gating test cases');
if (nonGatingRoots.length > 0) {
  floor('REGO_PARITY_MIN_NONGATING_POLICIES', nonGating.length, 'non-gating policies');
}

// ── G6  static census ──────────────────────────────────────────────────────────

const readManifest = (name) => {
  const path = process.env[name];
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    die(`could not read ${name} at ${path}: ${err.message}`);
  }
};

const observedSites = gating
  .flatMap((p) => builtinInputSites(p.source).map((site) => ({ policy: p.policyPath, ...site })))
  .sort((a, b) => (a.policy + a.line < b.policy + b.line ? -1 : 1));

const observedCollisions = packageCollisions(gating);

const nonGatingSiteCount = nonGating.reduce((sum, p) => sum + builtinInputSites(p.source).length, 0);

function censusDiff(label, observed, manifest, hint) {
  const expected = manifest ?? [];
  const a = JSON.stringify(observed);
  const b = JSON.stringify(expected);
  if (a === b) return;
  fail(
    `${label} census does not match the frozen manifest.\n` +
      `  observed: ${a}\n  expected: ${b}\n  ${hint}`,
  );
}

censusDiff(
  'unguarded-builtin',
  observedSites,
  readManifest('REGO_PARITY_BUILTIN_SITES_FILE'),
  'A new count(input.…)/regex.match(…, input.…) site diverges from OPA on a wrong-typed value. Guard it (is_array / object.get) or update the manifest with justification.',
);
censusDiff(
  'package-collision',
  observedCollisions,
  readManifest('REGO_PARITY_COLLISIONS_FILE'),
  'Two modules declare the same Rego package. OPA merges them into one data document (union of findings); per-module engines do not. Rename the package or update the manifest.',
);

// ── evaluation ─────────────────────────────────────────────────────────────────

const concurrency = positiveInt('REGO_PARITY_CONCURRENCY', Math.min(8, cpus().length || 4));

/** One engine per policy — production-faithful, and verified safe to reuse after a throw. */
const registered = new Set();
const registerErrors = [];
for (const policy of policies) {
  if (!policy.pkg) {
    registerErrors.push({ policy: policy.policyPath, error: 'no package declaration' });
    continue;
  }
  try {
    adapter.register(policy.policyPath, policy.source, policy.module);
    registered.add(policy.policyPath);
  } catch (err) {
    registerErrors.push({ policy: policy.policyPath, error: String(err?.message ?? err).trim().slice(0, 300) });
  }
}
for (const entry of registerErrors) {
  const policy = policies.find((p) => p.policyPath === entry.policy);
  if (policy?.gating) fail(`gating policy failed to register: ${entry.policy}\n  ${entry.error}`);
}

const tasks = [];
for (const policy of policies) {
  if (!registered.has(policy.policyPath)) continue;
  const cases = policy.testsPath
    ? readCases(policy.testsPath).map((testCase, index) => ({
        cohort: 'corpus',
        name: testCase.name ?? `#${index}`,
        input: JSON.stringify(testCase.input ?? {}),
      }))
    : [];
  cases.push({ cohort: 'emptyInput', name: '{}', input: EMPTY_INPUT });
  for (const testCase of cases) {
    for (const rule of ['exposures', 'countermeasures']) {
      tasks.push({ policy, rule, ...testCase });
    }
  }
}

console.log(
  `rego-parity: opa ${foundOpa} · engine ${engineMode} · ${policies.length} policies ` +
    `(${gating.length} gating, ${nonGating.length} non-gating) · ${tasks.length} evaluations · concurrency ${concurrency}`,
);

const started = Date.now();
let comparisons;
try {
  comparisons = await mapWithConcurrency(tasks, concurrency, async (task) => {
    const ruleRef = `data.${task.policy.pkg}.${task.rule}`;
    // Synchronous, so it is atomic with respect to the event loop: no other task can
    // touch this engine's input between setInputJson and evalQuery.
    const regorus = adapter.evaluate(task.policy.policyPath, task.rule, task.input);
    const opa = await opaOutcome(task.policy.policyPath, ruleRef, task.input);
    return {
      task,
      ...compareOutcomes(opa, regorus),
      opaKind: opa.kind,
      regorusKind: regorus.kind,
      throwMessage: regorus.message,
      // A cohort of all-empty results would agree vacuously. Count the pairs where OPA
      // actually emitted findings, so "0 diffs" is backed by real deep-object compares.
      firing: opa.kind === OUTCOME.VALUE && Array.isArray(opa.value) && opa.value.length > 0,
    };
  });
} catch (err) {
  if (err instanceof OpaUnavailableError) die('`opa` disappeared from PATH mid-run');
  die(`harness failure: ${err.message}`);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

// ── tally ──────────────────────────────────────────────────────────────────────

const empty = () => ({ pairs: 0, agree: 0, firing: 0, diffs: [], rawShape: 0 });
const tally = {
  corpus: { gating: empty(), nonGating: empty() },
  emptyInput: { gating: empty(), nonGating: empty() },
};

for (const result of comparisons) {
  const bucket = tally[result.task.cohort][result.task.policy.gating ? 'gating' : 'nonGating'];
  bucket.pairs++;
  if (result.firing) bucket.firing++;
  if (result.rawShape) bucket.rawShape++;
  if (result.agree) {
    bucket.agree++;
  } else {
    const delta = result.reason === 'deep-object' ? nameDelta(result.opaCanon, result.regorusCanon) : null;
    bucket.diffs.push({
      policy: result.task.policy.policyPath,
      rule: result.task.rule,
      case: result.task.name,
      reason: result.reason,
      opa: result.opaKind,
      regorus: result.regorusKind,
      ...(delta ? { nameDelta: delta } : {}),
      ...(result.regorusKind === OUTCOME.THROW ? { throwMessage: result.throwMessage } : {}),
      // Whole canonical values, never truncated: a truncated payload is invalid JSON
      // and makes a real divergence impossible to triage.
      ...(delta ? { opaValue: result.opaCanon, regorusValue: result.regorusCanon } : {}),
    });
  }
}

const untestedByModule = {};
for (const policy of gating) {
  if (policy.testsPath) continue;
  untestedByModule[policy.module] = (untestedByModule[policy.module] ?? 0) + 1;
}

// ── report ─────────────────────────────────────────────────────────────────────

const row = (label, bucket) =>
  `  ${label.padEnd(24)} pairs=${String(bucket.pairs).padStart(5)}  agree=${String(bucket.agree).padStart(5)}  ` +
  `firing=${String(bucket.firing).padStart(4)}  diffs=${String(bucket.diffs.length).padStart(3)}  raw-shape=${bucket.rawShape}`;

console.log(`\nCohorts (${elapsed}s)`);
if (engineMode === 'wrapper') {
  console.log(
    '  note: RegoEngine maps an undefined rule to [], so it cannot report UNDEFINED.\n' +
      '        A non-zero raw-shape count is expected here and is never gated.',
  );
}
console.log(row('corpus / gating', tally.corpus.gating));
console.log(row('corpus / non-gating', tally.corpus.nonGating));
console.log(row('empty-input / gating', tally.emptyInput.gating));
console.log(row('empty-input / non-gating', tally.emptyInput.nonGating));

console.log(`\nCensus`);
console.log(`  builtin input sites (gating)     ${observedSites.length}`);
console.log(`  builtin input sites (non-gating) ${nonGatingSiteCount}  (characterisation only)`);
console.log(`  package collisions (gating)      ${observedCollisions.length}`);
console.log(`  gating policies without tests    ${Object.values(untestedByModule).reduce((a, b) => a + b, 0)}`);
for (const [module, count] of Object.entries(untestedByModule).sort()) {
  console.log(`    ${module}  ${count}`);
}

const showDiffs = (label, diffs) => {
  if (diffs.length === 0) return;
  console.log(`\n${label} (${diffs.length}):`);
  for (const diff of diffs.slice(0, 20)) {
    console.log(`  ${diff.policy} :: ${diff.rule} :: ${diff.case}`);
    console.log(`    ${diff.reason}  opa=${diff.opa} regorus=${diff.regorus}`);
    if (diff.nameDelta) {
      const { onlyInOpa, onlyInRegorus, sameNames } = diff.nameDelta;
      if (sameNames) console.log('    same finding names, differing bodies');
      if (onlyInOpa.length > 0) console.log(`    only in opa:     ${onlyInOpa.join(', ')}`);
      if (onlyInRegorus.length > 0) console.log(`    only in regorus: ${onlyInRegorus.join(', ')}`);
    }
    if (diff.throwMessage) console.log(`    regorus: ${diff.throwMessage.split('\n').pop()}`);
  }
  if (diffs.length > 20) console.log(`  … ${diffs.length - 20} more (see the JSON report)`);
};

const gatingDiffs = [...tally.corpus.gating.diffs, ...tally.emptyInput.gating.diffs];
const nonGatingDiffs = [...tally.corpus.nonGating.diffs, ...tally.emptyInput.nonGating.diffs];
showDiffs('GATING DIVERGENCES', gatingDiffs);
showDiffs('non-gating divergences (characterisation, not a failure)', nonGatingDiffs);

if (gatingDiffs.length > 0) fail(`${gatingDiffs.length} gating divergence(s) between opa ${foundOpa} and the committed Regorus blob`);

const verdict = failures.length === 0 ? 'pass' : 'fail';

if (process.env.REGO_PARITY_REPORT) {
  writeFileSync(
    process.env.REGO_PARITY_REPORT,
    JSON.stringify(
      {
        verdict,
        engineMode,
        opaVersion: foundOpa,
        roots,
        nonGatingRoots,
        elapsedSeconds: Number(elapsed),
        policies: { total: policies.length, gating: gating.length, nonGating: nonGating.length },
        cohorts: tally,
        census: { builtinSites: observedSites, collisions: observedCollisions, nonGatingSiteCount },
        untestedGatingPolicies: untestedByModule,
        registerErrors,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport → ${process.env.REGO_PARITY_REPORT}`);
}

console.log(`\nverdict: ${verdict.toUpperCase()}`);
process.exit(verdict === 'pass' ? 0 : 1);
