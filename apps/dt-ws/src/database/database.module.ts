import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { databaseConfig } from './database.config';

/**
 * The 'NEO4J_DRIVER' token resolves to DatabaseService's OWN driver — one
 * pool for the whole application, created by ensureInitialized(), watched
 * by the service's health checks, and closed by its onModuleDestroy.
 * (Previously this factory built a second, independent driver with no
 * shutdown hook: all GraphQL traffic ran on an unmonitored pool while the
 * health probes watched the other one.)
 *
 * Exported as a named function so the delegation is unit-pinnable.
 */
export const neo4jDriverFactory = async (db: DatabaseService) => {
  await db.ensureInitialized();
  return db.getDriver();
};

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
  ],
  providers: [
    DatabaseService,
    {
      provide: 'NEO4J_DRIVER',
      inject: [DatabaseService],
      useFactory: neo4jDriverFactory,
    },
    // Provide service access
    {
      provide: 'NEO4J_SERVICE',
      useExisting: DatabaseService,
    },
  ],
  exports: ['NEO4J_DRIVER', 'NEO4J_SERVICE', DatabaseService],
})
export class DatabaseModule {}
