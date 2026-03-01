/**
 * Structure schema for Dethernety threat models.
 *
 * This schema defines the hierarchical structure of a threat model:
 * boundaries containing other boundaries and components.
 *
 * IMPORTANT: This schema does NOT include attributes.
 * Attributes are stored separately in the split-file format to:
 * - Keep diffs focused and meaningful
 * - Allow independent attribute updates
 * - Reduce merge conflicts in collaborative editing
 */

import type {
  UUID,
  ComponentType,
  Position,
  Dimensions,
  ElementReference,
  ClassReference,
  ControlReference,
  ModelReference,
  Identifiable,
} from './common.schema.js';

/**
 * Component in the threat model (Process, External Entity, or Store).
 *
 * Components are the leaf nodes in the hierarchy - they don't contain
 * other elements. They connect to other components via data flows.
 *
 * Note: Component size is fixed at 150x150 pixels in the UI.
 */
export interface StructureComponent extends Identifiable {
  /** Component type (PROCESS, EXTERNAL_ENTITY, STORE) */
  type: ComponentType;

  /** Position relative to parent boundary */
  positionX: number;
  positionY: number;

  /** Reference to parent boundary */
  parentBoundary?: ElementReference;

  /** Class assigned to this component (defines available attributes) */
  classData?: ClassReference;

  /** Controls associated with this component */
  controls?: ControlReference[];

  /** Data items this component processes */
  dataItemIds?: UUID[];

  /** If this component represents another model */
  representedModel?: ModelReference;
}

/**
 * Boundary in the threat model (security zone, trust boundary, etc.).
 *
 * Boundaries are containers that group components and other boundaries.
 * They represent security zones, trust boundaries, or logical groupings.
 *
 * The hierarchy is recursive: boundaries can contain boundaries.
 */
export interface StructureBoundary extends Identifiable {
  /** Position relative to parent boundary (0,0 = top-left of parent) */
  positionX?: number;
  positionY?: number;

  /** Dimensions of the boundary */
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  dimensionsMinWidth?: number;
  dimensionsMinHeight?: number;

  /** Reference to parent boundary (undefined for root/default boundary) */
  parentBoundary?: ElementReference;

  /** Class assigned to this boundary (defines available attributes) */
  classData?: ClassReference;

  /** Controls associated with this boundary */
  controls?: ControlReference[];

  /** Data items scoped to this boundary */
  dataItemIds?: UUID[];

  /** If this boundary represents another model */
  representedModel?: ModelReference;

  /** Child boundaries nested within this boundary */
  boundaries?: StructureBoundary[];

  /** Components contained within this boundary */
  components?: StructureComponent[];
}

/**
 * Model structure - the hierarchy without attributes.
 *
 * This is the main content of `structure.json` in split-file format.
 * It defines:
 * - The complete boundary/component hierarchy
 * - Positions and dimensions (layout)
 * - Class assignments
 * - Control and data item associations
 *
 * Attributes are stored separately to minimize diff noise.
 */
export interface ModelStructure {
  /** Root boundary of the model (default boundary) */
  defaultBoundary: StructureBoundary;
}

/**
 * Flattened view of structure for easier processing.
 * Useful when you need to iterate over all elements.
 */
export interface FlattenedStructure {
  /** All boundaries including the root */
  boundaries: StructureBoundary[];
  /** All components across all boundaries */
  components: StructureComponent[];
  /** Map of element ID to parent boundary ID */
  parentMap: Map<UUID, UUID | null>;
}

/**
 * Flatten a hierarchical structure into arrays.
 * Useful for processing all elements without recursion.
 */
export function flattenStructure(structure: ModelStructure): FlattenedStructure {
  const boundaries: StructureBoundary[] = [];
  const components: StructureComponent[] = [];
  const parentMap = new Map<UUID, UUID | null>();

  function processBoundary(boundary: StructureBoundary, parentId: UUID | null): void {
    boundaries.push(boundary);
    parentMap.set(boundary.id, parentId);

    if (boundary.components) {
      for (const component of boundary.components) {
        components.push(component);
        parentMap.set(component.id, boundary.id);
      }
    }

    if (boundary.boundaries) {
      for (const childBoundary of boundary.boundaries) {
        processBoundary(childBoundary, boundary.id);
      }
    }
  }

  processBoundary(structure.defaultBoundary, null);

  return { boundaries, components, parentMap };
}

/**
 * Get all element IDs from a structure.
 */
export function getAllElementIds(structure: ModelStructure): UUID[] {
  const { boundaries, components } = flattenStructure(structure);
  return [
    ...boundaries.map(b => b.id),
    ...components.map(c => c.id),
  ];
}

/**
 * Find an element by ID in the structure.
 */
export function findElementById(
  structure: ModelStructure,
  id: UUID
): StructureBoundary | StructureComponent | undefined {
  const { boundaries, components } = flattenStructure(structure);
  return boundaries.find(b => b.id === id) ?? components.find(c => c.id === id);
}
