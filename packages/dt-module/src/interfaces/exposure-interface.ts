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
  exploitedBy?: {
    label: string;
    property: string;
    value: string;
  }[] | string[];
}

export const VALID_ATTACK_VECTORS = new Set(['NETWORK', 'ADJACENT', 'LOCAL', 'PHYSICAL', 'UNSPECIFIED']);
