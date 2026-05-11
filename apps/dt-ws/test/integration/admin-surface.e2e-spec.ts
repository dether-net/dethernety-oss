/**
 * End-to-end admin GraphQL surface tests against a testcontainers
 * Memgraph. Drives ClassIdentityResolverService directly (the GraphQL
 * wire layer is exercised by Apollo's own conformance suite; this file
 * covers the resolver's interaction with the actual graph DB).
 *
 * Cases:
 *   1. runIdentityMigration(dryRun: true) on a dirty fixture
 *   2. runIdentityMigration(dryRun: false) applies + idempotent re-run
 *   3. migrateClassId aligns id; cross-module collision check
 *   4. reviveOrphanedClass flips edge type back
 *   5. deleteOrphanedClass(cascade: false) refuses with incident edges
 *   6. deleteOrphanedClass(cascade: true) DETACH DELETEs class + instances
 *   7. Module.constraintsHealthy reflects EnsureConstraintsService state
 *   8. classIdentityEvents returns emitted events with shape
 *   9. Admin gate (rejected path) — non-admin context blocks mutation
 *   10. Orphan timestamp written by ClassReconciler.renameEdge during orphan
 *   11. migrateClassId on a non-existent (module, class) pair → NotFound
 */

import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Driver } from 'neo4j-driver';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { ClassIdentityResolverService } from '../../src/gql/resolver-services/class-identity-resolver.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';
import { ClassIdentityMigrationService } from '../../src/gql/module-management-services/class-identity-migration.service';
import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';

jest.setTimeout(120_000);

// ── DatabaseService stub bound to the testcontainer driver ─────────────
// Only the two methods the resolver + migration service use. Records are
// returned in the same shape the real DatabaseService produces (they're the
// raw neo4j-driver records).
function makeDbStub(driver: Driver) {
  return {
    async executeRead(query: string, parameters?: any) {
      const session = driver.session({ database: 'memgraph' });
      try {
        return await session.executeRead((tx) => tx.run(query, parameters));
      } finally {
        await session.close();
      }
    },
    async executeWrite(query: string, parameters?: any) {
      const session = driver.session({ database: 'memgraph' });
      try {
        return await session.executeWrite((tx) => tx.run(query, parameters));
      } finally {
        await session.close();
      }
    },
    async executeImplicitWrite(query: string, parameters?: any) {
      const session = driver.session({ database: 'memgraph' });
      try {
        return await session.run(query, parameters);
      } finally {
        await session.close();
      }
    },
  };
}

const adminCtx = { user: { sub: 'op-1', email: 'op@example.com', roles: ['admin'] } };
const nonAdminCtx = { user: { sub: 'u-1', email: 'u@example.com', roles: ['user'] } };

async function withWrite(driver: Driver, query: string, parameters?: any) {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeWrite((tx) => tx.run(query, parameters));
  } finally {
    await session.close();
  }
}

async function withRead(driver: Driver, query: string, parameters?: any) {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeRead((tx) => tx.run(query, parameters));
  } finally {
    await session.close();
  }
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}

describe('class-identity admin GraphQL surface — end-to-end against Memgraph', () => {
  let mg: MemgraphHandle;
  let svc: ClassIdentityResolverService;
  let events: ClassIdentityEventLog;
  let constraints: { isHealthy: jest.Mock };
  let migration: ClassIdentityMigrationService;
  let reconciler: ClassReconciler;
  let resolvers: ReturnType<ClassIdentityResolverService['getResolvers']>;
  let db: ReturnType<typeof makeDbStub>;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    events = new ClassIdentityEventLog();
    jest.spyOn((events as any).logger, 'warn').mockImplementation(() => {});
    db = makeDbStub(mg.driver);
    constraints = { isHealthy: jest.fn().mockReturnValue(true) };
    migration = new ClassIdentityMigrationService(db as any);
    jest.spyOn((migration as any).logger, 'log').mockImplementation(() => {});
    reconciler = new ClassReconciler(mg.driver, events);
    // Force the fallback path so the test doesn't depend on MAGE
    // probe interaction patterns — semantically equivalent for our purposes.
    reconciler.setMageAvailableForTesting(false);
    svc = new ClassIdentityResolverService(events, migration, constraints as any, db as any);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => {});
    resolvers = svc.getResolvers();
  });

  // ── Case 1: runIdentityMigration(dryRun: true) on dirty fixture ──────
  it('case 1 — runIdentityMigration dry-run reports planned actions, no writes', async () => {
    // Seed two duplicate AnalysisClass nodes with the same name.
    await withWrite(
      mg.driver,
      `MERGE (m:Module {name: 'mod-a'})
       CREATE (c1:AnalysisClass {id: 'id-1', name: 'DupName'})
       CREATE (c2:AnalysisClass {id: 'id-2', name: 'DupName'})
       CREATE (m)-[:HAS_CLASS]->(c1)
       CREATE (m)-[:HAS_CLASS]->(c2)`,
    );
    const before = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {name: 'DupName'}) RETURN count(c) AS n`,
    );
    expect(asNumber(before.records[0].get('n'))).toBe(2);

    const report = await resolvers.Mutation.runIdentityMigration({}, { dryRun: true }, adminCtx);
    expect(report.dryRun).toBe(true);
    expect(report.totalActions).toBeGreaterThan(0);

    // Re-check state — no writes happened.
    const after = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {name: 'DupName'}) RETURN count(c) AS n`,
    );
    expect(asNumber(after.records[0].get('n'))).toBe(2);
  });

  // ── Case 2: runIdentityMigration apply + idempotent re-run ───────────
  it('case 2 — runIdentityMigration apply collapses duplicates; re-run reports zero', async () => {
    await withWrite(
      mg.driver,
      `MERGE (m:Module {name: 'mod-a'})
       CREATE (c1:AnalysisClass {id: 'id-1', name: 'DupName'})
       CREATE (c2:AnalysisClass {id: 'id-2', name: 'DupName'})
       CREATE (c3:AnalysisClass {id: 'id-3', name: 'DupName'})
       CREATE (m)-[:HAS_CLASS]->(c1)
       CREATE (m)-[:HAS_CLASS]->(c2)
       CREATE (m)-[:HAS_CLASS]->(c3)`,
    );

    const apply = await resolvers.Mutation.runIdentityMigration({}, { dryRun: false }, adminCtx);
    expect(apply.dryRun).toBe(false);
    expect(apply.totalActions).toBe(2); // two non-canonical deletes

    const after = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {name: 'DupName'}) RETURN count(c) AS n`,
    );
    expect(asNumber(after.records[0].get('n'))).toBe(1);

    const reRun = await resolvers.Mutation.runIdentityMigration({}, { dryRun: true }, adminCtx);
    expect(reRun.totalActions).toBe(0);
  });

  // ── Case 3: migrateClassId aligns id ────────────────────────────────
  it('case 3 — migrateClassId aligns DB id to operator-supplied id; emits rebind event', async () => {
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_CLASS]->
       (c:AnalysisClass {id: 'old-id', name: 'MyClass'})`,
    );

    const result = await resolvers.Mutation.migrateClassId(
      {},
      {
        moduleName: 'mod-a',
        className: 'MyClass',
        classKind: 'AnalysisClass',
        newId: 'new-id',
      },
      adminCtx,
    );
    expect(result).toBe(true);

    const after = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {name: 'MyClass'})
       RETURN c.id AS id, c.idAliases AS aliases`,
    );
    expect(after.records[0].get('id')).toBe('new-id');
    expect(after.records[0].get('aliases')).toEqual(['old-id']);

    // Event surfaced into the in-memory log with the right shape.
    const rebinds = events.list({ kind: 'rebind', moduleName: 'mod-a' });
    expect(rebinds).toHaveLength(1);
    expect(rebinds[0]).toMatchObject({
      kind: 'rebind',
      moduleName: 'mod-a',
      className: 'MyClass',
      oldId: 'old-id',
      newId: 'new-id',
      policy: 'audit',
    });
  });

  // ── Case 3b: cross-module collision rejection ───────────────────────
  it('case 3b — migrateClassId refuses when newId is already owned by another module', async () => {
    await withWrite(
      mg.driver,
      `CREATE (a:Module {name: 'mod-a'})-[:HAS_CLASS]->(ca:AnalysisClass {id: 'a-id', name: 'A'})
       CREATE (b:Module {name: 'mod-b'})-[:HAS_CLASS]->(cb:AnalysisClass {id: 'b-id', name: 'B'})`,
    );
    await expect(
      resolvers.Mutation.migrateClassId(
        {},
        {
          moduleName: 'mod-a',
          className: 'A',
          classKind: 'AnalysisClass',
          newId: 'b-id',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Case 4: reviveOrphanedClass flips edge type ─────────────────────
  it('case 4 — reviveOrphanedClass renames HAS_ORPHANED_CLASS → HAS_CLASS; preserves orphanedAt', async () => {
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_ORPHANED_CLASS]->
       (c:AnalysisClass {id: 'c-1', name: 'Retired', orphanedAt: datetime()})`,
    );
    const orphaned = await withRead(
      mg.driver,
      `MATCH (m)-[r:HAS_ORPHANED_CLASS]->(c:AnalysisClass {id: 'c-1'})
       RETURN c.orphanedAt AS oa`,
    );
    expect(orphaned.records[0].get('oa')).not.toBeNull();

    const result = await resolvers.Mutation.reviveOrphanedClass(
      {},
      { classId: 'c-1', classKind: 'AnalysisClass' },
      adminCtx,
    );
    expect(result).toBe(true);

    const after = await withRead(
      mg.driver,
      `MATCH (m)-[r:HAS_CLASS]->(c:AnalysisClass {id: 'c-1'})
       RETURN type(r) AS rt, c.orphanedAt AS oa`,
    );
    expect(after.records[0].get('rt')).toBe('HAS_CLASS');
    // orphanedAt is intentionally NOT cleared on revive — operator-meaningful
    // "when did this class last fall out" is the most recent value, useful
    // until a future re-orphan overwrites.
    expect(after.records[0].get('oa')).not.toBeNull();

    // No HAS_ORPHANED_CLASS edge remains.
    const stale = await withRead(
      mg.driver,
      `MATCH ()-[r:HAS_ORPHANED_CLASS]->(c:AnalysisClass {id: 'c-1'})
       RETURN count(r) AS n`,
    );
    expect(asNumber(stale.records[0].get('n'))).toBe(0);
  });

  // ── Case 5: deleteOrphanedClass cascade=false refuses ───────────────
  it('case 5 — deleteOrphanedClass(cascade: false) with incident edges → BadRequest', async () => {
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_ORPHANED_CLASS]->
       (c:AnalysisClass {id: 'c-1', name: 'Retired'})
       CREATE (a1:Analysis {id: 'a-1'})-[:IS_INSTANCE_OF]->(c)
       CREATE (a2:Analysis {id: 'a-2'})-[:IS_INSTANCE_OF]->(c)`,
    );
    await expect(
      resolvers.Mutation.deleteOrphanedClass(
        {},
        { classId: 'c-1', classKind: 'AnalysisClass', cascade: false },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Class still exists.
    const still = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {id: 'c-1'}) RETURN count(c) AS n`,
    );
    expect(asNumber(still.records[0].get('n'))).toBe(1);
  });

  // ── Case 6: deleteOrphanedClass cascade=true succeeds ───────────────
  it('case 6 — deleteOrphanedClass(cascade: true) DETACH DELETEs class + instance nodes', async () => {
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_ORPHANED_CLASS]->
       (c:AnalysisClass {id: 'c-1', name: 'Retired'})
       CREATE (a1:Analysis {id: 'a-1'})-[:IS_INSTANCE_OF]->(c)
       CREATE (a2:Analysis {id: 'a-2'})-[:IS_INSTANCE_OF]->(c)`,
    );

    const result = await resolvers.Mutation.deleteOrphanedClass(
      {},
      { classId: 'c-1', classKind: 'AnalysisClass', cascade: true },
      adminCtx,
    );
    expect(result).toBe(true);

    const classGone = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {id: 'c-1'}) RETURN count(c) AS n`,
    );
    expect(asNumber(classGone.records[0].get('n'))).toBe(0);

    const instGone = await withRead(
      mg.driver,
      `MATCH (a:Analysis) WHERE a.id IN ['a-1', 'a-2'] RETURN count(a) AS n`,
    );
    expect(asNumber(instGone.records[0].get('n'))).toBe(0);

    // Module node survives.
    const modAlive = await withRead(
      mg.driver,
      `MATCH (m:Module {name: 'mod-a'}) RETURN count(m) AS n`,
    );
    expect(asNumber(modAlive.records[0].get('n'))).toBe(1);
  });

  // ── Case 7: Module.constraintsHealthy reflects state ────────────────
  it('case 7 — Module.constraintsHealthy reflects EnsureConstraintsService state', () => {
    constraints.isHealthy.mockReturnValue(true);
    expect(resolvers.Module.constraintsHealthy()).toBe(true);

    constraints.isHealthy.mockReturnValue(false);
    expect(resolvers.Module.constraintsHealthy()).toBe(false);
  });

  // ── Case 8: classIdentityEvents returns emitted events ──────────────
  it('case 8 — classIdentityEvents returns emitted events filtered by kind/moduleName', async () => {
    // Seed a class to migrate (so we get a real rebind event into the log).
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_CLASS]->
       (c:AnalysisClass {id: 'old-id', name: 'X'})`,
    );
    await resolvers.Mutation.migrateClassId(
      {},
      { moduleName: 'mod-a', className: 'X', classKind: 'AnalysisClass', newId: 'new-id' },
      adminCtx,
    );

    const all = resolvers.Query.classIdentityEvents({}, {}, adminCtx);
    expect(all.length).toBeGreaterThanOrEqual(1);

    const filtered = resolvers.Query.classIdentityEvents(
      {},
      { kind: 'rebind', moduleName: 'mod-a' },
      adminCtx,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ kind: 'rebind', moduleName: 'mod-a' });

    // Filter by a non-matching moduleName → empty.
    const empty = resolvers.Query.classIdentityEvents(
      {},
      { kind: 'rebind', moduleName: 'mod-other' },
      adminCtx,
    );
    expect(empty).toHaveLength(0);
  });

  // ── Case 9: admin gate blocks non-admin ─────────────────────────────
  it('case 9 — admin mutation rejected for non-admin context; no DB mutation occurs', async () => {
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_CLASS]->
       (c:AnalysisClass {id: 'old-id', name: 'X'})`,
    );

    await expect(
      resolvers.Mutation.migrateClassId(
        {},
        { moduleName: 'mod-a', className: 'X', classKind: 'AnalysisClass', newId: 'new-id' },
        nonAdminCtx,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Class id unchanged.
    const after = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {name: 'X'}) RETURN c.id AS id`,
    );
    expect(after.records[0].get('id')).toBe('old-id');
  });

  // ── Case 10: orphanedAt written on orphan rename ────────────────────
  it('case 10 — ClassReconciler.orphanClass stamps orphanedAt on the class node', async () => {
    await withWrite(
      mg.driver,
      `CREATE (m:Module {name: 'mod-a'})
       -[:HAS_CLASS]->
       (c:AnalysisClass {id: 'c-1', name: 'X'})`,
    );

    const beforeStamp = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {id: 'c-1'}) RETURN c.orphanedAt AS oa`,
    );
    expect(beforeStamp.records[0].get('oa')).toBeNull();

    // Drive the rename via the reconciler (the same path the install loop uses).
    const session = mg.driver.session({ database: 'memgraph' });
    try {
      await session.executeWrite((tx) => reconciler.orphanClass(tx, 'mod-a', 'AnalysisClass', 'c-1'));
    } finally {
      await session.close();
    }

    const afterStamp = await withRead(
      mg.driver,
      `MATCH (c:AnalysisClass {id: 'c-1'}) RETURN c.orphanedAt AS oa`,
    );
    expect(afterStamp.records[0].get('oa')).not.toBeNull();
  });

  // ── Case 11: migrateClassId NotFound for missing pair ───────────────
  it('case 11 — migrateClassId on a non-existent (module, class) pair → NotFoundException', async () => {
    await expect(
      resolvers.Mutation.migrateClassId(
        {},
        { moduleName: 'ghost', className: 'nope', classKind: 'AnalysisClass', newId: 'new-id' },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
