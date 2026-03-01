/**
 * Attributes schema for Dethernety threat models.
 *
 * Attributes are the dynamic properties of elements defined by their classes.
 * In the split-file format, attributes are stored separately from structure
 * to minimize diff noise and enable independent updates.
 *
 * This is the key innovation of the split-file format:
 * - Changing a security attribute doesn't pollute the structure diff
 * - Multiple users can edit attributes of different elements
 * - AI agents can update specific attributes without risk to other data
 */

import type {
  UUID,
  ClassReference,
  Attributes,
} from './common.schema.js';

/**
 * Element types that can have attributes.
 */
export type AttributeElementType =
  | 'boundary'
  | 'component'
  | 'dataFlow'
  | 'dataItem';

/**
 * Attributes for a single element.
 * Links an element ID to its class and attribute values.
 */
export interface ElementAttributes {
  /** UUID of the element these attributes belong to */
  elementId: UUID;

  /** Type of the element */
  elementType: AttributeElementType;

  /** Human-readable element name (for debugging/display) */
  elementName?: string;

  /** Class that defines these attributes */
  classData: ClassReference;

  /** The actual attribute values */
  attributes: Attributes;

  /** Last modified timestamp */
  modifiedAt?: string;
}

/**
 * Consolidated attributes file - all attributes in one file.
 * Used when attributes are stored in a single `attributes.json`.
 *
 * Structure:
 * ```json
 * {
 *   "boundaries": { "uuid1": {...}, "uuid2": {...} },
 *   "components": { "uuid3": {...}, "uuid4": {...} },
 *   "dataFlows": { "uuid5": {...} },
 *   "dataItems": { "uuid6": {...} }
 * }
 * ```
 */
export interface ConsolidatedAttributesFile {
  /** Attributes for boundaries, keyed by element ID */
  boundaries?: Record<UUID, ElementAttributes>;

  /** Attributes for components, keyed by element ID */
  components?: Record<UUID, ElementAttributes>;

  /** Attributes for data flows, keyed by element ID */
  dataFlows?: Record<UUID, ElementAttributes>;

  /** Attributes for data items, keyed by element ID */
  dataItems?: Record<UUID, ElementAttributes>;
}

/**
 * Per-element attributes file structure.
 * Used when each element has its own file in the attributes directory.
 *
 * File naming: `{elementType}/{elementId}.json`
 * Example: `attributes/components/c323859d-d67b-4555-93f7-341a5990a2af.json`
 */
export interface PerElementAttributesFile extends ElementAttributes {
  /** Schema version for per-element files */
  schemaVersion?: string;
}

/**
 * Attributes directory index.
 * Lists all attribute files for quick enumeration.
 */
export interface AttributesIndex {
  /** Schema version */
  schemaVersion: string;

  /** Total count of elements with attributes */
  totalElements: number;

  /** Summary by element type */
  summary: {
    boundaries: number;
    components: number;
    dataFlows: number;
    dataItems: number;
  };

  /** List of element IDs with attributes */
  elements: {
    boundaries: UUID[];
    components: UUID[];
    dataFlows: UUID[];
    dataItems: UUID[];
  };

  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Attributes storage mode.
 * Determines how attributes are organized in the file system.
 */
export type AttributesStorageMode =
  | 'consolidated'  // All attributes in one attributes.json
  | 'per-element'   // Each element gets its own file
  | 'by-type';      // One file per element type (boundaries.json, components.json, etc.)

/**
 * Merge attributes from multiple sources.
 * Later sources override earlier ones for the same element.
 */
export function mergeAttributes(
  ...sources: ConsolidatedAttributesFile[]
): ConsolidatedAttributesFile {
  const result: ConsolidatedAttributesFile = {
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {},
  };

  for (const source of sources) {
    if (source.boundaries) {
      result.boundaries = { ...result.boundaries, ...source.boundaries };
    }
    if (source.components) {
      result.components = { ...result.components, ...source.components };
    }
    if (source.dataFlows) {
      result.dataFlows = { ...result.dataFlows, ...source.dataFlows };
    }
    if (source.dataItems) {
      result.dataItems = { ...result.dataItems, ...source.dataItems };
    }
  }

  return result;
}

/**
 * Get attributes for a specific element.
 */
export function getElementAttributes(
  consolidated: ConsolidatedAttributesFile,
  elementId: UUID,
  elementType: AttributeElementType
): ElementAttributes | undefined {
  switch (elementType) {
    case 'boundary':
      return consolidated.boundaries?.[elementId];
    case 'component':
      return consolidated.components?.[elementId];
    case 'dataFlow':
      return consolidated.dataFlows?.[elementId];
    case 'dataItem':
      return consolidated.dataItems?.[elementId];
  }
}

/**
 * Set attributes for a specific element.
 * Returns a new consolidated file with the update (immutable).
 */
export function setElementAttributes(
  consolidated: ConsolidatedAttributesFile,
  attrs: ElementAttributes
): ConsolidatedAttributesFile {
  const result = { ...consolidated };

  switch (attrs.elementType) {
    case 'boundary':
      result.boundaries = { ...result.boundaries, [attrs.elementId]: attrs };
      break;
    case 'component':
      result.components = { ...result.components, [attrs.elementId]: attrs };
      break;
    case 'dataFlow':
      result.dataFlows = { ...result.dataFlows, [attrs.elementId]: attrs };
      break;
    case 'dataItem':
      result.dataItems = { ...result.dataItems, [attrs.elementId]: attrs };
      break;
  }

  return result;
}

/**
 * Remove attributes for a specific element.
 */
export function removeElementAttributes(
  consolidated: ConsolidatedAttributesFile,
  elementId: UUID,
  elementType: AttributeElementType
): ConsolidatedAttributesFile {
  const result = { ...consolidated };

  switch (elementType) {
    case 'boundary':
      if (result.boundaries) {
        const { [elementId]: _, ...rest } = result.boundaries;
        result.boundaries = rest;
      }
      break;
    case 'component':
      if (result.components) {
        const { [elementId]: _, ...rest } = result.components;
        result.components = rest;
      }
      break;
    case 'dataFlow':
      if (result.dataFlows) {
        const { [elementId]: _, ...rest } = result.dataFlows;
        result.dataFlows = rest;
      }
      break;
    case 'dataItem':
      if (result.dataItems) {
        const { [elementId]: _, ...rest } = result.dataItems;
        result.dataItems = rest;
      }
      break;
  }

  return result;
}

/**
 * Create an attributes index from consolidated attributes.
 */
export function createAttributesIndex(
  consolidated: ConsolidatedAttributesFile
): AttributesIndex {
  const boundaryIds = Object.keys(consolidated.boundaries ?? {});
  const componentIds = Object.keys(consolidated.components ?? {});
  const dataFlowIds = Object.keys(consolidated.dataFlows ?? {});
  const dataItemIds = Object.keys(consolidated.dataItems ?? {});

  return {
    schemaVersion: '2.0.0',
    totalElements: boundaryIds.length + componentIds.length + dataFlowIds.length + dataItemIds.length,
    summary: {
      boundaries: boundaryIds.length,
      components: componentIds.length,
      dataFlows: dataFlowIds.length,
      dataItems: dataItemIds.length,
    },
    elements: {
      boundaries: boundaryIds,
      components: componentIds,
      dataFlows: dataFlowIds,
      dataItems: dataItemIds,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Find elements with missing attributes (have class but no attributes set).
 */
export function findElementsMissingAttributes(
  elementIds: UUID[],
  elementType: AttributeElementType,
  consolidated: ConsolidatedAttributesFile
): UUID[] {
  const attributeMap = (() => {
    switch (elementType) {
      case 'boundary':
        return consolidated.boundaries ?? {};
      case 'component':
        return consolidated.components ?? {};
      case 'dataFlow':
        return consolidated.dataFlows ?? {};
      case 'dataItem':
        return consolidated.dataItems ?? {};
    }
  })();

  return elementIds.filter(id => !attributeMap[id]);
}
