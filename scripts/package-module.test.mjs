/**
 * Unit tests for package-module.js and module-payload.mjs — run with:
 *   node --test oss/scripts/
 *
 * Node's built-in runner (node:test) + node:assert/strict, hermetic fixtures under
 * os.tmpdir(). oss/scripts/ has no Vitest wiring and resolves no dependencies; this is
 * the self-contained, zero-config choice, and it keeps the CI job to a bare Node with
 * no install step.
 *
 * The fixture deliberately contains NO policies.rego. The packager lints every policy
 * it finds through the real engine, which would pull in the base library's build
 * output and turn this suite into something that needs a full workspace build first.
 * The Rego gate has its own coverage; this suite is about payload shape and identity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  STAMP_FILENAME,
  computePayloadDigest,
  copyDirRecursive,
  frontendSkip,
  satisfiesCaret,
  checkDtModuleCompatibility,
} from './module-payload.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package-module.js');
const MODULE_NAME = 'fixture-mod';
const BUNDLE_BODY = 'export const ui = () => "hello";\n';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * A module tree exercising every branch the packager has: compiled JS (with a file
 * the extension allowlist must reject), a v2 data tree, and a frontend carrying the
 * three shapes that must be dropped plus one that must survive.
 */
function makeFixture({ compatibility } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-module-test-'));

  const manifest = { name: MODULE_NAME, version: '9.9.9', displayName: 'Fixture' };
  if (compatibility) manifest.compatibility = compatibility;
  writeJson(path.join(root, 'manifest.json'), manifest);

  // Compiled backend, as tsc would leave it.
  const js = path.join(root, 'dist', 'dethernety', MODULE_NAME);
  fs.mkdirSync(js, { recursive: true });
  fs.writeFileSync(path.join(js, 'FixtureModModule.js'), 'export class M {}\n');
  fs.writeFileSync(path.join(js, 'FixtureModModule.d.ts'), 'export declare class M {}\n');
  fs.writeFileSync(path.join(js, 'schema.graphql'), 'type Q { a: String }\n');
  fs.writeFileSync(path.join(js, 'notes.txt'), 'not a packaged extension\n');

  // v2 data tree — no policies.rego, see the header.
  const data = path.join(root, 'data', MODULE_NAME, 'component', 'x');
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(root, 'data', MODULE_NAME, 'module.json'), {
    formatVersion: 1,
    name: MODULE_NAME,
    version: '9.9.9',
  });
  writeJson(path.join(data, 'class.json'), { id: 'abc', name: 'X', classType: 'component' });

  // Frontend: one file the runtime reads, and four that it does not.
  const fe = path.join(root, 'frontend');
  fs.mkdirSync(path.join(fe, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(fe, '__tests__'), { recursive: true });
  fs.mkdirSync(path.join(fe, 'node_modules', '.vite'), { recursive: true });
  fs.mkdirSync(path.join(fe, 'lib', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(fe, 'lib', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(fe, 'bundle.js'), BUNDLE_BODY);
  fs.writeFileSync(path.join(fe, 'index.js'), 'source entry\n');
  fs.writeFileSync(path.join(fe, 'dist', 'bundle.js'), BUNDLE_BODY);
  fs.writeFileSync(path.join(fe, '__tests__', 'a.test.js'), 'test\n');
  fs.writeFileSync(path.join(fe, 'node_modules', '.vite', 'dep.js'), 'cache\n');
  fs.writeFileSync(path.join(fe, 'lib', 'util.js'), 'util\n');
  fs.writeFileSync(path.join(fe, 'lib', 'dist', 'keepme.js'), 'nested dist is content\n');
  fs.writeFileSync(path.join(fe, 'lib', 'node_modules', 'x.js'), 'nested junk\n');

  return {
    root,
    frontendDir: fe,
    packageDir: path.join(root, 'dist', 'package'),
    payloadDir: path.join(root, 'dist', 'package', 'dethernety', MODULE_NAME),
    archive: path.join(root, 'dist', `${MODULE_NAME}-9.9.9.tar.gz`),
  };
}

/** A legacy package: manifest plus flat .cypher, no compiled backend at all. */
function makeDataOnlyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-module-test-legacy-'));
  writeJson(path.join(root, 'manifest.json'), { name: 'legacy-mod', version: '0.1.0' });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', '01-seed.cypher'), 'CREATE (n:N);\n');
  return { root, packageDir: path.join(root, 'dist', 'package') };
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function withFixture(fn, opts) {
  const fx = makeFixture(opts);
  try {
    fn(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

/** Run the packager against a fixture root. GITHUB_SHA is stripped unless supplied. */
function pack(root, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (!('GITHUB_SHA' in extraEnv)) delete env.GITHUB_SHA;
  if (!('DETHERNETY_BUILD_SHA' in extraEnv)) delete env.DETHERNETY_BUILD_SHA;
  return spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', env });
}

/** Sorted POSIX-relative paths of every regular file under `dir`. */
function listTree(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) listTree(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

function readStamp(payloadDir) {
  return JSON.parse(fs.readFileSync(path.join(payloadDir, STAMP_FILENAME), 'utf8'));
}

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------

test('the packaged tree is exactly the expected file set', () => {
  withFixture((fx) => {
    const res = pack(fx.root);
    assert.equal(res.status, 0, res.stderr);

    // One assertion covering both over- and under-exclusion, and any future
    // accidental addition. A per-file check would pass while something new crept in.
    assert.deepEqual(listTree(fx.packageDir), [
      'dethernety/fixture-mod/.dethernety-module.json',
      'dethernety/fixture-mod/FixtureModModule.d.ts',
      'dethernety/fixture-mod/FixtureModModule.js',
      'dethernety/fixture-mod/data/fixture-mod/component/x/class.json',
      'dethernety/fixture-mod/data/fixture-mod/module.json',
      'dethernety/fixture-mod/frontend/bundle.js',
      'dethernety/fixture-mod/schema.graphql',
      'manifest.json',
    ]);
  });
});

test('frontend/bundle.js survives byte-identical', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const packaged = fs.readFileSync(path.join(fx.payloadDir, 'frontend', 'bundle.js'));
    const source = fs.readFileSync(path.join(fx.frontendDir, 'bundle.js'));
    assert.ok(packaged.equals(source));
  });
});

test('the data tree is copied unfiltered — this change did not touch it', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const packaged = listTree(path.join(fx.payloadDir, 'data'));
    const source = listTree(path.join(fx.root, 'data'));
    assert.deepEqual(packaged, source);
  });
});

test('step 2 still rejects an extension outside its allowlist', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    assert.equal(fs.existsSync(path.join(fx.payloadDir, 'notes.txt')), false);
  });
});

test('a frontend without bundle.js fails the build and names the file', () => {
  withFixture((fx) => {
    fs.rmSync(path.join(fx.frontendDir, 'bundle.js'));
    const res = pack(fx.root);
    // The alternative is a module that loads, reports healthy, and renders nothing.
    assert.equal(res.status, 1);
    assert.match(res.stderr, /frontend\/bundle\.js/);
  });
});

// ---------------------------------------------------------------------------
// Identity stamp
// ---------------------------------------------------------------------------

test('the stamp carries exactly four keys', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const stamp = readStamp(fx.payloadDir);
    // Exact, not a subset: a field added without thought is a field a consumer starts
    // depending on.
    assert.deepEqual(Object.keys(stamp).sort(), [
      'builtFrom', 'name', 'payloadDigest', 'version',
    ]);
    assert.equal(stamp.name, MODULE_NAME);
    assert.equal(stamp.version, '9.9.9');
    assert.match(stamp.payloadDigest, /^sha256:[0-9a-f]{64}$/);
  });
});

test('builtFrom is null outside a repository, and that is not fatal', () => {
  withFixture((fx) => {
    const res = pack(fx.root);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readStamp(fx.payloadDir).builtFrom, null);
  });
});

test('builtFrom honours GITHUB_SHA when there is no repository', () => {
  withFixture((fx) => {
    const sha = 'a'.repeat(40);
    assert.equal(pack(fx.root, { GITHUB_SHA: sha }).status, 0);
    assert.equal(readStamp(fx.payloadDir).builtFrom, sha);
  });
});

test('a malformed GITHUB_SHA is refused rather than recorded', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root, { GITHUB_SHA: 'not-a-sha' }).status, 0);
    assert.equal(readStamp(fx.payloadDir).builtFrom, null);
  });
});

test('the stamp is inside the archive', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const listing = execFileSync('tar', ['-tzf', fx.archive], { encoding: 'utf8' });
    // Guards the write-before-tar ordering, and any packaging path that later decides
    // to strip dotfiles.
    assert.ok(listing.includes(`./dethernety/${MODULE_NAME}/${STAMP_FILENAME}`), listing);
  });
});

test('a data-only package gets no stamp and still succeeds', () => {
  const fx = makeDataOnlyFixture();
  try {
    const res = pack(fx.root);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(listTree(fx.packageDir), ['data/01-seed.cypher', 'manifest.json']);
    assert.equal(fs.existsSync(path.join(fx.packageDir, 'dethernety')), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// payloadDigest
// ---------------------------------------------------------------------------

test('a digest recomputed over the installed tree equals the stamp it contains', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    // The recompute invariant. The packager computes the digest before the stamp
    // exists; anything re-deriving it does so over a tree that contains the stamp. If
    // the stamp were not excluded from its own digest, the two would never agree.
    assert.equal(computePayloadDigest(fx.payloadDir), readStamp(fx.payloadDir).payloadDigest);
  });
});

test('identical content yields an identical digest', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const first = readStamp(fx.payloadDir).payloadDigest;
    assert.equal(pack(fx.root).status, 0);
    assert.equal(readStamp(fx.payloadDir).payloadDigest, first);
  });
});

test('a one-byte change to the bundle flips the digest', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const before = readStamp(fx.payloadDir).payloadDigest;

    fs.writeFileSync(path.join(fx.frontendDir, 'bundle.js'), `${BUNDLE_BODY}//x\n`);
    assert.equal(pack(fx.root).status, 0);
    assert.notEqual(readStamp(fx.payloadDir).payloadDigest, before);
  });
});

test('a rename with identical bytes flips the digest', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const before = computePayloadDigest(fx.payloadDir);

    // Paths are hashed, not just contents — otherwise moving a file past the loader's
    // *Module.js gate would be invisible.
    fs.renameSync(
      path.join(fx.payloadDir, 'schema.graphql'),
      path.join(fx.payloadDir, 'other.graphql'),
    );
    assert.notEqual(computePayloadDigest(fx.payloadDir), before);
  });
});

test('excluded source files do not reach the digest', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const before = readStamp(fx.payloadDir).payloadDigest;

    fs.writeFileSync(path.join(fx.frontendDir, '__tests__', 'b.test.js'), 'more\n');
    assert.equal(pack(fx.root).status, 0);
    // The digest describes the payload, not the source tree it was built from.
    assert.equal(readStamp(fx.payloadDir).payloadDigest, before);
  });
});

test('manifest.json is outside the digest — the root is the installed tree', () => {
  withFixture((fx) => {
    assert.equal(pack(fx.root).status, 0);
    const before = readStamp(fx.payloadDir).payloadDigest;

    const manifestPath = path.join(fx.root, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    m.displayName = 'Changed';
    writeJson(manifestPath, m);

    assert.equal(pack(fx.root).status, 0);
    // Pins the root choice as a decision. The digest answers "is the installed
    // directory current", which manifest.json never reaches.
    assert.equal(readStamp(fx.payloadDir).payloadDigest, before);
  });
});

test('the digest refuses a non-regular entry rather than hashing it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-digest-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'real.js'), 'x\n');
    fs.symlinkSync('/etc/passwd', path.join(dir, 'link.js'));
    assert.throws(() => computePayloadDigest(dir), /non-regular entry/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// copyDirRecursive / frontendSkip
// ---------------------------------------------------------------------------
//
// The frontend allowlist means these are not on the packager's path today. They are
// the mechanism the moment a payload ships more than one file, and the anchoring rule
// is subtle enough to be worth pinning before then.

test('frontendSkip drops junk at any depth but dist only at the root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-skip-test-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-skip-out-'));
  try {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(dir, '__tests__'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'lib', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'lib', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bundle.js'), 'b\n');
    fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'b\n');
    fs.writeFileSync(path.join(dir, '__tests__', 'a.test.js'), 't\n');
    fs.writeFileSync(path.join(dir, 'lib', 'util.js'), 'u\n');
    fs.writeFileSync(path.join(dir, 'lib', 'dist', 'keepme.js'), 'k\n');
    fs.writeFileSync(path.join(dir, 'lib', 'node_modules', 'x.js'), 'j\n');

    copyDirRecursive(dir, dest, frontendSkip);

    assert.deepEqual(listTree(dest), [
      'bundle.js',
      // Anchored: a nested dist is ordinary content and must survive.
      'lib/dist/keepme.js',
      'lib/util.js',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('copyDirRecursive without a predicate copies everything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-all-test-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-all-out-'));
  try {
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'j\n');
    fs.writeFileSync(path.join(dir, 'a.json'), '{}\n');

    // The default must stay byte-identical to the old two-argument behaviour: the
    // data and langgraph call sites rely on it.
    copyDirRecursive(dir, dest);
    assert.deepEqual(listTree(dest), ['a.json', 'node_modules/x.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

test('satisfiesCaret follows npm caret semantics', () => {
  // The leftmost non-zero component is the one that may not change.
  for (const [range, version, expected] of [
    ['^0.11.0', '0.11.0', true],
    ['^0.11.0', '0.11.5', true],
    ['^0.11.0', '0.10.9', false],
    ['^0.11.0', '0.12.0', false],
    ['^0.11.0', '1.0.0', false],
    ['^1.2.0', '1.2.0', true],
    ['^1.2.0', '1.9.9', true],
    ['^1.2.0', '1.1.9', false],
    ['^1.2.0', '2.0.0', false],
    ['^0.0.3', '0.0.3', true],
    ['^0.0.3', '0.0.4', false],
  ]) {
    assert.equal(satisfiesCaret(version, range), expected, `${version} vs ${range}`);
  }
});

test('a range the checker cannot evaluate throws rather than passing', () => {
  // The important negative. Silently accepting an unparseable range would turn the
  // whole assertion into decoration.
  for (const range of ['>=0.11 <1', '*', '0.11.x', '~0.11.0', '0.11.0', '^0.11', '']) {
    assert.throws(() => satisfiesCaret('0.11.0', range), /caret range/, range);
  }
});

test('an absent compatibility block is a skip, not a failure', () => {
  assert.deepEqual(checkDtModuleCompatibility({ name: 'm' }, '0.11.0'), {
    ok: true, skipped: true,
  });
});

test('a non-string compatibility value is a failure', () => {
  const v = checkDtModuleCompatibility({ compatibility: { dtModule: 11 } }, '0.11.0');
  assert.equal(v.ok, false);
  assert.match(v.reason, /must be a string/);
});

test('an unsatisfied range fails and names both sides', () => {
  const v = checkDtModuleCompatibility({ compatibility: { dtModule: '^9.0.0' } }, '0.11.0');
  assert.equal(v.ok, false);
  assert.match(v.reason, /\^9\.0\.0/);
  assert.match(v.reason, /0\.11\.0/);
});

test('the packager refuses an unsatisfiable declaration', () => {
  withFixture((fx) => {
    const res = pack(fx.root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Compatibility check failed/);
    assert.match(res.stderr, /\^99\.0\.0/);
  }, { compatibility: { dtModule: '^99.0.0' } });
});

test('a failing compatibility check does not destroy the previous package', () => {
  withFixture((fx) => {
    // Build once so there is something to lose.
    assert.equal(pack(fx.root).status, 0);
    const sentinel = path.join(fx.packageDir, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'previous build\n');

    const manifestPath = path.join(fx.root, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    m.compatibility = { dtModule: '^99.0.0' };
    writeJson(manifestPath, m);

    assert.equal(pack(fx.root).status, 1);
    // The check runs before the wipe: a build that is going to fail must not first
    // delete the working package.
    assert.ok(fs.existsSync(sentinel));
  });
});
