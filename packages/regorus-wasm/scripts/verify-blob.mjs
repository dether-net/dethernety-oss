#!/usr/bin/env node
/**
 * Integrity gate for the vendored Regorus WASM blob.
 *
 * Wired as this package's `build` script, so `turbo build` (and therefore
 * `oss/scripts/build.sh`) verifies the blob on every build. This is the
 * tripwire for silent binary corruption — most plausibly a text-mode git
 * round-trip (see the repo `.gitattributes`, which marks *.wasm binary).
 *
 * A corrupted .wasm would otherwise only surface as a runtime CompileError
 * inside the container, far from the change that caused it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sumsPath = join(pkgDir, 'SHA256SUMS');

let expected;
try {
  expected = readFileSync(sumsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, name] = line.trim().split(/\s+/);
      return { hash, name };
    });
} catch {
  console.error(`[regorus-wasm] FATAL: cannot read ${sumsPath}`);
  process.exit(1);
}

let failed = false;
for (const { hash, name } of expected) {
  let actual;
  try {
    actual = createHash('sha256').update(readFileSync(join(pkgDir, name))).digest('hex');
  } catch {
    console.error(`[regorus-wasm] FATAL: missing artifact ${name}`);
    failed = true;
    continue;
  }
  if (actual !== hash) {
    console.error(`[regorus-wasm] FATAL: ${name} checksum mismatch`);
    console.error(`  expected ${hash}`);
    console.error(`  actual   ${actual}`);
    console.error('  The blob is corrupt or was rebuilt without refreshing SHA256SUMS.');
    console.error('  If you intentionally rebuilt it, run: pnpm build:wasm');
    failed = true;
  } else {
    console.log(`[regorus-wasm] ok  ${name}  (sha256 ${hash.slice(0, 12)}…)`);
  }
}

process.exit(failed ? 1 : 0);
