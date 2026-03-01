import * as fs from 'fs';
import * as path from 'path';
import jsonLogic from "json-logic-js";

import { DTModule, DTMetadata, Countermeasure, Exposure, DbOps } from './index';

export class DtFileJsonModule implements DTModule {
  private readonly moduleDataDir: string;
  private readonly moduleName: string;
  private readonly dbOps: DbOps;

  constructor(moduleDataDir: string, moduleName: string, driver: any) {
    this.moduleDataDir = moduleDataDir;
    this.moduleName = moduleName;
    this.dbOps = new DbOps(driver);
  }
  
  private getClassDirectories(classesDir: string): string[] | null {
    if (fs.existsSync(classesDir)) {
      const entries = fs.readdirSync(classesDir, { withFileTypes: true });
      return entries
        .filter((entry: any) => entry.isDirectory())
        .map((entry: any) => entry.name);
    }
    return null;
  }

  private getClassMetaData(
    classesDir: string,
    className: string,
  ): any | null {
    const classDir = path.join(classesDir, className);
    this.validateModulePath(classDir);
    const metadataPath = path.join(classDir, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      const metaData = fs.readFileSync(metadataPath, 'utf8');
      try {
        const metadata = JSON.parse(metaData);
        // Compute the relative path from the module base directory to the class directory

        const relativePath = path.relative(this.moduleDataDir, classDir);
        metadata.path = relativePath;
        return metadata;
      } catch (err: unknown) {
        console.error(
          `Error parsing class metadata for ${className}:`,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }
    } else {
      console.warn(`Metadata file not found for class ${className}, skipping.`);
      return null;
    }
  }

  /**
   * Get the metadata for the module
   * @returns The metadata for the module
   */
  getMetadata(): DTMetadata {
    const moduleDir = path.join(this.moduleDataDir, this.moduleName);
    const metadataPath = path.join(moduleDir, 'metadata.json');
    const classTypes = [
      {
        key: 'componentClasses',
        label: 'ComponentClass',
        dir: 'ComponentClasses',
      },
      {
        key: 'dataFlowClasses',
        label: 'DataFlowClass',
        dir: 'DataFlowClasses',
      },
      {
        key: 'securityBoundaryClasses',
        label: 'SecurityBoundaryClass',
        dir: 'SecurityBoundaryClasses',
      },
      {
        key: 'controlClasses',
        label: 'ControlClass',
        dir: 'ControlClasses',
      },
      {
        key: 'dataClasses',
        label: 'DataClass',
        dir: 'DataClasses',
      },
    ];
    let parsedMetaData;

    const metaData = fs.existsSync(metadataPath)
      ? fs.readFileSync(metadataPath, 'utf8')
      : null;
    if (metaData) {
      try {
        parsedMetaData = JSON.parse(metaData);
        if (parsedMetaData) {
          for (const classType of classTypes) {
            const { key, label, dir } = classType;
            const classesDir = path.join(moduleDir, dir);
            if (!fs.existsSync(classesDir)) {
              console.warn(`Classes directory not found: ${classesDir}`);
              continue;
            }
            const classes = this.getClassDirectories(classesDir);
            if (classes && classes.length > 0) {
              let classData: any[] = [];
              for (const className of classes) {
                const classMetadata = this.getClassMetaData(
                  classesDir,
                  className,
                );
                if (classMetadata) {
                  classData.push(classMetadata);
                }
              }
              parsedMetaData[key] = classData;
            }
          }
        }
      } catch (err: unknown) {
        console.error('Error parsing metadata:', err instanceof Error ? err.message : String(err));
        throw new Error('Unable to parse metadata');
      }
    } else {
      throw new Error('Metadata file not found');
    }
    return parsedMetaData;
  }

  /**
   * Get the template for a class
   * @param id The id of the class
   * @returns The template for the class
   */
  private validateModulePath(filePath: string): void {
    const resolved = path.resolve(filePath);
    const moduleBase = path.resolve(this.moduleDataDir);
    if (!resolved.startsWith(moduleBase + path.sep) && resolved !== moduleBase) {
      throw new Error('Path traversal detected: path escapes module directory');
    }
  }

  async getClassTemplate(id: string): Promise<string> {
    const classDataPath = await this.dbOps.getAttribute(id, 'path');
    const templatePath = path.join(this.moduleDataDir, classDataPath, 'template.json');
    this.validateModulePath(templatePath);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Schema file not found: ${templatePath}`);
    }
    const fsContent = fs.readFileSync(templatePath, 'utf8');
    return fsContent
  }

  /**
   * Get the exposures for a class
   * @param id The id of the class
   * @returns The exposures for the class
   */
  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    try {
      const classDataPath = await this.dbOps.getAttribute(classId, 'path');
      const exposureRulesPath = path.join(this.moduleDataDir, classDataPath, 'exposure-rules.json');
      this.validateModulePath(exposureRulesPath);
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      if (attributes) {
        if (!fs.existsSync(exposureRulesPath)) {
          console.warn(`Exposure rules file not found: ${exposureRulesPath}`);
          return exposures;
        }
        
        const rulesData = fs.readFileSync(exposureRulesPath, 'utf-8');
        let parsedData: any;
        try {
          parsedData = JSON.parse(rulesData);
        } catch (parseError) {
          console.error(`Error parsing exposure rules for class ${classId}:`, parseError instanceof Error ? parseError.message : String(parseError));
          return exposures;
        }

        // Handle case where rules are wrapped in an "exposures" property
        const rules = Array.isArray(parsedData) ? parsedData : parsedData.exposures;

        // Add validation to ensure rules is iterable
        if (!Array.isArray(rules)) {
          console.warn(`Exposure rules for class ${classId} is not an array. Got: ${typeof rules}`);
          return exposures;
        }

        for (const rule of rules) {
          const { condition, exposureTemplate } = rule;
    
          // Use JsonLogic to evaluate the rule against attributes
          const isMatch = jsonLogic.apply(condition, attributes);
    
          if (isMatch) {
            // Step 4: Create Exposure Object Based on Rule
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
      }
    } catch (err: unknown) {
      console.error(`Error getting exposures for class ${id}:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
    return exposures
  }

  /**
   * Get the countermeasures for a class
   * @param id The id of the class
   * @returns The countermeasures for the class
   */
  async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]> {
    const counterMeasures: Countermeasure[] = [];
    try {
      const classDataPath = await this.dbOps.getAttribute(classId, 'path');
      const countermeasureRulesPath = path.join(this.moduleDataDir, classDataPath, 'countermeasure-rules.json');
      this.validateModulePath(countermeasureRulesPath);
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      if (attributes) {
        if (!fs.existsSync(countermeasureRulesPath)) {
          console.warn(`Countermeasure rules file not found: ${countermeasureRulesPath}`);
          return counterMeasures;
        }
        const rulesData = fs.readFileSync(countermeasureRulesPath, 'utf-8');
        let parsedData: any;
        try {
          parsedData = JSON.parse(rulesData);
        } catch (parseError) {
          console.error(`Error parsing countermeasure rules for class ${classId}:`, parseError instanceof Error ? parseError.message : String(parseError));
          return counterMeasures;
        }

        // Handle case where rules are wrapped in a "countermeasures" property
        const rules = Array.isArray(parsedData) ? parsedData : parsedData.countermeasures;

        // Add validation to ensure rules is iterable
        if (!Array.isArray(rules)) {
          console.warn(`Countermeasure rules for class ${classId} is not an array. Got: ${typeof rules}`);
          return counterMeasures;
        }

        for (const rule of rules) {
          const { condition, countermeasureTemplate } = rule;

          // Use JsonLogic to evaluate the rule against attributes
          const isMatch = jsonLogic.apply(condition, attributes);

          if (isMatch) {
            // Step 4: Create Countermeasure Object Based on Rule
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
      }
    } catch (err: unknown) {
      console.error(`Error getting countermeasures for class ${id}:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
    return counterMeasures
  }
}

