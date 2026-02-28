import { registerAs } from '@nestjs/config';
import { IsString, IsNumber, IsBoolean, IsOptional, Min, Max, validateSync } from 'class-validator';
import { plainToClass, Transform } from 'class-transformer';

export class DatabaseConfig {
  @IsString()
  uri: string = 'bolt://localhost:7687';

  @IsString()
  username: string = 'neo4j';

  @IsString()
  password: string = '';

  @IsOptional()
  @IsString()
  name?: string = 'neo4j';

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
  @Transform(({ value }) => value === 'true' || value === true)
  encrypted?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  trust?: boolean = false; // Trust self-signed certificates (only for dev)

  // Monitoring Settings
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enableMetrics?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enableLogging?: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  healthCheckInterval?: number = 60000; // 1 minute

  // Development Settings
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enableDebug?: boolean = false;
}

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const config = plainToClass(DatabaseConfig, {
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
  });

  const errors = validateSync(config);
  if (errors.length > 0) {
    const errorMessages = errors.map(error => 
      Object.values(error.constraints || {}).join(', ')
    ).join('; ');
    throw new Error(`Database configuration validation failed: ${errorMessages}`);
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
