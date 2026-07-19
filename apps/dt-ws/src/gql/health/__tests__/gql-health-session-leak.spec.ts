import { GqlHealthService } from '../gql-health.service';

/**
 * Pin the session lifecycle of the periodic Neo4j probe: `close()` must run
 * in a `finally` — before this fix a throwing `run()` skipped the close and
 * leaked one pooled session per failing probe, exhausting the pool exactly
 * while the DB was already struggling.
 */
describe('GqlHealthService — probe session lifecycle', () => {
  function makeService(runImpl: () => Promise<any>) {
    const close = jest.fn(async () => {});
    const driver: any = { session: () => ({ run: jest.fn(runImpl), close }) };
    const schemaService: any = {
      validateSchema: async () => true,
      isSchemaDegraded: () => false,
    };
    return { service: new GqlHealthService(schemaService, driver), close };
  }

  it('closes the session when the probe query throws, and reports unhealthy', async () => {
    const { service, close } = makeService(async () => {
      throw new Error('connection reset');
    });

    const health = await service.getHealthStatus();

    expect(close).toHaveBeenCalledTimes(1); // the leak regression
    expect(health.status).toBe('unhealthy');
    expect(health.details.neo4j).toBe('disconnected');
  });

  it('closes the session on the happy path too', async () => {
    const { service, close } = makeService(async () => ({ records: [{}] }));

    const health = await service.getHealthStatus();

    expect(close).toHaveBeenCalledTimes(1);
    expect(health.status).toBe('healthy');
  });
});
