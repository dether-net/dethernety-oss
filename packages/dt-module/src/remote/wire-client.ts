/**
 * A typed client over the module content service's v1 wire protocol — the only
 * place `DtRemoteModule` speaks HTTP. It covers the three mandatory surfaces a
 * remote module uses (catalog / content / eval); the optional entitlements and
 * knowledge-graph surfaces are other modules' concern, not this one's.
 *
 * Cross-cutting protocol rules live here, once, so every call inherits them:
 *   - `redirect: 'error'` on every request (a 3xx is a hard failure — it stops a
 *     bearer following a redirect off-origin, and stops a catalog redirect
 *     poisoning a cached module document);
 *   - a bounded per-call timeout, so a slow service degrades to "unavailable"
 *     rather than hanging a resolver;
 *   - a static, library-only `User-Agent`, and no header, query, or body that
 *     identifies the deployment, host, user, or model content;
 *   - `Authorization: Bearer` only on the entitled surfaces; catalog calls carry
 *     no credential (their responses are publicly cacheable and may be logged by
 *     intermediaries).
 */
import { DTMetadata } from '../interfaces/module-metadata-interface';
import { Exposure } from '../interfaces/exposure-interface';
import { Countermeasure } from '../interfaces/countermeasure-interface';
import { mapStatusToError, ProblemBody, RemoteModuleUnavailableError } from './errors';

/** The `fetch`-shaped function the client calls. Global `fetch` by default; a
 * test injects an in-process mock here (no sockets). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** `GET /meta` — the unauthenticated service descriptor. */
export interface MetaResponse {
  service: string;
  protocolVersions: string[];
  surfaces: string[];
  portalOrigin?: string;
}

/** `GET /v1/catalog/modules/{key}/versions/{pin}` — the module document.
 * `module` is the platform's metadata shape verbatim; a `recalled` marker may sit
 * beside it without erasing the metadata. */
export interface ModuleDocument {
  protocol: string;
  module: DTMetadata;
  embeddings?: { models?: string[] };
  recalled?: { reason?: string; recalledAt?: string };
}

/** `GET …/embeddings/{model}` — every class vector in one response. */
export interface EmbeddingsResponse {
  moduleKey: string;
  version: string;
  model: string;
  embeddings: Array<{ classId: string; vector: number[] }>;
}

/** `GET …/template` — `uischema` is already normalized (lower case). */
export interface TemplateResponse {
  classId: string;
  version: string;
  template: { schema?: Record<string, unknown>; uischema?: Record<string, unknown> };
}

/** `GET …/guide`. */
export interface GuideResponse {
  classId: string;
  version: string;
  guide: Record<string, unknown>;
}

/** `POST /v1/eval/classes/{classId}/versions/{pin}` response — carries both
 * finding kinds; the platform asks for only one per element. */
export interface EvalResponse {
  requestId: string;
  classId: string;
  version: string;
  exposures: Exposure[];
  countermeasures: Countermeasure[];
}

export interface WireClientOptions {
  /** Deployment-global base URL (`MODULE_CONTENT_BASE_URL`). Undefined leaves the
   * client inert — every call fails as unavailable rather than hitting a default. */
  baseUrl?: string;
  /** Injected in tests; defaults to the Node global `fetch`. */
  fetchImpl?: FetchLike;
  /** Per-call timeout. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Static library-version User-Agent. Read from the package root at runtime so it
 * tracks the version bump without a second edit; never identifies the deployment. */
function clientUserAgent(): string {
  // Runtime require (not a static import): package.json sits outside rootDir:src,
  // so importing it would break outDir inference. `../../package.json` resolves to
  // the package root identically from src/remote/ and dist/remote/.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { version } = require('../../package.json') as { version: string };
  return `dt-remote-module/${version}`;
}

const USER_AGENT = clientUserAgent();

export class WireClient {
  private readonly baseUrl?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: WireClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '');
    // Bind so a bare global `fetch` keeps its expected `this`.
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // --- Catalog surface (unauthenticated — no Authorization header) -----------

  meta(): Promise<MetaResponse> {
    return this.getJson<MetaResponse>('/meta');
  }

  moduleDocument(moduleKey: string, pin: string): Promise<ModuleDocument> {
    return this.getJson<ModuleDocument>(`/v1/catalog/modules/${enc(moduleKey)}/versions/${enc(pin)}`);
  }

  embeddings(moduleKey: string, pin: string, model: string): Promise<EmbeddingsResponse> {
    return this.getJson<EmbeddingsResponse>(
      `/v1/catalog/modules/${enc(moduleKey)}/versions/${enc(pin)}/embeddings/${enc(model)}`,
    );
  }

  // --- Content surface (entitled — Bearer token) -----------------------------

  template(classId: string, pin: string, token: string): Promise<TemplateResponse> {
    return this.getJson<TemplateResponse>(
      `/v1/content/classes/${enc(classId)}/versions/${enc(pin)}/template`,
      { token },
    );
  }

  guide(classId: string, pin: string, token: string): Promise<GuideResponse> {
    return this.getJson<GuideResponse>(
      `/v1/content/classes/${enc(classId)}/versions/${enc(pin)}/guide`,
      { token },
    );
  }

  // --- Evaluation surface (entitled — Bearer token) --------------------------

  evaluate(
    classId: string,
    pin: string,
    token: string,
    payload: { requestId: string; attributes: Record<string, unknown> },
  ): Promise<EvalResponse> {
    return this.request<EvalResponse>(
      `/v1/eval/classes/${enc(classId)}/versions/${enc(pin)}`,
      { method: 'POST', token, jsonBody: payload },
    );
  }

  // --- Internals -------------------------------------------------------------

  private getJson<T>(path: string, opts: { token?: string } = {}): Promise<T> {
    return this.request<T>(path, { method: 'GET', ...opts });
  }

  private async request<T>(
    path: string,
    opts: { method: string; token?: string; jsonBody?: unknown },
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new RemoteModuleUnavailableError('No content service base URL configured');
    }
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.jsonBody !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // The timer stays armed through the body read (json/safeProblemBody), so a
    // response that returns headers promptly but stalls its body still aborts and
    // degrades to "unavailable" rather than hanging a resolver. mapStatusToError
    // is called AFTER the timed block so a mapped typed error is not reclassified.
    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetchImpl(url, {
        method: opts.method,
        headers,
        body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
        // A 3xx is a hard failure on every call — never follow a redirect.
        redirect: 'error',
        signal: controller.signal,
      });
      payload = response.ok ? await response.json() : await safeProblemBody(response);
    } catch (err) {
      // Abort (timeout, incl. a stalled body), network failure, a redirect
      // rejected by redirect:'error', or a malformed body — all transient/hard
      // unavailability, never a leak.
      throw new RemoteModuleUnavailableError(`Content service request failed: ${describe(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw mapStatusToError(response.status, payload as ProblemBody | undefined, retryAfterMs(response));
    }
    return payload as T;
  }
}

/** Percent-encode an opaque path segment; keys are never parsed for structure. */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'timeout' : err.message;
  return 'unknown error';
}

async function safeProblemBody(response: Response): Promise<ProblemBody | undefined> {
  try {
    return (await response.json()) as ProblemBody;
  } catch {
    return undefined;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
