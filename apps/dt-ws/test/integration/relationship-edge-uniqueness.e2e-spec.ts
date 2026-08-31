// Relationship edge-uniqueness — the graph-level proof for the element-side
// association write path.
//
// Neither Memgraph nor Neo4j can express an endpoint-pair relationship-uniqueness
// constraint, and `@neo4j/graphql`'s `connect` compiles to a bare relationship
// CREATE. So "one edge per pair" is not enforced anywhere below this layer — it is
// purely a property of the mutation variables the writer emits. This spec pins that
// property against a real engine.
//
// What it proves:
//   1. THE DEFECT, both shapes that exhibit it — (a) a bare `connect` with no
//      disconnect at all (what an append-only assign emits), and (b) a disconnect
//      that SPARES the incoming ids paired with an unconditional connect (what the
//      element-side save emitted). Both append a parallel edge per call. Pinned here
//      so the regression is a measurement, not an inference.
//   2. THE FIX — an unconditional disconnect-all paired with the same connect is
//      idempotent: repeat saves leave exactly one edge per pair.
//   3. ORDERING — disconnect-all and connect-all in ONE mutation do not annihilate
//      each other. The translator emits disconnect before connect for the same
//      field; if that ever inverts, replace-semantics would silently clear every
//      association instead of replacing it, so this is the load-bearing assertion.
//   4. SELF-HEAL — the fixed shape collapses duplicates already on disk.
//   5. The absent-field guard still leaves associations untouched.
//
// COUPLING NOTE: `@dethernety/dt-core` (the actual writer) cannot be imported here —
// it is ESM-only and this config un-ignores only `jose`. So the mutation variables
// below are reproduced by hand. The pairing that keeps them honest: dt-core's own
// vitest suite asserts the SHAPE it emits (`update-component-crownjewel.test.ts` et
// al. — "emits an unconditional disconnect-all for a %s control list"), and this
// spec asserts what that shape DOES to a real graph. Change one, revisit the other.

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

// Minimal probe SDL mirroring the production association shape: Control -SUPPORTS->
// element (direction IN on the element) and element -HANDLES-> Data.
// `id: ID!` is deliberately WITHOUT `@id` — `@id` excludes the field from the
// generated create input, and these tests need deterministic ids.
// `@authentication` is deliberately omitted (matching cypher-mutation-canary): without
// the features/context apparatus every operation would return Unauthenticated, which
// combined with the vacuous-pass trap below is a silent green.
const typeDefs = `
  type Control @node {
    id: ID!
    name: String!
  }

  type Data @node {
    id: ID!
    name: String!
  }

  type Component @node {
    id: ID!
    name: String!
    controls: [Control!]! @relationship(type: "SUPPORTS", direction: IN)
    dataItems: [Data!]! @relationship(type: "HANDLES", direction: OUT)
  }
`;

// Memgraph's database is named `memgraph`; addVersionPrefix:false drops the
// `CYPHER 5` prefix it rejects. Mirrors the production context factory.
const ctx = {
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
};

jest.setTimeout(60_000);

const UPDATE_COMPONENT = `
  mutation UpdateComponent($componentId: ID!, $input: ComponentUpdateInput!) {
    updateComponents(where: { id: { eq: $componentId } }, update: $input) {
      components {
        id
        controls { id }
        dataItems { id }
      }
    }
  }
`;

/** The buggy shape: disconnect everything NOT listed, then connect all listed. */
const sparingDisconnect = (ids: string[]) => ({
  disconnect: { where: { NOT: { OR: ids.map(id => ({ node: { id: { eq: id } } })) } } },
  connect: ids.map(id => ({ where: { node: { id: { eq: id } } } })),
});

/** The fixed shape: disconnect ALL, then connect all listed. */
const unconditionalDisconnect = (ids: string[]) => ({
  disconnect: {},
  connect: ids.map(id => ({ where: { node: { id: { eq: id } } } })),
});

describe('relationship edge uniqueness — element-side association writes', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    mg = await startMemgraph();
    const neoSchema = new Neo4jGraphQL({ typeDefs, driver: mg.driver });
    schema = await neoSchema.getSchema();
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  const run = (source: string, variableValues?: Record<string, unknown>) =>
    graphql({ schema, source, contextValue: ctx, variableValues });

  /**
   * VACUOUS-PASS GUARD. `graphql()` does not throw — a mistyped input field returns
   * `{ errors }` and leaves the graph untouched. Since the seed already produces
   * exactly one edge per pair, a silently-rejected update would make the
   * "exactly 1" assertions go green while proving nothing. Every operation goes
   * through here.
   */
  const runOk = async (source: string, variableValues?: Record<string, unknown>) => {
    const result = await run(source, variableValues);
    expect(result.errors).toBeUndefined();
    return result.data as any;
  };

  /**
   * Update cmp-1 and assert the mutation actually MATCHED it. `updateComponents` with a
   * `where` that matches nothing returns `{ components: [] }` and NO errors, so `runOk`
   * alone cannot distinguish a correct update from an inert one — and an inert update
   * leaves the seed state in place, which is exactly what the post-state assertions
   * expect. Every update in this spec goes through here.
   */
  const updateComponent = async (input: Record<string, unknown>) => {
    const data = await runOk(UPDATE_COMPONENT, { componentId: 'cmp-1', input });
    const components = data.updateComponents.components;
    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('cmp-1');
    return components[0];
  };

  /** Seed one Component with two Controls and one Data, all attached exactly once. */
  const seed = async () => {
    await runOk(`
      mutation {
        createControls(input: [{ id: "ctl-1", name: "C1" }, { id: "ctl-2", name: "C2" }]) {
          controls { id }
        }
      }
    `);
    await runOk(`
      mutation { createData(input: [{ id: "dat-1", name: "D1" }]) { data { id } } }
    `);
    await runOk(`
      mutation {
        createComponents(input: [{
          id: "cmp-1",
          name: "Comp",
          controls: { connect: [
            { where: { node: { id: { eq: "ctl-1" } } } },
            { where: { node: { id: { eq: "ctl-2" } } } }
          ] },
          dataItems: { connect: [{ where: { node: { id: { eq: "dat-1" } } } }] }
        }]) { components { id } }
      }
    `);

    // Assert the seed actually attached — otherwise every count below is trivially
    // satisfied by an empty graph (vacuous-pass trap #2).
    const seeded = await edgeCounts();
    expect(seeded).toEqual({ supports: { 'ctl-1': 1, 'ctl-2': 1 }, handles: { 'dat-1': 1 }, totals: { supports: 1 + 1, handles: 1 } });
  };

  /**
   * Per-pair edge multiplicity plus absolute totals. Counts come back as neo4j
   * Integers, hence `.toNumber()`. The totals catch the case where a pair vanishes
   * entirely — a per-pair map alone would report `{}` and assert nothing.
   */
  const edgeCounts = async () => {
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      const perPair = await session.run(`
        MATCH (c:Control)-[r:SUPPORTS]->(:Component { id: 'cmp-1' })
        RETURN c.id AS id, count(r) AS n
      `);
      const perData = await session.run(`
        MATCH (:Component { id: 'cmp-1' })-[r:HANDLES]->(d:Data)
        RETURN d.id AS id, count(r) AS n
      `);
      // Two INDEPENDENT queries on purpose. Combining them made the first count a
      // grouping key for the second MATCH, so a graph with zero HANDLES edges returned
      // no rows at all and reported BOTH totals as 0 — the exact false-negative these
      // totals exist to catch.
      const supportsTotal = await session.run(`
        MATCH (:Control)-[s:SUPPORTS]->(:Component) RETURN count(s) AS n
      `);
      const handlesTotal = await session.run(`
        MATCH (:Component)-[h:HANDLES]->(:Data) RETURN count(h) AS n
      `);
      const toMap = (res: any) =>
        Object.fromEntries(res.records.map((r: any) => [r.get('id'), r.get('n').toNumber()]));
      return {
        supports: toMap(perPair),
        handles: toMap(perData),
        totals: {
          supports: supportsTotal.records[0].get('n').toNumber(),
          handles: handlesTotal.records[0].get('n').toNumber(),
        },
      };
    } finally {
      await session.close();
    }
  };

  it('THE DEFECT (connect-only) — a bare connect with no disconnect appends on every call', async () => {
    await seed();

    // The shape an APPEND-ONLY assign emits: a connect and no disconnect whatsoever.
    // `connect` compiles to a bare relationship CREATE, so re-offering an
    // already-attached id appends rather than no-ops. This is why an append-only
    // writer has to read the attached set before writing — there is no disconnect
    // it could make unconditional instead.
    for (const expected of [2, 3]) {
      await updateComponent({ controls: { connect: [{ where: { node: { id: { eq: 'ctl-1' } } } }] } });
      expect((await edgeCounts()).supports['ctl-1']).toBe(expected);
    }

    // ctl-2 was never re-offered, so it stays at one — the growth tracks the
    // connect payload, not the save itself.
    expect((await edgeCounts()).supports['ctl-2']).toBe(1);
  });

  it('THE DEFECT — a disconnect that spares the incoming ids appends an edge per save', async () => {
    await seed();

    await updateComponent({ controls: sparingDisconnect(['ctl-1', 'ctl-2']) });

    // One save, one extra edge per already-attached pair. This is D1's mechanism.
    expect((await edgeCounts()).supports).toEqual({ 'ctl-1': 2, 'ctl-2': 2 });

    await updateComponent({ controls: sparingDisconnect(['ctl-1', 'ctl-2']) });

    // …and it compounds linearly. Nothing in the engine deduplicates.
    expect((await edgeCounts()).supports).toEqual({ 'ctl-1': 3, 'ctl-2': 3 });
  });

  it('THE FIX — an unconditional disconnect-all is idempotent across repeat saves', async () => {
    await seed();

    for (let save = 0; save < 3; save++) {
      const returned = await updateComponent({
        controls: unconditionalDisconnect(['ctl-1', 'ctl-2']),
        dataItems: unconditionalDisconnect(['dat-1']),
      });

      // The membership must SURVIVE each save, not just the edge count — this is
      // what distinguishes "replaced" from "cleared" (see the ordering test).
      expect(returned.controls.map((c: any) => c.id).sort()).toEqual(['ctl-1', 'ctl-2']);
      expect(returned.dataItems.map((d: any) => d.id)).toEqual(['dat-1']);
    }

    expect(await edgeCounts()).toEqual({
      supports: { 'ctl-1': 1, 'ctl-2': 1 },
      handles: { 'dat-1': 1 },
      totals: { supports: 2, handles: 1 },
    });
  });

  it('ORDERING — disconnect-all and connect-all in one mutation do not annihilate', async () => {
    await seed();

    // The disconnect and connect sets fully OVERLAP here. If the translator ever
    // emitted connect before disconnect, disconnect-all would delete what connect
    // just created and the association would end up EMPTY — a silent data-loss bug
    // that no edge-count-of-1 assertion would catch. Pin the non-empty outcome.
    await updateComponent({ controls: unconditionalDisconnect(['ctl-1', 'ctl-2']) });

    const counts = await edgeCounts();
    expect(counts.totals.supports).toBe(2);
    expect(Object.keys(counts.supports).sort()).toEqual(['ctl-1', 'ctl-2']);
  });

  it('SELF-HEAL — the fixed shape collapses duplicates already on disk', async () => {
    await seed();

    // Force the pre-fix state directly: three extra parallel SUPPORTS edges.
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      await session.run(`
        MATCH (c:Control { id: 'ctl-1' }), (cmp:Component { id: 'cmp-1' })
        CREATE (c)-[:SUPPORTS]->(cmp)
        CREATE (c)-[:SUPPORTS]->(cmp)
        CREATE (c)-[:SUPPORTS]->(cmp)
      `);
    } finally {
      await session.close();
    }
    expect((await edgeCounts()).supports).toEqual({ 'ctl-1': 4, 'ctl-2': 1 });

    await updateComponent({ controls: unconditionalDisconnect(['ctl-1', 'ctl-2']) });

    // One ordinary save repairs the element. This is why the data-repair scope
    // shrinks to elements nobody touches again.
    expect((await edgeCounts()).supports).toEqual({ 'ctl-1': 1, 'ctl-2': 1 });
  });

  it('membership is IDENTICAL to the old shape — the fix changes multiplicity only', async () => {
    // The question this answers: does an unconditional disconnect-all drop controls a
    // save was not trying to change? No. The OLD partial disconnect already removed
    // everything absent from the incoming list, so both shapes land on exactly the
    // listed set. They differ only in how many edges per pair.
    //
    // Realistic association edit: keep ctl-1, drop ctl-2, add ctl-3.
    const addCtl3 = `mutation { createControls(input: [{ id: "ctl-3", name: "C3" }]) { controls { id } } }`;

    await seed();
    await runOk(addCtl3);
    await updateComponent({ controls: sparingDisconnect(['ctl-1', 'ctl-3']) });
    const oldShape = (await edgeCounts()).supports;

    // Same starting graph, the new shape.
    await clearGraph(mg.driver);
    await seed();
    await runOk(addCtl3);
    await updateComponent({ controls: unconditionalDisconnect(['ctl-1', 'ctl-3']) });
    const newShape = (await edgeCounts()).supports;

    // Same membership, both shapes — and ctl-2 was dropped by BOTH, not just the fix.
    expect(Object.keys(newShape).sort()).toEqual(Object.keys(oldShape).sort());
    expect(Object.keys(oldShape).sort()).toEqual(['ctl-1', 'ctl-3']);

    // The only difference: the old shape duplicated the pair it was asked to keep.
    expect(oldShape).toEqual({ 'ctl-1': 2, 'ctl-3': 1 });
    expect(newShape).toEqual({ 'ctl-1': 1, 'ctl-3': 1 });
  });

  it('the absent-field guard leaves associations untouched', async () => {
    await seed();

    // No `controls` / `dataItems` key at all — the shape a position-only canvas save
    // or an import "safe node" pass emits.
    const returned = await updateComponent({ name: { set: 'Renamed' } });

    // Prove the update actually ran — otherwise "associations unchanged" is also what
    // an inert mutation produces.
    expect(returned.id).toBe('cmp-1');

    expect(await edgeCounts()).toEqual({
      supports: { 'ctl-1': 1, 'ctl-2': 1 },
      handles: { 'dat-1': 1 },
      totals: { supports: 2, handles: 1 },
    });
  });
});
