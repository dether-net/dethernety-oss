#!/usr/bin/env node
/**
 * Module content-hash generator for file-based Dethernety modules.
 *
 * Computes a deterministic fingerprint of a module's on-disk class data
 * (`data/<name>/**`) and records it as `module.json.contentHash`. The backend
 * compares this hash against the one stored on the `:Module` node at load time
 * and skips re-installing modules whose content has not changed.
 *
 * Run from a module directory (one that has `data/<name>/module.json`):
 *
 *   node ../../scripts/hash-module.mjs .            # write contentHash into module.json
 *   node ../../scripts/hash-module.mjs . --check    # verify committed hash (CI guard)
 *   node path/to/hash-module.mjs <module-dir>       # explicit path
 *
 * What is hashed:
 *   - All files under data/<name>/ are walked generically (no class-type
 *     allowlist), so any current or future class-kind directory is covered.
 *   - JSON files are canonicalized (recursively key-sorted, no whitespace) so
 *     export-time key-order / formatting churn does not change the hash.
 *   - Files under any `embeddings/` directory contribute their relative PATH
 *     only, not their float contents — adding/removing a `<model-slug>.json`
 *     flips the hash (model changed), but re-serialised floats do not.
 *   - `module.json`'s volatile fields (`exportedAt`, the `contentHash` output
 *     itself) are excluded; everything else is kept (erring toward extra
 *     reinstalls, never toward a silent skip).
 *
 * Stdlib-only (no dependencies), ESM. `.mjs` so it is unambiguously ESM
 * regardless of the nearest package.json `type` field.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MODULE_JSON = 'module.json';
const EMBEDDINGS_DIR = 'embeddings';
// module.json fields excluded from the digest: the output field itself plus the
// pure-timestamp stamp that churns on every export with no semantic meaning.
const MODULE_JSON_EXCLUDED_KEYS = ['contentHash', 'exportedAt'];

// ---------------------------------------------------------------------------
// Pure, testable functions
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute `data/<name>/` directory for a module.
 *
 * Resolution order:
 *   1. If `<moduleDir>/manifest.json` or `package.json` has a `name` and
 *      `data/<name>` exists, use it.
 *   2. Otherwise, if `data/` contains exactly one subdirectory, use it.
 *   3. Otherwise, throw.
 *
 * @param {string} moduleDir
 * @returns {string} absolute path to data/<name>
 */
export function resolveDataDir(moduleDir) {
  const root = path.resolve(moduleDir);
  const dataRoot = path.join(root, 'data');
  if (!fs.existsSync(dataRoot) || !fs.statSync(dataRoot).isDirectory()) {
    throw new Error(`No data/ directory found in module dir: ${root}`);
  }

  const declaredName = readModuleName(root);
  if (declaredName) {
    const byName = path.join(dataRoot, declaredName);
    if (fs.existsSync(byName) && fs.statSync(byName).isDirectory()) {
      return byName;
    }
  }

  const subdirs = fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (subdirs.length === 1) {
    return path.join(dataRoot, subdirs[0]);
  }

  throw new Error(
    `Could not resolve data/<name> in ${dataRoot}: ` +
      (declaredName
        ? `manifest/package name "${declaredName}" has no matching subdir, and `
        : 'no manifest/package name found, and ') +
      `data/ has ${subdirs.length} subdirectories (${subdirs.join(', ') || 'none'}). ` +
      `Expected exactly one.`,
  );
}

/**
 * Compute the content hash for a resolved `data/<name>` directory.
 * @param {string} dataDir
 * @returns {string} "sha256:<hex>"
 */
export function computeContentHash(dataDir) {
  const files = walkFiles(dataDir).sort(); // UTF-16 code-unit order — deterministic
  const hash = crypto.createHash('sha256');

  for (const relPath of files) {
    const absPath = path.join(dataDir, relPath);
    const payload = payloadFor(relPath, absPath);
    hash.update(relPath);
    hash.update('\0');
    hash.update(payload);
    hash.update('\0');
  }

  return `sha256:${hash.digest('hex')}`;
}

/**
 * Read the committed `module.json.contentHash` from a data dir (or null).
 * @param {string} dataDir
 * @returns {string|null}
 */
export function readStoredHash(dataDir) {
  const moduleJson = readModuleJson(dataDir);
  return typeof moduleJson.contentHash === 'string' ? moduleJson.contentHash : null;
}

/**
 * Write `contentHash` into the data dir's module.json, preserving existing key
 * order and the 2-space / no-trailing-newline format already in the repo.
 * @param {string} dataDir
 * @param {string} hash
 */
export function writeStoredHash(dataDir, hash) {
  const moduleJsonPath = path.join(dataDir, MODULE_JSON);
  const moduleJson = readModuleJson(dataDir);
  moduleJson.contentHash = hash; // append (or overwrite in place if present)
  fs.writeFileSync(moduleJsonPath, JSON.stringify(moduleJson, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readModuleName(moduleDir) {
  for (const file of ['manifest.json', 'package.json']) {
    const p = path.join(moduleDir, file);
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && typeof parsed.name === 'string' && parsed.name) {
        return parsed.name;
      }
    } catch {
      // Ignore unparseable manifest/package; fall through to single-subdir rule.
    }
  }
  return null;
}

function readModuleJson(dataDir) {
  const moduleJsonPath = path.join(dataDir, MODULE_JSON);
  if (!fs.existsSync(moduleJsonPath)) {
    throw new Error(`module.json not found: ${moduleJsonPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`Unable to parse ${moduleJsonPath}: ${err.message}`);
  }
}

/**
 * Recursively collect POSIX-style relative paths of all files under `dir`,
 * skipping hidden/junk entries (anything starting with ".").
 */
function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // .DS_Store, .gitkeep, etc.
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Compute the digest payload for one file given its POSIX relative path.
 */
function payloadFor(relPath, absPath) {
  const segments = relPath.split('/');

  // Embedding vectors (<classType>/<class>/embeddings/<slug>.json): hash the
  // path only (already fed to the digest), never the float contents. Anchor on
  // the file's immediate parent dir — not any segment — so a non-embedding file
  // (or a class literally named "embeddings") can't accidentally skip content
  // hashing, which would be a silent "content changed but hash didn't".
  if (segments.length >= 2 && segments[segments.length - 2] === EMBEDDINGS_DIR) {
    return '';
  }

  const name = segments[segments.length - 1];

  // Root module.json: canonicalize after dropping volatile keys.
  if (relPath === MODULE_JSON) {
    const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    for (const key of MODULE_JSON_EXCLUDED_KEYS) delete parsed[key];
    return canonicalize(parsed);
  }

  // Other JSON: canonicalize to neutralise key-order / whitespace churn.
  if (name.endsWith('.json')) {
    try {
      return canonicalize(JSON.parse(fs.readFileSync(absPath, 'utf8')));
    } catch {
      // Not valid JSON despite the extension — fall back to normalized text.
      return normalizeText(fs.readFileSync(absPath, 'utf8'));
    }
  }

  // Non-JSON (e.g. policies.rego): normalized raw text.
  return normalizeText(fs.readFileSync(absPath, 'utf8'));
}

/**
 * Deterministic JSON serialization: recursively sort object keys, no whitespace.
 */
function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Normalize text for hashing: CRLF → LF, strip trailing whitespace
 * (mirrors the loader's `.trim()` on rego at dt-file-opa-module.ts).
 */
function normalizeText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.filter((a) => a !== '--check');
  const check = argv.includes('--check');
  const moduleDir = args[0] ? path.resolve(args[0]) : process.cwd();

  let dataDir;
  try {
    dataDir = resolveDataDir(moduleDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const hash = computeContentHash(dataDir);

  if (check) {
    const stored = readStoredHash(dataDir);
    if (stored === hash) {
      console.log(`OK ${hash}`);
      process.exit(0);
    }
    console.error(
      `Content hash mismatch in ${path.join(dataDir, MODULE_JSON)}\n` +
        `  expected (committed): ${stored ?? '(none)'}\n` +
        `  actual (recomputed):  ${hash}\n` +
        `Run \`node ${path.basename(import.meta.url)} ${args[0] || '.'}\` to regenerate.`,
    );
    process.exit(1);
  }

  writeStoredHash(dataDir, hash);
  console.log(hash);
  process.exit(0);
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2));
}
