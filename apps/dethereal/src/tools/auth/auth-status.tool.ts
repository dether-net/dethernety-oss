/**
 * Auth Status Tool
 *
 * Reports the session state for the configured platform, so no prompt ever needs
 * to read the local token store itself.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { getConfig } from '../../config.js'
import {
  fetchPlatformConfig,
  getCachedPlatformConfig,
  loadStoredTokens,
  isTokenExpired,
  isRefreshTokenValid,
  refreshStoredSession,
  type PlatformConfig
} from '../../auth/index.js'
import { getRequiredScope } from '../../auth/platform-config.js'
import { emailClaimOf, grantedScopeOf, parseScopes } from '../../auth/scope.js'

/** Upper bound on the network work `verify` may do, so a status check never hangs. */
const VERIFY_TIMEOUT_MS = 10_000

const InputSchema = z.object({
  verify: z
    .boolean()
    .optional()
    .describe(
      'Load the platform config and refresh an expired session before answering (network, bounded). ' +
        'Without it the answer comes from local state only.'
    )
})

type AuthStatusInput = z.infer<typeof InputSchema>

interface AuthStatusOutput {
  /** Origin of the platform this server talks to */
  platformUrl: string
  /** Where the platform URL came from */
  urlSource: 'env' | 'default'
  /** Directory model paths are resolved against */
  projectRoot: string
  /** Whether the platform runs without authentication; null when it has not been reached */
  authDisabled: boolean | null
  /** Whether platform tools will be authorized right now */
  authenticated: boolean
  /** Whether a sign-in is waiting for the browser */
  pending: boolean
  /** Signed-in user, from the session's identity token */
  email?: string
  /** When the current access token expires (ISO-8601) */
  expiresAt?: string
  /** Seconds until the access token expires, never negative */
  secondsRemaining?: number
  /** Scopes the platform asks for that the session was not granted */
  scopeShortfall?: string
  /** Why the session is not usable, when it is not */
  detail?: string
}

interface SessionView {
  idToken: string
  accessToken: string
  expiresAt: number
  grantedScope?: string
}

function describeFailure(error: unknown): string {
  const names = [error, (error as { cause?: unknown } | null)?.cause].map(
    (e) => (e as { name?: unknown } | null)?.name
  )
  if (names.includes('AbortError') || names.includes('TimeoutError')) return 'timeout'
  return error instanceof Error ? error.message : 'unknown error'
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'invalid URL'
  }
}

export class AuthStatusTool extends ClientFreeTool<AuthStatusInput, AuthStatusOutput> {
  readonly name = 'auth_status'

  readonly description = `Report the Dethernety session state: platform URL, whether platform tools are authorized, the signed-in user and how long the session has left.

Use this to check authentication. Never read files under ~/.dethernety/ in the home directory — session credentials stay inside this server and are never returned.

- verify: true — load the platform config and refresh an expired session first (network, at most ${VERIFY_TIMEOUT_MS / 1000} s). Use it before pushing or pulling.
- authenticated is true for a live session, or when the platform has authentication disabled.`

  readonly inputSchema = InputSchema

  async execute(input: AuthStatusInput, _context: ToolContext): Promise<ToolResult<AuthStatusOutput>> {
    const config = getConfig()
    const verify = input.verify === true
    const signal = verify ? AbortSignal.timeout(VERIFY_TIMEOUT_MS) : undefined
    let detail: string | undefined

    const base = {
      platformUrl: originOf(config.baseUrl),
      urlSource: (process.env.DETHERNETY_URL ? 'env' : 'default') as 'env' | 'default',
      projectRoot: process.cwd(),
      pending: false
    }

    let platformConfig: PlatformConfig | null = getCachedPlatformConfig()
    if (verify && !platformConfig) {
      try {
        platformConfig = await fetchPlatformConfig(undefined, { signal })
      } catch (error) {
        // The fetch error quotes the configured URL, which may carry userinfo.
        detail = `platform unreachable: ${describeFailure(error).split(config.baseUrl).join(base.platformUrl)}`
      }
    }
    const authDisabled = platformConfig ? platformConfig.authDisabled === true : null

    if (authDisabled) {
      return { success: true, data: { ...base, authDisabled, authenticated: true } }
    }

    const stored = await loadStoredTokens(config.baseUrl)
    if (!stored) {
      return {
        success: true,
        data: { ...base, authDisabled, authenticated: false, detail: detail ?? 'not signed in' }
      }
    }

    let session: SessionView = stored
    if (isTokenExpired(stored) && verify && platformConfig) {
      if (isRefreshTokenValid(stored)) {
        try {
          const fresh = await refreshStoredSession(stored, config.baseUrl, { signal })
          session = {
            idToken: fresh.idToken,
            accessToken: fresh.accessToken,
            expiresAt: Date.now() + fresh.expiresIn * 1000,
            grantedScope: fresh.scope
          }
        } catch (error) {
          detail = `refresh failed: ${describeFailure(error)}`
        }
      } else {
        detail = 'session expired; sign in again'
      }
    }

    const authenticated = !isTokenExpired({ ...stored, ...session })
    if (!authenticated && !detail) {
      detail = verify
        ? 'session expired; sign in again'
        : 'access token expired; call again with verify: true to refresh it'
    }

    let scopeShortfall: string | undefined
    if (platformConfig) {
      const granted = parseScopes(grantedScopeOf(session))
      const missing = parseScopes(getRequiredScope(platformConfig)).filter((s) => !granted.includes(s))
      scopeShortfall = missing.length > 0 ? missing.join(' ') : undefined
    }

    return {
      success: true,
      data: {
        ...base,
        authDisabled,
        authenticated,
        email: emailClaimOf(session.idToken),
        expiresAt: new Date(session.expiresAt).toISOString(),
        secondsRemaining: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
        scopeShortfall,
        detail
      }
    }
  }
}

export const authStatusTool = new AuthStatusTool()
