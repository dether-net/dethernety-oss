import { plainToClass, Transform } from 'class-transformer';
import { IsString, IsNumber, IsBoolean, IsOptional, IsIn, IsUrl, Min, Max, validateSync } from 'class-validator';

export class EnvironmentVariables {
  // Application Settings
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10))
  PORT: number = 3003;

  @IsOptional()
  @IsIn(['error', 'warn', 'log', 'debug', 'verbose'])
  LOG_LEVEL: string = 'log';

  @IsOptional()
  @IsString()
  ALLOWED_ORIGINS?: string;

  // Neo4j Database Configuration
  @IsString()
  NEO4J_URI: string = 'bolt://localhost:7687';

  @IsString()
  NEO4J_USERNAME: string = 'neo4j';

  @IsString()
  NEO4J_PASSWORD: string;

  @IsOptional()
  @IsString()
  NEO4J_DATABASE?: string = 'neo4j';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  NEO4J_MAX_POOL_SIZE?: number = 50;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  NEO4J_CONNECTION_TIMEOUT?: number = 30000;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  NEO4J_CONNECT_TIMEOUT?: number = 5000;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  NEO4J_MAX_CONNECTION_LIFETIME?: number = 3600000;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  NEO4J_MAX_RETRY_TIME?: number = 30000;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  NEO4J_ENCRYPTED?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  NEO4J_TRUST_CERT?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  NEO4J_ENABLE_METRICS?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  NEO4J_ENABLE_LOGGING?: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  NEO4J_HEALTH_CHECK_INTERVAL?: number = 60000;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  NEO4J_DEBUG?: boolean = false;

  // OIDC Configuration
  @IsOptional()
  @IsUrl({ require_tld: false })
  OIDC_ISSUER?: string;

  @IsOptional()
  @IsString()
  OIDC_CLIENT_ID?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  OIDC_REDIRECT_URI?: string;

  @IsOptional()
  @IsIn(['cognito', 'zitadel', 'auth0', 'keycloak', 'generic'])
  OIDC_PROVIDER?: string;

  // GraphQL Configuration
  @IsOptional()
  @IsUrl({ require_tld: false })
  OIDC_JKWS_URI?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  GQL_QUERY_DEPTH_LIMIT?: number = 10;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(10000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  GQL_QUERY_COMPLEXITY_LIMIT?: number = 1000;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value !== 'false')
  GQL_ENABLE_SUBSCRIPTIONS?: boolean = true;

  // Module Registry Configuration
  @IsOptional()
  @IsString()
  CUSTOM_MODULES_PATH?: string = 'custom_modules';

  @IsOptional()
  @IsString()
  ALLOWED_MODULES?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value !== 'false')
  ENABLE_MODULE_HOT_RELOAD?: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(300000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  MODULE_LOAD_TIMEOUT?: number = 30000;

  // Cache Configuration
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  TEMPLATE_CACHE_SIZE?: number = 100;

  @IsOptional()
  @IsNumber()
  @Min(60000)
  @Max(3600000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  TEMPLATE_CACHE_TTL_MS?: number = 300000;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(500)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  ANALYSIS_CACHE_SIZE?: number = 50;

  @IsOptional()
  @IsNumber()
  @Min(60000)
  @Max(3600000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  ANALYSIS_CACHE_TTL_MS?: number = 600000;

  // Operation Timeouts
  @IsOptional()
  @IsNumber()
  @Min(5000)
  @Max(300000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  TEMPLATE_OPERATION_TIMEOUT_MS?: number = 30000;

  @IsOptional()
  @IsNumber()
  @Min(5000)
  @Max(300000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  ISSUE_SYNC_TIMEOUT_MS?: number = 30000;

  // Batch Processing
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(10000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  BATCH_PROCESSING_DEBOUNCE_MS?: number = 1000;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  BATCH_PROCESSING_MAX_SIZE?: number = 50;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(60000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  BATCH_PROCESSING_TIMEOUT_MS?: number = 5000;

  // Monitoring
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value !== 'false')
  MONITORING_ENABLED?: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(10000)
  @Max(300000)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  HEALTH_CHECK_INTERVAL_MS?: number = 60000;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(168)
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  STATISTICS_RETENTION_HOURS?: number = 24;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map(error => {
      const constraints = Object.values(error.constraints || {});
      return `${error.property}: ${constraints.join(', ')}`;
    }).join('\n');

    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  // Production-specific validations
  if (validatedConfig.NODE_ENV === 'production') {
    const productionErrors: string[] = [];

    // Critical production settings
    if (!validatedConfig.NEO4J_PASSWORD) {
      productionErrors.push('NEO4J_PASSWORD is required in production');
    }

    if (!validatedConfig.OIDC_JKWS_URI) {
      productionErrors.push('OIDC_JKWS_URI is required in production for JWT validation');
    }

    if (!validatedConfig.OIDC_ISSUER) {
      productionErrors.push('OIDC_ISSUER is required in production for authentication');
    }

    if (!validatedConfig.OIDC_CLIENT_ID) {
      productionErrors.push('OIDC_CLIENT_ID is required in production for authentication');
    }

    if (!validatedConfig.ALLOWED_MODULES) {
      productionErrors.push('ALLOWED_MODULES must be specified in production for security');
    }

    if (!validatedConfig.ALLOWED_ORIGINS) {
      productionErrors.push('ALLOWED_ORIGINS should be specified in production for CORS security');
    }

    if (validatedConfig.NEO4J_TRUST_CERT) {
      productionErrors.push('NEO4J_TRUST_CERT should be false in production for security');
    }

    if (productionErrors.length > 0) {
      throw new Error(`Production environment validation failed:\n${productionErrors.join('\n')}`);
    }
  }

  return validatedConfig;
}

export const environmentValidation = {
  validate: validateEnvironment,
};
