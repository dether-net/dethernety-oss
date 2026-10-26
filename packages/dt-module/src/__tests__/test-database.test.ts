/**
 * The external test database: which targets are refused before anything runs, how the server is identified, and
 * what the reset drops on each engine and in which order. The driver is a fake that answers listings from fixed rows
 * and records every statement with the database it ran on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import * as publicSurface from '../test-database';
import {
  assertTestTarget,
  checkExternalTestUri,
  checkSingleTestWorker,
  DELETE_BATCH,
  externalContainerStandIn,
  externalTestUri,
  isExternalTestRun,
  MEMGRAPH_VECTOR_INDEXES,
  memgraphDropConstraint,
  memgraphDropIndex,
  NEO4J_CONSTRAINTS,
  NEO4J_INDEXES,
  openExternalTestDatabase,
  resetTestDatabase,
  type TestDriver,
} from '../test-database-internal';

type Row = Record<string, unknown>;
const record = (row: Row) => ({ keys: Object.keys(row), get: (key: string) => row[key] });
/** A count as the driver returns it: an Integer, not a number. */
const int = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

const LOOKUPS: Row[] = [
  { name: 'l1', type: 'LOOKUP', owningConstraint: null },
  { name: 'l2', type: 'LOOKUP', owningConstraint: null },
];

interface Fake {
  agent?: string;
  defaultDatabase?: unknown[] | Error;
  /**
   * Listings by statement prefix (the first matching prefix wins), answered until the first delete batch runs, and
   * `after` from then on. A listing not given is empty, except: 5 nodes before the delete and none after, and on Neo4j
   * the two token lookup indexes a fresh database has.
   */
  before?: Record<string, Row[]>;
  after?: Record<string, Row[]>;
  failFirst?: number;
  /** The error every connection attempt fails with, as the driver throws it. */
  connectError?: Error & { code?: string };
}

function fakeDriver(fake: Fake = {}) {
  const ran: { cypher: string; database?: string }[] = [];
  let deleted = false;
  let failures = fake.failFirst ?? 0;
  const listing = (cypher: string): Row[] => {
    const source = deleted ? (fake.after ?? {}) : (fake.before ?? {});
    for (const [prefix, rows] of Object.entries(source)) if (cypher.startsWith(prefix)) return rows;
    if (cypher.startsWith('MATCH (n) RETURN count(n)')) return [{ c: int(deleted ? 0 : 5) }];
    if (cypher === NEO4J_INDEXES) return LOOKUPS;
    return [];
  };
  const driver = {
    closed: false,
    session: (config?: { database?: string }) => ({
      run: async (cypher: string) => {
        if (cypher === 'RETURN 1 AS ok' && fake.connectError) throw fake.connectError;
        if (cypher === 'RETURN 1 AS ok' && failures > 0) {
          failures--;
          throw new Error('connection refused');
        }
        ran.push({ cypher, database: config?.database });
        if (cypher.startsWith('SHOW DEFAULT DATABASE')) {
          if (fake.defaultDatabase instanceof Error) throw fake.defaultDatabase;
          return { records: (fake.defaultDatabase ?? ['memgraph']).map((name) => record({ name })) };
        }
        if (cypher === DELETE_BATCH) {
          const count = deleted ? 0 : 5;
          deleted = true;
          return { records: [record({ deleted: int(count) })] };
        }
        return { records: listing(cypher).map(record) };
      },
      close: async () => undefined,
      // Every statement runs auto-commit: a transaction function or an explicit transaction is a defect.
      executeWrite: () => {
        throw new Error('the reset must run auto-commit');
      },
      beginTransaction: () => {
        throw new Error('the reset must run auto-commit');
      },
    }),
    getServerInfo: async () => ({ agent: fake.agent ?? 'dt-test-memgraph' }),
    close: async () => {
      driver.closed = true;
    },
  };
  const statements = () => ran.map((r) => r.cypher);
  const mutated = () => statements().some((s) => s.startsWith('DROP') || s === DELETE_BATCH);
  return { driver: driver as TestDriver & { closed: boolean }, ran, statements, mutated };
}

const WIPE = { DT_TEST_EXTERNAL_WIPE: 'bolt://10.0.0.5:7697, bolt://10.0.0.5:7698' };

describe('the public subpath', () => {
  it('exports only what a harness needs: the reset is reachable through the guard alone', () => {
    expect(Object.keys(publicSurface).sort()).toEqual(
      ['externalContainerStandIn', 'externalTestUri', 'isExternalTestRun', 'openExternalTestDatabase'],
    );
  });
});

describe('externalTestUri', () => {
  it('reads each engine its own variable, and none means a container run', () => {
    const both = { MEMGRAPH_TEST_URI: 'bolt://h:7697', NEO4J_TEST_URI: 'bolt://h:7698' };
    expect(externalTestUri('memgraph', both)).toBe('bolt://h:7697');
    expect(externalTestUri('neo4j', both)).toBe('bolt://h:7698');
    expect(externalTestUri('memgraph', {})).toBeUndefined();
    expect(isExternalTestRun({})).toBe(false);
    expect(isExternalTestRun({ NEO4J_TEST_URI: 'bolt://h:7698' })).toBe(true);
  });

  it('refuses an external run that names no database for this engine, instead of starting a container', () => {
    expect(() => externalTestUri('neo4j', { MEMGRAPH_TEST_URI: 'bolt://h:7697' })).toThrow(/NEO4J_TEST_URI is not/);
    expect(() => externalTestUri('memgraph', { NEO4J_TEST_URI: 'bolt://h:7698' })).toThrow(/MEMGRAPH_TEST_URI is not/);
  });
});

/** The message checkExternalTestUri refuses `uri` with, the URI listed so only its form is checked. */
function refusal(uri: string): string {
  try {
    checkExternalTestUri(uri, { DT_TEST_EXTERNAL_WIPE: uri });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`checkExternalTestUri accepted ${uri}`);
}

describe('checkExternalTestUri', () => {
  it('accepts a listed bolt URI off the deployment port', () => {
    expect(() => checkExternalTestUri('bolt://10.0.0.5:7697', WIPE)).not.toThrow();
    expect(() => checkExternalTestUri('bolt://10.0.0.5:7698', WIPE)).not.toThrow();
  });

  it('refuses port 7687, even when listed', () => {
    expect(() =>
      checkExternalTestUri('bolt://127.0.0.1:7687', { DT_TEST_EXTERNAL_WIPE: 'bolt://127.0.0.1:7687' }),
    ).toThrow(/port 7687 is a deployment's database port/);
  });

  it('refuses a URI missing from the wipe list, or no list at all', () => {
    expect(() => checkExternalTestUri('bolt://10.0.0.6:7697', WIPE)).toThrow(/DT_TEST_EXTERNAL_WIPE/);
    expect(() => checkExternalTestUri('bolt://10.0.0.5:7697', {})).toThrow(/DT_TEST_EXTERNAL_WIPE/);
    // Exact entries only: a prefix of a listed URI is not listed.
    expect(() => checkExternalTestUri('bolt://10.0.0.5:769', WIPE)).toThrow(/DT_TEST_EXTERNAL_WIPE/);
  });

  it('refuses anything but a plain bolt://host:port, the deployment port written another way included', () => {
    for (const uri of [
      'neo4j://10.0.0.5:7697',
      'bolt://10.0.0.5',
      'bolt://10.0.0.5:7697/x',
      'bolt://10.0.0.5:07687',
      'bolt://10.0.0.5:0',
      'bolt://10.0.0.5:99999',
    ]) {
      expect(() => checkExternalTestUri(uri, { DT_TEST_EXTERNAL_WIPE: uri })).toThrow(/bolt:\/\/host:port/);
    }
  });

  it('refuses a URI carrying credentials, and does not print them', () => {
    for (const uri of [
      'bolt://dethernety:s3cret@10.0.0.5:7697',
      'bolt://u:pa/s3cret@10.0.0.5:7697',
      'bolt://u:p@s3cret@10.0.0.5:7697',
      'bolt://10.0.0.5:7697?password=s3cret',
    ]) {
      expect(() => checkExternalTestUri(uri, { DT_TEST_EXTERNAL_WIPE: uri })).toThrow(/bolt:\/\/host:port/);
      expect(() => checkExternalTestUri(uri, { DT_TEST_EXTERNAL_WIPE: uri })).not.toThrow(/s3cret/);
    }
  });

  it('masks the user info, up to the last @, and the query of a refused URI, and prints a value with a line break as ***', () => {
    for (const [uri, printed] of [
      ['bolt://u:p@h:1?x=1', 'bolt://***@h:1?***'],
      ['neo4j://a@b@h', 'neo4j://***@h'],
      ['neo4j://a@h:1', 'neo4j://***@h:1'],
      ['bolt://h:1?x=1', 'bolt://h:1?***'],
      ['bolt://h:1/x', 'bolt://h:1/x'],
      ['a@b//c', 'a@b//c'],
      ['bolt://u?x@h', 'bolt://***@h'],
      ['//@', '//***@'],
      ['bolt://h\n?tok=x@y', '***'],
      ['bolt://h:1\r', '***'],
    ]) {
      expect(refusal(uri)).toBe(`an external test database must be a bolt://host:port URI, got "${printed}"`);
    }
  });

  it('masks a long run of // or ? in linear time', () => {
    for (const [uri, printed] of [
      ['//'.repeat(50_000), '//'.repeat(50_000)],
      ['?'.repeat(50_000), '?***'],
      [`${'?'.repeat(100_000)}\n`, '***'],
    ]) {
      const started = performance.now();
      expect(refusal(uri)).toBe(`an external test database must be a bolt://host:port URI, got "${printed}"`);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});

describe('checkSingleTestWorker', () => {
  it('accepts one worker, or no runner at all', () => {
    expect(() => checkSingleTestWorker({})).not.toThrow();
    expect(() => checkSingleTestWorker({ JEST_WORKER_ID: '1' })).not.toThrow();
    expect(() => checkSingleTestWorker({ VITEST_POOL_ID: '1' })).not.toThrow();
  });

  it('refuses a second jest or vitest worker', () => {
    expect(() => checkSingleTestWorker({ JEST_WORKER_ID: '2' })).toThrow(/--runInBand/);
    expect(() => checkSingleTestWorker({ VITEST_POOL_ID: '3' })).toThrow(/--no-file-parallelism/);
  });
});

describe('assertTestTarget', () => {
  it('accepts a Memgraph that reports the test server name', async () => {
    await expect(assertTestTarget(fakeDriver().driver, 'memgraph')).resolves.toBeUndefined();
  });

  it('refuses a Memgraph with another server name, a longer one containing it included', async () => {
    for (const agent of ['Neo4j/v5.11.0 compatible graph database server - Memgraph', 'x-dt-test-memgraph', '']) {
      const { driver } = fakeDriver({ agent });
      await expect(assertTestTarget(driver, 'memgraph')).rejects.toThrow(/--bolt-server-name-for-init=dt-test-memgraph/);
    }
  });

  it('accepts a Neo4j whose default database is memgraph, read on system', async () => {
    const { driver, ran } = fakeDriver();
    await assertTestTarget(driver, 'neo4j');
    expect(ran).toEqual([{ cypher: 'SHOW DEFAULT DATABASE YIELD name', database: 'system' }]);
  });

  it('refuses a Neo4j whose default database is neo4j, a deployment', async () => {
    const { driver } = fakeDriver({ defaultDatabase: ['neo4j'] });
    await expect(assertTestTarget(driver, 'neo4j')).rejects.toThrow(/default database is \["neo4j"\]/);
  });

  it('refuses a Neo4j whose default database cannot be read', async () => {
    const { driver } = fakeDriver({ defaultDatabase: new Error('Unsupported administration command') });
    await expect(assertTestTarget(driver, 'neo4j')).rejects.toThrow(
      /could not be read \(Unsupported administration command\)/,
    );
  });
});

describe('the Memgraph drop statements', () => {
  const index = (kind: string, label: string, property: unknown) =>
    record({ 'index type': kind, label, property, count: 1 });

  it('drops each index kind with its own form, composite included', () => {
    expect(memgraphDropIndex(index('label', 'A', null))).toBe('DROP INDEX ON :`A`');
    expect(memgraphDropIndex(index('label+property', 'A', 'id'))).toBe('DROP INDEX ON :`A`(`id`)');
    expect(memgraphDropIndex(index('label+property', 'A', ['m', 'r']))).toBe('DROP INDEX ON :`A`(`m`, `r`)');
    expect(memgraphDropIndex(index('edge-type', 'T', null))).toBe('DROP EDGE INDEX ON :`T`');
    expect(memgraphDropIndex(index('edge-type+property', 'T', 'k'))).toBe('DROP EDGE INDEX ON :`T`(`k`)');
  });

  it('refuses a name outside what the suites create, before building a statement', () => {
    expect(() => memgraphDropIndex(index('label', 'a`b', null))).toThrow(/unexpected name "a`b"/);
    expect(() => memgraphDropIndex(index('label+property', 'A', 'x y'))).toThrow(/unexpected name "x y"/);
  });

  it('refuses an index kind the platform never creates, and a listing without the expected column', () => {
    expect(() => memgraphDropIndex(index('text', 'A', 'x'))).toThrow(/unexpected index kind "text"/);
    expect(() => memgraphDropIndex(record({ kind: 'label', label: 'A' }))).toThrow(/no "index type" column/);
  });

  it('drops unique (composite) and exists constraints, and refuses any other kind', () => {
    expect(memgraphDropConstraint(record({ 'constraint type': 'unique', label: 'N', properties: ['m', 'r'] }))).toBe(
      'DROP CONSTRAINT ON (n:`N`) ASSERT n.`m`, n.`r` IS UNIQUE',
    );
    expect(memgraphDropConstraint(record({ 'constraint type': 'exists', label: 'N', properties: 'id' }))).toBe(
      'DROP CONSTRAINT ON (n:`N`) ASSERT EXISTS (n.`id`)',
    );
    expect(() =>
      memgraphDropConstraint(record({ 'constraint type': 'data_type', label: 'N', properties: 'id' })),
    ).toThrow(/unexpected constraint kind "data_type"/);
  });
});

describe('resetTestDatabase on Memgraph', () => {
  const before = {
    'SHOW INDEX INFO': [{ 'index type': 'label+property', label: 'Control', property: 'id', count: 3 }],
    'SHOW CONSTRAINT INFO': [{ 'constraint type': 'unique', label: 'Module', properties: ['name'] }],
    'CALL vector_search': [{ index_name: 'mitre_attack_embeddings' }],
  };

  it('lists everything before the first drop, then drops vector indexes, indexes, constraints, every node, and checks nothing is left', async () => {
    const { driver, statements } = fakeDriver({ before });
    await resetTestDatabase(driver, 'memgraph');
    const s = statements();
    const firstDrop = s.findIndex((x) => x.startsWith('DROP'));
    expect(s.slice(0, firstDrop)).toEqual(['SHOW TRIGGERS', MEMGRAPH_VECTOR_INDEXES, 'SHOW INDEX INFO', 'SHOW CONSTRAINT INFO']);
    expect(s.slice(firstDrop, firstDrop + 3)).toEqual([
      'DROP VECTOR INDEX `mitre_attack_embeddings`',
      'DROP INDEX ON :`Control`(`id`)',
      'DROP CONSTRAINT ON (n:`Module`) ASSERT n.`name` IS UNIQUE',
    ]);
    expect(s.indexOf(DELETE_BATCH)).toBe(firstDrop + 3);
    expect(s.lastIndexOf('MATCH (n) RETURN count(n) AS c')).toBeGreaterThan(s.indexOf(DELETE_BATCH));
  });

  it('refuses a server that is not a test Memgraph, running nothing', async () => {
    const { driver, statements } = fakeDriver({ before, agent: 'Memgraph' });
    await expect(resetTestDatabase(driver, 'memgraph')).rejects.toThrow(/refusing the target/);
    expect(statements()).toEqual([]);
  });

  it('refuses a target with triggers, before dropping anything', async () => {
    const { driver, mutated } = fakeDriver({ before: { ...before, 'SHOW TRIGGERS': [{ 'trigger name': 't' }] } });
    await expect(resetTestDatabase(driver, 'memgraph')).rejects.toThrow(/has triggers/);
    expect(mutated()).toBe(false);
  });

  it('refuses an unknown index or constraint kind, or an unexpected name, before dropping anything', async () => {
    for (const extra of [
      { 'SHOW INDEX INFO': [{ 'index type': 'point', label: 'P', property: 'loc', count: 1 }] },
      { 'SHOW CONSTRAINT INFO': [{ 'constraint type': 'data_type', label: 'P', properties: ['x'] }] },
      { 'CALL vector_search': [{ index_name: 'bad name' }] },
    ]) {
      const { driver, mutated } = fakeDriver({ before: { ...before, ...extra } });
      await expect(resetTestDatabase(driver, 'memgraph')).rejects.toThrow(/refusing to reset: unexpected/);
      expect(mutated()).toBe(false);
    }
  });

  it('drops a vector index listed by SHOW INDEX INFO only through DROP VECTOR INDEX', async () => {
    const { driver, statements } = fakeDriver({
      before: { ...before, 'SHOW INDEX INFO': [{ 'index type': 'label+property_vector', label: 'M', property: 'e', count: 1 }] },
    });
    await resetTestDatabase(driver, 'memgraph');
    expect(statements().filter((s) => s.startsWith('DROP INDEX'))).toEqual([]);
  });

  it('throws when a vector index is left after the reset', async () => {
    const { driver } = fakeDriver({ before, after: { 'CALL vector_search': [{ index_name: 'v' }] } });
    await expect(resetTestDatabase(driver, 'memgraph')).rejects.toThrow(/the reset left vector indexes \["v"\]/);
  });

  it('throws when a trigger or a constraint is left after the reset', async () => {
    const trigger = fakeDriver({ before, after: { 'SHOW TRIGGERS': [{ 'trigger name': 't' }] } });
    await expect(resetTestDatabase(trigger.driver, 'memgraph')).rejects.toThrow(/the reset left 1 trigger\b/);
    const constraint = fakeDriver({
      before,
      after: { 'SHOW CONSTRAINT INFO': [{ 'constraint type': 'unique', label: 'M', properties: ['x'] }] },
    });
    await expect(resetTestDatabase(constraint.driver, 'memgraph')).rejects.toThrow(/the reset left 1 constraint\b/);
  });
});

describe('resetTestDatabase on Neo4j', () => {
  const before = {
    [NEO4J_CONSTRAINTS]: [{ name: 'module_name', type: 'UNIQUENESS' }],
    [NEO4J_INDEXES]: [
      ...LOOKUPS,
      { name: 'control_id', type: 'RANGE', owningConstraint: null },
      { name: 'module_name', type: 'RANGE', owningConstraint: 'module_name' },
    ],
  };

  it('lists and checks before the first drop, drops constraints then their free indexes, keeps the token lookups, deletes every node, on the test database', async () => {
    const { driver, ran, statements } = fakeDriver({ before });
    await resetTestDatabase(driver, 'neo4j');
    const s = statements();
    const firstDrop = s.findIndex((x) => x.startsWith('DROP'));
    expect(s.slice(0, firstDrop)).toEqual(['SHOW DEFAULT DATABASE YIELD name', NEO4J_CONSTRAINTS, NEO4J_INDEXES]);
    // The index the constraint owns goes with it; the token lookups stay.
    expect(s.filter((x) => x.startsWith('DROP'))).toEqual(['DROP CONSTRAINT `module_name`', 'DROP INDEX `control_id`']);
    expect(s.indexOf(DELETE_BATCH)).toBeGreaterThan(s.indexOf('DROP INDEX `control_id`'));
    expect(new Set(ran.filter((r) => !r.cypher.startsWith('SHOW DEFAULT')).map((r) => r.database))).toEqual(new Set(['memgraph']));
  });

  it('refuses a server that is not a test Neo4j, before any listing', async () => {
    const { driver, statements } = fakeDriver({ before, defaultDatabase: ['neo4j'] });
    await expect(resetTestDatabase(driver, 'neo4j')).rejects.toThrow(/refusing the target/);
    expect(statements()).toEqual(['SHOW DEFAULT DATABASE YIELD name']);
  });

  it('refuses a constraint or index type the suites never create, before dropping anything', async () => {
    for (const extra of [
      { [NEO4J_CONSTRAINTS]: [{ name: 'k', type: 'NODE_KEY' }] },
      { [NEO4J_INDEXES]: [...LOOKUPS, { name: 'ft', type: 'FULLTEXT', owningConstraint: null }] },
    ]) {
      const { driver, mutated } = fakeDriver({ before: { ...before, ...extra } });
      await expect(resetTestDatabase(driver, 'neo4j')).rejects.toThrow(/refusing to reset: unexpected (constraint|index) type/);
      expect(mutated()).toBe(false);
    }
  });

  it('throws when an index other than the token lookups is left', async () => {
    const { driver } = fakeDriver({
      before,
      after: { [NEO4J_INDEXES]: [...LOOKUPS, { name: 'x', type: 'RANGE', owningConstraint: null }] },
    });
    await expect(resetTestDatabase(driver, 'neo4j')).rejects.toThrow(/the reset left 1 index\b/);
  });

  it('throws when a token lookup index is missing', async () => {
    const { driver } = fakeDriver({ before, after: { [NEO4J_INDEXES]: [LOOKUPS[0]] } });
    await expect(resetTestDatabase(driver, 'neo4j')).rejects.toThrow(/1 token lookup index, where a fresh database has 2/);
  });
});

describe('openExternalTestDatabase', () => {
  const env = WIPE;

  it('checks the URI before it makes a driver, and names the variable', async () => {
    const makeDriver = vi.fn();
    await expect(openExternalTestDatabase('memgraph', 'bolt://10.0.0.5:7687', makeDriver, { env })).rejects.toThrow(
      /^MEMGRAPH_TEST_URI: refusing bolt:\/\/10\.0\.0\.5:7687: port 7687/,
    );
    expect(makeDriver).not.toHaveBeenCalled();
  });

  it('waits for the database, identifies it, resets it and returns the driver', async () => {
    const { driver, statements } = fakeDriver({ failFirst: 2 });
    const opened = await openExternalTestDatabase('neo4j', 'bolt://10.0.0.5:7698', () => driver, { env, delayMs: 0 });
    expect(opened).toBe(driver);
    const s = statements();
    expect(s.indexOf('SHOW DEFAULT DATABASE YIELD name')).toBeGreaterThan(s.indexOf('RETURN 1 AS ok'));
    expect(s.indexOf(DELETE_BATCH)).toBeGreaterThan(s.indexOf('SHOW DEFAULT DATABASE YIELD name'));
  });

  it('closes the driver and changes nothing when the target is not a test database', async () => {
    const { driver, mutated } = fakeDriver({ agent: 'Memgraph' });
    await expect(
      openExternalTestDatabase('memgraph', 'bolt://10.0.0.5:7697', () => driver, { env, delayMs: 0 }),
    ).rejects.toThrow(/^MEMGRAPH_TEST_URI: refusing the target/);
    expect(driver.closed).toBe(true);
    expect(mutated()).toBe(false);
  });

  it('refuses a target that rejects the login at once, on either engine, instead of waiting for it', async () => {
    for (const code of ['Neo.ClientError.Security.Unauthorized', 'Memgraph.ClientError.Security.Unauthenticated']) {
      const connectError = Object.assign(new Error('The client is unauthorized'), { code });
      const { driver } = fakeDriver({ connectError });
      await expect(
        openExternalTestDatabase('memgraph', 'bolt://10.0.0.5:7697', () => driver, { env, attempts: 60, delayMs: 1000 }),
      ).rejects.toThrow(/refused the login/);
      expect(driver.closed).toBe(true);
    }
  });

  it('refuses a Neo4j without the test database at once, instead of waiting for it', async () => {
    const connectError = Object.assign(new Error('Database does not exist. Database name: memgraph.'), {
      code: 'Neo.ClientError.Database.DatabaseNotFound',
    });
    const { driver } = fakeDriver({ connectError });
    await expect(
      openExternalTestDatabase('neo4j', 'bolt://10.0.0.5:7698', () => driver, { env, attempts: 60, delayMs: 1000 }),
    ).rejects.toThrow(/has no database "memgraph"/);
  });

  it('refuses a second test worker before it makes a driver', async () => {
    const makeDriver = vi.fn();
    await expect(
      openExternalTestDatabase('memgraph', 'bolt://10.0.0.5:7697', makeDriver, { env: { ...env, JEST_WORKER_ID: '2' } }),
    ).rejects.toThrow(/--runInBand/);
    expect(makeDriver).not.toHaveBeenCalled();
  });

  it('gives up when the database never answers, and closes the driver', async () => {
    const { driver } = fakeDriver({ failFirst: 10 });
    await expect(
      openExternalTestDatabase('memgraph', 'bolt://10.0.0.5:7697', () => driver, { env, attempts: 3, delayMs: 0 }),
    ).rejects.toThrow(/never answered \(connection refused\)/);
    expect(driver.closed).toBe(true);
  });
});

describe('externalContainerStandIn', () => {
  it('throws on any use, naming it, and can still be printed', () => {
    const container = externalContainerStandIn<{ restart(): Promise<void> }>();
    expect(() => container.restart()).toThrow(/container\.restart is not available against an external test database/);
    expect(() => JSON.stringify({ container })).not.toThrow();
    expect(() => String(Object.prototype.toString.call(container))).not.toThrow();
    // A failed assertion prints the value it compared.
    expect(() => expect({ container }).toEqual({ container: 1 })).toThrow(/expect/);
  });
});

describe('the subpath stays loadable by any test runner', () => {
  it('imports nothing: the guard file has no import at all, the subpath only the guard', () => {
    const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');
    const anyImport = [/^\s*import\s(?!type\b)/m, /\brequire\(/, /\bimport\(/, /^\s*export\s[^;]*\sfrom\s/m];
    const guard = read('test-database-internal.ts');
    for (const pattern of anyImport) expect(guard).not.toMatch(pattern);
    const subpath = read('test-database.ts');
    const sources = [...subpath.matchAll(/\sfrom\s+'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(sources)).toEqual(new Set(['./test-database-internal']));
    expect(subpath).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
