// The hidden-edges module's query end to end against a real test database, on whichever engine the suite runs
// (DT_TEST_ENGINE): a seeded model with a flat-segment finding gives the candidates the matching promises, the
// options reach the matching, refusals come back in the answer, and the model lookup uses an index.
//
// The module's matching is tested in the module itself on read-row fixtures; this spec is what only a database can
// show: the reads, the fold and the matching together, on each engine.

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { TEST_ENGINE } from './test-engine';
import DethernetyHiddenEdgesModule from '../../../../modules/dethernety-hidden-edges/src/DethernetyHiddenEdgesModule';
import { candidateId } from '../../../../modules/dethernety-hidden-edges/src/generate';
import { READS } from '../../../../modules/dethernety-hidden-edges/src/reads';

jest.setTimeout(120_000);

const FLAT = 'Lateral movement on a flat tier';
const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} } as any;

describe('hidden-edges query (e2e)', () => {
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
   * A flat segment (east-west traffic stated unrestricted) holding two services and a database, with an
   * affirmed flat-tier finding on the segment, and the classes held by the open-source module.
   */
  async function seedFlatSegment(): Promise<void> {
    const statements = [
      `CREATE (:Model {id: 'm1', name: 'M'}), (:Module {id: 'mod-general', name: 'dethernety-general', version: '1.0.0'})`,
      `MATCH (mod:Module {name: 'dethernety-general'})
       CREATE (mod)-[:HAS_CLASS]->(:SecurityBoundaryClass {id: 'c-seg', name: 'Network Segment', category: 'Network Architecture'}),
              (mod)-[:HAS_CLASS]->(:ComponentClass {id: 'c-app', name: 'Application Service', category: 'Application'}),
              (mod)-[:HAS_CLASS]->(:ComponentClass {id: 'c-web', name: 'Web Server', category: 'Application'}),
              (mod)-[:HAS_CLASS]->(:ComponentClass {id: 'c-db', name: 'Relational Database', category: 'Data Persistence'}),
              (mod)-[:HAS_CLASS]->(:DataFlowClass {id: 'c-q', name: 'Database Query', category: 'Data Traffic'}),
              (:MitreAttackTechnique {attack_id: 'T1021'})`,
      `MATCH (m:Model {id: 'm1'}), (cs:SecurityBoundaryClass {id: 'c-seg'})
       CREATE (m)-[:CONTAINS]->(seg:SecurityBoundary {id: 'seg', name: 'seg'}),
              (seg)-[:IS_INSTANCE_OF {east_west_within_segment_restricted: false}]->(cs)`,
      `MATCH (seg:SecurityBoundary {id: 'seg'}), (ca:ComponentClass {id: 'c-app'}), (cw:ComponentClass {id: 'c-web'}), (cd:ComponentClass {id: 'c-db'}), (cq:DataFlowClass {id: 'c-q'})
       CREATE (a:Component {id: 'A', name: 'A', type: 'PROCESS'})-[:BELONGS_TO]->(seg),
              (b:Component {id: 'B', name: 'B', type: 'PROCESS'})-[:BELONGS_TO]->(seg),
              (d:Component {id: 'D', name: 'D', type: 'STORE'})-[:BELONGS_TO]->(seg),
              (a)-[:IS_INSTANCE_OF]->(ca), (b)-[:IS_INSTANCE_OF]->(cw), (d)-[:IS_INSTANCE_OF]->(cd),
              (a)-[:FLOWS]->(f:DataFlow {id: 'f1', name: 'f1'})-[:FLOWS]->(d),
              (f)-[:IS_INSTANCE_OF]->(cq)`,
      `MATCH (seg:SecurityBoundary {id: 'seg'}), (cs:SecurityBoundaryClass {id: 'c-seg'}), (t:MitreAttackTechnique {attack_id: 'T1021'})
       CREATE (seg)-[:HAS_EXPOSURE]->(x:Exposure {id: 'x1', name: $flat, createdBy: 'SYSTEM', dispositionKind: 'AFFIRMED', dispositionedBy: 'someone'}),
              (x)-[:EXPLOITED_BY]->(t),
              (x)-[:IS_EXPOSURE_OF]->(cs)`,
    ];
    for (const s of statements) await runWrite(s, { flat: FLAT });
  }

  it('proposes the flat-segment pairs into the services, never into the store', async () => {
    await seedFlatSegment();
    const answer: any = await mod.candidates({ modelId: 'm1' });
    expect(answer.refusal).toBeUndefined();
    expect(answer.regime).toEqual({ kg: 'kg_absent', reason: 'unavailable' });
    const pairs = answer.candidates.map((c: any) => `${c.source}->${c.target}`).sort();
    expect(pairs).toEqual(['A->B', 'B->A', 'D->A', 'D->B']);
    for (const c of answer.candidates) {
      // a zone anchor reaches high only where the reached service has its own exposure: medium here
      expect(c).toMatchObject({ kind: 'remote-service', technique_ids: ['T1021'], exposure_ids: ['x1'], tier: 'medium' });
      expect(c.facts).toContain('attributes:seg#east_west_within_segment_restricted');
      expect(c.id).toBe(candidateId('remote-service', c.source, c.target));
    }
  });

  it('passes the options to the matching: an excluded pair is gone, and counted', async () => {
    await seedFlatSegment();
    const excluded: any = await mod.candidates({ modelId: 'm1', options: JSON.stringify({ excluded: [candidateId('remote-service', 'A', 'B')] }) });
    expect(excluded.candidates.map((c: any) => `${c.source}->${c.target}`).sort()).toEqual(['B->A', 'D->A', 'D->B']);
    expect(excluded.counts.excluded_by_decision).toBe(1);
  });

  it('refuses in the answer: an unknown model, an unknown option', async () => {
    await seedFlatSegment();
    expect(await mod.candidates({ modelId: 'nope' })).toMatchObject({ refusal: { code: 'model_not_found' } });
    expect(await mod.candidates({ modelId: 'm1', options: JSON.stringify({ unknown: 1 }) })).toMatchObject({ refusal: { code: 'options_invalid' } });
  });

  it('finds the model through an index', async () => {
    await seedFlatSegment();
    if (TEST_ENGINE === 'neo4j') {
      await runWrite('CREATE INDEX hidden_edges_model_id IF NOT EXISTS FOR (n:Model) ON (n.id)');
      await runWrite('CALL db.awaitIndexes()');
    } else {
      await runWrite('CREATE INDEX ON :Model(id)');
    }
    const session = mg.driver.session();
    try {
      const result = await session.run(`EXPLAIN ${READS.modelExists}`, { modelId: 'm1' });
      if (TEST_ENGINE === 'neo4j') {
        expect(JSON.stringify(result.summary.plan)).toMatch(/IndexSeek/);
      } else {
        // Memgraph returns the plan under `QUERY PLAN`; its index scan is ScanAllByLabelProperty* (renamed in 3.x)
        expect(result.records[0].keys).toContain('QUERY PLAN');
        const plan = result.records.map((r) => String(r.get('QUERY PLAN'))).join('\n');
        expect(plan).toMatch(/ScanAllByLabelPropert\w*/);
      }
    } finally {
      await session.close();
    }
  });
});
