import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { MatchClassesResolverService } from '../../resolver-services/match-classes-resolver.service';

type Stub<T> = Partial<T>;

async function buildService(overrides: {
  embedding?: Stub<EmbeddingService>;
  matchClasses?: Stub<MatchClassesResolverService>;
  driver?: any;
  config?: Stub<ConfigService>;
}) {
  const embedding: Stub<EmbeddingService> = {
    isEnabled: jest.fn(() => true),
    getDimensions: jest.fn(() => 3),
    getModel: jest.fn(() => 'nomic-embed-text'),
    embedBatch: jest.fn(async (texts: string[]) =>
      texts.map(() => [9, 9, 9] as number[]),
    ),
    composeClassText: jest.fn((cls: any) => `TEXT:${cls.name}`),
    ...overrides.embedding,
  };

  const matchClasses: Stub<MatchClassesResolverService> = {
    ensureVectorIndexes: jest.fn(async () => {}),
    ...overrides.matchClasses,
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

  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleManagementService,
      { provide: ConfigService, useValue: configService },
      { provide: EmbeddingService, useValue: embedding },
      { provide: MatchClassesResolverService, useValue: matchClasses },
      { provide: 'NEO4J_DRIVER', useValue: driver },
    ],
  }).compile();

  return {
    svc: mod.get(ModuleManagementService),
    embedding,
    matchClasses,
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

  it('calls ensureVectorIndexes before resolving (bootstrap gate)', async () => {
    const ensureVectorIndexes = jest.fn(async () => {});
    const { svc } = await buildService({
      matchClasses: { ensureVectorIndexes },
    });
    await svc.resolveVectors(metadataWithClasses([{ name: 'A' }]));
    expect(ensureVectorIndexes).toHaveBeenCalled();
  });

  it('returns null when the dim cross-check flipped disabled mid-bootstrap', async () => {
    // The ensureVectorIndexes call disables embedding via disableForSession.
    const isEnabled = jest
      .fn()
      .mockReturnValueOnce(true) // initial snapshot
      .mockReturnValueOnce(false); // after ensureVectorIndexes
    const { svc } = await buildService({ embedding: { isEnabled } });
    const result = await svc.resolveVectors(metadataWithClasses([{ name: 'A' }]));
    expect(result).toBeNull();
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
    expect(result!.get('A')).toEqual([1, 2, 3]);
    // B gets embedded on the fly by the stubbed embedBatch.
    expect(result!.get('B')).toEqual([9, 9, 9]);
    // Pre-computed were NOT re-embedded.
    expect(embedding.embedBatch).toHaveBeenCalledWith(['TEXT:B']);
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
    expect(result!.get('A')).toEqual([9, 9, 9]);
    expect(embedding.embedBatch).toHaveBeenCalledWith(['TEXT:A']);
  });

  it('treats all classes as missing when EMBEDDING_MODEL is empty', async () => {
    const getEmbedding = jest.fn().mockReturnValue([1, 2, 3]);
    const module = { getMetadata: () => ({}), getEmbedding };
    const { svc, embedding } = await buildService({
      embedding: {
        isEnabled: jest.fn(() => true),
        getDimensions: jest.fn(() => 3),
        getModel: jest.fn(() => ''),
      },
    });
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module as any,
    );
    // getEmbedding must NOT be called with empty slug.
    expect(getEmbedding).not.toHaveBeenCalled();
    expect(result!.get('A')).toEqual([9, 9, 9]);
    expect(embedding.embedBatch).toHaveBeenCalled();
  });

  it('returns null when embedBatch returns null (session disabled mid-call)', async () => {
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
    expect(result!.get('A')).toEqual([9, 9, 9]);
    expect(embedding.embedBatch).toHaveBeenCalled();
  });

  it('skips getEmbedding call when module does not implement it (optional method)', async () => {
    const { svc } = await buildService({});
    const module = { getMetadata: () => ({}) } as any; // no getEmbedding
    const result = await svc.resolveVectors(
      metadataWithClasses([{ name: 'A' }]),
      module,
    );
    expect(result!.get('A')).toEqual([9, 9, 9]);
  });

  it('returns an empty map when the module has no classes', async () => {
    const { svc, embedding } = await buildService({});
    const result = await svc.resolveVectors(metadataWithClasses([]));
    expect(result).toEqual(new Map());
    expect(embedding.embedBatch).not.toHaveBeenCalled();
  });
});
