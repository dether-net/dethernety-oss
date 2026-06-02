import { MitreRef } from './mitre-ref-interface';

export interface Countermeasure {
  id?: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  score?: number;
  reference?: string;
  addressedExposures?: string[];
  tags?: string[];

  // Identity block → RESPONDS_WITH edges (MITRE Mitigation + D3FEND technique this
  // control implements). Widened to MitreRef so the ref may carry edge `attributes`;
  // the bare-string fallback contract is preserved.
  respondsWith?: MitreRef[] | string[];

  // Verb blocks → COUNTERMEASURE_<VERB> edges to MitreAttackTechnique (how this control
  // counters each technique). Closed set — adding a verb is a deliberate cross-layer change
  // (this interface + the dt-ws verb→edge map + the GraphQL schema). Each countermeasure
  // populates only the verbs its policy emits.
  mitigates?: MitreRef[];
  protectsAgainst?: MitreRef[];
  detects?: MitreRef[];
  isolates?: MitreRef[];
  deceives?: MitreRef[];
  evicts?: MitreRef[];
  restores?: MitreRef[];
  respondsTo?: MitreRef[];
}
