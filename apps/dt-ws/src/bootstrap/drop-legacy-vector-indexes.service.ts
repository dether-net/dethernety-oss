import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EnsureConstraintsService } from './ensure-constraints.service';
import { EnsureIndexesService } from './ensure-indexes.service';

/** The class vector indexes earlier versions created on Memgraph. */
export const LEGACY_VECTOR_INDEXES: readonly string[] = [
  'component_class_embeddings',
  'control_class_embeddings',
  'dataflow_class_embeddings',
  'boundary_class_embeddings',
  'data_class_embeddings',
];

/**
 * Drops the Memgraph vector (HNSW) indexes earlier versions kept on the class
 * labels.
 *
 * Class matching is an exact cosine scan on both engines and reads no vector
 * index. On a Memgraph database that still has these indexes they only hold
 * memory and slow every class write, so they are dropped at bootstrap. (The
 * MITRE vector indexes are different: consumers still search them by name on
 * Memgraph, and the MITRE resolver keeps them.)
 *
 * Idempotent: only indexes `vector_search.show_index_info()` reports are
 * dropped, so a database that never had them, or already lost them, is left
 * alone. Neo4j never had them and is skipped, as is a database whose engine
 * cannot be determined or that has no vector_search module. A failure is
 * logged and never crashes bootstrap.
 *
 * The drop waits for the index and constraint bootstrap to finish: Memgraph
 * schema changes take exclusive access, and overlapping them can make one of
 * the other passes fail. Nest starts every bootstrap hook of a module in one
 * synchronous pass, so the drop yields once before it asks whether they have
 * started; that holds whatever order the providers are listed in.
 *
 * Vector index DDL runs auto-commit ({@link DatabaseService.executeSchemaWrite}):
 * Memgraph rejects it inside an explicit transaction. DatabaseService logs a
 * failed read or write at error level before this service sees it, so a
 * listing or drop failure also leaves that line in the log.
 */
@Injectable()
export class DropLegacyVectorIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DropLegacyVectorIndexesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ensureIndexes: EnsureIndexesService,
    private readonly ensureConstraints: EnsureConstraintsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Let the other hooks of this module start before asking whether they have finished.
      await Promise.resolve();
      await Promise.all([this.ensureIndexes.whenBootstrapped(), this.ensureConstraints.whenBootstrapped()]);
      await this.dropLegacyIndexes();
    } catch (error) {
      // A rejected bootstrap hook makes main.ts exit the process; a leftover
      // index only costs memory.
      this.logger.warn(`Legacy vector index cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async dropLegacyIndexes(): Promise<void> {
    const { engine } = await this.databaseService.getEngineInfoStrict();
    if (engine !== 'memgraph') return;

    let present: Set<string>;
    try {
      const result = await this.databaseService.executeRead(
        'CALL vector_search.show_index_info() YIELD index_name RETURN index_name',
      );
      present = new Set(result.records.map((record: any) => String(record.get('index_name'))));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // No vector_search module means no vector indexes to drop; any other failure leaves them in place.
      if (/no procedure/i.test(message)) this.logger.debug(`Vector indexes not listed: ${message}`);
      else this.logger.warn(`Unused vector indexes not checked: ${message}`);
      return;
    }
    const legacy = LEGACY_VECTOR_INDEXES.filter((name) => present.has(name));
    if (legacy.length === 0) return;

    let dropped = 0;
    for (const name of legacy) {
      try {
        await this.databaseService.executeSchemaWrite(`DROP VECTOR INDEX ${name}`);
        dropped += 1;
      } catch (error) {
        this.logger.warn(
          `Could not drop the unused vector index ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(`Dropped ${dropped} of ${legacy.length} unused vector indexes`);
  }
}
