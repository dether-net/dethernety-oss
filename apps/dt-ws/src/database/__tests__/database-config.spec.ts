import { Logger } from '@nestjs/common';
import { databaseConfig } from '../database.config';

/**
 * Pins for the database-config env parsing. Two long-standing silent bugs:
 *  1. `plainToClass` assigns explicitly-undefined keys OVER the class
 *     initializer defaults — every unset boolean env var became `false`
 *     (encrypted/enableMetrics/enableLogging all declared `true`) and every
 *     unset numeric became `undefined`.
 *  2. The boolean transform was case-sensitive — NEO4J_ENCRYPTED=TRUE → false.
 * Plus the regression trap: restoring a default for `name`
 * would send `database: 'neo4j'` on every session, which Memgraph rejects →
 * boot loop. `name` must stay undefined when NEO4J_DATABASE is unset.
 */
describe('databaseConfig factory', () => {
  const TOUCHED = [
    'NEO4J_URI',
    'NEO4J_USERNAME',
    'NEO4J_PASSWORD',
    'NEO4J_DATABASE',
    'NEO4J_MAX_POOL_SIZE',
    'NEO4J_ENCRYPTED',
    'NEO4J_TRUST_CERT',
    'NEO4J_ENABLE_METRICS',
    'NEO4J_ENABLE_LOGGING',
    'NODE_ENV',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of TOUCHED) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.restoreAllMocks();
  });

  it('unset boolean env vars keep the class defaults (true for encrypted/metrics/logging)', () => {
    const config = databaseConfig();
    expect(config.encrypted).toBe(true);
    expect(config.enableMetrics).toBe(true);
    expect(config.enableLogging).toBe(true);
    expect(config.trust).toBe(false);
    expect(config.enableDebug).toBe(false);
  });

  it('boolean parsing is case-insensitive and explicit false wins', () => {
    process.env.NEO4J_ENCRYPTED = 'TRUE';
    process.env.NEO4J_ENABLE_METRICS = 'FALSE';
    process.env.NEO4J_TRUST_CERT = 'true';
    const config = databaseConfig();
    expect(config.encrypted).toBe(true);
    expect(config.enableMetrics).toBe(false);
    expect(config.trust).toBe(true);
  });

  it('unset numeric env vars keep the class defaults (the undefined-wipe regression)', () => {
    const config = databaseConfig();
    expect(config.maxConnectionPoolSize).toBe(50);
    expect(config.connectionAcquisitionTimeout).toBe(30000);
    expect(config.healthCheckInterval).toBe(60000);
  });

  it('unset NEO4J_DATABASE leaves name undefined (Memgraph boot-loop regression)', () => {
    // A restored 'neo4j' default would make every session pass
    // database:'neo4j', which Memgraph rejects with an authorization error.
    expect(databaseConfig().name).toBeUndefined();
    process.env.NEO4J_DATABASE = 'memgraph';
    expect(databaseConfig().name).toBe('memgraph');
  });

  it('non-numeric numeric env vars fail validation at boot', () => {
    process.env.NEO4J_MAX_POOL_SIZE = 'abc';
    expect(() => databaseConfig()).toThrow(/Database configuration validation failed/);
  });

  it('production + unencrypted warns loudly (never throws — in-network plain bolt is supported)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.NODE_ENV = 'production';
    process.env.NEO4J_ENCRYPTED = 'false';
    expect(() => databaseConfig()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NEO4J_ENCRYPTED is off in production'));

    warn.mockClear();
    process.env.NEO4J_ENCRYPTED = 'true';
    databaseConfig();
    expect(warn).not.toHaveBeenCalled();
  });
});
