// runAnalysis against an orphaned class must produce a clean
// CLASS_RETIRED error rather than a misleading ANALYSIS_NOT_FOUND.
//
// Tests just the orphan-check path inside getAnalysisClassAndModule
// via raw Cypher (no NestJS bootstrap of the full analysis-resolver
// service — its DI graph is too large to wire up here).

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(60_000);

// Mirror the two queries from getAnalysisClassAndModule.
async function lookupActive(driver: any, analysisId: string) {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeRead((tx: any) =>
      tx.run(
        `MATCH (a:Analysis {id: $analysisId})
         MATCH (a)<-[:ANALYZED_BY]-(e)
         MATCH (a)-[:IS_INSTANCE_OF]->(c:AnalysisClass)
         MATCH (c)<-[:HAS_CLASS]-(m:Module)
         RETURN c.id AS analysisClassId, m.name AS moduleName, e.id AS elementId`,
        { analysisId },
      ),
    );
  } finally {
    await session.close();
  }
}

async function lookupOrphan(driver: any, analysisId: string) {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeRead((tx: any) =>
      tx.run(
        `MATCH (a:Analysis {id: $analysisId})-[:IS_INSTANCE_OF]->(c:AnalysisClass)
                                              <-[:HAS_ORPHANED_CLASS]-(m:Module)
         RETURN c.name AS className, m.name AS moduleName LIMIT 1`,
        { analysisId },
      ),
    );
  } finally {
    await session.close();
  }
}

describe('runAnalysis CLASS_RETIRED path', () => {
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

  // Seed: Module → HAS_ORPHANED_CLASS → AnalysisClass ← IS_INSTANCE_OF ← Analysis ← ANALYZED_BY ← Element
  const seedOrphanedAnalysis = async (
    moduleName: string,
    className: string,
    classId: string,
    analysisId: string,
    elementId: string,
  ) => {
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      await session.executeWrite((tx: any) =>
        tx.run(
          `CREATE (m:Module {name: $moduleName, id: 'mod-id'})
           CREATE (c:AnalysisClass {id: $classId, name: $className})
           CREATE (m)-[:HAS_ORPHANED_CLASS]->(c)
           CREATE (e:Element {id: $elementId})
           CREATE (a:Analysis {id: $analysisId})
           CREATE (e)-[:ANALYZED_BY]->(a)
           CREATE (a)-[:IS_INSTANCE_OF]->(c)`,
          { moduleName, className, classId, analysisId, elementId },
        ),
      );
    } finally {
      await session.close();
    }
  };

  it('active query returns 0 records for orphaned class (the routing change)', async () => {
    await seedOrphanedAnalysis('mod-studio', 'Generate', 'class-1', 'an-1', 'el-1');
    const result = await lookupActive(mg.driver, 'an-1');
    expect(result.records).toHaveLength(0);
  });

  it('orphan-check query returns the retired class + module name', async () => {
    await seedOrphanedAnalysis('mod-studio', 'Generate Class', 'class-1', 'an-1', 'el-1');
    const result = await lookupOrphan(mg.driver, 'an-1');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('className')).toBe('Generate Class');
    expect(result.records[0].get('moduleName')).toBe('mod-studio');
  });

  it('orphan-check returns empty for a truly absent analysis', async () => {
    // No seed at all
    const result = await lookupOrphan(mg.driver, 'an-doesnt-exist');
    expect(result.records).toHaveLength(0);
  });

  it('orphan-check ignores active classes (only matches HAS_ORPHANED_CLASS)', async () => {
    // Active path, NOT orphaned
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      await session.executeWrite((tx: any) =>
        tx.run(
          `CREATE (m:Module {name: 'mod-active', id: 'mod-id'})
           CREATE (c:AnalysisClass {id: 'class-A', name: 'Active'})
           CREATE (m)-[:HAS_CLASS]->(c)
           CREATE (e:Element {id: 'el-1'})
           CREATE (a:Analysis {id: 'an-1'})
           CREATE (e)-[:ANALYZED_BY]->(a)
           CREATE (a)-[:IS_INSTANCE_OF]->(c)`,
        ),
      );
    } finally {
      await session.close();
    }
    // Active query succeeds
    const active = await lookupActive(mg.driver, 'an-1');
    expect(active.records).toHaveLength(1);
    // Orphan-check returns nothing (correct — class is active)
    const orphan = await lookupOrphan(mg.driver, 'an-1');
    expect(orphan.records).toHaveLength(0);
  });
});
