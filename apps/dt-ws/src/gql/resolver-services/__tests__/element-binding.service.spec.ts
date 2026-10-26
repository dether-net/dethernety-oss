import { ElementBindingService } from '../element-binding.service';
import { LOCK_ELEMENT_CYPHER } from '../shared/element-db-lock';

/**
 * Unit pins for ElementBindingService's class-scope guards:
 *   - wrong-kind rebind is refused BEFORE anything destructive (no module
 *     call, no write transaction) and surfaces as VALIDATION_ERROR;
 *   - likewise a ComponentClass whose ComponentType contradicts the element's
 *     (STORE class onto a PROCESS component) — right label, wrong type, which
 *     the rewire itself would happily bind;
 *   - a correct-kind rebind still succeeds through the same path;
 *   - the rewire row-count guards turn a zero-row final MATCH (single-class
 *     and Controls N-N) into a thrown-and-rolled-back DATABASE_ERROR instead
 *     of silent success.
 *
 * The fakes are STRICT: any query the dispatcher does not recognise throws,
 * so a service-side query refactor can never silently starve a fixture and
 * turn these pins vacuous. Live-graph proof lives in
 * test/integration/element-binding.e2e-spec.ts.
 */

type Row = Record<string, any>;
const rec = (row: Row) => ({ get: (k: string) => row[k] });

interface FixtureOptions {
  // Element labels returned by the preflight read.
  elementLabels: string[];
  // The element's own ComponentType (`c.type`), when it is a Component.
  elementComponentType?: string | null;
  // Current IS_INSTANCE_OF class ids (preflight + in-tx read).
  currentClassIds: string[];
  // Per-classId answer for lookupClassStatus.
  classStatus: Record<
    string,
    {
      exists: boolean;
      moduleName: string | null;
      labels: string[];
      // The class's own ComponentType (`klass.type`), for ComponentClass rows.
      componentType?: string | null;
      // The class's policy hash, which the binding stamps on the element.
      policyHash?: string | null;
    }
  >;
  // `bound` answered by the single-class rewire statement.
  singleRewireBound?: number;
  // `bound` answered by the Controls add-edges statement.
  controlsAddBound?: number;
  // `bound` answered by the represented-model rewire statement.
  modelRewireBound?: number;
}

function makeFixture(opts: FixtureOptions) {
  const writeStatements: string[] = [];
  const writeParams: any[] = [];

  const readTx = {
    run: async (query: string, params: any) => {
      if (query.includes('klassLabels')) {
        const status = opts.classStatus[params.classId];
        if (!status) throw new Error(`no classStatus fixture for ${params.classId}`);
        return {
          records: [
            rec({
              exists: status.exists,
              moduleName: status.moduleName,
              klassLabels: status.labels,
              klassComponentType: status.componentType ?? null,
              policyHash: status.policyHash ?? null,
            }),
          ],
        };
      }
      if (query.includes('labels(c) AS labels')) {
        return {
          records: [
            rec({
              labels: opts.elementLabels,
              elementComponentType: opts.elementComponentType ?? null,
              currentClassIds: opts.currentClassIds,
              currentModelId: null,
            }),
          ],
        };
      }
      if (query.includes('MATCH (m:Model')) {
        return { records: [rec({ cnt: 1 })] };
      }
      throw new Error(`unrecognized read query: ${query}`);
    },
  };

  const writeTx = {
    run: async (query: string, params: any) => {
      writeStatements.push(query);
      writeParams.push(params);
      if (query === LOCK_ELEMENT_CYPHER) return { records: [] };
      if (query.includes('currentClassIds')) {
        return {
          records: [
            rec({ currentClassIds: opts.currentClassIds, currentModelId: null }),
          ],
        };
      }
      if (query.includes('deletedNames')) {
        return { records: [rec({ deletedNames: [] })] };
      }
      if (query.includes('count(newKlass) AS bound')) {
        return { records: [rec({ bound: opts.singleRewireBound ?? 1 })] };
      }
      if (query.includes('count(m) AS bound')) {
        return { records: [rec({ bound: opts.modelRewireBound ?? 1 })] };
      }
      if (query.includes('WHERE klass.id IN $removedClassIds')) {
        return { records: [] };
      }
      if (query.includes('count(DISTINCT klass) AS bound')) {
        return { records: [rec({ bound: opts.controlsAddBound ?? 0 })] };
      }
      if (query.includes('COUNT(DISTINCT cm) AS countermeasures')) {
        return { records: [rec({ exposures: 0, countermeasures: 0 })] };
      }
      throw new Error(`unrecognized write query: ${query}`);
    },
  };

  const executeWrite = jest.fn(async (cb: any) => cb(writeTx));
  const session = {
    executeRead: jest.fn(async (cb: any) => cb(readTx)),
    executeWrite,
    close: jest.fn(async () => {}),
  };
  const driver = { session: jest.fn(() => session) };

  // Stable, spy-able module instance so tests can assert the arguments the
  // platform forwards into the module (e.g. the per-request bearer token).
  const moduleInstance = {
    getExposures: jest.fn(async () => []),
    getCountermeasures: jest.fn(async () => []),
  };
  const getModuleByName = jest.fn(() => moduleInstance);

  const setInstantiation = {
    upsertExposuresInTx: jest.fn(async () => ({ instantiated: [], unresolved: [] })),
    upsertCountermeasuresInTx: jest.fn(async () => ({ instantiated: [], unresolved: [] })),
    deleteObsoleteFindingsInTx: jest.fn(async () => 0),
    stampPolicyInTx: jest.fn(async () => undefined),
    // The stored hash, as for a module that evaluates with it (the agreement check is policy-stamp.spec's).
    policyHashToStamp: jest.fn(async (_module: unknown, _classId: string, storedHash: string | null) => storedHash),
    // The per-element lock the binding call now takes. Passed straight through here: exclusion is not
    // what any case in this file is about, and it is proven against the real lock in element-lock.spec.
    runExclusive: jest.fn(async (_elementId: string, _type: string, operation: () => Promise<any>) =>
      operation(),
    ),
  };

  const service = new ElementBindingService(
    driver as any,
    { get: jest.fn(() => 'neo4j') } as any,
    { getModuleByName } as any,
    {} as any,
    setInstantiation as any,
  );

  return { service, executeWrite, getModuleByName, writeStatements, writeParams, moduleInstance, setInstantiation };
}

const CTX = { user: { sub: 'tester' } };

describe('ElementBindingService — class-scope guards', () => {
  it('refuses a wrong-kind rebind before any module call or write tx (VALIDATION_ERROR)', async () => {
    const { service, executeWrite, getModuleByName } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: {
        'ctl-x': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['ctl-x'] } },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toContain('is not a ComponentClass');
    // The discriminating assertions: refusal happened BEFORE the module SDK
    // and BEFORE the destructive write transaction.
    expect(getModuleByName).not.toHaveBeenCalled();
    expect(executeWrite).not.toHaveBeenCalled();
  });

  it('refuses a ComponentClass whose type contradicts the component (VALIDATION_ERROR)', async () => {
    const { service, executeWrite, getModuleByName } = makeFixture({
      elementLabels: ['Component'],
      elementComponentType: 'PROCESS',
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-store': {
          exists: true,
          moduleName: 'mod-1',
          labels: ['ComponentClass'],
          componentType: 'STORE',
        },
      },
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-store'] } },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toContain('is a STORE class');
    expect(result.errorMessage).toContain('PROCESS');
    // Same discipline as the wrong-label guard: refused before the module SDK
    // and before the destructive write transaction.
    expect(getModuleByName).not.toHaveBeenCalled();
    expect(executeWrite).not.toHaveBeenCalled();
  });

  it('allows a ComponentClass whose type matches the component', async () => {
    const { service, executeWrite } = makeFixture({
      elementLabels: ['Component'],
      elementComponentType: 'PROCESS',
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-proc': {
          exists: true,
          moduleName: 'mod-1',
          labels: ['ComponentClass'],
          componentType: 'PROCESS',
        },
      },
      singleRewireBound: 1,
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-proc'] } },
      CTX,
    );

    expect(result.success).toBe(true);
    expect(executeWrite).toHaveBeenCalled();
  });

  it('leaves pre-schema rows alone when either component type is absent', async () => {
    // `type` is non-null in the schema, so a missing value means legacy data —
    // refuse to block a rebind on an absence we cannot interpret.
    const { service, executeWrite } = makeFixture({
      elementLabels: ['Component'],
      elementComponentType: null,
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-store': {
          exists: true,
          moduleName: 'mod-1',
          labels: ['ComponentClass'],
          componentType: 'STORE',
        },
      },
      singleRewireBound: 1,
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-store'] } },
      CTX,
    );

    expect(result.success).toBe(true);
    expect(executeWrite).toHaveBeenCalled();
  });

  it('correct-kind rebind still succeeds through the guarded path', async () => {
    const { service, executeWrite } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-new': {
          exists: true,
          moduleName: 'mod-1',
          labels: ['ComponentClass'],
        },
      },
      singleRewireBound: 1,
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } },
      CTX,
    );

    expect(result.errorMessage).toBeNull();
    expect(result.errorCode).toBeNull();
    expect(result.success).toBe(true);
    expect(executeWrite).toHaveBeenCalledTimes(1);
  });

  it('counts each derived finding once when the driver re-runs the write after a transient conflict', async () => {
    const { service, executeWrite } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: { 'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'] } },
      singleRewireBound: 1,
    });
    (service as any).setInstantiation.upsertExposuresInTx.mockResolvedValue({ instantiated: ['A', 'B'], unresolved: [] });
    const once = executeWrite.getMockImplementation()!;
    // The first try runs to the end and is rolled back by a conflict; the driver runs the function again.
    executeWrite.mockImplementation(async (cb: any) => {
      await once(cb);
      return once(cb);
    });

    const result = await service.changeElementBinding({ elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } }, CTX);

    expect(result.success).toBe(true);
    expect(result.deltas.instantiatedDerivedExposures).toBe(2);
  });

  it('zero-row rewire guard: bound=0 rolls back as DATABASE_ERROR, never silent success', async () => {
    const { service } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-new': {
          exists: true,
          moduleName: 'mod-1',
          labels: ['ComponentClass'],
        },
      },
      singleRewireBound: 0, // TOCTOU: class vanished between preflight and tx
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DATABASE_ERROR');
    expect(result.errorMessage).toContain('matched 0 target rows');
  });

  it('Controls added-class guard: short count rolls back as DATABASE_ERROR', async () => {
    const { service } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-a': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 0, // added cls-b matched nothing in-tx
    });

    const result = await service.changeElementBinding(
      {
        elementId: 'ctrl-1',
        target: { kind: 'CLASS', classIds: ['cls-a', 'cls-b'] },
      },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DATABASE_ERROR');
    expect(result.errorMessage).toContain('matched 0 of 1 added ControlClass');
  });

  it('Controls added-class guard: PARTIAL shortfall (1 of 2) also rolls back', async () => {
    const { service } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-a': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-c': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 1, // only one of the two added ids matched in-tx
    });

    const result = await service.changeElementBinding(
      {
        elementId: 'ctrl-1',
        target: { kind: 'CLASS', classIds: ['cls-a', 'cls-b', 'cls-c'] },
      },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DATABASE_ERROR');
    expect(result.errorMessage).toContain('matched 1 of 2 added ControlClass');
  });

  it('Controls added-class guard tolerates duplicate ids in the input (Set-deduplicated expectation)', async () => {
    // The guard compares count(DISTINCT klass) to the DEDUPLICATED added
    // set — pins the code comment's duplicate-tolerance claim: two copies
    // of cls-b expect 1 distinct match, not 2.
    const { service } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 1,
    });

    const result = await service.changeElementBinding(
      {
        elementId: 'ctrl-1',
        target: { kind: 'CLASS', classIds: ['cls-b', 'cls-b'] },
      },
      CTX,
    );

    expect(result.errorMessage).toBeNull();
    expect(result.success).toBe(true);
  });

  it('represented-model rewire guard: bound=0 rolls back as DATABASE_ERROR', async () => {
    const { service } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: {},
      modelRewireBound: 0, // model vanished between preflight and tx
    });

    const result = await service.changeElementBinding(
      {
        elementId: 'comp-1',
        target: { kind: 'REPRESENTED_MODEL', modelId: 'model-x' },
      },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DATABASE_ERROR');
    expect(result.errorMessage).toContain('matched 0 target rows for Model');
  });

  it('multi-class Control: wrong-kind id refused after earlier valid classes, still before any write', async () => {
    // Per-class ordering honesty: the loop reads module findings for the
    // earlier VALID class before hitting the wrong-kind one. Those reads
    // are side-effect-free; the load-bearing invariant is that the write
    // tx never opens.
    const { service, executeWrite, getModuleByName } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: [],
      classStatus: {
        'cls-ok': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-bad': {
          exists: true,
          moduleName: 'mod-1',
          labels: ['ComponentClass'],
        },
      },
    });

    const result = await service.changeElementBinding(
      {
        elementId: 'ctrl-1',
        target: { kind: 'CLASS', classIds: ['cls-ok', 'cls-bad'] },
      },
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toContain('is not a ControlClass');
    expect(getModuleByName).toHaveBeenCalledTimes(1); // the valid class only
    expect(executeWrite).not.toHaveBeenCalled(); // never anything destructive
  });
});

describe('ElementBindingService — per-request token threading', () => {
  // The platform forwards the caller's raw bearer token into the module's
  // content methods so a module can call an upstream service on the caller's
  // behalf. Here we pin that the token in the request context reaches the
  // getExposures/getCountermeasures call unchanged.
  const CTX_TOKEN = { user: { sub: 'tester' }, token: 'bearer-xyz' };

  it('forwards the caller token into getExposures on a Component bind', async () => {
    const { service, moduleInstance } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'] },
      },
      singleRewireBound: 1,
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } },
      CTX_TOKEN,
    );

    expect(result.success).toBe(true);
    expect(moduleInstance.getExposures).toHaveBeenCalledWith('comp-1', 'cls-new', 'bearer-xyz');
    expect(moduleInstance.getCountermeasures).not.toHaveBeenCalled();
  });

  it('forwards the caller token into getCountermeasures on a Control bind', async () => {
    const { service, moduleInstance } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 1,
    });

    const result = await service.changeElementBinding(
      { elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['cls-b'] } },
      CTX_TOKEN,
    );

    expect(result.success).toBe(true);
    expect(moduleInstance.getCountermeasures).toHaveBeenCalledWith('ctrl-1', 'cls-b', 'bearer-xyz');
    expect(moduleInstance.getExposures).not.toHaveBeenCalled();
  });

  it('passes token=undefined when the request has no bearer (dev/NOAUTH absence)', async () => {
    const { service, moduleInstance } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: {
        'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'] },
      },
      singleRewireBound: 1,
    });

    const result = await service.changeElementBinding(
      { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } },
      { user: { sub: 'tester' } }, // no token
    );

    expect(result.success).toBe(true);
    expect(moduleInstance.getExposures).toHaveBeenCalledWith('comp-1', 'cls-new', undefined);
  });
});

describe('ElementBindingService — every bound class keeps exactly what its module emits', () => {
  it('a Control that keeps a class has that class\'s obsolete countermeasures removed after the upsert', async () => {
    const { service, moduleInstance, setInstantiation } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-a': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 1,
    });
    (moduleInstance.getCountermeasures as jest.Mock).mockImplementation(async (_id: string, classId: string) =>
      (classId === 'cls-a' ? [{ name: 'MFA' }, { name: 'Lockout' }] : [{ name: 'Audit' }]) as any,
    );
    (setInstantiation.deleteObsoleteFindingsInTx as jest.Mock).mockImplementation(async (_tx: unknown, req: any) => (req.classId === 'cls-a' ? 2 : 0));

    const result = await service.changeElementBinding(
      { elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['cls-a', 'cls-b'] } },
      CTX,
    );

    expect(result.success).toBe(true);
    expect(setInstantiation.deleteObsoleteFindingsInTx.mock.calls.map(([, req]: any[]) => req)).toEqual([
      { elementId: 'ctrl-1', relation: 'HAS_COUNTERMEASURE', validNames: ['MFA', 'Lockout'], classId: 'cls-a' },
      { elementId: 'ctrl-1', relation: 'HAS_COUNTERMEASURE', validNames: ['Audit'], classId: 'cls-b' },
    ]);
    // Each class's cleanup runs after that class's upsert.
    const upsertOrder = setInstantiation.upsertCountermeasuresInTx.mock.invocationCallOrder;
    const cleanupOrder = setInstantiation.deleteObsoleteFindingsInTx.mock.invocationCallOrder;
    expect(cleanupOrder[0]).toBeGreaterThan(upsertOrder[0]);
    expect(cleanupOrder[1]).toBeGreaterThan(upsertOrder[1]);
    expect(result.deltas.deletedDerivedCountermeasures).toBe(2);
  });

  it('a component bound to a new class runs the same cleanup for its exposures', async () => {
    const { service, moduleInstance, setInstantiation } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: { 'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'] } },
      singleRewireBound: 1,
    });
    moduleInstance.getExposures.mockResolvedValue([{ name: 'Weak auth' }] as any);

    const result = await service.changeElementBinding({ elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } }, CTX);

    expect(result.success).toBe(true);
    expect(setInstantiation.deleteObsoleteFindingsInTx).toHaveBeenCalledWith(expect.anything(), {
      elementId: 'comp-1',
      relation: 'HAS_EXPOSURE',
      validNames: ['Weak auth'],
      classId: 'cls-new',
    });
  });

  it('a failed cleanup fails the binding change', async () => {
    const { service, setInstantiation } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-a': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 1,
    });
    setInstantiation.deleteObsoleteFindingsInTx.mockRejectedValue(new Error('Failed to delete obsolete findings: boom'));

    const result = await service.changeElementBinding({ elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['cls-a', 'cls-b'] } }, CTX);

    expect(result.success).toBe(false);
  });
});

describe('ElementBindingService — the binding stamps the policy it evaluated', () => {
  it('stamps each bound class with the hash read with its status, after that class\'s findings', async () => {
    const { service, setInstantiation } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-a': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'], policyHash: 'ha' },
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'], policyHash: 'hb' },
      },
      controlsAddBound: 1,
    });

    const result = await service.changeElementBinding({ elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['cls-a', 'cls-b'] } }, CTX);

    expect(result.success).toBe(true);
    expect(setInstantiation.stampPolicyInTx.mock.calls.map(([, ...rest]: any[]) => rest)).toEqual([
      ['ctrl-1', 'cls-a', 'ha'],
      ['ctrl-1', 'cls-b', 'hb'],
    ]);
    const cleanupOrder = setInstantiation.deleteObsoleteFindingsInTx.mock.invocationCallOrder;
    const stampOrder = setInstantiation.stampPolicyInTx.mock.invocationCallOrder;
    expect(stampOrder[0]).toBeGreaterThan(cleanupOrder[0]);
    expect(stampOrder[1]).toBeGreaterThan(cleanupOrder[1]);
  });

  it('does not stamp a class whose module evaluates with another policy than the stored one', async () => {
    const { service, setInstantiation, moduleInstance } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: { 'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'], policyHash: 'hn' } },
      singleRewireBound: 1,
    });
    setInstantiation.policyHashToStamp.mockResolvedValue(null);

    const result = await service.changeElementBinding({ elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } }, CTX);

    expect(result.success).toBe(true);
    expect(setInstantiation.policyHashToStamp).toHaveBeenCalledWith(moduleInstance, 'cls-new', 'hn');
    expect(setInstantiation.stampPolicyInTx).not.toHaveBeenCalled();
  });

  it('does not stamp a class with no policy hash', async () => {
    const { service, setInstantiation } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: { 'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'] } },
      singleRewireBound: 1,
    });

    const result = await service.changeElementBinding({ elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } }, CTX);

    expect(result.success).toBe(true);
    expect(setInstantiation.stampPolicyInTx).not.toHaveBeenCalled();
  });

  it('a failed stamp fails the binding change, with the rest of its transaction', async () => {
    const { service, setInstantiation } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: { 'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'], policyHash: 'hn' } },
      singleRewireBound: 1,
    });
    setInstantiation.stampPolicyInTx.mockRejectedValue(new Error('boom'));

    const result = await service.changeElementBinding({ elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } }, CTX);

    expect(result.success).toBe(false);
  });
});

describe('ElementBindingService — stale flips from link changes', () => {
  it('logs the dispositions its upserts flagged stale', async () => {
    const { service, setInstantiation } = makeFixture({
      elementLabels: ['Control'],
      currentClassIds: ['cls-a'],
      classStatus: {
        'cls-a': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
        'cls-b': { exists: true, moduleName: 'mod-1', labels: ['ControlClass'] },
      },
      controlsAddBound: 1,
    });
    (setInstantiation.upsertCountermeasuresInTx as jest.Mock).mockImplementation(async (_tx: unknown, req: any) => ({
      instantiated: [],
      unresolved: [],
      staleFlipped: req.classId === 'cls-a' ? 2 : 1,
    }));
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

    const result = await service.changeElementBinding({ elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['cls-a', 'cls-b'] } }, CTX);

    expect(result.success).toBe(true);
    expect(log).toHaveBeenCalledWith('Element binding changed', expect.objectContaining({ linkStaleFlipped: 3 }));
  });
});

describe('ElementBindingService — the element lock', () => {
  it('locks the element first in the write, before it reads the current binding', async () => {
    const { service, writeStatements, writeParams } = makeFixture({
      elementLabels: ['Component'],
      currentClassIds: ['cls-old'],
      classStatus: { 'cls-new': { exists: true, moduleName: 'mod-1', labels: ['ComponentClass'] } },
      singleRewireBound: 1,
    });
    await service.changeElementBinding({ elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cls-new'] } }, CTX);
    expect(writeStatements[0]).toBe(LOCK_ELEMENT_CYPHER);
    expect(writeParams[0]).toEqual({ elementId: 'comp-1' });
    expect(writeStatements[1]).toContain('currentClassIds');
  });
});
