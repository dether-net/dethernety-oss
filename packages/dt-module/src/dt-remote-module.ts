/**
 * A module that serves its content — metadata, class templates, guides,
 * embeddings, and evaluation — from an HTTP content service over the v1 wire
 * protocol, instead of from a local data directory. It is a sibling of
 * {@link DtFileOpaModule}: it satisfies the exact same {@link DTModule} contract,
 * so the platform cannot tell it apart from a file-backed module. Every
 * difference (network, caching, denial-as-fallback, not-evaluated) is expressed
 * through that contract — a returned template, a returned finding list, or a
 * thrown error — never a new platform hook.
 *
 * It is the lighter of the two implementations: no policy engine (evaluation is
 * remote), no cloud SDK — just HTTPS via the {@link WireClient} plus the shared
 * interfaces already in this package.
 */
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { DTModule } from './interfaces/module-interface';
import { DTMetadata } from './interfaces/module-metadata-interface';
import { Exposure } from './interfaces/exposure-interface';
import { Countermeasure } from './interfaces/countermeasure-interface';
import { DbOps } from './db-ops';
import { embeddingVectorDefect, slugifyModelName } from './embedding-text';
import { FetchLike, WireClient } from './remote/wire-client';
import { CachedModule, MetadataCache, SERVED_CLASS_ARRAYS, countClasses } from './remote/metadata-cache';
import {
  ContentRecalledError,
  DenialInfo,
  EvaluationNotEntitledError,
  RemoteModuleUnavailableError,
} from './remote/errors';
import { ResponseCache, ContentKind, EvalResult, stableStringify } from './remote/response-cache';
import { buildFallbackGuide, buildFallbackTemplate, sanitizeText } from './remote/fallback';
import { JsonSchema, stripToSchema } from './remote/strip';
import { deploymentTeamId } from './remote/team-id';

/** A burst of fallbacks logs one warn per reason in this window; the next warn carries how many went unlogged. */
const FALLBACK_WARN_INTERVAL_MS = 60_000;

/** Why a template or guide was served as the read-only fallback. */
type FallbackReason = 'no-credential' | 'denied' | 'unavailable';

/** At most one background refresh, or one retry of a failed registration, starts
 * per interval, so a probe that calls getMetadata continuously cannot keep the
 * content service busy. */
const REFRESH_INTERVAL_MS = 60_000;

/** Whether less than REFRESH_INTERVAL_MS has passed since `at`. A clock stepped
 * back counts as elapsed, so it cannot hold a retry off. */
function withinRefreshInterval(at: number): boolean {
  const since = Date.now() - at;
  return since >= 0 && since < REFRESH_INTERVAL_MS;
}

/** The per-module identity a mount stub supplies: which module, at which pinned
 * (immutable, content-hash) version. */
export interface RemoteModuleConfig {
  moduleKey: string;
  pin: string;
}

/** Internal construction seam — tests inject an in-process mock, a temp cache
 * directory and a team here. The mount stub never passes it; the deployment reads
 * the base URL, the cache directory and its team from the environment. */
export interface RemoteModuleDeps {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  cacheDir?: string;
  teamId?: string;
}

export class DtRemoteModule implements DTModule {
  protected readonly moduleKey: string;
  protected readonly pin: string;
  protected readonly logger: Logger;
  protected readonly wire: WireClient;
  protected readonly cache: MetadataCache;
  protected readonly responseCache = new ResponseCache();
  protected readonly dbOps: DbOps;

  /** The single origin denial action URLs may point at (pinned from /meta). */
  protected portalOrigin?: string;
  /** slug → (className → vector), rebuilt from the registered document. */
  private vectors = new Map<string, Map<string, number[]>>();
  /** Per fallback reason: when it was last logged, and how many fallbacks since went unlogged. */
  private readonly fallbackWarns = new Map<FallbackReason, { at: number; unlogged: number }>();
  /** The entry this module registered from: set by the first getMetadata that
   * succeeds, and replaced when a background refresh fetches the configured pin. */
  private registered?: CachedModule;
  /** The registration in flight, shared by concurrent callers. */
  private registering?: Promise<CachedModule>;
  /** The last failed registration, answered again without the network
   * within the interval. */
  private lastFailure?: { at: number; error: unknown };
  /** When the last background refresh started. */
  private lastRefreshAt?: number;

  constructor(config: RemoteModuleConfig, driver: unknown, logger?: Logger, deps?: RemoteModuleDeps) {
    this.moduleKey = config.moduleKey;
    this.pin = config.pin;
    this.logger = logger ?? new Logger('DtRemoteModule');

    // Deployment-global base URL; no baked default, so an unconfigured
    // deployment leaves the module inert rather than pointing at a host.
    const baseUrl = deps?.baseUrl ?? process.env.MODULE_CONTENT_BASE_URL;
    // Which team this deployment belongs to, so entitled calls can be scoped. Absent leaves them naming
    // no team — which the content service still answers while it counts how many deployments have not
    // been told theirs, and will refuse once it stops counting.
    const teamId = deps?.teamId ?? deploymentTeamId();
    this.wire = new WireClient({ baseUrl, fetchImpl: deps?.fetchImpl, teamId });
    this.cache = new MetadataCache({
      dir: deps?.cacheDir,
      explicitDir: deps?.cacheDir !== undefined,
      logger: this.logger,
    });
    this.dbOps = new DbOps(driver);
  }

  /**
   * Template and guide content may vary by the calling user (entitlement), so
   * the host must not cache it under a caller-agnostic key. Evaluation results
   * never vary by caller — they persist to the shared model graph.
   */
  isContentCallerVariant(): boolean {
    return true;
  }

  /**
   * Register the module's classes. Resolution order until the module has
   * registered (never throws once it has ever registered, so the platform's
   * obsolescence sweep never fires):
   *   exact-pin cache (immutable → authoritative, offline-fast)
   *     → live fetch (module document + embeddings, persisted)
   *       → newest cached document for this module (offline pin-miss → stay registered)
   *         → throw only when nothing was ever cached (safe first boot).
   * Concurrent calls share one registration, and a failed one is answered again
   * for a minute without the network.
   *
   * Once registered it answers at once from the entry it registered, and leaves
   * pinning the portal origin and fetching an uncached pin to a background
   * refresh: the platform health-probes getMetadata against a short timeout, and
   * a slow content service must not fail a registered module's probe. A module
   * registered from another pin keeps serving that entry until the background
   * fetch of its own pin succeeds; an install made before then installs that
   * entry, and the next install after it (at the latest the next start) installs
   * its own pin's classes.
   */
  async getMetadata(): Promise<DTMetadata> {
    if (this.registered) {
      this.refreshInBackground(this.registered);
      return this.registered.document.module;
    }
    if (this.lastFailure && withinRefreshInterval(this.lastFailure.at)) throw this.lastFailure.error;
    this.registering ??= this.register()
      .catch((error: unknown) => {
        this.lastFailure = { at: Date.now(), error };
        throw error;
      })
      .finally(() => {
        this.registering = undefined;
      });
    return (await this.registering).document.module;
  }

  /**
   * Return a pre-computed embedding vector for a class by name. Synchronous by
   * contract — the platform accessor cannot await — answering only from vectors
   * prefetched at registration; a cold or unknown lookup is `null`, never a
   * network call and never a throw.
   */
  getEmbedding(className: string, embeddingModel: string): number[] | null {
    if (!embeddingModel) return null;
    const slug = slugifyModelName(embeddingModel);
    // Copy on return — the cached array is shared for the module's lifetime, so an in-place
    // normalization by a consumer must not corrupt it (same contract as EmbeddingFileCache).
    const vector = this.vectors.get(slug)?.get(className);
    return vector ? vector.slice() : null;
  }

  /**
   * Serve a class's configuration template. Forwards the caller's bearer to the
   * entitled content surface and returns the served template verbatim (already
   * normalized by the publisher — the client does not re-normalize). An absent
   * token, an entitlement denial, or a transient outage renders as a valid,
   * self-sanitized read-only fallback; a 401/410/misconfiguration propagates.
   */
  getClassTemplate(id: string, token?: string): Promise<string> {
    return this.serveContent('template', id, token);
  }

  getClassGuide(id: string, token?: string): Promise<string> {
    return this.serveContent('guide', id, token);
  }

  /**
   * Evaluate one element against its class policy in the cloud, returning the
   * exposures. Reads attributes locally, strips them to schema-declared keys
   * (payload minimization), evaluates in one round trip, and caches
   * deterministically. A denied /
   * expired / recalled / unavailable evaluation THROWS a typed error — never `[]`,
   * which would masquerade as an evaluated-clean result and overwrite prior findings.
   */
  async getExposures(id: string, classId: string, token?: string): Promise<Exposure[]> {
    return (await this.evaluate(id, classId, token)).exposures;
  }

  async getCountermeasures(id: string, classId: string, token?: string): Promise<Countermeasure[]> {
    return (await this.evaluate(id, classId, token)).countermeasures;
  }

  // --- Evaluation internals --------------------------------------------------

  /** One element evaluation is one round trip returning both finding kinds; the
   * caller hands back the half the platform asked for. Never returns `[]` for a
   * not-evaluated state — it throws, so the platform's finding write is skipped
   * and prior persisted findings survive. */
  private async evaluate(id: string, classId: string, token?: string): Promise<EvalResult> {
    // No credential to reach the entitled eval surface (old platform / dev-NOAUTH):
    // not-evaluated, surfaced as a handled module error — never a fabricated clean result.
    if (!token) {
      throw new RemoteModuleUnavailableError('Evaluation requires an authenticated cloud session');
    }
    try {
      const raw = await this.dbOps.getInstantiationAttributes(id, classId);
      // `null` means no such element node (getInstantiationAttributes returns `{}` for an
      // element that exists but has no instantiation attributes, `null` only when the MATCH
      // finds no node). Evaluating a non-existent element against empty input would fabricate a
      // clean result — this module's contract is to throw for a not-evaluated state, never to
      // synthesise one — so fail loud before the round trip.
      if (raw === null) {
        throw new RemoteModuleUnavailableError(`Element "${id}" was not found for evaluation`);
      }
      const schema = await this.schemaFor(classId, token); // hard precondition — throws if unobtainable
      const attributes = stripToSchema(raw, schema); // the schema is the allowlist
      const hash = attributesHash(attributes);

      const cached = this.responseCache.getEval(classId, this.pin, hash);
      if (cached) return cached;

      const resp = await this.wire.evaluate(classId, this.pin, token, {
        requestId: crypto.randomUUID(),
        attributes,
      });
      const result: EvalResult = {
        exposures: resp.exposures ?? [],
        countermeasures: resp.countermeasures ?? [],
      };
      this.responseCache.putEval(classId, this.pin, hash, result);
      return result;
    } catch (err) {
      if (err instanceof ContentRecalledError) this.responseCache.evictPin(this.pin);
      throw sanitizeError(err);
    }
  }

  /** The strip allowlist is the class schema. Fetched via the RAW wire template
   * with eval-outcome mapping — never getClassTemplate, whose 403 fallback would
   * hand back a minimal-schema template and silently corrupt the allowlist (a
   * strip-to-empty eval would masquerade as evaluated-clean). Immutable at the
   * pin, cached per class for every caller. */
  private async schemaFor(classId: string, token: string): Promise<JsonSchema> {
    const cached = this.responseCache.getSchema(classId, this.pin);
    if (cached) return cached;
    const template = await this.wire.template(classId, this.pin, token);
    const schema = (template.template.schema ?? {}) as JsonSchema;
    this.responseCache.putSchema(classId, this.pin, schema);
    return schema;
  }

  // --- Content internals -----------------------------------------------------

  /** Shared template/guide path: forward the token, cache the account-invariant
   * content behind a per-caller entitlement memo, and degrade to a self-sanitized
   * fallback on denial / absent token / transient outage. */
  private async serveContent(kind: ContentKind, id: string, token?: string): Promise<string> {
    // Old platform / dev-NOAUTH: no credential to forward — never fabricate one.
    if (!token) return this.serveFallback(kind, id, 'no-credential');

    // Warm entitled memo + cached content → zero round trip. Gating the cached
    // return on THIS caller's entitled memo is what stops A's content reaching B.
    if (this.responseCache.isEntitled(token, id, this.pin)) {
      const cached = this.responseCache.getContent(kind, id, this.pin);
      if (cached) return cached;
    }

    try {
      const str =
        kind === 'template'
          ? JSON.stringify((await this.wire.template(id, this.pin, token)).template)
          : JSON.stringify((await this.wire.guide(id, this.pin, token)).guide);
      this.responseCache.putContent(kind, id, this.pin, str);
      this.responseCache.rememberEntitled(token, id, this.pin);
      return str;
    } catch (err) {
      if (err instanceof EvaluationNotEntitledError) return this.serveFallback(kind, id, 'denied', err.denial);
      if (err instanceof RemoteModuleUnavailableError) return this.serveFallback(kind, id, 'unavailable');
      // A recall stops serving this pin's cached content the moment it is observed.
      if (err instanceof ContentRecalledError) this.responseCache.evictPin(this.pin);
      // 401 (re-authenticate), 410 (recalled), misconfiguration → propagate; a
      // denial is never a silent fallback and an outage is never a clean result.
      // Sanitized because the message reaches the platform's error banner (the
      // same untrusted-server-text surface the eval path guards).
      throw sanitizeError(err);
    }
  }

  /** The fallback for this call, logged so an outage or a denial stays visible to the operator: the host sees a
   * served fallback as a successful call. The log carries no token and no server text. */
  private serveFallback(kind: ContentKind, id: string, reason: FallbackReason, denial?: DenialInfo): string {
    const now = Date.now();
    const last = this.fallbackWarns.get(reason);
    if (last && now - last.at < FALLBACK_WARN_INTERVAL_MS) {
      last.unlogged++;
    } else {
      this.fallbackWarns.set(reason, { at: now, unlogged: 0 });
      this.logger.warn('Serving the read-only fallback', {
        moduleKey: this.moduleKey,
        kind,
        id,
        reason,
        unloggedSinceLastWarn: last?.unlogged ?? 0,
      });
    }
    return this.fallbackString(kind, denial);
  }

  private fallbackString(kind: ContentKind, denial?: DenialInfo): string {
    return kind === 'template'
      ? JSON.stringify(buildFallbackTemplate(denial, this.portalOrigin))
      : JSON.stringify(buildFallbackGuide(denial));
  }

  // --- Registration internals ------------------------------------------------

  private async register(): Promise<CachedModule> {
    await this.pinPortalOrigin();

    let liveError: unknown;
    const entry =
      this.cache.get(this.moduleKey, this.pin) ??
      (await this.fetchAndCache().catch((err) => {
        liveError = err;
        return null;
      })) ??
      this.cache.newestFor(this.moduleKey);

    if (!entry) {
      // Nothing was ever cached: genuine first boot (no live class to orphan) or
      // total cache loss (which, co-durable, means the graph is gone too). Rethrow
      // the real live error so a bad pin surfaces as misconfigured, an outage as
      // unavailable — never a blanket message. Sanitized: its message may carry
      // server-authored text and reaches the platform's error banner.
      throw sanitizeError(liveError ?? new RemoteModuleUnavailableError(this.moduleKey));
    }

    this.adopt(entry);
    return entry;
  }

  /** Serve this entry from now on: its vectors and its document. */
  private adopt(entry: CachedModule): void {
    this.loadVectors(entry);
    this.registered = entry;
  }

  /** Pin the portal origin, and take the configured pin if the module registered
   * from another (`current` is the registered entry at the call): at most one
   * start a minute. A failed document fetch keeps the registered entry and is
   * logged without server text. */
  private refreshInBackground(current: CachedModule): void {
    const pinStale = current.pin !== this.pin;
    if (!pinStale && this.portalOrigin) return;
    if (this.lastRefreshAt !== undefined && withinRefreshInterval(this.lastRefreshAt)) return;
    this.lastRefreshAt = Date.now();
    void (async () => {
      await this.pinPortalOrigin();
      if (!pinStale) return;
      this.adopt(this.cache.get(this.moduleKey, this.pin) ?? (await this.fetchAndCache()));
    })().catch((err: unknown) => {
      this.logger.warn('Background fetch of the module document failed; the registered entry stays', {
        moduleKey: this.moduleKey,
        pin: this.pin,
        error: err instanceof Error ? err.name : 'Error',
      });
    });
  }

  /** Best-effort /meta to pin the portal origin (bounds denial action URLs).
   * Called by each registration attempt and by the background refresh; once pinned
   * it never re-fetches. Non-fatal: a failure leaves portalOrigin undefined (the
   * action-URL check fails closed). */
  private async pinPortalOrigin(): Promise<void> {
    if (this.portalOrigin) return;
    try {
      const meta = await this.wire.meta();
      if (meta.portalOrigin) this.portalOrigin = meta.portalOrigin;
    } catch {
      // Non-fatal — the action-URL check fails closed when portalOrigin is absent.
    }
  }

  /** Fetch the module document and every listed embedding model, persist, return.
   * A wire error propagates to register's fallback chain or the background
   * refresh's catch, and never past either. */
  private async fetchAndCache(): Promise<CachedModule> {
    const document = await this.wire.moduleDocument(this.moduleKey, this.pin);
    // A live document with zero classes is corruption (a partial/wrong response),
    // not a legitimate module — treat it as a failed fetch so registration falls
    // through to the newest cached document instead of returning a reduced set
    // (which the platform would reconcile by orphaning every prior class). Guard
    // before persisting so the bad document never poisons the cache or its memo.
    if (!document?.module || countClasses(document.module) === 0) {
      throw new RemoteModuleUnavailableError(`Content service returned no classes for ${this.moduleKey}`);
    }
    // The platform refuses metadata without a name, so such a document would fail
    // registration and every probe.
    if (typeof document.module.name !== 'string' || !document.module.name.trim()) {
      throw new RemoteModuleUnavailableError(`Content service returned no module name for ${this.moduleKey}`);
    }
    const models = document.embeddings?.models ?? [];
    const embeddings = await Promise.all(
      models.map((model) => this.wire.embeddings(this.moduleKey, this.pin, model)),
    );
    const entry: CachedModule = {
      moduleKey: this.moduleKey,
      pin: this.pin,
      fetchedAt: new Date().toISOString(),
      document,
      embeddings,
    };
    this.cache.put(entry);
    return entry;
  }

  /** Rebuild the synchronous vector map from a (live or cached) entry: join the
   * wire embeddings (keyed by classId) with the document's class id→name. */
  private loadVectors(entry: CachedModule): void {
    const idToName = new Map<string, string>();
    for (const key of SERVED_CLASS_ARRAYS) {
      const classes = entry.document.module[key] as Array<{ id?: string; name?: unknown }> | undefined;
      if (!Array.isArray(classes)) continue;
      for (const cls of classes) {
        if (cls?.id && typeof cls.name === 'string') idToName.set(cls.id, cls.name);
      }
    }

    const next = new Map<string, Map<string, number[]>>();
    for (const response of entry.embeddings) {
      const slug = slugifyModelName(response.model);
      const byName = next.get(slug) ?? new Map<string, number[]>();
      let rejected = 0;
      for (const { classId, vector } of response.embeddings) {
        const className = idToName.get(classId);
        if (!className) continue;
        // The wire carries a bare array, but a cached entry may hold a vector file's
        // `{ vector, contentHash }` wrapper passed through verbatim. Unwrap it, and drop
        // anything that is still not a usable vector: a dropped class is embedded on the
        // fly, whereas a malformed one would throw on every lookup.
        const candidate = Array.isArray(vector) ? vector : (vector as { vector?: unknown } | null)?.vector;
        if (embeddingVectorDefect(candidate)) {
          rejected++;
          continue;
        }
        byName.set(className, candidate as number[]);
      }
      if (rejected > 0) {
        // Wire-sourced values ride as structured metadata, never interpolated into the message.
        this.logger.warn('Dropped malformed embedding vectors; those classes are embedded on the fly', {
          moduleKey: this.moduleKey,
          model: response.model,
          rejected,
        });
      }
      next.set(slug, byName);
    }
    this.vectors = next;
  }
}

/** A stable hash of the stripped attribute map — the eval cache key. Deterministic
 * (top-level and nested keys sorted; array order preserved), so identical attributes
 * always hash identically regardless of key order. Never includes the token. */
function attributesHash(attributes: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(stableStringify(attributes)).digest('hex');
}

/** Sanitize the message of a propagated typed error before it surfaces in dt-ui's
 * generic error banner — the same untrusted-server-text surface as the denial
 * fallback. Preserves the error's type and structured fields. */
function sanitizeError(err: unknown): unknown {
  if (err instanceof Error && typeof err.message === 'string') {
    err.message = sanitizeText(err.message, 500);
  }
  return err;
}
