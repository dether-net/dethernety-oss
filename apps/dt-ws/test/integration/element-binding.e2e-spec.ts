// Integration coverage for ElementBindingService (changeElementBinding).
//
// Strategy: instantiate the resolver service directly against a real Memgraph
// testcontainer with a real neo4j-driver and a hand-rolled ModuleRegistryService
// mock that returns canned findings. We do NOT boot the full Apollo/NestJS
// stack — this matches provenance.e2e-spec.ts's pattern (direct service call)
// for the same reasons: fast, deterministic, and the resolver factory is
// trivial enough that schema-level wiring is exercised by booting dt-ws in
// dev/CI, not by these tests.
//
// Coverage:
//   - Transition matrix on Component (single-class) and Control (N-N).
//   - Identity short-circuit — both single-class and Controls (incl.
//     set-equality with reversed order).
//   - Module-failure rollback — pre/post graph snapshots identical.
//   - Validation failure (VALIDATION_ERROR, REPRESENTED_MODEL_NOT_ALLOWED).
//   - Element-not-found, class-not-found, orphan-class, model-not-found.
//   - USER-authored finding preservation across every transition.
//   - Class-derived cleanup honesty + legacy-stale catch.
//   - Mutual-exclusion invariant — afterEach query returns 0 after every test.
//   - SYSTEM-stamping integrity (I5) — every instantiated finding has
//     createdBy = 'SYSTEM'.
//
// Tests run sequentially via `--runInBand` (already configured by jest-e2e.json)
// so the shared Memgraph container is safe.

import { ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { assertMutualExclusion } from './invariants';
import { ElementBindingService } from '../../src/gql/resolver-services/element-binding.service';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';

jest.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Module registry mock — per-test reset via setModuleData().
// ---------------------------------------------------------------------------

type ModuleData = {
  exposures?: any[];
  countermeasures?: any[];
  // Set to throw to simulate module failure.
  throwOn?: 'getExposures' | 'getCountermeasures';
};

class FakeModuleRegistry {
  private byClass = new Map<string, ModuleData>();

  setForClass(classId: string, data: ModuleData) {
    this.byClass.set(classId, data);
  }

  reset() {
    this.byClass.clear();
  }

  // The service calls this with the module name from the §4.2 lookup. Our
  // seed uses `mod-1` as the module name for every class; this mock returns
  // a synthetic DTModule-shaped object whose getExposures/getCountermeasures
  // look up by classId.
  getModuleByName(name: string): any | undefined {
    if (name !== 'mod-1') return undefined;
    const byClass = this.byClass;
    return {
      getExposures: async (_elementId: string, classId: string) => {
        const data = byClass.get(classId);
        if (!data) return [];
        if (data.throwOn === 'getExposures') throw new Error('module exploded');
        return data.exposures ?? [];
      },
      getCountermeasures: async (_elementId: string, classId: string) => {
        const data = byClass.get(classId);
        if (!data) return [];
        if (data.throwOn === 'getCountermeasures') throw new Error('module exploded');
        return data.countermeasures ?? [];
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Minimal stub services so SetInstantiationAttributesService instantiates.
// We never call its methods that depend on these (we only use the tx-bound
// helpers), but the constructor reads gqlConfig from ConfigService.
// ---------------------------------------------------------------------------

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') {
        return {
          // Only fields touched by SetInstantiationAttributesService's
          // constructor — generous defaults; nothing in the tx-bound path
          // reads from them, but the ctor expects the object to exist.
          maxQueryDepth: 10,
          maxQueryComplexity: 1000,
          queryTimeout: 30000,
          enableIntrospection: false,
          enableAuthentication: true,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

function makeStubAuthService(): any {
  return {
    extractAuthContext: (ctx: any) => ({ user: ctx?.user, token: ctx?.token }),
    checkAuthorization: async () => ({ allowed: true }),
  };
}

function makeStubMonitoringService(): any {
  return { recordOperation: () => {} };
}

// ---------------------------------------------------------------------------
// Cypher seed helpers.
// ---------------------------------------------------------------------------

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function seedModule(driver: any): Promise<void> {
  await runWrite(driver, `CREATE (m:Module {id: 'mod-1-id', name: 'mod-1'})`);
}

async function seedClass(
  driver: any,
  classLabel: string,
  classId: string,
  active = true,
): Promise<void> {
  const rel = active ? 'HAS_CLASS' : 'HAS_ORPHANED_CLASS';
  await runWrite(
    driver,
    `MATCH (m:Module {name: 'mod-1'})
     CREATE (m)-[:${rel}]->(:${classLabel} {id: $classId, name: $classId})`,
    { classId },
  );
}

async function seedComponent(driver: any, id: string): Promise<void> {
  await runWrite(driver, `CREATE (:Component {id: $id, name: $id})`, { id });
}

async function seedControl(driver: any, id: string): Promise<void> {
  await runWrite(driver, `CREATE (:Control {id: $id, name: $id})`, { id });
}

async function seedModel(driver: any, id: string): Promise<void> {
  await runWrite(driver, `CREATE (:Model {id: $id, name: $id})`, { id });
}

async function bindClassEdge(
  driver: any,
  elementId: string,
  classId: string,
): Promise<void> {
  await runWrite(
    driver,
    `MATCH (c {id: $elementId}), (k {id: $classId})
     MERGE (c)-[:IS_INSTANCE_OF]->(k)`,
    { elementId, classId },
  );
}

async function bindRepresentsModelEdge(
  driver: any,
  elementId: string,
  modelId: string,
): Promise<void> {
  await runWrite(
    driver,
    `MATCH (c {id: $elementId}), (m:Model {id: $modelId})
     MERGE (c)-[:REPRESENTS_MODEL]->(m)`,
    { elementId, modelId },
  );
}

async function seedUserExposure(
  driver: any,
  elementId: string,
  name: string,
  authoredBy = 'user-99',
): Promise<void> {
  await runWrite(
    driver,
    `MATCH (c {id: $elementId})
     CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {
       id: randomUUID(),
       name: $name,
       createdBy: 'USER',
       authoredBy: $authoredBy
     })`,
    { elementId, name, authoredBy },
  );
}

async function seedSystemExposureBoundToClass(
  driver: any,
  elementId: string,
  classId: string,
  name: string,
): Promise<void> {
  await runWrite(
    driver,
    `MATCH (c {id: $elementId}), (k {id: $classId})
     CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {
       id: randomUUID(),
       name: $name,
       createdBy: 'SYSTEM'
     })-[:IS_EXPOSURE_OF]->(k)`,
    { elementId, classId, name },
  );
}

async function readGraphSnapshot(driver: any): Promise<{ edges: number; nodes: number }> {
  const session = driver.session();
  try {
    const nr = await session.run(`MATCH (n) RETURN COUNT(n) AS cnt`);
    const er = await session.run(`MATCH ()-[r]->() RETURN COUNT(r) AS cnt`);
    return {
      nodes: nr.records[0].get('cnt').toNumber?.() ?? Number(nr.records[0].get('cnt')),
      edges: er.records[0].get('cnt').toNumber?.() ?? Number(er.records[0].get('cnt')),
    };
  } finally {
    await session.close();
  }
}

async function readBinding(
  driver: any,
  elementId: string,
): Promise<{ classIds: string[]; modelId: string | null }> {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (c {id: $elementId})
       OPTIONAL MATCH (c)-[:IS_INSTANCE_OF]->(k)
         WHERE any(l IN labels(k) WHERE l ENDS WITH 'Class')
       OPTIONAL MATCH (c)-[:REPRESENTS_MODEL]->(m:Model)
       RETURN collect(DISTINCT k.id) AS cids, m.id AS mid`,
      { elementId },
    );
    return {
      classIds: result.records[0]?.get('cids') ?? [],
      modelId: result.records[0]?.get('mid') ?? null,
    };
  } finally {
    await session.close();
  }
}

async function readFindings(
  driver: any,
  elementId: string,
  rel: 'HAS_EXPOSURE' | 'HAS_COUNTERMEASURE',
): Promise<Array<{ name: string; createdBy: string | null; classIds: string[] }>> {
  const session = driver.session();
  try {
    const classRel = rel === 'HAS_EXPOSURE' ? 'IS_EXPOSURE_OF' : 'IS_COUNTERMEASURE_OF';
    const result = await session.run(
      `MATCH (c {id: $elementId})-[:${rel}]->(f)
       OPTIONAL MATCH (f)-[:${classRel}]->(k)
       RETURN f.name AS name, f.createdBy AS createdBy, collect(DISTINCT k.id) AS classIds`,
      { elementId },
    );
    return result.records.map((rec) => ({
      name: rec.get('name'),
      createdBy: rec.get('createdBy'),
      classIds: (rec.get('classIds') ?? []).filter((x: any) => x != null),
    }));
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Test suite.
// ---------------------------------------------------------------------------

describe('ElementBindingService — atomic class-change invariants', () => {
  let mg: MemgraphHandle;
  let registry: FakeModuleRegistry;
  let setInst: SetInstantiationAttributesService;
  let service: ElementBindingService;

  beforeAll(async () => {
    mg = await startMemgraph();
    const config = makeStubConfigService();
    registry = new FakeModuleRegistry();
    const auth = makeStubAuthService();
    const monitoring = makeStubMonitoringService();

    // SetInstantiationAttributesService is instantiated solely so the new
    // service can call its tx-bound upsert helpers. We deliberately skip
    // onModuleInit (avoids spinning a cleanup interval that would leak
    // across tests).
    setInst = new SetInstantiationAttributesService(
      mg.driver as any,
      config,
      registry as any,
      auth as any,
      monitoring as any,
    );

    service = new ElementBindingService(
      mg.driver as any,
      config,
      registry as any,
      auth as any,
      setInst,
    );
  }, 180_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    registry.reset();
    await seedModule(mg.driver);
  });

  afterEach(async () => {
    await assertMutualExclusion(mg.driver);
  });

  const ctx = (sub = 'test-user') => ({ user: { sub } });

  // -------------------------------------------------------------------------
  // §5.7 transition matrix — Component (single-class).
  // -------------------------------------------------------------------------

  describe('§5.7 transitions — Component (single-class)', () => {
    beforeEach(async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedClass(mg.driver, 'ComponentClass', 'cc-B');
      await seedModel(mg.driver, 'model-X');
      registry.setForClass('cc-A', {
        exposures: [{ name: 'SQLi', description: 'classA' }],
      });
      registry.setForClass('cc-B', {
        exposures: [{ name: 'XSS', description: 'classB' }],
      });
    });

    it('none → class: instantiates derived findings, sets binding', async () => {
      await seedComponent(mg.driver, 'comp-1');
      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(result.deltas.instantiatedDerivedExposures).toBe(1);
      expect(result.deltas.deletedDerivedExposures).toBe(0);

      const binding = await readBinding(mg.driver, 'comp-1');
      expect(binding.classIds).toEqual(['cc-A']);

      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings).toHaveLength(1);
      expect(findings[0].name).toBe('SQLi');
      expect(findings[0].createdBy).toBe('SYSTEM');
      expect(findings[0].classIds).toEqual(['cc-A']);
    });

    it('class → class: sweeps old findings, instantiates new ones', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'SQLi');

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-B'] } },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.deletedDerivedExposures).toBe(1);
      expect(result.deltas.instantiatedDerivedExposures).toBe(1);

      const binding = await readBinding(mg.driver, 'comp-1');
      expect(binding.classIds).toEqual(['cc-B']);

      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings.map((f) => f.name).sort()).toEqual(['XSS']);
      expect(findings[0].classIds).toEqual(['cc-B']);
    });

    it('class → representedModel: sweeps all derived findings, sets REPRESENTS_MODEL', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'SQLi');

      const result = await service.changeElementBinding(
        {
          elementId: 'comp-1',
          target: { kind: 'REPRESENTED_MODEL', modelId: 'model-X' },
        },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.deletedDerivedExposures).toBe(1);
      expect(result.deltas.instantiatedDerivedExposures).toBe(0);

      const binding = await readBinding(mg.driver, 'comp-1');
      expect(binding.classIds).toEqual([]);
      expect(binding.modelId).toBe('model-X');

      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings).toHaveLength(0);
    });

    it('class → none: sweeps all derived findings, leaves no binding', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'SQLi');

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'NONE' } },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.deletedDerivedExposures).toBe(1);

      const binding = await readBinding(mg.driver, 'comp-1');
      expect(binding.classIds).toEqual([]);
      expect(binding.modelId).toBeNull();
    });

    it('representedModel → class: removes model edge, instantiates derived', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindRepresentsModelEdge(mg.driver, 'comp-1', 'model-X');

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      expect(result.success).toBe(true);

      const binding = await readBinding(mg.driver, 'comp-1');
      expect(binding.classIds).toEqual(['cc-A']);
      expect(binding.modelId).toBeNull();
    });

    it('identity transition (I8): zero deltas, no module call (preflight short-circuit)', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'SQLi');

      // Tripwire: configure the module to throw if invoked. The preflight
      // identity short-circuit must exit before any module call, so we
      // expect a successful response and zero deltas — never reaching the
      // throwing path.
      registry.setForClass('cc-A', { throwOn: 'getExposures' });

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(result.deltas).toEqual({
        deletedDerivedExposures: 0,
        instantiatedDerivedExposures: 0,
        preservedCustomExposures: 0,
        deletedDerivedCountermeasures: 0,
        instantiatedDerivedCountermeasures: 0,
        preservedCustomCountermeasures: 0,
      });

      // Sanity: pre-existing SQLi finding is intact.
      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings.map((f) => f.name)).toEqual(['SQLi']);
    });

    it('USER-authored exposures survive class change (I2)', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'SQLi');
      await seedUserExposure(mg.driver, 'comp-1', 'Hand-Authored Risk');

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-B'] } },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.preservedCustomExposures).toBe(1);

      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      const userFinding = findings.find((f) => f.createdBy === 'USER');
      expect(userFinding).toBeDefined();
      expect(userFinding!.name).toBe('Hand-Authored Risk');
    });

    it('legacy-stale catch (I3): finding bound to a class the element does not instantiate is swept on a real transition', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      // Stale finding: IS_EXPOSURE_OF cc-B but the Component never had an
      // IS_INSTANCE_OF to cc-B. Simulates a past buggy write path. We
      // transition to NONE so the sweep runs (identity short-circuit would
      // otherwise fire if target == cc-A).
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-B', 'Legacy-Stale');

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'NONE' } },
        ctx(),
      );
      expect(result.success).toBe(true);
      // Both clauses match for the kind=NONE sweep ($targetClassId IS NULL):
      // the stale Legacy-Stale (linked to cc-B) is swept. Seed produces
      // exactly one stale exposure — assert the count, not a lower bound,
      // so over-delete regressions surface.
      expect(result.deltas.deletedDerivedExposures).toBe(1);
      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings.find((f) => f.name === 'Legacy-Stale')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // §5.7 transition matrix — Control (N-N).
  // -------------------------------------------------------------------------

  describe('§5.7 transitions — Control (N-N)', () => {
    beforeEach(async () => {
      await seedClass(mg.driver, 'ControlClass', 'ctlc-A');
      await seedClass(mg.driver, 'ControlClass', 'ctlc-B');
      await seedClass(mg.driver, 'ControlClass', 'ctlc-C');
      registry.setForClass('ctlc-A', {
        countermeasures: [{ name: 'cm-A1' }, { name: 'cm-A2' }],
      });
      registry.setForClass('ctlc-B', {
        countermeasures: [{ name: 'cm-B1' }],
      });
      registry.setForClass('ctlc-C', {
        countermeasures: [{ name: 'cm-C1' }],
      });
    });

    it('none → [A, B]: instantiates both class sets', async () => {
      await seedControl(mg.driver, 'ctl-1');
      const result = await service.changeElementBinding(
        {
          elementId: 'ctl-1',
          target: { kind: 'CLASS', classIds: ['ctlc-A', 'ctlc-B'] },
        },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.instantiatedDerivedCountermeasures).toBe(3);
      expect(result.deltas.deletedDerivedCountermeasures).toBe(0);

      const binding = await readBinding(mg.driver, 'ctl-1');
      expect(binding.classIds.sort()).toEqual(['ctlc-A', 'ctlc-B']);

      const findings = await readFindings(mg.driver, 'ctl-1', 'HAS_COUNTERMEASURE');
      expect(findings.map((f) => f.name).sort()).toEqual(['cm-A1', 'cm-A2', 'cm-B1']);
    });

    it('[A, B] → [B, C]: diff-based add/remove', async () => {
      await seedControl(mg.driver, 'ctl-1');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-A');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-B');
      // Seed prior derived findings for A and B
      await runWrite(
        mg.driver,
        `MATCH (c:Control {id: 'ctl-1'}), (k:ControlClass {id: 'ctlc-A'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: randomUUID(), name: 'cm-A1', createdBy: 'SYSTEM'})-[:IS_COUNTERMEASURE_OF]->(k)`,
      );
      await runWrite(
        mg.driver,
        `MATCH (c:Control {id: 'ctl-1'}), (k:ControlClass {id: 'ctlc-B'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: randomUUID(), name: 'cm-B1', createdBy: 'SYSTEM'})-[:IS_COUNTERMEASURE_OF]->(k)`,
      );

      const result = await service.changeElementBinding(
        {
          elementId: 'ctl-1',
          target: { kind: 'CLASS', classIds: ['ctlc-B', 'ctlc-C'] },
        },
        ctx(),
      );
      expect(result.success).toBe(true);
      // Deleted: cm-A1 (because ctlc-A removed). cm-B1 stays (still bound to ctlc-B).
      expect(result.deltas.deletedDerivedCountermeasures).toBe(1);
      // Instantiated: cm-B1 + cm-C1 (B re-runs against module since it's in the
      // target list; C is added new). The §4.7 upsert is idempotent — re-running
      // it on cm-B1 keeps the same node.
      expect(result.deltas.instantiatedDerivedCountermeasures).toBe(2);

      const binding = await readBinding(mg.driver, 'ctl-1');
      expect(binding.classIds.sort()).toEqual(['ctlc-B', 'ctlc-C']);

      const findings = await readFindings(mg.driver, 'ctl-1', 'HAS_COUNTERMEASURE');
      expect(findings.map((f) => f.name).sort()).toEqual(['cm-B1', 'cm-C1']);
    });

    it('[A, B] → none: sweeps all derived', async () => {
      await seedControl(mg.driver, 'ctl-1');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-A');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-B');
      await runWrite(
        mg.driver,
        `MATCH (c:Control {id: 'ctl-1'}), (k:ControlClass {id: 'ctlc-A'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: randomUUID(), name: 'cm-A1', createdBy: 'SYSTEM'})-[:IS_COUNTERMEASURE_OF]->(k)`,
      );

      const result = await service.changeElementBinding(
        { elementId: 'ctl-1', target: { kind: 'NONE' } },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.deletedDerivedCountermeasures).toBe(1);

      const binding = await readBinding(mg.driver, 'ctl-1');
      expect(binding.classIds).toEqual([]);
    });

    it('identity transition with reversed-order classIds (I8 set-equality)', async () => {
      await seedControl(mg.driver, 'ctl-1');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-A');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-B');

      // Target order is reversed — must still trip the identity short-circuit.
      const result = await service.changeElementBinding(
        {
          elementId: 'ctl-1',
          target: { kind: 'CLASS', classIds: ['ctlc-B', 'ctlc-A'] },
        },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(result.deltas.deletedDerivedCountermeasures).toBe(0);
      expect(result.deltas.instantiatedDerivedCountermeasures).toBe(0);
    });

    it('legacy-stale catch on Controls (§4.4 second OR clause)', async () => {
      // Seed: Control bound to [ctlc-A]. A stale countermeasure exists
      // tied to ctlc-B via IS_COUNTERMEASURE_OF, even though the Control
      // never had an IS_INSTANCE_OF to ctlc-B. Past buggy-write-path data.
      // Transition to [ctlc-A] (identity for the binding edges, but NOT
      // identity overall — the stale countermeasure tied to ctlc-B has
      // to be swept). To force a real transition (non-identity), we
      // remove ctlc-A from the seed and bind to ctlc-C instead.
      await seedControl(mg.driver, 'ctl-1');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-A');
      await runWrite(
        mg.driver,
        `MATCH (c:Control {id: 'ctl-1'}), (k:ControlClass {id: 'ctlc-B'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: randomUUID(), name: 'StaleCM', createdBy: 'SYSTEM'})-[:IS_COUNTERMEASURE_OF]->(k)`,
      );

      const result = await service.changeElementBinding(
        {
          elementId: 'ctl-1',
          target: { kind: 'CLASS', classIds: ['ctlc-C'] },
        },
        ctx(),
      );
      expect(result.success).toBe(true);
      // The stale countermeasure (IS_COUNTERMEASURE_OF ctlc-B, but ctl-1
      // was never instance of ctlc-B) is swept by the second OR clause
      // of §4.4: NOT (c)-[:IS_INSTANCE_OF]->(klass) where klass=ctlc-B.
      // Seed produces exactly one stale countermeasure — assert the count,
      // not a lower bound, so over-delete regressions surface.
      expect(result.deltas.deletedDerivedCountermeasures).toBe(1);
      const findings = await readFindings(mg.driver, 'ctl-1', 'HAS_COUNTERMEASURE');
      expect(findings.find((f) => f.name === 'StaleCM')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error paths.
  // -------------------------------------------------------------------------

  describe('error taxonomy', () => {
    it('VALIDATION_ERROR — empty classIds with kind=CLASS', async () => {
      const result = await service.changeElementBinding(
        { elementId: 'whatever', target: { kind: 'CLASS', classIds: [] } },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
    });

    it('ELEMENT_NOT_FOUND — element id does not exist', async () => {
      const result = await service.changeElementBinding(
        { elementId: 'no-such-elem', target: { kind: 'NONE' } },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('ELEMENT_NOT_FOUND');
    });

    it('CLASS_NOT_FOUND — class id not in graph', async () => {
      await seedComponent(mg.driver, 'comp-1');
      const result = await service.changeElementBinding(
        {
          elementId: 'comp-1',
          target: { kind: 'CLASS', classIds: ['nonexistent-class'] },
        },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('CLASS_NOT_FOUND');
    });

    it('ORPHAN_CLASS_REFUSED — class linked via HAS_ORPHANED_CLASS', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await seedClass(mg.driver, 'ComponentClass', 'orphaned-class', false);
      const result = await service.changeElementBinding(
        {
          elementId: 'comp-1',
          target: { kind: 'CLASS', classIds: ['orphaned-class'] },
        },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('ORPHAN_CLASS_REFUSED');
    });

    it('MODEL_NOT_FOUND — modelId does not exist', async () => {
      await seedComponent(mg.driver, 'comp-1');
      const result = await service.changeElementBinding(
        {
          elementId: 'comp-1',
          target: { kind: 'REPRESENTED_MODEL', modelId: 'no-such-model' },
        },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MODEL_NOT_FOUND');
    });

    it('REPRESENTED_MODEL_NOT_ALLOWED — Control element with kind=REPRESENTED_MODEL', async () => {
      await seedControl(mg.driver, 'ctl-1');
      await seedModel(mg.driver, 'model-X');
      const result = await service.changeElementBinding(
        {
          elementId: 'ctl-1',
          target: { kind: 'REPRESENTED_MODEL', modelId: 'model-X' },
        },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('REPRESENTED_MODEL_NOT_ALLOWED');
    });

    it('VALIDATION_ERROR — wrong-kind rebind refused; binding and findings untouched', async () => {
      // Live regression. Pre-fix, targeting a ControlClass id
      // from a Component destroyed the element's SYSTEM findings, left it
      // unbound (the sweep + DELETE oldRel persisted while the wrong-label
      // MATCH bound zero rows), and reported success: true.
      await seedComponent(mg.driver, 'comp-1');
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedClass(mg.driver, 'ControlClass', 'ctl-X');
      await bindClassEdge(mg.driver, 'comp-1', 'cc-A');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'SQLi');

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['ctl-X'] } },
        ctx(),
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(result.errorMessage).toContain('is not a ComponentClass');
      expect(result.deltas).toEqual({
        deletedDerivedExposures: 0,
        instantiatedDerivedExposures: 0,
        preservedCustomExposures: 0,
        deletedDerivedCountermeasures: 0,
        instantiatedDerivedCountermeasures: 0,
        preservedCustomCountermeasures: 0,
      });
      // Binding and derived findings are exactly as seeded.
      expect(await readBinding(mg.driver, 'comp-1')).toEqual({
        classIds: ['cc-A'],
        modelId: null,
      });
      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings).toEqual([
        { name: 'SQLi', createdBy: 'SYSTEM', classIds: ['cc-A'] },
      ]);
    });

    it('VALIDATION_ERROR — Controls variant: wrong-kind replacement refused, existing state intact', async () => {
      // Replacement scenario ([ctlc-A] → [cc-X]) on purpose: pre-fix this
      // was the fully destructive path (ctlc-A lands in removedClassIds →
      // cm-A1 swept, IS_INSTANCE_OF deleted, the wrong-kind add MATCH binds
      // nothing, success reported) — so the state asserts below discriminate,
      // not just the envelope.
      await seedControl(mg.driver, 'ctl-1');
      await seedClass(mg.driver, 'ControlClass', 'ctlc-A');
      await seedClass(mg.driver, 'ComponentClass', 'cc-X');
      await bindClassEdge(mg.driver, 'ctl-1', 'ctlc-A');
      await runWrite(
        mg.driver,
        `MATCH (c {id: 'ctl-1'}), (k {id: 'ctlc-A'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: randomUUID(), name: 'cm-A1', createdBy: 'SYSTEM'})-[:IS_COUNTERMEASURE_OF]->(k)`,
      );

      const result = await service.changeElementBinding(
        {
          elementId: 'ctl-1',
          target: { kind: 'CLASS', classIds: ['cc-X'] },
        },
        ctx(),
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(result.errorMessage).toContain('is not a ControlClass');
      expect(await readBinding(mg.driver, 'ctl-1')).toEqual({
        classIds: ['ctlc-A'],
        modelId: null,
      });
      const findings = await readFindings(mg.driver, 'ctl-1', 'HAS_COUNTERMEASURE');
      expect(findings).toEqual([
        { name: 'cm-A1', createdBy: 'SYSTEM', classIds: ['ctlc-A'] },
      ]);
    });

    it('module-returned createdBy/id are forced/overridden (anti-forgery, allowlist guard)', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      // Hostile module: returns createdBy=USER + a chosen id + a key
      // outside the allowlist. The resolver must:
      //   - force createdBy = 'SYSTEM' (the §4.7 upsert's inline + trailing SET),
      //   - assign a server-generated UUID (randomUUID in the upsert),
      //   - drop the unallowlisted 'internalNotes' key.
      registry.setForClass('cc-A', {
        exposures: [
          {
            name: 'Forge-Attempt',
            createdBy: 'USER',
            id: 'attacker-chosen-id',
            internalNotes: 'leak-me',
          },
        ],
      });

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      expect(result.success).toBe(true);

      const session = mg.driver.session();
      try {
        const r = await session.run(
          `MATCH (e:Exposure {name: 'Forge-Attempt'})
           RETURN e.id AS id, e.createdBy AS createdBy, e.internalNotes AS internalNotes`,
        );
        expect(r.records).toHaveLength(1);
        const rec = r.records[0];
        expect(rec.get('createdBy')).toBe('SYSTEM');
        expect(rec.get('id')).not.toBe('attacker-chosen-id');
        // Server-generated UUIDs are 36 chars. Be permissive.
        expect((rec.get('id') as string).length).toBeGreaterThan(8);
        expect(rec.get('internalNotes')).toBeNull();
      } finally {
        await session.close();
      }
    });

    it('VALIDATION_ERROR — classIds contains null or empty string', async () => {
      await seedComponent(mg.driver, 'comp-1');
      const result = await service.changeElementBinding(
        {
          elementId: 'comp-1',
          target: { kind: 'CLASS', classIds: ['', null as any] },
        },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
    });

    it('VALIDATION_ERROR — missing actor (no context.user.sub)', async () => {
      await seedComponent(mg.driver, 'comp-1');
      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'NONE' } },
        // Empty context — no user.sub
        {} as any,
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(result.errorMessage).toMatch(/actor/i);
    });

    it('MODULE_ERROR + I7 rollback — module throws, graph unchanged', async () => {
      await seedComponent(mg.driver, 'comp-1');
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      registry.setForClass('cc-A', { throwOn: 'getExposures' });

      const before = await readGraphSnapshot(mg.driver);

      const result = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MODULE_ERROR');

      const after = await readGraphSnapshot(mg.driver);
      expect(after).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // Scoped-upsert self-heal regression.
  //
  // Documents the v1 concurrent-upsert race behavior: if two simultaneous
  // upserts both pass through the OPTIONAL MATCH `existing IS NULL` gate, two
  // duplicate SYSTEM exposures can land for the same (element, class, name)
  // triple. RETURN DISTINCT defends the returned row count, but the graph
  // carries the duplicate. The documented self-heal is that the *next* class
  // change sweeps both via §4.3's class-derived filter and instantiates a
  // single fresh row against the new class — restoring singularity.
  //
  // We prime the duplicate state directly (deterministic; no race-condition
  // flake) and assert the self-heal trigger on the subsequent class change.
  // -------------------------------------------------------------------------

  describe('§4.7 self-heal — primed duplicate state restores singularity', () => {
    beforeEach(async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedClass(mg.driver, 'ComponentClass', 'cc-B');
      registry.setForClass('cc-A', {
        exposures: [{ name: 'Privilege Escalation', description: 'classA' }],
      });
      registry.setForClass('cc-B', {
        exposures: [{ name: 'XSS', description: 'classB' }],
      });
    });

    // Helper: count Exposure NODES (not name-aggregated rows) bound to the
    // element under a given class. The `readFindings` helper aggregates by
    // name + createdBy, which would silently collapse the duplicate state we
    // are explicitly trying to assert. This query returns per-node counts.
    const countExposureNodesByClass = async (
      elementId: string,
      classId: string,
    ): Promise<number> => {
      const session = mg.driver.session();
      try {
        const r = await session.run(
          `MATCH (c {id: $elementId})-[:HAS_EXPOSURE]->(e:Exposure)-[:IS_EXPOSURE_OF]->(k {id: $classId})
           RETURN count(e) AS cnt`,
          { elementId, classId },
        );
        const v = r.records[0].get('cnt');
        return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
      } finally {
        await session.close();
      }
    };

    it('directly-inserted duplicate SYSTEM exposures collapse to singularity on next class change', async () => {
      await seedComponent(mg.driver, 'comp-1');

      // Bind to cc-A via the resolver — creates the canonical SYSTEM exposure.
      const initial = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      expect(initial.success).toBe(true);
      expect(initial.deltas.instantiatedDerivedExposures).toBe(1);

      // Prime the documented race state: insert a second SYSTEM exposure with
      // the same name + IS_EXPOSURE_OF cc-A edge, distinct id. This is what
      // the §4.7 OPTIONAL MATCH/CREATE race produces in production when two
      // independent sessions both see `existing IS NULL`.
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'Privilege Escalation');

      // Count nodes directly — readFindings aggregates by name, which would
      // hide the duplicate state we are explicitly priming.
      expect(await countExposureNodesByClass('comp-1', 'cc-A')).toBe(2);

      // Self-heal trigger: transition to a different class. §4.3's sweep
      // deletes BOTH duplicates (both linked to cc-A via IS_EXPOSURE_OF), and
      // §4.7 instantiates one clean exposure against cc-B.
      const healed = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-B'] } },
        ctx(),
      );
      expect(healed.success).toBe(true);
      expect(healed.deltas.deletedDerivedExposures).toBe(2);
      expect(healed.deltas.instantiatedDerivedExposures).toBe(1);

      // Direct node counts: cc-A has none (both swept), cc-B has exactly one.
      expect(await countExposureNodesByClass('comp-1', 'cc-A')).toBe(0);
      expect(await countExposureNodesByClass('comp-1', 'cc-B')).toBe(1);

      const finalFindings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(finalFindings).toHaveLength(1);
      expect(finalFindings[0].name).toBe('XSS');
      expect(finalFindings[0].createdBy).toBe('SYSTEM');
      expect(finalFindings[0].classIds).toEqual(['cc-B']);
    });

    it('self-heal preserves USER-authored findings even when SYSTEM duplicates exist', async () => {
      await seedComponent(mg.driver, 'comp-1');

      // Initial state: cc-A binding + USER-authored finding + duplicate
      // SYSTEM exposure on the same name.
      await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx(),
      );
      await seedUserExposure(mg.driver, 'comp-1', 'Hand-Authored Risk');
      await seedSystemExposureBoundToClass(mg.driver, 'comp-1', 'cc-A', 'Privilege Escalation');

      const healed = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-B'] } },
        ctx(),
      );
      expect(healed.success).toBe(true);
      expect(healed.deltas.deletedDerivedExposures).toBe(2);
      expect(healed.deltas.instantiatedDerivedExposures).toBe(1);
      expect(healed.deltas.preservedCustomExposures).toBe(1);

      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      const userFinding = findings.find((f) => f.createdBy === 'USER');
      expect(userFinding).toBeDefined();
      expect(userFinding!.name).toBe('Hand-Authored Risk');
      const systemFindings = findings.filter((f) => f.createdBy === 'SYSTEM');
      expect(systemFindings).toHaveLength(1);
      expect(systemFindings[0].name).toBe('XSS');
    });
  });

  // -------------------------------------------------------------------------
  // Last-writer-wins forensic recoverability.
  //
  // Documents the cross-client last-writer-wins outcome: two sequential
  // changeElementBinding calls from independent clients on the same element
  // both succeed, with the final binding reflecting the second call's target.
  // Each call emits a `Logger.log('Element binding changed', ...)` entry with
  // operationId + actor + before/after binding + deltas — sufficient for
  // forensic reconstruction.
  // -------------------------------------------------------------------------

  describe('§3.4 LWW forensic recoverability', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedClass(mg.driver, 'ComponentClass', 'cc-B');
      await seedClass(mg.driver, 'ComponentClass', 'cc-C');
      registry.setForClass('cc-A', { exposures: [{ name: 'SQLi' }] });
      registry.setForClass('cc-B', { exposures: [{ name: 'XSS' }] });
      registry.setForClass('cc-C', { exposures: [{ name: 'CSRF' }] });

      // Spy on the service's logger.log — captures every success path. We
      // attach via the private field rather than Logger.prototype so the spy
      // is scoped tightly to this service instance.
      logSpy = jest.spyOn((service as any).logger, 'log');
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('three sequential class changes — final target wins, all three logged for recovery', async () => {
      await seedComponent(mg.driver, 'comp-1');

      const r1 = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-A'] } },
        ctx('alice'),
      );
      const r2 = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-B'] } },
        ctx('bob'),
      );
      const r3 = await service.changeElementBinding(
        { elementId: 'comp-1', target: { kind: 'CLASS', classIds: ['cc-C'] } },
        ctx('carol'),
      );

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);

      // Final binding reflects the last call (Carol's).
      const binding = await readBinding(mg.driver, 'comp-1');
      expect(binding.classIds).toEqual(['cc-C']);

      // Only cc-C's derived finding survives.
      const findings = await readFindings(mg.driver, 'comp-1', 'HAS_EXPOSURE');
      expect(findings.map((f) => f.name)).toEqual(['CSRF']);
      expect(findings[0].classIds).toEqual(['cc-C']);

      // Logger spy: assert all three transitions captured the actor + element
      // + new binding, forming a complete forensic trail.
      const successLogs = logSpy.mock.calls.filter(
        ([msg]: any[]) => msg === 'Element binding changed',
      );
      expect(successLogs).toHaveLength(3);

      const actors = successLogs.map(([, payload]: any[]) => payload.actor);
      expect(actors).toEqual(['alice', 'bob', 'carol']);

      const elementIds = successLogs.map(([, payload]: any[]) => payload.elementId);
      expect(elementIds).toEqual(['comp-1', 'comp-1', 'comp-1']);

      // Every log entry carries operationId + newBinding so an operator can
      // reconstruct the timeline post-incident.
      for (const [, payload] of successLogs) {
        expect(payload.operationId).toBeDefined();
        expect(payload.newBinding).toBeDefined();
        expect(payload.deltas).toBeDefined();
      }
    });
  });
});
