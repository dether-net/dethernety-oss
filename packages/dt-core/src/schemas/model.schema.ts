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
import type { ModelManifest, ModelMetadata, ModelScopeLocal } from './manifest.schema.js';
import type {
  ModelStructure,
  StructureBoundary,
  StructureComponent,
} from './structure.schema.js';
import { flattenStructure } from './structure.schema.js';
import type { Zone, Plane, Conduit } from '../interfaces/core-types-interface.js';
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
  /** Explicit `null` unassigns the class on update; absent leaves the binding untouched. */
  classData?: ClassReference | null;
  attributes?: Attributes;
  controls?: ControlReference[];
  dataItemIds?: UUID[];
  representedModel?: ModelReference;
  crownJewel?: boolean;
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
  /** Explicit `null` unassigns the class on update; absent leaves the binding untouched. */
  classData?: ClassReference | null;
  attributes?: Attributes;
  controls?: ControlReference[];
  dataItemIds?: UUID[];
  representedModel?: ModelReference;
  zone?: Zone | null;
  domains?: string[];
  planes?: Plane[];
  conduits?: Conduit[];
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
  /** Explicit `null` unassigns the class on update; absent leaves the binding untouched. */
  classData?: ClassReference | null;
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
  /** Explicit `null` unassigns the class on update; absent leaves the binding untouched. */
  classData?: ClassReference | null;
  attributes?: Attributes;
  sensitivity?: string;
  regulatory_flags?: string[];
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
  /** Asset-context scope (grouped, snake_case); absent when unset. */
  scope?: ModelScopeLocal;
  /** Model-level controls (SUPPORTS relationship); absent when none. */
  controls?: ControlReference[];
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
      // Carry model-level controls and scope so this stays symmetric with
      // splitToMonolithic (which reads manifest.model.controls / .scope) —
      // otherwise a round-trip through this standalone pair would silently drop them.
      ...(model.controls ? { controls: model.controls } : {}),
      ...(model.scope ? { scope: model.scope } : {}),
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
    // First-class asset-context fields — splitToMonolithic spreads them back
    // (`...item`), so omitting them here silently dropped both on round-trip.
    sensitivity: item.sensitivity,
    regulatory_flags: item.regulatory_flags,
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
      // `!== undefined` (not `??`): an explicit null is the unassign sentinel and
      // must not be swallowed by falling back to the attributes-bag classData.
      classData: flow.classData !== undefined ? flow.classData : attrs?.classData,
      attributes: attrs?.attributes ?? flow.attributes,
    } as MonolithicDataFlow;
  });

  // Rebuild data items with attributes
  const dataItems = split.dataItems.map(item => {
    const attrs = split.attributes.dataItems?.[item.id];
    return {
      ...item,
      // `!== undefined` (not `??`): preserve the explicit-null unassign sentinel.
      classData: item.classData !== undefined ? item.classData : attrs?.classData,
      attributes: attrs?.attributes ?? item.attributes,
    } as MonolithicDataItem;
  });

  return {
    id: split.manifest.model.id,
    name: split.manifest.model.name,
    description: split.manifest.model.description,
    // Asset-context scope rides into the monolithic so the push input-builders
    // can lift it onto the flat platform Model fields (model.schema carries the
    // grouped local shape unchanged). Absent when scope.json was never set.
    scope: split.manifest.model.scope,
    // Model-level controls ride through so import restores them at model create.
    // NOTE: this same field also reaches the UPDATE path (DtUpdateSplit →
    // updateModelProperties), where it REPLACE-syncs model controls — a present list
    // reconciles, an explicit [] clears (consistent with element-level controls);
    // absent preserves. The exporter is present-only, so a normal round-trip never
    // clears.
    controls: split.manifest.model.controls,
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
    zone: boundary.zone,
    domains: boundary.domains,
    planes: boundary.planes,
    conduits: boundary.conduits,
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
    // First-class asset-context flag — must ride the forward conversion or the
    // round-trip flips true→false (splitToMonolithic emits a definite boolean),
    // and pushing that under REPLACE clears crown jewels on the platform.
    crownJewel: component.crownJewel,
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

  // Attributes are extracted whenever present — NOT gated on classData. A
  // classless element (e.g. a crown-jewel-only unclassified component) is a
  // supported shape whose attributes previously vanished through this
  // conversion. `classData` is carried only when present (ElementAttributes
  // declares it optional for exactly this synthesized-entry case).

  // Process boundaries recursively
  function processBoundary(boundary: MonolithicBoundary): void {
    if (boundary.attributes) {
      result.boundaries![boundary.id] = {
        elementId: boundary.id,
        elementType: 'boundary',
        elementName: boundary.name,
        ...(boundary.classData ? { classData: boundary.classData } : {}),
        attributes: boundary.attributes,
      };
    }

    boundary.components?.forEach(component => {
      if (component.attributes) {
        result.components![component.id] = {
          elementId: component.id,
          elementType: 'component',
          elementName: component.name,
          ...(component.classData ? { classData: component.classData } : {}),
          attributes: component.attributes,
        };
      }
    });

    boundary.boundaries?.forEach(processBoundary);
  }

  processBoundary(model.defaultBoundary);

  // Process data flows
  model.dataFlows?.forEach(flow => {
    if (flow.attributes) {
      result.dataFlows![flow.id] = {
        elementId: flow.id,
        elementType: 'dataFlow',
        elementName: flow.name,
        ...(flow.classData ? { classData: flow.classData } : {}),
        attributes: flow.attributes,
      };
    }
  });

  // Process data items
  model.dataItems?.forEach(item => {
    if (item.attributes) {
      result.dataItems![item.id] = {
        elementId: item.id,
        elementType: 'dataItem',
        elementName: item.name,
        ...(item.classData ? { classData: item.classData } : {}),
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
    // `!== undefined` (not `??`): preserve the explicit-null unassign sentinel.
    classData: boundary.classData !== undefined ? boundary.classData : boundaryAttrs?.classData,
    attributes: boundaryAttrs?.attributes,
    controls: boundary.controls,
    dataItemIds: boundary.dataItemIds,
    representedModel: boundary.representedModel,
    zone: boundary.zone,
    domains: boundary.domains,
    planes: boundary.planes,
    conduits: boundary.conduits,
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
        // `!== undefined` (not `??`): preserve the explicit-null unassign sentinel.
        classData: c.classData !== undefined ? c.classData : componentAttrs?.classData,
        attributes: componentAttrs?.attributes,
        controls: c.controls,
        dataItemIds: c.dataItemIds,
        representedModel: c.representedModel,
        // crownJewel is a first-class structure field (structure.json), mirroring
        // the platform Component.crownJewel. A definite boolean lets the push apply
        // REPLACE semantics (clears the platform flag when unset locally).
        crownJewel: c.crownJewel === true,
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

/** Component types the platform accepts (mirrors common.schema `ComponentType`). */
const VALID_COMPONENT_TYPES = new Set(['PROCESS', 'EXTERNAL_ENTITY', 'STORE']);

/**
 * Validate a monolithic model.
 *
 * Never throws on malformed input — a missing `defaultBoundary` or a flow with
 * no `source` returns `{ valid: false }` with the matching error rather than a
 * TypeError (the pre-repair validator crashed on exactly the inputs it existed
 * to reject). Wired into the import path (DtImport.importModel) so it actually
 * runs before any mutation.
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
    // Every structural check below walks defaultBoundary — without it the model
    // is unusable, so return the accumulated errors instead of dereferencing
    // undefined (the old fall-through crashed in collectAllComponentIds).
    return { valid: false, errors, warnings };
  }
  if (!model.defaultBoundary.id) {
    errors.push({
      code: 'MISSING_BOUNDARY_ID',
      message: 'Default boundary must have an ID',
      path: 'defaultBoundary.id',
    });
  }

  // Junk-shape guard: a collection that is present but not an array, or an entry
  // that is not an object, is malformed input — surface a MALFORMED_STRUCTURE
  // error and skip it rather than crashing on the dereference (the never-throw
  // contract has to hold for arbitrary junk, not just the historic crash shapes).
  const asEntries = <T>(value: unknown, path: string): T[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      errors.push({
        code: 'MALFORMED_STRUCTURE',
        message: `${path} must be an array, got ${typeof value}`,
        path,
      });
      return [];
    }
    return value.filter((entry, i) => {
      if (entry && typeof entry === 'object') return true;
      errors.push({
        code: 'MALFORMED_STRUCTURE',
        message: `${path}[${i}] must be an object, got ${entry === null ? 'null' : typeof entry}`,
        path: `${path}[${i}]`,
      });
      return false;
    }) as T[];
  };

  // Duplicate element ids: idMapping.set on import silently overwrites, so two
  // elements sharing an id would bind every reference to the second only.
  const seenIds = new Set<UUID>();
  const checkId = (id: UUID | undefined, kind: string, name?: string) => {
    if (!id) return;
    if (seenIds.has(id)) {
      errors.push({
        code: 'DUPLICATE_ELEMENT_ID',
        message: `Duplicate element id "${id}" (${kind}${name ? ` "${name}"` : ''}) — element ids must be unique across the model`,
        elementId: id,
      });
    }
    seenIds.add(id);
  };

  // Component scalar shapes: a bad `type`/position fails GraphQL coercion
  // mid-import, leaving a partial model — reject up front instead.
  const checkComponent = (c: MonolithicComponent) => {
    checkId(c.id, 'component', c.name);
    if (c.type !== undefined && !VALID_COMPONENT_TYPES.has(c.type)) {
      errors.push({
        code: 'INVALID_COMPONENT_TYPE',
        message: `Component "${c.name || c.id}" has invalid type "${c.type}" (expected one of: ${[...VALID_COMPONENT_TYPES].join(', ')})`,
        elementId: c.id,
      });
    }
    for (const field of ['positionX', 'positionY'] as const) {
      const v = c[field];
      if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
        errors.push({
          code: 'INVALID_POSITION',
          message: `Component "${c.name || c.id}": ${field} must be a finite number, got ${typeof v}`,
          elementId: c.id,
        });
      }
    }
  };

  const walkBoundary = (b: MonolithicBoundary, path: string) => {
    checkId(b.id, 'boundary', b.name);
    asEntries<MonolithicComponent>(b.components, `${path}.components`).forEach(checkComponent);
    asEntries<MonolithicBoundary>(b.boundaries, `${path}.boundaries`).forEach(
      (child, i) => walkBoundary(child, `${path}.boundaries[${i}]`)
    );
  };
  walkBoundary(model.defaultBoundary, 'defaultBoundary');
  const dataFlows = asEntries<MonolithicDataFlow>(model.dataFlows, 'dataFlows');
  const dataItems = asEntries<MonolithicDataItem>(model.dataItems, 'dataItems');
  dataFlows.forEach(f => checkId(f.id, 'dataFlow', f.name));
  dataItems.forEach(i => checkId(i.id, 'dataItem', i.name));

  // Validate data flow references. Boundaries are legal flow endpoints (the
  // split-import validator always accepted them) — use the shared collector so
  // the two validators can't drift apart again.
  if (dataFlows.length > 0) {
    const endpointIds = collectFlowEndpointIds(model.defaultBoundary);

    for (const flow of dataFlows) {
      // A missing endpoint reference is invalid, not skippable — and must not
      // crash the validator (the old `flow.source.id` threw on it).
      if (!flow.source?.id || !endpointIds.has(flow.source.id)) {
        errors.push({
          code: 'INVALID_FLOW_SOURCE',
          message: `Data flow "${flow.name}" references ${flow.source?.id ? 'a non-existent' : 'no'} source element`,
          elementId: flow.id,
        });
      }
      if (!flow.target?.id || !endpointIds.has(flow.target.id)) {
        errors.push({
          code: 'INVALID_FLOW_TARGET',
          message: `Data flow "${flow.name}" references ${flow.target?.id ? 'a non-existent' : 'no'} target element`,
          elementId: flow.id,
        });
      }
    }
  }

  // Validate data item references
  if (dataItems.length > 0) {
    const dataItemIds = new Set(dataItems.map(item => item.id));
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
 * Collect every legal data-flow endpoint id (boundaries AND components) from a
 * boundary hierarchy. Shared by the monolithic validator and the split-import
 * validator so they agree on endpoint semantics — the pre-consolidation copies
 * disagreed (the monolithic one collected components only, failing legitimate
 * boundary-attached flows with INVALID_FLOW_SOURCE). Null-safe: a missing
 * boundary yields an empty set.
 */
export function collectFlowEndpointIds(
  boundary: { id?: UUID, boundaries?: any[], components?: Array<{ id?: UUID }> } | undefined | null
): Set<UUID> {
  const ids = new Set<UUID>();

  function process(b: { id?: UUID, boundaries?: any[], components?: Array<{ id?: UUID }> } | undefined | null): void {
    if (!b || typeof b !== 'object') return;
    // Boundaries can also be source/target of flows.
    if (b.id) ids.add(b.id);
    // Array.isArray (not optional chaining): a truthy non-array must not crash.
    if (Array.isArray(b.components)) b.components.forEach(c => { if (c?.id) ids.add(c.id); });
    if (Array.isArray(b.boundaries)) b.boundaries.forEach(process);
  }

  process(boundary);
  return ids;
}

/**
 * Collect all data item IDs referenced in a model. Junk-tolerant (null entries,
 * non-array collections are skipped) — the validator reports malformed shapes
 * separately; this collector must never throw on them.
 */
function collectUsedDataItemIds(model: MonolithicModel): Set<UUID> {
  const ids = new Set<UUID>();
  const addAll = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(id => { if (id) ids.add(id); });
  };

  function processBoundary(b: MonolithicBoundary | null | undefined): void {
    if (!b || typeof b !== 'object') return;
    addAll(b.dataItemIds);
    if (Array.isArray(b.components)) {
      b.components.forEach(c => { if (c && typeof c === 'object') addAll(c.dataItemIds); });
    }
    if (Array.isArray(b.boundaries)) b.boundaries.forEach(processBoundary);
  }

  processBoundary(model.defaultBoundary);
  if (Array.isArray(model.dataFlows)) {
    model.dataFlows.forEach(f => { if (f && typeof f === 'object') addAll(f.dataItemIds); });
  }

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
