# Dethereal MCP Server Architecture

> Architecture of the Dethernety MCP Server

## Table of Contents
- [Overview](#overview)
- [Architecture Diagram](#architecture-diagram)
- [Core Components](#core-components)
- [Authentication Flow](#authentication-flow)
- [Tool System](#tool-system)
- [Data Flow](#data-flow)
- [Integration Points](#integration-points)
- [Security Model](#security-model)
- [Configuration](#configuration)

---

## Overview

**Dethereal** is an MCP (Model Context Protocol) server that lets AI assistants create, validate, import, export, and manage Dethernety threat models.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Protocol Compliance** | Full MCP 1.0 implementation via `@modelcontextprotocol/sdk` |
| **dt-core Integration** | All backend communication through `@dethernety/dt-core` classes |
| **Split-File Format** | Directory-based model storage with per-element attribute files |
| **Stateless Tools** | Each tool execution is independent with cached authentication |
| **Type Safety** | Full TypeScript with Zod schema validation |

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
│     DtImportSplit, DtExportSplit, DtUpdateSplit, DtModule.                  │
│     No raw GraphQL queries in tool implementations.                         │
│                                                                             │
│  4. BROWSER-BASED OAUTH                                                     │
│     ─────────────────────────                                               │
│     Authentication via OIDC OAuth with PKCE. Opens browser for              │
│     login, receives callback on localhost, caches tokens locally.           │
│     Automatic token refresh when possible.                                  │
│     Supports auth-disabled mode for demo/development (no login needed).     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              AI ASSISTANT HOST                               │
│                        (Claude Desktop, VS Code, etc.)                       │
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
│  │                            Tool Registry                               │  │
│  │  ┌─────────────────────┐  ┌─────────────────────────────────────────┐  │  │
│  │  │ Client-Free Tools   │  │ Client-Dependent Tools                  │  │  │
│  │  │ • login             │  │ • import_model    • get_classes         │  │  │
│  │  │ • logout            │  │ • export_model    • update_attributes   │  │  │
│  │  │ • refresh_token     │  │ • update_model    • create_threat_model │  │  │
│  │  │ • validate_model    │  │                                         │  │  │
│  │  │ • get_model_schema  │  │                                         │  │  │
│  │  │ • get_example_models│  │                                         │  │  │
│  │  └─────────────────────┘  └─────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────────┐ │
│  │    Authentication       │  │           dt-core Integration              │ │
│  │  ┌───────────────────┐  │  │  ┌──────────────┐  ┌──────────────────┐    │ │
│  │  │ OAuth Flow (PKCE) │  │  │  │ DtImportSplit│  │ DtExportSplit    │    │ │
│  │  │ Token Store       │  │  │  │ DtUpdateSplit│  │ DtModule         │    │ │
│  │  │ Platform Config   │  │  │  └──────────────┘  └──────────────────┘    │ │
│  │  └───────────────────┘  │  │                                            │ │
│  └─────────────────────────┘  └────────────────────────────────────────────┘ │
│                                    │                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        File System Layer                               │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Directory Utils: read/write model directories, apply ID mappings │  │  │
│  │  │ File Utils: path operations, JSON read/write, backups            │  │  │
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
│  │ • Managed Login UI      │  │   │  │ • Modules, Classes              │  │
│  │ • JWT Token Issuance    │  │   │  │                                 │  │
│  └─────────────────────────┘  │   │  └─────────────────────────────────┘  │
└───────────────────────────────┘   └───────────────────────────────────────┘
```

---

## Core Components

### Server Entry Point (`index.ts`)

The main entry point initializes the MCP server and registers request handlers:

```typescript
// Server initialization
const server = new Server(
  { name: 'dethereal', version: '2.0.0' },
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
```

### Base Tool Classes (`base-tool.ts`)

Abstract base classes define the tool interface:

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

export abstract class BaseTool<TInput, TOutput> {
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly inputSchema: ZodType<TInput>
  abstract readonly requiresClient: boolean

  abstract execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>
}

// Concrete base classes
export abstract class ClientFreeTool extends BaseTool { requiresClient = false }
export abstract class ClientDependentTool extends BaseTool { requiresClient = true }
```

### Tool Categories

| Category | Tools | Requires Auth |
|----------|-------|---------------|
| **Authentication** | `login`, `logout`, `refresh_token` | No |
| **Schema/Reference** | `get_model_schema`, `get_example_models` | No |
| **Validation** | `validate_model_json` | No |
| **Model Management** | `import_model`, `export_model`, `update_model`, `create_threat_model` | Yes |
| **Class Discovery** | `get_classes` | Yes |
| **Attribute Updates** | `update_attributes` | Yes |

---

## Authentication Flow

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

See [Configuration Guide](../../CONFIGURATION_GUIDE.md#auth-disabled-mode-demo--development) for the backend requirements.

### Token Management

```typescript
// Token storage structure
interface StoredTokens {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number  // Unix timestamp
  tokenType: string
}

// Token priority for authenticated requests:
// 1. Token passed in tool arguments (_token parameter)
// 2. Cached tokens from ~/.dethernety/tokens.json (if not expired)
// 3. No token needed when authDisabled is true
```

### Auth Component Files

| File | Purpose |
|------|---------|
| `oauth-flow.ts` | Main authentication orchestration |
| `oauth-server.ts` | Localhost callback server (port 9876) |
| `pkce.ts` | PKCE code generation and verification |
| `token-store.ts` | Local token caching and retrieval |
| `platform-config.ts` | Fetches OIDC provider config from platform |
| `browser.ts` | Cross-platform browser opening |

---

## Tool System

### Tool Execution Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           TOOL EXECUTION FLOW                               │
└────────────────────────────────────────────────────────────────────────────┘

1. MCP CallTool Request
   │
   ▼
2. Find tool by name in registry
   │
   ▼
3. Build ToolContext
   ├─ If authDisabled:
   │  └─ Create unauthenticated Apollo client (no Authorization header)
   ├─ Else:
   │  ├─ Extract token from args or cache
   │  ├─ Fetch platform config if needed
   │  └─ Create Apollo client with Bearer token (if token available)
   │
   ▼
4. Check client requirement
   ├─ If requiresClient && !apolloClient
   │  └─ Return "Authentication required" error
   └─ Continue if satisfied (always satisfied when authDisabled)
   │
   ▼
5. Validate input with Zod schema
   │
   ▼
6. Execute tool.execute(input, context)
   │
   ▼
7. Format response
   ├─ Success: { content: [{ type: 'text', text: JSON.stringify(data) }] }
   └─ Error: { content: [...], isError: true }
```

### Tool Implementation Pattern

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

    // 5. Return result
    return { success: true, data: { model_id: result.model.id, ... } }
  }
}
```

---

## Data Flow

### Split-File Model Format

```
model-directory/
├── manifest.json       # Schema version, model metadata, module refs
├── structure.json      # Boundary/component hierarchy (no attributes)
├── dataflows.json      # Array of data flow connections
├── data-items.json     # Array of data classification items
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
attributes/* ──────┘        │              ▼
                            │         ImportResult
                            │         { model, idMapping }
                            │              │
                            ▼              ▼
                    Apply idMapping   Write server IDs
                    to source files   back to directory
```

### ID Mapping System

When importing, reference IDs in source files are mapped to server-generated IDs:

```typescript
// Before import (structure.json)
{
  "defaultBoundary": {
    "id": "temp-boundary-1",  // Reference ID
    "components": [{
      "id": "temp-component-1",
      "name": "Web Server"
    }]
  }
}

// After import - idMapping:
Map {
  "temp-boundary-1" => "550e8400-e29b-41d4-a716-446655440000",
  "temp-component-1" => "550e8400-e29b-41d4-a716-446655440001"
}

// Files updated with server IDs
{
  "defaultBoundary": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "components": [{
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Web Server"
    }]
  }
}
```

---

## Integration Points

### dt-core Classes Used

| Class | Purpose | Used By |
|-------|---------|---------|
| `DtImportSplit` | Import SplitModel to platform | `import_model`, `create_threat_model` |
| `DtExportSplit` | Export model to SplitModel | `export_model` |
| `DtUpdateSplit` | Update model from SplitModel | `update_model`, `update_attributes` |
| `DtModule` | Query modules and classes | `get_classes` |

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
    uri: `${platformConfig.graphqlUrl}`,
    headers
  }),
  cache: new InMemoryCache()
})
```

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

## Security Model

### Authentication Security

| Mechanism | Implementation |
|-----------|----------------|
| **OAuth 2.0 + OIDC** | Any OIDC-compliant provider (Cognito, Keycloak, Auth0, Zitadel) |
| **PKCE** | Protects against authorization code interception |
| **Local Token Storage** | `~/.dethernety/tokens.json` with filesystem permissions |
| **Token Expiration** | Access tokens expire in hours, refresh tokens in 30 days |
| **Auth-Disabled Mode** | For demo/development only; backend creates mock user for unauthenticated requests |

### API Security

| Mechanism | Implementation |
|-----------|----------------|
| **JWT Validation** | All GraphQL requests include Bearer token |
| **HTTPS** | All platform communication over TLS |
| **No Raw Queries** | All operations via dt-core (validated queries) |

### File System Security

| Mechanism | Implementation |
|-----------|----------------|
| **Backup Before Modify** | Timestamped backups on import/update |
| **Path Validation** | Zod schema validation on all paths |
| **No Arbitrary Execution** | Tools only read/write model files |

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DETHERNETY_URL` | Yes | `http://localhost:3003` | Platform base URL |
| `DEBUG` | No | `false` | Enable debug logging |

### MCP Server Registration

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

## Related Documentation

- [User Guide](../../user/dethereal/README.md) - End-user documentation
- [dt-core Overview](../dt-core/) - Data access layer
- [Backend Architecture](../backend/BACKEND_ARCHITECTURE.md) - GraphQL API
