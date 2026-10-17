#!/usr/bin/env node
/**
 * Every class a module ships must carry its vector for the platform's default embedding profile, made from the class
 * text as it is now. Otherwise the platform embeds the class at install, which is slow and needs the model loaded.
 *
 *   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/check-module-embeddings.mjs <modules-root>... [--exclude <module-path>]...
 *
 * For each class under component/, dataFlow/, securityBoundary/, control/, data/ and issue/, the file
 * embeddings/<default profile>.json must hold the default profile's id and weights revision, a vector of the
 * profile's length with finite values and unit norm, and the sha256 of the class text the platform composes. No other
 * embeddings file may exist: a single profile ships vectors (when a second one does, this becomes an allow-list).
 *
 * Nothing is copied here: the class-text composer is dt-module's source, loaded by Node's type stripping, and the
 * default profile id is read from its one definition in dt-ws. A change to either, or to the profile, fails this check
 * until the vectors are made again (`pnpm embed` in each module, or `module-manager.sh embed-all`).
 */

import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.features.typescript) {
  console.error('check-module-embeddings: needs Node type stripping (Node >= 22.18, or --experimental-strip-types)');
  process.exit(2);
}

const ossRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composer = await import(pathToFileURL(resolve(ossRoot, 'packages/dt-module/src/embedding-text.ts')).href);
const lib = await import(pathToFileURL(resolve(ossRoot, 'scripts/lib/class-vectors.ts')).href);

/** The command line: module roots, and module paths to leave out. */
export function parseArgs(argv) {
  const roots = [];
  const excludes = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--exclude') {
      const value = argv[++i];
      if (!value) throw new Error('--exclude needs a module path');
      excludes.push(value);
    } else if (argv[i].startsWith('--')) {
      throw new Error(`unknown argument "${argv[i]}"`);
    } else {
      roots.push(argv[i]);
    }
  }
  if (roots.length === 0) throw new Error('usage: check-module-embeddings.mjs <modules-root>... [--exclude <module-path>]...');
  return { roots, excludes };
}

/** The problems of every module under `roots`, and how many classes were checked. */
export function checkModules(roots, excludes, root = ossRoot) {
  const profile = lib.readVectorProfile(root, lib.readDefaultProfileId(root));
  const problems = [];
  let classes = 0;
  const modules = lib.findClassModules(roots, excludes);
  for (const modulePath of modules) {
    const dataDir = lib.moduleDataDir(modulePath);
    const found = lib.collectClasses(dataDir, composer);
    // A class the platform skips (a component of a type it rejects) needs no vector; a broken class.json is a defect.
    for (const s of found.skipped) if (s.invalid) problems.push({ where: s.classDir, problem: s.reason });
    for (const entry of found.classes) {
      classes++;
      for (const problem of lib.vectorFileProblems(entry, profile, composer)) problems.push({ where: entry.classDir, problem });
      for (const stray of lib.strayVectorFiles(entry.classDir, profile, composer)) problems.push({ where: stray, problem: 'not the default profile\'s vector file; remove it' });
    }
    for (const stray of lib.strayEmbeddingDirs(dataDir)) problems.push({ where: stray, problem: 'an embeddings directory outside a class directory' });
  }
  return { profile, modules: modules.length, classes, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check-module-embeddings: ${error.message}`);
    process.exit(2);
  }
  const { profile, modules, classes, problems } = checkModules(args.roots, args.excludes);
  for (const p of problems) console.error(`${relative(process.cwd(), p.where)}: ${p.problem}`);
  if (problems.length > 0) {
    console.error(`check-module-embeddings: ${problems.length} problem(s) in ${modules} module(s); make the vectors again with the module's embed script`);
    process.exit(1);
  }
  console.log(`check-module-embeddings: ${classes} classes in ${modules} modules carry current ${profile.id} vectors`);
}
