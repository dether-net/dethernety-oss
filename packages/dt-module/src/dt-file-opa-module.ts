import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { DTModule, DTMetadata, Countermeasure, Exposure, DbOps } from './index';
import { EmbeddingFileCache } from './embedding-file-cache';
import { RegoEngine } from './rego-engine';
import { mapExposureFinding, mapCountermeasureFinding } from './rego-mapping';

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
  { key: 'issueClasses', dir: 'issue' },
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

/**
 * The file-data module base class. Policies evaluate through the in-process Regorus WASM
 * engine — one engine per class, registered eagerly at load, freed on `dispose()`.
 *
 * The "Opa" in the name is historical: the class predates the in-process engine and every
 * shipped module extends it by this name, so the name outlived the OPA server it once
 * talked to.
 */
export class DtFileOpaModule implements DTModule {
  private readonly moduleDataDir: string;
  private readonly moduleName: string;
  private readonly dbOps: DbOps;
  private readonly logger: Logger;
  private readonly embeddingCache: EmbeddingFileCache;
  private readonly regoEngine = new RegoEngine();

  /**
   * Cumulative since construction; appended to every `getMetadata completed` log line,
   * which the platform health-probes continuously — the counters are the observability
   * for an engine that is otherwise silent in-process. A rise in `halts` (evaluation
   * throws) is the leading regression indicator.
   */
  private readonly stats = {
    evaluations: 0,
    findingsServed: 0,
    halts: 0,
  };

  constructor(moduleDataDir: string, moduleName: string, driver: any, logger?: Logger) {
    this.moduleDataDir = moduleDataDir;
    this.moduleName = moduleName;
    this.dbOps = new DbOps(driver);
    this.logger = logger || new Logger('DtFileOpaModule');

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
    });
  }

  /**
   * Free the in-process Rego engines. The platform calls this before discarding the
   * instance; without it every module reload would strand its policies on the WASM heap,
   * which the garbage collector never reclaims.
   */
  dispose(): void {
    this.regoEngine.dispose();
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
      contentHash: moduleJson.contentHash,
    };

    // Registration remembers which keys survived, so the prune below can free anything
    // that no longer exists on disk.
    const registeredKeys = new Set<string>();
    const registerFailures: { key: string; error: string }[] = [];

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

        // Issue classes carry no exposures/countermeasures, so a stray policies.rego
        // under an issue class is never registered.
        if (classType.dir !== 'issue') {
          const policiesPath = path.join(classDir, 'policies.rego');
          this.validateModulePath(policiesPath);
          if (fs.existsSync(policiesPath)) {
            const raw = this.decodeRegoPolicies(fs.readFileSync(policiesPath, 'utf8').trim());
            if (raw) {
              // Eager, so a policy that cannot be parsed or is not self-contained is
              // reported here rather than at the first analysis that needs it.
              const key = RegoEngine.keyFor(classMetadata.path);
              try {
                this.regoEngine.register(key, raw);
                registeredKeys.add(key);
              } catch (err: unknown) {
                registerFailures.push({ key, error: err instanceof Error ? err.message : String(err) });
              }
            }
          }
        }
      }

      (metadata as any)[classType.key] = classDataList;
    }

    // A class whose policy failed to register is absent from `registeredKeys`, so its
    // stale engine (if any) is freed here and every evaluation of it will throw:
    // a class with a broken policy must fail loudly, not answer from an older one.
    const freed = this.regoEngine.prune(registeredKeys);
    if (registerFailures.length > 0) {
      this.logger.error('Rego policies failed to register; those classes will throw when evaluated', {
        moduleName: this.moduleName,
        failures: registerFailures.length,
        classes: registerFailures.map((f) => f.key),
        errors: registerFailures.map((f) => f.error),
      });
    }
    if (freed > 0) {
      this.logger.log('Freed Rego engines for classes no longer present', {
        moduleName: this.moduleName,
        freed,
      });
    }

    const duration = Date.now() - startTime;
    // The platform health-probes getMetadata() continuously, so the cumulative counters
    // on this existing log line are the engine's heartbeat — no extra infrastructure.
    this.logger.log('getMetadata completed', {
      moduleName: this.moduleName,
      duration: `${duration}ms`,
      stats: this.stats,
      totalPolicies: registeredKeys.size,
      componentClasses: metadata.componentClasses?.length || 0,
      dataFlowClasses: metadata.dataFlowClasses?.length || 0,
      securityBoundaryClasses: metadata.securityBoundaryClasses?.length || 0,
      controlClasses: metadata.controlClasses?.length || 0,
      dataClasses: metadata.dataClasses?.length || 0,
      issueClasses: metadata.issueClasses?.length || 0,
    });

    return metadata;
  }

  // No getModuleTemplate: the only module-wide setting ever offered was the OPA compile
  // server URL, which the in-process engine made meaningless. The platform's template
  // resolver answers its documented fallback for modules without one.

  async getClassTemplate(id: string, token?: string): Promise<string> {
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

  async getClassGuide(id: string, token?: string): Promise<string> {
    const classDataPath = await this.dbOps.getAttribute(id, 'path');
    const guidePath = path.join(this.moduleDataDir, classDataPath, 'guide.json');
    this.validateModulePath(guidePath);

    if (!fs.existsSync(guidePath)) {
      return JSON.stringify(FALLBACK_GUIDE);
    }
    return fs.readFileSync(guidePath, 'utf8');
  }

  /**
   * Evaluate one rule of a class's policy in-process.
   *
   * Returns `null` when there is nothing to evaluate — no `policies.rego`, or an empty
   * one — and the caller yields no findings. A real evaluation failure throws
   * (`RegoEngine.evaluate` is fail-loud), so `null` never doubles as an error. A missing
   * *element* (no graph node — `getInstantiationAttributes` returns `null`) also throws:
   * reporting a non-existent element as "no findings" would fabricate a clean result,
   * the same not-evaluated contract `DtRemoteModule.evaluate` enforces. An element that
   * exists without instantiation attributes arrives as `{}` and evaluates normally.
   */
  private async evaluatePolicy(
    id: string,
    classId: string,
    rule: 'exposures' | 'countermeasures',
  ): Promise<any[] | null> {
    const classDataPath = await this.dbOps.getAttribute(classId, 'path');
    const policiesPath = path.join(this.moduleDataDir, classDataPath, 'policies.rego');
    this.validateModulePath(policiesPath);

    const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
    if (attributes === null) {
      throw new Error(`Element "${id}" was not found for evaluation`);
    }

    if (!fs.existsSync(policiesPath)) {
      this.logger.warn(`Policies file not found: ${policiesPath}`);
      return null;
    }

    const regoContent = this.decodeRegoPolicies(fs.readFileSync(policiesPath, 'utf-8'));
    if (!regoContent) return null;

    const key = RegoEngine.keyFor(classDataPath);
    if (!this.regoEngine.has(key)) {
      // getMetadata registers every class, and the platform calls it before an instance
      // serves anything — but a caller that constructs a module and evaluates straight
      // away would otherwise hit an unregistered package, which `evalQuery` answers with
      // `undefined`: a silent "no findings". Register from the source just read instead.
      // Cheap (the file is already in hand) and it cannot fail open, because `register`
      // throws on a policy it cannot parse or isolate.
      this.logger.warn('Policy was not registered at load; registering it on first use', {
        moduleName: this.moduleName,
        class: key,
      });
      this.regoEngine.register(key, regoContent);
    }
    let findings: any[];
    try {
      findings = this.regoEngine.evaluate(key, rule, attributes);
    } catch (err: unknown) {
      this.stats.halts += 1;
      throw err;
    }
    this.stats.evaluations += 1;
    this.stats.findingsServed += findings.length;
    return findings;
  }

  async getExposures(id: string, classId: string, token?: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    try {
      const result = await this.evaluatePolicy(id, classId, 'exposures');
      if (result === null) return exposures;

      exposures.push(
        ...result
          .filter((e: any) => e.name)
          .map((e: any) =>
            mapExposureFinding(e, (rawValue, exposureName) =>
              this.logger.warn('Invalid attackVector in policy output, defaulting to UNSPECIFIED', {
                moduleName: this.moduleName, rawValue, exposureName,
                classId,
              }),
            ),
          ),
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

  async getCountermeasures(id: string, classId: string, token?: string): Promise<Countermeasure[]> {
    const countermeasures: Countermeasure[] = [];

    try {
      const result = await this.evaluatePolicy(id, classId, 'countermeasures');
      if (result === null) return countermeasures;

      countermeasures.push(...result.filter((c: any) => c.name).map((c: any) => mapCountermeasureFinding(c)));
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
