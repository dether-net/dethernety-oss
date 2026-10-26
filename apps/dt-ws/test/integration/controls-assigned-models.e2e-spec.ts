// Integration coverage for the getControlsAssignedModels @cypher statement: the models each control is assigned to,
// through the elements it supports. The control library's shared-ownership check reads it, so an under-count makes a
// shared control look like one model's alone.
//
// The statement is taken from the production schema.graphql and run on the test database as it stands, on Memgraph
// or Neo4j (DT_TEST_ENGINE). It adds the two branches' model lists in a WITH of its own, which is the shape Neo4j
// accepts: the earlier one-clause form (`ids1 + collect(...)`) is refused there.

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { PRODUCTION_SDL } from './production-schema';
import { cypherStatementsInSchema } from '@dethernety/dt-module/cypher-lint';

jest.setTimeout(120_000);

const STATEMENT = (() => {
  const found = cypherStatementsInSchema(PRODUCTION_SDL).filter((s) => s.text.includes('AS combined'));
  if (found.length !== 1) throw new Error(`expected one getControlsAssignedModels statement, found ${found.length}`);
  return found[0].text;
})();

// Two models. ctrl-comp supports a component two boundaries deep in model A; ctrl-flow supports a data flow whose
// component is in model B; ctrl-both supports a boundary in A, a component in A and a flow in B, so A must appear
// once; ctrl-none supports nothing.
const SEED = `
  CREATE (ma:Model {id: 'model-a'}), (mb:Model {id: 'model-b'})
  CREATE (topA:SecurityBoundary {id: 'top-a'}), (innerA:SecurityBoundary {id: 'inner-a'}), (topB:SecurityBoundary {id: 'top-b'})
  CREATE (ma)-[:CONTAINS]->(topA), (innerA)-[:BELONGS_TO]->(topA), (mb)-[:CONTAINS]->(topB)
  CREATE (compA:Component {id: 'comp-a'})-[:BELONGS_TO]->(innerA)
  CREATE (compB:Component {id: 'comp-b'})-[:BELONGS_TO]->(topB)
  CREATE (compB2:Component {id: 'comp-b2'})-[:BELONGS_TO]->(topB)
  CREATE (flowB:DataFlow {id: 'flow-b'}), (compB)-[:FLOWS]->(flowB), (flowB)-[:FLOWS]->(compB2)
  CREATE (ctrlComp:Control {id: 'ctrl-comp'})-[:SUPPORTS]->(compA)
  CREATE (ctrlFlow:Control {id: 'ctrl-flow'})-[:SUPPORTS]->(flowB)
  CREATE (ctrlBoth:Control {id: 'ctrl-both'}), (ctrlBoth)-[:SUPPORTS]->(topA), (ctrlBoth)-[:SUPPORTS]->(compA),
    (ctrlBoth)-[:SUPPORTS]->(flowB)
  CREATE (:Control {id: 'ctrl-none'})
`;

describe('getControlsAssignedModels — live test database (e2e)', () => {
  let mg: MemgraphHandle;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    const session = mg.driver.session();
    try {
      await session.run(SEED);
    } finally {
      await session.close();
    }
  });

  async function assigned(controlIds: string[]): Promise<Record<string, string[]>> {
    const session = mg.driver.session();
    try {
      const result = await session.run(STATEMENT, { controlIds });
      const byControl: Record<string, string[]> = {};
      for (const record of result.records) {
        const row = record.get('result') as { controlId: string; modelIds: string[] };
        byControl[row.controlId] = [...row.modelIds].sort();
      }
      return byControl;
    } finally {
      await session.close();
    }
  }

  it('reaches a model through a nested boundary and through a data flow, once per model', async () => {
    expect(await assigned(['ctrl-comp', 'ctrl-flow', 'ctrl-both'])).toEqual({
      'ctrl-comp': ['model-a'],
      'ctrl-flow': ['model-b'],
      'ctrl-both': ['model-a', 'model-b'],
    });
  });

  it('keeps a row with no models for a control that supports nothing', async () => {
    expect(await assigned(['ctrl-none'])).toEqual({ 'ctrl-none': [] });
  });

  it('gives no row for an unknown control id, and one row for a repeated id', async () => {
    const session = mg.driver.session();
    try {
      const result = await session.run(STATEMENT, { controlIds: ['ctrl-comp', 'ctrl-comp', 'no-such-control'] });
      expect(result.records.map((r) => r.get('result'))).toEqual([{ controlId: 'ctrl-comp', modelIds: ['model-a'] }]);
    } finally {
      await session.close();
    }
  });
});
