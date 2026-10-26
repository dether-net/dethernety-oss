import { Module } from '@nestjs/common';
import { CheckApocFunctionsService } from './check-apoc-functions.service';
import { EnsureConstraintsService } from './ensure-constraints.service';
import { DropLegacyVectorIndexesService } from './drop-legacy-vector-indexes.service';
import { EnsureIndexesService } from './ensure-indexes.service';

/**
 * Aggregator module for application-startup bootstrap services. Each provider
 * implements `OnApplicationBootstrap` and runs once at startup to bring the
 * graph database into a known state before request traffic arrives.
 *
 * DatabaseModule is `@Global`, so DatabaseService is injected by every
 * provider here without an explicit import.
 *
 * Current providers:
 * - {@link EnsureIndexesService} — id-index creation, in the engine's
 *   dialect; needed by shared-ownership lookup queries that scan by id.
 *   Waits for the constraint pass below: on Neo4j the two can deadlock on one label.
 * - {@link EnsureConstraintsService} — UNIQUE/EXISTS constraint creation, in
 *   the engine's dialect, on the seven platform `*Class` labels and
 *   `Analysis.id` (class-identity safety net).
 * - {@link DropLegacyVectorIndexesService} — drops the Memgraph vector indexes
 *   earlier versions kept on the class labels; nothing reads those. The MITRE
 *   vector indexes stay.
 *   Waits for the two services above, so schema changes do not overlap.
 * - {@link CheckApocFunctionsService} — on Neo4j, reports at error the APOC
 *   functions the GraphQL layer calls that the database lacks or cannot run.
 *   Changes nothing.
 *
 * Add new bootstrap services flat in this folder (`bootstrap/<topic>.service.ts`)
 * and register them in the `providers` array below.
 */
@Module({
  providers: [EnsureIndexesService, EnsureConstraintsService, DropLegacyVectorIndexesService, CheckApocFunctionsService],
  // Export EnsureConstraintsService so the admin GraphQL surface
  // (`Module.constraintsHealthy` resolver) can read the bootstrap result
  // via the same singleton instance that ran onApplicationBootstrap.
  exports: [EnsureConstraintsService],
})
export class BootstrapModule {}
