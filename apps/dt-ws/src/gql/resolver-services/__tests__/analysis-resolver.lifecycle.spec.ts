import { AnalysisResolverService } from '../analysis-resolver.service';
import { GraphQLError } from 'graphql';

/**
 * Unit pins for analysis lifecycle visibility:
 *   Part 1: the Mutation adapters THROW a GraphQLError carrying the failure
 *           code (extensions.code) instead of swallowing {success:false} into a
 *           phantom { sessionId: '' } / false.
 *   Part 3: the internal streamResponse listener removes a longRunningAnalyses
 *           entry on a terminal event (so the parallel limiter stops counting
 *           finished sessions) and refreshes lastActivity on a content chunk
 *           (so the idle sweep never evicts an actively-streaming run).
 *
 * Pure in-process — no DB, no Nest TestingModule (mirrors
 * analysis-resolver.delete-analysis.spec.ts). onModuleInit is only called in
 * the dedicated wiring test (it starts a cleanup interval — fake timers there).
 */

function makeService(configOverrides: Record<string, unknown> = {}) {
  const moduleRegistry: any = { getModuleByName: jest.fn() };
  const analysisCache: any = {
    getConfig: jest.fn().mockReturnValue({
      maxParallelAnalyses: 5,
      cacheEnabled: false,
      pubSubMaxListeners: 10,
      cleanupInterval: 60_000,
      ...configOverrides,
    }),
    invalidateAnalysis: jest.fn(),
    setAnalysisMetadata: jest.fn(),
  };
  const configService: any = { get: jest.fn().mockReturnValue(undefined) };
  const neo4jDriver: any = {};
  const authorizationService: any = { extractAuthContext: jest.fn().mockReturnValue({}) };
  const monitoringService: any = { recordOperation: jest.fn() };

  const svc = new AnalysisResolverService(
    neo4jDriver,
    configService,
    moduleRegistry,
    authorizationService,
    monitoringService,
    analysisCache,
  );
  return { svc, moduleRegistry, analysisCache };
}

function seedEntry(svc: AnalysisResolverService, sessionId: string, lastActivity = Date.now()) {
  (svc as any).longRunningAnalyses.set(sessionId, {
    analysisId: 'a1',
    sessionId,
    moduleName: 'm',
    startTime: 0,
    lastActivity,
    status: 'running',
  });
}

describe('AnalysisResolverService — Mutation adapters surface failures (Part 1)', () => {
  const sessionCases = [
    { field: 'runAnalysis', args: { analysisId: 'a1' } },
    { field: 'startChat', args: { analysisId: 'a1', userQuestion: 'q' } },
    { field: 'resumeAnalysis', args: { analysisId: 'a1', userInput: 'i' } },
  ] as const;

  it.each(sessionCases)(
    '$field throws a GraphQLError with the errorType as extensions.code',
    async ({ field, args }) => {
      const { svc } = makeService();
      (svc as any)[field] = jest
        .fn()
        .mockResolvedValue({ success: false, error: 'class retired', errorType: 'CLASS_RETIRED' });

      const mutation = (svc.getResolvers() as any).Mutation[field];

      await expect(mutation({}, args, {})).rejects.toThrow(GraphQLError);
      try {
        await mutation({}, args, {});
        fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).message).toBe('class retired');
        expect((error as GraphQLError).extensions?.code).toBe('CLASS_RETIRED');
      }
    },
  );

  it.each(sessionCases)('$field passes success data through unchanged', async ({ field, args }) => {
    const { svc } = makeService();
    (svc as any)[field] = jest.fn().mockResolvedValue({ success: true, data: { sessionId: 's1' } });

    const mutation = (svc.getResolvers() as any).Mutation[field];

    await expect(mutation({}, args, {})).resolves.toEqual({ sessionId: 's1' });
  });

  it('deleteAnalysis throws on failure and returns true on success', async () => {
    const { svc } = makeService();

    (svc as any).deleteAnalysis = jest
      .fn()
      .mockResolvedValue({ success: false, error: 'db down', errorType: 'DATABASE_ERROR' });
    let del = (svc.getResolvers() as any).Mutation.deleteAnalysis;
    try {
      await del({}, { analysisId: 'a1' }, {});
      fail('should have thrown');
    } catch (error) {
      expect((error as GraphQLError).extensions?.code).toBe('DATABASE_ERROR');
    }

    (svc as any).deleteAnalysis = jest.fn().mockResolvedValue({ success: true, data: true });
    del = (svc.getResolvers() as any).Mutation.deleteAnalysis;
    await expect(del({}, { analysisId: 'a1' }, {})).resolves.toBe(true);
  });

  it('falls back to code UNKNOWN_ERROR when errorType is absent (stays within the union)', async () => {
    const { svc } = makeService();
    (svc as any).runAnalysis = jest.fn().mockResolvedValue({ success: false, error: 'boom' });

    const mutation = (svc.getResolvers() as any).Mutation.runAnalysis;
    try {
      await mutation({}, { analysisId: 'a1' }, {});
      fail('should have thrown');
    } catch (error) {
      expect((error as GraphQLError).extensions?.code).toBe('UNKNOWN_ERROR');
      expect((error as GraphQLError).message).toBe('boom');
    }
  });

  it('the real runAnalysis surfaces RESOURCE_EXHAUSTED as errorType when at the parallel cap', async () => {
    const { svc } = makeService({ maxParallelAnalyses: 1 });
    seedEntry(svc, 'x1');
    (svc as any).validateAnalysisRequest = jest.fn().mockReturnValue({ isValid: true, errors: [] });

    const result = await svc.runAnalysis({ analysisId: 'a2' } as any);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('RESOURCE_EXHAUSTED');
  });

  it('treats a module empty-sessionId sentinel as a MODULE_ERROR failure (no phantom session)', async () => {
    const { svc, moduleRegistry } = makeService();
    (svc as any).validateAnalysisRequest = jest.fn().mockReturnValue({ isValid: true, errors: [] });
    (svc as any).getAnalysisMetadataWithCache = jest
      .fn()
      .mockResolvedValue({ moduleName: 'm', analysisClassId: 'ac', elementId: 'e' });
    (svc as any).checkAuthorization = jest.fn().mockResolvedValue(undefined);
    (svc as any).recordOperation = jest.fn();
    (svc as any).pubSub = { publish: jest.fn(), subscribe: jest.fn(), unsubscribe: jest.fn() };
    // The module returns the empty-sessionId sentinel (assistant not found /
    // graph-config missing) instead of throwing.
    moduleRegistry.getModuleByName.mockReturnValue({
      runAnalysis: jest.fn().mockResolvedValue({ sessionId: '' }),
    });

    const result = await svc.runAnalysis({ analysisId: 'a1' } as any);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('MODULE_ERROR');
    // No tracking entry created for a non-started run.
    expect((svc as any).longRunningAnalyses.size).toBe(0);

    // And the adapter turns it into a coded GraphQLError (not a phantom session).
    (svc as any).runAnalysis = jest
      .fn()
      .mockResolvedValue({ success: false, error: 'no session', errorType: 'MODULE_ERROR' });
    const mutation = (svc.getResolvers() as any).Mutation.runAnalysis;
    await expect(mutation({}, { analysisId: 'a1' }, {})).rejects.toMatchObject({
      extensions: { code: 'MODULE_ERROR' },
    });
  });
});

describe('AnalysisResolverService — handleStreamLifecycle (Part 3)', () => {
  it('a terminal complete removes the entry and decrements activeAnalyses', () => {
    const { svc } = makeService();
    seedEntry(svc, 's1');
    (svc as any).statistics.activeAnalyses = 1;

    (svc as any).handleStreamLifecycle({ sessionId: 's1', streamResponse: { type: 'complete' } });

    expect((svc as any).longRunningAnalyses.has('s1')).toBe(false);
    expect((svc as any).statistics.activeAnalyses).toBe(0);
  });

  it('a terminal error also removes the entry', () => {
    const { svc } = makeService();
    seedEntry(svc, 's1');
    (svc as any).statistics.activeAnalyses = 1;

    (svc as any).handleStreamLifecycle({ sessionId: 's1', streamResponse: { type: 'error' } });

    expect((svc as any).longRunningAnalyses.has('s1')).toBe(false);
  });

  it('is idempotent — a second terminal never drives activeAnalyses negative', () => {
    const { svc } = makeService();
    seedEntry(svc, 's1');
    (svc as any).statistics.activeAnalyses = 1;

    (svc as any).handleStreamLifecycle({ sessionId: 's1', streamResponse: { type: 'complete' } });
    (svc as any).handleStreamLifecycle({ sessionId: 's1', streamResponse: { type: 'complete' } });

    expect((svc as any).statistics.activeAnalyses).toBe(0);
  });

  it('a content chunk refreshes lastActivity without removing the entry', () => {
    jest.useFakeTimers();
    try {
      const t0 = 1_000_000;
      jest.setSystemTime(t0);
      const { svc } = makeService();
      seedEntry(svc, 's1', t0);

      jest.setSystemTime(t0 + 5_000);
      (svc as any).handleStreamLifecycle({
        sessionId: 's1',
        streamResponse: { type: 'AIMessageChunk', content: 'hi' },
      });

      const entry = (svc as any).longRunningAnalyses.get('s1');
      expect(entry).toBeDefined();
      expect(entry.lastActivity).toBe(t0 + 5_000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores an unknown or missing sessionId without throwing or decrementing', () => {
    const { svc } = makeService();
    (svc as any).statistics.activeAnalyses = 3;

    expect(() =>
      (svc as any).handleStreamLifecycle({ sessionId: 'nope', streamResponse: { type: 'complete' } }),
    ).not.toThrow();
    expect(() =>
      (svc as any).handleStreamLifecycle({ streamResponse: { type: 'complete' } }),
    ).not.toThrow();
    expect((svc as any).statistics.activeAnalyses).toBe(3);
  });

  it('the parallel limiter admits a new run after a prior one completes', async () => {
    const { svc, moduleRegistry } = makeService({ maxParallelAnalyses: 2 });
    seedEntry(svc, 'x1');
    seedEntry(svc, 'x2');
    (svc as any).validateAnalysisRequest = jest.fn().mockReturnValue({ isValid: true, errors: [] });
    (svc as any).getAnalysisMetadataWithCache = jest
      .fn()
      .mockResolvedValue({ moduleName: 'm', analysisClassId: 'ac', elementId: 'e' });
    (svc as any).checkAuthorization = jest.fn().mockResolvedValue(undefined);
    (svc as any).recordOperation = jest.fn();
    (svc as any).pubSub = {
      publish: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      asyncIterableIterator: jest.fn(),
    };
    moduleRegistry.getModuleByName.mockReturnValue({
      runAnalysis: jest.fn().mockResolvedValue({ sessionId: 's3' }),
    });

    // At the cap → rejected.
    const blocked = await svc.runAnalysis({ analysisId: 'a3' } as any);
    expect(blocked.success).toBe(false);
    expect(blocked.errorType).toBe('RESOURCE_EXHAUSTED');

    // A finished session frees a slot.
    (svc as any).handleStreamLifecycle({ sessionId: 'x1', streamResponse: { type: 'complete' } });

    const admitted = await svc.runAnalysis({ analysisId: 'a3' } as any);
    expect(admitted.success).toBe(true);
    expect(admitted.data).toEqual({ sessionId: 's3' });
  });
});

describe('AnalysisResolverService — lifecycle listener wiring (Part 3)', () => {
  it('subscribes to streamResponse on init and unsubscribes on destroy', async () => {
    jest.useFakeTimers();
    try {
      const { svc } = makeService();
      const subscribe = jest.fn().mockResolvedValue(7);
      const unsubscribe = jest.fn();
      (svc as any).pubSub = {
        subscribe,
        unsubscribe,
        publish: jest.fn(),
        asyncIterableIterator: jest.fn(),
      };

      seedEntry(svc, 's1');
      (svc as any).statistics.activeAnalyses = 1;

      await svc.onModuleInit();
      expect(subscribe).toHaveBeenCalledWith('streamResponse', expect.any(Function), {});
      expect((svc as any).streamLifecycleSubId).toBe(7);

      // The registered callback must be handleStreamLifecycle — invoke it with a
      // terminal payload and confirm it drives cleanup (guards against wiring the
      // wrong method, which the presence assertion alone would not catch).
      const registered = subscribe.mock.calls[0][1];
      registered({ sessionId: 's1', streamResponse: { type: 'complete' } });
      expect((svc as any).longRunningAnalyses.has('s1')).toBe(false);
      expect((svc as any).statistics.activeAnalyses).toBe(0);

      await svc.onModuleDestroy();
      expect(unsubscribe).toHaveBeenCalledWith(7);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
