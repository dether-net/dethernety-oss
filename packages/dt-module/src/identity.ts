import { v5 as uuidv5 } from 'uuid';
import { ASSISTANT_NAMESPACE_UUID, MODULE_CLASS_NAMESPACE_UUID } from './constants';

export type ClassKind =
  | 'analysisClasses'
  | 'componentClasses'
  | 'controlClasses'
  | 'dataClasses'
  | 'dataFlowClasses'
  | 'issueClasses'
  | 'securityBoundaryClasses';

/**
 * Derive a deterministic id for a (moduleName, classKind, className) triple.
 *
 * Same input → same UUID across processes, machines, and deployments.
 * Used by base classes that don't have an external authority (file-based,
 * neo4j-based) and by the legacy-module backwards-compat fallback in
 * `ModuleRegistryService`.
 *
 * `DtLgModule.AnalysisClass` is the one exception: it derives from
 * `uuid5(ASSISTANT_NAMESPACE_UUID, graphName)` directly (see
 * `deriveAnalysisClassId`) so the platform-side id matches what the LangGraph
 * server stores as `assistant_id`.
 */
export function deriveClassId(moduleName: string, classKind: ClassKind, className: string): string {
  return uuidv5(`${moduleName}::${classKind}::${className}`, MODULE_CLASS_NAMESPACE_UUID);
}

/**
 * Derive an AnalysisClass id from a LangGraph graph name, matching the LangGraph
 * server's own `assistant_id = uuid5(ASSISTANT_NAMESPACE_UUID, graphName)`
 * derivation. Used by `DtLgModule.getAnalysisClasses()`.
 */
export function deriveAnalysisClassId(graphName: string): string {
  return uuidv5(graphName, ASSISTANT_NAMESPACE_UUID);
}
