import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { GraphQLObjectType, GraphQLSchema, getNamedType, graphql } from 'graphql';
import { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } from '../../populated-by/authored-by';
import { AuthorizationService } from '../../services/authorization.service';
import { ReportDetailsResolverService } from '../report-details-resolver.service';

/**
 * The report-details fields on the production schema with OIDC configured, served by the real resolvers, and no
 * database: the library's version probe is answered by a stand-in transaction, and the resolvers' own driver records
 * whether a session was opened.
 */

const SDL = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'schema', 'schema.graphql'), 'utf8');
const JWKS = 'https://jwks.invalid/.well-known/jwks.json';
const versionProbe = { run: async () => ({ records: [['5.20.0', 'enterprise']] }) };

let schema: GraphQLSchema;
const driver = { session: jest.fn() };

beforeAll(async () => {
  const configService: any = { get: (key: string) => (key === 'gql' ? { oidcJwksUri: JWKS } : 'memgraph') };
  const loggers = [jest.spyOn(Logger.prototype, 'log'), jest.spyOn(Logger.prototype, 'warn')];
  loggers.forEach((spy) => spy.mockImplementation(() => undefined));
  const service = new ReportDetailsResolverService(driver, configService, new AuthorizationService(configService));
  const warn = console.warn;
  console.warn = () => undefined; // "Custom resolver … has not been provided": only these three are needed
  try {
    schema = await new Neo4jGraphQL({
      typeDefs: SDL,
      features: {
        authorization: { key: { url: JWKS } },
        populatedBy: { callbacks: { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } },
      },
      resolvers: service.getResolvers(),
    }).getSchema();
  } finally {
    console.warn = warn;
  }
});

afterAll(() => jest.restoreAllMocks());

const run = (source: string) =>
  graphql({
    schema,
    source,
    contextValue: { executionContext: versionProbe, cypherQueryOptions: { addVersionPrefix: false } },
  });

describe('report details on the authenticated schema', () => {
  it.each([
    ['reportDetails', '{ reportDetails(analysisId: "an-1") { client updated } }'],
    ['suggestReportDetails', '{ suggestReportDetails(analysisId: "an-1") { client } }'],
    ['setReportDetails', 'mutation { setReportDetails(analysisId: "an-1", details: { client: "x" }) { client } }'],
  ])('%s refuses a request without a token, and reaches no database', async (_field, source) => {
    const result = await run(source);
    expect(result.errors?.map(String).join()).toMatch(/Unauthenticated|Authentication required/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('refuses an input key the server does not know, in validation', async () => {
    const result = await run(
      'mutation { setReportDetails(analysisId: "an-1", details: { client: "x", project: "y" }) { client } }',
    );
    expect(result.errors?.map(String).join()).toMatch(/"project" is not defined by type "ReportDetailsInput"/);
  });

  it('has no updated in the input: only the server stamps it', async () => {
    const result = await run(
      'mutation { setReportDetails(analysisId: "an-1", details: { updated: "2026-01-01T00:00:00Z" }) { client } }',
    );
    expect(result.errors?.map(String).join()).toMatch(/"updated" is not defined by type "ReportDetailsInput"/);
  });

  it('exposes no property of an ANALYZED_BY edge: the generated connections carry none', () => {
    const edges = Object.values(schema.getTypeMap()).filter(
      (type): type is GraphQLObjectType =>
        type instanceof GraphQLObjectType &&
        'cursor' in type.getFields() &&
        'node' in type.getFields() &&
        (getNamedType(type.getFields().node.type).name === 'Analysis' || type.name.startsWith('Analysis')),
    );
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) expect(Object.keys(edge.getFields()).sort()).toEqual(['cursor', 'node']);
  });
});
