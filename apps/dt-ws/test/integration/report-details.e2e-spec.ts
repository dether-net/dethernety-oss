// Integration coverage for ReportDetailsResolverService on a real graph.
//
// Strategy mirrors delete-model.e2e-spec.ts: the resolver service runs directly against the testcontainer with a
// real driver; the production schema (no-auth variant) runs createAnalysisIdempotent and the generated deletes.
//
// Coverage:
//   - set, read, change and clear; every key, with the custom fields replaced whole; a value an earlier release
//     stored (the client only);
//   - concurrent sets all land, and a stored key this server does not know survives every one of them;
//   - a set that starts while another writer holds the analysis waits for it and reads what it committed (no lost
//     update);
//   - createAnalysisIdempotent called again for the same element leaves the details; for another element it adds a
//     binding the read still answers through, and the next set writes there too;
//   - a binding added by other means (as the generated connect adds one) carries none until the next set;
//   - the suggestion comes from another analysis of the same element;
//   - a set on an analysis bound to no element is refused, and its read is null;
//   - deletion is automatic: after an analysis delete and after a model delete, no binding carrying details remains.
//
// The concurrent and held-lock cases run again on Neo4j in every run (the last suite), since what makes them hold
// differs per engine. The whole suite also runs on Neo4j in the neo4j-leg workflow.
//
// The refusals without a token, unknown input keys and the schema surface are covered without a database in
// src/gql/resolver-services/__tests__/report-details-schema.spec.ts.

import { ConfigService } from '@nestjs/config';
import { graphql, GraphQLSchema } from 'graphql';
import type { Driver } from 'neo4j-driver';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { startNeo4j, Neo4jHandle } from './neo4j-container';
import { describeWithNeo4j, TEST_ENGINE } from './test-engine';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';
import {
  LOCK_ANALYSIS,
  ReportDetailsResolverService,
} from '../../src/gql/resolver-services/report-details-resolver.service';
import { ModelResolverService } from '../../src/gql/resolver-services/model-resolver.service';

jest.setTimeout(120_000);

const configService = {
  get: (key: string) => (key === 'database.name' ? 'memgraph' : key === 'gql' ? { enableNoauth: false } : undefined),
} as unknown as ConfigService;
const authorizationService: any = {
  extractAuthContext: (ctx: any) => ({ user: ctx?.user }),
  checkAuthorization: async () => ({ allowed: true }),
};
const auth = { user: { id: 'u-1', email: 'u@example.com', roles: [], permissions: [] } } as any;

async function cypher(driver: any, query: string, params: Record<string, unknown> = {}): Promise<any[]> {
  const session = driver.session();
  try {
    const result = await session.run(query, params);
    return result.records.map((record: any) => record.toObject());
  } finally {
    await session.close();
  }
}

// The two cases whose meaning differs per engine. On Neo4j a set blocks at the analysis's lock and then reads what was
// committed; on Memgraph it conflicts and the managed transaction retries. They run in the suite below on the engine
// this run selects, and in the last suite on Neo4j in every run.
function lockCases(
  driver: () => Driver,
  service: () => ReportDetailsResolverService,
  bindAnalysis: () => Promise<unknown>,
): void {
  it('lets concurrent sets all land, keeping a stored key this server does not know', async () => {
    await bindAnalysis();
    await cypher(driver(), `MATCH (:Analysis {id: 'an-1'})<-[r:ANALYZED_BY]-() SET r.metadata = $metadata`, {
      metadata: JSON.stringify({ notes: 'From a newer release' }),
    });
    const clients = Array.from({ length: 8 }, (_, i) => `Client ${i}`);
    await Promise.all(clients.map((client) => service().setReportDetails('an-1', { client }, auth)));

    const [{ metadata }] = await cypher(
      driver(),
      `MATCH (:Analysis {id: 'an-1'})<-[r:ANALYZED_BY]-() RETURN r.metadata AS metadata`,
    );
    const stored = JSON.parse(metadata);
    expect(stored.notes).toBe('From a newer release');
    expect(clients).toContain(stored.client);
  });

  it('reads what a writer holding the analysis committed, so its keys are not lost', async () => {
    await bindAnalysis();
    // A writer holds the analysis's lock while the set starts, then writes a key and commits. The set must not finish
    // while the lock is held, and must then read the committed key.
    const session = driver().session();
    const held = session.beginTransaction();
    let settled = false;
    let settledWhileHeld: boolean | undefined;
    try {
      await held.run(LOCK_ANALYSIS, { analysisId: 'an-1' });
      const pending = service()
        .setReportDetails('an-1', { client: 'Example Ltd' }, auth)
        .finally(() => {
          settled = true;
        });
      // Awaited below; this only keeps a rejection while the lock is held from surfacing as an unhandled one.
      pending.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      await held.run(`MATCH (:Analysis {id: 'an-1'})<-[r:ANALYZED_BY]-() SET r.metadata = $metadata`, {
        metadata: JSON.stringify({ notes: 'Written while held', updated: '2026-01-01T00:00:00.000Z' }),
      });
      settledWhileHeld = settled;
      await held.commit();
      await pending;
    } finally {
      await session.close();
    }
    expect(settledWhileHeld).toBe(false);
    const [{ metadata }] = await cypher(
      driver(),
      `MATCH (:Analysis {id: 'an-1'})<-[r:ANALYZED_BY]-() RETURN r.metadata AS metadata`,
    );
    expect(JSON.parse(metadata)).toMatchObject({ notes: 'Written while held', client: 'Example Ltd' });
  });
}

const SEED = `CREATE (m:Model {id: 'm-1', name: 'Model'})
  CREATE (m)-[:CONTAINS]->(b:SecurityBoundary {id: 'b-1', name: 'Boundary'})
  CREATE (:Component {id: 'c-1', name: 'One'})-[:BELONGS_TO]->(b)
  CREATE (:Component {id: 'c-2', name: 'Two'})-[:BELONGS_TO]->(b)`;

describe('report details (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: ReportDetailsResolverService;
  let schema: GraphQLSchema;

  const gql = async (source: string) => {
    const result = await graphql({ schema, source, contextValue: { ...MEMGRAPH_CONTEXT } });
    if (result.errors) throw new Error(result.errors.map(String).join('; '));
    return result.data as any;
  };
  const bindingsWithDetails = async (analysisId: string) =>
    Number(
      (
        await cypher(
          mg.driver,
          'MATCH (:Analysis {id: $analysisId})<-[r:ANALYZED_BY]-() WHERE r.metadata IS NOT NULL RETURN count(r) AS n',
          { analysisId },
        )
      )[0].n,
    );

  const allBindingsWithDetails = async () =>
    Number(
      (await cypher(mg.driver, 'MATCH ()-[r:ANALYZED_BY]->() WHERE r.metadata IS NOT NULL RETURN count(r) AS n'))[0].n,
    );

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new ReportDetailsResolverService(mg.driver, configService, authorizationService);
    schema = await buildProductionSchema('noauth', mg.driver);
  });

  afterAll(async () => {
    await mg?.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    await cypher(mg.driver, `CREATE (:AnalysisClass {id: 'ac-1', name: 'Report'})`);
    await cypher(mg.driver, SEED);
  });

  const createAnalysis = (id: string, elementId: string) =>
    gql(
      `mutation { createAnalysisIdempotent(id: "${id}", name: "Report", elementId: "${elementId}", ` +
        `analysisClassId: "ac-1") { id } }`,
    );

  it('sets, reads, changes and clears the client', async () => {
    await createAnalysis('an-1', 'c-1');
    expect(await svc.reportDetails('an-1', auth)).toEqual({
      client: null,
      author: null,
      project: null,
      customFields: null,
      updated: null,
    });

    const set = await svc.setReportDetails('an-1', { client: 'Example Ltd' }, auth);
    expect(set.client).toBe('Example Ltd');
    expect(await svc.reportDetails('an-1', auth)).toEqual(set);

    expect((await svc.setReportDetails('an-1', { client: 'Other Ltd' }, auth)).client).toBe('Other Ltd');
    const cleared = await svc.setReportDetails('an-1', { client: null }, auth);
    expect(cleared.client).toBeNull();
    expect(cleared.updated).not.toBeNull();
  });

  it('sets and reads every key, and replaces the custom fields whole', async () => {
    await createAnalysis('an-1', 'c-1');
    const customFields = [
      { label: 'Engagement ref', value: 'ES-2026-114' },
      { label: 'Classification', value: 'Confidential' },
    ];
    const set = await svc.setReportDetails(
      'an-1',
      { client: 'Example Ltd', author: 'A. Analyst', project: '2026 cloud review', customFields },
      auth,
    );
    expect(set).toMatchObject({
      client: 'Example Ltd',
      author: 'A. Analyst',
      project: '2026 cloud review',
      customFields,
    });
    expect(await svc.reportDetails('an-1', auth)).toEqual(set);

    const replaced = await svc.setReportDetails('an-1', { customFields: [{ label: 'Owner', value: 'IT' }] }, auth);
    expect(replaced.customFields).toEqual([{ label: 'Owner', value: 'IT' }]);
    expect(replaced.author).toBe('A. Analyst');
    expect((await svc.setReportDetails('an-1', { customFields: [] }, auth)).customFields).toBeNull();
  });

  it('reads and sets a value an earlier release stored, which holds the client only', async () => {
    await createAnalysis('an-1', 'c-1');
    const earlier = { client: 'Example Ltd', updated: '2026-01-01T00:00:00.000Z' };
    await cypher(mg.driver, `MATCH (:Analysis {id: 'an-1'})<-[r:ANALYZED_BY]-() SET r.metadata = $metadata`, {
      metadata: JSON.stringify(earlier),
    });
    expect(await svc.reportDetails('an-1', auth)).toEqual({
      client: 'Example Ltd',
      author: null,
      project: null,
      customFields: null,
      updated: earlier.updated,
    });
    const set = await svc.setReportDetails('an-1', { author: 'A. Analyst' }, auth);
    expect(set).toMatchObject({ client: 'Example Ltd', author: 'A. Analyst' });
  });

  lockCases(
    () => mg.driver,
    () => svc,
    () => createAnalysis('an-1', 'c-1'),
  );

  it('survives createAnalysisIdempotent: untouched for the same element, read through for another', async () => {
    await createAnalysis('an-1', 'c-1');
    const set = await svc.setReportDetails('an-1', { client: 'Example Ltd' }, auth);

    await createAnalysis('an-1', 'c-1');
    expect(await svc.reportDetails('an-1', auth)).toEqual(set);

    await createAnalysis('an-1', 'c-2');
    expect(await bindingsWithDetails('an-1')).toBe(1);
    expect(await svc.reportDetails('an-1', auth)).toEqual(set);

    await svc.setReportDetails('an-1', {}, auth);
    expect(await bindingsWithDetails('an-1')).toBe(2);
  });

  it('reads through a binding added by other means, which carries none until the next set', async () => {
    await createAnalysis('an-1', 'c-1');
    const set = await svc.setReportDetails('an-1', { client: 'Example Ltd' }, auth);
    await cypher(
      mg.driver,
      `MATCH (c:Component {id: 'c-2'}), (a:Analysis {id: 'an-1'}) CREATE (c)-[:ANALYZED_BY]->(a)`,
    );
    expect(await bindingsWithDetails('an-1')).toBe(1);
    expect(await svc.reportDetails('an-1', auth)).toEqual(set);
    await svc.setReportDetails('an-1', {}, auth);
    expect(await bindingsWithDetails('an-1')).toBe(2);
  });

  it('suggests the details of another analysis of the same element', async () => {
    await createAnalysis('an-1', 'c-1');
    await createAnalysis('an-2', 'c-1');
    const customFields = [{ label: 'Ref', value: 'ES-114' }];
    await svc.setReportDetails('an-1', { client: 'Example Ltd', author: 'A. Analyst', customFields }, auth);
    expect(await svc.suggestReportDetails('an-2', auth)).toMatchObject({
      client: 'Example Ltd',
      author: 'A. Analyst',
      customFields,
    });
    expect(await svc.suggestReportDetails('an-1', auth)).toBeNull();
  });

  it('leaves no binding carrying details after an analysis delete', async () => {
    await createAnalysis('an-1', 'c-1');
    await svc.setReportDetails('an-1', { client: 'Example Ltd' }, auth);
    await gql(`mutation { deleteAnalyses(where: { id: { eq: "an-1" } }) { nodesDeleted } }`);
    expect(await allBindingsWithDetails()).toBe(0);
  });

  it('leaves no binding carrying details after a model delete', async () => {
    await createAnalysis('an-1', 'c-1');
    await svc.setReportDetails('an-1', { client: 'Example Ltd' }, auth);
    const noModules = { getAllModules: () => new Map() } as any;
    await new ModelResolverService(mg.driver, configService, noModules, authorizationService).deleteModel('m-1', auth);
    expect(await allBindingsWithDetails()).toBe(0);
  });

  it('refuses a set on an analysis bound to no element', async () => {
    await cypher(mg.driver, `CREATE (:Analysis {id: 'an-loose', name: 'Loose'})`);
    await expect(svc.setReportDetails('an-loose', { client: 'x' }, auth)).rejects.toMatchObject({
      extensions: { code: 'ANALYSIS_NOT_BOUND' },
    });
    expect(await svc.reportDetails('an-loose', auth)).toBeNull();
  });
});

// On the neo4j leg the suite above already runs on Neo4j.
(TEST_ENGINE === 'neo4j' ? describe.skip : describeWithNeo4j)('report details: the lock on Neo4j (e2e)', () => {
  let neo: Neo4jHandle;
  let svc: ReportDetailsResolverService;

  beforeAll(async () => {
    neo = await startNeo4j();
    svc = new ReportDetailsResolverService(neo.driver, configService, authorizationService);
  });

  afterAll(async () => {
    await neo?.stop();
  });

  beforeEach(async () => {
    await clearGraph(neo.driver);
    await cypher(neo.driver, SEED);
  });

  lockCases(
    () => neo.driver,
    () => svc,
    () =>
      cypher(
        neo.driver,
        `MATCH (c:Component {id: 'c-1'}) CREATE (c)-[:ANALYZED_BY]->(:Analysis {id: 'an-1', name: 'Report'})`,
      ),
  );
});
