// Controls on Data elements, through the production schema on the engine the suites run against.
//
// A Control attaches to a Data element by a SUPPORTS edge, written from the element side (`updateData { controls }`,
// as a whole list or as a delta) or from the control side (`updateControls { supportedData }`), and read from either
// end. Each end is scoped to its own label: the control-side connect binds Data nodes only, so an id of another
// element type in the same list attaches nothing there. Deleting the Data element removes its edges.
//
// dt-core's assign reads the attached elements before it writes and connects only the difference, so its read must
// see every edge its write makes. Its two documents are read from dt-core's source rather than copied (dt-core is
// ESM-only, and this Jest config cannot import it): an edge the four-path assign writes, the find reads back.

import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';

jest.setTimeout(120_000);

/** The text of `export const <name> = gql`…`` in a dt-core source file. */
function dtCoreOperation(file: string, name: string): string {
  const source = fs.readFileSync(path.join(__dirname, '../../../../packages/dt-core/src', file), 'utf8');
  const match = new RegExp(`export const ${name} = gql\`([\\s\\S]*?)\``).exec(source);
  if (!match) throw new Error(`${name} not found in dt-core ${file}`);
  if (match[1].includes('${')) throw new Error(`${name} in dt-core ${file} interpolates; read it some other way`);
  return match[1];
}

const ASSIGN_CONTROL_TO_ELEMENTS = dtCoreOperation('dt-control/dt-control-gql.ts', 'ASSIGN_CONTROL_TO_ELEMENTS');
const FIND_CONTROLS = dtCoreOperation('dt-control/dt-control-gql.ts', 'FIND_CONTROLS');

const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();

describe('controls on Data elements — live test database (e2e)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await buildProductionSchema('noauth', mg.driver);
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    await cypher(`
      CREATE (m:Model {id: 'model-1', name: 'M'})
      CREATE (m)-[:CONTAINS]->(:Data {id: 'data-1', name: 'Card numbers'})
      CREATE (m)-[:CONTAINS]->(:Data {id: 'data-2', name: 'Session tokens'})
      CREATE (:Component {id: 'comp-1', name: 'Store', type: 'STORE'})
      CREATE (:Control {id: 'ctrl-1', name: 'Field encryption'})
      CREATE (:Control {id: 'ctrl-2', name: 'Tokenisation'})
    `);
  });

  async function cypher(statement: string): Promise<any[]> {
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      return (await session.run(statement)).records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  }

  async function gql(source: string, variableValues: Record<string, unknown> = {}): Promise<any> {
    const result = await graphql({ schema, source, variableValues, contextValue: MEMGRAPH_CONTEXT });
    expect(result.errors).toBeUndefined();
    return result.data;
  }

  // The input travels as a whole DataUpdateInput, the way dt-core sends it; a single update operation coerces to the
  // one-element list the field takes.
  const UPDATE_DATA = `mutation ($id: ID!, $input: DataUpdateInput!) {
    updateData(where: { id: { eq: $id } }, update: $input) { data { id controls { id } } }
  }`;
  const writeControls = (id: string, controls: Record<string, unknown>) => gql(UPDATE_DATA, { id, input: { controls } });

  const connect = (...controlIds: string[]) => [{ where: { node: { id: { in: controlIds } } } }];

  const dataControls = async (id: string) =>
    ids(((await gql(`query ($id: ID!) { data(where: { id: { eq: $id } }) { controls { id } } }`, { id })) as any).data[0].controls);

  const supportedData = async (id: string) =>
    ids(((await gql(`query ($id: ID!) { controls(where: { id: { eq: $id } }) { supportedData { id } } }`, { id })) as any).controls[0].supportedData);

  it('writes the whole list from the element side, and both ends read it', async () => {
    await writeControls('data-1', { disconnect: {}, connect: connect('ctrl-1', 'ctrl-2') });
    expect(await dataControls('data-1')).toEqual(['ctrl-1', 'ctrl-2']);
    expect(await supportedData('ctrl-1')).toEqual(['data-1']);

    // A whole list replaces: everything not named is disconnected.
    await writeControls('data-1', { disconnect: {}, connect: connect('ctrl-2') });
    expect(await dataControls('data-1')).toEqual(['ctrl-2']);
    expect(await supportedData('ctrl-1')).toEqual([]);
  });

  it('writes a delta from the element side, leaving what it does not name', async () => {
    await writeControls('data-1', { connect: connect('ctrl-1') });
    await writeControls('data-1', { connect: connect('ctrl-2'), disconnect: [{ where: { node: { id: { in: ['ctrl-1'] } } } }] });
    expect(await dataControls('data-1')).toEqual(['ctrl-2']);
  });

  it('connects from the control side to Data nodes only', async () => {
    await gql(
      `mutation { updateControls(where: { id: { eq: "ctrl-1" } }, update: {
         supportedData: { connect: [{ where: { node: { id: { in: ["data-2", "comp-1"] } } } }] }
       }) { controls { id } } }`,
    );
    expect(await supportedData('ctrl-1')).toEqual(['data-2']);
    expect(await dataControls('data-2')).toEqual(['ctrl-1']);
    const [{ n }] = await cypher(`MATCH (:Control)-[s:SUPPORTS]->(:Component) RETURN count(s) AS n`);
    expect(Number(n)).toBe(0);
  });

  it("reads back, in dt-core's find, every edge dt-core's four-path assign writes", async () => {
    // As assignControlToElements builds it: every id on every typed path, each path binding its own label.
    const connects = [{ where: { node: { id: { in: ['data-2', 'comp-1'] } } } }];
    await gql(ASSIGN_CONTROL_TO_ELEMENTS, {
      controlId: 'ctrl-1',
      input: Object.fromEntries(
        ['supportedComponents', 'supportedBoundaries', 'supportedDataFlows', 'supportedData'].map((field) => [field, { connect: connects }]),
      ),
    });

    const [found] = (await gql(FIND_CONTROLS, { condition: { AND: { id: { eq: 'ctrl-1' } } } })).controls;
    expect(ids(found.supportedData)).toEqual(['data-2']);
    expect(ids(found.supportedComponents)).toEqual(['comp-1']);
    const [{ n }] = await cypher(`MATCH (:Control {id: 'ctrl-1'})-[s:SUPPORTS]->() RETURN count(s) AS n`);
    expect(Number(n)).toBe(2);
  });

  it('disconnects from the control side, leaving the control\'s other data elements', async () => {
    await writeControls('data-1', { connect: connect('ctrl-1') });
    await writeControls('data-2', { connect: connect('ctrl-1') });
    await gql(
      `mutation { updateControls(where: { id: { eq: "ctrl-1" } }, update: {
         supportedData: { disconnect: [{ where: { node: { id: { in: ["data-1"] } } } }] }
       }) { controls { id } } }`,
    );
    expect(await supportedData('ctrl-1')).toEqual(['data-2']);
    expect(await dataControls('data-1')).toEqual([]);
  });

  it('refuses to read a data element\'s controls without authentication on the authenticated schema', async () => {
    // No token in the context, so nothing is verified and the JWKS URL is never contacted.
    const authSchema = await buildProductionSchema('auth', mg.driver);
    const result = await graphql({
      schema: authSchema,
      source: `query { data(where: { id: { eq: "data-1" } }) { id controls { id } } }`,
      contextValue: MEMGRAPH_CONTEXT,
    });
    expect(result.errors?.map(String).join()).toMatch(/Unauthenticated/);
  });

  it('removes the edges with the Data element, and leaves the controls', async () => {
    await writeControls('data-1', { disconnect: {}, connect: connect('ctrl-1') });
    await gql(`mutation { deleteData(where: { id: { eq: "data-1" } }) { nodesDeleted } }`);
    const [{ edges }] = await cypher(`MATCH (:Control)-[s:SUPPORTS]->() RETURN count(s) AS edges`);
    expect(Number(edges)).toBe(0);
    expect(await supportedData('ctrl-1')).toEqual([]);
  });
});
