// The report's client name never reaches getDocument. It is stored on the analysis's ANALYZED_BY binding (as the
// platform's report details), and agents read the getDocument payload, so a report generated after it was set must
// carry it nowhere in the snapshot the module stores and returns. The model's name, which the export does need, is
// carried, and is outside the fingerprint: renaming the model leaves the report fresh.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import DethernetyThreatReportModule from '../src/DethernetyThreatReportModule';

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} } as any;

const CLIENT = 'Client-Marker-7f3a';

const SEED = `
CREATE (m:Model {id: 'm1', name: 'Shop'})-[:CONTAINS]->(b:SecurityBoundary {id: 'b1', name: 'Default'}),
  (c:Component {id: 'c1', name: 'Web', type: 'PROCESS'})-[:BELONGS_TO]->(b),
  (a:Analysis {id: 'an-1', name: 'Threat report'})
CREATE (m)-[:ANALYZED_BY]->(a)
`;

describe('report details stay out of getDocument (Memgraph)', () => {
  let mg: MemgraphHandle;
  let report: DethernetyThreatReportModule;

  const run = async (cypher: string, params: Record<string, unknown> = {}) => {
    const session = mg.driver.session();
    try {
      return await session.run(cypher, params);
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
    // As the platform stores report details: one JSON string on every binding of the analysis.
    await run(`MATCH (:Analysis {id: 'an-1'})<-[r:ANALYZED_BY]-() SET r.metadata = $metadata`, {
      metadata: JSON.stringify({ client: CLIENT, updated: '2026-11-20T10:15:00.000Z' }),
    });
  });

  it('carries the client nowhere in the snapshot or the getDocument payload, and the model name in both', async () => {
    await report.runAnalysis('an-1', 'tr-class', 'm1', {} as never);

    const stored = (await run(`MATCH (a:Analysis {id: 'an-1'}) RETURN a.threatReportDoc AS doc`)).records[0].get('doc');
    expect(stored).not.toContain(CLIENT);
    expect(JSON.parse(stored).modelName).toBe('Shop');

    for (const filter of [{ document: 'index' }, {}]) {
      const payload = JSON.stringify(await report.getDocument('m1', 'an-1', 'tr-class', filter));
      expect(payload).not.toContain(CLIENT);
      expect(payload).toContain('"modelName":"Shop"');
    }
  });

  it('keeps the report fresh when the model is renamed', async () => {
    await report.runAnalysis('an-1', 'tr-class', 'm1', {} as never);
    const stored = JSON.parse(
      (await run(`MATCH (a:Analysis {id: 'an-1'}) RETURN a.threatReportDoc AS doc`)).records[0].get('doc'),
    );
    await run(`MATCH (m:Model {id: 'm1'}) SET m.name = 'Shop renamed'`);
    const { fingerprint } = await (report as any).computeStructure('m1');
    expect(fingerprint).toBe(stored.fingerprint);
  });
});
