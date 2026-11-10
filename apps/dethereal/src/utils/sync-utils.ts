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
import { assertRealModelTree, writeFileNoFollow } from './path-confinement.js'
import { readRepoJson, readChecked, StateFileError } from './state-store.js'
import type { PlatformBaselineRecord } from './platform-baseline.js'
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
  /** What the platform model looked like at the last pull or push, signed on this machine. */
  platform_baseline?: PlatformBaselineRecord
}

/** The largest sync.json read or written: a platform baseline for a large model fits. */
export const MAX_SYNC_BYTES = 8 * 1024 * 1024

/**
 * Write sync.json to the model directory
 */
export async function writeSyncJson(
  modelDir: string,
  syncData: Partial<Omit<SyncMetadata, 'platform_baseline'>> & { platform_baseline?: PlatformBaselineRecord | null }
): Promise<void> {
  const detherealDir = path.join(modelDir, DETHEREAL_DIR)
  // .dethereal/ is repository content: never written through a link.
  await assertRealModelTree(modelDir)
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
  // A baseline passed in replaces the recorded one, `null` removes it, and any
  // other write keeps it as it is.
  const baseline = syncData.platform_baseline !== undefined ? syncData.platform_baseline : existing?.platform_baseline
  if (baseline) merged.platform_baseline = baseline

  await writeFileNoFollow(syncPath, JSON.stringify(merged, null, 2), modelDir)
}

/**
 * Read sync.json from the model directory
 * Returns null if the file does not exist
 */
export async function readSyncJson(modelDir: string): Promise<SyncMetadata | null> {
  // Read like the state file: no links, no special files, a size cap. Anything
  // it refuses reads as absent.
  try {
    return (await readRepoJson(modelDir, `${DETHEREAL_DIR}/${SYNC_FILE}`, { baseDir: modelDir, maxBytes: MAX_SYNC_BYTES })) as SyncMetadata | null
  } catch {
    return null
  }
}

/** Largest top-level model file hashed (as the model readers). */
const MAX_MODEL_FILE_BYTES = 32 * 1024 * 1024
/** Largest scope or attribute file hashed. */
const MAX_SIDE_FILE_BYTES = 1024 * 1024

/**
 * Read one hash input without following a link or blocking on a special file.
 * A link, special file or hard link is left out of the hash, as the model
 * readers leave it out of the model; a file replaced while being read is read
 * again; anything else (too large, an I/O error) fails the hash rather than
 * silently changing it.
 */
async function hashInput(abs: string, rel: string, maxBytes: number): Promise<Buffer | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readChecked(abs, rel, maxBytes)
    } catch (err) {
      if (err instanceof StateFileError) {
        if (err.code === 'symlink' || err.code === 'not_regular' || err.code === 'hardlinked') return null
        if (err.code === 'changed' && attempt < 3) continue
      }
      throw err
    }
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
  // The attribute groups are listed below: none of them may be a link.
  await assertRealModelTree(modelDir)

  // Read and hash each top-level file in deterministic order
  const files = ['manifest.json', 'structure.json', 'dataflows.json', 'data-items.json']

  for (const file of files) {
    const bytes = await hashInput(path.join(modelDir, file), file, MAX_MODEL_FILE_BYTES)
    if (bytes === null) continue
    try {
      const parsed = JSON.parse(bytes.toString('utf-8'))
      const stripped = stripNonSemanticProperties(parsed)
      hash.update(file + ':' + JSON.stringify(stripped))
    } catch {
      // Not JSON: skipped, as before
    }
  }

  // .dethereal/scope.json (whole file — synced keys AND local-only keys are both
  // legitimate local changes to surface)
  const scopeRaw = await hashInput(path.join(modelDir, DETHEREAL_DIR, 'scope.json'), `${DETHEREAL_DIR}/scope.json`, MAX_SIDE_FILE_BYTES)
  if (scopeRaw !== null) {
    try {
      hash.update('scope.json:' + JSON.stringify(stripNonSemanticProperties(JSON.parse(scopeRaw.toString('utf-8')))))
    } catch {
      // Not JSON: skipped, as before
    }
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
      const content = await hashInput(path.join(dir, f), `attributes/${subdir}/${f}`, MAX_SIDE_FILE_BYTES)
      if (content === null) continue
      hash.update(`attributes/${subdir}/${f}:` + JSON.stringify(stripNonSemanticProperties(JSON.parse(content.toString('utf-8')))))
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

/** A model's sync record, as `workspace_status` reports it: identifiers, times and codes only. */
export interface SyncRecord {
  status: 'never_synced' | 'no_local_changes' | 'local_changes' | 'unknown'
  /** Whether the model changed since the last push or pull; null when that cannot be told */
  localChanges: boolean | null
  /** A platform model id is recorded */
  linked: boolean
  platformModelId: string | null
  lastPushAt: string | null
  lastPullAt: string | null
  /** Which recorded content hash the model was compared with */
  baseline: 'push' | 'pull' | null
  /** Platform ids of models this one references (at most 20); `workspace_status` fills it from structure.json */
  referencedModels: string[]
  /** Why local changes could not be told, as a code */
  problem?: string
}

const ID_CHARS = /^[A-Za-z0-9_-]{1,128}$/
const HASH_PREFIX = `sha256:${CONTENT_HASH_VERSION}:`

function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && ID_CHARS.test(value) ? value : null
}

function timeOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Whether a model has local changes since it was last pushed or pulled: the
 * model's content hash against the hash recorded by whichever of the two ran
 * last. A hash recorded by an earlier hashing scheme counts as a clean
 * baseline (the next sync re-records it). Reads through the checked readers
 * and reports codes, never paths or file content.
 */
export async function localChangeStatus(modelDir: string): Promise<SyncRecord> {
  const sync = (await readSyncJson(modelDir)) as Record<string, unknown> | null
  const platformModelId = idOrNull(sync?.platform_model_id)
  const lastPushAt = timeOrNull(sync?.last_push_at)
  const lastPullAt = timeOrNull(sync?.last_pull_at)
  const referencedModels = Array.isArray(sync?.referenced_models)
    ? (sync!.referenced_models as unknown[]).map(idOrNull).filter((id): id is string => id !== null).slice(0, 20)
    : []
  const record = { linked: platformModelId !== null, platformModelId, lastPushAt, lastPullAt, referencedModels }
  if (!sync || (!lastPushAt && !lastPullAt)) {
    return { status: 'never_synced', localChanges: null, baseline: null, ...record }
  }
  const baseline: 'push' | 'pull' = lastPushAt && (!lastPullAt || lastPushAt > lastPullAt) ? 'push' : 'pull'
  const stored = baseline === 'push' ? sync.push_content_hash : sync.pull_content_hash
  if (typeof stored !== 'string' || stored.length === 0) {
    return { status: 'unknown', localChanges: null, baseline, ...record, problem: 'no_recorded_hash' }
  }
  if (!stored.startsWith(HASH_PREFIX)) {
    return { status: 'no_local_changes', localChanges: false, baseline, ...record }
  }
  let current: string
  try {
    current = await computeContentHash(modelDir)
  } catch (error) {
    const code = error instanceof StateFileError ? error.code : (error as { code?: unknown })?.code
    return { status: 'unknown', localChanges: null, baseline, ...record, problem: typeof code === 'string' ? code : 'unreadable' }
  }
  const changed = current !== stored
  return { status: changed ? 'local_changes' : 'no_local_changes', localChanges: changed, baseline, ...record }
}
