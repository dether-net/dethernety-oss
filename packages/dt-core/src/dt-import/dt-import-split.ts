/**
 * Split-file import functionality for the Dethernety threat modeling framework.
 *
 * This module provides the DtImportSplit class which handles importing threat models
 * from the split-file format (SplitModel).
 *
 * Key features:
 * - Converts SplitModel to monolithic format for import
 * - Uses existing DtImport internally for actual import logic
 * - Returns idMapping (reference ID → server ID) for file synchronization
 */

import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject

import { DtImport, ImportResult, ImportOptions, ImportProgress, ImportError } from './dt-import.js'
import {
  SplitModel,
  MonolithicModel,
  splitToMonolithic,
} from '../schemas/index.js'

/**
 * Extended import result that includes ID mapping for split-file synchronization.
 */
export interface ImportSplitResult extends ImportResult {
  /**
   * Mapping of reference IDs (from JSON files) to server-generated IDs.
   * Use this to update the source JSON files with server IDs after import.
   */
  idMapping: Map<string, string>
}

/**
 * Options for split model import.
 */
export interface ImportSplitOptions extends ImportOptions {
  /**
   * Whether to validate the split model before import.
   * Default: true
   */
  validateBeforeImport?: boolean
}

/**
 * Class for importing models from split-file format.
 *
 * This class wraps DtImport and provides split-file specific functionality:
 * - Converts SplitModel to MonolithicModel
 * - Captures ID mapping for file synchronization
 * - Supports progress callbacks
 */
export class DtImportSplit {
  private dtImport: DtImport
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtImport = new DtImport(apolloClient)
  }

  /**
   * Import a model from split-file format (SplitModel).
   *
   * Converts the split model to monolithic format and uses DtImport for the actual import.
   * Returns the ID mapping so the caller can update source files with server-generated IDs.
   *
   * @param splitModel - The split model to import
   * @param options - Import options (folderId, progress callback, etc.)
   * @returns ImportSplitResult with idMapping for file synchronization
   */
  async importSplitModel(
    splitModel: SplitModel,
    options: ImportSplitOptions = {}
  ): Promise<ImportSplitResult> {
    try {
      // Validate the split model if requested (default: true)
      if (options.validateBeforeImport !== false) {
        const validationErrors = this.validateSplitModel(splitModel)
        if (validationErrors.length > 0) {
          return {
            success: false,
            errors: validationErrors,
            warnings: [],
            progress: {
              currentStep: 0,
              totalSteps: 8,
              stepName: 'Validation failed',
              percentage: 0,
            },
            idMapping: new Map(),
          }
        }
      }

      // Convert split model to monolithic format
      const monolithicModel = splitToMonolithic(splitModel)

      // Import using existing DtImport
      const importResult = await this.dtImport.importModel(monolithicModel, {
        folderId: options.folderId,
        onProgress: options.onProgress,
      })

      // Extract ID mapping from DtImport
      // Since DtImport's idMapping is private, we need to reconstruct it
      // by comparing the original IDs with the created model
      const idMapping = await this.buildIdMapping(splitModel, importResult)

      return {
        ...importResult,
        idMapping,
      }
    } catch (error) {
      return {
        success: false,
        errors: [{
          step: 'import_split',
          error: error instanceof Error ? error.message : 'Unknown error during split model import',
        }],
        warnings: [],
        progress: {
          currentStep: 0,
          totalSteps: 8,
          stepName: 'Import failed',
          percentage: 0,
        },
        idMapping: new Map(),
      }
    }
  }

  /**
   * Validate a split model before import.
   */
  private validateSplitModel(splitModel: SplitModel): ImportError[] {
    const errors: ImportError[] = []

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

    // Validate data flow references if present
    if (splitModel.dataFlows && splitModel.structure.defaultBoundary) {
      const componentIds = this.collectAllComponentIds(splitModel.structure.defaultBoundary)

      for (const flow of splitModel.dataFlows) {
        if (!flow.source?.id) {
          errors.push({
            step: 'validation',
            elementName: flow.name,
            error: `Data flow "${flow.name}" is missing source reference`,
          })
        } else if (!componentIds.has(flow.source.id)) {
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
        } else if (!componentIds.has(flow.target.id)) {
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
   * Collect all component IDs from a boundary hierarchy.
   */
  private collectAllComponentIds(boundary: any): Set<string> {
    const ids = new Set<string>()

    const process = (b: any): void => {
      // Add boundary ID (boundaries can also be source/target of flows)
      if (b.id) {
        ids.add(b.id)
      }
      // Add component IDs
      b.components?.forEach((c: any) => {
        if (c.id) ids.add(c.id)
      })
      // Process nested boundaries
      b.boundaries?.forEach(process)
    }

    process(boundary)
    return ids
  }

  /**
   * Build ID mapping by comparing original IDs with created model.
   *
   * Since DtImport tracks idMapping internally but doesn't expose it,
   * we need to access it through a workaround or reconstruct it.
   */
  private async buildIdMapping(
    splitModel: SplitModel,
    importResult: ImportResult
  ): Promise<Map<string, string>> {
    const idMapping = new Map<string, string>()

    if (!importResult.success || !importResult.model) {
      return idMapping
    }

    // Access the internal idMapping from DtImport if possible
    // The DtImport instance should have captured all mappings during import
    const dtImportAny = this.dtImport as any
    if (dtImportAny.idMapping && dtImportAny.idMapping instanceof Map) {
      // Copy the internal mapping
      for (const [refId, serverId] of dtImportAny.idMapping) {
        idMapping.set(refId, serverId)
      }
    }

    // Always add the model ID mapping if we have the created model
    if (splitModel.manifest.model.id && importResult.model.id) {
      idMapping.set(splitModel.manifest.model.id, importResult.model.id)
    } else if (importResult.model.id) {
      // If the original model ID was null, still record the new model ID
      // The MCP tool will need to write this to the manifest
      idMapping.set('__model__', importResult.model.id)
    }

    return idMapping
  }

  /**
   * Get the Apollo client instance.
   */
  getApolloClient(): ApolloClient<NormalizedCacheObject> {
    return this.apolloClient
  }
}
