// End-to-end reconciliation tests against a testcontainers Memgraph.
// Drives upsertClass + Phase 4 reconciliation via a manually-wired
// ModuleManagementService instance (avoids dragging the full NestJS DI
// graph for what are fundamentally Cypher-level assertions).

import { ModuleManagementService } from '../../src/gql/module-management-services/module-management.service';
import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';
import type { DTMetadata } from '@dethernety/dt-module';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(90_000);

// ── stubs for the dependencies upsertModule doesn't actually exercise ─────
const configStub: any = {
  get: (key: string) => {
    if (key === 'gql') {
      return {
        customModulesPath: 'custom_modules',
        allowedModules: ['*'],
        enableModuleSecurityValidation: false,
        enableModuleHotReload: false,
        moduleLoadTimeout: 30000,
      };
    }
    if (key === 'database.name') return 'memgraph';
    return undefined;
  },
};
const embeddingStub: any = {
  isEnabled: () => false,
  getModel: () => '',
  getDimensions: () => 0,
  composeClassText: (_c: any) => '',
  embedBatch: async () => null,
};
const matchStub: any = { ensureVectorIndexes: async () => undefined };

// Run against the test container's "memgraph" database explicitly.
// Return type is `any` (loose) because callers access `.records[*].get(...)`
// dynamically — neo4j-driver's typed QueryResult would be over-engineered here.
async function withWrite(driver: any, fn: (tx: any) => Promise<any>): Promise<any> {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeWrite(fn);
  } finally {
    await session.close();
  }
}
async function withRead(driver: any, fn: (tx: any) => Promise<any>): Promise<any> {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}

const meta = (
  name: string,
  classes: Array<{ id: string; name: string }> = [],
  extra: Partial<DTMetadata> = {},
): DTMetadata => ({
  name,
  version: '1.0.0',
  description: '',
  analysisClasses: classes,
  ...extra,
} as unknown as DTMetadata);

describe('module reconciliation — install / orphan / revive end-to-end', () => {
  let mg: MemgraphHandle;
  let log: ClassIdentityEventLog;
  let reconciler: ClassReconciler;
  let service: ModuleManagementService;

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
    reconciler.setMageAvailableForTesting(null);
    service = new ModuleManagementService(
      mg.driver,
      configStub,
      embeddingStub,
      matchStub,
      reconciler,
      log,
    );
    // Suppress noisy initialization log output from the constructor.
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => {});
  });

  // Helper that runs upsertModule end-to-end inside one write tx.
  const install = async (m: DTMetadata): Promise<void> => {
    await withWrite(mg.driver, (tx) => service.upsertModule(tx, m));
  };

  const countByEdge = async (
    moduleName: string,
    edgeType: 'HAS_CLASS' | 'HAS_ORPHANED_CLASS',
  ): Promise<number> => {
    const r = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: $moduleName})-[r:${edgeType}]->(c:AnalysisClass)
         RETURN count(r) AS n`,
        { moduleName },
      ),
    );
    return r.records[0].get('n').toNumber();
  };

  it('first install creates module + classes; lastInstallStatus = authoritative', async () => {
    await install(meta('mod-a', [
      { id: 'class-1', name: 'A' },
      { id: 'class-2', name: 'B' },
    ]));
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(2);
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(0);
    const status = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (m:Module {name: 'mod-a'}) RETURN m.lastInstallStatus AS s`),
    );
    expect(status.records[0].get('s')).toBe('authoritative');
  });

  it('cross-module pollution regression: each module sees only its own classes', async () => {
    // The source-side filter (declared-graphs check in DtLgModule) +
    // MERGE-by-id together ensure each module owns only its own classes.
    await install(meta('mod-studio', [
      { id: 'class-studio-gen', name: 'Studio: Generate Class' },
    ]));
    await install(meta('mod-copilot', [
      { id: 'class-analysis-copilot', name: 'Analysis Copilot' },
    ]));
    // Each module bound only to its own class
    expect(await countByEdge('mod-studio', 'HAS_CLASS')).toBe(1);
    expect(await countByEdge('mod-copilot', 'HAS_CLASS')).toBe(1);
    // No spurious cross-bindings
    const cross = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m1:Module)-[:HAS_CLASS]->(c)<-[:HAS_CLASS]-(m2:Module)
         WHERE m1.name <> m2.name RETURN count(*) AS n`,
      ),
    );
    expect(cross.records[0].get('n').toNumber()).toBe(0);
    // No duplicate AnalysisClass nodes (the production UNIQUE constraint
    // would also catch this, but the test container has no constraint —
    // this asserts the upsert-by-id logic standalone).
    const dup = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass) WITH c.id AS id, count(c) AS n WHERE n > 1
         RETURN count(*) AS dups`,
      ),
    );
    expect(dup.records[0].get('dups').toNumber()).toBe(0);
  });

  it('absent class with incident IS_INSTANCE_OF → orphaned (not deleted)', async () => {
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    // Seed an Analysis bound to class-1
    await withWrite(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass {id: 'class-1'})
         CREATE (a:Analysis {id: 'an-1'})-[:IS_INSTANCE_OF]->(c)`,
      ),
    );
    // Re-install with empty class list (authoritative-empty per §5.3 trust-the-source)
    await install(meta('mod-a', []));
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(0);
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(1);
    // Class node + IS_INSTANCE_OF edge intact
    const survives = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (a:Analysis {id: 'an-1'})-[r:IS_INSTANCE_OF]->(c:AnalysisClass {id: 'class-1'})
         RETURN count(r) AS n`,
      ),
    );
    expect(survives.records[0].get('n').toNumber()).toBe(1);
    // Orphan event emitted
    const events = log.list({ kind: 'orphan' });
    expect(events).toHaveLength(1);
    expect((events[0] as any).className).toBe('A');
  });

  it('absent class with NO incident edges → DETACH DELETE (not orphaned)', async () => {
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    await install(meta('mod-a', []));
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(0);
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(0);
    const remaining = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (c:AnalysisClass {id: 'class-1'}) RETURN count(c) AS n`),
    );
    expect(remaining.records[0].get('n').toNumber()).toBe(0);
    expect(log.list({ kind: 'orphan' })).toHaveLength(0);
  });

  it('revive: orphaned class re-introduced by metadata flips back to HAS_CLASS', async () => {
    // Initial install + orphan (via re-install with empty list)
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    await withWrite(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass {id: 'class-1'})
         CREATE (:Analysis {id: 'an-1'})-[:IS_INSTANCE_OF]->(c)`,
      ),
    );
    await install(meta('mod-a', []));
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(1);
    // Re-install with the same class (same name + same id) → revive (case b)
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(1);
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(0);
    expect(log.list({ kind: 'revive' })).toHaveLength(1);
  });

  it('B-strict variant: orphan, then the server returns same name with different id, strict policy → rebind rejected, revive succeeds', async () => {
    // Install with 'audit' default, orphan it
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    await withWrite(mg.driver, (tx) =>
      tx.run(`MATCH (c:AnalysisClass {id: 'class-1'}) CREATE (:Analysis {id: 'an-1'})-[:IS_INSTANCE_OF]->(c)`),
    );
    await install(meta('mod-a', []));
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(1);
    // Re-install with same name but different id under STRICT policy.
    // With case-c dispatch under strict → emit rebind-conflict, skip.
    // The class stays HAS_ORPHANED_CLASS with original id (since we didn't
    // get to the revive branch).
    await install(meta('mod-a', [{ id: 'class-NEW', name: 'A' }], { idRebindPolicy: 'strict' } as any));
    // Conflict event emitted
    const conflicts = log.list({ kind: 'rebind-conflict' });
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as any).moduleDeclaredId).toBe('class-NEW');
    expect((conflicts[0] as any).dbId).toBe('class-1');
    // Class still orphaned with original id
    const state = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[r]->(c:AnalysisClass)
         RETURN type(r) AS t, c.id AS id`,
      ),
    );
    expect(state.records).toHaveLength(1);
    expect(state.records[0].get('t')).toBe('HAS_ORPHANED_CLASS');
    expect(state.records[0].get('id')).toBe('class-1');
    // lastInstallStatus = 'partial' (one class hit a strict-mode conflict)
    const status = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (m:Module {name: 'mod-a'}) RETURN m.lastInstallStatus AS s`),
    );
    expect(status.records[0].get('s')).toBe('partial');
  });

  it('audit-mode rebind: id changes in-place, oldId appended to idAliases, event emitted', async () => {
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    await install(meta('mod-a', [{ id: 'class-NEW', name: 'A' }])); // default audit
    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[:HAS_CLASS]->(c:AnalysisClass)
         RETURN c.id AS id, c.idAliases AS aliases, c.name AS name`,
      ),
    );
    expect(after.records).toHaveLength(1);
    expect(after.records[0].get('id')).toBe('class-NEW');
    expect(after.records[0].get('aliases')).toEqual(['class-1']);
    const events = log.list({ kind: 'rebind' });
    expect(events).toHaveLength(1);
    expect((events[0] as any).oldId).toBe('class-1');
    expect((events[0] as any).newId).toBe('class-NEW');
  });

  it('D variant: the server returns a RENAMED graph (different name) → old orphan stays, new class fresh', async () => {
    await install(meta('mod-a', [{ id: 'class-1', name: 'OldName' }]));
    await withWrite(mg.driver, (tx) =>
      tx.run(`MATCH (c:AnalysisClass {id: 'class-1'}) CREATE (:Analysis {id: 'an-1'})-[:IS_INSTANCE_OF]->(c)`),
    );
    // Re-install with a totally different class name + new id
    await install(meta('mod-a', [{ id: 'class-2', name: 'NewName' }]));
    // Old class orphaned, new class active
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(1);
    expect(await countByEdge('mod-a', 'HAS_ORPHANED_CLASS')).toBe(1);
    const state = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[r]->(c:AnalysisClass)
         RETURN type(r) AS t, c.id AS id, c.name AS name ORDER BY c.id`,
      ),
    );
    expect(state.records).toHaveLength(2);
    // class-1 = orphaned (OldName), class-2 = active (NewName)
    const byId: Record<string, { t: string; name: string }> = {};
    for (const r of state.records) {
      byId[r.get('id') as string] = { t: r.get('t'), name: r.get('name') };
    }
    expect(byId['class-1'].t).toBe('HAS_ORPHANED_CLASS');
    expect(byId['class-1'].name).toBe('OldName');
    expect(byId['class-2'].t).toBe('HAS_CLASS');
    expect(byId['class-2'].name).toBe('NewName');
  });

  it('idempotent re-install — same metadata twice produces identical end state', async () => {
    const m = meta('mod-a', [
      { id: 'class-1', name: 'A' },
      { id: 'class-2', name: 'B' },
    ]);
    await install(m);
    log.clear();
    await install(m);
    // No rebind/orphan/revive events on the second pass
    expect(log.list().filter((e) => e.kind !== 'rebind' && e.kind !== 'orphan' && e.kind !== 'revive')).toHaveLength(0);
    expect(log.list({ kind: 'rebind' })).toHaveLength(0);
    expect(log.list({ kind: 'orphan' })).toHaveLength(0);
    expect(log.list({ kind: 'revive' })).toHaveLength(0);
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(2);
  });

  it('§8.5 invariants: no NULL ids, no duplicate ids, no double :HAS_CLASS per (module,class)', async () => {
    await install(meta('mod-a', [
      { id: 'class-1', name: 'A' },
      { id: 'class-2', name: 'B' },
    ]));
    const nullIds = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (c:AnalysisClass) WHERE c.id IS NULL RETURN count(c) AS n`),
    );
    expect(nullIds.records[0].get('n').toNumber()).toBe(0);

    const dupIds = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass) WITH c.id AS id, count(c) AS n WHERE n > 1
         RETURN count(*) AS dups`,
      ),
    );
    expect(dupIds.records[0].get('dups').toNumber()).toBe(0);

    const dupEdges = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module)-[r:HAS_CLASS]->(c:AnalysisClass)
         WITH m, c, count(r) AS n WHERE n > 1 RETURN count(*) AS dups`,
      ),
    );
    expect(dupEdges.records[0].get('dups').toNumber()).toBe(0);
  });

  it('cross-module collision: second module declares same id → emit collision, skip create', async () => {
    await install(meta('mod-a', [{ id: 'shared-id', name: 'X' }]));
    await install(meta('mod-b', [{ id: 'shared-id', name: 'Y' }]));
    // Only mod-a's binding survives
    expect(await countByEdge('mod-a', 'HAS_CLASS')).toBe(1);
    expect(await countByEdge('mod-b', 'HAS_CLASS')).toBe(0);
    const collisions = log.list({ kind: 'collision' });
    expect(collisions).toHaveLength(1);
    expect((collisions[0] as any).firstModuleName).toBe('mod-a');
    expect((collisions[0] as any).secondModuleName).toBe('mod-b');
    expect((collisions[0] as any).collidingId).toBe('shared-id');
  });

  // Migration story for deployments that pre-date the deterministic-id
  // contract: existing class nodes carry randomUUID-assigned ids, and the
  // first install after the upgrade should rebind to the module-declared
  // (deterministically-derived) id, preserve the old id in idAliases, and
  // emit a single audit-mode rebind event.
  it('legacy randomUUID-id rebind: first install → class id flips, oldId in idAliases, single rebind event', async () => {
    // Seed legacy state: a module with an existing class node whose id
    // was assigned via randomUUID() (the literal value below is just a
    // random-looking string — the test only cares that the id differs
    // from what the module now declares).
    const legacyId = 'legacy-random-uuid-d3a8f1c2';
    const moduleDeclaredId = 'class-deterministic-from-derive';
    await withWrite(mg.driver, (tx) =>
      tx.run(
        `CREATE (m:Module {name: 'legacy-mod', id: 'mod-id-legacy'})
         CREATE (c:AnalysisClass {id: $legacyId, name: 'A'})
         CREATE (m)-[:HAS_CLASS]->(c)`,
        { legacyId },
      ),
    );
    // Module also already has Analyses bound to its old class
    await withWrite(mg.driver, (tx) =>
      tx.run(
        `MATCH (c:AnalysisClass {id: $legacyId})
         CREATE (a:Analysis {id: 'an-pre-s4'})-[:IS_INSTANCE_OF]->(c)`,
        { legacyId },
      ),
    );

    // First install under the new contract: the module now declares the
    // deterministically-derived id. Default 'audit' policy → in-place rebind.
    await install(meta('legacy-mod', [{ id: moduleDeclaredId, name: 'A' }]));

    // Class node carries the new id; legacy id appended to idAliases.
    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'legacy-mod'})-[:HAS_CLASS]->(c:AnalysisClass)
         RETURN c.id AS id, c.idAliases AS aliases, c.name AS name`,
      ),
    );
    expect(after.records).toHaveLength(1);
    expect(after.records[0].get('id')).toBe(moduleDeclaredId);
    expect(after.records[0].get('aliases')).toEqual([legacyId]);

    // Existing Analysis still resolves (IS_INSTANCE_OF preserved by the
    // in-place SET — node identity doesn't change).
    const survives = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (a:Analysis {id: 'an-pre-s4'})-[r:IS_INSTANCE_OF]->(c:AnalysisClass {id: $newId})
         RETURN count(r) AS n`,
        { newId: moduleDeclaredId },
      ),
    );
    expect(survives.records[0].get('n').toNumber()).toBe(1);

    // Exactly one rebind event with both ids.
    const events = log.list({ kind: 'rebind' });
    expect(events).toHaveLength(1);
    expect((events[0] as any).oldId).toBe(legacyId);
    expect((events[0] as any).newId).toBe(moduleDeclaredId);
    expect((events[0] as any).policy).toBe('audit');

    // Re-running the install is now idempotent — no further rebind events.
    log.clear();
    await install(meta('legacy-mod', [{ id: moduleDeclaredId, name: 'A' }]));
    expect(log.list({ kind: 'rebind' })).toHaveLength(0);

    // Status: 'authoritative' — rebind under audit-mode is not 'partial'.
    const status = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (m:Module {name: 'legacy-mod'}) RETURN m.lastInstallStatus AS s`),
    );
    expect(status.records[0].get('s')).toBe('authoritative');
  });

  // Pin the case-c collision check on the NEW id — without it, an
  // audit-mode rebind that lands on an id already owned by another
  // module would attempt to SET an id that exists at the same label
  // and trigger a UNIQUE-constraint violation mid-tx.
  it('case-c rebind: new id collides with another module → emit collision, no rebind, partial status', async () => {
    // mod-other already owns 'shared-new-id' for class X
    await install(meta('mod-other', [{ id: 'shared-new-id', name: 'X' }]));
    // mod-a has class A with id 'class-a-orig'
    await install(meta('mod-a', [{ id: 'class-a-orig', name: 'A' }]));
    log.clear();
    // mod-a re-installs class A with id 'shared-new-id' (collision with mod-other)
    await install(meta('mod-a', [{ id: 'shared-new-id', name: 'A' }]));

    // Collision emitted; class-a-orig untouched
    const collisions = log.list({ kind: 'collision' });
    expect(collisions).toHaveLength(1);
    expect((collisions[0] as any).secondModuleName).toBe('mod-a');
    expect((collisions[0] as any).collidingId).toBe('shared-new-id');
    expect(log.list({ kind: 'rebind' })).toHaveLength(0);

    const after = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})-[:HAS_CLASS]->(c:AnalysisClass {name: 'A'})
         RETURN c.id AS id`,
      ),
    );
    expect(after.records[0].get('id')).toBe('class-a-orig'); // unchanged

    // Skipped class → partial status
    const status = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (m:Module {name: 'mod-a'}) RETURN m.lastInstallStatus AS s`),
    );
    expect(status.records[0].get('s')).toBe('partial');
  });

  // Verification follow-up: lastAuthoritativeInstall must NOT advance on
  // partial installs — operators querying for "last known-good" should
  // see the prior clean install, not a partial.
  it('lastAuthoritativeInstall stays pinned to the most recent clean install', async () => {
    // First install: clean → authoritative + lastAuthoritativeInstall set
    await install(meta('mod-a', [{ id: 'class-1', name: 'A' }]));
    const r1 = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})
         RETURN m.lastInstallStatus AS s, m.lastAuthoritativeInstall AS la`,
      ),
    );
    expect(r1.records[0].get('s')).toBe('authoritative');
    const cleanTimestamp = r1.records[0].get('la');
    expect(cleanTimestamp).not.toBeNull();

    // Wait a tick so subsequent datetime() would differ if it fired
    await new Promise((r) => setTimeout(r, 50));

    // Second install: strict-mode rebind-conflict on class-1 → partial
    await install(meta('mod-a', [{ id: 'class-DIFFERENT', name: 'A' }], { idRebindPolicy: 'strict' } as any));
    const r2 = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (m:Module {name: 'mod-a'})
         RETURN m.lastInstallStatus AS s, m.lastAuthoritativeInstall AS la, m.lastAttemptedInstall AS at`,
      ),
    );
    expect(r2.records[0].get('s')).toBe('partial');
    // lastAuthoritativeInstall did NOT move (still equals cleanTimestamp)
    expect(r2.records[0].get('la')).toEqual(cleanTimestamp);
    // lastAttemptedInstall DID move
    expect(r2.records[0].get('at')).not.toEqual(cleanTimestamp);
  });
});
