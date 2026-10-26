import { Neo4jError } from 'neo4j-driver';
import { DatabaseService, SCHEMA_WRITE_ATTEMPTS, SCHEMA_WRITE_RETRY_DELAY_MS, isTransientError } from '../database.service';

const neo4jError = (message: string, code: string) => new Neo4jError(message, code, '50N00', message);
const deadlock = () => neo4jError('ForsetiClient can not acquire UpdateLock', 'Neo.TransientError.Transaction.DeadlockDetected');
const memgraphConflict = () => neo4jError('Cannot resolve conflicting transactions', 'Memgraph.TransientError.MemgraphError.MemgraphError');
const unavailable = () => neo4jError('Could not perform discovery', 'ServiceUnavailable');
const syntaxError = () => neo4jError('Invalid input', 'Neo.ClientError.Statement.SyntaxError');

/** A service whose sessions answer `outcomes` in turn: an Error is thrown, anything else is the result. */
function makeService(outcomes: unknown[]) {
  const service = new DatabaseService({
    get: () => ({ uri: 'bolt://test:7687', username: '', password: '' }),
  } as any);
  const run = jest.fn(async () => {
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const close = jest.fn(async () => {});
  const getSession = jest.fn(() => ({ run, close }));
  (service as any).getSession = getSession;
  const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  return { service, run, close, getSession, error, warn };
}

/** Runs `call` to its end, firing the retry pauses as they come. */
async function settle<T>(call: Promise<T>): Promise<T> {
  const outcome = call.then(
    (value) => ({ value }),
    (reason) => ({ reason }),
  );
  await jest.runAllTimersAsync();
  const done = await outcome;
  if ('reason' in done) throw done.reason;
  return done.value;
}

/**
 * The bootstrap's schema statements run through executeSchemaWrite. On Neo4j two of them on one label can deadlock, and
 * the engine fails one; a transient error runs the statement again, in a new session, up to SCHEMA_WRITE_ATTEMPTS
 * times, and only the last failure is logged as an error.
 */
describe('DatabaseService.executeSchemaWrite', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs a statement that met a Neo4j deadlock again, in a new session, and logs the retry, not an error', async () => {
    const result = { records: [] };
    const { service, run, close, getSession, error, warn } = makeService([deadlock(), result]);

    await expect(settle(service.executeSchemaWrite('CREATE INDEX x IF NOT EXISTS FOR (n:Module) ON (n.id)'))).resolves.toBe(result);

    expect(run).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Schema write met a transient error; running it again',
      expect.objectContaining({ code: 'Neo.TransientError.Transaction.DeadlockDetected', attempt: 1 }),
    );
  });

  it('runs a statement that met a Memgraph conflict again', async () => {
    const result = { records: [] };
    const { service, run } = makeService([memgraphConflict(), result]);

    await expect(settle(service.executeSchemaWrite('CREATE INDEX ON :Module(id)'))).resolves.toBe(result);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('pauses longer before each retry', async () => {
    const { service, run } = makeService([deadlock(), deadlock(), { records: [] }]);

    const call = service.executeSchemaWrite('CREATE INDEX x');
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(SCHEMA_WRITE_RETRY_DELAY_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2 * SCHEMA_WRITE_RETRY_DELAY_MS - 1);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await call;
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('stops after the last attempt, logs that failure once as an error, and throws it', async () => {
    const failures = Array.from({ length: SCHEMA_WRITE_ATTEMPTS }, deadlock);
    const last = failures[failures.length - 1];
    const { service, run, close, error, warn } = makeService([...failures]);

    await expect(settle(service.executeSchemaWrite('CREATE INDEX x'))).rejects.toBe(last);

    expect(run).toHaveBeenCalledTimes(SCHEMA_WRITE_ATTEMPTS);
    expect(close).toHaveBeenCalledTimes(SCHEMA_WRITE_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(SCHEMA_WRITE_ATTEMPTS - 1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Implicit write failed',
      expect.objectContaining({ code: 'Neo.TransientError.Transaction.DeadlockDetected' }),
    );
  });

  it.each([
    ['an error that is not transient', syntaxError],
    ['a database that cannot be reached', unavailable],
  ])('does not run a statement again after %s', async (_label, make) => {
    const failure = make();
    const { service, run, warn, error } = makeService([failure]);

    await expect(settle(service.executeSchemaWrite('CREATE INDEX x'))).rejects.toBe(failure);

    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('DatabaseService.executeImplicitWrite', () => {
  it('runs a statement once, even after a transient error', async () => {
    const failure = deadlock();
    const { service, run, error } = makeService([failure, { records: [] }]);

    await expect(service.executeImplicitWrite('CREATE INDEX x')).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('isTransientError', () => {
  it('holds for the engines\' transient codes, not for a lost connection or other failures', () => {
    expect(isTransientError(deadlock())).toBe(true);
    expect(isTransientError(memgraphConflict())).toBe(true);
    expect(isTransientError(unavailable())).toBe(false);
    expect(isTransientError(syntaxError())).toBe(false);
    expect(isTransientError(new Error('no code'))).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});
