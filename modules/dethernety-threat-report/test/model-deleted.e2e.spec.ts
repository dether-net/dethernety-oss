// onModelDeleted against a real graph: which analyses a model delete takes. The unit spec's fake transaction answers
// whatever is asked, so only a real graph shows that the delete is scoped to this module's analyses.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import DethernetyThreatReportModule from '../src/DethernetyThreatReportModule';

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} } as any;

/**
 * Model m1 owns two threat-report analyses (one of a class this module has since retired) and another module's
 * analysis; model m2 owns a threat-report analysis of its own.
 */
const SEED = `
CREATE (tr:Module {name: 'dethernety-threat-report'})-[:HAS_CLASS]->(tc:AnalysisClass {id: 'tr-class'}),
  (tr)-[:HAS_ORPHANED_CLASS]->(rc:AnalysisClass {id: 'tr-retired'}),
  (other:Module {name: 'test-other'})-[:HAS_CLASS]->(oc:AnalysisClass {id: 'other-class'}),
  (m1:Model {id: 'm1'}), (m2:Model {id: 'm2'}),
  (a1:Analysis {id: 'an-tr', threatReportDoc: '{}'}), (a2:Analysis {id: 'an-retired', threatReportDoc: '{}'}),
  (a3:Analysis {id: 'an-other'}), (a4:Analysis {id: 'an-m2', threatReportDoc: '{}'})
CREATE (m1)-[:ANALYZED_BY]->(a1), (m1)-[:ANALYZED_BY]->(a2), (m1)-[:ANALYZED_BY]->(a3), (m2)-[:ANALYZED_BY]->(a4),
  (a1)-[:IS_INSTANCE_OF]->(tc), (a2)-[:IS_INSTANCE_OF]->(rc), (a3)-[:IS_INSTANCE_OF]->(oc), (a4)-[:IS_INSTANCE_OF]->(tc)
`;

describe('onModelDeleted (Memgraph)', () => {
  let mg: MemgraphHandle;
  let report: DethernetyThreatReportModule;

  const run = async (cypher: string) => {
    const session = mg.driver.session();
    try {
      return await session.run(cypher);
    } finally {
      await session.close();
    }
  };
  const ids = async () =>
    (await run('MATCH (a:Analysis) RETURN a.id AS id ORDER BY id')).records.map((r) => r.get('id'));
  const deleteFor = async (analysisIds: string[]) => {
    const session = mg.driver.session();
    try {
      return await session.executeWrite((tx) => report.onModelDeleted(tx, 'm1', analysisIds));
    } finally {
      await session.close();
    }
  };

  beforeAll(async () => {
    mg = await startMemgraph();
    report = new DethernetyThreatReportModule(mg.driver, quiet);
  });
  afterAll(async () => {
    await mg?.stop();
  });
  beforeEach(async () => {
    await clearGraph(mg.driver);
    await run(SEED);
  });

  it("deletes this module's analyses of the model, a retired class's included, and leaves the rest", async () => {
    // Each deleted analysis had two edges: ANALYZED_BY from the model and IS_INSTANCE_OF to its class.
    expect(await deleteFor(['an-tr', 'an-retired', 'an-other'])).toEqual({ nodesDeleted: 2, relationshipsDeleted: 4 });
    expect(await ids()).toEqual(['an-m2', 'an-other']);
  });

  it('is a no-op when run again, as a retried transaction runs it', async () => {
    await deleteFor(['an-tr', 'an-retired', 'an-other']);
    expect(await deleteFor(['an-tr', 'an-retired', 'an-other'])).toEqual({ nodesDeleted: 0, relationshipsDeleted: 0 });
    expect(await ids()).toEqual(['an-m2', 'an-other']);
  });

  it('counts an analysis named twice once', async () => {
    expect(await deleteFor(['an-tr', 'an-tr'])).toEqual({ nodesDeleted: 1, relationshipsDeleted: 2 });
  });
});
