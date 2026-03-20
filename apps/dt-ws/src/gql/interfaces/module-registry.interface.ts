import { DTModule, DTMetadata } from '@dethernety/dt-module';

export interface ModuleEntry {
  instance: DTModule;
  metadata: DTMetadata;
  loadedAt: Date;
  filePath: string;
  version?: string;
  lastReloadAt?: Date;
  loadAttempts: number;
  isHealthy: boolean;
  /** GraphQL SDL content from the module's getSchemaExtension() method */
  schemaFragment?: string;
}

export interface ModuleHealthStatus {
  totalModules: number;
  healthyModules: number;
  unhealthyModules: number;
  lastCheckAt: Date;
  modules: ModuleHealth[];
}

export interface ModuleHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'loading' | 'failed';
  loadedAt?: Date;
  version?: string;
  error?: string;
  lastHealthCheck?: Date;
}

export interface ModuleLoadResult {
  success: boolean;
  module?: DTModule;
  metadata?: DTMetadata;
  error?: string;
  loadTime: number;
}

export interface ModuleSecurityValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ModuleLoadOptions {
  maxRetries?: number;
  timeout?: number;
  skipSecurityValidation?: boolean;
  forceReload?: boolean;
}
