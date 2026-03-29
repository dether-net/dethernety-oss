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

// Layout properties to exclude from content hash
const LAYOUT_PROPERTIES = new Set([
  'positionX', 'positionY', 'dimensionsWidth', 'dimensionsHeight'
])

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
 * Compute content hash of model files
 *
 * SHA-256 of model files (manifest, structure, dataflows, data-items),
 * excluding layout properties (positionX, positionY, dimensionsWidth, dimensionsHeight).
 * Files are sorted by name for deterministic ordering.
 */
export async function computeContentHash(modelDir: string): Promise<string> {
  const hash = createHash('sha256')

  // Read and hash each file in deterministic order
  const files = ['manifest.json', 'structure.json', 'dataflows.json', 'data-items.json']

  for (const file of files) {
    try {
      const filePath = path.join(modelDir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      const stripped = stripLayoutProperties(parsed)
      hash.update(file + ':' + JSON.stringify(stripped))
    } catch {
      // File doesn't exist, skip
    }
  }

  return 'sha256:' + hash.digest('hex')
}

/**
 * Strip layout properties from an object recursively
 */
function stripLayoutProperties(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(item => stripLayoutProperties(item))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (LAYOUT_PROPERTIES.has(key)) continue
    result[key] = stripLayoutProperties(value)
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
