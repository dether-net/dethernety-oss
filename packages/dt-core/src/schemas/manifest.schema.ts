/**
 * Manifest schema for Dethernety threat models.
 *
 * The manifest contains model metadata and references to related files
 * in the split-file format. It serves as the entry point for loading
 * a threat model from multiple files.
 */

import type {
  UUID,
  ModuleReference,
  SCHEMA_VERSION,
} from './common.schema.js';

/**
 * File references for split-file format.
 * Paths are relative to the manifest file location.
 */
export interface FileReferences {
  /** Path to the structure file (hierarchy without attributes) */
  structure: string;
  /** Path to the data flows file */
  dataFlows: string;
  /** Path to the data items file */
  dataItems: string;
  /** Path to the attributes directory or file */
  attributes: string;
}

/**
 * Model manifest - the root of a split-file threat model.
 *
 * In split-file format, this is stored as `manifest.json` and
 * references other files containing the model data.
 */
export interface ModelManifest {
  /** Schema version for migration handling */
  schemaVersion: typeof SCHEMA_VERSION;

  /**
   * Format indicator.
   * - 'split': Model is split across multiple files
   * - 'monolithic': All data in single file (for backward compat)
   */
  format: 'split' | 'monolithic';

  /** Model metadata */
  model: ModelMetadata;

  /**
   * File references (only present when format is 'split').
   * Paths are relative to the manifest file.
   */
  files?: FileReferences;

  /** Modules used by this model */
  modules: ModuleReference[];

  /**
   * Checksum for integrity verification.
   * SHA-256 hash of concatenated file contents.
   */
  checksum?: string;

  /** Export timestamp */
  exportedAt?: string;

  /** Platform version that created this export */
  platformVersion?: string;
}

/**
 * Model metadata stored in the manifest.
 */
export interface ModelMetadata {
  /** Model UUID (null for new models being imported) */
  id: UUID | null;
  /** Model name */
  name: string;
  /** Model description */
  description?: string;
  /** ID of the default boundary (root of hierarchy) */
  defaultBoundaryId: UUID;
}

/**
 * Default file names for split-file format.
 */
export const DEFAULT_FILE_NAMES = {
  manifest: 'manifest.json',
  structure: 'structure.json',
  dataFlows: 'dataflows.json',
  dataItems: 'data-items.json',
  attributes: 'attributes',
} as const;

/**
 * Create a default manifest for a new model.
 */
export function createManifest(
  model: ModelMetadata,
  modules: ModuleReference[],
  format: 'split' | 'monolithic' = 'split'
): ModelManifest {
  const manifest: ModelManifest = {
    schemaVersion: '2.0.0',
    format,
    model,
    modules,
    exportedAt: new Date().toISOString(),
  };

  if (format === 'split') {
    manifest.files = {
      structure: DEFAULT_FILE_NAMES.structure,
      dataFlows: DEFAULT_FILE_NAMES.dataFlows,
      dataItems: DEFAULT_FILE_NAMES.dataItems,
      attributes: DEFAULT_FILE_NAMES.attributes,
    };
  }

  return manifest;
}
