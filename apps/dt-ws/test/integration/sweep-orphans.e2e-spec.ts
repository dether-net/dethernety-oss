// Integration coverage for OrphanSweepResolverService.sweepOrphans.
//
// Strategy mirrors delete-model.e2e-spec.ts: instantiate the resolver service
// directly against a real Memgraph testcontainer with a real neo4j-driver and a
// hand-rolled ModuleRegistry mock. We do NOT boot the full Apollo/NestJS stack.
//
// Coverage:
//   - admin gate: a non-admin caller is rejected before any work.
//   - core Data/Exposure liveness sweep: orphan model-level Data (no CONTAINS /
//     no HANDLES) and orphan Exposures (owner is orphan Data, or no owner) are
//     counted (dry-run) / deleted (apply); live ones survive.
//   - aggregation: a module hook's per-label counts fold into the report
//     alongside the core counts; dry-run mutates nothing.
//
// Tests run sequentially (--runInBand) so the shared container is safe.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { OrphanSweepResolverService } from '../../src/gql/resolver-services/orphan-sweep-resolver.service';

jest.setTimeout(120_000);

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
}

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
  } as unknown as ConfigService;
}

const adminCtx = { user: { sub: 'admin-1', email: 'a@example.com', roles: ['admin'] } };
const userCtx = { user: { sub: 'user-1', email: 'u@example.com', roles: [] } };

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}
function num(v: any): number {
  return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
}
async function countByLabel(driver: any, label: string): Promise<number> {
  const r = await runWrite(driver, `MATCH (n:${label}) RETURN count(n) AS cnt`);
  return num(r.records[0].get('cnt'));
}
async function nodeExists(driver: any, id: string): Promise<boolean> {
  const r = await runWrite(driver, `MATCH (n {id: $id}) RETURN count(n) AS cnt`, { id });
  return num(r.records[0].get('cnt')) > 0;
}
async function graphSnapshot(driver: any): Promise<{ nodes: number; edges: number }> {
  const nr = await runWrite(driver, `MATCH (n) RETURN count(n) AS cnt`);
  const er = await runWrite(driver, `MATCH ()-[r]->() RETURN count(r) AS cnt`);
  return { nodes: num(nr.records[0].get('cnt')), edges: num(er.records[0].get('cnt')) };
}

// Orphan core Data/Exposure + their live counterparts.
//   orph-d        : Data, no CONTAINS / no HANDLES         → orphan
//   orph-d2 ──HAS_EXPOSURE──▶ orph-e2 (owner is orphan Data) → both orphan
//   orph-e1       : Exposure, no in-edge                   → orphan
//   live: Model ─CONTAINS─▶ live-d ; Component ─HANDLES─▶ live-hd ;
//         Component ─HAS_EXPOSURE─▶ live-e                 → all live
async function seedCore(driver: any): Promise<void> {
  await runWrite(
    driver,
    `
    CREATE (:Data {id: 'orph-d', name: 'orphan'})
    CREATE (od2:Data {id: 'orph-d2', name: 'orphan2'})
    CREATE (od2)-[:HAS_EXPOSURE]->(:Exposure {id: 'orph-e2'})
    CREATE (:Exposure {id: 'orph-e1'})
    CREATE (m:Model {id: 'live-m', name: 'm'})
    CREATE (m)-[:CONTAINS]->(:Data {id: 'live-d', name: 'model-data'})
    CREATE (c:Component {id: 'live-c', name: 'c'})
    CREATE (c)-[:HANDLES]->(:Data {id: 'live-hd', name: 'handled'})
    CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'live-e'})
    `,
  );
}

// A module hook returning canned per-label counts. The label values are
// deliberately fictitious placeholders — this OSS test must not name a real
// private label; the platform treats hook labels as opaque runtime strings.
function makeFakeModule(): any {
  return {
    onOrphanSweep: async (_tx: any, opts: { apply: boolean }) => ({
      byLabel: { ModuleLabelA: 3, ModuleLabelB: 1 },
      nodesDeleted: 4,
      relationshipsDeleted: opts.apply ? 7 : 0,
    }),
  };
}

describe('OrphanSweepResolverService.sweepOrphans', () => {
  let mg: MemgraphHandle;
  let registry: FakeModuleRegistry;
  let service: OrphanSweepResolverService;
  let sweep: (parent: any, args: any, ctx: any) => Promise<any>;

  beforeAll(async () => {
    mg = await startMemgraph();
    registry = new FakeModuleRegistry();
    service = new OrphanSweepResolverService(mg.driver, makeStubConfigService(), registry as any);
    sweep = service.getResolvers().Mutation.sweepOrphans as any;
  }, 180_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    registry.reset();
  });

  it('admin gate: a non-admin caller is rejected before any work', async () => {
    await seedCore(mg.driver);
    const before = await graphSnapshot(mg.driver);
    await expect(sweep(null, { dryRun: false }, userCtx)).rejects.toThrow(/Admin role required/);
    expect(await graphSnapshot(mg.driver)).toEqual(before);
  });

  it('dry-run: counts core orphans + folds hook counts, mutates nothing', async () => {
    await seedCore(mg.driver);
    registry.setModule('fake', makeFakeModule());
    const before = await graphSnapshot(mg.driver);

    const report = await sweep(null, { dryRun: true }, adminCtx);

    expect(report.dryRun).toBe(true);
    expect(report.byLabel).toEqual([
      { label: 'Data', count: 2 },
      { label: 'Exposure', count: 2 },
      { label: 'ModuleLabelA', count: 3 },
      { label: 'ModuleLabelB', count: 1 },
    ]);
    expect(report.totalNodes).toBe(8); // 2 + 2 + 3 + 1
    expect(report.totalRelationships).toBe(0); // dry-run reports node counts only
    expect(await graphSnapshot(mg.driver)).toEqual(before); // nothing removed
  });

  it('apply: deletes core orphans, keeps live, aggregates hook + core counts', async () => {
    await seedCore(mg.driver);
    registry.setModule('fake', makeFakeModule());

    const report = await sweep(null, { dryRun: false }, adminCtx);

    expect(report.dryRun).toBe(false);
    expect(report.totalNodes).toBe(8);
    // Core orphans gone.
    for (const id of ['orph-d', 'orph-d2', 'orph-e1', 'orph-e2']) {
      expect(await nodeExists(mg.driver, id)).toBe(false);
    }
    // Live core nodes survive.
    for (const id of ['live-d', 'live-hd', 'live-e', 'live-m', 'live-c']) {
      expect(await nodeExists(mg.driver, id)).toBe(true);
    }
    expect(await countByLabel(mg.driver, 'Data')).toBe(2); // live-d + live-hd
    expect(await countByLabel(mg.driver, 'Exposure')).toBe(1); // live-e
    // Relationship total folds the hook's 7 + the one core HAS_EXPOSURE edge.
    expect(report.totalRelationships).toBeGreaterThanOrEqual(7);
  });

  it('idempotent: a second apply removes nothing more', async () => {
    await seedCore(mg.driver);
    await sweep(null, { dryRun: false }, adminCtx);
    const report = await sweep(null, { dryRun: false }, adminCtx);
    // Core orphans already gone — only Data/Exposure absent from byLabel now.
    expect(report.byLabel.find((b: any) => b.label === 'Data')).toBeUndefined();
    expect(report.byLabel.find((b: any) => b.label === 'Exposure')).toBeUndefined();
  });

  it('keeps an Exposure owned by a live (model-contained) Data', async () => {
    // Subtle Exposure branch: the sole HAS_EXPOSURE owner is a LIVE Data (under a
    // Model via CONTAINS — not a Component, not an orphan Data). Since not every
    // owner is an orphan Data, the Exposure is not an orphan and must survive.
    await runWrite(
      mg.driver,
      `
      CREATE (m:Model {id: 'lde-m', name: 'm'})
      CREATE (m)-[:CONTAINS]->(ld:Data {id: 'ld', name: 'live-data'})
      CREATE (ld)-[:HAS_EXPOSURE]->(:Exposure {id: 'lde'})
      `,
    );

    const report = await sweep(null, { dryRun: false }, adminCtx);

    // The live Data + its Exposure survive...
    expect(await nodeExists(mg.driver, 'ld')).toBe(true);
    expect(await nodeExists(mg.driver, 'lde')).toBe(true);
    // ...and neither was reported as an orphan.
    expect(report.byLabel.find((b: any) => b.label === 'Data')).toBeUndefined();
    expect(report.byLabel.find((b: any) => b.label === 'Exposure')).toBeUndefined();
  });
});
