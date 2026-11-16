/**
 * Dethereal MCP Server
 *
 * Model Context Protocol server for Dethernety threat modeling platform.
 * Provides tools for authentication, threat model validation, import, export, and manipulation.
 */

import { readFileSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js'

import { configProblem, getConfig, debug, originOf } from './config.js'
import { missingPlatformCapability } from './client/platform-capabilities.js'
import { fetchPlatformConfig, cancelPendingLogin } from './auth/index.js'
import { buildToolContext } from './client/tool-context.js'
import { redactSecrets, redactStderr } from './auth/redact.js'
import { allTools, authTools, clientDependentTools, localTools, needsDataControls, BaseTool, ToolContext } from './tools/index.js'
import { initProjectRoot } from './utils/project-root.js'
import { installJournalAuthenticator } from './tools/manage-controls.tool.js'
import { listedTool } from './tool-listing.js'
import { resultText } from './tools/base-tool.js'
import { settlementEnvProblem } from './utils/settlement-switch.js'

// Before anything can log: the bundled GraphQL layer writes platform error text
// to stderr on its own, and that text can echo the session's bearer.
redactStderr()
// Node prints a fatal error itself, without going through process.stderr.write, so
// report it here instead and exit as Node would have.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}

/** The package's version, stamped in by the build; undefined when running from source. */
declare const __DETHEREAL_VERSION__: string | undefined

/** The version the server reports: the build's, or package.json's when running from source. */
function serverVersion(): string {
  if (typeof __DETHEREAL_VERSION__ === 'string') return __DETHEREAL_VERSION__
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Server instance
const server = new Server(
  {
    name: 'dethereal',
    version: serverVersion()
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debug('Listing available tools')

  const tools = allTools.map(listedTool)

  return { tools }
})

type CallToolResponse = { content: { type: 'text'; text: string }[]; isError?: boolean }

function textResponse(body: unknown, isError?: boolean, compact?: boolean): CallToolResponse {
  return {
    content: [{ type: 'text', text: resultText(body, compact) }],
    ...(isError ? { isError: true } : {})
  }
}

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

  // Every result passes through redaction: tools relay platform text this
  // server does not control, and that text can echo the session's bearer.
  const response = await callTool(tool, name, args)
  return {
    ...response,
    content: response.content.map((item) => ({ ...item, text: redactSecrets(item.text) }))
  }
})

async function callTool(tool: BaseTool, name: string, args: Record<string, unknown>): Promise<CallToolResponse> {
  try {
    // An unusable configuration (e.g. a plain-HTTP remote URL) reaches no network:
    // every platform tool reports it, and auth_status describes it alongside the rest.
    const local = (localTools as BaseTool[]).includes(tool)
    const problem = configProblem()
    // Signing out must stay possible, above all when the runtime is refused: logout clears the local
    // session and skips revoking it over a connection that cannot be trusted.
    if (problem && tool.name !== 'auth_status' && tool.name !== 'logout' && !local) {
      return textResponse({ error: 'Configuration error', message: problem, tool: name }, true)
    }

    // The auth tools manage the session themselves. Building a session context
    // for them would refresh an expired session first — a network call that
    // auth_status must not make unless asked, and that would make login report a
    // refresh it did not perform. Local tools read files only and need no session.
    const context: ToolContext = (authTools as BaseTool[]).includes(tool) || local
      ? { debug: getConfig().debug }
      : await buildToolContext()

    // Check if tool requires client
    const requiresClient = clientDependentTools.includes(tool)

    if (requiresClient && !context.apolloClient) {
      // Both client-construction catches record WHY the client is missing. Only
      // say "Authentication required" when that is actually the cause — otherwise
      // this message sends the operator to re-login for a fault re-login cannot
      // fix, and in auth-disabled mode the advice cannot even be followed.
      const reason = context.clientUnavailableReason
      return textResponse(
        reason
          ? { error: 'Platform client unavailable', message: reason, tool: name }
          : {
              error: 'Authentication required',
              message:
                'This tool requires authentication. Please call the "login" tool first to authenticate via browser OAuth.',
              tool: name
            },
        true
      )
    }

    // A platform older than the documents this tool sends refuses all of them; say so once, in words, instead.
    if (context.apolloClient && needsDataControls(tool, args)) {
      const missing = await missingPlatformCapability(context.apolloClient, getConfig().baseUrl)
      if (missing) {
        return textResponse({ error: 'Platform too old for this Dethereal version', message: missing, tool: name }, true)
      }
    }

    // Validate input and execute the tool
    const result = await tool.run(args, context)

    if (!result.success) {
      return textResponse({ error: result.error, data: result.data }, true)
    }

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

    return textResponse(payload, false, tool.compactResult)
  } catch (error) {
    debug(`Tool execution error: ${error}`)
    return textResponse({ error: error instanceof Error ? error.message : 'Unknown error', tool: name }, true)
  }
}

/**
 * Main entry point
 *
 * Only local work happens before the transport connects, so a platform that is slow
 * or unreachable can never delay the handshake — the harness would show the server
 * as missing. The platform config is then loaded in the background, bounded, and
 * again by the first tool call that needs it.
 */
async function main() {
  const config = getConfig()
  const problem = configProblem()
  if (problem) {
    debug(`Configuration error: ${problem}`)
  } else {
    debug(`Platform URL: ${originOf(config.baseUrl)} (from ${config.urlSource})`)
  }

  // A value that is not the switch's is never guessed at: it reads as off, said once.
  const settlementProblem = settlementEnvProblem()
  if (settlementProblem) process.stderr.write(`dethereal: ${settlementProblem}\n`)

  const root = initProjectRoot()
  debug(root.root === null ? `No project root: ${root.reason}` : `Project root from ${root.source}`)

  // Before any tool can run: only journals this machine signed are ever replayed.
  installJournalAuthenticator()

  // Start the server with stdio transport
  const transport = new StdioServerTransport()

  debug('Starting MCP server...')
  debug(`Available tools: ${allTools.map((t) => t.name).join(', ')}`)

  await server.connect(transport)

  debug('MCP server started successfully')

  // The stdio transport does not end the process when the harness closes stdin.
  // A pending sign-in would keep its listener (and the callback port) alive, and
  // could still write the session store; cancel it and exit instead.
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    debug('stdin closed; shutting down')
    cancelPendingLogin().finally(() => process.exit(0))
  }
  process.stdin.once('end', shutdown)
  process.stdin.once('close', shutdown)

  if (!problem) {
    fetchPlatformConfig().then(
      () => debug('Platform configuration loaded'),
      (error) => debug(`Platform config not loaded yet: ${error instanceof Error ? error.message : String(error)}`)
    )
  }
}

// Run the server
main().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
