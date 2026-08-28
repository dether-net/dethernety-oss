#!/usr/bin/env node
/**
 * Dethereal MCP Server Entry Point
 *
 * Model Context Protocol server for Dethernety threat modeling platform.
 * Provides tools for authentication, threat model validation, import, export, and manipulation.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { getConfig, validateConfig, debug } from './config.js'
import { createApolloClient } from './client/apollo-client.js'
import {
  fetchPlatformConfig,
  loadStoredTokens,
  saveTokens,
  isTokenExpired,
  isRefreshTokenValid,
  refreshTokens,
  getCachedPlatformConfig,
  isAuthDisabled
} from './auth/index.js'
import { allTools, clientDependentTools, BaseTool, ToolContext } from './tools/index.js'

// Server instance
const server = new Server(
  {
    name: 'dethereal',
    version: '3.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

/**
 * Resolve the session's two tokens: the bearer, and the identity token behind it.
 *
 * They are not interchangeable and each is used for exactly one thing:
 *
 * - `bearer` is the ACCESS token. Only it carries the `scope` claim, and anything
 *   sitting behind the platform is entitled to require one — presenting the
 *   identity token works until a request leaves the platform, then fails opaquely.
 * - `identity` is the ID token. Only it carries the profile claims (`email`), which
 *   is what audit attribution records. Reading identity off the bearer would silently
 *   demote every attributed entry to an opaque subject id.
 *
 * Resolution order:
 * 1. Stored token from local cache (if not expired)
 * 2. Transparent refresh (if access token expired but refresh token valid)
 * 3. undefined (tool will fail if requiresClient=true)
 *
 * @returns access token, or undefined if not available
 */
async function getSessionTokens(): Promise<{ bearer: string; identity: string } | undefined> {
  const config = getConfig()
  debug(`Loading stored tokens for baseUrl: ${config.baseUrl}`)
  const storedTokens = await loadStoredTokens(config.baseUrl)

  if (!storedTokens) {
    debug('No stored tokens found')
    return undefined
  }

  // Valid token: use it directly
  if (!isTokenExpired(storedTokens)) {
    debug('Using stored accessToken for authentication')
    return { bearer: storedTokens.accessToken, identity: storedTokens.idToken }
  }

  // Expired but refresh token valid: attempt transparent refresh
  if (isRefreshTokenValid(storedTokens)) {
    try {
      debug('Token expired, attempting transparent refresh')
      await fetchPlatformConfig()
      const newTokens = await refreshTokens(storedTokens.refreshToken)
      await saveTokens({
        accessToken: newTokens.accessToken,
        idToken: newTokens.idToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: Date.now() + newTokens.expiresIn * 1000,
        baseUrl: config.baseUrl,
        storedAt: Date.now(),
        grantedScope: newTokens.scope
      })
      debug('Transparent token refresh succeeded')
      return { bearer: newTokens.accessToken, identity: newTokens.idToken }
    } catch (error) {
      debug(`Transparent refresh failed: ${error}`)
    }
  }

  debug(`Stored tokens expired. expiresAt: ${storedTokens.expiresAt}, now: ${Date.now()}`)
  return undefined
}

/**
 * Build tool context for execution
 */
async function buildToolContext(): Promise<ToolContext> {
  const config = getConfig()
  const authDisabled = isAuthDisabled()

  // In auth-disabled mode, create an unauthenticated Apollo client directly
  if (authDisabled) {
    debug('Auth disabled — creating unauthenticated Apollo client')
    let apolloClient = undefined
    let clientUnavailableReason: string | undefined
    try {
      if (!getCachedPlatformConfig()) {
        await fetchPlatformConfig()
      }
      apolloClient = createApolloClient()
      debug('Unauthenticated Apollo client created successfully')
      clientUnavailableReason = undefined
    } catch (error) {
      debug(`Failed to create Apollo client: ${error}`)
      clientUnavailableReason =
        `auth is DISABLED on this platform, so this is not an authentication problem — ` +
        `the client could not be built: ${error instanceof Error ? error.message : String(error)}. ` +
        `Calling "login" will not help (it answers "No login needed"). Check the platform URL and that ` +
        `its /config endpoint is reachable and well-formed.`
    }
    return { apolloClient, token: undefined, debug: config.debug, clientUnavailableReason }
  }

  // Get the best available token (stored → transparent refresh → undefined)
  const session = await getSessionTokens()
  const accessToken = session?.bearer
  debug(`Token available: ${accessToken ? 'yes' : 'no'}`)

  // Create Apollo client if we have a token
  let apolloClient = undefined
  let tokenPathFailure: string | undefined
  if (accessToken) {
    try {
      // Ensure platform config is loaded before creating Apollo client
      if (!getCachedPlatformConfig()) {
        debug('Platform config not cached, fetching...')
        await fetchPlatformConfig()
      }
      apolloClient = createApolloClient(accessToken)
      debug('Apollo client created successfully')
    } catch (error) {
      debug(`Failed to create Apollo client: ${error}`)
      // Don't throw - let the tool handle the missing client. Keep the reason:
      // the token was present and usable here, so reporting this as an auth
      // failure sends the operator to re-login for a problem re-login cannot fix.
      tokenPathFailure =
        `a stored token WAS available, so this is not an authentication problem — ` +
        `the GraphQL client could not be built: ${error instanceof Error ? error.message : String(error)}. ` +
        `This usually means the platform's /config endpoint is unreachable or malformed.`
    }
  }

  return {
    apolloClient,
    token: accessToken,
    identityToken: session?.identity,
    debug: config.debug,
    clientUnavailableReason: tokenPathFailure
  }
}

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debug('Listing available tools')

  const tools = allTools.map((tool: BaseTool) => {
    // Convert Zod schema to JSON Schema
    const jsonSchema = z.toJSONSchema(tool.inputSchema, {
      target: 'draft-07'
    })

    // Remove the outermost wrapper to get just the properties
    const inputSchema = (jsonSchema as Record<string, unknown>).properties
      ? {
          type: 'object' as const,
          properties: (jsonSchema as Record<string, unknown>).properties,
          required: ((jsonSchema as Record<string, unknown>).required as string[]) || []
        }
      : { type: 'object' as const, properties: {} }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema
    }
  })

  return { tools }
})

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params

  debug(`Tool call: ${name}`)

  // Find the tool
  const tool = allTools.find((t) => t.name === name)

  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  }

  // Check if tool requires client
  const requiresClient = clientDependentTools.includes(tool)
  const context = await buildToolContext()

  if (requiresClient && !context.apolloClient) {
    // Both client-construction catches record WHY the client is missing. Only
    // say "Authentication required" when that is actually the cause — otherwise
    // this message sends the operator to re-login for a fault re-login cannot
    // fix, and in auth-disabled mode the advice cannot even be followed.
    const reason = context.clientUnavailableReason
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            reason
              ? { error: 'Platform client unavailable', message: reason, tool: name }
              : {
                  error: 'Authentication required',
                  message:
                    'This tool requires authentication. Please call the "login" tool first to authenticate via browser OAuth.',
                  tool: name
                },
            null,
            2
          )
        }
      ],
      isError: true
    }
  }

  try {
    // Validate input and execute the tool
    const result = await tool.run(args, context)

    if (result.success) {
      // ToolResult carries an optional top-level `warnings`, but only `data`
      // was serialized — so a tool that set warnings as a sibling of data (the
      // shape the ToolResult type invites) had them silently dropped before
      // they reached the caller. Merge them in rather than requiring every tool
      // to remember to nest them, which is the mistake this shape encourages.
      const payload = result.warnings?.length
        ? (result.data && typeof result.data === 'object' && !Array.isArray(result.data)
            // Nested warnings win: a tool that already put them in `data` has
            // the richer, tool-specific list.
            ? { warnings: result.warnings, ...(result.data as Record<string, unknown>) }
            : { data: result.data, warnings: result.warnings })
        : result.data

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2)
          }
        ]
      }
    } else {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: result.error,
                data: result.data
              },
              null,
              2
            )
          }
        ],
        isError: true
      }
    }
  } catch (error) {
    debug(`Tool execution error: ${error}`)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: error instanceof Error ? error.message : 'Unknown error',
              tool: name
            },
            null,
            2
          )
        }
      ],
      isError: true
    }
  }
})

/**
 * Main entry point
 */
async function main() {
  const config = getConfig()

  try {
    // Validate configuration
    validateConfig(config)
    debug('Configuration validated')
    debug(`Platform URL: ${config.baseUrl}`)
  } catch (error) {
    console.error('Configuration error:', error)
    process.exit(1)
  }

  // Fetch platform configuration
  try {
    debug('Fetching platform configuration...')
    await fetchPlatformConfig()
    debug('Platform configuration loaded')
  } catch (error) {
    // Log warning but don't exit - config will be fetched on first auth attempt
    debug(`Warning: Could not fetch platform config: ${error}`)
    debug('Platform config will be fetched when needed')
  }

  // Start the server with stdio transport
  const transport = new StdioServerTransport()

  debug('Starting MCP server...')
  debug(`Available tools: ${allTools.map((t) => t.name).join(', ')}`)

  await server.connect(transport)

  debug('MCP server started successfully')
}

// Run the server
main().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
