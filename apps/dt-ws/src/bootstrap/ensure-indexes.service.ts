import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService, EngineInfo } from '../database/database.service';
import { UNIQUE_CONSTRAINT_COVERED_PAIRS } from './ensure-constraints.service';

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
 * **Dual-engine DDL.** Both Neo4j 5 and Memgraph are supported production
 * engines and share no index syntax: Memgraph only parses the legacy
 * `CREATE INDEX ON :L(p)` form (and errors on an existing index — no
 * `IF NOT EXISTS`; the "already exists" error is caught and treated as
 * success), Neo4j 5 only `CREATE INDEX [IF NOT EXISTS] FOR (n:L) ON (n.p)`.
 * The engine is probed once via {@link DatabaseService.getEngineInfo} and the
 * statement built per dialect by {@link buildIndexDdl}.
 *
 * **Neo4j constraint interaction.** On Neo4j a uniqueness constraint
 * auto-creates its backing index, and a *plain* index on the same
 * label/property BLOCKS later constraint creation (`IF NOT EXISTS` does not
 * suppress the conflict). The pairs that EnsureConstraintsService covers with
 * UNIQUE constraints ({@link UNIQUE_CONSTRAINT_COVERED_PAIRS}) are therefore
 * skipped here on Neo4j — the constraint's backing index serves the same
 * lookups. On Memgraph indexes and constraints are independent, so the full
 * list is created there (shipped behavior, unchanged).
 *
 * Any non-"already exists" failure is logged at error level but does not
 * crash bootstrap — downstream queries will fall back to label scans, which
 * is functionally correct (just slower).
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

/** Build the engine-correct index DDL statement. */
export function buildIndexDdl(engineInfo: EngineInfo, label: string, property: string): string {
  return engineInfo.engine === 'neo4j'
    ? `CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n.${property})`
    : `CREATE INDEX ON :${label}(${property})`;
}

/**
 * True when the pair receives a UNIQUE constraint at bootstrap — on Neo4j
 * such pairs must not get a plain index (see class docblock).
 */
export function isConstraintCovered(label: string, property: string): boolean {
  return UNIQUE_CONSTRAINT_COVERED_PAIRS.some(
    (pair) => pair.label === label && pair.property === property,
  );
}

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
    // Back the per-label id match in the `addElementsToIssue` @cypher mutation —
    // a finding (Exposure) or countermeasure linked to an issue is matched by id.
    // These two were the only allowed element labels without an id index, so their
    // OPTIONAL MATCH branch would fall back to a label scan per UNWIND row.
    { label: 'Exposure', property: 'id' },
    { label: 'Countermeasure', property: 'id' },
  ];

  constructor(private readonly databaseService: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureIndexes();
    } catch (error) {
      // Belt-and-braces: a rejected bootstrap hook makes main.ts exit the
      // process — index bootstrap must degrade to label scans, never
      // crash-loop the app.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Index bootstrap aborted unexpectedly: ${message}. ` +
          'Downstream queries fall back to label scans until the next successful restart.',
      );
    }
  }

  private async ensureIndexes(): Promise<void> {
    const engineInfo = await this.databaseService.getEngineInfo();

    // On Neo4j, constraint-covered pairs get their index from the uniqueness
    // constraint itself; a plain index here would block constraint creation.
    const targets =
      engineInfo.engine === 'neo4j'
        ? EnsureIndexesService.REQUIRED_INDEXES.filter(
            ({ label, property }) => !isConstraintCovered(label, property),
          )
        : EnsureIndexesService.REQUIRED_INDEXES;
    const skippedCovered = EnsureIndexesService.REQUIRED_INDEXES.length - targets.length;

    this.logger.log(
      `Ensuring ${targets.length} ${engineInfo.engine} indexes for control-library queries` +
        (skippedCovered > 0
          ? ` (${skippedCovered} pairs covered by uniqueness constraints — skipped)`
          : ''),
    );

    let created = 0;
    let existed = 0;
    let failed = 0;

    for (const { label, property } of targets) {
      const cypher = buildIndexDdl(engineInfo, label, property);
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
