import neo4j, { Integer } from 'neo4j-driver';
import { ListClassesResolverService } from '../list-classes-resolver.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';
import { ConfigService } from '@nestjs/config';

/**
 * Unit pins for ListClassesResolverService. Asserts:
 *   - input validation rejects unknown classLabel before any DB call (defence-
 *     in-depth against Cypher label injection)
 *   - input validation rejects out-of-range pagination params
 *   - componentType is rejected when classLabel != COMPONENT
 *   - the resolver wires filter params (search, categories, moduleIds,
 *     componentType, offset, limit) into the Cypher session.executeRead call
 *   - facet aggregation produces correct counts including the module facet
 *     with both id and name
 *   - authorization denial short-circuits before any DB call
 *
 * Integration coverage against a live DB is out of scope for this unit pin —
 * the e2e suite exercises the round-trip.
 */

type RecordMap = Record<string, any>;

const toRecord = (row: RecordMap) => ({
  get: (key: string) => row[key],
});

function makeDriver(itemsRows: RecordMap[], aggregationRows: RecordMap[]) {
  const session = {
    executeRead: jest
      .fn()
      .mockImplementation(async (work: (tx: any) => Promise<any>) => {
        const itemsResult = { records: itemsRows.map(toRecord) };
        const aggregationResult = { records: aggregationRows.map(toRecord) };
        const tx = {
          run: jest
            .fn()
            // First call: items query. Second call: aggregation query.
            .mockResolvedValueOnce(itemsResult)
            .mockResolvedValueOnce(aggregationResult),
        };
        return work(tx);
      }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const driver = { session: jest.fn().mockReturnValue(session) };
  return { driver, session };
}

function makeServices(allowed = true) {
  const auth: any = {
    extractAuthContext: jest.fn().mockReturnValue({ userId: 'u-1' }),
    checkAuthorization: jest.fn().mockResolvedValue({ allowed, reason: 'nope' }),
  };
  const monitoring: any = { recordOperation: jest.fn() };
  const config: any = { get: jest.fn().mockReturnValue('neo4j') };
  return { auth, monitoring, config };
}

const adminCtx = { user: { sub: 'op-1' } };

describe('ListClassesResolverService — input validation', () => {
  it('rejects unknown classLabel before touching the DB', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );

    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'NOT_A_LABEL' } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/Invalid classLabel/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('rejects label-injection payload', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT; DROP TABLE' } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/Invalid classLabel/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('rejects componentType when classLabel !== COMPONENT', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        {
          input: {
            classLabel: 'DATA_FLOW',
            componentType: 'PROCESS',
          },
        },
        adminCtx as any,
      ),
    ).rejects.toThrow(/componentType is only applicable/);
  });

  it('rejects negative offset', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT', offset: -1 } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/offset must be >= 0/);
  });

  it('rejects offset above the deep-pagination cap (MAX_LIMIT * 1000 = 200000)', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT', offset: 200001 } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/offset must be <=/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('rejects limit < 1', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT', limit: 0 } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/limit must be >= 1/);
  });

  it('rejects search above MAX_SEARCH_LENGTH (200 chars)', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT', search: 'a'.repeat(201) } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/search exceeds maximum length/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('rejects categories above MAX_FILTER_ENTRIES (100)', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const tooMany = Array.from({ length: 101 }, (_, i) => `cat-${i}`);
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT', categories: tooMany } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/categories exceeds maximum entries/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('rejects moduleIds above MAX_FILTER_ENTRIES (100)', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const tooMany = Array.from({ length: 101 }, (_, i) => `mod-${i}`);
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT', moduleIds: tooMany } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/moduleIds exceeds maximum entries/);
    expect(driver.session).not.toHaveBeenCalled();
  });
});

describe('ListClassesResolverService — authorization', () => {
  it('denies before any DB call when checkAuthorization returns allowed: false', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices(false);
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT' } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/Authorization denied/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('uses resource type Class + operation listClasses (parity with matchClasses)', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices(true);
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT' } },
      adminCtx as any,
    );
    expect(auth.checkAuthorization).toHaveBeenCalledWith(
      expect.anything(),
      {
        operationType: 'query',
        operationName: 'listClasses',
        resourceType: 'Class',
      },
    );
  });
});

describe('ListClassesResolverService — happy paths', () => {
  it('returns empty result set cleanly (no rows → totalCount = 0, empty facets)', async () => {
    const { driver, session } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const result = await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT' } },
      adminCtx as any,
    );
    expect(result).toEqual({
      items: [],
      totalCount: 0,
      facetCounts: { categories: [], modules: [], types: [] },
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('shapes items as ClassCandidate-compatible (matchType=type_match, similarityScore=null)', async () => {
    const { driver } = makeDriver(
      [
        {
          classId: 'c1',
          className: 'Alpha',
          description: 'desc1',
          category: 'Persistence',
          type: 'STORE',
          moduleName: 'CoreModule',
          moduleId: 'm1',
        },
      ],
      [
        {
          category: 'Persistence',
          type: 'STORE',
          moduleId: 'm1',
          moduleName: 'CoreModule',
        },
      ],
    );
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const result = await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT' } },
      adminCtx as any,
    );
    expect(result.items).toEqual([
      {
        classId: 'c1',
        className: 'Alpha',
        classDescription: 'desc1',
        classCategory: 'Persistence',
        classType: 'STORE',
        moduleId: 'm1',
        moduleName: 'CoreModule',
        matchType: 'type_match',
        confidence: 'low',
        similarityScore: null,
      },
    ]);
  });

  it('items carry moduleId; two modules with identical moduleName surface distinct moduleId', async () => {
    // Defensive case: module names are expected to be unique in production,
    // but the join is by id, so a same-name fixture shouldn't collide.
    const { driver } = makeDriver(
      [
        {
          classId: 'c1',
          className: 'Alpha',
          description: null,
          category: null,
          type: null,
          moduleId: 'm1',
          moduleName: 'shared-name',
        },
        {
          classId: 'c2',
          className: 'Beta',
          description: null,
          category: null,
          type: null,
          moduleId: 'm2',
          moduleName: 'shared-name',
        },
      ],
      [],
    );
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const result = await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT' } },
      adminCtx as any,
    );
    expect(result.items.map((i: any) => i.moduleId)).toEqual(['m1', 'm2']);
    expect(result.items.map((i: any) => i.moduleName)).toEqual([
      'shared-name',
      'shared-name',
    ]);
  });

  it('aggregates facets correctly (counts sum to totalCount, modules carry id+name)', async () => {
    // 5-row filtered set: 3 categories (Persistence x 3, Auth x 2), 2 modules
    // (Core x 4, Auth x 1), 2 types (STORE x 3, PROCESS x 2).
    const aggregationRows = [
      { category: 'Persistence', type: 'STORE', moduleId: 'm1', moduleName: 'CoreModule' },
      { category: 'Persistence', type: 'STORE', moduleId: 'm1', moduleName: 'CoreModule' },
      { category: 'Persistence', type: 'STORE', moduleId: 'm1', moduleName: 'CoreModule' },
      { category: 'Auth', type: 'PROCESS', moduleId: 'm1', moduleName: 'CoreModule' },
      { category: 'Auth', type: 'PROCESS', moduleId: 'm2', moduleName: 'AuthModule' },
    ];
    const { driver } = makeDriver([], aggregationRows);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const result = await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT' } },
      adminCtx as any,
    );

    expect(result.totalCount).toBe(5);

    // Categories sorted by count desc, then name asc.
    expect(result.facetCounts.categories).toEqual([
      { value: 'Persistence', count: 3 },
      { value: 'Auth', count: 2 },
    ]);

    // Modules carry id+name and sum to totalCount.
    expect(result.facetCounts.modules).toEqual([
      { moduleId: 'm1', moduleName: 'CoreModule', count: 4 },
      { moduleId: 'm2', moduleName: 'AuthModule', count: 1 },
    ]);
    const moduleSum = result.facetCounts.modules.reduce(
      (acc: number, m: any) => acc + m.count,
      0,
    );
    expect(moduleSum).toBe(result.totalCount);

    // Types sorted by count desc.
    expect(result.facetCounts.types).toEqual([
      { value: 'STORE', count: 3 },
      { value: 'PROCESS', count: 2 },
    ]);
  });

  it('ignores null category/type in facet counts (defensive against sparse class data)', async () => {
    const aggregationRows = [
      { category: 'Persistence', type: 'STORE', moduleId: 'm1', moduleName: 'CoreModule' },
      { category: null, type: null, moduleId: 'm1', moduleName: 'CoreModule' },
    ];
    const { driver } = makeDriver([], aggregationRows);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    const result = await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT' } },
      adminCtx as any,
    );
    expect(result.totalCount).toBe(2);
    expect(result.facetCounts.categories).toEqual([
      { value: 'Persistence', count: 1 },
    ]);
    expect(result.facetCounts.types).toEqual([{ value: 'STORE', count: 1 }]);
    // Both rows count toward modules (m1 has both).
    expect(result.facetCounts.modules).toEqual([
      { moduleId: 'm1', moduleName: 'CoreModule', count: 2 },
    ]);
  });
});

describe('ListClassesResolverService — query parameter wiring', () => {
  it('passes search/categories/moduleIds/componentType + clamped pagination into the Cypher params', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();

    // Capture the tx.run calls.
    const txRunCalls: any[] = [];
    (driver.session().executeRead as jest.Mock).mockImplementationOnce(
      async (work: any) => {
        const tx = {
          run: jest.fn().mockImplementation((q: string, p: any) => {
            txRunCalls.push({ q, p });
            return { records: [] };
          }),
        };
        return work(tx);
      },
    );

    await resolvers.Query.listClasses(
      {},
      {
        input: {
          classLabel: 'COMPONENT',
          componentType: 'PROCESS',
          search: 'gres',
          categories: ['Persistence'],
          moduleIds: ['m1', 'm2'],
          offset: 10,
          // Limit above MAX_LIMIT (200) — must be clamped.
          limit: 9999,
        },
      },
      adminCtx as any,
    );

    expect(txRunCalls.length).toBe(2); // items + aggregation
    // Both queries share the same param payload.
    for (const call of txRunCalls) {
      expect(call.p.componentType).toBe('PROCESS');
      expect(call.p.categories).toEqual(['Persistence']);
      expect(call.p.moduleIds).toEqual(['m1', 'm2']);
      expect(call.p.search).toBe('gres');
      // offset / limit MUST be neo4j Integer wrappers — Memgraph rejects
      // plain JS numbers on SKIP / LIMIT.
      expect(neo4j.isInt(call.p.offset)).toBe(true);
      expect(neo4j.isInt(call.p.limit)).toBe(true);
      expect((call.p.offset as Integer).toNumber()).toBe(10);
      expect((call.p.limit as Integer).toNumber()).toBe(200); // clamped from 9999 to MAX_LIMIT
    }

    // Items query carries SKIP / LIMIT, aggregation does not.
    expect(txRunCalls[0].q).toMatch(/SKIP \$offset/);
    expect(txRunCalls[0].q).toMatch(/LIMIT \$limit/);
    expect(txRunCalls[1].q).not.toMatch(/SKIP/);
    expect(txRunCalls[1].q).not.toMatch(/LIMIT/);

    // search uses case-insensitive contains.
    expect(txRunCalls[0].q).toMatch(/toLower\(c\.name\) CONTAINS toLower\(\$search\)/);

    // ORDER BY carries a stable secondary sort key — without c.id, ties on
    // c.name shuffle between pages on Memgraph (implementation-defined).
    expect(txRunCalls[0].q).toMatch(/ORDER BY c\.name ASC, c\.id ASC/);

    // Label is interpolated from the validated map (only ComponentClass for
    // classLabel=COMPONENT) — no user-controlled string lands in Cypher.
    expect(txRunCalls[0].q).toMatch(/MATCH \(c:ComponentClass\)/);
    expect(txRunCalls[1].q).toMatch(/MATCH \(c:ComponentClass\)/);

    // Orphan exclusion via :HAS_CLASS (not :HAS_ORPHANED_CLASS).
    expect(txRunCalls[0].q).toMatch(/<-\[:HAS_CLASS\]-/);
    expect(txRunCalls[1].q).toMatch(/<-\[:HAS_CLASS\]-/);
  });

  it('normalises empty filter arrays to null (no-filter semantics)', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();

    const txRunCalls: any[] = [];
    (driver.session().executeRead as jest.Mock).mockImplementationOnce(
      async (work: any) => {
        const tx = {
          run: jest.fn().mockImplementation((q: string, p: any) => {
            txRunCalls.push({ q, p });
            return { records: [] };
          }),
        };
        return work(tx);
      },
    );

    await resolvers.Query.listClasses(
      {},
      {
        input: {
          classLabel: 'COMPONENT',
          categories: [],
          moduleIds: [],
          search: '',
        },
      },
      adminCtx as any,
    );

    expect(txRunCalls[0].p.componentType).toBeNull();
    expect(txRunCalls[0].p.categories).toBeNull();
    expect(txRunCalls[0].p.moduleIds).toBeNull();
    expect(txRunCalls[0].p.search).toBeNull();
    expect(neo4j.isInt(txRunCalls[0].p.offset)).toBe(true);
    expect(neo4j.isInt(txRunCalls[0].p.limit)).toBe(true);
    expect((txRunCalls[0].p.offset as Integer).toNumber()).toBe(0);
    expect((txRunCalls[0].p.limit as Integer).toNumber()).toBe(50);
  });

  it('trims whitespace from search before sending to Cypher', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();

    const txRunCalls: any[] = [];
    (driver.session().executeRead as jest.Mock).mockImplementationOnce(
      async (work: any) => {
        const tx = {
          run: jest.fn().mockImplementation((q: string, p: any) => {
            txRunCalls.push({ q, p });
            return { records: [] };
          }),
        };
        return work(tx);
      },
    );

    await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT', search: '  auth  ' } },
      adminCtx as any,
    );

    expect(txRunCalls[0].p.search).toBe('auth');
  });

  it('normalises whitespace-only search to null', async () => {
    const { driver } = makeDriver([], []);
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();

    const txRunCalls: any[] = [];
    (driver.session().executeRead as jest.Mock).mockImplementationOnce(
      async (work: any) => {
        const tx = {
          run: jest.fn().mockImplementation((q: string, p: any) => {
            txRunCalls.push({ q, p });
            return { records: [] };
          }),
        };
        return work(tx);
      },
    );

    await resolvers.Query.listClasses(
      {},
      { input: { classLabel: 'COMPONENT', search: '   ' } },
      adminCtx as any,
    );

    expect(txRunCalls[0].p.search).toBeNull();
  });
});

describe('ListClassesResolverService — error handling', () => {
  // safeErrorMessage returns the raw error message in dev/test and the
  // fallback only in production — this is by design (devs see real errors
  // while debugging, clients in prod see redacted text). Pin the production
  // redaction here, since that's the threat model the wrapping addresses.
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('wraps raw driver errors via safeErrorMessage in production (no raw leak)', async () => {
    process.env.NODE_ENV = 'production';
    const session = {
      executeRead: jest
        .fn()
        .mockRejectedValue(new Error('raw driver: SyntaxError at line 42')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const driver: any = { session: jest.fn().mockReturnValue(session) };
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT' } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/listClasses failed/);
    // Critical: the raw driver text must NOT appear in the thrown message.
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT' } },
        adminCtx as any,
      ),
    ).rejects.not.toThrow(/SyntaxError at line 42/);
    // Failure path still records to monitoring with success=false.
    expect(monitoring.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operationName: 'listClasses', success: false }),
    );
  });

  it('still surfaces raw driver message in non-production (dev convenience)', async () => {
    process.env.NODE_ENV = 'test';
    const session = {
      executeRead: jest
        .fn()
        .mockRejectedValue(new Error('helpful debug detail')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const driver: any = { session: jest.fn().mockReturnValue(session) };
    const { auth, monitoring, config } = makeServices();
    const svc = new ListClassesResolverService(
      driver,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );
    const resolvers = svc.getResolvers();
    await expect(
      resolvers.Query.listClasses(
        {},
        { input: { classLabel: 'COMPONENT' } },
        adminCtx as any,
      ),
    ).rejects.toThrow(/helpful debug detail/);
  });
});
