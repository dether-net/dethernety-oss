/**
 * Update functionality for the Dethernety threat modeling framework.
 *
 * This module provides the DtUpdate class which handles updating existing threat models
 * from JSON format conforming to the export-import-schema specification.
 */

import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { Node, Edge } from '@vue-flow/core'
import { DtUtils } from '../dt-utils/dt-utils.js'
import { Model, Module, Conduit } from '../interfaces/core-types-interface.js'
import { DtModel } from '../dt-model/dt-model.js'
import { DtClass } from '../dt-class/dt-class.js'
import { DtComponent } from '../dt-component/dt-component.js'
import { DtBoundary } from '../dt-boundary/dt-boundary.js'
import { flattenConduits, prepareConduitsForWrite } from '../dt-boundary/boundary-zoning-utils.js'
import { DtDataflow } from '../dt-dataflow/dt-dataflow.js'
import { DtDataItem } from '../dt-dataitem/dt-dataitem.js'
import { DtModule } from '../dt-module/dt-module.js'
import { DtControl } from '../dt-control/dt-control.js'

export interface UpdateProgress {
  currentStep: number
  totalSteps: number
  stepName: string
  percentage: number
}

export interface UpdateError {
  step: string
  elementName?: string
  elementId?: string
  error: string
  details?: any
}

export interface UpdateStats {
  created: number
  updated: number
  deleted: number
}

export interface UpdateResult {
  success: boolean
  model?: Model | null
  errors: UpdateError[]
  warnings: string[]
  progress?: UpdateProgress
  stats: UpdateStats
}

export interface UpdateOptions {
  onProgress?: (progress: UpdateProgress) => void
  deleteOrphaned?: boolean
}

export class DtUpdate {
  private apolloClient: Apollo.ApolloClient
  private dtUtils: DtUtils
  private dtModel: DtModel
  private dtClass: DtClass
  private dtComponent: DtComponent
  private dtBoundary: DtBoundary
  private dtDataflow: DtDataflow
  private dtDataitem: DtDataItem
  private dtModule: DtModule
  private dtControl: DtControl

  // Internal state for update process
  private idMapping: Map<string, string> = new Map()
  private errors: UpdateError[] = []
  private warnings: string[] = []
  private currentModelId: string = ''
  private defaultBoundaryId: string = ''
  private assignedModuleIds: string[] = []
  // Set when BOTH control-catalog fetches fail during a batch: the catalog is
  // unavailable (not genuinely empty), so resolveControls preserves rather than
  // REPLACE-wipes, and one error is surfaced so success reflects it.
  private controlCatalogUnavailable = false
  private stats: UpdateStats = { created: 0, updated: 0, deleted: 0 }

  // Track existing elements to detect deletions
  private existingBoundaryIds: Set<string> = new Set()
  private existingComponentIds: Set<string> = new Set()
  private existingDataflowIds: Set<string> = new Set()
  private existingDataitemIds: Set<string> = new Set()

  // Server-side conduit baseline per boundary id (flattened from the fetched structure). Feeds the
  // conduit reconcile as `baselineConduits` so an unchanged edge is not re-connected (connect is
  // non-idempotent — a re-connect would duplicate the parallel edge).
  private existingConduitsByBoundary: Map<string, Conduit[]> = new Map()

  // Track processed elements to identify orphans
  private processedBoundaryIds: Set<string> = new Set()
  private processedComponentIds: Set<string> = new Set()
  private processedDataflowIds: Set<string> = new Set()
  private processedDataitemIds: Set<string> = new Set()

  // Cached controls for resolveControls() — populated once per update batch
  private cachedAvailableControls: any[] | null = null

  private progress: UpdateProgress = {
    currentStep: 0,
    totalSteps: 9,
    stepName: 'Initializing',
    percentage: 0
  }
  private onProgress?: (progress: UpdateProgress) => void

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
    this.dtModel = new DtModel(apolloClient)
    this.dtClass = new DtClass(apolloClient)
    this.dtComponent = new DtComponent(apolloClient)
    this.dtBoundary = new DtBoundary(apolloClient)
    this.dtDataflow = new DtDataflow(apolloClient)
    this.dtDataitem = new DtDataItem(apolloClient)
    this.dtModule = new DtModule(apolloClient)
    this.dtControl = new DtControl(apolloClient)
  }

  private resetState(): void {
    this.idMapping = new Map()
    this.errors = []
    this.warnings = []
    this.currentModelId = ''
    this.defaultBoundaryId = ''
    this.assignedModuleIds = []
    this.stats = { created: 0, updated: 0, deleted: 0 }

    this.existingBoundaryIds = new Set()
    this.existingComponentIds = new Set()
    this.existingDataflowIds = new Set()
    this.existingDataitemIds = new Set()
    this.existingConduitsByBoundary = new Map()

    this.processedBoundaryIds = new Set()
    this.processedComponentIds = new Set()
    this.processedDataflowIds = new Set()
    this.processedDataitemIds = new Set()

    this.cachedAvailableControls = null
    this.controlCatalogUnavailable = false

    this.progress = {
      currentStep: 0,
      totalSteps: 9,
      stepName: 'Initializing',
      percentage: 0
    }
  }

  private updateProgress(step: number, stepName: string): void {
    this.progress = {
      currentStep: step,
      totalSteps: 9,
      stepName,
      percentage: Math.floor((step / 9) * 100)
    }
    if (this.onProgress) {
      this.onProgress(this.progress)
    }
  }

  private validateImportData(data: any): { valid: boolean; error?: string } {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Import data must be an object' }
    }

    if (!data.name) {
      return { valid: false, error: 'Missing required field: name' }
    }

    if (!data.defaultBoundary) {
      return { valid: false, error: 'Missing required field: defaultBoundary' }
    }

    return { valid: true }
  }

  /**
   * Update an existing model from JSON data conforming to export-import-schema.
   *
   * Workflow:
   * 1. Fetch existing model structure
   * 2. Update model properties
   * 3. Update/sync modules
   * 4. Update default boundary
   * 5. Update/create/delete data items
   * 6. Update/create/delete boundaries (recursive hierarchy)
   * 7. Update/create/delete components
   * 8. Update/create/delete data flows
   * 9. Delete orphaned elements (if enabled)
   *
   * @param modelId - The ID of the model to update
   * @param jsonData - The updated model data (object or JSON string)
   * @param options - Update options
   * @returns UpdateResult with success status, model, errors, warnings, and stats
   */
  updateModel = async (
    modelId: string,
    jsonData: any,
    options: UpdateOptions = {}
  ): Promise<UpdateResult> => {
    try {
      // Reset state
      this.resetState()
      this.onProgress = options.onProgress
      this.currentModelId = modelId
      const deleteOrphaned = options.deleteOrphaned !== false // Default to true

      // Parse JSON if it's a string
      if (typeof jsonData === 'string') {
        try {
          jsonData = JSON.parse(jsonData)
        } catch (e) {
          return {
            success: false,
            errors: [{ step: 'validation', error: `Invalid JSON: ${(e as Error).message}` }],
            warnings: [],
            progress: this.progress,
            stats: this.stats
          }
        }
      }

      this.updateProgress(1, 'Validating update data')

      // Step 1: Validate JSON structure
      const validationResult = this.validateImportData(jsonData)
      if (!validationResult.valid) {
        return {
          success: false,
          errors: [{ step: 'validation', error: validationResult.error || 'Invalid update data format' }],
          warnings: [],
          progress: this.progress,
          stats: this.stats
        }
      }

      this.updateProgress(2, 'Fetching existing model structure')

      // Step 2: Fetch existing model structure
      const existingModel = await this.fetchExistingModelStructure()
      if (!existingModel) {
        return {
          success: false,
          errors: [{ step: 'fetch_model', error: `Model ${modelId} not found` }],
          warnings: [],
          progress: this.progress,
          stats: this.stats
        }
      }

      this.updateProgress(3, 'Updating model properties')

      // Step 3: Update model properties (name/description/controls/modules/folder/scope)
      // in a SINGLE write. Module resolution is folded into updateModelProperties so
      // there is one source of truth — a second write (the former updateModules) re-sent
      // the pre-update name/description/controls and reverted this step.
      await this.updateModelProperties(jsonData, existingModel)

      this.updateProgress(4, 'Updating data items')

      // Step 5: Update/create data items FIRST — before any element (including the
      // default boundary, boundaries, components, and data flows) references them
      // via dataItemIds, so their ids are resolvable in this.idMapping.
      if (jsonData.dataItems) {
        await this.updateDataItems(jsonData.dataItems)
      }

      this.updateProgress(5, 'Updating default boundary')

      // Step 6: Update default boundary (may itself carry dataItemIds)
      await this.updateDefaultBoundary(jsonData.defaultBoundary)

      this.updateProgress(6, 'Updating boundaries and components')

      // Step 7: Update/create boundaries and components recursively
      if (jsonData.defaultBoundary?.boundaries) {
        await this.updateBoundariesRecursive(
          jsonData.defaultBoundary.boundaries,
          this.defaultBoundaryId
        )
      }

      // Step 8: Update/create components in default boundary
      if (jsonData.defaultBoundary?.components) {
        await this.updateComponents(
          jsonData.defaultBoundary.components,
          this.defaultBoundaryId
        )
      }

      // Conduits — after every boundary is created/mapped, and BEFORE orphan deletion (a conduit peer
      // that is being deleted must not be connected). Uses the fetched server baseline for a correct
      // delta (unchanged edge → no re-connect). Not a distinct progress step (avoids renumbering).
      await this.associateConduitsWithBoundaries(jsonData)

      this.updateProgress(7, 'Updating data flows')

      // Step 9: Update/create data flows
      if (jsonData.dataFlows) {
        await this.updateDataFlows(jsonData.dataFlows)
      }

      this.updateProgress(8, 'Cleaning up orphaned elements')

      // Step 10: Delete orphaned elements if enabled
      if (deleteOrphaned) {
        await this.deleteOrphanedElements()
      }

      this.updateProgress(9, 'Update completed')

      // Fetch updated model
      let updatedModel: Model | null = null
      try {
        updatedModel = await this.dtModel.getModel({ modelId })
      } catch (e) {
        // Non-fatal: model was updated successfully, but we can't fetch it
        this.warnings.push(`Update succeeded but failed to fetch updated model: ${(e as Error).message}`)
      }

      // Return result
      return {
        success: this.errors.length === 0,
        model: updatedModel,
        errors: this.errors,
        warnings: this.warnings,
        progress: this.progress,
        stats: this.stats
      }

    } catch (e) {
      this.errors.push({
        step: 'update',
        error: `Unexpected error during update: ${(e as Error).message}`
      })
      return {
        success: false,
        errors: this.errors,
        warnings: this.warnings,
        progress: this.progress,
        stats: this.stats
      }
    }
  }

  private fetchExistingModelStructure = async (): Promise<Model | null> => {
    try {
      const modelData = await this.dtModel.getModelData({ modelId: this.currentModelId })

      if (modelData && modelData.defaultBoundary) {
        const defaultBoundary = modelData.defaultBoundary
        this.defaultBoundaryId = defaultBoundary.id

        // Map the default boundary ID
        this.idMapping.set(defaultBoundary.id, this.defaultBoundaryId)

        // Track existing elements from allDescendant fields
        const allComponents = defaultBoundary.allDescendantComponents || []
        const allBoundaries = defaultBoundary.allDescendantBoundaries || []
        const allDataFlows = defaultBoundary.allDescendantDataFlows || []

        for (const component of allComponents) {
          this.existingComponentIds.add(component.id)
          this.idMapping.set(component.id, component.id)
        }

        // Conduit baseline: flatten the root's own conduit connections + every descendant's.
        // (getModelData = DUMP_MODEL_DATA selects outbound/inboundConduitsConnection on both.)
        this.existingConduitsByBoundary.set(this.defaultBoundaryId, flattenConduits(defaultBoundary))

        for (const boundary of allBoundaries) {
          this.existingBoundaryIds.add(boundary.id)
          this.idMapping.set(boundary.id, boundary.id)
          this.existingConduitsByBoundary.set(boundary.id, flattenConduits(boundary))
        }

        for (const dataflow of allDataFlows) {
          this.existingDataflowIds.add(dataflow.id)
          this.idMapping.set(dataflow.id, dataflow.id)
        }

        // Track data items
        if (modelData.dataItems) {
          for (const dataitem of modelData.dataItems) {
            this.existingDataitemIds.add(dataitem.id)
            this.idMapping.set(dataitem.id, dataitem.id)
          }
        }
      }

      return modelData as Model

    } catch (e) {
      this.errors.push({
        step: 'fetch_existing_model',
        error: (e as Error).message
      })
      return null
    }
  }

  /**
   * Resolve control references (by ID or name) to server control IDs.
   * Caches available controls for the duration of the update batch.
   * Returns undefined when input is undefined (preserves existing controls).
   */
  private resolveControls = async (
    controls: any[] | undefined
  ): Promise<string[] | undefined> => {
    if (controls === undefined) return undefined
    if (controls.length === 0) return []

    // Populate cache on first call
    if (this.cachedAvailableControls === null) {
      this.cachedAvailableControls = []
      let noFolderOk = false
      let allOk = false
      try {
        const noFolderControls = await this.dtControl.getControls({ folderId: undefined })
        this.cachedAvailableControls.push(...noFolderControls)
        noFolderOk = true
      } catch { /* silently continue */ }
      try {
        const allControls = await this.dtControl.getControls({ folderId: 'all' })
        for (const control of allControls) {
          if (!this.cachedAvailableControls.find((c: any) => c.id === control.id)) {
            this.cachedAvailableControls.push(control)
          }
        }
        allOk = true
      } catch { /* silently continue */ }
      // The 'all' fetch is the superset (folderId:'all' → no folder filter), so the
      // catalog is complete iff it succeeded — a half-outage where only the no-folder
      // fetch worked would leave folder-scoped controls unresolvable and REPLACE-strip
      // them just as silently as a full outage. Flag EITHER an 'all' failure or a full
      // failure as UNAVAILABLE (this and later elements preserve) and surface ONE error
      // so the run reports success:false rather than silently wiping controls.
      // (noFolderOk alone is NOT sufficient; allOk alone is — hence the gate on allOk.)
      if (!allOk) {
        this.controlCatalogUnavailable = true
        this.errors.push({
          step: 'resolve_controls',
          error: noFolderOk
            ? "Control catalog incomplete (the 'all' fetch failed) — controls preserved, not synced"
            : 'Control catalog unavailable (both fetches failed) — controls preserved, not synced',
        })
      }
    }

    // Catalog outage: preserve existing controls (undefined ⇒ callers omit the key)
    // rather than resolving this non-empty input against an empty catalog and wiping.
    if (this.controlCatalogUnavailable) return undefined

    const controlIds: string[] = []
    for (const controlData of controls) {
      let found = false

      // Priority 1: Match by exact ID
      if (controlData.id) {
        const match = this.cachedAvailableControls.find((c: any) => c.id === controlData.id)
        if (match) { controlIds.push(match.id); found = true }
      }

      // Priority 2-4: Match by name (exact → case-insensitive → partial)
      if (!found && controlData.name) {
        const match = this.cachedAvailableControls.find((c: any) => c.name === controlData.name)
          || this.cachedAvailableControls.find((c: any) =>
            c.name.toLowerCase() === controlData.name.toLowerCase())
          || this.cachedAvailableControls.find((c: any) =>
            c.name.toLowerCase().includes(controlData.name.toLowerCase()) ||
            controlData.name.toLowerCase().includes(c.name.toLowerCase()))
        if (match) { controlIds.push(match.id); found = true }
      }

      if (!found) {
        this.warnings.push(`Could not resolve control: ${controlData.name || controlData.id || 'unnamed'}`)
      }
    }
    return controlIds
  }

  /**
   * Resolve data-item reference ids through the id-mapping so newly-created
   * items carry their server ids; ids already on the platform fall through
   * unchanged. Returns [] when no ids are given. Used to populate
   * `node.data.dataItems` / `edge.data.dataItems`, which the per-element
   * mutations REPLACE-sync (connect the listed items, disconnect the rest).
   */
  private mapDataItemIds = (ids?: string[]): string[] =>
    (ids ?? []).map(id => this.idMapping.get(id) || id)

  private updateModelProperties = async (data: any, existingModel: Model): Promise<void> => {
    try {
      // Modules: resolve the NEW target ids from the JSON when the key is present
      // (single source of truth for the model write). Preserve existing modules when
      // the key is absent, or when nothing resolves — parity with the former
      // updateModules, which skipped its write when no target module resolved. (So an
      // explicit empty list preserves rather than clears — pushes cannot unassign all
      // modules; that matches prior behaviour and is out of scope here.)
      const existingModuleIds = existingModel.modules?.map((m: Module) => m.id) || []
      let moduleIds = existingModuleIds
      if (data.modules !== undefined) {
        const resolved = await this.resolveTargetModuleIds(data.modules)
        moduleIds = resolved.length > 0 ? resolved : existingModuleIds
      }
      this.assignedModuleIds = moduleIds

      // Resolve controls from input, falling back to existing model controls. A catalog
      // outage makes resolveControls return undefined — preserve existing rather than
      // wipe (the `?? existing` fallback), matching the element paths.
      const existingControlIds = existingModel.controls?.map((c: any) => typeof c === 'string' ? c : c.id) || []
      let controlIds: string[]
      if (data.controls !== undefined) {
        const resolved = await this.resolveControls(data.controls)
        controlIds = resolved ?? existingControlIds
      } else {
        controlIds = existingControlIds
      }

      await this.dtModel.updateModel({
        id: this.currentModelId,
        name: data.name || existingModel.name,
        description: data.description || existingModel.description || '',
        modules: moduleIds,
        controls: controlIds,
        // Preserve the model's current folder by passing its id, so the builder
        // reconnects the same folder (net no-op) instead of the disconnect-all that a
        // hardcoded `undefined` triggered on every push. `existingModel.folder` is now
        // populated by getModelData (DUMP_MODEL_DATA selects `folder { id }`).
        folderId: existingModel.folder?.id,
        // Asset-context scope (grouped local shape; the builder lifts it onto the
        // flat platform fields with REPLACE semantics). Absent → platform untouched.
        scope: data.scope
      })
      this.stats.updated++
    } catch (e) {
      // A thrown model-property write is a HARD failure — route to errors so `success`
      // reflects it (was a swallowed warning that left success:true on a failed write).
      this.errors.push({
        step: 'update_model_properties',
        error: (e as Error).message
      })
    }
  }

  // Resolve module references (by id, then by name) to server module ids. Extracted
  // from the former updateModules so updateModelProperties is the single writer of the
  // model. NEVER lets a dtModule fetch error propagate: each fetch stays wrapped so a
  // transient module-fetch failure is a warning, not a run-failing error (the caller's
  // catch is now error-level). Only invoked with a present `modules` key.
  private resolveTargetModuleIds = async (modules: any): Promise<string[]> => {
    if (!Array.isArray(modules)) {
      this.warnings.push(`Modules is not an array: ${typeof modules}`)
      return []
    }

    const targetModuleIds: string[] = []
    for (const moduleRef of modules) {
      if (typeof moduleRef !== 'object') {
        this.warnings.push(`Invalid module reference (type: ${typeof moduleRef}): ${moduleRef}`)
        continue
      }

      const moduleId = moduleRef.id
      const moduleName = moduleRef.name
      let actualModuleId: string | null = null

      // Try to find module by ID first
      if (moduleId) {
        try {
          const module = await this.dtModule.getModuleById(moduleId)
          if (module) {
            actualModuleId = moduleId
          }
        } catch (e) {
          this.warnings.push(`Error fetching module ${moduleId}: ${(e as Error).message}`)
        }
      }

      // If not found by ID, try by name
      if (!actualModuleId && moduleName) {
        try {
          const modulesList = await this.dtModule.getModules()
          for (const mod of modulesList) {
            if (mod.name === moduleName) {
              actualModuleId = mod.id
              break
            }
          }
        } catch (e) {
          this.warnings.push(`Error fetching modules list: ${(e as Error).message}`)
        }
      }

      if (actualModuleId) {
        targetModuleIds.push(actualModuleId)
      } else {
        this.warnings.push(`Module not found: ${moduleName || moduleId}`)
      }
    }
    return targetModuleIds
  }

  private updateDefaultBoundary = async (boundaryData: any): Promise<void> => {
    try {
      if (!this.defaultBoundaryId) {
        this.errors.push({
          step: 'update_default_boundary',
          error: 'Default boundary ID not set'
        })
        return
      }

      // Create a Node-like object for updating
      const boundaryNode: Node = {
        id: this.defaultBoundaryId,
        type: 'SECURITY_BOUNDARY',
        position: {
          x: boundaryData.positionX || 0,
          y: boundaryData.positionY || 0
        },
        data: {
          label: boundaryData.name || 'Default Boundary',
          description: boundaryData.description || '',
          zone: boundaryData.zone,
          domains: boundaryData.domains,
          planes: boundaryData.planes
        },
        width: boundaryData.dimensionsWidth,
        height: boundaryData.dimensionsHeight
      }

      // Controls REPLACE on full sync: a genuinely-absent JSON key clears (send []);
      // a present key uses the resolved list (incl []). If a present input can't be
      // resolved (resolveControls → undefined), leave the key unset so the builder
      // omits it (preserve) rather than wiping.
      const resolvedControls = await this.resolveControls(boundaryData.controls)
      if (boundaryData.controls === undefined) {
        boundaryNode.data.controls = []
      } else if (resolvedControls !== undefined) {
        boundaryNode.data.controls = resolvedControls
      }

      // Data items REPLACE on full sync: always send the mapped list (incl []) so
      // removed items are cleared via an explicit disconnect-all; the conduit pass
      // omits this key (builds its own node) to preserve.
      boundaryNode.data.dataItems = this.mapDataItemIds(boundaryData.dataItemIds)

      await this.dtBoundary.updateBoundaryNode({
        updatedNode: boundaryNode,
        defaultBoundaryId: this.defaultBoundaryId
      })
      this.stats.updated++

    } catch (e) {
      // A thrown default-boundary write is a HARD failure — route to errors.
      this.errors.push({
        step: 'update_default_boundary',
        error: (e as Error).message
      })
    }

    try {
      // Update class if provided. Explicit null is the unassign sentinel: fire a
      // NONE rebind (idempotent — the platform sweeps SYSTEM-derived exposures and
      // keeps user-authored ones). Absent classData leaves the binding untouched.
      if (boundaryData.classData?.id) {
        await this.dtClass.changeElementBinding({
          elementId: this.defaultBoundaryId,
          target: { kind: 'CLASS', classIds: [boundaryData.classData.id] }
        })
      } else if (boundaryData.classData === null) {
        await this.dtClass.changeElementBinding({
          elementId: this.defaultBoundaryId,
          target: { kind: 'NONE' }
        })
      }

    } catch (e) {
      // A thrown class-bind is a HARD failure — route to errors (consistent with how
      // non-default boundaries treat the same operation in updateBoundary's outer catch).
      this.errors.push({
        step: 'update_default_boundary_class',
        error: (e as Error).message
      })
    }
  }

  private updateDataItems = async (dataItems: any[]): Promise<void> => {
    for (const itemData of dataItems) {
      try {
        const itemId = itemData.id

        // Check if data item exists
        if (itemId && this.existingDataitemIds.has(itemId)) {
          // Update existing data item
          const result = await this.dtDataitem.updateDataItem({
            dataItemId: itemId,
            name: itemData.name,
            description: itemData.description || '',
            // Explicit null classData must reach updateDataItem as null (its NONE
            // unassign path); `?.` alone would collapse it to undefined (no-op).
            classId: itemData.classData === null ? null : itemData.classData?.id,
            // Asset-context (REPLACE on update). Local snake `regulatory_flags`.
            sensitivity: itemData.sensitivity,
            regulatoryFlags: itemData.regulatory_flags
          })
          // Map + mark processed regardless of outcome: the item EXISTS, so it must
          // not become an orphan-delete target even if the update itself failed.
          this.idMapping.set(itemId, itemId)
          this.processedDataitemIds.add(itemId)
          // updateDataItem never throws — it encodes failure as residualOk:false.
          // Count as updated only on genuine success; otherwise surface an error so
          // `success` reflects it (was an unconditional stats.updated++ = miscounted).
          if (result.residualOk) {
            this.stats.updated++
          } else {
            this.errors.push({
              step: 'update_data_items',
              elementName: itemData.name || 'unknown',
              elementId: itemId,
              error: result.bindingResult?.errorCode
                ? `Data item update failed (binding: ${result.bindingResult.errorCode})`
                : 'Data item update failed (residual mutation did not persist)'
            })
          }
        } else {
          // Create new data item
          const createdItem = await this.dtDataitem.createDataItem({
            name: itemData.name,
            description: itemData.description || '',
            elementId: this.defaultBoundaryId,
            classId: itemData.classData?.id,
            modelId: this.currentModelId,
            sensitivity: itemData.sensitivity,
            regulatoryFlags: itemData.regulatory_flags
          })

          if (createdItem && itemData.id) {
            this.idMapping.set(itemData.id, createdItem.id)
            this.processedDataitemIds.add(createdItem.id)
            this.stats.created++
          } else if (!createdItem) {
            // createDataItem returned no row (the mutation didn't persist) — a real
            // errors throw is caught below; a silent null was previously ignored.
            this.errors.push({
              step: 'update_data_items',
              elementName: itemData.name || 'unknown',
              elementId: itemData.id,
              error: 'Data item create returned no result'
            })
          }
        }

      } catch (e) {
        this.errors.push({
          step: 'update_data_items',
          elementName: itemData.name || 'unknown',
          elementId: itemData.id,
          error: (e as Error).message
        })
      }
    }
  }

  private updateBoundariesRecursive = async (
    boundaries: any[],
    parentBoundaryId: string
  ): Promise<void> => {
    for (const boundaryData of boundaries) {
      try {
        const boundaryId = boundaryData.id

        // Track the server id of this boundary directly (not via idMapping) so a newly
        // created boundary with NO JSON id still parents its subtree. Keying idMapping
        // with '' (the old `boundaryData.id || ''`) collided all id-less boundaries and
        // made the child lookup resolve to '' → recursion was skipped, dropping the tree.
        let actualBoundaryId = ''

        // Check if boundary exists
        if (boundaryId && this.existingBoundaryIds.has(boundaryId)) {
          // Update existing boundary
          await this.updateBoundary(boundaryData, parentBoundaryId)
          this.idMapping.set(boundaryId, boundaryId)
          this.processedBoundaryIds.add(boundaryId)
          this.stats.updated++
          actualBoundaryId = boundaryId
        } else {
          // Create new boundary
          const created = await this.createBoundary(boundaryData, parentBoundaryId)
          if (created) {
            // Only map when there is a source id to map from — never pollute idMapping
            // with a '' key.
            if (boundaryId) {
              this.idMapping.set(boundaryId, created.id)
            }
            this.processedBoundaryIds.add(created.id)
            this.stats.created++
            actualBoundaryId = created.id
          }
        }

        if (actualBoundaryId) {
          // Process nested boundaries recursively
          if (boundaryData.boundaries) {
            await this.updateBoundariesRecursive(
              boundaryData.boundaries,
              actualBoundaryId
            )
          }

          // Process components within this boundary
          if (boundaryData.components) {
            await this.updateComponents(
              boundaryData.components,
              actualBoundaryId
            )
          }
        }

      } catch (e) {
        this.errors.push({
          step: 'update_boundaries_recursive',
          elementName: boundaryData.name || 'unknown',
          elementId: boundaryData.id,
          error: (e as Error).message
        })
      }
    }
  }

  private updateBoundary = async (
    boundaryData: any,
    parentBoundaryId: string
  ): Promise<void> => {
    try {
      const boundaryId = boundaryData.id
      if (!boundaryId) return

      const boundaryNode: Node = {
        id: boundaryId,
        type: 'SECURITY_BOUNDARY',
        position: {
          x: boundaryData.positionX || 0,
          y: boundaryData.positionY || 0
        },
        data: {
          label: boundaryData.name,
          description: boundaryData.description || '',
          zone: boundaryData.zone,
          domains: boundaryData.domains,
          planes: boundaryData.planes
        },
        parentNode: parentBoundaryId,
        width: boundaryData.dimensionsWidth || 0,
        height: boundaryData.dimensionsHeight || 0
      }

      // Controls REPLACE on full sync: a genuinely-absent JSON key clears (send []);
      // a present key uses the resolved list (incl []). If a present input can't be
      // resolved (resolveControls → undefined), leave the key unset so the builder
      // omits it (preserve) rather than wiping.
      const resolvedControls = await this.resolveControls(boundaryData.controls)
      if (boundaryData.controls === undefined) {
        boundaryNode.data.controls = []
      } else if (resolvedControls !== undefined) {
        boundaryNode.data.controls = resolvedControls
      }

      // Data items REPLACE on full sync: always send the mapped list (incl []) so
      // removed items are cleared via an explicit disconnect-all; the conduit pass
      // omits this key (builds its own node) to preserve.
      boundaryNode.data.dataItems = this.mapDataItemIds(boundaryData.dataItemIds)

      await this.dtBoundary.updateBoundaryNode({
        updatedNode: boundaryNode,
        defaultBoundaryId: this.defaultBoundaryId
      })

      // Update class if provided. Explicit null unassigns (NONE rebind, idempotent);
      // absent classData leaves the binding untouched.
      if (boundaryData.classData?.id) {
        await this.dtClass.changeElementBinding({
          elementId: boundaryId,
          target: { kind: 'CLASS', classIds: [boundaryData.classData.id] }
        })

        // Set instantiation attributes if provided
        if (boundaryData.attributes) {
          await this.setElementAttributes(
            boundaryId,
            boundaryData.classData.id,
            boundaryData.attributes,
            boundaryData.name
          )
        }
      } else if (boundaryData.classData === null) {
        await this.dtClass.changeElementBinding({
          elementId: boundaryId,
          target: { kind: 'NONE' }
        })
      }

    } catch (e) {
      this.errors.push({
        step: 'update_boundary',
        elementName: boundaryData.name || 'unknown',
        elementId: boundaryData.id,
        error: (e as Error).message
      })
    }
  }

  private createBoundary = async (
    boundaryData: any,
    parentBoundaryId: string
  ): Promise<Node | null> => {
    try {
      const classId = boundaryData.classData?.id || ''

      const boundaryNode: Node = {
        id: '',
        type: 'SECURITY_BOUNDARY',
        position: {
          x: boundaryData.positionX || 0,
          y: boundaryData.positionY || 0
        },
        data: {
          label: boundaryData.name,
          description: boundaryData.description || ''
        },
        parentNode: parentBoundaryId,
        width: boundaryData.dimensionsWidth || 0,
        height: boundaryData.dimensionsHeight || 0
      }

      const createdBoundary = await this.dtBoundary.createBoundaryNode({
        newNode: boundaryNode,
        classId,
        // createBoundaryNode only honours an ARRAY-shaped parentNode; ours is a string,
        // so the parent must ride in via defaultBoundaryId (same pattern as DtImport) —
        // passing the model root here would flatten every nested create under it.
        defaultBoundaryId: parentBoundaryId || this.defaultBoundaryId
      })

      if (createdBoundary && boundaryData.attributes && classId) {
        await this.setElementAttributes(
          createdBoundary.id,
          classId,
          boundaryData.attributes,
          boundaryData.name
        )
      }

      // Associate controls and/or data items with the newly created boundary via a
      // follow-up update (the create mutation carries neither).
      if (createdBoundary) {
        const resolvedControls = await this.resolveControls(boundaryData.controls)
        const followUpControls = resolvedControls && resolvedControls.length > 0 ? resolvedControls : undefined
        const followUpDataItems = this.mapDataItemIds(boundaryData.dataItemIds)
        // createBoundaryNode (ADD_BOUNDARY) can't set zoning, so the follow-up must also fire when the
        // boundary declares any zoning — not only for controls/dataItems (else a zoning-only boundary loses it).
        const followUpZoning =
          boundaryData.zone !== undefined ||
          boundaryData.domains !== undefined ||
          boundaryData.planes !== undefined
        if (followUpControls || followUpDataItems.length > 0 || followUpZoning) {
          const updateNode: Node = {
            id: createdBoundary.id,
            type: 'SECURITY_BOUNDARY',
            position: { x: boundaryData.positionX || 0, y: boundaryData.positionY || 0 },
            data: {
              label: boundaryData.name,
              description: boundaryData.description || '',
              zone: boundaryData.zone,
              domains: boundaryData.domains,
              planes: boundaryData.planes,
              ...(followUpControls ? { controls: followUpControls } : {}),
              ...(followUpDataItems.length > 0 ? { dataItems: followUpDataItems } : {})
            },
            parentNode: parentBoundaryId,
            width: boundaryData.dimensionsWidth || 0,
            height: boundaryData.dimensionsHeight || 0
          }
          await this.dtBoundary.updateBoundaryNode({
            updatedNode: updateNode,
            defaultBoundaryId: this.defaultBoundaryId
          })
        }
      }

      return createdBoundary

    } catch (e) {
      this.errors.push({
        step: 'create_boundary',
        elementName: boundaryData.name || 'unknown',
        error: (e as Error).message
      })
      return null
    }
  }

  /**
   * Final conduit pass. Runs after every boundary is created/updated/mapped and BEFORE orphan deletion.
   * Writes each edge once from its OUTBOUND source (prepareConduitsForWrite), translating peer ids through
   * idMapping and passing the fetched server baseline so an unchanged edge is NOT re-connected (connect is
   * non-idempotent). A peer that is an orphan (present on the server but omitted from this update, so it is
   * about to be deleted) is dropped — its edge legitimately goes away.
   */
  private associateConduitsWithBoundaries = async (jsonData: any): Promise<void> => {
    const root = jsonData.defaultBoundary
    if (!root) return
    // The root host is always the server default boundary (updateDefaultBoundary resolves it the same
    // way, not via idMapping — the JSON's default id may not match the server's).
    await this.writeConduitsForBoundary(root, this.defaultBoundaryId)
    if (Array.isArray(root.boundaries)) {
      for (const child of root.boundaries) {
        await this.processElementForConduitAssociation(child)
      }
    }
  }

  private processElementForConduitAssociation = async (element: any): Promise<void> => {
    // Child boundaries resolve their server id through idMapping (existing → self, new → new id).
    const hostServerId = this.idMapping.get(element.id)
    if (hostServerId) {
      await this.writeConduitsForBoundary(element, hostServerId)
    }
    // Recurse into child boundaries (components carry no conduits).
    if (element.boundaries && Array.isArray(element.boundaries)) {
      for (const boundary of element.boundaries) {
        await this.processElementForConduitAssociation(boundary)
      }
    }
  }

  private writeConduitsForBoundary = async (element: any, hostServerId: string): Promise<void> => {
    // Decision 4: reconcile only when a conduits array is present (incl. []); absent ⇒ leave alone.
    if (!Array.isArray(element.conduits)) return

    const { conduits, dropped } = prepareConduitsForWrite(element.conduits, (oldId: string) => {
      const n = this.idMapping.get(oldId)
      // Drop unresolved peers and peers pending orphan-deletion (existing but not processed).
      if (!n || (this.existingBoundaryIds.has(n) && !this.processedBoundaryIds.has(n))) return undefined
      return n
    })
    for (const peerId of dropped) {
      this.warnings.push(`Dropped conduit on ${element.name || hostServerId}: peer ${peerId} unresolved or pending deletion`)
    }
    const baseline = this.existingConduitsByBoundary.get(hostServerId) ?? []
    // Write is OUTBOUND-canonical: prepareConduitsForWrite strips the INBOUND mirror from `conduits`, so
    // the baseline must be OUTBOUND-only too. Passing the full baseline (which includes the re-derived
    // INBOUND mirror) makes updateBoundaryNode's INBOUND reconcile see empty current vs a populated INBOUND
    // baseline and disconnect every inbound mirror — silently deleting an A→B channel that peer A still
    // declares, on any boundary that both sends and receives conduits. (Import is safe: its baseline is [].)
    const baselineOutbound = baseline.filter(c => c.direction === 'OUTBOUND')
    // Skip only when there is genuinely nothing to reconcile (no desired + no existing outbound).
    if (conduits.length === 0 && baselineOutbound.length === 0) return

    try {
      // Safe node: carry conduits, re-send name/description/position/dimensions, and OMIT
      // controls/dataItems/zoning/parentNode so they are left untouched (controls were set in
      // Step 7; `controls: []` would disconnect-ALL — never send it here).
      const updatedNode = {
        id: hostServerId,
        type: 'SECURITY_BOUNDARY',
        data: {
          label: element.name,
          description: element.description || '',
          conduits,
        },
        position: { x: element.positionX || 0, y: element.positionY || 0 },
        width: element.dimensionsWidth || 0,
        height: element.dimensionsHeight || 0,
      }
      await this.dtBoundary.updateBoundaryNode({
        updatedNode: updatedNode as Node,
        defaultBoundaryId: this.defaultBoundaryId,
        baselineConduits: baselineOutbound,
      })
    } catch (e) {
      // A thrown conduit reconcile is a HARD failure — route to errors (a dropped peer,
      // handled above via `dropped`, stays an advisory warning).
      this.errors.push({
        step: 'associate_conduits',
        elementName: element.name || hostServerId,
        elementId: hostServerId,
        error: (e as Error).message
      })
    }
  }

  private updateComponents = async (
    components: any[],
    parentBoundaryId: string
  ): Promise<void> => {
    for (const componentData of components) {
      try {
        const componentId = componentData.id

        // Check if component exists
        if (componentId && this.existingComponentIds.has(componentId)) {
          // Update existing component
          await this.updateComponent(componentData, parentBoundaryId)
          this.idMapping.set(componentId, componentId)
          this.processedComponentIds.add(componentId)
          this.stats.updated++
        } else {
          // Create new component
          const created = await this.createComponent(componentData, parentBoundaryId)
          if (created && componentData.id) {
            this.idMapping.set(componentData.id, created.id)
            this.processedComponentIds.add(created.id)
            this.stats.created++
          }
        }

      } catch (e) {
        this.errors.push({
          step: 'update_components',
          elementName: componentData.name || 'unknown',
          elementId: componentData.id,
          error: (e as Error).message
        })
      }
    }
  }

  private updateComponent = async (
    componentData: any,
    parentBoundaryId: string
  ): Promise<void> => {
    try {
      const componentId = componentData.id
      if (!componentId) return

      const componentNode: Node = {
        id: componentId,
        type: componentData.type,
        position: {
          x: componentData.positionX || 0,
          y: componentData.positionY || 0
        },
        data: {
          label: componentData.name,
          description: componentData.description || '',
          // Lifted crown-jewel flag (REPLACE on the primary structure update —
          // always set true/false so an unmark propagates).
          crownJewel: componentData.crownJewel === true
        },
        parentNode: parentBoundaryId
      }

      // Controls REPLACE on full sync: a genuinely-absent JSON key clears (send []);
      // a present key uses the resolved list (incl []). If a present input can't be
      // resolved (resolveControls → undefined), leave the key unset so the builder
      // omits it (preserve) rather than wiping.
      const resolvedControls = await this.resolveControls(componentData.controls)
      if (componentData.controls === undefined) {
        componentNode.data.controls = []
      } else if (resolvedControls !== undefined) {
        componentNode.data.controls = resolvedControls
      }

      // Data items REPLACE on full sync: always send the mapped list (incl []) so
      // removed items are cleared via an explicit disconnect-all; the conduit pass
      // omits this key (builds its own node) to preserve.
      componentNode.data.dataItems = this.mapDataItemIds(componentData.dataItemIds)

      await this.dtComponent.updateComponent({
        updatedNode: componentNode,
        defaultBoundaryId: this.defaultBoundaryId
      })

      // Update class if provided. Explicit null unassigns (NONE rebind, idempotent);
      // absent classData leaves the binding untouched.
      if (componentData.classData?.id) {
        await this.dtClass.changeElementBinding({
          elementId: componentId,
          target: { kind: 'CLASS', classIds: [componentData.classData.id] }
        })

        // Set instantiation attributes if provided
        if (componentData.attributes) {
          await this.setElementAttributes(
            componentId,
            componentData.classData.id,
            componentData.attributes,
            componentData.name
          )
        }
      } else if (componentData.classData === null) {
        await this.dtClass.changeElementBinding({
          elementId: componentId,
          target: { kind: 'NONE' }
        })
      }

    } catch (e) {
      this.errors.push({
        step: 'update_component',
        elementName: componentData.name || 'unknown',
        elementId: componentData.id,
        error: (e as Error).message
      })
    }
  }

  private createComponent = async (
    componentData: any,
    parentBoundaryId: string
  ): Promise<Node | null> => {
    try {
      const classId = componentData.classData?.id || ''

      const componentNode: Node = {
        id: '',
        type: componentData.type,
        position: {
          x: componentData.positionX || 0,
          y: componentData.positionY || 0
        },
        data: {
          label: componentData.name,
          description: componentData.description || '',
          // Lifted crown-jewel flag → carried into ADD_COMPONENT (set when true).
          crownJewel: componentData.crownJewel === true
        },
        parentNode: parentBoundaryId
      }

      const createdComponent = await this.dtComponent.createComponentNode({
        newNode: componentNode,
        classId,
        // createComponentNode only honours an ARRAY-shaped parentNode; ours is a string,
        // so the parent must ride in via defaultBoundaryId (same pattern as DtImport) —
        // passing the model root here would flatten every nested create under it.
        defaultBoundaryId: parentBoundaryId || this.defaultBoundaryId
      })

      if (createdComponent && componentData.attributes && classId) {
        await this.setElementAttributes(
          createdComponent.id,
          classId,
          componentData.attributes,
          componentData.name
        )
      }

      // Associate controls and/or data items with the newly created component via a
      // follow-up update (the create mutation carries neither).
      if (createdComponent) {
        const resolvedControls = await this.resolveControls(componentData.controls)
        const followUpControls = resolvedControls && resolvedControls.length > 0 ? resolvedControls : undefined
        const followUpDataItems = this.mapDataItemIds(componentData.dataItemIds)
        if (followUpControls || followUpDataItems.length > 0) {
          const updateNode: Node = {
            id: createdComponent.id,
            type: componentData.type,
            position: { x: componentData.positionX || 0, y: componentData.positionY || 0 },
            data: {
              label: componentData.name,
              description: componentData.description || '',
              ...(followUpControls ? { controls: followUpControls } : {}),
              ...(followUpDataItems.length > 0 ? { dataItems: followUpDataItems } : {})
            },
            parentNode: parentBoundaryId
          }
          await this.dtComponent.updateComponent({
            updatedNode: updateNode,
            defaultBoundaryId: this.defaultBoundaryId
          })
        }
      }

      return createdComponent

    } catch (e) {
      this.errors.push({
        step: 'create_component',
        elementName: componentData.name || 'unknown',
        error: (e as Error).message
      })
      return null
    }
  }

  private updateDataFlows = async (dataFlows: any[]): Promise<void> => {
    for (const flowData of dataFlows) {
      try {
        const flowId = flowData.id

        // Resolve source and target component IDs
        const sourceId = this.idMapping.get(flowData.source?.id)
        const targetId = this.idMapping.get(flowData.target?.id)

        if (!sourceId || !targetId) {
          this.errors.push({
            step: 'update_data_flows',
            elementName: flowData.name || 'unknown',
            elementId: flowId,
            error: 'Source or target component not found'
          })
          continue
        }

        // Check if data flow exists
        if (flowId && this.existingDataflowIds.has(flowId)) {
          // Update existing data flow
          await this.updateDataFlow(flowData, sourceId, targetId)
          this.idMapping.set(flowId, flowId)
          this.processedDataflowIds.add(flowId)
          this.stats.updated++
        } else {
          // Create new data flow
          const created = await this.createDataFlow(flowData, sourceId, targetId)
          if (created && flowData.id) {
            this.idMapping.set(flowData.id, created.id)
            this.processedDataflowIds.add(created.id)
            this.stats.created++
          }
        }

      } catch (e) {
        this.errors.push({
          step: 'update_data_flows',
          elementName: flowData.name || 'unknown',
          elementId: flowData.id,
          error: (e as Error).message
        })
      }
    }
  }

  private updateDataFlow = async (
    flowData: any,
    sourceId: string,
    targetId: string
  ): Promise<void> => {
    try {
      const flowId = flowData.id
      if (!flowId) return

      const edge: Edge = {
        id: flowId,
        source: sourceId,
        target: targetId,
        sourceHandle: flowData.sourceHandle,
        targetHandle: flowData.targetHandle,
        label: flowData.name,
        data: {
          description: flowData.description || ''
        }
      }

      // Controls REPLACE on full sync: a genuinely-absent JSON key clears (send []);
      // a present key uses the resolved list (incl []). If a present input can't be
      // resolved (resolveControls → undefined), leave the key unset so the builder
      // omits it (preserve) rather than wiping.
      const resolvedControls = await this.resolveControls(flowData.controls)
      if (flowData.controls === undefined) {
        edge.data.controls = []
      } else if (resolvedControls !== undefined) {
        edge.data.controls = resolvedControls
      }

      // Data items REPLACE on full sync: always send the mapped list (incl []) so
      // removed items are cleared via an explicit disconnect-all; the conduit pass
      // omits this key (builds its own node) to preserve.
      edge.data.dataItems = this.mapDataItemIds(flowData.dataItemIds)

      await this.dtDataflow.updateDataFlow({
        edge,
        updates: {
          name: flowData.name,
          description: flowData.description || ''
        }
      })

      // Update class if provided. Explicit null unassigns (NONE rebind, idempotent);
      // absent classData leaves the binding untouched.
      if (flowData.classData?.id) {
        await this.dtClass.changeElementBinding({
          elementId: flowId,
          target: { kind: 'CLASS', classIds: [flowData.classData.id] }
        })

        // Set instantiation attributes if provided
        if (flowData.attributes) {
          await this.setElementAttributes(
            flowId,
            flowData.classData.id,
            flowData.attributes,
            flowData.name
          )
        }
      } else if (flowData.classData === null) {
        await this.dtClass.changeElementBinding({
          elementId: flowId,
          target: { kind: 'NONE' }
        })
      }

    } catch (e) {
      this.errors.push({
        step: 'update_data_flow',
        elementName: flowData.name || 'unknown',
        elementId: flowData.id,
        error: (e as Error).message
      })
    }
  }

  private createDataFlow = async (
    flowData: any,
    sourceId: string,
    targetId: string
  ): Promise<Edge | null> => {
    try {
      const classId = flowData.classData?.id || ''

      const newEdge: Edge = {
        id: '',
        source: sourceId,
        target: targetId,
        sourceHandle: flowData.sourceHandle,
        targetHandle: flowData.targetHandle,
        label: flowData.name,
        data: {
          description: flowData.description || ''
        }
      }

      const createdFlow = await this.dtDataflow.createDataFlow({
        newEdge,
        classId
      })

      if (createdFlow && flowData.attributes && classId) {
        await this.setElementAttributes(
          createdFlow.id,
          classId,
          flowData.attributes,
          flowData.name
        )
      }

      // Associate controls and/or data items with the newly created data flow via a
      // follow-up update (the create mutation carries neither).
      if (createdFlow) {
        const resolvedControls = await this.resolveControls(flowData.controls)
        const followUpControls = resolvedControls && resolvedControls.length > 0 ? resolvedControls : undefined
        const followUpDataItems = this.mapDataItemIds(flowData.dataItemIds)
        if (followUpControls || followUpDataItems.length > 0) {
          const updateEdge: Edge = {
            id: createdFlow.id,
            source: sourceId,
            target: targetId,
            sourceHandle: flowData.sourceHandle,
            targetHandle: flowData.targetHandle,
            label: flowData.name,
            data: {
              description: flowData.description || '',
              ...(followUpControls ? { controls: followUpControls } : {}),
              ...(followUpDataItems.length > 0 ? { dataItems: followUpDataItems } : {})
            }
          }
          await this.dtDataflow.updateDataFlow({
            edge: updateEdge,
            updates: {}
          })
        }
      }

      return createdFlow

    } catch (e) {
      this.errors.push({
        step: 'create_data_flow',
        elementName: flowData.name || 'unknown',
        error: (e as Error).message
      })
      return null
    }
  }

  private deleteOrphanedElements = async (): Promise<void> => {
    try {
      // Delete orphaned data items
      const orphanedDataitemIds = new Set(
        [...this.existingDataitemIds].filter(id => !this.processedDataitemIds.has(id))
      )
      for (const dataitemId of orphanedDataitemIds) {
        try {
          await this.dtDataitem.deleteDataItem({ dataItemId: dataitemId })
          this.stats.deleted++
        } catch (e) {
          this.warnings.push(`Error deleting orphaned data item ${dataitemId}: ${(e as Error).message}`)
        }
      }

      // Delete orphaned data flows
      const orphanedDataflowIds = new Set(
        [...this.existingDataflowIds].filter(id => !this.processedDataflowIds.has(id))
      )
      for (const dataflowId of orphanedDataflowIds) {
        try {
          await this.dtDataflow.deleteDataFlow({ dataFlowId: dataflowId })
          this.stats.deleted++
        } catch (e) {
          this.warnings.push(`Error deleting orphaned data flow ${dataflowId}: ${(e as Error).message}`)
        }
      }

      // Delete orphaned components
      const orphanedComponentIds = new Set(
        [...this.existingComponentIds].filter(id => !this.processedComponentIds.has(id))
      )
      for (const componentId of orphanedComponentIds) {
        try {
          await this.dtComponent.deleteComponent({ componentId })
          this.stats.deleted++
        } catch (e) {
          this.warnings.push(`Error deleting orphaned component ${componentId}: ${(e as Error).message}`)
        }
      }

      // Delete orphaned boundaries
      const orphanedBoundaryIds = new Set(
        [...this.existingBoundaryIds].filter(id => !this.processedBoundaryIds.has(id))
      )
      for (const boundaryId of orphanedBoundaryIds) {
        try {
          await this.dtBoundary.deleteBoundary({ boundaryId })
          this.stats.deleted++
        } catch (e) {
          this.warnings.push(`Error deleting orphaned boundary ${boundaryId}: ${(e as Error).message}`)
        }
      }

    } catch (e) {
      this.warnings.push(`Error deleting orphaned elements: ${(e as Error).message}`)
    }
  }

  private setElementAttributes = async (
    elementId: string,
    classId: string,
    attributes: any,
    elementName: string
  ): Promise<void> => {
    try {
      if (!attributes || typeof attributes !== 'object') {
        return
      }

      // Flatten attributes before setting them
      const flatAttributes = DtUtils.flattenProperties(attributes)

      // Use DtClass to set instantiation attributes
      const success = await this.dtClass.setInstantiationAttributes({
        componentId: elementId,
        classId,
        attributes: flatAttributes
      })

      if (!success) {
        // A failed attribute write is silent partial data loss — route to errors so
        // `success` reflects it (the class-instantiation attributes did not persist).
        this.errors.push({
          step: 'set_element_attributes',
          elementName,
          elementId,
          error: 'Failed to set instantiation attributes'
        })
      }

    } catch (e) {
      this.errors.push({
        step: 'set_element_attributes',
        elementName,
        elementId,
        error: (e as Error).message
      })
    }
  }
}
