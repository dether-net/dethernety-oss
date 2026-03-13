import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { Model, ComponentData, BoundaryData, DataFlowData, DataItem, Module, Class } from '../interfaces/core-types-interface.js'
import { DtModel } from '../dt-model/dt-model.js'
import { DtClass } from '../dt-class/dt-class.js'
import { DtComponent } from '../dt-component/dt-component.js'
import { DtBoundary } from '../dt-boundary/dt-boundary.js'
import { DtDataflow } from '../dt-dataflow/dt-dataflow.js'

export interface ExportedDataItem extends Omit<DataItem, 'dataClass' | 'elements'> {
  classData?: Pick<Class, 'id' | 'name'>
  attributes?: any
}

export interface ExportedDataFlow extends Omit<DataFlowData, '__typename'> {
  dataItemIds?: string[]
  classData?: Pick<Class, 'id' | 'name'>
  attributes?: any
}

export interface ExportedComponent extends Omit<ComponentData, '__typename'> {
  dataItemIds?: string[]
  classData?: Pick<Class, 'id' | 'name'>
  attributes?: any
  representedModel?: Omit<Model, '__typename'> | null
}

export interface ExportedBoundary extends Omit<BoundaryData, '__typename'> {
  dataItemIds?: string[]
  components?: ExportedComponent[]
  boundaries?: ExportedBoundary[]
  classData?: Pick<Class, 'id' | 'name'>
  attributes?: any
  representedModel?: Omit<Model, '__typename'> | null
}

export interface ExportedModel extends Omit<Model, '__typename'> {
  defaultBoundary?: ExportedBoundary
  dataFlows?: ExportedDataFlow[]
  dataItems?: ExportedDataItem[]
  modules?: Module[]
}

export class DtExport {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient
  private dtModel: DtModel
  private dtClass: DtClass
  private dtComponent: DtComponent
  private dtBoundary: DtBoundary
  private dtDataflow: DtDataflow

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
    this.dtModel = new DtModel(apolloClient)
    this.dtClass = new DtClass(apolloClient)
    this.dtComponent = new DtComponent(apolloClient)
    this.dtBoundary = new DtBoundary(apolloClient)
    this.dtDataflow = new DtDataflow(apolloClient)
  }

  /**
   * Export a model to JSON format
   * @param modelId - The ID of the model to export
   * @returns The exported model data
   */
  exportModel = async (modelId: string): Promise<ExportedModel> => {
    const mutexKey = `exportModel_${modelId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        // Get the raw model data
        const modelData = await this.dtModel.getModelData({ modelId })
        if (!modelData) {
          throw new Error(`Model with ID ${modelId} not found`)
        }

        // Build the exported model structure
        const exportedModel: ExportedModel = {
          id: modelData.id,
          name: modelData.name,
          description: modelData.description,
        }

        // Process data items first (needed for references)
        const dataItemsMap = new Map<string, ExportedDataItem>()
        if (modelData.dataItems) {
          for (const dataItem of modelData.dataItems) {
            const enrichedItem = await this.enrichDataItem(dataItem)
            dataItemsMap.set(dataItem.id, enrichedItem)
          }
        }
        exportedModel.dataItems = Array.from(dataItemsMap.values())

        // Process default boundary and its contents
        if (modelData.defaultBoundary) {
          const allComponents = modelData.defaultBoundary.allDescendantComponents || []
          const allBoundaries = modelData.defaultBoundary.allDescendantBoundaries || []
          const allDataFlows = modelData.defaultBoundary.allDescendantDataFlows || []

          exportedModel.defaultBoundary = await this.enrichBoundary(
            modelData.defaultBoundary,
            allBoundaries,
            allComponents,
            Array.from(dataItemsMap.values())
          )

          // Remove computed properties from default boundary
          if (exportedModel.defaultBoundary) {
            this.cleanBoundary(exportedModel.defaultBoundary)
          }

          // Process data flows
          const enrichedDataFlows: ExportedDataFlow[] = []
          for (const dataFlow of allDataFlows) {
            const enrichedFlow = await this.enrichDataFlow(dataFlow, Array.from(dataItemsMap.values()))
            enrichedDataFlows.push(enrichedFlow)
          }
          exportedModel.dataFlows = enrichedDataFlows
        }

        // Process modules (simplified)
        if (modelData.modules) {
          exportedModel.modules = modelData.modules.map((module: Module) => ({
            id: module.id,
            name: module.name,
            description: module.description,
          }))
        }

        return this.removeTypenames(exportedModel)
      } catch (error) {
        this.dtUtils.handleError({ action: 'exportModel', error })
        throw error
      }
    })
  }

  /**
   * Export a model to JSON string format
   * @param modelId - The ID of the model to export
   * @param indent - JSON indentation level (default: 2)
   * @returns JSON string representation of the exported model
   */
  exportModelToJson = async (modelId: string, indent: number = 2): Promise<string> => {
    try {
      const exportedModel = await this.exportModel(modelId)
      return JSON.stringify(exportedModel, null, indent)
    } catch (error) {
      this.dtUtils.handleError({ action: 'exportModelToJson', error })
      throw error
    }
  }

  /**
   * Export a model to a JSON file (Node.js only)
   * @param modelId - The ID of the model to export
   * @param filePath - Path to the output JSON file
   * @param indent - JSON indentation level (default: 2)
   */
  exportModelToFile = async (modelId: string, filePath: string, indent: number = 2): Promise<void> => {
    try {
      const jsonString = await this.exportModelToJson(modelId, indent)
      // Dynamic import for Node.js fs module
      // This will fail in browser environments, which is expected
      const { writeFile } = await import('fs/promises')
      await writeFile(filePath, jsonString, 'utf-8')
    } catch (error) {
      this.dtUtils.handleError({ action: 'exportModelToFile', error })
      throw error
    }
  }

  /**
   * Export model and download as JSON file (browser only)
   * @param modelId - The ID of the model to export
   * @param filename - Optional custom filename (without extension)
   */
  exportAndDownload = async (modelId: string, filename?: string): Promise<void> => {
    try {
      const exportedModel = await this.exportModel(modelId)
      const jsonString = JSON.stringify(exportedModel, null, 2)
      
      // Create and download the file
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${filename || modelId}-export.json`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      this.dtUtils.handleError({ action: 'exportAndDownload', error })
      throw error
    }
  }

  private enrichDataItem = async (dataItem: DataItem): Promise<ExportedDataItem> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dataClass, elements, ...baseDataItem } = dataItem
    const enrichedItem = baseDataItem as ExportedDataItem

    try {
      const dataClassId = dataClass?.id
      if (dataClassId) {
        const classData = await this.dtClass.getDataClass({ dataClassId })
        if (classData) {
          const attributes = await this.dtClass.getAttributesFromClassRelationship({
            componentId: dataItem.id,
            classId: dataClassId,
          })
          enrichedItem.classData = {
            id: classData.id,
            name: classData.name
          }
          // Unflatten attributes to restore nested structure
          if (attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0) {
            enrichedItem.attributes = DtUtils.unflattenProperties(attributes)
          } else {
            enrichedItem.attributes = attributes || {}
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to enrich data item ${dataItem.id}:`, error)
    }

    return enrichedItem
  }

  private enrichComponent = async (
    component: ComponentData,
    allDataItems: ExportedDataItem[]
  ): Promise<ExportedComponent> => {
    const enrichedComponent = { ...component } as ExportedComponent

    try {
      // Get class data
      const classData = await this.dtClass.getComponentClass({ componentId: component.id })
      if (classData) {
        const attributes = await this.dtClass.getAttributesFromClassRelationship({
          componentId: component.id,
          classId: classData.id,
        })
        enrichedComponent.classData = {
          id: classData.id,
          name: classData.name
        }
        // Unflatten attributes to restore nested structure
        if (attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0) {
          enrichedComponent.attributes = DtUtils.unflattenProperties(attributes)
        } else {
          enrichedComponent.attributes = attributes || {}
        }
      } else {
        // Try to get represented model
        const representedModel = await this.dtComponent.getComponentRepresentedModel({ componentId: component.id })
        enrichedComponent.representedModel = representedModel
      }

      // Process data items
      if (component.dataItems && Array.isArray(component.dataItems) && component.dataItems.length > 0) {
        const componentDataItemIds = component.dataItems
          .map(item => typeof item === 'string' ? item : item.id)
          .filter(id => allDataItems.some(dataItem => dataItem.id === id))

        if (componentDataItemIds.length > 0) {
          enrichedComponent.dataItemIds = componentDataItemIds
        }
      }
    } catch (error) {
      console.warn(`Failed to enrich component ${component.id}:`, error)
    }

    return enrichedComponent
  }

  private enrichDataFlow = async (
    dataFlow: DataFlowData,
    allDataItems: ExportedDataItem[]
  ): Promise<ExportedDataFlow> => {
    const enrichedFlow = { ...dataFlow } as ExportedDataFlow

    try {
      // Get class data
      const classData = await this.dtClass.getDataFlowClass({ dataFlowId: dataFlow.id })
      if (classData) {
        const attributes = await this.dtClass.getAttributesFromClassRelationship({
          componentId: dataFlow.id,
          classId: classData.id,
        })
        enrichedFlow.classData = {
          id: classData.id,
          name: classData.name
        }
        // Unflatten attributes to restore nested structure
        if (attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0) {
          enrichedFlow.attributes = DtUtils.unflattenProperties(attributes)
        } else {
          enrichedFlow.attributes = attributes || {}
        }
      }

      // Process data items
      const flowData = (dataFlow as any).data || []
      if (Array.isArray(flowData) && flowData.length > 0) {
        const flowDataItemIds = flowData
          .map((dataRef: any) => typeof dataRef === 'string' ? dataRef : dataRef.id)
          .filter((id: string) => allDataItems.some(dataItem => dataItem.id === id))

        if (flowDataItemIds.length > 0) {
          enrichedFlow.dataItemIds = flowDataItemIds
        }
      }
    } catch (error) {
      console.warn(`Failed to enrich data flow ${dataFlow.id}:`, error)
    }

    return enrichedFlow
  }

  private enrichBoundary = async (
    boundary: BoundaryData,
    allBoundaries: BoundaryData[],
    allComponents: ComponentData[],
    allDataItems: ExportedDataItem[]
  ): Promise<ExportedBoundary> => {
    const enrichedBoundary = { ...boundary } as ExportedBoundary

    try {
      // Get class data
      const classData = await this.dtClass.getBoundaryClass({ boundaryId: boundary.id })
      if (classData) {
        const attributes = await this.dtClass.getAttributesFromClassRelationship({
          componentId: boundary.id,
          classId: classData.id,
        })
        enrichedBoundary.classData = {
          id: classData.id,
          name: classData.name
        }
        // Unflatten attributes to restore nested structure
        if (attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0) {
          enrichedBoundary.attributes = DtUtils.unflattenProperties(attributes)
        } else {
          enrichedBoundary.attributes = attributes || {}
        }
      } else {
        // Try to get represented model
        const representedModel = await this.dtBoundary.getBoundaryRepresentedModel({ boundaryId: boundary.id })
        enrichedBoundary.representedModel = representedModel
      }

      // Process data items
      const boundaryData = (boundary as any).data || []
      if (Array.isArray(boundaryData) && boundaryData.length > 0) {
        const boundaryDataItemIds = boundaryData
          .map((dataRef: any) => typeof dataRef === 'string' ? dataRef : dataRef.id)
          .filter((id: string) => allDataItems.some(dataItem => dataItem.id === id))

        if (boundaryDataItemIds.length > 0) {
          enrichedBoundary.dataItemIds = boundaryDataItemIds
        }
      }

      // Process child boundaries
      const childBoundaries = allBoundaries.filter((b: BoundaryData) =>
        b.parentBoundary && b.parentBoundary.id === boundary.id
      )
      if (childBoundaries.length > 0) {
        const enrichedChildBoundaries: ExportedBoundary[] = []
        for (const childBoundary of childBoundaries) {
          const enrichedChild = await this.enrichBoundary(childBoundary, allBoundaries, allComponents, allDataItems)
          enrichedChildBoundaries.push(enrichedChild)
        }
        enrichedBoundary.boundaries = enrichedChildBoundaries
      }

      // Process child components
      const childComponents = allComponents.filter((c: ComponentData) =>
        c.parentBoundary && c.parentBoundary.id === boundary.id
      )
      if (childComponents.length > 0) {
        const enrichedChildComponents: ExportedComponent[] = []
        for (const component of childComponents) {
          const enrichedComponent = await this.enrichComponent(component, allDataItems)
          enrichedChildComponents.push(enrichedComponent)
        }
        enrichedBoundary.components = enrichedChildComponents
      }
    } catch (error) {
      console.warn(`Failed to enrich boundary ${boundary.id}:`, error)
    }

    return enrichedBoundary
  }

  private cleanBoundary = (boundary: ExportedBoundary): void => {
    // Remove computed properties that shouldn't be in the export
    delete (boundary as any).allDescendantComponents
    delete (boundary as any).allDescendantBoundaries
    delete (boundary as any).allDescendantDataFlows

    // Recursively clean child boundaries
    if (boundary.boundaries) {
      boundary.boundaries.forEach(childBoundary => this.cleanBoundary(childBoundary))
    }
  }

  private removeTypenames = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(item => this.removeTypenames(item))
    } else if (obj !== null && typeof obj === 'object') {
      const newObj: any = {}
      for (const key in obj) {
        if (key !== '__typename' && Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = this.removeTypenames(obj[key])
        }
      }
      return newObj
    } else {
      return obj
    }
  }
}
