/**
 * Generic module packaging script for Dethernety modules.
 *
 * Run from any module directory that has a manifest.json.
 * Auto-detects and includes all components found:
 *
 *   - dethernety/  (compiled JS backend from dist/dethernety/{name}/)
 *   - data/        (file-based class data, copied into dethernety/{name}/data/)
 *   - langgraph/   (Python analysis graphs)
 *   - frontend/    (Vue UI bundle, copied into dethernety/{name}/frontend/)
 *
 * Produces a MODULE_PACKAGE_DESIGN.md-compliant package:
 *
 *   {name}-{version}.tar.gz
 *   ├── manifest.json
 *   ├── dethernety/{name}/
 *   │   ├── *Module.js (+ .d.ts)
 *   │   ├── .dethernety-module.json  (identity stamp — see step 5.5)
 *   │   ├── data/       (if source data/ exists)
 *   │   └── frontend/   (bundle.js only, if source frontend/ exists)
 *   ├── langgraph/      (if source langgraph/ exists)
 *   └── data/           (if source data/*.cypher or *.csv exist — legacy ingestion)
 *
 * The archive is NOT reproducible: tar is invoked without `--sort`, `--mtime` or
 * ownership normalisation and gzip is not given `-n`, so two runs over identical
 * content produce different bytes. Anything that needs to answer "is this the same
 * payload" must use the stamp's `payloadDigest`, which is content-derived, and not a
 * digest of this file.
 *
 * Usage:
 *   node ../../scripts/package-module.js          (from module dir)
 *   node path/to/package-module.js <module-dir>   (explicit path)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  STAMP_FILENAME,
  computePayloadDigest,
  resolveBuiltFrom,
  copyDirRecursive,
  checkDtModuleCompatibility,
} from './module-payload.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lint every `policies.rego` under the module's data tree before it is packaged.
 *
 * This is the only place a Regorus-incompatible policy can be caught at build time:
 * the engine resolves function names lazily, so a call to a builtin the vendored blob
 * lacks parses fine at load and fails only when its clause first fires — aborting that
 * element's whole evaluation in production. Registering through the real `RegoEngine`
 * additionally runs the exact parse, isolation, and duplicate-package checks the
 * platform runs at module load, so lint and runtime cannot disagree.
 *
 * Resolved relative to THIS script, not the invoking module: pnpm hoists nothing to
 * `oss/scripts/`, so a bare `@dethernety/dt-module` specifier would never resolve here,
 * while dt-module's own dist resolves its WASM dependency from its own node_modules.
 * Loaded lazily — the data-only modules have no policies and no build edge to dt-module.
 */
function lintRegoPolicies(dataSourceDir) {
  const policies = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'policies.rego') policies.push(full);
    }
  };
  walk(dataSourceDir);
  if (policies.length === 0) return;

  const require = createRequire(import.meta.url);
  let lint, engineModule;
  try {
    lint = require('../packages/dt-module/dist/rego-lint.js');
    engineModule = require('../packages/dt-module/dist/rego-engine.js');
  } catch (err) {
    console.error('✗ Cannot lint Rego policies: failed to load @dethernety/dt-module dist.');
    console.error(`  ${err.message}`);
    console.error('  If dist/ is missing, run `pnpm turbo build --filter=@dethernety/dt-module` and retry.');
    process.exit(1);
  }

  const engine = new engineModule.RegoEngine();
  const errors = [];
  let warnings = 0;
  try {
    for (const policyPath of policies) {
      const rel = path.relative(dataSourceDir, policyPath);
      const source = fs.readFileSync(policyPath, 'utf8');

      const result = lint.lintPolicySource(source);
      for (const finding of result.errors) {
        errors.push(`  ${rel}${finding.line ? `:${finding.line}` : ''}  ${finding.message}`);
      }
      warnings += result.warnings.length;

      // The same registration the platform performs at module load.
      try {
        engine.register(engineModule.RegoEngine.keyFor(path.dirname(rel)), source);
      } catch (err) {
        errors.push(`  ${rel}  ${err.message}`);
      }
    }
  } finally {
    engine.dispose();
  }

  if (warnings > 0) {
    console.log(`  Rego lint: ${warnings} warning(s) — count/regex.match applied directly to input values`);
  }
  if (errors.length > 0) {
    console.error(`✗ Rego lint failed — ${errors.length} error(s), no package produced:`);
    for (const line of errors) console.error(line);
    process.exit(1);
  }
  console.log(`  Rego lint: ${policies.length} policies OK`);
}

// Resolve module root: explicit arg or cwd
const projectRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

const manifestPath = path.join(projectRoot, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`manifest.json not found in ${projectRoot}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { name, version } = manifest;

if (!name || !version) {
  console.error('manifest.json must contain "name" and "version" fields');
  process.exit(1);
}

const distDir = path.join(projectRoot, 'dist');
const packageDir = path.join(distDir, 'package');

console.log(`Packaging ${name} v${version}...`);

// ---------------------------------------------------------------------------
// 0. Base-library compatibility  (BEFORE anything is destroyed)
// ---------------------------------------------------------------------------
//
// A manifest that misdeclares what it was built against produces a package that
// installs cleanly and fails at load. Same class of defect as a policy that fails the
// Rego lint, so it gets the same treatment: refuse to produce an archive.
//
// This runs before the package directory is wiped. A build that is going to fail must
// not first destroy the previous, working package — which is what the Rego lint does
// today, further down, for want of anywhere better to sit.
//
// Assert agreement; never rewrite. The manifest is authored deliberately, and a
// packager that silently corrected it would make the declaration worthless.
{
  const dtModulePkg = path.join(SCRIPT_DIR, '..', 'packages', 'dt-module', 'package.json');
  const actual = fs.existsSync(dtModulePkg)
    ? JSON.parse(fs.readFileSync(dtModulePkg, 'utf8')).version
    : null;

  const verdict = checkDtModuleCompatibility(manifest, actual);
  if (!verdict.ok) {
    console.error('✗ Compatibility check failed — no package produced.');
    console.error(`  ${verdict.reason}`);
    console.error('  Update manifest.json deliberately, or correct the installed version.');
    process.exit(1);
  }
  if (!verdict.skipped) {
    console.log(`  dt-module compatibility: ${verdict.declared} satisfied by ${verdict.actual}`);
  }
}

// Clean and create package directory
if (fs.existsSync(packageDir)) {
  fs.rmSync(packageDir, { recursive: true });
}
fs.mkdirSync(packageDir, { recursive: true });

// ---------------------------------------------------------------------------
// 1. manifest.json (always)
// ---------------------------------------------------------------------------

console.log('  Copying manifest.json...');
fs.copyFileSync(manifestPath, path.join(packageDir, 'manifest.json'));

// ---------------------------------------------------------------------------
// 2. Compiled JS backend  →  dethernety/{name}/
// ---------------------------------------------------------------------------

const jsSourceDir = path.join(distDir, 'dethernety', name);
const moduleDestDir = path.join(packageDir, 'dethernety', name);

if (fs.existsSync(jsSourceDir)) {
  fs.mkdirSync(moduleDestDir, { recursive: true });
  const jsFiles = fs.readdirSync(jsSourceDir).filter(f =>
    f.endsWith('.js') || f.endsWith('.d.ts') || f.endsWith('.js.map') ||
    // External GraphQL schema fragment (readSchemaExtension reads schema.graphql
    // co-located with the compiled JS at runtime).
    f.endsWith('.graphql')
  );
  for (const file of jsFiles) {
    fs.copyFileSync(path.join(jsSourceDir, file), path.join(moduleDestDir, file));
  }
  console.log(`  Copied ${jsFiles.length} JS files → dethernety/${name}/`);
}

// ---------------------------------------------------------------------------
// 3. File-based class data  →  dethernety/{name}/data/
//    Co-located with JS so __dirname-relative resolution works at runtime.
// ---------------------------------------------------------------------------

const dataSourceDir = path.join(projectRoot, 'data');

if (fs.existsSync(dataSourceDir)) {
  // Check if this is v2 file-based data (has subdirs with module.json)
  // vs v1 ingestion data (flat .cypher/.csv files)
  const entries = fs.readdirSync(dataSourceDir, { withFileTypes: true });
  const hasSubdirs = entries.some(e => e.isDirectory());
  const hasCypherOrCsv = entries.some(e =>
    !e.isDirectory() && (e.name.endsWith('.cypher') || e.name.endsWith('.csv'))
  );

  if (hasSubdirs) {
    // A policy that fails the lint must never reach an archive.
    lintRegoPolicies(dataSourceDir);
    // V2: copy entire data tree into dethernety/{name}/data/
    fs.mkdirSync(moduleDestDir, { recursive: true });
    const dataDestDir = path.join(moduleDestDir, 'data');
    copyDirRecursive(dataSourceDir, dataDestDir);
    console.log(`  Copied data/ → dethernety/${name}/data/`);
  }

  if (hasCypherOrCsv) {
    // V1 legacy: copy .cypher and .csv to top-level data/ for DB ingestion
    const legacyDataDir = path.join(packageDir, 'data');
    fs.mkdirSync(legacyDataDir, { recursive: true });
    const dataFiles = entries.filter(e =>
      !e.isDirectory() && (e.name.endsWith('.cypher') || e.name.endsWith('.csv'))
    );
    for (const entry of dataFiles) {
      fs.copyFileSync(
        path.join(dataSourceDir, entry.name),
        path.join(legacyDataDir, entry.name),
      );
    }
    console.log(`  Copied ${dataFiles.length} data files → data/`);
  }
}

// ---------------------------------------------------------------------------
// 4. LangGraph graphs  →  langgraph/
// ---------------------------------------------------------------------------

const langgraphSourceDir = path.join(projectRoot, 'langgraph');

if (fs.existsSync(langgraphSourceDir)) {
  const langgraphDestDir = path.join(packageDir, 'langgraph');
  copyDirRecursive(langgraphSourceDir, langgraphDestDir);
  console.log(`  Copied langgraph/ → langgraph/`);
}

// ---------------------------------------------------------------------------
// 5. Frontend bundle  →  dethernety/{name}/frontend/bundle.js
// ---------------------------------------------------------------------------
//
// An allowlist of exactly one file, mirroring step 2's extension allowlist rather
// than inventing a second, weaker discipline.
//
// The backend serves precisely one file out of a module frontend — `bundle.js`, both
// when discovering which modules have a UI and when answering the bundle request.
// Nothing at runtime opens the Vue sources, the vite config, or the build output
// directory, and each module's vite config inlines dynamic imports and CSS so the
// bundle is self-contained by construction. Everything else is dead weight in the
// package.

const frontendSourceDir = path.join(projectRoot, 'frontend');

if (fs.existsSync(frontendSourceDir)) {
  const bundleSource = path.join(frontendSourceDir, 'bundle.js');

  // Refusing here converts a silent failure into a loud one. A module that ships a
  // frontend/ without a bundle loads, registers, and reports healthy — and then
  // renders nothing, because the lookup that would have found the bundle treats a
  // missing file as "this module has no UI" rather than as an error.
  if (!fs.existsSync(bundleSource)) {
    console.error('✗ frontend/ exists but frontend/bundle.js does not — no package produced.');
    console.error('  The convention is `cd frontend && vite build && cp dist/bundle.js bundle.js`.');
    console.error('  Packaging a frontend without its bundle yields a module that loads and');
    console.error('  reports healthy while rendering no UI at all.');
    process.exit(1);
  }

  const frontendDestDir = path.join(moduleDestDir, 'frontend');
  fs.mkdirSync(frontendDestDir, { recursive: true });
  fs.copyFileSync(bundleSource, path.join(frontendDestDir, 'bundle.js'));
  console.log(`  Copied frontend/bundle.js → dethernety/${name}/frontend/`);
}

// ---------------------------------------------------------------------------
// 5.5 Identity stamp  →  dethernety/{name}/.dethernety-module.json
// ---------------------------------------------------------------------------
//
// An unpacked module otherwise carries no identity: manifest.json sits at the package
// root and never reaches the module directory, so nothing in the installed tree records
// what version it is or whether it matches a given package.
//
// Position is fixed at both ends. After every copy, or the digest does not cover the
// payload it claims to describe; before the archive, or it is not in it. It is
// written rather than copied — it does not exist in the source tree, and step 2's
// extension allowlist would drop it if it did.

if (fs.existsSync(moduleDestDir)) {
  const payloadDigest = computePayloadDigest(moduleDestDir);
  const stamp = {
    name,
    version,
    builtFrom: resolveBuiltFrom(projectRoot),
    payloadDigest,
  };
  fs.writeFileSync(
    path.join(moduleDestDir, STAMP_FILENAME),
    `${JSON.stringify(stamp, null, 2)}\n`,
    'utf8',
  );
  console.log(`  Stamped dethernety/${name}/${STAMP_FILENAME}`);
  console.log(`    ${payloadDigest}`);
} else {
  // Legacy data-only packages produce no dethernety/{name}/ at all — they are a
  // manifest plus .cypher files for ingestion. There is no installed tree to stamp,
  // and fabricating an empty one would add a directory the module loader scans on
  // every start and finds nothing in. manifest.json remains their identity.
  console.log('  No dethernety/<name>/ payload — no identity stamp (data-only package).');
}

// ---------------------------------------------------------------------------
// 6. Create tar.gz archive
// ---------------------------------------------------------------------------

console.log('  Creating tar.gz archive...');
const archiveName = `${name}-${version}.tar.gz`;
const archivePath = path.join(distDir, archiveName);

// execFileSync, not execSync: these paths are built from manifest-supplied values, and
// a shell would give a name containing a quote or a backtick command execution during
// an ordinary build.
execFileSync('tar', ['-czf', archivePath, '-C', packageDir, '.']);

const size = (fs.statSync(archivePath).size / 1024).toFixed(1);
console.log('');
console.log('Package created successfully!');
console.log(`  Archive: ${archivePath}`);
console.log(`  Size: ${size} KB`);
console.log('');
console.log('Package contents:');
const contents = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
console.log(contents);
