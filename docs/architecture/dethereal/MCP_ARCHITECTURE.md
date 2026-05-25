# Dethereal MCP Server -- Target Architecture

> Target architecture for the Dethereal MCP server. Replaces [ARCHITECTURE.md](ARCHITECTURE.md) (current implementation) once the upgrade is complete.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Architecture Diagram](#2-architecture-diagram)
- [3. Core Components](#3-core-components)
- [4. Authentication Flow](#4-authentication-flow)
- [5. Tool System](#5-tool-system)
- [6. Tool Reference](#6-tool-reference)
- [7. Data Flow](#7-data-flow)
- [8. dt-core Integration](#8-dt-core-integration)
- [9. Security Model](#9-security-model)
- [10. Configuration](#10-configuration)
- [11. Migration from Current Implementation](#11-migration-from-current-implementation)

---

## 1. Overview

**Dethereal** is an MCP (Model Context Protocol) server that enables AI assistants to create, validate, import, export, analyze, and manage Dethernety threat models. It is the platform communication layer of the Dethereal Claude Code plugin.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Protocol Compliance** | Full MCP 1.0 implementation via `@modelcontextprotocol/sdk` |
| **dt-core Integration** | All backend communication through `@dethernety/dt-core` classes — no raw GraphQL queries |
| **Split-File Format** | Directory-based model storage with per-element attribute files |
| **Stateless Tools** | Each tool execution is independent with cached authentication |
| **Type Safety** | Full TypeScript with Zod schema validation on all inputs |
| **Output Size Awareness** | MCP tool output limited to ~10,000 tokens; large payloads paginate, summarize, or write to disk |

### Key Characteristics

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DETHEREAL CHARACTERISTICS                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. MCP PROTOCOL COMPLIANCE                                                 │
│     ─────────────────────────                                               │
│     Implements Model Context Protocol for AI assistant integration.         │
│     Uses stdio transport for communication with host applications.          │
│     Tools exposed via ListTools/CallTool handlers.                          │
│                                                                             │
│  2. SPLIT-FILE DIRECTORY FORMAT                                             │
│     ─────────────────────────                                               │
│     Models stored as directory structures with separate JSON files:         │
│     manifest.json, structure.json, dataflows.json, data-items.json,         │
│     and per-element attribute files. Enables version control and            │
│     incremental updates.                                                    │
│                                                                             │
│  3. dt-core DATA ACCESS LAYER                                               │
│     ─────────────────────────                                               │
│     All GraphQL operations routed through dt-core classes:                  │
│     DtImportSplit, DtExportSplit, DtUpdateSplit, DtModule, DtModel,         │
│     DtExposure, DtControl, DtCountermeasure, DtAnalysis,                    │
│     DtMitreAttack, DtMitreDefend.                                          │
│     No raw GraphQL queries in tool implementations.                         │
│                                                                             │
│  4. BROWSER-BASED OAUTH                                                     │
│     ─────────────────────────                                               │
│     Authentication via OIDC OAuth with PKCE. Opens browser for              │
│     login, receives callback on localhost, caches tokens locally.           │
│     Transparent token refresh via refresh token when access token expires.   │
│     Supports auth-disabled mode for demo/development (no login needed).     │
│                                                                             │
│  5. PLUGIN INTEGRATION                                                      │
│     ─────────────────────────                                               │
│     Skills and agents invoke tools via mcp__plugin_dethereal_dethereal__<tool_name>.         │
│     Tool confirmations are handled by Claude Code's built-in MCP            │
│     permission system. Tools are designed for agent consumption              │
│     (structured JSON output, compact summaries).                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              AI ASSISTANT HOST                               │
│                (Claude Code CLI / VS Code / Claude Desktop)                   │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Skills (/dethereal:*)  │  Agents (threat-modeler, etc.)              │  │
│  │  invoke tools as mcp__plugin_dethereal_dethereal__<name>                               │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ stdio (JSON-RPC)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            DETHEREAL MCP SERVER                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         MCP Protocol Layer                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │  │
│  │  │ ListTools    │  │ CallTool     │  │ Error Handling               │  │  │
│  │  │ Handler      │  │ Handler      │  │ (McpError)                   │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                            Tool Registry (20 tools)                    │  │
│  │  ┌─────────────────────┐  ┌─────────────────────────────────────────┐  │  │
│  │  │ Client-Free Tools   │  │ Client-Dependent Tools                  │  │  │
│  │  │ • login             │  │ • import_model    • get_classes         │  │  │
│  │  │ • logout            │  │ • export_model    • update_attributes   │  │  │
│  │  │ • refresh_token     │  │ • update_model    • generate_attribute_ │  │  │
│  │  │ • validate_model    │  │ • create_threat_    stubs               │  │  │
│  │  │ • get_model_schema  │  │   model           • manage_exposures    │  │  │
│  │  │ • get_example_models│  │ • list_models     • manage_controls     │  │  │
│  │  │                     │  │ • search_mitre_   • manage_counter-     │  │  │
│  │  │                     │  │   attack            measures            │  │  │
│  │  │                     │  │ • get_mitre_defend• manage_analyses     │  │  │
│  │  └─────────────────────┘  └─────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────────┐ │
│  │    Authentication       │  │           dt-core Integration              │ │
│  │  ┌───────────────────┐  │  │  ┌──────────────┐  ┌──────────────────┐    │ │
│  │  │ OAuth Flow (PKCE) │  │  │  │ DtImportSplit│  │ DtExportSplit    │    │ │
│  │  │ Token Store       │  │  │  │ DtUpdateSplit│  │ DtModule         │    │ │
│  │  │ Platform Config   │  │  │  │ DtModel      │  │ DtExposure       │    │ │
│  │  └───────────────────┘  │  │  │ DtControl    │  │ DtCountermeasure │    │ │
│  └─────────────────────────┘  │  │ DtMitreAttack│  │ DtMitreDefend    │    │ │
│                               │  │ DtAnalysis   │  │ DtClass          │    │ │
│                               │  └──────────────┘  └──────────────────┘    │ │
│                               └────────────────────────────────────────────┘ │
│                                    │                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        File System Layer                               │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Directory Utils: read/write model directories, apply ID mappings │  │  │
│  │  │ File Utils: path operations, JSON read/write, backups            │  │  │
│  │  │ Sync Utils: sync.json management, content hashing               │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────────┐
│   Identity Provider (OIDC)    │   │         Dethernety Platform           │
│  ┌─────────────────────────┐  │   │  ┌─────────────────────────────────┐  │
│  │ • Cognito / Keycloak /  │  │   │  │ GraphQL API (dt-ws)             │  │
│  │   Auth0 / Zitadel       │  │   │  │ • Models, Components, Boundaries│  │
│  │ • OAuth 2.0 + OIDC      │  │   │  │ • Data Flows, Data Items        │  │
│  │ • Managed Login UI      │  │   │  │ • Modules, Classes, Exposures   │  │
│  │ • JWT Token Issuance    │  │   │  │ • Controls, Countermeasures     │  │
│  └─────────────────────────┘  │   │  │ • MITRE ATT&CK / D3FEND        │  │
└───────────────────────────────┘   │  │ • Analyses                      │  │
                                    │  └─────────────────────────────────┘  │
                                    └───────────────────────────────────────┘
```

---

## 3. Core Components

### Server Entry Point (`src/index.ts`)

The main entry point initializes the MCP server and registers request handlers:

```typescript
const server = new Server(
  { name: 'dethereal', version: '3.0.0' },
  { capabilities: { tools: {} } }
)

// Tool listing handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema)
  }))}
})

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = allTools.find(t => t.name === request.params.name)
  const context = await buildToolContext(request.params.arguments)
  return await tool.execute(request.params.arguments, context)
})

// Stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
```

### Base Tool Classes (`src/tools/base-tool.ts`)

Abstract base classes define the tool interface. All 20 tools extend one of two concrete base classes:

```typescript
export interface ToolContext {
  apolloClient?: ApolloClient<NormalizedCacheObject>
  token?: string
  debug: boolean
}

export interface ToolResult<T = any> {
  success: boolean
  data?: T
  error?: string
  warnings?: string[]
}

export abstract class BaseTool<TInput = any, TOutput = any> {
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly inputSchema: ZodType<TInput>
  abstract readonly requiresClient: boolean

  abstract execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>

  // Validates input via Zod, checks client requirement, then delegates to execute()
  async run(rawInput: unknown, context: ToolContext): Promise<ToolResult<TOutput>> { ... }
}

// Concrete base classes
export abstract class ClientFreeTool extends BaseTool { requiresClient = false }
export abstract class ClientDependentTool extends BaseTool { requiresClient = true }
```

### Tool Categories

| Category | Tools | Base Class | Count |
|----------|-------|------------|-------|
| **Authentication** | `login`, `logout`, `refresh_token` | `ClientFreeTool` | 3 |
| **Reference** | `get_model_schema`, `get_example_models` | `ClientFreeTool` | 2 |
| **Validation** | `validate_model_json` | `ClientFreeTool` | 1 |
| **Model CRUD** | `create_threat_model`, `import_model`, `export_model`, `update_model`, `list_models` | `ClientDependentTool` | 5 |
| **Element Management** | `get_classes`, `update_attributes`, `generate_attribute_stubs` | `ClientDependentTool` | 3 |
| **MITRE Frameworks** | `search_mitre_attack`, `get_mitre_defend` | `ClientDependentTool` | 2 |
| **Security Elements** | `manage_exposures`, `manage_controls`, `manage_countermeasures` | `ClientDependentTool` | 3 |
| **Analysis** | `manage_analyses` | `ClientDependentTool` | 1 |
| **Total** | | | **20** |

### Source Directory Layout

```
oss/apps/dethereal/src/
├── index.ts                        # Server entry point, MCP handlers
├── config.ts                       # Configuration validation, debug mode
├── client/
│   └── apollo-client.ts            # Apollo Client factory (auth/unauth)
├── auth/
│   ├── index.ts                    # Auth module exports
│   ├── oauth-flow.ts               # OAuth orchestration (PKCE + browser)
│   ├── oauth-server.ts             # Localhost callback server (port 9876)
│   ├── pkce.ts                     # PKCE code_verifier/code_challenge generation
│   ├── token-store.ts              # Local token caching (~/.dethernety/tokens.json)
│   ├── platform-config.ts          # Platform /config endpoint fetching + caching
│   └── browser.ts                  # Cross-platform browser opening
├── tools/
│   ├── base-tool.ts                # BaseTool, ClientFreeTool, ClientDependentTool
│   ├── index.ts                    # Tool registry (allTools, clientFreeTools, clientDependentTools)
│   ├── auth/                       # login, logout, refresh_token tools
│   │   ├── login.tool.ts
│   │   ├── logout.tool.ts
│   │   ├── refresh-token.tool.ts
│   │   └── index.ts
│   ├── get-schema.tool.ts          # get_model_schema
│   ├── get-examples.tool.ts        # get_example_models
│   ├── validate-model.tool.ts      # validate_model_json
│   ├── create-model.tool.ts        # create_threat_model
│   ├── import-model.tool.ts        # import_model
│   ├── export-model.tool.ts        # export_model
│   ├── update-model.tool.ts        # update_model
│   ├── update-attributes.tool.ts   # update_attributes
│   ├── get-classes.tool.ts         # get_classes
│   ├── list-models.tool.ts         # list_models (NEW)
│   ├── search-mitre-attack.tool.ts # search_mitre_attack (NEW)
│   ├── get-mitre-defend.tool.ts    # get_mitre_defend (NEW)
│   ├── manage-exposures.tool.ts    # manage_exposures (NEW)
│   ├── manage-controls.tool.ts     # manage_controls (NEW)
│   ├── manage-countermeasures.tool.ts # manage_countermeasures (NEW)
│   └── manage-analyses.tool.ts     # manage_analyses (NEW)
├── utils/
│   ├── directory-utils.ts          # Read/write model directories
│   ├── file-utils.ts               # Path operations, JSON I/O, backups
│   └── sync-utils.ts               # sync.json management, content hashing (NEW)
└── __tests__/
```

---

## 4. Authentication Flow

### OAuth 2.0 with PKCE

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ AI Assistant│     │  Dethereal  │     │   Browser   │     │OIDC Provider│
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ login tool call   │                   │                   │
       │──────────────────>│                   │                   │
       │                   │                   │                   │
       │                   │ Generate PKCE     │                   │
       │                   │ code_verifier +   │                   │
       │                   │ code_challenge    │                   │
       │                   │                   │                   │
       │                   │ Start callback    │                   │
       │                   │ server on :9876   │                   │
       │                   │                   │                   │
       │                   │ Open auth URL     │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │                   │ GET /authorize    │
       │                   │                   │──────────────────>│
       │                   │                   │                   │
       │                   │                   │<──────────────────│
       │                   │                   │ Login page        │
       │                   │                   │                   │
       │                   │                   │ User authenticates│
       │                   │                   │──────────────────>│
       │                   │                   │                   │
       │                   │                   │<──────────────────│
       │                   │                   │ Redirect with code│
       │                   │                   │                   │
       │                   │<──────────────────│                   │
       │                   │ GET /callback     │                   │
       │                   │ ?code=xxx         │                   │
       │                   │                   │                   │
       │                   │ Exchange code     │                   │
       │                   │ + code_verifier   │                   │
       │                   │─────────────────────────────────────>│
       │                   │                   │                   │
       │                   │<─────────────────────────────────────│
       │                   │ Tokens (access,   │                   │
       │                   │ id, refresh)      │                   │
       │                   │                   │                   │
       │                   │ Store tokens at   │                   │
       │                   │ ~/.dethernety/    │                   │
       │                   │ tokens.json       │                   │
       │                   │                   │                   │
       │<──────────────────│                   │                   │
       │ Return tokens     │                   │                   │
       │                   │                   │                   │
```

### Auth-Disabled Mode

When the platform's `/config` endpoint returns `authDisabled: true` (demo/development mode), the MCP server bypasses all OAuth flows:

```
┌─────────────┐     ┌─────────────┐                    ┌─────────────┐
│ AI Assistant│     │  Dethereal  │                    │  Platform   │
└──────┬──────┘     └──────┬──────┘                    └──────┬──────┘
       │                   │                                  │
       │                   │ GET /config                      │
       │                   │─────────────────────────────────>│
       │                   │<─────────────────────────────────│
       │                   │ { authDisabled: true, ... }      │
       │                   │                                  │
       │ any tool call     │                                  │
       │──────────────────>│                                  │
       │                   │                                  │
       │                   │ GraphQL (no Authorization header)│
       │                   │─────────────────────────────────>│
       │                   │   Backend creates mock dev-user  │
       │                   │<─────────────────────────────────│
       │                   │                                  │
       │<──────────────────│                                  │
       │ Tool result       │                                  │
```

In this mode:

| Component | Behavior |
|-----------|----------|
| **Platform config** | Skips `oidcClientId` / `oidcDomain` validation |
| **Apollo client** | Created without `Authorization` header |
| **buildToolContext()** | Skips token resolution, creates unauthenticated client |
| **Client-dependent tools** | Work without authentication (backend creates mock user) |
| **Auth tools** (login, logout, refresh) | Return immediately with "auth not needed" message |

### Token Management

```typescript
// Token storage structure (~/.dethernety/tokens.json)
// Keyed by platform URL to prevent cross-instance token confusion (D61)
interface TokenStore {
  [platformUrl: string]: StoredTokens
}

interface StoredTokens {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number  // Unix timestamp (milliseconds)
  tokenType: string
}

// Token resolution for authenticated requests:
// 1. Load stored tokens from ~/.dethernety/tokens.json for the current baseUrl
// 2. Check exp claim — discard if expired
// 3. If expired but refreshToken is valid, attempt transparent refresh
// 4. No token needed when authDisabled is true
```

The `getIdToken()` function implements this chain:
1. Load stored tokens from `~/.dethernety/tokens.json` keyed by the current `baseUrl` and check expiry
2. If expired but `refreshToken` exists and is not expired, transparently refresh by calling the OIDC token endpoint with `grant_type=refresh_token` — store new tokens and use the new access token
3. Return `undefined` if no valid token is available (no token, no refresh token, or refresh also expired)

> **Security (D61):** The `_token` argument is **not supported**. Tokens must only come from the secure token store, never from the conversation layer. Accepting tokens from tool arguments would allow prompt injection attacks to supply attacker-controlled JWTs.

### Auth Component Files

| File | Purpose |
|------|---------|
| `auth/oauth-flow.ts` | Main authentication orchestration |
| `auth/oauth-server.ts` | Localhost callback server (port 9876) |
| `auth/pkce.ts` | PKCE code_verifier/code_challenge generation and verification |
| `auth/token-store.ts` | Local token caching and retrieval (`~/.dethernety/tokens.json`) |
| `auth/platform-config.ts` | Fetches and caches OIDC provider config from platform `/config` endpoint |
| `auth/browser.ts` | Cross-platform browser opening (macOS `open`, Linux `xdg-open`, Windows `start`) |

---

## 5. Tool System

### Tool Execution Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           TOOL EXECUTION FLOW                               │
└────────────────────────────────────────────────────────────────────────────┘

1. MCP CallTool Request (JSON-RPC via stdio)
   │
   ▼
2. Find tool by name in allTools registry
   ├─ Not found: throw McpError(MethodNotFound)
   │
   ▼
3. Build ToolContext via buildToolContext(args)
   ├─ If authDisabled (cached from platform /config):
   │  └─ Create unauthenticated Apollo client (no Authorization header)
   ├─ Else:
   │  ├─ Load token from store (keyed by baseUrl)
   │  ├─ Decode JWT, check exp claim — if expired, attempt transparent refresh
   │  ├─ Fetch platform config if not cached
   │  └─ Create Apollo client with Bearer token (if token available)
   │
   ▼
4. Check client requirement
   ├─ If requiresClient && !apolloClient
   │  └─ Return structured error: { error: "Authentication required",
   │     message: "...", hint: "Use the login tool to authenticate" }
   └─ Continue if satisfied (always satisfied when authDisabled)
   │
   ▼
5. Validate input with Zod schema (tool.run -> safeParse)
   ├─ Validation failure: return { success: false, error: "Invalid input: ..." }
   │
   ▼
6. Execute tool.execute(input, context)
   │
   ▼
7. Format MCP response
   ├─ Success: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
   └─ Error: { content: [{ type: 'text', text: JSON.stringify({ error, data }) }], isError: true }
```

### Tool Implementation Pattern

All tools follow the same pattern. Client-dependent tools extend `ClientDependentTool` and use dt-core classes for platform operations:

```typescript
export class ImportModelTool extends ClientDependentTool<ImportInput, ImportOutput> {
  readonly name = 'import_model'
  readonly description = '...'
  readonly inputSchema = z.object({
    directory_path: z.string(),
    folder_id: z.string().optional(),
    create_backup: z.boolean().optional()
  })

  async execute(input: ImportInput, context: ToolContext): Promise<ToolResult<ImportOutput>> {
    // 1. Validate prerequisites
    if (!context.apolloClient) {
      return { success: false, error: 'Apollo client not available' }
    }

    // 2. Read from file system
    const splitModel = await readModelDirectory(input.directory_path)

    // 3. Use dt-core for API operations
    const dtImportSplit = new DtImportSplit(context.apolloClient)
    const result = await dtImportSplit.importSplitModel(splitModel)

    // 4. Post-process (write IDs back to files)
    await applyIdMapping(input.directory_path, result.idMapping)

    // 5. Return structured result
    return { success: true, data: { model_id: result.model.id, ... } }
  }
}
```

New tools (MITRE, security elements, analysis) follow the **action-based pattern** — a single tool handles multiple operations via an `action` discriminator:

```typescript
export class ManageExposuresTool extends ClientDependentTool<ExposureInput, ExposureOutput> {
  readonly name = 'manage_exposures'
  readonly description = '...'
  readonly inputSchema = z.object({
    action: z.enum(['list', 'get']),
    element_id: z.string().optional(),
    exposure_id: z.string().optional()
  })

  async execute(input: ExposureInput, context: ToolContext): Promise<ToolResult<ExposureOutput>> {
    const dtExposure = new DtExposure(context.apolloClient!)

    switch (input.action) {
      case 'list':
        const exposures = await dtExposure.getExposuresByElement({ elementId: input.element_id! })
        return { success: true, data: { exposures } }
      case 'get':
        const exposure = await dtExposure.getExposure({ exposureId: input.exposure_id! })
        return { success: true, data: { exposure } }
    }
  }
}
```

### Error Propagation

MCP tool errors propagate to the agent via `ToolResult`. Agent prompts include handling instructions:

| Error Type | Agent Behavior |
|------------|---------------|
| **Auth errors** ("Authentication required") | Agent suggests `/dethereal:login` and retries |
| **Validation errors** (Zod parse failure) | Agent presents errors to user with suggested fixes |
| **Network errors** (platform unreachable) | Agent retries once after 5 seconds, then reports to user |
| **Platform errors** (GraphQL 500) | Agent reports to user without retry |
| **Not found** (model/element ID invalid) | Agent reports to user, suggests corrective action |

---

## 6. Tool Reference

### Authentication Tools (Client-Free)

#### `login`

Browser-based OAuth PKCE authentication.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{}` (no parameters) |
| **Output** | `{ authenticated: true, expires_in: number }` |
| **dt-core class** | None (uses auth module directly) |

Starts the OAuth flow: generates PKCE codes, opens browser to OIDC provider's login page, starts localhost callback server on port 9876, exchanges authorization code for tokens, stores tokens at `~/.dethernety/tokens.json`. Returns immediately with "auth not needed" when `authDisabled` is true.

#### `logout`

Clear cached tokens.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{}` |
| **Output** | `{ logged_out: true }` |
| **dt-core class** | None |

Deletes stored tokens from `~/.dethernety/tokens.json`.

#### `refresh_token`

Refresh expired access token using stored refresh token.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{}` |
| **Output** | `{ refreshed: true, expires_in: number }` |
| **dt-core class** | None |

Uses the stored `refreshToken` to obtain new access and ID tokens from the OIDC provider.

### Reference Tools (Client-Free)

#### `get_model_schema`

Returns the SplitModel JSON schema and modeling guidelines.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{}` |
| **Output** | Schema JSON + guidelines text |
| **dt-core class** | None (reads from bundled data) |

> **Output size note:** The full schema exceeds 10,000 tokens. The tool should return a summary with file paths to the full schema on disk, or the agent should embed guidelines in its prompt (Skill Design Principle 7).

#### `get_example_models`

Returns example model templates for reference.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{}` |
| **Output** | Example model JSON structures |
| **dt-core class** | None (reads from bundled data) |

### Validation Tool (Client-Free)

#### `validate_model_json`

Offline structural validation and quality score computation.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ action: 'validate' \| 'quality', directory_path: string }` |
| **Output** | Validation errors (for `validate`) or quality score breakdown (for `quality`) |
| **dt-core class** | None (local file validation) |

- `validate`: Structural checks — required fields, ID uniqueness, reference integrity, schema compliance
- `quality`: Quality score computation using the formula from THREAT_MODELING_WORKFLOW.md (component classification rate, attribute completion, boundary hierarchy quality, data flow coverage, data classification, control coverage, credential coverage)

### Model CRUD Tools (Client-Dependent)

#### `create_threat_model`

Create a new model on the platform from a local directory.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ directory_path: string, folder_id?: string }` |
| **Output** | `{ model_id: string, name: string, element_count: number }` |
| **dt-core class** | `DtImportSplit` |

Creates a new model on the platform. Writes server-generated IDs back to local files via ID mapping. Updates `sync.json` with platform model ID and push hash.

#### `import_model`

Import a local model directory to the platform (alias for create with backup support).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ directory_path: string, folder_id?: string, create_backup?: boolean }` |
| **Output** | `{ model_id: string, id_mapping: Record<string, string>, warnings: string[] }` |
| **dt-core class** | `DtImportSplit` |

When `create_backup` is true, creates a timestamped backup of the directory before modifying files with server IDs.

#### `export_model`

Export a platform model to a local directory.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model_id: string, directory_path: string }` |
| **Output** | `{ directory_path: string, element_count: number, warnings: string[] }` |
| **dt-core class** | `DtExportSplit` |

Exports the full model including structure, data flows, data items, attributes, and controls. Writes `sync.json` with pull metadata (content hash, baseline element IDs, referenced models).

#### `update_model`

Update an existing platform model from local files.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model_id: string, directory_path: string, delete_orphaned?: boolean, create_backup?: boolean, disable_source_file_update?: boolean }` |
| **Output** | `{ updated: true, changes: { added: number, modified: number, removed: number } }` |
| **dt-core class** | `DtUpdateSplit` |

Applies structural changes (add/remove/modify elements) and attribute updates. The caller (e.g. the `/dethereal:sync` push path) resolves `model_id` from `manifest.model.id`. Optional flags:
- `delete_orphaned` (default `true`) — delete platform elements absent from the local files; this is the mechanism the sync C1/C2 conflict gate relies on.
- `create_backup` (default `true`) — snapshot the directory before applying changes.
- `disable_source_file_update` (default `false`) — skip the post-update re-export back to the source directory.

#### `list_models` (NEW)

List threat models on the platform.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ folder_id?: string, name?: string }` |
| **Output** | `{ models: Array<{ id, name, description, folder_id }> }` |
| **dt-core class** | `DtModel` |

Wraps `DtModel.getModels()`. The `name` filter is applied client-side after fetching (the backend API only supports `folderId` filtering). Used during workflow Step 4 for `representedModel` linking via `getNotRepreseningModels(modelId)`.

### Element Management Tools (Client-Dependent)

#### `get_classes`

Query available classes from installed modules.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action?: 'classify_components' \| 'list', type?: string }` |
| **Output** | Class definitions with JSON Schema templates |
| **dt-core class** | `DtModule` |

- `list` (default): Returns all classes of the specified type (e.g., `DTComponentClass`, `DTControlClass`, `DTDataFlowClass`)
- `classify_components`: Returns component classes with descriptions optimized for classification matching

#### `update_attributes`

Update element attributes only (no structural changes).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ directory_path: string, element_ids?: string[] }` |
| **Output** | `{ updated_count: number, warnings: string[] }` |
| **dt-core class** | `DtUpdateSplit` (attribute-only mode) |

Reads attribute files from the directory and calls `setInstantiationAttributes()` for each element. If `element_ids` is provided, only updates those elements.

### MITRE Framework Tools (Client-Dependent, NEW)

#### `search_mitre_attack`

Search and browse ATT&CK techniques, tactics, and mitigations (D26).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'search' \| 'tactics' \| 'techniques_by_tactic' \| 'technique' \| 'mitigations' \| 'mitigation', search?: string, tactic_id?: string, attack_id?: string }` |
| **dt-core class** | `DtMitreAttack` |

| Action | dt-core Method | Required Params | Notes |
|--------|---------------|-----------------|-------|
| `search` | `findMitreAttackTechniques` | `search` | Free-text translated to GraphQL name filter. Results capped at 20. Client-side filtering. |
| `tactics` | `getMitreAttackTactics` | -- | Returns all 14 tactics. |
| `techniques_by_tactic` | `getMitreAttackTechniquesByTactic` | `tactic_id` (e.g., "TA0001") | |
| `technique` | `getMitreAttackTechnique` | `attack_id` (e.g., "T1190") | Anti-hallucination guardrail: validates technique exists before annotating. |
| `mitigations` | `getMitreAttackMitigations` | -- | Returns all mitigations. |
| `mitigation` | `getMitreAttackMitigation` | `attack_id` (e.g., "M1036") | |

> The plugin provides `search_mitre_attack` for user-initiated reference browsing. Systematic technique-to-component mapping (STRIDE-to-ATT&CK evaluation) is performed by platform analysis modules, not the plugin.

#### `get_mitre_defend`

Browse D3FEND defensive techniques (D24).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'tactics' \| 'techniques_by_tactic' \| 'technique', tactic_id?: string, d3fend_id?: string }` |
| **dt-core class** | `DtMitreDefend` |

Renamed from `search_mitre_defend` because the underlying `DtMitreDefend` class has no text search capability -- only tactic listing, technique-by-tactic browsing, and technique lookup by ID. Semantic D3FEND search is a platform analysis module capability (backed by PostgreSQL pgvector).

**Fast-follow:** Add `findMitreDefendTechniques` to dt-core (matching the ATT&CK pattern) to enable name-based filtering.

### Security Element Tools (Client-Dependent, NEW)

#### `manage_exposures`

Read-only access to platform-computed exposures (D25).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list' \| 'get', element_id?: string, exposure_id?: string }` |
| **dt-core class** | `DtExposure` |

**Create/update/delete are NOT supported.** Exposures are computed by OPA/Rego policy evaluation on the platform. Plugin-created exposures would pollute the analysis engine's evidence chain (`Component → HAS_EXPOSURE → Exposure → EXPLOITED_BY → Technique`) with unverified claims.

After model import, the plugin reads back computed exposures: *"12 exposures found on your model. Run analysis for full findings and remediation roadmaps."*

#### `manage_controls`

CRUD for security controls.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list' \| 'get' \| 'create' \| 'update' \| 'delete', control_id?: string, control?: ControlInput, class_ids?: string[] }` |
| **dt-core class** | `DtControl` |

`class_ids` behavior: for `list`, filters controls by class IDs; for `create`/`update`, assigns `DTControlClass` class IDs to the control instance. Use `get_classes(type: 'DTControlClass')` to retrieve available control class definitions.

#### `manage_countermeasures`

Link controls to exposures via countermeasures.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | See below |
| **dt-core class** | `DtCountermeasure` |

```typescript
z.object({
  action: z.enum(['list', 'get', 'create', 'update', 'delete']),
  element_id: z.string().optional(),           // required for 'list'
  countermeasure_id: z.string().optional(),     // required for 'get', 'update', 'delete'
  countermeasure: z.object({                    // required for 'create', optional for 'update'
    name: z.string(),
    type: z.string(),                           // "preventive" | "detective" | "corrective"
    category: z.string(),                       // e.g., "access-control", "encryption", "monitoring"
    description: z.string().optional(),
    score: z.number().optional(),               // effectiveness 0-100, defaults to 50
    exposure_ids: z.array(z.string()).optional(),// links to addressed exposures
    defend_technique_ids: z.array(z.string()).optional(),
    mitigations: z.array(z.string()).optional(), // ATT&CK mitigation references
    references: z.array(z.string()).optional()
  }).optional()
})
```

> **Temporal dependency (R6/F3):** Countermeasures created before model import will not have `exposure_ids` (no exposures exist yet). The guided workflow handles this in Step 11: after sync, read back platform-computed exposures via `manage_exposures(action: 'list')` and present a batch linking table.

### Analysis Tool (Client-Dependent, NEW)

#### `manage_analyses`

List analysis classes, create/run analyses, get results.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list_classes' \| 'list' \| 'create' \| 'run' \| 'status' \| 'results' \| 'delete', model_id?: string, analysis_id?: string }` |
| **dt-core class** | `DtAnalysis` |

**Polling contract** (streaming/subscription-based delivery cannot work through stateless MCP tools):

| Action | Returns | Next Step |
|--------|---------|-----------|
| `list_classes` | Available analysis module classes | Select class for `create` |
| `create` | `{ analysis_id }` | Call `run` |
| `run` | `{ session_id, status: 'started' }` | Poll `status` |
| `status` | `{ status: 'running' \| 'completed' \| 'failed', progress?: { completed_tasks, total_tasks, current_phase } }` | When `completed`, call `results` |
| `results` | Analysis results when complete, otherwise `{ status: 'running', retry_after_seconds: 5 }` | Display to user |

---

## 7. Data Flow

### Split-File Model Format

```
model-directory/
├── manifest.json       # Schema version, model metadata, module refs
├── structure.json      # Boundary/component hierarchy (no attributes)
├── dataflows.json      # Array of data flow connections
├── data-items.json     # Array of data classification items
├── controls.json       # Security controls on elements
└── attributes/         # Per-element attribute files
    ├── boundaries/
    │   └── {elementId}.json
    ├── components/
    │   └── {elementId}.json
    ├── dataFlows/
    │   └── {elementId}.json
    └── dataItems/
        └── {elementId}.json
```

### Import Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              IMPORT FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

Directory Files                      dt-core                      Platform
─────────────                      ─────────                      ────────

manifest.json ─────┐
structure.json ────┼──> SplitModel ──> DtImportSplit ──────────> GraphQL API
dataflows.json ────┤        │              │
data-items.json ───┤        │              │
controls.json ─────┤        │              ▼
attributes/* ──────┘        │         ImportResult
                            │         { model, idMapping,
                            │           warnings, errors }
                            │              │
                            ▼              ▼
                    Apply idMapping   Write server IDs
                    to source files   back to directory
                            │
                            ▼
                    Update sync.json
                    (platform_model_id,
                     push_content_hash,
                     baseline_element_ids)
```

### Export Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXPORT FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

Platform                      dt-core                      Directory Files
────────                      ─────────                    ─────────────

GraphQL API ──> DtExportSplit ──> SplitModel ──> manifest.json
                     │                │           structure.json
                     │                │           dataflows.json
                     │                │           data-items.json
                     │                │           controls.json
                     │                │           attributes/*
                     │                │
                     │                ▼
                     │           Write sync.json
                     │           (platform_model_id,
                     │            pull_content_hash,
                     │            baseline_element_ids,
                     │            referenced_models)
                     │
                     ▼
                representedModel
                references tracked
                in sync.json
```

### Update Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UPDATE FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

1. Read local SplitModel from directory
2. Read model_id from manifest.json or sync.json
3. DtUpdateSplit computes diff against platform model
4. Apply structural changes (add/remove/modify elements)
5. Apply attribute changes via setInstantiationAttributes()
6. Write updated IDs back to local files
7. Update sync.json (push_content_hash)
```

### ID Mapping System

When importing, reference IDs in source files are mapped to server-generated UUIDs:

```typescript
// Before import (structure.json)
{
  "defaultBoundary": {
    "id": "temp-boundary-1",  // Reference ID (local)
    "components": [{
      "id": "temp-component-1",
      "name": "Web Server"
    }]
  }
}

// After import - idMapping applied:
{
  "defaultBoundary": {
    "id": "550e8400-e29b-41d4-a716-446655440000",  // Server-generated UUID
    "components": [{
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Web Server"
    }]
  }
}
```

ID mapping is applied to all files in the directory (manifest, structure, dataflows, data-items, controls, attribute files). Cross-references within the model (e.g., data flow source/target component IDs) are updated consistently.

### Sync Metadata (`sync.json`)

Written to `<model-directory>/.dethereal/sync.json` after each push/pull operation:

```json
{
  "platform_model_id": "abc-123-def-456",
  "platform_url": "https://demo.dethernety.io",
  "last_pull_at": "2026-03-26T10:00:00Z",
  "last_push_at": "2026-03-26T11:30:00Z",
  "pull_content_hash": "sha256:...",
  "push_content_hash": "sha256:...",
  "baseline_element_ids": {
    "boundaries": ["b-001", "b-002"],
    "components": ["c-001", "c-002", "c-003"],
    "flows": ["f-001", "f-002"],
    "dataItems": ["d-001"]
  },
  "referenced_models": [
    { "id": "xyz-789", "name": "API Service", "localPath": null }
  ]
}
```

See SYNC_AND_SOURCE_OF_TRUTH.md for the full sync architecture (dual-authority model, conflict taxonomy, push flow, dirtiness tracking).

---

## 8. dt-core Integration

### Classes Used by Tool

| dt-core Class | Tools | Purpose |
|---------------|-------|---------|
| `DtImportSplit` | `import_model`, `create_threat_model` | Import SplitModel directory to platform |
| `DtExportSplit` | `export_model` | Export platform model to SplitModel directory |
| `DtUpdateSplit` | `update_model`, `update_attributes` | Update existing model from SplitModel |
| `DtModule` | `get_classes` | Query modules and class definitions |
| `DtModel` | `list_models` | List and query models on the platform |
| `DtClass` | `update_attributes` | `setInstantiationAttributes()` for attribute updates |
| `DtExposure` | `manage_exposures` | Read platform-computed exposures |
| `DtControl` | `manage_controls` | CRUD for security controls |
| `DtCountermeasure` | `manage_countermeasures` | Link controls to exposures |
| `DtMitreAttack` | `search_mitre_attack` | ATT&CK technique search and browsing |
| `DtMitreDefend` | `get_mitre_defend` | D3FEND technique browsing |
| `DtAnalysis` | `manage_analyses` | Analysis lifecycle (create, run, poll, results) |

### Apollo Client Configuration

```typescript
// Created with optional authenticated token
// When authDisabled, idToken is omitted and no Authorization header is sent
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (idToken) {
  headers.Authorization = `Bearer ${idToken}`
}

const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: `${platformUrl}${graphqlPath}`,
    headers
  }),
  cache: new InMemoryCache()
})
```

The Apollo client is created per-request in `buildToolContext()`. The cache is not shared across tool calls (stateless tools).

### Platform Configuration

Fetched from `{DETHERNETY_URL}/config` (the backend's runtime config endpoint):

```typescript
interface PlatformConfig {
  authDisabled?: boolean      // True when auth is disabled (demo/development mode)
  oidcIssuer: string          // OIDC provider issuer URL
  oidcClientId: string        // OIDC client identifier
  oidcDomain: string          // Cognito hosted UI domain (Cognito only)
  oidcRedirectUri: string     // Default redirect URI (dethereal uses localhost instead)
  oidcProvider: string        // Provider type: cognito, keycloak, auth0, zitadel, generic
  graphqlUrl: string          // GraphQL API path (e.g., "/graphql")
  graphqlWsUrl: string        // WebSocket URL for subscriptions
  subscriptionTransport: string // "sse" or "ws"
  appUrl: string              // Application base URL
  appBaseUrl: string          // Application base path
  apiBaseUrl: string          // API base URL (usually empty, relative)
}
```

When `authDisabled` is `true`, the OIDC fields (`oidcClientId`, `oidcDomain`) are not validated and may be empty.

---

## 9. Security Model

### Authentication Security

| Mechanism | Implementation |
|-----------|----------------|
| **OAuth 2.0 + OIDC** | Any OIDC-compliant provider (Cognito, Keycloak, Auth0, Zitadel, generic) |
| **PKCE** | Protects against authorization code interception |
| **OAuth `state` parameter** | Generated alongside PKCE codes, validated on callback receipt. Callbacks with missing or mismatched `state` are rejected (D61) |
| **Local Token Storage** | `~/.dethernety/tokens.json` keyed by platform URL, with `0600` filesystem permissions (D61) |
| **Token Expiration** | Access tokens expire per OIDC provider config (typically hours), refresh tokens per provider (typically 30 days) |
| **Token Resolution** | Stored token (keyed by `baseUrl`) → transparent refresh if expired → auth-disabled fallback. No argument-level tokens (D61) |
| **Transparent Token Refresh** | When access token is expired but refresh token is valid, `buildToolContext()` refreshes automatically before creating the Apollo client |
| **JWT Expiry Check** | Token `exp` claim decoded and checked before use |
| **Auth-Disabled Mode** | For demo/development only; backend creates mock user for unauthenticated requests |

### API Security

| Mechanism | Implementation |
|-----------|----------------|
| **JWT Validation** | All GraphQL requests include Bearer token (validated by backend) |
| **HTTPS Enforcement** | When `DETHERNETY_URL` is not `localhost`/`127.0.0.1`, the server rejects HTTP (non-TLS) URLs at startup (D61) |
| **No Raw Queries** | All operations via dt-core classes (validated, parameterized queries) |
| **Input Validation** | Zod schema validation on all tool inputs before execution |

### File System Security

| Mechanism | Implementation |
|-----------|----------------|
| **Backup Before Modify** | Timestamped backups on import/update (when `create_backup: true`) |
| **Path Containment** | `directory_path` must resolve to a subdirectory of the current working directory or a path registered in `.dethernety/models.json`. Paths must not contain `..` after `path.resolve()`. Symlink targets are validated to ensure they resolve within allowed boundaries. Enforced via a shared `validatePath()` utility called before any file I/O (D61) |
| **No Arbitrary Execution** | Tools only read/write model files and sync metadata |
| **Token File Permissions** | `~/.dethernety/tokens.json` created with `0600` permissions; server warns if permissions are too broad |

### OAuth Callback Security

| Mechanism | Implementation |
|-----------|----------------|
| **PKCE code exchange** | `code_verifier`/`code_challenge` prevents code interception from being useful |
| **`state` parameter** | Generated alongside PKCE codes. Validated on callback receipt — callbacks with missing or mismatched `state` are rejected to prevent CSRF-based code injection (D61) |
| **Callback server lifetime** | Auto-closes after receiving callback or after 2-minute timeout |
| **Fixed port** | Port 9876 required by OIDC providers that restrict redirect URIs |
| **Path restriction** | Server only listens for the expected redirect path |

### Exposure Management Security

Exposures are **read-only** in the MCP server. Create/update/delete operations are restricted to platform analysis modules. This prevents unverified claims from polluting the analysis evidence chain.

---

## 10. Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DETHERNETY_URL` | Yes | `http://localhost:3003` | Platform base URL |
| `DEBUG` | No | `false` | Enable debug logging to stderr |

### MCP Server Registration

**Claude Code** (`.mcp.json` in plugin root, configured by plugin install):

```json
{
  "mcpServers": {
    "dethereal": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "DETHERNETY_URL": "${DETHERNETY_URL}"
      }
    }
  }
}
```

`DETHERNETY_URL` is inherited from the user's shell environment. The MCP server falls back to `http://localhost:3003` internally if unset.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dethereal": {
      "command": "node",
      "args": ["/path/to/dethereal/dist/index.js"],
      "env": {
        "DETHERNETY_URL": "https://demo.dethernety.io",
        "DEBUG": "true"
      }
    }
  }
}
```

**VS Code** (via MCP extension settings):

```json
{
  "mcp.servers": {
    "dethereal": {
      "command": "npx",
      "args": ["@dethernety/dethereal"],
      "env": {
        "DETHERNETY_URL": "https://demo.dethernety.io"
      }
    }
  }
}
```

---

## 11. Migration from Current Implementation

### What Changes

| Component | Current (12 tools) | Target (20 tools) | Change Type |
|-----------|-------------------|-------------------|-------------|
| **Server entry** | `index.ts` — same pattern | `index.ts` — same pattern, updated `allTools` | Minor |
| **Base classes** | `BaseTool`, `ClientFreeTool`, `ClientDependentTool` | Same — no changes | None |
| **Auth module** | Full OAuth PKCE + token store | Same — no changes | None |
| **Apollo client** | Same pattern | Same — no changes | None |
| **Tool registry** | 12 tools in `tools/index.ts` | 20 tools — add 8 new tool files + update registry | Addition |
| **File utils** | `directory-utils.ts`, `file-utils.ts` | Same + new `sync-utils.ts` for sync.json management | Addition |
| **Version** | `2.0.0` | `3.0.0` | Bump |

### New Tool Files to Create

| File | Tool | dt-core Class | Complexity |
|------|------|---------------|------------|
| `list-models.tool.ts` | `list_models` | `DtModel` | Low — single query, client-side name filter |
| `search-mitre-attack.tool.ts` | `search_mitre_attack` | `DtMitreAttack` | Medium — 6 actions, client-side search filtering |
| `get-mitre-defend.tool.ts` | `get_mitre_defend` | `DtMitreDefend` | Low — 3 actions, direct dt-core method calls |
| `manage-exposures.tool.ts` | `manage_exposures` | `DtExposure` | Low — 2 read-only actions |
| `manage-controls.tool.ts` | `manage_controls` | `DtControl` | Medium — 5 CRUD actions with class assignment |
| `manage-countermeasures.tool.ts` | `manage_countermeasures` | `DtCountermeasure` | Medium — 5 CRUD actions with exposure linking |
| `manage-analyses.tool.ts` | `manage_analyses` | `DtAnalysis` | High — 7 actions including polling contract |

### New Utility Files

| File | Purpose |
|------|---------|
| `utils/sync-utils.ts` | Read/write `sync.json`, compute content hashes, manage `baseline_element_ids` |

### Migration Steps

1. **Add new dt-core dependencies** — ensure `DtExposure`, `DtControl`, `DtCountermeasure`, `DtMitreAttack`, `DtMitreDefend`, `DtAnalysis`, `DtModel` are exported from `@dethernety/dt-core`
2. **Create 7 new tool files** following the existing tool implementation pattern
3. **Create `sync-utils.ts`** for sync.json management
4. **Update `tools/index.ts`** — add new tools to `allTools` and `clientDependentTools` arrays
5. **Update `validate-model.tool.ts`** — add `quality` action for quality score computation
6. **Bump server version** to `3.0.0` in `index.ts`
7. **Update tests** — add unit tests for each new tool
8. **No changes needed** to auth module, base classes, Apollo client, or MCP protocol layer

### Existing Tools: Modifications

| Tool | Modification |
|------|-------------|
| `validate_model_json` | Add `quality` action for quality score computation (currently only does structural validation) |
| `export_model` | Write `sync.json` after export (pull metadata, content hash, baseline element IDs) |
| `import_model` / `create_threat_model` | Write `sync.json` after import (push metadata, content hash, baseline element IDs) |
| `update_model` | Write `sync.json` after update (push metadata, content hash, baseline element IDs) |

---

## Related Documentation

- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Full plugin specification (skills, agents, hooks, settings)
- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — End-to-end workflow that orchestrates these tools
- [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) — Sync architecture (dual-authority model, conflict taxonomy, push flow)
- [ARCHITECTURE.md](ARCHITECTURE.md) — Current MCP server implementation (to be replaced by this document)
- [User Guide](../../user/dethereal/README.md) — End-user documentation
- [dt-core](../dt-core/) — Data access layer architecture
- [Backend Architecture](../backend/BACKEND_ARCHITECTURE.md) — GraphQL API
