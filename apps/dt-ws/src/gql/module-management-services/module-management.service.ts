import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DTModule, DTMetadata, ClassKind, IdRebindPolicy } from '@dethernety/dt-module';
import { ClassReconciler } from './class-reconciler.service';
import { ClassIdentityEventLog } from './class-identity-event-log.service';
import { slugifyModelName } from '@dethernety/dt-module/embedding';
import { EmbeddingService } from '../services/embedding.service';
import { MatchClassesResolverService } from '../resolver-services/match-classes-resolver.service';
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
    private readonly embeddingService: EmbeddingService,
    @Inject(forwardRef(() => MatchClassesResolverService))
    private readonly matchClassesResolver: MatchClassesResolverService,
    private readonly classReconciler: ClassReconciler,
    private readonly events: ClassIdentityEventLog,
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

    // Check for exact match (case-insensitive)
    const moduleNameLower = moduleName.toLowerCase();
    if (allowedModules.some(m => m.toLowerCase() === moduleNameLower)) {
      return true;
    }

    // Check for prefix patterns (e.g., 'aws-*', 'mitre-*') (case-insensitive)
    for (const pattern of allowedModules) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1).toLowerCase();
        if (moduleNameLower.startsWith(prefix)) {
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
  sanitizePropertyKeys(obj: any, depth: number = 0): FlattenedProperties {
    if (depth > 20) {
      return {}; // Prevent stack overflow from deeply nested or circular objects
    }
    const sanitizedObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_.]/g, '_');
        const value = obj[key];

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          sanitizedObj[sanitizedKey] = this.sanitizePropertyKeys(value, depth + 1);
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
    depth: number = 0,
  ): any {
    if (depth > 20) {
      return result; // Prevent stack overflow from deeply nested or circular objects
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_.]/g, '_');
        const prefixedKey = prefix ? `${prefix}.${sanitizedKey}` : sanitizedKey;

        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length > 0
        ) {
          this.flattenNestedProperties(value, prefixedKey, result, depth + 1);
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
      throw new Error(`Property flattening failed: ${error.message}`, { cause: error });
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

        // Cascade through both edge types — module deletion must also
        // clean up the orphaned classes that module was holding, otherwise
        // we leave AnalysisClass nodes that the routing queries (and the
        // CLASS_RETIRED probe) can't reach. The OPTIONAL MATCH followed
        // by DETACH DELETE p, t leaves any unmatched p-without-t deletion
        // intact.
        await tx.run(
          `MATCH (p:Module)
           WHERE p.name IN $modulesToDelete
           OPTIONAL MATCH (p)-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(t)
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
      throw new Error(`Module cleanup failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Resolve the effective rebind policy for an upsert.
   *
   * Module-declared `idRebindPolicy` is the default. The
   * `CLASS_ID_REBIND_OVERRIDE` env var lets operators force the
   * platform-wide policy regardless of what modules declare — intended for
   * "no silent ID mutations" compliance windows.
   *
   * Undefined module declaration falls through to `'audit'` (least
   * disruptive default for deployments that pre-date the policy contract,
   * where existing class ids were assigned by `randomUUID()` and would
   * otherwise be rejected on every install).
   */
  private effectivePolicy(modulePolicy?: IdRebindPolicy): IdRebindPolicy {
    const override = process.env.CLASS_ID_REBIND_OVERRIDE;
    if (override === 'strict' || override === 'audit' || override === 'silent') {
      return override;
    }
    return modulePolicy ?? 'audit';
  }

  /**
   * Map a classLabel (e.g. 'AnalysisClass') to its DTMetadata key
   * (e.g. 'analysisClasses'). Used for event-log payloads.
   */
  private classKindForLabel(classLabel: string): ClassKind {
    const cfg = MODULE_CLASS_CONFIGS.find((c) => c.label === classLabel);
    return (cfg?.key ?? 'componentClasses') as ClassKind;
  }

  /**
   * Upsert a class via MERGE-by-id with rebind dispatch.
   *
   * Five cases:
   *   (a) Found by name, dbId === id, edge=HAS_CLASS    → idempotent SET +=
   *   (b) Found by name, dbId === id, edge=HAS_ORPHANED → revive + SET += + emit
   *   (c) Found by name, dbId !== id                   → rebind dispatch on policy
   *   (d) New id collides with an existing class       → same-module id match whose
   *       old name is absent from the incoming metadata = RENAME with a stable id
   *       (update in place, reviving an orphan if needed); anything else
   *       (foreign owner, same-module double-declaration, or indeterminate
   *       because `declaredNames` wasn't supplied) → emit collision, skip
   *   (e) Not found at all                             → CREATE + MERGE edge
   *
   * Strict-mode rebind-conflict on one class doesn't fail the whole
   * module install — the install completes for the other classes and the
   * module's `lastInstallStatus` is downgraded to 'partial'. Caller
   * (`upsertModule`) counts processed-vs-attempted to derive that status.
   */
  async upsertClass(
    tx: DatabaseTransaction,
    moduleName: string,
    cls: { id: string; name: string; [k: string]: any },
    classLabel: string,
    embedding?: number[],
    modulePolicy?: IdRebindPolicy,
    // All class names the module declares on disk for this label — the
    // rename-vs-double-declaration discriminator for case (d). Callers that
    // omit it (tests, legacy paths) get the conservative collision-skip.
    declaredNames?: Set<string>,
  ): Promise<'applied' | 'skipped'> {
    const startTime = Date.now();

    try {
      this.validateClassLabel(classLabel);
      this.validateClassObject(cls, classLabel);

      if (!moduleName || typeof moduleName !== 'string') {
        throw new Error('Module name is required and must be a string');
      }
      if (!cls.id || typeof cls.id !== 'string') {
        // Defense-in-depth — `validateModuleInterface` should already have
        // rejected an id-less metadata at the registration boundary; this
        // catch makes a bypass case (e.g. tests calling upsertClass
        // directly) noisy rather than silent.
        throw new Error(`Class id is required (class "${cls.name}", label ${classLabel})`);
      }

      const policy = this.effectivePolicy(modulePolicy);
      const classKind = this.classKindForLabel(classLabel);
      const classData = this.flattenProperties(cls);
      const hasEmbedding = embedding !== undefined;

      // 1. Look up existing class node by (module, classLabel, name) — both
      //    edge types so a previously-orphaned class can be revived (design
      //    §5.4 dual-edge-type lookup).
      const lookup = await tx.run(
        `MATCH (m:Module {name: $moduleName})-[r:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${classLabel} {name: $name})
         RETURN c.id AS dbId, type(r) AS edgeType LIMIT 1`,
        { moduleName, name: cls.name },
      );

      const existing =
        lookup.records.length > 0
          ? {
              dbId: lookup.records[0].get('dbId') as string,
              edgeType: lookup.records[0].get('edgeType') as string,
            }
          : null;

      // Build the SET-properties payload. Same shape as before — ON CREATE
      // sets createdAt; subsequent SET overwrites updatedAt + properties.
      const nodeProperties: Record<string, any> = {
        ...classData,
        updatedAt: new Date().toISOString(),
        ...(hasEmbedding
          ? { embedding, embeddingModel: this.embeddingService.getModel() }
          : {}),
      };

      // 2. Cross-module collision check — only when this is a new
      //    registration (no existing node by name in *this* module).
      let renamed = false;
      if (!existing) {
        // Collision check spans ALL modules including this one. `!existing`
        // guarantees no node by *this* (module, name) exists yet, so a match
        // is one of:
        //   - a foreign module owning the id            → collision, skip
        //   - THIS module's node under a DIFFERENT name → either a rename
        //     with a stable id (old name gone from the incoming metadata:
        //     update in place) or a double-declaration of the id within one
        //     metadata (old name still declared: collision, skip — renaming
        //     here would destroy the sibling registration mid-install).
        // Without `declaredNames` the two same-module cases are
        // indistinguishable → conservative collision-skip.
        const collision = await tx.run(
          `MATCH (other:Module)-[r:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${classLabel} {id: $id})
           RETURN other.name AS otherModule, type(r) AS edgeType, c.name AS oldName LIMIT 1`,
          { id: cls.id }, // moduleName no longer referenced since the self-exclusion WHERE was dropped
        );
        if (collision.records.length > 0) {
          const collisionRec = collision.records[0];
          const otherModule = collisionRec.get('otherModule') as string;
          const collidingEdgeType = collisionRec.get('edgeType') as string;
          const oldName = collisionRec.get('oldName') as string | null;
          const isRename =
            otherModule === moduleName &&
            typeof oldName === 'string' &&
            declaredNames !== undefined &&
            !declaredNames.has(oldName);
          if (isRename) {
            // Rename with a stable id. The node may have been orphaned by a
            // previous boot's reconciliation of the old name — revive it now
            // so the class is active in the same boot that applied the
            // rename (without this, it would stay orphaned until the NEXT
            // boot's by-name lookup hits case (b), while this install
            // reports 'applied').
            if (collidingEdgeType === 'HAS_ORPHANED_CLASS') {
              await this.classReconciler.reviveClass(tx, moduleName, classLabel, cls.id);
              this.events.emit({
                kind: 'revive',
                moduleName,
                classKind,
                className: cls.name,
                classId: cls.id,
                timestamp: new Date().toISOString(),
              });
            }
            await this.applySetProperties(tx, classLabel, cls.id, nodeProperties, hasEmbedding);
            this.events.emit({
              kind: 'rename',
              moduleName,
              classKind,
              className: cls.name,
              oldName,
              classId: cls.id,
              timestamp: new Date().toISOString(),
            });
            renamed = true;
          } else {
            // Case (d): collision. Emit and skip — the schema-layer UNIQUE
            // constraint would also reject the eventual CREATE, but emitting
            // first gives operators the structured context they need.
            this.events.emit({
              kind: 'collision',
              firstModuleName: otherModule,
              secondModuleName: moduleName,
              classKind,
              className: cls.name,
              collidingId: cls.id,
              timestamp: new Date().toISOString(),
            });
            return 'skipped';
          }
        }
      }

      if (existing && existing.dbId === cls.id) {
        if (existing.edgeType === 'HAS_CLASS') {
          // Case (a): clean idempotent update.
          await this.applySetProperties(tx, classLabel, cls.id, nodeProperties, hasEmbedding);
        } else {
          // Case (b): revive the orphan, then update properties.
          await this.classReconciler.reviveClass(tx, moduleName, classLabel, cls.id);
          await this.applySetProperties(tx, classLabel, cls.id, nodeProperties, hasEmbedding);
          this.events.emit({
            kind: 'revive',
            moduleName,
            classKind,
            className: cls.name,
            classId: cls.id,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (existing && existing.dbId !== cls.id) {
        // Case (c): id mismatch. Dispatch on policy.
        if (policy === 'strict') {
          this.events.emit({
            kind: 'rebind-conflict',
            moduleName,
            classKind,
            className: cls.name,
            moduleDeclaredId: cls.id,
            dbId: existing.dbId,
            policy: 'strict',
            timestamp: new Date().toISOString(),
          });
          return 'skipped';
        }
        // Cross-module collision check on the NEW id — without this the
        // rebind would attempt to SET an id that already exists in
        // another module, hitting the per-label UNIQUE constraint
        // mid-tx and rolling back the whole install. Surface it as a structured
        // collision event the way case (d) does for fresh registrations.
        // Spans ALL modules incl. this one (see the case-(d) note above): the
        // NEW id ($id) differs from the node being rebound (existing.dbId), so a
        // match is a genuine foreign — or same-module sibling — owner of $id.
        const rebindCollision = await tx.run(
          `MATCH (other:Module)-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${classLabel} {id: $id})
           RETURN other.name AS otherModule LIMIT 1`,
          { id: cls.id }, // moduleName no longer referenced since the self-exclusion WHERE was dropped
        );
        if (rebindCollision.records.length > 0) {
          this.events.emit({
            kind: 'collision',
            firstModuleName: rebindCollision.records[0].get('otherModule') as string,
            secondModuleName: moduleName,
            classKind,
            className: cls.name,
            collidingId: cls.id,
            timestamp: new Date().toISOString(),
          });
          return 'skipped';
        }
        // audit / silent: in-place rebind. If the existing edge is the
        // orphan flavour, revive too — the same metadata is now declaring
        // both a new id AND that the class is active again.
        if (existing.edgeType === 'HAS_ORPHANED_CLASS') {
          await this.classReconciler.reviveClass(tx, moduleName, classLabel, existing.dbId);
        }
        // Module-pinned rebind: without the module pin, two modules
        // sharing a label could collide on $oldId and rewrite the wrong
        // node's id. The lookup at line ~432 already proved the (m, c)
        // pair exists; re-asserting it here keeps the SET scoped.
        await tx.run(
          `MATCH (m:Module {name: $moduleName})-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${classLabel} {id: $oldId})
           SET c.id = $newId,
               c.idAliases = coalesce(c.idAliases, []) + [$oldId]`,
          { moduleName, oldId: existing.dbId, newId: cls.id },
        );
        await this.applySetProperties(tx, classLabel, cls.id, nodeProperties, hasEmbedding);
        if (policy === 'audit') {
          this.events.emit({
            kind: 'rebind',
            moduleName,
            classKind,
            className: cls.name,
            oldId: existing.dbId,
            newId: cls.id,
            policy: 'audit',
            timestamp: new Date().toISOString(),
          });
        } else {
          // 'silent' policy: do NOT emit a structured event.
          // Logger.debug still captures the change for ops-only investigation.
          this.logger.debug('silent rebind', {
            moduleName,
            classKind,
            className: cls.name,
            oldId: existing.dbId,
            newId: cls.id,
          });
        }
      } else if (!renamed) {
        // Case (e): not found, no collision, not a rename — fresh create with
        // the module-declared id. nodeProperties already carries the embedding
        // fields when hasEmbedding is true, so the CREATE shape is
        // identical regardless of embedding presence (no REMOVE needed
        // for a brand-new node).
        await tx.run(
          `MATCH (m:Module {name: $moduleName})
           CREATE (c:${classLabel} {id: $id, name: $name, createdAt: datetime()})
           SET c += $nodeProperties
           MERGE (m)-[:HAS_CLASS]->(c)
           RETURN c`,
          {
            moduleName,
            id: cls.id,
            name: cls.name,
            nodeProperties,
          },
        );
      }

      const duration = Date.now() - startTime;
      this.recordOperation('upsertClass', duration, {
        moduleName,
        classId: cls.id,
        className: cls.name,
        classLabel,
      });
      return 'applied';
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to upsert class', {
        moduleName,
        classId: cls?.id,
        className: cls?.name,
        classLabel,
        error: error.message,
        stack: error.stack,
        duration,
      });
      throw new Error(
        `Class upsert failed for ${classLabel}/${cls?.name}: ${error.message}`,
        { cause: error },
      );
    }
  }

  /**
   * Apply node-property update + REMOVE stale embedding when none provided.
   *
   * Without the conditional REMOVE, a class that had a pre-computed vector
   * last time and doesn't this time (model change, file deleted, per-class
   * dim mismatch) would silently be scored against a wrong-model vector in
   * match_classes.
   */
  private async applySetProperties(
    tx: DatabaseTransaction,
    classLabel: string,
    classId: string,
    nodeProperties: Record<string, any>,
    hasEmbedding: boolean,
  ): Promise<void> {
    const cypher = hasEmbedding
      ? `MATCH (c:${classLabel} {id: $id}) SET c += $nodeProperties RETURN c`
      : `MATCH (c:${classLabel} {id: $id}) SET c += $nodeProperties REMOVE c.embedding, c.embeddingModel RETURN c`;
    await tx.run(cypher, { id: classId, nodeProperties });
  }

  /**
   * Resolve the embedding vector for every class in a module's metadata.
   *
   * Runs OUTSIDE any write transaction — the caller must invoke this before
   * session.executeWrite. The returned Map is handed to upsertModule(...,
   * vectors?) which does no embedding HTTP.
   *
   * Returns null when embedding is disabled (either via EMBEDDING_ENABLED or
   * a session-level disableForSession flip). When null is returned, Phase 3
   * writes no embedding properties and REMOVES any stale ones.
   *
   * For each class:
   *   1. Ask the module via moduleInstance.getEmbedding?.(className, slug).
   *   2. If that returns a vector of the expected dimension, use it.
   *   3. Otherwise, compose text and batch-embed via the HTTP endpoint.
   *
   * Failures in the on-the-fly batch throw — the caller decides per-module
   * whether to swallow (bulk path) or propagate (single-module mutation).
   */
  async resolveVectors(
    metadata: DTMetadata,
    moduleInstance?: DTModule,
  ): Promise<Map<string, number[]> | null> {
    // Snapshot isEnabled() once so a mid-call flip of the session-disabled
    // flag does not produce a half-resolved map.
    if (!this.embeddingService.isEnabled()) return null;

    // Ensure the vector index exists and its dimension matches the config
    // before we commit any vector writes. On a fresh DB the matchClasses
    // query path hasn't run yet, so without this the bootstrap would never
    // fire in time to gate the very first install. ensureVectorIndexes is
    // idempotent (guarded by an internal boolean flag).
    await this.matchClassesResolver.ensureVectorIndexes();

    // The dim cross-check may have disabled embedding for the session.
    // Re-snapshot.
    if (!this.embeddingService.isEnabled()) return null;

    const rawModel = this.embeddingService.getModel();
    if (!rawModel) {
      // Empty EMBEDDING_MODEL config — treat as "no pre-computed lookup
      // possible" and fall through to on-the-fly for every class.
      this.logger.warn(
        'EMBEDDING_MODEL is empty — all classes will be embedded on the fly',
        { moduleName: metadata.name },
      );
    }
    const modelSlug = rawModel ? slugifyModelName(rawModel) : '';
    const expectedDim = this.embeddingService.getDimensions();

    // Flatten classes in the same order upsertModule's Phase 3 will iterate.
    const allClasses: { cls: any; label: string }[] = [];
    for (const modClass of MODULE_CLASS_CONFIGS) {
      const classes = metadata[modClass.key];
      if (classes && Array.isArray(classes)) {
        for (const cls of classes) {
          allClasses.push({ cls, label: modClass.label });
        }
      }
    }

    if (allClasses.length === 0) return new Map();

    const resolved = new Map<string, number[]>();
    const missing: { className: string; text: string }[] = [];

    for (const { cls } of allClasses) {
      if (!cls?.name) continue;

      let pre: number[] | null = null;
      if (modelSlug && moduleInstance?.getEmbedding) {
        try {
          // getEmbedding contract: synchronous, returns null or number[].
          // Coerce undefined → null (optional chaining quirk).
          pre = moduleInstance.getEmbedding(cls.name, modelSlug) ?? null;
        } catch (err) {
          this.logger.warn('Module getEmbedding threw — falling through', {
            moduleName: metadata.name,
            className: cls.name,
            error: err instanceof Error ? err.message : String(err),
          });
          pre = null;
        }
      }

      if (pre && Array.isArray(pre) && pre.length === expectedDim) {
        resolved.set(cls.name, pre);
      } else {
        if (pre && Array.isArray(pre) && pre.length !== expectedDim) {
          this.logger.warn(
            'Pre-computed embedding dimension mismatch; falling through to on-the-fly',
            {
              moduleName: metadata.name,
              className: cls.name,
              expected: expectedDim,
              got: pre.length,
            },
          );
        }
        missing.push({
          className: cls.name,
          text: this.embeddingService.composeClassText(cls),
        });
      }
    }

    if (missing.length > 0) {
      const fresh = await this.embeddingService.embedBatch(
        missing.map((m) => m.text),
      );
      // embedBatch returns null only when embedding became disabled between
      // the snapshot and the call (e.g. dim-mismatch during bootstrap).
      // In that case, write no vectors at all.
      if (!fresh) return null;
      for (let i = 0; i < missing.length; i++) {
        resolved.set(missing[i].className, fresh[i]);
      }
    }

    this.logger.log('Embeddings resolved', {
      moduleName: metadata.name,
      total: allClasses.length,
      preComputed: allClasses.length - missing.length,
      onTheFly: missing.length,
    });

    return resolved;
  }

  /**
   * Upserts a module with comprehensive validation and error handling.
   *
   * Concurrency: NOT safe for concurrent invocation on the same
   * `metadata.name`. Two simultaneous installs for the same module
   * race on the (lookup → CREATE) check-then-act in upsertClass and
   * on the (Phase 4 read → orphan write) sequence. The
   * `:Module(name)` UNIQUE constraint serializes Module-node MERGEs
   * but does not protect the per-class flow. Callers (registry,
   * admin endpoints, scheduled refresh) MUST serialize per moduleName
   * — today this is implicit (single-writer install path); a future
   * advisory-lock or per-module mutex is tracked as a follow-up.
   *
   * @param tx The database transaction
   * @param metadata The module metadata
   * @param options Operation options
   * @param vectors  Pre-resolved embeddings keyed by className (from
   *                 resolveVectors). null → embedding disabled (write none);
   *                 undefined → caller didn't resolve (tests/migrations);
   *                 Map → per-class lookup.
   * @returns UpsertResult with operation details
   */
  async upsertModule(
    tx: DatabaseTransaction,
    metadata: DTMetadata,
    options: ModuleOperationOptions = {},
    vectors?: Map<string, number[]> | null,
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

      // A same-label duplicate class id is caught gracefully downstream by the
      // per-class collision pre-check in upsertClass (which now spans this
      // module too): the offending class is skipped + a collision event is
      // emitted + the module downgrades to 'partial', while its other classes
      // still install. No pre-emptive whole-module rejection — that would block
      // a module's legitimate classes and regress harmless exact duplicates.

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

      // Phase 1: Collect all classes from all MODULE_CLASS_CONFIGS
      const allClasses: { cls: any; label: string }[] = [];
      for (const modClass of MODULE_CLASS_CONFIGS) {
        const classes = metadata[modClass.key];
        if (classes && Array.isArray(classes)) {
          for (const cls of classes) {
            allClasses.push({ cls, label: modClass.label });
          }
          this.statistics.totalClasses += classes.length;
        }
      }

      // Phase 2 (embedding resolution) runs OUTSIDE this write transaction now
      // — see resolveVectors() + updateAllModules Phase A. Holding a Bolt
      // write tx across an HTTP call to the embedding endpoint would keep
      // locks open for the entire network round-trip.
      //
      // `vectors` is the pre-resolved map keyed by className:
      //   - null      → embedding disabled for the whole module, write no embedding property
      //   - undefined → caller did not resolve vectors (legacy path, tests) — equivalent to null
      //   - Map       → per-class lookup; classes not in the map get no embedding
      const vectorForClass = (name: string): number[] | undefined =>
        vectors?.get(name);

      // Names declared on disk per label — upsertClass's case-(d)
      // rename-vs-double-declaration discriminator (a same-module id match
      // whose old name is still declared is a duplicate, not a rename).
      const declaredNamesByLabel = new Map<string, Set<string>>();
      for (const { cls, label } of allClasses) {
        let names = declaredNamesByLabel.get(label);
        if (!names) {
          names = new Set<string>();
          declaredNamesByLabel.set(label, names);
        }
        names.add(cls.name);
      }

      // Phase 3: Upsert each class with its (optional) pre-resolved vector.
      // 'applied' counts as success; 'skipped' (strict rebind-conflict or
      // collision) leaves classesProcessed lower than allClasses.length →
      // the per-module status downgrades to 'partial'. Throws are caught
      // and also count as not-applied.
      for (let i = 0; i < allClasses.length; i++) {
        const { cls, label } = allClasses[i];
        const embedding = vectorForClass(cls.name);
        try {
          const outcome = await this.upsertClass(
            tx,
            installedModuleName,
            cls,
            label,
            embedding,
            metadata.idRebindPolicy,
            declaredNamesByLabel.get(label),
          );
          if (outcome === 'applied') classesProcessed++;
        } catch (error) {
          this.logger.error('Failed to upsert class', {
            moduleId,
            className: cls?.name,
            classLabel: label,
            error: error.message,
          });
          // Continue processing other classes — a single class failure
          // downgrades `lastInstallStatus` to 'partial' but doesn't fail
          // the whole module install.
        }
      }

      // Counts reconciliation-step failures so Phase 5 can downgrade
      // 'authoritative' → 'partial' (per-class try/catch below).
      let reconciliationFailures = 0;

      // Phase 4: Reconcile classes absent from new metadata.
      // Orphan via MAGE rename if incident IS_INSTANCE_OF edges exist;
      // DETACH DELETE if not. Revive of previously-orphaned classes is
      // handled inside upsertClass when metadata re-introduces them.
      // Reads only :HAS_CLASS — orphaned classes are untouched here.
      for (const modClass of MODULE_CLASS_CONFIGS) {
        // Reuse the Phase-3 per-label sets — the orphan sweep and the
        // rename-vs-double-declaration discriminator must never diverge.
        const declaredNames = declaredNamesByLabel.get(modClass.label) ?? new Set<string>();
        const dbBindings = await tx.run(
          `MATCH (m:Module {name: $moduleName})-[:HAS_CLASS]->(c:${modClass.label})
           RETURN c.id AS id, c.name AS name`,
          { moduleName: installedModuleName },
        );
        for (const rec of dbBindings.records) {
          const name = rec.get('name') as string;
          if (declaredNames.has(name)) continue;
          const id = rec.get('id') as string;
          // Per-class try/catch so a single orphan/delete failure (e.g.,
          // missing edge under a re-run race, MAGE transient) doesn't
          // roll back the entire module install. The Memgraph driver
          // aborts the tx on most failures so subsequent ops in the
          // same callback may also throw and break out of the loop —
          // that's acceptable; some reconciliation is better than none,
          // and the next install converges to the same end state.
          try {
            const incident = await this.classReconciler.hasIncidentInstances(tx, modClass.label, id);
            if (incident) {
              await this.classReconciler.orphanClass(tx, installedModuleName, modClass.label, id);
              this.events.emit({
                kind: 'orphan',
                moduleName: installedModuleName,
                classKind: modClass.key as ClassKind,
                className: name,
                classId: id,
                reason: 'absent-from-metadata',
                timestamp: new Date().toISOString(),
              });
            } else {
              await tx.run(
                `MATCH (m:Module {name: $moduleName})-[:HAS_CLASS]->(c:${modClass.label} {id: $id})
                 DETACH DELETE c`,
                { moduleName: installedModuleName, id },
              );
            }
          } catch (e) {
            this.logger.error('Reconciliation step failed; continuing with next class', {
              moduleName: installedModuleName,
              classKind: modClass.key,
              className: name,
              classId: id,
              error: (e as Error).message,
            });
            reconciliationFailures += 1;
          }
        }
      }

      // Phase 5: write per-module install status. 'authoritative' if every
      // declared class processed cleanly; 'partial' if any hit a strict-mode
      // rebind-conflict, cross-module collision, or unhandled error.
      // `lastAuthoritativeInstall` only stamps on a clean install — operators
      // querying for "last known-good" should see the most recent
      // 'authoritative' moment, not a partial one. `lastAttemptedInstall`
      // stamps on every attempt.
      // FOLLOW-UP: the 'unavailable' (getMetadata throws) and 'error'
      // (upsertModule throws) statuses are NOT written today — the path
      // through loadModuleInternal aborts before reaching this code, and
      // the catch handler at the bottom of upsertModule re-throws without
      // a compensating status write. See process-architect review for the
      // remediation sketch (out-of-tx markStatus call from the catch
      // handler + a parallel from module-registry.loadModuleInternal).
      const status =
        classesProcessed === allClasses.length && reconciliationFailures === 0
          ? 'authoritative'
          : 'partial';

      // SMED snapshot — captures every (classKind, className, declaredId) the
      // module asked for at THIS install, before strict-mode rebind blocks can
      // hide the declared id. Read by the `Module.rebindConflicts` resolver
      // post-install to compute the diff against the DB-resident id. Self-
      // healing: every install overwrites it.
      const lastInstallClassIds = JSON.stringify(
        allClasses.map(({ cls, label }) => ({
          classKind: label,
          className: cls.name,
          declaredId: cls.id,
        })),
      );

      await tx.run(
        `MATCH (m:Module {name: $moduleName})
         SET m.lastInstallStatus = $status,
             m.lastAttemptedInstall = datetime(),
             m.lastInstallClassIds = $lastInstallClassIds` +
          (status === 'authoritative' ? `, m.lastAuthoritativeInstall = datetime()` : ``),
        { moduleName: installedModuleName, status, lastInstallClassIds },
      );

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
      throw new Error(`Module upsert failed for ${metadata?.name}: ${error.message}`, { cause: error });
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
      database: this.configService.get('database.name'),
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
      database: this.configService.get('database.name'),
    });
    let moduleInstalled = '';

    try {
      this.logger.log('Starting single module reset');

      // Phase A — resolve vectors OUTSIDE the write tx. A failure here throws
      // straight out to the caller (single-module mutation path; no per-module
      // skip-and-continue like the bulk path).
      const metadata = await Promise.resolve(moduleInstance.getMetadata());
      if (!metadata) {
        throw new Error('Module metadata not found');
      }
      const vectors = await this.resolveVectors(metadata, moduleInstance);

      this.logger.debug('Resetting module', {
        moduleName: metadata.name,
        version: metadata.version,
      });

      // Phase B — write tx with pre-resolved vectors (no HTTP inside).
      await session.executeWrite(async (tx: DatabaseTransaction) => {
        const result = await this.upsertModule(tx, metadata, options, vectors);
        moduleInstalled = result.moduleName;

        this.logger.log('Module reset successfully', {
          moduleName: moduleInstalled,
          moduleId: result.moduleId,
          classesProcessed: result.classesProcessed,
        });
      });

      // Post-commit: the :Module node is committed + visible. Run afterInstall
      // on its own session — a requirement, not a backstop (design §9.2 #H12):
      // an operator "reset a broken module" must re-run the hook too, else the
      // reset re-installs classes but never re-does the hook's graph work.
      await this.runAfterInstall(session, moduleInstalled, moduleInstance);

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
      throw new Error(`Module reset failed: ${error.message}`, { cause: error });
    } finally {
      await session.close();
    }
  }

  /**
   * Runs a module's optional `afterInstall` hook POST-COMMIT, once its
   * `:Module` node is committed and visible. The hook opens its own session on
   * the raw driver; a throw OR a timeout is caught, logged, and downgrades ONLY
   * this module's `lastInstallStatus` to 'partial' so the content-hash skip gate
   * reinstalls it next boot and re-invokes the hook (design §9.2 #H9 self-heal).
   * Never throws — failure is isolated so sibling modules are unaffected.
   *
   * @param session   An OPEN session to issue the partial-downgrade write on
   *                  (reused post-commit; distinct from the hook's own session).
   * @param moduleName The module's name === its `:Module {name}`.
   * @param instance   The module instance (may be undefined / lack the hook).
   */
  private async runAfterInstall(
    session: any,
    moduleName: string,
    instance: DTModule | undefined,
  ): Promise<void> {
    if (!instance?.afterInstall) return;
    const databaseName = this.configService.get('database.name');
    // `this.config` is absent in some test harnesses (ConfigService.get → undefined);
    // fall back to the MODULE_LOAD_TIMEOUT default so we never TypeError.
    const timeoutMs = this.config?.moduleLoadTimeout ?? 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        instance.afterInstall({ driver: this.neo4jDriver, moduleName, databaseName }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('afterInstall timeout')),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      this.logger.error('afterInstall failed — downgrading module to partial', {
        moduleName,
        error: error?.message,
      });
      try {
        await session.executeWrite((tx: DatabaseTransaction) =>
          tx.run(
            `MATCH (m:Module {name: $moduleName}) SET m.lastInstallStatus = 'partial'`,
            { moduleName },
          ),
        );
      } catch (downgradeError) {
        this.logger.error('afterInstall partial-downgrade write failed', {
          moduleName,
          error: downgradeError?.message,
        });
      }
    } finally {
      if (timer) clearTimeout(timer);
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
      database: this.configService.get('database.name'),
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

      // Phase A — resolve vectors for every module OUTSIDE the write tx.
      // Per-module try/catch preserves today's skip-and-continue semantic:
      // a failing module is logged and dropped; others still install.
      const resolved = new Map<
        string,
        { metadata: DTMetadata; vectors: Map<string, number[]> | null }
      >();

      // Content-hash skip gate — read each :Module node's stored contentHash +
      // lastInstallStatus once (single read, outside the write tx). A module
      // whose shipped contentHash matches the node's and whose last install was
      // authoritative is unchanged: skip its embedding resolution AND graph
      // write. Fails safe — unknown/partial/legacy/forced ⇒ full install.
      const installed = new Map<
        string,
        { contentHash: string | null; lastInstallStatus: string | null }
      >();
      const installState = await session.executeRead(async (tx: DatabaseTransaction) =>
        tx.run(
          `MATCH (m:Module)
           RETURN m.name AS name, m.contentHash AS contentHash, m.lastInstallStatus AS lastInstallStatus`,
        ),
      );
      for (const rec of installState.records) {
        installed.set(rec.get('name'), {
          contentHash: rec.get('contentHash') ?? null,
          lastInstallStatus: rec.get('lastInstallStatus') ?? null,
        });
      }
      let skippedCount = 0;

      for (const [moduleName, moduleInstance] of modules) {
        try {
          this.logger.debug('Processing module for update', { moduleName });
          const metadata = await Promise.resolve(moduleInstance.getMetadata());
          if (!metadata) {
            this.logger.warn('Module metadata not found, skipping', { moduleName });
            continue;
          }

          // Skip unchanged, authoritatively-installed modules (unless forced).
          if (!options.force && metadata.contentHash) {
            const db = installed.get(moduleName);
            if (
              db &&
              db.contentHash === metadata.contentHash &&
              db.lastInstallStatus === 'authoritative'
            ) {
              this.logger.log('Module unchanged — skipping embedding + write', {
                moduleName,
                contentHash: metadata.contentHash,
              });
              modulesInstalled.push(moduleName); // retained; protected from deleteOldModules
              skippedCount++;
              continue;
            }
          }

          const vectors = await this.resolveVectors(metadata, moduleInstance);
          resolved.set(moduleName, { metadata, vectors });
        } catch (error) {
          errorCount++;
          this.logger.error('Failed to resolve vectors during bulk update', {
            moduleName,
            error: error.message,
            stack: error.stack,
          });
          // Continue with other modules — same semantic as today's in-tx catch.
        }
      }

      // Phase B — one write tx PER MODULE (pre-resolved vectors; no HTTP inside).
      // A shared tx made the per-module try/catch illusory: a DB-level abort in
      // any module (e.g. a same-label id collision) poisons the whole Bolt tx,
      // so every subsequent tx.run — including deleteOldModules' — throws and
      // rolls the batch back, crashing onModuleInit. Isolating each module in
      // its own executeWrite makes the "continue with other modules" promise
      // real: a poisoned module rolls back only its own tx; the others commit.
      for (const [moduleName, { metadata, vectors }] of resolved) {
        try {
          const result = await session.executeWrite((tx: DatabaseTransaction) =>
            this.upsertModule(tx, metadata, options, vectors),
          );
          modulesInstalled.push(result.moduleName);
          processedCount++;

          this.logger.debug('Module processed successfully', {
            moduleName,
            moduleId: result.moduleId,
            classesProcessed: result.classesProcessed,
          });
        } catch (error) {
          errorCount++;
          this.logger.error('Failed to upsert module during bulk update', {
            moduleName,
            error: error.message,
            stack: error.stack,
          });
          // Continue — now genuinely isolated from the other modules' txns.
        }
      }

      // Obsolescence sweep in its OWN final tx, after every module upsert has
      // committed. Protect every module PRESENT ON DISK this round (`attempted`),
      // NOT just the ones that installed: deleteOldModules deletes (DB −
      // validNames), so passing the on-disk set means "delete only modules that
      // no longer exist on disk". A module that merely blipped this boot
      // (getMetadata/resolveVectors/upsert threw) stays in `attempted` and is
      // never treated as obsolete and DETACH DELETE-d along with its classes.
      const attempted = Array.from(new Set(modules.keys()));
      if (attempted.length > 0) {
        // A failed obsolescence sweep must NOT crash boot: every module has
        // already committed, so a DB error here should degrade to "an obsolete
        // module lingers one more boot" (self-heals next sweep), not take the
        // whole app down. Log and continue rather than rethrow out of onModuleInit.
        try {
          await session.executeWrite((tx: DatabaseTransaction) =>
            this.deleteOldModules(tx, attempted),
          );
        } catch (error) {
          errorCount++;
          this.logger.error('Obsolescence sweep failed — leaving stale modules for next boot', {
            error: error.message,
            stack: error.stack,
            attempted,
          });
        }
      }

      // Post-commit: every :Module node is committed + visible to a fresh
      // session. Fire afterInstall on each installed OR content-hash-skipped
      // module (iterate `modulesInstalled`, NOT `resolved` — a skipped module
      // must still re-run its hook; a failure self-heals via the partial
      // downgrade next boot). Isolated + timeout-bounded (design §4.3, §9.2 #H9).
      for (const name of modulesInstalled) {
        await this.runAfterInstall(session, name, modules.get(name));
      }

      const duration = Date.now() - startTime;
      this.recordOperation('updateAllModules', duration, {
        totalModules: modules.size,
        processedCount,
        skippedCount,
        errorCount,
        installedModules: modulesInstalled,
      });

      this.logger.log('Bulk module update completed', {
        totalModules: modules.size,
        processedCount,
        skippedCount,
        errorCount,
        duration,
        successRate: modules.size
          ? (processedCount + skippedCount) / modules.size
          : 1,
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
      throw new Error(`Bulk module update failed: ${error.message}`, { cause: error });
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
      if (!resolvedPath.startsWith(allowedBasePath + path.sep) && resolvedPath !== allowedBasePath) {
        throw new Error('Invalid bundle path: outside module directory');
      }

      let bundleContent: string;
      try {
        bundleContent = await fs.readFile(frontendBundlePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`Frontend bundle not found for module '${moduleName}' at path: ${frontendBundlePath}`, { cause: error });
        } else if (error.code === 'EACCES') {
          throw new Error(`Access denied to frontend bundle for module '${moduleName}'`, { cause: error });
        } else {
          throw new Error(`Failed to read frontend bundle for module '${moduleName}': ${error.message}`, { cause: error });
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
