export interface Exposure {
  id?: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  score?: number;
  reference?: string;
  mitigationTechniques?: string[];
  detectionTechniques?: string[];
  tags?: string[];
  exploitedBy?: {
    label: string;
    property: string;
    value: string;
  }[] | string[];
}
