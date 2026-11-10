/**
 * Refresh-token revocation (RFC 7009).
 *
 * Each session is revoked only at the identity provider of its own platform, with
 * that platform's client id, read from that platform's /config at the time of
 * revocation (never from the cache, which belongs to the configured platform). A
 * session that recorded its issuer when it was saved is revoked only if the
 * platform still names that issuer: a platform that now points elsewhere never
 * receives the token.
 *
 * Nothing here holds the token store's lock; callers remove the sessions first.
 * Results carry fixed text or an HTTP status with a standard OAuth error code,
 * never a response body, a URL or a token.
 */

import fetch from 'cross-fetch'
import { debug, validateConfig } from '../config.js'
import { loadPlatformConfig, getOAuthUrls, isHostOnly, type PlatformConfig } from './platform-config.js'
import { getTokenKey, type RemovedSession } from './token-store.js'
import { endpointFailure } from './token-endpoint.js'
import { registerSecret } from './redact.js'

/** Upper bound on one revocation request. */
export const REVOKE_TIMEOUT_MS = 5_000

/** At most this many sessions are revoked by one logout; the rest are reported as skipped. */
export const MAX_REVOCATIONS = 20

export interface RevocationResult {
  /** The platform's origin, or `unknown` for an entry that names none. */
  platform: string
  result: 'revoked' | 'skipped' | 'failed'
  reason?: string
}

type Attempt = { ok: true } | { ok: false; reason: string }

/** POST the token to the provider's revocation endpoint. Never throws. */
async function revokeAt(platformConfig: PlatformConfig, refreshToken: string): Promise<Attempt> {
  registerSecret(refreshToken)
  let url: string
  try {
    url = getOAuthUrls(platformConfig).revoke
  } catch {
    return { ok: false, reason: 'invalid platform config' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken, client_id: platformConfig.oidcClientId }).toString(),
      signal: controller.signal,
      // A redirect would re-send the token wherever it points.
      redirect: 'error'
    })
    if (response.ok) return { ok: true }
    const failure = await endpointFailure('Revocation', response)
    return { ok: false, reason: `HTTP ${failure.status}${failure.oauthError ? ` (${failure.oauthError})` : ''}` }
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network error' }
  } finally {
    clearTimeout(timer)
  }
}

async function revokeOne(session: RemovedSession): Promise<RevocationResult> {
  let platform: string
  try {
    platform = session.baseUrl ? getTokenKey(session.baseUrl) : ''
  } catch {
    platform = ''
  }
  if (!platform || platform !== session.storeKey) {
    return { platform: 'unknown', result: 'skipped', reason: 'malformed entry' }
  }
  if (!session.refreshToken) return { platform, result: 'skipped', reason: 'no refresh token' }

  try {
    validateConfig({ baseUrl: session.baseUrl! })
  } catch {
    return { platform, result: 'skipped', reason: 'invalid platform URL' }
  }
  let platformConfig: PlatformConfig
  try {
    platformConfig = await loadPlatformConfig(session.baseUrl!)
  } catch {
    return { platform, result: 'skipped', reason: 'platform unreachable' }
  }
  if (platformConfig.authDisabled) return { platform, result: 'skipped', reason: 'sign-in disabled on the platform' }
  if (
    session.oidcDomain !== undefined &&
    (session.oidcDomain !== platformConfig.oidcDomain || session.oidcClientId !== platformConfig.oidcClientId)
  ) {
    return { platform, result: 'skipped', reason: 'issuer changed' }
  }

  if (!isHostOnly(platformConfig.oidcDomain) || !platformConfig.oidcClientId) {
    return { platform, result: 'skipped', reason: 'invalid platform config' }
  }

  const attempt = await revokeAt(platformConfig, session.refreshToken)
  if (attempt.ok) return { platform, result: 'revoked' }
  return { platform, result: 'failed', reason: attempt.reason }
}

/** Revoke removed sessions, each at its own platform, in parallel. Never throws. */
export async function revokeSessions(sessions: RemovedSession[]): Promise<RevocationResult[]> {
  const now = sessions.slice(0, MAX_REVOCATIONS)
  const later = sessions.slice(MAX_REVOCATIONS)
  const results = await Promise.all(
    now.map((s) =>
      revokeOne(s).catch((): RevocationResult => ({ platform: 'unknown', result: 'failed', reason: 'internal error' }))
    )
  )
  for (const s of later) {
    let platform = 'unknown'
    try {
      if (s.baseUrl && getTokenKey(s.baseUrl) === s.storeKey) platform = s.storeKey
    } catch {
      // Reported as unknown.
    }
    results.push({ platform, result: 'skipped', reason: 'limit' })
  }
  for (const r of results) debug(`Revocation at ${r.platform}: ${r.result}${r.reason ? ` (${r.reason})` : ''}`)
  return results
}

/**
 * Revoke a refresh token that was received but will not be stored, at the
 * provider that issued it. Runs in the background; the outcome goes to debug only.
 */
export function revokeDetached(refreshToken: string, issuer: PlatformConfig): void {
  registerSecret(refreshToken)
  void revokeAt(issuer, refreshToken).then(
    (attempt) => debug(`Unstored session revoked: ${attempt.ok ? 'yes' : `no (${attempt.reason})`}`),
    () => debug('Unstored session revocation failed')
  )
}
