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
} from '@dethernety/dt-core'
import {
  DEFAULT_FILE_NAMES,
  SCHEMA_VERSION,
} from '@dethernety/dt-core'

// =============================================================================
// Constants
// =============================================================================

const ATTRIBUTES_SUBDIRS = ['boundaries', 'components', 'dataFlows', 'dataItems'] as const

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
// Path Validation
// =============================================================================

/**
 * Validate that a path is within the allowed base directory.
 * Prevents path traversal attacks via directory_path parameters.
 */
export function validatePathConfinement(targetPath: string, baseDir?: string): string {
  const base = path.resolve(baseDir || process.cwd());
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path "${targetPath}" is outside the allowed directory`);
  }
  return resolved;
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
    throw new Error(`Invalid JSON in manifest at ${manifestPath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`)
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
    throw new Error(`Invalid JSON in structure at ${structurePath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`)
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
 * Read attributes from directory (assembles from per-element files)
 */
export async function readAttributes(dirPath: string): Promise<ConsolidatedAttributesFile> {
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
      // Per-element format: read from subdirectories
      for (const subdir of ATTRIBUTES_SUBDIRS) {
        const subdirPath = path.join(attributesDir, subdir)
        const targetKey = subdir as keyof ConsolidatedAttributesFile

        try {
          const files = await fs.readdir(subdirPath)
          for (const file of files) {
            if (file.endsWith('.json')) {
              const filePath = path.join(subdirPath, file)
              const content = await fs.readFile(filePath, 'utf-8')
              const attrs = JSON.parse(content) as ElementAttributes
              validateElementId(attrs.elementId)
              result[targetKey]![attrs.elementId] = attrs
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
  const attributes = await readAttributes(dirPath)

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
  validatePathConfinement(dirPath);
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
  validatePathConfinement(dirPath);
  const manifestPath = path.join(dirPath, DEFAULT_FILE_NAMES.manifest)
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

/**
 * Write structure to directory
 */
export async function writeStructure(dirPath: string, structure: ModelStructure): Promise<void> {
  validatePathConfinement(dirPath);
  const structurePath = path.join(dirPath, DEFAULT_FILE_NAMES.structure)
  await fs.writeFile(structurePath, JSON.stringify(structure, null, 2), 'utf-8')
}

/**
 * Write dataflows to directory
 */
export async function writeDataFlows(dirPath: string, dataFlows: DataFlow[]): Promise<void> {
  validatePathConfinement(dirPath);
  const dataFlowsPath = path.join(dirPath, DEFAULT_FILE_NAMES.dataFlows)
  await fs.writeFile(dataFlowsPath, JSON.stringify({ dataFlows }, null, 2), 'utf-8')
}

/**
 * Write data items to directory
 */
export async function writeDataItems(dirPath: string, dataItems: DataItem[]): Promise<void> {
  validatePathConfinement(dirPath);
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
  validatePathConfinement(dirPath);
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
  validatePathConfinement(backupPath)

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
  const attributes = await readAttributes(dirPath)

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
