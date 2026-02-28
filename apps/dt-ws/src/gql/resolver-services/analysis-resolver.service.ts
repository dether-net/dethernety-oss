import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import {
  AnalysisEvents,
  AnalysisSession,
  AnalysisStatus,
} from '@dethernety/dt-core';
import { PubSub, withFilter } from 'graphql-subscriptions';
import { ExtendedPubSubEngine } from '@dethernety/dt-module';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { AnalysisCacheService } from '../services/analysis-cache.service';
import {
  AnalysisMetadata,
  AnalysisRequest,
  ChatAnalysisRequest,
  ResumeAnalysisRequest,
  DocumentRequest,
  AnalysisValuesRequest,
  AnalysisOperationResult,
  AnalysisSessionResult,
  AnalysisStatusResult,
  DocumentResult,
  AnalysisValidationResult,
  DatabaseQueryResult,
  DatabaseTransaction,
  AnalysisOperationStatistics,
  LongRunningAnalysis,
  SubscriptionSession,
  PubSubHealthStatus,
  AnalysisModuleHealth,
  AnalysisError,
  AnalysisErrorType,
  AnalysisResolverConfig,
} from '../interfaces/analysis-resolver.interface';
import { AuthorizationContext } from '../interfaces/authorization.interface';
import { GqlConfig } from '../gql.config';

@Injectable()
export class AnalysisResolverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisResolverService.name);
  private readonly config: AnalysisResolverConfig;
  private readonly pubSub: ExtendedPubSubEngine;
  private readonly longRunningAnalyses = new Map<string, LongRunningAnalysis>();
  private readonly subscriptionSessions = new Map<string, SubscriptionSession>();
  private cleanupInterval: NodeJS.Timeout;
  private statistics: AnalysisOperationStatistics = {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    averageResponseTime: 0,
    longestOperation: 0,
    shortestOperation: Infinity,
    activeAnalyses: 0,
    parallelSessions: 0,
    operationsByType: {
      runAnalysis: 0,
      startChat: 0,
      resumeAnalysis: 0,
      deleteAnalysis: 0,
      getStatus: 0,
      getValues: 0,
      getDocument: 0,
    },
  };

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
    private readonly analysisCache: AnalysisCacheService,
  ) {
    const gqlConfig = this.configService.get<GqlConfig>('gql')!;
    this.config = this.analysisCache.getConfig();
    
    // Initialize PubSub with proper configuration
    this.pubSub = new PubSub<AnalysisEvents>() as unknown as ExtendedPubSubEngine;
    this.configurePubSub();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('AnalysisResolverService initializing...', {
      maxParallelAnalyses: this.config.maxParallelAnalyses,
      cacheEnabled: this.config.cacheEnabled,
      pubSubMaxListeners: this.config.pubSubMaxListeners,
    });

    this.startCleanupInterval();
    this.logger.log('AnalysisResolverService initialized successfully');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Cleanup active subscriptions
    this.subscriptionSessions.clear();
    this.longRunningAnalyses.clear();
    
    this.logger.log('AnalysisResolverService destroyed');
  }

  /**
   * Get analysis status from module (real-time data, never cached)
   * Supports long-running analyses (15+ minutes)
   */
  async getAnalysisStatus(
    id: string,
    moduleName: string,
    context?: AuthorizationContext,
  ): Promise<AnalysisStatusResult> {
    const operationId = `getStatus-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Getting analysis status', { analysisId: id, moduleName, operationId });

      // Input validation
      const validation = this.validateAnalysisRequest({ analysisId: id });
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, id, moduleName);
      }

      // Authorization check (blank implementation as per user request)
      await this.checkAuthorization(context, 'getAnalysisStatus', { analysisId: id, moduleName });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', `No module found for name: ${moduleName}`, id, moduleName);
      }

      // Call module (NO TIMEOUT - supports 15+ minute operations)
      const status = await moduleInstance.getAnalysisStatus(id);
      
      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('getStatus', true, duration, { analysisId: id, moduleName });
      
      this.logger.debug('Analysis status retrieved successfully', {
        analysisId: id,
        moduleName,
        operationId,
        duration,
        status: status.status,
      });

      return {
        success: true,
        data: status,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: id,
          moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('getStatus', false, duration, { analysisId: id, moduleName, error: error.message });
      
      this.logger.error('Failed to get analysis status', {
        analysisId: id,
        moduleName,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      // Return structured error result instead of throwing
      return {
        success: false,
        error: safeErrorMessage(error),
        data: {
          createdAt: '',
          updatedAt: '',
          status: 'error',
          interrupts: {},
          messages: [],
          metadata: { error: safeErrorMessage(error) },
        },
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: id,
          moduleName,
        },
      };
    }
  }

  /**
   * Get analysis value keys from module (real-time data, never cached)
   */
  async getAnalysisValueKeys(
    id: string,
    moduleName: string,
    context?: AuthorizationContext,
  ): Promise<AnalysisOperationResult<string[]>> {
    const operationId = `getValueKeys-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Getting analysis value keys', { analysisId: id, moduleName, operationId });

      // Input validation
      const validation = this.validateAnalysisRequest({ analysisId: id });
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, id, moduleName);
      }

      // Authorization check
      await this.checkAuthorization(context, 'getAnalysisValueKeys', { analysisId: id, moduleName });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', `No module found for name: ${moduleName}`, id, moduleName);
      }

      // Call module (NO TIMEOUT)
      const valueKeys = await moduleInstance.getAnalysisValueKeys(id);
      
      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('getValues', true, duration, { analysisId: id, moduleName });
      
      this.logger.debug('Analysis value keys retrieved successfully', {
        analysisId: id,
        moduleName,
        operationId,
        duration,
        keyCount: valueKeys.length,
      });

      return {
        success: true,
        data: valueKeys,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: id,
          moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('getValues', false, duration, { analysisId: id, moduleName, error: error.message });
      
      this.logger.error('Failed to get analysis value keys', {
        analysisId: id,
        moduleName,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: [],
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: id,
          moduleName,
        },
      };
    }
  }

  /**
   * Get analysis values from module (real-time data, never cached)
   */
  async getAnalysisValues(
    request: AnalysisValuesRequest,
    context?: AuthorizationContext,
  ): Promise<AnalysisOperationResult<Record<string, any>>> {
    const operationId = `getValues-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Getting analysis values', { 
        analysisId: request.analysisId, 
        valueKey: request.valueKey, 
        operationId 
      });

      // Input validation
      const validation = this.validateAnalysisValuesRequest(request);
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, request.analysisId);
      }

      // Get analysis metadata (can use cache for Neo4j query)
      const metadata = await this.getAnalysisMetadataWithCache(request.analysisId);
      if (!metadata) {
        throw this.createAnalysisError('ANALYSIS_NOT_FOUND', 'Analysis metadata not found', request.analysisId);
      }

      // Authorization check
      await this.checkAuthorization(context, 'getAnalysisValues', { 
        analysisId: request.analysisId, 
        moduleName: metadata.moduleName 
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', `No module found for name: ${metadata.moduleName}`, request.analysisId, metadata.moduleName);
      }

      // Call module (NO TIMEOUT)
      const values = await moduleInstance.getAnalysisValues(request.analysisId, request.valueKey);
      
      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('getValues', true, duration, { 
        analysisId: request.analysisId, 
        moduleName: metadata.moduleName,
        valueKey: request.valueKey 
      });
      
      this.logger.debug('Analysis values retrieved successfully', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        valueKey: request.valueKey,
        operationId,
        duration,
        valueSize: JSON.stringify(values).length,
      });

      return {
        success: true,
        data: values,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('getValues', false, duration, { 
        analysisId: request.analysisId, 
        valueKey: request.valueKey,
        error: error.message 
      });
      
      this.logger.error('Failed to get analysis values', {
        analysisId: request.analysisId,
        valueKey: request.valueKey,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: {},
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
        },
      };
    }
  }

  /**
   * Get analysis metadata from Neo4j database (with caching)
   * This is the only operation that can be cached as it queries the database, not modules
   */
  private async getAnalysisMetadataWithCache(analysisId: string): Promise<AnalysisMetadata | null> {
    // Try cache first
    const cached = this.analysisCache.getAnalysisMetadata(analysisId);
    if (cached) {
      this.logger.debug('Using cached analysis metadata', { analysisId, moduleName: cached.moduleName });
      return cached;
    }

    // Query database if not cached
    return await this.getAnalysisClassAndModule(analysisId);
  }

  /**
   * Get analysis class and module from Neo4j database using modern v5 patterns
   * Results are cached to avoid repeated database queries
   */
  private async getAnalysisClassAndModule(analysisId: string): Promise<AnalysisMetadata | null> {
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
    
    try {
      this.logger.debug('Querying analysis metadata from database', { analysisId });
      
      // Use modern Neo4j v5 executeRead pattern
      const result = await session.executeRead(async (tx: DatabaseTransaction) => {
        return await tx.run(
          `
          MATCH (a:Analysis {id: $analysisId})
          MATCH (a)<-[:ANALYZED_BY]-(e)
          MATCH (a)-[:IS_INSTANCE_OF]->(c:AnalysisClass)
          MATCH (c)<-[:HAS_CLASS]-(m:Module)
          RETURN c.id AS analysisClassId, m.name AS moduleName, e.id AS elementId
          `,
          { analysisId },
        );
      });
      
      if (result.records.length === 0) {
        this.logger.warn('No analysis class found for analysisId', { analysisId });
        return null;
      }
      
      const record = result.records[0];
      const metadata: AnalysisMetadata = {
        analysisClassId: record.get('analysisClassId'),
        moduleName: record.get('moduleName'),
        elementId: record.get('elementId'),
      };
      
      // Cache the result for future queries
      this.analysisCache.setAnalysisMetadata(analysisId, metadata);
      
      this.logger.debug('Analysis metadata retrieved from database', {
        analysisId,
        moduleName: metadata.moduleName,
        cached: true,
      });
      
      return metadata;
      
    } catch (error) {
      this.logger.error('Failed to get analysis metadata from database', {
        analysisId,
        error: error.message,
        stack: error.stack,
      });
      return null;
    } finally {
      await session.close();
    }
  }

  /**
   * Run analysis operation (long-running, no timeout)
   * Supports 15+ minute operations with real-time progress via subscriptions
   */
  async runAnalysis(
    request: AnalysisRequest,
    context?: AuthorizationContext,
  ): Promise<AnalysisSessionResult> {
    const operationId = `runAnalysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log('Starting analysis operation', {
        analysisId: request.analysisId,
        operationId,
        additionalParams: request.additionalParams ? Object.keys(request.additionalParams) : [],
      });

      // Input validation
      const validation = this.validateAnalysisRequest(request);
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, request.analysisId);
      }

      // Check parallel analysis limits
      if (this.longRunningAnalyses.size >= this.config.maxParallelAnalyses) {
        throw this.createAnalysisError('RESOURCE_EXHAUSTED', 
          `Maximum parallel analyses limit reached (${this.config.maxParallelAnalyses})`, 
          request.analysisId
        );
      }

      // Get analysis metadata
      const metadata = await this.getAnalysisMetadataWithCache(request.analysisId);
      if (!metadata) {
        throw this.createAnalysisError('ANALYSIS_NOT_FOUND', 'Analysis metadata not found', request.analysisId);
      }

      // Authorization check
      await this.checkAuthorization(context, 'runAnalysis', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', 
          `No module found for name: ${metadata.moduleName}`, 
          request.analysisId, 
          metadata.moduleName
        );
      }

      // Start long-running analysis (NO TIMEOUT - supports 15+ minutes)
      const session = await moduleInstance.runAnalysis(
        request.analysisId,
        metadata.analysisClassId,
        metadata.elementId,
        this.pubSub,
        request.additionalParams || {},
      );

      // Track long-running analysis
      if (session.sessionId) {
        const longRunning: LongRunningAnalysis = {
          analysisId: request.analysisId,
          sessionId: session.sessionId,
          moduleName: metadata.moduleName,
          startTime,
          lastActivity: Date.now(),
          status: 'running',
        };
        this.longRunningAnalyses.set(session.sessionId, longRunning);
        this.statistics.activeAnalyses++;
      }

      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('runAnalysis', true, duration, {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        sessionId: session.sessionId,
      });

      this.logger.log('Analysis started successfully', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        sessionId: session.sessionId,
        operationId,
        duration,
        activeAnalyses: this.statistics.activeAnalyses,
      });

      return {
        success: true,
        data: session,
        sessionId: session.sessionId,
        parallelSessions: this.longRunningAnalyses.size,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('runAnalysis', false, duration, {
        analysisId: request.analysisId,
        error: error.message,
      });

      this.logger.error('Failed to run analysis', {
        analysisId: request.analysisId,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: { sessionId: '' },
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
        },
      };
    }
  }

  /**
   * Start chat analysis operation (long-running, no timeout)
   */
  async startChat(
    request: ChatAnalysisRequest,
    context?: AuthorizationContext,
  ): Promise<AnalysisSessionResult> {
    const operationId = `startChat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log('Starting chat analysis', {
        analysisId: request.analysisId,
        operationId,
        questionLength: request.userQuestion?.length || 0,
      });

      // Input validation
      const validation = this.validateChatAnalysisRequest(request);
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, request.analysisId);
      }

      // Check parallel analysis limits
      if (this.longRunningAnalyses.size >= this.config.maxParallelAnalyses) {
        throw this.createAnalysisError('RESOURCE_EXHAUSTED', 
          `Maximum parallel analyses limit reached (${this.config.maxParallelAnalyses})`, 
          request.analysisId
        );
      }

      // Get analysis metadata
      const metadata = await this.getAnalysisMetadataWithCache(request.analysisId);
      if (!metadata) {
        throw this.createAnalysisError('ANALYSIS_NOT_FOUND', 'Analysis metadata not found', request.analysisId);
      }

      // Authorization check
      await this.checkAuthorization(context, 'startChat', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', 
          `No module found for name: ${metadata.moduleName}`, 
          request.analysisId, 
          metadata.moduleName
        );
      }

      // Start chat analysis (NO TIMEOUT - supports long conversations)
      const session = await moduleInstance.startChat(
        request.analysisId,
        metadata.analysisClassId,
        metadata.elementId,
        request.userQuestion,
        this.pubSub,
        request.additionalParams || {},
      );

      // Track long-running analysis
      if (session.sessionId) {
        const longRunning: LongRunningAnalysis = {
          analysisId: request.analysisId,
          sessionId: session.sessionId,
          moduleName: metadata.moduleName,
          startTime,
          lastActivity: Date.now(),
          status: 'running',
        };
        this.longRunningAnalyses.set(session.sessionId, longRunning);
        this.statistics.activeAnalyses++;
      }

      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('startChat', true, duration, {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        sessionId: session.sessionId,
        questionLength: request.userQuestion.length,
      });

      this.logger.log('Chat analysis started successfully', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        sessionId: session.sessionId,
        operationId,
        duration,
        activeAnalyses: this.statistics.activeAnalyses,
      });

      return {
        success: true,
        data: session,
        sessionId: session.sessionId,
        parallelSessions: this.longRunningAnalyses.size,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('startChat', false, duration, {
        analysisId: request.analysisId,
        error: error.message,
      });

      this.logger.error('Failed to start chat analysis', {
        analysisId: request.analysisId,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: { sessionId: '' },
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
        },
      };
    }
  }

  /**
   * Resume analysis operation (long-running, no timeout)
   */
  async resumeAnalysis(
    request: ResumeAnalysisRequest,
    context?: AuthorizationContext,
  ): Promise<AnalysisSessionResult> {
    const operationId = `resumeAnalysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log('Resuming analysis operation', {
        analysisId: request.analysisId,
        operationId,
        inputLength: request.userInput?.length || 0,
      });

      // Input validation
      const validation = this.validateResumeAnalysisRequest(request);
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, request.analysisId);
      }

      // Get analysis metadata
      const metadata = await this.getAnalysisMetadataWithCache(request.analysisId);
      if (!metadata) {
        throw this.createAnalysisError('ANALYSIS_NOT_FOUND', 'Analysis metadata not found', request.analysisId);
      }

      // Authorization check
      await this.checkAuthorization(context, 'resumeAnalysis', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', 
          `No module found for name: ${metadata.moduleName}`, 
          request.analysisId, 
          metadata.moduleName
        );
      }

      // Resume analysis (NO TIMEOUT - supports long operations)
      const session = await moduleInstance.resumeAnalysis(
        request.analysisId,
        metadata.analysisClassId,
        request.userInput,
        this.pubSub,
      );

      // Update long-running analysis tracking
      if (session.sessionId) {
        const existing = this.longRunningAnalyses.get(session.sessionId);
        if (existing) {
          existing.lastActivity = Date.now();
          existing.status = 'running';
        } else {
          // Create new tracking entry
          const longRunning: LongRunningAnalysis = {
            analysisId: request.analysisId,
            sessionId: session.sessionId,
            moduleName: metadata.moduleName,
            startTime,
            lastActivity: Date.now(),
            status: 'running',
          };
          this.longRunningAnalyses.set(session.sessionId, longRunning);
          this.statistics.activeAnalyses++;
        }
      }

      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('resumeAnalysis', true, duration, {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        sessionId: session.sessionId,
        inputLength: request.userInput.length,
      });

      this.logger.log('Analysis resumed successfully', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        sessionId: session.sessionId,
        operationId,
        duration,
        activeAnalyses: this.statistics.activeAnalyses,
      });

      return {
        success: true,
        data: session,
        sessionId: session.sessionId,
        parallelSessions: this.longRunningAnalyses.size,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('resumeAnalysis', false, duration, {
        analysisId: request.analysisId,
        error: error.message,
      });

      this.logger.error('Failed to resume analysis', {
        analysisId: request.analysisId,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: { sessionId: '' },
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
        },
      };
    }
  }

  /**
   * Delete analysis node from Neo4j database using modern v5 patterns
   */
  private async deleteAnalysisNode(id: string): Promise<boolean> {
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
    
    try {
      this.logger.debug('Deleting analysis node from database', { analysisId: id });
      
      // Use modern Neo4j v5 executeWrite pattern
      await session.executeWrite(async (tx: DatabaseTransaction) => {
        await tx.run(`MATCH (a:Analysis {id: $id}) DETACH DELETE a`, { id });
      });
      
      // Invalidate cache entry
      this.analysisCache.invalidateAnalysis(id);
      
      this.logger.debug('Analysis node deleted successfully', { analysisId: id });
      return true;
      
    } catch (error) {
      this.logger.error('Failed to delete analysis node', {
        analysisId: id,
        error: error.message,
        stack: error.stack,
      });
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Delete analysis operation (database + module cleanup)
   */
  async deleteAnalysis(
    analysisId: string,
    context?: AuthorizationContext,
  ): Promise<AnalysisOperationResult<boolean>> {
    const operationId = `deleteAnalysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log('Deleting analysis', { analysisId, operationId });

      // Input validation
      const validation = this.validateAnalysisRequest({ analysisId });
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, analysisId);
      }

      // Get analysis metadata before deletion
      const metadata = await this.getAnalysisMetadataWithCache(analysisId);
      if (!metadata) {
        this.logger.warn('Analysis metadata not found, proceeding with database deletion only', { analysisId });
        const dbDeleted = await this.deleteAnalysisNode(analysisId);
        return {
          success: dbDeleted,
          data: dbDeleted,
          error: dbDeleted ? undefined : 'Failed to delete analysis node',
          metadata: {
            operationId,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            analysisId,
          },
        };
      }

      // Authorization check
      await this.checkAuthorization(context, 'deleteAnalysis', {
        analysisId,
        moduleName: metadata.moduleName,
      });

      // Clean up long-running analysis tracking first
      const sessionIds = Array.from(this.longRunningAnalyses.entries())
        .filter(([_, analysis]) => analysis.analysisId === analysisId)
        .map(([sessionId]) => sessionId);

      for (const sessionId of sessionIds) {
        this.longRunningAnalyses.delete(sessionId);
        this.statistics.activeAnalyses = Math.max(0, this.statistics.activeAnalyses - 1);
      }

      // Delete from database first
      const dbDeleted = await this.deleteAnalysisNode(analysisId);
      if (!dbDeleted) {
        throw this.createAnalysisError('DATABASE_ERROR', 'Failed to delete analysis node from database', analysisId);
      }

      // Clean up module data
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      let moduleDeleted = true;
      
      if (moduleInstance && typeof moduleInstance.deleteAnalysis === 'function') {
        try {
          moduleDeleted = await moduleInstance.deleteAnalysis(analysisId);
        } catch (error) {
          this.logger.warn('Failed to delete analysis from module, but database deletion succeeded', {
            analysisId,
            moduleName: metadata.moduleName,
            error: error.message,
          });
          moduleDeleted = false;
        }
      }

      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('deleteAnalysis', true, duration, {
        analysisId,
        moduleName: metadata.moduleName,
        dbDeleted,
        moduleDeleted,
        sessionsCleared: sessionIds.length,
      });

      this.logger.log('Analysis deleted successfully', {
        analysisId,
        moduleName: metadata.moduleName,
        operationId,
        duration,
        dbDeleted,
        moduleDeleted,
        sessionsCleared: sessionIds.length,
        activeAnalyses: this.statistics.activeAnalyses,
      });

      return {
        success: true,
        data: true,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('deleteAnalysis', false, duration, {
        analysisId,
        error: error.message,
      });

      this.logger.error('Failed to delete analysis', {
        analysisId,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: false,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId,
        },
      };
    }
  }

  /**
   * Get document from module (real-time data, never cached)
   */
  async getDocument(
    request: DocumentRequest,
    context?: AuthorizationContext,
  ): Promise<DocumentResult> {
    const operationId = `getDocument-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Getting document from module', {
        analysisId: request.analysisId,
        operationId,
        filterKeys: request.filter ? Object.keys(request.filter) : [],
      });

      // Input validation
      const validation = this.validateDocumentRequest(request);
      if (!validation.isValid) {
        throw this.createAnalysisError('VALIDATION_ERROR', `Invalid request: ${validation.errors.join(', ')}`, request.analysisId);
      }

      // Get analysis metadata
      const metadata = await this.getAnalysisMetadataWithCache(request.analysisId);
      if (!metadata) {
        throw this.createAnalysisError('ANALYSIS_NOT_FOUND', 'Analysis metadata not found', request.analysisId);
      }

      // Authorization check
      await this.checkAuthorization(context, 'getDocument', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      if (!moduleInstance) {
        throw this.createAnalysisError('MODULE_NOT_FOUND', 
          `No module found for name: ${metadata.moduleName}`, 
          request.analysisId, 
          metadata.moduleName
        );
      }

      // Get document from module (NO TIMEOUT)
      const document = await moduleInstance.getDocument(
        metadata.elementId,
        request.analysisId,
        metadata.analysisClassId,
        request.filter,
      );

      // Calculate document size for metrics
      const documentSize = JSON.stringify(document).length;

      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('getDocument', true, duration, {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        documentSize,
        filterKeys: request.filter ? Object.keys(request.filter) : [],
      });

      this.logger.debug('Document retrieved successfully', {
        analysisId: request.analysisId,
        moduleName: metadata.moduleName,
        operationId,
        duration,
        documentSize,
      });

      return {
        success: true,
        data: document,
        documentSize,
        processingTime: duration,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('getDocument', false, duration, {
        analysisId: request.analysisId,
        error: error.message,
      });

      this.logger.error('Failed to get document', {
        analysisId: request.analysisId,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        data: {},
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          analysisId: request.analysisId,
        },
      };
    }
  }

  // ============================================================================
  // Validation Methods
  // ============================================================================

  private validateAnalysisRequest(request: { analysisId: string }): AnalysisValidationResult {
    const errors: string[] = [];

    if (!request.analysisId || typeof request.analysisId !== 'string') {
      errors.push('analysisId is required and must be a string');
    } else if (request.analysisId.trim().length === 0) {
      errors.push('analysisId cannot be empty');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private validateAnalysisValuesRequest(request: AnalysisValuesRequest): AnalysisValidationResult {
    const errors: string[] = [];

    if (!request.analysisId || typeof request.analysisId !== 'string') {
      errors.push('analysisId is required and must be a string');
    }

    if (!request.valueKey || typeof request.valueKey !== 'string') {
      errors.push('valueKey is required and must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private validateChatAnalysisRequest(request: ChatAnalysisRequest): AnalysisValidationResult {
    const errors: string[] = [];

    if (!request.analysisId || typeof request.analysisId !== 'string') {
      errors.push('analysisId is required and must be a string');
    }

    if (!request.userQuestion || typeof request.userQuestion !== 'string') {
      errors.push('userQuestion is required and must be a string');
    } else if (request.userQuestion.trim().length === 0) {
      errors.push('userQuestion cannot be empty');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private validateResumeAnalysisRequest(request: ResumeAnalysisRequest): AnalysisValidationResult {
    const errors: string[] = [];

    if (!request.analysisId || typeof request.analysisId !== 'string') {
      errors.push('analysisId is required and must be a string');
    }

    if (!request.userInput || typeof request.userInput !== 'string') {
      errors.push('userInput is required and must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private validateDocumentRequest(request: DocumentRequest): AnalysisValidationResult {
    const errors: string[] = [];

    if (!request.analysisId || typeof request.analysisId !== 'string') {
      errors.push('analysisId is required and must be a string');
    }

    if (!request.filter || typeof request.filter !== 'object') {
      errors.push('filter is required and must be an object');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // ============================================================================
  // Authorization and Monitoring
  // ============================================================================

  private async checkAuthorization(
    context: AuthorizationContext | undefined,
    operation: string,
    resource: Record<string, any>,
  ): Promise<void> {
    // Blank authorization implementation as per user request
    // Authorization is handled by the GraphQL schema directives
    return;
  }

  private recordOperation(
    operationType: keyof AnalysisOperationStatistics['operationsByType'],
    success: boolean,
    duration: number,
    metadata: Record<string, any> = {},
  ): void {
    this.statistics.totalOperations++;
    this.statistics.operationsByType[operationType]++;

    if (success) {
      this.statistics.successfulOperations++;
    } else {
      this.statistics.failedOperations++;
    }

    // Update response time statistics
    const totalTime = this.statistics.averageResponseTime * (this.statistics.totalOperations - 1);
    this.statistics.averageResponseTime = (totalTime + duration) / this.statistics.totalOperations;

    this.statistics.longestOperation = Math.max(this.statistics.longestOperation, duration);
    this.statistics.shortestOperation = Math.min(this.statistics.shortestOperation, duration);
    this.statistics.parallelSessions = this.longRunningAnalyses.size;

    // Record in monitoring service
    this.monitoringService.recordOperation({
      operationName: `analysis.${operationType}`,
      success,
      duration,
      timestamp: new Date(),
      metadata,
    });
  }

  private createAnalysisError(
    type: AnalysisErrorType,
    message: string,
    analysisId?: string,
    moduleName?: string,
    sessionId?: string,
  ): AnalysisError {
    return {
      type,
      message,
      analysisId,
      moduleName,
      sessionId,
      timestamp: Date.now(),
      context: {
        service: 'AnalysisResolverService',
        activeAnalyses: this.statistics.activeAnalyses,
        parallelSessions: this.longRunningAnalyses.size,
      },
    };
  }

  // ============================================================================
  // PubSub Management
  // ============================================================================

  private configurePubSub(): void {
    try {
      // Set max listeners to handle concurrent subscriptions
      (this.pubSub as any).ee?.setMaxListeners?.(this.config.pubSubMaxListeners);
      
      this.logger.debug('PubSub configured successfully', {
        maxListeners: this.config.pubSubMaxListeners,
      });
    } catch (error) {
      this.logger.warn('Could not configure PubSub EventEmitter', {
        error: error.message,
      });
    }
  }

  private trackSubscription(sessionId: string, analysisId: string, userId?: string): void {
    const session: SubscriptionSession = {
      sessionId,
      analysisId,
      userId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      isActive: true,
    };
    
    this.subscriptionSessions.set(sessionId, session);
    
    this.logger.debug('Subscription session tracked', {
      sessionId,
      analysisId,
      totalSubscriptions: this.subscriptionSessions.size,
    });
  }

  private updateSubscriptionActivity(sessionId: string): void {
    const session = this.subscriptionSessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  // ============================================================================
  // Cleanup and Health Methods
  // ============================================================================

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveAnalyses();
      this.cleanupInactiveSubscriptions();
    }, this.config.cleanupInterval);

    this.logger.debug('Cleanup interval started', {
      interval: this.config.cleanupInterval,
    });
  }

  private cleanupInactiveAnalyses(): void {
    const now = Date.now();
    const inactiveThreshold = 60 * 60 * 1000; // 1 hour of inactivity
    let cleaned = 0;

    for (const [sessionId, analysis] of this.longRunningAnalyses.entries()) {
      if (now - analysis.lastActivity > inactiveThreshold) {
        this.longRunningAnalyses.delete(sessionId);
        this.statistics.activeAnalyses = Math.max(0, this.statistics.activeAnalyses - 1);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cleaned up inactive analyses', {
        cleaned,
        remaining: this.longRunningAnalyses.size,
      });
    }
  }

  private cleanupInactiveSubscriptions(): void {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes of inactivity
    let cleaned = 0;

    for (const [sessionId, session] of this.subscriptionSessions.entries()) {
      if (now - session.lastActivity > inactiveThreshold) {
        this.subscriptionSessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cleaned up inactive subscriptions', {
        cleaned,
        remaining: this.subscriptionSessions.size,
      });
    }
  }

  // ============================================================================
  // Public API Methods
  // ============================================================================

  /**
   * Get comprehensive statistics for analysis operations
   */
  getStatistics(): AnalysisOperationStatistics {
    return {
      ...this.statistics,
      activeAnalyses: this.longRunningAnalyses.size,
      parallelSessions: this.longRunningAnalyses.size,
    };
  }

  /**
   * Reset statistics (for testing or monitoring reset)
   */
  resetStatistics(): void {
    this.statistics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageResponseTime: 0,
      longestOperation: 0,
      shortestOperation: Infinity,
      activeAnalyses: this.longRunningAnalyses.size,
      parallelSessions: this.longRunningAnalyses.size,
      operationsByType: {
        runAnalysis: 0,
        startChat: 0,
        resumeAnalysis: 0,
        deleteAnalysis: 0,
        getStatus: 0,
        getValues: 0,
        getDocument: 0,
      },
    };

    this.logger.log('Analysis resolver statistics reset');
  }

  /**
   * Get health status of analysis resolver service
   */
  getHealthStatus(): {
    isHealthy: boolean;
    statistics: AnalysisOperationStatistics;
    cache: any;
    pubSub: PubSubHealthStatus;
    longRunningAnalyses: LongRunningAnalysis[];
    issues: string[];
  } {
    const statistics = this.getStatistics();
    const cacheHealth = this.analysisCache.getHealthStatus();
    const issues: string[] = [];

    // Check for potential issues
    if (statistics.activeAnalyses > this.config.maxParallelAnalyses * 0.8) {
      issues.push('High number of active analyses');
    }

    if (statistics.failedOperations / statistics.totalOperations > 0.1 && statistics.totalOperations > 10) {
      issues.push('High failure rate detected');
    }

    if (this.subscriptionSessions.size > this.config.maxSubscriptionsPerUser * 10) {
      issues.push('High number of active subscriptions');
    }

    // Add cache issues
    issues.push(...cacheHealth.issues);

    const pubSubHealth: PubSubHealthStatus = {
      isHealthy: true,
      activeSubscriptions: this.subscriptionSessions.size,
      totalSubscriptions: this.subscriptionSessions.size,
      memoryUsage: this.subscriptionSessions.size * 100, // Rough estimate
    };

    return {
      isHealthy: issues.length === 0,
      statistics,
      cache: cacheHealth,
      pubSub: pubSubHealth,
      longRunningAnalyses: Array.from(this.longRunningAnalyses.values()),
      issues,
    };
  }

  // ============================================================================
  // GraphQL Resolver Interface
  // ============================================================================

  getResolvers() {
    return {
      Analysis: {
        status: async ({ id, analysisClass }, _args, context) => {
          const moduleName = analysisClass?.[0]?.module?.[0]?.name || '';
          if (!moduleName) {
            this.logger.warn('No module name found for analysis status', { analysisId: id });
            return {
              createdAt: '',
              updatedAt: '',
              status: 'error',
              interrupts: {},
              messages: [],
              metadata: { error: 'Module not found' },
            };
          }

          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.getAnalysisStatus(id, moduleName, authContext);
          return result.data;
        },
        
        valueKeys: async ({ id, analysisClass }, _args, context) => {
          const moduleName = analysisClass?.[0]?.module?.[0]?.name || '';
          if (!moduleName) {
            this.logger.warn('No module name found for analysis value keys', { analysisId: id });
            return [];
          }

          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.getAnalysisValueKeys(id, moduleName, authContext);
          return result.data || [];
        },
      },
      
      Query: {
        getAnalysisValues: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.getAnalysisValues({
            analysisId: args.analysisId,
            valueKey: args.valueKey,
          }, authContext);
          return result.data || {};
        },
        
        getDocument: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.getDocument({
            analysisId: args.analysisId,
            filter: args.filter,
          }, authContext);
          return result.data || {};
        },
      },
      
      Mutation: {
        runAnalysis: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.runAnalysis({
            analysisId: args.analysisId,
            additionalParams: args.additionalParams,
          }, authContext);
          return result.data || { sessionId: '' };
        },
        
        startChat: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.startChat({
            analysisId: args.analysisId,
            userQuestion: args.userQuestion,
            additionalParams: args.additionalParams,
          }, authContext);
          return result.data || { sessionId: '' };
        },
        
        resumeAnalysis: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.resumeAnalysis({
            analysisId: args.analysisId,
            userInput: args.userInput,
          }, authContext);
          return result.data || { sessionId: '' };
        },
        
        deleteAnalysis: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const result = await this.deleteAnalysis(args.analysisId, authContext);
          return result.data || false;
        },
      },
      
      Subscription: {
        streamResponse: {
          subscribe: withFilter(
            () => {
              return this.pubSub.asyncIterableIterator('streamResponse');
            },
            (payload, variables, context) => {
              // Track subscription activity
              if (variables.sessionId) {
                this.updateSubscriptionActivity(variables.sessionId);
              }
              
              return payload.sessionId === variables.sessionId;
            },
          ),
          
          resolve: (payload) => {
            if (!payload) {
              this.logger.error('No payload received in subscription resolve function');
              return {
                content: '',
                id: '',
                type: 'error',
                name: 'Error',
                example: false,
                tool_calls: [],
                invalid_tool_calls: [],
                usage_metadata: {},
                tool_call_chunks: [],
              };
            }
            
            // Log subscription activity for monitoring
            this.logger.debug('Subscription response delivered', {
              sessionId: payload.sessionId,
              type: payload.streamResponse?.type,
            });
            
            return payload.streamResponse;
          },
        },
      },
    };
  }
}
