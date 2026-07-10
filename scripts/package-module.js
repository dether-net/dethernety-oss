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
 *   │   ├── data/       (if source data/ exists)
 *   │   └── frontend/   (if source frontend/ exists)
 *   ├── langgraph/      (if source langgraph/ exists)
 *   └── data/           (if source data/*.cypher or *.csv exist — legacy ingestion)
 *
 * Usage:
 *   node ../../scripts/package-module.js          (from module dir)
 *   node path/to/package-module.js <module-dir>   (explicit path)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

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

// Clean and create package directory
if (fs.existsSync(packageDir)) {
  fs.rmSync(packageDir, { recursive: true });
}
fs.mkdirSync(packageDir, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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
// 5. Frontend bundle  →  dethernety/{name}/frontend/
// ---------------------------------------------------------------------------

const frontendSourceDir = path.join(projectRoot, 'frontend');

if (fs.existsSync(frontendSourceDir)) {
  fs.mkdirSync(moduleDestDir, { recursive: true });
  const frontendDestDir = path.join(moduleDestDir, 'frontend');
  copyDirRecursive(frontendSourceDir, frontendDestDir);
  console.log(`  Copied frontend/ → dethernety/${name}/frontend/`);
}

// ---------------------------------------------------------------------------
// 6. Create tar.gz archive
// ---------------------------------------------------------------------------

console.log('  Creating tar.gz archive...');
const archiveName = `${name}-${version}.tar.gz`;
const archivePath = path.join(distDir, archiveName);

execSync(`tar -czf "${archivePath}" -C "${packageDir}" .`);

const size = (fs.statSync(archivePath).size / 1024).toFixed(1);
console.log('');
console.log('Package created successfully!');
console.log(`  Archive: ${archivePath}`);
console.log(`  Size: ${size} KB`);
console.log('');
console.log('Package contents:');
const contents = execSync(`tar -tzf "${archivePath}"`, { encoding: 'utf8' });
console.log(contents);
