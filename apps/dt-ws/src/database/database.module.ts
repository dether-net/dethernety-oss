import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import { DatabaseService } from './database.service';
import { databaseConfig } from './database.config';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
  ],
  providers: [
    // Create the Neo4j driver directly for backward compatibility
    {
      provide: 'NEO4J_DRIVER',
      useFactory: () => {
        // Load configuration directly from environment
        const config = databaseConfig();
        
        const driverConfig: any = {
          maxConnectionPoolSize: config.maxConnectionPoolSize,
          connectionAcquisitionTimeout: config.connectionAcquisitionTimeout,
          connectionTimeout: config.connectionTimeout,
          maxConnectionLifetime: config.maxConnectionLifetime,
          maxTransactionRetryTime: config.maxTransactionRetryTime,
          encrypted: config.encrypted ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF',
          trust: config.trust ? 'TRUST_ALL_CERTIFICATES' : 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
        };

        return neo4j.driver(
          config.uri,
          neo4j.auth.basic(config.username, config.password),
          driverConfig
        );
      },
    },
    // Create the DatabaseService (it will create its own driver internally)
    DatabaseService,
    // Provide service access
    {
      provide: 'NEO4J_SERVICE',
      useExisting: DatabaseService,
    },
  ],
  exports: ['NEO4J_DRIVER', 'NEO4J_SERVICE', DatabaseService],
})
export class DatabaseModule {}
