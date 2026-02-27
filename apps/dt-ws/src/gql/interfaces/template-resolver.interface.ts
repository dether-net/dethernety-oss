export interface TemplateRequest {
  type: 'template' | 'guide';
  moduleName: string;
  id?: string;
  entityType?: string; // ComponentClass, DataFlowClass, etc.
}

export interface TemplateResponse {
  content: string;
  cached: boolean;
  moduleName: string;
  id?: string;
  timestamp: Date;
  source: 'cache' | 'module' | 'fallback';
}

export interface TemplateOperationResult {
  success: boolean;
  content: string;
  cached: boolean;
  duration: number;
  source: 'cache' | 'module' | 'fallback';
  error?: string;
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ModuleTemplateInfo {
  moduleName: string;
  available: boolean;
  hasTemplate: boolean;
  hasGuide: boolean;
  lastChecked: Date;
  error?: string;
}

export interface TemplateResolverStatistics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  moduleErrors: number;
  averageResponseTime: number;
  templatesByModule: Map<string, {
    requests: number;
    cacheHits: number;
    errors: number;
  }>;
}
