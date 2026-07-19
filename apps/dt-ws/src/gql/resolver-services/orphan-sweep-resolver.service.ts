import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { ResolverMap, ResolverService } from '../interfaces/resolver.interface';
import { requireAdmin, UserClaims } from '../../common/guards/is-admin';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

interface GqlContext {
  user?: UserClaims;
  token?: string;
}

interface SweepOrphansArgs {
  dryRun?: boolean;
}

/** Coerce a neo4j Integer (or plain number / null) to a JS number. */
function toNumber(value: any): number {
  if (value == null) return 0;
  return typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);
}

/**
 * Core (OSS-owned) orphan sweep — model-level `Data` and `Exposure` left behind
 * by the pre-fix structural delete. Counts (dry-run) or deletes
 * (apply) the same orphan set; the set is computed by liveness, ordering-free,
 * so the dry-run count equals the apply count.
 *
 * Orphan `Data`: no `CONTAINS` from a `Model` AND no `HANDLES` in-edge. Sound
 * because the structural delete already removes structural elements correctly
 * (only `Data`/`Exposure` leaked) — so any surviving `Component`/`SecurityBoundary`/
 * `DataFlow` is live, and a `HANDLES` in-edge therefore implies a live owner.
 *
 * Orphan `Exposure`: every `HAS_EXPOSURE` owner is an orphan `Data` (or it has
 * none). A *local* "no in-edge" predicate would be wrong — the pre-fix delete left
 * the exposure still attached to its (also-orphaned) `Data`, so it only loses the
 * edge once the `Data` is deleted; the liveness form catches it on both passes.
 *
 * `FOREACH` keeps the statement one row (clean `{0,0}` on an empty graph). The
 * `CALL {}` (apply only) counts edges on the orphan set once via
 * `count(DISTINCT r)`. The COUNT (dry-run) variant reports node counts only and
 * `relationshipsDeleted: 0` — symmetric with the module hooks, so the operator
 * compares the comparable figure (per-label node counts) across the two passes.
 *
 * NOTE (load-bearing): `orphanData` is collapsed to a single value at the first
 * `collect()` barrier, so the implicit grouping key of the per-exposure
 * `collect(owner.id)` is `e` alone — that is what makes `ownerIds` the full
 * owner set per exposure. `orphanDataIds` holds only `Data` ids; the anti-join's
 * soundness rests on the migration premise that only `Data`/`Exposure` leaked
 * (surviving structural elements are live, so a non-`Data` owner ⇒ live owner).
 *
 * The `WHERE x.id IS NOT NULL` in the `orphanDataIds` comprehension is a 3VL
 * guard: a `Data` lacking an id would inject `null`, making the downstream
 * `oid IN orphanDataIds` membership 3-valued (`null` poisons the anti-join).
 * Filtering nulls keeps it 2-valued / deterministic (theoretical — all `Data`
 * carry ids — but cheap insurance).
 */
const CORE_ORPHAN_SWEEP_BODY = `
MATCH (d:Data)
WHERE NOT (d)<-[:CONTAINS]-(:Model) AND NOT (d)<-[:HANDLES]-()
WITH collect(DISTINCT d) AS orphanData
WITH orphanData, [x IN orphanData WHERE x.id IS NOT NULL | x.id] AS orphanDataIds
OPTIONAL MATCH (e:Exposure)
OPTIONAL MATCH (e)<-[:HAS_EXPOSURE]-(owner)
WITH orphanData, orphanDataIds, e, collect(owner.id) AS ownerIds
WITH orphanData,
     collect(DISTINCT CASE
       WHEN e IS NOT NULL AND size([oid IN ownerIds WHERE NOT oid IN orphanDataIds]) = 0
       THEN e END) AS expoRaw
WITH orphanData, [x IN expoRaw WHERE x IS NOT NULL] AS orphanExpo
WITH orphanData, orphanExpo, orphanData + orphanExpo AS allNodes`;

const CORE_ORPHAN_SWEEP_COUNT = `${CORE_ORPHAN_SWEEP_BODY}
RETURN size(orphanData) AS dataCount, size(orphanExpo) AS expoCount, 0 AS relationshipsDeleted
`;

const CORE_ORPHAN_SWEEP_DELETE = `${CORE_ORPHAN_SWEEP_BODY}
CALL {
  WITH allNodes UNWIND allNodes AS x
  OPTIONAL MATCH (x)-[r]-()
  RETURN count(DISTINCT r) AS rels
}
WITH orphanData, orphanExpo, allNodes, rels
FOREACH (n IN allNodes | DETACH DELETE n)
RETURN size(orphanData) AS dataCount, size(orphanExpo) AS expoCount, rels AS relationshipsDeleted
`;

interface OrphanSweepLabelCount {
  label: string;
  count: number;
}

interface OrphanSweepReport {
  dryRun: boolean;
  totalNodes: number;
  totalRelationships: number;
  byLabel: OrphanSweepLabelCount[];
}

/**
 * Admin GraphQL surface for the one-time orphan sweep (`Mutation.sweepOrphans`).
 *
 * Pre-existing orphans — nodes whose owner was deleted before the delete path
 * cascaded fully (the cascade-delete fix) — are removed here. The resolver owns
 * only the **core** labels (`Data`/`Exposure`); it dispatches the
 * `onOrphanSweep` lifecycle hook to every loaded module so each removes its own
 * (private-label) orphans on the same transaction, then aggregates every
 * module's per-label counts into one operator-facing report. The resolver names
 * no module label — the OSS surface stays label-agnostic.
 *
 * **Authz.** Admin-gated at resolver entry via `requireAdmin(ctx)` (mirrors the
 * class-identity admin family) — the destructive `apply` path must never be
 * reachable without the admin role. Audit-logged before the work runs.
 *
 * **Atomicity / modes.** One `executeRead` (dry-run, the default) or
 * `executeWrite` (apply) wraps the whole sweep — hooks + core. A module hook MAY
 * throw to abort (e.g. a violated data-integrity precondition); the throw rolls
 * the transaction back and surfaces as a GraphQL error.
 */
@Injectable()
export class OrphanSweepResolverService implements ResolverService {
  private readonly logger = new Logger(OrphanSweepResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
  ) {}

  getResolvers(): ResolverMap {
    return {
      Mutation: {
        sweepOrphans: async (_parent, args: SweepOrphansArgs, context: GqlContext) => {
          requireAdmin(context);
          this.auditLog('sweepOrphans', args, context);
          // dryRun defaults to true (schema default) — apply only when explicitly false.
          const apply = args.dryRun === false;
          return this.sweepOrphans(apply);
        },
      },
    };
  }

  /**
   * Run the sweep. `apply=false` counts only (read tx); `apply=true` deletes
   * (write tx). Idempotent on apply — a second run is a no-op `{}` everywhere.
   */
  async sweepOrphans(apply: boolean): Promise<OrphanSweepReport> {
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });

    const run = async (tx: any): Promise<OrphanSweepReport> => {
      const byLabel = new Map<string, number>();
      let totalNodes = 0;
      let totalRelationships = 0;

      const add = (label: string, count: number) => {
        if (count <= 0) return;
        byLabel.set(label, (byLabel.get(label) ?? 0) + count);
        totalNodes += count;
      };

      // 1. Dispatch the orphan-sweep hook to every loaded module that
      //    implements it, on this same tx. Each module removes (or counts) its
      //    own orphans; a throw aborts the whole sweep. Iteration order is
      //    unspecified — safe only because each participant's label set is
      //    disjoint from the others and from the core (Data/Exposure), so no
      //    hook reads a label another deletes. A future hook that breaks that
      //    contract would need this loop ordered.
      for (const moduleInstance of this.moduleRegistry.getAllModules().values()) {
        if (typeof moduleInstance.onOrphanSweep === 'function') {
          const counts = await moduleInstance.onOrphanSweep(tx, { apply });
          if (counts) {
            for (const [label, n] of Object.entries(counts.byLabel ?? {})) {
              add(label, toNumber(n));
            }
            totalRelationships += toNumber(counts.relationshipsDeleted);
          }
        }
      }

      // 2. Core (OSS-owned) Data/Exposure orphans.
      const coreRes = await tx.run(apply ? CORE_ORPHAN_SWEEP_DELETE : CORE_ORPHAN_SWEEP_COUNT);
      const coreRow = coreRes.records[0];
      if (coreRow) {
        add('Data', toNumber(coreRow.get('dataCount')));
        add('Exposure', toNumber(coreRow.get('expoCount')));
        totalRelationships += toNumber(coreRow.get('relationshipsDeleted'));
      }

      return {
        dryRun: !apply,
        totalNodes,
        totalRelationships,
        byLabel: Array.from(byLabel.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
    };

    try {
      const report = apply
        ? await session.executeWrite(run)
        : await session.executeRead(run);
      this.logger.warn('orphan sweep complete', {
        dryRun: report.dryRun,
        totalNodes: report.totalNodes,
        totalRelationships: report.totalRelationships,
        byLabel: report.byLabel,
      });
      return report;
    } catch (error) {
      this.logger.error('orphan sweep failed', {
        apply,
        error: safeErrorMessage(error),
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  private auditLog(action: string, args: unknown, ctx: GqlContext): void {
    this.logger.warn(`admin action: ${action}`, {
      action,
      args,
      operator: { sub: ctx?.user?.sub, email: ctx?.user?.email },
      timestamp: new Date().toISOString(),
    });
  }
}
