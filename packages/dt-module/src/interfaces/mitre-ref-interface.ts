/**
 * A reference from a finding (Exposure / Countermeasure) to a MITRE node.
 *
 * `label` + `property` + `value` self-describe the target node and its key
 * (e.g. `MitreAttackTechnique` / `attack_id` / `T1078`). The relationship type
 * (edge name) is decided by the field/verb the ref sits under, not by the ref
 * itself. `attributes` is free-form provenance (e.g. `justification`) copied onto
 * the graph edge — values MUST be primitives (Memgraph property model).
 */
export interface MitreRef {
  label: string;
  property: string;
  value: string;
  attributes?: Record<string, string | number | boolean>;
}
