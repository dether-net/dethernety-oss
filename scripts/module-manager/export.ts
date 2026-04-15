/**
 * `module-manager export` — produce a Studio-importable archive from a module.
 *
 * Tars the contents of `<module-path>/data/<moduleName>/` into a `.tar.gz`
 * whose root entry is `<moduleName>/` — byte-compatible with the layout
 * Studio's own `exportWorkspaceToFiles` produces, and thus accepted by
 * Studio's `importFromArchive`.
 *
 * Pre-computed embeddings (`**\/embeddings/`) are excluded by default so the
 * upload stays under Studio's 10MB base64 cap. Pass `--include-embeddings`
 * to keep them.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface ExportOptions {
  modulePath: string;
  output?: string;
  includeEmbeddings: boolean;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export function runExport(opts: ExportOptions): void {
  const log = opts.logger ?? console;
  const modulePath = resolve(opts.modulePath);

  const manifestPath = join(modulePath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }

  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err: any) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${err.message}`);
  }

  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error('manifest.json: "name" is required and must be a string');
  }
  const moduleName = manifest.name;
  const version =
    typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : '0.0.0';

  const dataRoot = join(modulePath, 'data');
  const moduleDataDir = join(dataRoot, moduleName);
  if (!existsSync(moduleDataDir)) {
    throw new Error(
      `Module data directory not found: ${moduleDataDir}. ` +
        `Expected "<module-path>/data/<moduleName>/" with Studio-format files.`,
    );
  }

  // module.json at data/<moduleName>/ is the marker for the Studio format
  // (as produced by exportWorkspaceToFiles). Reject modules that only ship
  // the legacy Cypher-based data layout.
  const moduleJsonPath = join(moduleDataDir, 'module.json');
  if (!existsSync(moduleJsonPath)) {
    throw new Error(
      `module.json not found at ${moduleJsonPath}. The module does not appear ` +
        `to use the Studio file-based layout; nothing to export.`,
    );
  }

  const outputPath = opts.output
    ? resolve(opts.output)
    : join(modulePath, 'dist', `${moduleName}-${version}-studio.tar.gz`);

  mkdirSync(dirname(outputPath), { recursive: true });

  // --exclude='*/embeddings' matches on both BSD (macOS) and GNU tar:
  // tar skips a directory matching the pattern along with its contents.
  const excludeArgs = opts.includeEmbeddings ? '' : `--exclude='*/embeddings' `;

  const cmd =
    `tar -czf "${outputPath}" ${excludeArgs}` +
    `-C "${dataRoot}" "${moduleName}"`;

  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(
      `Failed to create archive: ${err.message}${stderr ? `\n${stderr}` : ''}`,
    );
  }

  log.log(`[export] wrote ${outputPath}`);
  if (!opts.includeEmbeddings) {
    log.log(
      `[export] excluded **/embeddings/ (pass --include-embeddings to keep)`,
    );
  }
}
