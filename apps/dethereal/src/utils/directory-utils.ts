/**
 * Directory Utilities for Dethereal MCP Server
 *
 * Provides utilities for reading and writing split-file model directories.
 * Handles the directory structure:
 *
 * model-directory/
 * ├── manifest.json       # Model metadata, modules
 * ├── structure.json      # Boundaries & components (no attributes)
 * ├── dataflows.json      # All data flows
 * ├── data-items.json     # All data items
 * └── attributes/         # Per-element attributes
 *     ├── boundaries/
 *     │   └── {uuid}.json
 *     ├── components/
 *     │   └── {uuid}.json
 *     ├── dataFlows/
 *     │   └── {uuid}.json
 *     └── dataItems/
 *         └── {uuid}.json
 */

import { promises as fs } from 'fs'
import path from 'path'
import { homedir } from 'os'
import type {
  SplitModel,
  ModelManifest,
  ModelScopeLocal,
  ModelStructure,
  StructureBoundary,
  StructureComponent,
  DataFlow,
  SchemaDataItem as DataItem,
  ConsolidatedAttributesFile,
  ElementAttributes,
  AttributeElementType,
  ClassReference,
} from '@dethernety/dt-core'
import {
  DEFAULT_FILE_NAMES,
  SCHEMA_VERSION,
  flattenStructure,
} from '@dethernety/dt-core'

// =============================================================================
// Constants
// =============================================================================

const ATTRIBUTES_SUBDIRS = ['boundaries', 'components', 'dataFlows', 'dataItems'] as const

/** Per-model sync-state directory; holds scope.json and sync.json (see sync-utils.ts). */
const DETHEREAL_DIR = '.dethereal'
const SCOPE_FILE = 'scope.json'

/**
 * The model-scope keys that sync to/from the platform (mirror of `ModelScopeLocal`).
 * scope.json is a superset on disk — local-only keys (`crown_jewels`, `adversary_classes`,
 * `activeModules`, `declared_governance_controls`, …) are written by the modeling skills and
 * must be preserved by `writeScope`; only these five are platform-synced.
 */
const SYNCED_SCOPE_KEYS = [
  'depth',
  'modeling_intent',
  'compliance_drivers',
  'exclusions',
  'trust_assumptions',
] as const

/**
 * Maps attribute subdirectory names to the ID field used in the flat enrichment format
 * and the corresponding AttributeElementType.
 */
const FLAT_FORMAT_META: Record<string, { idField: string; elementType: AttributeElementType }> = {
  boundaries: { idField: 'boundaryId', elementType: 'boundary' },
  components: { idField: 'componentId', elementType: 'component' },
  dataFlows:  { idField: 'flowId',      elementType: 'dataFlow' },
  dataItems:  { idField: 'dataItemId',  elementType: 'dataItem' },
}

/**
 * Metadata fields per element type that are NOT security attributes.
 * Everything else in the flat JSON becomes an attribute value.
 */
const FLAT_METADATA_FIELDS: Record<string, Set<string>> = {
  boundary:  new Set(['boundaryId', 'name', 'type']),
  component: new Set(['componentId', 'name', 'type']),
  dataFlow:  new Set(['flowId', 'name', 'sourceId', 'targetId', 'source_boundary', 'target_boundary', 'crosses_boundary']),
  dataItem:  new Set(['dataItemId', 'name']),
}

/**
 * Context for normalizing flat-format attribute files.
 * When provided, flat files are converted to structured ElementAttributes format.
 */
export interface AttributeNormalizationContext {
  structure: ModelStructure
  dataFlows: DataFlow[]
  dataItems: DataItem[]
}

/**
 * Validate that an element ID is safe for use in filesystem paths.
 * Element IDs should be UUIDs or similar safe identifiers.
 * Exported for tools that interpolate element/class ids into paths
 * (e.g. generate_attribute_stubs) — ids originate from agent-writable
 * model files and must never be able to escape the model directory.
 */
export function validateElementId(elementId: string): void {
  if (!/^[\w-]+$/.test(elementId)) {
    throw new Error(`Invalid elementId "${elementId}": contains disallowed characters`)
  }
}

// =============================================================================
// Flat-Format Normalization
// =============================================================================

/**
 * Detect whether a parsed JSON object is in the flat enrichment format
 * (written by agents) vs the structured ElementAttributes format.
 */
export function isFlatFormat(rawJson: Record<string, unknown>): boolean {
  // Structured format has 'elementId' AND a nested 'attributes' object
  if ('elementId' in rawJson && 'attributes' in rawJson && typeof rawJson.attributes === 'object') {
    return false
  }
  // Flat format has a type-specific ID field
  return ('componentId' in rawJson || 'boundaryId' in rawJson ||
          'flowId' in rawJson || 'dataItemId' in rawJson)
}

export interface ElementInfo {
  id: string
  name: string
  elementType: AttributeElementType
  classData?: ClassReference
}

/**
 * Build a lookup map from element names to their structure metadata.
 * Keys are `{elementType}:{name}` (e.g., `component:PostgreSQL`).
 */
function buildElementLookup(
  structure: ModelStructure,
  dataFlows: DataFlow[],
  dataItems: DataItem[]
): Map<string, ElementInfo> {
  const lookup = new Map<string, ElementInfo>()
  const { boundaries, components } = flattenStructure(structure)

  for (const b of boundaries) {
    lookup.set(`boundary:${b.name}`, {
      id: b.id, name: b.name, elementType: 'boundary', classData: b.classData
    })
  }
  for (const c of components) {
    lookup.set(`component:${c.name}`, {
      id: c.id, name: c.name, elementType: 'component', classData: c.classData
    })
  }
  for (const f of dataFlows) {
    lookup.set(`dataFlow:${f.name}`, {
      id: f.id, name: f.name, elementType: 'dataFlow', classData: f.classData
    })
  }
  for (const d of dataItems) {
    lookup.set(`dataItem:${d.name}`, {
      id: d.id, name: d.name, elementType: 'dataItem', classData: d.classData
    })
  }

  return lookup
}

/**
 * Normalize a flat-format attribute file into the structured ElementAttributes format.
 *
 * @returns The normalized ElementAttributes and the resolved element ID, or null if unresolvable.
 */
export function normalizeFlatAttribute(
  rawJson: Record<string, unknown>,
  subdir: string,
  elementLookup: Map<string, ElementInfo>,
  fileName: string
): { attrs: ElementAttributes; resolvedId: string } | null {
  const meta = FLAT_FORMAT_META[subdir]
  if (!meta) {
    console.warn(`[dethereal] Unknown attribute subdirectory: ${subdir}`)
    return null
  }

  const workNameId = rawJson[meta.idField] as string | undefined
  const elementName = rawJson.name as string | undefined

  // Resolve to structure element by type:name
  const lookupKey = elementName ? `${meta.elementType}:${elementName}` : undefined
  const elementInfo = lookupKey ? elementLookup.get(lookupKey) : undefined

  if (!elementInfo && elementName) {
    console.warn(
      `[dethereal] Flat attribute file ${fileName} (name="${elementName}") has no matching ` +
      `${meta.elementType} in structure. Using work-name ID as fallback.`
    )
  }

  const resolvedId = elementInfo?.id ?? workNameId ?? fileName.replace('.json', '')

  // Separate metadata fields from attribute fields
  const metadataFields = FLAT_METADATA_FIELDS[meta.elementType] ?? new Set()
  const attributes: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(rawJson)) {
    if (!metadataFields.has(key)) {
      attributes[key] = value
    }
  }

  const normalized: ElementAttributes = {
    elementId: resolvedId,
    elementType: meta.elementType,
    elementName: elementName,
    classData: elementInfo?.classData as any,
    attributes,
  }

  return { attrs: normalized, resolvedId }
}

// =============================================================================
// Path Validation
// =============================================================================

/**
 * Load allowed model paths from ~/.dethernety/models.json
 * Returns registered directory paths that are permitted outside CWD.
 */
async function loadAllowedModelPaths(): Promise<string[]> {
  try {
    const modelsJsonPath = path.join(homedir(), '.dethernety', 'models.json')
    const content = await fs.readFile(modelsJsonPath, 'utf-8')
    const data = JSON.parse(content)
    return Array.isArray(data.paths) ? data.paths : []
  } catch {
    return []
  }
}

/**
 * Validate that a path is within the allowed base directory.
 * Prevents path traversal attacks via directory_path parameters.
 *
 * Checks (in order):
 * 1. CWD confinement (or provided baseDir)
 * 2. Registered model paths from ~/.dethernety/models.json
 *
 * Symlink targets are resolved before checking containment.
 */
export async function validatePathConfinement(targetPath: string, baseDir?: string): Promise<string> {
  const base = path.resolve(baseDir || process.cwd())
  const resolved = path.resolve(targetPath)

  // Resolve symlinks to prevent symlink-based escapes
  let realPath: string
  try {
    realPath = await fs.realpath(resolved)
  } catch {
    // Path doesn't exist yet (creation case) — check parent
    const parentPath = path.dirname(resolved)
    try {
      const realParent = await fs.realpath(parentPath)
      realPath = path.join(realParent, path.basename(resolved))
    } catch {
      realPath = resolved // parent doesn't exist either, use resolved
    }
  }

  // Check CWD confinement
  if (realPath.startsWith(base + path.sep) || realPath === base) {
    return realPath
  }

  // Check models.json allowlist. Each entry must be a legitimate model
  // directory — manifest.json present and parsable — before we honour it.
  // Without this check, anything with write access to
  // ~/.dethernety/models.json (the user's own home dir, /dethereal:create
  // routine flows, any process running as the user) bypasses CWD
  // confinement on every subsequent MCP invocation.
  const allowedPaths = await loadAllowedModelPaths()
  for (const allowed of allowedPaths) {
    const resolvedAllowed = path.resolve(allowed)
    if (realPath.startsWith(resolvedAllowed + path.sep) || realPath === resolvedAllowed) {
      // Verify the allowlist entry itself is a real model directory before
      // trusting it. A poisoned models.json pointing at /tmp would otherwise
      // pass the substring match.
      if (await isModelDirectory(resolvedAllowed)) {
        return realPath
      }
    }
  }

  throw new Error(`Path "${targetPath}" is outside the allowed directory`)
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Check if a path is a valid model directory (has manifest.json)
 */
export async function isModelDirectory(dirPath: string): Promise<boolean> {
  try {
    const manifestPath = path.join(dirPath, DEFAULT_FILE_NAMES.manifest)
    const stats = await fs.stat(manifestPath)
    return stats.isFile()
  } catch {
    return false
  }
}

/**
 * Read manifest from directory
 */
export async function readManifest(dirPath: string): Promise<ModelManifest> {
  const manifestPath = path.join(dirPath, DEFAULT_FILE_NAMES.manifest)
  const content = await fs.readFile(manifestPath, 'utf-8')
  try {
    return JSON.parse(content) as ModelManifest
  } catch (parseError) {
    throw new Error(`Invalid JSON in manifest at ${manifestPath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`, { cause: parseError })
  }
}

/**
 * Read structure from directory
 */
export async function readStructure(dirPath: string): Promise<ModelStructure> {
  const structurePath = path.join(dirPath, DEFAULT_FILE_NAMES.structure)
  const content = await fs.readFile(structurePath, 'utf-8')
  try {
    return JSON.parse(content) as ModelStructure
  } catch (parseError) {
    throw new Error(`Invalid JSON in structure at ${structurePath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`, { cause: parseError })
  }
}

/**
 * Read dataflows from directory
 */
export async function readDataFlows(dirPath: string): Promise<DataFlow[]> {
  const dataFlowsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataFlows)
  try {
    const content = await fs.readFile(dataFlowsPath, 'utf-8')
    const parsed = JSON.parse(content)
    // Handle both array and object with dataFlows property
    return Array.isArray(parsed) ? parsed : (parsed.dataFlows || [])
  } catch {
    return []
  }
}

/**
 * Read data items from directory
 */
export async function readDataItems(dirPath: string): Promise<DataItem[]> {
  const dataItemsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataItems)
  try {
    const content = await fs.readFile(dataItemsPath, 'utf-8')
    const parsed = JSON.parse(content)
    // Handle both array and object with dataItems property
    return Array.isArray(parsed) ? parsed : (parsed.dataItems || [])
  } catch {
    return []
  }
}

/**
 * Read attributes from directory (assembles from per-element files).
 *
 * Supports two file formats:
 * - **Structured** (platform format): `{ elementId, elementType, classData, attributes: {...} }`
 * - **Flat** (agent enrichment format): `{ componentId, name, authentication, ... }`
 *
 * When `normCtx` is provided, flat-format files are automatically normalized to
 * structured format by resolving element names against the structure.
 */
/**
 * A per-file failure encountered while reading the attributes tree.
 *
 * These used to go only to `console.warn`, which in the MCP server writes to a
 * stderr stream that is part of no tool result — so an unparseable attribute
 * file was invisible to `validate` (which still returned `valid: true`),
 * silently lowered `quality`, and could be overwritten or unlinked by the next
 * push. Callers pass an accumulator to surface them.
 */
export interface AttributeReadIssue {
  file: string
  reason: string
  /**
   * Whether the file's bytes may hold work that exists nowhere else.
   *
   * True for a file that could not be read at all (parse or I/O failure) and
   * for a flat-format file this caller had no structure context to resolve —
   * in both cases the content is real enrichment that was never pushed, so
   * losing the bytes loses the work.
   *
   * False for the one case that is known litter rather than lost work: a file
   * that parsed cleanly but carries no usable element id (`undefined.json`).
   * `cleanupStaleAttributeFiles` exists in part to remove exactly that, and it
   * has always done so. Reporting it is the new part; preserving it would leave
   * the litter on disk indefinitely.
   */
  preserve: boolean
}

/**
 * The identity an attribute file is known by across a read/write round trip.
 *
 * `AttributeReadIssue.file` and the stale-file cleanup's protected set have to
 * agree exactly or the protection silently does nothing — so neither of them
 * spells the path itself.
 */
export function attributeFileKey(subdir: string, file: string): string {
  return `${DEFAULT_FILE_NAMES.attributes}/${subdir}/${file}`
}

/**
 * The comparison form of an attribute-file key.
 *
 * The two sides of the protection are not derived from the same source: the
 * producer reads a name off `fs.readdir`, while `writeAttributes` composes
 * `<elementId>.json` from the id the platform returned. On a case-insensitive
 * filesystem — APFS and NTFS by default, so most operators — an on-disk
 * `C-DB.json` holding `elementId: "c-db"` is protected under one spelling and
 * looked up under the other, the lookup misses, and the write truncates the
 * very file through its case-folded name. The guard silently does nothing,
 * which is the failure shape it exists to prevent.
 *
 * Comparing case-insensitively everywhere costs an over-match on a
 * case-sensitive filesystem: two files differing only in case would both be
 * protected, so a genuinely stale one survives. That is the right direction to
 * be wrong in — over-protection keeps a file and says so, under-protection
 * destroys one in silence.
 */
function attributeFileKeyForCompare(key: string): string {
  return key.toLowerCase()
}

/** Ask the protected set about a file, in the one form both sides agree on. */
function isProtectedAttributeFile(
  protectedFiles: ReadonlySet<string> | undefined,
  subdir: string,
  file: string,
): boolean {
  if (!protectedFiles || protectedFiles.size === 0) return false
  return protectedFiles.has(attributeFileKeyForCompare(attributeFileKey(subdir, file)))
}

/**
 * The set of attribute files a write must not touch, built from what a read
 * reported.
 *
 * The invariant every mutation path under `attributes/` honours: **a protected
 * path is never written over, renamed over, or unlinked.** There are three such
 * paths — `writeAttributes`, `updateAndRenameAttributes`, and
 * `cleanupStaleAttributeFiles` — and guarding only one of them leaves the file
 * just as destroyed by the other two.
 */
export function protectedAttributeFiles(
  issues: readonly AttributeReadIssue[]
): ReadonlySet<string> {
  return new Set(
    issues.filter((i) => i.preserve).map((i) => attributeFileKeyForCompare(i.file)),
  )
}

export async function readAttributes(
  dirPath: string,
  normCtx?: AttributeNormalizationContext,
  issues?: AttributeReadIssue[]
): Promise<ConsolidatedAttributesFile> {
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)
  const result: ConsolidatedAttributesFile = {
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {},
  }

  // Check if attributes is a file (consolidated) or directory (per-element)
  try {
    const stats = await fs.stat(attributesDir)

    if (stats.isFile()) {
      // Consolidated format: single attributes.json file
      const content = await fs.readFile(attributesDir, 'utf-8')
      return JSON.parse(content) as ConsolidatedAttributesFile
    }

    if (stats.isDirectory()) {
      // Build element lookup once if normalization context is provided
      let elementLookup: Map<string, ElementInfo> | null = null
      if (normCtx) {
        elementLookup = buildElementLookup(normCtx.structure, normCtx.dataFlows, normCtx.dataItems)
      }

      // Per-element format: read from subdirectories
      for (const subdir of ATTRIBUTES_SUBDIRS) {
        const subdirPath = path.join(attributesDir, subdir)
        const targetKey = subdir as keyof ConsolidatedAttributesFile

        try {
          const files = await fs.readdir(subdirPath)
          for (const file of files) {
            if (!file.endsWith('.json')) continue

            const filePath = path.join(subdirPath, file)
            try {
              const content = await fs.readFile(filePath, 'utf-8')
              const rawJson = JSON.parse(content) as Record<string, unknown>

              if (isFlatFormat(rawJson)) {
                // Flat enrichment format — normalize if context available
                if (!elementLookup) {
                  console.warn(
                    `[dethereal] Flat-format attribute file ${file} in ${subdir}/ ` +
                    `cannot be normalized (no structure context). Skipping.`
                  )
                  issues?.push({
                    file: attributeFileKey(subdir, file),
                    reason: 'flat-format file skipped — caller supplied no structure context',
                    preserve: true,
                  })
                  continue
                }
                const normalized = normalizeFlatAttribute(rawJson, subdir, elementLookup, file)
                if (normalized) {
                  result[targetKey]![normalized.resolvedId] = normalized.attrs
                }
              } else {
                // Structured format — existing behavior with improved validation
                const attrs = rawJson as unknown as ElementAttributes
                if (!attrs.elementId || attrs.elementId === 'undefined') {
                  console.warn(`[dethereal] Attribute file ${filePath} has invalid elementId: "${attrs.elementId}". Skipping.`)
                  issues?.push({
                    file: attributeFileKey(subdir, file),
                    reason: `structured attribute file carries no usable elementId (saw ${JSON.stringify(attrs.elementId)})`,
                    // Known litter, not lost work — see AttributeReadIssue.preserve.
                    preserve: false,
                  })
                  continue
                }
                validateElementId(attrs.elementId)
                result[targetKey]![attrs.elementId] = attrs
              }
            } catch (parseError) {
              const reason = parseError instanceof Error ? parseError.message : String(parseError)
              console.warn(`[dethereal] Failed to read attribute file ${filePath}: ${reason}`)
              issues?.push({ file: attributeFileKey(subdir, file), reason, preserve: true })
            }
          }
        } catch {
          // Subdirectory doesn't exist, skip
        }
      }
    }
  } catch {
    // Attributes directory doesn't exist, return empty
  }

  return result
}

/**
 * Read a complete model from a split-file directory
 */
export async function readModelDirectory(
  dirPath: string,
  issues?: AttributeReadIssue[]
): Promise<SplitModel> {
  const manifest = await readManifest(dirPath)
  const structure = await readStructure(dirPath)
  const dataFlows = await readDataFlows(dirPath)
  const dataItems = await readDataItems(dirPath)
  // Pass structure context so flat-format attribute files are normalized, and
  // the accumulator so a file this read could not use is not mistaken for an
  // absent element by whatever the caller does next (see readAttributes).
  const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems }, issues)

  return {
    manifest,
    structure,
    dataFlows,
    dataItems,
    attributes,
  }
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Ensure the model directory structure exists
 */
export async function ensureModelDirectoryStructure(dirPath: string): Promise<void> {
  await validatePathConfinement(dirPath);
  // Create main directory
  await fs.mkdir(dirPath, { recursive: true })

  // Create attributes subdirectories
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)
  await fs.mkdir(attributesDir, { recursive: true })

  for (const subdir of ATTRIBUTES_SUBDIRS) {
    await fs.mkdir(path.join(attributesDir, subdir), { recursive: true })
  }
}

/**
 * Write manifest to directory
 */
export async function writeManifest(dirPath: string, manifest: ModelManifest): Promise<void> {
  await validatePathConfinement(dirPath);
  const manifestPath = path.join(dirPath, DEFAULT_FILE_NAMES.manifest)
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

/**
 * Write structure to directory
 */
export async function writeStructure(dirPath: string, structure: ModelStructure): Promise<void> {
  await validatePathConfinement(dirPath);
  const structurePath = path.join(dirPath, DEFAULT_FILE_NAMES.structure)
  await fs.writeFile(structurePath, JSON.stringify(structure, null, 2), 'utf-8')
}

/**
 * Write dataflows to directory
 */
export async function writeDataFlows(dirPath: string, dataFlows: DataFlow[]): Promise<void> {
  await validatePathConfinement(dirPath);
  const dataFlowsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataFlows)
  await fs.writeFile(dataFlowsPath, JSON.stringify({ dataFlows }, null, 2), 'utf-8')
}

/**
 * Write data items to directory
 */
export async function writeDataItems(dirPath: string, dataItems: DataItem[]): Promise<void> {
  await validatePathConfinement(dirPath);
  const dataItemsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataItems)
  await fs.writeFile(dataItemsPath, JSON.stringify({ dataItems }, null, 2), 'utf-8')
}

/**
 * Write attributes to directory (per-element format)
 */
export async function writeAttributes(
  dirPath: string,
  attributes: ConsolidatedAttributesFile,
  protectedFiles?: ReadonlySet<string>
): Promise<void> {
  await validatePathConfinement(dirPath);
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)

  /**
   * Overwriting is the second way to destroy a protected file, and it fires in
   * the case unlink never reaches: the element id is still current, so cleanup
   * skips the file, and the merge-back writes the platform's copy straight over
   * the bytes. The platform's copy cannot contain the local enrichment — the
   * file failed to read, so it was never pushed — so this trades the operator's
   * unpushed work for a copy that is missing it.
   *
   * Skipping means the platform's values do not land for that element until the
   * file is repaired. That is the right trade: the values are still on the
   * platform, the bytes exist nowhere else.
   */
  const skip = (subdir: string, elementId: string): boolean => {
    if (!isProtectedAttributeFile(protectedFiles, subdir, `${elementId}.json`)) return false
    console.warn(
      `[dethereal] Not overwriting ${subdir}/${elementId}.json: it could not be read, ` +
      `so its contents cannot be recovered if replaced.`
    )
    return true
  }

  // Ensure subdirectories exist
  for (const subdir of ATTRIBUTES_SUBDIRS) {
    await fs.mkdir(path.join(attributesDir, subdir), { recursive: true })
  }

  // Write boundary attributes
  if (attributes.boundaries) {
    for (const [elementId, attrs] of Object.entries(attributes.boundaries)) {
      validateElementId(elementId)
      if (skip('boundaries', elementId)) continue
      const filePath = path.join(attributesDir, 'boundaries', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }

  // Write component attributes
  if (attributes.components) {
    for (const [elementId, attrs] of Object.entries(attributes.components)) {
      validateElementId(elementId)
      if (skip('components', elementId)) continue
      const filePath = path.join(attributesDir, 'components', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }

  // Write dataflow attributes
  if (attributes.dataFlows) {
    for (const [elementId, attrs] of Object.entries(attributes.dataFlows)) {
      validateElementId(elementId)
      if (skip('dataFlows', elementId)) continue
      const filePath = path.join(attributesDir, 'dataFlows', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }

  // Write data item attributes
  if (attributes.dataItems) {
    for (const [elementId, attrs] of Object.entries(attributes.dataItems)) {
      validateElementId(elementId)
      if (skip('dataItems', elementId)) continue
      const filePath = path.join(attributesDir, 'dataItems', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }
}

/**
 * Write a complete model to a split-file directory
 */
export interface WriteModelDirectoryOptions {
  /**
   * Attribute files (as `attributes/<subdir>/<file>.json`, the shape
   * `AttributeReadIssue.file` carries) that the caller's read could NOT parse
   * or resolve.
   *
   * Stale-file cleanup decides what to unlink by asking whether a filename
   * corresponds to a current element. A file that failed to read produced no
   * element, so it looks exactly like a stale one and gets deleted — a parse
   * error in an enriched attribute file would otherwise destroy that file on
   * the next write. Cleanup cannot detect this itself: from its side an
   * unreadable file and a genuinely orphaned one are indistinguishable. Only
   * the reader knows, so the reader tells it.
   */
  protectedAttributeFiles?: ReadonlySet<string>
}

export async function writeModelDirectory(
  dirPath: string,
  model: SplitModel,
  options?: WriteModelDirectoryOptions
): Promise<void> {
  // Ensure directory structure exists
  await ensureModelDirectoryStructure(dirPath)

  // Write all files
  await writeManifest(dirPath, model.manifest)
  await writeStructure(dirPath, model.structure)
  await writeDataFlows(dirPath, model.dataFlows)
  await writeDataItems(dirPath, model.dataItems)
  await writeAttributes(dirPath, model.attributes, options?.protectedAttributeFiles)

  // writeAttributes only writes the current bags — attribute files for
  // elements deleted since the last write would otherwise survive forever
  // (and update_model's local-merge resurrects them). Idempotent; also runs
  // on the applyIdMapping path.
  await cleanupStaleAttributeFiles(dirPath, model.attributes, options?.protectedAttributeFiles)
}

// =============================================================================
// Scope I/O (.dethereal/scope.json)
// =============================================================================

/**
 * Read the platform-synced model scope from `.dethereal/scope.json`.
 *
 * scope.json is a superset on disk (it also holds skill-owned local-only keys like
 * `crown_jewels`, `adversary_classes`, `activeModules`). This projects to just the five
 * synced keys so the value can be attached to `manifest.model.scope` for a push without
 * leaking local-only keys into manifest.json.
 *
 * Returns `null` when the file is absent/unparseable or carries none of the synced keys.
 */
export async function readScope(modelDir: string): Promise<ModelScopeLocal | null> {
  const scopePath = path.join(modelDir, DETHEREAL_DIR, SCOPE_FILE)
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await fs.readFile(scopePath, 'utf-8'))
  } catch {
    return null
  }

  const scope: ModelScopeLocal = {}
  for (const key of SYNCED_SCOPE_KEYS) {
    if (raw[key] !== undefined) {
      ;(scope as Record<string, unknown>)[key] = raw[key]
    }
  }
  return Object.keys(scope).length > 0 ? scope : null
}

/**
 * Write the platform-synced model scope into `.dethereal/scope.json`, merge-preserving.
 *
 * Preserves every existing key (the skill-owned local-only keys) and replaces the synced
 * view: each synced key present in `scope` is set, each absent one is deleted (symmetric
 * with the push REPLACE semantics — scope.json mirrors the platform's synced state).
 *
 * Callers pass an empty `scope` ({}) when the platform has no scope set, so the mirror still
 * runs and clears any stale synced keys left on disk. To avoid materialising a noise-only file,
 * an empty `scope` with no pre-existing scope.json is a no-op (nothing to clear, nothing to write).
 */
export async function writeScope(modelDir: string, scope: ModelScopeLocal): Promise<void> {
  const detherealDir = path.join(modelDir, DETHEREAL_DIR)
  const scopePath = path.join(detherealDir, SCOPE_FILE)

  // Read any existing file first (before mkdir) so we distinguish absent / parseable /
  // malformed without leaving side effects.
  let rawExisting: string | null = null
  try {
    rawExisting = await fs.readFile(scopePath, 'utf-8')
  } catch {
    // No existing scope.json.
  }

  const incoming = scope as Record<string, unknown>
  const hasSyncedKeys = SYNCED_SCOPE_KEYS.some((key) => incoming[key] !== undefined)

  // Nothing to mirror and no file to reconcile: don't create an empty scope.json. Reached on a
  // pull/push of a model whose platform scope is empty and which has no local scope.json yet.
  if (rawExisting === null && !hasSyncedKeys) return

  let existing: Record<string, unknown> = {}
  if (rawExisting !== null) {
    // Fail loud on a present-but-unparseable file rather than overwriting it: a
    // blind `{}` fallback here would silently destroy the skill-owned local-only
    // keys (crown_jewels, adversary_classes, …) on the next merge.
    try {
      existing = JSON.parse(rawExisting)
    } catch {
      throw new Error(
        `Refusing to overwrite malformed ${SCOPE_FILE} (it would destroy local-only scope keys); fix or remove the file first`,
      )
    }
  }

  const merged: Record<string, unknown> = { ...existing }
  for (const key of SYNCED_SCOPE_KEYS) {
    if (incoming[key] !== undefined) {
      merged[key] = incoming[key]
    } else {
      delete merged[key]
    }
  }

  await fs.mkdir(detherealDir, { recursive: true })
  await fs.writeFile(scopePath, JSON.stringify(merged, null, 2), 'utf-8')
}

/**
 * The platform tracks crown jewels on **components** only — a component's `crownJewel` is a
 * first-class `structure.json` field that syncs. There is no crown-jewel field on data items /
 * boundaries / data flows, so a `crown_jewel: true` on one of those *attribute bags* can't be
 * pushed. Returns a one-line user notice (or `null` when there are none) so a push can surface
 * what it left behind rather than silently dropping it.
 *
 * Detection scans the non-component bags for `crown_jewel` at the bag root or nested under
 * `attributes`. Components are intentionally excluded — their `crownJewel` syncs via structure.json.
 */
export function localOnlyCrownJewelNotice(attributes: ConsolidatedAttributesFile): string | null {
  let count = 0
  for (const subdir of ['dataItems', 'boundaries', 'dataFlows'] as const) {
    const bags = attributes[subdir]
    if (!bags) continue
    for (const bag of Object.values(bags)) {
      const b = bag as { crown_jewel?: unknown; attributes?: { crown_jewel?: unknown } }
      if (b?.crown_jewel === true || b?.attributes?.crown_jewel === true) count++
    }
  }
  if (count === 0) return null
  return `Crown-jewel marks on ${count} non-component element(s) (data items / boundaries / flows) are local-only — the platform tracks crown jewels on components, so these were not synced.`
}

// =============================================================================
// Backup Operations
// =============================================================================

/**
 * Create a timestamped backup of a directory
 */
export async function createDirectoryBackup(dirPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const parentDir = path.dirname(dirPath)
  const baseName = path.basename(dirPath)
  const backupPath = path.join(parentDir, `${baseName}.backup-${timestamp}`)

  // Validate backup path stays within confinement boundary
  await validatePathConfinement(backupPath)

  // Recursively copy directory
  await copyDirectory(dirPath, backupPath)

  return backupPath
}

/**
 * Recursively copy a directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

// =============================================================================
// ID Mapping Operations
// =============================================================================

/**
 * Apply ID mapping to all files in a directory after import.
 * This rewrites the JSON files replacing reference IDs with server-generated IDs.
 *
 * @param dirPath - Path to the model directory
 * @param idMapping - Map of reference ID → server ID
 * @param modelId - The server-generated model ID
 */
export async function applyIdMapping(
  dirPath: string,
  idMapping: Map<string, string>,
  modelId: string
): Promise<void> {
  // Read current files
  const manifest = await readManifest(dirPath)
  const structure = await readStructure(dirPath)
  const dataFlows = await readDataFlows(dirPath)
  const dataItems = await readDataItems(dirPath)
  // Pass normalization context so flat-format attribute files are converted,
  // and collect read failures: this function ends in a stale-file cleanup, and
  // a file that failed to read is absent from `attributes` for reasons that
  // have nothing to do with staleness.
  const readIssues: AttributeReadIssue[] = []
  const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems }, readIssues)

  // Update manifest with model ID and default boundary ID
  manifest.model.id = modelId
  if (manifest.model.defaultBoundaryId) {
    const newDefaultBoundaryId = idMapping.get(manifest.model.defaultBoundaryId)
    if (newDefaultBoundaryId) {
      manifest.model.defaultBoundaryId = newDefaultBoundaryId
    }
  }

  // Update structure IDs
  const updatedStructure = updateStructureIds(structure, idMapping)

  // Update dataflow IDs and references
  const updatedDataFlows = dataFlows.map(flow => updateDataFlowIds(flow, idMapping))

  // Update data item IDs
  const updatedDataItems = dataItems.map(item => updateDataItemIds(item, idMapping))

  // Update attribute element IDs and rename files
  const protectedFiles = protectedAttributeFiles(readIssues)
  const updatedAttributes = await updateAndRenameAttributes(dirPath, attributes, idMapping, protectedFiles)

  // Re-key the id-keyed sidecars under .dethereal/ — see remapLocalSidecars.
  await remapLocalSidecars(dirPath, idMapping)

  // Write updated files
  await writeManifest(dirPath, manifest)
  await writeStructure(dirPath, updatedStructure)
  await writeDataFlows(dirPath, updatedDataFlows)
  await writeDataItems(dirPath, updatedDataItems)
  await writeAttributes(dirPath, updatedAttributes, protectedFiles)

  // Clean up stale files (flat-format originals, undefined.json, etc.)
  await cleanupStaleAttributeFiles(dirPath, updatedAttributes, protectedFiles)
}

/**
 * Re-key the id-keyed sidecars under `.dethereal/` onto the platform's ids.
 *
 * Two local files are keyed by element id and are therefore invalidated the
 * moment a push swaps local reference ids for platform ones:
 *
 * - `.dethereal/template-fields/<element-id>.json` — `generate_attribute_stubs`
 *   looks a manifest up by the element's CURRENT id, so against an orphaned set
 *   that lookup always misses. Reclassification cleanup silently stops pruning
 *   the previous class's template fields.
 * - `.dethereal/state.json`'s `staleElements[]` — the re-enrichment queue. Held
 *   in pre-push ids it resolves to no element, so the next enrichment pass
 *   finds nothing and drops the elements that were explicitly queued.
 *
 * This must run wherever ids change on disk, which is not only the first push:
 * `update_model` mints platform ids for newly added elements and rewrites the
 * model files with them on its re-export path. Both are id-remap sites; only
 * one used to fix the sidecars.
 *
 * Best-effort throughout: these are local optimisations, never model data, so
 * nothing here may fail a push that already succeeded platform-side.
 */
export async function remapLocalSidecars(
  dirPath: string,
  idMapping: Map<string, string> | undefined
): Promise<void> {
  if (!idMapping || idMapping.size === 0) return
  await renameTemplateFieldManifests(dirPath, idMapping)
  await remapStateStaleElements(dirPath, idMapping)
}

/**
 * Re-key the element ids held in `.dethereal/state.json`'s `staleElements[]`.
 *
 * `src/` otherwise never touches state.json — it is maintained by the skills —
 * but nothing else runs at the moment ids change, so after the first push the
 * array holds pre-push ids that resolve to no element. The next enrichment pass
 * reads it to decide what to prioritise, finds nothing, and silently drops the
 * elements that were explicitly queued as needing attention. Same failure shape
 * as the orphaned template-field manifests above; fixed in the same place.
 *
 * Best-effort: state.json is workflow bookkeeping, never model data, so a
 * missing or malformed file must not fail a push that already succeeded.
 */
async function remapStateStaleElements(
  dirPath: string,
  idMapping: Map<string, string>
): Promise<void> {
  const statePath = path.join(dirPath, DETHEREAL_DIR, 'state.json')

  try {
    const raw = await fs.readFile(statePath, 'utf-8')
    const state = JSON.parse(raw) as Record<string, unknown>
    const stale = state.staleElements
    if (!Array.isArray(stale) || stale.length === 0) return

    let changed = false
    const remapped = stale.map((id) => {
      if (typeof id !== 'string') return id
      const next = idMapping.get(id)
      if (next && next !== id) { changed = true; return next }
      return id
    })
    if (!changed) return

    state.staleElements = remapped
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // Absent, unreadable, or not JSON — leave it alone.
  }
}

/**
 * Rename `.dethereal/template-fields/<element-id>.json` manifests onto the
 * element's new id after an id remap.
 *
 * Best-effort by design: the manifests are a local optimisation for
 * reclassification cleanup, not model data, so a missing directory or an
 * unreadable entry must never fail the push that just succeeded platform-side.
 * Only entries whose id actually changed are touched; unmapped ids are left
 * where they are.
 */
async function renameTemplateFieldManifests(
  dirPath: string,
  idMapping: Map<string, string>
): Promise<void> {
  const manifestDir = path.join(dirPath, DETHEREAL_DIR, 'template-fields')

  let entries: string[]
  try {
    entries = await fs.readdir(manifestDir)
  } catch {
    return // no manifests for this model — nothing to re-key
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const oldId = entry.slice(0, -'.json'.length)
    const newId = idMapping.get(oldId)
    if (!newId || newId === oldId) continue

    try {
      validateElementId(oldId)
      validateElementId(newId)
    } catch {
      continue // refuse to build a path from an id that failed confinement checks
    }

    const oldPath = path.join(manifestDir, entry)
    const newPath = path.join(manifestDir, `${newId}.json`)
    try {
      // Overwrite rather than skip: a manifest already sitting on the new id is
      // from an earlier run of the same element and is not newer than this one.
      await fs.rename(oldPath, newPath)
    } catch {
      // Unreadable/locked manifest — losing it costs one reclassification
      // cleanup, never model data. Do not fail the id remap for it.
    }
  }
}

/**
 * Update IDs in structure recursively
 */
function updateStructureIds(structure: ModelStructure, idMapping: Map<string, string>): ModelStructure {
  return {
    defaultBoundary: updateBoundaryIds(structure.defaultBoundary, idMapping),
  }
}

/**
 * Update IDs in a boundary recursively
 */
function updateBoundaryIds(boundary: StructureBoundary, idMapping: Map<string, string>): StructureBoundary {
  const newId = idMapping.get(boundary.id) || boundary.id

  const updated: StructureBoundary = {
    ...boundary,
    id: newId,
  }

  // Update parent boundary reference
  if (boundary.parentBoundary?.id) {
    updated.parentBoundary = {
      id: idMapping.get(boundary.parentBoundary.id) || boundary.parentBoundary.id,
    }
  }

  // Update data item IDs
  if (boundary.dataItemIds) {
    updated.dataItemIds = boundary.dataItemIds.map(id => idMapping.get(id) || id)
  }

  // Update conduit peer references. A conduit's `peerId` is a boundary id, so it must be remapped
  // through the same idMapping as every other id — otherwise, after the first import rewrites all
  // boundary ids to platform UUIDs, the local peerId keeps its pre-import (author) value and the
  // next update_model can no longer resolve the peer, silently dropping the declared channel.
  if (boundary.conduits) {
    updated.conduits = boundary.conduits.map(conduit => ({
      ...conduit,
      peerId: idMapping.get(conduit.peerId) || conduit.peerId,
    }))
  }

  // Update control IDs
  if (boundary.controls) {
    updated.controls = boundary.controls.map(ctrl => ({
      ...ctrl,
      id: idMapping.get(ctrl.id) || ctrl.id,
    }))
  }

  // Update nested boundaries
  if (boundary.boundaries) {
    updated.boundaries = boundary.boundaries.map(b => updateBoundaryIds(b, idMapping))
  }

  // Update components
  if (boundary.components) {
    updated.components = boundary.components.map(c => updateComponentIds(c, idMapping))
  }

  return updated
}

/**
 * Update IDs in a component
 */
function updateComponentIds(component: StructureComponent, idMapping: Map<string, string>): StructureComponent {
  const newId = idMapping.get(component.id) || component.id

  const updated: StructureComponent = {
    ...component,
    id: newId,
  }

  // Update parent boundary reference
  if (component.parentBoundary?.id) {
    updated.parentBoundary = {
      id: idMapping.get(component.parentBoundary.id) || component.parentBoundary.id,
    }
  }

  // Update data item IDs
  if (component.dataItemIds) {
    updated.dataItemIds = component.dataItemIds.map(id => idMapping.get(id) || id)
  }

  // Update control IDs
  if (component.controls) {
    updated.controls = component.controls.map(ctrl => ({
      ...ctrl,
      id: idMapping.get(ctrl.id) || ctrl.id,
    }))
  }

  return updated
}

/**
 * Update IDs in a data flow
 */
function updateDataFlowIds(flow: DataFlow, idMapping: Map<string, string>): DataFlow {
  const newId = idMapping.get(flow.id) || flow.id

  const updated: DataFlow = {
    ...flow,
    id: newId,
    source: {
      id: idMapping.get(flow.source.id) || flow.source.id,
    },
    target: {
      id: idMapping.get(flow.target.id) || flow.target.id,
    },
  }

  // Update data item IDs
  if (flow.dataItemIds) {
    updated.dataItemIds = flow.dataItemIds.map(id => idMapping.get(id) || id)
  }

  // Update control IDs
  if (flow.controls) {
    updated.controls = flow.controls.map(ctrl => ({
      ...ctrl,
      id: idMapping.get(ctrl.id) || ctrl.id,
    }))
  }

  return updated
}

/**
 * Update IDs in a data item
 */
function updateDataItemIds(item: DataItem, idMapping: Map<string, string>): DataItem {
  const newId = idMapping.get(item.id) || item.id

  return {
    ...item,
    id: newId,
  }
}

/**
 * Update attribute element IDs and rename files
 */
async function updateAndRenameAttributes(
  dirPath: string,
  attributes: ConsolidatedAttributesFile,
  idMapping: Map<string, string>,
  protectedFiles?: ReadonlySet<string>
): Promise<ConsolidatedAttributesFile> {
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)
  const updated: ConsolidatedAttributesFile = {
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {},
  }

  // Helper to update and rename attribute files
  async function processAttributeGroup(
    group: Record<string, ElementAttributes> | undefined,
    subdir: string,
    targetKey: keyof ConsolidatedAttributesFile
  ): Promise<void> {
    if (!group) return

    for (const [oldId, attrs] of Object.entries(group)) {
      const newId = idMapping.get(oldId) || oldId
      validateElementId(oldId)
      validateElementId(newId)

      // Update element ID in attributes
      const updatedAttrs: ElementAttributes = {
        ...attrs,
        elementId: newId,
      }

      updated[targetKey]![newId] = updatedAttrs

      // Delete old file if ID changed
      if (newId !== oldId) {
        // The third mutation path, and the one that is easiest to miss: the
        // old-id filename can belong to a DIFFERENT file from the one that
        // produced this bag entry. A flat-format file resolving to `c-db`
        // puts `c-db` in the bag while the unreadable `c-db.json` sits beside
        // it — and this unlink then deletes the unreadable one.
        if (isProtectedAttributeFile(protectedFiles, subdir, `${oldId}.json`)) {
          console.warn(
            `[dethereal] Keeping ${subdir}/${oldId}.json through the id remap: ` +
            `it could not be read, so its contents cannot be recovered if removed.`
          )
          continue
        }
        const oldPath = path.join(attributesDir, subdir, `${oldId}.json`)
        try {
          await fs.unlink(oldPath)
        } catch {
          // File doesn't exist, ignore
        }
      }
    }
  }

  await processAttributeGroup(attributes.boundaries, 'boundaries', 'boundaries')
  await processAttributeGroup(attributes.components, 'components', 'components')
  await processAttributeGroup(attributes.dataFlows, 'dataFlows', 'dataFlows')
  await processAttributeGroup(attributes.dataItems, 'dataItems', 'dataItems')

  return updated
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that a directory contains all required model files
 */
export async function validateModelDirectory(dirPath: string): Promise<{
  valid: boolean
  errors: string[]
  warnings: string[]
}> {
  const errors: string[] = []
  const warnings: string[] = []

  // Check manifest exists
  const manifestPath = path.join(dirPath, DEFAULT_FILE_NAMES.manifest)
  try {
    await fs.access(manifestPath)
  } catch {
    errors.push(`Missing required file: ${DEFAULT_FILE_NAMES.manifest}`)
  }

  // Check structure exists
  const structurePath = path.join(dirPath, DEFAULT_FILE_NAMES.structure)
  try {
    await fs.access(structurePath)
  } catch {
    errors.push(`Missing required file: ${DEFAULT_FILE_NAMES.structure}`)
  }

  // Check dataflows exists
  const dataFlowsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataFlows)
  try {
    await fs.access(dataFlowsPath)
  } catch {
    warnings.push(`Missing optional file: ${DEFAULT_FILE_NAMES.dataFlows}`)
  }

  // Check data-items exists
  const dataItemsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataItems)
  try {
    await fs.access(dataItemsPath)
  } catch {
    warnings.push(`Missing optional file: ${DEFAULT_FILE_NAMES.dataItems}`)
  }

  // Check attributes directory exists
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)
  try {
    const stats = await fs.stat(attributesDir)
    if (!stats.isDirectory()) {
      warnings.push(`${DEFAULT_FILE_NAMES.attributes} exists but is not a directory`)
    }
  } catch {
    warnings.push(`Missing optional directory: ${DEFAULT_FILE_NAMES.attributes}`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// =============================================================================
// Attribute File Cleanup
// =============================================================================

/**
 * Remove attribute files whose filenames don't match any current element ID.
 * This cleans up flat-format files (e.g., c-postgres.json) and stale
 * undefined.json files after normalization + ID mapping.
 */
async function cleanupStaleAttributeFiles(
  dirPath: string,
  currentAttributes: ConsolidatedAttributesFile,
  protectedFiles?: ReadonlySet<string>
): Promise<void> {
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)

  const currentIdSets: Record<string, Set<string>> = {
    boundaries: new Set(Object.keys(currentAttributes.boundaries ?? {})),
    components: new Set(Object.keys(currentAttributes.components ?? {})),
    dataFlows:  new Set(Object.keys(currentAttributes.dataFlows ?? {})),
    dataItems:  new Set(Object.keys(currentAttributes.dataItems ?? {})),
  }

  for (const subdir of ATTRIBUTES_SUBDIRS) {
    const subdirPath = path.join(attributesDir, subdir)
    const validIds = currentIdSets[subdir]
    if (!validIds) continue

    try {
      const files = await fs.readdir(subdirPath)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const stem = file.replace('.json', '')
        if (validIds.has(stem)) continue
        // A file the read could not use is absent from `currentAttributes` for
        // a reason that has nothing to do with staleness. Deleting it would
        // turn a recoverable parse error into lost enrichment work.
        if (isProtectedAttributeFile(protectedFiles, subdir, file)) {
          console.warn(
            `[dethereal] Keeping ${subdir}/${file}: it could not be read, so it cannot be shown to be stale.`
          )
          continue
        }
        try {
          await fs.unlink(path.join(subdirPath, file))
        } catch {
          // File may already be gone
        }
      }
    } catch {
      // Subdirectory doesn't exist
    }
  }
}
