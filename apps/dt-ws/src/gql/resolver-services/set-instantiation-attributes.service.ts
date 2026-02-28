import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { Countermeasure, Exposure } from '@dethernety/dt-module';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import {
  SetAttributesRequest,
  SetAttributesResult,
  ExternalObjectTarget,
  LinkExternalObjectRequest,
  DatabaseTransaction,
  DatabaseSession,
  ComponentMetadata,
  UpsertExposuresRequest,
  UpsertCountermeasuresRequest,
  DeleteObsoleteObjectsRequest,
  DatabaseOperationResult,
  SetAttributesValidationResult,
  ExternalObjectValidationResult,
  BatchOperationEntry,
  BatchProcessingStatistics,
  SetInstantiationStatistics,
  ConcurrentOperation,
  SetInstantiationError,
  SetInstantiationErrorType,
  SetInstantiationConfig,
  ModuleOperationResult,
  ComponentType,
  MitreTechniqueReference,
  MitreResponseReference,
} from '../interfaces/set-instantiation-attributes.interface';
import { AuthorizationContext } from '../interfaces/authorization.interface';
import { GqlConfig } from '../gql.config';

@Injectable()
export class SetInstantiationAttributesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SetInstantiationAttributesService.name);
  private readonly config: SetInstantiationConfig;
  private readonly concurrentOperations = new Map<string, ConcurrentOperation>();
  private readonly batchQueue = new Map<string, BatchOperationEntry[]>();
  private readonly batchTimeouts = new Map<string, NodeJS.Timeout>();
  private cleanupInterval: NodeJS.Timeout;
  private statistics: SetInstantiationStatistics = {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    averageResponseTime: 0,
    longestOperation: 0,
    shortestOperation: Infinity,
    operationsByType: {
      setAttributes: 0,
      upsertExposures: 0,
      upsertCountermeasures: 0,
      linkExternalObjects: 0,
    },
    batchProcessing: {
      totalBatches: 0,
      totalOperations: 0,
      averageBatchSize: 0,
      averageWaitTime: 0,
      debouncingActive: false,
      pendingOperations: 0,
    },
  };

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
  ) {
    const gqlConfig = this.configService.get<GqlConfig>('gql')!;
    
    // Set instantiation attributes specific configuration
    this.config = {
      batchEnabled: true,
      batchDebounceTime: 1000, // 1 second debounce for auto-save
      maxBatchSize: 10,
      operationTimeout: 30000, // 30 seconds
      maxConcurrentOperations: 50,
      transactionTimeout: 10000, // 10 seconds
      retryAttempts: 3,
      enableDetailedMetrics: true,
      metricsRetentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('SetInstantiationAttributesService initializing...', {
      batchEnabled: this.config.batchEnabled,
      batchDebounceTime: this.config.batchDebounceTime,
      operationTimeout: this.config.operationTimeout,
    });

    this.startCleanupInterval();
    this.logger.log('SetInstantiationAttributesService initialized successfully');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Clear all batch timeouts
    for (const timeout of this.batchTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.batchTimeouts.clear();
    
    // Clear concurrent operations
    for (const operation of this.concurrentOperations.values()) {
      clearTimeout(operation.timeout);
    }
    this.concurrentOperations.clear();
    
    this.logger.log('SetInstantiationAttributesService destroyed');
  }

  /**
   * Link component to external MITRE objects (techniques, mitigations)
   * Uses modern Neo4j v5 transaction patterns
   */
  private async linkToExternalObject(
    tx: DatabaseTransaction,
    request: LinkExternalObjectRequest,
  ): Promise<DatabaseOperationResult> {
    const operationId = `linkExternal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Linking to external object', {
        elementId: request.elementId,
        originName: request.originName,
        targetLabel: request.target.label,
        operationId,
      });

      // Validate external object target
      const validation = this.validateExternalObjectTarget(request.target);
      if (!validation.isValid) {
        throw this.createSetInstantiationError(
          'VALIDATION_ERROR',
          `Invalid external object target: ${validation.error}`,
          request.elementId
        );
      }

      // Validate Cypher identifiers before interpolation
      const cypherIdentifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!cypherIdentifierRegex.test(request.elementToOriginRelation)) {
        throw new Error(`Invalid relationship type: ${request.elementToOriginRelation}`);
      }
      if (!cypherIdentifierRegex.test(request.relationName)) {
        throw new Error(`Invalid relationship name: ${request.relationName}`);
      }

      const result = await tx.run(
        `
        MATCH (c:Component {id: $elementId})-[:${request.elementToOriginRelation}]->(e {name: $originName})
        OPTIONAL MATCH (t:${request.target.label}) WHERE t.${request.target.property} = $value
        WITH e, t
        WHERE t IS NOT NULL
        MERGE (e)-[:${request.relationName}]->(t)
        RETURN COUNT(*) as relationshipsCreated
        `,
        {
          elementId: request.elementId,
          originName: request.originName,
          value: request.target.value,
        },
      );

      const relationshipsCreated = result.records[0]?.get('relationshipsCreated')?.toNumber() || 0;
      const duration = Date.now() - startTime;
      
      if (relationshipsCreated === 0) {
        this.logger.warn('Target node not found for external link', {
          elementId: request.elementId,
          originName: request.originName,
          targetLabel: request.target.label,
          targetProperty: request.target.property,
          targetValue: request.target.value,
          operationId,
          duration,
        });
      } else {
        this.logger.debug('External object linked successfully', {
          elementId: request.elementId,
          originName: request.originName,
          relationshipsCreated,
          operationId,
          duration,
        });
      }

      // Record operation metrics
      this.recordOperation('linkExternalObjects', true, duration, {
        elementId: request.elementId,
        relationshipsCreated,
      });

      return {
        success: true,
        recordsAffected: relationshipsCreated,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('linkExternalObjects', false, duration, {
        elementId: request.elementId,
        error: error.message,
      });

      this.logger.error('Failed to link to external object', {
        elementId: request.elementId,
        originName: request.originName,
        targetLabel: request.target.label,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        recordsAffected: 0,
      };
    }
  }

  /**
   * Delete obsolete external objects (exposures/countermeasures)
   * Uses modern Neo4j v5 transaction patterns
   */
  private async deleteObsoleteExternalObjects(
    tx: DatabaseTransaction,
    request: DeleteObsoleteObjectsRequest,
  ): Promise<DatabaseOperationResult> {
    const operationId = `deleteObsolete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      // Validate relationship type before Cypher interpolation
      const cypherIdentifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!cypherIdentifierRegex.test(request.relation)) {
        throw new Error(`Invalid relationship type: ${request.relation}`);
      }

      this.logger.debug('Deleting obsolete external objects', {
        elementId: request.elementId,
        relation: request.relation,
        validNamesCount: request.validNames.length,
        operationId,
      });

      const result = await tx.run(
        `
        MATCH (class:DTComponentClass {id: $classId})
        MATCH (c:Component {id: $elementId})-[r:${request.relation}]->(e)-[]->(class)
        WHERE NOT e.name IN $validNames
        DETACH DELETE e
        RETURN COUNT(e) as deletedCount
        `,
        {
          elementId: request.elementId,
          validNames: request.validNames,
          classId: request.classId,
        },
      );

      const deletedCount = result.records[0]?.get('deletedCount')?.toNumber() || 0;
      const duration = Date.now() - startTime;

      if (deletedCount > 0) {
        this.logger.debug('Obsolete external objects deleted', {
          elementId: request.elementId,
          relation: request.relation,
          deletedCount,
          operationId,
          duration,
        });
      }

      return {
        success: true,
        recordsAffected: deletedCount,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('Failed to delete obsolete external objects', {
        elementId: request.elementId,
        relation: request.relation,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        recordsAffected: 0,
      };
    }
  }

  /**
   * Upsert exposures using modern Neo4j v5 executeWrite pattern
   */
  private async upsertExposures(
    session: DatabaseSession,
    request: UpsertExposuresRequest,
  ): Promise<DatabaseOperationResult> {
    const operationId = `upsertExposures-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Upserting exposures', {
        componentId: request.componentId,
        exposureCount: request.exposures.length,
        operationId,
      });

      const exposureNames = request.exposures.map((exposure) => exposure.name);
      let totalProcessed = 0;
      
      // Use modern Neo4j v5 executeWrite pattern
      await session.executeWrite(async (tx: DatabaseTransaction) => {
        for (const exposure of request.exposures) {
          const omitExploitedBy = (exposure: Exposure): Omit<Exposure, 'exploitedBy'> => {
             
            const { exploitedBy, ...rest } = exposure;
            return rest;
          };

          // Upsert exposure node
          await tx.run(
            `
            MATCH (c:Component {id: $componentId})
            MATCH (t:DTComponentClass {id: $classId})
            MERGE (c)-[:HAS_EXPOSURE]->(e:Exposure {name: $attributes.name})-[:IS_EXPOSURE_OF]->(t)
            ON CREATE SET e.id = randomUUID()
            SET e += $attributes
            `,
            {
              componentId: request.componentId,
              attributes: omitExploitedBy(exposure),
              classId: request.classId,
            },
          );

          // Link to MITRE techniques
          for (const technique of exposure.exploitedBy || []) {
            const target: ExternalObjectTarget = typeof technique === 'string'
              ? {
                  label: 'MitreAttackTechnique',
                  property: 'attack_id',
                  value: technique,
                }
              : technique;

            const linkRequest: LinkExternalObjectRequest = {
              elementId: request.componentId,
              elementToOriginRelation: 'HAS_EXPOSURE',
              originName: exposure.name,
              relationName: 'EXPLOITED_BY',
              target,
            };

            await this.linkToExternalObject(tx, linkRequest);
          }
          
          totalProcessed++;
        }

        // Clean up obsolete exposures
        const deleteRequest: DeleteObsoleteObjectsRequest = {
          elementId: request.componentId,
          relation: 'HAS_EXPOSURE',
          validNames: exposureNames,
          classId: request.classId,
        };
        
        const deleteResult = await this.deleteObsoleteExternalObjects(tx, deleteRequest);
        if (!deleteResult.success) {
          throw this.createSetInstantiationError(
            'DATABASE_ERROR',
            `Failed to delete obsolete exposures: ${deleteResult.error}`,
            request.componentId
          );
        }
      });

      const duration = Date.now() - startTime;
      this.recordOperation('upsertExposures', true, duration, {
        componentId: request.componentId,
        exposureCount: request.exposures.length,
        totalProcessed,
      });

      this.logger.debug('Exposures upserted successfully', {
        componentId: request.componentId,
        exposureCount: request.exposures.length,
        totalProcessed,
        operationId,
        duration,
      });

      return {
        success: true,
        recordsAffected: totalProcessed,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('upsertExposures', false, duration, {
        componentId: request.componentId,
        exposureCount: request.exposures.length,
        error: error.message,
      });

      this.logger.error('Failed to upsert exposures', {
        componentId: request.componentId,
        exposureCount: request.exposures.length,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        recordsAffected: 0,
      };
    }
  }

  /**
   * Upsert countermeasures using modern Neo4j v5 executeWrite pattern
   */
  private async upsertCountermeasures(
    session: DatabaseSession,
    request: UpsertCountermeasuresRequest,
  ): Promise<DatabaseOperationResult> {
    const operationId = `upsertCountermeasures-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.debug('Upserting countermeasures', {
        componentId: request.componentId,
        countermeasureCount: request.countermeasures.length,
        operationId,
      });

      const countermeasureNames = request.countermeasures.map(
        (countermeasure) => countermeasure.name,
      );
      let totalProcessed = 0;
      
      // Use modern Neo4j v5 executeWrite pattern
      await session.executeWrite(async (tx: DatabaseTransaction) => {
        for (const countermeasure of request.countermeasures) {
          const omitRespondsWith = (
            countermeasure: Countermeasure,
          ): Omit<Countermeasure, 'respondsWith'> => {
             
            const { respondsWith, ...rest } = countermeasure;
            return rest;
          };

          // Upsert countermeasure node
          await tx.run(
            `
            MATCH (c:Component {id: $componentId})
            MATCH (t:DTComponentClass {id: $classId})
            MERGE (c)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure {name: $attributes.name})-[:IS_COUNTERMEASURE_OF]->(t)
            ON CREATE SET cm.id = randomUUID()
            SET cm += $attributes
            `,
            {
              componentId: request.componentId,
              attributes: omitRespondsWith(countermeasure),
              classId: request.classId,
            },
          );

          // Link to MITRE mitigations
          for (const response of countermeasure.respondsWith || []) {
            const target: ExternalObjectTarget = typeof response === 'string'
              ? {
                  label: 'MitreAttackMitigation',
                  property: 'attack_id',
                  value: response,
                }
              : response;

            const linkRequest: LinkExternalObjectRequest = {
              elementId: request.componentId,
              elementToOriginRelation: 'HAS_COUNTERMEASURE',
              originName: countermeasure.name,
              relationName: 'RESPONDS_WITH',
              target,
            };

            await this.linkToExternalObject(tx, linkRequest);
          }
          
          totalProcessed++;
        }

        // Clean up obsolete countermeasures
        const deleteRequest: DeleteObsoleteObjectsRequest = {
          elementId: request.componentId,
          relation: 'HAS_COUNTERMEASURE',
          validNames: countermeasureNames,
          classId: request.classId,
        };
        
        const deleteResult = await this.deleteObsoleteExternalObjects(tx, deleteRequest);
        if (!deleteResult.success) {
          throw this.createSetInstantiationError(
            'DATABASE_ERROR',
            `Failed to delete obsolete countermeasures: ${deleteResult.error}`,
            request.componentId
          );
        }
      });

      const duration = Date.now() - startTime;
      this.recordOperation('upsertCountermeasures', true, duration, {
        componentId: request.componentId,
        countermeasureCount: request.countermeasures.length,
        totalProcessed,
      });

      this.logger.debug('Countermeasures upserted successfully', {
        componentId: request.componentId,
        countermeasureCount: request.countermeasures.length,
        totalProcessed,
        operationId,
        duration,
      });

      return {
        success: true,
        recordsAffected: totalProcessed,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('upsertCountermeasures', false, duration, {
        componentId: request.componentId,
        countermeasureCount: request.countermeasures.length,
        error: error.message,
      });

      this.logger.error('Failed to upsert countermeasures', {
        componentId: request.componentId,
        countermeasureCount: request.countermeasures.length,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        recordsAffected: 0,
      };
    }
  }

  /**
   * Set instantiation attributes with modern Neo4j v5 patterns and proper session management
   * Supports batch processing for frequent frontend updates
   */
  async setAttributes(
    request: SetAttributesRequest,
    context?: AuthorizationContext,
  ): Promise<SetAttributesResult> {
    const operationId = `setAttributes-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    }) as DatabaseSession;

    try {
      this.logger.debug('Setting instantiation attributes', {
        componentId: request.componentId,
        classId: request.classId,
        operationId,
        attributeKeys: Object.keys(request.attributes),
      });

      // Input validation
      const validation = this.validateSetAttributesRequest(request);
      if (!validation.isValid) {
        throw this.createSetInstantiationError(
          'VALIDATION_ERROR',
          `Invalid request: ${validation.errors.join(', ')}`,
          request.componentId,
          request.classId
        );
      }

      // Authorization check (blank implementation as per established pattern)
      await this.checkAuthorization(context, 'setInstantiationAttributes', {
        componentId: request.componentId,
        classId: request.classId,
      });

      // Get component metadata using modern Neo4j v5 executeWrite
      const metadata = await session.executeWrite(async (tx: DatabaseTransaction) => {
        const result = await tx.run(
          `
          MATCH (c:Component {id: $componentId})
          MATCH (t:DTComponentClass {id: $classId})<-[:HAS_CLASS]-(m:Module)
          MATCH (c)-[r:IS_INSTANCE_OF]->(t)
          SET r += $attributes
          RETURN m.name AS moduleName, labels(c)[0] AS type
          `,
          {
            componentId: request.componentId,
            classId: request.classId,
            attributes: request.attributes,
          },
        );
        
        if (result.records.length === 0 || 
            !result.records[0].get('moduleName') || 
            !result.records[0].get('type')) {
          throw this.createSetInstantiationError(
            'DATABASE_ERROR',
            'Component or class not found, or failed to set attributes',
            request.componentId,
            request.classId
          );
        }
        
        return {
          moduleName: result.records[0].get('moduleName') as string,
          componentType: result.records[0].get('type') as ComponentType,
        };
      });

      this.logger.debug('Component metadata retrieved', {
        componentId: request.componentId,
        moduleName: metadata.moduleName,
        componentType: metadata.componentType,
        operationId,
      });

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(metadata.moduleName);
      if (!moduleInstance) {
        throw this.createSetInstantiationError(
          'MODULE_ERROR',
          `Module not found: ${metadata.moduleName}`,
          request.componentId,
          request.classId
        );
      }

      // Process based on component type (preserving existing business logic)
      if (metadata.componentType === 'Issue') {
        // Issues don't require additional processing
        this.logger.debug('Issue component processed', {
          componentId: request.componentId,
          operationId,
        });
      } else if (metadata.componentType === 'Control') {
        // Handle countermeasures for controls
        await this.processControlCountermeasures(
          session,
          request.componentId,
          request.classId,
          moduleInstance,
          operationId
        );
      } else {
        // Handle exposures for other component types
        await this.processComponentExposures(
          session,
          request.componentId,
          request.classId,
          moduleInstance,
          operationId
        );
      }

      // Record successful operation
      const duration = Date.now() - startTime;
      this.recordOperation('setAttributes', true, duration, {
        componentId: request.componentId,
        classId: request.classId,
        componentType: metadata.componentType,
        moduleName: metadata.moduleName,
      });

      this.logger.log('Instantiation attributes set successfully', {
        componentId: request.componentId,
        classId: request.classId,
        componentType: metadata.componentType,
        moduleName: metadata.moduleName,
        operationId,
        duration,
      });

      return {
        success: true,
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          componentId: request.componentId,
          classId: request.classId,
          componentType: metadata.componentType,
          moduleName: metadata.moduleName,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('setAttributes', false, duration, {
        componentId: request.componentId,
        classId: request.classId,
        error: error.message,
      });

      this.logger.error('Failed to set instantiation attributes', {
        componentId: request.componentId,
        classId: request.classId,
        operationId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: safeErrorMessage(error),
        metadata: {
          operationId,
          timestamp: new Date().toISOString(),
          duration,
          componentId: request.componentId,
          classId: request.classId,
        },
      };

    } finally {
      // Ensure session is always closed (modern pattern)
      await session.close();
    }
  }

  /**
   * Process countermeasures for control components
   */
  private async processControlCountermeasures(
    session: DatabaseSession,
    componentId: string,
    classId: string,
    moduleInstance: any,
    operationId: string,
  ): Promise<void> {
    this.logger.debug('Processing control countermeasures', {
      componentId,
      classId,
      operationId,
    });

    const countermeasures = await moduleInstance.getCountermeasures(componentId, classId);
    if (!countermeasures) {
      throw this.createSetInstantiationError(
        'MODULE_ERROR',
        'Failed to get countermeasures from module',
        componentId,
        classId
      );
    }

    const upsertRequest: UpsertCountermeasuresRequest = {
      componentId,
      countermeasures,
      classId,
    };

    const result = await this.upsertCountermeasures(session, upsertRequest);
    if (!result.success) {
      throw this.createSetInstantiationError(
        'DATABASE_ERROR',
        `Failed to upsert countermeasures: ${result.error}`,
        componentId,
        classId
      );
    }

    this.logger.debug('Control countermeasures processed successfully', {
      componentId,
      countermeasureCount: countermeasures.length,
      recordsAffected: result.recordsAffected,
      operationId,
    });
  }

  /**
   * Process exposures for non-control components
   */
  private async processComponentExposures(
    session: DatabaseSession,
    componentId: string,
    classId: string,
    moduleInstance: any,
    operationId: string,
  ): Promise<void> {
    this.logger.debug('Processing component exposures', {
      componentId,
      classId,
      operationId,
    });

    const exposures = await moduleInstance.getExposures(componentId, classId);
    if (exposures === undefined) {
      throw this.createSetInstantiationError(
        'MODULE_ERROR',
        'Failed to get exposures from module',
        componentId,
        classId
      );
    }

    const upsertRequest: UpsertExposuresRequest = {
      componentId,
      exposures,
      classId,
    };

    const result = await this.upsertExposures(session, upsertRequest);
    if (!result.success) {
      throw this.createSetInstantiationError(
        'DATABASE_ERROR',
        `Failed to upsert exposures: ${result.error}`,
        componentId,
        classId
      );
    }

    this.logger.debug('Component exposures processed successfully', {
      componentId,
      exposureCount: exposures.length,
      recordsAffected: result.recordsAffected,
      operationId,
    });
  }

  // ============================================================================
  // Validation Methods
  // ============================================================================

  private validateSetAttributesRequest(request: SetAttributesRequest): SetAttributesValidationResult {
    const errors: string[] = [];

    if (!request.componentId || typeof request.componentId !== 'string') {
      errors.push('componentId is required and must be a string');
    }

    if (!request.classId || typeof request.classId !== 'string') {
      errors.push('classId is required and must be a string');
    }

    if (!request.attributes || typeof request.attributes !== 'object') {
      errors.push('attributes is required and must be an object');
    } else if (Object.keys(request.attributes).length === 0) {
      errors.push('attributes cannot be empty');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private validateExternalObjectTarget(target: ExternalObjectTarget): ExternalObjectValidationResult {
    // Regex for safe Cypher identifiers (alphanumeric + underscore only)
    const cypherIdentifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    if (!target.label || typeof target.label !== 'string') {
      return { isValid: false, error: 'target.label is required and must be a string' };
    }
    if (!cypherIdentifierRegex.test(target.label)) {
      return { isValid: false, error: `target.label contains invalid characters: ${target.label}` };
    }

    if (!target.property || typeof target.property !== 'string') {
      return { isValid: false, error: 'target.property is required and must be a string' };
    }
    if (!cypherIdentifierRegex.test(target.property)) {
      return { isValid: false, error: `target.property contains invalid characters: ${target.property}` };
    }

    if (!target.value || typeof target.value !== 'string') {
      return { isValid: false, error: 'target.value is required and must be a string' };
    }

    return { isValid: true };
  }

  // ============================================================================
  // Authorization and Monitoring
  // ============================================================================

  private async checkAuthorization(
    context: AuthorizationContext | undefined,
    operation: string,
    resource: Record<string, any>,
  ): Promise<void> {
    // Blank authorization implementation as per established pattern
    // Authorization is handled by the GraphQL schema directives
    return;
  }

  private recordOperation(
    operationType: keyof SetInstantiationStatistics['operationsByType'],
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

    // Record in monitoring service
    this.monitoringService.recordOperation({
      operationName: `setInstantiation.${operationType}`,
      success,
      duration,
      timestamp: new Date(),
      metadata,
    });
  }

  private createSetInstantiationError(
    type: SetInstantiationErrorType,
    message: string,
    componentId?: string,
    classId?: string,
  ): SetInstantiationError {
    return {
      type,
      message,
      componentId,
      classId,
      timestamp: Date.now(),
      context: {
        service: 'SetInstantiationAttributesService',
        concurrentOperations: this.concurrentOperations.size,
        batchQueueSize: Array.from(this.batchQueue.values()).reduce((sum, queue) => sum + queue.length, 0),
      },
    };
  }

  // ============================================================================
  // Batch Processing for Frontend Auto-Save
  // ============================================================================

  /**
   * Process set attributes with batch debouncing for frequent frontend updates
   */
  private async setAttributesWithBatching(
    request: SetAttributesRequest,
    context?: AuthorizationContext,
  ): Promise<SetAttributesResult> {
    return new Promise((resolve, reject) => {
      const batchEntry: BatchOperationEntry = {
        request,
        timestamp: Date.now(),
        resolve,
        reject,
      };

      // Add to batch queue
      if (!this.batchQueue.has(request.componentId)) {
        this.batchQueue.set(request.componentId, []);
      }
      this.batchQueue.get(request.componentId)!.push(batchEntry);
      this.statistics.batchProcessing.pendingOperations++;

      // Clear existing timeout and set new one
      const existingTimeout = this.batchTimeouts.get(request.componentId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        this.processBatch(request.componentId, context);
      }, this.config.batchDebounceTime);

      this.batchTimeouts.set(request.componentId, timeout);
      this.statistics.batchProcessing.debouncingActive = true;

      this.logger.debug('Added to batch queue', {
        componentId: request.componentId,
        queueSize: this.batchQueue.get(request.componentId)!.length,
        debounceTime: this.config.batchDebounceTime,
      });
    });
  }

  /**
   * Process batched operations for a specific component
   */
  private async processBatch(
    componentId: string,
    context?: AuthorizationContext,
  ): Promise<void> {
    const batchEntries = this.batchQueue.get(componentId) || [];
    if (batchEntries.length === 0) {
      return;
    }

    this.logger.debug('Processing batch', {
      componentId,
      batchSize: batchEntries.length,
    });

    // Clear the batch
    this.batchQueue.delete(componentId);
    this.batchTimeouts.delete(componentId);
    this.statistics.batchProcessing.totalBatches++;
    this.statistics.batchProcessing.totalOperations += batchEntries.length;
    this.statistics.batchProcessing.pendingOperations -= batchEntries.length;

    // Process the latest request (most recent attributes)
    const latestEntry = batchEntries[batchEntries.length - 1];
    const averageWaitTime = batchEntries.reduce((sum, entry) => 
      sum + (Date.now() - entry.timestamp), 0) / batchEntries.length;
    
    this.statistics.batchProcessing.averageWaitTime = averageWaitTime;
    this.statistics.batchProcessing.averageBatchSize = 
      this.statistics.batchProcessing.totalOperations / this.statistics.batchProcessing.totalBatches;

    try {
      // Execute the latest request
      const result = await this.setAttributes(latestEntry.request, context);
      
      // Resolve all entries with the same result
      batchEntries.forEach(entry => entry.resolve(result));
      
      this.logger.debug('Batch processed successfully', {
        componentId,
        batchSize: batchEntries.length,
        averageWaitTime,
        success: result.success,
      });

    } catch (error) {
      // Reject all entries with the error
      batchEntries.forEach(entry => entry.reject(error));
      
      this.logger.error('Batch processing failed', {
        componentId,
        batchSize: batchEntries.length,
        error: error.message,
      });
    }

    this.statistics.batchProcessing.debouncingActive = this.batchQueue.size > 0;
  }

  // ============================================================================
  // Concurrency Control (Following Established Pattern)
  // ============================================================================

  private async executeWithConcurrencyControl(
    componentId: string,
    operation: () => Promise<SetAttributesResult>,
  ): Promise<SetAttributesResult> {
    const operationId = `concurrent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Check if operation is already in progress
    if (this.concurrentOperations.has(componentId)) {
      const existing = this.concurrentOperations.get(componentId)!;
      this.logger.debug('Operation already in progress, waiting', {
        componentId,
        existingOperationId: existing.operationId,
        operationId,
      });
      
      // Wait for existing operation to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.concurrentOperations.has(componentId)) {
            clearInterval(checkInterval);
            // Retry the operation
            this.executeWithConcurrencyControl(componentId, operation)
              .then(resolve)
              .catch(reject);
          }
        }, 100);
      });
    }

    // Create operation tracking
    const timeout = setTimeout(() => {
      this.concurrentOperations.delete(componentId);
      this.logger.warn('Operation timed out', { componentId, operationId });
    }, this.config.operationTimeout);

    const concurrentOp: ConcurrentOperation = {
      componentId,
      operationId,
      startTime: Date.now(),
      timeout,
      type: 'setAttributes',
    };

    this.concurrentOperations.set(componentId, concurrentOp);

    try {
      const result = await operation();
      return result;
    } finally {
      clearTimeout(timeout);
      this.concurrentOperations.delete(componentId);
    }
  }

  // ============================================================================
  // Cleanup and Health Methods
  // ============================================================================

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleOperations();
      this.cleanupStaleBatches();
    }, 60000); // 1 minute cleanup interval

    this.logger.debug('Cleanup interval started');
  }

  private cleanupStaleOperations(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    let cleaned = 0;

    for (const [componentId, operation] of this.concurrentOperations.entries()) {
      if (now - operation.startTime > staleThreshold) {
        clearTimeout(operation.timeout);
        this.concurrentOperations.delete(componentId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cleaned up stale operations', { cleaned });
    }
  }

  private cleanupStaleBatches(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    let cleaned = 0;

    for (const [componentId, entries] of this.batchQueue.entries()) {
      const staleEntries = entries.filter(entry => now - entry.timestamp > staleThreshold);
      if (staleEntries.length > 0) {
        // Reject stale entries
        staleEntries.forEach(entry => 
          entry.reject(new Error('Batch operation timed out'))
        );
        
        // Remove stale entries
        const freshEntries = entries.filter(entry => now - entry.timestamp <= staleThreshold);
        if (freshEntries.length > 0) {
          this.batchQueue.set(componentId, freshEntries);
        } else {
          this.batchQueue.delete(componentId);
          const timeout = this.batchTimeouts.get(componentId);
          if (timeout) {
            clearTimeout(timeout);
            this.batchTimeouts.delete(componentId);
          }
        }
        
        cleaned += staleEntries.length;
        this.statistics.batchProcessing.pendingOperations -= staleEntries.length;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cleaned up stale batch entries', { cleaned });
    }
  }

  // ============================================================================
  // Public API Methods
  // ============================================================================

  /**
   * Get comprehensive statistics for set instantiation operations
   */
  getStatistics(): SetInstantiationStatistics {
    return {
      ...this.statistics,
      batchProcessing: {
        ...this.statistics.batchProcessing,
        debouncingActive: this.batchQueue.size > 0,
        pendingOperations: Array.from(this.batchQueue.values())
          .reduce((sum, queue) => sum + queue.length, 0),
      },
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
      operationsByType: {
        setAttributes: 0,
        upsertExposures: 0,
        upsertCountermeasures: 0,
        linkExternalObjects: 0,
      },
      batchProcessing: {
        totalBatches: 0,
        totalOperations: 0,
        averageBatchSize: 0,
        averageWaitTime: 0,
        debouncingActive: this.batchQueue.size > 0,
        pendingOperations: Array.from(this.batchQueue.values())
          .reduce((sum, queue) => sum + queue.length, 0),
      },
    };

    this.logger.log('Set instantiation attributes statistics reset');
  }

  /**
   * Get health status of set instantiation attributes service
   */
  getHealthStatus(): {
    isHealthy: boolean;
    statistics: SetInstantiationStatistics;
    concurrentOperations: number;
    batchQueueSize: number;
    issues: string[];
  } {
    const statistics = this.getStatistics();
    const issues: string[] = [];

    // Check for potential issues
    if (this.concurrentOperations.size > this.config.maxConcurrentOperations * 0.8) {
      issues.push('High number of concurrent operations');
    }

    if (statistics.failedOperations / statistics.totalOperations > 0.1 && statistics.totalOperations > 10) {
      issues.push('High failure rate detected');
    }

    const batchQueueSize = Array.from(this.batchQueue.values())
      .reduce((sum, queue) => sum + queue.length, 0);
    
    if (batchQueueSize > this.config.maxBatchSize * 5) {
      issues.push('Large batch queue detected');
    }

    return {
      isHealthy: issues.length === 0,
      statistics,
      concurrentOperations: this.concurrentOperations.size,
      batchQueueSize,
      issues,
    };
  }

  // ============================================================================
  // GraphQL Resolver Interface
  // ============================================================================

  getResolvers() {
    return {
      Mutation: {
        setInstantiationAttributes: async (_parent: any, args: any, context: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          const request: SetAttributesRequest = {
            componentId: args.componentId,
            classId: args.classId,
            attributes: args.attributes,
          };

          this.logger.debug('GraphQL setInstantiationAttributes called', {
            componentId: args.componentId,
            classId: args.classId,
            attributeKeys: Object.keys(args.attributes || {}),
          });

          // Use concurrency control following established pattern
          try {
            const result = await this.executeWithConcurrencyControl(
              args.componentId,
              async () => {
                // Use batch processing if enabled
                if (this.config.batchEnabled) {
                  return await this.setAttributesWithBatching(request, authContext);
                } else {
                  return await this.setAttributes(request, authContext);
                }
              },
            );
            return result.success;
          } catch (error) {
            this.logger.error('GraphQL setInstantiationAttributes failed', {
              componentId: args.componentId,
              error: error.message,
            });
            return false;
          }
        },
      },
    };
  }
}
