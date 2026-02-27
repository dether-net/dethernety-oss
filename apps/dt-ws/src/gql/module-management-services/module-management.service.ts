import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DTModule, DTMetadata } from '@dethernety/dt-module';
import { GqlConfig } from '../gql.config';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ModuleClassDefinition,
  FlattenedProperties,
  ModuleInfo,
  UpsertResult,
  ModuleOperationOptions,
  ModuleStatistics,
  ValidationError,
  ModuleValidationResult,
  DatabaseTransaction,
  QueryResult,
  ALLOWED_CLASS_LABELS,
  MODULE_CLASS_CONFIGS,
} from '../interfaces/module-management.interface';

@Injectable()
export class ModuleManagementService {
  private readonly logger = new Logger(ModuleManagementService.name);
  private readonly config: GqlConfig;
  private statistics: ModuleStatistics = {
    totalModules: 0,
    totalClasses: 0,
    operationCount: 0,
    averageOperationTime: 0,
  };

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    
    this.logger.log('ModuleManagementService initialized', {
      allowedClassLabels: Array.from(ALLOWED_CLASS_LABELS),
      moduleClassConfigs: MODULE_CLASS_CONFIGS.length,
    });
  }

  /**
   * Checks if a module name matches the allowed modules whitelist.
   * Supports exact matches, '*' for all modules, and 'prefix*' for prefix matching.
   */
  private isModuleAllowed(moduleName: string): boolean {
    const allowedModules = this.config.allowedModules;

    // If no whitelist configured, allow all
    if (!allowedModules || allowedModules.length === 0) {
      return true;
    }

    // Check for global wildcard
    if (allowedModules.includes('*')) {
      return true;
    }

    // Check for exact match
    if (allowedModules.includes(moduleName)) {
      return true;
    }

    // Check for prefix patterns (e.g., 'aws-*', 'mitre-*')
    for (const pattern of allowedModules) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (moduleName.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validates metadata structure and content.
   */
  private validateMetadata(metadata: DTMetadata): ModuleValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!metadata) {
      errors.push({ field: 'metadata', message: 'Metadata is required' });
      return { isValid: false, errors, warnings };
    }

    if (!metadata.name || typeof metadata.name !== 'string') {
      errors.push({ 
        field: 'name', 
        message: 'Module name is required and must be a string',
        value: metadata.name 
      });
    }

    if (metadata.name && metadata.name.length > 100) {
      errors.push({ 
        field: 'name', 
        message: 'Module name must be less than 100 characters',
        value: metadata.name 
      });
    }

    // Optional field validation
    if (metadata.version && typeof metadata.version !== 'string') {
      warnings.push('Version should be a string');
    }

    if (metadata.description && typeof metadata.description !== 'string') {
      warnings.push('Description should be a string');
    }

    // Validate class arrays
    MODULE_CLASS_CONFIGS.forEach(({ key }) => {
      const classes = metadata[key];
      if (classes && !Array.isArray(classes)) {
        errors.push({ 
          field: key, 
          message: `${key} must be an array`,
          value: typeof classes 
        });
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates class label for security.
   */
  private validateClassLabel(classLabel: string): void {
    if (!ALLOWED_CLASS_LABELS.has(classLabel)) {
      throw new Error(`Invalid class label: ${classLabel}. Allowed labels: ${Array.from(ALLOWED_CLASS_LABELS).join(', ')}`);
    }
  }

  /**
   * Validates class object structure.
   */
  private validateClassObject(cls: any, classLabel: string): void {
    if (!cls) {
      throw new Error(`Class object is required for ${classLabel}`);
    }

    if (!cls.name || typeof cls.name !== 'string') {
      throw new Error(`Class name is required and must be a string for ${classLabel}`);
    }

    if (cls.name.length > 200) {
      throw new Error(`Class name too long (max 200 characters) for ${classLabel}`);
    }
  }

  /**
   * Records operation metrics for monitoring.
   */
  private recordOperation(operationName: string, duration: number, metadata?: any): void {
    this.statistics.operationCount++;
    
    // Update average operation time
    const totalTime = this.statistics.averageOperationTime * (this.statistics.operationCount - 1) + duration;
    this.statistics.averageOperationTime = totalTime / this.statistics.operationCount;
    this.statistics.lastOperationAt = new Date();

    this.logger.debug('Operation completed', {
      operation: operationName,
      duration,
      operationCount: this.statistics.operationCount,
      averageTime: Math.round(this.statistics.averageOperationTime),
      ...metadata,
    });
  }

  /**
   * Sanitizes the property keys of an object.
   * @param obj The object to sanitize
   * @returns The sanitized object
   */
  sanitizePropertyKeys(obj: any): FlattenedProperties {
    const sanitizedObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_.]/g, '_');
        const value = obj[key];

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          sanitizedObj[sanitizedKey] = this.sanitizePropertyKeys(value);
        } else {
          sanitizedObj[sanitizedKey] = value;
        }
      }
    }
    return sanitizedObj;
  }

  /**
   * Flattens nested properties of an object.
   * @param obj The object to flatten
   * @param prefix The prefix to add to the property keys
   * @param result The result object
   * @returns The flattened object
   */
  flattenNestedProperties(
    obj: any,
    prefix: string = '',
    result: any = {},
  ): any {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_.]/g, '_');
        const prefixedKey = prefix ? `${prefix}.${sanitizedKey}` : sanitizedKey;

        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length > 0
        ) {
          this.flattenNestedProperties(value, prefixedKey, result);
        } else {
          result[prefixedKey] = value;
        }
      }
    }
    return result;
  }

  /**
   * Flattens the properties of an object.
   * @param obj The object to flatten
   * @param excludeKeys The keys to exclude from the flattening
   * @returns The flattened object
   */
  flattenProperties(obj: any, excludeKeys: string[] = []): FlattenedProperties {
    try {
      if (!obj || typeof obj !== 'object') {
        return obj;
      }

      const { properties, ...rest } = obj;

      let flattenedProperties: FlattenedProperties = {};
      if (properties && typeof properties === 'object') {
        const sanitizedProperties = this.sanitizePropertyKeys(properties);
        flattenedProperties = this.flattenNestedProperties(
          sanitizedProperties,
          'properties',
        );
      }

      // Remove excluded keys
      for (const key of excludeKeys) {
        delete rest[key];
      }

      return {
        ...rest,
        ...flattenedProperties,
      };
    } catch (error) {
      this.logger.error('Failed to flatten properties', {
        error: error.message,
        excludeKeys,
        objectType: typeof obj,
      });
      throw new Error(`Property flattening failed: ${error.message}`);
    }
  }

  /**
   * Deletes old modules that are no longer valid.
   * @param tx The database transaction
   * @param validModuleNames Array of valid module names to keep
   */
  async deleteOldModules(tx: DatabaseTransaction, validModuleNames: string[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting old modules cleanup', {
        validModuleCount: validModuleNames.length,
        validModules: validModuleNames,
      });

      // Get existing modules from database
      const result: QueryResult = await tx.run(
        `MATCH (p:Module) RETURN p.name AS name`
      );
      
      const existingModuleNames = result.records.map((record) =>
        record.get('name')
      ).filter(name => name); // Filter out null/undefined names

      const modulesToDelete = existingModuleNames.filter(
        (name) => !validModuleNames.includes(name)
      );

      if (modulesToDelete.length > 0) {
        this.logger.log('Deleting obsolete modules', {
          modulesToDelete,
          count: modulesToDelete.length,
        });

        await tx.run(
          `MATCH (p:Module)
           WHERE p.name IN $modulesToDelete
           OPTIONAL MATCH (p)-[:HAS_CLASS]->(t)
           DETACH DELETE p, t`,
          { modulesToDelete }
        );

        this.statistics.totalModules = Math.max(0, this.statistics.totalModules - modulesToDelete.length);
      } else {
        this.logger.debug('No obsolete modules to delete');
      }

      const duration = Date.now() - startTime;
      this.recordOperation('deleteOldModules', duration, {
        deletedCount: modulesToDelete.length,
        existingCount: existingModuleNames.length,
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to delete old modules', {
        error: error.message,
        stack: error.stack,
        validModuleNames,
        duration,
      });
      throw new Error(`Module cleanup failed: ${error.message}`);
    }
  }

  /**
   * Deletes old classes.
   * @param tx The transaction
   * @param moduleId The module id
   * @param validNames The valid names
   * @param classLabel The class label
   */
  async deleteOldClasses(
    tx: any,
    moduleId: string,
    validNames: string[],
    classLabel: string,
  ) {
    try {
      const result = await tx.run(
        `
        MATCH (p:Module {id: $moduleId})-[:HAS_CLASS]->(t:${classLabel})
        RETURN t.name AS name
        `,
        { moduleId },
      );
      const existingNames = result.records.map((record) => record.get('name'));

      const namesToDelete = existingNames.filter(
        (name) => !validNames.includes(name),
      );

      if (namesToDelete.length > 0) {
        await tx.run(
          `
          MATCH (p:Module {id: $moduleId})-[:HAS_CLASS]->(t:${classLabel})
          WHERE t.name IN $namesToDelete
          DETACH DELETE t
          `,
          { moduleId, namesToDelete },
        );
      }
    } catch (error) {
      this.logger.error('Failed to delete old classes', {
        moduleId,
        classLabel,
        validNames,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Upserts a class with validation and error handling.
   * @param tx The database transaction
   * @param moduleId The module id
   * @param cls The class object
   * @param classLabel The class label
   */
  async upsertClass(
    tx: DatabaseTransaction, 
    moduleId: string, 
    cls: any, 
    classLabel: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate inputs
      this.validateClassLabel(classLabel);
      this.validateClassObject(cls, classLabel);

      if (!moduleId || typeof moduleId !== 'string') {
        throw new Error('Module ID is required and must be a string');
      }

      this.logger.debug('Upserting class', {
        moduleId,
        className: cls.name,
        classLabel,
      });

      const classData = this.flattenProperties(cls);
      const nodeProperties = {
        ...classData,
        updatedAt: new Date().toISOString(),
      };

      await tx.run(
        `MATCH (p:Module {id: $moduleId})
         MERGE (p)-[:HAS_CLASS]->(t:${classLabel} {name: $name})
         ON CREATE SET
           t.id = randomUUID(),
           t.createdAt = datetime()
         SET t += $nodeProperties
         RETURN t`,
        {
          moduleId,
          name: cls.name,
          nodeProperties,
        }
      );

      const duration = Date.now() - startTime;
      this.recordOperation('upsertClass', duration, {
        moduleId,
        className: cls.name,
        classLabel,
      });

      this.logger.debug('Class upserted successfully', {
        moduleId,
        className: cls.name,
        classLabel,
        duration,
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to upsert class', {
        moduleId,
        className: cls?.name,
        classLabel,
        error: error.message,
        stack: error.stack,
        duration,
      });
      throw new Error(`Class upsert failed for ${classLabel}/${cls?.name}: ${error.message}`);
    }
  }

  /**
   * Upserts a module with comprehensive validation and error handling.
   * @param tx The database transaction
   * @param metadata The module metadata
   * @param options Operation options
   * @returns UpsertResult with operation details
   */
  async upsertModule(
    tx: DatabaseTransaction, 
    metadata: DTMetadata, 
    options: ModuleOperationOptions = {}
  ): Promise<UpsertResult> {
    const startTime = Date.now();
    let classesProcessed = 0;

    try {
      this.logger.log('Starting module upsert', {
        moduleName: metadata.name,
        version: metadata.version,
        skipValidation: options.skipValidation,
      });

      // Validate metadata unless skipped
      if (!options.skipValidation) {
        const validation = this.validateMetadata(metadata);
        if (!validation.isValid) {
          const errorMessage = `Metadata validation failed: ${validation.errors.map(e => e.message).join(', ')}`;
          this.logger.error(errorMessage, {
            moduleName: metadata.name,
            errors: validation.errors,
          });
          throw new Error(errorMessage);
        }

        if (validation.warnings.length > 0) {
          this.logger.warn('Metadata validation warnings', {
            moduleName: metadata.name,
            warnings: validation.warnings,
          });
        }
      }

      // Prepare module data
      const moduleData = this.flattenProperties(
        metadata,
        MODULE_CLASS_CONFIGS.map((c) => c.key)
      );

      const nodeProperties = {
        ...moduleData,
        updatedAt: new Date().toISOString(),
      };

      // Upsert module
      this.logger.debug('Upserting module node', {
        moduleName: metadata.name,
        propertiesCount: Object.keys(nodeProperties).length,
      });

      const result: QueryResult = await tx.run(
        `MERGE (p:Module {name: $name})
         ON CREATE SET 
           p.id = randomUUID(),
           p.createdAt = datetime()
         SET p += $nodeProperties
         RETURN p.id AS moduleId, p.name AS name`,
        {
          name: metadata.name,
          nodeProperties,
        }
      );

      if (!result.records || result.records.length === 0) {
        throw new Error('Module upsert returned no results');
      }

      const moduleId = result.records[0].get('moduleId');
      const installedModuleName = result.records[0].get('name');

      if (!moduleId || !installedModuleName) {
        throw new Error('Module upsert returned invalid data');
      }

      this.logger.debug('Module node upserted successfully', {
        moduleId,
        moduleName: installedModuleName,
      });

      // Process module classes
      for (const modClass of MODULE_CLASS_CONFIGS) {
        const classes = metadata[modClass.key];
        if (classes && Array.isArray(classes)) {
          this.logger.debug(`Processing ${modClass.label} classes`, {
            moduleId,
            classCount: classes.length,
            classLabel: modClass.label,
          });

          for (const cls of classes) {
            try {
              await this.upsertClass(tx, moduleId, cls, modClass.label);
              classesProcessed++;
            } catch (error) {
              this.logger.error(`Failed to upsert class`, {
                moduleId,
                className: cls?.name,
                classLabel: modClass.label,
                error: error.message,
              });
              // Continue processing other classes
            }
          }

          // Update statistics
          this.statistics.totalClasses += classes.length;
        }
      }

      // Update module statistics
      this.statistics.totalModules++;

      const duration = Date.now() - startTime;
      const upsertResult: UpsertResult = {
        moduleId,
        moduleName: installedModuleName,
        classesProcessed,
        duration,
      };

      this.recordOperation('upsertModule', duration, {
        moduleName: installedModuleName,
        classesProcessed,
        moduleId,
      });

      this.logger.log('Module upsert completed successfully', upsertResult);

      return upsertResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Module upsert failed', {
        moduleName: metadata?.name,
        error: error.message,
        stack: error.stack,
        duration,
        classesProcessed,
      });
      throw new Error(`Module upsert failed for ${metadata?.name}: ${error.message}`);
    }
  }

  /**
   * Gets the module info by id using modern Neo4j v5 patterns.
   * @param moduleId The module id
   * @returns The module info
   */
  async getModuleInfoById(
    moduleId: string,
  ): Promise<{ name: string; path?: string } | null> {
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
    
    try {
      const result = await session.executeRead(async (tx: DatabaseTransaction) => {
        return await tx.run(
          `MATCH (m:Module {id: $moduleId})
           RETURN m.name AS name, m.path AS path`,
          { moduleId },
        );
      });

      if (result.records.length === 0) {
        return null;
      }

      return {
        name: result.records[0].get('name'),
        path: result.records[0].get('path'),
      };
    } catch (error) {
      this.logger.error(`Failed to get module info for ID ${moduleId}`, {
        moduleId,
        error: error.message,
        stack: error.stack,
      });
      return null;
    } finally {
      await session.close();
    }
  }

  /**
   * Resets a single module using modern Neo4j v5 transaction patterns.
   * @param moduleInstance The module instance
   * @param options Operation options
   * @returns The installed module name
   */
  async resetSingleModule(
    moduleInstance: DTModule, 
    options: ModuleOperationOptions = {}
  ): Promise<string> {
    const startTime = Date.now();
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
    let moduleInstalled = '';

    try {
      this.logger.log('Starting single module reset');

      await session.executeWrite(async (tx: DatabaseTransaction) => {
        const metadata = await Promise.resolve(moduleInstance.getMetadata());
        if (!metadata) {
          throw new Error('Module metadata not found');
        }

        this.logger.debug('Resetting module', {
          moduleName: metadata.name,
          version: metadata.version,
        });

        const result = await this.upsertModule(tx, metadata, options);
        moduleInstalled = result.moduleName;

        this.logger.log('Module reset successfully', {
          moduleName: moduleInstalled,
          moduleId: result.moduleId,
          classesProcessed: result.classesProcessed,
        });
      });

      const duration = Date.now() - startTime;
      this.recordOperation('resetSingleModule', duration, {
        moduleName: moduleInstalled,
      });

      return moduleInstalled;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to reset module', {
        error: error.message,
        stack: error.stack,
        duration,
      });
      throw new Error(`Module reset failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Updates all modules using modern Neo4j v5 transaction patterns.
   * @param modules Map of module names to DTModule instances
   * @param options Operation options
   */
  async updateAllModules(
    modules: Map<string, DTModule>, 
    options: ModuleOperationOptions = {}
  ): Promise<void> {
    const startTime = Date.now();
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
    const modulesInstalled: string[] = [];
    let processedCount = 0;
    let errorCount = 0;

    try {
      this.logger.log('Starting bulk module update', {
        moduleCount: modules.size,
        moduleNames: Array.from(modules.keys()),
        options,
      });

      await session.executeWrite(async (tx: DatabaseTransaction) => {
        for (const [moduleName, moduleInstance] of modules) {
          try {
            this.logger.debug('Processing module for update', { moduleName });

            const metadata = await Promise.resolve(moduleInstance.getMetadata());
            if (!metadata) {
              this.logger.warn('Module metadata not found, skipping', { moduleName });
              continue;
            }

            const result = await this.upsertModule(tx, metadata, options);
            modulesInstalled.push(result.moduleName);
            processedCount++;

            this.logger.debug('Module processed successfully', {
              moduleName,
              moduleId: result.moduleId,
              classesProcessed: result.classesProcessed,
            });

          } catch (error) {
            errorCount++;
            this.logger.error('Failed to process module during bulk update', {
              moduleName,
              error: error.message,
              stack: error.stack,
            });
            // Continue with other modules
          }
        }

        // Clean up obsolete modules
        if (modulesInstalled.length > 0) {
          await this.deleteOldModules(tx, modulesInstalled);
        }
      });

      const duration = Date.now() - startTime;
      this.recordOperation('updateAllModules', duration, {
        totalModules: modules.size,
        processedCount,
        errorCount,
        installedModules: modulesInstalled,
      });

      this.logger.log('Bulk module update completed', {
        totalModules: modules.size,
        processedCount,
        errorCount,
        duration,
        successRate: processedCount / modules.size,
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Bulk module update failed', {
        error: error.message,
        stack: error.stack,
        totalModules: modules.size,
        processedCount,
        errorCount,
        duration,
      });
      throw new Error(`Bulk module update failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Gets comprehensive service statistics for monitoring.
   * @returns Current service statistics
   */
  getStatistics(): ModuleStatistics {
    return {
      ...this.statistics,
    };
  }

  /**
   * Resets service statistics (useful for testing).
   */
  resetStatistics(): void {
    this.statistics = {
      totalModules: 0,
      totalClasses: 0,
      operationCount: 0,
      averageOperationTime: 0,
    };
    this.logger.log('Service statistics reset');
  }

  /**
   * Gets list of modules that have frontend bundle.js files
   */
  async getAvailableFrontendModules(moduleRegistryService: { getAllModuleEntries(): Map<string, any> }): Promise<string[]> {
    const startTime = Date.now();
    const operationName = 'getAvailableFrontendModules';

    try {
      this.logger.debug('Getting available frontend modules');

      // Get all registered module entries from the module registry
      const moduleEntries = moduleRegistryService.getAllModuleEntries();
      const availableModules: string[] = [];

      for (const [moduleName, entry] of moduleEntries) {
        // Only consider healthy modules
        if (!entry.isHealthy) {
          this.logger.debug('Skipping unhealthy module for frontend check', {
            moduleName,
            isHealthy: entry.isHealthy,
          });
          continue;
        }

        try {
          // Get the directory path from the module's file path
          const moduleDir = path.dirname(entry.filePath);
          const frontendBundlePath = path.join(moduleDir, 'frontend', 'bundle.js');
          
          // Check if bundle.js exists
          await fs.access(frontendBundlePath);
          availableModules.push(moduleName);
          
          this.logger.debug('Found frontend module', {
            moduleName,
            moduleDir,
            bundlePath: frontendBundlePath,
            version: entry.version,
          });
        } catch {
          // bundle.js doesn't exist for this module - skip silently
          this.logger.debug('No frontend bundle found for module', {
            moduleName,
            moduleDir: path.dirname(entry.filePath),
          });
        }
      }

      const duration = Date.now() - startTime;
      this.recordOperation(operationName, duration, {
        totalRegisteredModules: moduleEntries.size,
        healthyModules: Array.from(moduleEntries.values()).filter(e => e.isHealthy).length,
        modulesWithFrontend: availableModules.length,
        modules: availableModules,
      });

      this.logger.log('Frontend modules retrieved successfully', {
        totalRegisteredModules: moduleEntries.size,
        healthyModules: Array.from(moduleEntries.values()).filter(e => e.isHealthy).length,
        modulesWithFrontend: availableModules.length,
        modules: availableModules,
        duration,
      });

      return availableModules;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to get available frontend modules', {
        error: error.message,
        stack: error.stack,
        duration,
      });

      throw error;
    }
  }

  /**
   * Gets the content of a module's frontend bundle.js file
   */
  async getModuleFrontendBundle(moduleName: string, moduleRegistryService: { getAllModuleEntries(): Map<string, any> }): Promise<string> {
    const startTime = Date.now();
    const operationName = 'getModuleFrontendBundle';

    try {
      // Input validation
      if (!moduleName) {
        throw new Error('Module name is required');
      }

      if (typeof moduleName !== 'string') {
        throw new Error('Module name must be a string');
      }

      if (moduleName.trim().length === 0) {
        throw new Error('Module name cannot be empty');
      }

      // Security: Prevent path traversal attacks
      if (moduleName.includes('..') || moduleName.includes('/') || moduleName.includes('\\')) {
        throw new Error('Invalid module name: path traversal not allowed');
      }

      this.logger.debug('Getting frontend bundle for module', {
        moduleName,
      });

      // Get module entry from the module registry
      const moduleEntries = moduleRegistryService.getAllModuleEntries();
      const moduleEntry = moduleEntries.get(moduleName);

      if (!moduleEntry) {
        throw new Error(`Module '${moduleName}' is not registered`);
      }

      if (!moduleEntry.isHealthy) {
        throw new Error(`Module '${moduleName}' is not healthy`);
      }

      // Check if module is in allowed list (security)
      if (!this.isModuleAllowed(moduleName)) {
        throw new Error(`Module '${moduleName}' is not in the allowed modules list`);
      }

      // Get the module directory from the registered file path
      const moduleDir = path.dirname(moduleEntry.filePath);
      const frontendBundlePath = path.join(moduleDir, 'frontend', 'bundle.js');

      // Security: Ensure the resolved path is still within the expected module directory
      const resolvedPath = path.resolve(frontendBundlePath);
      const allowedBasePath = path.resolve(moduleDir);
      if (!resolvedPath.startsWith(allowedBasePath)) {
        throw new Error('Invalid bundle path: outside module directory');
      }

      let bundleContent: string;
      try {
        bundleContent = await fs.readFile(frontendBundlePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`Frontend bundle not found for module '${moduleName}' at path: ${frontendBundlePath}`);
        } else if (error.code === 'EACCES') {
          throw new Error(`Access denied to frontend bundle for module '${moduleName}'`);
        } else {
          throw new Error(`Failed to read frontend bundle for module '${moduleName}': ${error.message}`);
        }
      }

      const duration = Date.now() - startTime;
      this.recordOperation(operationName, duration, {
        moduleName,
        moduleVersion: moduleEntry.version,
        moduleDir,
        bundlePath: frontendBundlePath,
        bundleSize: bundleContent.length,
      });

      this.logger.log('Frontend bundle retrieved successfully', {
        moduleName,
        moduleVersion: moduleEntry.version,
        moduleDir,
        bundlePath: frontendBundlePath,
        bundleSize: bundleContent.length,
        duration,
      });

      return bundleContent;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to get module frontend bundle', {
        moduleName,
        error: error.message,
        stack: error.stack,
        duration,
      });

      throw error;
    }
  }

}
