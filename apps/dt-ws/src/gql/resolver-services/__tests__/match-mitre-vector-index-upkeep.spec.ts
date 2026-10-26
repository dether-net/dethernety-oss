import { MatchMitreTechniquesResolverService } from '../match-mitre-techniques-resolver.service';

/**
 * The MITRE vector-index upkeep per engine: on Memgraph it asks the database for its vector
 * indexes; on any other engine it touches nothing and says so once, at info, however often it is
 * asked.
 */

function makeService(dialect: 'memgraph' | 'neo4j') {
  const run = jest.fn(async (_cypher: string) => ({ records: [] }));
  const executeRead = jest.fn(async (work: (tx: { run: typeof run }) => unknown) => work({ run }));
  const session = jest.fn(() => ({ executeRead, run, close: jest.fn(async () => {}) }));
  const vectorSearch = {
    dialect: jest.fn(async () => dialect),
    read: jest.fn(async () => []),
  };
  const config = { get: () => undefined };
  const embedding = { getDimensions: () => 8, getModel: () => 'm' };
  const svc = new MatchMitreTechniquesResolverService(
    { session } as any,
    config as any,
    {} as any,
    {} as any,
    embedding as any,
    vectorSearch as any,
  );
  const logger = (svc as any).logger;
  for (const level of ['log', 'warn', 'debug'] as const) jest.spyOn(logger, level).mockImplementation(() => {});
  return { svc, session, executeRead, run, logger };
}

describe('MITRE vector-index upkeep per engine', () => {
  it('on Neo4j skips without opening a session, with one info log however often it is asked', async () => {
    const { svc, session, logger } = makeService('neo4j');
    await svc.ensureMitreVectorIndexes();
    (svc as any).vectorIndexesEnsured = false; // as a precheck refresh does
    await svc.ensureMitreVectorIndexes();
    expect(session).not.toHaveBeenCalled();
    const skips = logger.log.mock.calls.filter(([m]: [string]) => m.includes('upkeep skipped'));
    expect(skips).toEqual([['MITRE vector index upkeep skipped: it applies to Memgraph only, the database is neo4j']]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('on Memgraph opens a session and reads the vector indexes', async () => {
    const { svc, session, executeRead, run, logger } = makeService('memgraph');
    (svc as any).vectorPrecheckResult = { reason: null, checkedAt: Date.now() };
    await svc.ensureMitreVectorIndexes();
    expect(session).toHaveBeenCalled();
    expect(executeRead).toHaveBeenCalled();
    expect(run.mock.calls.some(([q]) => q.includes('vector_search.show_index_info() YIELD index_name, dimension'))).toBe(true);
    expect(logger.log.mock.calls.some(([m]: [string]) => m.includes('upkeep skipped'))).toBe(false);
  });
});
