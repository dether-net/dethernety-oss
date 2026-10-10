// Class vector indexes on the Memgraph version a deployment pins.
//
// 1. Which write forms put a node into a vector index (a characterisation of Memgraph's behaviour,
//    so a version that changes it shows up here).
// 2. Classes installed through updateAllModules with precomputed vectors are held by their index and
//    found by vector similarity.
// 3. A module-scoped search finds a module's class even when other modules' classes are nearer.
// 4. Memgraph 3.8.1 recovers a vector index from a snapshot under another label or property (the
//    index created first keeps its key). The self-heal rebuilds such a class index on the next install
//    pass, and the MITRE resolver rebuilds such a MITRE index when it ensures its indexes.
// 5. When only Memgraph restarts and the platform keeps running, the next search after the vector
//    availability check expires rebuilds a re-keyed class or MITRE index.
//
// The services run against a real container with stub config, auth, monitoring and embedding
// services; the embedding stub returns a fixed query vector and the module serves precomputed ones.

import neo4j, { Driver } from 'neo4j-driver';
import { Readable } from 'node:stream';
import { GenericContainer, Wait } from 'testcontainers';
import type { DTMetadata, DTModule } from '@dethernety/dt-module';
import {
  startMemgraph,
  clearGraph,
  MemgraphHandle,
} from './memgraph-container';
import { MatchClassesResolverService } from '../../src/gql/resolver-services/match-classes-resolver.service';
import { MatchMitreTechniquesResolverService } from '../../src/gql/resolver-services/match-mitre-techniques-resolver.service';
import { ModuleManagementService } from '../../src/gql/module-management-services/module-management.service';
import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';

jest.setTimeout(180_000);

// The image the deployment bundle pins.
const DEPLOYMENT_IMAGE = 'memgraph/memgraph:3.13.2';
// The release that re-keys a vector index on snapshot recovery; deployments that keep it rely on the self-heal.
const REKEYING_IMAGE = 'memgraph/memgraph:3.8.1';
// The snapshot settings a deployment runs with; a restart recovers from the snapshot.
const DEPLOYMENT_FLAGS = [
  '--storage-snapshot-interval-sec=300',
  '--storage-gc-cycle-sec=300',
];
const DIMENSIONS = 8;
const MODEL = 'test-embedding-model';
const COMPONENT_INDEX = 'component_class_embeddings';

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
}
/** e0 tilted towards axis `axis` by `amount`: similarity to e0 falls as `amount` grows. */
function near(axis: number, amount: number): number[] {
  const v = new Array(DIMENSIONS).fill(0);
  v[0] = 1;
  v[axis] += amount;
  return unit(v);
}
const QUERY = near(1, 0);

async function run(
  driver: Driver,
  cypher: string,
  params: Record<string, unknown> = {},
) {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

/** Run several statements in one explicit transaction, as the module installer does. */
async function inOneTransaction(
  driver: Driver,
  statements: [string, Record<string, unknown>][],
) {
  const session = driver.session();
  try {
    await session.executeWrite(async (tx) => {
      for (const [cypher, params] of statements) await tx.run(cypher, params);
    });
  } finally {
    await session.close();
  }
}

/** Ids of the classes a search with each class's own vector returns among its nearest three. */
async function heldClassIds(
  driver: Driver,
  label: string,
  index: string,
): Promise<string[]> {
  const result = await run(
    driver,
    `MATCH (c:${label}) WHERE c.embedding IS NOT NULL
     CALL vector_search.search('${index}', 3, c.embedding) YIELD node
     WITH c, collect(node.id) AS nearest
     WHERE c.id IN nearest
     RETURN c.id AS id ORDER BY id`,
  );
  return result.records.map((r) => r.get('id'));
}

/** The label and property Memgraph reports for a vector index. */
async function indexKey(driver: Driver, index: string): Promise<string> {
  const result = await run(
    driver,
    'CALL vector_search.show_index_info() YIELD index_name, label, property WITH index_name, label, property WHERE index_name = $index RETURN label, property',
    { index },
  );
  const record = result.records[0];
  return `${String(record.get('label')).replace(/^:/, '')}.${record.get('property')}`;
}

/** Take a snapshot, restart the container (it recovers from the snapshot) and connect again. */
async function restartFromSnapshot(mg: MemgraphHandle): Promise<Driver> {
  await run(mg.driver, 'CREATE SNAPSHOT');
  await mg.driver.close();
  await mg.container.restart();
  const driver = neo4j.driver(
    `bolt://${mg.container.getHost()}:${mg.container.getMappedPort(7687)}`,
    neo4j.auth.basic('', ''),
  );
  for (let i = 0; i < 40; i++) {
    try {
      await run(driver, 'RETURN 1');
      return driver;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('Memgraph did not come back after the restart');
}

describe('Memgraph vector index: write forms that index a node', () => {
  let mg: MemgraphHandle;
  const VECTOR = [0.1, 0.2, 0.3, 0.4];

  beforeAll(async () => {
    mg = await startMemgraph({ image: DEPLOYMENT_IMAGE });
  });

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  const cases: {
    label: string;
    form: string;
    write: (d: Driver) => Promise<void>;
  }[] = [
    {
      label: 'CreateMergeMap',
      form: 'CREATE … SET c += {embedding} in one statement (the installer’s form)',
      write: (d) =>
        inOneTransaction(d, [
          [
            'CREATE (c:CreateMergeMap {id: $id}) SET c += $props',
            { id: 'a', props: { embedding: VECTOR } },
          ],
        ]),
    },
    {
      label: 'CreateInlineMap',
      form: 'CREATE (c {…, embedding}) in one statement',
      write: (d) =>
        inOneTransaction(d, [
          [
            'CREATE (c:CreateInlineMap {id: $id, embedding: $v})',
            { id: 'a', v: VECTOR },
          ],
        ]),
    },
    {
      label: 'SameTxSetProperty',
      form: 'CREATE, then SET c.embedding in a second statement of the same transaction',
      write: (d) =>
        inOneTransaction(d, [
          ['CREATE (c:SameTxSetProperty {id: $id})', { id: 'a' }],
          [
            'MATCH (c:SameTxSetProperty {id: $id}) SET c.embedding = $v',
            { id: 'a', v: VECTOR },
          ],
        ]),
    },
    {
      label: 'SeparateTxSetProperty',
      form: 'CREATE in one transaction, SET c.embedding in the next',
      write: async (d) => {
        await inOneTransaction(d, [
          ['CREATE (c:SeparateTxSetProperty {id: $id})', { id: 'a' }],
        ]);
        await inOneTransaction(d, [
          [
            'MATCH (c:SeparateTxSetProperty {id: $id}) SET c.embedding = $v',
            { id: 'a', v: VECTOR },
          ],
        ]);
      },
    },
    {
      label: 'ExistingMergeMap',
      form: 'an existing node, MATCH … SET c += {embedding}',
      write: async (d) => {
        await inOneTransaction(d, [
          ['CREATE (c:ExistingMergeMap {id: $id})', { id: 'a' }],
        ]);
        await inOneTransaction(d, [
          [
            'MATCH (c:ExistingMergeMap {id: $id}) SET c += $props',
            { id: 'a', props: { embedding: VECTOR } },
          ],
        ]);
      },
    },
    {
      label: 'IndexAfterNodes',
      form: 'nodes written before the index exists (creating the index indexes them)',
      write: async (d) => {
        await run(d, 'DROP VECTOR INDEX indexafternodes_idx');
        await inOneTransaction(d, [
          [
            'CREATE (c:IndexAfterNodes {id: $id}) SET c += $props',
            { id: 'a', props: { embedding: VECTOR } },
          ],
        ]);
        await run(
          d,
          'CREATE VECTOR INDEX indexafternodes_idx ON :IndexAfterNodes(embedding) WITH CONFIG {"dimension": 4, "capacity": 16, "metric": "cos"}',
        );
      },
    },
  ];

  it.each(cases)('$form', async ({ label, write }) => {
    const index = `${label.toLowerCase()}_idx`;
    await run(
      mg.driver,
      `CREATE VECTOR INDEX ${index} ON :${label}(embedding) WITH CONFIG {"dimension": 4, "capacity": 16, "metric": "cos"}`,
    );
    await write(mg.driver);
    expect(await heldClassIds(mg.driver, label, index)).toEqual(['a']);
  });
});

describe('class vector indexes through the install and match code', () => {
  let mg: MemgraphHandle;
  let resolver: MatchClassesResolverService;
  let modules: ModuleManagementService;
  // A nested block sets the image in its beforeAll, which runs before this block's beforeEach.
  let image = DEPLOYMENT_IMAGE;

  const config: any = {
    get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
  };
  const auth: any = {
    extractAuthContext: () => ({}),
    checkAuthorization: async () => ({ allowed: true }),
  };
  const monitoring: any = { recordOperation: () => {} };
  const embedding: any = {
    isEnabled: () => true,
    getModel: () => MODEL,
    getDimensions: () => DIMENSIONS,
    getThreshold: () => 0.5,
    composeElementText: (e: { name: string }) => e.name,
    composeClassText: (c: { name: string }) => c.name,
    embedBatch: async (texts: string[]) => texts.map(() => QUERY),
    disableForSession: () => {},
  };

  /** A file module whose component classes carry precomputed vectors. */
  function fileModule(
    name: string,
    contentHash: string,
    classes: { id: string; name: string; vector: number[] }[],
  ): DTModule {
    const vectors = new Map(classes.map((c) => [c.name, c.vector]));
    return {
      getMetadata: async (): Promise<DTMetadata> =>
        ({
          name,
          version: '1.0.0',
          description: '',
          contentHash,
          componentClasses: classes.map((c) => ({
            id: c.id,
            name: c.name,
            description: `${c.name} description`,
            type: 'PROCESS',
            category: 'Test',
          })),
        }) as unknown as DTMetadata,
      getEmbedding: (className: string) => vectors.get(className) ?? null,
    } as unknown as DTModule;
  }

  async function matchComponent(description: string, moduleIds?: string[]) {
    const result: any = await resolver.getResolvers().Query.matchClasses(
      null,
      {
        input: {
          elements: [
            { name: 'zz element under test', type: 'PROCESS', description },
          ],
          classLabel: 'COMPONENT',
          topN: 1,
          ...(moduleIds ? { moduleIds } : {}),
        },
      },
      {},
    );
    return result.matches[0].candidates as {
      className: string;
      matchType: string;
      moduleName: string;
    }[];
  }

  async function moduleId(name: string): Promise<string> {
    return (
      await run(mg.driver, 'MATCH (m:Module {name: $name}) RETURN m.id AS id', {
        name,
      })
    ).records[0].get('id');
  }

  beforeEach(async () => {
    // A fresh container per test: the restart tests leave a recovered database behind.
    mg = await startMemgraph({ image, command: DEPLOYMENT_FLAGS });
    await clearGraph(mg.driver);
    for (const index of [
      'component_class_embeddings',
      'control_class_embeddings',
      'dataflow_class_embeddings',
      'boundary_class_embeddings',
      'data_class_embeddings',
    ]) {
      await run(mg.driver, `DROP VECTOR INDEX ${index}`).catch(() => undefined);
    }
    resolver = new MatchClassesResolverService(
      mg.driver,
      config,
      auth,
      monitoring,
      embedding,
    );
    const log = new ClassIdentityEventLog();
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
    const reconciler = new ClassReconciler(mg.driver, log);
    reconciler.setMageAvailableForTesting(null);
    modules = new ModuleManagementService(
      mg.driver,
      config,
      embedding,
      resolver,
      reconciler,
      log,
    );
    for (const target of [modules, resolver, reconciler]) {
      for (const level of ['log', 'debug', 'warn'])
        jest.spyOn((target as any).logger, level).mockImplementation(() => {});
    }
  });

  afterEach(async () => {
    await mg.driver.close().catch(() => undefined);
    await mg.container.stop();
  });

  it('holds every class installed with a precomputed vector and finds one by vector similarity', async () => {
    const classes = [
      { id: 'a1', name: 'Alpha One', vector: near(2, 3) },
      { id: 'a2', name: 'Alpha Two', vector: near(3, 0.1) },
      { id: 'a3', name: 'Alpha Three', vector: near(4, 3) },
    ];
    await modules.updateAllModules(
      new Map([['mod-a', fileModule('mod-a', 'sha256:a1', classes)]]),
    );

    expect(
      await heldClassIds(mg.driver, 'ComponentClass', COMPONENT_INDEX),
    ).toEqual(['a1', 'a2', 'a3']);
    const [best] = await matchComponent('a paraphrase that names no class');
    expect(best).toMatchObject({
      className: 'Alpha Two',
      matchType: 'vector_similarity',
    });
  });

  it('finds a module’s class in a module-scoped search when other modules’ classes are nearer', async () => {
    // Ten classes of mod-near sit closer to the query than mod-far's only class.
    const nearClasses = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      name: `Near ${i}`,
      vector: near(1 + (i % 6), 0.05 + i * 0.01),
    }));
    await modules.updateAllModules(
      new Map([
        ['mod-near', fileModule('mod-near', 'sha256:n', nearClasses)],
        [
          'mod-far',
          fileModule('mod-far', 'sha256:f', [
            { id: 'f1', name: 'Far One', vector: near(7, 1) },
          ]),
        ],
      ]),
    );

    const [best] = await matchComponent('a paraphrase that names no class', [
      await moduleId('mod-far'),
    ]);
    expect(best).toMatchObject({
      className: 'Far One',
      moduleName: 'mod-far',
      matchType: 'vector_similarity',
    });
  });

  it('ignores a class deleted since it was indexed, before the database collects its index entry', async () => {
    await modules.updateAllModules(
      new Map([
        [
          'mod-a',
          fileModule('mod-a', 'sha256:a1', [
            { id: 'a1', name: 'Alpha One', vector: near(2, 0.5) },
            { id: 'a2', name: 'Alpha Two', vector: near(3, 0.1) },
          ]),
        ],
      ]),
    );
    // The nearest class goes away; until garbage collection runs, the index can still return it.
    await run(mg.driver, "MATCH (c:ComponentClass {id: 'a2'}) DETACH DELETE c");
    const [best] = await matchComponent('a paraphrase that names no class');
    expect(best).toMatchObject({
      className: 'Alpha One',
      matchType: 'vector_similarity',
    });
    const report = await resolver.healClassVectorIndexes();
    expect(report.find((r) => r.indexName === COMPONENT_INDEX)).toMatchObject({
      embedded: 1,
      held: 1,
    });
  });

  it('ignores a MITRE technique deleted since it was indexed, before the database collects its index entry', async () => {
    const write = (id: string, v: number[]) =>
      run(
        mg.driver,
        'CREATE (n:MitreAtlasTechnique {atlas_id: $id, name: $id, description: $id}) SET n.embedding = $v, n.embeddingModel = $model',
        { id, v, model: MODEL },
      );
    await write('AML.T0001', near(2, 0.5));
    await write('AML.T0002', near(3, 0.1));
    const mitre = new MatchMitreTechniquesResolverService(
      mg.driver,
      config,
      auth,
      monitoring,
      embedding,
    );
    for (const level of ['log', 'warn', 'debug'])
      jest.spyOn((mitre as any).logger, level).mockImplementation(() => {});
    const search = (): Promise<any> =>
      mitre
        .getResolvers()
        .Query.matchMitreTechniques(
          null,
          {
            input: {
              queries: [{ query: 'a behaviour described in other words' }],
              kind: 'ATLAS_TECHNIQUE',
              topN: 3,
            },
          },
          {},
        );
    await search();
    await run(
      mg.driver,
      "MATCH (n:MitreAtlasTechnique {atlas_id: 'AML.T0002'}) DETACH DELETE n",
    );
    const result = await search();
    expect(
      result.matches[0].candidates.map((c: { mitreId: string }) => c.mitreId),
    ).toEqual(['AML.T0001']);
  });

  describe(`on ${REKEYING_IMAGE}, which re-keys a vector index on snapshot recovery`, () => {
    beforeAll(() => {
      image = REKEYING_IMAGE;
    });

    afterAll(() => {
      image = DEPLOYMENT_IMAGE;
    });

    it('rebuilds a class index that a snapshot recovery re-keyed, on the next install pass', async () => {
      // Another vector index first: the index Memgraph re-keys on recovery is not the first one.
      await run(
        mg.driver,
        'CREATE VECTOR INDEX decoy_idx ON :Decoy(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
      );
      await modules.updateAllModules(
        new Map([
          [
            'mod-a',
            fileModule('mod-a', 'sha256:a1', [
              { id: 'a1', name: 'Alpha One', vector: near(2, 3) },
            ]),
          ],
        ]),
      );
      expect(await indexKey(mg.driver, COMPONENT_INDEX)).toBe(
        'ComponentClass.embedding',
      );

      const driver = await restartFromSnapshot(mg);
      mg = { ...mg, driver };
      // The field state: the recovered index is keyed on another label or property.
      expect(await indexKey(driver, COMPONENT_INDEX)).not.toBe(
        'ComponentClass.embedding',
      );

      // Fresh services on the restarted database, as after a platform restart.
      resolver = new MatchClassesResolverService(
        driver,
        config,
        auth,
        monitoring,
        embedding,
      );
      const log = new ClassIdentityEventLog();
      const reconciler = new ClassReconciler(driver, log);
      reconciler.setMageAvailableForTesting(null);
      modules = new ModuleManagementService(
        driver,
        config,
        embedding,
        resolver,
        reconciler,
        log,
      );
      for (const target of [modules, resolver, reconciler, log]) {
        for (const level of ['log', 'debug', 'warn'])
          jest
            .spyOn((target as any).logger, level)
            .mockImplementation(() => {});
      }

      // A module installed after the recovery: its class would not reach the re-keyed index.
      await modules.updateAllModules(
        new Map([
          [
            'mod-a',
            fileModule('mod-a', 'sha256:a1', [
              { id: 'a1', name: 'Alpha One', vector: near(2, 3) },
            ]),
          ],
          [
            'mod-b',
            fileModule('mod-b', 'sha256:b1', [
              { id: 'b1', name: 'Beta One', vector: near(3, 0.1) },
            ]),
          ],
        ]),
      );
      expect(await indexKey(driver, COMPONENT_INDEX)).toBe(
        'ComponentClass.embedding',
      );
      expect(
        await heldClassIds(driver, 'ComponentClass', COMPONENT_INDEX),
      ).toEqual(['a1', 'b1']);
      const [best] = await matchComponent('a paraphrase that names no class');
      expect(best).toMatchObject({
        className: 'Beta One',
        matchType: 'vector_similarity',
      });

      // A healthy index is left alone.
      const report = await resolver.healClassVectorIndexes();
      expect(report.find((r) => r.indexName === COMPONENT_INDEX)).toEqual({
        indexName: COMPONENT_INDEX,
        embedded: 2,
        held: 2,
        rebuilt: false,
      });
    });

    it(`heals the re-keyed index a ${REKEYING_IMAGE} snapshot carries into ${DEPLOYMENT_IMAGE}, on the first install pass`, async () => {
      await run(
        mg.driver,
        'CREATE VECTOR INDEX decoy_idx ON :Decoy(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
      );
      const mod = fileModule('mod-a', 'sha256:a1', [
        { id: 'a1', name: 'Alpha One', vector: near(2, 3) },
        { id: 'a2', name: 'Alpha Two', vector: near(3, 0.1) },
      ]);
      await modules.updateAllModules(new Map([['mod-a', mod]]));

      // The old release re-keys the index on a restart, and its next snapshot keeps the wrong key.
      const driver = await restartFromSnapshot(mg);
      mg = { ...mg, driver };
      expect(await indexKey(driver, COMPONENT_INDEX)).not.toBe(
        'ComponentClass.embedding',
      );
      await run(driver, 'CREATE SNAPSHOT');
      const snapshots = await mg.container.copyArchiveFromContainer(
        '/var/lib/memgraph/snapshots',
      );
      const chunks: Buffer[] = [];
      for await (const chunk of snapshots as AsyncIterable<Buffer>)
        chunks.push(Buffer.from(chunk));

      // The upgrade: the new release opens the old release's data.
      const upgraded = await new GenericContainer(DEPLOYMENT_IMAGE)
        .withCommand([...DEPLOYMENT_FLAGS, '--data-recovery-on-startup=true'])
        .withCopyArchivesToContainer([
          {
            tar: Readable.from(Buffer.concat(chunks)),
            target: '/var/lib/memgraph',
          },
        ])
        .withExposedPorts(7687)
        .withWaitStrategy(Wait.forListeningPorts())
        .withStartupTimeout(180_000)
        .start();
      const upgradedDriver = neo4j.driver(
        `bolt://${upgraded.getHost()}:${upgraded.getMappedPort(7687)}`,
        neo4j.auth.basic('', ''),
      );
      try {
        for (let i = 0; i < 40; i++) {
          try {
            await run(upgradedDriver, 'RETURN 1');
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        expect(
          (
            await run(
              upgradedDriver,
              'MATCH (c:ComponentClass) RETURN count(c) AS n',
            )
          ).records[0]
            .get('n')
            .toNumber(),
        ).toBe(2);
        expect(await indexKey(upgradedDriver, COMPONENT_INDEX)).not.toBe(
          'ComponentClass.embedding',
        );

        // A platform start on the new release: the module is unchanged and skipped, and the pass heals.
        const upgradedResolver = new MatchClassesResolverService(
          upgradedDriver,
          config,
          auth,
          monitoring,
          embedding,
        );
        const log = new ClassIdentityEventLog();
        const reconciler = new ClassReconciler(upgradedDriver, log);
        reconciler.setMageAvailableForTesting(null);
        const upgradedModules = new ModuleManagementService(
          upgradedDriver,
          config,
          embedding,
          upgradedResolver,
          reconciler,
          log,
        );
        for (const target of [
          upgradedModules,
          upgradedResolver,
          reconciler,
          log,
        ]) {
          for (const level of ['log', 'debug', 'warn'])
            jest
              .spyOn((target as any).logger, level)
              .mockImplementation(() => {});
        }
        await upgradedModules.updateAllModules(new Map([['mod-a', mod]]));
        expect(await indexKey(upgradedDriver, COMPONENT_INDEX)).toBe(
          'ComponentClass.embedding',
        );
        expect(
          await heldClassIds(upgradedDriver, 'ComponentClass', COMPONENT_INDEX),
        ).toEqual(['a1', 'a2']);
      } finally {
        await upgradedDriver.close();
        await upgraded.stop();
      }
    });

    it('rebuilds a MITRE index that a snapshot recovery re-keyed, when the MITRE resolver ensures its indexes', async () => {
      const atlasIndex = 'mitre_atlas_technique_embeddings';
      const mitre = () =>
        new MatchMitreTechniquesResolverService(
          mg.driver,
          config,
          auth,
          monitoring,
          embedding,
        );
      await run(
        mg.driver,
        'CREATE VECTOR INDEX decoy_idx ON :Decoy(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
      );
      const writeTechnique = (id: string, v: number[]) =>
        run(
          mg.driver,
          'CREATE (n:MitreAtlasTechnique {atlas_id: $id, name: $id}) SET n.embedding = $v, n.embeddingModel = $model',
          { id, v, model: MODEL },
        );
      await writeTechnique('AML.T0001', near(2, 1));
      const first = mitre();
      jest.spyOn((first as any).logger, 'log').mockImplementation(() => {});
      await first.ensureMitreVectorIndexes();
      expect(await indexKey(mg.driver, atlasIndex)).toBe(
        'MitreAtlasTechnique.embedding',
      );

      const driver = await restartFromSnapshot(mg);
      mg = { ...mg, driver };
      expect(await indexKey(driver, atlasIndex)).not.toBe(
        'MitreAtlasTechnique.embedding',
      );
      // A technique written after the recovery, as a later ingest would.
      await writeTechnique('AML.T0002', near(3, 1));

      const fresh = mitre();
      for (const level of ['log', 'warn'])
        jest.spyOn((fresh as any).logger, level).mockImplementation(() => {});
      await fresh.ensureMitreVectorIndexes();
      expect(await indexKey(driver, atlasIndex)).toBe(
        'MitreAtlasTechnique.embedding',
      );
      const held = await run(
        driver,
        `MATCH (n:MitreAtlasTechnique) CALL vector_search.search('${atlasIndex}', 3, n.embedding) YIELD node
       WITH n, collect(node.atlas_id) AS nearest WHERE n.atlas_id IN nearest RETURN n.atlas_id AS id ORDER BY id`,
      );
      expect(held.records.map((r) => r.get('id'))).toEqual([
        'AML.T0001',
        'AML.T0002',
      ]);
    });

    it('heals a class index re-keyed by a database-only restart at the next search after the availability check expires', async () => {
      await run(
        mg.driver,
        'CREATE VECTOR INDEX decoy_idx ON :Decoy(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
      );
      await modules.updateAllModules(
        new Map([
          [
            'mod-a',
            fileModule('mod-a', 'sha256:a1', [
              { id: 'a1', name: 'Alpha One', vector: near(2, 3) },
            ]),
          ],
        ]),
      );
      expect(
        (await matchComponent('a paraphrase that names no class'))[0],
      ).toMatchObject({ className: 'Alpha One' });

      // Memgraph restarts on its own; the platform's services keep their state and reconnect.
      const driver = await restartFromSnapshot(mg);
      mg = { ...mg, driver };
      (resolver as any).neo4jDriver = driver;
      (modules as any).neo4jDriver = driver;
      expect(await indexKey(driver, COMPONENT_INDEX)).not.toBe(
        'ComponentClass.embedding',
      );

      // A class written after the restart (a re-embed, or any other write path) misses the re-keyed index.
      await run(
        driver,
        `MATCH (m:Module {name: 'mod-a'}) CREATE (c:ComponentClass {id: 'a2', name: 'Alpha Two', description: 'x'}) SET c += $p MERGE (m)-[:HAS_CLASS]->(c)`,
        {
          p: { embedding: near(3, 0.1), embeddingModel: MODEL },
        },
      );
      expect(
        await heldClassIds(driver, 'ComponentClass', COMPONENT_INDEX),
      ).not.toContain('a2');

      // The availability check expires (its TTL elapsing, here moved back), and the next search heals.
      (resolver as any).vectorSearchAvailableCheckedAt = 0;
      const [best] = await matchComponent('a paraphrase that names no class');
      expect(await indexKey(driver, COMPONENT_INDEX)).toBe(
        'ComponentClass.embedding',
      );
      expect(
        await heldClassIds(driver, 'ComponentClass', COMPONENT_INDEX),
      ).toEqual(['a1', 'a2']);
      expect(best).toMatchObject({
        className: 'Alpha Two',
        matchType: 'vector_similarity',
      });
    });

    it('heals a MITRE index re-keyed by a database-only restart at the next search after the precheck expires', async () => {
      const atlasIndex = 'mitre_atlas_technique_embeddings';
      await run(
        mg.driver,
        'CREATE VECTOR INDEX decoy_idx ON :Decoy(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
      );
      const writeTechnique = (driver: Driver, id: string, v: number[]) =>
        run(
          driver,
          'CREATE (n:MitreAtlasTechnique {atlas_id: $id, name: $id, description: $id}) SET n.embedding = $v, n.embeddingModel = $model',
          { id, v, model: MODEL },
        );
      await writeTechnique(mg.driver, 'AML.T0001', near(2, 1));
      const mitre = new MatchMitreTechniquesResolverService(
        mg.driver,
        config,
        auth,
        monitoring,
        embedding,
      );
      for (const level of ['log', 'warn', 'debug'])
        jest.spyOn((mitre as any).logger, level).mockImplementation(() => {});
      const search = () =>
        mitre.getResolvers().Query.matchMitreTechniques(
          null,
          {
            input: {
              queries: [{ query: 'a behaviour described in other words' }],
              kind: 'ATLAS_TECHNIQUE',
              topN: 3,
            },
          },
          {},
        );
      await search();
      expect(await indexKey(mg.driver, atlasIndex)).toBe(
        'MitreAtlasTechnique.embedding',
      );

      const driver = await restartFromSnapshot(mg);
      mg = { ...mg, driver };
      (mitre as any).neo4jDriver = driver;
      expect(await indexKey(driver, atlasIndex)).not.toBe(
        'MitreAtlasTechnique.embedding',
      );
      await writeTechnique(driver, 'AML.T0002', near(3, 1));

      // The precheck expires (its TTL elapsing, here moved back), and the next search heals.
      (mitre as any).vectorPrecheckResult.checkedAt = 0;
      await search();
      expect(await indexKey(driver, atlasIndex)).toBe(
        'MitreAtlasTechnique.embedding',
      );
      const held = await run(
        driver,
        `MATCH (n:MitreAtlasTechnique) CALL vector_search.search('${atlasIndex}', 3, n.embedding) YIELD node
       WITH n, collect(node.atlas_id) AS nearest WHERE n.atlas_id IN nearest RETURN n.atlas_id AS id ORDER BY id`,
      );
      expect(held.records.map((r) => r.get('id'))).toEqual([
        'AML.T0001',
        'AML.T0002',
      ]);
    });
  });
});
