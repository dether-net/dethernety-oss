// The hidden-edges module's reads against a real test database, on whichever engine the suite runs
// (DT_TEST_ENGINE): the module's query runs on a seeded model and its counts must match what was seeded.
//
// The module's pure parts (the fold, the bounds, the Cypher lints) are tested in the module itself; this
// spec is what only a database can show: that every read parses and runs on the engine (each LIMIT is an
// integer literal, which Memgraph requires), that the boundary walk ends on a DAG and on a cycle, that
// attribute maps come back whole (explicit false kept apart from absent, flat keys rebuilt), and that the
// answer carries no attribute value.

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import DethernetyHiddenEdgesModule from '../../../../modules/dethernety-hidden-edges/src/DethernetyHiddenEdgesModule';
import { Deadline } from '../../../../modules/dethernety-hidden-edges/src/bounds';
import { foldModel } from '../../../../modules/dethernety-hidden-edges/src/fold';
import { readModel, Run } from '../../../../modules/dethernety-hidden-edges/src/reads';

jest.setTimeout(120_000);

const SECRET = 'SECRET-CANARY-1c9e';
const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} } as any;

describe('hidden-edges module reads (e2e)', () => {
  let mg: MemgraphHandle;
  let mod: DethernetyHiddenEdgesModule;

  beforeAll(async () => {
    mg = await startMemgraph();
    mod = new DethernetyHiddenEdgesModule(mg.driver, logger);
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  async function runWrite(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
    const session = mg.driver.session();
    try {
      await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  /**
   * A model with a segment holding a host and a container, the container also under the segment (a DAG), a
   * boundary cycle below the host, two components, a flow carrying a credential item, three exposures with
   * ATT&CK techniques, and a control supporting the store.
   */
  async function seed(): Promise<void> {
    const statements = [
      `CREATE (:Model {id: 'm1', name: 'M'})`,
      `CREATE (:SecurityBoundaryClass {id: 'c-seg', name: 'Network Segment', category: 'Network'}),
              (:SecurityBoundaryClass {id: 'c-host', name: 'Operating System Host', category: 'Compute'}),
              (:SecurityBoundaryClass {id: 'c-ctr', name: 'Container', category: 'Compute'}),
              (:ComponentClass {id: 'c-web', name: 'Web Server', category: 'Application'}),
              (:ComponentClass {id: 'c-db', name: 'Relational Database', category: 'Data'}),
              (:DataFlowClass {id: 'c-q', name: 'Database Query', category: 'Data'}),
              (:DataClass {id: 'c-cred', name: 'User Credentials', category: 'Identity'}),
              (:ControlClass {id: 'c-enc', name: 'encryption-at-rest'}),
              (:MitreAttackTechnique {attack_id: 'T1021'}),
              (:MitreAttackTechnique {attack_id: 'T1210'}),
              (:MitreAttackTechnique {attack_id: 'T1611'})`,
      `MATCH (m:Model {id: 'm1'})
       CREATE (m)-[:CONTAINS]->(seg:SecurityBoundary {id: 'seg', name: 'seg'}),
              (host:SecurityBoundary {id: 'host', name: 'host'})-[:BELONGS_TO]->(seg),
              (ctr:SecurityBoundary {id: 'ctr', name: 'ctr'})-[:BELONGS_TO]->(host),
              (ctr)-[:BELONGS_TO]->(seg),
              (a:SecurityBoundary {id: 'loopA', name: 'loopA'})-[:BELONGS_TO]->(host),
              (b:SecurityBoundary {id: 'loopB', name: 'loopB'})-[:BELONGS_TO]->(a),
              (a)-[:BELONGS_TO]->(b)`,
      `MATCH (seg:SecurityBoundary {id: 'seg'}), (host:SecurityBoundary {id: 'host'}), (ctr:SecurityBoundary {id: 'ctr'}),
             (cs:SecurityBoundaryClass {id: 'c-seg'}), (ch:SecurityBoundaryClass {id: 'c-host'}), (cc:SecurityBoundaryClass {id: 'c-ctr'})
       CREATE (seg)-[:IS_INSTANCE_OF {east_west_within_segment_restricted: false}]->(cs),
              (host)-[:IS_INSTANCE_OF]->(ch),
              (ctr)-[:IS_INSTANCE_OF {container_privileged_mode_disabled: true}]->(cc)`,
      `MATCH (ctr:SecurityBoundary {id: 'ctr'}), (host:SecurityBoundary {id: 'host'}), (cw:ComponentClass {id: 'c-web'}), (cd:ComponentClass {id: 'c-db'})
       CREATE (web:Component {id: 'web', name: 'web', type: 'PROCESS'})-[:BELONGS_TO]->(ctr),
              (db:Component {id: 'db', name: 'db', type: 'STORE', crownJewel: true})-[:BELONGS_TO]->(host),
              (web)-[:IS_INSTANCE_OF {\`tls.enabled\`: true, api_key_hint: $secret}]->(cw),
              (db)-[:IS_INSTANCE_OF]->(cd)`,
      `MATCH (m:Model {id: 'm1'}), (web:Component {id: 'web'}), (db:Component {id: 'db'}), (cq:DataFlowClass {id: 'c-q'}), (ck:DataClass {id: 'c-cred'})
       CREATE (web)-[:FLOWS]->(f:DataFlow {id: 'f1', name: 'f1'})-[:FLOWS]->(db),
              (f)-[:IS_INSTANCE_OF]->(cq),
              (m)-[:CONTAINS]->(d:Data {id: 'cred', name: 'cred', isCredential: true}),
              (d)-[:IS_INSTANCE_OF]->(ck),
              (f)-[:HANDLES]->(d)`,
      `MATCH (seg:SecurityBoundary {id: 'seg'}), (web:Component {id: 'web'}), (ctr:SecurityBoundary {id: 'ctr'}),
             (t1:MitreAttackTechnique {attack_id: 'T1021'}), (t2:MitreAttackTechnique {attack_id: 'T1210'}), (t3:MitreAttackTechnique {attack_id: 'T1611'})
       CREATE (seg)-[:HAS_EXPOSURE]->(x1:Exposure {id: 'x1', name: 'x1', createdBy: 'SYSTEM'})-[:EXPLOITED_BY]->(t1),
              (web)-[:HAS_EXPOSURE]->(x2:Exposure {id: 'x2', name: 'x2', createdBy: 'SYSTEM', dispositionKind: 'AFFIRMED', dispositionedBy: 'someone'})-[:EXPLOITED_BY]->(t2),
              (ctr)-[:HAS_EXPOSURE]->(x3:Exposure {id: 'x3', name: 'x3', createdBy: 'SYSTEM'})-[:EXPLOITED_BY]->(t3)`,
      `MATCH (db:Component {id: 'db'}), (ce:ControlClass {id: 'c-enc'})
       CREATE (k:Control {id: 'k1', name: 'k1'})-[:SUPPORTS]->(db), (k)-[:IS_INSTANCE_OF]->(ce)`,
    ];
    for (const s of statements) await runWrite(s, { secret: SECRET });
  }

  it('reads a seeded model on this engine and counts what was seeded', async () => {
    await seed();
    const answer: any = await mod.candidates({ modelId: 'm1' });
    expect(answer.refusal).toBeUndefined();
    expect(answer.contract).toBe(1);
    expect(answer.counts).toMatchObject({
      boundaries: 5,
      components: 2,
      flows: 1,
      dataItems: 1,
      exposures: 3,
      controls: 1,
      // ctr under host and seg; loopA under host and loopB
      boundariesWithSeveralParents: 2,
      boundaryDepthCut: false,
      danglingReferences: 0,
    });
    // the two loop boundaries have no class; nothing else is unclassified
    expect(answer.counts.elementsWithoutClass).toBe(2);
  });

  it('reads attribute maps whole, keeping an explicit false apart from an absent key', async () => {
    await seed();
    const session = mg.driver.session({ defaultAccessMode: 'READ' });
    try {
      const rows = await session.executeRead((tx) => {
        const run: Run = async (cypher, params) => (await tx.run(cypher, params)).records.map((r) => r.toObject());
        return readModel(run, 'm1', new Deadline());
      });
      const model = foldModel(rows!);
      expect(model.boundaries.get('seg')?.attributes).toEqual({ east_west_within_segment_restricted: false });
      expect(model.boundaries.get('host')?.attributes).toEqual({});
      expect(model.boundaries.get('ctr')?.attributes).toEqual({ container_privileged_mode_disabled: true });
      expect(model.components.get('web')?.attributes).toMatchObject({ tls: { enabled: true } });
      expect(model.counts.attributeKeysDropped).toBe(0);
      expect(model.dataItems.get('cred')?.isCredential).toBe(true);
      expect(model.exposures.get('x2')).toMatchObject({ elementKind: 'component', lifecycle: 'confirmed', techniques: ['T1210'] });
      expect(model.controls.get('k1')).toEqual({ id: 'k1', classNames: ['encryption-at-rest'], attributesByClass: { 'encryption-at-rest': {} }, supports: ['db'] });
    } finally {
      await session.close();
    }
  });

  it('answers model_not_found for an unknown model', async () => {
    await seed();
    expect(await mod.candidates({ modelId: 'nope' })).toMatchObject({ refusal: { code: 'model_not_found' } });
  });

  it('carries no attribute value in its answer', async () => {
    await seed();
    expect(JSON.stringify(await mod.candidates({ modelId: 'm1' }))).not.toContain(SECRET);
  });

  it('reads a model with no boundaries as empty, not as an error', async () => {
    await runWrite(`CREATE (:Model {id: 'bare', name: 'bare'})`);
    const answer: any = await mod.candidates({ modelId: 'bare' });
    expect(answer.counts).toMatchObject({ boundaries: 0, components: 0, flows: 0, exposures: 0 });
  });
});
