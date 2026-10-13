// Integration coverage for evaluating an element that has no answers.
//
// An element bound to a class gets that class's exposures from the attribute write, so an importer sends the
// write with empty attributes when the file has no answers. Covered against a real Memgraph:
//   - setInstantiationAttributes with {} on a classed element writes no attribute and creates its exposures;
//   - many elements of ONE class written concurrently (as an importer does) all get their exposures. Every
//     exposure upsert links to the same class node, the case where Memgraph can report conflicting transactions;
//   - the same, round after round, for components and controls together, each finding linked to a technique: every
//     round half the elements (alternating by element and round) lose a finding while the other half gain one, so
//     the sweep deletes and the upserts and technique links create on the same class nodes at once. A write that
//     walked a class node's edges read findings another transaction was still creating and failed; the writes start
//     from the element.
//
// Drives the resolver (per-element lock and batch included) with a fake module registry.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';

jest.setTimeout(180_000);

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

const technique = (attackId: string) => ({ label: 'MitreAttackTechnique', property: 'attack_id', value: attackId });

// Module `mod-1` serves, whatever the element's answers, three exposures for component class `cls-1` and three
// countermeasures for control class `ccls-1`, each linked to a technique. With a round set, an element serves its
// third finding only when its number and the round have the same parity, so neighbours move in opposite directions.
class FakeModuleRegistry {
  round: number | null = null;

  full(elementId: string): boolean {
    return this.round === null || (Number(elementId.split('-').pop()) + this.round) % 2 === 0;
  }

  getModuleByName(name: string): any | undefined {
    if (name !== 'mod-1') return undefined;
    return {
      getExposures: async (elementId: string, classId: string) =>
        classId === 'cls-1'
          ? ['Weak authentication', 'Unencrypted channel', ...(this.full(elementId) ? ['Excessive privilege'] : [])].map(name => ({
              name,
              exploitedBy: [technique('T1078')],
            }))
          : [],
      getCountermeasures: async (elementId: string, classId: string) =>
        classId === 'ccls-1'
          ? ['Multi-factor login', 'Audit logging', ...(this.full(elementId) ? ['Session timeout'] : [])].map(name => ({
              name,
              type: 'CONTROL',
              mitigates: [technique('T1110')],
            }))
          : [],
    };
  }
}

/** Runs `work` over `items` with at most `cap` in flight. */
async function pool<T, R>(items: T[], cap: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(cap, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

describe('Evaluating elements that have no answers (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: SetInstantiationAttributesService;
  const registry = new FakeModuleRegistry();

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new SetInstantiationAttributesService(
      mg.driver as any,
      makeStubConfigService(),
      registry as any,
      makeStubAuthService(),
      { recordOperation: () => {} } as any,
    );
    // The batch path stays on; a short debounce keeps the many-round cases inside the test timeout.
    (svc as any).config.batchDebounceTime = 50;
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    registry.round = null;
    await clearGraph(mg.driver);
    await run(`CREATE (m:Module {id: 'mod-1-id', name: 'mod-1'})-[:HAS_CLASS]->(:ComponentClass {id: 'cls-1', name: 'cls-1'})
               CREATE (m)-[:HAS_CLASS]->(:ControlClass {id: 'ccls-1', name: 'ccls-1'})
               CREATE (:MitreAttackTechnique {id: 'tech-1', attack_id: 'T1078', name: 'T1078'})
               CREATE (:MitreAttackTechnique {id: 'tech-2', attack_id: 'T1110', name: 'T1110'})`);
  });

  async function run(cypher: string, params: Record<string, unknown> = {}): Promise<any[]> {
    const session = mg.driver.session();
    try {
      return (await session.run(cypher, params)).records.map((r: any) => r.toObject());
    } finally {
      await session.close();
    }
  }

  const write = (componentId: string) =>
    svc.getResolvers().Mutation.setInstantiationAttributes(null, { componentId, classId: 'cls-1', attributes: {} }, {});

  const bindElements = (ids: string[]) =>
    run(`MATCH (k:ComponentClass {id: 'cls-1'}) UNWIND $ids AS id CREATE (:Component {id: id})-[:IS_INSTANCE_OF]->(k)`, { ids });

  const exposureCounts = async (): Promise<Record<string, number>> =>
    Object.fromEntries(
      (
        await run(`
          MATCH (c:Component)
          OPTIONAL MATCH (c)-[:HAS_EXPOSURE]->(e:Exposure)-[:IS_EXPOSURE_OF]->(:ComponentClass {id: 'cls-1'})
          RETURN c.id AS id, count(e) AS n`)
      ).map(r => [r.id, Number(r.n)]),
    );

  it('{} on a classed element: no attribute is written and the class exposures appear', async () => {
    await bindElements(['cmp-1']);

    const result = await write('cmp-1');

    expect(result).toMatchObject({ success: true, errorCode: null });
    const [binding] = await run(`MATCH (:Component {id: 'cmp-1'})-[r:IS_INSTANCE_OF]->() RETURN keys(r) AS keys`);
    expect(binding.keys).toEqual([]);
    expect(await exposureCounts()).toEqual({ 'cmp-1': 3 });
  });

  it.each([4, 20])('20 elements of one class, %i at a time: every element gets its exposures, no conflict', async cap => {
    const ids = Array.from({ length: 20 }, (_, i) => `cmp-${i + 1}`);
    await bindElements(ids);

    const results = await pool(ids, cap, write);

    expect(results.filter(r => !r.success)).toEqual([]);
    const counts = await exposureCounts();
    expect(Object.keys(counts).sort()).toEqual([...ids].sort());
    expect(Object.values(counts).every(n => n === 3)).toBe(true);
  });

  const writeAs = (classId: string) => (elementId: string) =>
    svc.getResolvers().Mutation.setInstantiationAttributes(null, { componentId: elementId, classId, attributes: {} }, {});

  /** Per element: its findings of the class and how many of them link a technique. */
  const findingsOf = async (relation: string, of: string, classId: string): Promise<Record<string, { n: number; linked: number }>> =>
    Object.fromEntries(
      (
        await run(`
          MATCH (c)-[:IS_INSTANCE_OF]->(:${classId === 'cls-1' ? 'ComponentClass' : 'ControlClass'} {id: $classId})
          OPTIONAL MATCH (c)-[:${relation}]->(f)-[:${of}]->(:${classId === 'cls-1' ? 'ComponentClass' : 'ControlClass'} {id: $classId})
          OPTIONAL MATCH (f)-[l]->(:MitreAttackTechnique)
          RETURN c.id AS id, count(DISTINCT f) AS n, count(DISTINCT l) AS linked`, { classId })
      ).map(r => [r.id, { n: Number(r.n), linked: Number(r.linked) }]),
    );

  it.each([4, 8])(
    '60 components and 20 controls, %i at a time, six rounds of mixed deletes and creates with technique links: no conflict, exact findings',
    async cap => {
      const components = Array.from({ length: 60 }, (_, i) => `cmp-${i + 1}`);
      const controls = Array.from({ length: 20 }, (_, i) => `ctl-${i + 1}`);
      await bindElements(components);
      await run(`MATCH (k:ControlClass {id: 'ccls-1'}) UNWIND $ids AS id CREATE (:Control {id: id})-[:IS_INSTANCE_OF]->(k)`, { ids: controls });
      // Interleaved, so component and control writes overlap.
      const work = components.flatMap((id, i) => (i < controls.length ? [{ id, classId: 'cls-1' }, { id: controls[i], classId: 'ccls-1' }] : [{ id, classId: 'cls-1' }]));

      for (let round = 1; round <= 6; round++) {
        registry.round = round;
        const results = await pool(work, cap, w => writeAs(w.classId)(w.id));

        expect([round, results.filter(r => !r.success)]).toEqual([round, []]);
        const exposures = await findingsOf('HAS_EXPOSURE', 'IS_EXPOSURE_OF', 'cls-1');
        const countermeasures = await findingsOf('HAS_COUNTERMEASURE', 'IS_COUNTERMEASURE_OF', 'ccls-1');
        const expect3or2 = (id: string) => (registry.full(id) ? 3 : 2);
        expect([round, components.filter(id => exposures[id]?.n !== expect3or2(id) || exposures[id]?.linked !== expect3or2(id))]).toEqual([round, []]);
        expect([round, controls.filter(id => countermeasures[id]?.n !== expect3or2(id) || countermeasures[id]?.linked !== expect3or2(id))]).toEqual([round, []]);
      }
    },
    // Six rounds of contended writes retry often under load; on a slow runner they can take minutes.
    300_000,
  );
});
