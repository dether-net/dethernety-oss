import { ALLOWED_CLASS_LABELS } from '../../interfaces/module-management.interface';

/**
 * Maps ClassLabelEnum values (from the GraphQL schema) to graph node labels.
 * This is the only place where label strings are defined — all Cypher label
 * interpolation flows through this map, preventing injection.
 *
 * Shared between MatchClassesResolverService and ListClassesResolverService so
 * the same validated mapping is the single source of truth.
 */
export const CLASS_LABEL_TO_NODE_LABEL: Record<string, string> = {
  COMPONENT: 'ComponentClass',
  SECURITY_BOUNDARY: 'SecurityBoundaryClass',
  DATA_FLOW: 'DataFlowClass',
  DATA: 'DataClass',
  CONTROL: 'ControlClass',
};

/**
 * Convert a ClassLabelEnum value to the corresponding graph node label.
 * Validates against both the local map and ALLOWED_CLASS_LABELS as
 * defense-in-depth. Throws if the label is not recognised — callers must
 * never interpolate unvalidated strings into Cypher.
 */
export function classLabelToNodeLabel(classLabel: string): string {
  const nodeLabel = CLASS_LABEL_TO_NODE_LABEL[classLabel];
  if (!nodeLabel) {
    throw new Error(`Invalid classLabel: ${classLabel}`);
  }
  if (!ALLOWED_CLASS_LABELS.has(nodeLabel)) {
    throw new Error(`Node label ${nodeLabel} is not in the allowed set`);
  }
  return nodeLabel;
}
