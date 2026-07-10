#!/usr/bin/env node
/**
 * Regenerate `src/rego-builtins.ts` — the partition of OPA's builtin set into the names
 * the vendored Regorus WASM engine supports and the names it lacks.
 *
 * The partition must be MEASURED, not transcribed: the vendored blob is feature-trimmed
 * (`--no-default-features`), so upstream Regorus documentation does not describe it, and
 * `addPolicy` cannot be asked — Regorus resolves function names lazily at evaluation, so
 * an unsupported builtin parses fine and only fails when its clause actually runs.
 *
 * Method: take the candidate names from the reference `opa` binary's own capability
 * report, then probe each one against the blob with a zero-argument call. Arity does not
 * matter for classification — a present builtin fails with an arity/type complaint, an
 * absent one fails with "could not find function".
 *
 * Needs `opa` on PATH (same posture as the parity gate; this script is run manually when
 * the blob or the pinned OPA version changes, never as part of `build`).
 *
 *   node scripts/generate-builtins.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Engine } = require('@dethernety/regorus-wasm');

const opaVersion = execFileSync('opa', ['version'], { encoding: 'utf8' })
  .split('\n')[0]
  .replace(/^Version:\s*/, '')
  .trim();
const capabilities = JSON.parse(
  execFileSync('opa', ['capabilities', '--current'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);
const candidates = capabilities.builtins.map((b) => b.name).sort();

const wasmPath = require.resolve('@dethernety/regorus-wasm/regorusjs_bg.wasm');
const blobSha = createHash('sha256').update(readFileSync(wasmPath)).digest('hex');

const supported = [];
const unsupported = [];
const unclassified = [];

for (const name of candidates) {
  const engine = new Engine();
  engine.setPolicyLengthConfig({ maxCol: 8192, maxFileBytes: 4 * 1024 * 1024, maxLines: 100_000 });
  let message = null;
  try {
    const pkg = engine.addPolicy('probe.rego', `package probe\n\nx := ${name}()\n`);
    engine.setInputJson('{}');
    engine.evalQuery(`${pkg}.x`);
  } catch (err) {
    message = String(err?.message ?? err);
  } finally {
    engine.free();
  }
  if (message === null) supported.push(name);
  else if (message.includes('could not find function')) unsupported.push(name);
  else if (/expects .* argument|type mismatch|expects.*parameter|invalid.*type/i.test(message)) supported.push(name);
  else unclassified.push({ name, message: message.split('\n').filter(Boolean).pop() });
}

if (unclassified.length > 0) {
  console.error('Refusing to write a partition with unclassified names — inspect these probes:');
  for (const { name, message } of unclassified) console.error(`  ${name}: ${message}`);
  process.exit(1);
}

const banner = `/**
 * GENERATED — do not edit. Regenerate with \`node scripts/generate-builtins.mjs\`.
 *
 * The builtin names of OPA ${opaVersion}, partitioned by probing each one against the
 * vendored Regorus WASM blob (sha256 ${blobSha.slice(0, 16)}…). Regorus resolves function
 * names lazily at evaluation, so this measured partition is the only way to know at
 * build time whether a policy calls something the engine lacks.
 */`;

const list = (names) => names.map((n) => `  '${n}',`).join('\n');
writeFileSync(
  path.join(HERE, '..', 'src', 'rego-builtins.ts'),
  `${banner}

/** Builtins the vendored engine evaluates. */
export const SUPPORTED_BUILTINS: ReadonlySet<string> = new Set([
${list(supported)}
]);

/** OPA builtins absent from the trimmed blob — calling one fails at evaluation. */
export const UNSUPPORTED_BUILTINS: ReadonlySet<string> = new Set([
${list(unsupported)}
]);
`,
);

console.log(`opa ${opaVersion}: ${candidates.length} candidates -> ${supported.length} supported, ${unsupported.length} absent`);
console.log('wrote src/rego-builtins.ts');
