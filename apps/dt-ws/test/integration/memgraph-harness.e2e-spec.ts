// Bootstrap-sanity smoke for the testcontainers Memgraph harness.
// Proves the helper works end-to-end (start, connect, write, read,
// clean, stop) before integration specs layer @cypher mutation
// execution on top.

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

describe('Memgraph testcontainer harness', () => {
  let mg: MemgraphHandle;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 90_000);

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
