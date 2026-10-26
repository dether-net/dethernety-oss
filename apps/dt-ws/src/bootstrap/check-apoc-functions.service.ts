import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * The APOC Core functions the queries @neo4j/graphql 7 generates call on Neo4j (its REQUIRED_APOC_FUNCTIONS, which
 * it does not export): apoc.date.convertFormat reads every DateTime field, and apoc.util.validatePredicate carries
 * the checks it writes into mutations (list push and pop, arithmetic operators, single relationships).
 */
export const GRAPHQL_APOC_FUNCTIONS: readonly string[] = ['apoc.date.convertFormat', 'apoc.util.validatePredicate'];

/** Calls both functions once, with values that pass. */
const CALL_APOC_FUNCTIONS =
  "RETURN apoc.date.convertFormat('2026-01-01T00:00:00Z', 'iso_zoned_date_time', 'iso_offset_date_time') AS converted, " +
  "apoc.util.validatePredicate(false, 'unused', []) AS validated";

/**
 * On Neo4j, reports at bootstrap the {@link GRAPHQL_APOC_FUNCTIONS} the database lacks or cannot run. Without them
 * every GraphQL query that selects a DateTime field fails ("Unknown function 'apoc.date.convertFormat'"), and the
 * rest of the API still answers, so the cause would otherwise first show in a failed query. The bundle loads them
 * from the image's labs/ directory (compose.neo4j.yaml).
 *
 * Logged at error, never thrown: a rejected bootstrap hook makes main.ts exit the process. Memgraph is not asked (it
 * has no SHOW FUNCTIONS), and a check that cannot run, the engine probe included, is logged at warn. DatabaseService
 * logs a failed read at error level before this service sees it, so such a failure also leaves that line in the log.
 */
@Injectable()
export class CheckApocFunctionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CheckApocFunctionsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { engine } = await this.databaseService.getEngineInfoStrict();
      if (engine !== 'neo4j') return;

      const listed = await this.databaseService.executeRead(
        'SHOW FUNCTIONS YIELD name WHERE name IN $names RETURN collect(name) AS found',
        { names: GRAPHQL_APOC_FUNCTIONS },
      );
      const found: string[] = listed.records[0]?.get('found') ?? [];
      const missing = GRAPHQL_APOC_FUNCTIONS.filter((name) => !found.includes(name));
      if (missing.length > 0) {
        this.logger.error(
          `Neo4j lacks APOC functions the GraphQL layer calls (${missing.join(', ')}): every query that selects a ` +
            'DateTime field fails. Load APOC Core, e.g. with server.directories.plugins=/var/lib/neo4j/labs ' +
            'and these functions in dbms.security.procedures.allowlist, as compose.neo4j.yaml does.',
        );
        return;
      }

      try {
        await this.databaseService.executeRead(CALL_APOC_FUNCTIONS);
      } catch (error) {
        this.logger.error(
          `Neo4j lists the APOC functions the GraphQL layer calls but cannot run them: ${errorText(error)}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Could not check the APOC functions the GraphQL layer calls: ${errorText(error)}`);
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
