/**
 * An in-process implementation of the v1 wire protocol (catalog + content + eval
 * surfaces), driven by fixtures. It exposes a `fetch`-shaped function so a
 * {@link WireClient} can be pointed straight at it — **no sockets**, so the whole
 * contract suite runs offline in CI with no credentials.
 *
 * It replays a scenario selected by the caller's bearer token (entitled /
 * unentitled / expired) and by mode switches (a transient outage, a recalled
 * pin). Every request is captured so tests can assert on headers, method, and
 * call counts.
 */
import * as fixtures from './fixtures';
import { ModuleDocument } from '../remote/wire-client';
import { DenialInfo, RecallInfo } from '../remote/errors';

export type FailureMode = 'none' | 'network' | '5xx' | 'rate_limited';

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  token?: string;
  bodyText?: string;
}

const PROBLEM = { 'Content-Type': 'application/problem+json' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class MockContentServer {
  /** token → outcome. Unknown tokens are treated as unentitled. */
  private readonly entitlement = new Map<string, 'entitled' | 'unentitled' | 'expired'>([
    [fixtures.ENTITLED_TOKEN, 'entitled'],
    [fixtures.UNENTITLED_TOKEN, 'unentitled'],
    [fixtures.EXPIRED_TOKEN, 'expired'],
  ]);
  private readonly recalledPins = new Set<string>();
  private denial: DenialInfo = fixtures.denial;
  private recallInfo: RecallInfo = fixtures.recall;
  private moduleDocOverride?: ModuleDocument;
  private failureMode: FailureMode = 'none';
  /** When set, the mock hangs until the caller's abort signal fires (timeout). */
  private delayMs = 0;
  /** When true, model `redirect: 'error'` hitting a 3xx: the fetch promise rejects. */
  private redirectHardFailure = false;

  readonly requests: CapturedRequest[] = [];

  /** Bound so it can be passed directly as a `FetchLike`. */
  readonly fetch = (url: string, init: RequestInit): Promise<Response> => this.handle(url, init);

  // --- Scenario controls -----------------------------------------------------

  setFailureMode(mode: FailureMode): void {
    this.failureMode = mode;
  }

  /** Hang every call until the client's timeout aborts it. */
  setHang(on: boolean): void {
    this.delayMs = on ? 3_600_000 : 0;
  }

  /** Model a 3xx meeting `redirect: 'error'` — the fetch rejects, never follows. */
  setRedirectHardFailure(on: boolean): void {
    this.redirectHardFailure = on;
  }

  recall(pin: string): void {
    this.recalledPins.add(pin);
  }

  /** Override the denial payload the 403 path returns (drive adversarial text). */
  setDenial(denial: DenialInfo): void {
    this.denial = denial;
  }

  /** Override the recall payload the 410 path returns (drive adversarial text). */
  setRecall(recall: RecallInfo): void {
    this.recallInfo = recall;
  }

  /** Override the module document the catalog returns (e.g. a zero-class doc). */
  setModuleDocument(doc: ModuleDocument): void {
    this.moduleDocOverride = doc;
  }

  reset(): void {
    this.failureMode = 'none';
    this.delayMs = 0;
    this.redirectHardFailure = false;
    this.recalledPins.clear();
    this.denial = fixtures.denial;
    this.recallInfo = fixtures.recall;
    this.moduleDocOverride = undefined;
    this.requests.length = 0;
  }

  // --- Request handling ------------------------------------------------------

  private async handle(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    const method = (init.method ?? 'GET').toUpperCase();
    const path = safePath(url);
    const token = bearer(headers);
    const bodyText = typeof init.body === 'string' ? init.body : undefined;
    this.requests.push({ method, url, path, headers, token, bodyText });

    // A redirect meeting redirect:'error', or a network failure, both reject the
    // fetch promise — the client maps either to a transient/hard unavailability.
    if (this.redirectHardFailure) {
      throw new TypeError('Failed to fetch: redirect not followed');
    }
    if (this.failureMode === 'network') {
      throw new TypeError('Failed to fetch: network error');
    }
    if (this.delayMs > 0) {
      await this.hangUntilAborted(init.signal ?? undefined);
    }
    if (this.failureMode === '5xx') {
      return problem(503, { code: 'internal', title: 'Service unavailable' });
    }
    if (this.failureMode === 'rate_limited') {
      return problem(429, { code: 'rate_limited', title: 'Rate limited' }, { 'Retry-After': '1' });
    }

    const segments = path.split('/').filter(Boolean).map(decodeSafe);
    return this.route(method, segments, token);
  }

  private route(method: string, segs: string[], token?: string): Response {
    // /meta — unauthenticated service descriptor.
    if (segs.length === 1 && segs[0] === 'meta') {
      return ok(fixtures.metaResponse);
    }
    // Catalog surface — unauthenticated, publicly cacheable.
    if (segs[0] === 'v1' && segs[1] === 'catalog' && segs[2] === 'modules') {
      const pin = segs[5];
      // /v1/catalog/modules/:key/versions/:pin
      if (segs.length === 6 && segs[4] === 'versions') {
        return ok(this.moduleDocument(pin));
      }
      // /v1/catalog/modules/:key/versions/:pin/embeddings/:model
      if (segs.length === 8 && segs[6] === 'embeddings') {
        return ok(fixtures.embeddingsResponse);
      }
    }
    // Content surface — entitled.
    if (segs[0] === 'v1' && segs[1] === 'content' && segs[2] === 'classes') {
      const pin = segs[5];
      const kind = segs[6];
      if (segs.length === 7 && segs[4] === 'versions' && (kind === 'template' || kind === 'guide')) {
        const denied = this.entitlementResponse(token, pin);
        if (denied) return denied;
        return ok(kind === 'template' ? fixtures.templateResponse : fixtures.guideResponse);
      }
    }
    // Evaluation surface — entitled.
    if (method === 'POST' && segs[0] === 'v1' && segs[1] === 'eval' && segs[2] === 'classes') {
      const pin = segs[5];
      if (segs.length === 6 && segs[4] === 'versions') {
        const denied = this.entitlementResponse(token, pin);
        if (denied) return denied;
        return ok(fixtures.evalResponse);
      }
    }
    return problem(404, { code: 'version_not_found', title: 'Not found' });
  }

  private moduleDocument(pin: string): ModuleDocument {
    const base = this.moduleDocOverride ?? fixtures.moduleDocument;
    if (this.recalledPins.has(pin)) {
      return { ...base, recalled: { reason: this.recallInfo.reason, recalledAt: this.recallInfo.recalledAt } };
    }
    return base;
  }

  /** The 401/410/403 an entitled path returns, or `null` when the caller may proceed. */
  private entitlementResponse(token: string | undefined, pin: string): Response | null {
    const outcome = token ? this.entitlement.get(token) ?? 'unentitled' : undefined;
    if (!token || outcome === 'expired') {
      return problem(401, { code: outcome === 'expired' ? 'token_expired' : 'invalid_token', title: 'Invalid token' });
    }
    if (this.recalledPins.has(pin)) {
      return problem(410, { code: 'version_recalled', title: 'Content version recalled', recalled: this.recallInfo });
    }
    if (outcome === 'unentitled') {
      return problem(403, { code: 'not_entitled', title: 'Not entitled', denial: this.denial });
    }
    return null;
  }

  private hangUntilAborted(signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
  }
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

function problem(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...PROBLEM, ...extraHeaders } });
}

function bearer(headers: Headers): string | undefined {
  const auth = headers.get('authorization');
  if (!auth) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1] : undefined;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // Relative or malformed — take the path portion best-effort.
    return url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0];
  }
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
