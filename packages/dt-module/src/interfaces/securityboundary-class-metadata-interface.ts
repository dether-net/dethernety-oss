export interface SecurityBoundaryClassMetadata {
  id?: string;
  /**
   * A hash of what an evaluation of this class compiles; it changes whenever the class's findings could. The platform
   * re-evaluates the class's elements when it changes. Absent when the module cannot say.
   */
  policyHash?: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  icon?: string;
  properties?: object;
}