/**
 * Login Tool
 *
 * Authenticates the user via browser-based OAuth (authorization code + PKCE).
 * Uses the stored session if valid, refreshes it if expired, or opens the browser for a new login.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { getConfig } from '../../config.js'
import { performLogin, isAuthDisabled } from '../../auth/index.js'
import { emailClaimOf } from '../../auth/scope.js'

/**
 * Input schema for login tool
 */
const InputSchema = z.object({
  /** Timeout in milliseconds for waiting for browser callback (default: 120000 = 2 minutes) */
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
  /** Force new login even if cached tokens are valid */
  force_new: z.boolean().optional().describe('Force new login even if cached tokens are valid')
})

type LoginInput = z.infer<typeof InputSchema>

/**
 * Output from login tool
 */
interface LoginOutput {
  /** Token lifetime in seconds */
  expiresIn: number
  /** Token type */
  tokenType: string
  /** Whether tokens came from cache */
  fromCache?: boolean
  /** Whether tokens were refreshed using refresh token */
  refreshed?: boolean
  /** Origin of the platform signed in to */
  platformUrl: string
  /** Signed-in user, from the identity token */
  email?: string
  /** Status message */
  message: string
  /**
   * Scopes the platform asked for that the provider did not grant, if any.
   *
   * Present only on an otherwise-successful login. The session still works for
   * the platform itself; this reports that something behind it may refuse the
   * token, which is otherwise invisible until a feature quietly stops working.
   */
  scopeShortfall?: string
}

function platformOrigin(): string {
  try {
    return new URL(getConfig().baseUrl).origin
  } catch {
    return 'invalid URL'
  }
}

/**
 * Login tool - authenticates user via browser OAuth
 */
export class LoginTool extends ClientFreeTool<LoginInput, LoginOutput> {
  readonly name = 'login'

  readonly description = `Sign in to the Dethernety platform.

- A valid stored session is reused (fromCache: true); an expired one is refreshed when possible (refreshed: true).
- Otherwise the default browser opens the platform's sign-in page and this call waits for the sign-in to finish.

Session credentials stay inside this server and are never returned. Use auth_status to check the session.`

  readonly inputSchema = InputSchema

  async execute(input: LoginInput, context: ToolContext): Promise<ToolResult<LoginOutput>> {
    if (isAuthDisabled()) {
      return {
        success: true,
        data: {
          expiresIn: 0,
          tokenType: 'none',
          platformUrl: platformOrigin(),
          message: 'Authentication is disabled. No login needed — all tools work without authentication.'
        }
      }
    }

    try {
      const result = await performLogin({
        timeout: input.timeout ?? 120000,
        forceNew: input.force_new ?? false
      })

      if (!result.success || !result.tokens) {
        return {
          success: false,
          error: result.error || 'Login failed'
        }
      }

      return {
        success: true,
        data: {
          expiresIn: result.tokens.expiresIn,
          tokenType: result.tokens.tokenType,
          fromCache: result.fromCache,
          refreshed: result.refreshed,
          platformUrl: platformOrigin(),
          email: emailClaimOf(result.tokens.idToken),
          scopeShortfall: result.scopeShortfall,
          message: result.scopeShortfall
            ? `Authentication successful, but the provider did not grant: ${result.scopeShortfall}. ` +
              'Features depending on those scopes will be refused.'
            : 'Authentication successful.'
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed'
      }
    }
  }
}

export const loginTool = new LoginTool()
