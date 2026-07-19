import { Injectable, Logger, Inject } from '@nestjs/common';
import { SchemaService } from '../services/schema.service';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  details: {
    neo4j: 'connected' | 'disconnected' | 'error';
    schema: 'valid' | 'invalid' | 'degraded' | 'error';
    services: string[];
  };
  errors?: string[];
}

@Injectable()
export class GqlHealthService {
  private readonly logger = new Logger(GqlHealthService.name);

  constructor(
    private readonly schemaService: SchemaService,
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  ) {}

  async getHealthStatus(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const errors: string[] = [];
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    // Check Neo4j connection
    let neo4jStatus: 'connected' | 'disconnected' | 'error' = 'connected';
    try {
      const session = this.neo4jDriver.session();
      let result;
      try {
        result = await session.run('RETURN 1 as test');
      } finally {
        // finally, not sequential — a throwing run() would otherwise leak
        // one session per failing probe (probes run periodically).
        await session.close();
      }

      if (!result.records || result.records.length === 0) {
        neo4jStatus = 'error';
        errors.push('Neo4j query returned no results');
        overallStatus = 'degraded';
      }
    } catch (error) {
      neo4jStatus = 'disconnected';
      errors.push(`Neo4j connection failed: ${error.message}`);
      overallStatus = 'unhealthy';
      this.logger.error('Neo4j health check failed', error);
    }

    // Check schema validity
    let schemaStatus: 'valid' | 'invalid' | 'degraded' | 'error' = 'valid';
    try {
      const isValid = await this.schemaService.validateSchema();
      if (!isValid) {
        schemaStatus = 'invalid';
        errors.push('GraphQL schema validation failed');
        overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
      } else if (this.schemaService.isSchemaDegraded()) {
        // The composition fallback fired at boot: the served schema is the
        // base only — module types/resolvers are missing. Without this, a
        // pathological module degrades the whole module surface while
        // /health stays green.
        schemaStatus = 'degraded';
        errors.push(
          'Module-contributed schema failed to compose — serving base schema without module types/resolvers',
        );
        overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
      }
    } catch (error) {
      schemaStatus = 'error';
      errors.push(`Schema validation error: ${error.message}`);
      overallStatus = 'unhealthy';
      this.logger.error('Schema health check failed', error);
    }

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp,
      details: {
        neo4j: neo4jStatus,
        schema: schemaStatus,
        services: ['GraphQL', 'Neo4j', 'Schema'],
      },
    };

    if (errors.length > 0) {
      healthStatus.errors = errors;
    }

    if (overallStatus !== 'healthy') {
      this.logger.warn('Health check completed with issues', healthStatus);
    } else {
      this.logger.debug('Health check completed successfully');
    }

    return healthStatus;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const status = await this.getHealthStatus();
      return status.status === 'healthy';
    } catch (error) {
      this.logger.error('Health check failed completely', error);
      return false;
    }
  }
}
