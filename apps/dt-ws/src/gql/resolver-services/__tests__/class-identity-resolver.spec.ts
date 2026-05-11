import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { ClassIdentityResolverService } from '../class-identity-resolver.service';
import { ClassIdentityEventLog } from '../../module-management-services/class-identity-event-log.service';
import { ClassIdentityMigrationService } from '../../module-management-services/class-identity-migration.service';

/**
 * Unit pins for the class-identity admin GraphQL surface. Asserts:
 *   - admin gate fires before any DB call (rejected paths never reach
 *     downstream services)
 *   - admin path delegates to the right downstream service
 *   - classKind validation rejects unknown labels at the BadRequest layer
 *   - the admin-only `classIdentityEvents` query rejects non-admin
 *     contexts (the in-memory log surfaces operational state across the
 *     deployment and would leak across tenants in a multi-tenant setup)
 *   - migrateClassId TOCTOU guard throws ConflictException when the write
 *     match returns zero rows (concurrent writer changed state between
 *     the resolver's read and write)
 *   - deleteOrphanedClass cascade hard-cap refuses above CASCADE_HARD_LIMIT
 *
 * End-to-end DB execution is exercised in the integration spec.
 */

interface MockResults {
  read: any[];
  write: number;
}

function makeMocks(reads: any[][] = [], writes: any[][] = []) {
  const events: any = {
    list: jest.fn().mockReturnValue([]),
    emit: jest.fn(),
  };
  const migration: any = {
    run: jest.fn().mockResolvedValue({ dryRun: true, totalActions: 0, details: [] }),
  };
  const constraints: any = {
    isHealthy: jest.fn().mockReturnValue(true),
  };
  let readCallIndex = 0;
  let writeCallIndex = 0;
  const toRecords = (rows: any[] | undefined) =>
    (rows ?? []).map((row) => ({ get: (key: string) => row[key] }));
  // Default write returns one confirmation row — matches migrateClassId's
  // contract that the write `RETURN c.id AS confirmedId` to detect the
  // TOCTOU no-match case. Tests that want to simulate the no-match path
  // pass an explicit `writes` array including `[]` for the confirming write.
  const dbWrite = jest.fn().mockImplementation(() => {
    const records = writes.length > 0
      ? toRecords(writes[writeCallIndex])
      : [{ get: (key: string) => (key === 'confirmedId' ? 'new-id' : undefined) }];
    writeCallIndex += 1;
    return Promise.resolve({ records });
  });
  const db: any = {
    executeRead: jest.fn().mockImplementation(() => {
      const records = toRecords(reads[readCallIndex]);
      readCallIndex += 1;
      return Promise.resolve({ records });
    }),
    executeWrite: dbWrite,
  };
  return { events, migration, constraints, db, dbWrite };
}

const adminCtx = { user: { sub: 'op-1', email: 'op@example.com', roles: ['admin'] } };
const nonAdminCtx = { user: { sub: 'u-1', email: 'u@example.com', roles: ['user'] } };
const noUserCtx = {};

describe('ClassIdentityResolverService — admin gate', () => {
  let svc: ClassIdentityResolverService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    svc = new ClassIdentityResolverService(
      mocks.events as ClassIdentityEventLog,
      mocks.migration as ClassIdentityMigrationService,
      mocks.constraints as any,
      mocks.db as any,
    );
  });

  describe('migrateClassId', () => {
    it('rejects non-admin caller with ForbiddenException', async () => {
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.migrateClassId(
          {},
          {
            moduleName: 'm',
            className: 'c',
            classKind: 'AnalysisClass',
            newId: 'new-id',
          },
          nonAdminCtx as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.db.executeRead).not.toHaveBeenCalled();
      expect(mocks.db.executeWrite).not.toHaveBeenCalled();
    });

    it('rejects no-user caller', async () => {
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.migrateClassId(
          {},
          {
            moduleName: 'm',
            className: 'c',
            classKind: 'AnalysisClass',
            newId: 'new-id',
          },
          noUserCtx as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin path delegates to DB write + emits rebind event', async () => {
      mocks = makeMocks([
        [{ oldId: 'old-id' }], // current id lookup
        [], // no cross-module collision
      ]);
      svc = new ClassIdentityResolverService(
        mocks.events as any,
        mocks.migration as any,
        mocks.constraints as any,
        mocks.db as any,
      );
      const resolvers = svc.getResolvers();
      const result = await resolvers.Mutation.migrateClassId(
        {},
        {
          moduleName: 'mod-a',
          className: 'class-x',
          classKind: 'AnalysisClass',
          newId: 'new-id',
        },
        adminCtx as any,
      );
      expect(result).toBe(true);
      expect(mocks.db.executeWrite).toHaveBeenCalledTimes(1);
      expect(mocks.events.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'rebind',
          moduleName: 'mod-a',
          className: 'class-x',
          oldId: 'old-id',
          newId: 'new-id',
          policy: 'audit',
        }),
      );
    });

    it('rejects unknown classKind with BadRequestException', async () => {
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.migrateClassId(
          {},
          {
            moduleName: 'm',
            className: 'c',
            classKind: 'NotARealClass',
            newId: 'new-id',
          },
          adminCtx as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when the write match returns zero rows (TOCTOU guard)', async () => {
      // Reads succeed (oldId found, no collision) but the write returns no
      // rows — simulates a concurrent writer that already changed the id
      // between the read and the write.
      mocks = makeMocks(
        [
          [{ oldId: 'old-id' }], // current id read
          [], // no cross-module collision
        ],
        [
          [], // write match returns zero rows → ConflictException expected
        ],
      );
      svc = new ClassIdentityResolverService(
        mocks.events as any,
        mocks.migration as any,
        mocks.constraints as any,
        mocks.db as any,
      );
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.migrateClassId(
          {},
          { moduleName: 'mod-a', className: 'class-x', classKind: 'AnalysisClass', newId: 'new-id' },
          adminCtx as any,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      // Critically: NO event emitted on the no-match path — the audit
      // timeline must not lie about a rebind that didn't happen.
      expect(mocks.events.emit).not.toHaveBeenCalled();
    });
  });

  describe('reviveOrphanedClass', () => {
    it('rejects non-admin caller', async () => {
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.reviveOrphanedClass(
          {},
          { classId: 'c-1', classKind: 'AnalysisClass' },
          nonAdminCtx as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin path: delegates to DB rename + emits revive event', async () => {
      mocks = makeMocks([
        [{ moduleName: 'mod-a', className: 'class-x' }], // owning module lookup
      ]);
      svc = new ClassIdentityResolverService(
        mocks.events as any,
        mocks.migration as any,
        mocks.constraints as any,
        mocks.db as any,
      );
      const resolvers = svc.getResolvers();
      const result = await resolvers.Mutation.reviveOrphanedClass(
        {},
        { classId: 'c-1', classKind: 'AnalysisClass' },
        adminCtx as any,
      );
      expect(result).toBe(true);
      expect(mocks.db.executeWrite).toHaveBeenCalledTimes(1);
      expect(mocks.events.emit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'revive', classId: 'c-1' }),
      );
    });
  });

  describe('deleteOrphanedClass', () => {
    it('rejects non-admin caller', async () => {
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.deleteOrphanedClass(
          {},
          { classId: 'c-1', classKind: 'AnalysisClass', cascade: true },
          nonAdminCtx as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin path with cascade=false + incident edges → BadRequest, includes sample ids', async () => {
      mocks = makeMocks([
        [{ moduleName: 'mod-a' }], // orphaned-class lookup
        [{ n: 3, sampleIds: ['inst-1', 'inst-2', 'inst-3'] }], // incident count + sample
      ]);
      svc = new ClassIdentityResolverService(
        mocks.events as any,
        mocks.migration as any,
        mocks.constraints as any,
        mocks.db as any,
      );
      const resolvers = svc.getResolvers();
      let caught: BadRequestException | undefined;
      try {
        await resolvers.Mutation.deleteOrphanedClass(
          {},
          { classId: 'c-1', classKind: 'AnalysisClass', cascade: false },
          adminCtx as any,
        );
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      // The rejection message MUST include both the count AND sample ids so
      // operators can grep before deciding to cascade.
      const msg = (caught as any).message as string;
      expect(msg).toContain('3 incoming');
      expect(msg).toContain('inst-1');
      expect(mocks.db.executeWrite).not.toHaveBeenCalled();
    });

    it('admin path with cascade=true above CASCADE_HARD_LIMIT → BadRequest', async () => {
      mocks = makeMocks([
        [{ moduleName: 'mod-a' }], // orphaned-class lookup
        [{ n: 5000, sampleIds: ['x'] }], // way over the 1000 cap
      ]);
      svc = new ClassIdentityResolverService(
        mocks.events as any,
        mocks.migration as any,
        mocks.constraints as any,
        mocks.db as any,
      );
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.deleteOrphanedClass(
          {},
          { classId: 'c-1', classKind: 'AnalysisClass', cascade: true },
          adminCtx as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Cap fires BEFORE the DETACH DELETE — protects Memgraph tx memory.
      expect(mocks.db.executeWrite).not.toHaveBeenCalled();
    });

    it('admin path with cascade=true → DETACH DELETE', async () => {
      mocks = makeMocks([
        [{ moduleName: 'mod-a' }], // orphaned-class lookup
        [{ n: 2, sampleIds: ['inst-1', 'inst-2'] }], // incident count + sample
      ]);
      svc = new ClassIdentityResolverService(
        mocks.events as any,
        mocks.migration as any,
        mocks.constraints as any,
        mocks.db as any,
      );
      const resolvers = svc.getResolvers();
      const result = await resolvers.Mutation.deleteOrphanedClass(
        {},
        { classId: 'c-1', classKind: 'AnalysisClass', cascade: true },
        adminCtx as any,
      );
      expect(result).toBe(true);
      expect(mocks.db.executeWrite).toHaveBeenCalledTimes(1);
    });
  });

  describe('runIdentityMigration', () => {
    it('rejects non-admin caller', async () => {
      const resolvers = svc.getResolvers();
      await expect(
        resolvers.Mutation.runIdentityMigration(
          {},
          { dryRun: true },
          nonAdminCtx as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.migration.run).not.toHaveBeenCalled();
    });

    it('admin path with dryRun=true → calls service with apply=false', async () => {
      const resolvers = svc.getResolvers();
      await resolvers.Mutation.runIdentityMigration(
        {},
        { dryRun: true },
        adminCtx as any,
      );
      expect(mocks.migration.run).toHaveBeenCalledWith({ apply: false });
    });

    it('admin path with dryRun=false → calls service with apply=true', async () => {
      const resolvers = svc.getResolvers();
      await resolvers.Mutation.runIdentityMigration(
        {},
        { dryRun: false },
        adminCtx as any,
      );
      expect(mocks.migration.run).toHaveBeenCalledWith({ apply: true });
    });

    it('default dryRun is true (no arg)', async () => {
      const resolvers = svc.getResolvers();
      await resolvers.Mutation.runIdentityMigration({}, {}, adminCtx as any);
      expect(mocks.migration.run).toHaveBeenCalledWith({ apply: false });
    });
  });
});

describe('ClassIdentityResolverService — read paths', () => {
  let svc: ClassIdentityResolverService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    svc = new ClassIdentityResolverService(
      mocks.events as any,
      mocks.migration as any,
      mocks.constraints as any,
      mocks.db as any,
    );
  });

  it('classIdentityEvents is admin-only (closes the multi-tenant leak path)', () => {
    const resolvers = svc.getResolvers();
    // Admin succeeds.
    resolvers.Query.classIdentityEvents({}, {}, adminCtx as any);
    expect(mocks.events.list).toHaveBeenCalledTimes(1);

    // Authenticated non-admin → ForbiddenException.
    expect(() =>
      resolvers.Query.classIdentityEvents({}, {}, nonAdminCtx as any),
    ).toThrow(ForbiddenException);

    // Unauthenticated → ForbiddenException (admin gate covers both).
    expect(() =>
      resolvers.Query.classIdentityEvents({}, {}, noUserCtx as any),
    ).toThrow(ForbiddenException);

    // events.list called exactly once (the admin call); the two rejected
    // calls never reached the event log.
    expect(mocks.events.list).toHaveBeenCalledTimes(1);
  });

  it('Module.constraintsHealthy delegates to EnsureConstraintsService.isHealthy()', () => {
    const resolvers = svc.getResolvers();
    const result = resolvers.Module.constraintsHealthy();
    expect(result).toBe(true);
    expect(mocks.constraints.isHealthy).toHaveBeenCalled();
  });

  it('Module.rebindConflicts joins lastInstallClassIds against the DB and surfaces diff rows', async () => {
    // The resolver issues one executeRead with the parsed snapshot bound to $snapshot.
    const localMocks = makeMocks([
      [
        { classKind: 'AnalysisClass', className: 'X', dbId: 'db-x', moduleDeclaredId: 'mod-x' },
        { classKind: 'ComponentClass', className: 'Y', dbId: 'db-y', moduleDeclaredId: 'mod-y' },
      ],
    ]);
    const localSvc = new ClassIdentityResolverService(
      localMocks.events as ClassIdentityEventLog,
      localMocks.migration as ClassIdentityMigrationService,
      localMocks.constraints as any,
      localMocks.db as any,
    );
    const resolvers = localSvc.getResolvers();
    const result = await resolvers.Module.rebindConflicts({
      name: 'mod-a',
      lastInstallClassIds: JSON.stringify([
        { classKind: 'AnalysisClass', className: 'X', declaredId: 'mod-x' },
        { classKind: 'ComponentClass', className: 'Y', declaredId: 'mod-y' },
      ]),
      lastAttemptedInstall: '2026-05-11T00:00:00.000Z',
    });
    expect(result).toEqual([
      { classKind: 'AnalysisClass', className: 'X', dbId: 'db-x', moduleDeclaredId: 'mod-x' },
      { classKind: 'ComponentClass', className: 'Y', dbId: 'db-y', moduleDeclaredId: 'mod-y' },
    ]);
    expect(localMocks.db.executeRead).toHaveBeenCalledWith(
      expect.stringContaining('UNWIND $snapshot AS row'),
      expect.objectContaining({ moduleName: 'mod-a' }),
    );
  });

  it('Module.rebindConflicts returns empty when snapshot or lastAttemptedInstall is missing', async () => {
    const resolvers = svc.getResolvers();
    expect(await resolvers.Module.rebindConflicts({ name: 'mod-a' })).toEqual([]);
    expect(
      await resolvers.Module.rebindConflicts({
        name: 'mod-a',
        lastInstallClassIds: '[]',
      }),
    ).toEqual([]);
    expect(mocks.db.executeRead).not.toHaveBeenCalled();
  });

  it('Module.rebindConflicts returns empty when lastInstallClassIds is unparseable', async () => {
    const resolvers = svc.getResolvers();
    const result = await resolvers.Module.rebindConflicts({
      name: 'mod-a',
      lastInstallClassIds: 'not-json',
      lastAttemptedInstall: '2026-05-11T00:00:00.000Z',
    });
    expect(result).toEqual([]);
    expect(mocks.db.executeRead).not.toHaveBeenCalled();
  });
});
