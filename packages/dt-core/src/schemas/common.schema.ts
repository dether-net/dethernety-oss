/**
 * Common types shared across all Dethernety threat model schemas.
 * These types are the foundation for both monolithic and split-file formats.
 */

/**
 * Schema version for the export/import format.
 * Used to handle migrations and backward compatibility.
 */
export const SCHEMA_VERSION = '2.0.0' as const;

/**
 * UUID string type for element identification.
 * All elements in a threat model are identified by UUIDs.
 */
export type UUID = string;

/**
 * Component types in a threat model (DFD element types).
 */
export type ComponentType = 'PROCESS' | 'EXTERNAL_ENTITY' | 'STORE';

/**
 * Class types that can be assigned to elements.
 */
export type ClassType =
  | 'PROCESS'
  | 'EXTERNAL_ENTITY'
  | 'STORE'
  | 'SECURITY_BOUNDARY'
  | 'BOUNDARY'
  | 'DATA_FLOW'
  | 'DATA'
  | 'CONTROL';

/**
 * Connection handles for data flow endpoints.
 * Determines where on a component the flow connects.
 */
export type ConnectionHandle = 'top' | 'right' | 'bottom' | 'left';

/**
 * Reference to another element by ID.
 * Used for relationships without embedding full objects.
 */
export interface ElementReference {
  /** UUID of the referenced element */
  id: UUID;
}

/**
 * Reference to a module that provides classes.
 */
export interface ModuleReference {
  /** UUID of the module */
  id: UUID;
  /** Human-readable module name */
  name: string;
  /** Optional description */
  description?: string;
}

/**
 * Reference to a class that defines element behavior and attributes.
 */
export interface ClassReference {
  /** UUID of the class */
  id: UUID;
  /** Human-readable class name */
  name: string;
  /** Optional description */
  description?: string;
  /** Class type */
  type?: ClassType;
  /** Class category within the type */
  category?: string;
  /** Module that provides this class */
  module?: ModuleReference;
}

/**
 * Reference to a model (for represented models).
 */
export interface ModelReference {
  /** UUID of the model */
  id: UUID;
  /** Human-readable model name */
  name: string;
  /** Optional description */
  description?: string;
}

/**
 * Reference to a control.
 */
export interface ControlReference {
  /** UUID of the control */
  id: UUID;
  /** Human-readable control name */
  name?: string;
}

/**
 * Position coordinates for layout.
 * Coordinates are relative to the parent boundary.
 * (0,0) is the top-left corner of the parent.
 */
export interface Position {
  /** X-coordinate in pixels, relative to parent boundary */
  x: number;
  /** Y-coordinate in pixels, relative to parent boundary */
  y: number;
}

/**
 * Dimensions for boundaries.
 */
export interface Dimensions {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Minimum width constraint */
  minWidth?: number;
  /** Minimum height constraint */
  minHeight?: number;
}

/**
 * Dynamic attributes for an element.
 * Keys and values are defined by the element's class schema.
 */
export type Attributes = Record<string, unknown>;

/**
 * Base interface for all identifiable elements.
 */
export interface Identifiable {
  /** Unique identifier for the element */
  id: UUID;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
}
