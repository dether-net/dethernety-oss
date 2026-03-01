/**
 * Login Tool
 *
 * Authenticates the user via browser-based OAuth with Cognito.
 * Uses cached tokens if available, refreshes if expired, or opens browser for new login.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { performLogin, AuthTokens, getTokenStoragePath } from '../../auth/index.js'

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
  /** Where tokens are stored locally */
  tokenStoragePath: string
  /** Status message */
  message: string
}

/**
 * Login tool - authenticates user via browser OAuth
 */
export class LoginTool extends ClientFreeTool<LoginInput, LoginOutput> {
  readonly name = 'login'

  readonly description = `Authenticate with the Dethernety platform using browser-based OAuth.

Opens your default browser to the Cognito login page. After successful authentication,
tokens are returned and cached locally for future use.

Behavior:
- If valid cached tokens exist, returns them immediately (no browser needed)
- If cached tokens are expired but refresh token is valid, refreshes automatically
- Otherwise, opens browser for new OAuth login

The returned idToken should be used for authenticated API calls.
Tokens are cached at: ~/.dethernety/tokens.json`

  readonly inputSchema = InputSchema

  async execute(input: LoginInput, context: ToolContext): Promise<ToolResult<LoginOutput>> {
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
          tokenStoragePath: getTokenStoragePath(),
          message: 'Authentication successful. Tokens stored securely.'
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
