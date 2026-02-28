/**
 * Unified model schema for Dethernety threat models.
 *
 * This module provides:
 * - Complete model type combining all schemas
 * - Conversion between split and monolithic formats
 * - Validation utilities
 * - Backward compatibility with v1 (Python) export format
 */

import type {
  UUID,
  ModuleReference,
  Attributes,
  ClassReference,
  ControlReference,
  ModelReference,
  ElementReference,
} from './common.schema.js';
import { SCHEMA_VERSION } from './common.schema.js';
import type { ModelManifest, ModelMetadata } from './manifest.schema.js';
import type {
  ModelStructure,
  StructureBoundary,
  StructureComponent,
} from './structure.schema.js';
import { flattenStructure } from './structure.schema.js';
import type { DataFlow, DataFlowsFile } from './dataflows.schema.js';
import type { DataItem, DataItemsFile } from './data-items.schema.js';
import type {
  ConsolidatedAttributesFile,
  ElementAttributes,
} from './attributes.schema.js';

// ============================================================================
// MONOLITHIC FORMAT (Backward Compatible with v1)
// ============================================================================

/**
 * Component with inline attributes (monolithic format).
 */
export interface MonolithicComponent {
  id: UUID;
  name: string;
  description?: string;
  type: 'PROCESS' | 'EXTERNAL_ENTITY' | 'STORE';
  positionX: number;
  positionY: number;
  parentBoundary?: ElementReference;
  classData?: ClassReference;
  attributes?: Attributes;
  controls?: ControlReference[];
  dataItemIds?: UUID[];
  representedModel?: ModelReference;
}

/**
 * Boundary with inline attributes and nested children (monolithic format).
 */
export interface MonolithicBoundary {
  id: UUID;
  name: string;
  description?: string;
  positionX?: number;
  positionY?: number;
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  dimensionsMinWidth?: number;
  dimensionsMinHeight?: number;
  parentBoundary?: ElementReference;
  classData?: ClassReference;
  attributes?: Attributes;
  controls?: ControlReference[];
  dataItemIds?: UUID[];
  representedModel?: ModelReference;
  boundaries?: MonolithicBoundary[];
  components?: MonolithicComponent[];
}

/**
 * Data flow with inline attributes (monolithic format).
 */
export interface MonolithicDataFlow {
  id: UUID;
  name: string;
  description?: string;
  source: ElementReference;
  target: ElementReference;
  sourceHandle?: string;
  targetHandle?: string;
  classData?: ClassReference;
  attributes?: Attributes;
  controls?: ControlReference[];
  dataItemIds?: UUID[];
}

/**
 * Data item with inline attributes (monolithic format).
 */
export interface MonolithicDataItem {
  id: UUID;
  name: string;
  description?: string;
  classData?: ClassReference;
  attributes?: Attributes;
}

/**
 * Complete monolithic model (single-file format).
 * This is backward-compatible with the Python v1 export format.
 */
export interface MonolithicModel {
  /** Model ID (null for new imports) */
  id?: UUID | null;
  /** Model name */
  name: string;
  /** Model description */
  description?: string;
  /** Root boundary containing all elements */
  defaultBoundary: MonolithicBoundary;
  /** All data flows in the model */
  dataFlows?: MonolithicDataFlow[];
  /** All data items in the model */
  dataItems?: MonolithicDataItem[];
  /** Modules used by this model */
  modules?: ModuleReference[];
}

// ============================================================================
// SPLIT FORMAT
// ============================================================================

/**
 * Complete split model - all files loaded into memory.
 */
export interface SplitModel {
  /** Manifest with metadata and file references */
  manifest: ModelManifest;
  /** Structure (hierarchy without attributes) */
  structure: ModelStructure;
  /** All data flows */
  dataFlows: DataFlow[];
  /** All data items */
  dataItems: DataItem[];
  /** All attributes by element */
  attributes: ConsolidatedAttributesFile;
}

// ============================================================================
// CONVERSION UTILITIES
// ============================================================================

/**
 * Convert a monolithic model to split format.
 */
export function monolithicToSplit(model: MonolithicModel): SplitModel {
  const defaultBoundaryId = model.defaultBoundary.id;

  // Build manifest
  const manifest: ModelManifest = {
    schemaVersion: SCHEMA_VERSION,
    format: 'split',
    model: {
      id: model.id ?? null,
      name: model.name,
      description: model.description,
      defaultBoundaryId,
    },
    modules: model.modules ?? [],
    exportedAt: new Date().toISOString(),
  };

  // Extract structure (without attributes)
  const structure: ModelStructure = {
    defaultBoundary: extractStructureBoundary(model.defaultBoundary),
  };

  // Extract data flows (keeping inline attributes for now)
  const dataFlows: DataFlow[] = (model.dataFlows ?? []).map(flow => ({
    id: flow.id,
    name: flow.name,
    description: flow.description,
    source: flow.source,
    target: flow.target,
    sourceHandle: flow.sourceHandle as any,
    targetHandle: flow.targetHandle as any,
    classData: flow.classData,
    controls: flow.controls,
    dataItemIds: flow.dataItemIds,
    // Note: attributes included here for now, will be extracted separately
    attributes: flow.attributes,
  }));

  // Extract data items
  const dataItems: DataItem[] = (model.dataItems ?? []).map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    classData: item.classData,
    attributes: item.attributes,
  }));

  // Extract attributes into consolidated format
  const attributes = extractAttributes(model);

  return {
    manifest,
    structure,
    dataFlows,
    dataItems,
    attributes,
  };
}

/**
 * Convert a split model to monolithic format.
 */
export function splitToMonolithic(split: SplitModel): MonolithicModel {
  // Rebuild boundary hierarchy with attributes
  const defaultBoundary = injectAttributesBoundary(
    split.structure.defaultBoundary,
    split.attributes
  );

  // Rebuild data flows with attributes
  const dataFlows = split.dataFlows.map(flow => {
    const attrs = split.attributes.dataFlows?.[flow.id];
    return {
      ...flow,
      attributes: attrs?.attributes ?? flow.attributes,
    } as MonolithicDataFlow;
  });

  // Rebuild data items with attributes
  const dataItems = split.dataItems.map(item => {
    const attrs = split.attributes.dataItems?.[item.id];
    return {
      ...item,
      attributes: attrs?.attributes ?? item.attributes,
    } as MonolithicDataItem;
  });

  return {
    id: split.manifest.model.id,
    name: split.manifest.model.name,
    description: split.manifest.model.description,
    defaultBoundary,
    dataFlows,
    dataItems,
    modules: split.manifest.modules,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract structure boundary (without attributes) from monolithic boundary.
 */
function extractStructureBoundary(boundary: MonolithicBoundary): StructureBoundary {
  return {
    id: boundary.id,
    name: boundary.name,
    description: boundary.description,
    positionX: boundary.positionX,
    positionY: boundary.positionY,
    dimensionsWidth: boundary.dimensionsWidth,
    dimensionsHeight: boundary.dimensionsHeight,
    dimensionsMinWidth: boundary.dimensionsMinWidth,
    dimensionsMinHeight: boundary.dimensionsMinHeight,
    parentBoundary: boundary.parentBoundary,
    classData: boundary.classData,
    controls: boundary.controls,
    dataItemIds: boundary.dataItemIds,
    representedModel: boundary.representedModel,
    boundaries: boundary.boundaries?.map(extractStructureBoundary),
    components: boundary.components?.map(extractStructureComponent),
  };
}

/**
 * Extract structure component (without attributes) from monolithic component.
 */
function extractStructureComponent(component: MonolithicComponent): StructureComponent {
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    type: component.type,
    positionX: component.positionX,
    positionY: component.positionY,
    parentBoundary: component.parentBoundary,
    classData: component.classData,
    controls: component.controls,
    dataItemIds: component.dataItemIds,
    representedModel: component.representedModel,
  };
}

/**
 * Extract all attributes from a monolithic model.
 */
function extractAttributes(model: MonolithicModel): ConsolidatedAttributesFile {
  const result: ConsolidatedAttributesFile = {
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {},
  };

  // Process boundaries recursively
  function processBoundary(boundary: MonolithicBoundary): void {
    if (boundary.classData && boundary.attributes) {
      result.boundaries![boundary.id] = {
        elementId: boundary.id,
        elementType: 'boundary',
        elementName: boundary.name,
        classData: boundary.classData,
        attributes: boundary.attributes,
      };
    }

    boundary.components?.forEach(component => {
      if (component.classData && component.attributes) {
        result.components![component.id] = {
          elementId: component.id,
          elementType: 'component',
          elementName: component.name,
          classData: component.classData,
          attributes: component.attributes,
        };
      }
    });

    boundary.boundaries?.forEach(processBoundary);
  }

  processBoundary(model.defaultBoundary);

  // Process data flows
  model.dataFlows?.forEach(flow => {
    if (flow.classData && flow.attributes) {
      result.dataFlows![flow.id] = {
        elementId: flow.id,
        elementType: 'dataFlow',
        elementName: flow.name,
        classData: flow.classData,
        attributes: flow.attributes,
      };
    }
  });

  // Process data items
  model.dataItems?.forEach(item => {
    if (item.classData && item.attributes) {
      result.dataItems![item.id] = {
        elementId: item.id,
        elementType: 'dataItem',
        elementName: item.name,
        classData: item.classData,
        attributes: item.attributes,
      };
    }
  });

  return result;
}

/**
 * Inject attributes back into a structure boundary.
 */
function injectAttributesBoundary(
  boundary: StructureBoundary,
  attributes: ConsolidatedAttributesFile
): MonolithicBoundary {
  const boundaryAttrs = attributes.boundaries?.[boundary.id];

  return {
    id: boundary.id,
    name: boundary.name,
    description: boundary.description,
    positionX: boundary.positionX,
    positionY: boundary.positionY,
    dimensionsWidth: boundary.dimensionsWidth,
    dimensionsHeight: boundary.dimensionsHeight,
    dimensionsMinWidth: boundary.dimensionsMinWidth,
    dimensionsMinHeight: boundary.dimensionsMinHeight,
    parentBoundary: boundary.parentBoundary,
    classData: boundary.classData,
    attributes: boundaryAttrs?.attributes,
    controls: boundary.controls,
    dataItemIds: boundary.dataItemIds,
    representedModel: boundary.representedModel,
    boundaries: boundary.boundaries?.map(b => injectAttributesBoundary(b, attributes)),
    components: boundary.components?.map(c => {
      const componentAttrs = attributes.components?.[c.id];
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type,
        positionX: c.positionX,
        positionY: c.positionY,
        parentBoundary: c.parentBoundary,
        classData: c.classData,
        attributes: componentAttrs?.attributes,
        controls: c.controls,
        dataItemIds: c.dataItemIds,
        representedModel: c.representedModel,
      } as MonolithicComponent;
    }),
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Model validation result.
 */
export interface ModelValidation {
  valid: boolean;
  errors: ModelValidationError[];
  warnings: ModelValidationWarning[];
}

export interface ModelValidationError {
  code: string;
  message: string;
  path?: string;
  elementId?: UUID;
}

export interface ModelValidationWarning {
  code: string;
  message: string;
  path?: string;
  elementId?: UUID;
}

/**
 * Validate a monolithic model.
 */
export function validateMonolithicModel(model: MonolithicModel): ModelValidation {
  const errors: ModelValidationError[] = [];
  const warnings: ModelValidationWarning[] = [];

  // Required fields
  if (!model.name || typeof model.name !== 'string') {
    errors.push({
      code: 'MISSING_NAME',
      message: 'Model name is required',
      path: 'name',
    });
  }

  if (!model.defaultBoundary) {
    errors.push({
      code: 'MISSING_DEFAULT_BOUNDARY',
      message: 'Default boundary is required',
      path: 'defaultBoundary',
    });
  } else {
    if (!model.defaultBoundary.id) {
      errors.push({
        code: 'MISSING_BOUNDARY_ID',
        message: 'Default boundary must have an ID',
        path: 'defaultBoundary.id',
      });
    }
  }

  // Validate data flow references
  if (model.dataFlows) {
    const componentIds = collectAllComponentIds(model.defaultBoundary);

    for (const flow of model.dataFlows) {
      if (!componentIds.has(flow.source.id)) {
        errors.push({
          code: 'INVALID_FLOW_SOURCE',
          message: `Data flow "${flow.name}" references non-existent source component`,
          elementId: flow.id,
        });
      }
      if (!componentIds.has(flow.target.id)) {
        errors.push({
          code: 'INVALID_FLOW_TARGET',
          message: `Data flow "${flow.name}" references non-existent target component`,
          elementId: flow.id,
        });
      }
    }
  }

  // Validate data item references
  if (model.dataItems) {
    const dataItemIds = new Set(model.dataItems.map(item => item.id));
    const usedDataItemIds = collectUsedDataItemIds(model);

    for (const usedId of usedDataItemIds) {
      if (!dataItemIds.has(usedId)) {
        warnings.push({
          code: 'ORPHANED_DATA_ITEM_REF',
          message: `Reference to non-existent data item: ${usedId}`,
          elementId: usedId,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Collect all component IDs from a boundary hierarchy.
 */
function collectAllComponentIds(boundary: MonolithicBoundary): Set<UUID> {
  const ids = new Set<UUID>();

  function process(b: MonolithicBoundary): void {
    b.components?.forEach(c => ids.add(c.id));
    b.boundaries?.forEach(process);
  }

  process(boundary);
  return ids;
}

/**
 * Collect all data item IDs referenced in a model.
 */
function collectUsedDataItemIds(model: MonolithicModel): Set<UUID> {
  const ids = new Set<UUID>();

  function processBoundary(b: MonolithicBoundary): void {
    b.dataItemIds?.forEach(id => ids.add(id));
    b.components?.forEach(c => c.dataItemIds?.forEach(id => ids.add(id)));
    b.boundaries?.forEach(processBoundary);
  }

  processBoundary(model.defaultBoundary);
  model.dataFlows?.forEach(f => f.dataItemIds?.forEach(id => ids.add(id)));

  return ids;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  SCHEMA_VERSION,
  type UUID,
  type ModuleReference,
  type Attributes,
  type ClassReference,
} from './common.schema.js';

export type {
  ModelManifest,
  ModelMetadata,
} from './manifest.schema.js';

export type {
  ModelStructure,
  StructureBoundary,
  StructureComponent,
} from './structure.schema.js';

export type {
  DataFlow,
  DataFlowsFile,
} from './dataflows.schema.js';

export type {
  DataItem,
  DataItemsFile,
} from './data-items.schema.js';

export type {
  ConsolidatedAttributesFile,
  ElementAttributes,
  AttributeElementType,
} from './attributes.schema.js';
