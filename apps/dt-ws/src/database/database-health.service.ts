import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface DatabaseHealthResult {
  status: 'up' | 'down';
  connectivity: boolean;
  lastCheck: Date;
  metrics?: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    averageQueryTime: number;
    connectionPoolUtilization: string;
    activeConnections: number;
    idleConnections: number;
  };
  error?: string;
  timestamp?: Date;
}

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async checkHealth(key: string = 'database'): Promise<{ [key: string]: DatabaseHealthResult }> {
    try {
      const healthStatus = await this.databaseService.getHealthStatus();
      const metrics = this.databaseService.getMetrics();

      if (healthStatus.isHealthy && healthStatus.connectivity) {
        const result: DatabaseHealthResult = {
          status: 'up',
          connectivity: healthStatus.connectivity,
          lastCheck: healthStatus.lastCheck,
          metrics: {
            totalQueries: metrics.totalQueries,
            successfulQueries: metrics.successfulQueries,
            failedQueries: metrics.failedQueries,
            averageQueryTime: Math.round(metrics.averageQueryTime),
            connectionPoolUtilization: `${metrics.connectionPoolUtilization.toFixed(1)}%`,
            activeConnections: metrics.activeConnections,
            idleConnections: metrics.idleConnections,
          },
        };

        return { [key]: result };
      }

      const result: DatabaseHealthResult = {
        status: 'down',
        connectivity: healthStatus.connectivity,
        lastCheck: healthStatus.lastCheck,
        error: 'Database connectivity issues detected',
      };

      this.logger.warn('Database health check failed', result);
      return { [key]: result };

    } catch (error) {
      const result: DatabaseHealthResult = {
        status: 'down',
        connectivity: false,
        lastCheck: new Date(),
        error: error.message,
        timestamp: new Date(),
      };

      this.logger.error('Database health check error', {
        error: error.message,
        stack: error.stack,
      });

      return { [key]: result };
    }
  }

  async isHealthy(): Promise<boolean> {
    const health = await this.checkHealth();
    return Object.values(health).every(status => status.status === 'up');
  }
}
