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
 * every push (the F-32 / F-15-class fail-open the bootstrap exists to prevent).
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
