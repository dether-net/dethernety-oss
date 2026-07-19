import { neo4jDriverFactory } from '../database.module';

/**
 * Delegation pin for the single-driver consolidation: the 'NEO4J_DRIVER'
 * token must resolve to DatabaseService's OWN driver (awaiting
 * initialization first) — the one pool that is health-checked and closed
 * on shutdown. This is the only seam where the "same instance" invariant
 * can break.
 */
describe('neo4jDriverFactory', () => {
  it('awaits ensureInitialized, then returns the service driver instance', async () => {
    const sentinel = { __driver: true };
    const calls: string[] = [];
    const fakeDb: any = {
      ensureInitialized: jest.fn(async () => {
        // Async gap BEFORE recording: a factory that drops the `await`
        // reaches getDriver first and fails the order assert cleanly.
        await Promise.resolve();
        calls.push('init');
      }),
      getDriver: jest.fn(() => {
        calls.push('get');
        return sentinel;
      }),
    };

    const driver = await neo4jDriverFactory(fakeDb);

    expect(driver).toBe(sentinel); // exact same instance, no copy/new pool
    expect(calls).toEqual(['init', 'get']); // init strictly before getDriver
  });

  it('propagates initialization failure (boot fails fast, no half-wired driver)', async () => {
    const fakeDb: any = {
      ensureInitialized: jest.fn(async () => {
        throw new Error('db unreachable');
      }),
      getDriver: jest.fn(),
    };

    await expect(neo4jDriverFactory(fakeDb)).rejects.toThrow('db unreachable');
    expect(fakeDb.getDriver).not.toHaveBeenCalled();
  });
});
