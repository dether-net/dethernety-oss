import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { ModuleManagementService } from '../module-management-services/module-management.service';
import { 
  AuthorizationContext, 
  OperationContext, 
  AuthorizationLevel,
  ModulePermissions 
} from '../interfaces/authorization.interface';
import { GqlConfig } from '../gql.config';

interface ModuleOperationResult {
  success: boolean;
  moduleId?: string;
  moduleName?: string;
  message?: string;
  duration?: number;
}

interface ResolverStatistics {
  operationCount: number;
  successCount: number;
  errorCount: number;
  averageResponseTime: number;
  lastOperationAt?: Date;
}

@Injectable()
export class ModuleManagementResolverService {
  private readonly logger = new Logger(ModuleManagementResolverService.name);
  private readonly syncMutex = new Map<string, Promise<any>>();
  private readonly config: GqlConfig;
  private statistics: ResolverStatistics = {
    operationCount: 0,
    successCount: 0,
    errorCount: 0,
    averageResponseTime: 0,
  };

  constructor(
    private readonly moduleRegistryService: ModuleRegistryService,
    private readonly moduleManagementService: ModuleManagementService,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    this.logger.log('ModuleManagementResolverService initialized');
  }

  /**
   * Future-ready authorization hook (currently passes through)
   * When you need complex authorization, implement logic here
   */
  private async checkAuthorization(
    context: AuthorizationContext,
    operation: OperationContext,
  ): Promise<void> {
    // Currently: Schema-level @authentication handles this
    // Future: Implement role-based, resource-based, or custom authorization here
    
    this.logger.debug('Authorization check', {
      operation: operation.operationName,
      resourceType: operation.resourceType,
      resourceId: operation.resourceId,
      userId: context.user?.id,
    });

    // Example future implementation:
    // if (operation.operationName === 'resetModule') {
    //   await this.checkModuleResetPermission(context, operation.resourceId);
    // }
  }

  /**
   * Records operation metrics for monitoring
   */
  private recordOperation(operationName: string, success: boolean, duration: number): void {
    this.statistics.operationCount++;
    
    if (success) {
      this.statistics.successCount++;
    } else {
      this.statistics.errorCount++;
    }

    // Update average response time
    const totalTime = this.statistics.averageResponseTime * (this.statistics.operationCount - 1) + duration;
    this.statistics.averageResponseTime = totalTime / this.statistics.operationCount;
    this.statistics.lastOperationAt = new Date();
  }

  /**
   * Validates input parameters
   */
  private validateResetModuleInput(moduleId: string): void {
    if (!moduleId) {
      throw new Error('Module ID is required');
    }

    if (typeof moduleId !== 'string') {
      throw new Error('Module ID must be a string');
    }

    if (moduleId.trim().length === 0) {
      throw new Error('Module ID cannot be empty');
    }

    // UUID validation (if your IDs are UUIDs)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(moduleId)) {
      this.logger.warn('Invalid module ID format', { moduleId });
      // Don't throw - might not be UUID format
    }
  }

  async resetModule(
    moduleId: string, 
    context?: AuthorizationContext
  ): Promise<ModuleOperationResult> {
    const startTime = Date.now();
    const operationName = 'resetModule';

    try {
      // Input validation
      this.validateResetModuleInput(moduleId);

      // Future authorization check (currently no-op)
      if (context) {
        await this.checkAuthorization(context, {
          operationType: 'mutation',
          operationName,
          resourceType: 'module',
          resourceId: moduleId,
        });
      }

      this.logger.log('Starting module reset', {
        moduleId,
        userId: context?.user?.id,
        sessionId: context?.sessionId,
      });

      // Perform the operation
      const success = await this.moduleRegistryService.resetModuleById(moduleId);
      
      if (!success) {
        throw new Error('Module reset operation returned false');
      }

      // Get module info for response (optional - for enhanced logging)
      let moduleName: string | undefined;
      try {
        const allModules = await this.moduleRegistryService.getAllModules();
        // Find module by ID if possible, otherwise use moduleId as name
        moduleName = moduleId; // Fallback to moduleId
      } catch {
        // If we can't get module info, that's okay - just use moduleId
        moduleName = moduleId;
      }
      
      const duration = Date.now() - startTime;
      this.recordOperation(operationName, true, duration);

      this.logger.log('Module reset completed successfully', {
        moduleId,
        duration,
        userId: context?.user?.id,
      });

      return {
        success: true,
        moduleId,
        moduleName,
        message: 'Module reset successfully',
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation(operationName, false, duration);

      this.logger.error('Module reset failed', {
        moduleId,
        error: error.message,
        stack: error.stack,
        duration,
        userId: context?.user?.id,
      });

      return {
        success: false,
        moduleId,
        message: `Module reset failed: ${error.message}`,
        duration,
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   * Returns boolean as expected by current GraphQL schema
   */
  async resetModuleLegacy(moduleId: string): Promise<boolean> {
    const result = await this.resetModule(moduleId);
    return result.success;
  }

  /**
   * Gets service statistics for monitoring
   */
  getStatistics(): ResolverStatistics {
    return { ...this.statistics };
  }

  /**
   * Resets service statistics (useful for testing)
   */
  resetStatistics(): void {
    this.statistics = {
      operationCount: 0,
      successCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
    };
    this.logger.log('Resolver statistics reset');
  }

  /**
   * Gets all modules (future query resolver)
   */
  async getModules(): Promise<any[]> {
    try {
      const modulesMap = await this.moduleRegistryService.getAllModules();
      // Convert Map to Array for GraphQL
      const modulePromises = Array.from(modulesMap.values()).map(async (module) => {
        try {
          const metadata = await module.getMetadata();
          return {
            id: metadata.name || 'unknown', // Use name as ID since DTMetadata doesn't have id
            name: metadata.name || 'unknown',
            version: metadata.version,
            description: metadata.description,
          };
        } catch (error) {
          this.logger.warn('Failed to get metadata for module', { error: error.message });
          return {
            id: 'unknown',
            name: 'unknown',
            version: 'unknown',
            description: 'Failed to load metadata',
          };
        }
      });
      
      return await Promise.all(modulePromises);
    } catch (error) {
      this.logger.error('Failed to get modules', { error: error.message });
      return [];
    }
  }

  /**
   * Gets module health information
   */
  async getModuleHealth(moduleId: string): Promise<any> {
    try {
      // The getModuleHealth method expects no parameters based on the interface
      const healthMap = await this.moduleRegistryService.getModuleHealth();
      // Find health info for specific module if needed
      return healthMap || null;
    } catch (error) {
      this.logger.error('Failed to get module health', { 
        moduleId, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Gets list of modules that have frontend bundle.js files
   */
  async getAvailableFrontendModules(context?: AuthorizationContext): Promise<string[]> {
    const startTime = Date.now();
    const operationName = 'getAvailableFrontendModules';

    try {
      // Future authorization check (currently no-op)
      if (context) {
        await this.checkAuthorization(context, {
          operationType: 'query',
          operationName,
          resourceType: 'module',
          resourceId: 'frontend-modules',
        });
      }

      this.logger.debug('Getting available frontend modules', {
        userId: context?.user?.id,
      });

      // Use the service method
      const availableModules = await this.moduleManagementService.getAvailableFrontendModules(this.moduleRegistryService);

      const duration = Date.now() - startTime;
      this.recordOperation(operationName, true, duration);

      this.logger.log('Frontend modules retrieved successfully via resolver', {
        modulesWithFrontend: availableModules.length,
        modules: availableModules,
        duration,
        userId: context?.user?.id,
      });

      return availableModules;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation(operationName, false, duration);

      this.logger.error('Failed to get available frontend modules via resolver', {
        error: error.message,
        stack: error.stack,
        duration,
        userId: context?.user?.id,
      });

      throw error;
    }
  }

  /**
   * Gets the content of a module's frontend bundle.js file
   */
  async getModuleFrontendBundle(moduleName: string, context?: AuthorizationContext): Promise<string> {
    const startTime = Date.now();
    const operationName = 'getModuleFrontendBundle';

    try {
      // Future authorization check (currently no-op)
      if (context) {
        await this.checkAuthorization(context, {
          operationType: 'query',
          operationName,
          resourceType: 'module',
          resourceId: moduleName,
        });
      }

      this.logger.debug('Getting frontend bundle for module via resolver', {
        moduleName,
        userId: context?.user?.id,
      });

      // Use the service method
      const bundleContent = await this.moduleManagementService.getModuleFrontendBundle(moduleName, this.moduleRegistryService);

      const duration = Date.now() - startTime;
      this.recordOperation(operationName, true, duration);

      this.logger.log('Frontend bundle retrieved successfully via resolver', {
        moduleName,
        bundleSize: bundleContent.length,
        duration,
        userId: context?.user?.id,
      });

      return bundleContent;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation(operationName, false, duration);

      this.logger.error('Failed to get module frontend bundle via resolver', {
        moduleName,
        error: error.message,
        stack: error.stack,
        duration,
        userId: context?.user?.id,
      });

      throw error;
    }
  }

  getResolvers() {
    return {
      Mutation: {
        resetModule: async (
          _: any, 
          { moduleId }: { moduleId: string }, 
          context?: any
        ) => {
          // Convert GraphQL context to AuthorizationContext
          const authContext: AuthorizationContext = {
            user: context?.user,
            token: context?.token,
            sessionId: context?.sessionId,
          };

          // Check for existing operation to prevent concurrent resets
          if (this.syncMutex.has(moduleId)) {
            this.logger.debug('Concurrent reset attempt detected, waiting for existing operation', {
              moduleId,
              userId: authContext.user?.id,
            });
            
            const existingPromise = this.syncMutex.get(moduleId);
            const result = await existingPromise;
            return typeof result === 'boolean' ? result : result.success;
          }

          // Create operation promise with enhanced error handling
          const syncPromise = this.resetModuleLegacy(moduleId);
          this.syncMutex.set(moduleId, syncPromise);
          
          try {
            const result = await syncPromise;
            this.logger.debug('Module reset operation completed', {
              moduleId,
              result,
              userId: authContext.user?.id,
            });
            return result;
          } catch (error) {
            this.logger.error('Module reset operation failed in resolver', {
              moduleId,
              error: error.message,
              userId: authContext.user?.id,
            });
            return false; // GraphQL schema expects boolean
          } finally {
            this.syncMutex.delete(moduleId);
          }
        },
      },
      
      Query: {
        // Frontend module resolvers
        getAvailableFrontendModules: async (
          _: any,
          args: any,
          context?: any
        ) => {
          // Convert GraphQL context to AuthorizationContext
          const authContext: AuthorizationContext = {
            user: context?.user,
            token: context?.token,
            sessionId: context?.sessionId,
          };

          return await this.getAvailableFrontendModules(authContext);
        },

        getModuleFrontendBundle: async (
          _: any,
          { moduleName }: { moduleName: string },
          context?: any
        ) => {
          // Convert GraphQL context to AuthorizationContext
          const authContext: AuthorizationContext = {
            user: context?.user,
            token: context?.token,
            sessionId: context?.sessionId,
          };

          return await this.getModuleFrontendBundle(moduleName, authContext);
        },
      },
      
      // Future query resolvers (commented out until schema is updated)
      // Additional Query resolvers:
      // {
      //   modules: async () => {
      //     return await this.getModules();
      //   },
      //   
      //   moduleHealth: async (_: any, { moduleId }: { moduleId: string }) => {
      //     return await this.getModuleHealth(moduleId);
      //   },
      //   
      //   moduleStatistics: async () => {
      //     return this.getStatistics();
      //   },
      // },
    };
  }
}
