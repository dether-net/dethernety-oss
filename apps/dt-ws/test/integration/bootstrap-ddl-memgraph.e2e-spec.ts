/**
 * Bootstrap DDL against a real Memgraph — regression proof that the
 * engine branch left the shipped Memgraph path intact: the engine probe
 * detects memgraph, both bootstrap hooks install the full constraint and
 * index sets via the legacy dialect, and a re-run is idempotent.
 */
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/database/database.service';
import { EnsureConstraintsService } from '../../src/bootstrap/ensure-constraints.service';
import { EnsureIndexesService } from '../../src/bootstrap/ensure-indexes.service';
import { startMemgraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(120_000);

function makeConfigService(uri: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database') {
        return {
          uri,
          username: '',
          password: '',
          // No `name`: the server default database (works on both engines).
          name: undefined,
          maxConnectionPoolSize: 10,
          connectionAcquisitionTimeout: 30000,
          connectionTimeout: 5000,
          maxConnectionLifetime: 3600000,
          maxTransactionRetryTime: 30000,
          // Plain-bolt test container; metrics OFF so no health-check
          // setInterval leaks into the serial Jest run.
          encrypted: false,
          trustSelfSignedCerts: false,
          enableMetrics: false,
          enableLogging: false,
          healthCheckInterval: 60000,
          enableDebug: false,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

async function runRead(handle: MemgraphHandle, cypher: string): Promise<any[]> {
  const session = handle.driver.session();
  try {
    const result = await session.run(cypher);
    return result.records;
  } finally {
    await session.close();
  }
}

describe('bootstrap DDL on Memgraph (e2e)', () => {
  let handle: MemgraphHandle;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    handle = await startMemgraph();
    databaseService = new DatabaseService(makeConfigService(handle.uri));
    await databaseService.ensureInitialized();
  });

  afterAll(async () => {
    await databaseService?.onModuleDestroy();
    await handle?.stop();
  });

  it('probes the engine as memgraph', async () => {
    const info = await databaseService.getEngineInfo();
    expect(info.engine).toBe('memgraph');
  });

  it('installs the full constraint set via the legacy dialect and reports healthy', async () => {
    const constraints = new EnsureConstraintsService(databaseService);
    await constraints.onApplicationBootstrap();

    expect(constraints.isHealthy()).toBe(true);
    expect(constraints.getSkippedLabels()).toEqual([]);

    const rows = await runRead(handle, 'SHOW CONSTRAINT INFO');
    const flat = rows.map((r) => JSON.stringify(r.toObject()));
    // Spot-check the safety net: unique + exists on a *Class label,
    // unique on Analysis(id) and Module(name).
    expect(flat.some((s) => s.includes('ControlClass') && s.includes('unique'))).toBe(true);
    expect(flat.some((s) => s.includes('ControlClass') && s.includes('exists'))).toBe(true);
    expect(flat.some((s) => s.includes('"Analysis"') && s.includes('unique'))).toBe(true);
    expect(flat.some((s) => s.includes('Module') && s.includes('name'))).toBe(true);
  });

  it('installs the full index set (constraint-covered pairs NOT filtered on Memgraph)', async () => {
    const indexes = new EnsureIndexesService(databaseService);
    await indexes.onApplicationBootstrap();

    const rows = await runRead(handle, 'SHOW INDEX INFO');
    const flat = rows.map((r) => JSON.stringify(r.toObject()));
    // Index-only pair…
    expect(flat.some((s) => s.includes('"Control"') && s.includes('"id"'))).toBe(true);
    // …AND a constraint-covered pair (Memgraph keeps both — shipped behavior).
    expect(flat.some((s) => s.includes('ControlClass') && s.includes('"id"'))).toBe(true);
    expect(flat.some((s) => s.includes('Module') && s.includes('"name"'))).toBe(true);
  });

  it('re-running both hooks is idempotent and stays healthy', async () => {
    const constraints = new EnsureConstraintsService(databaseService);
    const indexes = new EnsureIndexesService(databaseService);
    await constraints.onApplicationBootstrap();
    await indexes.onApplicationBootstrap();

    expect(constraints.isHealthy()).toBe(true);
  });
});
