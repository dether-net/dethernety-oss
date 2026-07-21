import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';

/**
 * Unit pins for SetInstantiationAttributesService failure transparency.
 * Covers:
 *   - diagnoseSetAttributesFailure branches: element missing, class missing,
 *     wrong-kind class (a ComponentClass bound to a
 *     Control), orphaned class, no IS_INSTANCE_OF edge, and the generic
 *     fallback — each producing an actionable message naming the offending id.
 *   - the diagnostic issues exactly one tx.run (one round trip on the error
 *     path).
 *   - the GraphQL resolver maps a thrown SetInstantiationError into the
 *     envelope's errorCode/errorMessage, and returns nulls on success.
 *
 * Live-DB integration coverage is out of scope for this unit pin.
 */

type RecordMap = Record<string, any>;

const toRecord = (row: RecordMap) => ({ get: (key: string) => row[key] });

function makeTx(row: RecordMap | null) {
  const runMock = jest
    .fn()
    .mockResolvedValue({ records: row ? [toRecord(row)] : [] });
  return { tx: { run: runMock }, runMock };
}

function makeService() {
  const configService: any = {
    get: jest.fn().mockReturnValue({}), // GqlConfig — only needs to be truthy
  };
  const moduleRegistry: any = { getModuleByName: jest.fn() };
  const authorizationService: any = {
    extractAuthContext: jest.fn().mockReturnValue({ userId: 'u-1' }),
  };
  const monitoringService: any = { recordOperation: jest.fn() };
  const driver: any = { session: jest.fn() };

  const service = new SetInstantiationAttributesService(
    driver,
    configService as ConfigService,
    moduleRegistry as ModuleRegistryService,
    authorizationService as AuthorizationService,
    monitoringService as MonitoringService,
  );
  return { service, authorizationService };
}

// Default "all present and consistent" diagnostic row, overridden per case.
const baseRow = (over: RecordMap): RecordMap => ({
  elementFound: true,
  elementLabels: ['Control'],
  classFound: true,
  classLabels: ['ControlClass'],
  className: 'Network Access Control',
  moduleName: 'dethernety-general',
  edgeExists: true,
  ...over,
});

describe('SetInstantiationAttributesService — diagnoseSetAttributesFailure', () => {
  const COMP = 'ctrl-1';
  const CLASS = 'class-1';

  const diagnose = (service: any, row: RecordMap | null) => {
    const { tx, runMock } = makeTx(row);
    return { result: service.diagnoseSetAttributesFailure(tx, COMP, CLASS), runMock };
  };

  it('reports the element id when the element is missing', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({ elementFound: false, elementLabels: null, classFound: true }),
    );
    await expect(result).resolves.toContain(`element "${COMP}" not found`);
  });

  it('reports the class id when the class is missing', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({ classFound: false, classLabels: null, className: null, moduleName: null }),
    );
    await expect(result).resolves.toContain(`class "${CLASS}" not found`);
  });

  it('names the actual class kind when a ComponentClass is bound to a Control', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({
        elementLabels: ['Control'],
        classLabels: ['ComponentClass'],
        className: 'NetworkPolicy',
        moduleName: 'k8s-module',
        edgeExists: false,
      }),
    );
    const msg = await result;
    expect(msg).toContain('NetworkPolicy');
    expect(msg).toContain('is a ComponentClass');
    expect(msg).toContain('a Control can only bind ControlClass');
  });

  it('flags an orphaned class (no active module)', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({ moduleName: null, edgeExists: false }),
    );
    await expect(result).resolves.toContain('no active module');
  });

  it('reports a missing IS_INSTANCE_OF edge when kind and module are fine', async () => {
    const { service } = makeService();
    const { result } = diagnose(service, baseRow({ edgeExists: false }));
    await expect(result).resolves.toContain('no IS_INSTANCE_OF relationship');
  });

  it('falls back to the generic message when everything looks consistent', async () => {
    const { service } = makeService();
    const { result } = diagnose(service, baseRow({}));
    await expect(result).resolves.toContain('failed to set attributes');
  });

  it('runs exactly one diagnostic query', async () => {
    const { service } = makeService();
    const { result, runMock } = diagnose(service, baseRow({ edgeExists: false }));
    await result;
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to the generic message if the diagnostic query throws', async () => {
    const { service } = makeService();
    const tx = { run: jest.fn().mockRejectedValue(new Error('boom')) };
    await expect(
      (service as any).diagnoseSetAttributesFailure(tx, COMP, CLASS),
    ).resolves.toContain('failed to set attributes');
  });
});

describe('SetInstantiationAttributesService — resolver envelope', () => {
  const callResolver = async (service: any, authorizationService: any) => {
    const resolvers = service.getResolvers();
    return resolvers.Mutation.setInstantiationAttributes(
      null,
      { componentId: 'ctrl-1', classId: 'class-1', attributes: {} },
      {},
    );
  };

  // Production path: setAttributes catches its own failure and RESOLVES with a
  // result envelope (error + errorCode) — it does not reject — because the
  // batch path resolves on this. The resolver must surface those fields.
  it('surfaces errorCode/errorMessage when setAttributes resolves a failure result', async () => {
    const { service, authorizationService } = makeService();
    (service as any).config.batchEnabled = false;
    jest.spyOn(service as any, 'setAttributes').mockResolvedValue({
      success: false,
      errorCode: 'DATABASE_ERROR',
      error: 'class "class-1" ("NetworkPolicy") is a ComponentClass — a Control can only bind ControlClass',
    });

    const out = await callResolver(service, authorizationService);
    expect(out.success).toBe(false);
    expect(out.staleFlippedCount).toBeNull();
    expect(out.errorCode).toBe('DATABASE_ERROR');
    expect(out.errorMessage).toContain('is a ComponentClass');
  });

  // Defensive: a genuine throw (e.g. concurrency-control rejection) still maps
  // through the resolver catch.
  it('surfaces errorCode/errorMessage when the write throws a SetInstantiationError', async () => {
    const { service, authorizationService } = makeService();
    (service as any).config.batchEnabled = false;
    jest.spyOn(service as any, 'setAttributes').mockRejectedValue({
      type: 'DATABASE_ERROR',
      message: 'class "class-1" ("NetworkPolicy") is a ComponentClass — a Control can only bind ControlClass',
    });

    const out = await callResolver(service, authorizationService);
    expect(out.success).toBe(false);
    expect(out.staleFlippedCount).toBeNull();
    expect(out.errorCode).toBe('DATABASE_ERROR');
    expect(out.errorMessage).toContain('is a ComponentClass');
  });

  it('returns null error fields on success', async () => {
    const { service, authorizationService } = makeService();
    (service as any).config.batchEnabled = false;
    jest
      .spyOn(service as any, 'setAttributes')
      .mockResolvedValue({ success: true, staleFlippedCount: 2 });

    const out = await callResolver(service, authorizationService);
    expect(out.success).toBe(true);
    expect(out.staleFlippedCount).toBe(2);
    expect(out.errorCode).toBeNull();
    expect(out.errorMessage).toBeNull();
  });
});

describe('SetInstantiationAttributesService — MITRE-link anchor scoping', () => {
  // Query-shape pin: the external-link anchor must scope the origin finding
  // to the class the upsert wrote it under (classId + SYSTEM-or-legacy-null
  // createdBy), so a bare-name match can never weld module-declared edges
  // onto a same-named USER finding or another class's countermeasure. The
  // behavioral proof against real Memgraph lives in
  // test/integration/mitre-verb-edges.e2e-spec.ts.
  it('threads classId into the link statement with class + createdBy scope', async () => {
    const { service } = makeService();
    const calls: Array<{ query: string; params: any }> = [];
    const tx = {
      run: jest.fn(async (query: string, params: any) => {
        calls.push({ query, params });
        if (query.includes('EXPLOITED_BY')) {
          // Link statement — empty result (target-not-found path) is fine.
          return { records: [] };
        }
        if (query.includes('instantiatedName')) {
          return { records: [toRecord({ instantiatedName: 'X' })] };
        }
        throw new Error(`unrecognized query: ${query}`);
      }),
    };

    await (service as any).upsertExposuresInTx(tx, {
      componentId: 'comp-1',
      classId: 'cls-1',
      exposures: [{ name: 'X', exploitedBy: ['T1078'] }],
    });

    const link = calls.find((c) => c.query.includes('EXPLOITED_BY'));
    expect(link).toBeDefined();
    expect(link!.query).toContain(
      "-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(klass {id: $classId})",
    );
    expect(link!.query).toContain(
      "e.createdBy = 'SYSTEM' OR e.createdBy IS NULL",
    );
    expect(link!.params.classId).toBe('cls-1');
  });
});

describe('SetInstantiationAttributesService — per-request token threading', () => {
  // The platform forwards the caller's raw bearer token into the module's
  // content methods (so a module can call an upstream service on the caller's
  // behalf). Two independent hops are pinned:
  //   forward hop — the private process* method forwards its token into the
  //                 module call;
  //   wiring hop  — setAttributes passes the request context's token DOWN into
  //                 process* (guards the "passed context.user / dropped the
  //                 arg" regression).

  it('forward hop: process* forwards the token into the module call', async () => {
    const { service } = makeService();
    jest.spyOn(service as any, 'upsertExposures').mockResolvedValue({ success: true, recordsAffected: 0 });
    jest.spyOn(service as any, 'upsertCountermeasures').mockResolvedValue({ success: true, recordsAffected: 0 });

    const moduleInstance = {
      getExposures: jest.fn(async () => []),
      getCountermeasures: jest.fn(async () => []),
    };

    // session arg is unused once the upsert is spied out.
    await (service as any).processComponentExposures({}, 'comp-1', 'cls-1', moduleInstance, 'op', 'bearer-xyz');
    expect(moduleInstance.getExposures).toHaveBeenCalledWith('comp-1', 'cls-1', 'bearer-xyz');

    await (service as any).processControlCountermeasures({}, 'ctrl-1', 'cls-1', moduleInstance, 'op', 'bearer-xyz');
    expect(moduleInstance.getCountermeasures).toHaveBeenCalledWith('ctrl-1', 'cls-1', 'bearer-xyz');
  });

  it('wiring hop: setAttributes passes context.token down into process*', async () => {
    const { service } = makeService();

    // Minimal session: executeWrite yields the flat metadata record setAttributes
    // destructures; close() is called in its finally block.
    const session = {
      executeWrite: jest.fn(async () => ({
        moduleName: 'mod-1',
        componentType: 'Component', // non-Control/non-Issue → exposures branch
        valueChanged: false,
        changedKeys: [],
        staleFlippedCount: 0,
      })),
      close: jest.fn(async () => {}),
    };
    (service as any).neo4jDriver.session = jest.fn(() => session);
    (service as any).moduleRegistry.getModuleByName = jest.fn(() => ({
      getExposures: jest.fn(async () => []),
      getCountermeasures: jest.fn(async () => []),
    }));

    const processSpy = jest
      .spyOn(service as any, 'processComponentExposures')
      .mockResolvedValue(undefined);

    const result = await (service as any).setAttributes(
      { componentId: 'comp-1', classId: 'cls-1', attributes: { k: 'v' } }, // non-empty attrs required by validation
      { user: { sub: 'tester' }, token: 'bearer-xyz' },
    );

    expect(result.success).toBe(true);
    // token is the LAST positional arg into process*.
    expect(processSpy).toHaveBeenCalledWith(
      expect.anything(), // session
      'comp-1',
      'cls-1',
      expect.anything(), // moduleInstance
      expect.anything(), // operationId
      'bearer-xyz',
    );
  });

  it('wiring hop: token is undefined when the request carries no bearer (absence)', async () => {
    const { service } = makeService();
    const session = {
      executeWrite: jest.fn(async () => ({
        moduleName: 'mod-1',
        componentType: 'Component',
        valueChanged: false,
        changedKeys: [],
        staleFlippedCount: 0,
      })),
      close: jest.fn(async () => {}),
    };
    (service as any).neo4jDriver.session = jest.fn(() => session);
    (service as any).moduleRegistry.getModuleByName = jest.fn(() => ({
      getExposures: jest.fn(async () => []),
      getCountermeasures: jest.fn(async () => []),
    }));
    const processSpy = jest
      .spyOn(service as any, 'processComponentExposures')
      .mockResolvedValue(undefined);

    await (service as any).setAttributes(
      { componentId: 'comp-1', classId: 'cls-1', attributes: { k: 'v' } },
      { user: { sub: 'tester' } }, // no token
    );

    expect(processSpy.mock.calls[0][5]).toBeUndefined();
  });
});
