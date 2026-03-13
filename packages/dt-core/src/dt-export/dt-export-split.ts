/**
 * Split-file export functionality for the Dethernety threat modeling framework.
 *
 * This module provides the DtExportSplit class which handles exporting threat models
 * to the split-file format (SplitModel).
 */

import * as Apollo from '@apollo/client'

import { DtExport, ExportedModel, ExportedBoundary, ExportedComponent, ExportedDataFlow, ExportedDataItem } from './dt-export.js'
import {
  SplitModel,
  ModelManifest,
  ModelStructure,
  StructureBoundary,
  StructureComponent,
  DataFlow,
  DataItem,
  ConsolidatedAttributesFile,
  ElementAttributes,
  ModuleReference,
  SCHEMA_VERSION,
  DEFAULT_FILE_NAMES,
} from '../schemas/index.js'

/**
 * Class for exporting models to split-file format.
 */
export class DtExportSplit {
  private dtExport: DtExport

  constructor(apolloClient: Apollo.ApolloClient) {
    this.dtExport = new DtExport(apolloClient)
  }

  /**
   * Export a model to split-file format (SplitModel).
   *
   * Uses existing DtExport.exportModel() to get monolithic data,
   * then converts to split format.
   *
   * @param modelId - The ID of the model to export
   * @returns SplitModel object
   */
  async exportModelToSplit(modelId: string): Promise<SplitModel> {
    // Get monolithic export
    const monolithic = await this.dtExport.exportModel(modelId)

    // Convert to split format
    return this.monolithicToSplit(monolithic)
  }

  /**
   * Convert a monolithic model export to split format.
   */
  private monolithicToSplit(model: ExportedModel): SplitModel {
    const defaultBoundaryId = model.defaultBoundary?.id || ''

    // Build manifest
    const manifest: ModelManifest = {
      schemaVersion: SCHEMA_VERSION,
      format: 'split',
      model: {
        id: model.id || null,
        name: model.name || '',
        description: model.description,
        defaultBoundaryId,
      },
      files: {
        structure: DEFAULT_FILE_NAMES.structure,
        dataFlows: DEFAULT_FILE_NAMES.dataFlows,
        dataItems: DEFAULT_FILE_NAMES.dataItems,
        attributes: DEFAULT_FILE_NAMES.attributes,
      },
      modules: this.extractModuleReferences(model.modules || []),
      exportedAt: new Date().toISOString(),
    }

    // Build structure (hierarchy without inline attributes)
    const structure: ModelStructure = {
      defaultBoundary: model.defaultBoundary
        ? this.convertToStructureBoundary(model.defaultBoundary)
        : {
            id: defaultBoundaryId,
            name: 'Default Boundary',
          },
    }

    // Extract data flows
    const dataFlows: DataFlow[] = (model.dataFlows || []).map(flow =>
      this.convertToDataFlow(flow)
    )

    // Extract data items
    const dataItems: DataItem[] = (model.dataItems || []).map(item =>
      this.convertToDataItem(item)
    )

    // Extract attributes into consolidated format
    const attributes = this.extractAttributes(model)

    return {
      manifest,
      structure,
      dataFlows,
      dataItems,
      attributes,
    }
  }

  /**
   * Extract module references from modules array.
   */
  private extractModuleReferences(modules: any[]): ModuleReference[] {
    return modules.map(mod => ({
      id: mod.id,
      name: mod.name,
      description: mod.description,
    }))
  }

  /**
   * Convert ExportedBoundary to StructureBoundary (without inline attributes).
   */
  private convertToStructureBoundary(boundary: ExportedBoundary): StructureBoundary {
    const result: StructureBoundary = {
      id: boundary.id,
      name: boundary.name,
      description: boundary.description,
      positionX: boundary.positionX,
      positionY: boundary.positionY,
      dimensionsWidth: boundary.dimensionsWidth,
      dimensionsHeight: boundary.dimensionsHeight,
      dimensionsMinWidth: boundary.dimensionsMinWidth,
      dimensionsMinHeight: boundary.dimensionsMinHeight,
    }

    // Add parent boundary reference if present
    if (boundary.parentBoundary) {
      result.parentBoundary = { id: boundary.parentBoundary.id }
    }

    // Add class reference if present
    if (boundary.classData) {
      result.classData = {
        id: boundary.classData.id,
        name: boundary.classData.name,
      }
    }

    // Add control references if present
    if (boundary.controls && boundary.controls.length > 0) {
      result.controls = boundary.controls
        .filter(ctrl => ctrl.id)
        .map(ctrl => ({
          id: ctrl.id!,
          name: ctrl.name,
        }))
    }

    // Add data item IDs if present
    if (boundary.dataItemIds && boundary.dataItemIds.length > 0) {
      result.dataItemIds = boundary.dataItemIds
    }

    // Add represented model reference if present
    if (boundary.representedModel && boundary.representedModel.id) {
      result.representedModel = {
        id: boundary.representedModel.id,
        name: boundary.representedModel.name || '',
      }
    }

    // Convert nested boundaries
    if (boundary.boundaries && boundary.boundaries.length > 0) {
      result.boundaries = boundary.boundaries.map(b =>
        this.convertToStructureBoundary(b)
      )
    }

    // Convert components
    if (boundary.components && boundary.components.length > 0) {
      result.components = boundary.components.map(c =>
        this.convertToStructureComponent(c)
      )
    }

    return result
  }

  /**
   * Convert ExportedComponent to StructureComponent (without inline attributes).
   */
  private convertToStructureComponent(component: ExportedComponent): StructureComponent {
    const result: StructureComponent = {
      id: component.id,
      name: component.name,
      description: component.description,
      type: component.type as 'PROCESS' | 'EXTERNAL_ENTITY' | 'STORE',
      positionX: component.positionX || 0,
      positionY: component.positionY || 0,
    }

    // Add parent boundary reference if present
    if (component.parentBoundary) {
      result.parentBoundary = { id: component.parentBoundary.id }
    }

    // Add class reference if present
    if (component.classData) {
      result.classData = {
        id: component.classData.id,
        name: component.classData.name,
      }
    }

    // Add control references if present
    if (component.controls && component.controls.length > 0) {
      result.controls = component.controls
        .filter(ctrl => ctrl.id)
        .map(ctrl => ({
          id: ctrl.id!,
          name: ctrl.name,
        }))
    }

    // Add data item IDs if present
    if (component.dataItemIds && component.dataItemIds.length > 0) {
      result.dataItemIds = component.dataItemIds
    }

    // Add represented model reference if present
    if (component.representedModel && component.representedModel.id) {
      result.representedModel = {
        id: component.representedModel.id,
        name: component.representedModel.name || '',
      }
    }

    return result
  }

  /**
   * Convert ExportedDataFlow to DataFlow.
   */
  private convertToDataFlow(flow: ExportedDataFlow): DataFlow {
    const result: DataFlow = {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      source: { id: flow.source?.id || '' },
      target: { id: flow.target?.id || '' },
    }

    // Add handles if present
    if (flow.sourceHandle) {
      result.sourceHandle = flow.sourceHandle as any
    }
    if (flow.targetHandle) {
      result.targetHandle = flow.targetHandle as any
    }

    // Add class reference if present
    if (flow.classData) {
      result.classData = {
        id: flow.classData.id,
        name: flow.classData.name,
      }
    }

    // Add control references if present
    if (flow.controls && flow.controls.length > 0) {
      result.controls = flow.controls
        .filter(ctrl => ctrl.id)
        .map(ctrl => ({
          id: ctrl.id!,
          name: ctrl.name,
        }))
    }

    // Add data item IDs if present
    if (flow.dataItemIds && flow.dataItemIds.length > 0) {
      result.dataItemIds = flow.dataItemIds
    }

    return result
  }

  /**
   * Convert ExportedDataItem to DataItem.
   */
  private convertToDataItem(item: ExportedDataItem): DataItem {
    const result: DataItem = {
      id: item.id,
      name: item.name,
      description: item.description,
    }

    // Add class reference if present
    if (item.classData) {
      result.classData = {
        id: item.classData.id,
        name: item.classData.name,
      }
    }

    return result
  }

  /**
   * Extract all attributes from a monolithic model into consolidated format.
   */
  private extractAttributes(model: ExportedModel): ConsolidatedAttributesFile {
    const result: ConsolidatedAttributesFile = {
      boundaries: {},
      components: {},
      dataFlows: {},
      dataItems: {},
    }

    // Process boundaries recursively
    if (model.defaultBoundary) {
      this.extractBoundaryAttributes(model.defaultBoundary, result)
    }

    // Process data flows
    if (model.dataFlows) {
      for (const flow of model.dataFlows) {
        if (flow.classData && flow.attributes && Object.keys(flow.attributes).length > 0) {
          result.dataFlows![flow.id] = {
            elementId: flow.id,
            elementType: 'dataFlow',
            elementName: flow.name,
            classData: {
              id: flow.classData.id,
              name: flow.classData.name,
            },
            attributes: flow.attributes,
          }
        }
      }
    }

    // Process data items
    if (model.dataItems) {
      for (const item of model.dataItems) {
        if (item.classData && item.attributes && Object.keys(item.attributes).length > 0) {
          result.dataItems![item.id] = {
            elementId: item.id,
            elementType: 'dataItem',
            elementName: item.name,
            classData: {
              id: item.classData.id,
              name: item.classData.name,
            },
            attributes: item.attributes,
          }
        }
      }
    }

    return result
  }

  /**
   * Extract attributes from a boundary and its children recursively.
   */
  private extractBoundaryAttributes(
    boundary: ExportedBoundary,
    result: ConsolidatedAttributesFile
  ): void {
    // Extract boundary attributes
    if (boundary.classData && boundary.attributes && Object.keys(boundary.attributes).length > 0) {
      result.boundaries![boundary.id] = {
        elementId: boundary.id,
        elementType: 'boundary',
        elementName: boundary.name,
        classData: {
          id: boundary.classData.id,
          name: boundary.classData.name,
        },
        attributes: boundary.attributes,
      }
    }

    // Extract component attributes
    if (boundary.components) {
      for (const component of boundary.components) {
        if (component.classData && component.attributes && Object.keys(component.attributes).length > 0) {
          result.components![component.id] = {
            elementId: component.id,
            elementType: 'component',
            elementName: component.name,
            classData: {
              id: component.classData.id,
              name: component.classData.name,
            },
            attributes: component.attributes,
          }
        }
      }
    }

    // Process nested boundaries recursively
    if (boundary.boundaries) {
      for (const childBoundary of boundary.boundaries) {
        this.extractBoundaryAttributes(childBoundary, result)
      }
    }
  }
}
