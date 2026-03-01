import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, Result, Integer } from 'neo4j-driver';
import { DatabaseConfig } from './database.config';

export interface DatabaseMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  connectionPoolUtilization: number;
  lastHealthCheck: Date;
  isHealthy: boolean;
}

export interface QueryMetrics {
  query: string;
  parameters?: any;
  duration: number;
  success: boolean;
  timestamp: Date;
  error?: string;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private driver: Driver;
  private readonly config: DatabaseConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private metrics: DatabaseMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    totalQueries: 0,
    successfulQueries: 0,
    failedQueries: 0,
    averageQueryTime: 0,
    connectionPoolUtilization: 0,
    lastHealthCheck: new Date(),
    isHealthy: false,
  };

  private initializationPromise?: Promise<void>;
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<DatabaseConfig>('database')!;
  }

  async onModuleInit(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeDatabase();
    }
    return this.initializationPromise;
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.logger.log('Initializing Neo4j database connection...');
      await this.createDriver();
      await this.verifyConnectivity();
      
      if (this.config.enableMetrics) {
        this.startHealthChecks();
      }
      
      this.isInitialized = true;
      
      this.logger.log('Database connection initialized successfully', {
        uri: this.maskUri(this.config.uri),
        database: this.config.name,
        maxPoolSize: this.config.maxConnectionPoolSize,
        encrypted: this.config.encrypted,
      });
    } catch (error) {
      this.logger.error('Failed to initialize database connection', {
        error: error.message,
        stack: error.stack,
        uri: this.maskUri(this.config.uri),
      });
      throw error;
    }
  }

  /**
   * Ensures the database service is initialized before use
   */
  async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeDatabase();
    }
    
    return this.initializationPromise;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.logger.log('Closing database connections...');
      
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      if (this.driver) {
        await this.driver.close();
        this.logger.log('Database connections closed successfully');
      }
    } catch (error) {
      this.logger.error('Error closing database connections', {
        error: error.message,
      });
    }
  }

  private async createDriver(): Promise<void> {
    const driverConfig: any = {
      maxConnectionPoolSize: this.config.maxConnectionPoolSize,
      connectionAcquisitionTimeout: this.config.connectionAcquisitionTimeout,
      connectionTimeout: this.config.connectionTimeout,
      maxConnectionLifetime: this.config.maxConnectionLifetime,
      maxTransactionRetryTime: this.config.maxTransactionRetryTime,
      encrypted: this.config.encrypted ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF',
      trust: this.config.trust ? 'TRUST_ALL_CERTIFICATES' : 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
      logging: this.config.enableLogging ? {
        level: this.config.enableDebug ? 'debug' : 'info',
        logger: (level: string, message: string) => {
          if (level === 'error') {
            this.logger.error(`Neo4j Driver: ${message}`);
          } else if (level === 'warn') {
            this.logger.warn(`Neo4j Driver: ${message}`);
          } else if (level === 'info') {
            this.logger.log(`Neo4j Driver: ${message}`);
          } else if (level === 'debug' && this.config.enableDebug) {
            this.logger.debug(`Neo4j Driver: ${message}`);
          }
        }
      } : undefined,
    };

    this.driver = neo4j.driver(
      this.config.uri,
      neo4j.auth.basic(this.config.username, this.config.password),
      driverConfig
    );
  }

  private async verifyConnectivity(): Promise<void> {
    const session = this.driver.session({
      database: this.config.name,
    });

    try {
      const result = await session.run('RETURN 1 as test');
      if (!result.records || result.records.length === 0) {
        throw new Error('Connectivity test failed: No records returned');
      }
      
      const testValue = result.records[0].get('test');
      if (!testValue || testValue.toNumber() !== 1) {
        throw new Error('Connectivity test failed: Invalid response');
      }

      this.metrics.isHealthy = true;
      this.logger.debug('Database connectivity verified');
    } finally {
      await session.close();
    }
  }

  private startHealthChecks(): void {
    if (!this.config.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health check failed', {
          error: error.message,
        });
      }
    }, this.config.healthCheckInterval);

    this.logger.debug('Health checks started', {
      interval: this.config.healthCheckInterval,
    });
  }

  private async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    const session = this.driver.session({
      database: this.config.name,
    });

    try {
      // Test basic connectivity
      await session.run('RETURN 1');
      
      // Update metrics
      this.metrics.lastHealthCheck = new Date();
      this.metrics.isHealthy = true;
      
      // Get connection pool metrics if available
      // Note: Driver metrics API may vary by Neo4j driver version
      try {
        const driverWithMetrics = this.driver as any;
        if (driverWithMetrics.metrics) {
          const poolMetrics = driverWithMetrics.metrics;
          this.metrics.totalConnections = poolMetrics.connectionPoolMetrics?.created || 0;
          this.metrics.activeConnections = poolMetrics.connectionPoolMetrics?.inUse || 0;
          this.metrics.idleConnections = poolMetrics.connectionPoolMetrics?.idle || 0;
          
          const maxPoolSize = this.config.maxConnectionPoolSize || 50;
          this.metrics.connectionPoolUtilization = 
            (this.metrics.activeConnections / maxPoolSize) * 100;
        }
      } catch (error) {
        // Metrics not available in this driver version
        this.logger.debug('Driver metrics not available', { error: error.message });
      }

      const duration = Date.now() - startTime;
      this.logger.debug('Health check completed', {
        duration,
        isHealthy: this.metrics.isHealthy,
        activeConnections: this.metrics.activeConnections,
        poolUtilization: `${this.metrics.connectionPoolUtilization.toFixed(1)}%`,
      });

    } catch (error) {
      this.metrics.isHealthy = false;
      this.metrics.lastHealthCheck = new Date();
      
      this.logger.warn('Health check failed', {
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get the Neo4j driver instance
   */
  getDriver(): Driver {
    if (!this.driver || !this.isInitialized) {
      throw new Error('Database driver not initialized. Call ensureInitialized() first.');
    }
    return this.driver;
  }

  /**
   * Get the Neo4j driver instance safely (returns null if not initialized)
   */
  getDriverSafe(): Driver | null {
    if (!this.driver || !this.isInitialized) {
      return null;
    }
    return this.driver;
  }

  /**
   * Create a new session with optional database specification
   */
  getSession(database?: string): Session {
    if (!this.driver || !this.isInitialized) {
      throw new Error('Database driver not initialized. Call ensureInitialized() first.');
    }

    return this.driver.session({
      database: database || this.config.name,
    });
  }

  /**
   * Execute a read query with automatic session management
   */
  async executeRead<T = any>(
    query: string, 
    parameters?: any, 
    database?: string
  ): Promise<Result<T>> {
    const session = this.getSession(database);
    const startTime = Date.now();

    try {
      this.logger.debug('Executing read query', {
        query: this.maskQuery(query),
        database: database || this.config.name,
      });

      const result = await session.executeRead(async (tx) => {
        return await tx.run<T>(query, parameters);
      });

      const duration = Date.now() - startTime;
      this.recordQueryMetrics(query, parameters, duration, true);

      this.logger.debug('Read query completed', {
        duration,
        recordCount: result.records.length,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordQueryMetrics(query, parameters, duration, false, error.message);
      
      this.logger.error('Read query failed', {
        query: this.maskQuery(query),
        error: error.message,
        duration,
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a write query with automatic session management
   */
  async executeWrite<T = any>(
    query: string, 
    parameters?: any, 
    database?: string
  ): Promise<Result<T>> {
    const session = this.getSession(database);
    const startTime = Date.now();

    try {
      this.logger.debug('Executing write query', {
        query: this.maskQuery(query),
        database: database || this.config.name,
      });

      const result = await session.executeWrite(async (tx) => {
        return await tx.run<T>(query, parameters);
      });

      const duration = Date.now() - startTime;
      this.recordQueryMetrics(query, parameters, duration, true);

      this.logger.debug('Write query completed', {
        duration,
        recordCount: result.records.length,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordQueryMetrics(query, parameters, duration, false, error.message);
      
      this.logger.error('Write query failed', {
        query: this.maskQuery(query),
        error: error.message,
        duration,
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get current database metrics
   */
  getMetrics(): DatabaseMetrics {
    return { ...this.metrics };
  }

  /**
   * Get database health status
   */
  async getHealthStatus(): Promise<{
    isHealthy: boolean;
    lastCheck: Date;
    metrics: DatabaseMetrics;
    connectivity: boolean;
  }> {
    let connectivity = false;
    
    try {
      const session = this.getSession();
      try {
        await session.run('RETURN 1');
        connectivity = true;
      } finally {
        await session.close();
      }
    } catch (error) {
      this.logger.warn('Connectivity check failed during health status', {
        error: error.message,
      });
    }

    return {
      isHealthy: this.metrics.isHealthy && connectivity,
      lastCheck: this.metrics.lastHealthCheck,
      metrics: this.getMetrics(),
      connectivity,
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      averageQueryTime: 0,
      connectionPoolUtilization: 0,
      lastHealthCheck: new Date(),
      isHealthy: false,
    };
    
    this.logger.log('Database metrics reset');
  }

  private recordQueryMetrics(
    query: string,
    parameters: any,
    duration: number,
    success: boolean,
    error?: string
  ): void {
    this.metrics.totalQueries++;
    
    if (success) {
      this.metrics.successfulQueries++;
    } else {
      this.metrics.failedQueries++;
    }

    // Update average query time
    const totalTime = this.metrics.averageQueryTime * (this.metrics.totalQueries - 1) + duration;
    this.metrics.averageQueryTime = totalTime / this.metrics.totalQueries;

    if (this.config.enableDebug) {
      const queryMetric: QueryMetrics = {
        query: this.maskQuery(query),
        parameters: this.maskParameters(parameters),
        duration,
        success,
        timestamp: new Date(),
        error,
      };

      this.logger.debug('Query metrics recorded', queryMetric);
    }
  }

  private maskUri(uri: string): string {
    try {
      const url = new URL(uri);
      return `${url.protocol}//${url.hostname}:${url.port}`;
    } catch {
      return 'Invalid URI';
    }
  }

  private maskQuery(query: string): string {
    // Mask sensitive data in queries (passwords, tokens, etc.)
    return query
      .replace(/password\s*[:=]\s*['"][^'"]*['"]/gi, 'password: "***"')
      .replace(/token\s*[:=]\s*['"][^'"]*['"]/gi, 'token: "***"')
      .replace(/secret\s*[:=]\s*['"][^'"]*['"]/gi, 'secret: "***"');
  }

  private maskParameters(parameters: any): any {
    if (!parameters || typeof parameters !== 'object') {
      return parameters;
    }

    const masked = { ...parameters };
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
    
    for (const key of Object.keys(masked)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        masked[key] = '***';
      }
    }

    return masked;
  }
}
