import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { DTModule, DTMetadata } from '@dethernety/dt-module';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import { ModuleManagementService } from './module-management.service';
import { GqlConfig } from '../gql.config';
import {
  ModuleEntry,
  ModuleHealthStatus,
  ModuleHealth,
  ModuleLoadResult,
  ModuleSecurityValidation,
  ModuleLoadOptions,
} from '../interfaces/module-registry.interface';

@Injectable()
export class ModuleRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private customModules = new Map<string, ModuleEntry>();
  private readonly config: GqlConfig;
  private readonly allowedModules: Set<string>;

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly moduleManagementService: ModuleManagementService,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    this.allowedModules = new Set(this.config.allowedModules.map(m => m.toLowerCase()));
    
    this.logger.log('Module Registry initialized', {
      customModulesPath: this.config.customModulesPath,
      allowedModulesCount: this.allowedModules.size,
      securityValidationEnabled: this.config.enableModuleSecurityValidation,
      hotReloadEnabled: this.config.enableModuleHotReload,
    });
  }

  async onModuleInit() {
    try {
      this.logger.log('Starting module initialization...');
      await this.loadModules();
      
      // Convert ModuleEntry map to DTModule map for backward compatibility
      const moduleInstances = new Map<string, DTModule>();
      for (const [name, entry] of this.customModules) {
        if (entry.isHealthy) {
          moduleInstances.set(name, entry.instance);
        }
      }
      
      await this.moduleManagementService.updateAllModules(moduleInstances);
      
      this.logger.log('Module initialization completed', {
        totalModules: this.customModules.size,
        healthyModules: moduleInstances.size,
        unhealthyModules: this.customModules.size - moduleInstances.size,
      });
    } catch (error) {
      this.logger.error('Failed to initialize modules', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Checks if a module name matches the allowed modules whitelist.
   * Supports exact matches, '*' for all modules, and 'prefix*' for prefix matching.
   */
  private isModuleAllowed(moduleName: string): boolean {
    // If no whitelist configured, allow all
    if (this.allowedModules.size === 0) {
      return true;
    }

    // Check for global wildcard
    if (this.allowedModules.has('*')) {
      return true;
    }

    // Check for exact match (case-insensitive)
    const normalizedName = moduleName.toLowerCase();
    if (this.allowedModules.has(normalizedName)) {
      return true;
    }

    // Check for prefix patterns (e.g., 'aws-*', 'mitre-*')
    for (const pattern of this.allowedModules) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (normalizedName.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validates module security before loading.
   */
  private async validateModuleSecurity(filePath: string, moduleName: string): Promise<ModuleSecurityValidation> {
    const validation: ModuleSecurityValidation = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      // Skip security validation if disabled (development mode)
      if (!this.config.enableModuleSecurityValidation) {
        validation.warnings.push('Security validation disabled');
        return validation;
      }

      // Check if module is in whitelist (if whitelist is configured)
      if (!this.isModuleAllowed(moduleName)) {
        validation.isValid = false;
        validation.errors.push(`Module '${moduleName}' not in allowed modules list`);
        return validation;
      }

      // Check file permissions
      const stats = await fs.stat(filePath);
      if (stats.mode & 0o002) { // World writable
        validation.isValid = false;
        validation.errors.push('Module file is world writable');
      }

      // Check file size (prevent extremely large modules)
      const maxFileSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxFileSize) {
        validation.warnings.push(`Module file is large (${Math.round(stats.size / 1024 / 1024)}MB)`);
      }

      // Check file age (warn about very old files)
      const daysSinceModified = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceModified > 365) {
        validation.warnings.push(`Module file is old (${Math.round(daysSinceModified)} days)`);
      }

    } catch (error) {
      validation.isValid = false;
      validation.errors.push(`Security validation failed: ${safeErrorMessage(error)}`);
    }

    return validation;
  }

  /**
   * Validates module interface compliance.
   */
  private async validateModuleInterface(moduleInstance: DTModule): Promise<boolean> {
    try {
      // Check if module implements required getMetadata method
      if (typeof moduleInstance.getMetadata !== 'function') {
        return false;
      }

      // Try to get metadata to ensure it works
      const metadata = await Promise.resolve(moduleInstance.getMetadata());
      if (!metadata || !metadata.name) {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Module interface validation failed', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Creates a secure Neo4j driver wrapper for modules.
   */
  private createSecureDriver(): any {
    // In production, we might want to create a restricted driver
    // For now, we'll use the full driver but log access
    return new Proxy(this.neo4jDriver, {
      get: (target, prop) => {
        if (prop === 'session') {
          return (...args: any[]) => {
            this.logger.debug('Module accessing Neo4j session', { args });
            return target.session(...args);
          };
        }
        return target[prop];
      }
    });
  }

  /**
   * Creates a module-specific logger instance.
   */
  private createModuleLogger(moduleName: string): Logger {
    return new Logger(`Module:${moduleName}`);
  }

  /**
   * Loads a single module with comprehensive error handling.
   */
  private async loadModuleWithRetry(
    filePath: string,
    options: ModuleLoadOptions = {}
  ): Promise<ModuleLoadResult> {
    const startTime = Date.now();
    const {
      maxRetries = 3,
      timeout = this.config.moduleLoadTimeout,
      skipSecurityValidation = false,
      forceReload = false
    } = options;

    const result: ModuleLoadResult = {
      success: false,
      loadTime: 0,
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Loading module attempt ${attempt}`, { filePath });

        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Module load timeout')), timeout);
        });

        // Load module with timeout
        const loadPromise = this.loadModuleInternal(filePath, skipSecurityValidation, forceReload);
        const moduleData = await Promise.race([loadPromise, timeoutPromise]);

        result.success = true;
        result.module = moduleData.module;
        result.metadata = moduleData.metadata;
        result.loadTime = Date.now() - startTime;

        this.logger.debug(`Module loaded successfully on attempt ${attempt}`, {
          filePath,
          loadTime: result.loadTime,
          moduleName: result.metadata?.name,
        });

        return result;

      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        
        this.logger.warn(`Module load attempt ${attempt} failed`, {
          filePath,
          attempt,
          maxRetries,
          error: error.message,
          isLastAttempt,
        });

        if (isLastAttempt) {
          result.error = safeErrorMessage(error);
          result.loadTime = Date.now() - startTime;
          return result;
        }

        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return result;
  }

  /**
   * Internal module loading logic.
   */
  private async loadModuleInternal(
    filePath: string,
    skipSecurityValidation: boolean,
    forceReload: boolean
  ): Promise<{ module: DTModule; metadata: DTMetadata }> {
    const moduleName = path.basename(path.dirname(filePath));

    // Security validation
    if (!skipSecurityValidation) {
      const securityValidation = await this.validateModuleSecurity(filePath, moduleName);
      
      if (securityValidation.warnings.length > 0) {
        this.logger.warn('Module security warnings', {
          filePath,
          moduleName,
          warnings: securityValidation.warnings,
        });
      }

      if (!securityValidation.isValid) {
        throw new Error(`Security validation failed: ${securityValidation.errors.join(', ')}`);
      }
    }

    // Clear require cache if force reload
    if (forceReload) {
      delete require.cache[require.resolve(filePath)];
    }

    // Import module
    const customModule = await import(filePath);
    const ModuleClass = customModule.default;

    if (!ModuleClass) {
      throw new Error('Module does not export default class');
    }

    // Create module instance with driver and logger
    const moduleLogger = this.createModuleLogger(moduleName);
    this.logger.debug('Creating module instance with logger', {
      moduleName,
      loggerContext: `Module:${moduleName}`,
    });
    
    const moduleInstance: DTModule = new ModuleClass(this.createSecureDriver(), moduleLogger);

    // Validate interface
    if (!(await this.validateModuleInterface(moduleInstance))) {
      throw new Error('Module does not implement required DTModule interface');
    }

    // Get metadata
    const metadata = await Promise.resolve(moduleInstance.getMetadata());

    return { module: moduleInstance, metadata };
  }

  private modulesLoaded = false;

  /**
   * Loads all modules from the custom modules directory.
   * Safe to call multiple times — skips loading if already done.
   */
  async loadModules() {
    if (this.modulesLoaded) return;
    this.modulesLoaded = true;
    const customModuleDir = path.isAbsolute(this.config.customModulesPath)
      ? this.config.customModulesPath
      : path.join(process.cwd(), this.config.customModulesPath);
    
    try {
      // Check if custom modules directory exists
      await fs.access(customModuleDir);
    } catch (error) {
      this.logger.warn('Custom modules directory not found', {
        path: customModuleDir,
        error: error.message,
      });
      return;
    }

    this.logger.log('Loading modules from directory', { customModuleDir });

    // Clear existing modules cache
    this.customModules.clear();

    try {
      // Get all subdirectories
      const entries = await fs.readdir(customModuleDir, { withFileTypes: true });
      const subDirs = entries
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => path.join(customModuleDir, dirent.name));

      let loadedCount = 0;
      let failedCount = 0;

      for (const subDir of subDirs) {
        try {
          // Find module files
          const files = await fs.readdir(subDir);
          const moduleFiles = files.filter((f) => f.endsWith('Module.js'));

          for (const file of moduleFiles) {
            const filePath = path.join(subDir, file);
            const loadResult = await this.loadModuleWithRetry(filePath);

            if (loadResult.success && loadResult.module && loadResult.metadata) {
              const moduleName = loadResult.metadata.name;

              // Check for duplicate modules
              if (this.customModules.has(moduleName)) {
                this.logger.warn('Duplicate module name detected', {
                  moduleName,
                  existingPath: this.customModules.get(moduleName)?.filePath,
                  newPath: filePath,
                });
                continue;
              }

              // Create module entry
              const moduleEntry: ModuleEntry = {
                instance: loadResult.module,
                metadata: loadResult.metadata,
                loadedAt: new Date(),
                filePath,
                version: loadResult.metadata.version,
                loadAttempts: 1,
                isHealthy: true,
              };

              // Collect schema extension if the module provides one
              if (typeof loadResult.module.getSchemaExtension === 'function') {
                try {
                  const fragment = await loadResult.module.getSchemaExtension();
                  if (fragment?.trim()) {
                    moduleEntry.schemaFragment = fragment;
                    this.logger.log('Module provided schema extension', { moduleName });
                  }
                } catch (error) {
                  this.logger.warn('Failed to get schema extension from module', {
                    moduleName,
                    error: safeErrorMessage(error),
                  });
                }
              }

              this.customModules.set(moduleName, moduleEntry);
              loadedCount++;

              this.logger.log('Module loaded successfully', {
                moduleName,
                version: loadResult.metadata.version,
                filePath,
                loadTime: loadResult.loadTime,
              });
            } else {
              failedCount++;
              this.logger.error('Failed to load module', {
                filePath,
                error: loadResult.error,
                loadTime: loadResult.loadTime,
              });
            }
          }
        } catch (error) {
          this.logger.error('Failed to process module directory', {
            subDir,
            error: error.message,
          });
          failedCount++;
        }
      }

      this.logger.log('Module loading completed', {
        totalAttempted: loadedCount + failedCount,
        successfullyLoaded: loadedCount,
        failed: failedCount,
        loadedModules: Array.from(this.customModules.keys()),
      });

    } catch (error) {
      this.logger.error('Failed to load modules', {
        customModuleDir,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Reloads a module.
   * @param moduleName The name of the module
   * @returns The module instance
   */
  async reloadModule(moduleName: string): Promise<DTModule | null> {
    if (!this.config.enableModuleHotReload) {
      this.logger.warn('Module hot reload is disabled', { moduleName });
      return null;
    }

    this.logger.log('Attempting to reload module', { moduleName });

    try {
      const existingEntry = this.customModules.get(moduleName);
      const customModuleDir = path.isAbsolute(this.config.customModulesPath)
        ? this.config.customModulesPath
        : path.join(process.cwd(), this.config.customModulesPath);

      // Check if custom modules directory exists
      try {
        await fs.access(customModuleDir);
      } catch (error) {
        this.logger.error('Custom modules directory not accessible', {
          path: customModuleDir,
          error: error.message,
        });
        return null;
      }

      // Get all subdirectories
      const entries = await fs.readdir(customModuleDir, { withFileTypes: true });
      const subDirs = entries
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => path.join(customModuleDir, dirent.name));

      for (const subDir of subDirs) {
        try {
          const files = await fs.readdir(subDir);
          const moduleFiles = files.filter((f) => f.endsWith('Module.js'));

          for (const file of moduleFiles) {
            const filePath = path.join(subDir, file);
            
            // Load module with force reload
            const loadResult = await this.loadModuleWithRetry(filePath, {
              forceReload: true,
              maxRetries: 1,
            });

            if (loadResult.success && loadResult.metadata?.name === moduleName) {
              // Update module entry
              const moduleEntry: ModuleEntry = {
                instance: loadResult.module!,
                metadata: loadResult.metadata,
                loadedAt: existingEntry?.loadedAt || new Date(),
                filePath,
                version: loadResult.metadata.version,
                lastReloadAt: new Date(),
                loadAttempts: (existingEntry?.loadAttempts || 0) + 1,
                isHealthy: true,
              };

              this.customModules.set(moduleName, moduleEntry);

              this.logger.log('Module reloaded successfully', {
                moduleName,
                version: loadResult.metadata.version,
                filePath,
                loadTime: loadResult.loadTime,
                totalLoadAttempts: moduleEntry.loadAttempts,
              });

              return loadResult.module!;
            }
          }
        } catch (error) {
          this.logger.error('Failed to process directory during reload', {
            subDir,
            error: error.message,
          });
        }
      }

      this.logger.warn('Module not found during reload', { moduleName });
      return null;

    } catch (error) {
      this.logger.error('Failed to reload module', {
        moduleName,
        error: error.message,
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Resets a module by id.
   * @param moduleId The id of the module
   * @returns True if the module was reset, false otherwise
   */
  async resetModuleById(moduleId: string): Promise<boolean> {
    this.logger.log('Attempting to reset module', { moduleId });

    try {
      // Get module info from database
      const moduleInfo = await this.moduleManagementService.getModuleInfoById(moduleId);
      if (!moduleInfo) {
        this.logger.error('Module not found in database', { moduleId });
        return false;
      }

      this.logger.log('Found module in database', {
        moduleId,
        moduleName: moduleInfo.name,
      });

      // Reload module
      const moduleInstance = await this.reloadModule(moduleInfo.name);
      if (!moduleInstance) {
        this.logger.error('Failed to reload module', {
          moduleId,
          moduleName: moduleInfo.name,
        });
        return false;
      }

      // Reset module in database
      await this.moduleManagementService.resetSingleModule(moduleInstance);

      this.logger.log('Module reset successfully', {
        moduleId,
        moduleName: moduleInfo.name,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to reset module', {
        moduleId,
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  /**
   * Gets a module by name.
   * @param name The name of the module
   * @returns The module instance
   */
  getModuleByName(name: string): DTModule | undefined {
    const entry = this.customModules.get(name);
    return entry?.isHealthy ? entry.instance : undefined;
  }

  /**
   * Gets all modules (backward compatibility).
   * @returns All healthy modules
   */
  getAllModules(): Map<string, DTModule> {
    const modules = new Map<string, DTModule>();
    for (const [name, entry] of this.customModules) {
      if (entry.isHealthy) {
        modules.set(name, entry.instance);
      }
    }
    return modules;
  }

  /**
   * Gets all module entries with full metadata.
   * @returns All module entries
   */
  getAllModuleEntries(): Map<string, ModuleEntry> {
    return new Map(this.customModules);
  }

  /**
   * Gets GraphQL schema fragments from all healthy modules that provide them.
   * @returns Array of GraphQL SDL strings
   */
  getSchemaFragments(): string[] {
    const fragments: string[] = [];
    for (const [name, entry] of this.customModules) {
      if (entry.isHealthy && entry.schemaFragment) {
        fragments.push(entry.schemaFragment);
        this.logger.debug('Including schema fragment from module', { moduleName: name });
      }
    }
    return fragments;
  }

  /**
   * Gets module health status.
   * @returns Comprehensive health status of all modules
   */
  async getModuleHealth(): Promise<ModuleHealthStatus> {
    const healthStatus: ModuleHealthStatus = {
      totalModules: this.customModules.size,
      healthyModules: 0,
      unhealthyModules: 0,
      lastCheckAt: new Date(),
      modules: [],
    };

    for (const [name, entry] of this.customModules) {
      const moduleHealth: ModuleHealth = {
        name,
        status: 'healthy',
        loadedAt: entry.loadedAt,
        version: entry.version,
        lastHealthCheck: new Date(),
      };

      try {
        // Test module basic functionality
        const metadata = await Promise.race([
          Promise.resolve(entry.instance.getMetadata()),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]) as DTMetadata;

        if (!metadata || !metadata.name) {
          throw new Error('Invalid metadata returned');
        }

        moduleHealth.status = 'healthy';
        healthStatus.healthyModules++;
        
        // Update entry health status
        entry.isHealthy = true;

      } catch (error) {
        moduleHealth.status = 'unhealthy';
        moduleHealth.error = safeErrorMessage(error);
        healthStatus.unhealthyModules++;
        
        // Update entry health status
        entry.isHealthy = false;

        this.logger.warn('Module health check failed', {
          moduleName: name,
          error: error.message,
        });
      }

      healthStatus.modules.push(moduleHealth);
    }

    this.logger.debug('Module health check completed', {
      totalModules: healthStatus.totalModules,
      healthyModules: healthStatus.healthyModules,
      unhealthyModules: healthStatus.unhealthyModules,
    });

    return healthStatus;
  }

  /**
   * Gets module statistics for monitoring.
   */
  getModuleStatistics() {
    const stats = {
      totalModules: this.customModules.size,
      healthyModules: 0,
      unhealthyModules: 0,
      oldestModule: null as Date | null,
      newestModule: null as Date | null,
      totalLoadAttempts: 0,
      modulesByVersion: new Map<string, number>(),
    };

    for (const [name, entry] of this.customModules) {
      if (entry.isHealthy) {
        stats.healthyModules++;
      } else {
        stats.unhealthyModules++;
      }

      stats.totalLoadAttempts += entry.loadAttempts;

      // Track oldest and newest modules
      if (!stats.oldestModule || entry.loadedAt < stats.oldestModule) {
        stats.oldestModule = entry.loadedAt;
      }
      if (!stats.newestModule || entry.loadedAt > stats.newestModule) {
        stats.newestModule = entry.loadedAt;
      }

      // Track versions
      if (entry.version) {
        const count = stats.modulesByVersion.get(entry.version) || 0;
        stats.modulesByVersion.set(entry.version, count + 1);
      }
    }

    return stats;
  }

  /**
   * Performs a health check on a specific module.
   */
  async checkModuleHealth(moduleName: string): Promise<ModuleHealth> {
    const entry = this.customModules.get(moduleName);
    
    if (!entry) {
      return {
        name: moduleName,
        status: 'failed',
        error: 'Module not found',
        lastHealthCheck: new Date(),
      };
    }

    const moduleHealth: ModuleHealth = {
      name: moduleName,
      status: 'loading',
      loadedAt: entry.loadedAt,
      version: entry.version,
      lastHealthCheck: new Date(),
    };

    try {
      // Test module functionality with timeout
      const metadata = await Promise.race([
        Promise.resolve(entry.instance.getMetadata()),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]) as DTMetadata;

      if (!metadata || !metadata.name) {
        throw new Error('Invalid metadata returned');
      }

      moduleHealth.status = 'healthy';
      entry.isHealthy = true;

      this.logger.debug('Module health check passed', {
        moduleName,
        version: entry.version,
      });

    } catch (error) {
      moduleHealth.status = 'unhealthy';
      moduleHealth.error = safeErrorMessage(error);
      entry.isHealthy = false;

      this.logger.warn('Module health check failed', {
        moduleName,
        error: error.message,
      });
    }

    return moduleHealth;
  }
}
