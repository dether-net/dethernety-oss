import * as fs from 'fs';
import * as path from 'path';
import { OpaOps } from './opa-ops';

import { DTModule, DTMetadata, Countermeasure, Exposure, DbOps } from './index';

export class DtFileOpaModule implements DTModule {
  private readonly moduleDataDir: string;
  private readonly moduleName: string;
  private readonly dbOps: DbOps;
  private opaOps: OpaOps;

  constructor(moduleDataDir: string, moduleName: string, driver: any) {
    this.moduleDataDir = moduleDataDir;
    this.moduleName = moduleName;
    this.dbOps = new DbOps(driver);
    this.opaOps = new OpaOps(process.env.OPA_COMPILE_SERVER_URL || process.env.OPA_SERVER_URL || 'http://localhost:8181');
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

  private async installClassPolicies(classDir: string, className: string): Promise<void> {
    const policiesPath = path.join(classDir, 'policies.rego');
    if (fs.existsSync(policiesPath)) {
      const policies = fs.readFileSync(policiesPath, 'utf8').trim();
      await this.opaOps.installPolicies([{
        id: this.moduleName + '.' + className + '.policies',
        raw: policies
      }]);
    }
  }

  /**
   * Get the metadata for the module
   * @returns The metadata for the module
   */
  async getMetadata(): Promise<DTMetadata> {
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
        this.opaOps.deletePolicyByPrefix(this.moduleName + '.');
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
                  this.installClassPolicies(classesDir, className);
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
  async getClassTemplate(id: string): Promise<string> {
    const classDataPath = await this.dbOps.getAttribute(id, 'path');
    const templatePath = path.join(this.moduleDataDir, classDataPath, 'template.json');

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
      const exposureRulesPath = path.join(this.moduleDataDir, classDataPath, 'policies.rego');
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      if (attributes) {
        if (!fs.existsSync(exposureRulesPath)) {
          console.warn(`Exposure rules file not found: ${exposureRulesPath}`);
          return exposures;
        }
        const regoPackageName = this.extractRegoPackageName(fs.readFileSync(exposureRulesPath, 'utf-8'));
        const policyPath = regoPackageName?.replaceAll('.', '/') + '/exposures';
        const result = await this.opaOps.evaluate(policyPath, attributes);
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
      const countermeasureRulesPath = path.join(this.moduleDataDir, classDataPath, 'policies.rego');
      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      if (attributes) {
        if (!fs.existsSync(countermeasureRulesPath)) {
          console.warn(`Countermeasure rules file not found: ${countermeasureRulesPath}`);
          return counterMeasures;
        }
        const regoPackageName = this.extractRegoPackageName(fs.readFileSync(countermeasureRulesPath, 'utf-8'));
        const policyPath = regoPackageName?.replaceAll('.', '/') + '/countermeasures';
        const result = await this.opaOps.evaluate(policyPath, attributes);
        counterMeasures.push(...result
          .filter((countermeasure: any) => countermeasure.name)
          .map((countermeasure: any) => ({
            name: countermeasure.name,
            description: countermeasure.description,
            criticality: countermeasure.criticality,
            type: countermeasure.type,
            category: countermeasure.category,
            respondsWith: countermeasure.responds_with || countermeasure.respondsWith
          })));
      }
    } catch (err: unknown) {
      console.error(`Error getting countermeasures for class ${id}:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
    return counterMeasures
  }

  private extractRegoPackageName(regoPolicies: string): string | undefined {
    // Use regex to find package declaration on any line
    // Matches "package" followed by whitespace and captures the package name until end of line or whitespace
    if (!regoPolicies) {
      return undefined;
    }
    const packageMatch = regoPolicies.match(/^package\s+([^\s\n]+)/m);
    return packageMatch ? packageMatch[1] : undefined;
  }
}

