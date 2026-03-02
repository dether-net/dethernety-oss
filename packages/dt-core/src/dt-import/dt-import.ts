import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { Model, ComponentData, BoundaryData, DataFlowData, DataItem, Module, Class, Control } from '../interfaces/core-types-interface.js'
import { DtModel } from '../dt-model/dt-model.js'
import { DtClass } from '../dt-class/dt-class.js'
import { DtComponent } from '../dt-component/dt-component.js'
import { DtBoundary } from '../dt-boundary/dt-boundary.js'
import { DtDataflow } from '../dt-dataflow/dt-dataflow.js'
import { DtDataItem } from '../dt-dataitem/dt-dataitem.js'
import { DtModule } from '../dt-module/dt-module.js'
import { DtControl } from '../dt-control/dt-control.js'

export interface ImportProgress {
  currentStep: number
  totalSteps: number
  stepName: string
  percentage: number
}

export interface ImportError {
  step: string
  elementName?: string
  elementId?: string
  error: string
  details?: any
}

export interface ImportResult {
  success: boolean
  model?: Model
  errors: ImportError[]
  warnings: string[]
  progress: ImportProgress
}

export interface ImportOptions {
  folderId?: string
  onProgress?: (progress: ImportProgress) => void
}

export class DtImport {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>
  private dtModel: DtModel
  private dtClass: DtClass
  private dtComponent: DtComponent
  private dtBoundary: DtBoundary
  private dtDataflow: DtDataflow
  private dtDataitem: DtDataItem
  private dtModule: DtModule
  private dtControl: DtControl

  // Internal state for import process
  private idMapping: Map<string, string> = new Map()
  private errors: ImportError[] = []
  private warnings: string[] = []
  private currentModelId: string = ''
  private defaultBoundaryId: string = ''
  private pendingControlAssociations: Array<{elementId: string, controls: any[], elementType: 'component' | 'boundary' | 'dataflow'}> = [] // kept for backwards compat; no longer used
  private progress: ImportProgress = {
    currentStep: 0,
    totalSteps: 8,
    stepName: 'Initializing',
    percentage: 0
  }
  private onProgress?: (progress: ImportProgress) => void

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

  /**
   * Import a model from JSON data
   * @param jsonData - The exported model data
   * @param options - Import options
   * @returns Promise with import result
   */
  importModel = async (jsonData: any, options: ImportOptions = {}): Promise<ImportResult> => {
    const mutexKey = `importModel_${Date.now()}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        // Reset state
        this.idMapping.clear()
        this.errors = []
        this.warnings = []
        this.currentModelId = ''
        this.defaultBoundaryId = ''
        this.progress = {
          currentStep: 0,
          totalSteps: 8,
          stepName: 'Initializing',
          percentage: 0
        }
        this.onProgress = options.onProgress

        this.updateProgress(1, 'Validating import data')

        // Step 1: Validate JSON structure
        const validationResult = this.validateImportData(jsonData)
        if (!validationResult.valid) {
          return {
            success: false,
            errors: [{ step: 'validation', error: validationResult.error || 'Invalid import data format' }],
            warnings: [],
            progress: this.progress
          }
        }

        this.updateProgress(2, 'Creating model')

        // Step 2: Create the new model
        const createdModel = await this.createModel(jsonData, options.folderId)
        if (!createdModel) {
          return {
            success: false,
            errors: this.errors,
            warnings: this.warnings,
            progress: this.progress
          }
        }
        
        // Store the created model ID for later use
        this.currentModelId = createdModel.id

        this.updateProgress(3, 'Setting up default boundary')

        // Step 3: Setup default boundary
        await this.setupDefaultBoundary(jsonData.defaultBoundary, createdModel.id)

        this.updateProgress(4, 'Creating data items')

        // Step 4: Create data items FIRST (before boundaries/components so they can be referenced)
        if (jsonData.dataItems && Array.isArray(jsonData.dataItems)) {
          await this.createDataItems(jsonData.dataItems, createdModel.id, jsonData)
        }

        this.updateProgress(5, 'Creating boundaries and components')

        // Step 5: Create boundaries and components recursively
        if (jsonData.defaultBoundary) {
          const defaultBoundaryId = this.idMapping.get(jsonData.defaultBoundary.id)
          if (defaultBoundaryId) {
            await this.processHierarchy(jsonData.defaultBoundary, defaultBoundaryId)
          }
        }

        this.updateProgress(6, 'Creating data flows')

        // Step 6: Create data flows
        if (jsonData.dataFlows && Array.isArray(jsonData.dataFlows)) {
          await this.createDataFlows(jsonData.dataFlows)
        }

        this.updateProgress(7, 'Associating data items with elements')

        // Step 7: Associate data items with their elements (now that all elements exist)
        if (jsonData.dataItems && Array.isArray(jsonData.dataItems)) {
          await this.associateDataItemsWithElements(jsonData)
        }

        this.updateProgress(8, 'Associating controls')

        // Step 7: Associate controls with elements (after all elements are created)
        await this.processControlAssociations()

        this.updateProgress(8, 'Import completed')

        return {
          success: this.errors.length === 0,
          model: createdModel,
          errors: this.errors,
          warnings: this.warnings,
          progress: this.progress
        }

      } catch (error) {
        this.dtUtils.handleError({ action: 'importModel', error })
        return {
          success: false,
          errors: [{ step: 'general', error: error instanceof Error ? error.message : 'Unknown error occurred' }],
          warnings: this.warnings,
          progress: this.progress
        }
      }
    })
  }

  private updateProgress = (step: number, stepName: string) => {
    this.progress = {
      currentStep: step,
      totalSteps: 8,
      stepName,
      percentage: Math.round((step / 8) * 100)
    }
    
    if (this.onProgress) {
      this.onProgress(this.progress)
    }
  }

  private validateImportData = (jsonData: any): { valid: boolean, error?: string } => {
    if (!jsonData || typeof jsonData !== 'object') {
      return { valid: false, error: 'Invalid JSON data' }
    }

    if (!jsonData.name || typeof jsonData.name !== 'string') {
      return { valid: false, error: 'Missing or invalid model name' }
    }

    if (!jsonData.defaultBoundary || typeof jsonData.defaultBoundary !== 'object') {
      return { valid: false, error: 'Missing or invalid default boundary' }
    }

    if (!jsonData.defaultBoundary.id || typeof jsonData.defaultBoundary.id !== 'string') {
      return { valid: false, error: 'Missing or invalid default boundary ID' }
    }

    return { valid: true }
  }

  private createModel = async (jsonData: any, folderId?: string): Promise<Model | null> => {
    try {
      // Resolve module IDs
      const moduleIds = await this.resolveModuleIds(jsonData.modules || [])
      
      // If no modules found, try to get default module
      if (moduleIds.length === 0) {
        const modules = await this.dtModule.getModules()
        if (modules.length > 0) {
          moduleIds.push(modules[0].id)
          this.warnings.push('No matching modules found, using default module')
        }
      }

      const model = await this.dtModel.createModel({
        name: jsonData.name,
        description: jsonData.description || '',
        modules: moduleIds,
        folderId: folderId || undefined
      })

      if (model) {
        return model
      } else {
        this.errors.push({ step: 'model_creation', error: 'Failed to create model' })
        return null
      }
    } catch (error) {
      this.errors.push({ 
        step: 'model_creation', 
        error: error instanceof Error ? error.message : 'Unknown error creating model' 
      })
      return null
    }
  }

  private resolveModuleIds = async (modules: any[]): Promise<string[]> => {
    const moduleIds: string[] = []
    const availableModules = await this.dtModule.getModules()

    for (const moduleData of modules) {
      // Priority 1: Match by ID
      if (moduleData.id) {
        const existingModule = availableModules.find(m => m.id === moduleData.id)
        if (existingModule) {
          moduleIds.push(existingModule.id)
          continue
        }
      }

      // Priority 2: Match by name
      if (moduleData.name) {
        const existingModule = availableModules.find(m => m.name === moduleData.name)
        if (existingModule) {
          moduleIds.push(existingModule.id)
          continue
        }
      }

      this.warnings.push(`Could not find module: ${moduleData.name || moduleData.id || 'unnamed'}`)
    }

    return moduleIds
  }

  private setupDefaultBoundary = async (boundaryData: any, modelId: string): Promise<void> => {
    try {
      // Get the default boundary created with the model
      const modelData = await this.dtModel.dumpModelData({ modelId })
      if (!modelData || !modelData.defaultBoundary) {
        this.errors.push({ step: 'default_boundary_setup', error: 'No default boundary found in created model' })
        return
      }

      const defaultBoundaryId = modelData.defaultBoundary.id
      this.defaultBoundaryId = defaultBoundaryId
      this.idMapping.set(boundaryData.id, defaultBoundaryId)

      // Update the default boundary with imported data
      const updatedNode = {
        id: defaultBoundaryId,
        type: 'BOUNDARY',
        data: {
          label: boundaryData.name,
          description: boundaryData.description || '',
          controls: [],
          dataItems: [],
          minWidth: boundaryData.dimensionsMinWidth || 200,
          minHeight: boundaryData.dimensionsMinHeight || 150
        },
        position: {
          x: boundaryData.positionX || 0,
          y: boundaryData.positionY || 0
        },
        width: boundaryData.dimensionsWidth || 800,
        height: boundaryData.dimensionsHeight || 600,
        parentNode: undefined // Default boundary has no parent
      }
      
      await this.dtBoundary.updateBoundaryNode({
        updatedNode,
        defaultBoundaryId
      })

      // Set class and attributes for default boundary if available
      if (boundaryData.classData) {
        const classId = await this.resolveBoundaryClass(boundaryData.classData)
        if (classId) {
          try {
            // First set the class
            const success = await this.dtBoundary.updateBoundaryClass({
              boundaryId: defaultBoundaryId,
              classId
            })
            if (success) {
              // Then set attributes if available
              if (boundaryData.attributes) {
                await this.dtClass.setInstantiationAttributes({
                  componentId: defaultBoundaryId,
                  classId,
                  attributes: boundaryData.attributes
                })
              }
            } else {
              this.warnings.push(`Failed to set class for default boundary`)
            }
          } catch (error) {
            this.warnings.push(`Could not set class for default boundary: ${error}`)
          }
        }
      }

      // Set controls if available
      await this.setElementControls(defaultBoundaryId, boundaryData.controls || [])

      // Handle represented model if present
      if (boundaryData.representedModel?.id) {
        try {
          const representedModel = await this.dtModel.getModel({ modelId: boundaryData.representedModel.id })
          if (representedModel) {
            const success = await this.dtBoundary.updateBoundaryRepresentedModel({
              boundaryId: defaultBoundaryId,
              modelId: boundaryData.representedModel.id
            })
            if (!success) {
              this.warnings.push(`Failed to set represented model for default boundary`)
            }
          } else {
            this.warnings.push(`Represented model ${boundaryData.representedModel.id} not found for default boundary`)
          }
        } catch (error) {
          this.warnings.push(`Could not set represented model for default boundary: ${error}`)
        }
      }

    } catch (error) {
      this.errors.push({
        step: 'default_boundary_setup',
        error: error instanceof Error ? error.message : 'Unknown error setting up default boundary'
      })
    }
  }

  private processHierarchy = async (element: any, parentBoundaryId: string): Promise<void> => {
    // Process child components
    if (element.components && Array.isArray(element.components)) {
      for (const component of element.components) {
        await this.createComponent(component, parentBoundaryId)
      }
    }

    // Process child boundaries
    if (element.boundaries && Array.isArray(element.boundaries)) {
      for (const boundary of element.boundaries) {
        const newBoundaryId = await this.createBoundary(boundary, parentBoundaryId)
        if (newBoundaryId) {
          await this.processHierarchy(boundary, newBoundaryId)
        }
      }
    }
  }

  private createComponent = async (componentData: any, parentBoundaryId: string): Promise<string | null> => {
    try {
      // Create a Vue Flow node structure
      const newNode = {
        id: `temp-${Math.random().toString(36).substring(2, 11)}`,
        type: componentData.type,
        position: {
          x: componentData.positionX || 0,
          y: componentData.positionY || 0,
        },
        data: {
          label: componentData.name,
          description: componentData.description || '',
          controls: [],
          dataItems: [],
        },
        parentNode: parentBoundaryId,
      }

      const classId = await this.resolveComponentClass(componentData.classData)

      // Create component with class assigned at creation time
      // This ensures the IS_INSTANCE_OF relationship is properly established
      // (required by setInstantiationAttributes on the backend)
      const newComponent = await this.dtComponent.createComponentNode({
        newNode,
        classId: classId || '',
        defaultBoundaryId: parentBoundaryId
      })

      if (!newComponent) {
        this.errors.push({
          step: 'component_creation',
          elementName: componentData.name,
          error: 'Failed to create component'
        })
        return null
      }

      this.idMapping.set(componentData.id, newComponent.id)

      // Set attributes after creation (class was already assigned during creation)
      if (classId && componentData.attributes) {
        try {
          await this.dtClass.setInstantiationAttributes({
            componentId: newComponent.id,
            classId,
            attributes: componentData.attributes
          })
        } catch (error) {
          this.warnings.push(`Could not set attributes for component ${componentData.name}: ${error}`)
        }
      }

      // Set controls directly (same pattern as boundaries and dataflows)
      await this.setElementControlsDirect(newComponent.id, componentData.controls || [], 'component', {
        type: componentData.type,
        name: componentData.name,
        description: componentData.description,
        positionX: componentData.positionX,
        positionY: componentData.positionY,
        parentBoundaryId: parentBoundaryId
      })

      // Handle represented model if present
      if (componentData.representedModel?.id) {
        try {
          const representedModel = await this.dtModel.getModel({ modelId: componentData.representedModel.id })
          if (representedModel) {
            const success = await this.dtComponent.updateComponentRepresentedModel({
              componentId: newComponent.id,
              modelId: componentData.representedModel.id
            })
            if (!success) {
              this.warnings.push(`Failed to set represented model for component ${componentData.name}`)
            }
          } else {
            this.warnings.push(`Represented model ${componentData.representedModel.id} not found for component ${componentData.name}`)
          }
        } catch (error) {
          this.warnings.push(`Could not set represented model for component ${componentData.name}: ${error}`)
        }
      }

      return newComponent.id

    } catch (error) {
      this.errors.push({
        step: 'component_creation',
        elementName: componentData.name,
        error: error instanceof Error ? error.message : 'Unknown error creating component'
      })
      return null
    }
  }

  private createBoundary = async (boundaryData: any, parentBoundaryId: string): Promise<string | null> => {
    try {
      // Create a Vue Flow node structure
      const newNode = {
        id: `temp-${Math.random().toString(36).substring(2, 11)}`,
        type: 'BOUNDARY',
        position: {
          x: boundaryData.positionX || 0,
          y: boundaryData.positionY || 0,
        },
        data: {
          label: boundaryData.name,
          description: boundaryData.description || '',
          controls: [],
          dataItems: [],
          minWidth: boundaryData.dimensionsMinWidth || 200,
          minHeight: boundaryData.dimensionsMinHeight || 150,
        },
        width: boundaryData.dimensionsWidth || 400,
        height: boundaryData.dimensionsHeight || 300,
        parentNode: parentBoundaryId,
      }

      const classId = await this.resolveBoundaryClass(boundaryData.classData)

      // Create boundary with class assigned at creation time
      const newBoundary = await this.dtBoundary.createBoundaryNode({
        newNode,
        classId: classId || '',
        defaultBoundaryId: parentBoundaryId
      })

      if (!newBoundary) {
        this.errors.push({
          step: 'boundary_creation',
          elementName: boundaryData.name,
          error: 'Failed to create boundary'
        })
        return null
      }

      this.idMapping.set(boundaryData.id, newBoundary.id)

      // Set attributes after creation (class was already assigned during creation)
      if (classId && boundaryData.attributes) {
        try {
          await this.dtClass.setInstantiationAttributes({
            componentId: newBoundary.id,
            classId,
            attributes: boundaryData.attributes
          })
        } catch (error) {
          this.warnings.push(`Could not set attributes for boundary ${boundaryData.name}: ${error}`)
        }
      }

      // Set controls
      await this.setElementControlsDirect(newBoundary.id, boundaryData.controls || [], 'boundary', {
        type: 'TRUST_BOUNDARY',
        name: boundaryData.name,
        description: boundaryData.description,
        positionX: boundaryData.positionX,
        positionY: boundaryData.positionY,
        width: boundaryData.dimensionsWidth,
        height: boundaryData.dimensionsHeight,
        parentBoundaryId: parentBoundaryId
      })

      // Handle represented model if present
      if (boundaryData.representedModel?.id) {
        try {
          const representedModel = await this.dtModel.getModel({ modelId: boundaryData.representedModel.id })
          if (representedModel) {
            const success = await this.dtBoundary.updateBoundaryRepresentedModel({
              boundaryId: newBoundary.id,
              modelId: boundaryData.representedModel.id
            })
            if (!success) {
              this.warnings.push(`Failed to set represented model for boundary ${boundaryData.name}`)
            }
          } else {
            this.warnings.push(`Represented model ${boundaryData.representedModel.id} not found for boundary ${boundaryData.name}`)
          }
        } catch (error) {
          this.warnings.push(`Could not set represented model for boundary ${boundaryData.name}: ${error}`)
        }
      }

      return newBoundary.id

    } catch (error) {
      this.errors.push({
        step: 'boundary_creation',
        elementName: boundaryData.name,
        error: error instanceof Error ? error.message : 'Unknown error creating boundary'
      })
      return null
    }
  }

  private createDataFlows = async (dataFlows: any[]): Promise<void> => {
    for (const dataFlowData of dataFlows) {
      try {
        const sourceId = this.idMapping.get(dataFlowData.source.id)
        const targetId = this.idMapping.get(dataFlowData.target.id)

        if (!sourceId || !targetId) {
          this.warnings.push(`Could not map source or target for data flow ${dataFlowData.name}`)
          continue
        }

        // Create a Vue Flow edge structure
        const newEdge = {
          id: `temp-${Math.random().toString(36).substring(2, 11)}`,
          source: sourceId,
          target: targetId,
          sourceHandle: dataFlowData.sourceHandle,
          targetHandle: dataFlowData.targetHandle,
          label: dataFlowData.name,
          data: {
            description: dataFlowData.description || '',
            controls: [],
            dataItems: [],
          },
          markerEnd: 'arrowclosed',
        }

        const classId = await this.resolveDataFlowClass(dataFlowData.classData)

        // Create data flow with class assigned at creation time
        const newDataFlow = await this.dtDataflow.createDataFlow({
          newEdge,
          classId: classId || ''
        })

        if (!newDataFlow) {
          this.errors.push({
            step: 'dataflow_creation',
            elementName: dataFlowData.name,
            error: 'Failed to create data flow'
          })
          continue
        }

        this.idMapping.set(dataFlowData.id, newDataFlow.id)

        // Set attributes after creation (class was already assigned during creation)
        if (classId && dataFlowData.attributes) {
          try {
            await this.dtClass.setInstantiationAttributes({
              componentId: newDataFlow.id,
              classId,
              attributes: dataFlowData.attributes
            })
          } catch (error) {
            this.warnings.push(`Could not set attributes for data flow ${dataFlowData.name}: ${error}`)
          }
        }

        // Set controls
        await this.setElementControlsDirect(newDataFlow.id, dataFlowData.controls || [], 'dataflow', {
          name: dataFlowData.name,
          description: dataFlowData.description,
          sourceId: newEdge.source,
          targetId: newEdge.target
        })

      } catch (error) {
        this.errors.push({
          step: 'dataflow_creation',
          elementName: dataFlowData.name,
          error: error instanceof Error ? error.message : 'Unknown error creating data flow'
        })
      }
    }
  }

  private createDataItems = async (dataItems: any[], modelId: string, _importData: any): Promise<void> => {
    for (const dataItemData of dataItems) {
      try {
        const classId = await this.resolveDataClass(dataItemData.classData)

        // Create the data item with the model as the primary element
        // Data items are created BEFORE boundaries/components, so we use model as initial element
        // The actual associations will be made when elements are created (they reference data items)
        const newDataItem = await this.dtDataitem.createDataItem({
          name: dataItemData.name,
          description: dataItemData.description || '',
          elementId: modelId, // Always use model as primary element initially
          classId: classId || null,
          modelId: modelId
        })

        if (!newDataItem) {
          this.errors.push({
            step: 'dataitem_creation',
            elementName: dataItemData.name,
            error: 'Failed to create data item'
          })
          continue
        }

        this.idMapping.set(dataItemData.id, newDataItem.id)

        // Set attributes if available
        if (dataItemData.attributes && classId) {
          try {
            await this.dtClass.setInstantiationAttributes({
              componentId: newDataItem.id,
              classId,
              attributes: dataItemData.attributes
            })
          } catch (error) {
            this.warnings.push(`Could not set attributes for data item ${dataItemData.name}: ${error}`)
          }
        }

      } catch (error) {
        this.errors.push({
          step: 'dataitem_creation',
          elementName: dataItemData.name,
          error: error instanceof Error ? error.message : 'Unknown error creating data item'
        })
      }
    }
    // Note: Data item associations with elements are handled when elements are created
    // because data items are now created BEFORE boundaries/components
  }

  private associateDataItemsWithElements = async (importData: any): Promise<void> => {
    // Process default boundary and its hierarchy
    if (importData.defaultBoundary) {
      await this.processElementForDataItemAssociation(importData.defaultBoundary)
    }

    // Process data flows
    if (importData.dataFlows && Array.isArray(importData.dataFlows)) {
      for (const dataFlow of importData.dataFlows) {
        // Check both dataItemIds (old format) and dataItems (new format)
        const dataItemIds = dataFlow.dataItemIds || dataFlow.dataItems?.map((di: any) => di.id) || []
        if (Array.isArray(dataItemIds) && dataItemIds.length > 0) {
          const newDataFlowId = this.idMapping.get(dataFlow.id)
          if (newDataFlowId) {
            const mappedDataItemIds = dataItemIds
              .map((id: string) => this.idMapping.get(id))
              .filter((id: string | undefined) => id !== undefined)
            
            if (mappedDataItemIds.length > 0) {
              try {
                // Get the current data flow to preserve existing data
                const sourceId = this.idMapping.get(dataFlow.source?.id) || ''
                const targetId = this.idMapping.get(dataFlow.target?.id) || ''
                
                // Create a minimal edge structure for update - just what's needed
                const currentEdge = {
                  id: newDataFlowId,
                  source: sourceId,
                  target: targetId,
                  sourceHandle: dataFlow.sourceHandle,
                  targetHandle: dataFlow.targetHandle,
                  label: dataFlow.name,
                  data: {
                    description: dataFlow.description || '',
                    controls: [], // Controls were set separately
                    dataItems: [], // Start with empty, will be updated
                  },
                  markerEnd: 'arrowclosed',
                }

                // The updates to apply
                const updates = {
                  data: {
                    dataItems: mappedDataItemIds,
                  }
                }

                await this.dtDataflow.updateDataFlow({
                  edge: currentEdge,
                  updates: updates
                })
              } catch (error) {
                this.warnings.push(`Could not associate data items with data flow ${dataFlow.name}: ${error}`)
              }
            }
          }
        }
      }
    }
  }

  private processElementForDataItemAssociation = async (element: any): Promise<void> => {
    // Process current element's data items
    // Check both dataItemIds (old format) and dataItems (new format)
    const dataItemIds = element.dataItemIds || element.dataItems?.map((di: any) => di.id) || []
    if (Array.isArray(dataItemIds) && dataItemIds.length > 0) {
      const newElementId = this.idMapping.get(element.id)
      if (newElementId) {
        const mappedDataItemIds = dataItemIds
          .map((id: string) => this.idMapping.get(id))
          .filter((id: string | undefined) => id !== undefined)
        
        if (mappedDataItemIds.length > 0) {
          try {
            if (element.type === 'BOUNDARY' || !element.type) { // Default boundary has no type
              // Update boundary with data items using a simpler approach
              const updatedNode = {
                id: newElementId,
                type: 'BOUNDARY',
                data: {
                  label: element.name,
                  description: element.description || '',
                  controls: [], // Controls were set separately
                  dataItems: mappedDataItemIds,
                  minWidth: element.dimensionsMinWidth || 200,
                  minHeight: element.dimensionsMinHeight || 150,
                },
                position: {
                  x: element.positionX || 0,
                  y: element.positionY || 0,
                },
                width: element.dimensionsWidth || 400,
                height: element.dimensionsHeight || 300,
                parentNode: element.parentBoundary?.id ? this.idMapping.get(element.parentBoundary.id) : undefined,
              }

              await this.dtBoundary.updateBoundaryNode({
                updatedNode,
                defaultBoundaryId: this.findDefaultBoundaryId()
              })
            } else {
              // Update component with data items
              const updatedNode = {
                id: newElementId,
                type: element.type,
                data: {
                  label: element.name,
                  description: element.description || '',
                  controls: [], // Controls were set separately
                  dataItems: mappedDataItemIds,
                },
                position: {
                  x: element.positionX || 0,
                  y: element.positionY || 0,
                },
                parentNode: element.parentBoundary?.id ? this.idMapping.get(element.parentBoundary.id) || this.findDefaultBoundaryId() : this.findDefaultBoundaryId(),
              }

              await this.dtComponent.updateComponent({
                updatedNode,
                defaultBoundaryId: this.findDefaultBoundaryId()
              })
            }
          } catch (error) {
            this.warnings.push(`Could not associate data items with element ${element.name}: ${error}`)
          }
        }
      }
    }

    // Process child components
    if (element.components && Array.isArray(element.components)) {
      for (const component of element.components) {
        await this.processElementForDataItemAssociation(component)
      }
    }

    // Process child boundaries
    if (element.boundaries && Array.isArray(element.boundaries)) {
      for (const boundary of element.boundaries) {
        await this.processElementForDataItemAssociation(boundary)
      }
    }
  }

  private findDefaultBoundaryId = (): string => {
    return this.defaultBoundaryId
  }

  private getCurrentModelId = (): string => {
    return this.currentModelId
  }


  private resolveComponentClass = async (classData: any): Promise<string | null> => {
    return this.resolveClass(classData, 'COMPONENT')
  }

  private resolveBoundaryClass = async (classData: any): Promise<string | null> => {
    return this.resolveClass(classData, 'BOUNDARY')
  }

  private resolveDataFlowClass = async (classData: any): Promise<string | null> => {
    return this.resolveClass(classData, 'DATA_FLOW')
  }

  private resolveDataClass = async (classData: any): Promise<string | null> => {
    return this.resolveClass(classData, 'DATA')
  }

  private resolveClass = async (classData: any, entityType: string): Promise<string | null> => {
    if (!classData) return null

    try {

      // Priority 1: Match by ID
      if (classData.id) {
        // Try to verify the class exists by checking all modules
        try {
          const modules = await this.dtModule.getModules()

          
          for (const module of modules) {
            let classFound = null
            
            switch (entityType) {
              case 'COMPONENT':
                if (module.componentClasses) {
                  classFound = module.componentClasses.find(c => c.id === classData.id)
                }
                break
              case 'BOUNDARY':
                if (module.securityBoundaryClasses) {
                  classFound = module.securityBoundaryClasses.find(c => c.id === classData.id)
                }
                break
              case 'DATA_FLOW':
                if (module.dataFlowClasses) {
                  classFound = module.dataFlowClasses.find(c => c.id === classData.id)
                }
                break
              case 'DATA':
                if (module.dataClasses) {
                  classFound = module.dataClasses.find(c => c.id === classData.id)
                }
                break
            }
            
            if (classFound) {
              return classData.id
            }
          }
        } catch (error) {
          // Class doesn't exist, continue to name-based matching
        }
      }

      // Priority 2: Match by module ID and class name
      if (classData.module?.id && classData.name) {
        const modules = await this.dtModule.getModules()
        const matchingModule = modules.find(m => m.id === classData.module.id)
        
        if (matchingModule) {
          const matchingClass = await this.findClassInModule(matchingModule, classData.name, entityType)
          if (matchingClass) {
            return matchingClass.id
          }
        }
      }

      // Priority 3: Match by module name and class name
      if (classData.module?.name && classData.name) {
        const modules = await this.dtModule.getModules()
        const matchingModule = modules.find(m => m.name === classData.module.name)
        
        if (matchingModule) {
          const matchingClass = await this.findClassInModule(matchingModule, classData.name, entityType)
          if (matchingClass) {
            return matchingClass.id
          }
        }
      }

      return null

    } catch (error) {
      this.warnings.push(`Could not resolve ${entityType.toLowerCase()} class ${classData.name || classData.id}: ${error}`)
      return null
    }
  }

  private findClassInModule = async (module: Module, className: string, entityType: string): Promise<Class | null> => {
    try {
      switch (entityType) {
        case 'COMPONENT':
          if (module.componentClasses) {
            return module.componentClasses.find(c => c.name === className) || null
          }
          break
        case 'BOUNDARY':
          if (module.securityBoundaryClasses) {
            return module.securityBoundaryClasses.find(c => c.name === className) || null
          }
          break
        case 'DATA_FLOW':
          if (module.dataFlowClasses) {
            return module.dataFlowClasses.find(c => c.name === className) || null
          }
          break
        case 'DATA':
          if (module.dataClasses) {
            return module.dataClasses.find(c => c.name === className) || null
          }
          break
      }
      return null
    } catch (error) {
      return null
    }
  }

  private setElementControls = async (elementId: string, controls: any[]): Promise<void> => {
    if (!controls || !Array.isArray(controls) || controls.length === 0) {
      return
    }

    try {
      const resolvedControlIds = await this.resolveControls(controls)
      if (resolvedControlIds.length > 0) {
        await this.associateControlsWithElement(elementId, resolvedControlIds)
      }
    } catch (error) {
      this.warnings.push(`Could not set controls for element: ${error}`)
    }
  }

  private setElementControlsDirect = async (elementId: string, controls: any[], elementType: 'component' | 'boundary' | 'dataflow', elementData: any): Promise<void> => {
    if (!controls || !Array.isArray(controls) || controls.length === 0) {
      return
    }

    try {
      const resolvedControlIds = await this.resolveControls(controls)

      if (resolvedControlIds.length > 0) {
        await this.associateControlsDirectly(elementId, resolvedControlIds, elementType, elementData)
      }
    } catch (error) {
      this.warnings.push(`Could not set controls for element: ${error}`)
    }
  }

  private associateControlsDirectly = async (elementId: string, controlIds: string[], elementType: 'component' | 'boundary' | 'dataflow', elementData: any): Promise<void> => {
    try {
      switch (elementType) {
        case 'component':
          const updatedComponentNode = {
            id: elementId,
            type: elementData.type,
            data: {
              label: elementData.name,
              description: elementData.description || '',
              controls: controlIds, // Array of control ID strings
              dataItems: [], // Will be set later during data item association
            },
            position: {
              x: elementData.positionX || 0,
              y: elementData.positionY || 0,
            },
            parentNode: elementData.parentBoundaryId,
          }

          await this.dtComponent.updateComponent({
            updatedNode: updatedComponentNode,
            defaultBoundaryId: this.defaultBoundaryId
          })
          break

        case 'boundary':
          const updatedBoundaryNode = {
            id: elementId,
            type: 'TRUST_BOUNDARY',
            data: {
              label: elementData.name,
              description: elementData.description || '',
              controls: controlIds,
              dataItems: [], // Will be set later during data item association
            },
            position: {
              x: elementData.positionX || 0,
              y: elementData.positionY || 0,
            },
            width: elementData.width || 400,
            height: elementData.height || 300,
            parentNode: elementData.parentBoundaryId,
          }

          await this.dtBoundary.updateBoundaryNode({
            updatedNode: updatedBoundaryNode,
            defaultBoundaryId: this.defaultBoundaryId
          })
          break

        case 'dataflow':
          const dataFlowEdge = {
            id: elementId,
            source: elementData.sourceId,
            target: elementData.targetId,
            data: {
              label: elementData.name,
              description: elementData.description || '',
              controls: controlIds,
              dataItems: [] // Will be set later during data item association
            }
          }
          
          await this.dtDataflow.updateDataFlow({
            edge: dataFlowEdge,
            updates: {
              name: elementData.name,
              description: elementData.description || '',
              controls: controlIds
            }
          })
          break
      }
    } catch (error) {
      throw error
    }
  }

  private associateControlsWithElement = async (elementId: string, controlIds: string[]): Promise<void> => {
    try {
      // dumpModelData returns flat Vue Flow arrays (components: Node[], boundaries: Node[], dataFlows: Edge[])
      const modelData = await this.dtModel.dumpModelData({ modelId: this.getCurrentModelId() })
      if (!modelData) return

      const defaultBoundaryId = modelData.defaultBoundary?.id || ''

      // Search flat components array
      const component = modelData.components?.find((c: any) => c.id === elementId)
      if (component) {
        const updatedNode = {
          id: elementId,
          type: component.type,
          data: {
            label: component.data.label,
            description: component.data.description || '',
            controls: controlIds,
            dataItems: component.data.dataItems || [],
          },
          position: {
            x: component.position?.x || 0,
            y: component.position?.y || 0,
          },
          parentNode: component.parentNode || defaultBoundaryId,
        }

        await this.dtComponent.updateComponent({
          updatedNode,
          defaultBoundaryId
        })
        return
      }

      // Search flat boundaries array
      const boundary = modelData.boundaries?.find((b: any) => b.id === elementId)
      if (boundary) {
        const updatedNode = {
          id: elementId,
          type: 'BOUNDARY',
          data: {
            label: boundary.data.label,
            description: boundary.data.description || '',
            controls: controlIds,
            dataItems: boundary.data.dataItems || [],
            minWidth: boundary.data.minWidth || 200,
            minHeight: boundary.data.minHeight || 150,
          },
          position: {
            x: boundary.position?.x || 0,
            y: boundary.position?.y || 0,
          },
          width: boundary.width || 400,
          height: boundary.height || 300,
          parentNode: boundary.parentNode || undefined,
        }

        await this.dtBoundary.updateBoundaryNode({
          updatedNode,
          defaultBoundaryId
        })
        return
      }

      // Check if it's the default boundary itself
      if (modelData.defaultBoundary?.id === elementId) {
        const db = modelData.defaultBoundary
        const updatedNode = {
          id: elementId,
          type: 'BOUNDARY',
          data: {
            label: db.data.label,
            description: db.data.description || '',
            controls: controlIds,
            dataItems: db.data.dataItems || [],
          },
          position: db.position || { x: 0, y: 0 },
          parentNode: undefined,
        }

        await this.dtBoundary.updateBoundaryNode({
          updatedNode,
          defaultBoundaryId
        })
        return
      }

      // Search flat data flows array
      const dataFlow = modelData.dataFlows?.find((df: any) => df.id === elementId)
      if (dataFlow) {
        const updatedEdge = {
          id: elementId,
          source: dataFlow.source || '',
          target: dataFlow.target || '',
          sourceHandle: dataFlow.sourceHandle,
          targetHandle: dataFlow.targetHandle,
          label: dataFlow.label,
          data: {
            description: dataFlow.data?.description || '',
            controls: controlIds,
            dataItems: dataFlow.data?.dataItems || [],
          },
          markerEnd: 'arrowclosed',
        }

        await this.dtDataflow.updateDataFlow({
          edge: updatedEdge,
          updates: {}
        })
        return
      }

      throw new Error(`Element ${elementId} not found`)
    } catch (error) {
      throw error
    }
  }

  private processControlAssociations = async (): Promise<void> => {
    for (const association of this.pendingControlAssociations) {
      try {
        await this.setControlsAfterCreation(association.elementId, association.controls, association.elementType)
      } catch (error) {
        this.warnings.push(`Could not associate controls with ${association.elementType}: ${error}`)
      }
    }
  }

  private setControlsAfterCreation = async (elementId: string, controls: any[], elementType: 'component' | 'boundary' | 'dataflow'): Promise<void> => {
    try {
      const resolvedControlIds = await this.resolveControls(controls)
      if (resolvedControlIds.length === 0) {
        return
      }

      // Fetch current server state and update only controls, preserving all other properties
      await this.associateControlsWithElement(elementId, resolvedControlIds)
    } catch (error) {
      this.warnings.push(`Could not set controls for ${elementType}: ${error}`)
    }
  }

  private resolveControls = async (controls: any[]): Promise<string[]> => {
    const controlIds: string[] = []
    
    // Try to get controls from all folders (including no folder)
    let availableControls: any[] = []
    
    try {
      // Get controls with no folder
      const noFolderControls = await this.dtControl.getControls({ folderId: undefined })
      availableControls.push(...noFolderControls)
    } catch (error) {
      // Silently continue
    }
    
    try {
      // Get all controls (from all folders)
      const allControls = await this.dtControl.getControls({ folderId: 'all' })
      // Add controls that aren't already in the list
      for (const control of allControls) {
        if (!availableControls.find(c => c.id === control.id)) {
          availableControls.push(control)
        }
      }
    } catch (error) {
      // Silently continue
    }

    for (const controlData of controls) {
      // Priority 1: Match by ID
      if (controlData.id) {
        const existingControl = availableControls.find(c => c.id === controlData.id)
        if (existingControl) {
          controlIds.push(existingControl.id)
          continue
        }
      }

      // Priority 2: Match by name (exact)
      if (controlData.name) {
        const existingControl = availableControls.find(c => c.name === controlData.name)
        if (existingControl) {
          controlIds.push(existingControl.id)
          continue
        }
      }

      // Priority 3: Match by name (case-insensitive)
      if (controlData.name) {
        const existingControl = availableControls.find(c => 
          c.name.toLowerCase() === controlData.name.toLowerCase()
        )
        if (existingControl) {
          controlIds.push(existingControl.id)
          continue
        }
      }

      // Priority 4: Match by partial name (case-insensitive)
      if (controlData.name) {
        const existingControl = availableControls.find(c => 
          c.name.toLowerCase().includes(controlData.name.toLowerCase()) ||
          controlData.name.toLowerCase().includes(c.name.toLowerCase())
        )
        if (existingControl) {
          controlIds.push(existingControl.id)
          continue
        }
      }

      this.warnings.push(`Could not find control: ${controlData.name || controlData.id || 'unnamed'}`)
    }

    return controlIds
  }
}
