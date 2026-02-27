import { DTMetadata } from '@dethernety/dt-module';

export interface ModuleClassDefinition {
  key: keyof DTMetadata;
  label: string;
}

export interface FlattenedProperties {
  [key: string]: any;
}

export interface ModuleInfo {
  name: string;
  path?: string;
}

export interface UpsertResult {
  moduleId: string;
  moduleName: string;
  classesProcessed: number;
  duration: number;
}

export interface ModuleOperationOptions {
  skipValidation?: boolean;
  timeout?: number;
  retryCount?: number;
}

export interface ModuleStatistics {
  totalModules: number;
  totalClasses: number;
  operationCount: number;
  averageOperationTime: number;
  lastOperationAt?: Date;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ModuleValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface DatabaseTransaction {
  run(query: string, parameters?: any): Promise<any>;
}

export interface QueryResult {
  records: Array<{
    get(key: string): any;
  }>;
}

// Allowed class labels for security
export const ALLOWED_CLASS_LABELS = new Set([
  'ComponentClass',
  'DataFlowClass',
  'SecurityBoundaryClass', 
  'ControlClass',
  'DataClass',
  'AnalysisClass',
  'IssueClass',
]);

// Module class configurations
export const MODULE_CLASS_CONFIGS: ModuleClassDefinition[] = [
  { key: 'componentClasses', label: 'ComponentClass' },
  { key: 'dataFlowClasses', label: 'DataFlowClass' },
  { key: 'securityBoundaryClasses', label: 'SecurityBoundaryClass' },
  { key: 'controlClasses', label: 'ControlClass' },
  { key: 'dataClasses', label: 'DataClass' },
  { key: 'analysisClasses', label: 'AnalysisClass' },
  { key: 'issueClasses', label: 'IssueClass' },
];
