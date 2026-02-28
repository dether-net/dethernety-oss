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
  respondsWith?: {
    label: string;
    property: string;
    value: string;
  }[] | string[];
}