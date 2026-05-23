// Integration coverage for ModelResolverService.deleteModel.
//
// Strategy mirrors element-binding.e2e-spec.ts: instantiate the resolver
// service directly against a real Memgraph testcontainer with a real
// neo4j-driver and a hand-rolled ModuleRegistry mock. We do NOT boot the full
// Apollo/NestJS stack — schema-level wiring is exercised by booting dt-ws in
// dev/CI.
//
// Coverage:
//   - full model → every owned structural node gone, shared nodes (classes,
//     module, folder) intact, DeletionStats == an independent recount.
//   - a boundary-less model still deletes its Model node.
//   - model-level Data (CONTAINS) + boundary-data exposures removed.
//   - a throwing onModelDeleted hook rolls back the whole transaction.
//   - hook dispatch: onModelDeleted is invoked with (tx, modelId, analysisIds)
//     and its returned counts fold into DeletionStats.
//
// Tests run sequentially (--runInBand) so the shared container is safe.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { ModelResolverService } from '../../src/gql/resolver-services/model-resolver.service';

jest.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Module registry mock — deleteModel only calls getAllModules().
// ---------------------------------------------------------------------------

class FakeModuleRegistry {
  private modules = new Map<string, any>();

  setModule(name: string, instance: any) {
    this.modules.set(name, instance);
  }

  reset() {
    this.modules.clear();
  }

  getAllModules(): Map<string, any> {
    return new Map(this.modules);
  }

  getModuleByName(name: string): any | undefined {
    return this.modules.get(name);
  }
}

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

const authCtx = { user: { id: 'u-1', email: 'u@example.com', roles: [], permissions: [] } };

// ---------------------------------------------------------------------------
// Cypher helpers.
// ---------------------------------------------------------------------------

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function countByLabel(driver: any, label: string): Promise<number> {
  const r = await runWrite(driver, `MATCH (n:${label}) RETURN count(n) AS cnt`);
  const v = r.records[0].get('cnt');
  return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
}

async function nodeExists(driver: any, id: string): Promise<boolean> {
  const r = await runWrite(driver, `MATCH (n {id: $id}) RETURN count(n) AS cnt`, { id });
  const v = r.records[0].get('cnt');
  return (typeof v?.toNumber === 'function' ? v.toNumber() : Number(v)) > 0;
}

async function graphSnapshot(driver: any): Promise<{ nodes: number; edges: number }> {
  const nr = await runWrite(driver, `MATCH (n) RETURN count(n) AS cnt`);
  const er = await runWrite(driver, `MATCH ()-[r]->() RETURN count(r) AS cnt`);
  const num = (rec: any) =>
    typeof rec?.toNumber === 'function' ? rec.toNumber() : Number(rec);
  return { nodes: num(nr.records[0].get('cnt')), edges: num(er.records[0].get('cnt')) };
}

// The structural query without the DELETE — the independent recount.
const RECOUNT_OWNED = `
MATCH (m:Model {id: $modelId})
OPTIONAL MATCH (m)-[:CONTAINS]->(db:SecurityBoundary)
OPTIONAL MATCH (db)<-[:BELONGS_TO*0..]-(sb:SecurityBoundary)
OPTIONAL MATCH (sb)<-[:BELONGS_TO]-(c:Component)
OPTIONAL MATCH (c)-[:FLOWS]-(df:DataFlow)
OPTIONAL MATCH (m)-[:CONTAINS]->(md:Data)
OPTIONAL MATCH (sb)-[:HANDLES]->(bd:Data)
OPTIONAL MATCH (c)-[:HANDLES]->(cd:Data)
OPTIONAL MATCH (df)-[:HANDLES]->(fd:Data)
WITH m,
  collect(DISTINCT sb) + collect(DISTINCT c) + collect(DISTINCT df)
  + collect(DISTINCT md) + collect(DISTINCT bd) + collect(DISTINCT cd)
  + collect(DISTINCT fd) AS elems
UNWIND ([m] + elems) AS el
OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(exp:Exposure)
WITH m, elems, collect(DISTINCT exp) AS exps
WITH [m] + elems + exps AS owned
UNWIND owned AS n
WITH collect(DISTINCT n) AS nodes
CALL {
  WITH nodes UNWIND nodes AS x
  OPTIONAL MATCH (x)-[r]-()
  RETURN count(DISTINCT r) AS rels
}
RETURN size(nodes) AS nodesDeleted, rels AS relationshipsDeleted
`;

async function recountOwned(
  driver: any,
  modelId: string,
): Promise<{ nodesDeleted: number; relationshipsDeleted: number }> {
  const r = await runWrite(driver, RECOUNT_OWNED, { modelId });
  const row = r.records[0];
  const num = (v: any) => (typeof v?.toNumber === 'function' ? v.toNumber() : Number(v));
  return {
    nodesDeleted: num(row.get('nodesDeleted')),
    relationshipsDeleted: num(row.get('relationshipsDeleted')),
  };
}

/**
 * Seed a full structural model:
 *   Model ─CONTAINS─▶ SecurityBoundary(def) ◀─BELONGS_TO─ SecurityBoundary(child)
 *   child ◀─BELONGS_TO─ Component ─FLOWS─ DataFlow
 *   Model ─CONTAINS─▶ Data(model-level)
 *   def ─HANDLES─▶ Data(boundary) ─HAS_EXPOSURE─▶ Exposure
 *   Component ─HANDLES─▶ Data ; DataFlow ─HANDLES─▶ Data
 *   Component ─HAS_EXPOSURE─▶ Exposure
 *   Component ─IS_INSTANCE_OF─▶ ComponentClass   # shared, must survive
 *   Module ─HAS_CLASS─▶ ComponentClass            # shared
 * Plus a standalone Folder (shared, unconnected).
 * 11 owned nodes total.
 */
async function seedFullModel(driver: any, modelId: string): Promise<void> {
  await runWrite(
    driver,
    `
    CREATE (m:Model {id: $modelId, name: 'm'})
    CREATE (def:SecurityBoundary {id: $modelId + '-def', name: 'def'})
    CREATE (child:SecurityBoundary {id: $modelId + '-child', name: 'child'})
    CREATE (comp:Component {id: $modelId + '-comp', name: 'comp'})
    CREATE (flow:DataFlow {id: $modelId + '-flow', name: 'flow'})
    CREATE (md:Data {id: $modelId + '-md', name: 'model-data'})
    CREATE (bd:Data {id: $modelId + '-bd', name: 'boundary-data'})
    CREATE (cd:Data {id: $modelId + '-cd', name: 'comp-data'})
    CREATE (fd:Data {id: $modelId + '-fd', name: 'flow-data'})
    CREATE (excomp:Exposure {id: $modelId + '-excomp', name: 'comp-exp'})
    CREATE (exbd:Exposure {id: $modelId + '-exbd', name: 'boundary-data-exp'})
    CREATE (m)-[:CONTAINS]->(def)
    CREATE (child)-[:BELONGS_TO]->(def)
    CREATE (comp)-[:BELONGS_TO]->(child)
    CREATE (comp)-[:FLOWS]->(flow)
    CREATE (m)-[:CONTAINS]->(md)
    CREATE (def)-[:HANDLES]->(bd)
    CREATE (comp)-[:HANDLES]->(cd)
    CREATE (flow)-[:HANDLES]->(fd)
    CREATE (comp)-[:HAS_EXPOSURE]->(excomp)
    CREATE (bd)-[:HAS_EXPOSURE]->(exbd)
    `,
    { modelId },
  );
}

async function seedSharedNodes(driver: any, modelId: string): Promise<void> {
  // ComponentClass owned by a Module, linked from the model's Component.
  await runWrite(
    driver,
    `
    MATCH (comp:Component {id: $modelId + '-comp'})
    CREATE (mod:Module {id: 'shared-mod', name: 'shared-mod'})
    CREATE (cc:ComponentClass {id: 'shared-cc', name: 'shared-cc'})
    CREATE (mod)-[:HAS_CLASS]->(cc)
    CREATE (comp)-[:IS_INSTANCE_OF]->(cc)
    CREATE (:Folder {id: 'shared-folder', name: 'shared-folder'})
    `,
    { modelId },
  );
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe('ModelResolverService.deleteModel — structural delete + hook dispatch', () => {
  let mg: MemgraphHandle;
  let registry: FakeModuleRegistry;
  let service: ModelResolverService;

  beforeAll(async () => {
    mg = await startMemgraph();
    registry = new FakeModuleRegistry();
    service = new ModelResolverService(
      mg.driver as any,
      makeStubConfigService(),
      registry as any,
      makeStubAuthService(),
    );
  }, 180_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    registry.reset();
  });

  it('deletes the full structural subgraph, preserves shared nodes, counts match a recount', async () => {
    await seedFullModel(mg.driver, 'model-1');
    await seedSharedNodes(mg.driver, 'model-1');

    const expected = await recountOwned(mg.driver, 'model-1');
    expect(expected.nodesDeleted).toBe(11);

    const stats = await service.deleteModel('model-1', authCtx);

    // returned counts equal the independent recount.
    expect(stats).toEqual(expected);

    // every owned structural node is gone.
    for (const suffix of [
      '', '-def', '-child', '-comp', '-flow', '-md', '-bd', '-cd', '-fd', '-excomp', '-exbd',
    ]) {
      expect(await nodeExists(mg.driver, `model-1${suffix}`)).toBe(false);
    }

    // shared nodes survive (only their edges to the deleted elements died).
    expect(await nodeExists(mg.driver, 'shared-cc')).toBe(true);
    expect(await nodeExists(mg.driver, 'shared-mod')).toBe(true);
    expect(await nodeExists(mg.driver, 'shared-folder')).toBe(true);
    expect(await countByLabel(mg.driver, 'ComponentClass')).toBe(1);
    expect(await countByLabel(mg.driver, 'Module')).toBe(1);
    expect(await countByLabel(mg.driver, 'Folder')).toBe(1);
  });

  it('removes model-level Data (CONTAINS) and boundary-data exposures', async () => {
    await seedFullModel(mg.driver, 'model-4');

    await service.deleteModel('model-4', authCtx);

    expect(await nodeExists(mg.driver, 'model-4-md')).toBe(false); // model-level Data
    expect(await nodeExists(mg.driver, 'model-4-bd')).toBe(false); // boundary Data
    expect(await nodeExists(mg.driver, 'model-4-exbd')).toBe(false); // boundary-data Exposure
    expect(await countByLabel(mg.driver, 'Data')).toBe(0);
    expect(await countByLabel(mg.driver, 'Exposure')).toBe(0);
  });

  it('deletes a model with no default boundary', async () => {
    await runWrite(mg.driver, `CREATE (m:Model {id: 'model-3', name: 'm'})`);

    const stats = await service.deleteModel('model-3', authCtx);

    expect(stats.nodesDeleted).toBe(1);
    expect(await nodeExists(mg.driver, 'model-3')).toBe(false);
  });

  it('non-existent model is an idempotent no-op (returns {0,0})', async () => {
    const stats = await service.deleteModel('does-not-exist', authCtx);
    expect(stats).toEqual({ nodesDeleted: 0, relationshipsDeleted: 0 });
  });

  it('hook dispatch: onModelDeleted gets (tx, modelId, analysisIds); counts fold into DeletionStats', async () => {
    await seedFullModel(mg.driver, 'model-h');
    // Two analyses: one off the model, one off the component.
    await runWrite(
      mg.driver,
      `MATCH (m:Model {id: 'model-h'}), (c:Component {id: 'model-h-comp'})
       CREATE (m)-[:ANALYZED_BY]->(:Analysis {id: 'an-model'})
       CREATE (c)-[:ANALYZED_BY]->(:Analysis {id: 'an-comp'})`,
    );

    const structural = await recountOwned(mg.driver, 'model-h');
    const onModelDeleted = jest
      .fn()
      .mockResolvedValue({ nodesDeleted: 3, relationshipsDeleted: 5 });
    registry.setModule('analysis-mod', { onModelDeleted });

    const stats = await service.deleteModel('model-h', authCtx);

    expect(onModelDeleted).toHaveBeenCalledTimes(1);
    const [txArg, modelIdArg, analysisIdsArg] = onModelDeleted.mock.calls[0];
    expect(txArg).toBeDefined(); // the active transaction
    expect(modelIdArg).toBe('model-h');
    expect([...analysisIdsArg].sort()).toEqual(['an-comp', 'an-model']);

    // Hook counts fold into the structural counts.
    expect(stats.nodesDeleted).toBe(structural.nodesDeleted + 3);
    expect(stats.relationshipsDeleted).toBe(structural.relationshipsDeleted + 5);
  });

  it('a throwing onModelDeleted hook rolls back the whole transaction', async () => {
    await seedFullModel(mg.driver, 'model-7');
    await seedSharedNodes(mg.driver, 'model-7');

    const before = await graphSnapshot(mg.driver);

    registry.setModule('bad-mod', {
      onModelDeleted: jest.fn().mockRejectedValue(new Error('hook exploded')),
    });

    await expect(service.deleteModel('model-7', authCtx)).rejects.toThrow();

    // Whole transaction rolled back — model + subgraph fully present.
    const after = await graphSnapshot(mg.driver);
    expect(after).toEqual(before);
    expect(await nodeExists(mg.driver, 'model-7')).toBe(true);
    expect(await nodeExists(mg.driver, 'model-7-comp')).toBe(true);
  });
});
