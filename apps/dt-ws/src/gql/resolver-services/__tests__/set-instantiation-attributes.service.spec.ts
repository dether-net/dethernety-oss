import { STORED_ATTRIBUTES_CYPHER, SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { LOCK_ELEMENT_CYPHER } from '../shared/element-db-lock';
import { UNSTAMP_POLICY_CYPHER } from '../shared/policy-stamp';
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
        if (query === LOCK_ELEMENT_CYPHER) return { records: [] };
        if (query.includes('pairIndex')) {
          // Reference pre-pass — T1078 exists.
          return { records: [toRecord({ pairIndex: 0, value: 'T1078', found: true })] };
        }
        if (query.includes('findingName') || query.includes('prunedCount')) {
          // The link reconcile's read and prune — no prior links.
          return { records: [] };
        }
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
    expect(link!.query).toContain('-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(klass)');
    expect(link!.query).toContain('klass.id = $classId');
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
      .mockResolvedValue({ unresolved: [], staleFlipped: 0 });

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
      .mockResolvedValue({ unresolved: [], staleFlipped: 0 });

    await (service as any).setAttributes(
      { componentId: 'comp-1', classId: 'cls-1', attributes: { k: 'v' } },
      { user: { sub: 'tester' } }, // no token
    );

    expect(processSpy.mock.calls[0][5]).toBeUndefined();
  });
});

describe('SetInstantiationAttributesService — reference pre-pass', () => {
  // Every reference is resolved in one statement before any edge is written. A
  // resolved ref is linked; an unresolved or disallowed one is not written, is
  // recorded on its finding and returned; an unresolved RegulatoryRequirement is
  // only warned about. The save itself never fails on a reference.
  function makeTxWith(existing: Array<[number, string]>) {
    const calls: Array<{ query: string; params: any }> = [];
    const tx = {
      run: jest.fn(async (query: string, params: any) => {
        calls.push({ query, params });
        if (query === LOCK_ELEMENT_CYPHER) return { records: [] };
        if (query.includes('pairIndex')) {
          const records = existing
            .filter(([i, value]) => (params[`p${i}`] as string[]).includes(value))
            .map(([pairIndex, value]) => toRecord({ pairIndex, value, found: true }));
          return { records };
        }
        if (query.includes('instantiatedName')) {
          return { records: [toRecord({ instantiatedName: params.attributes.name })] };
        }
        return { records: [toRecord({ relationshipsCreated: { toNumber: () => 1 } })] };
      }),
    };
    return { tx, calls };
  }

  const links = (calls: Array<{ query: string; params: any }>) =>
    calls
      .filter(c => c.query.includes('MERGE (e)-[rel:'))
      .map(c => `${c.query.match(/MERGE \(e\)-\[rel:(\w+)\]/)![1]}->${c.params.value}`);
  const upserts = (calls: Array<{ query: string; params: any }>) =>
    calls.filter(c => c.query.includes('instantiatedName'));

  it('resolves once, links only what exists, records the rest on the exposure', async () => {
    const { service } = makeService();
    const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    const { tx, calls } = makeTxWith([[0, 'T1078'], [1, 'AML.T0051']]);

    const result = await service.upsertExposuresInTx(tx as any, {
      componentId: 'comp-1',
      classId: 'cls-1',
      exposures: [
        {
          name: 'A',
          exploitedBy: [
            'T1078',
            { label: 'MitreAtlasTechnique', property: 'atlas_id', value: 'AML.T0051', attributes: { justification: 'j' } },
            'T9999',
            { label: 'MitreAttackTechnique', property: 'attack_iexposured', value: 'T1078' },
            'T9999',
          ],
        } as any,
        { name: 'B', exploitedBy: ['T1078'] } as any,
      ],
    });

    expect(calls.filter(c => c.query.includes('pairIndex'))).toHaveLength(1);
    // The element's lock comes first, before the pre-pass and every read the upsert depends on.
    expect(calls[0]).toEqual({ query: LOCK_ELEMENT_CYPHER, params: { elementId: 'comp-1' } });
    expect(calls[1].query).toContain('pairIndex');
    expect(links(calls)).toEqual(['EXPLOITED_BY->T1078', 'EXPLOITED_BY->AML.T0051', 'EXPLOITED_BY->T1078']);
    const atlasLink = calls.find(c => c.params?.value === 'AML.T0051')!;
    expect(atlasLink.query).toContain('OPTIONAL MATCH (t:MitreAtlasTechnique) WHERE t.atlas_id = $value');
    expect(atlasLink.params.edge).toEqual({ justification: 'j' });

    const [a, b] = upserts(calls);
    expect(a.query).toContain('SET e.unresolvedReferences = $unresolvedReferences');
    expect(a.params.unresolvedReferences).toEqual(['T9999', 'MitreAttackTechnique.attack_iexposured=T1078']);
    expect(b.params.unresolvedReferences).toBeNull();

    expect(result).toEqual({
      instantiated: ['A', 'B'],
      unresolved: ['T9999', 'MitreAttackTechnique.attack_iexposured=T1078'],
      staleFlipped: 0,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toMatchObject({
      elementId: 'comp-1',
      classId: 'cls-1',
      findingKind: 'exposure',
      references: [
        { finding: 'A', field: 'exploitedBy', reference: 'T9999' },
        { finding: 'A', field: 'exploitedBy', reference: 'MitreAttackTechnique.attack_iexposured=T1078' },
        { finding: 'A', field: 'exploitedBy', reference: 'T9999' },
      ],
    });
  });

  it('drops a finding attribute the database cannot store, with a warning, and keeps the finding', async () => {
    const { service } = makeService();
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const { tx, calls } = makeTxWith([]);

    const result = await service.upsertExposuresInTx(tx as any, {
      componentId: 'comp-1',
      classId: 'cls-1',
      exposures: [{ name: 'A', type: 't', tags: ['x', null], mitigationTechniques: ['', 'M1'] } as any],
    });

    expect(upserts(calls)[0].params.attributes).toEqual({ name: 'A', type: 't', mitigationTechniques: ['', 'M1'] });
    expect(result.instantiated).toEqual(['A']);
    expect(warnSpy).toHaveBeenCalledWith(
      'Dropping module finding attributes that cannot be stored',
      expect.objectContaining({
        findingKind: 'exposure',
        finding: 'A',
        violations: [{ key: 'tags', violation: expect.stringMatching(/list element 1 is null/) }],
      }),
    );
  });

  it('skips a finding whose name cannot be stored, before any read, and writes the others', async () => {
    const { service } = makeService();
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const { tx, calls } = makeTxWith([]);

    const result = await service.upsertCountermeasuresInTx(tx as any, {
      componentId: 'ctl-1',
      classId: 'ccls-1',
      countermeasures: [{ name: { bad: true }, respondsWith: ['M9999'] } as any, { name: 'C', tags: [undefined], respondsWith: ['M1037'] } as any],
    });

    expect(upserts(calls).map(c => c.params.attributes)).toEqual([{ name: 'C' }]);
    // The skipped finding reaches no read: every statement that takes the finding names gets only the kept one.
    const nameLists = calls.filter(c => Array.isArray(c.params?.names)).map(c => JSON.stringify(c.params.names));
    expect(nameLists.length).toBeGreaterThan(0);
    expect(new Set(nameLists)).toEqual(new Set(['["C"]']));
    // Nor do its references reach the resolve statement.
    const resolve = calls.find(c => c.query.includes('pairIndex'))!;
    expect(Object.values(resolve.params).flat()).toContain('M1037');
    expect(Object.values(resolve.params).flat()).not.toContain('M9999');
    expect(result.instantiated).toEqual(['C']);
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping a module finding whose name cannot be stored',
      expect.objectContaining({ findingKind: 'countermeasure' }),
    );
  });

  it('skips the resolve statement when no reference is allowed, and clears the marker', async () => {
    const { service } = makeService();
    const { tx, calls } = makeTxWith([]);

    const result = await service.upsertExposuresInTx(tx as any, {
      componentId: 'comp-1',
      classId: 'cls-1',
      exposures: [{ name: 'A', exploitedBy: [] } as any],
    });

    expect(calls.some(c => c.query.includes('pairIndex'))).toBe(false);
    expect(upserts(calls)[0].params.unresolvedReferences).toBeNull();
    expect(result).toEqual({ instantiated: ['A'], unresolved: [], staleFlipped: 0 });
  });

  it('countermeasures: respondsWith and verbs share the pass; a missing requirement is only warned', async () => {
    const { service } = makeService();
    const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const { tx, calls } = makeTxWith([[2, 'M1037'], [4, 'D3-NTA'], [5, 'iso:A.8.20'], [0, 'T1021']]);

    const result = await service.upsertCountermeasuresInTx(tx as any, {
      componentId: 'ctl-1',
      classId: 'ccls-1',
      countermeasures: [
        {
          name: 'C',
          respondsWith: [
            'M1037',
            { label: 'MitreDefendTechnique', property: 'd3fendId', value: 'D3-NTA' },
            { label: 'RegulatoryRequirement', property: 'id', value: 'iso:A.8.20' },
            { label: 'RegulatoryRequirement', property: 'id', value: 'iso:A.9.99' },
            { label: 'MitreAtlasMitigation', property: 'atlas_id', value: 'AML.M0099' },
          ],
          mitigates: ['T1021', 'T1562.010'],
          detects: [{ label: 'MitreAttackMitigation', property: 'attack_id', value: 'M1037' }],
        } as any,
      ],
    });

    expect(calls[0]).toEqual({ query: LOCK_ELEMENT_CYPHER, params: { elementId: 'ctl-1' } });
    expect(calls.filter(c => c.query.includes('pairIndex'))).toHaveLength(1);
    expect(links(calls)).toEqual([
      'RESPONDS_WITH->M1037',
      'RESPONDS_WITH->D3-NTA',
      'RESPONDS_WITH->iso:A.8.20',
      'COUNTERMEASURE_MITIGATES->T1021',
    ]);
    const [cm] = upserts(calls);
    expect(cm.query).toContain('SET cm.unresolvedReferences = $unresolvedReferences');
    expect(cm.params.unresolvedReferences).toEqual([
      'AML.M0099',
      'T1562.010',
      'MitreAttackMitigation.attack_id=M1037',
    ]);
    expect(result.unresolved).toEqual(['AML.M0099', 'T1562.010', 'MitreAttackMitigation.attack_id=M1037']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Regulatory requirement references not in the graph; not linked',
      expect.objectContaining({
        references: [{ finding: 'C', field: 'respondsWith', reference: 'iso:A.9.99' }],
      }),
    );
  });

  it('setAttributes returns the unresolved references with success, and the resolver surfaces them', async () => {
    const { service } = makeService();
    (service as any).neo4jDriver.session = jest.fn(() => ({
      executeWrite: jest.fn(async () => ({
        moduleName: 'mod-1',
        componentType: 'Component',
        valueChanged: false,
        changedKeys: [],
        staleFlippedCount: 0,
      })),
      close: jest.fn(async () => {}),
    }));
    (service as any).moduleRegistry.getModuleByName = jest.fn(() => ({}));
    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: ['T9999'], staleFlipped: 0 });

    const result = await service.setAttributes({ componentId: 'c', classId: 'k', attributes: { k: 'v' } });
    expect(result).toMatchObject({ success: true, unresolvedReferences: ['T9999'] });

    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
    const clean = await service.setAttributes({ componentId: 'c', classId: 'k', attributes: { k: 'v' } });
    expect(clean.success).toBe(true);
    expect(clean.unresolvedReferences).toBeUndefined();

    jest.spyOn(service, 'runExclusive').mockResolvedValue({ success: true, unresolvedReferences: ['T9999'] } as any);
    const envelope = await service.getResolvers().Mutation.setInstantiationAttributes(
      null,
      { componentId: 'c', classId: 'k', attributes: {} },
      {},
    );
    expect(envelope).toEqual({
      success: true,
      staleFlippedCount: null,
      unresolvedReferences: ['T9999'],
      errorCode: null,
      errorMessage: null,
    });
  });
});

describe('SetInstantiationAttributesService — per-element lock spans the batch debounce', () => {
  // The batch queue executes only the latest queued request for an element. That drops nothing only because the
  // resolver holds the element's lock across the whole debounce: a second write to the same element waits for the
  // first batch to finish and then runs as its own batch. If the lock and the batch ever stop nesting this way, the
  // earlier write would be silently discarded.
  it('two concurrent writes to one element both reach setAttributes, in order', async () => {
    const { service } = makeService();
    (service as any).config.batchEnabled = true;
    (service as any).config.batchDebounceTime = 10;
    const events: string[] = [];
    jest.spyOn(service as any, 'setAttributes').mockImplementation(async (request: any) => {
      const key = Object.keys(request.attributes).join(',');
      events.push(`start ${key}`);
      await new Promise((r) => setTimeout(r, 20));
      events.push(`end ${key}`);
      return { success: true, staleFlippedCount: 0 };
    });

    const mutation = service.getResolvers().Mutation.setInstantiationAttributes;
    const [first, second] = await Promise.all([
      mutation(null, { componentId: 'comp-1', classId: 'cls-1', attributes: { x: 1 } }, {}),
      mutation(null, { componentId: 'comp-1', classId: 'cls-1', attributes: { y: 2 } }, {}),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(events).toEqual(['start x', 'end x', 'start y', 'end y']);
  });
});

describe('SetInstantiationAttributesService — empty attributes evaluate the element as it stands', () => {
  function withWrite(service: any, row: RecordMap) {
    const run = jest.fn().mockResolvedValue({ records: [toRecord(row)] });
    service.neo4jDriver.session = jest.fn(() => ({
      executeWrite: jest.fn(async (work: any) => work({ run })),
      close: jest.fn(async () => {}),
    }));
    service.moduleRegistry.getModuleByName = jest.fn(() => ({}));
    return run;
  }

  it('accepts {}: one write that changes nothing, no stale flip, and the exposures are still evaluated', async () => {
    const { service } = makeService();
    const run = withWrite(service, { moduleName: 'mod-1', type: 'Component', valueChanged: false, changedKeys: [] });
    const evaluate = jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });

    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: {} });

    expect(result.success).toBe(true);
    // The save's one write; the other statement is the stamp's, here an unstamp (the class carries no hash). A request
    // that writes nothing takes no lock and reads nothing first.
    const writes = run.mock.calls.filter(([query]: [string]) => query !== UNSTAMP_POLICY_CYPHER);
    expect(writes).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(writes[0][1]).toMatchObject({ componentId: 'comp-1', classId: 'cls-1', attributes: {} });
    expect(evaluate).toHaveBeenCalledWith(expect.anything(), 'comp-1', 'cls-1', expect.anything(), expect.any(String), undefined);
  });

  it('still rejects attributes that are not an object, an array included', async () => {
    const { service } = makeService();
    const run = withWrite(service, {});
    for (const attributes of [[], 'x', 7]) {
      const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: attributes as any });
      expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
      expect(result.error).toContain('attributes is required and must be an object');
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('still rejects a nested value', async () => {
    const { service } = makeService();
    const run = withWrite(service, {});
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { k: { nested: true } } as any });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('attributes.k');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a list holding null, naming the attribute, and keeps an empty string or an empty list', async () => {
    const { service } = makeService();
    const run = withWrite(service, {});
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { feeds: ['nvd', null], ok: [''], none: [] } as any });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('attributes.feeds: list element 1 is null');
    expect(result.error).not.toContain('attributes.ok');
    expect(result.error).not.toContain('attributes.none');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('SetInstantiationAttributesService — flattened keys over the limits are refused', () => {
  function withWrite(service: any) {
    const run = jest.fn().mockResolvedValue({ records: [toRecord({ moduleName: 'mod-1', type: 'Component', valueChanged: false, changedKeys: [] })] });
    service.neo4jDriver.session = jest.fn(() => ({
      executeWrite: jest.fn(async (work: any) => work({ run })),
      close: jest.fn(async () => {}),
    }));
    service.moduleRegistry.getModuleByName = jest.fn(() => ({}));
    return run;
  }

  it('refuses an index far above the limit, naming the key, and writes nothing', async () => {
    const { service } = makeService();
    const run = withWrite(service);
    const result = await service.setAttributes({
      componentId: 'comp-1',
      classId: 'cls-1',
      attributes: { 'allowed_origins[4294967294]': 'x', 'allowed_origins[0]': 'a.example' },
    });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('attributes.allowed_origins[4294967294]: a list index is above the maximum of 10000');
    expect(result.error).not.toContain('allowed_origins[0]');
    expect(run).not.toHaveBeenCalled();
  });

  it('accepts the largest allowed index and refuses the next one', async () => {
    const { service } = makeService();
    withWrite(service);
    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
    const ok = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { 'l[10000]': 'x' } });
    expect(ok.success).toBe(true);
    const refused = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { 'l[10001]': 'x' } });
    expect(refused).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
  });

  it('refuses a request whose lists add up past the total, too many parts, a reserved part, and keys that disagree', async () => {
    const { service } = makeService();
    const run = withWrite(service);
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 12; i++) attributes[`a${i}[10000]`] = 'x';
    attributes[Array.from({ length: 33 }, (_, i) => `p${i}`).join('.')] = 'x';
    attributes['x.__proto__'] = 'x';
    attributes['g.b'] = 'x';
    attributes['g[0]'] = 'x';
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('would hold more than 100000 entries in all');
    expect(result.error).toContain('the key has more than 32 parts');
    expect(result.error).toContain('attributes.x.__proto__: the key uses a reserved name');
    expect(result.error).toContain('attributes.g[0]: conflicts with another key: one uses this place as a list, the other as an object or a value');
    expect(run).not.toHaveBeenCalled();
  });

  it('accepts names that are also built-in members, and they reach nothing shared', async () => {
    const { service } = makeService();
    const run = withWrite(service);
    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
    const callBefore = Function.prototype.call;
    const result = await service.setAttributes({
      componentId: 'comp-1',
      classId: 'cls-1',
      attributes: { 'hasOwnProperty.call': 'x', 'toString.call': 'y', 'valueOf[0]': 'z' },
    });
    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalled();
    expect(Object.prototype.hasOwnProperty.call).toBe(callBefore);
    expect(Object.prototype.toString.call).toBe(callBefore);
    expect((Object.prototype.valueOf as any)[0]).toBeUndefined();
  });

  it('refuses an index into a list answer in the same request, and leaves the request untouched', async () => {
    const { service } = makeService();
    const run = withWrite(service);
    const attributes = { a: ['x'], 'a[3]': 'y' };
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('attributes.a[3]: conflicts with another key');
    expect(attributes.a).toEqual(['x']);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the error short for a large request: at most 20 reasons, then a count', async () => {
    const { service } = makeService();
    withWrite(service);
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 500; i++) attributes[`k${i}[99999]`] = 'x';
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('and 480 more');
    expect(result.error!.length).toBeLessThan(3000);
  });

  it('keeps the error short when many values are bad too', async () => {
    const { service } = makeService();
    withWrite(service);
    const attributes: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) attributes[`k${i}`] = { nested: true };
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: attributes as any });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('and 280 more');
  });

  it('refuses a key not in its plain form, naming the plain form, and writes nothing', async () => {
    const { service } = makeService();
    const run = withWrite(service);
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { 'tags[]': 'x', 'ports[01]': 2, ok: 1 } });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('attributes.tags[]: the key is not in its plain form (tags)');
    expect(result.error).toContain('attributes.ports[01]: the key is not in its plain form (ports[1])');
    expect(result.error).not.toContain('attributes.ok');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a key not in its plain form for that reason only, never blaming the plain key it would collide with', async () => {
    const { service } = makeService();
    const run = withWrite(service);
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { x: [1], '[x]': 1 } });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('attributes.[x]: the key is not in its plain form (x)');
    expect(result.error).not.toContain('attributes.x:');
    expect(result.error).not.toContain('list index');
    expect(result.error!.split('attributes.')).toHaveLength(2);
    expect(run).not.toHaveBeenCalled();
  });

  it('lets a key not in its plain form through when it is sent as null, so it can be cleared', async () => {
    const { service } = makeService();
    withWrite(service);
    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
    expect((await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { 'tags[]': null } as any })).success).toBe(true);
  });

  it('lets a key through when it is sent as null, so an old key over the limits can be cleared', async () => {
    const { service } = makeService();
    withWrite(service);
    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { 'l[4294967294]': null } as any });
    expect(result.success).toBe(true);
  });

  it('prints a long or control-character key short and clean', async () => {
    const { service } = makeService();
    withWrite(service);
    const key = `l\n${'k'.repeat(300)}[99999]`;
    const result = await service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes: { [key]: 'x' } });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain(`attributes.l?${'k'.repeat(78)}…: a list index is above the maximum of 10000`);
    expect(result.error).not.toContain('\n');
    expect(result.error!.length).toBeLessThan(400);
  });
});

describe('SetInstantiationAttributesService — a request is written into the stored answers', () => {
  const row = { moduleName: 'mod-1', type: 'Component', valueChanged: true, changedKeys: [] };
  function withStored(service: any, storedAttrs: Record<string, unknown>) {
    const run = jest.fn(async (query: string) => {
      if (query === LOCK_ELEMENT_CYPHER) return { records: [] };
      if (query === STORED_ATTRIBUTES_CYPHER) return { records: [toRecord({ storedAttrs })] };
      return { records: [toRecord(row)] };
    });
    service.neo4jDriver.session = jest.fn(() => ({
      executeWrite: jest.fn(async (work: any) => work({ run })),
      close: jest.fn(async () => {}),
    }));
    service.moduleRegistry.getModuleByName = jest.fn(() => ({}));
    jest.spyOn(service as any, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
    return run;
  }
  const save = (service: any, attributes: Record<string, unknown>) =>
    service.setAttributes({ componentId: 'comp-1', classId: 'cls-1', attributes });
  // What statement 1 was asked to write: its attributes parameter.
  const written = (run: jest.Mock) => {
    const call = run.mock.calls.find(([query]: [string]) => query.includes('SET r += newAttrs'));
    return call?.[1]?.attributes;
  };

  it('locks the element before it reads the stored answers', async () => {
    const { service } = makeService();
    const run = withStored(service, {});
    await save(service, { a: 1 });
    expect(run.mock.calls[0]).toEqual([LOCK_ELEMENT_CYPHER, { elementId: 'comp-1' }]);
    expect(run.mock.calls[1][0]).toBe(STORED_ATTRIBUTES_CYPHER);
  });

  it('import, then an update with list entries: the entries replace the stored whole list', async () => {
    const { service } = makeService();
    const run = withStored(service, { tags: ['a', 'b'], other: 1 });
    const result = await save(service, { 'tags[0]': 'c', 'tags[1]': 'd' });
    expect(result.success).toBe(true);
    // The whole list is cleared in the same write, so statement 1 counts it among the changed keys.
    expect(written(run)).toEqual({ 'tags[0]': 'c', 'tags[1]': 'd', tags: null });
  });

  it('an update with list entries, then an import of the whole list: the whole list replaces the entries', async () => {
    const { service } = makeService();
    const run = withStored(service, { 'tags[0]': 'a', 'tags[1]': 'b', other: 1 });
    const result = await save(service, { tags: ['c'] });
    expect(result.success).toBe(true);
    expect(written(run)).toEqual({ tags: ['c'], 'tags[0]': null, 'tags[1]': null });
  });

  it('a request that only clears is never refused, and reads nothing first', async () => {
    const { service } = makeService();
    const run = withStored(service, { 'a[00].x': 1, 'a[00][0]': 2, 'a[0].z': 3 });
    expect((await save(service, { 'a[00].x': null })).success).toBe(true);
    expect(written(run)).toEqual({ 'a[00].x': null });
    const queries = run.mock.calls.map(([q]: [string]) => q);
    expect(queries).not.toContain(STORED_ATTRIBUTES_CYPHER);
    expect(queries).not.toContain(LOCK_ELEMENT_CYPHER);
  });

  it('the shape a request writes wins below the top too: objects in a list replace the strings stored there', async () => {
    const { service } = makeService();
    const run = withStored(service, { 'p[0]': 'a', 'p[1]': 'b' });
    expect((await save(service, { 'p[0].x': 1 })).success).toBe(true);
    expect(written(run)).toEqual({ 'p[0].x': 1, 'p[0]': null });
  });

  it('moving an answer to the other shape with the same values flips nothing stale', async () => {
    const { service } = makeService();
    const run = withStored(service, { tags: ['a', 'b'] });
    expect((await save(service, { 'tags[0]': 'a', 'tags[1]': 'b' })).success).toBe(true);
    expect(written(run)).toEqual({ 'tags[0]': 'a', 'tags[1]': 'b', tags: null });
    expect(run.mock.calls.some(([q]: [string]) => q.includes('SET e.dispositionStale = true'))).toBe(false);
  });

  it('a changed answer in the other shape does flip dispositions stale', async () => {
    const { service } = makeService();
    const run = withStored(service, { tags: ['a', 'b'] });
    expect((await save(service, { 'tags[0]': 'a', 'tags[1]': 'z' })).success).toBe(true);
    expect(run.mock.calls.some(([q]: [string]) => q.includes('SET e.dispositionStale = true'))).toBe(true);
  });

  it('refuses re-writing a key the stored answers leave out', async () => {
    const stored: Record<string, string> = { 'c[10000]': 'z' };
    for (let i = 0; i < 9; i++) stored[`b${i}[10000]`] = 'x';
    const { service } = makeService();
    const run = withStored(service, stored);
    const result = await save(service, { 'c[10000]': 'y' });
    expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
    expect(result.error).toContain('would hold more than 100000 entries in all');
    expect(written(run)).toBeUndefined();
  });

  it('refuses a request that pushes the stored lists over the list total, on its own key or on a stored one', async () => {
    const stored: Record<string, string> = {};
    for (let i = 0; i < 9; i++) stored[`b${i}[10000]`] = 'x';
    for (const attributes of [{ 'c[10000]': 'y' }, { 'a[10000]': 'y' }]) {
      const { service } = makeService();
      const run = withStored(service, stored);
      const result = await save(service, attributes);
      expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
      expect(result.error).toContain('would hold more than 100000 entries in all');
      expect(written(run)).toBeUndefined();
    }
  });

  it('does not hold keys left out before against a request that leaves them alone', async () => {
    const { service } = makeService();
    const run = withStored(service, { 'x[4294967294]': 'z', 'h[0]': 1, 'h[0].y': 2, a: 1 });
    expect((await save(service, { b: 2 })).success).toBe(true);
    expect(written(run)).toEqual({ b: 2 });
  });
});
