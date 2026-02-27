/**
 * Set Instantiation Attributes Service Interfaces
 * 
 * Defines types and interfaces for the SetInstantiationAttributesService,
 * supporting component instantiation with exposures and countermeasures.
 */

import { Countermeasure, Exposure } from '@dethernety/dt-module';

// ============================================================================
// Request and Response Interfaces
// ============================================================================

/**
 * Set attributes request parameters
 */
export interface SetAttributesRequest {
  componentId: string;
  classId: string;
  attributes: Record<string, any>;
}

/**
 * Set attributes operation result
 */
export interface SetAttributesResult {
  success: boolean;
  error?: string;
  metadata?: {
    operationId: string;
    timestamp: string;
    duration: number;
    componentId: string;
    classId: string;
    componentType?: string;
    moduleName?: string;
  };
}

/**
 * External object link target definition
 */
export interface ExternalObjectTarget {
  label: string;
  property: string;
  value: string;
}

/**
 * Link to external object parameters
 */
export interface LinkExternalObjectRequest {
  elementId: string;
  elementToOriginRelation: string;
  originName: string;
  relationName: string;
  target: ExternalObjectTarget;
}

// ============================================================================
// Database Operation Interfaces
// ============================================================================

/**
 * Database transaction wrapper following Neo4j v5 patterns
 */
export interface DatabaseTransaction {
  run(query: string, parameters?: Record<string, any>): Promise<any>;
}

/**
 * Database session wrapper
 */
export interface DatabaseSession {
  executeRead<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  executeWrite<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Component metadata from database query
 */
export interface ComponentMetadata {
  moduleName: string;
  componentType: string;
}

// ============================================================================
// Exposure and Countermeasure Operations
// ============================================================================

/**
 * Upsert exposures request
 */
export interface UpsertExposuresRequest {
  componentId: string;
  exposures: Exposure[];
  classId: string;
}

/**
 * Upsert countermeasures request
 */
export interface UpsertCountermeasuresRequest {
  componentId: string;
  countermeasures: Countermeasure[];
  classId: string;
}

/**
 * Delete obsolete external objects request
 */
export interface DeleteObsoleteObjectsRequest {
  elementId: string;
  relation: string;
  validNames: string[];
  classId: string;
}

/**
 * Operation result for database operations
 */
export interface DatabaseOperationResult {
  success: boolean;
  recordsAffected?: number;
  error?: string;
}

// ============================================================================
// Validation Interfaces
// ============================================================================

/**
 * Set attributes request validation result
 */
export interface SetAttributesValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * External object target validation result
 */
export interface ExternalObjectValidationResult {
  isValid: boolean;
  error?: string;
}

// ============================================================================
// Batch Processing Interfaces
// ============================================================================

/**
 * Batch operation entry for debouncing
 */
export interface BatchOperationEntry {
  request: SetAttributesRequest;
  timestamp: number;
  resolve: (result: SetAttributesResult) => void;
  reject: (error: Error) => void;
}

/**
 * Batch processing statistics
 */
export interface BatchProcessingStatistics {
  totalBatches: number;
  totalOperations: number;
  averageBatchSize: number;
  averageWaitTime: number;
  debouncingActive: boolean;
  pendingOperations: number;
}

// ============================================================================
// Monitoring Interfaces
// ============================================================================

/**
 * Set instantiation attributes operation statistics
 */
export interface SetInstantiationStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageResponseTime: number;
  longestOperation: number;
  shortestOperation: number;
  operationsByType: {
    setAttributes: number;
    upsertExposures: number;
    upsertCountermeasures: number;
    linkExternalObjects: number;
  };
  batchProcessing: BatchProcessingStatistics;
}

/**
 * Concurrent operation tracking
 */
export interface ConcurrentOperation {
  componentId: string;
  operationId: string;
  startTime: number;
  timeout: NodeJS.Timeout;
  type: 'setAttributes' | 'batch';
}

// ============================================================================
// Error Interfaces
// ============================================================================

/**
 * Set instantiation attributes error types
 */
export type SetInstantiationErrorType = 
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'MODULE_ERROR'
  | 'TRANSACTION_ERROR'
  | 'EXTERNAL_LINK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Structured set instantiation attributes error
 */
export interface SetInstantiationError {
  type: SetInstantiationErrorType;
  message: string;
  componentId?: string;
  classId?: string;
  moduleName?: string;
  timestamp: number;
  stack?: string;
  context?: Record<string, any>;
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Set instantiation attributes resolver configuration
 */
export interface SetInstantiationConfig {
  // Batch processing settings
  batchEnabled: boolean;
  batchDebounceTime: number; // milliseconds
  maxBatchSize: number;
  
  // Operation settings
  operationTimeout: number;
  maxConcurrentOperations: number;
  
  // Database settings
  transactionTimeout: number;
  retryAttempts: number;
  
  // Monitoring settings
  enableDetailedMetrics: boolean;
  metricsRetentionPeriod: number;
}

// ============================================================================
// Module Integration Interfaces
// ============================================================================

/**
 * Module operation result for exposures/countermeasures
 */
export interface ModuleOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  moduleName: string;
  operationTime: number;
}

/**
 * Component type enumeration
 */
export type ComponentType = 'Issue' | 'Control' | 'Component' | 'DataFlow' | 'SecurityBoundary' | 'Data';

/**
 * MITRE technique reference (string or object)
 */
export type MitreTechniqueReference = string | ExternalObjectTarget;

/**
 * MITRE response reference (string or object)
 */
export type MitreResponseReference = string | ExternalObjectTarget;
