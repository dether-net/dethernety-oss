import { Logger } from '@nestjs/common';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { GraphQLScalarType, graphql } from 'graphql';
import { DtLgModule, LgAnalysisConfig } from '@dethernety/dt-module';
import { AnalysisResolverService } from '../analysis-resolver.service';

/**
 * A document read cannot address the store outside the scope of the call.
 *
 * ASSERTED THROUGH GRAPHQL, and that is the point rather than ceremony. The filter is an unvalidated
 * `JSON!` that the resolver passes through untouched, so a test of the helper alone would prove a layer
 * below the one an attacker actually enters. A real query document is executed against a schema carrying
 * the real resolver, with the filter sent as a VARIABLE so the scalar's passthrough is asserted too.
 *
 * Behind the resolver everything is the production code: the real AnalysisResolverService, a real
 * DtLgModule in the registry, a real DtLgDocumentOps. Two fakes, both deliberate — the LangGraph client
 * (there is no live store to mount in any harness here; the SDK is stubbed out of this project's jest
 * because it pulls pure-ESM dependencies), and the driver, whose read returns the metadata row so the
 * scope is still derived from the query's `elementId` column rather than handed in by the test.
 */

const mockGetItem = jest.fn();

jest.mock('@langchain/langgraph-sdk', () => ({
  Client: jest.fn().mockImplementation(() => ({
    assistants: { search: async () => [] },
    runs: {},
    threads: {},
    store: { getItem: (...args: any[]) => mockGetItem(...args) },
  })),
}));

const GRAPH = 'Scope Test Graph';
const MODULE = 'scope-test-module';
const CLASS_ID = 'analysis-class-1';
const ANALYSIS_ID = 'analysis-1';
const SCOPE = 'model-mine';
const OTHER_SCOPE = 'model-theirs';

const analysisConfig: LgAnalysisConfig = {
  graphs: {
    [GRAPH]: {
      description: 'scope test',
      type: 'model_analysis',
      category: 'scope_test',
      // The convention every module follows: category, scope, analysis.
      index_document: async (scope: string, analysisId?: string) => ({
        namespace: ['scope_test', scope, analysisId || GRAPH],
        key: 'index',
      }),
      input: async () => ({}),
    },
  },
};

class TestLgModule extends DtLgModule {
  constructor() {
    super(MODULE, {} as any, new Logger('scope-test'), {
      analysisConfig,
      metadata: { description: 'd', version: '1', author: 'a' },
    });
    // Normally filled from the LangGraph server at boot; the class id is what getDocument dispatches on.
    (this as any).assistants.push({ id: CLASS_ID, name: GRAPH });
  }
}

const record = (row: Record<string, any>) => ({ get: (k: string) => row[k] });

function makeBed() {
  const driver = {
    session: () => ({
      executeRead: async (work: any) =>
        work({
          run: async () => ({
            records: [
              record({ analysisClassId: CLASS_ID, moduleName: MODULE, elementId: SCOPE }),
            ],
          }),
        }),
      close: async () => undefined,
    }),
  };

  const service = new AnalysisResolverService(
    driver as any,
    { get: () => ({}) } as any,
    { getModuleByName: () => new TestLgModule() } as any,
    { extractAuthContext: (ctx: any) => ctx } as any,
    { recordOperation: () => undefined } as any,
    {
      getConfig: () => ({ pubSubMaxListeners: 10 }),
      getAnalysisMetadata: () => null,
      setAnalysisMetadata: () => undefined,
    } as any,
  );

  const passthroughJson = new GraphQLScalarType({
    name: 'JSON',
    serialize: (value) => value,
    parseValue: (value) => value,
  });

  const schema = makeExecutableSchema({
    typeDefs: `
      scalar JSON
      type Query {
        getDocument(analysisId: String!, filter: JSON!): JSON!
      }
    `,
    resolvers: {
      JSON: passthroughJson,
      Query: { getDocument: service.getResolvers().Query.getDocument },
    },
  });

  const read = async (filter: unknown): Promise<any> => {
    const result = await graphql({
      schema,
      source: 'query D($id: String!, $f: JSON!) { getDocument(analysisId: $id, filter: $f) }',
      variableValues: { id: ANALYSIS_ID, f: filter },
      contextValue: { user: { sub: 'tester' } },
    });
    expect(result.errors).toBeUndefined();
    return (result.data as any).getDocument;
  };

  return { read };
}

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockResolvedValue({ value: { document: 'contents' } });
});

describe('getDocument — the filter may not address outside the call scope', () => {
  it('refuses a namespace belonging to another scope, without touching the store', async () => {
    const { read } = makeBed();

    const document = await read({
      namespace: ['scope_test', OTHER_SCOPE, 'analysis-2'],
      key: 'index',
    });

    expect(document).toEqual({ error: 'Namespace is outside the scope of this analysis' });
    // The refusal has to happen before the read, not after it.
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('reads a namespace naming its own scope — the control', async () => {
    const { read } = makeBed();

    const document = await read({
      namespace: ['scope_test', SCOPE, ANALYSIS_ID],
      key: 'index',
    });

    expect(document).toEqual({ document: 'contents' });
    expect(mockGetItem).toHaveBeenCalledWith(['scope_test', SCOPE, ANALYSIS_ID], 'index');
  });

  it('leaves the index filter alone — it addresses nothing the caller chose', async () => {
    const { read } = makeBed();

    const document = await read({ document: 'index' });

    expect(document).toEqual({ document: 'contents' });
    expect(mockGetItem).toHaveBeenCalledWith(['scope_test', SCOPE, ANALYSIS_ID], 'index');
  });

  it('refuses a namespace sent as a string, which would otherwise match by substring', async () => {
    const { read } = makeBed();

    // `'model-mine'.includes('model-mine')` is true. Without the type guard this filter passes the scope
    // check and reaches the store with a namespace the SDK never expected.
    const document = await read({ namespace: SCOPE, key: 'index' });

    expect(document).toEqual({ error: 'Namespace must be an array of strings' });
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('allows the scope in any position — the documented limit of the check', async () => {
    const { read } = makeBed();

    // Membership, not position: this is permitted, and nothing is stored there because writers only
    // ever use the convention. Pinned so that tightening the check is a deliberate act, not a surprise.
    const document = await read({
      namespace: ['scope_test', OTHER_SCOPE, SCOPE],
      key: 'index',
    });

    expect(document).toEqual({ document: 'contents' });
    expect(mockGetItem).toHaveBeenCalledWith(['scope_test', OTHER_SCOPE, SCOPE], 'index');
  });
});
