// Finding upserts and class rebinds under concurrency, against a real database (Memgraph or Neo4j, DT_TEST_ENGINE).
//
// Within one process the per-element mutex (runExclusive) already serialises these writers; what holds across
// processes is the element's database lock, taken first in each transaction. These tests reach the database lock
// directly: the upserts run in transactions of their own, and the rebinds go through separate service instances,
// whose mutexes know nothing of each other, as two platform processes would. Outcome on both engines: one finding per
// name, one link per target, one class binding.
//
// DT_TEST_WITHOUT_LOCKS=1 removes the element lock, for the run that shows these tests fail without it.
import { ConfigService } from '@nestjs/config';
import { Driver } from 'neo4j-driver';

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';
import { ElementBindingService } from '../../src/gql/resolver-services/element-binding.service';
import { lockElementInTx } from '../../src/gql/resolver-services/shared/element-db-lock';

// The element lock is its own statement, so it is removed whole (an empty clause would leave a bare MATCH).
jest.mock('../../src/gql/resolver-services/shared/element-db-lock', () => {
  const actual = jest.requireActual('../../src/gql/resolver-services/shared/element-db-lock');
  return process.env.DT_TEST_WITHOUT_LOCKS ? { ...actual, lockElementInTx: async () => undefined } : actual;
});

jest.setTimeout(240_000);

const N = 8;
const MODULE_NAME = 'mod-1';

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') {
        return { maxQueryDepth: 10, maxQueryComplexity: 1000, queryTimeout: 30000, enableIntrospection: false, enableAuthentication: true };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

const auth = {
  extractAuthContext: (ctx: any) => ({ user: ctx?.user, token: ctx?.token }),
  checkAuthorization: async () => ({ allowed: true }),
};
const monitoring = { recordOperation: () => {} };

const EXPOSURES = [
  { name: 'Exposed admin port', type: 'exposure', category: 'network', exploitedBy: ['T1190'] },
  { name: 'Weak credentials', type: 'exposure', category: 'identity', exploitedBy: ['T1110', 'T1078'] },
];
const COUNTERMEASURES = [{ name: 'MFA enforced', type: 'countermeasure', category: 'identity', respondsWith: ['M1032'] }];

/** Serves the class policies the module would; one per class id. */
const registry = {
  getModuleByName: (name: string) =>
    name === MODULE_NAME
      ? {
          getExposures: async (_elementId: string, classId: string) => (classId.startsWith('cc-') ? EXPOSURES : []),
          getCountermeasures: async (_elementId: string, classId: string) => (classId.startsWith('ccls-') ? COUNTERMEASURES : []),
        }
      : undefined,
};

let mg: MemgraphHandle;
let driver: Driver;

beforeAll(async () => {
  mg = await startMemgraph();
  driver = mg.driver;
});
afterAll(async () => {
  await mg?.stop();
});
beforeEach(async () => {
  await clearGraph(driver);
  await run(`CREATE (:Module {id: 'mod-1-id', name: $name})`, { name: MODULE_NAME });
  for (const [label, classId] of [
    ['ComponentClass', 'cc-A'],
    ['ComponentClass', 'cc-B'],
    ['ComponentClass', 'cc-C'],
    ['ControlClass', 'ccls-A'],
  ]) {
    await run(`MATCH (m:Module {name: $name}) CREATE (m)-[:HAS_CLASS]->(:${label} {id: $classId, name: $classId})`, {
      name: MODULE_NAME,
      classId,
    });
  }
  await run(`UNWIND ['T1078', 'T1110', 'T1190'] AS id CREATE (:MitreAttackTechnique {attack_id: id, id: 'tech-' + id, name: id})`);
  await run(`CREATE (:MitreAttackMitigation {attack_id: 'M1032', id: 'mit-M1032', name: 'M1032'})`);
  // Bound to a third class, so every rebind below changes the binding.
  await run(`CREATE (c:Component {id: 'cmp-1', name: 'cmp-1'}) WITH c MATCH (k {id: 'cc-C'}) MERGE (c)-[:IS_INSTANCE_OF]->(k)`);
  await run(`CREATE (c:Control {id: 'ctrl-1', name: 'ctrl-1'}) WITH c MATCH (k {id: 'ccls-A'}) MERGE (c)-[:IS_INSTANCE_OF]->(k)`);
});

async function run(cypher: string, params: Record<string, unknown> = {}) {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

const num = (v: any): number => (typeof v?.toNumber === 'function' ? v.toNumber() : Number(v));

const service = () => new SetInstantiationAttributesService(driver, makeStubConfigService(), registry as any, auth as any, monitoring as any);

/** Each writer in its own session and transaction, retried by the driver on a conflict, as the platform's are. */
function inOwnTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
  const session = driver.session({ database: 'memgraph' });
  return session.executeWrite((tx) => work(tx)).finally(() => session.close());
}

async function findingCounts(elementId: string, relation: 'HAS_EXPOSURE' | 'HAS_COUNTERMEASURE') {
  const result = await run(
    `MATCH (c {id: $elementId})-[:${relation}]->(f)
     OPTIONAL MATCH (f)-[l]->(t) WHERE NOT type(l) IN ['IS_EXPOSURE_OF', 'IS_COUNTERMEASURE_OF']
     WITH f, count(l) AS links, count(DISTINCT t) AS targets
     RETURN f.name AS name, count(f) AS nodes, sum(links) AS links, sum(targets) AS targets ORDER BY name`,
    { elementId },
  );
  return result.records.map((r) => ({ name: r.get('name'), nodes: num(r.get('nodes')), links: num(r.get('links')), targets: num(r.get('targets')) }));
}

(process.env.DT_TEST_WITHOUT_LOCKS ? describe : describe.skip)('the run without locks', () => {
  it('has the element lock removed', async () => {
    const tx = { run: jest.fn() };
    await lockElementInTx(tx as any, 'cmp-1');
    expect(tx.run).not.toHaveBeenCalled();
  });
});

describe('N writers at once', () => {
  it(`exposure upserts: ${N} at once leave one finding per name and one link per technique`, async () => {
    const svc = service();
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        inOwnTransaction((tx) => svc.upsertExposuresInTx(tx, { componentId: 'cmp-1', classId: 'cc-A', exposures: EXPOSURES } as any)),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await findingCounts('cmp-1', 'HAS_EXPOSURE')).toEqual([
      { name: 'Exposed admin port', nodes: 1, links: 1, targets: 1 },
      { name: 'Weak credentials', nodes: 1, links: 2, targets: 2 },
    ]);
  });

  it(`countermeasure upserts: ${N} at once leave one finding and one link`, async () => {
    const svc = service();
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        inOwnTransaction((tx) =>
          svc.upsertCountermeasuresInTx(tx, { componentId: 'ctrl-1', classId: 'ccls-A', countermeasures: COUNTERMEASURES } as any),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await findingCounts('ctrl-1', 'HAS_COUNTERMEASURE')).toEqual([{ name: 'MFA enforced', nodes: 1, links: 1, targets: 1 }]);
  });

  it(`rebinds from ${N} separate service instances leave one class binding and that class's findings only`, async () => {
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => {
        const svc = service();
        const binding = new ElementBindingService(driver as any, makeStubConfigService(), registry as any, auth as any, svc);
        return binding.changeElementBinding(
          { elementId: 'cmp-1', target: { kind: 'CLASS', classIds: [i % 2 ? 'cc-B' : 'cc-A'] } } as any,
          { user: { sub: `writer-${i}` } } as any,
        );
      }),
    );
    // A binding change reports a database failure in its result rather than throwing.
    expect(results.map((r) => r.status === 'fulfilled' && (r.value as { success: boolean }).success)).toEqual(Array(N).fill(true));
    const bound = await run(`MATCH (:Component {id: 'cmp-1'})-[:IS_INSTANCE_OF]->(k) RETURN collect(k.id) AS classes`);
    const classes = bound.records[0].get('classes') as string[];
    expect(classes).toHaveLength(1);
    const ofOtherClass = await run(
      `MATCH (:Component {id: 'cmp-1'})-[:HAS_EXPOSURE]->(f)-[:IS_EXPOSURE_OF]->(k) WHERE k.id <> $bound RETURN count(f) AS c`,
      { bound: classes[0] },
    );
    expect(num(ofOtherClass.records[0].get('c'))).toBe(0);
    expect(await findingCounts('cmp-1', 'HAS_EXPOSURE')).toEqual([
      { name: 'Exposed admin port', nodes: 1, links: 1, targets: 1 },
      { name: 'Weak credentials', nodes: 1, links: 2, targets: 2 },
    ]);
  });
});
