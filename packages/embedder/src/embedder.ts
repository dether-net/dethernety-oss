/**
 * In-process embedder for an ONNX profile: one onnxruntime session on the profile's text graph.
 *
 * `embed(kind, items)` applies the profile's prompt, tokenises, runs the graph, pools as the profile
 * says and L2-normalises. Nothing else loads: the session opens only the files the profile lists,
 * after they verify, so a repository's other encoders are never read.
 */

import './no-telemetry';

import { readFile } from 'fs/promises';

import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-node';

import { applyPrompt, type EmbeddingProfile, type ProfileKind } from '@dethernety/dt-module/embedding';

import { safeFilePath, verifyWeights } from './acquire';

export interface EmbedItem {
  text: string;
  /** The item's name, for a profile whose document title rule is `name`. */
  title?: string;
}

export interface EmbedOptions {
  /**
   * How long the caller waits for the vectors, in ms. Past it the call rejects with an `EmbedTimeoutError`; the work
   * already handed to the worker still runs, and its result is dropped. Only the worker embedder honours it.
   */
  timeoutMs?: number;
}

export interface Embedder {
  readonly profileId: string;
  readonly dimensions: number;
  /** One unit-length vector per item, in input order. */
  embed(kind: ProfileKind, items: EmbedItem[], options?: EmbedOptions): Promise<number[][]>;
  release(): Promise<void>;
}

export interface OnnxEmbedderOptions {
  /** onnxruntime intra-op threads. Default 4. */
  threads?: number;
  /** Items per session run. Default 16. */
  batchSize?: number;
}

/** Token ids for one text, truncated to `maxTokens` with the tokenizer's special tokens kept. */
export interface TokenizerLike {
  encode(text: string, options?: { add_special_tokens?: boolean }): { ids: number[] };
}

export function encodeTruncated(tokenizer: TokenizerLike, text: string, maxTokens: number): number[] {
  const full = tokenizer.encode(text).ids;
  if (full.length <= maxTokens) return full;
  // Find the special tokens the tokenizer wraps the content in, keep them, and cut the content:
  // the same result as truncating before the specials are added.
  const content = tokenizer.encode(text, { add_special_tokens: false }).ids;
  const extra = full.length - content.length;
  for (let k = 0; k <= extra; k++) {
    if (content.every((id, i) => full[k + i] === id)) {
      const prefix = full.slice(0, k);
      const suffix = full.slice(k + content.length);
      const room = Math.max(0, maxTokens - prefix.length - suffix.length);
      return [...prefix, ...content.slice(0, room), ...suffix];
    }
  }
  return full.slice(0, maxTokens);
}

/** Mean of `hidden` [batch, seq, dim] over the positions where `mask` [batch, seq] is 1. */
export function meanPool(hidden: Float32Array, mask: number[][], seq: number, dim: number): number[][] {
  return mask.map((row, b) => {
    const out = new Array<number>(dim).fill(0);
    let count = 0;
    for (let t = 0; t < seq; t++) {
      if (!row[t]) continue;
      count++;
      const base = (b * seq + t) * dim;
      for (let d = 0; d < dim; d++) out[d] += hidden[base + d];
    }
    return out.map((v) => (count ? v / count : v));
  });
}

/** Unit-length copy of a vector. Throws on a non-finite value or a zero norm. */
export function l2Normalize(vector: number[]): number[] {
  let sumSq = 0;
  for (const v of vector) {
    if (!Number.isFinite(v)) throw new Error('embedding has a non-finite value');
    sumSq += v * v;
  }
  if (sumSq === 0) throw new Error('embedding has a zero norm');
  const inv = 1 / Math.sqrt(sumSq);
  return vector.map((v) => v * inv);
}

function padId(tokenizerJson: { added_tokens?: Array<{ id: number; content: string }> }, padToken: unknown): number {
  const token = typeof padToken === 'string' ? padToken : (padToken as { content?: string } | undefined)?.content;
  const hit = tokenizerJson.added_tokens?.find((t) => t.content === token);
  if (!hit) throw new Error(`pad token ${String(token)} is not in tokenizer.json`);
  return hit.id;
}

function fileNamed(profile: EmbeddingProfile, test: (path: string) => boolean, what: string) {
  const hits = profile.source!.files.filter((f) => test(f.path));
  if (hits.length !== 1) throw new Error(`Profile "${profile.id}" must list exactly one ${what}`);
  return hits[0];
}

/** Open the profile's verified files and return its embedder. */
export async function createOnnxEmbedder(
  profile: EmbeddingProfile,
  modelDir: string,
  options: OnnxEmbedderOptions = {},
): Promise<Embedder> {
  if (profile.runtime.engine !== 'onnx' || !profile.source) throw new Error(`Profile "${profile.id}" is not an onnx profile`);
  await verifyWeights(profile, modelDir);

  const graph = await safeFilePath(profile, modelDir, fileNamed(profile, (p) => p.endsWith('.onnx'), 'graph (.onnx)'));
  const tokenizerPath = await safeFilePath(profile, modelDir, fileNamed(profile, (p) => p === 'tokenizer.json', 'tokenizer.json'));
  const configPath = await safeFilePath(profile, modelDir, fileNamed(profile, (p) => p === 'tokenizer_config.json', 'tokenizer_config.json'));
  const tokenizerJson = JSON.parse(await readFile(tokenizerPath, 'utf-8'));
  const tokenizerConfig = JSON.parse(await readFile(configPath, 'utf-8'));
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const pad = padId(tokenizerJson, tokenizerConfig.pad_token);

  const session = await ort.InferenceSession.create(graph, {
    executionProviders: ['cpu'],
    intraOpNumThreads: options.threads ?? 4,
  });
  return new OnnxEmbedder(profile, session, tokenizer as unknown as TokenizerLike, pad, options.batchSize ?? 16);
}

export class OnnxEmbedder implements Embedder {
  readonly profileId: string;
  readonly dimensions: number;

  constructor(
    private readonly profile: EmbeddingProfile,
    private readonly session: Pick<ort.InferenceSession, 'run' | 'inputNames' | 'release'>,
    private readonly tokenizer: TokenizerLike,
    private readonly pad: number,
    private readonly batchSize: number,
  ) {
    this.profileId = profile.id;
    this.dimensions = profile.runtime.dimensions;
  }

  async embed(kind: ProfileKind, items: EmbedItem[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      out.push(...(await this.runBatch(kind, items.slice(i, i + this.batchSize))));
    }
    return out;
  }

  release(): Promise<void> {
    return this.session.release();
  }

  private async runBatch(kind: ProfileKind, items: EmbedItem[]): Promise<number[][]> {
    if (items.length === 0) return [];
    const { runtime } = this.profile;
    const maxTokens = runtime.maxTokens ?? Number.MAX_SAFE_INTEGER;
    const ids = items.map((it) => encodeTruncated(this.tokenizer, applyPrompt(this.profile, kind, it.text, it.title), maxTokens));
    const seq = Math.max(...ids.map((r) => r.length));
    const mask = ids.map((r) => Array.from({ length: seq }, (_, t) => (t < r.length ? 1 : 0)));
    const flatIds = BigInt64Array.from(ids.flatMap((r) => [...r, ...new Array(seq - r.length).fill(this.pad)]).map(BigInt));
    const flatMask = BigInt64Array.from(mask.flat().map(BigInt));

    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', flatIds, [items.length, seq]),
      attention_mask: new ort.Tensor('int64', flatMask, [items.length, seq]),
    };
    const empty = runtime.emptyInputs;
    for (const name of this.session.inputNames) {
      if (name in feeds) continue;
      if (!empty || !empty.names.includes(name)) throw new Error(`graph input "${name}" has no feed in profile "${this.profile.id}"`);
      feeds[name] = new ort.Tensor(empty.type as 'float32', new Float32Array(0), empty.shape);
    }

    const results = await this.session.run(feeds);
    const output = results[runtime.output ?? 'sentence_embedding'];
    if (!output) throw new Error(`graph output "${runtime.output}" missing for profile "${this.profile.id}"`);
    const data = output.data as Float32Array;
    const dim = this.dimensions;

    let vectors: number[][];
    if (runtime.pooling === 'mean') {
      vectors = meanPool(data, mask, seq, dim);
    } else {
      if (output.dims.length !== 2 || output.dims[1] !== dim) {
        throw new Error(`graph output "${runtime.output}" has shape [${output.dims.join(', ')}], expected [n, ${dim}]`);
      }
      vectors = items.map((_, b) => Array.from(data.subarray(b * dim, (b + 1) * dim)));
    }
    return vectors.map((v) => {
      if (v.length !== dim) throw new Error(`embedding has ${v.length} dimensions, expected ${dim}`);
      return l2Normalize(v);
    });
  }
}
