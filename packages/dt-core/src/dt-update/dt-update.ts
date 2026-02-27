/**
 * Update functionality for the Dethernety threat modeling framework.
 *
 * This module provides the DtUpdate class which handles updating existing threat models
 * from JSON format conforming to the export-import-schema specification.
 */

import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { Node, Edge } from '@vue-flow/core'
import { DtUtils } from '../dt-utils/dt-utils.js'
import { Model, Module } from '../interfaces/core-types-interface.js'
import { DtModel } from '../dt-model/dt-model.js'
import { DtClass } from '../dt-class/dt-class.js'
import { DtComponent } from '../dt-component/dt-component.js'
import { DtBoundary } from '../dt-boundary/dt-boundary.js'
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
  private apolloClient: ApolloClient<NormalizedCacheObject>
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
  private stats: UpdateStats = { created: 0, updated: 0, deleted: 0 }

  // Track existing elements to detect deletions
  private existingBoundaryIds: Set<string> = new Set()
  private existingComponentIds: Set<string> = new Set()
  private existingDataflowIds: Set<string> = new Set()
  private existingDataitemIds: Set<string> = new Set()

  // Track processed elements to identify orphans
  private processedBoundaryIds: Set<string> = new Set()
  private processedComponentIds: Set<string> = new Set()
  private processedDataflowIds: Set<string> = new Set()
  private processedDataitemIds: Set<string> = new Set()

  private progress: UpdateProgress = {
    currentStep: 0,
    totalSteps: 9,
    stepName: 'Initializing',
    percentage: 0
  }
  private onProgress?: (progress: UpdateProgress) => void

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
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

    this.processedBoundaryIds = new Set()
    this.processedComponentIds = new Set()
    this.processedDataflowIds = new Set()
    this.processedDataitemIds = new Set()

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

      // Step 3: Update model properties
      await this.updateModelProperties(jsonData, existingModel)

      // Step 4: Update modules
      if (jsonData.modules) {
        try {
          await this.updateModules(jsonData.modules, existingModel)
        } catch (e) {
          // Non-fatal: log warning and continue
          this.warnings.push(`Error updating modules: ${(e as Error).message}`)
        }
      }

      this.updateProgress(4, 'Updating default boundary')

      // Step 5: Update default boundary
      await this.updateDefaultBoundary(jsonData.defaultBoundary)

      this.updateProgress(5, 'Updating data items')

      // Step 6: Update/create data items FIRST (before components/dataflows need to reference them)
      if (jsonData.dataItems) {
        await this.updateDataItems(jsonData.dataItems)
      }

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

        for (const boundary of allBoundaries) {
          this.existingBoundaryIds.add(boundary.id)
          this.idMapping.set(boundary.id, boundary.id)
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

  private updateModelProperties = async (data: any, existingModel: Model): Promise<void> => {
    try {
      // Get current model state to preserve unchanged fields
      const moduleIds = existingModel.modules?.map((m: Module) => m.id) || []
      const controlIds: string[] = []

      await this.dtModel.updateModel({
        id: this.currentModelId,
        name: data.name || existingModel.name,
        description: data.description || existingModel.description || '',
        modules: moduleIds,
        controls: controlIds,
        folderId: undefined
      })
      this.stats.updated++
    } catch (e) {
      this.warnings.push(`Error updating model properties: ${(e as Error).message}`)
    }
  }

  private updateModules = async (modules: any[], existingModel: Model): Promise<void> => {
    try {
      if (!Array.isArray(modules)) {
        this.warnings.push(`Modules is not an array: ${typeof modules}`)
        return
      }

      // Resolve target module IDs from JSON
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

      // Update model with new module list
      if (targetModuleIds.length > 0) {
        await this.dtModel.updateModel({
          id: this.currentModelId,
          name: existingModel.name || '',
          description: existingModel.description || '',
          modules: targetModuleIds,
          controls: [],
          folderId: undefined
        })
        this.assignedModuleIds = targetModuleIds
      }

    } catch (e) {
      this.warnings.push(`Error updating modules: ${(e as Error).message}`)
    }
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
          description: boundaryData.description || ''
        },
        width: boundaryData.dimensionsWidth,
        height: boundaryData.dimensionsHeight
      }

      await this.dtBoundary.updateBoundaryNode({
        updatedNode: boundaryNode,
        defaultBoundaryId: this.defaultBoundaryId
      })
      this.stats.updated++

    } catch (e) {
      this.warnings.push(`Error updating default boundary: ${(e as Error).message}`)
    }

    try {
      // Update class if provided
      if (boundaryData.classData?.id) {
        await this.dtBoundary.updateBoundaryClass({
          boundaryId: this.defaultBoundaryId,
          classId: boundaryData.classData.id
        })
      }

    } catch (e) {
      this.warnings.push(`Error updating default boundary class: ${(e as Error).message}`)
    }
  }

  private updateDataItems = async (dataItems: any[]): Promise<void> => {
    for (const itemData of dataItems) {
      try {
        const itemId = itemData.id

        // Check if data item exists
        if (itemId && this.existingDataitemIds.has(itemId)) {
          // Update existing data item
          await this.dtDataitem.updateDataItem({
            dataItemId: itemId,
            name: itemData.name,
            description: itemData.description || '',
            classId: itemData.classData?.id
          })
          this.idMapping.set(itemId, itemId)
          this.processedDataitemIds.add(itemId)
          this.stats.updated++
        } else {
          // Create new data item
          const createdItem = await this.dtDataitem.createDataItem({
            name: itemData.name,
            description: itemData.description || '',
            elementId: this.defaultBoundaryId,
            classId: itemData.classData?.id,
            modelId: this.currentModelId
          })

          if (createdItem && itemData.id) {
            this.idMapping.set(itemData.id, createdItem.id)
            this.processedDataitemIds.add(createdItem.id)
            this.stats.created++
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

        // Check if boundary exists
        if (boundaryId && this.existingBoundaryIds.has(boundaryId)) {
          // Update existing boundary
          await this.updateBoundary(boundaryData, parentBoundaryId)
          this.idMapping.set(boundaryId, boundaryId)
          this.processedBoundaryIds.add(boundaryId)
          this.stats.updated++
        } else {
          // Create new boundary
          const created = await this.createBoundary(boundaryData, parentBoundaryId)
          if (created) {
            this.idMapping.set(boundaryData.id || '', created.id)
            this.processedBoundaryIds.add(created.id)
            this.stats.created++
          }
        }

        // Get the actual boundary ID (either updated or created)
        const actualBoundaryId = this.idMapping.get(boundaryId) || ''

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
          description: boundaryData.description || ''
        },
        parentNode: parentBoundaryId,
        width: boundaryData.dimensionsWidth || 0,
        height: boundaryData.dimensionsHeight || 0
      }

      await this.dtBoundary.updateBoundaryNode({
        updatedNode: boundaryNode,
        defaultBoundaryId: this.defaultBoundaryId
      })

      // Update class if provided
      if (boundaryData.classData?.id) {
        await this.dtBoundary.updateBoundaryClass({
          boundaryId,
          classId: boundaryData.classData.id
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
        defaultBoundaryId: this.defaultBoundaryId
      })

      if (createdBoundary && boundaryData.attributes && classId) {
        await this.setElementAttributes(
          createdBoundary.id,
          classId,
          boundaryData.attributes,
          boundaryData.name
        )
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
          description: componentData.description || ''
        },
        parentNode: parentBoundaryId
      }

      await this.dtComponent.updateComponent({
        updatedNode: componentNode,
        defaultBoundaryId: this.defaultBoundaryId
      })

      // Update class if provided
      if (componentData.classData?.id) {
        await this.dtComponent.updateComponentClass({
          componentId,
          classId: componentData.classData.id
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
          description: componentData.description || ''
        },
        parentNode: parentBoundaryId
      }

      const createdComponent = await this.dtComponent.createComponentNode({
        newNode: componentNode,
        classId,
        defaultBoundaryId: this.defaultBoundaryId
      })

      if (createdComponent && componentData.attributes && classId) {
        await this.setElementAttributes(
          createdComponent.id,
          classId,
          componentData.attributes,
          componentData.name
        )
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

      await this.dtDataflow.updateDataFlow({
        edge,
        updates: {
          name: flowData.name,
          description: flowData.description || ''
        }
      })

      // Update class if provided
      if (flowData.classData?.id) {
        await this.dtDataflow.updateDataFlowClass({
          dataFlowId: flowId,
          classId: flowData.classData.id
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
        this.warnings.push(
          `Failed to set attributes for element '${elementName}' (ID: ${elementId})`
        )
      }

    } catch (e) {
      this.warnings.push(
        `Error setting attributes for element '${elementName}' (ID: ${elementId}): ${(e as Error).message}`
      )
    }
  }
}
