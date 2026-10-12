/**
 * The embedder's own logic, without weights: truncation keeps special tokens, mean pooling honours
 * the attention mask, normalisation and hygiene, the feeds a session receives, and output handling
 * for both pooling modes.
 *
 * With EMBEDDER_TEST_MODEL_DIR pointing at a models directory that holds the shipped profiles'
 * files, the real-weight block also checks that batching does not change a vector.
 */

import * as ort from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';

import { getProfile, type EmbeddingProfile } from '@dethernety/dt-module/embedding';

import { createOnnxEmbedder, encodeTruncated, l2Normalize, meanPool, OnnxEmbedder, type TokenizerLike } from '../embedder';

/** A tokenizer that maps each character to its code and wraps the result in 2 … 1. */
const charTokenizer: TokenizerLike = {
  encode: (text, options) => {
    const ids = [...text].map((c) => c.charCodeAt(0));
    return { ids: options?.add_special_tokens === false ? ids : [2, ...ids, 1] };
  },
};

describe('encodeTruncated', () => {
  it('returns the full encoding when it fits', () => {
    expect(encodeTruncated(charTokenizer, 'abc', 10)).toEqual([2, 97, 98, 99, 1]);
  });

  it('cuts the content and keeps both special tokens', () => {
    expect(encodeTruncated(charTokenizer, 'abcdef', 5)).toEqual([2, 97, 98, 99, 1]);
  });
});

describe('meanPool', () => {
  it('averages only the positions the mask marks', () => {
    // batch 2, seq 2, dim 2
    const hidden = Float32Array.from([1, 2, 3, 4, 10, 20, 99, 99]);
    expect(meanPool(hidden, [[1, 1], [1, 0]], 2, 2)).toEqual([
      [2, 3],
      [10, 20],
    ]);
  });
});

describe('l2Normalize', () => {
  it('scales to unit length', () => {
    const [x, y] = l2Normalize([3, 4]);
    expect(x).toBeCloseTo(0.6, 12);
    expect(y).toBeCloseTo(0.8, 12);
  });
  it('rejects a zero vector and a non-finite value', () => {
    expect(() => l2Normalize([0, 0])).toThrow(/zero norm/);
    expect(() => l2Normalize([1, Number.NaN])).toThrow(/non-finite/);
  });
});

function testProfile(runtime: Partial<EmbeddingProfile['runtime']>, prompts = { query: 'q: {text}', document: 't: {title} | {text}', title: 'name' as const }): EmbeddingProfile {
  return {
    schemaVersion: 1,
    id: 'tiny-test-v1',
    label: 'tiny',
    runtime: { engine: 'onnx', dimensions: 2, maxTokens: 64, ...runtime },
    prompts,
    thresholds: { classes: null, mitre: null, components: null },
  };
}

/** A session stub that records its feeds and returns the given output. */
function fakeSession(inputNames: string[], output: (feeds: Record<string, ort.Tensor>) => Record<string, ort.Tensor>) {
  const runs: Array<Record<string, ort.Tensor>> = [];
  return {
    runs,
    session: {
      inputNames,
      run: async (feeds: Record<string, ort.Tensor>) => {
        runs.push(feeds);
        return output(feeds);
      },
      release: async () => undefined,
    } as unknown as ConstructorParameters<typeof OnnxEmbedder>[1],
  };
}

describe('OnnxEmbedder', () => {
  it('applies the prompt, pads the batch and feeds empty tensors for extra inputs', async () => {
    const profile = testProfile({
      output: 'last_hidden_state',
      pooling: 'mean',
      emptyInputs: { names: ['image_features'], shape: [0, 512], type: 'float32' },
    });
    const { runs, session } = fakeSession(['input_ids', 'attention_mask', 'image_features'], (feeds) => {
      const [b, n] = feeds.input_ids.dims as number[];
      return { last_hidden_state: new ort.Tensor('float32', new Float32Array(b * n * 2).fill(1), [b, n, 2]) };
    });
    const embedder = new OnnxEmbedder(profile, session, charTokenizer, 0, 16);
    const out = await embedder.embed('document', [{ text: 'a', title: 'X' }, { text: 'bcd', title: 'Y' }]);

    const feeds = runs[0];
    const ids = Array.from(feeds.input_ids.data as BigInt64Array, Number);
    const prompted = ['t: X | a', 't: Y | bcd'].map((s) => [2, ...[...s].map((c) => c.charCodeAt(0)), 1]);
    const seq = Math.max(...prompted.map((p) => p.length));
    expect(feeds.input_ids.dims).toEqual([2, seq]);
    expect(ids.slice(0, seq)).toEqual([...prompted[0], ...new Array(seq - prompted[0].length).fill(0)]);
    expect(Array.from(feeds.attention_mask.data as BigInt64Array, Number).slice(0, seq)).toEqual(
      prompted[0].map(() => 1).concat(new Array(seq - prompted[0].length).fill(0)),
    );
    expect(feeds.image_features.dims).toEqual([0, 512]);
    for (const v of out) expect(v.map((x) => +x.toFixed(6))).toEqual([0.707107, 0.707107]);
  });

  it('reads an in-graph pooled output for each item', async () => {
    const profile = testProfile({ output: 'sentence_embedding', pooling: 'in-graph' });
    const { session } = fakeSession(['input_ids', 'attention_mask'], (feeds) => {
      const [b] = feeds.input_ids.dims as number[];
      const data = new Float32Array(b * 2);
      for (let i = 0; i < b; i++) data.set([i + 1, 0], i * 2);
      return { sentence_embedding: new ort.Tensor('float32', data, [b, 2]) };
    });
    const out = await new OnnxEmbedder(profile, session, charTokenizer, 0, 16).embed('query', [{ text: 'a' }, { text: 'b' }]);
    expect(out).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });

  it('runs in chunks of the batch size and keeps input order', async () => {
    const profile = testProfile({ output: 'sentence_embedding', pooling: 'in-graph' });
    let call = 0;
    const { runs, session } = fakeSession(['input_ids', 'attention_mask'], (feeds) => {
      const [b] = feeds.input_ids.dims as number[];
      const data = new Float32Array(b * 2);
      for (let i = 0; i < b; i++) data.set([1, call], i * 2);
      call++;
      return { sentence_embedding: new ort.Tensor('float32', data, [b, 2]) };
    });
    const out = await new OnnxEmbedder(profile, session, charTokenizer, 0, 2).embed('query', ['a', 'b', 'c'].map((text) => ({ text })));
    expect(runs.map((r) => r.input_ids.dims[0])).toEqual([2, 1]);
    expect(out[2][1]).toBeGreaterThan(0);
    expect(out[0][1]).toBe(0);
  });

  it('refuses a graph input the profile gives no feed for', async () => {
    const { session } = fakeSession(['input_ids', 'attention_mask', 'pixel_values'], () => ({}));
    const embedder = new OnnxEmbedder(testProfile({ output: 'sentence_embedding' }), session, charTokenizer, 0, 16);
    await expect(embedder.embed('query', [{ text: 'a' }])).rejects.toThrow(/graph input "pixel_values" has no feed/);
  });

  it('refuses an output of the wrong width', async () => {
    const { session } = fakeSession(['input_ids', 'attention_mask'], () => ({
      sentence_embedding: new ort.Tensor('float32', new Float32Array(3), [1, 3]),
    }));
    const embedder = new OnnxEmbedder(testProfile({ output: 'sentence_embedding' }), session, charTokenizer, 0, 16);
    await expect(embedder.embed('query', [{ text: 'a' }])).rejects.toThrow(/expected \[n, 2\]/);
  });
});

const MODEL_DIR = process.env.EMBEDDER_TEST_MODEL_DIR;

describe.skipIf(!MODEL_DIR)('real weights', () => {
  const texts = [
    { text: 'OS credential dumping from LSASS memory', title: 'OS Credential Dumping' },
    { text: 'Redis cache', title: 'Redis' },
    { text: 'A managed Kubernetes control plane exposing an API server to the internet', title: 'EKS' },
  ];

  it.each(['embeddinggemma-300m-retrieval-v1', 'embeddinggemma-2-text-retrieval-v1'])(
    '%s: a batch gives the same vectors as one item at a time',
    async (id) => {
      const embedder = await createOnnxEmbedder(getProfile(id), MODEL_DIR!, { threads: 4 });
      try {
        for (const kind of ['query', 'document'] as const) {
          const batched = await embedder.embed(kind, texts);
          for (let i = 0; i < texts.length; i++) {
            const [single] = await embedder.embed(kind, [texts[i]]);
            const cos = single.reduce((s, v, d) => s + v * batched[i][d], 0);
            expect(cos).toBeGreaterThan(1 - 1e-6);
          }
        }
      } finally {
        await embedder.release();
      }
    },
    120_000,
  );
});
