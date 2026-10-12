// Integration coverage for evaluating an element that has no answers.
//
// An element bound to a class gets that class's exposures from the attribute write, so an importer sends the
// write with empty attributes when the file has no answers. Covered against a real Memgraph:
//   - setInstantiationAttributes with {} on a classed element writes no attribute and creates its exposures;
//   - many elements of ONE class written concurrently (as an importer does) all get their exposures. Every
//     exposure upsert links to the same class node, the case where Memgraph can report conflicting transactions.
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

// Module `mod-1` serves three exposures for class `cls-1`, whatever the element's answers.
class FakeModuleRegistry {
  getModuleByName(name: string): any | undefined {
    if (name !== 'mod-1') return undefined;
    return {
      getExposures: async (_elementId: string, classId: string) =>
        classId === 'cls-1'
          ? ['Weak authentication', 'Unencrypted channel', 'Excessive privilege'].map(name => ({ name, exploitedBy: [] }))
          : [],
      getCountermeasures: async () => [],
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

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new SetInstantiationAttributesService(
      mg.driver as any,
      makeStubConfigService(),
      new FakeModuleRegistry() as any,
      makeStubAuthService(),
      { recordOperation: () => {} } as any,
    );
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    await run(`CREATE (:Module {id: 'mod-1-id', name: 'mod-1'})-[:HAS_CLASS]->(:ComponentClass {id: 'cls-1', name: 'cls-1'})`);
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
});
