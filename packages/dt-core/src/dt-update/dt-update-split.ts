/**
 * Split-file update functionality for the Dethernety threat modeling framework.
 *
 * This module provides the DtUpdateSplit class which handles updating threat models
 * from the split-file format (SplitModel).
 *
 * Key features:
 * - Converts SplitModel to monolithic format for updates
 * - Uses existing DtUpdate internally for actual update logic
 * - Provides attributes-only update for efficient attribute changes
 * - Returns idMapping (reference ID → server ID) for file synchronization
 */

import * as Apollo from '@apollo/client'

import { DtUpdate, UpdateResult, UpdateOptions, UpdateProgress, UpdateError, UpdateStats } from './dt-update.js'
import { DtClass } from '../dt-class/dt-class.js'
import { DtModel } from '../dt-model/dt-model.js'
import { DtUtils } from '../dt-utils/dt-utils.js'
import {
  SplitModel,
  splitToMonolithic,
  ConsolidatedAttributesFile,
  ElementAttributes,
  collectFlowEndpointIds,
} from '../schemas/index.js'

/**
 * Extended update result that includes ID mapping for split-file synchronization.
 */
export interface UpdateSplitResult extends UpdateResult {
  /**
   * Mapping of reference IDs (from JSON files) to server-generated IDs.
   * Use this to update the source JSON files with server IDs after update.
   */
  idMapping: Map<string, string>
}

/**
 * Result for attributes-only update.
 */
export interface UpdateAttributesResult {
  success: boolean
  errors: UpdateError[]
  warnings: string[]
  stats: {
    boundaries: { updated: number; failed: number }
    components: { updated: number; failed: number }
    dataFlows: { updated: number; failed: number }
    dataItems: { updated: number; failed: number }
    total: { updated: number; failed: number }
  }
}

/**
 * Options for split model update.
 */
export interface UpdateSplitOptions extends UpdateOptions {
  /**
   * Whether to validate the split model before update.
   * Default: true
   */
  validateBeforeUpdate?: boolean
}

/**
 * Class for updating models from split-file format.
 *
 * This class wraps DtUpdate and provides split-file specific functionality:
 * - Converts SplitModel to MonolithicModel for full updates
 * - Provides attributes-only update capability
 * - Captures ID mapping for file synchronization
 */
export class DtUpdateSplit {
  private dtUpdate: DtUpdate
  private dtClass: DtClass
  private dtModel: DtModel
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUpdate = new DtUpdate(apolloClient)
    this.dtClass = new DtClass(apolloClient)
    this.dtModel = new DtModel(apolloClient)
  }

  /**
   * Update a model from split-file format (SplitModel).
   *
   * Converts the split model to monolithic format and uses DtUpdate for the actual update.
   * Returns the ID mapping so the caller can update source files with server-generated IDs.
   *
   * @param modelId - The ID of the model to update
   * @param splitModel - The split model data
   * @param options - Update options (progress callback, deleteOrphaned, etc.)
   * @returns UpdateSplitResult with idMapping for file synchronization
   */
  async updateFromSplitModel(
    modelId: string,
    splitModel: SplitModel,
    options: UpdateSplitOptions = {}
  ): Promise<UpdateSplitResult> {
    try {
      // Validate the split model if requested (default: true)
      if (options.validateBeforeUpdate !== false) {
        const validationErrors = this.validateSplitModel(splitModel)
        if (validationErrors.length > 0) {
          return {
            success: false,
            errors: validationErrors,
            warnings: [],
            stats: { created: 0, updated: 0, deleted: 0 },
            idMapping: new Map(),
          }
        }
      }

      // Convert split model to monolithic format
      const monolithicModel = splitToMonolithic(splitModel)

      // Update using existing DtUpdate
      const updateResult = await this.dtUpdate.updateModel(modelId, monolithicModel, {
        onProgress: options.onProgress,
        deleteOrphaned: options.deleteOrphaned,
      })

      // Extract ID mapping from DtUpdate
      const idMapping = this.extractIdMapping(splitModel, updateResult)

      return {
        ...updateResult,
        idMapping,
      }
    } catch (error) {
      return {
        success: false,
        errors: [{
          step: 'update_split',
          error: error instanceof Error ? error.message : 'Unknown error during split model update',
        }],
        warnings: [],
        stats: { created: 0, updated: 0, deleted: 0 },
        idMapping: new Map(),
      }
    }
  }

  /**
   * Update only attributes for elements in a model.
   *
   * This is more efficient than a full update when only attributes have changed.
   * Iterates through the attributes file and calls DtClass.setInstantiationAttributes()
   * for each element.
   *
   * @param modelId - The ID of the model (not directly used but included for context)
   * @param attributes - The consolidated attributes file
   * @returns UpdateAttributesResult with detailed stats
   */
  async updateAttributesOnly(
    modelId: string,
    attributes: ConsolidatedAttributesFile
  ): Promise<UpdateAttributesResult> {
    const result: UpdateAttributesResult = {
      success: true,
      errors: [],
      warnings: [],
      stats: {
        boundaries: { updated: 0, failed: 0 },
        components: { updated: 0, failed: 0 },
        dataFlows: { updated: 0, failed: 0 },
        dataItems: { updated: 0, failed: 0 },
        total: { updated: 0, failed: 0 },
      },
    }

    // Scope writes to the target model. setElementAttributes writes to whatever
    // element the record key names — without this check, an attributes file keyed
    // by an element id from a DIFFERENT model of the same user writes onto that
    // foreign element. Fetch the model's element-id set once (O(1), not per entry)
    // and reject non-member entries per-entry. Fail closed: if the membership set
    // can't be established, abort the whole update with a clear, retryable error
    // rather than writing unscoped.
    let memberIds: Set<string>
    try {
      const modelData = await this.dtModel.getModelData({ modelId })
      if (!modelData) {
        result.success = false
        result.errors.push({ step: 'attributes_scope', error: `Model ${modelId} not found — cannot verify element ownership for attributes update` })
        return result
      }
      memberIds = new Set<string>([modelId])
      const db = modelData.defaultBoundary
      if (db?.id) memberIds.add(db.id)
      db?.allDescendantComponents?.forEach((c: any) => { if (c?.id) memberIds.add(c.id) })
      db?.allDescendantBoundaries?.forEach((b: any) => { if (b?.id) memberIds.add(b.id) })
      db?.allDescendantDataFlows?.forEach((f: any) => { if (f?.id) memberIds.add(f.id) })
      modelData.dataItems?.forEach((d: any) => { if (d?.id) memberIds.add(d.id) })
    } catch (error) {
      result.success = false
      result.errors.push({ step: 'attributes_scope', error: `Could not verify element ownership for model ${modelId}: ${error instanceof Error ? error.message : 'unknown error'}` })
      return result
    }

    // Per-entry guard: the record key must match the entry's own elementId (the
    // write targets the KEY, so a mismatch silently redirects it), and the element
    // must belong to this model.
    const entryAllowed = (key: string, entry: ElementAttributes): string | null => {
      // A null/junk entry value (hand-edited attributes.json) must fail per-entry,
      // not throw out of the loop.
      if (!entry || typeof entry !== 'object') {
        return `Attributes record "${key}" is not an object — entry skipped`
      }
      if (entry.elementId && key !== entry.elementId) {
        return `Attributes record key "${key}" does not match its elementId "${entry.elementId}" — entry skipped`
      }
      if (!memberIds.has(key)) {
        return `Element ${key} does not belong to model ${modelId} — entry skipped`
      }
      return null
    }
    const rejectEntry = (key: string, entry: ElementAttributes, reason: string, statsKey: 'boundaries' | 'components' | 'dataFlows' | 'dataItems') => {
      result.errors.push({ step: `update_${statsKey}_attributes`, elementName: entry?.elementName, elementId: key, error: reason })
      result.stats[statsKey].failed++
      result.stats.total.failed++
    }

    // Process boundary attributes
    if (attributes.boundaries) {
      for (const [elementId, elementAttrs] of Object.entries(attributes.boundaries)) {
        const rejection = entryAllowed(elementId, elementAttrs)
        if (rejection) {
          rejectEntry(elementId, elementAttrs, rejection, 'boundaries')
          continue
        }
        const success = await this.setElementAttributes(elementId, elementAttrs, result, 'boundaries')
        if (success) {
          result.stats.boundaries.updated++
          result.stats.total.updated++
        } else {
          result.stats.boundaries.failed++
          result.stats.total.failed++
        }
      }
    }

    // Process component attributes
    if (attributes.components) {
      for (const [elementId, elementAttrs] of Object.entries(attributes.components)) {
        const rejection = entryAllowed(elementId, elementAttrs)
        if (rejection) {
          rejectEntry(elementId, elementAttrs, rejection, 'components')
          continue
        }
        const success = await this.setElementAttributes(elementId, elementAttrs, result, 'components')
        if (success) {
          result.stats.components.updated++
          result.stats.total.updated++
        } else {
          result.stats.components.failed++
          result.stats.total.failed++
        }
      }
    }

    // Process data flow attributes
    if (attributes.dataFlows) {
      for (const [elementId, elementAttrs] of Object.entries(attributes.dataFlows)) {
        const rejection = entryAllowed(elementId, elementAttrs)
        if (rejection) {
          rejectEntry(elementId, elementAttrs, rejection, 'dataFlows')
          continue
        }
        const success = await this.setElementAttributes(elementId, elementAttrs, result, 'dataFlows')
        if (success) {
          result.stats.dataFlows.updated++
          result.stats.total.updated++
        } else {
          result.stats.dataFlows.failed++
          result.stats.total.failed++
        }
      }
    }

    // Process data item attributes
    if (attributes.dataItems) {
      for (const [elementId, elementAttrs] of Object.entries(attributes.dataItems)) {
        const rejection = entryAllowed(elementId, elementAttrs)
        if (rejection) {
          rejectEntry(elementId, elementAttrs, rejection, 'dataItems')
          continue
        }
        const success = await this.setElementAttributes(elementId, elementAttrs, result, 'dataItems')
        if (success) {
          result.stats.dataItems.updated++
          result.stats.total.updated++
        } else {
          result.stats.dataItems.failed++
          result.stats.total.failed++
        }
      }
    }

    // Mark as failed if any errors occurred
    if (result.stats.total.failed > 0) {
      result.success = false
    }

    return result
  }

  /**
   * Set attributes for a single element.
   */
  private async setElementAttributes(
    elementId: string,
    elementAttrs: ElementAttributes,
    result: UpdateAttributesResult,
    elementType: string
  ): Promise<boolean> {
    try {
      if (!elementAttrs.classData?.id) {
        result.warnings.push(
          `Element ${elementAttrs.elementName || elementId} has no class ID, skipping attributes`
        )
        return true // Not a failure, just skipped
      }

      if (!elementAttrs.attributes || Object.keys(elementAttrs.attributes).length === 0) {
        // No attributes to set
        return true
      }

      // Flatten attributes before setting them
      const flatAttributes = DtUtils.flattenProperties(elementAttrs.attributes)

      const success = await this.dtClass.setInstantiationAttributes({
        componentId: elementId,
        classId: elementAttrs.classData.id,
        attributes: flatAttributes,
      })

      if (!success) {
        result.errors.push({
          step: `update_${elementType}_attributes`,
          elementName: elementAttrs.elementName,
          elementId,
          error: 'Failed to set attributes',
        })
        return false
      }

      return true
    } catch (error) {
      result.errors.push({
        step: `update_${elementType}_attributes`,
        elementName: elementAttrs.elementName,
        elementId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return false
    }
  }

  /**
   * Validate a split model before update.
   */
  private validateSplitModel(splitModel: SplitModel): UpdateError[] {
    const errors: UpdateError[] = []

    // Check manifest
    if (!splitModel.manifest) {
      errors.push({ step: 'validation', error: 'Missing manifest' })
      return errors
    }

    if (!splitModel.manifest.model?.name) {
      errors.push({ step: 'validation', error: 'Missing model name in manifest' })
    }

    // Check structure
    if (!splitModel.structure) {
      errors.push({ step: 'validation', error: 'Missing structure' })
      return errors
    }

    if (!splitModel.structure.defaultBoundary) {
      errors.push({ step: 'validation', error: 'Missing default boundary in structure' })
    } else if (!splitModel.structure.defaultBoundary.id) {
      errors.push({ step: 'validation', error: 'Missing default boundary ID' })
    }

    // Flow-reference validation (mirrors the import-side validator, via the shared
    // endpoint collector). Skipping this was lossy under deleteOrphaned: a typo'd
    // source id passed validation, the new flow was skipped with a warning, and the
    // pre-existing flow it should have replaced was deleted as an orphan.
    if (splitModel.dataFlows && splitModel.structure.defaultBoundary) {
      const endpointIds = collectFlowEndpointIds(splitModel.structure.defaultBoundary)

      for (const flow of splitModel.dataFlows) {
        if (!flow.source?.id) {
          errors.push({
            step: 'validation',
            elementName: flow.name,
            error: `Data flow "${flow.name}" is missing source reference`,
          })
        } else if (!endpointIds.has(flow.source.id)) {
          errors.push({
            step: 'validation',
            elementName: flow.name,
            error: `Data flow "${flow.name}" references non-existent source: ${flow.source.id}`,
          })
        }

        if (!flow.target?.id) {
          errors.push({
            step: 'validation',
            elementName: flow.name,
            error: `Data flow "${flow.name}" is missing target reference`,
          })
        } else if (!endpointIds.has(flow.target.id)) {
          errors.push({
            step: 'validation',
            elementName: flow.name,
            error: `Data flow "${flow.name}" references non-existent target: ${flow.target.id}`,
          })
        }
      }
    }

    return errors
  }

  /**
   * Extract ID mapping from the update result.
   */
  private extractIdMapping(
    splitModel: SplitModel,
    updateResult: UpdateResult
  ): Map<string, string> {
    const idMapping = new Map<string, string>()

    // Access the internal idMapping from DtUpdate if possible
    const dtUpdateAny = this.dtUpdate as any
    if (dtUpdateAny.idMapping && dtUpdateAny.idMapping instanceof Map) {
      for (const [refId, serverId] of dtUpdateAny.idMapping) {
        idMapping.set(refId, serverId)
      }
    }

    // Add model ID mapping if available
    if (splitModel.manifest.model.id && updateResult.model?.id) {
      idMapping.set(splitModel.manifest.model.id, updateResult.model.id)
    }

    return idMapping
  }

  /**
   * Get the Apollo client instance.
   */
  getApolloClient(): Apollo.ApolloClient {
    return this.apolloClient
  }
}
