/**
 * Sync Utilities
 *
 * Manages sync.json metadata for push/pull operations.
 * Stored at <model-path>/.dethereal/sync.json
 *
 * Per SYNC_AND_SOURCE_OF_TRUTH.md §4, sync.json should be gitignored
 * (per-user, per-instance state).
 */

import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import {
  readManifest,
  readStructure,
  readDataFlows,
  readDataItems,
} from './directory-utils.js'

const DETHEREAL_DIR = '.dethereal'
const SYNC_FILE = 'sync.json'

// Properties excluded from the content hash: diagram layout (no semantic
// meaning) plus churny export/edit metadata (modifiedAt on attribute bags,
// exportedAt on the manifest) that would otherwise dirty the hash on every pull.
const NON_SEMANTIC_PROPERTIES = new Set([
  'positionX', 'positionY', 'dimensionsWidth', 'dimensionsHeight',
  'modifiedAt', 'exportedAt'
])

/**
 * Algorithm version of `computeContentHash`, embedded in the digest as
 * `sha256:<version>:<hex>`. Bump when the set of hashed inputs or the strip
 * rules change, so stored hashes from a prior algorithm can be recognised and
 * silently re-baselined (see `isStaleContentHashVersion`) rather than reported
 * as spurious local changes.
 */
export const CONTENT_HASH_VERSION = 'v2'

/**
 * Sync metadata structure
 */
export interface SyncMetadata {
  platform_model_id: string
  platform_url: string
  last_pull_at?: string | null
  last_push_at?: string | null
  pull_content_hash?: string | null
  push_content_hash?: string | null
  baseline_element_ids: {
    boundaries: string[]
    components: string[]
    flows: string[]
    dataItems: string[]
  }
  referenced_models: string[]
}

/**
 * Write sync.json to the model directory
 */
export async function writeSyncJson(modelDir: string, syncData: Partial<SyncMetadata>): Promise<void> {
  const detherealDir = path.join(modelDir, DETHEREAL_DIR)
  await fs.mkdir(detherealDir, { recursive: true })

  const syncPath = path.join(detherealDir, SYNC_FILE)

  // Merge with existing if present
  const existing = await readSyncJson(modelDir)
  const merged: SyncMetadata = {
    platform_model_id: syncData.platform_model_id || existing?.platform_model_id || '',
    platform_url: syncData.platform_url || existing?.platform_url || '',
    last_pull_at: syncData.last_pull_at !== undefined ? syncData.last_pull_at : existing?.last_pull_at || null,
    last_push_at: syncData.last_push_at !== undefined ? syncData.last_push_at : existing?.last_push_at || null,
    pull_content_hash: syncData.pull_content_hash !== undefined ? syncData.pull_content_hash : existing?.pull_content_hash || null,
    push_content_hash: syncData.push_content_hash !== undefined ? syncData.push_content_hash : existing?.push_content_hash || null,
    baseline_element_ids: syncData.baseline_element_ids || existing?.baseline_element_ids || {
      boundaries: [], components: [], flows: [], dataItems: []
    },
    referenced_models: syncData.referenced_models || existing?.referenced_models || []
  }

  await fs.writeFile(syncPath, JSON.stringify(merged, null, 2), 'utf-8')
}

/**
 * Read sync.json from the model directory
 * Returns null if the file does not exist
 */
export async function readSyncJson(modelDir: string): Promise<SyncMetadata | null> {
  const syncPath = path.join(modelDir, DETHEREAL_DIR, SYNC_FILE)
  try {
    const content = await fs.readFile(syncPath, 'utf-8')
    return JSON.parse(content) as SyncMetadata
  } catch {
    return null
  }
}

/**
 * Compute content hash of model files.
 *
 * SHA-256 over the semantic content of the model directory, excluding
 * non-semantic properties (layout + churny `modifiedAt`/`exportedAt` metadata).
 * Inputs, in deterministic order:
 *   - the four top-level files (manifest, structure, dataflows, data-items);
 *   - `.dethereal/scope.json` (model scope + skill-owned local-only keys);
 *   - `attributes/{boundaries,components,dataFlows,dataItems}/*.json` (per-element
 *     attribute bags), fixed dir order, files sorted by name.
 *
 * The digest is version-tagged (`sha256:<version>:<hex>`); see CONTENT_HASH_VERSION.
 */
export async function computeContentHash(modelDir: string): Promise<string> {
  const hash = createHash('sha256')

  // Read and hash each top-level file in deterministic order
  const files = ['manifest.json', 'structure.json', 'dataflows.json', 'data-items.json']

  for (const file of files) {
    try {
      const filePath = path.join(modelDir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      const stripped = stripNonSemanticProperties(parsed)
      hash.update(file + ':' + JSON.stringify(stripped))
    } catch {
      // File doesn't exist, skip
    }
  }

  // .dethereal/scope.json (whole file — synced keys AND local-only keys are both
  // legitimate local changes to surface)
  try {
    const scopeRaw = await fs.readFile(path.join(modelDir, DETHEREAL_DIR, 'scope.json'), 'utf-8')
    hash.update('scope.json:' + JSON.stringify(stripNonSemanticProperties(JSON.parse(scopeRaw))))
  } catch {
    // absent — skip
  }

  // attributes/{boundaries,components,dataFlows,dataItems}/*.json — fixed dir order, sorted files
  for (const subdir of ['boundaries', 'components', 'dataFlows', 'dataItems']) {
    const dir = path.join(modelDir, 'attributes', subdir)
    let entries: string[]
    try {
      entries = (await fs.readdir(dir)).filter(f => f.endsWith('.json')).sort()
    } catch {
      continue // subdir absent
    }
    for (const f of entries) {
      const content = await fs.readFile(path.join(dir, f), 'utf-8')
      hash.update(`attributes/${subdir}/${f}:` + JSON.stringify(stripNonSemanticProperties(JSON.parse(content))))
    }
  }

  return `sha256:${CONTENT_HASH_VERSION}:` + hash.digest('hex')
}

/**
 * True when a stored content hash predates the current algorithm version, so it
 * should be silently re-baselined on the next sync rather than reported as local
 * changes (the digest's `sha256:<version>:` segment differs from CONTENT_HASH_VERSION).
 */
export function isStaleContentHashVersion(stored: string | null | undefined): boolean {
  return !!stored && !stored.startsWith(`sha256:${CONTENT_HASH_VERSION}:`)
}

/**
 * Strip non-semantic properties (layout + churny metadata) from an object recursively.
 */
function stripNonSemanticProperties(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(item => stripNonSemanticProperties(item))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (NON_SEMANTIC_PROPERTIES.has(key)) continue
    result[key] = stripNonSemanticProperties(value)
  }
  return result
}

/**
 * Collect all element IDs from model files
 * Returns structured baseline element IDs for sync.json
 */
export async function collectBaselineElementIds(modelDir: string): Promise<SyncMetadata['baseline_element_ids']> {
  const result = {
    boundaries: [] as string[],
    components: [] as string[],
    flows: [] as string[],
    dataItems: [] as string[]
  }

  try {
    const structure = await readStructure(modelDir)
    collectFromBoundary(structure.defaultBoundary, result)
  } catch {
    // Structure doesn't exist
  }

  try {
    const dataFlows = await readDataFlows(modelDir)
    for (const flow of dataFlows) {
      if (flow.id) result.flows.push(flow.id)
    }
  } catch {
    // No dataflows
  }

  try {
    const dataItems = await readDataItems(modelDir)
    for (const item of dataItems) {
      if (item.id) result.dataItems.push(item.id)
    }
  } catch {
    // No data items
  }

  return result
}

function collectFromBoundary(
  boundary: any,
  result: { boundaries: string[]; components: string[] }
): void {
  if (boundary.id) result.boundaries.push(boundary.id)
  if (boundary.components) {
    for (const comp of boundary.components) {
      if (comp.id) result.components.push(comp.id)
    }
  }
  if (boundary.boundaries) {
    for (const nested of boundary.boundaries) {
      collectFromBoundary(nested, result)
    }
  }
}
