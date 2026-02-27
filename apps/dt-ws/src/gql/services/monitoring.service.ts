import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlConfig } from '../gql.config';

export interface OperationMetrics {
  operationName: string;
  duration: number;
  success: boolean;
  timestamp: Date;
  metadata?: any;
}

export interface ServiceStatistics {
  operationCount: number;
  successCount: number;
  errorCount: number;
  averageResponseTime: number;
  lastOperationAt?: Date;
  operationsByName: Map<string, {
    count: number;
    successCount: number;
    errorCount: number;
    averageTime: number;
  }>;
}

/**
 * Shared monitoring service for GraphQL resolvers
 * Provides consistent metrics and monitoring across all resolver services
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly config: GqlConfig;
  private readonly statistics: ServiceStatistics = {
    operationCount: 0,
    successCount: 0,
    errorCount: 0,
    averageResponseTime: 0,
    operationsByName: new Map(),
  };

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    this.logger.log('MonitoringService initialized');
  }

  /**
   * Records operation metrics for monitoring
   */
  recordOperation(metrics: OperationMetrics): void {
    const { operationName, duration, success, metadata } = metrics;

    // Update overall statistics
    this.statistics.operationCount++;
    this.statistics.lastOperationAt = new Date();

    if (success) {
      this.statistics.successCount++;
    } else {
      this.statistics.errorCount++;
    }

    // Update average response time
    const totalTime = this.statistics.averageResponseTime * (this.statistics.operationCount - 1) + duration;
    this.statistics.averageResponseTime = totalTime / this.statistics.operationCount;

    // Update operation-specific statistics
    const opStats = this.statistics.operationsByName.get(operationName) || {
      count: 0,
      successCount: 0,
      errorCount: 0,
      averageTime: 0,
    };

    opStats.count++;
    if (success) {
      opStats.successCount++;
    } else {
      opStats.errorCount++;
    }

    const opTotalTime = opStats.averageTime * (opStats.count - 1) + duration;
    opStats.averageTime = opTotalTime / opStats.count;

    this.statistics.operationsByName.set(operationName, opStats);

    // Log operation details
    this.logger.debug('Operation recorded', {
      operationName,
      duration,
      success,
      operationCount: this.statistics.operationCount,
      averageTime: Math.round(this.statistics.averageResponseTime),
      successRate: (this.statistics.successCount / this.statistics.operationCount) * 100,
      ...metadata,
    });

    // Log slow operations
    if (duration > 5000) { // 5 seconds
      this.logger.warn('Slow operation detected', {
        operationName,
        duration,
        metadata,
      });
    }
  }

  /**
   * Gets comprehensive service statistics
   */
  getStatistics(): ServiceStatistics {
    return {
      operationCount: this.statistics.operationCount,
      successCount: this.statistics.successCount,
      errorCount: this.statistics.errorCount,
      averageResponseTime: this.statistics.averageResponseTime,
      lastOperationAt: this.statistics.lastOperationAt,
      operationsByName: new Map(this.statistics.operationsByName),
    };
  }

  /**
   * Gets statistics for a specific operation
   */
  getOperationStatistics(operationName: string) {
    return this.statistics.operationsByName.get(operationName) || null;
  }

  /**
   * Resets service statistics (useful for testing)
   */
  resetStatistics(): void {
    this.statistics.operationCount = 0;
    this.statistics.successCount = 0;
    this.statistics.errorCount = 0;
    this.statistics.averageResponseTime = 0;
    this.statistics.lastOperationAt = undefined;
    this.statistics.operationsByName.clear();
    
    this.logger.log('Service statistics reset');
  }

  /**
   * Gets service health information
   */
  getHealthStatus() {
    const successRate = this.statistics.operationCount > 0 
      ? (this.statistics.successCount / this.statistics.operationCount) * 100 
      : 100;

    return {
      healthy: successRate >= 95, // Consider healthy if 95%+ success rate
      successRate,
      averageResponseTime: Math.round(this.statistics.averageResponseTime),
      totalOperations: this.statistics.operationCount,
      lastOperationAt: this.statistics.lastOperationAt,
    };
  }
}
