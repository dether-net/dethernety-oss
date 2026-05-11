import { Module } from '@nestjs/common';
import { EnsureConstraintsService } from './ensure-constraints.service';
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
 * - {@link EnsureIndexesService} — Memgraph id-index creation; needed by
 *   shared-ownership lookup queries that scan by id.
 * - {@link EnsureConstraintsService} — Memgraph UNIQUE/EXISTS constraint
 *   creation on the seven platform `*Class` labels and `Analysis.id`
 *   (class-identity safety net).
 *
 * Add new bootstrap services flat in this folder (`bootstrap/<topic>.service.ts`)
 * and register them in the `providers` array below.
 */
@Module({
  providers: [EnsureIndexesService, EnsureConstraintsService],
  // Export EnsureConstraintsService so the admin GraphQL surface
  // (`Module.constraintsHealthy` resolver) can read the bootstrap result
  // via the same singleton instance that ran onApplicationBootstrap.
  exports: [EnsureConstraintsService],
})
export class BootstrapModule {}
