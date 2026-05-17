import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Idempotent per-label id-index creation at application bootstrap.
 *
 * Required by the control-library subsystem (CONTROL_LIBRARY.md §9) — the
 * §6 shared-ownership query and the §7 Step B refresh both hit these indexes.
 * Without them, those queries degrade to full label scans per UNWIND row.
 *
 * Rationale for startup-time rather than migration script: there is no formal
 * migration mechanism in dt-ws today. A startup hook tolerates Docker Compose
 * teardown/rebuild without operator intervention and aligns with how the rest
 * of dt-ws bootstraps schema-derived state.
 *
 * Memgraph's `CREATE INDEX` errors if the index already exists (no
 * `IF NOT EXISTS` clause); the service catches the "already exists" error and
 * continues. Any other failure is logged at error level but does not crash
 * bootstrap — downstream queries will fall back to label scans, which is
 * functionally correct (just slower).
 *
 * **Transaction mode.** Memgraph rejects DDL (`CREATE INDEX`, `CREATE
 * CONSTRAINT`, etc.) inside multi-command (explicit) transactions with the
 * message `Index manipulation is not allowed in multicommand transactions`.
 * The bootstrap routes through {@link DatabaseService.executeImplicitWrite},
 * which runs the statement via `session.run` (auto-commit) instead of
 * `session.executeWrite` (explicit BEGIN/COMMIT). Do NOT switch this back
 * to `executeWrite` — it will silently fail-open every restart and the
 * shared-ownership safety query in CL §6 will run full label scans on
 * every push (the fail-open the bootstrap exists to prevent).
 */
@Injectable()
export class EnsureIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EnsureIndexesService.name);

  private static readonly REQUIRED_INDEXES: ReadonlyArray<{ label: string; property: string }> = [
    { label: 'Control', property: 'id' },
    { label: 'Model', property: 'id' },
    { label: 'SecurityBoundary', property: 'id' },
    { label: 'ControlClass', property: 'id' },
    { label: 'Component', property: 'id' },
    // Platform `*Class` labels under the class-identity safety net (see
    // EnsureConstraintsService). Indexes back the MERGE-by-id upserts the
    // module-management service issues; without them, those queries fall
    // back to label scans even though the constraint guarantees uniqueness.
    { label: 'AnalysisClass', property: 'id' },
    { label: 'ComponentClass', property: 'id' },
    { label: 'DataFlowClass', property: 'id' },
    { label: 'DataClass', property: 'id' },
    { label: 'SecurityBoundaryClass', property: 'id' },
    { label: 'IssueClass', property: 'id' },
    // Per-label `name` indexes back the lookup-by-name in upsertClass
    // (`MATCH (m:Module {name})-[:HAS_CLASS|HAS_ORPHANED_CLASS]->(c {name})`).
    // Without these, the MATCH falls back to a label scan filtered by name —
    // tolerable on small modules but degrades linearly past O(10³) classes.
    { label: 'AnalysisClass', property: 'name' },
    { label: 'ComponentClass', property: 'name' },
    { label: 'DataFlowClass', property: 'name' },
    { label: 'DataClass', property: 'name' },
    { label: 'SecurityBoundaryClass', property: 'name' },
    { label: 'IssueClass', property: 'name' },
    { label: 'ControlClass', property: 'name' },
    // Module is the join hub for upsertClass / Phase-4 reconciliation
    // queries; module-name lookup happens on every install.
    { label: 'Module', property: 'name' },
    // Back `MATCH ... <-[:HAS_CLASS]-(m:Module) WHERE m.id IN $moduleIds`
    // in list-classes-resolver and the same pattern in match-classes-resolver.
    // Without this, moduleIds filtering degrades to a post-traversal filter.
    { label: 'Module', property: 'id' },
    // Back the @cypher `createAnalysisIdempotent` mutation:
    // `MERGE (a:Analysis {id})` + `MATCH (e:{ElementLabel} {id})` for
    // ANALYZED_BY binding. Without these, the MERGE/MATCH pair degrades
    // to label scans on every re-run. `Analysis(id)` is load-bearing
    // for the mutation; the other three back per-label id lookups for
    // element types that didn't previously have an id index.
    { label: 'Analysis', property: 'id' },
    { label: 'Data', property: 'id' },
    { label: 'DataFlow', property: 'id' },
    { label: 'Issue', property: 'id' },
    // Back the §4.7 scoped upsert in SetInstantiationAttributesService
    // (and the upcoming ElementBindingService): the `OPTIONAL MATCH ...
    // (existing:Exposure {name: $attributes.name})` lookup walks
    // HAS_EXPOSURE neighbours filtered by name; without an index the
    // filter is O(degree) on elements with many findings. Same rationale
    // for Countermeasure under HAS_COUNTERMEASURE.
    { label: 'Exposure', property: 'name' },
    { label: 'Countermeasure', property: 'name' },
  ];

  constructor(private readonly databaseService: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`Ensuring ${EnsureIndexesService.REQUIRED_INDEXES.length} Memgraph indexes for control-library queries`);

    let created = 0;
    let existed = 0;
    let failed = 0;

    for (const { label, property } of EnsureIndexesService.REQUIRED_INDEXES) {
      const cypher = `CREATE INDEX ON :${label}(${property})`;
      try {
        await this.databaseService.executeImplicitWrite(cypher);
        created += 1;
        this.logger.debug(`Created index on :${label}(${property})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already\s+exists/i.test(message)) {
          existed += 1;
          this.logger.debug(`Index on :${label}(${property}) already exists`);
        } else {
          failed += 1;
          this.logger.error(
            `Failed to ensure index on :${label}(${property}): ${message}. ` +
            'Downstream control-library queries will fall back to full label scans.'
          );
        }
      }
    }

    this.logger.log(
      `Index ensure complete — created: ${created}, already existed: ${existed}, failed: ${failed}`
    );
  }
}
