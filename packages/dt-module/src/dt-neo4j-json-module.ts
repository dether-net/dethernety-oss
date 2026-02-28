import jsonLogic from "json-logic-js";

import { DTModule, DTMetadata, Countermeasure, Exposure, DbOps } from './index';

export class DtNeo4jJsonModule implements DTModule {
  private readonly moduleName: string;
  private readonly dbOps: DbOps;
  private readonly driver: any;

  constructor(moduleName: string, driver: any) {
    this.moduleName = moduleName;
    this.driver = driver;
    this.dbOps = new DbOps(driver);
  }

  /**
   * Get the metadata for the module from Neo4J database
   * @returns The metadata for the module
   */
  async getMetadata(): Promise<DTMetadata> {
    const session = this.driver.session();
    
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

      // Get component classes
      const componentResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(cc:DTComponentClass)
         RETURN cc.name as name,
                cc.description as description,
                cc.type as type,
                cc.category as category,
                cc.icon as icon,
                cc.properties as properties,
                cc.id as id`,
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

      // Get dataflow classes
      const dataflowResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(dfc:DTDataFlowClass)
         RETURN dfc.name as name,
                dfc.description as description,
                dfc.type as type,
                dfc.category as category,
                dfc.icon as icon,
                dfc.properties as properties,
                dfc.id as id`,
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

      // Get security boundary classes
      const securityBoundaryResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(sbc:DTSecurityBoundaryClass)
         RETURN sbc.name as name,
                sbc.description as description,
                sbc.type as type,
                sbc.category as category,
                sbc.icon as icon,
                sbc.properties as properties,
                sbc.id as id`,
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

      // Get control classes
      const controlResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(cc:DTControlClass)
         RETURN cc.name as name,
                cc.description as description,
                cc.type as type,
                cc.category as category,
                cc.icon as icon,
                cc.properties as properties,
                cc.id as id`,
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

      // Get data classes
      const dataResult = await session.run(
        `MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(dc:DTDataClass)
         RETURN dc.name as name,
                dc.description as description,
                dc.type as type,
                dc.category as category,
                dc.icon as icon,
                dc.properties as properties,
                dc.id as id`,
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

      return metadata;

    } catch (error) {
      console.error(`Error getting metadata for module ${this.moduleName}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get the template for a class from Neo4J database
   * @param id The id of the class
   * @returns The template for the class
   */
  async getClassTemplate(id: string): Promise<string> {
    const session = this.driver.session();
    const dtClassId = await this.dbOps.getAttribute(id, 'dt_class_id');

    try {
      const result = await session.run(
        `MATCH (class) 
         WHERE class.id = $dtClassId AND (class:DTComponentClass OR class:DTDataFlowClass OR class:DTSecurityBoundaryClass OR class:DTControlClass OR class:DTDataClass)
         RETURN class.template as template`,
        { dtClassId }
      );

      if (result.records.length === 0) {
        throw new Error(`Class template not found for id: ${dtClassId}`);
      }

      const template = result.records[0].get('template');
      if (!template) {
        throw new Error(`Template is empty for class id: ${dtClassId}`);
      }

      return template;

    } catch (error) {
      console.error(`Error getting template for class ${dtClassId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get the exposures for a class from Neo4J database
   * @param id The id of the class
   * @returns The exposures for the class
   */
  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    try {
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      const dtClassId = await this.dbOps.getAttribute(classId, 'dt_class_id');
      
      if (!attributes) {
        return exposures;
      }

      const session = this.driver.session();

      try {
        const result = await session.run(
          `MATCH (class) 
           WHERE class.id = $dtClassId AND (class:DTComponentClass OR class:DTDataFlowClass OR class:DTSecurityBoundaryClass OR class:DTControlClass OR class:DTDataClass)
           RETURN class.exposureRules as exposureRules`,
          { dtClassId }
        );

        if (result.records.length === 0) {
          console.warn(`No exposure rules found for class ${dtClassId}`);
          return exposures;
        }

        const exposureRules = result.records[0].get('exposureRules');
        if (!exposureRules) {
          return exposures;
        }

        let parsedExposureRules: any;
        try {
          parsedExposureRules = JSON.parse(exposureRules);
        } catch (error) {
          console.error(`Error parsing exposure rules for class ${dtClassId}:`, error);
          return exposures;
        }

        // Handle case where rules are wrapped in an "exposures" property
        const rules = Array.isArray(parsedExposureRules) ? parsedExposureRules : parsedExposureRules.exposures;

        if (!Array.isArray(rules)) {
          console.warn(`Exposure rules for class ${dtClassId} is not an array. Got: ${typeof rules}`);
          return exposures;
        }

        for (const rule of rules) {
          const { condition, exposureTemplate } = rule;

          // Use JsonLogic to evaluate the rule against attributes
          const isMatch = jsonLogic.apply(condition, attributes);

          if (isMatch) {
            exposures.push({
              name: exposureTemplate.name,
              description: exposureTemplate.description,
              type: exposureTemplate.type ?? 'Exposure',
              category: exposureTemplate.category ?? 'Technical',
              score: jsonLogic.apply(exposureTemplate.score, attributes),
              reference: exposureTemplate.reference,
              mitigationTechniques: exposureTemplate.mitigationTechniques || [],
              detectionTechniques: exposureTemplate.detectionTechniques || [],
              tags: exposureTemplate.tags || [],
              exploitedBy: exposureTemplate.exploitedBy || [],
            });
          }
        }

      } finally {
        await session.close();
      }

    } catch (err: unknown) {
      console.error(`Error getting exposures for class ${id}:`, err instanceof Error ? err.message : String(err));
      throw err;
    }

    return exposures;
  }

  /**
   * Get the countermeasures for a class from Neo4J database
   * @param id The id of the class
   * @returns The countermeasures for the class
   */
  async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]> {
    const counterMeasures: Countermeasure[] = [];
    
    try {
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      const dtClassId = await this.dbOps.getAttribute(classId, 'dt_class_id');
      
      if (!attributes) {
        return counterMeasures;
      }

      const session = this.driver.session();

      try {
        const result = await session.run(
          `MATCH (class) 
            WHERE class.id = $dtClassId AND (class:DTComponentClass OR class:DTDataFlowClass OR class:DTSecurityBoundaryClass OR class:DTControlClass OR class:DTDataClass)
            RETURN class.countermeasureRules as countermeasureRules`,
          { dtClassId }
        );

        if (result.records.length === 0) {
          console.warn(`No countermeasure rules found for class ${dtClassId}`);
          return counterMeasures;
        }

        const countermeasureRules = result.records[0].get('countermeasureRules');
        if (!countermeasureRules) {
          return counterMeasures;
        }

        let parsedCountermeasureRules: any;
        try {
          parsedCountermeasureRules = JSON.parse(countermeasureRules);
        } catch (error) {
          console.error(`Error parsing countermeasure rules for class ${dtClassId}:`, error);
          return counterMeasures;
        }

        // Handle case where rules are wrapped in a "countermeasures" property
        const rules = Array.isArray(parsedCountermeasureRules) ? parsedCountermeasureRules : parsedCountermeasureRules.countermeasures;

        if (!Array.isArray(rules)) {
          console.warn(`Countermeasure rules for class ${dtClassId} is not an array. Got: ${typeof rules}`);
          return counterMeasures;
        }

        for (const rule of rules) {
          const { condition, countermeasureTemplate } = rule;

          // Use JsonLogic to evaluate the rule against attributes
          const isMatch = jsonLogic.apply(condition, attributes);

          if (isMatch) {
            counterMeasures.push({
              name: countermeasureTemplate.name,
              description: countermeasureTemplate.description,
              type: countermeasureTemplate.type ?? 'Countermeasure',
              category: countermeasureTemplate.category ?? 'Containerization',
              score: jsonLogic.apply(countermeasureTemplate.score, attributes),
              reference: countermeasureTemplate.reference,
              addressedExposures: countermeasureTemplate.addressedExposures || [],
              tags: countermeasureTemplate.tags || [],
              respondsWith: countermeasureTemplate.respondsWith || [],
            });
          }
        }

      } finally {
        await session.close();
      }

    } catch (err: unknown) {
      console.error(`Error getting countermeasures for class ${id}:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
    
    return counterMeasures;
  }
} 