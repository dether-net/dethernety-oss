// The harness's routing, without a database: an external test database named by MEMGRAPH_TEST_URI / NEO4J_TEST_URI
// is opened through the guard in @dethernety/dt-module/test-database, and no container starts; with neither set, a
// container starts.

import { afterEach, describe, expect, it, vi } from 'vitest';

const opened = vi.fn();
const containerStarts = vi.fn();

vi.mock('@dethernety/dt-module/test-database', async (importActual) => ({
  ...(await importActual<typeof import('@dethernety/dt-module/test-database')>()),
  openExternalTestDatabase: async (engine: string, uri: string) => {
    opened(engine, uri);
    return { close: async () => undefined };
  },
}));

vi.mock('testcontainers', () => ({
  Wait: { forListeningPorts: () => ({}), forLogMessage: () => ({}) },
  GenericContainer: class {
    constructor(image: string) {
      containerStarts(image);
      throw new Error('a container was started');
    }
  },
}));

const VARIABLES = ['DT_TEST_ENGINE', 'MEMGRAPH_TEST_URI', 'NEO4J_TEST_URI'];
const saved = { ...process.env };

async function harness(env: Record<string, string>) {
  for (const name of VARIABLES) delete process.env[name];
  Object.assign(process.env, env);
  vi.resetModules();
  return import('./memgraph-container');
}

afterEach(() => {
  process.env = { ...saved };
  opened.mockClear();
  containerStarts.mockClear();
});

describe('test-database routing', () => {
  it('opens the external Memgraph through the guard and starts no container', async () => {
    const { startMemgraph } = await harness({ MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697' });
    await expect(startMemgraph()).resolves.toMatchObject({ uri: 'bolt://10.0.0.5:7697' });
    expect(opened).toHaveBeenCalledWith('memgraph', 'bolt://10.0.0.5:7697');
    expect(containerStarts).not.toHaveBeenCalled();
  });

  it('opens the external Neo4j on the Neo4j leg and starts no container', async () => {
    const { startMemgraph } = await harness({ DT_TEST_ENGINE: 'neo4j', NEO4J_TEST_URI: 'bolt://10.0.0.5:7698' });
    await expect(startMemgraph()).resolves.toMatchObject({ uri: 'bolt://10.0.0.5:7698' });
    expect(opened).toHaveBeenCalledWith('neo4j', 'bolt://10.0.0.5:7698');
    expect(containerStarts).not.toHaveBeenCalled();
  });

  it('refuses a Neo4j-leg run that names only a Memgraph, instead of starting a container', async () => {
    const { startMemgraph } = await harness({ DT_TEST_ENGINE: 'neo4j', MEMGRAPH_TEST_URI: 'bolt://10.0.0.5:7697' });
    await expect(startMemgraph()).rejects.toThrow(/NEO4J_TEST_URI is not/);
    expect(opened).not.toHaveBeenCalled();
    expect(containerStarts).not.toHaveBeenCalled();
  });

  it('starts a container when no external database is named', async () => {
    const { startMemgraph } = await harness({});
    await expect(startMemgraph()).rejects.toThrow(/a container was started/);
    expect(containerStarts).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });
});
