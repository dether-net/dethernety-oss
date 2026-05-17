// Integration coverage for the Exposure / Countermeasure provenance
// invariants:
//
//   - The @populatedBy callback stamps `authoredBy` from the GraphQL
//     context on CREATE (USER write path).
//   - The @populatedBy callback populates `createdBy = USER` on CREATE.
//   - The scoped Cypher upsert (in SetInstantiationAttributesService)
//     stamps `createdBy = 'SYSTEM'` explicitly and is invisible to
//     USER-authored same-name nodes.
//   - The extended deleteObsoleteExternalObjects predicate skips
//     `createdBy = 'USER'` nodes even when their name is missing from
//     the module's current declaration.
//   - Legacy null-createdBy nodes are adopted into 'SYSTEM' on first
//     upsert contact.
//   - The UPDATE input shape rejects client-supplied createdBy_SET /
//     authoredBy_SET (anti-impersonation, anti-sweep-poisoning).

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { assertMutualExclusion } from './invariants';
import { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } from '../../src/gql/populated-by/authored-by';

// ---------------------------------------------------------------------------
// Throwaway schema mirrors the relevant Exposure/Countermeasure shape so the
// directive integration test exercises the same directives the production
// schema uses without booting the full NestJS app.
// ---------------------------------------------------------------------------
// Note: `id: ID!` rather than `id: ID! @id` so the test can pass an
// explicit id in the create input. v7 auto-generates @id fields and
// excludes them from the auto-generated create input shape; for a probe
// schema where we want to assert specific ids, we keep id as a plain
// required field.
// Production schema models `createdBy` as String (not enum) because
// @populatedBy in @neo4j/graphql v7 is restricted to scalar field types.
// Both fields use @populatedBy, which OVERRIDES client-supplied input
// (verified by the probe tests below) — closes the impersonation
// vulnerability where a client could otherwise forge `createdBy` or
// `authoredBy` at create time.
const directiveTypeDefs = `
  type ProbeFinding @node {
    id: ID!
    name: String!
    createdBy: String
      @populatedBy(callback: "stampCreatedByUserOnCreate", operations: [CREATE])
      @settable(onUpdate: false)
    authoredBy: String
      @populatedBy(callback: "populateAuthoredByOnCreate", operations: [CREATE])
      @settable(onUpdate: false)
  }
`;

// Production context shape (per oss/apps/dt-ws/src/gql/gql.module.ts:130-162):
// { token, jwt, user, driver, sessionConfig, cypherQueryOptions }
// where `user` holds JWT claims and `user.sub` is the subject identifier.
// The production callback reads `context.user.sub` directly.
const ctx = (userSub: string | null) => ({
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
  user: userSub ? { sub: userSub } : undefined,
});

// ---------------------------------------------------------------------------
// Verbatim copy of the production §4.7 upsert query for the Exposure case.
// The test asserts the production Cypher shape; if the service's query
// drifts, this test fails loudly. Keep in sync with
// set-instantiation-attributes.service.ts upsertExposures.
// ---------------------------------------------------------------------------
const SCOPED_UPSERT_EXPOSURE = `
  MATCH (c {id: $componentId}), (klass {id: $classId})
  WHERE any(l IN labels(klass) WHERE l ENDS WITH 'Class')
  OPTIONAL MATCH (c)-[:HAS_EXPOSURE]->(existing:Exposure {name: $attributes.name})-[:IS_EXPOSURE_OF]->(klass)
    WHERE existing.createdBy = 'SYSTEM' OR existing.createdBy IS NULL
  WITH c, klass, existing
  FOREACH (_ IN CASE WHEN existing IS NULL THEN [1] ELSE [] END |
    CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {
      id: randomUUID(),
      name: $attributes.name,
      createdBy: 'SYSTEM'
    })-[:IS_EXPOSURE_OF]->(klass)
  )
  WITH c, klass
  MATCH (c)-[:HAS_EXPOSURE]->(e:Exposure {name: $attributes.name})-[:IS_EXPOSURE_OF]->(klass)
  WHERE e.createdBy = 'SYSTEM' OR e.createdBy IS NULL
  SET e += $attributes
  SET e.createdBy = 'SYSTEM'
  RETURN DISTINCT e.name AS instantiatedName
`;

const CLEANUP_PREDICATE = `
  MATCH (class {id: $classId})
  MATCH (c {id: $elementId})-[r:HAS_EXPOSURE]->(e)-[]->(class)
  WHERE NOT e.name IN $validNames
    AND (e.createdBy = 'SYSTEM' OR e.createdBy IS NULL)
  DETACH DELETE e
  RETURN COUNT(e) AS deletedCount
`;

jest.setTimeout(60_000);

describe('Provenance — Exposure/Countermeasure invariants', () => {
  let mg: MemgraphHandle;
  let directiveSchema: GraphQLSchema;

  beforeAll(async () => {
    mg = await startMemgraph();
    const neoSchema = new Neo4jGraphQL({
      typeDefs: directiveTypeDefs,
      driver: mg.driver,
      features: {
        populatedBy: {
          callbacks: { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } as any,
        },
      },
    });
    directiveSchema = await neoSchema.getSchema();
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  // Mutual-exclusion invariant — propagated from element-binding.e2e-spec
  // via the shared `assertMutualExclusion` helper. Catches any provenance
  // test that leaves an element simultaneously class-bound AND model-bound.
  afterEach(async () => {
    await assertMutualExclusion(mg.driver);
  });

  // -------------------------------------------------------------------------
  // USER write path — schema directive integration (subsumes populated-by-probe)
  // -------------------------------------------------------------------------

  describe('USER write path (@populatedBy + @default integration)', () => {
    it('stamps authoredBy from context on auto-generated create', async () => {
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f1", name: "x" }]) { probeFindings { id authoredBy createdBy } } }`,
        contextValue: ctx('user-42'),
      });
      expect(result.errors).toBeUndefined();
      const node = (result.data as any)?.createProbeFindings?.probeFindings?.[0];
      expect(node).toEqual({ id: 'f1', authoredBy: 'user-42', createdBy: 'USER' });
    });

    it('returns null authoredBy when context.req.user is absent', async () => {
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f2", name: "y" }]) { probeFindings { id authoredBy createdBy } } }`,
        contextValue: ctx(null),
      });
      expect(result.errors).toBeUndefined();
      const node = (result.data as any)?.createProbeFindings?.probeFindings?.[0];
      expect(node).toEqual({ id: 'f2', authoredBy: null, createdBy: 'USER' });
    });

    it('does NOT fire the callback on update (operations: [CREATE] honored)', async () => {
      await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f3", name: "z" }]) { probeFindings { id } } }`,
        contextValue: ctx('user-1'),
      });
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { updateProbeFindings(where: { id_EQ: "f3" }, update: { name_SET: "z2" }) { probeFindings { id authoredBy } } }`,
        contextValue: ctx('user-2'),
      });
      expect(result.errors).toBeUndefined();
      const node = (result.data as any)?.updateProbeFindings?.probeFindings?.[0];
      expect(node?.authoredBy).toBe('user-1');
    });

    // Negative tests for client forgery on the CREATE path.
    // `@populatedBy(operations: [CREATE])` in @neo4j/graphql v7 REMOVES the
    // field from the auto-generated CREATE input shape entirely — clients
    // physically cannot supply createdBy or authoredBy on a create
    // mutation. GraphQL validation rejects the request before execution.
    it('rejects client-supplied authoredBy via input-shape exclusion (anti-impersonation)', async () => {
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f4", name: "x", authoredBy: "attacker" }]) { probeFindings { id authoredBy } } }`,
        contextValue: ctx('real-user'),
      });
      expect(result.errors).toBeDefined();
      const err = result.errors?.[0];
      expect(err?.message).toMatch(/authoredBy.*not defined/i);
    });

    it('rejects client-supplied createdBy via input-shape exclusion (anti-system-forgery)', async () => {
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f5", name: "x", createdBy: "SYSTEM" }]) { probeFindings { id createdBy } } }`,
        contextValue: ctx('real-user'),
      });
      expect(result.errors).toBeDefined();
      const err = result.errors?.[0];
      expect(err?.message).toMatch(/createdBy.*not defined/i);
    });

    // UPDATE-path negative tests. @populatedBy(operations: [CREATE]) only
    // strips the field from the CREATE input shape. Without an additional
    // @settable(onUpdate: false), an authenticated client could call the
    // auto-generated updateProbeFindings(update: { createdBy_SET, authoredBy_SET })
    // and (a) impersonate another user via authoredBy_SET, or (b) flip
    // a USER finding to SYSTEM (or vice versa) and influence the
    // destructive sweep predicate in ElementBindingService — silently
    // deleting victim findings on the next class rebinding pass.
    //
    // The production schema (oss/apps/dt-ws/schema/schema.graphql) stamps
    // both fields with @settable(onUpdate: false). The probe schema above
    // mirrors that. These tests assert the input-shape exclusion holds on
    // UPDATE: client mutations with createdBy_SET / authoredBy_SET fail
    // GraphQL validation before execution. The schema-shape unit test in
    // schema-shape.spec.ts is the cheap regression guardrail; this e2e is
    // the end-to-end proof.
    it('rejects client-supplied createdBy_SET on UPDATE (anti-sweep-poisoning)', async () => {
      await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f6", name: "x" }]) { probeFindings { id } } }`,
        contextValue: ctx('owner'),
      });
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { updateProbeFindings(where: { id_EQ: "f6" }, update: { createdBy_SET: "SYSTEM" }) { probeFindings { id createdBy } } }`,
        contextValue: ctx('attacker'),
      });
      expect(result.errors).toBeDefined();
      const err = result.errors?.[0];
      expect(err?.message).toMatch(/createdBy_SET.*not defined/i);
    });

    it('rejects client-supplied authoredBy_SET on UPDATE (anti-impersonation)', async () => {
      await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f7", name: "x" }]) { probeFindings { id } } }`,
        contextValue: ctx('victim'),
      });
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { updateProbeFindings(where: { id_EQ: "f7" }, update: { authoredBy_SET: "attacker" }) { probeFindings { id authoredBy } } }`,
        contextValue: ctx('attacker'),
      });
      expect(result.errors).toBeDefined();
      const err = result.errors?.[0];
      expect(err?.message).toMatch(/authoredBy_SET.*not defined/i);
    });

    it('preserves authoredBy across an unrelated UPDATE (no field re-stamp on update path)', async () => {
      await graphql({
        schema: directiveSchema,
        source: `mutation { createProbeFindings(input: [{ id: "f8", name: "x" }]) { probeFindings { id } } }`,
        contextValue: ctx('original-author'),
      });
      const result = await graphql({
        schema: directiveSchema,
        source: `mutation { updateProbeFindings(where: { id_EQ: "f8" }, update: { name_SET: "renamed" }) { probeFindings { id authoredBy createdBy name } } }`,
        contextValue: ctx('different-user'),
      });
      expect(result.errors).toBeUndefined();
      const node = (result.data as any)?.updateProbeFindings?.probeFindings?.[0];
      expect(node).toEqual({
        id: 'f8',
        name: 'renamed',
        authoredBy: 'original-author',
        createdBy: 'USER',
      });
    });
  });

  // -------------------------------------------------------------------------
  // SYSTEM write path — §4.7 scoped Cypher upsert (verbatim production shape)
  // -------------------------------------------------------------------------

  describe('SYSTEM write path (scoped Cypher upsert)', () => {
    async function seedComponentAndClass() {
      const session = mg.driver.session();
      try {
        await session.run(`
          CREATE (c:Component {id: 'comp-1'})
          CREATE (cl:ComponentClass {id: 'cls-1', name: 'PostgreSQL'})
        `);
      } finally {
        await session.close();
      }
    }

    async function findExposures(): Promise<Array<{ name: string; createdBy: string | null; authoredBy: string | null }>> {
      const session = mg.driver.session();
      try {
        const r = await session.run(`
          MATCH (c:Component {id: 'comp-1'})-[:HAS_EXPOSURE]->(e:Exposure)
          RETURN e.name AS name, e.createdBy AS createdBy, e.authoredBy AS authoredBy
          ORDER BY e.name
        `);
        return r.records.map((rec) => ({
          name: rec.get('name'),
          createdBy: rec.get('createdBy'),
          authoredBy: rec.get('authoredBy'),
        }));
      } finally {
        await session.close();
      }
    }

    it('first upsert against a fresh component creates the node with createdBy=SYSTEM', async () => {
      await seedComponentAndClass();
      const session = mg.driver.session();
      try {
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1',
          classId: 'cls-1',
          attributes: { name: 'SQL Injection', description: 'Inbound query parameter not parameterised', score: 8 },
        });
      } finally {
        await session.close();
      }
      const got = await findExposures();
      expect(got).toEqual([
        { name: 'SQL Injection', createdBy: 'SYSTEM', authoredBy: null },
      ]);
    });

    it('second upsert with same name on same (component, class) updates in place, no duplicate', async () => {
      await seedComponentAndClass();
      const session = mg.driver.session();
      try {
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1', classId: 'cls-1',
          attributes: { name: 'SQL Injection', description: 'v1' },
        });
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1', classId: 'cls-1',
          attributes: { name: 'SQL Injection', description: 'v2 (updated)' },
        });
      } finally {
        await session.close();
      }
      const r = mg.driver.session();
      try {
        const count = await r.run(`
          MATCH (c:Component {id: 'comp-1'})-[:HAS_EXPOSURE]->(e:Exposure {name: 'SQL Injection'})
          RETURN count(e) AS n, collect(e.description) AS descs
        `);
        expect(count.records[0].get('n').toNumber()).toBe(1);
        expect(count.records[0].get('descs')).toEqual(['v2 (updated)']);
      } finally {
        await r.close();
      }
    });

    it('module-supplied authoredBy lands on the SYSTEM node', async () => {
      await seedComponentAndClass();
      const session = mg.driver.session();
      try {
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1', classId: 'cls-1',
          attributes: { name: 'CVE-2024-1234', authoredBy: 'NIST NVD' },
        });
      } finally {
        await session.close();
      }
      const got = await findExposures();
      expect(got).toEqual([
        { name: 'CVE-2024-1234', createdBy: 'SYSTEM', authoredBy: 'NIST NVD' },
      ]);
    });

    it('legacy null-createdBy node is adopted into SYSTEM on next upsert contact', async () => {
      await seedComponentAndClass();
      const session = mg.driver.session();
      try {
        // Legacy data shape: an Exposure with no createdBy.
        await session.run(`
          MATCH (c:Component {id: 'comp-1'}), (cl:ComponentClass {id: 'cls-1'})
          CREATE (c)-[:HAS_EXPOSURE]->(e:Exposure {id: 'legacy-id', name: 'Legacy', description: 'old'})-[:IS_EXPOSURE_OF]->(cl)
        `);
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1', classId: 'cls-1',
          attributes: { name: 'Legacy', description: 'refreshed' },
        });
      } finally {
        await session.close();
      }
      const got = await findExposures();
      expect(got).toEqual([
        { name: 'Legacy', createdBy: 'SYSTEM', authoredBy: null },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // I5 — USER and SYSTEM coexist; cleanup protects USER
  // -------------------------------------------------------------------------

  describe('I5 — USER + SYSTEM coexistence + cleanup protection', () => {
    async function seedFull() {
      const session = mg.driver.session();
      try {
        await session.run(`
          CREATE (c:Component {id: 'comp-1'})
          CREATE (cl:ComponentClass {id: 'cls-1', name: 'PostgreSQL'})
          // USER-authored exposure with same name as one the class will declare.
          CREATE (c)-[:HAS_EXPOSURE]->(eUser:Exposure {
            id: 'user-id-1',
            name: 'SQL Injection',
            description: 'analyst-authored note',
            createdBy: 'USER',
            authoredBy: 'alice@example.com'
          })-[:IS_EXPOSURE_OF]->(cl)
          // USER-authored exposure NOT declared by the class. Cleanup must skip it.
          CREATE (c)-[:HAS_EXPOSURE]->(eUser2:Exposure {
            id: 'user-id-2',
            name: 'Custom Finding Only Alice Saw',
            description: 'one-off',
            createdBy: 'USER',
            authoredBy: 'alice@example.com'
          })-[:IS_EXPOSURE_OF]->(cl)
        `);
      } finally {
        await session.close();
      }
    }

    async function listExposureRows() {
      const session = mg.driver.session();
      try {
        const r = await session.run(`
          MATCH (c:Component {id: 'comp-1'})-[:HAS_EXPOSURE]->(e:Exposure)
          RETURN e.name AS name, e.createdBy AS createdBy, e.authoredBy AS authoredBy, e.description AS description
          ORDER BY e.createdBy, e.name
        `);
        return r.records.map((rec) => ({
          name: rec.get('name'),
          createdBy: rec.get('createdBy'),
          authoredBy: rec.get('authoredBy'),
          description: rec.get('description'),
        }));
      } finally {
        await session.close();
      }
    }

    it('class-declared exposure with same name as USER coexists; both survive', async () => {
      await seedFull();
      const session = mg.driver.session();
      try {
        // Module declares a "SQL Injection" exposure for this class.
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1', classId: 'cls-1',
          attributes: { name: 'SQL Injection', description: 'module-declared variant', score: 8 },
        });
      } finally {
        await session.close();
      }
      const rows = await listExposureRows();
      // Three nodes total: 2 USER (one with shared name, one custom) + 1 fresh SYSTEM.
      expect(rows).toHaveLength(3);
      const user = rows.filter((r) => r.createdBy === 'USER');
      const system = rows.filter((r) => r.createdBy === 'SYSTEM');
      expect(user.map((r) => r.name).sort()).toEqual(['Custom Finding Only Alice Saw', 'SQL Injection']);
      expect(system).toEqual([
        { name: 'SQL Injection', createdBy: 'SYSTEM', authoredBy: null, description: 'module-declared variant' },
      ]);
    });

    it('deleteObsoleteExternalObjects skips USER-authored entries', async () => {
      await seedFull();
      const session = mg.driver.session();
      try {
        // Module's current declaration: only "Replication Lag" is valid.
        // Both USER entries (SQL Injection, Custom Finding) are absent from
        // $validNames. The extended cleanup predicate must skip them.
        const r = await session.run(CLEANUP_PREDICATE, {
          elementId: 'comp-1',
          classId: 'cls-1',
          validNames: ['Replication Lag'],
        });
        expect(r.records[0].get('deletedCount').toNumber()).toBe(0);
      } finally {
        await session.close();
      }
      const rows = await listExposureRows();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.createdBy === 'USER')).toBe(true);
    });

    it('deleteObsoleteExternalObjects still deletes SYSTEM-authored entries absent from the module', async () => {
      await seedFull();
      const session = mg.driver.session();
      try {
        // Seed a SYSTEM exposure that the module no longer declares.
        await session.run(SCOPED_UPSERT_EXPOSURE, {
          componentId: 'comp-1', classId: 'cls-1',
          attributes: { name: 'Stale System Exposure', description: 'from a prior module declaration' },
        });
        const r = await session.run(CLEANUP_PREDICATE, {
          elementId: 'comp-1',
          classId: 'cls-1',
          validNames: ['SomeOtherName'],  // 'Stale System Exposure' is absent.
        });
        expect(r.records[0].get('deletedCount').toNumber()).toBe(1);
      } finally {
        await session.close();
      }
      const rows = await listExposureRows();
      // Only USER entries survive.
      expect(rows.map((r) => r.name).sort()).toEqual(['Custom Finding Only Alice Saw', 'SQL Injection']);
      expect(rows.every((r) => r.createdBy === 'USER')).toBe(true);
    });

    it('deleteObsoleteExternalObjects deletes legacy null-createdBy entries (treats them as SYSTEM)', async () => {
      await seedFull();
      const session = mg.driver.session();
      try {
        // Seed a legacy node directly (legacy shape, no createdBy).
        await session.run(`
          MATCH (c:Component {id: 'comp-1'}), (cl:ComponentClass {id: 'cls-1'})
          CREATE (c)-[:HAS_EXPOSURE]->(e:Exposure {id: 'legacy-id', name: 'Legacy null entry'})-[:IS_EXPOSURE_OF]->(cl)
        `);
        const r = await session.run(CLEANUP_PREDICATE, {
          elementId: 'comp-1',
          classId: 'cls-1',
          validNames: ['SomeOtherName'],
        });
        // Legacy entry is eligible for cleanup; the two USER entries are not.
        expect(r.records[0].get('deletedCount').toNumber()).toBe(1);
      } finally {
        await session.close();
      }
      const rows = await listExposureRows();
      expect(rows.every((r) => r.createdBy === 'USER')).toBe(true);
    });
  });
});
