/**
 * An in-process implementation of the v1 wire protocol (catalog + content + eval +
 * knowledge-graph surfaces), driven by fixtures. It exposes a `fetch`-shaped function so a
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
    // Entitled, but to fewer knowledge-graph slices than the caller above. Entitlement is binary
    // on the content surfaces and plural on the kg one, which is why this token is a third
    // *entitled* outcome rather than a fourth outcome.
    [fixtures.KG_NARROWED_TOKEN, 'entitled'],
  ]);
  private readonly recalledPins = new Set<string>();
  /**
   * Recalled knowledge-graph versions. A separate set from {@link recalledPins} on purpose: a
   * kg version and a module content pin are different subjects on different axes, and sharing
   * one set would let a content test's `recall(PIN)` silently recall the knowledge graph.
   */
  private readonly recalledKgVersions = new Set<string>();
  /**
   * The surfaces `/meta` declares. Held here rather than taken from the fixture because this
   * mock genuinely implements `kg` and the fixture is reused by things that do not — and a
   * service must never declare a surface it does not fully implement.
   */
  private surfaces: string[] = ['catalog', 'content', 'eval', 'kg'];
  private denial: DenialInfo = fixtures.denial;
  private recallInfo: RecallInfo = fixtures.recall;
  /** The kg surface's own recall payload — it names a slice and a kg version, not a module pin. */
  private kgRecallInfo: RecallInfo = fixtures.kgRecall;
  /**
   * The kg surface's own denial. Separate from {@link denial} for the same reason the recall is:
   * `subject.kind` is the discriminator a consumer routes on, and a knowledge-graph refusal
   * carrying a class subject would let a client that never checked it look correct.
   */
  private kgDenial: DenialInfo = fixtures.kgDenial;
  /** The named-query registry served by the contract tier; `null` makes that route fail. */
  private kgRegistry: typeof fixtures.kgRegistry | null = fixtures.kgRegistry;
  /** When true, every query answer claims it was capped — which the protocol never permits. */
  private kgTruncated = false;
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

  /** Recall a knowledge-graph version. Distinct from {@link recall}, which takes a content pin. */
  recallKgVersion(version: string): void {
    this.recalledKgVersions.add(version);
  }

  /** Override the surfaces `/meta` declares — e.g. drop `kg` to model a service without it. */
  setSurfaces(surfaces: string[]): void {
    this.surfaces = [...surfaces];
  }

  /** Override the denial payload the 403 path returns (drive adversarial text). */
  setDenial(denial: DenialInfo): void {
    this.denial = denial;
  }

  /** Override the recall payload the 410 path returns (drive adversarial text). */
  setRecall(recall: RecallInfo): void {
    this.recallInfo = recall;
  }

  /**
   * Override the named-query registry, or make it unreadable with `null`.
   *
   * The registry publishes the key bound a client chunks to, so a service that has tightened it
   * must be expressible — a client that assumed the number it shipped with would send more keys
   * than such a service accepts. `null` models the registry being unavailable, which is a
   * different situation from it being restrictive and has to fail differently.
   */
  setKgRegistry(registry: typeof fixtures.kgRegistry | null): void {
    this.kgRegistry = registry;
  }

  /**
   * Make query answers claim they were capped.
   *
   * The protocol caps nothing, so a client meeting this is meeting a service that broke its word;
   * the mock can produce it because "what does the client do when the service misbehaves" is not
   * answerable any other way.
   */
  setKgTruncated(on: boolean): void {
    this.kgTruncated = on;
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
    this.recalledKgVersions.clear();
    this.surfaces = ['catalog', 'content', 'eval', 'kg'];
    this.denial = fixtures.denial;
    this.recallInfo = fixtures.recall;
    this.kgRecallInfo = fixtures.kgRecall;
    this.kgDenial = fixtures.kgDenial;
    this.kgRegistry = fixtures.kgRegistry;
    this.kgTruncated = false;
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
    return this.route(method, segments, token, bodyText);
  }

  private route(method: string, segs: string[], token?: string, bodyText?: string): Response {
    // /meta — unauthenticated service descriptor. The surface list is the server's own, not the
    // fixture's: this mock implements `kg`, and declaring a surface is a commitment.
    if (segs.length === 1 && segs[0] === 'meta') {
      return ok({ ...fixtures.metaResponse, surfaces: this.surfaces });
    }
    if (segs[0] === 'v1' && segs[1] === 'kg') {
      return this.routeKg(method, segs, token, bodyText);
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

  /**
   * The knowledge-graph surface. Three public routes and two entitled ones.
   *
   * The split is the whole point of the surface's shape: the registry, the version list and the
   * slice list describe the contract and are readable with no credential at all, while an actual
   * answer requires one. Nothing here is reachable without naming keys.
   */
  private routeKg(method: string, segs: string[], token?: string, bodyText?: string): Response {
    // /v1/kg/queries — the named-query registry. Public: it is an interface definition, not data.
    if (method === 'GET' && segs.length === 3 && segs[2] === 'queries') {
      if (!this.kgRegistry) {
        return problem(500, { code: 'internal', title: 'Registry unavailable' });
      }
      return ok(this.kgRegistry);
    }
    if (segs[2] !== 'versions') {
      return problem(404, { code: 'version_not_found', title: 'Not found' });
    }
    // /v1/kg/versions — the published versions. Public.
    if (method === 'GET' && segs.length === 3) {
      return ok(fixtures.kgVersionsResponse);
    }
    const version = segs[3];
    // /v1/kg/versions/:version — the slices at a version. Public; names and ids, never content.
    if (method === 'GET' && segs.length === 4) {
      if (version !== fixtures.KG_VERSION) {
        return problem(404, { code: 'version_not_found', title: 'Not found' });
      }
      return ok(fixtures.kgSlicesResponse);
    }
    // /v1/kg/versions/:version/capability — entitled. A bounded answer to "may I ask?", so a
    // consumer never has to probe with an unfiltered query to find out.
    if (method === 'GET' && segs.length === 5 && segs[4] === 'capability') {
      const denied = this.kgEntitlementResponse(token, version, false);
      if (denied) return denied;
      const outcome = this.entitlement.get(token!) ?? 'unentitled';
      if (outcome === 'unentitled') return ok(fixtures.kgCapabilityUnentitled);
      return ok(token === fixtures.KG_NARROWED_TOKEN ? fixtures.kgCapabilityNarrowed : fixtures.kgCapabilityResponse);
    }
    // /v1/kg/versions/:version/query/:queryName — entitled, keyed, batch.
    if (method === 'POST' && segs.length === 6 && segs[4] === 'query') {
      const denied = this.kgEntitlementResponse(token, version);
      if (denied) return denied;
      return this.kgQuery(segs[5], bodyText, token);
    }
    return problem(404, { code: 'version_not_found', title: 'Not found' });
  }

  /**
   * Answer one named query, or reject it.
   *
   * Validation order matters and is the protocol's: an unknown query name is a 404 before the
   * parameters are looked at, and **an empty or absent key set is a 400** — there is no query,
   * and no parameter combination, that returns everything.
   */
  private kgQuery(queryName: string, bodyText?: string, token?: string): Response {
    const entry = (this.kgRegistry ?? fixtures.kgRegistry).queries.find((q) => q.name === queryName);
    if (!entry) {
      return problem(404, { code: 'query_not_found', title: 'Unknown query' });
    }
    let parameters: Record<string, unknown> | undefined;
    try {
      const body = bodyText ? (JSON.parse(bodyText) as { parameters?: Record<string, unknown> }) : undefined;
      parameters = body?.parameters;
    } catch {
      return problem(400, { code: 'payload_invalid', title: 'Malformed body' });
    }
    const paramName = Object.keys(entry.parameters)[0];
    const keys = parameters?.[paramName];
    if (!Array.isArray(keys) || keys.length === 0) {
      return problem(400, { code: 'payload_invalid', title: 'A key set is required' });
    }
    const table: Record<string, unknown[]> =
      queryName === 'rulesByClassId'
        ? fixtures.kgRulesByClassIdAnswer
        : queryName === 'threatsByRuleId'
          ? fixtures.kgThreatsByRuleIdAnswer
          : fixtures.kgThreatsByTechniqueIdAnswer;
    // The match set is computed over the caller's entitled slices, so the SAME query at the SAME
    // version answers differently for two callers who are both entitled. A key resolvable only in
    // a slice this caller does not hold comes back present and empty — not a 403, which the protocol
    // reserves for a caller with no knowledge-graph entitlement at all.
    const scoped =
      token === fixtures.KG_NARROWED_TOKEN
        ? (key: string) => (fixtures.KG_PREMIUM_KEYS.includes(key) ? [] : table[key] ?? [])
        : (key: string) => table[key] ?? [];
    // Grouped by input key, and EVERY requested key is present — a key that matched nothing
    // carries an empty array rather than being omitted, so a caller can tell "no matches" from
    // "not asked" without inferring it.
    // A declared optional parameter narrows the answer. Ignoring it would let the two client
    // implementations disagree without any test noticing: the local one filters, so a mock that
    // did not would make the same query return different rule sets in the two modes.
    const kind = parameters?.kind;
    const narrowed =
      typeof kind === 'string'
        ? (key: string) => scoped(key).filter((m) => (m as { kind?: unknown }).kind === kind)
        : scoped;
    const results = (keys as string[]).map((key) => ({ key, matches: narrowed(key) }));
    return ok({
      requestId: 'fixture-request-id',
      query: queryName,
      version: fixtures.KG_VERSION,
      results,
      truncated: this.kgTruncated,
    });
  }

  /**
   * The 401/410/403 a knowledge-graph path returns, or `null` to proceed.
   *
   * Same ladder as {@link entitlementResponse} and in the same order — authenticate, then
   * recall, then entitlement — but over the kg recall set. Recall precedes entitlement because a
   * withdrawn version is withdrawn for everyone: subscription state must not mask it, and a
   * caller owed a `410` must never be told `403` instead.
   */
  private kgEntitlementResponse(
    token: string | undefined,
    version: string,
    /**
     * Whether an unentitled caller is REFUSED or ANSWERED.
     *
     * True for `query` and false for `capability`, and the asymmetry is the point rather than an
     * exception to it: `capability` exists so a consumer can ask "may I?" without issuing a query,
     * so refusing it forces the probe it was added to prevent. 401 and 410 still apply to both —
     * an invalid credential is not a capability answer, and a withdrawn version is withdrawn for
     * everyone.
     */
    refuseUnentitled = true,
  ): Response | null {
    const outcome = token ? this.entitlement.get(token) ?? 'unentitled' : undefined;
    if (!token || outcome === 'expired') {
      return problem(401, { code: outcome === 'expired' ? 'token_expired' : 'invalid_token', title: 'Invalid token' });
    }
    if (this.recalledKgVersions.has(version)) {
      return problem(410, { code: 'version_recalled', title: 'Knowledge-graph version recalled', recalled: this.kgRecallInfo });
    }
    if (refuseUnentitled && outcome === 'unentitled') {
      return problem(403, { code: 'not_entitled', title: 'Not entitled', denial: this.kgDenial });
    }
    return null;
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
