import { Logger } from '@nestjs/common';
import { registerAs } from '@nestjs/config';
import { IsString, IsNumber, IsBoolean, IsOptional, Min, Max, validateSync } from 'class-validator';
import { plainToClass, Transform } from 'class-transformer';

// Boolean env parsing: case-insensitive 'true' (so NEO4J_ENCRYPTED=TRUE works)
// and true only for an explicit affirmative. Unset env vars never reach this
// transform — their keys are stripped before plainToClass so the class
// defaults below stay in effect (an explicitly-undefined key would WIPE the
// initializer default, which is how every boolean here was silently `false`
// and every unset numeric was `undefined` for years).
const parseBooleanEnv = ({ value }: { value: unknown }): boolean =>
  value === true || String(value).toLowerCase() === 'true';

export class DatabaseConfig {
  @IsString()
  uri: string = 'bolt://localhost:7687';

  @IsString()
  username: string = 'neo4j';

  @IsString()
  password: string = '';

  // No default: `undefined` means "the server's default database", which is
  // the only value that works on BOTH engines out of the box. A default of
  // 'neo4j' would make every session pass `database: 'neo4j'`, which Memgraph
  // rejects outright ("not authorized on the database") → boot loop for any
  // deployment that doesn't set NEO4J_DATABASE.
  @IsOptional()
  @IsString()
  name?: string;

  // Connection Pool Settings
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  maxConnectionPoolSize?: number = 50;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  connectionAcquisitionTimeout?: number = 30000; // 30 seconds

  @IsOptional()
  @IsNumber()
  @Min(1000)
  connectionTimeout?: number = 5000; // 5 seconds

  @IsOptional()
  @IsNumber()
  @Min(1000)
  maxConnectionLifetime?: number = 3600000; // 1 hour

  @IsOptional()
  @IsNumber()
  @Min(1000)
  maxTransactionRetryTime?: number = 30000; // 30 seconds

  // Security Settings
  @IsOptional()
  @IsBoolean()
  @Transform(parseBooleanEnv)
  encrypted?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(parseBooleanEnv)
  trust?: boolean = false; // Trust self-signed certificates (only for dev)

  // Monitoring Settings
  @IsOptional()
  @IsBoolean()
  @Transform(parseBooleanEnv)
  enableMetrics?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(parseBooleanEnv)
  enableLogging?: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  healthCheckInterval?: number = 60000; // 1 minute

  // Development Settings
  @IsOptional()
  @IsBoolean()
  @Transform(parseBooleanEnv)
  enableDebug?: boolean = false;
}

/**
 * Strip keys whose value is `undefined` before handing the plain object to
 * class-transformer: `plainToClass` assigns explicitly-undefined keys over
 * the class initializer defaults (an absent key keeps the default). Without
 * this, every unset env var silently nulls its documented default.
 */
function omitUndefined(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
}

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const config = plainToClass(DatabaseConfig, omitUndefined({
    uri: process.env.NEO4J_URI,
    username: process.env.NEO4J_USERNAME,
    password: process.env.NEO4J_PASSWORD,
    name: process.env.NEO4J_DATABASE,
    maxConnectionPoolSize: process.env.NEO4J_MAX_POOL_SIZE ? parseInt(process.env.NEO4J_MAX_POOL_SIZE) : undefined,
    connectionAcquisitionTimeout: process.env.NEO4J_CONNECTION_TIMEOUT ? parseInt(process.env.NEO4J_CONNECTION_TIMEOUT) : undefined,
    connectionTimeout: process.env.NEO4J_CONNECT_TIMEOUT ? parseInt(process.env.NEO4J_CONNECT_TIMEOUT) : undefined,
    maxConnectionLifetime: process.env.NEO4J_MAX_CONNECTION_LIFETIME ? parseInt(process.env.NEO4J_MAX_CONNECTION_LIFETIME) : undefined,
    maxTransactionRetryTime: process.env.NEO4J_MAX_RETRY_TIME ? parseInt(process.env.NEO4J_MAX_RETRY_TIME) : undefined,
    encrypted: process.env.NEO4J_ENCRYPTED,
    trust: process.env.NEO4J_TRUST_CERT,
    enableMetrics: process.env.NEO4J_ENABLE_METRICS,
    enableLogging: process.env.NEO4J_ENABLE_LOGGING,
    healthCheckInterval: process.env.NEO4J_HEALTH_CHECK_INTERVAL ? parseInt(process.env.NEO4J_HEALTH_CHECK_INTERVAL) : undefined,
    enableDebug: process.env.NEO4J_DEBUG,
  }));

  const errors = validateSync(config);
  if (errors.length > 0) {
    const errorMessages = errors.map(error =>
      Object.values(error.constraints || {}).join(', ')
    ).join('; ');
    throw new Error(`Database configuration validation failed: ${errorMessages}`);
  }

  // Warn — not throw — on unencrypted Bolt in production: in-network plain
  // bolt (single-host compose behind a TLS-terminating proxy) is a deliberate,
  // supported topology, but it must be a VISIBLE choice, never a silent one.
  if (process.env.NODE_ENV === 'production' && !config.encrypted) {
    new Logger('DatabaseConfig').warn(
      'NEO4J_ENCRYPTED is off in production — Bolt traffic (including credentials) ' +
        'is unencrypted. Acceptable only on a trusted private network.',
    );
  }

  return config;
});

export function validateDatabaseConfig(config: DatabaseConfig): void {
  const errors = validateSync(config);
  if (errors.length > 0) {
    const errorMessages = errors.map(error => 
      Object.values(error.constraints || {}).join(', ')
    ).join('; ');
    throw new Error(`Database configuration validation failed: ${errorMessages}`);
  }
}
