export * from './interfaces/core-types-interface.js'
export * from './dt-utils/dt-utils.js'
export * from './dt-model/dt-model.js'
export * from './dt-component/dt-component.js'
export * from './dt-boundary/dt-boundary.js'
export * from './dt-dataflow/dt-dataflow.js'
export * from './dt-dataitem/dt-dataitem.js'
export * from './dt-exposure/dt-exposure.js'
export * from './dt-class/dt-class.js'
export * from './dt-mitreattack/dt-mitreattack.js'
export * from './dt-mitredefend/dt-mitredefend.js'
export * from './dt-control/dt-control.js'
export * from './dt-countermeasure/dt-countermeasure.js'
export * from './dt-module/dt-module.js'
export * from './dt-analysis/dt-analysis.js'
export * from './dt-folder/dt-folder.js'
export * from './dt-issue/dt-issue.js'
export * from './dt-export/dt-export.js'
export * from './dt-export/dt-export-split.js'
export * from './dt-import/dt-import.js'
export * from './dt-import/dt-import-split.js'
export * from './dt-update/dt-update.js'
export * from './dt-update/dt-update-split.js'

// Schema exports - use explicit imports to avoid conflicts with core-types-interface
export {
  SCHEMA_VERSION,
  DEFAULT_FILE_NAMES,
  createManifest,
  flattenStructure,
  getAllElementIds,
  findElementById,
  validateDataFlows,
  getReferencedComponentIds,
  getFlowsForComponent,
  buildAdjacencyList,
  buildDataItemUsageMap,
  findOrphanedDataItems,
  groupDataItemsByClass,
  mergeAttributes,
  getElementAttributes,
  setElementAttributes,
  removeElementAttributes,
  createAttributesIndex,
  findElementsMissingAttributes,
  monolithicToSplit,
  splitToMonolithic,
  validateMonolithicModel,
} from './schemas/index.js'

// Schema types - prefixed or unique names to avoid conflicts
export type {
  UUID,
  ComponentType,
  ClassType,
  ConnectionHandle,
  ElementReference,
  ModuleReference,
  ClassReference,
  ModelReference,
  ControlReference,
  Position,
  Dimensions,
  Attributes,
  Identifiable,
  ModelManifest,
  ModelMetadata,
  FileReferences,
  ModelStructure,
  StructureBoundary,
  StructureComponent,
  FlattenedStructure,
  DataFlow,
  DataFlowsFile,
  DataFlowValidation,
  DataFlowValidationError,
  DataItemsFile,
  DataItemUsage,
  AttributeElementType,
  ElementAttributes,
  ConsolidatedAttributesFile,
  PerElementAttributesFile,
  AttributesIndex,
  AttributesStorageMode,
  MonolithicModel,
  MonolithicBoundary,
  MonolithicComponent,
  MonolithicDataFlow,
  MonolithicDataItem,
  SplitModel,
  ModelValidation,
  ModelValidationError,
  ModelValidationWarning,
} from './schemas/index.js'

// Re-export DataItem from schemas with a different name to avoid conflict
export type { DataItem as SchemaDataItem } from './schemas/index.js'