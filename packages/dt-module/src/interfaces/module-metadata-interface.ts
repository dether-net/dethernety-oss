import { ComponentClassMetadata } from './component-class-metadata-interface';
import { DataFlowClassMetadata } from './dataflow-class-metadata-interface';
import { SecurityBoundaryClassMetadata } from './securityboundary-class-metadata-interface';
import { DataClassMetadata } from './data-class-metadata-interface';
import { ControlClassMetadata } from './control-class-metadata-interface';
import { AnalysisClassMetadata } from './analysis-class-metadata-interface';
import { IssueClassMetadata } from './issue-class-metadata-interface';

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
}
