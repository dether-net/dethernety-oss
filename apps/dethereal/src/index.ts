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
 * Get the idToken to use for authentication
 *
 * Resolution order:
 * 1. Stored token from local cache (if not expired)
 * 2. Transparent refresh (if access token expired but refresh token valid)
 * 3. undefined (tool will fail if requiresClient=true)
 *
 * @returns idToken or undefined if not available
 */
async function getIdToken(): Promise<string | undefined> {
  const config = getConfig()
  debug(`Loading stored tokens for baseUrl: ${config.baseUrl}`)
  const storedTokens = await loadStoredTokens(config.baseUrl)

  if (!storedTokens) {
    debug('No stored tokens found')
    return undefined
  }

  // Valid token: use it directly
  if (!isTokenExpired(storedTokens)) {
    debug('Using stored idToken for authentication')
    return storedTokens.idToken
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
        storedAt: Date.now()
      })
      debug('Transparent token refresh succeeded')
      return newTokens.idToken
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
    try {
      if (!getCachedPlatformConfig()) {
        await fetchPlatformConfig()
      }
      apolloClient = createApolloClient()
      debug('Unauthenticated Apollo client created successfully')
    } catch (error) {
      debug(`Failed to create Apollo client: ${error}`)
    }
    return { apolloClient, token: undefined, debug: config.debug }
  }

  // Get the best available token (stored → transparent refresh → undefined)
  const idToken = await getIdToken()
  debug(`Token available: ${idToken ? 'yes' : 'no'}`)

  // Create Apollo client if we have a token
  let apolloClient = undefined
  if (idToken) {
    try {
      // Ensure platform config is loaded before creating Apollo client
      if (!getCachedPlatformConfig()) {
        debug('Platform config not cached, fetching...')
        await fetchPlatformConfig()
      }
      apolloClient = createApolloClient(idToken)
      debug('Apollo client created successfully')
    } catch (error) {
      debug(`Failed to create Apollo client: ${error}`)
      // Don't throw - let the tool handle the missing client
    }
  }

  return {
    apolloClient,
    token: idToken,
    debug: config.debug
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
    // Return helpful error if authentication is missing
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.data, null, 2)
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
