import { DatabaseService } from '../database.service';

function makeService(failure: Error & { code?: string }) {
  const service = new DatabaseService({
    get: () => ({ uri: 'bolt://test:7687', username: '', password: '' }),
  } as any);
  const session = {
    executeRead: jest.fn(async () => {
      throw failure;
    }),
    executeWrite: jest.fn(async () => {
      throw failure;
    }),
    run: jest.fn(async () => {
      throw failure;
    }),
    close: jest.fn(async () => {}),
  };
  (service as any).getSession = jest.fn(() => session);
  const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  return { service, error };
}

/**
 * A failed query is logged with the database's error code next to its message. The code is what tells the kind of
 * failure apart (a syntax error, a missing database, a lock wait that ended), and the Neo4j test leg's log gate reads it.
 */
describe('DatabaseService failure logs', () => {
  const failure = Object.assign(new Error('Invalid input'), { code: 'Neo.ClientError.Statement.SyntaxError' });

  it.each([
    ['Read query failed', (s: DatabaseService) => s.executeRead('RETURN x')],
    ['Write query failed', (s: DatabaseService) => s.executeWrite('CREATE (x)')],
    ['Implicit write failed', (s: DatabaseService) => s.executeImplicitWrite('CREATE INDEX x')],
  ])('%s carries the error code and the message, and the error still propagates', async (label, call) => {
    const { service, error } = makeService(failure);
    await expect(call(service)).rejects.toBe(failure);
    expect(error).toHaveBeenCalledWith(
      label,
      expect.objectContaining({ code: 'Neo.ClientError.Statement.SyntaxError', error: 'Invalid input' }),
    );
  });
});
