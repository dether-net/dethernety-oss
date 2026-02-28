import { DTModule, DTMetadata, Countermeasure, Exposure, DbOps, OpaOps, Policy } from './index';
import * as https from 'https';
import * as http from 'http';
import { Logger } from '@nestjs/common';

export class DtNeo4jOpaModule implements DTModule {
  private readonly moduleName: string;
  private readonly dbOps: DbOps;
  private readonly driver: any;
  private opaInstance: any = null;
  private policiesLoaded: boolean = false;
  private opaOps: OpaOps;
  private readonly logger: Logger;

  constructor(moduleName: string, driver: any, logger: Logger) {
    this.moduleName = moduleName;
    this.driver = driver;
    this.logger = logger;
    this.dbOps = new DbOps(driver);
    this.opaOps = new OpaOps(process.env.OPA_COMPILE_SERVER_URL || 'http://localhost:8181');
    
    this.logger.log('DtNeo4jOpaModule initialized successfully', {
      moduleName: this.moduleName,
      opaServerUrl: process.env.OPA_COMPILE_SERVER_URL || 'http://localhost:8181',
      timestamp: new Date().toISOString(),
    });
  }

  private resetInProgress: boolean = false;

  /**
   * Decodes a potentially base64-encoded string.
   * If the string looks like base64 (doesn't start with 'package'), decode it.
   * Otherwise, return as-is.
   */
  private decodeRegoPolicies(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    // If it already looks like Rego (starts with 'package'), return as-is
    const trimmed = value.trim();
    if (trimmed.startsWith('package ')) {
      return value;
    }

    // Try to decode as base64
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      // Verify it looks like valid Rego after decoding
      if (decoded.trim().startsWith('package ')) {
        this.logger.debug('Decoded base64-encoded Rego policies', {
          moduleName: this.moduleName,
          originalLength: value.length,
          decodedLength: decoded.length
        });
        return decoded;
      }
    } catch (e) {
      // Not valid base64, return original
      this.logger.debug('Failed to decode as base64, using original value', {
        moduleName: this.moduleName,
        error: e instanceof Error ? e.message : String(e)
      });
    }

    return value;
  }

  /**
   * Get the metadata for the module from Neo4J database
   * @returns The metadata for the module
   */
  async getMetadata(): Promise<DTMetadata> {
    const startTime = Date.now();
    this.logger.log('Starting getMetadata operation', {
      moduleName: this.moduleName,
      operation: 'getMetadata'
    });
    
    const session = this.driver.session();
    const policies: Policy[] = [];
    
    try {
      // Get module metadata
      const moduleResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})
         RETURN module.name as name, 
                module.description as description,
                module.icon as icon,
                module.version as version,
                module.author as author`,
        { moduleName: this.moduleName }
      );

      if (moduleResult.records.length === 0) {
        this.logger.error('Module not found in database', {
          moduleName: this.moduleName,
          operation: 'getMetadata',
          stage: 'module_lookup'
        });
        throw new Error(`Module ${this.moduleName} not found`);
      }

      const moduleRecord = moduleResult.records[0];
      const metadata: DTMetadata = {
        name: moduleRecord.get('name'),
        description: moduleRecord.get('description'),
        icon: moduleRecord.get('icon'),
        version: moduleRecord.get('version'),
        author: moduleRecord.get('author')
      };
      
      this.logger.debug('Module metadata retrieved', {
        moduleName: this.moduleName,
        version: metadata.version,
        author: metadata.author
      });

      // Get component classes
      const componentResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(cc:DTComponentClass)
         RETURN cc.name as name,
                cc.description as description,
                cc.type as type,
                cc.category as category,
                cc.icon as icon,
                cc.properties as properties,
                cc.id as id,
                cc.regoPolicies as regoPolicies`,
        { moduleName: this.moduleName }
      );

      metadata.componentClasses = componentResult.records.map((record: any) => ({
        name: record.get('name'),
        description: record.get('description'),
        type: record.get('type'),
        category: record.get('category'),
        icon: record.get('icon'),
        properties: record.get('properties'),
        dt_class_id: record.get('id')
      }));
      
      this.logger.debug('Component classes retrieved', {
        moduleName: this.moduleName,
        componentClassCount: metadata.componentClasses?.length || 0
      });

      for (const record of componentResult.records) {
        const regoPolicies = this.decodeRegoPolicies(record.get('regoPolicies'));
        const policyId = this.moduleName + '.' + record.get('type') + '.' + record.get('name').toLowerCase();
        if (regoPolicies) {
          const cleanPolicyId = policyId.trim().replaceAll(" ", "_").replaceAll(/[^A-Za-z0-9._]/g, '');
          policies.push({
            id: cleanPolicyId,
            raw: regoPolicies
          });
          this.logger.debug('Added component class policy', {
            moduleName: this.moduleName,
            policyId: cleanPolicyId,
            className: record.get('name')
          });
        }
      }

      // Get dataflow classes
      const dataflowResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(dfc:DTDataFlowClass)
         RETURN dfc.name as name,
                dfc.description as description,
                dfc.type as type,
                dfc.category as category,
                dfc.icon as icon,
                dfc.properties as properties,
                dfc.id as id,
                dfc.regoPolicies as regoPolicies`,
        { moduleName: this.moduleName }
      );

      metadata.dataFlowClasses = dataflowResult.records.map((record: any) => ({
        name: record.get('name'),
        description: record.get('description'),
        type: record.get('type'),
        category: record.get('category'),
        icon: record.get('icon'),
        properties: record.get('properties'),
        dt_class_id: record.get('id')
      }));
      
      this.logger.debug('DataFlow classes retrieved', {
        moduleName: this.moduleName,
        dataFlowClassCount: metadata.dataFlowClasses?.length || 0
      });

      for (const record of dataflowResult.records) {
        const regoPolicies = this.decodeRegoPolicies(record.get('regoPolicies'));
        if (regoPolicies) {
          const policyId = this.moduleName + '.' + record.get('type') + '.' + record.get('name').toLowerCase();
          const cleanPolicyId = policyId.trim().replaceAll(" ", "_").replaceAll(/[^A-Za-z0-9._]/g, '');
          policies.push({
            id: cleanPolicyId,
            raw: regoPolicies
          });
          this.logger.debug('Added dataflow class policy', {
            moduleName: this.moduleName,
            policyId: cleanPolicyId,
            className: record.get('name')
          });
        }
      }

      // Get security boundary classes
      const securityBoundaryResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(sbc:DTSecurityBoundaryClass)
         RETURN sbc.name as name,
                sbc.description as description,
                sbc.type as type,
                sbc.category as category,
                sbc.icon as icon,
                sbc.properties as properties,
                sbc.id as id,
                sbc.regoPolicies as regoPolicies`,
        { moduleName: this.moduleName }
      );

      metadata.securityBoundaryClasses = securityBoundaryResult.records.map((record: any) => ({
        name: record.get('name'),
        description: record.get('description'),
        type: record.get('type'),
        category: record.get('category'),
        icon: record.get('icon'),
        properties: record.get('properties'),
        dt_class_id: record.get('id')
      }));
      
      this.logger.debug('Security boundary classes retrieved', {
        moduleName: this.moduleName,
        securityBoundaryClassCount: metadata.securityBoundaryClasses?.length || 0
      });

      for (const record of securityBoundaryResult.records) {
        const regoPolicies = this.decodeRegoPolicies(record.get('regoPolicies'));
        if (regoPolicies) {
          const policyId = this.moduleName + '.' + record.get('type') + '.' + record.get('name').toLowerCase();
          const cleanPolicyId = policyId.trim().replaceAll(" ", "_").replaceAll(/[^A-Za-z0-9._]/g, '');
          this.logger.debug('Adding security boundary policy', {
            moduleName: this.moduleName,
            policyId: cleanPolicyId,
            className: record.get('name')
          });
          policies.push({
            id: cleanPolicyId,
            raw: regoPolicies
          });
        }
      }

      // Get control classes
      const controlResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(cc:DTControlClass)
         RETURN cc.name as name,
                cc.description as description,
                cc.type as type,
                cc.category as category,
                cc.icon as icon,
                cc.properties as properties,
                cc.id as id,
                cc.regoPolicies as regoPolicies`,
        { moduleName: this.moduleName }
      );

      metadata.controlClasses = controlResult.records.map((record: any) => ({
        name: record.get('name'),
        description: record.get('description'),
        type: record.get('type'),
        category: record.get('category'),
        icon: record.get('icon'),
        properties: record.get('properties'),
        dt_class_id: record.get('id')
      }));
      
      this.logger.debug('Control classes retrieved', {
        moduleName: this.moduleName,
        controlClassCount: metadata.controlClasses?.length || 0
      });

      for (const record of controlResult.records) {
        const regoPolicies = this.decodeRegoPolicies(record.get('regoPolicies'));
        if (regoPolicies) {
          const policyId = this.moduleName + '.' + record.get('type') + '.' + record.get('name').toLowerCase();
          const cleanPolicyId = policyId.trim().replaceAll(" ", "_").replaceAll(/[^A-Za-z0-9._]/g, '');
          policies.push({
            id: cleanPolicyId,
            raw: regoPolicies
          });
          this.logger.debug('Added control class policy', {
            moduleName: this.moduleName,
            policyId: cleanPolicyId,
            className: record.get('name')
          });
        }
      }

      // Get data classes
      const dataResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(dc:DTDataClass)
         RETURN dc.name as name,
                dc.description as description,
                dc.type as type,
                dc.category as category,
                dc.icon as icon,
                dc.properties as properties,
                dc.id as id,
                dc.regoPolicies as regoPolicies`,
        { moduleName: this.moduleName }
      );

      metadata.dataClasses = dataResult.records.map((record: any) => ({
        name: record.get('name'),
        description: record.get('description'),
        type: record.get('type'),
        category: record.get('category'),
        icon: record.get('icon'),
        properties: record.get('properties'),
        dt_class_id: record.get('id')
      }));
      
      this.logger.debug('Data classes retrieved', {
        moduleName: this.moduleName,
        dataClassCount: metadata.dataClasses?.length || 0
      });

      for (const record of dataResult.records) {
        const regoPolicies = this.decodeRegoPolicies(record.get('regoPolicies'));
        if (regoPolicies) {
          const policyId = this.moduleName + '.' + record.get('type') + '.' + record.get('name').toLowerCase();
          const cleanPolicyId = policyId.trim().replaceAll(" ", "_").replaceAll(/[^A-Za-z0-9._]/g, '');
          policies.push({
            id: cleanPolicyId,
            raw: regoPolicies
          });
          this.logger.debug('Added data class policy', {
            moduleName: this.moduleName,
            policyId: cleanPolicyId,
            className: record.get('name')
          });
        }
      }

      // Get issue classes
      const issueResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(tc:DTIssueClass)
         RETURN tc.name as name,
                tc.description as description,
                tc.type as type,
                tc.category as category,
                tc.icon as icon,
                tc.properties as properties,
                tc.id as id`,
        { moduleName: this.moduleName }
      );

      metadata.issueClasses = issueResult.records.map((record: any) => ({
        name: record.get('name'),
        description: record.get('description'),
        type: record.get('type'),
        category: record.get('category'),
        icon: record.get('icon'),
        properties: record.get('properties'),
        dt_class_id: record.get('id')
      }));
      
      this.logger.debug('Issue classes retrieved', {
        moduleName: this.moduleName,
        issueClassCount: metadata.issueClasses?.length || 0
      });

      // Launch policy reset without blocking metadata return.
      // resetPolicies has its own try/catch with full error logging.
      // Blocking here causes module load timeouts with large policy sets (70+ policies).
      this.resetPolicies(policies).catch((err) => {
        this.logger.error('Background policy reset failed', {
          moduleName: this.moduleName,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      const duration = Date.now() - startTime;
      this.logger.log('getMetadata operation completed successfully', {
        moduleName: this.moduleName,
        operation: 'getMetadata',
        duration: `${duration}ms`,
        totalPolicies: policies.length,
        componentClasses: metadata.componentClasses?.length || 0,
        dataFlowClasses: metadata.dataFlowClasses?.length || 0,
        securityBoundaryClasses: metadata.securityBoundaryClasses?.length || 0,
        controlClasses: metadata.controlClasses?.length || 0,
        dataClasses: metadata.dataClasses?.length || 0,
        issueClasses: metadata.issueClasses?.length || 0
      });

      return metadata;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Error getting metadata for module', {
        moduleName: this.moduleName,
        operation: 'getMetadata',
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  private async resetPolicies(policies: Policy[]) {
    if (!this.resetInProgress) {
      this.resetInProgress = true;
      const startTime = Date.now();
      
      this.logger.log('Starting policy reset operation', {
        moduleName: this.moduleName,
        operation: 'resetPolicies',
        policyCount: policies.length
      });
      
      try {
        await this.opaOps.deletePolicyByPrefix(this.moduleName + '.');
        this.logger.debug('Deleted existing policies', {
          moduleName: this.moduleName,
          prefix: this.moduleName + '.'
        });
        
        await this.opaOps.installPolicies(policies);
        
        const duration = Date.now() - startTime;
        this.logger.log('Policy reset completed successfully', {
          moduleName: this.moduleName,
          operation: 'resetPolicies',
          duration: `${duration}ms`,
          policiesInstalled: policies.length
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error('Error during policy reset', {
          moduleName: this.moduleName,
          operation: 'resetPolicies',
          duration: `${duration}ms`,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      } finally {
        this.resetInProgress = false;
      }
    } else {
      this.logger.warn('Policy reset already in progress, skipping', {
        moduleName: this.moduleName,
        operation: 'resetPolicies'
      });
    }
  }

  /**
   * Get the template for the module
   * @returns The template for the module
   */
  async getModuleTemplate(): Promise<string> {
    this.logger.debug('Retrieving module template', {
      moduleName: this.moduleName,
      operation: 'getModuleTemplate'
    });
    
    const template = `{
      "schema": {
        "type": "object",
        "properties": {
          "opa_compile_server_url": {
            "type": "string",
            "format": "uri"
          }
        }
      },
      "uischema": {
        "type": "VerticalLayout",
        "elements": [
          {
            "type": "Control",
            "scope": "#/properties/opa_compile_server_url"
          }
        ]
      }
    }`;
    
    this.logger.debug('Module template retrieved successfully', {
      moduleName: this.moduleName,
      operation: 'getModuleTemplate',
      templateLength: template.length
    });
    
    return template;
  }

  /**
   * Get the template for a class from Neo4J database
   * @param id The id of the class
   * @returns The template for the class
   */
  async getClassTemplate(id: string): Promise<string> {
    const startTime = Date.now();
    this.logger.log('Starting getClassTemplate operation', {
      moduleName: this.moduleName,
      operation: 'getClassTemplate',
      classId: id
    });

    try {
      const dtClassId = await this.dbOps.getAttribute(id, 'dt_class_id') as string;
      this.logger.debug('Retrieved dt_class_id', {
        moduleName: this.moduleName,
        classId: id,
        dtClassId: dtClassId
      });

      const session = this.driver.session();
      try {
        const result = await session.run(
          `MATCH (class)
           WHERE class.id = $dtClassId AND (class:DTComponentClass OR class:DTDataFlowClass OR class:DTSecurityBoundaryClass OR class:DTControlClass OR class:DTDataClass OR class:DTIssueClass)
           RETURN class.template as template`,
          { dtClassId }
        );

        if (result.records.length === 0) {
          this.logger.error('Class template not found in database', {
            moduleName: this.moduleName,
            operation: 'getClassTemplate',
            classId: id,
            dtClassId: dtClassId
          });
          throw new Error(`Class template not found for id: ${dtClassId}`);
        }

        const template = result.records[0].get('template');
        if (!template) {
          this.logger.error('Template is empty for class', {
            moduleName: this.moduleName,
            operation: 'getClassTemplate',
            classId: id,
            dtClassId: dtClassId
          });
          throw new Error(`Template is empty for class id: ${dtClassId}`);
        }

        const duration = Date.now() - startTime;
        this.logger.log('getClassTemplate completed successfully', {
          moduleName: this.moduleName,
          operation: 'getClassTemplate',
          classId: id,
          dtClassId: dtClassId,
          duration: `${duration}ms`,
          templateLength: template.length
        });

        return template;
      } finally {
        await session.close();
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Error getting template for class', {
        moduleName: this.moduleName,
        operation: 'getClassTemplate',
        classId: id,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  async getClassGuide(id: string): Promise<string> {
    const startTime = Date.now();
    this.logger.log('Starting getClassGuide operation', {
      moduleName: this.moduleName,
      operation: 'getClassGuide',
      classId: id
    });

    try {
      const dtClassId = await this.dbOps.getAttribute(id, 'dt_class_id') as string;
      this.logger.debug('Retrieved dt_class_id for guide', {
        moduleName: this.moduleName,
        classId: id,
        dtClassId: dtClassId
      });

      const session = this.driver.session();
      try {
        const result = await session.run(
          `MATCH (class)
           WHERE class.id = $dtClassId AND (class:DTComponentClass OR class:DTDataFlowClass OR class:DTSecurityBoundaryClass OR class:DTControlClass OR class:DTDataClass OR class:DTIssueClass)
           RETURN class.configurationOptionsGuide as guide`,
          { dtClassId }
        );

        if (result.records.length === 0) {
          this.logger.error('Class guide not found in database', {
            moduleName: this.moduleName,
            operation: 'getClassGuide',
            classId: id,
            dtClassId: dtClassId
          });
          throw new Error(`Class guide not found for id: ${dtClassId}`);
        }

        const guide = result.records[0].get('guide');
        if (!guide) {
          this.logger.error('Guide is empty for class', {
            moduleName: this.moduleName,
            operation: 'getClassGuide',
            classId: id,
            dtClassId: dtClassId
          });
          throw new Error(`Guide is empty for class id: ${dtClassId}`);
        }

        const duration = Date.now() - startTime;
        this.logger.log('getClassGuide completed successfully', {
          moduleName: this.moduleName,
          operation: 'getClassGuide',
          classId: id,
          dtClassId: dtClassId,
          duration: `${duration}ms`,
          guideLength: guide.length
        });

        return guide;
      } finally {
        await session.close();
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Error getting guide for class', {
        moduleName: this.moduleName,
        operation: 'getClassGuide',
        classId: id,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get the exposures for a class from Neo4J database
   * @param id The id of the class
   * @returns The exposures for the class
   */
  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const startTime = Date.now();
    this.logger.log('Starting getExposures operation', {
      moduleName: this.moduleName,
      operation: 'getExposures',
      instanceId: id,
      classId: classId
    });
    
    const exposures: Exposure[] = [];

    try {
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      const dtClassId = await this.dbOps.getAttribute(classId, 'dt_class_id');
      
      this.logger.debug('Retrieved class attributes and dtClassId', {
        moduleName: this.moduleName,
        instanceId: id,
        classId: classId,
        dtClassId: dtClassId,
        hasAttributes: !!attributes
      });
      
      // extract the package name from the Rego policy
      const regoPoliciesRaw = await this.dbOps.getAttribute(dtClassId, 'regoPolicies');
      const regoPolicies = this.decodeRegoPolicies(regoPoliciesRaw as string);
      const regoPackageName = regoPolicies
        ? this.extractRegoPackageName(regoPolicies)
        : undefined;

      const policyPath = regoPackageName?.replaceAll('.', '/') + '/exposures';
      
      this.logger.debug('Extracted Rego package information', {
        moduleName: this.moduleName,
        instanceId: id,
        regoPackageName: regoPackageName,
        policyPath: policyPath
      });

      if (!attributes) {
        this.logger.debug('No attributes found, returning empty exposures', {
          moduleName: this.moduleName,
          instanceId: id,
          classId: classId
        });
        return exposures;
      }

      try {
        const result = await this.opaOps.evaluate(policyPath, attributes);
        if (result && result.length > 0) {
          exposures.push(...result
            .filter((exposure: any) => exposure.name)
            .map((exposure: any) => ({
              name: exposure.name,
              description: exposure.description,
              criticality: exposure.criticality,
              type: exposure.type,
              category: exposure.category,
              exploitedBy: exposure.exploited_by || exposure.exploitedBy
            })));

          this.logger.debug('Exposures evaluated successfully', {
            moduleName: this.moduleName,
            instanceId: id,
            policyPath: policyPath,
            exposureCount: exposures.length,
            exposureNames: exposures.map(e => e.name)
          });
        } else {
          this.logger.debug('No exposures found from policy evaluation', {
            moduleName: this.moduleName,
            instanceId: id,
            policyPath: policyPath
          });
        }
      } catch (err: unknown) {
        this.logger.error('Error evaluating exposures policy', {
          moduleName: this.moduleName,
          operation: 'getExposures',
          instanceId: id,
          policyPath: policyPath,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        });
        throw err;
      }

    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      this.logger.error('Error getting exposures for class', {
        moduleName: this.moduleName,
        operation: 'getExposures',
        instanceId: id,
        classId: classId,
        duration: `${duration}ms`,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      throw err;
    }
    
    const duration = Date.now() - startTime;
    this.logger.log('getExposures completed successfully', {
      moduleName: this.moduleName,
      operation: 'getExposures',
      instanceId: id,
      classId: classId,
      duration: `${duration}ms`,
      exposureCount: exposures.length
    });
    
    return exposures;
  }

  /**
   * Get the countermeasures for a class from Neo4J database
   * @param id The id of the class
   * @returns The countermeasures for the class
   */
  async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]> {
    const startTime = Date.now();
    this.logger.log('Starting getCountermeasures operation', {
      moduleName: this.moduleName,
      operation: 'getCountermeasures',
      instanceId: id,
      classId: classId
    });
    
    const counterMeasures: Countermeasure[] = [];
    
    try {
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      const dtClassId = await this.dbOps.getAttribute(classId, 'dt_class_id');
      
      this.logger.debug('Retrieved class attributes and dtClassId for countermeasures', {
        moduleName: this.moduleName,
        instanceId: id,
        classId: classId,
        dtClassId: dtClassId,
        hasAttributes: !!attributes
      });
      
      // extract the package name from the Rego policy
      const regoPoliciesRaw = await this.dbOps.getAttribute(dtClassId, 'regoPolicies');
      const regoPolicies = this.decodeRegoPolicies(regoPoliciesRaw as string);
      const regoPackageName = regoPolicies
        ? this.extractRegoPackageName(regoPolicies)
        : undefined;

      const policyPath = regoPackageName?.replaceAll('.', '/') + '/countermeasures';
      
      this.logger.debug('Extracted Rego package information for countermeasures', {
        moduleName: this.moduleName,
        instanceId: id,
        regoPackageName: regoPackageName,
        policyPath: policyPath
      });
      
      if (!attributes) {
        this.logger.debug('No attributes found, returning empty countermeasures', {
          moduleName: this.moduleName,
          instanceId: id,
          classId: classId
        });
        return counterMeasures;
      }

      try {
        const result = await this.opaOps.evaluate(policyPath, attributes);
        counterMeasures.push(...result.map((countermeasure: any) => ({
          name: countermeasure.name,
          description: countermeasure.description,
          criticality: countermeasure.criticality,
          type: countermeasure.type,
          category: countermeasure.category,
          respondsWith: countermeasure.responds_with || countermeasure.respondsWith
        })));

        this.logger.debug('Countermeasures evaluated successfully', {
          moduleName: this.moduleName,
          instanceId: id,
          policyPath: policyPath,
          countermeasureCount: counterMeasures.length,
          countermeasureNames: counterMeasures.map(c => c.name)
        });
      } catch (err: unknown) {
        this.logger.error('Error evaluating countermeasures policy', {
          moduleName: this.moduleName,
          operation: 'getCountermeasures',
          instanceId: id,
          policyPath: policyPath,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        });
        throw err;
      }

    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      this.logger.error('Error getting countermeasures for class', {
        moduleName: this.moduleName,
        operation: 'getCountermeasures',
        instanceId: id,
        classId: classId,
        duration: `${duration}ms`,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      throw err;
    }
    
    const duration = Date.now() - startTime;
    this.logger.log('getCountermeasures completed successfully', {
      moduleName: this.moduleName,
      operation: 'getCountermeasures',
      instanceId: id,
      classId: classId,
      duration: `${duration}ms`,
      countermeasureCount: counterMeasures.length
    });
    
    return counterMeasures;
  }

  /**
   * Extracts the package name from a Rego policy string.
   * The package definition can be on any line.
   * @param regoPolicies - The Rego policy string
   * @returns The package name or undefined if not found
   */
  private extractRegoPackageName(regoPolicies: string): string | undefined {
    // Use regex to find package declaration on any line
    // Matches "package" followed by whitespace and captures the package name until end of line or whitespace
    if (!regoPolicies) {
      this.logger.debug('regoPolicies is undefined or empty', {
        moduleName: this.moduleName,
        operation: 'extractRegoPackageName'
      });
      return undefined;
    }
    
    const packageMatch = regoPolicies.match(/^package\s+([^\s\n]+)/m);
    const packageName = packageMatch ? packageMatch[1] : undefined;
    
    this.logger.debug('Extracted Rego package name', {
      moduleName: this.moduleName,
      operation: 'extractRegoPackageName',
      packageName: packageName,
      found: !!packageName
    });
    
    return packageName;
  }
} 
