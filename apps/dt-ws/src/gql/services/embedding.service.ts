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
  /**
   * Session-level enabled flag. Starts from EMBEDDING_ENABLED and can be
   * flipped to false by disableForSession() — for example when
   * MatchClassesResolverService detects an index-dimension mismatch. Callers
   * read isEnabled() before every resolve pass; the flag is never flipped
   * back on within a process lifetime.
   */
  private enabled: boolean;
  private sessionDisabled = false;
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

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get('EMBEDDING_ENABLED') === 'true';
    this.url = this.configService.get('EMBEDDING_URL') || 'http://localhost:11434/api/embed';
    this.apiKey = this.configService.get('EMBEDDING_API_KEY') || '';
    this.model = this.configService.get('EMBEDDING_MODEL') || LEGACY_PROFILE_ID;
    this.modelDir = this.configService.get('EMBEDDING_MODEL_DIR') || 'models';
    this.threads = Number(this.configService.get('EMBEDDING_THREADS') || 4);

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
    this.state = !this.enabled ? 'disabled' : this.runtime === 'onnx' ? 'downloading' : 'ready';

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
    const legacyValue = this.configService.get('EMBEDDING_SIMILARITY_THRESHOLD');
    if (legacyValue !== undefined && legacyValue !== '' && this.runtime === 'onnx') {
      this.logger.warn(
        `EMBEDDING_SIMILARITY_THRESHOLD is ignored under profile "${this.profile.id}"; ` +
          'set EMBEDDING_THRESHOLD_CLASSES, EMBEDDING_THRESHOLD_MITRE or EMBEDDING_THRESHOLD_COMPONENTS instead',
      );
    }
    const out = {} as Record<EmbeddingCorpus, number | null>;
    for (const corpus of CORPORA) {
      const override = this.configService.get(`EMBEDDING_THRESHOLD_${corpus.toUpperCase()}`);
      if (override !== undefined && override !== '') out[corpus] = Number(override);
      else if (this.runtime === 'http' && legacyValue !== undefined && legacyValue !== '' && corpus !== 'components') out[corpus] = Number(legacyValue);
      else out[corpus] = this.profile.thresholds[corpus];
    }
    return out;
  }

  onModuleInit(): void {
    if (this.enabled && this.runtime === 'onnx') this.started = this.startOnnx();
  }

  async onModuleDestroy(): Promise<void> {
    await this.started?.catch(() => undefined);
    await this.embedder?.release().catch(() => undefined);
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
      this.stateError = error instanceof Error ? error.message : String(error);
      this.logger.error('Embedder unavailable; the vector tier stays off', { profile: this.profile.id, error: this.stateError });
    }
  }

  /** Resolves once the background start has finished, ready or failed. For tests and tooling. */
  whenSettled(): Promise<void> {
    return this.started ?? Promise.resolve();
  }

  isEnabled(): boolean {
    return this.enabled && !this.sessionDisabled && this.state === 'ready';
  }

  /**
   * Enabled by configuration and not switched off for the session, but not able to embed: the model is still
   * downloading or loading, or it failed to. Vectors already stored stay valid for when it is ready, so a caller
   * keeps them rather than treating this as "disabled".
   */
  isPending(): boolean {
    return this.enabled && !this.sessionDisabled && this.state !== 'ready';
  }

  /** The embedder's state: disabled, downloading, loading, ready or failed. */
  getState(): EmbedderState {
    return this.sessionDisabled ? 'disabled' : this.state;
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
      state: this.sessionDisabled ? 'disabled' : this.state,
      ...(this.stateError ? { error: this.stateError } : {}),
    };
  }

  /**
   * Disable embedding for the remainder of this process. Called when the
   * runtime detects an unrecoverable invariant break (most notably, a
   * vector-index dimension that disagrees with EMBEDDING_DIMENSIONS).
   *
   * After this is called, isEnabled() returns false and embedBatch()
   * returns null. Logs exactly once.
   */
  disableForSession(reason: string): void {
    if (this.sessionDisabled) return;
    this.sessionDisabled = true;
    this.enabled = false;
    this.logger.error('Embedding disabled for this session', { reason });
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

  private async embedOverHttp(texts: string[]): Promise<number[][] | null> {
    const maxRetries = 3;
    const backoffBase = 1000; // 1s, 3s, 9s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: this.model, input: texts }),
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
