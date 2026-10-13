import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  composeClassText,
  composeElementText,
  composeTechniqueText,
  composeMitigationText,
  getProfile,
  listProfiles,
  parseEmbeddingResponse,
  type EmbeddingProfile,
  type ProfileKind,
} from '@dethernety/dt-module/embedding';
import type { Embedder } from '@dethernety/embedder';
import { optionalNumber } from '../../config/optional-number';

/**
 * L2-normalize a single embedding vector to unit length. Used so runtime
 * query vectors carry the same magnitude as the build-time stored vectors
 * (mitre-frameworks/scripts/embedding_provider.py normalizes on emit). This
 * keeps cosine-similarity scores well-defined and bounded in [-1, 1] modulo
 * FP noise, regardless of whether the embedding endpoint (Ollama / OpenAI)
 * happens to return normalized vectors by default.
 */
function l2NormalizeBatch(vectors: number[][]): number[][] {
  return vectors.map((v) => {
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
    if (sumSq === 0) return v;
    const inv = 1 / Math.sqrt(sumSq);
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
    return out;
  });
}

/**
 * Whether an embedding request failed without a response: Node's fetch rejects with a TypeError when the endpoint
 * cannot be reached, and an aborted or timed-out request with an AbortError or a TimeoutError.
 */
export function isTransportFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
}

/**
 * An error as /health and the log show it. Node's fetch rejects with a bare "fetch failed" and keeps the reason
 * (a refused connection, a DNS failure) in `cause`, so the cause's message, or its code, goes with it.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause as { message?: unknown; code?: unknown } | undefined;
  const detail = cause && (typeof cause.message === 'string' && cause.message ? cause.message : typeof cause.code === 'string' ? cause.code : '');
  return detail && detail !== error.message ? `${error.message} (${detail})` : error.message;
}

/**
 * A configured similarity floor as a number. A cosine floor outside -1..1, or one that is not a number, would
 * filter out everything or nothing without a word, so it stops the start instead.
 */
function cosineFloor(name: string, value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < -1 || n > 1) {
    throw new Error(`${name} must be a number from -1 to 1 (a cosine similarity floor); got "${String(value)}"`);
  }
  return n;
}

export type EmbeddingCorpus = 'classes' | 'mitre' | 'components';

/** Where the embedder is. Only `ready` serves vectors. */
export type EmbedderState = 'disabled' | 'downloading' | 'loading' | 'ready' | 'failed';

export interface EmbedderStatus {
  enabled: boolean;
  runtime: 'onnx' | 'http';
  profileId: string;
  state: EmbedderState;
  error?: string;
}

const LEGACY_PROFILE_ID = 'embeddinggemma';
/**
 * The HTTP embedder's start-up check: three attempts of at most 10 s, 1 s and 3 s apart, so at most 34 s, well
 * inside the platform healthcheck's start period. After a failure it checks again every minute.
 */
const HTTP_CHECK_TIMEOUT_MS = 10_000;
const HTTP_CHECK_BACKOFF_MS = [1_000, 3_000];
const HTTP_RECHECK_MS = 60_000;
const CORPORA: EmbeddingCorpus[] = ['classes', 'mitre', 'components'];

/**
 * The platform's embedder. `EMBEDDING_MODEL` names an embedding profile:
 *
 * - A built-in ONNX profile runs in process. Its weights are fetched into EMBEDDING_MODEL_DIR (or
 *   found there already) and verified by sha256 in the background after start; until the session
 *   is loaded the embedder is not enabled, so callers fall back to their name tiers.
 * - Any other value selects the HTTP embedder (EMBEDDING_URL, an Ollama-compatible /api/embed) with
 *   that model name, under the `embeddinggemma` profile's thresholds.
 *
 * The profile decides the prompts, the dimensions and the per-corpus similarity thresholds.
 */
@Injectable()
export class EmbeddingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingService.name);
  /** EMBEDDING_ENABLED. Callers read isEnabled() before every resolve pass. */
  private readonly enabled: boolean;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly profile: EmbeddingProfile;
  private readonly runtime: 'onnx' | 'http';
  private readonly thresholds: Record<EmbeddingCorpus, number | null>;
  private readonly modelDir: string;
  private readonly threads: number;
  private state: EmbedderState;
  private stateError: string | undefined;
  private embedder: Embedder | null = null;
  private started: Promise<void> | null = null;
  private recheckTimer: ReturnType<typeof setInterval> | null = null;
  private rechecking = false;
  /** Set first on shutdown: no further check attempt, pause or recheck starts after it. */
  private destroyed = false;
  /** Cancels the check request in flight, so shutdown does not wait for its timeout. */
  private probeAbort: AbortController | null = null;
  /** Ends the start-up check's back-off pause early, on shutdown. */
  private wake: (() => void) | null = null;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get('EMBEDDING_ENABLED') === 'true';
    this.url = this.configService.get('EMBEDDING_URL') || 'http://localhost:11434/api/embed';
    this.apiKey = this.configService.get('EMBEDDING_API_KEY') || '';
    this.model = this.configService.get('EMBEDDING_MODEL') || LEGACY_PROFILE_ID;
    this.modelDir = this.configService.get('EMBEDDING_MODEL_DIR') || 'models';
    this.threads = optionalNumber(this.configService.get('EMBEDDING_THREADS')) ?? 4;

    const builtIn = listProfiles().find((p) => p.id === this.model);
    this.profile = builtIn ?? getProfile(LEGACY_PROFILE_ID);
    this.runtime = this.profile.runtime.engine === 'onnx' ? 'onnx' : 'http';
    if (this.enabled && !builtIn) {
      this.logger.warn(
        `EMBEDDING_MODEL "${this.model}" is not a built-in embedding profile; using the HTTP embedder at EMBEDDING_URL ` +
          `with the "${LEGACY_PROFILE_ID}" profile's thresholds. Built-in profiles: ${listProfiles().map((p) => p.id).join(', ')}`,
      );
    }

    const configuredDims = this.configService.get('EMBEDDING_DIMENSIONS');
    if (this.runtime === 'onnx') {
      this.dimensions = this.profile.runtime.dimensions;
      if (configuredDims && Number(configuredDims) !== this.dimensions) {
        this.logger.warn(`EMBEDDING_DIMENSIONS=${configuredDims} is ignored: profile "${this.profile.id}" has ${this.dimensions} dimensions`);
      }
    } else {
      this.dimensions = parseInt(configuredDims || String(this.profile.runtime.dimensions), 10);
    }

    this.thresholds = this.resolveThresholds();
    // The HTTP embedder is ready only once its endpoint has answered (see checkHttp).
    this.state = !this.enabled ? 'disabled' : this.runtime === 'onnx' ? 'downloading' : 'loading';

    this.logger.log('EmbeddingService initialized', {
      enabled: this.enabled,
      runtime: this.runtime,
      profile: this.profile.id,
      model: this.getModel(),
      dimensions: this.dimensions,
      thresholds: this.thresholds,
      url: this.enabled && this.runtime === 'http' ? this.url : undefined,
    });
  }

  /**
   * Per-corpus thresholds: EMBEDDING_THRESHOLD_<CORPUS> first, then (HTTP embedder only)
   * EMBEDDING_SIMILARITY_THRESHOLD, then the profile's value. A cosine floor; null means none.
   */
  private resolveThresholds(): Record<EmbeddingCorpus, number | null> {
    // Blank reads as unset, as the environment validation reads it; a set value keeps its raw text for the error.
    const legacyRaw = this.configService.get('EMBEDDING_SIMILARITY_THRESHOLD');
    const legacyValue = optionalNumber(legacyRaw) === undefined ? undefined : legacyRaw;
    if (legacyValue !== undefined && this.runtime === 'onnx') {
      this.logger.warn(
        `EMBEDDING_SIMILARITY_THRESHOLD is ignored under profile "${this.profile.id}"; ` +
          'set EMBEDDING_THRESHOLD_CLASSES, EMBEDDING_THRESHOLD_MITRE or EMBEDDING_THRESHOLD_COMPONENTS instead',
      );
    }
    const out = {} as Record<EmbeddingCorpus, number | null>;
    for (const corpus of CORPORA) {
      const name = `EMBEDDING_THRESHOLD_${corpus.toUpperCase()}`;
      const override = this.configService.get(name);
      if (optionalNumber(override) !== undefined) out[corpus] = cosineFloor(name, override);
      else if (this.runtime === 'http' && legacyValue !== undefined && corpus !== 'components') {
        out[corpus] = cosineFloor('EMBEDDING_SIMILARITY_THRESHOLD', legacyValue);
      } else out[corpus] = this.profile.thresholds[corpus];
    }
    return out;
  }

  onModuleInit(): void {
    if (this.enabled && this.runtime === 'onnx') this.started = this.startOnnx();
    if (this.enabled && this.runtime === 'http') this.started = this.checkHttp();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.probeAbort?.abort();
    this.wake?.();
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    this.recheckTimer = null;
    await this.started?.catch(() => undefined);
    await this.embedder?.release().catch(() => undefined);
  }

  /**
   * The HTTP embedder's start-up check: embed one short text, retried on a back-off, and expect a vector of the
   * configured dimensions. It also loads the model on the server, so the first real query does not pay for it.
   * Bounded by HTTP_CHECK_TIMEOUT_MS per attempt, so the worst case stays well inside the platform's healthcheck
   * start period. A failure leaves the embedder `failed` and checks again every HTTP_RECHECK_MS until the endpoint
   * answers. Never throws.
   */
  private async checkHttp(): Promise<void> {
    const started = Date.now();
    let lastError = '';
    for (let attempt = 1; attempt <= HTTP_CHECK_BACKOFF_MS.length + 1; attempt++) {
      if (this.destroyed) return;
      lastError = await this.probeHttp();
      if (this.destroyed) return;
      if (!lastError) {
        this.state = 'ready';
        this.stateError = undefined;
        this.logger.log('Embedder ready', { runtime: 'http', model: this.model, url: this.url, ms: Date.now() - started });
        return;
      }
      if (attempt <= HTTP_CHECK_BACKOFF_MS.length) await this.pause(HTTP_CHECK_BACKOFF_MS[attempt - 1]);
    }
    if (this.destroyed) return;
    this.state = 'failed';
    this.stateError = lastError;
    this.logger.error('Embedder unavailable; the vector tier stays off and the endpoint is checked again every minute', {
      runtime: 'http',
      model: this.model,
      url: this.url,
      error: lastError,
    });
    this.recheckTimer = setInterval(() => void this.recheckHttp(), HTTP_RECHECK_MS);
    this.recheckTimer.unref?.();
  }

  /** A back-off pause that shutdown ends at once. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }

  private async recheckHttp(): Promise<void> {
    if (this.destroyed || this.state !== 'failed' || this.rechecking) return;
    this.rechecking = true;
    try {
      const error = await this.probeHttp();
      if (this.destroyed) return;
      if (error) {
        this.stateError = error;
        return;
      }
      this.state = 'ready';
      this.stateError = undefined;
      if (this.recheckTimer) clearInterval(this.recheckTimer);
      this.recheckTimer = null;
      this.logger.log('Embedder ready', { runtime: 'http', model: this.model, url: this.url, recovered: true });
    } finally {
      this.rechecking = false;
    }
  }

  /** One check request. Returns '' when the endpoint answered with a vector of the configured dimensions, else why not. */
  private async probeHttp(): Promise<string> {
    const abort = new AbortController();
    this.probeAbort = abort;
    try {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(HTTP_CHECK_TIMEOUT_MS)]);
      const [vector] = (await this.postEmbed(['warm-up'], signal)) ?? [];
      if (!vector) return 'the endpoint returned no embedding';
      if (vector.length !== this.dimensions) {
        return `the endpoint returned ${vector.length} dimensions; EMBEDDING_DIMENSIONS is ${this.dimensions}`;
      }
      return '';
    } catch (error) {
      return describeError(error);
    } finally {
      if (this.probeAbort === abort) this.probeAbort = null;
    }
  }

  /** Fetch and verify the weights, open the session and warm it up. Never throws: failures set the state. */
  private async startOnnx(): Promise<void> {
    try {
      // Loaded only here, so a deployment on the HTTP embedder never loads the native runtime.
      const { ensureWeightsWithRetry, createOnnxEmbedder } = await import('@dethernety/embedder');
      this.state = 'downloading';
      await ensureWeightsWithRetry(this.profile, this.modelDir, {
        token: this.configService.get('HF_TOKEN') || undefined,
        log: (message, detail) => this.logger.log(message, detail),
      });
      this.state = 'loading';
      const embedder = await createOnnxEmbedder(this.profile, this.modelDir, { threads: this.threads });
      await embedder.embed('query', [{ text: 'warm-up' }]);
      this.embedder = embedder;
      this.state = 'ready';
      this.logger.log('Embedder ready', { profile: this.profile.id });
    } catch (error) {
      this.state = 'failed';
      this.stateError = describeError(error);
      this.logger.error('Embedder unavailable; the vector tier stays off', { profile: this.profile.id, error: this.stateError });
    }
  }

  /** Resolves once the background start has finished, ready or failed. For tests and tooling. */
  whenSettled(): Promise<void> {
    return this.started ?? Promise.resolve();
  }

  /**
   * Resolves once the HTTP embedder's start-up check has finished, ready or failed; at once for the in-process
   * embedder, whose download can take minutes. The start-up module install waits on it, so a reachable endpoint
   * is ready before the install embeds the classes.
   */
  whenStartupChecked(): Promise<void> {
    return this.runtime === 'http' && this.started ? this.started : Promise.resolve();
  }

  isEnabled(): boolean {
    return this.enabled && this.state === 'ready';
  }

  /**
   * Enabled by configuration, but not able to embed: the model is still
   * downloading or loading, or it failed to. Vectors already stored stay valid for when it is ready, so a caller
   * keeps them rather than treating this as "disabled".
   */
  isPending(): boolean {
    return this.enabled && this.state !== 'ready';
  }

  /** The embedder's state: disabled, downloading, loading, ready or failed. */
  getState(): EmbedderState {
    return this.state;
  }

  /** The value stored as `embeddingModel` next to every vector this service makes. */
  getModel(): string {
    return this.runtime === 'onnx' ? this.profile.id : this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  /** The similarity floor (cosine) for a corpus; null for no floor. */
  getThreshold(corpus: 'classes' | 'mitre'): number;
  getThreshold(corpus: EmbeddingCorpus): number | null;
  getThreshold(corpus: EmbeddingCorpus): number | null {
    return this.thresholds[corpus];
  }

  getStatus(): EmbedderStatus {
    return {
      enabled: this.enabled,
      runtime: this.runtime,
      profileId: this.profile.id,
      state: this.state,
      ...(this.stateError ? { error: this.stateError } : {}),
    };
  }

  /**
   * Embed a batch of texts as queries or as documents. A document's title (its name) feeds the
   * profile's title rule. Returns null if the embedder is not enabled. The HTTP embedder applies no
   * prompt and retries up to 3 times with exponential backoff (1s, 3s, 9s); both throw on failure.
   */
  async embedBatch(texts: string[], kind: ProfileKind, titles?: string[]): Promise<number[][] | null> {
    if (!this.isEnabled()) return null;
    if (this.runtime === 'onnx') {
      return this.embedder!.embed(
        kind,
        texts.map((text, i) => ({ text, title: titles?.[i] })),
      );
    }
    return this.embedOverHttp(texts);
  }

  /**
   * Embeds the texts of one request in one batch and returns one vector per text, in order. When the batch fails with
   * a response (an error status, a malformed body), returns another number of vectors, or the in-process embedder
   * throws, each text is embedded on its own, once and without the HTTP retries the batch already used, so a text
   * that cannot be embedded costs only its own vector (null, with its error in `failures`). A batch of one is not
   * tried again, and an HTTP request that got no response (the endpoint unreachable, a timeout) fails every text at
   * once: it is not about any text. Every vector is null when the embedder is not enabled.
   */
  async embedEach(
    texts: string[],
    kind: ProfileKind,
  ): Promise<{ vectors: Array<number[] | null>; failures: Array<{ index: number; error: unknown }> }> {
    if (texts.length === 0) return { vectors: [], failures: [] };
    const allFail = (error: unknown) => ({ vectors: texts.map(() => null), failures: texts.map((_t, index) => ({ index, error })) });
    try {
      const batch = await this.embedBatch(texts, kind);
      if (!batch) return { vectors: texts.map(() => null), failures: [] };
      if (batch.length === texts.length) return { vectors: batch, failures: [] };
      if (texts.length === 1) return allFail(new Error(`the embedder returned ${batch.length} vectors for 1 text`));
    } catch (error) {
      if (texts.length === 1 || (this.runtime === 'http' && isTransportFailure(error))) return allFail(error);
      // Falls through to one text at a time, so one bad text does not take the others' vectors with it.
    }
    const vectors: Array<number[] | null> = [];
    const failures: Array<{ index: number; error: unknown }> = [];
    for (let index = 0; index < texts.length; index++) {
      try {
        vectors.push(await this.embedOnce(texts[index], kind));
      } catch (error) {
        vectors.push(null);
        failures.push({ index, error });
      }
    }
    return { vectors, failures };
  }

  /** One text in one attempt: the per-text fallback, after the batch has used the HTTP retries. */
  private async embedOnce(text: string, kind: ProfileKind): Promise<number[] | null> {
    if (!this.isEnabled()) return null;
    const vectors = this.runtime === 'onnx' ? await this.embedder!.embed(kind, [{ text }]) : await this.postEmbed([text]);
    return vectors?.[0] ?? null;
  }

  private async embedOverHttp(texts: string[]): Promise<number[][] | null> {
    const maxRetries = 3;
    const backoffBase = 1000; // 1s, 3s, 9s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.postEmbed(texts);
      } catch (error) {
        if (attempt === maxRetries) throw error;
        const delay = backoffBase * Math.pow(3, attempt - 1);
        this.logger.warn(
          `Embedding attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`,
          { error: error instanceof Error ? error.message : String(error) },
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Unreachable — loop either returns or throws on final attempt
    return null;
  }

  /** One request to the HTTP endpoint. Throws on a failed request; null when the response carries no vectors. */
  private async postEmbed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Embedding API returned ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    const parsed = parseEmbeddingResponse(data, texts.length);
    // L2-normalize to match the build-side unit-vector contract
    // (mitre-frameworks/scripts/embedding_provider.py). Idempotent on
    // already-unit vectors.
    return parsed ? l2NormalizeBatch(parsed) : parsed;
  }

  /**
   * Compose the embedding text for a class node. Delegates to the shared
   * helper so runtime and build-time tooling produce identical text.
   */
  composeClassText(cls: {
    name: string;
    description?: string;
    category?: string;
    type?: string;
  }): string {
    return composeClassText(cls);
  }

  /**
   * Compose the embedding text for a query element (match_classes input side).
   */
  composeElementText(element: {
    name: string;
    description?: string;
    type?: string;
  }): string {
    return composeElementText(element);
  }

  /**
   * Compose the embedding text for a MITRE technique (ATT&CK or D3FEND).
   * Delegates to the dt-module helper so runtime and build-time
   * tooling produce byte-equal text.
   */
  composeTechniqueText(t: {
    name: string;
    description?: string;
    tactic?: string;
  }): string {
    return composeTechniqueText(t);
  }

  /**
   * Compose the embedding text for a MITRE mitigation. Same byte-equality
   * contract as composeTechniqueText.
   */
  composeMitigationText(m: { name: string; description?: string }): string {
    return composeMitigationText(m);
  }
}
