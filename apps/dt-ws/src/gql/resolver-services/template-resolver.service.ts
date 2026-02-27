import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { TemplateCacheService } from '../services/template-cache.service';
import { 
  AuthorizationContext, 
  OperationContext 
} from '../interfaces/authorization.interface';
import {
  TemplateRequest,
  TemplateResponse,
  TemplateOperationResult,
  TemplateValidationResult,
  ModuleTemplateInfo,
} from '../interfaces/template-resolver.interface';
import { GqlConfig } from '../gql.config';

@Injectable()
export class TemplateResolverService {
  private readonly logger = new Logger(TemplateResolverService.name);
  private readonly config: GqlConfig;
  private readonly moduleHealthCache = new Map<string, ModuleTemplateInfo>();
  private readonly operationTimeout = 10000; // 10 seconds

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
    private readonly templateCache: TemplateCacheService,
  ) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    
    this.logger.log('TemplateResolverService initialized', {
      operationTimeout: this.operationTimeout,
    });
  }

  /**
   * Validates template request parameters
   */
  private validateTemplateRequest(request: TemplateRequest): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!request.moduleName || typeof request.moduleName !== 'string') {
      errors.push('Module name is required and must be a string');
    }

    if (request.moduleName && request.moduleName.trim().length === 0) {
      errors.push('Module name cannot be empty');
    }

    if (request.moduleName && request.moduleName.length > 100) {
      errors.push('Module name too long (max 100 characters)');
    }

    if (request.id && typeof request.id !== 'string') {
      errors.push('ID must be a string if provided');
    }

    if (request.id && request.id.length > 200) {
      errors.push('ID too long (max 200 characters)');
    }

    // Validate module name format (basic)
    if (request.moduleName && !/^[a-zA-Z0-9_.-]+$/.test(request.moduleName)) {
      warnings.push('Module name contains special characters');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Checks module health and availability
   */
  private async checkModuleHealth(moduleName: string): Promise<ModuleTemplateInfo> {
    const cached = this.moduleHealthCache.get(moduleName);
    const now = new Date();

    // Return cached result if recent (5 minutes)
    if (cached && (now.getTime() - cached.lastChecked.getTime()) < 5 * 60 * 1000) {
      return cached;
    }

    const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
    const info: ModuleTemplateInfo = {
      moduleName,
      available: !!moduleInstance,
      hasTemplate: false,
      hasGuide: false,
      lastChecked: now,
    };

    if (moduleInstance) {
      try {
        // Check if module has template methods
        info.hasTemplate = typeof moduleInstance.getModuleTemplate === 'function';
        info.hasGuide = typeof moduleInstance.getClassGuide === 'function';
      } catch (error) {
        info.error = error.message;
        info.available = false;
      }
    } else {
      info.error = 'Module not found';
    }

    this.moduleHealthCache.set(moduleName, info);
    return info;
  }

  /**
   * Gets template with comprehensive error handling and caching
   */
  async getModuleTemplate(
    moduleName: string, 
    context?: AuthorizationContext
  ): Promise<TemplateOperationResult> {
    const startTime = Date.now();
    const operationName = 'getModuleTemplate';

    try {
      // Input validation
      const request: TemplateRequest = { type: 'template', moduleName };
      const validation = this.validateTemplateRequest(request);
      
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        this.logger.warn('Template request warnings', {
          moduleName,
          warnings: validation.warnings,
        });
      }

      // Authorization check (currently pass-through)
      if (context) {
        const authResult = await this.authorizationService.checkAuthorization(context, {
          operationType: 'query',
          operationName,
          resourceType: 'template',
          resourceId: moduleName,
        });

        if (!authResult.allowed) {
          throw new Error(`Authorization failed: ${authResult.reason}`);
        }
      }

      this.logger.debug('Fetching module template', { moduleName });

      // Check cache first
      const cached = this.templateCache.get('template', moduleName);
      if (cached) {
        const duration = Date.now() - startTime;
        this.monitoringService.recordOperation({
          operationName,
          duration,
          success: true,
          timestamp: new Date(),
          metadata: { moduleName, cached: true },
        });

        return {
          success: true,
          content: cached,
          cached: true,
          duration,
          source: 'cache',
        };
      }

      // Check module health
      const moduleInfo = await this.checkModuleHealth(moduleName);
      if (!moduleInfo.available) {
        throw new Error(moduleInfo.error || 'Module not available');
      }

      if (!moduleInfo.hasTemplate) {
        this.logger.warn('Module does not support templates', { moduleName });
        return {
          success: true,
          content: '',
          cached: false,
          duration: Date.now() - startTime,
          source: 'fallback',
        };
      }

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
      if (!moduleInstance) {
        throw new Error('Module instance not found');
      }

      // Fetch template with timeout
      const template = await Promise.race([
        moduleInstance.getModuleTemplate(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Template fetch timeout')), this.operationTimeout)
        ),
      ]);

      const content = template || '';

      // Cache the result
      if (content) {
        this.templateCache.set('template', moduleName, content);
      }

      const duration = Date.now() - startTime;
      this.monitoringService.recordOperation({
        operationName,
        duration,
        success: true,
        timestamp: new Date(),
        metadata: { moduleName, cached: false, contentLength: content.length },
      });

      this.logger.debug('Module template fetched successfully', {
        moduleName,
        contentLength: content.length,
        duration,
      });

      return {
        success: true,
        content,
        cached: false,
        duration,
        source: 'module',
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.monitoringService.recordOperation({
        operationName,
        duration,
        success: false,
        timestamp: new Date(),
        metadata: { moduleName, error: error.message },
      });

      this.logger.error('Failed to fetch module template', {
        moduleName,
        error: error.message,
        stack: error.stack,
        duration,
      });

      return {
        success: false,
        content: '',
        cached: false,
        duration,
        source: 'fallback',
        error: error.message,
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   * Returns string as expected by current GraphQL resolvers
   */
  async getModuleTemplateLegacy(moduleName: string): Promise<string> {
    if (!moduleName) {
      return '';
    }

    const result = await this.getModuleTemplate(moduleName);
    return result.content;
  }

  /**
   * Gets class template with comprehensive error handling and caching
   */
  async getClassTemplate(
    id: string, 
    module: any, 
    context?: AuthorizationContext
  ): Promise<TemplateOperationResult> {
    const startTime = Date.now();
    const operationName = 'getClassTemplate';

    try {
      // Validate module parameter
      if (!module || !Array.isArray(module) || module.length === 0) {
        throw new Error('Module parameter is required and must be a non-empty array');
      }

      const moduleData = module[0];
      if (!moduleData || !moduleData.name) {
        throw new Error('Module data must contain a name property');
      }

      const moduleName = moduleData.name;

      // Input validation
      const request: TemplateRequest = { type: 'template', moduleName, id };
      const validation = this.validateTemplateRequest(request);
      
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Authorization check (currently pass-through)
      if (context) {
        const authResult = await this.authorizationService.checkAuthorization(context, {
          operationType: 'query',
          operationName,
          resourceType: 'classTemplate',
          resourceId: `${moduleName}:${id}`,
        });

        if (!authResult.allowed) {
          throw new Error(`Authorization failed: ${authResult.reason}`);
        }
      }

      this.logger.debug('Fetching class template', { moduleName, id });

      // Check cache first
      const cached = this.templateCache.get('template', moduleName, id);
      if (cached) {
        const duration = Date.now() - startTime;
        this.monitoringService.recordOperation({
          operationName,
          duration,
          success: true,
          timestamp: new Date(),
          metadata: { moduleName, id, cached: true },
        });

        return {
          success: true,
          content: cached,
          cached: true,
          duration,
          source: 'cache',
        };
      }

      // Check module health
      const moduleInfo = await this.checkModuleHealth(moduleName);
      if (!moduleInfo.available) {
        throw new Error(moduleInfo.error || 'Module not available');
      }

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
      if (!moduleInstance) {
        throw new Error('Module instance not found');
      }

      if (typeof moduleInstance.getClassTemplate !== 'function') {
        this.logger.warn('Module does not support class templates', { moduleName });
        return {
          success: true,
          content: '',
          cached: false,
          duration: Date.now() - startTime,
          source: 'fallback',
        };
      }

      // Fetch template with timeout
      const template = await Promise.race([
        moduleInstance.getClassTemplate(id),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Class template fetch timeout')), this.operationTimeout)
        ),
      ]);

      const content = template || '';

      // Cache the result
      if (content) {
        this.templateCache.set('template', moduleName, content, id);
      }

      const duration = Date.now() - startTime;
      this.monitoringService.recordOperation({
        operationName,
        duration,
        success: true,
        timestamp: new Date(),
        metadata: { moduleName, id, cached: false, contentLength: content.length },
      });

      this.logger.debug('Class template fetched successfully', {
        moduleName,
        id,
        contentLength: content.length,
        duration,
      });

      return {
        success: true,
        content,
        cached: false,
        duration,
        source: 'module',
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.monitoringService.recordOperation({
        operationName,
        duration,
        success: false,
        timestamp: new Date(),
        metadata: { id, error: error.message },
      });

      this.logger.error('Failed to fetch class template', {
        id,
        error: error.message,
        stack: error.stack,
        duration,
      });

      return {
        success: false,
        content: '',
        cached: false,
        duration,
        source: 'fallback',
        error: error.message,
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async getClassTemplateLegacy(id: string, module: any): Promise<string> {
    if (!id || !module) {
      return '';
    }

    const result = await this.getClassTemplate(id, module);
    return result.content;
  }

  /**
   * Gets class guide with comprehensive error handling and caching
   */
  async getClassGuide(
    id: string, 
    module: any, 
    context?: AuthorizationContext
  ): Promise<TemplateOperationResult> {
    const startTime = Date.now();
    const operationName = 'getClassGuide';

    try {
      // Validate module parameter
      if (!module || !Array.isArray(module) || module.length === 0) {
        throw new Error('Module parameter is required and must be a non-empty array');
      }

      const moduleData = module[0];
      if (!moduleData || !moduleData.name) {
        throw new Error('Module data must contain a name property');
      }

      const moduleName = moduleData.name;

      // Input validation
      const request: TemplateRequest = { type: 'guide', moduleName, id };
      const validation = this.validateTemplateRequest(request);
      
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Authorization check (currently pass-through)
      if (context) {
        const authResult = await this.authorizationService.checkAuthorization(context, {
          operationType: 'query',
          operationName,
          resourceType: 'classGuide',
          resourceId: `${moduleName}:${id}`,
        });

        if (!authResult.allowed) {
          throw new Error(`Authorization failed: ${authResult.reason}`);
        }
      }

      this.logger.debug('Fetching class guide', { moduleName, id });

      // Check cache first
      const cached = this.templateCache.get('guide', moduleName, id);
      if (cached) {
        const duration = Date.now() - startTime;
        this.monitoringService.recordOperation({
          operationName,
          duration,
          success: true,
          timestamp: new Date(),
          metadata: { moduleName, id, cached: true },
        });

        return {
          success: true,
          content: cached,
          cached: true,
          duration,
          source: 'cache',
        };
      }

      // Check module health
      const moduleInfo = await this.checkModuleHealth(moduleName);
      if (!moduleInfo.available) {
        throw new Error(moduleInfo.error || 'Module not available');
      }

      if (!moduleInfo.hasGuide) {
        this.logger.warn('Module does not support guides', { moduleName });
        return {
          success: true,
          content: '',
          cached: false,
          duration: Date.now() - startTime,
          source: 'fallback',
        };
      }

      // Get module instance
      const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
      if (!moduleInstance) {
        throw new Error('Module instance not found');
      }

      if (typeof moduleInstance.getClassGuide !== 'function') {
        this.logger.warn('Module does not support class guides', { moduleName });
        return {
          success: true,
          content: '',
          cached: false,
          duration: Date.now() - startTime,
          source: 'fallback',
        };
      }

      // Fetch guide with timeout
      const guide = await Promise.race([
        moduleInstance.getClassGuide(id),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Class guide fetch timeout')), this.operationTimeout)
        ),
      ]);

      const content = guide || '';

      // Cache the result
      if (content) {
        this.templateCache.set('guide', moduleName, content, id);
      }

      const duration = Date.now() - startTime;
      this.monitoringService.recordOperation({
        operationName,
        duration,
        success: true,
        timestamp: new Date(),
        metadata: { moduleName, id, cached: false, contentLength: content.length },
      });

      this.logger.debug('Class guide fetched successfully', {
        moduleName,
        id,
        contentLength: content.length,
        duration,
      });

      return {
        success: true,
        content,
        cached: false,
        duration,
        source: 'module',
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.monitoringService.recordOperation({
        operationName,
        duration,
        success: false,
        timestamp: new Date(),
        metadata: { id, error: error.message },
      });

      this.logger.error('Failed to fetch class guide', {
        id,
        error: error.message,
        stack: error.stack,
        duration,
      });

      return {
        success: false,
        content: '',
        cached: false,
        duration,
        source: 'fallback',
        error: error.message,
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async getClassGuideLegacy(id: string, module: any): Promise<string> {
    if (!id || !module) {
      return '';
    }

    const result = await this.getClassGuide(id, module);
    return result.content;
  }

  /**
   * Gets service statistics for monitoring
   */
  getStatistics() {
    return this.monitoringService.getStatistics();
  }

  /**
   * Gets template cache statistics
   */
  getCacheStatistics() {
    return this.templateCache.getStatistics();
  }

  /**
   * Invalidates cache for a specific module
   */
  invalidateModuleCache(moduleName: string): void {
    this.templateCache.invalidateModule(moduleName);
    this.moduleHealthCache.delete(moduleName);
    
    this.logger.log('Module cache invalidated', { moduleName });
  }

  /**
   * Gets service health status
   */
  getHealthStatus() {
    const monitoringHealth = this.monitoringService.getHealthStatus();
    const cacheHealth = this.templateCache.getHealthStatus();

    return {
      healthy: monitoringHealth.healthy && cacheHealth.healthy,
      monitoring: monitoringHealth,
      cache: cacheHealth,
      moduleHealth: Array.from(this.moduleHealthCache.values()),
    };
  }

  getResolvers() {
    return {
      Module: {
        template: async ({ name }: { name: string }, context?: any) => {
          // Extract authorization context
          const authContext = this.authorizationService.extractAuthContext(context);
          
          this.logger.debug('Module template resolver called', { 
            name, 
            userId: authContext.user?.id 
          });

          return await this.getModuleTemplateLegacy(name);
        },
      },
      ComponentClass: {
        template: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          
          this.logger.debug('ComponentClass template resolver called', { 
            id, 
            moduleName: module?.[0]?.name,
            userId: authContext.user?.id 
          });

          return await this.getClassTemplateLegacy(id, module);
        },
        guide: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          
          this.logger.debug('ComponentClass guide resolver called', { 
            id, 
            moduleName: module?.[0]?.name,
            userId: authContext.user?.id 
          });

          return await this.getClassGuideLegacy(id, module);
        },
      },
      DataFlowClass: {
        template: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassTemplateLegacy(id, module);
        },
        guide: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassGuideLegacy(id, module);
        },
      },
      SecurityBoundaryClass: {
        template: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassTemplateLegacy(id, module);
        },
        guide: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassGuideLegacy(id, module);
        },
      },
      ControlClass: {
        template: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassTemplateLegacy(id, module);
        },
        guide: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassGuideLegacy(id, module);
        },
      },
      DataClass: {
        template: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassTemplateLegacy(id, module);
        },
        guide: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassGuideLegacy(id, module);
        },
      },
      IssueClass: {
        template: async ({ id, module }: { id: string; module: any[] }, context?: any) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return await this.getClassTemplateLegacy(id, module);
        },
      },
    };
  }
}
