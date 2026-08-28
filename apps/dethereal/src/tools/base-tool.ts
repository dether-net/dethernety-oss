/**
 * Base Tool for Dethereal MCP Server
 *
 * Abstract base class for all MCP tools.
 */

import { z, ZodType } from 'zod'
import type { ApolloClient } from '@apollo/client'

/**
 * Tool execution context
 */
export interface ToolContext {
  /** Apollo Client for GraphQL operations (only available for client-dependent tools) */
  apolloClient?: ApolloClient
  /**
   * Why `apolloClient` is absent, when it is. Without this the MCP entry point
   * can only say "Authentication required", which is wrong whenever the cause
   * was not authentication — a valid unexpired token whose `/config` fetch
   * failed, a malformed config payload, or auth-disabled mode (where the advice
   * is impossible to follow, since `login` answers "No login needed").
   */
  clientUnavailableReason?: string
  /** The bearer sent to the platform — the OAuth ACCESS token (for client-dependent tools) */
  token?: string
  /**
   * The OIDC identity token for the same session, read for profile claims ONLY —
   * never presented as a bearer.
   *
   * Kept separate from `token` because the two carry different claims: the access
   * token has `scope` and no `email`, the identity token the reverse. Attribution
   * that read the bearer would record an opaque subject id for every operator.
   */
  identityToken?: string
  /**
   * JWT-anchored operator identity. Decoded once per MCP entry from the
   * `email` (preferred) or `sub` claim of the IDENTITY token — not the bearer,
   * which carries no `email`. The audit-log
   * writer threads this through as `AuditLogEntry.authnOperator` — the
   * platform-anchored truth that complements the spoofable local
   * `operator` field. `undefined` if decode failed (malformed token,
   * missing claim) — audit-log entry still writes with only the
   * local-claimed identity.
   */
  authnOperator?: string
  /** Debug mode flag */
  debug: boolean
}

/**
 * Tool result with success/error handling
 */
export interface ToolResult<T = any> {
  success: boolean
  data?: T
  error?: string
  warnings?: string[]
}

/**
 * Abstract base class for MCP tools
 */
export abstract class BaseTool<TInput = any, TOutput = any> {
  /** Unique name of the tool */
  abstract readonly name: string

  /** Description shown to the agent */
  abstract readonly description: string

  /** Zod schema for input validation */
  abstract readonly inputSchema: ZodType<TInput>

  /** Whether this tool requires an Apollo Client */
  abstract readonly requiresClient: boolean

  /**
   * Execute the tool with validated input
   *
   * @param input - Validated input parameters
   * @param context - Execution context with optional Apollo client
   * @returns Tool result
   */
  abstract execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>

  /**
   * Validate input and execute the tool
   *
   * @param rawInput - Raw input to validate and execute
   * @param context - Execution context
   * @returns Tool result
   */
  async run(rawInput: unknown, context: ToolContext): Promise<ToolResult<TOutput>> {
    try {
      // Validate input
      const parseResult = this.inputSchema.safeParse(rawInput)
      if (!parseResult.success) {
        return {
          success: false,
          error: `Invalid input: ${parseResult.error.message}`
        }
      }

      // Check if client is required but not provided
      if (this.requiresClient && !context.apolloClient) {
        return {
          success: false,
          error: 'This tool requires authentication. Please call the "login" tool first.'
        }
      }

      // Execute the tool
      return await this.execute(parseResult.data, context)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  /**
   * Get the JSON schema representation for MCP
   */
  getJsonSchema(): Record<string, any> {
    // Convert Zod schema to JSON schema
    // This is a simplified version - for production, use zod-to-json-schema
    return {
      type: 'object',
      properties: {},
      required: []
    }
  }
}

/**
 * Base class for tools that don't require a client
 */
export abstract class ClientFreeTool<TInput = any, TOutput = any> extends BaseTool<TInput, TOutput> {
  readonly requiresClient = false
}

/**
 * Base class for tools that require a client
 */
export abstract class ClientDependentTool<TInput = any, TOutput = any> extends BaseTool<TInput, TOutput> {
  readonly requiresClient = true
}
