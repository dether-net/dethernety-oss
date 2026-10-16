import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  composeClassText,
  composeElementText,
  composeTechniqueText,
  composeMitigationText,
  type EmbeddingProfile,
  type ProfileKind,
} from '@dethernety/dt-module/embedding';
import type { Embedder } from '@dethernety/embedder';
import { embeddingEnabled, selectEmbeddingProfile } from '../../config/embedding-profile-selection';
import { optionalNumber } from '../../config/optional-number';

/**
 * An error as /health and the log show it. A failed download rejects with a bare "fetch failed" and keeps the reason
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
  runtime: 'onnx';
  profileId: string;
  state: EmbedderState;
  error?: string;
}

/**
 * Settings of the HTTP embedder the platform no longer has. An upgraded environment may still carry them: they are
 * ignored, with a warning, and never stop a start. (A module may read some of them for an embedder of its own.)
 */
const IGNORED_SETTINGS: Record<string, string> = {
  EMBEDDING_URL: '',
  EMBEDDING_API_KEY: '',
  EMBEDDING_DIMENSIONS: ' (the profile sets the dimensions)',
  EMBEDDING_SIMILARITY_THRESHOLD: '; set EMBEDDING_THRESHOLD_CLASSES, EMBEDDING_THRESHOLD_MITRE or EMBEDDING_THRESHOLD_COMPONENTS instead',
};
/**
 * How long the start-up install waits for an in-process embedder whose files are already in place (verify, load and
 * warm-up took about 8 s on a 4-CPU host): the platform healthcheck's start period. A download is never waited for.
 */
const ONNX_STARTUP_WAIT_MS = 60_000;
/** How long a shutdown waits for a model load in progress (it cannot be ended; a stop's grace period is about 10 s). */
const SHUTDOWN_WAIT_MS = 5_000;
const CORPORA: EmbeddingCorpus[] = ['classes', 'mitre', 'components'];

/**
 * The platform's embedder: an embedding profile run in process. `EMBEDDING_MODEL` names the profile, and only the
 * profiles this release offers start (config/embedding-profile-selection.ts). Its weights are fetched into
 * EMBEDDING_MODEL_DIR (or found there already) and verified by sha256 in the background after start; until the session
 * is loaded the embedder is not enabled, so callers fall back to their name tiers.
 *
 * The profile decides the prompts, the dimensions and the per-corpus similarity thresholds.
 */
@Injectable()
export class EmbeddingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingService.name);
  /** EMBEDDING_ENABLED. Callers read isEnabled() before every resolve pass. */
  private readonly enabled: boolean;
  private readonly dimensions: number;
  private readonly profile: EmbeddingProfile;
  private readonly thresholds: Record<EmbeddingCorpus, number | null>;
  private readonly modelDir: string;
  private readonly threads: number;
  private state: EmbedderState;
  private stateError: string | undefined;
  private embedder: Embedder | null = null;
  /** The worker being warmed up, until it is ready: a shutdown then releases it, which ends the warm-up. */
  private starting: Embedder | null = null;
  private started: Promise<void> | null = null;
  /** Set first on shutdown. */
  private destroyed = false;
  /** Ends a weight download in flight, or its retry wait, on shutdown. */
  private readonly stop = new AbortController();
  /** Whether the in-process embedder's files were already in place at start (no download due). */
  private weightsInPlace: Promise<boolean> | null = null;
  /** Called on each move into `ready` (see onReady). */
  private readonly readyListeners = new Set<() => void>();

  constructor(private readonly configService: ConfigService) {
    const enabledRaw = this.configService.get('EMBEDDING_ENABLED');
    this.enabled = embeddingEnabled(enabledRaw);
    this.profile = selectEmbeddingProfile({ enabled: enabledRaw, model: this.configService.get('EMBEDDING_MODEL') });
    this.modelDir = this.configService.get('EMBEDDING_MODEL_DIR') || 'models';
    this.threads = optionalNumber(this.configService.get('EMBEDDING_THREADS')) ?? 4;
    this.dimensions = this.profile.runtime.dimensions;

    if (this.enabled) {
      for (const [name, hint] of Object.entries(IGNORED_SETTINGS)) {
        const value = this.configService.get(name);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          this.logger.warn(`${name} is ignored by the platform's embedder, which runs in process${hint}`);
        }
      }
    }

    this.thresholds = this.resolveThresholds();
    this.state = this.enabled ? 'downloading' : 'disabled';

    this.logger.log('EmbeddingService initialized', {
      enabled: this.enabled,
      runtime: 'onnx',
      profile: this.profile.id,
      dimensions: this.dimensions,
      thresholds: this.thresholds,
    });
  }

  /** Per-corpus thresholds: EMBEDDING_THRESHOLD_<CORPUS> first, then the profile's value. A cosine floor; null means none. */
  private resolveThresholds(): Record<EmbeddingCorpus, number | null> {
    const out = {} as Record<EmbeddingCorpus, number | null>;
    for (const corpus of CORPORA) {
      const name = `EMBEDDING_THRESHOLD_${corpus.toUpperCase()}`;
      const override = this.configService.get(name);
      out[corpus] = optionalNumber(override) !== undefined ? cosineFloor(name, override) : this.profile.thresholds[corpus];
    }
    return out;
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.weightsInPlace = this.checkWeightsInPlace();
      this.started = this.startOnnx();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.stop.abort(new Error('the platform is shutting down'));
    // A worker in its warm-up is released now (its pending embed then rejects), not waited for. A load in progress
    // cannot be ended from here: the wait for it is bounded, and a worker it delivers later is released by startOnnx.
    await this.starting?.release().catch(() => undefined);
    if (this.started) {
      let timer: NodeJS.Timeout | undefined;
      const bounded = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        timer.unref();
      });
      await Promise.race([this.started.catch(() => undefined), bounded]);
      clearTimeout(timer);
    }
    const embedder = this.embedder;
    this.embedder = null;
    await embedder?.release().catch(() => undefined);
  }

  /**
   * Fetch and verify the weights, start the embedder's worker thread (it opens the session there, so neither the load
   * nor any later embed runs on this event loop) and warm it up. Never throws: failures set the state. A worker that
   * fails after it was ready (it exited or crashed) sets the state to failed with the reason; the vector tier stays off
   * until the next start, as after a failed load.
   */
  private async startOnnx(): Promise<void> {
    let embedder: Embedder | undefined;
    try {
      // Loaded only here, so a deployment with embedding off never loads the native runtime.
      const { ensureWeightsWithRetry, createWorkerEmbedder } = await import('@dethernety/embedder');
      this.state = 'downloading';
      if (!(await this.weightsInPlace) && this.profile.source) {
        const bytes = this.profile.source.files.reduce((sum, f) => sum + f.bytes, 0);
        this.logger.log('Downloading the embedding model once; it stays in the models directory', {
          profile: this.profile.id,
          bytes,
          dir: this.modelDir,
          ...(this.profile.licence ? { licence: this.profile.licence.name, licenceUrl: this.profile.licence.url } : {}),
        });
      }
      await ensureWeightsWithRetry(this.profile, this.modelDir, {
        token: this.configService.get('HF_TOKEN') || undefined,
        log: (message, detail) => this.logger.log(message, detail),
        signal: this.stop.signal,
      });
      // A shutdown that came during the download's last moments: do not start loading a model nobody will use.
      this.stop.signal.throwIfAborted();
      this.state = 'loading';
      embedder = await createWorkerEmbedder(this.profile, this.modelDir, {
        threads: this.threads,
        onFailure: (error) => {
          if (!embedder || this.embedder !== embedder) return;
          this.embedder = null;
          this.state = 'failed';
          this.stateError = describeError(error);
          this.logger.error('Embedder failed; the vector tier stays off until the next start', { profile: this.profile.id, error: this.stateError });
        },
      });
      if (this.destroyed) {
        // The shutdown came during the load: nobody will use this worker.
        await embedder.release().catch(() => undefined);
        return;
      }
      this.starting = embedder;
      await embedder.embed('query', [{ text: 'warm-up' }]);
      this.starting = null;
      if (this.destroyed) {
        await embedder.release().catch(() => undefined);
        return;
      }
      this.embedder = embedder;
      this.state = 'ready';
      this.logger.log('Embedder ready', { profile: this.profile.id });
      this.announceReady();
    } catch (error) {
      this.state = 'failed';
      this.stateError = describeError(error);
      if (this.destroyed) {
        // A shutdown during the start ended it (onModuleDestroy aborts the download): not a failure to report.
        this.logger.debug('Embedder start ended by the shutdown', { profile: this.profile.id, error: this.stateError });
      } else {
        this.logger.error('Embedder unavailable; the vector tier stays off', { profile: this.profile.id, error: this.stateError });
      }
      this.starting = null;
      // A worker that loaded but failed its warm-up still holds the session and its thread: end it.
      if (embedder && embedder !== this.embedder) await embedder.release().catch(() => undefined);
    }
  }

  /** Resolves once the background start has finished, ready or failed. For tests and tooling. */
  whenSettled(): Promise<void> {
    return this.started ?? Promise.resolve();
  }

  /**
   * What the start-up module install waits for before it embeds the classes: the embedder's start, ready or failed,
   * when its files were already in place, for at most ONNX_STARTUP_WAIT_MS; at once when a download is due, which can
   * take minutes. The install that runs before the embedder is ready is caught up when it becomes ready (onReady). The
   * model loads on the embedder's worker thread, so the wait is a real bound, and the worker's own load timeout fails a
   * load that hangs.
   */
  async whenStartupChecked(): Promise<void> {
    if (!this.started) return;
    if (!(await this.weightsInPlace)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ONNX_STARTUP_WAIT_MS);
      timer.unref?.();
    });
    const outcome = await Promise.race([this.started.then(() => 'settled' as const), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      this.logger.warn('Embedder not ready after the start-up wait; the module install continues and catches up when it is', {
        profile: this.profile.id,
        waitedMs: ONNX_STARTUP_WAIT_MS,
      });
    }
  }

  /** Calls `listener` each time the embedder moves into `ready` (once loaded). Returns a function that removes it. */
  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private announceReady(): void {
    if (this.destroyed) return;
    for (const listener of this.readyListeners) {
      try {
        listener();
      } catch (error) {
        this.logger.warn('An embedder-ready listener failed', { error: describeError(error) });
      }
    }
  }

  /** Whether the in-process embedder's files are already in place, by size (see weightsPlaced). Never throws. */
  private async checkWeightsInPlace(): Promise<boolean> {
    try {
      const { weightsPlaced } = await import('@dethernety/embedder');
      return await weightsPlaced(this.profile, this.modelDir);
    } catch (error) {
      this.logger.debug('Could not tell whether the embedder files are in place; the start-up install will not wait', {
        error: describeError(error),
      });
      return false;
    }
  }

  /** Ready to embed. False from the start of a shutdown on, so no new embedding starts while the worker is released. */
  isEnabled(): boolean {
    return this.enabled && this.state === 'ready' && !this.destroyed;
  }

  /**
   * Enabled by configuration, but not able to embed: the model is still
   * downloading or loading, or it failed to. Vectors already stored stay valid for when it is ready, so a caller
   * keeps them rather than treating this as "disabled".
   */
  isPending(): boolean {
    return this.enabled && (this.state !== 'ready' || this.destroyed);
  }

  /** The embedder's state: disabled, downloading, loading, ready or failed. */
  getState(): EmbedderState {
    return this.state;
  }

  /** The value stored as `embeddingModel` next to every vector this service makes: the profile id. */
  getModel(): string {
    return this.profile.id;
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
      runtime: 'onnx',
      profileId: this.profile.id,
      state: this.state,
      ...(this.stateError ? { error: this.stateError } : {}),
    };
  }

  /**
   * Embed a batch of texts as queries or as documents. A document's title (its name) feeds the
   * profile's title rule. Returns null if the embedder is not enabled; throws on failure.
   */
  async embedBatch(texts: string[], kind: ProfileKind, titles?: string[]): Promise<number[][] | null> {
    if (!this.isEnabled()) return null;
    return this.embedder!.embed(
      kind,
      texts.map((text, i) => ({ text, title: titles?.[i] })),
    );
  }

  /**
   * Embeds the texts of one request in one batch and returns one vector per text, in order. When the batch throws or
   * returns another number of vectors, each text is embedded on its own, once, so a text that cannot be embedded costs
   * only its own vector (null, with its error in `failures`). A batch of one is not tried again. Every vector is null
   * when the embedder is not enabled.
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
      if (texts.length === 1) return allFail(error);
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

  /** One text in one attempt: the per-text fallback after a failed batch. */
  private async embedOnce(text: string, kind: ProfileKind): Promise<number[] | null> {
    if (!this.isEnabled()) return null;
    const vectors = await this.embedder!.embed(kind, [{ text }]);
    return vectors?.[0] ?? null;
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
