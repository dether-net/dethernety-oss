import 'reflect-metadata'; // class-transformer decorators need the shim under Jest
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { EmbeddingService } from '../../gql/services/embedding.service';
import { validateEnvironment } from '../environment.validation';
import { optionalNumber } from '../optional-number';

describe('optionalNumber', () => {
  it('reads unset, empty and blank as unset, and anything else as a number', () => {
    expect([undefined, null, '', '   ', '\t'].map(optionalNumber)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect([' 0.4 ', '4', 0, -1].map(optionalNumber)).toEqual([0.4, 4, 0, -1]);
    expect(optionalNumber('high')).toBeNaN();
  });
});

/**
 * Through the real ConfigModule with the environment validation, as dt-ws boots: a blank value the validation
 * leaves unset reaches ConfigService.get as the raw environment string, and the embedding service must read it as
 * unset too, not as 0.
 */
describe('blank embedding settings through the real ConfigModule', () => {
  const SET = {
    NEO4J_PASSWORD: 'secret',
    EMBEDDING_ENABLED: 'true',
    EMBEDDING_MODEL: ' ',
    EMBEDDING_SIMILARITY_THRESHOLD: '   ',
    EMBEDDING_THRESHOLD_MITRE: ' ',
    EMBEDDING_THREADS: '  ',
  };
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [k, v] of Object.entries(SET)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('applies the defaults: the default profile, its floors and four threads', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, validate: validateEnvironment })],
      providers: [EmbeddingService],
    }).compile();
    const svc = moduleRef.get(EmbeddingService);
    expect(svc.getModel()).toBe('embeddinggemma-300m-retrieval-v1');
    expect(svc.getThreshold('classes')).toBe(0.35);
    expect(svc.getThreshold('mitre')).toBe(0.301);
    expect((svc as unknown as { threads: number }).threads).toBe(4);
    await moduleRef.close();
  });
});
