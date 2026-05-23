import { AnalysisResolverService } from '../analysis-resolver.service';

/**
 * Unit pins for the `deleteAnalysis` ordering + failure contract that prevents
 * orphaned analysis subtrees. Asserts:
 *   - module cleanup runs BEFORE the node delete (so a module that owns an
 *     atomic subtree+node cascade commits/rolls back before we touch the node)
 *   - a module THROW aborts: the node is NOT deleted and the op fails (a
 *     failed cascade can never leave a half-deleted analysis)
 *   - a module returning FALSE is tolerated: the node is still deleted and the
 *     op succeeds (control-plane delete works when the AI runtime is down)
 *   - with no owning module, the node delete still runs (fallback)
 *
 * End-to-end subtree cascade behaviour is exercised by the module-side specs;
 * here we pin only the resolver's orchestration order + error semantics.
 */

interface ModuleStub {
  deleteAnalysis: jest.Mock;
}

function makeService(moduleStub: ModuleStub | null) {
  const moduleRegistry: any = {
    getModuleByName: jest.fn().mockReturnValue(moduleStub),
  };
  const analysisCache: any = {
    getConfig: jest.fn().mockReturnValue({
      maxParallelAnalyses: 5,
      cacheEnabled: false,
      pubSubMaxListeners: 10,
    }),
    invalidateAnalysis: jest.fn(),
  };
  const configService: any = { get: jest.fn().mockReturnValue(undefined) };
  const neo4jDriver: any = {};
  const authorizationService: any = {};
  const monitoringService: any = {};

  const svc = new AnalysisResolverService(
    neo4jDriver,
    configService,
    moduleRegistry,
    authorizationService,
    monitoringService,
    analysisCache,
  );

  // Stub the surrounding helpers so the test isolates the module-vs-node
  // orchestration. `deleteAnalysisNode` is the spy we order against.
  (svc as any).validateAnalysisRequest = jest.fn().mockReturnValue({ isValid: true, errors: [] });
  (svc as any).getAnalysisMetadataWithCache = jest
    .fn()
    .mockResolvedValue({ moduleName: 'test-module' });
  (svc as any).checkAuthorization = jest.fn().mockResolvedValue(undefined);
  (svc as any).recordOperation = jest.fn();
  const deleteAnalysisNode = jest.fn().mockResolvedValue(true);
  (svc as any).deleteAnalysisNode = deleteAnalysisNode;

  return { svc, deleteAnalysisNode, moduleRegistry };
}

describe('AnalysisResolverService.deleteAnalysis — ordering + failure contract', () => {
  it('runs module cleanup before the node delete', async () => {
    const moduleStub: ModuleStub = { deleteAnalysis: jest.fn().mockResolvedValue(true) };
    const { svc, deleteAnalysisNode } = makeService(moduleStub);

    const result = await svc.deleteAnalysis('analysis-1');

    expect(result.success).toBe(true);
    expect(moduleStub.deleteAnalysis).toHaveBeenCalledWith('analysis-1');
    expect(deleteAnalysisNode).toHaveBeenCalledWith('analysis-1');
    // Module cleanup must be invoked strictly before the node delete.
    expect(moduleStub.deleteAnalysis.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAnalysisNode.mock.invocationCallOrder[0],
    );
  });

  it('aborts without deleting the node when the module throws', async () => {
    const moduleStub: ModuleStub = {
      deleteAnalysis: jest.fn().mockRejectedValue(new Error('cascade rolled back')),
    };
    const { svc, deleteAnalysisNode } = makeService(moduleStub);

    const result = await svc.deleteAnalysis('analysis-1');

    expect(result.success).toBe(false);
    expect(moduleStub.deleteAnalysis).toHaveBeenCalledTimes(1);
    // A throw must abort before the node delete — never a half-deleted analysis.
    expect(deleteAnalysisNode).not.toHaveBeenCalled();
  });

  it('tolerates a module returning false and still deletes the node', async () => {
    const moduleStub: ModuleStub = { deleteAnalysis: jest.fn().mockResolvedValue(false) };
    const { svc, deleteAnalysisNode } = makeService(moduleStub);

    const result = await svc.deleteAnalysis('analysis-1');

    // false = external/thread cleanup couldn't finish but the graph is intact;
    // the control-plane delete proceeds.
    expect(result.success).toBe(true);
    expect(moduleStub.deleteAnalysis).toHaveBeenCalledTimes(1);
    expect(deleteAnalysisNode).toHaveBeenCalledWith('analysis-1');
  });

  it('deletes the node when there is no owning module (fallback)', async () => {
    const { svc, deleteAnalysisNode } = makeService(null);

    const result = await svc.deleteAnalysis('analysis-1');

    expect(result.success).toBe(true);
    expect(deleteAnalysisNode).toHaveBeenCalledWith('analysis-1');
  });
});
