/**
 * The failure taxonomy of the remote content service, expressed as typed
 * errors. Every wire outcome (an HTTP status plus an optional problem-document
 * `code`) collapses to exactly one of these classes; nothing else propagates
 * into a resolver, and a raw upstream error body never passes through — messages
 * are plain and non-sensitive by construction.
 *
 * The four behavioral classes (per the protocol's normative client mapping):
 *   - session expired      → re-authenticate                (401)
 *   - not entitled         → denial handling                (403)
 *   - recalled / misconfig → operator problem, not transient (410, 404-on-pin, 400/413, 500 eval_failed)
 *   - unavailable          → transient, back off / degrade  (429, other 5xx, timeout, network)
 */

/** A recognized problem-document `code` extension, when the body carried one. */
export type WireErrorCode =
  | 'invalid_token'
  | 'token_expired'
  | 'not_entitled'
  | 'module_not_found'
  | 'version_not_found'
  | 'class_not_found'
  | 'version_recalled'
  | 'payload_invalid'
  | 'payload_too_large'
  | 'rate_limited'
  | 'eval_failed'
  | 'internal';

/** The recall detail block a `410 version_recalled` carries. */
export interface RecallInfo {
  moduleKey?: string;
  version?: string;
  reason?: string;
  recalledAt?: string;
  supersededBy?: string;
}

/** The denial block a `403 not_entitled` carries. */
export interface DenialInfo {
  subject?: { kind?: string; id?: string; moduleKey?: string };
  packages?: Array<{ key?: string; name?: string }>;
  message?: {
    title?: string;
    body?: string;
    actionUrl?: string;
    actionLabel?: string;
  };
}

/** 401 — the caller's token is invalid or expired; re-authenticate (never retried). */
export class CloudSessionExpiredError extends Error {
  readonly code: 'invalid_token' | 'token_expired';
  constructor(code: 'invalid_token' | 'token_expired' = 'invalid_token', message?: string) {
    super(message ?? 'Cloud session expired — re-authentication required');
    this.name = 'CloudSessionExpiredError';
    this.code = code;
  }
}

/** 403 — a valid caller with no covering entitlement. On the eval surface this is
 * thrown; on the content surface the caller catches it and renders fallback. */
export class EvaluationNotEntitledError extends Error {
  readonly code = 'not_entitled';
  readonly denial?: DenialInfo;
  constructor(message?: string, denial?: DenialInfo) {
    super(message ?? 'This content is not available for the current account');
    this.name = 'EvaluationNotEntitledError';
    this.denial = denial;
  }
}

/** Transient — network failure, timeout, 429, or a 5xx with no non-transient
 * marker. Bounded backoff / serve local caches / degrade. */
export class RemoteModuleUnavailableError extends Error {
  readonly code = 'unavailable';
  readonly retryAfterMs?: number;
  constructor(message?: string, retryAfterMs?: number) {
    super(message ?? 'Remote module content service is temporarily unavailable');
    this.name = 'RemoteModuleUnavailableError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** 410 — the pinned content version is known-bad and withdrawn. An operator
 * problem: never transient, never a silent cache fallback. */
export class ContentRecalledError extends Error {
  readonly code = 'version_recalled';
  readonly recall?: RecallInfo;
  constructor(message?: string, recall?: RecallInfo) {
    super(message ?? 'This content version has been recalled');
    this.name = 'ContentRecalledError';
    this.recall = recall;
  }
}

/** 404-on-a-pinned-path / 400 / 413 / 500 eval_failed — a non-transient defect
 * an operator (or the publisher) must fix; not retried, not cached. */
export class RemoteModuleMisconfiguredError extends Error {
  readonly code: WireErrorCode | 'misconfigured';
  constructor(message?: string, code: WireErrorCode | 'misconfigured' = 'misconfigured') {
    super(message ?? 'Remote module is misconfigured');
    this.name = 'RemoteModuleMisconfiguredError';
    this.code = code;
  }
}

/** The best-effort-parsed problem document a non-2xx response may carry. */
export interface ProblemBody {
  code?: string;
  title?: string;
  denial?: DenialInfo;
  recalled?: RecallInfo;
}

/**
 * Map an HTTP status (plus an optional problem body and `Retry-After`) to the
 * typed error the client surfaces. This is the one place the service's error
 * model becomes a client outcome.
 *
 * The subtle cases:
 *   - 500/503 with **no** parseable `code` → transient Unavailable (retry). Only
 *     an explicit `eval_failed` marks a 5xx as a non-transient content defect.
 *   - 404 is always treated as a pinned-path misconfiguration here — the client
 *     only ever requests pinned subjects, so a 404 means a bad pin / retired
 *     version, which never heals by waiting.
 */
export function mapStatusToError(
  status: number,
  body?: ProblemBody,
  retryAfterMs?: number,
): Error {
  const code = body?.code;
  switch (status) {
    case 401:
      return new CloudSessionExpiredError(
        code === 'token_expired' ? 'token_expired' : 'invalid_token',
        body?.title,
      );
    case 403:
      return new EvaluationNotEntitledError(body?.denial?.message?.body ?? body?.title, body?.denial);
    case 404:
      return new RemoteModuleMisconfiguredError(
        body?.title,
        (code as WireErrorCode) ?? 'module_not_found',
      );
    case 400:
      return new RemoteModuleMisconfiguredError(body?.title, 'payload_invalid');
    case 413:
      return new RemoteModuleMisconfiguredError(body?.title, 'payload_too_large');
    case 410:
      return new ContentRecalledError(body?.recalled?.reason ?? body?.title, body?.recalled);
    case 429:
      return new RemoteModuleUnavailableError(body?.title, retryAfterMs);
    default:
      // 5xx and anything else. eval_failed is a deterministic content defect
      // (a retry with the same input cannot succeed) → misconfigured; every
      // other 5xx with no marker is a transient outage.
      if (status >= 500 && code === 'eval_failed') {
        return new RemoteModuleMisconfiguredError(body?.title, 'eval_failed');
      }
      return new RemoteModuleUnavailableError(body?.title, retryAfterMs);
  }
}
