import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { GqlHealthService } from './gql/health/gql-health.service';
import { ModuleRegistryService } from './gql/module-management-services/module-registry.service';

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: {
      status: 'up' | 'down';
      responseTime?: number;
      error?: string;
    };
    graphql: {
      status: 'up' | 'down';
      error?: string;
    };
    modules: {
      status: 'up' | 'down';
      loaded: number;
      healthy: number;
      error?: string;
    };
  };
  system: {
    memory: {
      used: number;
      total: number;
      usage: number;
    };
    node: {
      version: string;
      uptime: number;
    };
  };
}

@Controller()
export class AppController {
  constructor(
    @Inject('NEO4J_SERVICE') private readonly databaseService: DatabaseService,
    private readonly gqlHealthService: GqlHealthService,
    private readonly moduleRegistryService: ModuleRegistryService,
  ) {}

  @Get('config')
  getFrontendConfig() {
    // Determine subscription transport from environment
    const subscriptionTransport = process.env.SUBSCRIPTION_TRANSPORT?.toLowerCase() === 'ws' ? 'ws' : 'sse';
    const isProduction = process.env.NODE_ENV === 'production';

    // Base configuration (always exposed)
    const config: Record<string, unknown> = {
      // OIDC Configuration
      oidcIssuer: process.env.OIDC_ISSUER || '',
      oidcClientId: process.env.OIDC_CLIENT_ID || '',
      oidcRedirectUri: process.env.OIDC_REDIRECT_URI || '',
      // Optional: explicit provider selection (cognito, zitadel, auth0, keycloak, generic)
      // If not set, frontend auto-detects from issuer URL
      oidcProvider: process.env.OIDC_PROVIDER || '',
      // Cognito hosted UI domain for OAuth2 flows (authorize, token, logout)
      // For Cognito, OAuth2 endpoints are on a different domain than the issuer
      // Format: prefix.auth.region.amazoncognito.com (without https://)
      oidcDomain: process.env.OIDC_DOMAIN || '',
      // Optional: custom endpoint overrides (frontend uses provider presets if not specified)
      // oidcEndpoints: { authorize: '...', token: '...', ... }

      // API Configuration
      apiBaseUrl: '', // Relative URLs in production
      graphqlUrl: '/graphql',
      graphqlWsUrl: '', // Auto-detected by frontend when subscriptionTransport is 'ws'
      subscriptionTransport, // 'sse' (default) or 'ws'

      // Application Configuration
      appUrl: process.env.APP_URL || '',
      appBaseUrl: process.env.APP_BASE_URL || '/',
    };

    // Development-only configuration (not exposed in production)
    // These fields reveal debug capabilities and environment details
    if (!isProduction) {
      config.debugAuth = process.env.DEBUG_AUTH === 'true';
      config.enableDevTools = process.env.ENABLE_DEV_TOOLS === 'true';
      config.nodeEnv = process.env.NODE_ENV || 'development';
    }

    return config;
  }

  @Get('health')
  async getHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    
    // Database health check
    let databaseStatus: 'up' | 'down' = 'down';
    let databaseError: string | undefined;
    let databaseResponseTime: number | undefined;
    
    try {
      const dbStartTime = Date.now();
      const dbHealth = await this.databaseService.getHealthStatus();
      databaseResponseTime = Date.now() - dbStartTime;
      databaseStatus = dbHealth.isHealthy ? 'up' : 'down';
      if (!dbHealth.isHealthy) {
        databaseError = 'Database connectivity issues';
        overallStatus = 'unhealthy';
      }
    } catch (error) {
      databaseError = error.message;
      overallStatus = 'unhealthy';
    }

    // GraphQL health check
    let graphqlStatus: 'up' | 'down' = 'down';
    let graphqlError: string | undefined;
    
    try {
      const gqlHealth = await this.gqlHealthService.getHealthStatus();
      graphqlStatus = gqlHealth.status === 'healthy' ? 'up' : 'down';
      if (gqlHealth.status !== 'healthy') {
        graphqlError = gqlHealth.errors?.join(', ') || 'GraphQL service issues';
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }
    } catch (error) {
      graphqlError = error.message;
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Module registry health check
    let moduleStatus: 'up' | 'down' = 'down';
    let moduleError: string | undefined;
    let loadedModules = 0;
    let healthyModules = 0;
    
    try {
      const moduleHealth = await this.moduleRegistryService.getModuleHealth();
      loadedModules = moduleHealth.totalModules;
      healthyModules = moduleHealth.healthyModules;
      moduleStatus = moduleHealth.healthyModules === moduleHealth.totalModules ? 'up' : 'down';
      
      if (moduleHealth.healthyModules !== moduleHealth.totalModules) {
        moduleError = `${moduleHealth.totalModules - moduleHealth.healthyModules} unhealthy modules`;
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }
    } catch (error) {
      moduleError = error.message;
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // System metrics
    const memUsage = process.memoryUsage();
    const totalMemory = memUsage.heapTotal + memUsage.external;
    const usedMemory = memUsage.heapUsed;

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '0.0.1',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: {
          status: databaseStatus,
          responseTime: databaseResponseTime,
          error: databaseError,
        },
        graphql: {
          status: graphqlStatus,
          error: graphqlError,
        },
        modules: {
          status: moduleStatus,
          loaded: loadedModules,
          healthy: healthyModules,
          error: moduleError,
        },
      },
      system: {
        memory: {
          used: Math.round(usedMemory / 1024 / 1024), // MB
          total: Math.round(totalMemory / 1024 / 1024), // MB
          usage: Math.round((usedMemory / totalMemory) * 100), // %
        },
        node: {
          version: process.version,
          uptime: Math.floor(process.uptime()),
        },
      },
    };
  }

  @Get('health/simple')
  async getSimpleHealth(): Promise<{ status: string; timestamp: string }> {
    try {
      // Quick checks only
      const dbHealth = await this.databaseService.getHealthStatus();

      if (!dbHealth.isHealthy) {
        throw new ServiceUnavailableException({
          status: 'error',
          timestamp: new Date().toISOString(),
        });
      }

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  @Get('ready')
  async getReadiness(): Promise<{ ready: boolean; timestamp: string }> {
    try {
      // Check if all critical services are ready
      const dbHealth = await this.databaseService.getHealthStatus();
      const gqlHealth = await this.gqlHealthService.getHealthStatus();
      
      const ready = dbHealth.isHealthy && gqlHealth.status === 'healthy';
      
      return {
        ready,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ready: false,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
