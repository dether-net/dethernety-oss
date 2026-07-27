/**
 * Bootstrap DDL against a real Neo4j 5 (community) — the only automated
 * proof of the headline fix. Before this fix the bootstrap issued
 * Memgraph-legacy DDL that Neo4j rejects, fail-open: ZERO constraints and
 * ZERO indexes installed, so id lookups ran label scans and duplicate-id
 * nodes were possible. This suite asserts:
 *  - the probe detects neo4j + community edition,
 *  - the uniqueness constraints actually install (SHOW CONSTRAINTS),
 *  - existence constraints are cleanly skipped (Enterprise-only),
 *  - plain indexes install for non-covered pairs, while constraint-covered
 *    pairs get NO separate plain index (their backing index is
 *    constraint-owned — a plain one would have blocked the constraint),
 *  - a second run is idempotent (IF NOT EXISTS).
 */
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/database/database.service';
import { EnsureConstraintsService } from '../../src/bootstrap/ensure-constraints.service';
import { EnsureIndexesService } from '../../src/bootstrap/ensure-indexes.service';
import { startNeo4j, Neo4jHandle } from './neo4j-container';

jest.setTimeout(240_000);

function makeConfigService(uri: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database') {
        return {
          uri,
          username: '',
          password: '',
          name: undefined,
          maxConnectionPoolSize: 10,
          connectionAcquisitionTimeout: 30000,
          connectionTimeout: 5000,
          maxConnectionLifetime: 3600000,
          maxTransactionRetryTime: 30000,
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

async function runRead(handle: Neo4jHandle, cypher: string): Promise<any[]> {
  const session = handle.driver.session();
  try {
    const result = await session.run(cypher);
    return result.records;
  } finally {
    await session.close();
  }
}

describe('bootstrap DDL on Neo4j 5 (e2e)', () => {
  let handle: Neo4jHandle;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    handle = await startNeo4j();
    databaseService = new DatabaseService(makeConfigService(handle.uri));
    await databaseService.ensureInitialized();
  });

  afterAll(async () => {
    await databaseService?.onModuleDestroy();
    await handle?.stop();
  });

  it('probes the engine as neo4j, community edition', async () => {
    const info = await databaseService.getEngineInfo();
    expect(info.engine).toBe('neo4j');
    expect(info.edition).toBe('community');
  });

  it('installs the uniqueness constraints and skips Enterprise-only existence constraints', async () => {
    const constraints = new EnsureConstraintsService(databaseService);
    await constraints.onApplicationBootstrap();

    expect(constraints.isHealthy()).toBe(true);
    expect(constraints.getSkippedLabels()).toEqual([]);

    const rows = await runRead(handle, 'SHOW CONSTRAINTS');
    const parsed = rows.map((r) => r.toObject() as any);

    const uniqueFor = (label: string, property: string) =>
      parsed.some(
        (c) =>
          String(c.type).includes('UNIQUENESS') &&
          (c.labelsOrTypes ?? []).includes(label) &&
          (c.properties ?? []).includes(property),
      );

    for (const label of [
      'AnalysisClass',
      'ComponentClass',
      'ControlClass',
      'DataFlowClass',
      'DataClass',
      'SecurityBoundaryClass',
      'IssueClass',
      'Analysis',
    ]) {
      expect(uniqueFor(label, 'id')).toBe(true);
    }
    expect(uniqueFor('Module', 'name')).toBe(true);

    // Community: NO property-existence constraints (proactively skipped).
    expect(parsed.filter((c) => String(c.type).includes('EXISTENCE'))).toHaveLength(0);
  });

  it('installs plain indexes for non-covered pairs only; covered pairs have constraint-owned indexes', async () => {
    const indexes = new EnsureIndexesService(databaseService);
    await indexes.onApplicationBootstrap();

    const rows = await runRead(handle, 'SHOW INDEXES');
    const parsed = rows.map((r) => r.toObject() as any);

    const plainIndexFor = (label: string, property: string) =>
      parsed.some(
        (idx) =>
          idx.owningConstraint == null &&
          (idx.labelsOrTypes ?? []).includes(label) &&
          (idx.properties ?? []).includes(property),
      );
    const constraintOwnedIndexFor = (label: string, property: string) =>
      parsed.some(
        (idx) =>
          idx.owningConstraint != null &&
          (idx.labelsOrTypes ?? []).includes(label) &&
          (idx.properties ?? []).includes(property),
      );

    // Non-covered pairs get plain indexes.
    expect(plainIndexFor('Control', 'id')).toBe(true);
    expect(plainIndexFor('ComponentClass', 'name')).toBe(true);
    expect(plainIndexFor('Module', 'id')).toBe(true);
    expect(plainIndexFor('Exposure', 'name')).toBe(true);

    // Covered pairs: index exists but is constraint-owned; no plain twin
    // (a plain index there would have BLOCKED the constraint creation).
    for (const [label, property] of [
      ['ControlClass', 'id'],
      ['Analysis', 'id'],
      ['Module', 'name'],
    ] as const) {
      expect(plainIndexFor(label, property)).toBe(false);
      expect(constraintOwnedIndexFor(label, property)).toBe(true);
    }
  });

  it('re-running both hooks is idempotent (IF NOT EXISTS) and stays healthy', async () => {
    const constraints = new EnsureConstraintsService(databaseService);
    const indexes = new EnsureIndexesService(databaseService);
    await constraints.onApplicationBootstrap();
    await indexes.onApplicationBootstrap();

    expect(constraints.isHealthy()).toBe(true);

    // Still exactly one uniqueness constraint per covered pair.
    const rows = await runRead(handle, 'SHOW CONSTRAINTS');
    const controlClassUnique = rows
      .map((r) => r.toObject() as any)
      .filter(
        (c) =>
          String(c.type).includes('UNIQUENESS') &&
          (c.labelsOrTypes ?? []).includes('ControlClass'),
      );
    expect(controlClassUnique).toHaveLength(1);
  });
});
