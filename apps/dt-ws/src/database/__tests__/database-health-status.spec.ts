import { DatabaseService } from '../database.service';

/**
 * Pin: getHealthStatus() keys on LIVE connectivity only, never the cached
 * background-tick flag. The periodic health check runs every ~60s, so after
 * a brief DB blip the cached `metrics.isHealthy` stays stale-false for up
 * to a full interval past recovery — with /ready acting on this value
 * (503), ANDing the stale flag would hold every replica out of rotation
 * long after the DB is back.
 */

function makeService(runImpl: () => Promise<any>) {
  const service = new DatabaseService({
    get: () => ({ uri: 'bolt://test:7687', username: '', password: '' }),
  } as any);
  (service as any).getSession = () => ({ run: jest.fn(runImpl), close: async () => {} });
  return service;
}

describe('DatabaseService.getHealthStatus — live connectivity', () => {
  it('reports healthy when the live probe succeeds despite a stale-false cached flag', async () => {
    const service = makeService(async () => ({ records: [{}] }));
    (service as any).metrics.isHealthy = false; // stale background tick

    const health = await service.getHealthStatus();

    expect(health.connectivity).toBe(true);
    expect(health.isHealthy).toBe(true); // live probe wins — no 60s unready tail
  });

  it('reports unhealthy when the live probe fails, whatever the cache says', async () => {
    const service = makeService(async () => {
      throw new Error('connection refused');
    });
    (service as any).metrics.isHealthy = true;

    const health = await service.getHealthStatus();

    expect(health.connectivity).toBe(false);
    expect(health.isHealthy).toBe(false);
  });
});
