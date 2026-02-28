export interface ControlClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  compatibleTypes?: string[];
  compatibleCategories?: string[];
  icon?: string;
  properties?: object;
}