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
import { slugifyModelName } from './embedding-text';
import { FetchLike, WireClient } from './remote/wire-client';
import { CachedModule, MetadataCache, SERVED_CLASS_ARRAYS, countClasses } from './remote/metadata-cache';
import {
  ContentRecalledError,
  DenialInfo,
  EvaluationNotEntitledError,
  RemoteModuleUnavailableError,
} from './remote/errors';
import { ResponseCache, ContentKind, EvalResult } from './remote/response-cache';
import { buildFallbackGuide, buildFallbackTemplate, sanitizeText } from './remote/fallback';
import { JsonSchema, stripToSchema } from './remote/strip';

/** The per-module identity a mount stub supplies: which module, at which pinned
 * (immutable, content-hash) version. */
export interface RemoteModuleConfig {
  moduleKey: string;
  pin: string;
}

/** Internal construction seam — tests inject an in-process mock and a temp cache
 * directory here. The mount stub never passes it; the deployment reads the base
 * URL and cache directory from the environment. */
export interface RemoteModuleDeps {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  cacheDir?: string;
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

  constructor(config: RemoteModuleConfig, driver: unknown, logger?: Logger, deps?: RemoteModuleDeps) {
    this.moduleKey = config.moduleKey;
    this.pin = config.pin;
    this.logger = logger ?? new Logger('DtRemoteModule');

    // Deployment-global base URL; no baked default, so an unconfigured
    // deployment leaves the module inert rather than pointing at a host.
    const baseUrl = deps?.baseUrl ?? process.env.MODULE_CONTENT_BASE_URL;
    this.wire = new WireClient({ baseUrl, fetchImpl: deps?.fetchImpl });
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
   * Register the module's classes. Resolution order (never throws once the module
   * has ever registered, so the platform's obsolescence sweep never fires):
   *   exact-pin cache (immutable → authoritative, offline-fast)
   *     → live fetch (module document + embeddings, persisted)
   *       → newest cached document for this module (offline pin-miss → stay registered)
   *         → throw only when nothing was ever cached (safe first boot).
   */
  async getMetadata(): Promise<DTMetadata> {
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

    this.loadVectors(entry);
    return entry.document.module;
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
    return this.vectors.get(slug)?.get(className) ?? null;
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
      const schema = await this.schemaFor(classId, token); // hard precondition — throws if unobtainable
      const attributes = stripToSchema(raw ?? {}, schema); // the schema is the allowlist
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
    if (!token) return this.fallbackString(kind);

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
      if (err instanceof EvaluationNotEntitledError) return this.fallbackString(kind, err.denial);
      if (err instanceof RemoteModuleUnavailableError) return this.fallbackString(kind);
      // A recall stops serving this pin's cached content the moment it is observed.
      if (err instanceof ContentRecalledError) this.responseCache.evictPin(this.pin);
      // 401 (re-authenticate), 410 (recalled), misconfiguration → propagate; a
      // denial is never a silent fallback and an outage is never a clean result.
      // Sanitized because the message reaches the platform's error banner (the
      // same untrusted-server-text surface the eval path guards).
      throw sanitizeError(err);
    }
  }

  private fallbackString(kind: ContentKind, denial?: DenialInfo): string {
    return kind === 'template'
      ? JSON.stringify(buildFallbackTemplate(denial, this.portalOrigin))
      : JSON.stringify(buildFallbackGuide(denial));
  }

  // --- Registration internals ------------------------------------------------

  /** Best-effort /meta to pin the portal origin (bounds denial action URLs).
   * Once pinned it never re-fetches — getMetadata is health-probed continuously,
   * so an unguarded call would generate constant /meta traffic. Non-fatal: a
   * failure leaves portalOrigin undefined (the action-URL check fails closed)
   * and never blocks boot. */
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
   * A wire error propagates to getMetadata's catch and never past it. */
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
      for (const { classId, vector } of response.embeddings) {
        const className = idToName.get(classId);
        if (className) byName.set(className, vector);
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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
