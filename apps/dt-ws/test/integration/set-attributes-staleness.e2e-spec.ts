// Integration coverage for SetInstantiationAttributesService —
// two-statement Cypher staleness extension.
//
// Strategy: instantiate the service directly against a real Memgraph
// testcontainer with stub Config/Auth/Monitoring services + a fake
// ModuleRegistryService that returns empty findings (so the post-Cypher
// upsert path is a no-op and we can isolate the staleness behaviour).
//
// Coverage:
//   - Case A (no-op): identical attrs → valueChanged=false, no stale flip, count=0
//   - Case B (scalar change): scalar attr changes → stale flip, count=1
//   - Case C (list change): list attr changes → stale flip, count=1 (regression
//     coverage for direct-equality on List<String>)
//   - Case D (multi-disposition): two dispositioned exposures → count=2
//   - Case E (no dispositions): element has zero dispositioned exposures → count=0
//   - Case F (re-affirm clears stale): dispose, change attr, re-affirm via
//     DispositionResolverService → dispositionStale = false
//   - Case G (no re-count): already-stale row excluded from a second change's
//     count → staleFlippedCount = 0 (state stays stale)

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';
import { DispositionResolverService } from '../../src/gql/resolver-services/disposition-resolver.service';

jest.setTimeout(120_000);

const TEST_USER_SUB = 'auth0|staleness-test';

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') {
        return {
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

// Fake registry returns a module instance whose getExposures/getCountermeasures
// return empty arrays — so the post-Cypher upsert path is a no-op and we
// isolate the two-statement Cypher behaviour.
class FakeModuleRegistry {
  getModuleByName(name: string): any | undefined {
    if (name !== 'mod-1') return undefined;
    return {
      getExposures: async () => [],
      getCountermeasures: async () => [],
    };
  }
}

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function readExposureStale(
  driver: any,
  exposureId: string,
): Promise<{ kind: string | null; stale: boolean | null }> {
  const session = driver.session();
  try {
    const r = await session.run(
      `MATCH (e:Exposure {id: $id}) RETURN e.dispositionKind AS k, e.dispositionStale AS s`,
      { id: exposureId },
    );
    if (r.records.length === 0) return { kind: null, stale: null };
    const rec = r.records[0];
    return {
      kind: rec.get('k') ?? null,
      stale: rec.get('s'),
    };
  } finally {
    await session.close();
  }
}

async function seedFixture(
  driver: any,
  opts: {
    initialAttrs: Record<string, any>;
    dispositionedExposureIds?: string[];        // pre-dispositioned
    undispositionedExposureIds?: string[];      // exist but no disposition
  } = { initialAttrs: {} },
): Promise<void> {
  await runWrite(driver, `CREATE (m:Module {id: 'mod-1-id', name: 'mod-1'})`);
  await runWrite(
    driver,
    `MATCH (m:Module {id: 'mod-1-id'})
     CREATE (k:ComponentClass {id: 'cls-1', name: 'Cls-1'})<-[:HAS_CLASS]-(m)`,
  );
  await runWrite(
    driver,
    `MATCH (k:ComponentClass {id: 'cls-1'})
     CREATE (c:Component {id: 'cmp-1', name: 'Cmp-1'})-[r:IS_INSTANCE_OF]->(k)
     SET r = $attrs`,
    { attrs: opts.initialAttrs },
  );
  for (const id of opts.dispositionedExposureIds ?? []) {
    await runWrite(
      driver,
      `MATCH (c:Component {id: 'cmp-1'})
       CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {
         id: $id, name: $name,
         dispositionKind: 'NOT_APPLICABLE',
         dispositionReason: 'Pre-existing',
         dispositionedBy: 'auth0|prior',
         dispositionedAt: '2026-01-01T00:00:00.000Z',
         dispositionStale: false
       })`,
      { id, name: `Exposure ${id}` },
    );
  }
  for (const id of opts.undispositionedExposureIds ?? []) {
    await runWrite(
      driver,
      `MATCH (c:Component {id: 'cmp-1'})
       CREATE (c)-[:HAS_EXPOSURE]->(:Exposure { id: $id, name: $name })`,
      { id, name: `Exposure ${id}` },
    );
  }
}

async function readCountermeasureStale(
  driver: any,
  countermeasureId: string,
): Promise<{ kind: string | null; stale: boolean | null }> {
  const session = driver.session();
  try {
    const r = await session.run(
      `MATCH (cm:Countermeasure {id: $id}) RETURN cm.dispositionKind AS k, cm.dispositionStale AS s`,
      { id: countermeasureId },
    );
    if (r.records.length === 0) return { kind: null, stale: null };
    const rec = r.records[0];
    return { kind: rec.get('k') ?? null, stale: rec.get('s') };
  } finally {
    await session.close();
  }
}

// Control fixture: a Control IS_INSTANCE_OF a ControlClass, with dispositioned
// countermeasures hanging off it via HAS_COUNTERMEASURE. setInstantiationAttributes
// runs for a Control exactly as it does for a Component; the sibling statement
// flips the Control's countermeasures (the exposure statement matches zero rows here).
async function seedControlFixture(
  driver: any,
  opts: {
    initialAttrs: Record<string, any>;
    dispositionedCountermeasureIds?: string[];
  } = { initialAttrs: {} },
): Promise<void> {
  // Module name 'mod-1' so the FakeModuleRegistry resolves it for the
  // post-flip processControlCountermeasures dispatch (empty getCountermeasures
  // → upsert is a no-op, isolating the staleness behaviour).
  await runWrite(driver, `CREATE (m:Module {id: 'cmod-1-id', name: 'mod-1'})`);
  await runWrite(
    driver,
    `MATCH (m:Module {id: 'cmod-1-id'})
     CREATE (k:ControlClass {id: 'ccls-1', name: 'CCls-1'})<-[:HAS_CLASS]-(m)`,
  );
  await runWrite(
    driver,
    `MATCH (k:ControlClass {id: 'ccls-1'})
     CREATE (ctrl:Control {id: 'ctrl-1', name: 'Ctrl-1'})-[r:IS_INSTANCE_OF]->(k)
     SET r = $attrs`,
    { attrs: opts.initialAttrs },
  );
  for (const id of opts.dispositionedCountermeasureIds ?? []) {
    await runWrite(
      driver,
      `MATCH (ctrl:Control {id: 'ctrl-1'})
       CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {
         id: $id, name: $name,
         dispositionKind: 'WAIVED',
         dispositionReason: 'Pre-existing',
         dispositionedBy: 'auth0|prior',
         dispositionedAt: '2026-01-01T00:00:00.000Z',
         dispositionStale: false
       })`,
      { id, name: `Countermeasure ${id}` },
    );
  }
}

describe('SetInstantiationAttributesService — staleness extension (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: SetInstantiationAttributesService;
  let dispositionSvc: DispositionResolverService;

  beforeAll(async () => {
    mg = await startMemgraph();
    const registry = new FakeModuleRegistry() as any;
    svc = new SetInstantiationAttributesService(
      mg.driver,
      makeStubConfigService(),
      registry,
      makeStubAuthService(),
      makeStubMonitoringService(),
    );
    dispositionSvc = new DispositionResolverService(
      mg.driver,
      makeStubConfigService(),
      makeStubAuthService(),
      makeStubMonitoringService(),
    );
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  it('Case A — no-op save (identical attrs): valueChanged=false, no flip, count=0', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: {
        tls_enabled: 'true',
        unencrypted_remnant_partitions: ['/boot', '/recovery'],
      },
      dispositionedExposureIds: ['exp-1'],
    });
    const result = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: {
        tls_enabled: 'true',
        unencrypted_remnant_partitions: ['/boot', '/recovery'],
      },
    });
    expect(result.success).toBe(true);
    expect(result.staleFlippedCount).toBe(0);
    const exp = await readExposureStale(mg.driver, 'exp-1');
    expect(exp.kind).toBe('NOT_APPLICABLE');
    expect(exp.stale).toBe(false);
  });

  it('Case B — scalar value change: dispositionStale flipped, count=1', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: {
        tls_enabled: 'true',
        unencrypted_remnant_partitions: ['/boot', '/recovery'],
      },
      dispositionedExposureIds: ['exp-1'],
    });
    const result = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: {
        tls_enabled: 'false',
        unencrypted_remnant_partitions: ['/boot', '/recovery'],
      },
    });
    expect(result.success).toBe(true);
    expect(result.staleFlippedCount).toBe(1);
    const exp = await readExposureStale(mg.driver, 'exp-1');
    expect(exp.stale).toBe(true);
  });

  it('Case C — list element change: dispositionStale flipped, count=1', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: {
        tls_enabled: 'true',
        unencrypted_remnant_partitions: ['/boot', '/recovery'],
      },
      dispositionedExposureIds: ['exp-1'],
    });
    const result = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: {
        tls_enabled: 'true',
        unencrypted_remnant_partitions: ['/boot'],   // shrunk list
      },
    });
    expect(result.success).toBe(true);
    expect(result.staleFlippedCount).toBe(1);
    const exp = await readExposureStale(mg.driver, 'exp-1');
    expect(exp.stale).toBe(true);
  });

  it('Case D — multi-disposition: two dispositioned exposures, both flipped, count=2', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: { tls_enabled: 'true' },
      dispositionedExposureIds: ['exp-1', 'exp-2'],
    });
    const result = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: { tls_enabled: 'false' },
    });
    expect(result.success).toBe(true);
    expect(result.staleFlippedCount).toBe(2);
    const e1 = await readExposureStale(mg.driver, 'exp-1');
    const e2 = await readExposureStale(mg.driver, 'exp-2');
    expect(e1.stale).toBe(true);
    expect(e2.stale).toBe(true);
  });

  it('Case E — no dispositions on element: count=0 (statement 2 zero rows)', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: { tls_enabled: 'true' },
      undispositionedExposureIds: ['exp-1'],
    });
    const result = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: { tls_enabled: 'false' },
    });
    expect(result.success).toBe(true);
    expect(result.staleFlippedCount).toBe(0);
    // exp-1 has no disposition; the bare exposure record should still exist.
    const exp = await readExposureStale(mg.driver, 'exp-1');
    expect(exp.kind).toBeNull();
  });

  it('Case F — re-affirm via disposeExposure clears stale set by attribute change', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: { tls_enabled: 'true' },
      dispositionedExposureIds: ['exp-1'],
    });
    // 1. Trigger stale flip via attribute change.
    await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: { tls_enabled: 'false' },
    });
    let exp = await readExposureStale(mg.driver, 'exp-1');
    expect(exp.stale).toBe(true);

    // 2. Re-affirm via disposeExposure with the same kind — the SET clears stale.
    const reaffirm = await dispositionSvc.disposeExposure(
      { exposureId: 'exp-1', kind: 'NOT_APPLICABLE', reason: 'Re-reviewed after attr change' },
      { user: { sub: TEST_USER_SUB } },
    );
    expect(reaffirm.success).toBe(true);
    expect(reaffirm.dispositionStale).toBe(false);

    exp = await readExposureStale(mg.driver, 'exp-1');
    expect(exp.stale).toBe(false);
  });

  it('Case G — already-stale rows are not re-counted on a second attribute change', async () => {
    await seedFixture(mg.driver, {
      initialAttrs: { tls_enabled: 'true' },
      dispositionedExposureIds: ['exp-1'],
    });

    // First change flips exp-1 stale and counts it once.
    const first = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: { tls_enabled: 'false' },
    });
    expect(first.success).toBe(true);
    expect(first.staleFlippedCount).toBe(1);
    expect((await readExposureStale(mg.driver, 'exp-1')).stale).toBe(true);

    // Second change is a real value change but exp-1 is already stale, so it is
    // excluded from the count — staleFlippedCount reports *newly* flipped rows.
    const second = await svc.setAttributes({
      componentId: 'cmp-1',
      classId: 'cls-1',
      attributes: { tls_enabled: 'true' },
    });
    expect(second.success).toBe(true);
    expect(second.staleFlippedCount).toBe(0);
    // The row remains stale (the exclusion only affects counting, not state).
    expect((await readExposureStale(mg.driver, 'exp-1')).stale).toBe(true);
  });

  // ===========================================================================
  // Sibling countermeasure flip — a Control's attribute change flips its
  // dispositioned countermeasures (HAS_COUNTERMEASURE), disjoint from the
  // exposure flip (the Control has no HAS_EXPOSURE edges).
  // ===========================================================================
  describe('Control countermeasure flip (sibling statement)', () => {
    it('scalar change on a Control flips its dispositioned countermeasure, count=1', async () => {
      await seedControlFixture(mg.driver, {
        initialAttrs: { rotation_days: '90' },
        dispositionedCountermeasureIds: ['cm-1'],
      });
      const result = await svc.setAttributes({
        componentId: 'ctrl-1',
        classId: 'ccls-1',
        attributes: { rotation_days: '30' },
      });
      expect(result.success).toBe(true);
      expect(result.staleFlippedCount).toBe(1);
      const cm = await readCountermeasureStale(mg.driver, 'cm-1');
      expect(cm.kind).toBe('WAIVED');
      expect(cm.stale).toBe(true);
    });

    it('no-op save on a Control: no flip, count=0', async () => {
      await seedControlFixture(mg.driver, {
        initialAttrs: { rotation_days: '90' },
        dispositionedCountermeasureIds: ['cm-1'],
      });
      const result = await svc.setAttributes({
        componentId: 'ctrl-1',
        classId: 'ccls-1',
        attributes: { rotation_days: '90' },
      });
      expect(result.success).toBe(true);
      expect(result.staleFlippedCount).toBe(0);
      const cm = await readCountermeasureStale(mg.driver, 'cm-1');
      expect(cm.stale).toBe(false);
    });

    it('multi-countermeasure: both flipped, count=2', async () => {
      await seedControlFixture(mg.driver, {
        initialAttrs: { rotation_days: '90' },
        dispositionedCountermeasureIds: ['cm-1', 'cm-2'],
      });
      const result = await svc.setAttributes({
        componentId: 'ctrl-1',
        classId: 'ccls-1',
        attributes: { rotation_days: '30' },
      });
      expect(result.success).toBe(true);
      expect(result.staleFlippedCount).toBe(2);
      expect((await readCountermeasureStale(mg.driver, 'cm-1')).stale).toBe(true);
      expect((await readCountermeasureStale(mg.driver, 'cm-2')).stale).toBe(true);
    });
  });
});
