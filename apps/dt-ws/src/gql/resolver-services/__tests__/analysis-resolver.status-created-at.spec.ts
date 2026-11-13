import { AnalysisResolverService } from '../analysis-resolver.service';

/**
 * Analysis.status's createdAt: a module that reports its own creation time keeps it; one that reports none (the
 * deterministic modules return '') gets the Analysis node's createdAt, which the field `requires`. The dialog that
 * lists analyses used to show the current time for every such row.
 *
 * Pure in-process — no DB, no Nest TestingModule (mirrors analysis-resolver.lifecycle.spec.ts).
 */

function makeService() {
  const analysisCache: any = {
    getConfig: jest.fn().mockReturnValue({
      maxParallelAnalyses: 5,
      cacheEnabled: false,
      pubSubMaxListeners: 10,
      cleanupInterval: 60_000,
    }),
  };
  const configService: any = { get: jest.fn().mockReturnValue(undefined) };
  const neo4jDriver: any = {};
  const authorizationService: any = { extractAuthContext: jest.fn().mockReturnValue({}) };
  const monitoringService: any = { recordOperation: jest.fn() };
  const moduleRegistry: any = { getModuleByName: jest.fn() };

  return new AnalysisResolverService(
    neo4jDriver,
    configService,
    moduleRegistry,
    authorizationService,
    monitoringService,
    analysisCache,
  );
}

const NODE_CREATED_AT = '2026-11-13T09:30:00.000Z';
const analysisClass = [{ id: 'c1', module: [{ name: 'some-module' }] }];

const resolveStatus = (svc: AnalysisResolverService, parent: Record<string, unknown>) =>
  (svc.getResolvers() as any).Analysis.status(parent, {}, {});

function statusOf(svc: AnalysisResolverService, moduleCreatedAt: unknown, parent: Record<string, unknown>) {
  jest.spyOn(svc, 'getAnalysisStatus').mockResolvedValue({
    success: true,
    data: { createdAt: moduleCreatedAt, updatedAt: '2026-11-13T10:00:00Z', status: 'idle', hasDocument: true } as any,
  } as any);
  return resolveStatus(svc, parent);
}

describe('Analysis.status — createdAt', () => {
  it("keeps the module's own createdAt", async () => {
    const svc = makeService();
    const status = await statusOf(svc, '2026-01-02T03:04:05Z', { id: 'a1', analysisClass, createdAt: NODE_CREATED_AT });
    expect(status.createdAt).toBe('2026-01-02T03:04:05Z');
  });

  it.each([[''], [null], [undefined]])("falls back to the node's createdAt when the module reports %p", async (empty) => {
    const svc = makeService();
    const status = await statusOf(svc, empty, { id: 'a1', analysisClass, createdAt: NODE_CREATED_AT });
    expect(status).toEqual({
      createdAt: NODE_CREATED_AT,
      updatedAt: '2026-11-13T10:00:00Z',
      status: 'idle',
      hasDocument: true,
    });
  });

  it("stays '' when neither the module nor the node has one", async () => {
    const svc = makeService();
    const status = await statusOf(svc, '', { id: 'a1', analysisClass, createdAt: null });
    expect(status.createdAt).toBe('');
  });

  it("uses the node's createdAt on the no-module fallback", async () => {
    const svc = makeService();
    const status = await resolveStatus(svc, { id: 'a1', analysisClass: [], createdAt: NODE_CREATED_AT });
    expect(status.status).toBe('error');
    expect(status.createdAt).toBe(NODE_CREATED_AT);
  });
});
