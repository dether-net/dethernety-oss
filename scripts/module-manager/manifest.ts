/**
 * manifest.ts — Module manifest parsing and validation.
 *
 * Mirrors the manifest schema used by the Go management-service.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ManifestComponent {
  type: 'dethernety' | 'langgraph' | 'data';
  path: string;
}

export interface Manifest {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  tags?: string[];
  dependencies?: string[];
  restarts?: string[];
  components?: ManifestComponent[];
}

/**
 * Load and validate a manifest.json from a directory.
 */
export function loadManifest(dir: string): Manifest {
  const manifestPath = join(dir, 'manifest.json');
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`manifest.json not found in ${dir}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }

  const m = parsed as Record<string, unknown>;

  if (!m.name || typeof m.name !== 'string') {
    throw new Error('manifest.json: "name" is required and must be a string');
  }
  if (!m.version || typeof m.version !== 'string') {
    throw new Error('manifest.json: "version" is required and must be a string');
  }

  return {
    name: m.name,
    version: m.version,
    displayName: typeof m.displayName === 'string' ? m.displayName : undefined,
    description: typeof m.description === 'string' ? m.description : undefined,
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : undefined,
    dependencies: Array.isArray(m.dependencies)
      ? m.dependencies.filter((d): d is string => typeof d === 'string')
      : undefined,
    restarts: Array.isArray(m.restarts)
      ? m.restarts.filter((r): r is string => typeof r === 'string')
      : undefined,
  };
}
