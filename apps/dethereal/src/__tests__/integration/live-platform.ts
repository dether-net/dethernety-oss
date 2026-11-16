/**
 * The platform a triage live suite runs against. It is only the one named in DETHERNETY_URL, never a user config or
 * the code default; its /config must send GraphQL to that same origin (a /config may name another one), and either
 * report authentication disabled or the server hold a live session for it, as the product's own auth_status says
 * (the suite never reads a session itself; the session belongs to the HOME it runs with). A suite that writes also
 * needs DETHEREAL_TRIAGE_LIVE_WRITE set to that same URL: naming the platform twice is the consent to write to it.
 * The config it read is the one the suite's client then uses.
 *
 * Once a suite is switched on (DETHEREAL_TRIAGE_LIVE=1), a platform it cannot use is a failure, not a skip: a run that
 * reports passing suites must have run them.
 */
import { fetchPlatformConfig, getGraphQLEndpoint, type PlatformConfig } from '../../auth/platform-config.js'
import { authStatusTool } from '../../tools/auth/auth-status.tool.js'
import { buildToolContext } from '../../client/tool-context.js'
import type { ToolContext } from '../../tools/base-tool.js'

export interface LivePlatform {
  /** DETHEREAL_TRIAGE_LIVE=1 */
  enabled: boolean
  /** Why the suite cannot run on the platform, when it is switched on */
  problem: string | null
}

/** Whether a live suite may run, and if not, why. `write`: the suite writes to the platform. */
export async function livePlatform({ write = false }: { write?: boolean } = {}): Promise<LivePlatform> {
  if (process.env.DETHEREAL_TRIAGE_LIVE !== '1') return { enabled: false, problem: null }
  const url = process.env.DETHERNETY_URL
  if (!url) return { enabled: true, problem: 'DETHERNETY_URL must name the platform: a live suite never falls back to a user config or the default' }
  const originOf = (u: string) => {
    try {
      return new URL(u).origin
    } catch {
      return null
    }
  }
  if (originOf(url) !== url) return { enabled: true, problem: `DETHERNETY_URL must be a platform origin (scheme, host and port only), not ${url}` }
  if (write && process.env.DETHEREAL_TRIAGE_LIVE_WRITE !== url) {
    return { enabled: true, problem: 'this suite writes to the platform: set DETHEREAL_TRIAGE_LIVE_WRITE to the same URL as DETHERNETY_URL' }
  }
  // Read and cached for this URL: the suite's Apollo client takes its GraphQL endpoint from this config.
  let cfg: PlatformConfig
  try {
    cfg = await fetchPlatformConfig(url)
  } catch (err) {
    return { enabled: true, problem: `${url}: ${err instanceof Error ? err.message : String(err)}` }
  }
  let endpoint: string
  try {
    endpoint = getGraphQLEndpoint(cfg)
  } catch (err) {
    return { enabled: true, problem: `${url}'s GraphQL endpoint: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (new URL(endpoint).origin !== new URL(url).origin) return { enabled: true, problem: `${url}'s /config sends GraphQL to ${new URL(endpoint).origin}, another platform: the live suites run only on the one named` }
  if (cfg.authDisabled !== true) {
    const status = await authStatusTool.run({ verify: true }, { debug: false })
    const data = status.data as { authenticated?: boolean; platformUrl?: string; scopeShortfall?: string } | undefined
    if (!status.success || data?.authenticated !== true || data.platformUrl !== url) {
      return { enabled: true, problem: `${url} requires authentication and this HOME holds no live session for it: sign in first, with the HOME the suite runs with` }
    }
    if (data.scopeShortfall) return { enabled: true, problem: `the session for ${url} lacks scopes the platform asks for (${data.scopeShortfall}): sign in again` }
  }
  return { enabled: true, problem: null }
}

/**
 * The context a live suite calls its tools with: the one the server builds for a tool call (the stored session's
 * bearer, or none on a platform with authentication disabled), so the suite never handles the session itself.
 */
export async function liveContext(): Promise<ToolContext> {
  const context = await buildToolContext()
  if (!context.apolloClient) throw new Error(`no platform client: ${context.clientUnavailableReason ?? 'not signed in'}`)
  return context
}
