// Bootstrap-sanity smoke for the testcontainers harness, on the engine DT_TEST_ENGINE names.
// Proves the helper works end-to-end (start, connect, write, read,
// clean, stop) before integration specs layer @cypher mutation
// execution on top.

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { TEST_ENGINE } from './test-engine';

describe('testcontainer harness', () => {
  let mg: MemgraphHandle;

  // 180 s: on Neo4j the container's start-up wait alone may take 120 s.
  beforeAll(async () => {
    mg = await startMemgraph();
  }, 180_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  it('connects, writes a node, reads it back', async () => {
    const session = mg.driver.session();
    try {
      await session.run('CREATE (n:Smoke {id: $id, name: $name})', { id: 'a', name: 'first' });
      const result = await session.run(
        'MATCH (n:Smoke {id: $id}) RETURN n.name AS name',
        { id: 'a' },
      );
      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('name')).toBe('first');
    } finally {
      await session.close();
    }
  });

  // The engine the run asked for is the one that answers, and the database the suites name (`memgraph`, the
  // platform's default) opens on it: on Neo4j the harness makes it the default database.
  it('serves the engine DT_TEST_ENGINE names, with a database named memgraph', async () => {
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      const result = await session.run('CALL dbms.components() YIELD name RETURN name');
      expect(String(result.records[0].get('name')).toLowerCase()).toContain(TEST_ENGINE);
    } finally {
      await session.close();
    }
  });

  it('clearGraph wipes the database between tests', async () => {
    const session = mg.driver.session();
    try {
      const result = await session.run('MATCH (n) RETURN count(n) AS c');
      expect(result.records[0].get('c').toNumber()).toBe(0);
    } finally {
      await session.close();
    }
  });
});
