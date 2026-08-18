/**
 * The response cache for entitled content (template/guide half).
 *
 * Two structures, kept apart on purpose:
 *   - a CONTENT cache — account-invariant, immutable at the pin (a content hash),
 *     so a hit is authoritative and no revalidation is needed;
 *   - a per-caller ENTITLEMENT memo — because content is reusable but *entitlement*
 *     is per-caller, the client must never serve cached content to a caller it has
 *     not itself confirmed entitled.
 *
 * The memo never stores the token: it stores a SHA-256 of the token under a
 * per-process random salt, so the key is an opaque per-process value, not a stable
 * token fingerprint, and it is in-memory only — never persisted. Only `entitled`
 * outcomes are remembered (briefly); a denial always forces a live re-check on the
 * next call.
 */
import * as crypto from 'crypto';
import { Exposure } from '../interfaces/exposure-interface';
import { Countermeasure } from '../interfaces/countermeasure-interface';
import { JsonSchema } from './strip';

export type ContentKind = 'template' | 'guide';

/** A cached evaluation — both finding kinds, since one wire call carries both. */
export interface EvalResult {
  exposures: Exposure[];
  countermeasures: Countermeasure[];
}

/** How long an `entitled` outcome is trusted before a live re-check. */
const ENTITLEMENT_TTL_MS = 60_000;

/** Upper bound on the caches that grow with usage rather than class count: the
 * eval cache (per distinct stripped-attribute set), the entitlement memo (per
 * rotated token) and the knowledge-graph answers (per caller × key set). A
 * minimal FIFO cap keeps a long-running server bounded; eviction only forces a
 * re-eval / re-check / re-query, all of which are safe. */
const MAX_ENTRIES = 1000;

/** Drop the oldest entry (Map preserves insertion order) once over the cap. */
function capFifo<K, V>(map: Map<K, V>): void {
  if (map.size <= MAX_ENTRIES) return;
  const oldest = map.keys().next().value as K | undefined;
  if (oldest !== undefined) map.delete(oldest);
}

export class ResponseCache {
  private readonly content = new Map<string, string>();
  private readonly entitled = new Map<string, number>();
  private readonly schemas = new Map<string, JsonSchema>();
  private readonly evals = new Map<string, EvalResult>();
  /** Knowledge-graph answers, keyed by caller as well as by content — see {@link getKgQuery}. */
  private readonly kgAnswers = new Map<string, { results: unknown[]; expiresAt: number }>();
  private readonly salt = crypto.randomBytes(16);

  getContent(kind: ContentKind, classId: string, pin: string): string | undefined {
    return this.content.get(contentKey(kind, classId, pin));
  }

  putContent(kind: ContentKind, classId: string, pin: string, value: string): void {
    this.content.set(contentKey(kind, classId, pin), value);
  }

  /** True only if this exact caller was confirmed entitled for (classId, pin)
   * within the TTL. Never a stored `false` — an unknown or expired entry re-checks. */
  isEntitled(token: string, classId: string, pin: string, now: number = Date.now()): boolean {
    const key = this.memoKey(token, classId, pin);
    const expiresAt = this.entitled.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.entitled.delete(key);
      return false;
    }
    return true;
  }

  rememberEntitled(token: string, classId: string, pin: string, now: number = Date.now()): void {
    this.entitled.set(this.memoKey(token, classId, pin), now + ENTITLEMENT_TTL_MS);
    capFifo(this.entitled);
  }

  // --- Schema cache (immutable at the pin; only ever populated from a real
  //     entitled template fetch, never a fallback) ---------------------------

  getSchema(classId: string, pin: string): JsonSchema | undefined {
    return this.schemas.get(pairKey(classId, pin));
  }

  putSchema(classId: string, pin: string, schema: JsonSchema): void {
    this.schemas.set(pairKey(classId, pin), schema);
  }

  // --- Eval cache (deterministic at the pin; keyed by the stripped attrs) ----

  getEval(classId: string, pin: string, attributesHash: string): EvalResult | undefined {
    return this.evals.get(evalKey(classId, pin, attributesHash));
  }

  putEval(classId: string, pin: string, attributesHash: string, result: EvalResult): void {
    this.evals.set(evalKey(classId, pin, attributesHash), result);
    capFifo(this.evals);
  }

  /** Drop every cached template/guide, schema, and eval result for a pin — used
   * the moment a recall is observed, so recalled content never serves again.
   * (Keys are `\0`-delimited; the pin is one of the segments.) */
  evictPin(pin: string): void {
    for (const map of [this.content, this.schemas, this.evals] as Array<Map<string, unknown>>) {
      for (const key of map.keys()) {
        if (key.split('\0').includes(pin)) map.delete(key);
      }
    }
  }

  // --- Knowledge-graph answers (caller-scoped) -------------------------------

  /**
   * A knowledge-graph answer, if this exact caller has one that has not expired.
   *
   * **The caller is part of the key, and that is the whole point.** The protocol suggests caching
   * these by `(queryName, version, hash(parameters))` — the *content* key, which is valid only
   * inside one caller. Unlike a template, which is account-invariant bytes behind a per-caller
   * gate, a knowledge-graph answer's **content** varies by caller: the match set is computed over
   * that caller's entitled slices. A deployment-shared entry is wrong in both directions — it can
   * hand a caller matches from a slice their account never bought, and it can hand an entitled
   * caller the thinner answer computed for a less-entitled one. The second is the silent one.
   *
   * Entries expire on the same horizon as an entitlement memo, because that is how long any
   * statement about what a caller may see is trusted here.
   */
  getKgQuery(
    token: string,
    queryName: string,
    version: string,
    parameters: unknown,
    now: number = Date.now(),
  ): unknown[] | undefined {
    const key = this.kgKey(token, queryName, version, parameters);
    const entry = this.kgAnswers.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.kgAnswers.delete(key);
      return undefined;
    }
    return entry.results;
  }

  putKgQuery(
    token: string,
    queryName: string,
    version: string,
    parameters: unknown,
    results: unknown[],
    now: number = Date.now(),
  ): void {
    this.kgAnswers.set(this.kgKey(token, queryName, version, parameters), {
      results,
      expiresAt: now + ENTITLEMENT_TTL_MS,
    });
    capFifo(this.kgAnswers);
  }

  /**
   * Drop everything cached for one caller — used the moment that caller is refused.
   *
   * Scoped to the caller rather than global: another caller's entries were computed against their
   * own entitlements and remain correct. The caller hash is the first key segment, so this is a
   * prefix test rather than a segment search — a segment search could match a caller whose hash
   * happened to equal some other segment's value.
   */
  evictCaller(token: string): void {
    const prefix = `${this.callerHash(token)}\0`;
    for (const key of this.kgAnswers.keys()) {
      if (key.startsWith(prefix)) this.kgAnswers.delete(key);
    }
  }

  private kgKey(token: string, queryName: string, version: string, parameters: unknown): string {
    const params = crypto.createHash('sha256').update(stableStringify(parameters)).digest('hex');
    return `${this.callerHash(token)}\0${queryName}\0${version}\0${params}`;
  }

  /** An opaque per-process value, never the token and never persisted. The salt is per instance,
   * so the same token yields different hashes in different processes — a stored fingerprint would
   * be a stable identifier for a credential, which this deliberately is not. */
  private callerHash(token: string): string {
    return crypto.createHash('sha256').update(this.salt).update(token).digest('hex');
  }

  private memoKey(token: string, classId: string, pin: string): string {
    return `${this.callerHash(token)}\0${classId}\0${pin}`;
  }
}

/**
 * Canonical JSON: object keys sorted at every depth, array order preserved.
 *
 * So a hash of equal data is equal regardless of key order. Lives here rather than beside either
 * caller because both cache keys need it and a second copy would be one edit away from hashing
 * the same input differently.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function contentKey(kind: ContentKind, classId: string, pin: string): string {
  return `${kind}\0${classId}\0${pin}`;
}

function pairKey(classId: string, pin: string): string {
  return `${classId}\0${pin}`;
}

function evalKey(classId: string, pin: string, attributesHash: string): string {
  return `${classId}\0${pin}\0${attributesHash}`;
}
