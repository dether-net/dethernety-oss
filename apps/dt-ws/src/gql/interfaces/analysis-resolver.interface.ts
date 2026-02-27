/**
 * Analysis Resolver Service Interfaces
 * 
 * Defines types and interfaces for the AnalysisResolverService,
 * supporting long-running AI analysis operations with real-time subscriptions.
 */

import { AnalysisStatus, AnalysisSession } from '@dethernety/dt-core';

// ============================================================================
// Analysis Operation Interfaces
// ============================================================================

/**
 * Analysis metadata cached from Neo4j database operations
 */
export interface AnalysisMetadata {
  analysisClassId: string;
  moduleName: string;
  elementId: string;
}

/**
 * Analysis request parameters
 */
export interface AnalysisRequest {
  analysisId: string;
  additionalParams?: Record<string, any>;
}

/**
 * Chat analysis request parameters
 */
export interface ChatAnalysisRequest extends AnalysisRequest {
  userQuestion: string;
}

/**
 * Resume analysis request parameters
 */
export interface ResumeAnalysisRequest {
  analysisId: string;
  userInput: string;
}

/**
 * Document query request parameters
 */
export interface DocumentRequest {
  analysisId: string;
  filter: Record<string, any>;
}

/**
 * Analysis values request parameters
 */
export interface AnalysisValuesRequest {
  analysisId: string;
  valueKey: string;
}

// ============================================================================
// Operation Result Interfaces
// ============================================================================

/**
 * Generic analysis operation result
 */
export interface AnalysisOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    operationId: string;
    timestamp: string;
    duration?: number;
    analysisId?: string;
    moduleName?: string;
  };
}

/**
 * Analysis session result with enhanced metadata
 */
export interface AnalysisSessionResult extends AnalysisOperationResult<AnalysisSession> {
  sessionId?: string;
  estimatedDuration?: number;
  parallelSessions?: number;
}

/**
 * Analysis status result with caching metadata
 */
export interface AnalysisStatusResult extends AnalysisOperationResult<AnalysisStatus> {
  cached?: boolean;
  cacheAge?: number;
}

/**
 * Document retrieval result
 */
export interface DocumentResult extends AnalysisOperationResult<Record<string, any>> {
  documentSize?: number;
  processingTime?: number;
}

// ============================================================================
// Validation Interfaces
// ============================================================================

/**
 * Analysis request validation result
 */
export interface AnalysisValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Analysis input validation
 */
export interface AnalysisInputValidation {
  analysisId: {
    isValid: boolean;
    error?: string;
  };
  moduleName?: {
    isValid: boolean;
    error?: string;
  };
  additionalParams?: {
    isValid: boolean;
    error?: string;
  };
}

// ============================================================================
// Database Operation Interfaces
// ============================================================================

/**
 * Database query result for analysis metadata
 */
export interface DatabaseQueryResult {
  success: boolean;
  records: any[];
  summary?: any;
  error?: string;
}

/**
 * Database transaction wrapper
 */
export interface DatabaseTransaction {
  run(query: string, parameters?: Record<string, any>): Promise<any>;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
}

// ============================================================================
// Cache Interfaces
// ============================================================================

/**
 * Analysis metadata cache entry
 */
export interface AnalysisMetadataCacheEntry {
  metadata: AnalysisMetadata;
  timestamp: number;
  ttl: number;
  hits: number;
}

/**
 * Analysis cache statistics
 */
export interface AnalysisCacheStatistics {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  averageAge: number;
  memoryUsage: number;
}

// ============================================================================
// Monitoring Interfaces
// ============================================================================

/**
 * Analysis operation statistics
 */
export interface AnalysisOperationStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageResponseTime: number;
  longestOperation: number;
  shortestOperation: number;
  activeAnalyses: number;
  parallelSessions: number;
  operationsByType: {
    runAnalysis: number;
    startChat: number;
    resumeAnalysis: number;
    deleteAnalysis: number;
    getStatus: number;
    getValues: number;
    getDocument: number;
  };
}

/**
 * Long-running analysis tracking
 */
export interface LongRunningAnalysis {
  analysisId: string;
  sessionId: string;
  moduleName: string;
  startTime: number;
  estimatedEndTime?: number;
  lastActivity: number;
  status: 'running' | 'waiting' | 'streaming' | 'completed' | 'failed';
  progressPercentage?: number;
}

// ============================================================================
// PubSub and Subscription Interfaces
// ============================================================================

/**
 * Subscription session tracking
 */
export interface SubscriptionSession {
  sessionId: string;
  analysisId: string;
  userId?: string;
  startTime: number;
  lastActivity: number;
  isActive: boolean;
}

/**
 * PubSub health status
 */
export interface PubSubHealthStatus {
  isHealthy: boolean;
  activeSubscriptions: number;
  totalSubscriptions: number;
  memoryUsage: number;
  lastError?: string;
  lastErrorTime?: number;
}

// ============================================================================
// Module Integration Interfaces
// ============================================================================

/**
 * Module health check for analysis operations
 */
export interface AnalysisModuleHealth {
  moduleName: string;
  isHealthy: boolean;
  activeAnalyses: number;
  averageResponseTime: number;
  lastSuccessfulOperation?: number;
  lastError?: string;
  capabilities: {
    supportsAnalysis: boolean;
    supportsChat: boolean;
    supportsResume: boolean;
    supportsDocument: boolean;
    supportsValues: boolean;
  };
}

// ============================================================================
// Error Interfaces
// ============================================================================

/**
 * Analysis-specific error types
 */
export type AnalysisErrorType = 
  | 'ANALYSIS_NOT_FOUND'
  | 'MODULE_NOT_FOUND'
  | 'MODULE_ERROR'
  | 'DATABASE_ERROR'
  | 'VALIDATION_ERROR'
  | 'SUBSCRIPTION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'RESOURCE_EXHAUSTED'
  | 'UNKNOWN_ERROR';

/**
 * Structured analysis error
 */
export interface AnalysisError {
  type: AnalysisErrorType;
  message: string;
  analysisId?: string;
  moduleName?: string;
  sessionId?: string;
  timestamp: number;
  stack?: string;
  context?: Record<string, any>;
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Analysis resolver configuration
 */
export interface AnalysisResolverConfig {
  // Cache settings (for Neo4j operations only)
  cacheEnabled: boolean;
  cacheTtl: number;
  maxCacheSize: number;
  
  // Operation settings
  maxParallelAnalyses: number;
  cleanupInterval: number;
  
  // Subscription settings
  maxSubscriptionsPerUser: number;
  subscriptionCleanupInterval: number;
  
  // Monitoring settings
  enableDetailedMetrics: boolean;
  metricsRetentionPeriod: number;
  
  // PubSub settings
  pubSubMaxListeners: number;
  pubSubMemoryThreshold: number;
}
