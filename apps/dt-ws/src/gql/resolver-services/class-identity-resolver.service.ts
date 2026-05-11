import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { EnsureConstraintsService } from '../../bootstrap/ensure-constraints.service';
import {
  ClassIdentityEventLog,
  EventFilter,
  ClassIdentityEvent,
} from '../module-management-services/class-identity-event-log.service';
import { ClassIdentityMigrationService } from '../module-management-services/class-identity-migration.service';
import { requireAdmin, UserClaims } from '../../common/guards/is-admin';

/**
 * Admin GraphQL surface for class-identity operations — exposes
 * engine-level state and recovery primitives an operator can hit
 * through any GraphQL client (no DB shell access required).
 *
 * Surfaces:
 *   - `Query.classIdentityEvents(...)` — read the in-memory event log
 *   - `Mutation.migrateClassId(...)` — operator-authorized rebind
 *   - `Mutation.reviveOrphanedClass(...)` — HAS_ORPHANED_CLASS → HAS_CLASS
 *   - `Mutation.deleteOrphanedClass(...)` — DETACH DELETE with cascade gate
 *   - `Mutation.runIdentityMigration(...)` — re-run cleanup migration
 *   - `Module.rebindConflicts` — derived by joining the install-time
 *     declared-id snapshot (`Module.lastInstallClassIds`) against current
 *     DB ids; survives process restarts (event log does not).
 *   - `Module.constraintsHealthy` — derived from EnsureConstraintsService
 *
 * **Authz model.** Every mutation AND the read query require admin role
 * — checked at resolver entry via `requireAdmin(ctx)`. The admin check
 * itself is in `is-admin.ts`. The runtime gate (rather than a schema
 * directive) keeps the admin contract role-aware without introducing a
 * new schema directive into the type system.
 *
 * **Audit log.** Every admin mutation emits a Logger.warn structured entry
 * BEFORE doing the work, capturing operator identity (sub + email) +
 * arguments. Mutations that produce a class-identity event (e.g.
 * `migrateClassId` is mechanically an audit-mode rebind) ALSO emit the
 * structured event into the same in-memory log that automatic operations
 * use — so the operator-driven action shows up in the same timeline as
 * the engine's own actions. No separate persisted audit log; if compliance
 * later requires it, a downstream Logger transport handles persistence.
 */

const VALID_CLASS_KINDS = [
  'AnalysisClass',
  'ComponentClass',
  'ControlClass',
  'DataFlowClass',
  'DataClass',
  'SecurityBoundaryClass',
  'IssueClass',
] as const;

type ClassKindLabel = (typeof VALID_CLASS_KINDS)[number];

interface GqlContext {
  user?: UserClaims;
  token?: string;
}

interface MigrateClassIdArgs {
  moduleName: string;
  className: string;
  classKind: string;
  newId: string;
}

interface ReviveOrphanedArgs {
  classId: string;
  classKind: string;
}

interface DeleteOrphanedArgs {
  classId: string;
  classKind: string;
  cascade?: boolean;
}

interface RunIdentityMigrationArgs {
  dryRun?: boolean;
}

@Injectable()
export class ClassIdentityResolverService {
  private readonly logger = new Logger(ClassIdentityResolverService.name);

  /**
   * Hard cap on cascade-delete blast radius. Any deleteOrphanedClass call
   * with incidentCount > this value is refused — the operator must chunk
   * via direct Cypher first (or escalate the Memgraph per-tx memory limit
   * out-of-band). 1000 is a conservative ceiling that keeps the single-tx
   * DETACH DELETE well within Memgraph 3.8.1's default --memory-limit on
   * typical deployments. Tune via a future env knob if production patterns
   * justify it; today this lives as a code constant to keep the surface
   * minimal.
   */
  private static readonly CASCADE_HARD_LIMIT = 1000;

  constructor(
    private readonly events: ClassIdentityEventLog,
    private readonly migration: ClassIdentityMigrationService,
    private readonly constraints: EnsureConstraintsService,
    private readonly db: DatabaseService,
  ) {
    this.logger.log('ClassIdentityResolverService initialized');
  }

  getResolvers() {
    return {
      Module: {
        rebindConflicts: async (parent: {
          name?: string;
          lastInstallClassIds?: string | null;
          lastAttemptedInstall?: unknown;
        }) => {
          if (!parent?.name) return [];
          // No snapshot ⇒ never installed in this deployment, or installed
          // before the snapshot field was introduced. Either way: empty
          // conflict list. Re-install to populate. (Same self-heal posture
          // as `lastAttemptedInstall`.)
          if (!parent.lastInstallClassIds || !parent.lastAttemptedInstall) return [];
          let snapshot: Array<{ classKind: string; className: string; declaredId: string }>;
          try {
            snapshot = JSON.parse(parent.lastInstallClassIds);
          } catch (e) {
            this.logger.warn('Module.rebindConflicts: lastInstallClassIds JSON parse failed', {
              moduleName: parent.name,
              error: (e as Error).message,
            });
            return [];
          }
          if (!Array.isArray(snapshot) || snapshot.length === 0) return [];

          // Join the snapshot against current DB state. Surface only rows
          // where the DB id diverges from what the module declared — those
          // are the operator-actionable strict-mode conflicts.
          const result = await this.db.executeRead(
            `UNWIND $snapshot AS row
             MATCH (m:Module {name: $moduleName})-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c)
             WHERE labels(c)[0] = row.classKind AND c.name = row.className AND c.id <> row.declaredId
             RETURN row.classKind AS classKind,
                    row.className AS className,
                    c.id          AS dbId,
                    row.declaredId AS moduleDeclaredId`,
            { moduleName: parent.name, snapshot },
          );
          return result.records.map((r) => ({
            classKind: r.get('classKind'),
            className: r.get('className'),
            dbId: r.get('dbId'),
            moduleDeclaredId: r.get('moduleDeclaredId'),
          }));
        },
        constraintsHealthy: () => this.constraints.isHealthy(),
      },
      Query: {
        classIdentityEvents: (_: unknown, args: EventFilter, ctx: GqlContext) => {
          // Admin-only — the event log surfaces module names, class names,
          // rebind history, and collision events across the deployment.
          // Originally read-only-authenticated (rationale: "operationally
          // interesting to any operator"); flipped to admin to close a
          // tenant-leak path in deployments that are or might become
          // multi-tenant. The Logger.warn mirror in the event-log service
          // remains accessible to operators with log access.
          requireAdmin(ctx);
          // Coerce DateTime arg to ISO string (event log stores ISO strings).
          const filter: EventFilter = {
            kind: args.kind as ClassIdentityEvent['kind'] | undefined,
            moduleName: args.moduleName,
            since: this.coerceTimestamp(args.since),
          };
          return this.events.list(filter);
        },
      },
      Mutation: {
        migrateClassId: async (_: unknown, args: MigrateClassIdArgs, ctx: GqlContext) => {
          requireAdmin(ctx);
          this.auditLog('migrateClassId', args, ctx);
          return this.doMigrateClassId(args);
        },
        reviveOrphanedClass: async (_: unknown, args: ReviveOrphanedArgs, ctx: GqlContext) => {
          requireAdmin(ctx);
          this.auditLog('reviveOrphanedClass', args, ctx);
          return this.doRevive(args);
        },
        deleteOrphanedClass: async (_: unknown, args: DeleteOrphanedArgs, ctx: GqlContext) => {
          requireAdmin(ctx);
          this.auditLog('deleteOrphanedClass', args, ctx);
          return this.doDelete(args);
        },
        runIdentityMigration: async (_: unknown, args: RunIdentityMigrationArgs, ctx: GqlContext) => {
          requireAdmin(ctx);
          this.auditLog('runIdentityMigration', args, ctx);
          const dryRun = args.dryRun !== false; // default true
          return this.migration.run({ apply: !dryRun });
        },
      },
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private validateClassKind(classKind: string): ClassKindLabel {
    if (!VALID_CLASS_KINDS.includes(classKind as ClassKindLabel)) {
      throw new BadRequestException(
        `Invalid classKind "${classKind}" — expected one of ${VALID_CLASS_KINDS.join(', ')}`,
      );
    }
    return classKind as ClassKindLabel;
  }

  private async doMigrateClassId(args: MigrateClassIdArgs): Promise<boolean> {
    const label = this.validateClassKind(args.classKind);
    const { moduleName, className, newId } = args;

    // Look up the (module, className) pair to find the current id. Either
    // edge type counts — operator may be migrating an active OR an orphaned
    // class.
    const current = await this.db.executeRead(
      `MATCH (m:Module {name: $moduleName})-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${label} {name: $className})
       RETURN c.id AS oldId LIMIT 1`,
      { moduleName, className },
    );
    if (current.records.length === 0) {
      throw new NotFoundException(
        `No (Module "${moduleName}", ${label} "${className}") binding found`,
      );
    }
    const oldId = current.records[0].get('oldId') as string;
    if (oldId === newId) {
      // Idempotent no-op — operator already aligned. Return true; no event
      // (nothing to log, the timeline shouldn't show a non-action).
      return true;
    }

    // Cross-module collision check — refuse if newId is already taken by
    // another module's class at the same label. Mirrors the runtime rebind
    // collision guard at module-management.service.ts:529-547.
    const collision = await this.db.executeRead(
      `MATCH (other:Module)-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${label} {id: $newId})
       WHERE other.name <> $moduleName
       RETURN other.name AS otherModule LIMIT 1`,
      { moduleName, newId },
    );
    if (collision.records.length > 0) {
      const otherModule = collision.records[0].get('otherModule') as string;
      throw new BadRequestException(
        `Cannot migrate to id "${newId}" — already owned by Module "${otherModule}" at label ${label}. ` +
          `Resolution: (a) query ${label}(id: "${newId}") { orphanedAt } — if non-null, the conflicting class ` +
          `is itself orphaned and you can reviveOrphanedClass it (or migrate it to a different id) first; ` +
          `or (b) pick a different newId (note: this diverges DB from the module source).`,
      );
    }

    // Re-verify (oldId, className) inside the write match — closes the
    // TOCTOU between the collision check and the write. If a concurrent
    // writer changed the id between our read and write, the MATCH binds
    // zero rows and the SET no-ops; without this guard we'd silently emit a
    // misleading rebind event saying "X→Y" that never actually applied.
    // RETURN a confirmation row so we can detect the no-match case.
    //
    // Alias set-semantics: dedupe oldId on the idAliases array so a
    // re-applied migration (or a concurrent retry that lost the race but
    // partially raced through to the SET) doesn't produce duplicate
    // entries in the aliases history.
    const writeResult = await this.db.executeWrite(
      `MATCH (m:Module {name: $moduleName})-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c:${label} {id: $oldId, name: $className})
       SET c.id = $newId,
           c.idAliases = CASE
             WHEN $oldId IN coalesce(c.idAliases, []) THEN c.idAliases
             ELSE coalesce(c.idAliases, []) + [$oldId]
           END
       RETURN c.id AS confirmedId`,
      { moduleName, oldId, newId, className },
    );
    if (writeResult.records.length === 0) {
      throw new ConflictException(
        `Concurrent migration detected on (Module "${moduleName}", ${label} "${className}") — ` +
          `the (id, name) pair changed between read and write. Re-read state and retry.`,
      );
    }

    // Emit into the same timeline as automatic rebinds. Operator-driven
    // migration is mechanically equivalent to an audit-mode rebind, so the
    // event kind matches. Only emit AFTER confirming the write actually
    // matched — otherwise the audit timeline would lie about a rebind that
    // didn't happen.
    this.events.emit({
      kind: 'rebind',
      moduleName,
      classKind: this.classKindKey(label),
      className,
      oldId,
      newId,
      policy: 'audit',
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  private async doRevive(args: ReviveOrphanedArgs): Promise<boolean> {
    const label = this.validateClassKind(args.classKind);
    const { classId } = args;

    // Find the owning module — required by ClassReconciler.reviveClass.
    const lookup = await this.db.executeRead(
      `MATCH (m:Module)-[:HAS_ORPHANED_CLASS]->(c:${label} {id: $classId})
       RETURN m.name AS moduleName, c.name AS className LIMIT 1`,
      { classId },
    );
    if (lookup.records.length === 0) {
      // Already revived (HAS_CLASS) — idempotent no-op.
      const active = await this.db.executeRead(
        `MATCH (m:Module)-[:HAS_CLASS]->(c:${label} {id: $classId})
         RETURN m.name AS moduleName LIMIT 1`,
        { classId },
      );
      if (active.records.length > 0) return true;
      throw new NotFoundException(
        `No orphaned ${label} with id "${classId}" found (and no active class either)`,
      );
    }
    const moduleName = lookup.records[0].get('moduleName') as string;
    const className = lookup.records[0].get('className') as string;

    // Inline rename — DELETE + CREATE + property copy. The reconciler's
    // `reviveClass` method requires a caller-supplied tx scope which the
    // DatabaseService API doesn't expose. For a single one-shot admin call
    // the explicit DELETE+CREATE shape is functionally equivalent to the
    // reconciler's MAGE happy path; preserves edge properties via
    // `properties(r)` snapshotting.
    await this.db.executeWrite(
      `MATCH (m:Module {name: $moduleName})-[r:HAS_ORPHANED_CLASS]->(c:${label} {id: $classId})
       WITH m, c, r, properties(r) AS oldProps
       DELETE r
       CREATE (m)-[newR:HAS_CLASS]->(c)
       SET newR = oldProps`,
      { moduleName, classId },
    );

    this.events.emit({
      kind: 'revive',
      moduleName,
      classKind: this.classKindKey(label),
      className,
      classId,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  private async doDelete(args: DeleteOrphanedArgs): Promise<boolean> {
    const label = this.validateClassKind(args.classKind);
    const cascade = args.cascade === true;
    const { classId } = args;

    // Confirm the target IS orphaned — refuse to delete an active class.
    const lookup = await this.db.executeRead(
      `MATCH (m:Module)-[:HAS_ORPHANED_CLASS]->(c:${label} {id: $classId})
       RETURN m.name AS moduleName LIMIT 1`,
      { classId },
    );
    if (lookup.records.length === 0) {
      const active = await this.db.executeRead(
        `MATCH (m:Module)-[:HAS_CLASS]->(c:${label} {id: $classId})
         RETURN m.name AS moduleName LIMIT 1`,
        { classId },
      );
      if (active.records.length > 0) {
        throw new BadRequestException(
          `${label} "${classId}" is currently active (HAS_CLASS) — orphan it first via metadata reconciliation`,
        );
      }
      throw new NotFoundException(`No orphaned ${label} with id "${classId}" found`);
    }

    // Cascade gate — count incident :IS_INSTANCE_OF edges + sample 5 ids
    // so the cascade=false rejection gives the operator something to grep
    // before deciding whether to proceed.
    const incidentResult = await this.db.executeRead(
      `MATCH (c:${label} {id: $classId})<-[r:IS_INSTANCE_OF]-(inst)
       WITH count(r) AS n, collect(inst.id)[..5] AS sampleIds
       RETURN n, sampleIds`,
      { classId },
    );
    const incidentCount = this.toNumber(incidentResult.records[0]?.get('n') ?? 0);
    const sampleIds = (incidentResult.records[0]?.get('sampleIds') as unknown[] | undefined) ?? [];

    if (incidentCount > 0 && !cascade) {
      const sampleStr = sampleIds.length > 0
        ? ` First ${Math.min(5, sampleIds.length)} instance id(s): [${sampleIds.map((s) => `"${s}"`).join(', ')}].`
        : '';
      throw new BadRequestException(
        `Refusing to delete ${label} "${classId}" — has ${incidentCount} incoming :IS_INSTANCE_OF edge(s).${sampleStr} ` +
          `Re-call with cascade: true to DETACH DELETE the class AND every incident instance.`,
      );
    }

    // Cascade safety cap — refuse cascade deletes above CASCADE_HARD_LIMIT
    // to keep the single-tx DETACH DELETE under Memgraph's per-tx memory
    // ceiling. Operator with a legitimately-large cascade should chunk via
    // the CLI or escalate the tx memory limit; refusing is safer than
    // blowing the tx mid-flight.
    if (cascade && incidentCount > ClassIdentityResolverService.CASCADE_HARD_LIMIT) {
      throw new BadRequestException(
        `Refusing to cascade-delete ${label} "${classId}" — incident count (${incidentCount}) exceeds the ` +
          `hard limit of ${ClassIdentityResolverService.CASCADE_HARD_LIMIT}. Drop the instances in chunks via ` +
          `direct Cypher first, then re-call this mutation with cascade: true once incidentCount is below the cap.`,
      );
    }

    // Cascade rewrite — collect+FOREACH instead of `DETACH DELETE c, inst`
    // (which has documented row-stream edge cases on Memgraph 3.8.1 when
    // OPTIONAL MATCH binds N rows). The aggregation step deduplicates the
    // class-side and filters NULL when no instances bind.
    await this.db.executeWrite(
      `MATCH (c:${label} {id: $classId})
       OPTIONAL MATCH (c)<-[:IS_INSTANCE_OF]-(inst)
       WITH c, collect(DISTINCT inst) AS instances
       FOREACH (i IN instances | DETACH DELETE i)
       DETACH DELETE c`,
      { classId },
    );

    this.logger.warn('orphaned class hard-deleted', {
      classKind: label,
      classId,
      cascade,
      incidentCount,
    });

    return true;
  }

  private auditLog(action: string, args: unknown, ctx: GqlContext): void {
    this.logger.warn(`admin action: ${action}`, {
      action,
      args,
      operator: {
        sub: ctx?.user?.sub,
        email: ctx?.user?.email,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * The event log uses union-discriminant `classKind: ClassKind` from
   * `@dethernety/dt-module` ('analysisClasses' | 'componentClasses' | ...
   * — pluralized to match metadata array keys). Map from the schema-level
   * *Class label so emitted events match the log shape that the
   * reconciliation flow already produces.
   */
  private classKindKey(label: ClassKindLabel): ClassIdentityEvent['classKind'] {
    const map: Record<ClassKindLabel, ClassIdentityEvent['classKind']> = {
      AnalysisClass: 'analysisClasses',
      ComponentClass: 'componentClasses',
      ControlClass: 'controlClasses',
      DataFlowClass: 'dataFlowClasses',
      DataClass: 'dataClasses',
      SecurityBoundaryClass: 'securityBoundaryClasses',
      IssueClass: 'issueClasses',
    };
    return map[label];
  }

  private coerceTimestamp(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    // neo4j-driver DateTime objects expose toString()
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return String(value);
    }
    return undefined;
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }
}
