import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Idempotent per-label id-constraint creation at application bootstrap.
 *
 * Establishes UNIQUE + EXISTS constraints on `id` for every platform `*Class`
 * label, plus a UNIQUE constraint on `Analysis.id`. The constraints are the
 * schema-level safety net against the duplicate-class-node and
 * duplicate-analysis-node failure modes (which would otherwise allow
 * routing-key ambiguity at the data layer).
 *
 * **Why per-label pre-flight.** The constraint creation itself would fail if
 * the underlying data violates the constraint (e.g. existing duplicate ids,
 * existing null ids). Memgraph rejects the `CREATE CONSTRAINT` statement and
 * the safety net would silently fail-open — which is exactly what the bootstrap
 * exists to prevent. The per-label pre-flight runs the same dup/null-count
 * queries that the cleanup migration script (`scripts/migrate-class-identity.ts`)
 * uses; if either count is non-zero for a label, that label's constraint
 * creation is **skipped with a loud banner** so the operator sees the missing
 * safety net at startup.
 *
 * **Memgraph constraint creation is naturally idempotent** — re-creating the
 * same constraint produces no error and no duplicate (verified empirically
 * against Memgraph 3.8.1). Unlike `EnsureIndexesService` which catches an
 * "already exists" message from `CREATE INDEX`, this service relies on
 * Memgraph's silent no-op behaviour and does not need the regex catch-and-
 * continue pattern. Any error surfacing from `executeImplicitWrite` is a
 * genuine failure and is logged but does not crash bootstrap.
 *
 * **Transaction mode.** Same as `EnsureIndexesService` — Memgraph rejects DDL
 * inside multi-command transactions, so this service routes through
 * {@link DatabaseService.executeImplicitWrite} which uses `session.run`
 * (auto-commit). Do NOT switch to `executeWrite` — DDL would silently fail.
 */
@Injectable()
export class EnsureConstraintsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EnsureConstraintsService.name);

  // Instance-state cache of the bootstrap result so the admin GraphQL
  // surface (`Module.constraintsHealthy`) can read it without re-probing
  // Memgraph. Populated once during onApplicationBootstrap; immutable
  // thereafter — a `DROP CONSTRAINT` performed at runtime won't be
  // reflected until restart (accepted trade-off vs. a per-call
  // SHOW CONSTRAINT INFO probe).
  private skippedLabels: string[] = [];
  private failedCount: number = 0;
  private bootstrapped: boolean = false;

  /**
   * True iff every required constraint was created (or already existed) at
   * application bootstrap. Returns false if any label was skipped due to
   * dirty data pre-flight, or if any CREATE CONSTRAINT raised an error.
   * Returns false before bootstrap completes (test-safe default).
   */
  isHealthy(): boolean {
    return this.bootstrapped && this.skippedLabels.length === 0 && this.failedCount === 0;
  }

  /** Read-only snapshot of skipped labels for diagnostics. */
  getSkippedLabels(): readonly string[] {
    return this.skippedLabels;
  }

  /**
   * Per-label constraint specification. The seven platform `*Class` labels
   * each carry both UNIQUE and EXISTS on `id` (the routing key + presence
   * guarantee). `Analysis` carries UNIQUE only — load-bearing for the
   * `createAnalysisIdempotent` `@cypher` MERGE-by-id mutation. EXISTS on
   * `Analysis.id` is not required because every Analysis-creating mutation
   * (the idempotent variant + the auto-generated legacy `createAnalyses`)
   * supplies an id at write time.
   */
  private static readonly REQUIRED_CONSTRAINTS: ReadonlyArray<{
    label: string;
    kinds: ('unique' | 'exists')[];
  }> = [
    { label: 'AnalysisClass',         kinds: ['unique', 'exists'] },
    { label: 'ComponentClass',        kinds: ['unique', 'exists'] },
    { label: 'ControlClass',          kinds: ['unique', 'exists'] },
    { label: 'DataFlowClass',         kinds: ['unique', 'exists'] },
    { label: 'DataClass',             kinds: ['unique', 'exists'] },
    { label: 'SecurityBoundaryClass', kinds: ['unique', 'exists'] },
    { label: 'IssueClass',            kinds: ['unique', 'exists'] },
    { label: 'Analysis',              kinds: ['unique'] },
  ];

  constructor(private readonly databaseService: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    const labelCount = EnsureConstraintsService.REQUIRED_CONSTRAINTS.length;
    const constraintCount = EnsureConstraintsService.REQUIRED_CONSTRAINTS
      .reduce((sum, { kinds }) => sum + kinds.length, 0);

    this.logger.log(
      `Ensuring ${constraintCount} Memgraph constraints across ${labelCount} labels (class identity safety net)`
    );

    let created = 0;
    let skippedDirty = 0;
    let failed = 0;
    // Reset before populating so re-bootstrap (test scenarios) starts clean.
    this.skippedLabels = [];
    this.failedCount = 0;
    const skippedLabels = this.skippedLabels;

    // Module.name UNIQUE — separate from the REQUIRED_CONSTRAINTS loop
    // because the rest is hardcoded to `id`. Module.name is the join hub
    // for upsertClass / Phase-4 reconciliation, and serializes concurrent
    // installs of the same module via Memgraph's UNIQUE-property serial
    // ordering. Pre-flight check by name not id; if duplicate Module
    // names exist (legacy data), skip with the same loud-banner pattern.
    {
      const dupResult = await this.databaseService.executeRead(
        `MATCH (m:Module) WITH m.name AS uname, count(*) AS n WHERE n > 1 RETURN count(*) AS dup_groups`,
      );
      const dupCount =
        dupResult.records[0]?.get('dup_groups')?.toNumber?.() ??
        Number(dupResult.records[0]?.get('dup_groups') ?? 0);
      if (dupCount > 0) {
        this.logger.warn(
          `:Module name pre-flight failed — duplicate_name_groups=${dupCount}. ` +
            'Skipping Module.name UNIQUE constraint creation. ' +
            'Concurrent installs of the same module are NOT serialized until this is resolved.',
        );
        skippedDirty += 1;
        skippedLabels.push('Module(name)');
      } else {
        try {
          await this.databaseService.executeImplicitWrite(
            `CREATE CONSTRAINT ON (m:Module) ASSERT m.name IS UNIQUE`,
          );
          created += 1;
          this.logger.debug('Ensured unique constraint on :Module(name)');
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to ensure unique constraint on :Module(name): ${message}. ` +
              'Concurrent installs of the same module are not serialized until this is resolved.',
          );
        }
      }
    }

    for (const { label, kinds } of EnsureConstraintsService.REQUIRED_CONSTRAINTS) {
      const dirty = await this.preflightDirtyCheck(label);
      if (dirty) {
        skippedDirty += kinds.length;
        skippedLabels.push(label);
        continue;
      }

      for (const kind of kinds) {
        const cypher = kind === 'unique'
          ? `CREATE CONSTRAINT ON (n:${label}) ASSERT n.id IS UNIQUE`
          : `CREATE CONSTRAINT ON (n:${label}) ASSERT EXISTS (n.id)`;
        try {
          await this.databaseService.executeImplicitWrite(cypher);
          created += 1;
          this.logger.debug(`Ensured ${kind} constraint on :${label}(id)`);
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to ensure ${kind} constraint on :${label}(id): ${message}. ` +
            `Class-identity safety net for :${label} is incomplete — duplicate or null-id ` +
            `nodes can be created until this is resolved.`
          );
        }
      }
    }

    this.logger.log(
      `Constraint ensure complete — created/idempotent: ${created}, skipped (dirty data): ${skippedDirty}, failed: ${failed}`
    );

    if (skippedLabels.length > 0) {
      // Loud banner — operator-visible — names the labels that need cleanup
      // and points at the canonical resolution path.
      this.logger.warn(
        '╔══ MISSING CONSTRAINTS ═══════════════════════════════════════════════╗\n' +
        `║ Labels with dirty data (constraint creation skipped): ${skippedLabels.join(', ')}\n` +
        '║ Resolution: run the class-identity cleanup migration:\n' +
        '║   pnpm --filter dt-ws build && pnpm --filter dt-ws migrate:class-identity --apply\n' +
        '║ Then restart this service to retry constraint creation.\n' +
        '╚══════════════════════════════════════════════════════════════════════╝'
      );
    }

    // Publish bootstrap result so isHealthy() reflects this run.
    this.failedCount = failed;
    this.bootstrapped = true;
  }

  /**
   * Returns true if the label has at least one node with a null `id` or at
   * least one duplicate-id group. Used by the per-label pre-flight to decide
   * whether to attempt constraint creation (which would otherwise fail).
   */
  private async preflightDirtyCheck(label: string): Promise<boolean> {
    const nullResult = await this.databaseService.executeRead(
      `MATCH (c:${label}) WHERE c.id IS NULL RETURN count(c) AS n`
    );
    const nullCount = nullResult.records[0]?.get('n')?.toNumber?.() ?? Number(nullResult.records[0]?.get('n') ?? 0);

    const dupResult = await this.databaseService.executeRead(
      `MATCH (c:${label}) WITH c.id AS uid, count(*) AS n WHERE n > 1 RETURN count(*) AS dup_groups`
    );
    const dupCount = dupResult.records[0]?.get('dup_groups')?.toNumber?.() ?? Number(dupResult.records[0]?.get('dup_groups') ?? 0);

    if (nullCount > 0 || dupCount > 0) {
      this.logger.warn(
        `:${label} pre-flight failed — null_ids=${nullCount}, duplicate_id_groups=${dupCount}. ` +
        'Skipping constraint creation for this label.'
      );
      return true;
    }

    return false;
  }
}
