import { HttpStatus } from '@nestjs/common';
import { AppController } from '../app.controller';

/**
 * Pins for the honest health status codes: orchestrator probes (k8s, ELB,
 * compose healthchecks) act on the HTTP status, not the body — a 200 with
 * {ready:false} kept dead pods in rotation.
 *
 * The 503 is set via response passthrough, NOT ServiceUnavailableException:
 * the global @Catch() exception filter would strip the diagnostic body to a
 * generic error envelope and log every failing probe at ERROR with a stack.
 * The body must survive intact so operators see WHY from the probe response.
 *
 * Readiness deliberately treats a `degraded` GraphQL status as READY: the
 * composition fallback serves the base schema and reports degraded — pulling
 * that pod would turn a partial degradation into a full outage.
 */

function makeController(opts: {
  dbHealthy?: boolean;
  dbThrows?: boolean;
  gqlStatus?: 'healthy' | 'degraded' | 'unhealthy';
}) {
  const databaseService: any = {
    getHealthStatus: jest.fn(async () => {
      if (opts.dbThrows) throw new Error('db probe blew up');
      return { isHealthy: opts.dbHealthy ?? true };
    }),
  };
  const gqlHealthService: any = {
    getHealthStatus: jest.fn(async () => ({
      status: opts.gqlStatus ?? 'healthy',
      errors: opts.gqlStatus === 'healthy' ? undefined : ['something'],
    })),
  };
  const moduleRegistryService: any = {
    getModuleHealth: jest.fn(async () => ({ totalModules: 2, healthyModules: 2 })),
  };
  return new AppController(databaseService, gqlHealthService, moduleRegistryService);
}

function makeRes() {
  return { status: jest.fn() } as any;
}

describe('GET /ready — status codes', () => {
  it('503 with {ready:false} when the database is down', async () => {
    const res = makeRes();
    const body = await makeController({ dbHealthy: false }).getReadiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toMatchObject({ ready: false });
  });

  it('503 when gql health is unhealthy', async () => {
    const res = makeRes();
    await makeController({ gqlStatus: 'unhealthy' }).getReadiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('503 when a probe itself throws (fail-closed)', async () => {
    const res = makeRes();
    const body = await makeController({ dbThrows: true }).getReadiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toMatchObject({ ready: false });
  });

  it('200 {ready:true} when healthy (status untouched)', async () => {
    const res = makeRes();
    const body = await makeController({}).getReadiness(res);
    expect(res.status).not.toHaveBeenCalled();
    expect(body).toMatchObject({ ready: true });
  });

  it('200 {ready:true} when gql is only DEGRADED (base-schema fallback keeps serving)', async () => {
    const res = makeRes();
    const body = await makeController({ gqlStatus: 'degraded' }).getReadiness(res);
    expect(res.status).not.toHaveBeenCalled();
    expect(body).toMatchObject({ ready: true });
  });
});

describe('GET /health — status codes', () => {
  const savedNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it('503 with the full diagnostic body when unhealthy (DB down)', async () => {
    const res = makeRes();
    const body: any = await makeController({ dbHealthy: false }).getHealth(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    // The 503 body still carries WHY — operators diagnose from the probe
    // response (would be stripped if this threw through the global filter).
    expect(body.status).toBe('unhealthy');
    expect(body.services.database.status).toBe('down');
  });

  it('production: 503 with the minimal body when unhealthy (the branch orchestrators hit)', async () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    const body: any = await makeController({ dbHealthy: false }).getHealth(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toEqual({ status: 'unhealthy', timestamp: expect.any(String) });
    expect(body.services).toBeUndefined(); // no internals in prod
  });

  it('200 with status "degraded" when only GraphQL is degraded', async () => {
    const res = makeRes();
    const body = await makeController({ gqlStatus: 'degraded' }).getHealth(res);
    expect(res.status).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: 'degraded' });
  });

  it('200 with status "healthy" when everything is up', async () => {
    const res = makeRes();
    const body = await makeController({}).getHealth(res);
    expect(res.status).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: 'healthy' });
  });
});
