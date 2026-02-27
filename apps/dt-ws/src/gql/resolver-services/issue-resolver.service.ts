import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { 
  AuthorizationContext, 
  OperationContext 
} from '../interfaces/authorization.interface';
import {
  IssueAttributes,
  SyncMetadata,
  SyncedAttributesResponse,
  IssueResolverInput,
  SyncRequest,
  SyncResult,
  SyncValidationResult,
  IssueOperationStatistics,
  DatabaseOperationResult,
} from '../interfaces/issue-resolver.interface';
import { GqlConfig } from '../gql.config';

@Injectable()
export class IssueResolverService {
  private readonly logger = new Logger(IssueResolverService.name);
  private readonly config: GqlConfig;
  private readonly syncMutex = new Map<string, Promise<SyncedAttributesResponse>>();
  private readonly operationTimeout = 30000; // 30 seconds for external sync operations
  private readonly statistics: IssueOperationStatistics = {
    totalSyncRequests: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    averageSyncTime: 0,
    syncsByModule: new Map(),
  };

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
  ) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    
    this.logger.log('IssueResolverService initialized', {
      operationTimeout: this.operationTimeout,
    });
  }

  /**
   * Validates sync request parameters
   */
  private validateSyncRequest(request: SyncRequest): SyncValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!request.issueId || typeof request.issueId !== 'string') {
      errors.push('Issue ID is required and must be a string');
    }

    if (request.issueId && request.issueId.trim().length === 0) {
      errors.push('Issue ID cannot be empty');
    }

    if (request.issueId && request.issueId.length > 200) {
      errors.push('Issue ID too long (max 200 characters)');
    }

    if (!request.moduleName || typeof request.moduleName !== 'string') {
      errors.push('Module name is required and must be a string');
    }

    if (request.moduleName && request.moduleName.trim().length === 0) {
      errors.push('Module name cannot be empty');
    }

    if (request.moduleName && request.moduleName.length > 100) {
      errors.push('Module name too long (max 100 characters)');
    }

    // Validate module name format
    if (request.moduleName && !/^[a-zA-Z0-9_.-]+$/.test(request.moduleName)) {
      warnings.push('Module name contains special characters');
    }

    // Validate lastSyncAt format if provided
    if (request.lastSyncAt && request.lastSyncAt !== null) {
      try {
        new Date(request.lastSyncAt);
      } catch {
        errors.push('Invalid lastSyncAt date format');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Updates the lastSyncAt timestamp for an issue using modern Neo4j v5 patterns
   */
  private async setSyncedDate(issueId: string): Promise<DatabaseOperationResult<string>> {
    const startTime = Date.now();
    const syncedAt = new Date().toISOString();
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });

    try {
      this.logger.debug('Setting synced date', { issueId, syncedAt });

      // Use modern Neo4j v5 executeWrite pattern
      const result = await session.executeWrite(async (tx: any) => {
        return await tx.run(
          'MATCH (i:Issue {id: $issueId}) SET i.lastSyncAt = $syncedAt RETURN i.lastSyncAt AS lastSyncAt',
          { issueId, syncedAt },
        );
      });

      const returnedSyncedAt = result.records[0]?.get('lastSyncAt') || syncedAt;
      const duration = Date.now() - startTime;

      this.logger.debug('Synced date updated successfully', {
        issueId,
        syncedAt: returnedSyncedAt,
        duration,
      });

      return {
        success: true,
        data: returnedSyncedAt,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to set synced date', {
        issueId,
        error: error.message,
        stack: error.stack,
        duration,
      });

      return {
        success: false,
        error: error.message,
        duration,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Records sync operation statistics
   */
  private recordSyncOperation(moduleName: string, success: boolean, duration: number): void {
    this.statistics.totalSyncRequests++;
    
    if (success) {
      this.statistics.successfulSyncs++;
    } else {
      this.statistics.failedSyncs++;
    }

    // Update average sync time
    const totalTime = this.statistics.averageSyncTime * (this.statistics.totalSyncRequests - 1) + duration;
    this.statistics.averageSyncTime = totalTime / this.statistics.totalSyncRequests;

    // Update module-specific statistics
    const moduleStats = this.statistics.syncsByModule.get(moduleName) || {
      requests: 0,
      successes: 0,
      failures: 0,
      averageTime: 0,
    };

    moduleStats.requests++;
    if (success) {
      moduleStats.successes++;
    } else {
      moduleStats.failures++;
    }

    const moduleTime = moduleStats.averageTime * (moduleStats.requests - 1) + duration;
    moduleStats.averageTime = moduleTime / moduleStats.requests;

    this.statistics.syncsByModule.set(moduleName, moduleStats);
  }

  /**
   * Synchronizes issue attributes with external system via module
   * NO CACHING - Always fetches fresh data from external systems
   */
  private async getUpdatedIssue(
    issueId: string,
    attributes: string | null,
    moduleName: string,
    lastSyncAt: string | null,
    context?: AuthorizationContext,
  ): Promise<SyncResult> {
    const startTime = Date.now();

    try {
      // Create sync request for validation
      const syncRequest: SyncRequest = {
        issueId,
        attributes,
        moduleName,
        lastSyncAt,
      };

      // Input validation
      const validation = this.validateSyncRequest(syncRequest);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        this.logger.warn('Sync request warnings', {
          issueId,
          moduleName,
          warnings: validation.warnings,
        });
      }

      // Authorization check (currently pass-through)
      if (context) {
        const authResult = await this.authorizationService.checkAuthorization(context, {
          operationType: 'query',
          operationName: 'syncIssueAttributes',
          resourceType: 'issue',
          resourceId: issueId,
        });

        if (!authResult.allowed) {
          throw new Error(`Authorization failed: ${authResult.reason}`);
        }
      }

      this.logger.log('Starting issue synchronization', {
        issueId,
        moduleName,
        lastSyncAt,
        userId: context?.user?.id,
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
      if (!moduleInstance) {
        throw new Error(`No module found: ${moduleName}`);
      }

      if (!moduleInstance.getSyncedIssueAttributes) {
        throw new Error(
          `No getSyncedIssueAttributes method found for module ${moduleName}`,
        );
      }

      // Sync with external system (with timeout)
      const syncedAttributes = await Promise.race([
        moduleInstance.getSyncedIssueAttributes(issueId, attributes, lastSyncAt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Sync operation timeout')), this.operationTimeout)
        ),
      ]);

      // Update database with sync timestamp
      const syncDateResult = await this.setSyncedDate(issueId);
      const syncedAt = syncDateResult.success ? syncDateResult.data! : new Date().toISOString();

      if (!syncDateResult.success) {
        this.logger.warn('Failed to update sync timestamp in database', {
          issueId,
          error: syncDateResult.error,
        });
      }

      const parsedAttributes = this.parseAttributes(syncedAttributes);
      const duration = Date.now() - startTime;

      // Record successful operation
      this.recordSyncOperation(moduleName, true, duration);
      this.monitoringService.recordOperation({
        operationName: 'syncIssueAttributes',
        duration,
        success: true,
        timestamp: new Date(),
        metadata: { issueId, moduleName, attributeCount: Object.keys(parsedAttributes).length },
      });

      this.logger.log('Issue synchronization completed successfully', {
        issueId,
        moduleName,
        duration,
        attributeCount: Object.keys(parsedAttributes).length,
        syncedAt,
      });

      return {
        success: true,
        attributes: parsedAttributes,
        metadata: {
          lastSyncAt: lastSyncAt || '',
          syncedAt,
          synced: true,
          message: null,
        },
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed operation
      this.recordSyncOperation(moduleName, false, duration);
      this.monitoringService.recordOperation({
        operationName: 'syncIssueAttributes',
        duration,
        success: false,
        timestamp: new Date(),
        metadata: { issueId, moduleName, error: error.message },
      });

      this.logger.error('Issue synchronization failed', {
        issueId,
        moduleName,
        error: error.message,
        stack: error.stack,
        duration,
        userId: context?.user?.id,
      });

      // Return fallback with local attributes
      return {
        success: false,
        attributes: this.parseAttributes(attributes),
        metadata: {
          lastSyncAt: lastSyncAt || '',
          syncedAt: lastSyncAt || new Date().toISOString(),
          synced: false,
          message: error.message,
        },
        duration,
        error: error.message,
      };
    }
  }

  /**
   * Safely parses JSON attributes with comprehensive error handling
   */
  private parseAttributes(attributesJson: string | null): IssueAttributes {
    if (!attributesJson) {
      return {};
    }

    if (typeof attributesJson !== 'string') {
      this.logger.warn('Attributes is not a string, returning empty object', {
        type: typeof attributesJson,
        value: attributesJson,
      });
      return {};
    }

    try {
      const parsed = JSON.parse(attributesJson);
      
      // Ensure parsed result is an object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.logger.warn('Parsed attributes is not a valid object', {
          type: typeof parsed,
          isArray: Array.isArray(parsed),
          isNull: parsed === null,
        });
        return {};
      }

      return parsed;
    } catch (error) {
      this.logger.error('Failed to parse attributes JSON', {
        error: error.message,
        attributesJson: attributesJson?.substring(0, 200), // Log first 200 chars
      });
      return {};
    }
  }

  /**
   * Validates GraphQL resolver input parameters
   */
  private validateResolverInput(input: IssueResolverInput): SyncValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.id || typeof input.id !== 'string') {
      errors.push('Issue ID is required and must be a string');
    }

    if (!input.issueClass || !Array.isArray(input.issueClass) || input.issueClass.length === 0) {
      errors.push('Issue class is required and must be a non-empty array');
    } else {
      const issueClassData = input.issueClass[0];
      if (!issueClassData || !issueClassData.module || !Array.isArray(issueClassData.module) || issueClassData.module.length === 0) {
        errors.push('Issue class must contain module information');
      } else {
        const moduleData = issueClassData.module[0];
        if (!moduleData || !moduleData.name) {
          errors.push('Module must have a name');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Gets service statistics for monitoring
   */
  getStatistics(): IssueOperationStatistics {
    return {
      totalSyncRequests: this.statistics.totalSyncRequests,
      successfulSyncs: this.statistics.successfulSyncs,
      failedSyncs: this.statistics.failedSyncs,
      averageSyncTime: Math.round(this.statistics.averageSyncTime),
      syncsByModule: new Map(this.statistics.syncsByModule),
    };
  }

  /**
   * Resets service statistics (useful for testing)
   */
  resetStatistics(): void {
    this.statistics.totalSyncRequests = 0;
    this.statistics.successfulSyncs = 0;
    this.statistics.failedSyncs = 0;
    this.statistics.averageSyncTime = 0;
    this.statistics.syncsByModule.clear();
    
    this.logger.log('Issue resolver statistics reset');
  }

  /**
   * Gets service health status
   */
  getHealthStatus() {
    const monitoringHealth = this.monitoringService.getHealthStatus();
    const successRate = this.statistics.totalSyncRequests > 0 
      ? (this.statistics.successfulSyncs / this.statistics.totalSyncRequests) * 100 
      : 100;

    return {
      healthy: monitoringHealth.healthy && successRate >= 85, // Consider healthy if 85%+ success rate
      monitoring: monitoringHealth,
      syncStatistics: {
        successRate: Math.round(successRate * 100) / 100,
        averageSyncTime: Math.round(this.statistics.averageSyncTime),
        totalSyncRequests: this.statistics.totalSyncRequests,
        activeModules: this.statistics.syncsByModule.size,
      },
    };
  }

  getResolvers() {
    return {
      Issue: {
        syncedAttributes: async (
          { id, attributes, issueClass, lastSyncAt }: IssueResolverInput,
          context?: any
        ): Promise<SyncedAttributesResponse> => {
          const startTime = Date.now();
          
          // Extract authorization context
          const authContext = this.authorizationService.extractAuthContext(context);
          
          this.logger.debug('Issue syncedAttributes resolver called', { 
            id, 
            userId: authContext.user?.id,
            hasIssueClass: !!issueClass,
          });

          try {
            // Input validation
            const validation = this.validateResolverInput({ id, attributes, issueClass, lastSyncAt });
            if (!validation.isValid) {
              this.logger.error('Resolver input validation failed', {
                id,
                errors: validation.errors,
                userId: authContext.user?.id,
              });

              return {
                attributes: this.parseAttributes(attributes),
                _metadata: {
                  lastSyncAt: lastSyncAt || '',
                  syncedAt: new Date().toISOString(),
                  synced: false,
                  message: `Validation failed: ${validation.errors.join(', ')}`,
                },
              };
            }

            // Check for existing sync operation (mutex)
            if (this.syncMutex.has(id)) {
              this.logger.debug('Concurrent sync detected, waiting for existing operation', {
                id,
                userId: authContext.user?.id,
              });
              
              return await this.syncMutex.get(id)!;
            }

            // Extract module name safely
            const moduleName = issueClass[0]?.module[0]?.name;
            if (!moduleName) {
              this.logger.warn('No module name found for issue, returning local attributes', {
                id,
                userId: authContext.user?.id,
              });

              return {
                attributes: this.parseAttributes(attributes),
                _metadata: {
                  lastSyncAt: lastSyncAt || '',
                  syncedAt: lastSyncAt || new Date().toISOString(),
                  synced: false,
                  message: 'No module name found for issue',
                },
              };
            }

            // Create sync promise with enhanced error handling
            const syncPromise = this.performSyncWithFallback(
              id,
              attributes,
              moduleName,
              lastSyncAt,
              authContext,
            );

            this.syncMutex.set(id, syncPromise);

            try {
              return await syncPromise;
            } finally {
              this.syncMutex.delete(id);
            }

          } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error('Issue resolver failed with unexpected error', {
              id,
              error: error.message,
              stack: error.stack,
              duration,
              userId: authContext.user?.id,
            });

            // Return fallback response
            return {
              attributes: this.parseAttributes(attributes),
              _metadata: {
                lastSyncAt: lastSyncAt || '',
                syncedAt: new Date().toISOString(),
                synced: false,
                message: `Resolver error: ${error.message}`,
              },
            };
          }
        },
      },
    };
  }

  /**
   * Performs sync with comprehensive fallback handling
   */
  private async performSyncWithFallback(
    issueId: string,
    attributes: string | null,
    moduleName: string,
    lastSyncAt: string | null,
    authContext: AuthorizationContext,
  ): Promise<SyncedAttributesResponse> {
    try {
      const syncResult = await this.getUpdatedIssue(
        issueId,
        attributes,
        moduleName,
        lastSyncAt,
        authContext,
      );

      return {
        attributes: syncResult.attributes,
        _metadata: syncResult.metadata,
      };

    } catch (error) {
      this.logger.error('Sync operation failed, returning fallback', {
        issueId,
        moduleName,
        error: error.message,
        userId: authContext.user?.id,
      });

      // Return fallback with local attributes
      return {
        attributes: this.parseAttributes(attributes),
        _metadata: {
          lastSyncAt: lastSyncAt || '',
          syncedAt: new Date().toISOString(),
          synced: false,
          message: `Sync failed: ${error.message}`,
        },
      };
    }
  }
}
