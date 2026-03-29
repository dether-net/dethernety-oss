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
 */
function validateElementId(elementId: string): void {
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

interface ElementInfo {
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
      id: f.id, name: f.name, elementType: 'dataFlow', classData: (f as Record<string, unknown>).classData as ClassReference | undefined
    })
  }
  for (const d of dataItems) {
    lookup.set(`dataItem:${d.name}`, {
      id: d.id, name: d.name, elementType: 'dataItem', classData: (d as Record<string, unknown>).classData as ClassReference | undefined
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

  // Check models.json allowlist
  const allowedPaths = await loadAllowedModelPaths()
  for (const allowed of allowedPaths) {
    const resolvedAllowed = path.resolve(allowed)
    if (realPath.startsWith(resolvedAllowed + path.sep) || realPath === resolvedAllowed) {
      return realPath
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
export async function readAttributes(
  dirPath: string,
  normCtx?: AttributeNormalizationContext
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
                  continue
                }
                validateElementId(attrs.elementId)
                result[targetKey]![attrs.elementId] = attrs
              }
            } catch (parseError) {
              console.warn(
                `[dethereal] Failed to read attribute file ${filePath}: ` +
                `${parseError instanceof Error ? parseError.message : String(parseError)}`
              )
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
export async function readModelDirectory(dirPath: string): Promise<SplitModel> {
  const manifest = await readManifest(dirPath)
  const structure = await readStructure(dirPath)
  const dataFlows = await readDataFlows(dirPath)
  const dataItems = await readDataItems(dirPath)
  // Pass structure context so flat-format attribute files are normalized
  const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems })

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
  attributes: ConsolidatedAttributesFile
): Promise<void> {
  await validatePathConfinement(dirPath);
  const attributesDir = path.join(dirPath, DEFAULT_FILE_NAMES.attributes)

  // Ensure subdirectories exist
  for (const subdir of ATTRIBUTES_SUBDIRS) {
    await fs.mkdir(path.join(attributesDir, subdir), { recursive: true })
  }

  // Write boundary attributes
  if (attributes.boundaries) {
    for (const [elementId, attrs] of Object.entries(attributes.boundaries)) {
      validateElementId(elementId)
      const filePath = path.join(attributesDir, 'boundaries', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }

  // Write component attributes
  if (attributes.components) {
    for (const [elementId, attrs] of Object.entries(attributes.components)) {
      validateElementId(elementId)
      const filePath = path.join(attributesDir, 'components', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }

  // Write dataflow attributes
  if (attributes.dataFlows) {
    for (const [elementId, attrs] of Object.entries(attributes.dataFlows)) {
      validateElementId(elementId)
      const filePath = path.join(attributesDir, 'dataFlows', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }

  // Write data item attributes
  if (attributes.dataItems) {
    for (const [elementId, attrs] of Object.entries(attributes.dataItems)) {
      validateElementId(elementId)
      const filePath = path.join(attributesDir, 'dataItems', `${elementId}.json`)
      await fs.writeFile(filePath, JSON.stringify(attrs, null, 2), 'utf-8')
    }
  }
}

/**
 * Write a complete model to a split-file directory
 */
export async function writeModelDirectory(
  dirPath: string,
  model: SplitModel
): Promise<void> {
  // Ensure directory structure exists
  await ensureModelDirectoryStructure(dirPath)

  // Write all files
  await writeManifest(dirPath, model.manifest)
  await writeStructure(dirPath, model.structure)
  await writeDataFlows(dirPath, model.dataFlows)
  await writeDataItems(dirPath, model.dataItems)
  await writeAttributes(dirPath, model.attributes)
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
  // Pass normalization context so flat-format attribute files are converted
  const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems })

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
  const updatedAttributes = await updateAndRenameAttributes(dirPath, attributes, idMapping)

  // Write updated files
  await writeManifest(dirPath, manifest)
  await writeStructure(dirPath, updatedStructure)
  await writeDataFlows(dirPath, updatedDataFlows)
  await writeDataItems(dirPath, updatedDataItems)
  await writeAttributes(dirPath, updatedAttributes)

  // Clean up stale files (flat-format originals, undefined.json, etc.)
  await cleanupStaleAttributeFiles(dirPath, updatedAttributes)
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
  idMapping: Map<string, string>
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
  currentAttributes: ConsolidatedAttributesFile
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
        if (!validIds.has(stem)) {
          try {
            await fs.unlink(path.join(subdirPath, file))
          } catch {
            // File may already be gone
          }
        }
      }
    } catch {
      // Subdirectory doesn't exist
    }
  }
}
