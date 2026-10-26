import * as path from 'path';
import { CheckApocFunctionsService, GRAPHQL_APOC_FUNCTIONS } from '../check-apoc-functions.service';

/**
 * On Neo4j the queries @neo4j/graphql generates call two APOC Core functions; a database without them fails every
 * query that selects a DateTime field. The bootstrap names the missing ones in an error, and no failure of the check
 * rejects the hook (main.ts exits on a rejected hook).
 */

function makeDb(opts: { engine?: 'neo4j' | 'memgraph' | Error; found?: string[]; showFails?: boolean; callFails?: boolean }) {
  return {
    getEngineInfoStrict: jest.fn(async () => {
      if (opts.engine instanceof Error) throw opts.engine;
      return { engine: opts.engine ?? 'neo4j', edition: 'community', version: '5.26.32' };
    }),
    executeRead: jest.fn(async (cypher: string, params?: { names?: readonly string[] }) => {
      if (cypher.startsWith('SHOW FUNCTIONS')) {
        if (opts.showFails) throw new Error('Permission denied');
        const found = (opts.found ?? []).filter((name) => (params?.names ?? []).includes(name));
        return { records: [{ get: () => found }] };
      }
      if (opts.callFails) throw new Error('Unknown function');
      return { records: [] };
    }),
  };
}

function make(db: ReturnType<typeof makeDb>) {
  const service = new CheckApocFunctionsService(db as any);
  const logger = (service as any).logger;
  const error = jest.spyOn(logger, 'error').mockImplementation(() => {});
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  return { service, error, warn };
}

describe('CheckApocFunctionsService', () => {
  it('lists exactly the APOC functions @neo4j/graphql requires (a tripwire for a library upgrade)', () => {
    // The package exports only its index, so the constants file is loaded by path.
    const dist = path.dirname(require.resolve('@neo4j/graphql'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { REQUIRED_APOC_FUNCTIONS } = require(path.join(dist, 'constants.js'));
    expect([...GRAPHQL_APOC_FUNCTIONS].sort()).toEqual([...REQUIRED_APOC_FUNCTIONS].sort());
  });

  it('is quiet on a Neo4j that lists and runs both, and calls them once', async () => {
    const db = makeDb({ found: [...GRAPHQL_APOC_FUNCTIONS] });
    const { service, error, warn } = make(db);
    await service.onApplicationBootstrap();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(db.executeRead).toHaveBeenCalledTimes(2);
    expect(String(db.executeRead.mock.calls[1][0])).toContain('apoc.date.convertFormat(');
    expect(String(db.executeRead.mock.calls[1][0])).toContain('apoc.util.validatePredicate(');
  });

  it('logs one error naming the missing functions on a Neo4j without APOC, and does not reject', async () => {
    const { service, error } = make(makeDb({ found: [] }));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('(apoc.date.convertFormat, apoc.util.validatePredicate)');
  });

  it('names only the function that is missing, and does not try to call them', async () => {
    const db = makeDb({ found: ['apoc.util.validatePredicate'] });
    const { service, error } = make(db);
    await service.onApplicationBootstrap();
    expect(error.mock.calls[0][0]).toContain('(apoc.date.convertFormat)');
    expect(db.executeRead).toHaveBeenCalledTimes(1);
  });

  it('logs an error when both are listed but cannot run', async () => {
    const { service, error } = make(makeDb({ found: [...GRAPHQL_APOC_FUNCTIONS], callFails: true }));
    await service.onApplicationBootstrap();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('cannot run them: Unknown function');
  });

  it('does not ask Memgraph', async () => {
    const db = makeDb({ engine: 'memgraph' });
    const { service, error } = make(db);
    await service.onApplicationBootstrap();
    expect(error).not.toHaveBeenCalled();
    expect(db.executeRead).not.toHaveBeenCalled();
  });

  it.each([
    ['the engine cannot be determined', makeDb({ engine: new Error('db unreachable') })],
    ['the functions cannot be listed', makeDb({ showFails: true })],
  ])('logs a warning, not an error, when %s', async (_label, db) => {
    const { service, error, warn } = make(db);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
