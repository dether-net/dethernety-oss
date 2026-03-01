/**
 * Dethernety Threat Model Schemas
 *
 * This module exports all schema types for the Dethernety threat modeling format.
 *
 * ## Formats
 *
 * Two formats are supported:
 *
 * ### Monolithic Format (v1 compatible)
 * Single JSON file containing the entire model with inline attributes.
 * Use `MonolithicModel` type for this format.
 *
 * ### Split Format (v2)
 * Multiple files for better git management and AI agent updates:
 * - `manifest.json` - Model metadata and file references
 * - `structure.json` - Hierarchy without attributes
 * - `dataflows.json` - Data flow connections
 * - `data-items.json` - Data classification items
 * - `attributes/` - Element attributes (consolidated or per-element)
 *
 * Use `SplitModel` type for this format.
 *
 * ## Converting Between Formats
 *
 * ```typescript
 * import { monolithicToSplit, splitToMonolithic } from './schemas';
 *
 * // Convert monolithic to split
 * const splitModel = monolithicToSplit(monolithicModel);
 *
 * // Convert split to monolithic
 * const monolithicModel = splitToMonolithic(splitModel);
 * ```
 *
 * ## Validation
 *
 * ```typescript
 * import { validateMonolithicModel } from './schemas';
 *
 * const result = validateMonolithicModel(model);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

// Common types
export {
  SCHEMA_VERSION,
  type UUID,
  type ComponentType,
  type ClassType,
  type ConnectionHandle,
  type ElementReference,
  type ModuleReference,
  type ClassReference,
  type ModelReference,
  type ControlReference,
  type Position,
  type Dimensions,
  type Attributes,
  type Identifiable,
} from './common.schema.js';

// Manifest
export {
  type ModelManifest,
  type ModelMetadata,
  type FileReferences,
  DEFAULT_FILE_NAMES,
  createManifest,
} from './manifest.schema.js';

// Structure
export {
  type ModelStructure,
  type StructureBoundary,
  type StructureComponent,
  type FlattenedStructure,
  flattenStructure,
  getAllElementIds,
  findElementById,
} from './structure.schema.js';

// Data flows
export {
  type DataFlow,
  type DataFlowsFile,
  type DataFlowValidation,
  type DataFlowValidationError,
  validateDataFlows,
  getReferencedComponentIds,
  getFlowsForComponent,
  buildAdjacencyList,
} from './dataflows.schema.js';

// Data items
export {
  type DataItem,
  type DataItemsFile,
  type DataItemUsage,
  buildDataItemUsageMap,
  findOrphanedDataItems,
  groupDataItemsByClass,
} from './data-items.schema.js';

// Attributes
export {
  type AttributeElementType,
  type ElementAttributes,
  type ConsolidatedAttributesFile,
  type PerElementAttributesFile,
  type AttributesIndex,
  type AttributesStorageMode,
  mergeAttributes,
  getElementAttributes,
  setElementAttributes,
  removeElementAttributes,
  createAttributesIndex,
  findElementsMissingAttributes,
} from './attributes.schema.js';

// Unified model types and conversion
export {
  // Monolithic format types
  type MonolithicModel,
  type MonolithicBoundary,
  type MonolithicComponent,
  type MonolithicDataFlow,
  type MonolithicDataItem,

  // Split format types
  type SplitModel,

  // Conversion functions
  monolithicToSplit,
  splitToMonolithic,

  // Validation
  type ModelValidation,
  type ModelValidationError,
  type ModelValidationWarning,
  validateMonolithicModel,
} from './model.schema.js';
