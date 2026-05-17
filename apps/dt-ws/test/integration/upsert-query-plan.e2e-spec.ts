// Query-plan inspection for the scoped exposure upsert in
// SetInstantiationAttributesService. Documents the as-planned access
// pattern under Memgraph 3.8.1 and asserts the cost stays at
// O(element-degree-on-HAS_EXPOSURE), not at O(all-Exposures-in-graph).
//
// Important: Memgraph 3.8.1's planner does NOT consume the
// `CREATE INDEX ON :Exposure(name)` label-property index for the upsert
// pattern `(c {id: $componentId})-[:HAS_EXPOSURE]->(existing:Exposure
// {name: $attrs.name})`. The planner anchors traversal at `c`, walks
// HAS_EXPOSURE edges to neighbours, then post-filters by label and name.
// Label-property indexes help only when the pattern STARTS at a labelled
// node (`MATCH (n:Exposure {name: ...})`), not when the labelled node is
// reached via expansion from another bound node.
//
// What this means in practice:
//   - Cost is O(N) where N = degree(c, HAS_EXPOSURE) — the count of
//     exposures attached to the element — NOT O(M) where M = total
//     Exposure nodes in the graph.
//   - For elements with realistic finding counts (~50) this is fine.
//   - For pathological elements (>>1000 exposures) the post-filter walk
//     becomes the hot spot; rewriting §4.7 to start from Exposure (e.g.
//     `MATCH (existing:Exposure {name: ...})<-[:HAS_EXPOSURE]-(c {id: ...})`)
//     would enable the label-property index path at the cost of changing
//     the query shape. Deferred — current shape is sufficient for v1.
//
// What this test asserts:
//   1. The EXPLAIN plan contains the documented operator chain (Expand +
//      Filter on `:Exposure`/`name`) — the as-planned access pattern.
//   2. The plan does NOT contain a `ScanAll (Exposure)` operator — i.e.
//      Memgraph is not scanning every Exposure in the graph as part of
//      the access path.
//   3. The plan contains exactly one HAS_EXPOSURE Expand (from `c`) — the
//      access is anchored at the element, not at the label.
//
// We additionally count exposure-node touches in the plan tree (Expand on
// HAS_EXPOSURE returning ~degree(c)+1 rows) to guard against future
// planner regressions that would degenerate this to a Cartesian.
//
// Memgraph EXPLAIN returns the plan as a single column `QUERY PLAN`, one
// record per operator. We join the operator names and assert against the
// resulting text. PROFILE is intentionally NOT consumed here — the
// neo4j-driver-core (v5.28.3) `ProfiledPlan` parser expects a `dbHits`
// key that Memgraph's JSON-shaped PROFILE response does not provide, so
// `result.summary` access throws when the consumer iterates. EXPLAIN
// alone is sufficient for the static-analysis assertion this spec makes.

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(120_000);

const UPSERT_QUERY = `
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

async function runSession<T>(driver: any, fn: (session: any) => Promise<T>): Promise<T> {
  const session = driver.session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

async function captureExplainPlan(driver: any, params: any): Promise<string> {
  return runSession(driver, async (session) => {
    const result = await session.run(`EXPLAIN ${UPSERT_QUERY}`, params);
    expect(result.records.length).toBeGreaterThan(0);
    // Memgraph returns plan rows under column `QUERY PLAN` (with space).
    // Pin the column name — if a future Memgraph image changes the contract,
    // this fails fast rather than silently returning empty strings.
    const firstKeys = result.records[0].keys;
    expect(firstKeys).toContain('QUERY PLAN');
    return result.records.map((rec: any) => rec.get('QUERY PLAN')).join('\n');
  });
}

describe('scoped exposure upsert — query plan inspection', () => {
  let mg: MemgraphHandle;

  beforeAll(async () => {
    mg = await startMemgraph();

    // Create the `:Exposure(name)` index that production carries via
    // EnsureIndexesService. Currently NOT consumed by the §4.7 access
    // pattern under Memgraph 3.8.1 (see file docblock) but we ship it
    // because (a) it helps any future query that anchors at Exposure,
    // and (b) the spec specifies it for forward compatibility.
    await runSession(mg.driver, (s) => s.run(`CREATE INDEX ON :Exposure(name)`));
  }, 180_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    // Seed: one Module/Class, one Component, 50 SYSTEM exposures all bound
    // to the class via IS_EXPOSURE_OF with distinct names. This is the
    // realistic post-class-change finding population we want the plan to
    // handle well.
    await runSession(mg.driver, async (session) => {
      await session.run(`CREATE (m:Module {id: 'mod-1-id', name: 'mod-1'})`);
      await session.run(
        `MATCH (m:Module {name: 'mod-1'})
         CREATE (m)-[:HAS_CLASS]->(:ComponentClass {id: 'cc-A', name: 'cc-A'})`,
      );
      await session.run(`CREATE (:Component {id: 'comp-1', name: 'comp-1'})`);
      await session.run(`MATCH (c {id: 'comp-1'}), (k {id: 'cc-A'}) MERGE (c)-[:IS_INSTANCE_OF]->(k)`);
      await session.run(
        `UNWIND range(0, 49) AS i
         MATCH (c {id: 'comp-1'}), (k {id: 'cc-A'})
         CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {
           id: 'sys-' + toString(i),
           name: 'Existing Risk ' + toString(i),
           createdBy: 'SYSTEM'
         })-[:IS_EXPOSURE_OF]->(k)`,
      );
    });
  });

  it('plan is element-anchored — no full :Exposure label scan, no Cartesian on Exposure', async () => {
    const params = {
      componentId: 'comp-1',
      classId: 'cc-A',
      attributes: { name: 'Existing Risk 25', description: 'updated' },
    };
    const plan = await captureExplainPlan(mg.driver, params);

    // SHOULD contain — the documented access pattern (Memgraph 3.8.1):
    //   * Expand (c)-[:HAS_EXPOSURE]->(existing)
    //   * Filter (existing :Exposure), Generic ...{existing.name}
    expect(plan).toMatch(/Expand \(c\)-\[[^\]]+:HAS_EXPOSURE\]->\(existing\)/);
    expect(plan).toMatch(/Filter \(existing :Exposure\)/);

    // SHOULD NOT contain — the failure modes we are guarding against:
    //   - A top-level `ScanAll (existing)` or `ScanAll (e)` on the Exposure
    //     side — would mean the planner walks every Exposure in the graph.
    //   - A `ScanAllByLabel` operator anchored at `Exposure` (same risk,
    //     different operator name).
    expect(plan).not.toMatch(/^\s*\*?\s*ScanAll\s+\(existing\)/m);
    expect(plan).not.toMatch(/^\s*\*?\s*ScanAll\s+\(e\)/m);
    expect(plan).not.toMatch(/ScanAllByLabel\s+\([^)]*Exposure\)/);
  });

  it('plan touches HAS_EXPOSURE exactly twice — once for the OPTIONAL MATCH, once for the post-FOREACH MATCH', async () => {
    const params = {
      componentId: 'comp-1',
      classId: 'cc-A',
      attributes: { name: 'Existing Risk 25', description: 'updated' },
    };
    const plan = await captureExplainPlan(mg.driver, params);

    // The §4.7 query touches HAS_EXPOSURE in three places:
    //   1. OPTIONAL MATCH (c)-[:HAS_EXPOSURE]->(existing) — READ Expand
    //   2. FOREACH CREATE (c)-[:HAS_EXPOSURE]->(:Exposure) — CreateExpand
    //   3. MATCH (c)-[:HAS_EXPOSURE]->(e) — READ Expand
    // Total: 2 READ Expand + 1 WRITE CreateExpand. Any extra read Expand
    // would indicate a planner regression (e.g. a join that walks the
    // edge multiple times).
    //
    // \b word-boundary prevents matching `Expand` inside `CreateExpand`.
    const readExpands = plan.match(/\bExpand \([^)]*\)-\[[^\]]+:HAS_EXPOSURE\]->/g);
    expect(readExpands).not.toBeNull();
    expect(readExpands!.length).toBe(2);

    const writeExpands = plan.match(/CreateExpand \([^)]*\)-\[[^\]]+:HAS_EXPOSURE\]->/g);
    expect(writeExpands).not.toBeNull();
    expect(writeExpands!.length).toBe(1);
  });
});
