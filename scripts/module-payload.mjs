/**
 * Payload identity for packaged Dethernety modules.
 *
 * `.mjs` so it is unambiguously ESM regardless of the nearest package.json `type`
 * field — the same reason `hash-module.mjs` carries the extension.
 *
 * `payloadDigest` is a stable identifier for a packaged module's payload tree. It is
 * recomputable: any tool that re-derives it over an unpacked copy must reproduce two
 * encoding choices exactly, or the values will disagree — and both are invisible to a
 * JS-only test suite, so they are spelled out here:
 *
 *   - the sort is over UTF-8 BYTES, not UTF-16 code units (see `computePayloadDigest`)
 *   - each record is length-prefixed, so the framing is unambiguous
 *
 * ## `payloadDigest` is not `contentHash`
 *
 * `hash-module.mjs` computes `contentHash` over `data/<name>/**` and stores it in
 * `module.json`. It answers "did this module's authored class data change". This
 * file's `payloadDigest` covers the whole installed tree and answers "is this the same
 * payload". Different scopes, deliberately different names. Neither may be substituted
 * for the other: keyed on `contentHash`, a code-only change produces an identical value
 * and a change would go unnoticed.
 *
 * ## What `payloadDigest` deliberately does not cover
 *
 *   - **Empty directories.** They are invisible to the walk. The module loader
 *     ascribes no meaning to one, so this is acceptable — but it is a difference from
 *     the tarball, which does record them.
 *   - **File modes.** A file losing its executable bit digests identically.
 *     Irrelevant for a JavaScript payload.
 *   - **Unicode normalisation.** Directory listings return NFD on some platforms and
 *     NFC on others. No payload carries a non-ASCII filename today; if one ever does,
 *     packages built on different platforms could disagree.
 *
 * It is also not a reproducibility proof. Compiler output is deterministic for a
 * fixed input *and toolchain*, not across toolchains. The digest answers "is this the
 * same payload", never "was this built from the same source".
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * Written into the payload root so an installed module carries its own identity.
 * Invisible to the module loader, which keeps only directories at the modules root
 * and only `*Module.js` inside one.
 */
export const STAMP_FILENAME = '.dethernety-module.json';

const NUL = Buffer.from([0]);

// ---------------------------------------------------------------------------
// Payload digest
// ---------------------------------------------------------------------------

/**
 * Content digest over a module's installed payload tree.
 *
 * Deliberately NOT a digest of the tarball. The archive is built without
 * `--sort`, `--mtime` or ownership normalisation and gzip is not given `-n`, so it
 * embeds file mtimes and a gzip header timestamp: two builds of byte-identical
 * content produce different archives. An archive digest would therefore differ on
 * every rebuild and defeat the exact "unchanged, skip it" case this value exists to
 * serve.
 *
 * Raw bytes, never canonicalised JSON. The inputs are compiler output, so there is
 * no key-order churn to neutralise — and more importantly, two byte-different payloads
 * must never share a digest, or a real change would read as "unchanged". Err toward
 * reporting a difference; a false "unchanged" is the failure this exists to prevent.
 *
 * @param {string} payloadDir  the module's payload root
 * @param {{exclude?: string[]}} [opts]  POSIX-relative paths to omit
 * @returns {string} `sha256:<64 lowercase hex>`
 */
export function computePayloadDigest(payloadDir, { exclude = [STAMP_FILENAME] } = {}) {
  const excluded = new Set(exclude);
  const files = walkFiles(payloadDir, payloadDir).filter((rel) => !excluded.has(rel));

  // UTF-8 byte order, stated explicitly. JavaScript's default string sort compares
  // UTF-16 code units; a byte-wise sort (what most other languages give you) differs
  // above the Basic Multilingual Plane. Pinning the order removes the question
  // instead of betting that no payload ever ships such a filename.
  files.sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));

  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    const bytes = fs.readFileSync(path.join(payloadDir, rel));
    // Length-prefixed, so the encoding is prefix-free: no combination of a path and
    // file contents can be re-split into a different (path, contents) pair. Framing
    // by separator alone is ambiguous once contents may themselves contain the
    // separator, which minified JavaScript and source maps can.
    hash.update(Buffer.from(rel, 'utf8'));
    hash.update(NUL);
    hash.update(Buffer.from(String(bytes.length), 'utf8'));
    hash.update(NUL);
    hash.update(bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Every regular file under `dir`, as POSIX-relative paths against `base`.
 *
 * No dotfile skip. `hash-module.mjs` skips them because a stray `.DS_Store` in an
 * exported data tree is junk; in a code payload a dot-prefixed file is content — the
 * identity stamp itself is one.
 */
function walkFiles(dir, base, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    } else {
      // A symlink, socket or device in a payload is either a packaging accident or
      // an attempt to smuggle one. Either way, refuse rather than digest something
      // whose meaning depends on where it is unpacked.
      throw new Error(`payload digest: refusing to hash non-regular entry ${abs}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build provenance
// ---------------------------------------------------------------------------

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * The commit a payload was built from, or `null` when it cannot be established.
 *
 * `null` rather than a sentinel string: `"unknown"` invites `if (sha !== 'unknown')`
 * at the consumer and collides the day someone names a branch `unknown`.
 *
 * Note that a build cache which restores `dist/` wholesale will also restore a stamp
 * written by an earlier run, so `builtFrom` can name the commit at which the cache
 * entry was created rather than the current checkout. That commit's tree did produce
 * this payload, so the value is not wrong — but it is not a reliable answer to "which
 * commit am I looking at". `payloadDigest` is unaffected: it is derived from content,
 * which the cache preserves exactly.
 */
export function resolveBuiltFrom(cwd) {
  // An explicit override first — this is the answer for a container build, where the
  // context is usually copied without any version-control metadata.
  const fromEnv = process.env.DETHERNETY_BUILD_SHA || process.env.GITHUB_SHA;
  if (fromEnv && SHA_RE.test(fromEnv)) return fromEnv;

  try {
    // execFileSync, not execSync: no shell, so no interpolation surface.
    const sha = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!SHA_RE.test(sha)) return null;

    // Scoped to this module directory. A monorepo always has something uncommitted
    // somewhere, and an unscoped check would mark every local build dirty forever.
    // Ignored build outputs do not appear in --porcelain, which is the right
    // semantics: a build output is not source drift.
    const dirty = execFileSync('git', ['-C', cwd, 'status', '--porcelain', '--', '.'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().length > 0;

    // Without the suffix, a field named `builtFrom` could name a commit whose tree
    // never produced this payload — an honesty defect in the one field a consumer
    // would trust for provenance.
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    // No repository, no git binary, a source archive rather than a checkout. Never
    // fatal: the payload is valid without provenance.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Filtered copy
// ---------------------------------------------------------------------------

/** Build junk, by basename, at any depth. `dist` is deliberately absent — see below. */
const JUNK_DIR_NAMES = new Set(['node_modules', '__tests__']);

/** Excluded only at the copy root, so `frontend/dist` goes and `frontend/lib/dist` stays. */
const ROOT_ONLY_SKIPS = new Set(['dist']);

/**
 * Skip predicate for a module frontend tree.
 *
 * `dist` is matched against the ROOT-RELATIVE path, not the basename. A basename rule
 * would be a quiet trap: `dist` is an ordinary directory name, and a frontend that
 * nests one under `lib/` would have it silently dropped.
 */
export function frontendSkip(relPath, entry) {
  if (!entry.isDirectory()) return false;
  return JUNK_DIR_NAMES.has(entry.name) || ROOT_ONLY_SKIPS.has(relPath);
}

/**
 * Recursive copy with an optional skip predicate.
 *
 * `skip` defaults to null so existing call sites keep their exact behaviour.
 *
 * @param {(relPath: string, entry: fs.Dirent) => boolean | null} [skip]
 */
export function copyDirRecursive(src, dest, skip = null, relBase = '') {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (skip && skip(rel, entry)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, skip, rel);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    } else {
      // Previously a symlinked directory reached copyFileSync and threw a bare
      // EISDIR naming nothing, while a symlinked file was silently dereferenced and
      // packaged as content. Name what was refused.
      throw new Error(`package: refusing to copy non-regular entry ${srcPath}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

const CARET = /^\^(\d+)\.(\d+)\.(\d+)$/;
const EXACT = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * Caret-range satisfaction, stdlib only.
 *
 * `oss/scripts/` is not a workspace package and resolves no dependencies, which is
 * what lets its tests run on a bare Node with no install step. A full semver
 * implementation is not available here, so the supported grammar is deliberately one
 * shape — and anything outside it THROWS. A range this cannot evaluate must fail the
 * build; treating it as satisfied would turn an assertion into decoration.
 *
 * Caret semantics follow npm: the leftmost non-zero component is the one that may not
 * change. For a 0.x version that makes the minor the breaking axis, so `^0.11.0`
 * admits 0.11.x and rejects 0.12.0.
 *
 * A prerelease or build suffix on `actual` is tolerated and ignored. Strict semver
 * would exclude a prerelease from a range that does not name one; the simplification
 * is documented rather than silently assumed, and matters only if the compared
 * package starts publishing prereleases.
 */
export function satisfiesCaret(actual, range) {
  const r = CARET.exec(range);
  if (!r) {
    throw new Error(
      `compatibility.dtModule must be a caret range "^X.Y.Z" (got "${range}"). ` +
      'Richer semver ranges are deliberately unsupported: this check is stdlib-only, ' +
      'and a range it cannot evaluate must not be treated as satisfied.',
    );
  }
  const a = EXACT.exec(actual ?? '');
  if (!a) {
    throw new Error(`cannot read the installed version to compare against (got "${actual}")`);
  }

  const [rMaj, rMin, rPat] = r.slice(1, 4).map(Number);
  const [aMaj, aMin, aPat] = a.slice(1, 4).map(Number);

  // Lower bound.
  if ((aMaj - rMaj || aMin - rMin || aPat - rPat) < 0) return false;

  // Upper bound: pin the leftmost non-zero component.
  if (rMaj > 0) return aMaj === rMaj;
  if (rMin > 0) return aMaj === 0 && aMin === rMin;
  return aMaj === 0 && aMin === 0 && aPat === rPat;
}

/**
 * Check a manifest's declared base-library compatibility against what is installed.
 *
 * Returns a verdict and never exits — the caller owns the process. That is what makes
 * it testable against a fixed version pair instead of a test that rots the next time
 * the base library moves.
 *
 * Declaring `compatibility` is opt-in. A data-only module that never loads JavaScript
 * cannot be incompatible with the base library, and requiring the field everywhere
 * would mean editing manifests that have no reason to carry it.
 */
export function checkDtModuleCompatibility(manifest, actualVersion) {
  const declared = manifest?.compatibility?.dtModule;
  if (declared === undefined) return { ok: true, skipped: true };

  if (typeof declared !== 'string') {
    return { ok: false, reason: 'compatibility.dtModule must be a string such as "^0.11.0"' };
  }
  try {
    return satisfiesCaret(actualVersion, declared)
      ? { ok: true, declared, actual: actualVersion }
      : {
          ok: false,
          declared,
          actual: actualVersion,
          reason: `manifest declares "${declared}", but @dethernety/dt-module is ${actualVersion}`,
        };
  } catch (err) {
    return { ok: false, declared, actual: actualVersion, reason: err.message };
  }
}
