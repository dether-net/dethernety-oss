// Tests for check-module-embeddings.mjs: node --test scripts/check-module-embeddings.test.mjs
//
// The gate loads TypeScript sources by Node's type stripping. On a Node that has it off by default (before 22.18), this
// file runs itself again with it on.

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.features.typescript) {
  const self = fileURLToPath(import.meta.url);
  const run = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', self],
    // Without NODE_TEST_CONTEXT, which marks a child of the test runner: with it, the child would run no tests.
    { stdio: 'inherit', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) },
  );
  process.exit(run.status ?? 1);
}

const { after, test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const ossRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(ossRoot, rel)).href);
const composer = await load('packages/dt-module/src/embedding-text.ts');
const lib = await load('scripts/lib/class-vectors.ts');
const { checkModules, parseArgs } = await load('scripts/check-module-embeddings.mjs');

const profile = lib.readVectorProfile(ossRoot, lib.readDefaultProfileId(ossRoot));
const unit = (n) => Array.from({ length: n }, (_v, i) => (i === 0 ? 1 : 0));

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
const mkTmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

/** A modules root with one module, `mod`, holding the given classes; returns the root and each class directory. */
function scaffold(classes) {
  const root = mkTmp('embeddings-gate-');
  const moduleDir = path.join(root, 'mod');
  writeJson(path.join(moduleDir, 'manifest.json'), { name: 'mod', version: '1.0.0' });
  const dataDir = path.join(moduleDir, 'data', 'mod');
  writeJson(path.join(dataDir, 'module.json'), { name: 'mod' });
  const dirs = {};
  for (const c of classes) {
    const classDir = path.join(dataDir, c.dir, c.slug);
    writeJson(path.join(classDir, 'class.json'), c.def);
    dirs[c.slug] = classDir;
  }
  return { root, moduleDir, dataDir, dirs };
}

/** A current vector file for the class in `classDir`, with `override` fields replacing the good ones. */
function writeVector(classDir, classTypeDir, override = {}) {
  const def = JSON.parse(fs.readFileSync(path.join(classDir, 'class.json'), 'utf8'));
  const contentHash = composer.hashEmbeddingText(composer.classEmbeddingText(def, classTypeDir));
  const body = { profile: profile.id, revision: profile.revision, contentHash, vector: unit(profile.dimensions), ...override };
  writeJson(lib.vectorFilePath(classDir, profile, composer), Array.isArray(override) ? override : body);
}

const web = { dir: 'component', slug: 'web', def: { name: 'Web server', type: 'PROCESS', description: 'Serves pages', category: 'Compute' } };
const gap = { dir: 'issue', slug: 'gap', def: { name: 'Gap', description: 'A missing control' } };
const problemsOf = (root, excludes = []) => checkModules([root], excludes).problems.map((p) => p.problem);

test('a current vector file for every class passes', () => {
  const { root, dirs } = scaffold([web, gap]);
  writeVector(dirs.web, 'component');
  writeVector(dirs.gap, 'issue');
  const result = checkModules([root], []);
  assert.deepEqual(result.problems, []);
  assert.equal(result.classes, 2);
  assert.equal(result.modules, 1);
});

test('a class without a vector file fails', () => {
  const { root } = scaffold([web]);
  assert.deepEqual(problemsOf(root), ['no vector file']);
});

test('a class edited after its vector was made fails as stale', () => {
  const { root, dirs } = scaffold([web]);
  writeVector(dirs.web, 'component');
  writeJson(path.join(dirs.web, 'class.json'), { ...web.def, description: 'Serves pages and an API' });
  assert.equal(problemsOf(root).length, 1);
  assert.match(problemsOf(root)[0], /^stale/);
});

test('a vector made for another profile or weights revision fails', () => {
  const { root, dirs } = scaffold([web]);
  writeVector(dirs.web, 'component', { profile: 'embeddinggemma' });
  assert.match(problemsOf(root).join('\n'), /profile "embeddinggemma"/);
  writeVector(dirs.web, 'component', { revision: 'main' });
  assert.match(problemsOf(root).join('\n'), /revision "main"/);
});

test('a bare array, the old file shape, fails', () => {
  const { root, dirs } = scaffold([web]);
  writeVector(dirs.web, 'component', unit(profile.dimensions));
  assert.match(problemsOf(root)[0], /not a \{profile/);
});

test('a vector of the wrong length, with a value that is not finite, or not of unit norm fails', () => {
  const { root, dirs } = scaffold([web]);
  writeVector(dirs.web, 'component', { vector: unit(profile.dimensions - 1) });
  assert.match(problemsOf(root)[0], /values, not/);
  writeVector(dirs.web, 'component', { vector: [...unit(profile.dimensions - 1), null] });
  assert.match(problemsOf(root)[0], /not a finite number/);
  writeVector(dirs.web, 'component', { vector: unit(profile.dimensions).map((v) => v * 1.01) });
  assert.match(problemsOf(root)[0], /^norm/);
  writeVector(dirs.web, 'component', { vector: unit(profile.dimensions).map((v) => v * (1 + lib.UNIT_NORM_TOLERANCE / 2)) });
  assert.deepEqual(problemsOf(root), []);
});

test('an old-slug file beside the current one fails, and so does an embeddings directory outside a class', () => {
  const { root, dataDir, dirs } = scaffold([web]);
  writeVector(dirs.web, 'component');
  writeJson(path.join(dirs.web, 'embeddings', 'embeddinggemma.json'), unit(profile.dimensions));
  assert.deepEqual(problemsOf(root), ["not the default profile's vector file; remove it"]);
  fs.rmSync(path.join(dirs.web, 'embeddings', 'embeddinggemma.json'));
  writeJson(path.join(dataDir, 'analysis', 'report', 'embeddings', 'x.json'), []);
  assert.deepEqual(problemsOf(root), ['an embeddings directory outside a class directory']);
});

test('a component of a type the platform skips needs no vector; a broken class.json is a defect', () => {
  const { root, dirs } = scaffold([{ dir: 'component', slug: 'odd', def: { name: 'Odd', type: 'WIDGET' } }]);
  assert.deepEqual(problemsOf(root), []);
  writeJson(path.join(dirs.odd, 'class.json'), '{not json');
  assert.match(problemsOf(root)[0], /^malformed class.json/);
});

test('an excluded module is not checked', () => {
  const { root, moduleDir } = scaffold([web]);
  assert.deepEqual(problemsOf(root, [moduleDir]), []);
});

test('the default profile id is read from its one definition', () => {
  const fake = mkTmp('embeddings-gate-oss-');
  const source = path.join(fake, lib.DEFAULT_PROFILE_SOURCE);
  writeJson(source, "export const DEFAULT_EMBEDDING_PROFILE_ID = 'p-1';\n");
  assert.equal(lib.readDefaultProfileId(fake), 'p-1');
  writeJson(source, "export const DEFAULT_EMBEDDING_PROFILE_ID = 'p-1';\nexport const DEFAULT_EMBEDDING_PROFILE_ID = 'p-2';\n");
  assert.throws(() => lib.readDefaultProfileId(fake), /found 2/);
  writeJson(source, '// moved\n');
  assert.throws(() => lib.readDefaultProfileId(fake), /found 0/);
  assert.equal(lib.readDefaultProfileId(ossRoot), profile.id);
});

test('the command line takes roots and excludes, and needs a root', () => {
  assert.deepEqual(parseArgs(['a', '--exclude', 'a/x', 'b']), { roots: ['a', 'b'], excludes: ['a/x'] });
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['a', '--exclude']), /needs a module path/);
  assert.throws(() => parseArgs(['--root', 'a']), /unknown argument/);
});
