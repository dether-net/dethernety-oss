/**
 * Embedding response parsing + shared text/hash composition.
 *
 * parseEmbeddingResponse must restore INPUT order (callers zip results positionally), validate
 * shape, and match the requested count — a reordered/malformed/short response must fail loud
 * rather than silently mis-assign vectors to classes. classEmbeddingText is the single source
 * of the embedded/hashed text shared by the write-time CLI and the read-time cache.
 */

import { describe, it, expect } from 'vitest';

import {
  classEmbeddingText,
  hashEmbeddingText,
  parseEmbeddingResponse,
} from '../embedding-text';

describe('parseEmbeddingResponse — ordering', () => {
  it('sorts the OpenAI branch by item.index (restoring input order)', () => {
    const data = {
      data: [
        { index: 1, embedding: [3, 4] },
        { index: 0, embedding: [1, 2] },
      ],
    };
    expect(parseEmbeddingResponse(data, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('preserves array order when items carry no index (backward-compat)', () => {
    const data = { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] };
    expect(parseEmbeddingResponse(data, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('handles the Ollama /api/embed and legacy single formats', () => {
    expect(parseEmbeddingResponse({ embeddings: [[1, 2], [3, 4]] }, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(parseEmbeddingResponse({ embedding: [1, 2] }, 1)).toEqual([[1, 2]]);
  });
});

describe('parseEmbeddingResponse — validation', () => {
  it('throws on a count mismatch rather than mis-aligning vectors to inputs', () => {
    expect(() => parseEmbeddingResponse({ data: [{ embedding: [1, 2] }] }, 2)).toThrow(/count mismatch/i);
  });

  it('throws when an item embedding is missing / empty / non-numeric', () => {
    expect(() => parseEmbeddingResponse({ data: [{ index: 0 }] }, 1)).toThrow(/not a non-empty numeric array/);
    expect(() => parseEmbeddingResponse({ data: [{ embedding: [] }] }, 1)).toThrow(/not a non-empty numeric array/);
    expect(() => parseEmbeddingResponse({ data: [{ embedding: ['x'] }] }, 1)).toThrow(/not a non-empty numeric array/);
    expect(() => parseEmbeddingResponse({ embeddings: [[1, NaN]] }, 1)).toThrow(/not a non-empty numeric array/);
  });

  it('throws on an unrecognized response shape', () => {
    expect(() => parseEmbeddingResponse({ foo: 'bar' }, 1)).toThrow(/Unexpected embedding API response format/);
  });
});

describe('classEmbeddingText + hashEmbeddingText', () => {
  it('composes the pinned text with normalized component type', () => {
    expect(
      classEmbeddingText({ name: 'App', type: 'process' }, 'component'),
    ).toBe('App. . Category: General. Type: PROCESS.');
  });

  it('applies the forced type for non-component class dirs', () => {
    expect(
      classEmbeddingText({ name: 'Flow', type: 'irrelevant' }, 'dataFlow'),
    ).toBe('Flow. . Category: General. Type: DATA_FLOW.');
  });

  it('includes description and category when present', () => {
    expect(
      classEmbeddingText(
        { name: 'DB', description: 'the store', category: 'Data', type: 'store' },
        'component',
      ),
    ).toBe('DB. the store. Category: Data. Type: STORE.');
  });

  it('hashes deterministically to a 64-char hex digest that changes with the text', () => {
    const a = hashEmbeddingText('App. . Category: General. Type: PROCESS.');
    const b = hashEmbeddingText('App. . Category: General. Type: PROCESS.');
    const c = hashEmbeddingText('App. edited. Category: General. Type: PROCESS.');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
