/**
 * extractor.ts — Extract tar.gz module packages.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Extract a .tar.gz archive to a temporary directory.
 * Returns the path to the extracted directory.
 */
export function extractPackage(archivePath: string): string {
  if (!existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'dtmod-'));

  try {
    execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, {
      stdio: 'pipe',
    });
  } catch (err: any) {
    throw new Error(`Failed to extract ${archivePath}: ${err.message}`);
  }

  // Validate that manifest.json exists
  if (!existsSync(join(tmpDir, 'manifest.json'))) {
    throw new Error(
      `Invalid module package: no manifest.json found in archive root`,
    );
  }

  return tmpDir;
}
