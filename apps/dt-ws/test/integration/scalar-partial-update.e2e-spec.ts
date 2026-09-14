// Partial updates — the graph-level proof for the element-side write path.
//
// The element writers emit a field only when the element they are given defines it. That design rests
// on one property of the translator: an update input that omits a field leaves that field alone. It is
// asserted for relationships elsewhere; for scalars it was carried on reasoning, and this pins it.
//
// What it proves:
//   1. AN OMITTED SCALAR IS UNTOUCHED, including across a second writer's change — which is the
//      concurrent case the narrowing exists for: two people editing one element, each sending only
//      their own field, neither reverting the other.
//   2. A PRESENT SCALAR STILL REPLACES. The control. Without it, (1) is equally satisfied by an update
//      that does nothing at all, which is the failure mode narrowing could introduce.
//   3. AN EXPLICIT NULL STILL WRITES. Presence is the test, not truth: clearing a field is an edit,
//      and an input built on truthiness would silently drop it.
//   4. THE EMPTY FILTER, MEASURED. A relationship `connect` whose `where` carries no condition does not
//      fail and does not no-op — it matches EVERY node of that label, after the disconnect beside it
//      has already run. This is what an element that does not define its parent would produce if the
//      key were emitted anyway, so it is pinned as a measurement rather than inferred.
//   5. OMITTING THE KEY IS THE ANSWER TO (4), on the same seed.
//   7. A LIST-TYPED PROPERTY behaves like the scalars: `{ set: [] }` clears it, the key omitted leaves
//      it alone, `{ set: [...] }` replaces it. Pinned because a list property's generated mutation
//      input is not the same machinery as a scalar's — this codebase already carries a note about an
//      enum-list field whose generated input was unusable — and because an absent list used to be read
//      as a clear by the data-item writer, which is the defect the narrowing removes.
//   6. A BARE DISCONNECT, with no connect beside it, detaches and attaches nothing. That is the shape
//      an element sends when it is moved to the root of a tree whose root is the ABSENCE of a parent
//      rather than a node — a model moved out of every folder — and it is the one payload shape the
//      writers emit that no spec had ever run. Its no-op case travels with it, because moving something
//      already at the root to the root must not fail.
//
// COUPLING NOTE: `@dethernety/dt-core` (the actual writer) cannot be imported here — it is ESM-only and
// this config un-ignores only `jose`. So the inputs below are reproduced by hand. The pairing that
// keeps them honest: dt-core's own vitest suite asserts the SHAPE its writers emit — the three element
// writers in `update-{component,boundary,dataflow}-partial.test.ts` ("a field the element does not
// define is not written"), the model writer in `update-model-partial.test.ts` and the data-item writer
// in `update-dataitem-partial.test.ts` ("a field the caller does not supply is not written") — and this
// spec asserts what those shapes DO to a real graph. Change one, revisit the other.

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

// Minimal probe SDL mirroring the production component shape: scalars plus the parent relationship.
// `id: ID!` is deliberately WITHOUT `@id`, and `@authentication` is deliberately omitted, both for the
// reasons relationship-edge-uniqueness records.
const typeDefs = `
  type SecurityBoundary @node {
    id: ID!
    name: String!
  }

  type Component @node {
    id: ID!
    name: String!
    description: String
    positionX: Float
    # A list-typed PROPERTY, mirroring the shape a data item's regulatory flags have. It is on this
    # type rather than a new one because the translator branches on the field's type, not on the node
    # it hangs off, and reusing the seed keeps the two-client case three lines long.
    regulatoryFlags: [String!]
    parentBoundary: [SecurityBoundary!]! @relationship(type: "CONTAINS", direction: IN)
  }
`;

const ctx = {
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
};

jest.setTimeout(60_000);

const UPDATE = `
  mutation UpdateComponent($componentId: ID!, $input: ComponentUpdateInput!) {
    updateComponents(where: { id: { eq: $componentId } }, update: $input) {
      components {
        id
        name
        description
        positionX
        regulatoryFlags
        parentBoundary { id }
      }
    }
  }
`;

describe('partial updates — an omitted field is left alone', () => {
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
   * VACUOUS-PASS GUARD. `graphql()` does not throw — a mistyped input field returns `{ errors }` and
   * leaves the graph untouched, which would make every "unchanged" assertion below go green while
   * proving nothing. Every operation goes through here.
   */
  const runOk = async (source: string, variableValues?: Record<string, unknown>) => {
    const result = await run(source, variableValues);
    expect(result.errors).toBeUndefined();
    return result.data as any;
  };

  /**
   * Update cmp-1 and assert the mutation actually MATCHED it. A `where` matching nothing returns
   * `{ components: [] }` and no errors, and an inert update leaves the seed state in place — which is
   * exactly what the post-state assertions expect.
   */
  const update = async (input: Record<string, unknown>) => {
    const data = await runOk(UPDATE, { componentId: 'cmp-1', input });
    const components = data.updateComponents.components;
    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('cmp-1');
    return components[0];
  };

  /** One component inside boundary A, with a second boundary that it must never become a child of. */
  const seed = async () => {
    await runOk(`
      mutation {
        createSecurityBoundaries(input: [{ id: "bnd-a", name: "A" }, { id: "bnd-b", name: "B" }]) {
          securityBoundaries { id }
        }
      }
    `);
    await runOk(`
      mutation {
        createComponents(input: [{
          id: "cmp-1",
          name: "original",
          description: "original description",
          positionX: 10,
          regulatoryFlags: ["GDPR"],
          parentBoundary: { connect: [{ where: { node: { id: { eq: "bnd-a" } } } }] }
        }]) { components { id } }
      }
    `);
  };

  describe('scalars', () => {
    it('leaves a scalar alone when the input omits it — including one another writer just changed', async () => {
      await seed();

      // Another client renames it. This is the state the second save must not undo.
      await update({ name: { set: 'theirs' } });

      // This client edits only the description, the way a narrowed save does.
      const after = await update({ description: { set: 'mine' } });

      expect(after.name).toBe('theirs');
      expect(after.description).toBe('mine');
      // And every other scalar it never mentioned.
      expect(after.positionX).toBe(10);
    });

    it('replaces a scalar the input does present (the control)', async () => {
      await seed();
      const after = await update({ name: { set: 'renamed' } });
      expect(after.name).toBe('renamed');
    });

    it('writes an explicit null, because presence is the test and not truth', async () => {
      await seed();
      const after = await update({ description: { set: null } });
      expect(after.description).toBeNull();
    });

    it('changes nothing at all on an empty input', async () => {
      await seed();
      const after = await update({});
      expect(after.name).toBe('original');
      expect(after.description).toBe('original description');
      expect(after.parentBoundary.map((b: any) => b.id)).toEqual(['bnd-a']);
    });
  });

  describe('a list-typed property', () => {
    it('clears on an explicit empty list', async () => {
      await seed();

      const after = await update({ regulatoryFlags: { set: [] } });

      expect(after.regulatoryFlags).toEqual([]);
    });

    // The two-client case for a list, and the reason the writer stopped reading an absence as a clear:
    // one client sets the flags, another edits only the description and must not undo it.
    it('is untouched when the input omits it, including one another writer just set', async () => {
      await seed();
      await update({ regulatoryFlags: { set: ['PCI cardholder', 'PHI'] } });

      const after = await update({ description: { set: 'mine' } });

      expect(after.regulatoryFlags).toEqual(['PCI cardholder', 'PHI']);
      expect(after.description).toBe('mine');
    });

    it('replaces wholesale when the input does present it (the control)', async () => {
      await seed();

      const after = await update({ regulatoryFlags: { set: ['PHI'] } });

      expect(after.regulatoryFlags).toEqual(['PHI']);
    });
  });

  describe('a relationship connect whose filter carries no condition', () => {
    it('attaches to EVERY node of that label, having already disconnected — the hazard, measured', async () => {
      await seed();

      // The shape an element that does not define its parent produces if the key is emitted anyway:
      // the id filter is an empty object, which is no condition at all.
      const after = await update({
        parentBoundary: { disconnect: {}, connect: { where: { node: { id: {} } } } },
      });

      expect(after.parentBoundary.map((b: any) => b.id).sort()).toEqual(['bnd-a', 'bnd-b']);
    });

    it('leaves the single parent alone when the key is omitted instead — the answer to it', async () => {
      await seed();

      const after = await update({ description: { set: 'edited' } });

      expect(after.parentBoundary.map((b: any) => b.id)).toEqual(['bnd-a']);
    });

    // A model's root is the absence of a folder rather than a node to connect to, so moving one there
    // emits a disconnect with nothing beside it. Every other shape in this suite pairs the unconditional
    // disconnect with a connect; this one has no connect at all.
    it('detaches and attaches nothing on a bare disconnect', async () => {
      await seed();

      const after = await update({ parentBoundary: { disconnect: {} } });

      expect(after.parentBoundary).toEqual([]);
      // The control for it is two tests up: the same key OMITTED leaves the parent where it was. The
      // pair is what separates "this payload detaches" from "this payload does nothing".
    });

    it('is a no-op rather than an error when there is nothing attached to detach', async () => {
      // Moving something that is already at the root to the root. The dialog cannot tell the two apart
      // without a read, so this has to be safe or the save would fail for a reason the user cannot see.
      await seed();
      await update({ parentBoundary: { disconnect: {} } });

      const after = await update({ parentBoundary: { disconnect: {} }, name: { set: 'still here' } });

      expect(after.parentBoundary).toEqual([]);
      // And the rest of the update still landed, which is what proves the mutation ran at all.
      expect(after.name).toBe('still here');
    });

    it('still re-homes the parent when the filter names one (the control)', async () => {
      await seed();

      const after = await update({
        parentBoundary: { disconnect: {}, connect: { where: { node: { id: { eq: 'bnd-b' } } } } },
      });

      expect(after.parentBoundary.map((b: any) => b.id)).toEqual(['bnd-b']);
    });
  });
});
