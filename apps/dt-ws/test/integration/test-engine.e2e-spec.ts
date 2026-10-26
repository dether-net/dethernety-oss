// The engine switch of the integration harness, without a database: which engine DT_TEST_ENGINE selects, what the
// Neo4j leg refuses before any container starts, how an external run is routed and what it skips, and what the
// server-failure logging writes.

import { externalRefusal, neo4jRefusal } from './memgraph-container';
import { readTestEngine, serverFailureLogging, SERVER_FAILURE_MARK } from './test-engine';

describe('DT_TEST_ENGINE', () => {
  it('selects memgraph by default and neo4j when named', () => {
    expect(readTestEngine(undefined)).toBe('memgraph');
    expect(readTestEngine('')).toBe('memgraph');
    expect(readTestEngine('memgraph')).toBe('memgraph');
    expect(readTestEngine('neo4j')).toBe('neo4j');
  });

  it.each([['Neo4j'], ['postgres'], ['memgraph ']])('refuses %j rather than run Memgraph', (value) => {
    expect(() => readTestEngine(value)).toThrow(/DT_TEST_ENGINE must be memgraph or neo4j/);
  });
});

describe('the Neo4j leg refuses what only Memgraph has', () => {
  it('accepts a plain start', () => {
    expect(neo4jRefusal({}, {})).toBeUndefined();
  });

  it.each([
    ['its own image', { image: 'memgraph/memgraph:3.13.2' }, {}, /Memgraph-only: declare it with describeMemgraphOnly/],
    ['its own flags', { command: ['--storage-snapshot-interval-sec=1'] }, {}, /Memgraph-only/],
    ['a Memgraph image', {}, { MEMGRAPH_TEST_IMAGE: 'memgraph/memgraph:3.13.2' }, /MEMGRAPH_TEST_IMAGE/],
  ])('refuses %s', (_case, options, env, message) => {
    expect(neo4jRefusal(options, env as NodeJS.ProcessEnv)).toMatch(message);
  });
});

describe('an external test database refuses what needs a container', () => {
  it('accepts a plain start', () => {
    expect(externalRefusal({}, {})).toBeUndefined();
  });

  it.each([
    ['its own image', { image: 'memgraph/memgraph:3.8.1' }, {}, /describeContainerOnly/],
    ['its own flags', { command: ['--storage-snapshot-interval-sec=1'] }, {}, /describeContainerOnly/],
    ['a Memgraph image', {}, { MEMGRAPH_TEST_IMAGE: 'memgraph/memgraph:3.13.2' }, /MEMGRAPH_TEST_IMAGE/],
  ])('refuses %s', (_case, options, env, message) => {
    expect(externalRefusal(options, env as NodeJS.ProcessEnv)).toMatch(message);
  });
});

const EXTERNAL_VARIABLES = ['DT_TEST_ENGINE', 'MEMGRAPH_TEST_URI', 'NEO4J_TEST_URI', 'MEMGRAPH_TEST_IMAGE', 'DT_TEST_EXTERNAL_WIPE'];

describe('external routing: the suites connect to the named database and start no container', () => {
  const saved = { ...process.env };
  let connectExternal: jest.Mock;
  let containerStarts: number;
  let startMemgraph: (options?: { image?: string; command?: string[] }) => Promise<{ uri: string }>;
  let startNeo4j: () => Promise<{ uri: string }>;

  function load(env: Record<string, string>) {
    for (const name of EXTERNAL_VARIABLES) delete process.env[name];
    Object.assign(process.env, env);
    containerStarts = 0;
    connectExternal = jest.fn(async (engine: string, uri: string) => ({ container: {}, driver: {}, uri: `${engine} ${uri}`, stop: async () => {} }));
    jest.isolateModules(() => {
      jest.doMock('./external-database', () => ({ connectExternal }));
      jest.doMock('./loopback-container', () => ({
        LOOPBACK_HOST: '127.0.0.1',
        LoopbackContainer: class {
          constructor() {
            containerStarts++;
            throw new Error('a container was started');
          }
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ startMemgraph } = require('./memgraph-container'));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ startNeo4j } = require('./neo4j-container'));
    });
  }

  afterEach(() => {
    process.env = { ...saved };
    jest.dontMock('./external-database');
    jest.dontMock('./loopback-container');
  });

  it('routes Memgraph to MEMGRAPH_TEST_URI and a direct Neo4j start to NEO4J_TEST_URI', async () => {
    load({ MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697', NEO4J_TEST_URI: 'bolt://10.0.0.5:7698' });
    await expect(startMemgraph()).resolves.toMatchObject({ uri: 'memgraph bolt://10.0.0.5:7697' });
    await expect(startNeo4j()).resolves.toMatchObject({ uri: 'neo4j bolt://10.0.0.5:7698' });
    expect(containerStarts).toBe(0);
  });

  it('routes the Neo4j leg to NEO4J_TEST_URI through startMemgraph', async () => {
    load({ DT_TEST_ENGINE: 'neo4j', NEO4J_TEST_URI: 'bolt://10.0.0.5:7698' });
    await expect(startMemgraph()).resolves.toMatchObject({ uri: 'neo4j bolt://10.0.0.5:7698' });
    expect(containerStarts).toBe(0);
  });

  it('refuses a direct Neo4j start in a run that names only a Memgraph, instead of starting a container', async () => {
    load({ MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697' });
    await expect(startNeo4j()).rejects.toThrow(/NEO4J_TEST_URI is not/);
    expect(containerStarts).toBe(0);
  });

  it('refuses a suite that needs its own image or flags against an external Memgraph', async () => {
    load({ MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697' });
    await expect(startMemgraph({ image: 'memgraph/memgraph:3.8.1' })).rejects.toThrow(/describeContainerOnly/);
    expect(connectExternal).not.toHaveBeenCalled();
    expect(containerStarts).toBe(0);
  });

  it('starts a container when no external database is named', async () => {
    load({});
    await expect(startMemgraph()).rejects.toThrow(/a container was started/);
    expect(containerStarts).toBe(1);
    expect(connectExternal).not.toHaveBeenCalled();
  });
});

describe('the external-run markers', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function markers(env: Record<string, string>) {
    for (const name of EXTERNAL_VARIABLES) delete process.env[name];
    Object.assign(process.env, env);
    let loaded: typeof import('./test-engine') | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('./test-engine');
    });
    return loaded!;
  }

  it('runs every suite in a container run', () => {
    const m = markers({});
    expect(m.EXTERNAL_RUN_WITHOUT_NEO4J).toBe(false);
    expect(m.describeContainerOnly).toBe(describe);
    expect(m.describeWithNeo4j).toBe(describe);
  });

  it('skips container-only suites in an external run, and Neo4j suites when it names no Neo4j', () => {
    const memgraphOnly = markers({ MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697' });
    expect(memgraphOnly.EXTERNAL_RUN_WITHOUT_NEO4J).toBe(true);
    expect(memgraphOnly.describeContainerOnly).not.toBe(describe);
    expect(memgraphOnly.describeWithNeo4j).not.toBe(describe);
    const both = markers({ MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697', NEO4J_TEST_URI: 'bolt://10.0.0.5:7698' });
    expect(both.EXTERNAL_RUN_WITHOUT_NEO4J).toBe(false);
    expect(both.describeWithNeo4j).toBe(describe);
    expect(both.describeContainerOnly).not.toBe(describe);
  });
});

describe('server-failure logging', () => {
  it('writes a server FAILURE to stderr with its code, marked, and nothing else', () => {
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { logger, level } = serverFailureLogging();
      expect(level).toBe('debug');
      logger('debug', 'Connection [1][bolt-2] S: FAILURE {"code":"Neo.ClientError.Statement.SyntaxError","message":"Invalid input"}');
      logger('debug', 'Connection [1][bolt-2] C: RUN "RETURN 1" {} {}');
      logger('info', 'Connection [1][bolt-2] S: SUCCESS {}');
      expect(write).toHaveBeenCalledTimes(1);
      const line = String(write.mock.calls[0][0]);
      expect(line.startsWith(`${SERVER_FAILURE_MARK} `)).toBe(true);
      expect(line).toContain('Neo.ClientError.Statement.SyntaxError');
    } finally {
      write.mockRestore();
    }
  });
});

describe('startMemgraph on the Neo4j leg', () => {
  const saved = { ...process.env };
  let startNeo4j: jest.Mock;
  let startMemgraph: (options?: { image?: string; command?: string[] }) => Promise<{ uri: string }>;

  beforeEach(() => {
    for (const name of EXTERNAL_VARIABLES) delete process.env[name];
    process.env.DT_TEST_ENGINE = 'neo4j';
    startNeo4j = jest.fn(async () => ({ container: {}, driver: {}, uri: 'bolt://neo4j-stub:7687', stop: async () => {} }));
    jest.isolateModules(() => {
      jest.doMock('./neo4j-container', () => ({ startNeo4j }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ startMemgraph } = require('./memgraph-container'));
    });
  });

  afterEach(() => {
    process.env = { ...saved };
    jest.dontMock('./neo4j-container');
  });

  it('starts Neo4j for a plain start', async () => {
    await expect(startMemgraph()).resolves.toMatchObject({ uri: 'bolt://neo4j-stub:7687' });
    expect(startNeo4j).toHaveBeenCalledTimes(1);
  });

  it('refuses a suite that needs its own Memgraph image, before any container starts', async () => {
    await expect(startMemgraph({ image: 'memgraph/memgraph:3.13.2' })).rejects.toThrow(/DT_TEST_ENGINE=neo4j: .*Memgraph-only/);
    expect(startNeo4j).not.toHaveBeenCalled();
  });
});
