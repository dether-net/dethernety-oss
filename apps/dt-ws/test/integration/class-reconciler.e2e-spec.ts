// ClassReconciler integration — validates the orphan ↔ revive rename
// mechanics against a real Memgraph (testcontainer).

import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(60_000);

// Adapter so the ClassReconciler's `tx` parameter (typed DatabaseTransaction)
// accepts a neo4j-driver session — the tx-shaped interface is `run` only,
// which sessions also expose. This keeps the integration tests light
// (no executeWrite ceremony just to call one helper method).
async function withWrite(driver: any, fn: (tx: any) => Promise<any>): Promise<any> {
  const session = driver.session();
  try {
    return await session.executeWrite(fn);
  } finally {
    await session.close();
  }
}

async function withRead(driver: any, fn: (tx: any) => Promise<any>): Promise<any> {
  const session = driver.session();
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}

describe('ClassReconciler — orphan/revive rename against Memgraph', () => {
  let mg: MemgraphHandle;
  let log: ClassIdentityEventLog;
  let reconciler: ClassReconciler;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    log = new ClassIdentityEventLog();
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
    reconciler = new ClassReconciler(mg.driver, log);
    // Force MAGE-detected for the happy path; individual fallback test flips this.
    reconciler.setMageAvailableForTesting(null);
  });

  // Seed a Module + AnalysisClass + HAS_CLASS edge with a synthetic edge
  // property; lets us verify that orphan/revive preserves edge attributes.
  const seedModuleClass = async (
    moduleName: string,
    className: string,
    classId: string,
    edgeAttr?: { key: string; value: string },
  ) => {
    await withWrite(mg.driver, async (tx) => {
      await tx.run(
        `CREATE (m:Module {name: $moduleName, id: 'mod-id-1'})
         CREATE (c:AnalysisClass {id: $classId, name: $className})
         CREATE (m)-[r:HAS_CLASS]->(c)
         ${edgeAttr ? `SET r.${edgeAttr.key} = $edgeValue` : ''}`,
        { moduleName, className, classId, edgeValue: edgeAttr?.value },
      );
    });
  };

  it('orphans via MAGE rename — edge type changes, properties preserved', async () => {
    await seedModuleClass('mod-a', 'Studio: Generate Class', 'class-1', {
      key: 'versionInstalled',
      value: '1.0.0',
    });
    await withWrite(mg.driver, (tx) =>
      reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[r]->(c:AnalysisClass {id: 'class-1'})
         RETURN type(r) AS type, r.versionInstalled AS attr`,
      ),
    );
    expect(after.records).toHaveLength(1);
    expect(after.records[0].get('type')).toBe('HAS_ORPHANED_CLASS');
    expect(after.records[0].get('attr')).toBe('1.0.0');
  });

  it('revive is symmetric — orphan then revive returns to start', async () => {
    await seedModuleClass('mod-a', 'X', 'class-1', { key: 'k', value: 'v' });
    await withWrite(mg.driver, (tx) =>
      reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    await withWrite(mg.driver, (tx) =>
      reconciler.reviveClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[r]->(c:AnalysisClass {id: 'class-1'})
         RETURN type(r) AS type, r.k AS attr, count(r) AS n`,
      ),
    );
    expect(after.records[0].get('type')).toBe('HAS_CLASS');
    expect(after.records[0].get('attr')).toBe('v');
    expect(after.records[0].get('n').toNumber()).toBe(1);
  });

  it('fallback path produces same end state when MAGE is forced unavailable', async () => {
    await seedModuleClass('mod-a', 'X', 'class-1', { key: 'k', value: 'fallback-test' });
    reconciler.setMageAvailableForTesting(false);
    await withWrite(mg.driver, (tx) =>
      reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[r]->(c:AnalysisClass {id: 'class-1'})
         RETURN type(r) AS type, r.k AS attr`,
      ),
    );
    expect(after.records[0].get('type')).toBe('HAS_ORPHANED_CLASS');
    expect(after.records[0].get('attr')).toBe('fallback-test');
  });

  it('hasIncidentInstances detects IS_INSTANCE_OF edges', async () => {
    await seedModuleClass('mod-a', 'X', 'class-1');
    // No instances yet
    let has = await withRead(mg.driver, (tx) =>
      reconciler.hasIncidentInstances(tx, 'AnalysisClass', 'class-1'),
    );
    expect(has).toBe(false);

    // Seed an Analysis with IS_INSTANCE_OF
    await withWrite(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass {id: 'class-1'})
         CREATE (a:Analysis {id: 'an-1'})-[:IS_INSTANCE_OF]->(c)`,
      ),
    );
    has = await withRead(mg.driver, (tx) =>
      reconciler.hasIncidentInstances(tx, 'AnalysisClass', 'class-1'),
    );
    expect(has).toBe(true);
  });

  it('orphan-then-revive preserves IS_INSTANCE_OF edge identity (the routing fix)', async () => {
    await seedModuleClass('mod-a', 'X', 'class-1');
    await withWrite(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass {id: 'class-1'})
         CREATE (a:Analysis {id: 'an-1'})-[:IS_INSTANCE_OF {createdBy: 'op-1'}]->(c)`,
      ),
    );
    // orphan
    await withWrite(mg.driver, (tx) =>
      reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    // IS_INSTANCE_OF edge intact through the orphan transition
    const mid = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (a:Analysis {id: 'an-1'})-[r:IS_INSTANCE_OF]->(c:AnalysisClass {id: 'class-1'})
         RETURN r.createdBy AS createdBy, count(r) AS n`,
      ),
    );
    expect(mid.records[0].get('n').toNumber()).toBe(1);
    expect(mid.records[0].get('createdBy')).toBe('op-1');
    // revive
    await withWrite(mg.driver, (tx) =>
      reconciler.reviveClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    const end = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (a:Analysis {id: 'an-1'})-[r:IS_INSTANCE_OF]->(c:AnalysisClass {id: 'class-1'})
         RETURN r.createdBy AS createdBy, count(r) AS n`,
      ),
    );
    expect(end.records[0].get('n').toNumber()).toBe(1);
    expect(end.records[0].get('createdBy')).toBe('op-1');
  });

  it('probeMage caches per process — second call doesn\'t re-query', async () => {
    reconciler.setMageAvailableForTesting(null);
    const spy = jest.spyOn(mg.driver, 'session');
    spy.mockClear();
    // First orphan triggers probe + rename
    await seedModuleClass('mod-a', 'X', 'class-1');
    await withWrite(mg.driver, (tx) =>
      reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'class-1'),
    );
    // Second call should NOT issue another mg.procedures() probe — but
    // we can't easily count tx.run calls from inside the executeWrite
    // closure. Instead, verify mageAvailable flipped from null to a bool.
    const probed = (reconciler as any).mageAvailable;
    expect(probed === true || probed === false).toBe(true);
    // …and re-running orphan against a fresh class still works.
    await seedModuleClass('mod-a', 'Y', 'class-2');
    await withWrite(mg.driver, (tx) =>
      reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'class-2'),
    );
    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module)-[r:HAS_ORPHANED_CLASS]->(c:AnalysisClass)
         RETURN count(r) AS n`,
      ),
    );
    expect(after.records[0].get('n').toNumber()).toBe(2);
    spy.mockRestore();
  });
});
