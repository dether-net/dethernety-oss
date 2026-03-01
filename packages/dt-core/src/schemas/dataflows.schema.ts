/**
 * Data flows schema for Dethernety threat models.
 *
 * Data flows represent the movement of data between components.
 * They are the "edges" in the threat model graph, connecting
 * components (nodes) together.
 *
 * Data flows are stored separately from the structure because:
 * - They reference components by ID (not embedded)
 * - They can be added/removed independently
 * - They have their own attributes that can be large
 */

import type {
  UUID,
  ConnectionHandle,
  ElementReference,
  ClassReference,
  ControlReference,
  Identifiable,
  Attributes,
} from './common.schema.js';

/**
 * Data flow connecting two components.
 *
 * Data flows have a source and target component, and optionally
 * specify which connection handles to use for visual routing.
 */
export interface DataFlow extends Identifiable {
  /** Source component of the flow */
  source: ElementReference;

  /** Target component of the flow */
  target: ElementReference;

  /** Connection point on source component */
  sourceHandle?: ConnectionHandle;

  /** Connection point on target component */
  targetHandle?: ConnectionHandle;

  /** Class assigned to this data flow */
  classData?: ClassReference;

  /** Controls associated with this data flow */
  controls?: ControlReference[];

  /** Data items carried by this flow */
  dataItemIds?: UUID[];

  /**
   * Inline attributes for the data flow.
   * In split-file format, this may be empty with attributes stored separately.
   * In monolithic format, attributes are included here.
   */
  attributes?: Attributes;
}

/**
 * Data flows collection - the content of `dataflows.json`.
 *
 * Contains all data flows in the model, stored as a flat array.
 * Flows reference components by ID, so the structure must be
 * loaded first to resolve references.
 */
export interface DataFlowsFile {
  /** All data flows in the model */
  dataFlows: DataFlow[];
}

/**
 * Data flow validation result.
 */
export interface DataFlowValidation {
  valid: boolean;
  errors: DataFlowValidationError[];
}

/**
 * Data flow validation error.
 */
export interface DataFlowValidationError {
  flowId: UUID;
  flowName: string;
  errorType: 'missing_source' | 'missing_target' | 'self_loop' | 'invalid_handle';
  message: string;
}

/**
 * Validate data flows against available component IDs.
 * Returns validation errors for flows with missing sources/targets.
 */
export function validateDataFlows(
  flows: DataFlow[],
  validComponentIds: Set<UUID>
): DataFlowValidation {
  const errors: DataFlowValidationError[] = [];

  for (const flow of flows) {
    if (!validComponentIds.has(flow.source.id)) {
      errors.push({
        flowId: flow.id,
        flowName: flow.name,
        errorType: 'missing_source',
        message: `Source component ${flow.source.id} not found`,
      });
    }

    if (!validComponentIds.has(flow.target.id)) {
      errors.push({
        flowId: flow.id,
        flowName: flow.name,
        errorType: 'missing_target',
        message: `Target component ${flow.target.id} not found`,
      });
    }

    if (flow.source.id === flow.target.id) {
      errors.push({
        flowId: flow.id,
        flowName: flow.name,
        errorType: 'self_loop',
        message: 'Data flow cannot connect a component to itself',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get all unique component IDs referenced by data flows.
 * Useful for determining which components are connected.
 */
export function getReferencedComponentIds(flows: DataFlow[]): Set<UUID> {
  const ids = new Set<UUID>();
  for (const flow of flows) {
    ids.add(flow.source.id);
    ids.add(flow.target.id);
  }
  return ids;
}

/**
 * Get flows connected to a specific component.
 */
export function getFlowsForComponent(
  flows: DataFlow[],
  componentId: UUID
): { incoming: DataFlow[]; outgoing: DataFlow[] } {
  return {
    incoming: flows.filter(f => f.target.id === componentId),
    outgoing: flows.filter(f => f.source.id === componentId),
  };
}

/**
 * Build an adjacency list from data flows.
 * Useful for graph algorithms (reachability, cycles, etc.).
 */
export function buildAdjacencyList(
  flows: DataFlow[]
): Map<UUID, UUID[]> {
  const adjacency = new Map<UUID, UUID[]>();

  for (const flow of flows) {
    const existing = adjacency.get(flow.source.id) ?? [];
    existing.push(flow.target.id);
    adjacency.set(flow.source.id, existing);
  }

  return adjacency;
}
