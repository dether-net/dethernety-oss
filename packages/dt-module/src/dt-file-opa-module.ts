import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { OpaOps, Policy } from './opa-ops';
import { DTModule, DTMetadata, Countermeasure, Exposure, DbOps, VALID_ATTACK_VECTORS } from './index';
import { EmbeddingFileCache } from './embedding-file-cache';

/**
 * V2 classType folder mapping.
 * Maps DTMetadata keys to the directory names used by Studio-generated module data.
 */
const CLASS_TYPES = [
  { key: 'componentClasses', dir: 'component' },
  { key: 'dataFlowClasses', dir: 'dataFlow' },
  { key: 'securityBoundaryClasses', dir: 'securityBoundary' },
  { key: 'controlClasses', dir: 'control' },
  { key: 'dataClasses', dir: 'data' },
] as const;

/** Valid ComponentType values from the GraphQL schema for component classes. */
const VALID_COMPONENT_TYPES = new Set(['PROCESS', 'EXTERNAL_ENTITY', 'STORE']);

/** Forced type overrides for non-component classTypes whose type must match the GraphQL enum. */
const FORCED_TYPES: Record<string, string> = {
  dataFlow: 'DATA_FLOW',
  securityBoundary: 'SECURITY_BOUNDARY',
  control: 'CONTROL',
  data: 'DATA',
};

/** Fallback template for classes without a schema.json file. */
const FALLBACK_TEMPLATE = {
  schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        title: 'Description',
        description: 'Describe this component and its role in the architecture.',
      },
      attributes: {
        type: 'array',
        title: 'Attributes',
        description: 'Custom attributes for this component.',
        items: {
          type: 'object',
          properties: {
            attribute: { type: 'string', title: 'Attribute' },
            value: { type: 'string', title: 'Value' },
          },
        },
      },
    },
  },
  uischema: {
    type: 'Categorization',
    elements: [
      {
        type: 'Category',
        label: 'General',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/description',
            options: { multi: true },
          },
          {
            type: 'Control',
            scope: '#/properties/attributes',
          },
        ],
      },
    ],
  },
};

/** Fallback guide for classes without a guide.json file. */
const FALLBACK_GUIDE = [
  {
    option_name: 'description',
    option_description: 'A free-text description of this component, its purpose, and how it fits into the overall architecture.',
    security_impact: 'Provides context for threat analysis. A clear description helps identify applicable threats and attack vectors.',
    how_to_obtain: [
      {
        type: 'documentation',
        instruction: 'Review existing architecture documentation, design documents, or runbooks for a description of this component.',
        command: null,
        file_path: null,
        navigation: null,
        expected_output: 'A concise paragraph describing the component purpose and responsibilities.',
      },
    ],
  },
  {
    option_name: 'attributes',
    option_description: 'A list of key-value pairs capturing security-relevant properties of this component that are not covered by a dedicated configuration schema.',
    security_impact: 'Custom attributes allow you to record any security-relevant configuration detail. These values can inform manual risk assessment even when automated policy evaluation is not available.',
    how_to_obtain: [
      {
        type: 'documentation',
        instruction: 'Identify security-relevant properties from the component configuration, deployment manifests, or operational runbooks and record them as attribute/value pairs.',
        command: null,
        file_path: null,
        navigation: null,
        expected_output: 'One or more attribute/value pairs, e.g. attribute: "tls_enabled", value: "true".',
      },
    ],
  },
];

export class DtFileOpaModule implements DTModule {
  private readonly moduleDataDir: string;
  private readonly moduleName: string;
  private readonly dbOps: DbOps;
  private readonly logger: Logger;
  private readonly embeddingCache: EmbeddingFileCache;
  private opaOps: OpaOps;
  private resetInProgress = false;

  constructor(moduleDataDir: string, moduleName: string, driver: any, logger?: Logger) {
    this.moduleDataDir = moduleDataDir;
    this.moduleName = moduleName;
    this.dbOps = new DbOps(driver);
    this.logger = logger || new Logger('DtFileOpaModule');

    const opaServerUrl = process.env.OPA_COMPILE_SERVER_URL || process.env.OPA_SERVER_URL || 'http://localhost:8181';
    this.opaOps = new OpaOps(opaServerUrl, this.logger);

    this.embeddingCache = new EmbeddingFileCache({
      moduleDataDir: path.join(this.moduleDataDir, this.moduleName),
      classTypeDirs: CLASS_TYPES.map((t) => t.dir),
      classDefinitionFile: 'class.json',
      logger: {
        warn: (msg, meta) => this.logger.warn(msg, meta ?? {}),
      },
    });

    this.logger.log('DtFileOpaModule initialized', {
      moduleName: this.moduleName,
      moduleDataDir: this.moduleDataDir,
      opaServerUrl,
    });
  }

  /**
   * Return a pre-computed embedding vector for a class by name, if shipped
   * with the module at {classDir}/embeddings/{modelSlug}.json. Returns null
   * when no vector is available — the platform falls back to on-the-fly
   * embedding for that class.
   */
  getEmbedding(className: string, embeddingModel: string): number[] | null {
    return this.embeddingCache.get(className, embeddingModel);
  }

  // ---------------------------------------------------------------------------
  // Path safety
  // ---------------------------------------------------------------------------

  private validateModulePath(filePath: string): void {
    const resolved = path.resolve(filePath);
    const moduleBase = path.resolve(this.moduleDataDir);
    if (!resolved.startsWith(moduleBase + path.sep) && resolved !== moduleBase) {
      throw new Error('Path traversal detected: path escapes module directory');
    }
  }

  // ---------------------------------------------------------------------------
  // Directory / file helpers
  // ---------------------------------------------------------------------------

  private getClassDirectories(classesDir: string): string[] | null {
    if (fs.existsSync(classesDir)) {
      const entries = fs.readdirSync(classesDir, { withFileTypes: true });
      return entries
        .filter((entry: any) => entry.isDirectory())
        .map((entry: any) => entry.name);
    }
    return null;
  }

  private getClassMetaData(classDir: string): any | null {
    this.validateModulePath(classDir);
    const classJsonPath = path.join(classDir, 'class.json');
    if (!fs.existsSync(classJsonPath)) {
      this.logger.warn(`class.json not found in ${classDir}, skipping`);
      return null;
    }
    try {
      const raw = fs.readFileSync(classJsonPath, 'utf8');
      const classData = JSON.parse(raw);
      classData.path = path.relative(this.moduleDataDir, classDir);
      return classData;
    } catch (err: unknown) {
      this.logger.error(`Error parsing class.json in ${classDir}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Rego helpers
  // ---------------------------------------------------------------------------

  private extractRegoPackageName(regoPolicies: string): string | undefined {
    if (!regoPolicies) return undefined;
    const packageMatch = regoPolicies.match(/^package\s+([^\s\n]+)/m);
    return packageMatch ? packageMatch[1] : undefined;
  }

  private decodeRegoPolicies(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (trimmed.startsWith('package ')) return value;
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      if (decoded.trim().startsWith('package ')) return decoded;
    } catch { /* not base64 */ }
    return value;
  }

  // ---------------------------------------------------------------------------
  // Policy management
  // ---------------------------------------------------------------------------

  private async resetPolicies(policies: Policy[]): Promise<void> {
    if (this.resetInProgress) {
      this.logger.warn('Policy reset already in progress, skipping', { moduleName: this.moduleName });
      return;
    }
    this.resetInProgress = true;
    const startTime = Date.now();
    try {
      await this.opaOps.deletePolicyByPrefix(this.moduleName + '.');
      await this.opaOps.installPolicies(policies);
      this.logger.log('Policy reset completed', {
        moduleName: this.moduleName,
        duration: `${Date.now() - startTime}ms`,
        policiesInstalled: policies.length,
      });
    } catch (error) {
      this.logger.error('Error during policy reset', {
        moduleName: this.moduleName,
        duration: `${Date.now() - startTime}ms`,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.resetInProgress = false;
    }
  }

  // ---------------------------------------------------------------------------
  // DTModule interface
  // ---------------------------------------------------------------------------

  async getMetadata(): Promise<DTMetadata> {
    const startTime = Date.now();
    const moduleDir = path.join(this.moduleDataDir, this.moduleName);
    const moduleJsonPath = path.join(moduleDir, 'module.json');

    if (!fs.existsSync(moduleJsonPath)) {
      throw new Error(`module.json not found: ${moduleJsonPath}`);
    }

    let moduleJson: any;
    try {
      moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
    } catch (err: unknown) {
      this.logger.error('Error parsing module.json', {
        moduleName: this.moduleName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Unable to parse module.json');
    }

    const metadata: DTMetadata = {
      name: moduleJson.name,
      description: moduleJson.description,
      version: moduleJson.version,
    };

    const policies: Policy[] = [];

    for (const classType of CLASS_TYPES) {
      const classesDir = path.join(moduleDir, classType.dir);
      if (!fs.existsSync(classesDir)) continue;

      const classDirs = this.getClassDirectories(classesDir);
      if (!classDirs || classDirs.length === 0) continue;

      const classDataList: any[] = [];

      for (const className of classDirs) {
        const classDir = path.join(classesDir, className);
        const classMetadata = this.getClassMetaData(classDir);
        if (!classMetadata) continue;

        // Normalize type to match the GraphQL ComponentType enum
        const forcedType = FORCED_TYPES[classType.dir];
        if (forcedType) {
          classMetadata.type = forcedType;
        } else if (classType.dir === 'component') {
          const rawType = String(classMetadata.type || '').toUpperCase();
          if (!VALID_COMPONENT_TYPES.has(rawType)) {
            this.logger.warn(`Skipping component class "${classMetadata.name}": invalid type "${classMetadata.type}" (expected one of: ${[...VALID_COMPONENT_TYPES].join(', ')})`, { moduleName: this.moduleName });
            continue;
          }
          classMetadata.type = rawType;
        }

        classDataList.push(classMetadata);

        // Collect policy for batch installation
        const policiesPath = path.join(classDir, 'policies.rego');
        this.validateModulePath(policiesPath);
        if (fs.existsSync(policiesPath)) {
          const raw = this.decodeRegoPolicies(fs.readFileSync(policiesPath, 'utf8').trim());
          if (raw) {
            const policyId = `${this.moduleName}.${classType.dir}.${className}`
              .replaceAll(' ', '_')
              .replaceAll(/[^A-Za-z0-9._-]/g, '');
            policies.push({ id: policyId, raw });
          }
        }
      }

      (metadata as any)[classType.key] = classDataList;
    }

    // Non-blocking policy reset (fire-and-forget)
    this.resetPolicies(policies).catch((err) => {
      this.logger.error('Background policy reset failed', {
        moduleName: this.moduleName,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const duration = Date.now() - startTime;
    this.logger.log('getMetadata completed', {
      moduleName: this.moduleName,
      duration: `${duration}ms`,
      totalPolicies: policies.length,
      componentClasses: metadata.componentClasses?.length || 0,
      dataFlowClasses: metadata.dataFlowClasses?.length || 0,
      securityBoundaryClasses: metadata.securityBoundaryClasses?.length || 0,
      controlClasses: metadata.controlClasses?.length || 0,
      dataClasses: metadata.dataClasses?.length || 0,
    });

    return metadata;
  }

  async getModuleTemplate(): Promise<string> {
    return JSON.stringify({
      schema: {
        type: 'object',
        properties: {
          opa_compile_server_url: { type: 'string', format: 'uri' },
        },
      },
      uischema: {
        type: 'VerticalLayout',
        elements: [
          { type: 'Control', scope: '#/properties/opa_compile_server_url' },
        ],
      },
    });
  }

  async getClassTemplate(id: string): Promise<string> {
    const classDataPath = await this.dbOps.getAttribute(id, 'path');
    const schemaPath = path.join(this.moduleDataDir, classDataPath, 'schema.json');
    this.validateModulePath(schemaPath);

    if (!fs.existsSync(schemaPath)) {
      return JSON.stringify(FALLBACK_TEMPLATE);
    }

    const raw = fs.readFileSync(schemaPath, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      // Normalize uiSchema → uischema (platform convention)
      if (parsed.uiSchema && !parsed.uischema) {
        parsed.uischema = parsed.uiSchema;
        delete parsed.uiSchema;
      }
      return JSON.stringify(parsed);
    } catch {
      return raw;
    }
  }

  async getClassGuide(id: string): Promise<string> {
    const classDataPath = await this.dbOps.getAttribute(id, 'path');
    const guidePath = path.join(this.moduleDataDir, classDataPath, 'guide.json');
    this.validateModulePath(guidePath);

    if (!fs.existsSync(guidePath)) {
      return JSON.stringify(FALLBACK_GUIDE);
    }
    return fs.readFileSync(guidePath, 'utf8');
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    try {
      const classDataPath = await this.dbOps.getAttribute(classId, 'path');
      const policiesPath = path.join(this.moduleDataDir, classDataPath, 'policies.rego');
      this.validateModulePath(policiesPath);

      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      if (!attributes) return exposures;

      if (!fs.existsSync(policiesPath)) {
        this.logger.warn(`Policies file not found: ${policiesPath}`);
        return exposures;
      }

      const regoContent = this.decodeRegoPolicies(fs.readFileSync(policiesPath, 'utf-8'));
      const regoPackageName = regoContent ? this.extractRegoPackageName(regoContent) : undefined;
      if (!regoPackageName) return exposures;

      const policyPath = regoPackageName.replaceAll('.', '/') + '/exposures';
      const result = await this.opaOps.evaluate(policyPath, attributes);

      exposures.push(
        ...result
          .filter((e: any) => e.name)
          .map((e: any) => {
            const rawAV = (e.attack_vector ?? e.attackVector ?? null)?.toUpperCase();
            const attackVector = rawAV && VALID_ATTACK_VECTORS.has(rawAV) ? rawAV : 'UNSPECIFIED';
            if (rawAV && !VALID_ATTACK_VECTORS.has(rawAV)) {
              this.logger.warn('Invalid attackVector in policy output, defaulting to UNSPECIFIED', {
                moduleName: this.moduleName, rawValue: rawAV, exposureName: e.name,
                policyPath, classId,
              });
            }
            return {
              name: e.name,
              description: e.description,
              type: e.type,
              category: e.category,
              score: e.score,
              attackVector,
              exploitedBy: e.exploited_by || e.exploitedBy,
            };
          }),
      );
    } catch (err: unknown) {
      this.logger.error('Error getting exposures', {
        moduleName: this.moduleName,
        instanceId: id,
        classId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return exposures;
  }

  async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]> {
    const countermeasures: Countermeasure[] = [];

    try {
      const classDataPath = await this.dbOps.getAttribute(classId, 'path');
      const policiesPath = path.join(this.moduleDataDir, classDataPath, 'policies.rego');
      this.validateModulePath(policiesPath);

      const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
      if (!attributes) return countermeasures;

      if (!fs.existsSync(policiesPath)) {
        this.logger.warn(`Policies file not found: ${policiesPath}`);
        return countermeasures;
      }

      const regoContent = this.decodeRegoPolicies(fs.readFileSync(policiesPath, 'utf-8'));
      const regoPackageName = regoContent ? this.extractRegoPackageName(regoContent) : undefined;
      if (!regoPackageName) return countermeasures;

      const policyPath = regoPackageName.replaceAll('.', '/') + '/countermeasures';
      const result = await this.opaOps.evaluate(policyPath, attributes);

      countermeasures.push(
        ...result
          .filter((c: any) => c.name)
          .map((c: any) => ({
            name: c.name,
            description: c.description,
            type: c.type,
            category: c.category,
            score: c.score,
            respondsWith: c.responds_with || c.respondsWith,
          })),
      );
    } catch (err: unknown) {
      this.logger.error('Error getting countermeasures', {
        moduleName: this.moduleName,
        instanceId: id,
        classId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return countermeasures;
  }
}
