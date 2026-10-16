import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

type Stub<T> = Partial<T>;

async function buildService(overrides: {
  embedding?: Stub<EmbeddingService>;
  driver?: any;
  config?: Stub<ConfigService>;
}) {
  const embedding: Stub<EmbeddingService> = {
    isEnabled: jest.fn(() => true),
    isPending: jest.fn(() => false),
    getState: jest.fn(() => 'ready' as const),
    getDimensions: jest.fn(() => 3),
    getModel: jest.fn(() => 'nomic-embed-text'),
    embedBatch: jest.fn(async (texts: string[]) =>
      texts.map(() => [9, 9, 9] as number[]),
    ),
    composeClassText: jest.fn((cls: any) => `TEXT:${cls.name}`),
    ...overrides.embedding,
  };

  const driver = overrides.driver ?? {
    session: () => ({
      executeWrite: async () => {},
      executeRead: async () => ({ records: [] }),
      run: async () => ({ records: [] }),
      close: async () => {},
    }),
  };

  const configService = {
    get: jest.fn(() => undefined),
    ...overrides.config,
  };

  // ModuleManagementService takes ClassReconciler + ClassIdentityEventLog,
  // but resolveVectors doesn't touch them, so a minimal stub each is fine.
  const eventLog = new ClassIdentityEventLog();
  const reconciler = { hasIncidentInstances: async () => false } as unknown as ClassReconciler;

  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleManagementService,
      { provide: ConfigService, useValue: configService },
      { provide: EmbeddingService, useValue: embedding },
      { provide: 'NEO4J_DRIVER', useValue: driver },
      { provide: ClassReconciler, useValue: reconciler },
      { provide: ClassIdentityEventLog, useValue: eventLog },
    ],
  }).compile();

  return {
    svc: mod.get(ModuleManagementService),
    embedding,
  };
}

function metadataWithClasses(classes: any[]) {
  return {
    name: 'test-module',
    version: '1.0.0',
    componentClasses: classes,
  } as any;
}

describe('ModuleManagementService.resolveVectors', () => {
  it('returns null when EmbeddingService is disabled', async () => {
    const { svc } = await buildService({
      embedding: { isEnabled: jest.fn(() => false) },
    });
    const result = await svc.resolveVectors(metadataWithClasses([{ name: 'A' }]));
    expect(result).toBeNull();
  });

  it('returns pending when embedding is enabled but the embedder is not ready, and says so once per boot', async () => {
    const { svc, embedding } = await buildService({
      embedding: { isEnabled: jest.fn(() => false), isPending: jest.fn(() => true), getState: jest.fn(() => 'loading' as const) },
    });
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    expect(await svc.resolveVectors(metadataWithClasses([{ name: 'A' }]))).toBe('pending');
    expect(await svc.resolveVectors(metadataWithClasses([{ name: 'B' }]))).toBe('pending');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ state: 'loading' });
    expect(embedding.embedBatch).not.toHaveBeenCalled();
  });

  it('uses pre-computed vectors from the module', async () => {
    const module = {
      getMetadata: () => ({}),
      getEmbedding: jest.fn((name: string) => (name === 'A' ? [1, 2, 3] : null)),
    };
    const { svc, embedding } = await buildService({});
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }, { name: 'B' }]),
      module as any,
    );
    expect(result).not.toBeNull();
    expect((result as Map<string, number[]>).get('A')).toEqual([1, 2, 3]);
    // B gets embedded on the fly by the stubbed embedBatch.
    expect((result as Map<string, number[]>).get('B')).toEqual([9, 9, 9]);
    // Pre-computed were NOT re-embedded.
    expect(embedding.embedBatch).toHaveBeenCalledWith(['TEXT:B'], 'document', ['B']);
  });

  it('passes the SLUGIFIED model name to getEmbedding', async () => {
    const getEmbedding = jest.fn().mockReturnValue(null);
    const module = { getMetadata: () => ({}), getEmbedding };
    const { svc } = await buildService({
      embedding: {
        isEnabled: jest.fn(() => true),
        getDimensions: jest.fn(() => 3),
        getModel: jest.fn(() => 'sentence-transformers/all-MiniLM-L6-v2'),
      },
    });
    await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module as any,
    );
    expect(getEmbedding).toHaveBeenCalledWith(
      'A',
      'sentence-transformers-all-MiniLM-L6-v2',
    );
  });

  it('falls through to on-the-fly when pre-computed vector has wrong dimension', async () => {
    const module = {
      getMetadata: () => ({}),
      getEmbedding: () => [1, 2] as number[], // expected 3
    };
    const { svc, embedding } = await buildService({});
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module as any,
    );
    expect((result as Map<string, number[]>).get('A')).toEqual([9, 9, 9]);
    expect(embedding.embedBatch).toHaveBeenCalledWith(['TEXT:A'], 'document', ['A']);
  });

  it('writes no vectors (null) should embedBatch return null after the enabled check', async () => {
    const module = { getMetadata: () => ({}), getEmbedding: () => null };
    const { svc } = await buildService({
      embedding: { embedBatch: jest.fn(async () => null) },
    });
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module as any,
    );
    expect(result).toBeNull();
  });

  it('coerces undefined getEmbedding return to "missing"', async () => {
    // Some implementations might return undefined via optional chaining.
    const module = { getMetadata: () => ({}), getEmbedding: () => undefined as any };
    const { svc, embedding } = await buildService({});
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module as any,
    );
    expect((result as Map<string, number[]>).get('A')).toEqual([9, 9, 9]);
    expect(embedding.embedBatch).toHaveBeenCalled();
  });

  it('skips getEmbedding call when module does not implement it (optional method)', async () => {
    const { svc } = await buildService({});
    const module = { getMetadata: () => ({}) } as any; // no getEmbedding
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module,
    );
    expect((result as Map<string, number[]>).get('A')).toEqual([9, 9, 9]);
  });

  it('returns an empty map when the module has no classes', async () => {
    const { svc, embedding } = await buildService({});
    const result = await svc.resolveVectors(metadataWithClasses([]));
    expect(result).toEqual(new Map());
    expect(embedding.embedBatch).not.toHaveBeenCalled();
  });

  // An install writes every class it declares a vector or fails: a class left without one would have the skip gate
  // install its module again at every start.
  it('fails when the embedder returns fewer vectors than classes', async () => {
    const { svc } = await buildService({
      embedding: { embedBatch: jest.fn(async () => [[9, 9, 9]]) },
    });
    await expect(svc.resolveVectors(metadataWithClasses([{ name: 'A' }, { name: 'B' }]))).rejects.toThrow(
      'The embedder returned 1 vectors for 2 classes',
    );
  });

  it.each([
    ['a non-finite value', [9, Number.NaN, 9]],
    ['a zero norm', [0, 0, 0]],
    ['length 2, expected 3', [9, 9]],
  ])('fails when the embedder returns a vector with %s', async (defect, vector) => {
    const { svc } = await buildService({
      embedding: { embedBatch: jest.fn(async (texts: string[]) => texts.map(() => vector)) },
    });
    await expect(svc.resolveVectors(metadataWithClasses([{ name: 'A' }]))).rejects.toThrow(
      `The embedder returned a vector that cannot be stored for class "A": ${defect}`,
    );
  });

  it('embeds on the fly a class whose pre-computed vector has the right length but cannot be stored', async () => {
    const { svc, embedding } = await buildService({});
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    const module = { getEmbedding: () => [1, Number.NaN, 0] } as any;
    const result = await svc.resolveVectors(metadataWithClasses([{ name: 'A' }]), module);
    expect((result as Map<string, number[]>).get('A')).toEqual([9, 9, 9]);
    expect(embedding.embedBatch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Pre-computed embedding cannot be stored; falling through to on-the-fly', {
      moduleName: 'test-module',
      className: 'A',
      defect: 'a non-finite value',
    });
  });
});
