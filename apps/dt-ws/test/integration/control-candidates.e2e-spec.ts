// Integration coverage for ControlCandidatesResolverService (controlCandidatesForType, the ranking surface).
//
// Strategy: construct the resolver service directly against a real Memgraph testcontainer (as control-gaps does)
// and drive executeControlCandidatesForType. The headline case: no catalogue class sets supportedTypes, so a class
// without the list must rank as applying to every element type; a class with an explicit list is read strictly,
// in the eligibility prune and in the per-class compatible flag alike.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { ControlCandidatesResolverService } from '../../src/gql/resolver-services/control-candidates-resolver.service';

jest.setTimeout(120_000);

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
  } as unknown as ConfigService;
}

describe('ControlCandidatesResolverService — live Memgraph (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: ControlCandidatesResolverService;

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new ControlCandidatesResolverService(
      mg.driver as any,
      makeStubConfigService(),
      {} as any, // authorizationService — unused on the direct path
      { recordOperation: () => {} } as any,
    );
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    // Four control classes in one module: one without supportedTypes, one for stores only, one with an empty
    // list, and a fourth without supportedTypes that a mixed control carries beside the store class.
    await runWrite(`
      CREATE (mod:Module {id: 'mod-1', name: 'general'})
      CREATE (any:ControlClass {id: 'cc-any', name: 'Any'})
      CREATE (store:ControlClass {id: 'cc-store', name: 'Store only', supportedTypes: ['STORE']})
      CREATE (none:ControlClass {id: 'cc-none', name: 'None', supportedTypes: []})
      CREATE (mod)-[:HAS_CLASS]->(any)
      CREATE (mod)-[:HAS_CLASS]->(store)
      CREATE (mod)-[:HAS_CLASS]->(none)
      CREATE (c1:Control {id: 'ctrl-any', name: 'Typeless'})-[:IS_INSTANCE_OF]->(any)
      CREATE (c2:Control {id: 'ctrl-store', name: 'Store'})-[:IS_INSTANCE_OF]->(store)
      CREATE (c3:Control {id: 'ctrl-none', name: 'Empty list'})-[:IS_INSTANCE_OF]->(none)
      CREATE (c4:Control {id: 'ctrl-mixed', name: 'Mixed'})
      CREATE (c4)-[:IS_INSTANCE_OF]->(any)
      CREATE (c4)-[:IS_INSTANCE_OF]->(store)
      CREATE (cm:Countermeasure {id: 'cm-1', name: 'CM'})
      CREATE (c1)-[:HAS_COUNTERMEASURE]->(cm)
      CREATE (cm)-[:IS_COUNTERMEASURE_OF]->(any)
    `);
  });

  async function runWrite(cypher: string, params: any = {}): Promise<any> {
    const session = mg.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  const rank = async (elementTypes: string[]) =>
    ((await (svc as any).executeControlCandidatesForType(elementTypes, [])) as Array<{ controlId: string; classes: Array<{ classId: string; compatible: boolean; countermeasureCount: number }> }>)
      .sort((a, b) => a.controlId.localeCompare(b.controlId));

  it('ranks a control whose class has no supportedTypes for every element type, and marks it compatible', async () => {
    for (const type of ['PROCESS', 'STORE', 'EXTERNAL_ENTITY', 'BOUNDARY']) {
      const ids = (await rank([type])).map((c) => c.controlId)
      expect(ids).toContain('ctrl-any');
      expect(ids).toContain('ctrl-mixed');
    }
    const typeless = (await rank(['PROCESS'])).find((c) => c.controlId === 'ctrl-any')!;
    expect(typeless.classes).toEqual([expect.objectContaining({ classId: 'cc-any', compatible: true, countermeasureCount: 1 })]);
  });

  it('reads an explicit list strictly: a store class ranks for stores only, an empty list for nothing', async () => {
    expect((await rank(['PROCESS'])).map((c) => c.controlId)).toEqual(['ctrl-any', 'ctrl-mixed']);
    expect((await rank(['STORE'])).map((c) => c.controlId)).toEqual(['ctrl-any', 'ctrl-mixed', 'ctrl-store']);
    // A control eligible through its typeless class still reports its store class as incompatible with a process.
    const mixed = (await rank(['PROCESS'])).find((c) => c.controlId === 'ctrl-mixed')!;
    const fit = Object.fromEntries(mixed.classes.map((c) => [c.classId, c.compatible]));
    expect(fit).toEqual({ 'cc-any': true, 'cc-store': false });
  });
});
