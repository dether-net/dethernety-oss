import { ComponentClassMetadata } from './component-class-metadata-interface';
import { DataFlowClassMetadata } from './dataflow-class-metadata-interface';
import { SecurityBoundaryClassMetadata } from './securityboundary-class-metadata-interface';
import { DataClassMetadata } from './data-class-metadata-interface';
import { ControlClassMetadata } from './control-class-metadata-interface';
import { AnalysisClassMetadata } from './analysis-class-metadata-interface';
import { IssueClassMetadata } from './issue-class-metadata-interface';

/**
 * How the platform should react when a class's stored id no longer matches
 * the module's declared id at upsert. Dispatched in the upsert path; field
 * is declared here so module authors can set it ahead of the dispatch logic
 * (which lands in a later sprint).
 *
 * - `strict`: reject the conflicting class's upsert; module + other classes
 *   continue. Operator resolves via admin mutation.
 * - `audit` (default): in-place rebind, append old id to `idAliases`, emit
 *   structured event. The first-major-release default — random-uuid-era data
 *   would otherwise produce strict-mode rejections on every install.
 * - `silent`: same as `audit` but no event emission. Reserved for noisy
 *   bulk-migration windows.
 */
export type IdRebindPolicy = 'strict' | 'audit' | 'silent';

export interface DTMetadata {
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  componentClasses?: ComponentClassMetadata[];
  dataFlowClasses?: DataFlowClassMetadata[];
  securityBoundaryClasses?: SecurityBoundaryClassMetadata[];
  dataClasses?: DataClassMetadata[];
  controlClasses?: ControlClassMetadata[];
  analysisClasses?: AnalysisClassMetadata[];
  issueClasses?: IssueClassMetadata[];
  author?: string;
  idRebindPolicy?: IdRebindPolicy;
}
