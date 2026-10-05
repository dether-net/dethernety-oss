/**
 * The remote module's tolerance of embedding vectors that are not the wire's bare
 * `number[]`: a vector file's `{ vector, contentHash }` wrapper served verbatim is
 * unwrapped, and anything still unusable is dropped (the class is then embedded on
 * the fly) instead of throwing on every `getEmbedding` lookup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '@nestjs/common';
import { DtRemoteModule } from '../dt-remote-module';
import { MockContentServer } from '../testing/mock-content-server';
import { MODULE_KEY, PIN, MODEL_SLUG, CLASS_ID, embeddingsResponse } from '../testing/fixtures';

const VECTOR = embeddingsResponse.embeddings[0].vector;

const mock = new MockContentServer();
let cacheDir: string;

beforeEach(() => {
  mock.reset();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-embeddings-'));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

/** A client whose embeddings route serves `vector` for the fixture class; every other
 * route is the mock's. */
function clientServing(vector: unknown, logger?: Logger): DtRemoteModule {
  const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
    if (/\/embeddings\/[^/]+$/.test(new URL(url).pathname)) {
      const body = { ...embeddingsResponse, embeddings: [{ classId: CLASS_ID, vector }] };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    }
    return mock.fetch(url, init);
  };
  return new DtRemoteModule({ moduleKey: MODULE_KEY, pin: PIN }, {}, logger, {
    fetchImpl,
    baseUrl: 'https://mock.local',
    cacheDir,
  });
}

describe('DtRemoteModule embedding vectors', () => {
  it('unwraps a { vector, contentHash } wrapper served in place of the bare array', async () => {
    const client = clientServing({ vector: VECTOR, contentHash: 'a'.repeat(64) });
    await client.getMetadata();
    expect(client.getEmbedding('Virtual Machine', MODEL_SLUG)).toEqual(VECTOR);
  });

  it('serves a wrapper already persisted in the metadata cache (warm-offline boot)', async () => {
    await clientServing({ vector: VECTOR, contentHash: 'a'.repeat(64) }).getMetadata();
    mock.setFailureMode('network');
    const offline = clientServing(null);
    await offline.getMetadata();
    expect(offline.getEmbedding('Virtual Machine', MODEL_SLUG)).toEqual(VECTOR);
  });

  it.each([
    ['an object without a vector', { contentHash: 'a'.repeat(64) }],
    ['a wrapper around a non-array', { vector: 'nope' }],
    ['a string', 'nope'],
    ['null', null],
    ['an empty array', []],
    ['a non-numeric entry', [0.1, '0.2']],
    ['a zero-magnitude vector', [0, 0, 0]],
  ])('drops %s: getEmbedding returns null and never throws', async (_label, vector) => {
    const logger = new Logger('test');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = clientServing(vector, logger);
    await client.getMetadata();
    expect(() => client.getEmbedding('Virtual Machine', MODEL_SLUG)).not.toThrow();
    expect(client.getEmbedding('Virtual Machine', MODEL_SLUG)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Dropped malformed embedding vectors'),
      expect.objectContaining({ moduleKey: MODULE_KEY, model: MODEL_SLUG, rejected: 1 }),
    );
  });
});
