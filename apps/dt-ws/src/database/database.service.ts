import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, Result, Integer } from 'neo4j-driver';
import type { Config as Neo4jDriverConfig } from 'neo4j-driver';
import { DatabaseConfig } from './database.config';
import { EngineInfo, probeEngine } from '@dethernety/dt-module';

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

/** How many times in all {@link DatabaseService.executeSchemaWrite} runs a statement that meets a transient error. */
export const SCHEMA_WRITE_ATTEMPTS = 3;
/** The pause before each retry of a schema write grows by this much per attempt. */
export const SCHEMA_WRITE_RETRY_DELAY_MS = 200;

/**
 * An error the engine reports as transient: the statement can succeed if run again (a Neo4j deadlock, a Memgraph
 * conflict). A lost connection is not one, so a database that cannot be reached fails at once.
 */
export function isTransientError(error: unknown): boolean {
  return /^(Neo|Memgraph)\.TransientError\./.test(String((error as { code?: unknown } | null)?.code ?? ''));
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
  private engineInfoPromise?: Promise<EngineInfo>;

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
    // A `+s` / `+ssc` URI scheme configures encryption on the URL itself, and
    // neo4j-driver throws "Encryption/trust can only be configured either
    // through URL or config, not both" if the config ALSO carries encrypted /
    // trust keys (their mere presence conflicts, whatever the value). The
    // shipped production templates pair neo4j+s:// with NEO4J_ENCRYPTED=true,
    // so the URL must win and the config keys must be omitted entirely.
    const uriConfiguresEncryption = /^[a-z0-9]+\+s(sc)?:\/\//i.test(this.config.uri);

    // Hoisted out of the spread below and typed as a Pick, which is what makes
    // the annotation bite: excess-property checking does NOT reach properties
    // introduced by a spread, so writing these inline would compile happily
    // even if the driver renamed or dropped them. `Pick` constrains the key
    // set, so a driver major that moves either key fails the build instead of
    // silently changing the TLS posture at runtime.
    const encryptionConfig: Pick<Neo4jDriverConfig, 'encrypted' | 'trust'> = {
      encrypted: this.config.encrypted ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF',
      // `trust` is the driver's key; the right-hand side is our field.
      trust: this.config.trustSelfSignedCerts
        ? 'TRUST_ALL_CERTIFICATES'
        : 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
    };

    const driverConfig: Neo4jDriverConfig = {
      maxConnectionPoolSize: this.config.maxConnectionPoolSize,
      connectionAcquisitionTimeout: this.config.connectionAcquisitionTimeout,
      connectionTimeout: this.config.connectionTimeout,
      maxConnectionLifetime: this.config.maxConnectionLifetime,
      maxTransactionRetryTime: this.config.maxTransactionRetryTime,
      ...(uriConfiguresEncryption ? {} : encryptionConfig),
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
        // The database's error code (Neo.ClientError.Statement.SyntaxError, …): what the message leaves out.
        code: error.code,
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
        code: error.code,
        duration,
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a write query in an **implicit (auto-commit) transaction**.
   *
   * Use this for Memgraph DDL (`CREATE INDEX`, `CREATE CONSTRAINT`,
   * `DROP INDEX`, etc.) — those statements are rejected inside the
   * multi-command transactions that {@link executeWrite} opens via
   * `session.executeWrite`. Memgraph requires DDL in auto-commit mode,
   * which is what `session.run(query)` (no surrounding `tx.*` call) gives.
   *
   * No retry on transient errors (the underlying `Session.executeWrite`
   * retry semantics don't apply); for schema statements use
   * {@link executeSchemaWrite}, which retries them.
   */
  async executeImplicitWrite<T = any>(
    query: string,
    parameters?: any,
    database?: string,
  ): Promise<Result<T>> {
    const startTime = Date.now();
    try {
      return await this.runImplicitWrite<T>(query, parameters, database);
    } catch (error) {
      this.logImplicitWriteFailure(query, error, Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Execute a schema statement (`CREATE INDEX`, `CREATE CONSTRAINT`, `DROP INDEX`, …) in an implicit
   * transaction, as {@link executeImplicitWrite} does, and run it again, in a new session, after a transient
   * error: on Neo4j two schema statements on one label can deadlock, and the engine fails one of them.
   * {@link SCHEMA_WRITE_ATTEMPTS} attempts in all; each retry is logged at warn, and only the last failure at
   * error before it is thrown. Only for statements that are safe to run twice: `IF NOT EXISTS`, or an
   * "already exists" the caller treats as done. Never a data write.
   */
  async executeSchemaWrite<T = any>(query: string): Promise<Result<T>> {
    for (let attempt = 1; ; attempt += 1) {
      const startTime = Date.now();
      try {
        return await this.runImplicitWrite<T>(query);
      } catch (error) {
        if (attempt < SCHEMA_WRITE_ATTEMPTS && isTransientError(error)) {
          this.logger.warn('Schema write met a transient error; running it again', {
            query: this.maskQuery(query),
            error: error.message,
            code: error.code,
            attempt,
          });
          await new Promise((resolve) => setTimeout(resolve, SCHEMA_WRITE_RETRY_DELAY_MS * attempt));
          continue;
        }
        this.logImplicitWriteFailure(query, error, Date.now() - startTime);
        throw error;
      }
    }
  }

  private logImplicitWriteFailure(query: string, error: any, duration: number): void {
    this.logger.error('Implicit write failed', {
      query: this.maskQuery(query),
      error: error.message,
      code: error.code,
      duration,
    });
  }

  /** One run of an implicit write: its metrics and debug lines; the caller logs a failure. */
  private async runImplicitWrite<T>(query: string, parameters?: any, database?: string): Promise<Result<T>> {
    const session = this.getSession(database);
    const startTime = Date.now();

    try {
      this.logger.debug('Executing implicit-transaction write', {
        query: this.maskQuery(query),
        database: database || this.config.name,
      });

      const result = await session.run<T>(query, parameters);

      const duration = Date.now() - startTime;
      this.recordQueryMetrics(query, parameters, duration, true);

      this.logger.debug('Implicit write completed', {
        duration,
        recordCount: result.records.length,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordQueryMetrics(query, parameters, duration, false, error.message);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Detect which graph engine the configured Bolt endpoint is.
   *
   * Probes `CALL dbms.components()` (answered by both Neo4j and Memgraph —
   * verified empirically) and branches on the returned `name`. Successful
   * probes are memoized for the process lifetime; a **failed probe is NOT
   * memoized**, so a transient early failure cannot pin the wrong engine.
   *
   * Never rejects: any failure (driver not initialized, DB down, procedure
   * missing, unrecognised engine) logs an error and falls back to `memgraph`
   * for that call — the historical implicit assumption of the bootstrap DDL,
   * whose statements fail-open per statement anyway when the guess is wrong.
   * Callers that must not act on a guess use {@link getEngineInfoStrict}.
   */
  async getEngineInfo(): Promise<EngineInfo> {
    try {
      return await this.getEngineInfoStrict();
    } catch (error) {
      this.logger.error(
        `Engine detection probe failed — assuming Memgraph for this call: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { engine: 'memgraph', edition: null, version: null };
    }
  }

  /**
   * The same memoized probe as {@link getEngineInfo}, but a failure rejects
   * instead of falling back. Concurrent callers share one probe; on failure
   * the memo is cleared so the next caller probes again.
   */
  getEngineInfoStrict(): Promise<EngineInfo> {
    if (!this.engineInfoPromise) {
      this.engineInfoPromise = this.probeEngine().catch((error) => {
        this.engineInfoPromise = undefined;
        throw error;
      });
    }
    return this.engineInfoPromise;
  }

  private async probeEngine(): Promise<EngineInfo> {
    const info = await probeEngine(this.getDriver(), this.config.name);
    this.logger.log(
      `Graph engine detected: ${info.engine} (edition: ${info.edition ?? 'unknown'}, version: ${info.version ?? 'unknown'})`,
    );
    return info;
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
      // Live connectivity ONLY — never AND in the cached background flag.
      // The periodic health check ticks every ~60s, so after a brief DB blip
      // the cached `metrics.isHealthy` stays stale-false for up to a full
      // interval past recovery; with /ready acting on this value (503), that
      // stale flag would hold every replica out of rotation long after the
      // DB is back. The cache remains background telemetry (getMetrics()).
      isHealthy: connectivity,
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
