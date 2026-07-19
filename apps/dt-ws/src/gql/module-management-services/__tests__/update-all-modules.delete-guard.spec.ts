import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { MatchClassesResolverService } from '../../resolver-services/match-classes-resolver.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// Minimal :Module record stub for the content-hash read (.get(field)).
const rec = (
  name: string,
  contentHash: string | null = null,
  lastInstallStatus: string | null = 'authoritative',
) => ({
  get: (k: string) =>
    (({ name, contentHash, lastInstallStatus }) as Record<string, unknown>)[k],
});

// Driver whose executeRead returns the given :Module rows for the content-hash
// gate and whose executeWrite runs the callback against a shared writeTx. The
// executeWrite jest.fn is stable across the whole updateAllModules call, so a
// test can count how many write transactions were opened (per-module split).
function makeDriver(installRows: ReturnType<typeof rec>[] = []) {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  const executeWrite = jest.fn(async (cb: any) => cb(writeTx));
  const executeRead = jest.fn(async (cb: any) =>
    cb({ run: async () => ({ records: installRows }) }),
  );
  const session = { executeWrite, executeRead, close: jest.fn(async () => {}) };
  return { driver: { session: () => session }, executeWrite, executeRead, writeTx };
}

async function buildService(driver: any): Promise<ModuleManagementService> {
  const embedding: Partial<EmbeddingService> = {
    isEnabled: jest.fn(() => true),
    getDimensions: jest.fn(() => 3),
    getModel: jest.fn(() => 'nomic-embed-text'),
  };
  const matchClasses: Partial<MatchClassesResolverService> = {
    ensureVectorIndexes: jest.fn(async () => {}),
  };
  const reconciler = {
    hasIncidentInstances: async () => false,
  } as unknown as ClassReconciler;

  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleManagementService,
      { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      { provide: EmbeddingService, useValue: embedding },
      { provide: MatchClassesResolverService, useValue: matchClasses },
      { provide: 'NEO4J_DRIVER', useValue: driver },
      { provide: ClassReconciler, useValue: reconciler },
      { provide: ClassIdentityEventLog, useValue: new ClassIdentityEventLog() },
    ],
  }).compile();

  return mod.get(ModuleManagementService);
}

const fakeModule = (name: string) =>
  ({ getMetadata: async () => ({ name }) }) as any;

describe('ModuleManagementService.updateAllModules — obsolescence sweep guard', () => {
  it('protects a transiently-failed module from deletion (delete guard)', async () => {
    const { driver } = makeDriver([]); // no existing :Module rows → no skip-gate
    const svc = await buildService(driver);

    // B's embedding resolution blips this boot; A resolves fine.
    jest.spyOn(svc as any, 'resolveVectors').mockImplementation(
      async (metadata: any) => {
        if (metadata.name === 'B') throw new Error('embedding endpoint hiccup');
        return null;
      },
    );
    jest.spyOn(svc as any, 'upsertModule').mockImplementation(
      async (_tx: any, metadata: any) => ({
        moduleId: 'id',
        moduleName: metadata.name,
        classesProcessed: 0,
        duration: 0,
      }),
    );
    const deleteOldModules = jest
      .spyOn(svc as any, 'deleteOldModules')
      .mockResolvedValue(undefined);

    await expect(
      svc.updateAllModules(
        new Map([
          ['A', fakeModule('A')],
          ['B', fakeModule('B')],
        ]),
      ),
    ).resolves.toBeUndefined();

    // The sweep is handed the on-disk (attempted) set — B included — so the
    // blipped-but-present module is never treated as obsolete.
    expect(deleteOldModules).toHaveBeenCalledTimes(1);
    const validNames = deleteOldModules.mock.calls[0][1] as string[];
    expect(validNames).toContain('A');
    expect(validNames).toContain('B');
  });

  it('isolates a poisoned module in its own tx — others still commit, no crash', async () => {
    const { driver, executeWrite } = makeDriver([]);
    const svc = await buildService(driver);

    jest.spyOn(svc as any, 'resolveVectors').mockResolvedValue(null);
    jest.spyOn(svc as any, 'upsertModule').mockImplementation(
      async (_tx: any, metadata: any) => {
        if (metadata.name === 'B') throw new Error('constraint abort');
        return { moduleId: 'id', moduleName: metadata.name, classesProcessed: 0, duration: 0 };
      },
    );
    jest.spyOn(svc as any, 'deleteOldModules').mockResolvedValue(undefined);
    const afterInstall = jest
      .spyOn(svc as any, 'runAfterInstall')
      .mockResolvedValue(undefined);

    await expect(
      svc.updateAllModules(
        new Map([
          ['A', fakeModule('A')],
          ['B', fakeModule('B')],
        ]),
      ),
    ).resolves.toBeUndefined();

    // The discriminating assertion: one write tx PER resolved module (A, B) +
    // one for the sweep = 3. Pre-fix this was a single shared tx (1 call), so
    // the count is what proves the split — a real DB abort in B's tx can only
    // roll back B's own tx, never A's. (The afterInstall check below is a
    // secondary sanity signal, not the isolation proof: it also held pre-fix,
    // where B's in-callback throw was caught and only A reached modulesInstalled.)
    expect(executeWrite).toHaveBeenCalledTimes(3);
    const installed = afterInstall.mock.calls.map((c) => c[1]);
    expect(installed).toContain('A');
    expect(installed).not.toContain('B');
  });

  it('never opens a sweep tx when no modules are on disk (empty map guard)', async () => {
    // The most destructive scenario: if module discovery wholesale-fails and
    // the map is empty, the sweep must NOT run — deleteOldModules([]) would
    // compute (DB - []) = every module and DETACH DELETE the entire graph.
    const { driver, executeWrite } = makeDriver([]);
    const svc = await buildService(driver);
    const deleteOldModules = jest
      .spyOn(svc as any, 'deleteOldModules')
      .mockResolvedValue(undefined);

    await expect(svc.updateAllModules(new Map())).resolves.toBeUndefined();

    expect(deleteOldModules).not.toHaveBeenCalled();
    expect(executeWrite).not.toHaveBeenCalled();
  });
});

describe('ModuleManagementService.deleteOldModules — obsolescence semantics', () => {
  // Fake tx: first run() answers the "existing modules" read; a DETACH DELETE
  // run() is recorded for assertion.
  function makeTx(existing: string[]) {
    const run = jest.fn(async (q: string) => {
      if (q.includes('RETURN p.name AS name')) {
        return { records: existing.map((n) => ({ get: (k: string) => (k === 'name' ? n : undefined) })) };
      }
      return { records: [] };
    });
    return { run };
  }
  const deleteRuns = (tx: { run: jest.Mock }) =>
    tx.run.mock.calls.filter((c) => String(c[0]).includes('DETACH DELETE'));

  it('deletes nothing when every DB module is still present on disk', async () => {
    const svc = await buildService(makeDriver([]).driver);
    const tx = makeTx(['A', 'B']);
    await (svc as any).deleteOldModules(tx, ['A', 'B']);
    expect(deleteRuns(tx)).toHaveLength(0);
  });

  it('deletes a module that no longer exists on disk', async () => {
    const svc = await buildService(makeDriver([]).driver);
    const tx = makeTx(['A', 'B']);
    await (svc as any).deleteOldModules(tx, ['A']);
    const calls = deleteRuns(tx);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ modulesToDelete: ['B'] });
  });
});

describe('ModuleManagementService.upsertClass — same-module id collision backstop', () => {
  // A same-label duplicate id within one module is handled GRACEFULLY (skip the
  // offending class + emit a collision event), NOT by rejecting the whole
  // module. This is the backstop that replaced the removed pre-emptive throw:
  // the module's other classes still install and it downgrades to 'partial'.
  //
  // The ONE same-module case that is NOT a collision: a rename with a stable
  // id (the colliding node's old name is absent from the incoming metadata's
  // declaredNames) — that updates the node in place instead of skipping.
  // Without declaredNames the cases are indistinguishable → conservative skip.

  // Fake tx for the case-(d) path: lookup-by-name → not found; collision-by-id
  // → found, owned by `owner` under `oldName` via `edgeType`.
  function makeCollisionTx(owner: string, oldName?: string, edgeType = 'HAS_CLASS') {
    return {
      run: jest.fn(async (q: string) => {
        if (String(q).includes('otherModule')) {
          return {
            records: [
              {
                get: (k: string) =>
                  (({ otherModule: owner, oldName, edgeType }) as Record<string, unknown>)[k],
              },
            ],
          };
        }
        return { records: [] };
      }),
    };
  }
  const createRuns = (tx: { run: jest.Mock }) =>
    tx.run.mock.calls.filter((c) => String(c[0]).includes('CREATE'));
  const setRuns = (tx: { run: jest.Mock }) =>
    tx.run.mock.calls.filter((c) => String(c[0]).includes('SET c +='));

  it('skips a class whose id already belongs to this module — no CREATE, no throw', async () => {
    const svc = await buildService(makeDriver([]).driver);
    // No declaredNames supplied → indeterminate → conservative skip.
    const tx = makeCollisionTx('M');

    const result = await (svc as any).upsertClass(
      tx,
      'M',
      { id: 'dup-id', name: 'Second' },
      'ComponentClass',
    );

    expect(result).toBe('skipped');
    expect(createRuns(tx)).toHaveLength(0); // the colliding class is not written
  });

  it('double-declaration (old name still declared) stays a collision-skip', async () => {
    const svc = await buildService(makeDriver([]).driver);
    const tx = makeCollisionTx('M', 'First');

    const result = await (svc as any).upsertClass(
      tx,
      'M',
      { id: 'dup-id', name: 'Second' },
      'ComponentClass',
      undefined,
      undefined,
      new Set(['First', 'Second']), // 'First' is still on disk → duplicate id, not a rename
    );

    expect(result).toBe('skipped');
    expect(createRuns(tx)).toHaveLength(0);
    expect(setRuns(tx)).toHaveLength(0); // renaming here would destroy First's registration
    const events = (svc as any).events.list({ kind: 'collision' });
    expect(events).toHaveLength(1);
  });

  it('rename with a stable id (old name gone from metadata) updates in place', async () => {
    const svc = await buildService(makeDriver([]).driver);
    const tx = makeCollisionTx('M', 'Foo');

    const result = await (svc as any).upsertClass(
      tx,
      'M',
      { id: 'stable-id', name: 'Bar' },
      'ComponentClass',
      undefined,
      undefined,
      new Set(['Bar']), // 'Foo' is NOT declared any more → rename
    );

    expect(result).toBe('applied');
    expect(createRuns(tx)).toHaveLength(0); // no second node — the id stays unique
    expect(setRuns(tx)).toHaveLength(1); // properties (incl. the new name) SET on the existing node
    const renames = (svc as any).events.list({ kind: 'rename' });
    expect(renames).toEqual([
      expect.objectContaining({
        moduleName: 'M',
        classKind: 'componentClasses',
        className: 'Bar',
        oldName: 'Foo',
        classId: 'stable-id',
      }),
    ]);
    expect((svc as any).events.list({ kind: 'collision' })).toHaveLength(0);
  });

  it('re-install after a rename is idempotent — case (a), no collision query', async () => {
    const svc = await buildService(makeDriver([]).driver);
    // Next boot: lookup-by-name now FINDS the renamed node under 'Bar' with
    // the same id → clean idempotent update, the collision path never runs.
    const tx = {
      run: jest.fn(async (q: string) => {
        if (String(q).includes('type(r) AS edgeType') && String(q).includes('dbId')) {
          return {
            records: [
              {
                get: (k: string) =>
                  (({ dbId: 'stable-id', edgeType: 'HAS_CLASS' }) as Record<string, unknown>)[k],
              },
            ],
          };
        }
        return { records: [] };
      }),
    };

    const result = await (svc as any).upsertClass(
      tx,
      'M',
      { id: 'stable-id', name: 'Bar' },
      'ComponentClass',
      undefined,
      undefined,
      new Set(['Bar']),
    );

    expect(result).toBe('applied');
    const collisionQueries = tx.run.mock.calls.filter((c) => String(c[0]).includes('otherModule'));
    expect(collisionQueries).toHaveLength(0);
    expect((svc as any).events.list({ kind: 'rename' })).toHaveLength(0);
  });

  it('rename of an ORPHANED node revives it first (the wedge regression)', async () => {
    // The wedge: boot 1 skipped the rename as a collision, Phase 4 orphaned the
    // old name (it had instances) — pre-fix every later boot kept skipping
    // against the orphan, leaving the renamed class uninstallable forever.
    const driver = makeDriver([]).driver;
    const svc = await buildService(driver);
    const revive = jest.fn(async () => {});
    (svc as any).classReconciler.reviveClass = revive;
    const tx = makeCollisionTx('M', 'Foo', 'HAS_ORPHANED_CLASS');

    const result = await (svc as any).upsertClass(
      tx,
      'M',
      { id: 'stable-id', name: 'Bar' },
      'ComponentClass',
      undefined,
      undefined,
      new Set(['Bar']),
    );

    expect(result).toBe('applied');
    expect(revive).toHaveBeenCalledWith(tx, 'M', 'ComponentClass', 'stable-id');
    // Revive must precede the property SET — the boot that applies the
    // rename must also end with the class active.
    const reviveOrder = revive.mock.invocationCallOrder[0];
    const setCall = tx.run.mock.calls.findIndex((c) => String(c[0]).includes('SET c +='));
    expect(setCall).toBeGreaterThanOrEqual(0);
    const setOrder = tx.run.mock.invocationCallOrder[setCall];
    expect(reviveOrder).toBeLessThan(setOrder);
    expect((svc as any).events.list({ kind: 'revive' })).toHaveLength(1);
    expect((svc as any).events.list({ kind: 'rename' })).toHaveLength(1);
  });

  it('foreign-module id owner is still a collision even with declaredNames', async () => {
    const svc = await buildService(makeDriver([]).driver);
    const tx = makeCollisionTx('OtherModule', 'Foo');

    const result = await (svc as any).upsertClass(
      tx,
      'M',
      { id: 'their-id', name: 'Bar' },
      'ComponentClass',
      undefined,
      undefined,
      new Set(['Bar']),
    );

    expect(result).toBe('skipped');
    const events = (svc as any).events.list({ kind: 'collision' });
    expect(events).toEqual([
      expect.objectContaining({ firstModuleName: 'OtherModule', secondModuleName: 'M' }),
    ]);
  });
});
