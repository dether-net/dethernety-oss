/**
 * Generate Attribute Stubs Tool
 *
 * Deterministically writes class template attribute stubs to disk for all
 * classified elements. Replaces the fragile 5-step agent instruction sequence
 * (fetch template → extract schema → read existing → merge → write) with a
 * single tool call.
 *
 * Key behaviors:
 * - Auto-scans structure.json for classified elements (or filters by element_ids)
 * - Deduplicates class IDs — N elements with K unique classes = K GraphQL fetches
 * - Merges template defaults into existing attribute files (existing values always win)
 * - Writes class cache to .dethereal/class-cache/ for offline resilience
 * - Writes template field manifests to .dethereal/template-fields/ for reclassification
 * - Idempotent: running twice produces identical output
 */

import { z } from 'zod'
import { promises as fs } from 'fs'
import path from 'path'
import { DtClass } from '@dethernety/dt-core'
import type { Class } from '@dethernety/dt-core'
import { flattenStructure } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  validatePathConfinement,
  readStructure,
  readDataFlows,
  readDataItems,
  isFlatFormat,
  normalizeFlatAttribute,
} from '../utils/directory-utils.js'

// =============================================================================
// Input / Output Types
// =============================================================================

const InputSchema = z.object({
  directory_path: z.string().describe('Path to the model directory'),
  element_ids: z.array(z.string()).optional()
    .describe('Specific element IDs to generate stubs for. If omitted, auto-scans all classified elements.'),
})

type GenerateStubsInput = z.infer<typeof InputSchema>

interface GenerateStubsResult {
  generated: number
  skipped: number
  reclassified: number
  cached_classes: number
  failed: Array<{ element_id: string; reason: string }>
  warnings: string[]
}

// =============================================================================
// Internal Types
// =============================================================================

interface ClassifiedElement {
  id: string
  name: string
  elementType: 'component' | 'boundary' | 'dataFlow' | 'dataItem'
  classData: { id: string; name: string; [key: string]: unknown }
}

/** Maps element type to attribute subdirectory and classType for getClassById */
const ELEMENT_TYPE_CONFIG: Record<string, { subdir: string; classType: string }> = {
  component: { subdir: 'components', classType: 'component' },
  boundary: { subdir: 'boundaries', classType: 'boundary' },
  dataFlow: { subdir: 'dataFlows', classType: 'dataflow' },
  dataItem: { subdir: 'dataItems', classType: 'data' },
}

// =============================================================================
// Tool Implementation
// =============================================================================

export class GenerateAttributeStubsTool extends ClientDependentTool<GenerateStubsInput, GenerateStubsResult> {
  readonly name = 'generate_attribute_stubs'
  readonly description = 'Deterministically write class template attribute stubs to disk for classified elements. Auto-scans structure.json, deduplicates classes, fetches templates via GraphQL, and merges template fields into existing attribute files (existing values always preserved). Call after classification to ensure attribute files contain the exact field names OPA policies evaluate.'
  readonly inputSchema = InputSchema

  async execute(input: GenerateStubsInput, context: ToolContext): Promise<ToolResult<GenerateStubsResult>> {
    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.',
        }
      }

      // 1. Validate path
      const dirPath = await validatePathConfinement(input.directory_path)

      // 2. Read model files
      const structure = await readStructure(dirPath)
      const dataFlows = await readDataFlows(dirPath)
      const dataItems = await readDataItems(dirPath)
      const { boundaries, components } = flattenStructure(structure)

      // 3. Collect all classified elements
      const classifiedElements = this.collectClassifiedElements(
        boundaries, components, dataFlows, dataItems, input.element_ids
      )

      if (classifiedElements.length === 0) {
        return {
          success: true,
          data: { generated: 0, skipped: 0, reclassified: 0, cached_classes: 0, failed: [], warnings: ['No classified elements found.'] },
        }
      }

      // 4. Deduplicate class IDs
      const uniqueClassIds = new Map<string, { classType: string; elementIds: string[] }>()
      for (const el of classifiedElements) {
        const config = ELEMENT_TYPE_CONFIG[el.elementType]
        if (!config) continue
        const existing = uniqueClassIds.get(el.classData.id)
        if (existing) {
          existing.elementIds.push(el.id)
        } else {
          uniqueClassIds.set(el.classData.id, {
            classType: config.classType,
            elementIds: [el.id],
          })
        }
      }

      // 5. Fetch templates for each unique class
      const dtClass = new DtClass(context.apolloClient)
      const classMap = new Map<string, Class>()
      const failed: GenerateStubsResult['failed'] = []
      const warnings: string[] = []

      // Ensure cache directories exist
      const classCacheDir = path.join(dirPath, '.dethereal', 'class-cache')
      const templateFieldsDir = path.join(dirPath, '.dethereal', 'template-fields')
      await fs.mkdir(classCacheDir, { recursive: true })
      await fs.mkdir(templateFieldsDir, { recursive: true })

      for (const [classId, { classType, elementIds }] of uniqueClassIds) {
        // Try platform fetch first
        try {
          const cls = await dtClass.getClassById({ classId, classType })
          if (cls) {
            classMap.set(classId, cls)
            await this.writeClassCache(classCacheDir, classId, cls, classType)
            continue // Success — next class
          }
        } catch {
          // Platform fetch failed — will try cache below
        }

        // Platform returned null or threw — try cache fallback
        const cached = await this.readClassCache(classCacheDir, classId)
        if (cached) {
          classMap.set(classId, cached.cls)
          warnings.push(
            `Class "${cached.cls.name}" (${classId}) loaded from cache. Platform fetch failed — using cached template.`
          )
          if (this.isCacheStale(cached.cachedAt)) {
            warnings.push(
              `WARNING: Cache for class "${cached.cls.name}" (${classId}) is older than 7 days. ` +
              `Re-run with platform connectivity to refresh.`
            )
          }
        } else {
          for (const eid of elementIds) {
            failed.push({
              element_id: eid,
              reason: `Class ${classId} not found via getClassById(${classType}) and no cache available`,
            })
          }
        }
      }

      // 6. Build element lookup for flat-format normalization
      const elementLookup = this.buildElementLookup(boundaries, components, dataFlows, dataItems)

      // 7. Generate stubs for each element
      let generated = 0
      let skipped = 0
      let reclassified = 0

      for (const el of classifiedElements) {
        // Skip elements whose class fetch failed
        if (failed.some(f => f.element_id === el.id)) continue

        const cls = classMap.get(el.classData.id)
        if (!cls) continue

        // Extract template properties
        const templateProps = this.extractTemplateProperties(cls)
        if (!templateProps) {
          warnings.push(`Class "${cls.name}" (${cls.id}) has no template schema properties. Skipped element "${el.name}".`)
          skipped++
          continue
        }

        // Compute defaults
        const templateDefaults: Record<string, unknown> = {}
        for (const [key, schemaProp] of Object.entries(templateProps)) {
          templateDefaults[key] = (schemaProp as Record<string, unknown>)?.default ?? null
        }

        // Read existing attribute file
        const config = ELEMENT_TYPE_CONFIG[el.elementType]!
        const attrFilePath = path.join(dirPath, 'attributes', config.subdir, `${el.id}.json`)
        let existingAttributes: Record<string, unknown> = {}
        let existingMeta: { elementId?: string; elementType?: string; elementName?: string; classData?: unknown; modifiedAt?: string } = {}

        try {
          const content = await fs.readFile(attrFilePath, 'utf-8')
          const rawJson = JSON.parse(content) as Record<string, unknown>

          if (isFlatFormat(rawJson)) {
            // Normalize flat format
            const normalized = normalizeFlatAttribute(rawJson, config.subdir, elementLookup, `${el.id}.json`)
            if (normalized) {
              existingAttributes = normalized.attrs.attributes as Record<string, unknown>
              existingMeta = {
                elementId: normalized.attrs.elementId,
                elementType: normalized.attrs.elementType,
                elementName: normalized.attrs.elementName,
                classData: normalized.attrs.classData,
              }
            }
          } else {
            // Structured format
            existingAttributes = (rawJson.attributes as Record<string, unknown>) || {}
            existingMeta = {
              elementId: rawJson.elementId as string,
              elementType: rawJson.elementType as string,
              elementName: rawJson.elementName as string,
              classData: rawJson.classData,
              modifiedAt: rawJson.modifiedAt as string,
            }
          }
        } catch {
          // No existing file — will create new one
        }

        // Reclassification detection: compare manifest classId with current classData.id
        let isReclassified = false
        const existingManifest = await this.readManifest(templateFieldsDir, el.id)
        if (existingManifest && existingManifest.classId !== el.classData.id) {
          // Class has changed — remove unenriched old template fields
          const oldTemplateFields = new Set(existingManifest.templateFields)
          for (const oldField of oldTemplateFields) {
            if (oldField in existingAttributes && existingAttributes[oldField] === null) {
              delete existingAttributes[oldField]
            }
          }
          isReclassified = true
          reclassified++
          warnings.push(
            `Element "${el.name}" (${el.id}) reclassified from "${existingManifest.className}" to "${el.classData.name}". ` +
            `Unenriched template fields removed, enriched values preserved.`
          )
        }

        // Merge: existing values always win
        const mergedAttributes = { ...existingAttributes }
        let newFieldsAdded = false
        for (const [key, defaultValue] of Object.entries(templateDefaults)) {
          if (!(key in mergedAttributes)) {
            mergedAttributes[key] = defaultValue
            newFieldsAdded = true
          }
        }

        if (!newFieldsAdded && Object.keys(existingAttributes).length > 0 && !isReclassified) {
          // All template fields already present and not reclassified — skip
          skipped++
        } else if (!isReclassified) {
          generated++
        }

        // Write merged attribute file in structured ElementAttributes format
        const outputAttrs = {
          elementId: el.id,
          elementType: el.elementType,
          elementName: el.name,
          classData: el.classData,
          attributes: mergedAttributes,
          modifiedAt: new Date().toISOString(),
        }

        await fs.mkdir(path.dirname(attrFilePath), { recursive: true })
        await fs.writeFile(attrFilePath, JSON.stringify(outputAttrs, null, 2), 'utf-8')

        // Write template field manifest
        const manifest = {
          classId: el.classData.id,
          className: el.classData.name,
          templateFields: Object.keys(templateDefaults),
          generatedAt: new Date().toISOString(),
        }
        const manifestPath = path.join(templateFieldsDir, `${el.id}.json`)
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
      }

      return {
        success: true,
        data: {
          generated,
          skipped,
          reclassified,
          cached_classes: classMap.size,
          failed,
          warnings,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate attribute stubs',
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Collect all elements with classData from the model.
   * If element_ids is provided, filter to only those elements.
   */
  private collectClassifiedElements(
    boundaries: Array<{ id: string; name: string; classData?: { id: string; name: string; [key: string]: unknown } }>,
    components: Array<{ id: string; name: string; classData?: { id: string; name: string; [key: string]: unknown } }>,
    dataFlows: Array<{ id: string; name: string; classData?: { id: string; name: string; [key: string]: unknown } }>,
    dataItems: Array<{ id: string; name: string; classData?: { id: string; name: string; [key: string]: unknown } }>,
    elementIds?: string[],
  ): ClassifiedElement[] {
    const elements: ClassifiedElement[] = []
    const idFilter = elementIds ? new Set(elementIds) : null

    const addElements = (
      source: Array<{ id: string; name: string; classData?: { id: string; name: string; [key: string]: unknown } }>,
      elementType: ClassifiedElement['elementType'],
    ) => {
      for (const el of source) {
        if (!el.classData?.id) continue
        if (idFilter && !idFilter.has(el.id)) continue
        elements.push({
          id: el.id,
          name: el.name,
          elementType,
          classData: el.classData as ClassifiedElement['classData'],
        })
      }
    }

    addElements(components, 'component')
    addElements(boundaries, 'boundary')
    addElements(dataFlows as any[], 'dataFlow')
    addElements(dataItems as any[], 'dataItem')

    return elements
  }

  /**
   * Extract template properties from a class's template.
   * Returns null if the class has no usable template schema.
   */
  private extractTemplateProperties(cls: Class): Record<string, unknown> | null {
    const template = cls.template as { schema?: { properties?: Record<string, unknown> } } | null
    if (!template?.schema?.properties) return null
    const props = template.schema.properties
    if (Object.keys(props).length === 0) return null
    return props
  }

  /**
   * Write class cache file for offline resilience.
   */
  private async writeClassCache(
    cacheDir: string,
    classId: string,
    cls: Class,
    classType: string,
  ): Promise<void> {
    const cacheEntry = {
      classId,
      className: cls.name,
      classType,
      cachedAt: new Date().toISOString(),
      template: cls.template,
      guide: cls.guide,
    }
    const cachePath = path.join(cacheDir, `${classId}.json`)
    await fs.writeFile(cachePath, JSON.stringify(cacheEntry, null, 2), 'utf-8')
  }

  /**
   * Read class cache file for offline fallback.
   * Returns the cached Class object or null if cache doesn't exist.
   */
  private async readClassCache(
    cacheDir: string,
    classId: string,
  ): Promise<{ cls: Class; cachedAt: string } | null> {
    try {
      const cachePath = path.join(cacheDir, `${classId}.json`)
      const content = await fs.readFile(cachePath, 'utf-8')
      const cached = JSON.parse(content) as {
        classId: string
        className: string
        classType: string
        cachedAt: string
        template: unknown
        guide: unknown
      }
      const cls: Class = {
        id: cached.classId,
        name: cached.className,
        type: cached.classType,
        template: cached.template as Class['template'],
        guide: cached.guide as Class['guide'],
      }
      return { cls, cachedAt: cached.cachedAt }
    } catch {
      return null
    }
  }

  /**
   * Check if a cache entry is stale (older than 7 days).
   */
  private isCacheStale(cachedAt: string): boolean {
    const cacheDate = new Date(cachedAt)
    const now = new Date()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    return (now.getTime() - cacheDate.getTime()) > sevenDaysMs
  }

  /**
   * Read template field manifest for an element.
   * Returns null if manifest doesn't exist.
   */
  private async readManifest(
    templateFieldsDir: string,
    elementId: string,
  ): Promise<{ classId: string; className: string; templateFields: string[]; generatedAt: string } | null> {
    try {
      const manifestPath = path.join(templateFieldsDir, `${elementId}.json`)
      const content = await fs.readFile(manifestPath, 'utf-8')
      return JSON.parse(content) as {
        classId: string
        className: string
        templateFields: string[]
        generatedAt: string
      }
    } catch {
      return null
    }
  }

  /**
   * Build element lookup map for flat-format normalization.
   * Keys: `{elementType}:{name}` (e.g., `component:PostgreSQL`)
   */
  private buildElementLookup(
    boundaries: Array<{ id: string; name: string; classData?: unknown }>,
    components: Array<{ id: string; name: string; classData?: unknown }>,
    dataFlows: Array<{ id: string; name: string; classData?: unknown }>,
    dataItems: Array<{ id: string; name: string; classData?: unknown }>,
  ): Map<string, { id: string; name: string; elementType: string; classData?: unknown }> {
    const lookup = new Map<string, { id: string; name: string; elementType: string; classData?: unknown }>()

    for (const b of boundaries) {
      lookup.set(`boundary:${b.name}`, { id: b.id, name: b.name, elementType: 'boundary', classData: b.classData })
    }
    for (const c of components) {
      lookup.set(`component:${c.name}`, { id: c.id, name: c.name, elementType: 'component', classData: c.classData })
    }
    for (const f of dataFlows) {
      lookup.set(`dataFlow:${f.name}`, { id: f.id, name: f.name, elementType: 'dataFlow', classData: (f as Record<string, unknown>).classData })
    }
    for (const d of dataItems) {
      lookup.set(`dataItem:${d.name}`, { id: d.id, name: d.name, elementType: 'dataItem', classData: (d as Record<string, unknown>).classData })
    }

    return lookup
  }
}

// Export singleton instance
export const generateAttributeStubsTool = new GenerateAttributeStubsTool()
