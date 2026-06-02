import { MitreRef } from './mitre-ref-interface';

export interface Exposure {
  id?: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  score?: number;
  reference?: string;
  attackVector?: string;
  mitigationTechniques?: string[];
  detectionTechniques?: string[];
  tags?: string[];
  // → EXPLOITED_BY edges to the MITRE node(s) that exploit this exposure. Widened to
  // MitreRef so each ref may carry edge `attributes` (e.g. justification); the bare-string
  // fallback contract is preserved.
  exploitedBy?: MitreRef[] | string[];
}

export const VALID_ATTACK_VECTORS = new Set(['NETWORK', 'ADJACENT', 'LOCAL', 'PHYSICAL', 'UNSPECIFIED']);
