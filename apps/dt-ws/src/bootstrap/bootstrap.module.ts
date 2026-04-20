import { Module } from '@nestjs/common';
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
 * - {@link EnsureIndexesService} — Memgraph id-index creation (CL §9; needed
 *   by the §6 shared-ownership query and §7 Step B refresh).
 *
 * Add new bootstrap services flat in this folder (`bootstrap/<topic>.service.ts`)
 * and register them in the `providers` array below.
 */
@Module({
  providers: [EnsureIndexesService],
})
export class BootstrapModule {}
