/**
 * The knowledge-graph client backed by a remote service.
 *
 * Answers the same interface as the local one, over the wire protocol's knowledge-graph surface.
 * Everything a caller can observe is identical between the two — the same keyed maps, the same
 * payload objects, the same guarantee that every requested key is present. What differs is
 * confined to this file: a bearer travels with each call, answers are cached per caller, and a key
 * set wider than the service accepts is split up and put back together without the caller knowing.
 */
import * as crypto from 'crypto';
import {
  KgCapability,
  KgClient,
  KgRule,
  KgRuleKind,
  KgRuleRef,
  KgThreat,
} from '../interfaces/kg-client-interface';
import { CloudSessionExpiredError, EvaluationNotEntitledError, RemoteModuleMisconfiguredError } from '../remote/errors';
import { ResponseCache } from '../remote/response-cache';
import { FetchLike, KgRegistryResponse, WireClient } from '../remote/wire-client';
import { distinct, distinctRefs, seededMap } from './keys';
import { FieldGetter, fromObject, toRule, toThreat } from './normalize';

/**
 * The key bound to use when the registry cannot be read.
 *
 * The published value, and a last resort rather than a configured default: the registry is the
 * authority and is fetched on every process, so this only applies when it is unreachable. It
 * bounds a request rather than naming a host, so it does not make an unconfigured deployment
 * point anywhere.
 *
 * IT MUST NOT EXCEED WHAT THE SERVICE ENFORCES. The reasoning that "its 400 is still the backstop"
 * was wrong: a 400 on the fallback path is not a backstop, it is the failure. The registry is
 * unreachable precisely when a deployment can least afford a rejected request, and the caller sees
 * an empty answer rather than a smaller one. Chunking narrower than the service allows costs a
 * round trip; chunking wider costs the answer.
 */
const PUBLISHED_MAX_ITEMS = 100;

/** The parameter each named query is keyed by. */
const PARAMETER_NAME: Record<string, string> = {
  rulesByClassId: 'classIds',
  threatsByRuleId: 'ruleRefs',
  threatsByTechniqueId: 'techniqueIds',
};

export interface CloudKgClientOptions {
  /** Service origin. No default anywhere — an unconfigured deployment never reaches this class. */
  baseUrl: string;
  /** The pinned knowledge-graph version, already validated as a digest by the factory. */
  version: string;
  /** Injected in tests; defaults to the Node global `fetch`. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class CloudKgClient implements KgClient {
  readonly version: string;
  private readonly wire: WireClient;
  private readonly cache = new ResponseCache();
  /** The registry, in flight or settled. Memoised as a promise so concurrent callers share one
   * fetch, and dropped on rejection so a transient failure is not remembered as the answer. */
  private registry?: Promise<KgRegistryResponse>;

  constructor(opts: CloudKgClientOptions) {
    this.version = opts.version;
    this.wire = new WireClient({
      baseUrl: opts.baseUrl,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
  }

  async capability(token?: string): Promise<KgCapability> {
    const bearer = requireToken(token);
    const body = await this.wire.kgCapability(this.version, bearer);
    return {
      available: body.available === true,
      entitled: body.entitled === true,
      // The wire calls this `entitledSliceCount`; the interface calls it `sliceCount`, because the
      // local mode it also describes has no entitled slices to count. This is the one point the
      // two names meet — and an absent one is zero, not NaN.
      sliceCount: typeof body.entitledSliceCount === 'number' ? body.entitledSliceCount : 0,
    };
  }

  async rulesByClassId(
    classIds: string[],
    opts?: { kind?: KgRuleKind },
    token?: string,
  ): Promise<Map<string, KgRule[]>> {
    const keys = distinct(classIds);
    if (keys.length === 0) return new Map();
    return this.answer('rulesByClassId', keys, token, toRule, opts?.kind ? { kind: opts.kind } : {});
  }

  async threatsByRuleId(refs: KgRuleRef[], token?: string): Promise<Map<string, KgThreat[]>> {
    const seen = distinctRefs(refs);
    if (seen.size === 0) return new Map();
    // The keys travel as the joined strings, not as pairs: the registry's parameter vocabulary is
    // an array of strings and has no shape for an array of objects, so sending them structurally
    // would be a protocol change. Joining at this boundary also makes the wire key and the map key
    // the same string by construction rather than by a rule someone has to remember.
    const keys = Array.from(seen.keys());
    return this.answer('threatsByRuleId', keys, token, toThreat);
  }

  async threatsByTechniqueId(techniqueIds: string[], token?: string): Promise<Map<string, KgThreat[]>> {
    const keys = distinct(techniqueIds);
    if (keys.length === 0) return new Map();
    return this.answer('threatsByTechniqueId', keys, token, toThreat);
  }

  // --- Internals -------------------------------------------------------------

  /** Chunk, call, cache, merge — the whole shape of a query, once. */
  private async answer<T>(
    queryName: string,
    keys: string[],
    token: string | undefined,
    map: (get: FieldGetter) => T,
    extraParameters: Record<string, unknown> = {},
  ): Promise<Map<string, T[]>> {
    const bearer = requireToken(token);
    const parameterName = PARAMETER_NAME[queryName];
    const out = seededMap<T>(keys);

    for (const chunk of chunked(keys, await this.maxItems(queryName))) {
      const parameters = { [parameterName]: chunk, ...extraParameters };
      for (const entry of await this.results(queryName, parameters, bearer)) {
        // A key outside the requested set cannot happen — the service echoes what it was sent —
        // but dropping it beats inventing a key nobody asked for.
        out.get(entry.key)?.push(...toList(entry.matches).map((m) => map(fromObject(m))));
      }
    }
    return out;
  }

  /** One call's worth of grouped results, from the cache if this caller has them. */
  private async results(
    queryName: string,
    parameters: Record<string, unknown>,
    token: string,
  ): Promise<Array<{ key: string; matches: unknown[] }>> {
    const cached = this.cache.getKgQuery(token, queryName, this.version, parameters);
    if (cached) return cached as Array<{ key: string; matches: unknown[] }>;

    let body;
    try {
      body = await this.wire.kgQuery(this.version, queryName, token, {
        // Support correlation only. Random per call, encoding nothing about the caller.
        requestId: crypto.randomUUID(),
        parameters,
      });
    } catch (err) {
      // A refusal invalidates everything this caller has been told they may see. Another caller's
      // entries were computed against their own entitlements and stay valid.
      if (err instanceof EvaluationNotEntitledError) this.cache.evictCaller(token);
      throw err;
    }

    if (body.truncated === true) {
      // The protocol caps no result set, so this cannot be data — it is a service that capped one
      // without saying it would. A short map is indistinguishable from a complete one at the call
      // site, so it must not be returned, and nothing about this response is cached.
      throw new RemoteModuleMisconfiguredError(
        `The knowledge-graph service truncated its answer to "${queryName}"`,
        'internal',
      );
    }

    const results = Array.isArray(body.results) ? body.results : [];
    this.cache.putKgQuery(token, queryName, this.version, parameters, results);
    return results;
  }

  /**
   * The key bound for a query, from the registry.
   *
   * Fetched rather than compiled in, because the registry is versioned independently of this
   * client and a service is free to publish a tighter bound than the one shipped here. A client
   * that assumed the published number would send more keys than such a service accepts and hand
   * its caller a `400` for asking a wide question — the one outcome chunking exists to prevent.
   */
  private async maxItems(queryName: string): Promise<number> {
    if (!this.registry) {
      const pending = this.wire.kgQueries();
      this.registry = pending;
      pending.catch(() => {
        if (this.registry === pending) this.registry = undefined;
      });
    }
    let bound: number | undefined;
    try {
      const entry = (await this.registry).queries?.find((q) => q.name === queryName);
      bound = entry?.parameters?.[PARAMETER_NAME[queryName]]?.maxItems;
    } catch {
      // The registry is public and its absence says nothing about entitlement, so an unreadable
      // one degrades to the published bound rather than failing a query the caller may well be
      // entitled to. The service's own rejection remains the backstop.
      bound = undefined;
    }
    return typeof bound === 'number' && bound > 0 ? bound : PUBLISHED_MAX_ITEMS;
  }
}

/**
 * The caller's bearer, or the outcome a bearer-less call would have produced anyway.
 *
 * Short-circuiting is safe precisely because it is not a different answer: the entitled routes
 * reject a request with no `Authorization` as `401 invalid_token`, which is this error. What it
 * must never become is an empty map — indistinguishable, at the call site, from a graph that
 * genuinely holds no matches.
 */
function requireToken(token: string | undefined): string {
  if (!token) {
    throw new CloudSessionExpiredError(
      'invalid_token',
      'A knowledge-graph query requires an authenticated cloud session',
    );
  }
  return token;
}

/** Split into runs of at most `size`, preserving order. */
function chunked(keys: string[], size: number): string[][] {
  if (keys.length <= size) return [keys];
  const out: string[][] = [];
  for (let i = 0; i < keys.length; i += size) out.push(keys.slice(i, i + size));
  return out;
}

function toList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
