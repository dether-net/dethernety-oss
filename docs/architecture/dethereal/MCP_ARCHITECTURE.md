# Dethereal MCP Server Architecture

> Architecture of the Dethereal MCP server. Supersedes [ARCHITECTURE.md](ARCHITECTURE.md), which is retained as a pre-upgrade snapshot; §11 says briefly how the one became the other.

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
- [11. History](#11-history)

---

## 1. Overview

**Dethereal** is an MCP (Model Context Protocol) server that enables AI assistants to create, validate, import, export, analyze, and manage Dethernety threat models. It is the platform communication layer of the Dethereal workflow, which is rendered for three harnesses: Claude Code, Codex and OpenCode. Each harness names the same tool differently:

| Harness | Tool name |
|---------|-----------|
| Claude Code | `mcp__plugin_dethereal_dethereal__<tool>` |
| Codex | `mcp__dethereal__<tool>` |
| OpenCode | `dethereal_<tool>` |

Which tools run without asking is decided once, in the tool manifest (see [Tool Manifest and Listing](#tool-manifest-and-listing)), and written into each harness's own approval configuration; see [PLUGIN_ARCHITECTURE.md → Tools by Approval](PLUGIN_ARCHITECTURE.md#tools-by-approval).

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Protocol Compliance** | MCP server over stdio via `@modelcontextprotocol/sdk`, offering the tools capability |
| **dt-core Integration** | Every platform write goes through `@dethernety/dt-core` classes. The few reads dt-core has no class for are the server's own read-only GraphQL documents (see [The server's own read documents](#the-servers-own-read-documents)) |
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
│     Every platform write is routed through dt-core classes:                 │
│     DtImportSplit, DtExportSplit, DtUpdateSplit, DtModule, DtModel,         │
│     DtClass, DtExposure, DtControl, DtControlLibrary, DtCountermeasure,     │
│     DtAnalysis, DtMitreAttack, DtMitreDefend.                               │
│     Reads dt-core has no class for are the server's own documents.          │
│                                                                             │
│  4. BROWSER-BASED OAUTH                                                     │
│     ─────────────────────────                                               │
│     Authentication via OIDC OAuth with PKCE. Opens browser for              │
│     login, receives callback on localhost, caches tokens locally.           │
│     Transparent token refresh via refresh token when access token expires.  │
│     Supports auth-disabled mode for no-auth deployments (no login needed).  │
│                                                                             │
│  5. HARNESS INTEGRATION                                                     │
│     ─────────────────────────                                               │
│     Skills and agents call tools by each harness's own tool name.           │
│     Which tools ask first comes from the tool manifest, written into        │
│     each harness's approval configuration. Tools are designed for agent     │
│     consumption (structured JSON output, compact summaries).                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              AI ASSISTANT HOST                               │
│                       (Claude Code / Codex / OpenCode)                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Skills  │  Agents (threat-modeler, etc.)                              │  │
│  │  call tools by the harness's tool name (see §1)                        │  │
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
│  │                            Tool Registry (36 tools)                    │  │
│  │  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │  │
│  │  │ Client-Free Tools (14)  │  │ Client-Dependent Tools (22)         │  │  │
│  │  │ • Authentication (3)    │  │ • Model CRUD (5)                    │  │  │
│  │  │ • Reference (2)         │  │ • Element Management (4)            │  │  │
│  │  │ • Validation (1)        │  │ • MITRE Frameworks (2)              │  │  │
│  │  │ • Local Workspace (2)   │  │ • Security Elements (6)             │  │  │
│  │  │ • Workflow State (4)    │  │ • Analysis (1)                      │  │  │
│  │  │ • Triage (1)            │  │ • Triage (3)                        │  │  │
│  │  │ • Hidden edges (1)      │  │ • Hidden edges (1)                  │  │  │
│  │  └─────────────────────────┘  └─────────────────────────────────────┘  │  │
│  │  Per-tool list: Tool Categories below                                  │  │
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
                                    │  │ • Knowledge graph (if loaded)   │  │
                                    │  └─────────────────────────────────┘  │
                                    └───────────────────────────────────────┘
```

---

## 3. Core Components

### Entry Point (`src/index.ts`)

`src/index.ts` is the package's executable (`dist/index.js`). It only dispatches: with no arguments it loads the MCP server (`src/server.ts`); with arguments it runs the command-line interface (`src/cli/`) that harness hooks and the installer use. A Node.js older than the supported floor is refused before either loads.

### MCP Server (`src/server.ts`)

The version the server reports comes from `serverVersion()`: the shipped build stamps the `package.json` version in as `__DETHEREAL_VERSION__`, and a build without it (tsc's output) reads the version from the `package.json` beside `dist/`.

The server registers two request handlers and connects over stdio:

```typescript
const server = new Server(
  { name: 'dethereal', version: serverVersion() },
  { capabilities: { tools: {} } }
)

// Tool listing: name, description, flattened input schema, and the
// interaction hint for tools the manifest marks requiresUser (tool-listing.ts)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools.map(listedTool) }
})

// Tool execution: find the tool, run it (§5), redact the result
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params
  const tool = allTools.find((t) => t.name === name)
  if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  const response = await callTool(tool, name, args)   // config gate, context, tool.run(args, context)
  return { ...response, content: response.content.map((item) => ({ ...item, text: redactSecrets(item.text) })) }
})

// Stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
```

`listedTool` converts each Zod schema to JSON Schema (draft-07) and forwards only `{ type, properties, required }`: top-level keywords such as `$ref`, or the `allOf` a cross-field refinement produces, are dropped before the client sees them, so tool inputs must be expressible as a flat property bag. `buildToolContext()` takes no arguments; it builds the session context described in §5.

Only local work happens before the transport connects (the project root is resolved and the configuration is checked), so a slow or unreachable platform never delays the handshake. The platform's `/config` is then loaded in the background, and again by the first tool call that needs it. When the harness closes stdin, a pending sign-in is cancelled and the process exits.

### Base Tool Classes (`src/tools/base-tool.ts`)

Abstract base classes define the tool interface. All 36 tools extend one of two concrete base classes:

```typescript
export interface ToolContext {
  apolloClient?: ApolloClient
  /** Why `apolloClient` is absent, when it is — see §5 Tool Execution Flow, step 5 */
  clientUnavailableReason?: string
  /** The bearer sent to the platform — the OAuth access token */
  token?: string
  /** The same session's OIDC identity token, read for profile claims only */
  identityToken?: string
  /** JWT-anchored operator identity, decoded from the identity token's `email`/`sub` claim */
  authnOperator?: string
  debug: boolean
  /** The settlement mode of this call, when an in-process caller names it; otherwise DETHEREAL_SETTLEMENT — see §5 Settlement Switch */
  settlement?: 'on' | 'off'
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
  /** A successful result is sent as compact JSON; `false` indents it. Errors are always compact */
  readonly compactResult: boolean = true

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
| **Authentication** | `login`, `logout`, `auth_status` | `ClientFreeTool` | 3 |
| **Reference** | `get_model_schema`, `get_example_models` | `ClientFreeTool` | 2 |
| **Validation** | `validate_model_json` | `ClientFreeTool` | 1 |
| **Local Workspace** | `workspace_status`, `detect_drift` | `ClientFreeTool` | 2 |
| **Workflow State** | `model_state`, `model_state_waive`, `model_state_settle`, `model_state_prune` | `ClientFreeTool` | 4 |
| **Triage (review)** | `triage_review` | `ClientFreeTool` | 1 |
| **Hidden edges (review)** | `hidden_edges` | `ClientFreeTool` | 1 |
| **Model CRUD** | `create_threat_model`, `import_model`, `export_model`, `update_model`, `list_models` | `ClientDependentTool` | 5 |
| **Element Management** | `get_classes`, `match_classes`, `update_attributes`, `generate_attribute_stubs` | `ClientDependentTool` | 4 |
| **MITRE Frameworks** | `search_mitre_attack`, `get_mitre_defend` | `ClientDependentTool` | 2 |
| **Security Elements** | `manage_controls`, `manage_countermeasures`, `get_control_gaps`, `query_controls`, `query_exposures`, `query_countermeasures` | `ClientDependentTool` | 6 |
| **Analysis** | `manage_analyses` | `ClientDependentTool` | 1 |
| **Triage (writes and evidence)** | `manage_dispositions`, `get_kg_chain`, `get_class_guide` | `ClientDependentTool` | 3 |
| **Hidden edges (writes)** | `manage_hidden_edges` | `ClientDependentTool` | 1 |
| **Total** | | | **36** |

`model_state_settle` is listed only with the settlement on, so a server with the default lists 35 tools; see [Settlement Switch](#settlement-switch).

The four triage tools serve the `triage` skill, together with two actions each of `search_mitre_attack` (`lookup`, `match`) and `query_exposures` (`list_model`, `evidence`); see [Triage Tools](#triage-tools). `triage_review` is a `ClientFreeTool` so that its `tasks` action needs a session only for the class guides it reads; its `open` refuses without a platform client, and `reply` and `get` work on the review the server holds.

The two hidden-edge tools serve the `hidden-edges` skill, and `manage_hidden_edges` `record` also serves the `remove` skill; see [Hidden-Edge Tools](#hidden-edge-tools). `hidden_edges` is a `ClientFreeTool` for the same reason as `triage_review`: its `open` refuses without a platform client, and `reply`, `get` and `evidence` work on the review the server holds.

`model_state_prune` is a write action and always asks for the operator's approval: it deletes the attribute files of elements the model no longer has. The server deletes only the files it finds orphaned itself (a structured attribute file named for an element id that is in no element group), all or nothing and at most 50 a call; a call that leaves more returns the next call's files as `next_files`. The call must name exactly those files, and each must still hold the bytes the server read. A flat file, a file named for another id, or one whose name differs from a live element id only in letter case is listed as not deleted. With the settlement on, it does not drop the removed elements' registered values; `model_state_settle` drops those once the operator acknowledges them. With it off, the prune runs the same checks, reads and writes no settlement file and needs no key, and its description does not name the settle tool.

### Source Directory Layout

Directories, and the key files in them. Tests sit beside the code, in `__tests__/` folders.

```
apps/dethereal/src/
├── index.ts                        # Executable: no arguments runs the server, arguments run the CLI
├── server.ts                       # MCP server: handlers, session context, config gate, redaction
├── tool-listing.ts                 # tools/list entries: flattened schema + interaction hint
├── config.ts                       # Platform URL resolution and URL policy (configProblem)
├── client/
│   ├── apollo-client.ts            # Apollo Client factory, cached per bearer
│   └── platform-capabilities.ts    # Probe for the platform fields the plugin's documents need
├── auth/
│   ├── login-manager.ts            # One non-blocking browser sign-in at a time (wait, pending, busy)
│   ├── oauth-flow.ts               # Code exchange, refresh, stored-session login
│   ├── oauth-server.ts             # Loopback sign-in server (/start, /callback; port 9876)
│   ├── browser.ts                  # Opens the local /start URL with a fixed system launcher
│   ├── pkce.ts                     # PKCE verifier/challenge and state generation
│   ├── token-store.ts              # Session store (~/.dethernety/tokens.json), locking, expiry
│   ├── revoke.ts                   # Refresh-token revocation at logout (RFC 7009)
│   ├── token-endpoint.ts           # Token/revocation endpoint failures, described without bodies
│   ├── platform-config.ts          # Platform /config fetching and caching
│   ├── scope.ts                    # Granted-scope and ID-token claim helpers
│   └── redact.ts                   # Session-token redaction for tool results and stderr
├── tools/
│   ├── manifest.ts                 # Tool manifest: names, approval classes, actions, inputs
│   ├── index.ts                    # Registry: allTools, clientFreeTools, clientDependentTools, localTools
│   ├── base-tool.ts                # BaseTool, ClientFreeTool, ClientDependentTool
│   ├── stub-tool.ts                # Placeholder for an unimplemented manifest entry (tests only)
│   ├── auth/                       # login, logout, auth_status
│   ├── query-security.tool.ts      # query_controls, query_exposures, query_countermeasures
│   ├── manage-exposures.tool.ts    # Exposure reader behind query_exposures (not a registered tool)
│   └── *.tool.ts                   # One file per remaining tool (see Tool Categories)
├── triage/                         # The triage domain behind the triage tools
│   ├── review.ts                   # A review: its groups, decisions and reply grammar (no I/O)
│   ├── store.ts                    # The open reviews, held in this process only
│   ├── dispositions.ts             # Disposition plans: checks, lines, writes and outcomes
│   ├── log.ts                      # The triage record (.dethereal/triage-log.json) and its caps
│   ├── exposures.ts                # A model's exposures in one read; one exposure's evidence
│   ├── model-views.ts              # The list_model views (partition, groups, rows), their pages and caps
│   ├── kg.ts                       # Knowledge-graph capability probe and chain read
│   ├── notices.ts                  # The fixed texts triage shows about the knowledge graph
│   ├── model.ts                    # The platform model a model directory names
│   └── text.ts, turns.ts           # Display cleaning; one call at a time per key
├── review-module/                  # The platform's dethermine-review module, as triage uses it
│   ├── contract.ts                 # Its GraphQL documents, the analysis lookup and create, and its bounds
│   ├── platform.ts                 # Each call, bounded in time and size, its answer checked as untrusted input
│   ├── workspace.ts                # What open reads: the module, the model's Triage analysis, fingerprints, waiting proposals
│   ├── payload.ts                  # A review's proposals as the publish takes them, what is left out, and the lines
│   ├── citations.ts                # A citation's grammar, and the files discovery read
│   └── readback.ts                 # What became of this machine's publishes, in the operator's words
├── hidden-edges/                   # The hidden-edge domain behind the hidden-edge tools
│   ├── open.ts                     # A run's reads: sync check, decisions, exposures, the module's candidates
│   ├── platform.ts                 # The module's candidate query, bounded in time and size
│   ├── answer.ts, contract.ts      # The module's answer checked as untrusted input; the fixed vocabulary
│   ├── review.ts, views.ts         # A review: its candidates, decisions and reply grammar (no I/O); its table pages
│   ├── analyst.ts                  # The analyst's evidence locators
│   ├── apply.ts                    # Apply and record plans, and the local writes
│   ├── records.ts                  # The decisions file (signed accepts) and the hidden-edge record
│   ├── predicate.ts                # Which flows are hidden edges on this machine
│   └── asks.ts, local.ts           # The review and apply questions; the local model as the checks read it
├── utils/
│   ├── directory-utils.ts          # Read/write split-file model directories, apply ID mappings
│   ├── file-utils.ts               # Path operations, JSON I/O, backups
│   ├── sync-utils.ts               # .dethereal/sync.json
│   ├── platform-baseline.ts        # Platform-change check before a push
│   ├── state-store.ts              # .dethereal/state.json and the other committed state files
│   ├── gates.ts                    # Quality Gates 1–3
│   ├── loop-back.ts                # Loop-back guard
│   ├── settlement*.ts              # Settlement baseline, state and machine registrations
│   ├── settle-plans.ts             # In-memory plans of the two-phase tools (settlement, dispositions)
│   ├── registrable.ts              # What may be registered as the operator's value
│   ├── manifest-modules.ts         # Derived manifest.json module list
│   ├── project-root.ts             # Project root resolution
│   ├── path-confinement.ts         # Path confinement for directory_path
│   ├── runtime-trust.ts            # Refuses a Node runtime that cannot be trusted with the bearer
│   └── ...                         # Lints, tiers, hashing, locking, git, secret paths, source globs
├── cli/                            # CLI: hook commands (session-start, post-write, approve, config and secret guards), workspace-status, installer commands
├── installer/                      # dethereal install / uninstall / doctor for Claude Code, Codex, OpenCode
├── generator/                      # Renders the harness-neutral workflow/ into bundles/<harness>
├── packaging/                      # Shipped-build options and self-contained bundle checks
├── data/                           # Example models and credential-class hints
├── acceptance/                     # Development only: scoring of harness runs (not shipped)
├── test-setup/                     # Isolated home directory for tests
└── __tests__/                      # Package-level tests (packaging, startup, tool listing, harness smoke tests)
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
       │                   │ Open local /start │                   │
       │                   │ (redirects to IdP)│                   │
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
       │ Platform URL,     │                   │                   │
       │ email, expiry     │                   │                   │
       │ (never tokens)    │                   │                   │
       │                   │                   │                   │
```

`login` does not block until the browser returns. It waits at most `wait` seconds (default 30, at most 45); a sign-in that has not finished by then is reported as `status: 'pending'` with `openUrl`, the local `http://127.0.0.1:9876/start` address, for the user to open. The listener lives 5 minutes from its start and exchanges the code as soon as the provider redirects, whether or not a call is waiting; the next `login` reuses the pending sign-in, and `force_new` cancels it first. The provider's sign-in URL, with its `state` and PKCE challenge, is never returned or logged: `/start` redirects to it.

### Auth-Disabled Mode

When the platform's `/config` endpoint returns `authDisabled: true` (no-auth mode), the MCP server bypasses all OAuth flows:

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
| **Auth tools** | `login` returns immediately with a "No login needed" message; `auth_status` reports `authDisabled: true, authenticated: true`; `logout` behaves as in any mode (it removes whatever session is stored) |

### Token Management

```typescript
// Token storage structure (~/.dethernety/tokens.json)
// Keyed by platform URL to prevent cross-instance token confusion (D61)
interface TokenFile {
  version: number
  tokens: Record<string, StoredTokens>   // keyed by platform URL
  logoutEpoch?: string      // Rewritten by every logout; a sign-in saves only if it is
                            // unchanged since the sign-in began
  // Unknown top-level keys are kept on every write
}

interface StoredTokens {
  accessToken: string       // Bearer presented to the platform (carries `scope`)
  idToken: string           // Profile claims only — never sent as a bearer
  grantedScope?: string     // Scope the provider actually granted; absent on older
                            // records, where the access token's own claim is read instead
  refreshToken: string
  expiresAt: number         // Unix timestamp (milliseconds) when the access token expires
  baseUrl: string           // Platform these tokens belong to
  storedAt: number          // When the tokens were last written (reset on every save)
  oidcDomain?: string       // The identity provider that issued the session; logout
  oidcClientId?: string     // revokes the refresh token only there, for this client
  refreshRejected?: boolean // The provider rejected the refresh token: never refreshed
                            // again; a new sign-in replaces the entry
  issuedAt?: number         // Written by older versions; ignored
}

// Token resolution for authenticated requests:
// 1. Load stored tokens from ~/.dethernety/tokens.json for the current baseUrl
// 2. Use them while expiresAt is more than 60 seconds away
// 3. Otherwise try a transparent refresh, unless the provider already rejected the refresh token
// 4. No token needed when authDisabled is true
```

The `getSessionTokens()` function in `server.ts` implements this chain, returning the session's two tokens as `{ bearer, identity }`:
1. Load stored tokens from `~/.dethernety/tokens.json` keyed by the current `baseUrl`. They are valid until 60 seconds before the stored `expiresAt`; the JWT is not decoded for this.
2. If they have expired, refresh transparently: load the platform config, then call the OIDC token endpoint with `grant_type=refresh_token`, and store and use the new tokens (or another process's, if it refreshed first). Any refresh token the provider has not rejected is tried, since only the provider knows whether it is still valid; a rejection sets `refreshRejected`. The refresh is bounded to 10 seconds.
3. Return `undefined` if no valid token is available (no session, a rejected refresh token, or a refresh that failed).

The two are not interchangeable. `bearer` is the OAuth **access token** — only it carries the `scope` claim, and a resource server behind the platform is entitled to require one. `identity` is the **ID token** — only it carries the profile claims (`email`), which is what audit attribution reads; it is never sent as an `Authorization` header.

**Scope.** Login requests the scope the platform advertises as `oidcScope`, falling back to `openid profile email` when it advertises none, and records what the provider actually granted as `grantedScope`. A stored session whose grant no longer satisfies the requirement is skipped in favour of a fresh browser login: the refresh grant takes no scope parameter, so refreshing would re-issue the original grant indefinitely. When the provider grants less than was asked for, login still succeeds and reports the shortfall — the tokens remain valid for the platform itself, but anything behind it may refuse them.

> **Security (D61):** The `_token` argument is **not supported**. Tokens must only come from the secure token store, never from the conversation layer. Accepting tokens from tool arguments would allow prompt injection attacks to supply attacker-controlled JWTs.

> **Security (D69):** Credentials do not flow the other way either. No tool takes a credential as input or returns token material or the token-store path; skills check the session with `auth_status` and are told never to read `~/.dethernety/`. Everything the server relays that it does not control — platform error text, a proxy's error page, the GraphQL layer's own logging — can echo the bearer, so every session token the process loads or saves is registered with `auth/redact.ts`, and both tool results and stderr pass through exact-value redaction. Token-endpoint errors carry only the HTTP status and the OAuth `error` code; token-store errors carry only the filesystem error code; the sign-in URL (which holds the pending login's `state` and PKCE challenge) is never logged or put into an error.

### Auth Component Files

| File | Purpose |
|------|---------|
| `auth/login-manager.ts` | One browser sign-in at a time, never blocking a call for long: `wait`, pending, reuse, `force_new`, cancellation |
| `auth/oauth-flow.ts` | Authorization-code exchange, refresh, and the stored-session step of `login` |
| `auth/oauth-server.ts` | Loopback sign-in server on port 9876: `/start` redirects to the provider, `/callback` receives the code |
| `auth/pkce.ts` | PKCE code_verifier/code_challenge and `state` generation |
| `auth/token-store.ts` | Session store (`~/.dethernety/tokens.json`): locking, atomic writes, expiry, refresh bookkeeping |
| `auth/revoke.ts` | Revokes removed sessions' refresh tokens at logout, each at its own platform's provider (RFC 7009) |
| `auth/token-endpoint.ts` | Token and revocation endpoint failures, reported by HTTP status and OAuth `error` code only |
| `auth/platform-config.ts` | Fetches and caches OIDC provider config from platform `/config` endpoint |
| `auth/browser.ts` | Opens only the local `/start` URL with a fixed system launcher (macOS `/usr/bin/open`, Windows `rundll32`, elsewhere `xdg-open`); errors never include the URL |
| `auth/scope.ts` | Granted-scope parsing and the `email` claim of the ID token |
| `auth/redact.ts` | Registers session tokens and redacts them from tool results and stderr |

---

## 5. Tool System

### Tool Manifest and Listing

`src/tools/manifest.ts` is the frozen contract of every tool: its name, its approval class (`auto` runs without a prompt in harnesses that ask per tool, `prompt` always asks), its actions and top-level inputs, and `requiresUser` for tools that must never run unattended. A test holds the registered tools to it. The per-harness bundles read their approvals from it: the Claude Code approve hook, Codex's `approval_mode` entries and OpenCode's `permission` rules. Today 20 tools are `auto` and 16 are `prompt`; on Claude Code the approve hook also approves one action of a `prompt` tool, `model_state_settle` `prepare`, which records nothing in the model.

The triage tools' classes:

| Tool | Approval | `requiresUser` | Why |
|------|----------|:-:|-----|
| `triage_review` | `auto` | -- | It reads the model and records the operator's replies in the model's own triage record; `tasks` writes the remediation task list under a fixed name in the run's own scratch directory, which is kept out of git, and never over a file. It never changes the platform. Only the main session holds it (see [PLUGIN_ARCHITECTURE.md → Main-session-only tools](PLUGIN_ARCHITECTURE.md#main-session-only-tools)) |
| `manage_dispositions` | `prompt` | yes | It writes dispositions and creates supersede copies on the platform, or publishes proposals to the platform's Triage workspace; `prepare`, `commit`, `prepare_publish` and `publish` each ask |
| `get_kg_chain` | `auto` | -- | Read-only knowledge-graph evidence |
| `get_class_guide` | `auto` | -- | Read-only class guidance |

`search_mitre_attack` and `query_exposures` stay `auto` with their new read actions.

The hidden-edge tools' classes:

| Tool | Approval | `requiresUser` | Why |
|------|----------|:-:|-----|
| `hidden_edges` | `auto` | -- | It reads the model, the platform's candidates and the model's exposures, and records the operator's replies in the model's own hidden-edge record. It never changes a model file or the platform. Only the main session holds it (see [PLUGIN_ARCHITECTURE.md → Main-session-only tools](PLUGIN_ARCHITECTURE.md#main-session-only-tools)) |
| `manage_hidden_edges` | `prompt` | yes | It writes flows into the model files, the decisions file and, for a one-by-one accept, affirmations on the platform; `prepare`, `record` and `commit` all ask |

`tools/list` (`src/tool-listing.ts`) lists each tool with its name, description and flattened input schema. A tool whose manifest entry has `requiresUser` also carries `_meta["anthropic/requiresUserInteraction"]: true`: Claude Code then asks even under allow rules, and refuses the call where no one can answer. Other harnesses ignore the key and apply their own approval rules.

A placeholder (`stub-tool.ts`) for a manifest entry without an implementation is registered only when `DETHEREAL_REGISTER_STUBS=1`, which tests set; a model never sees one.

### Settlement Switch

The **settlement** holds each value in the model files to the operator's registrations (see [`model_state_settle`](#model_state_settle)). It is off by default. It is on only when `DETHEREAL_SETTLEMENT` is exactly `on`. Unset is off. Any other value, an empty one included, is off too, and the server says so in one fixed stderr line at start that never shows the value (`settlementEnvProblem` in `src/utils/settlement-switch.ts`).

| | Settlement off (default) | Settlement on |
|---|---|---|
| Tool list (read once, when the server starts) | No `model_state_settle`; `model_state_prune` stays; `model_state` lists no `include`, `pending_from`, `pending_limit` or `pending_render`, and its description does not mention pending enrichment | All tools, with all their inputs |
| Push refusal (`create_threat_model`, `import_model`, `update_model`, `update_attributes`) | Gate 2 alone | Gate 2, then pending enrichment, then the settlement |
| `REVIEWED` | Gates 2 and 3, no queued stale element, a review hash | Also nothing pending and no unregistered value |
| `model_state` `get` | `settlement: "off"`, and none of `baseline`, `unregistered_changes`, `declined_fields`, `orphaned_registrations`, `registered`, the settlement log or `pending_enrichment`; a call that names `include` is refused as an unknown input | The settlement fields and `pending_enrichment` |
| `display_state` | No pending-enrichment or settlement qualifier | `N pending enrichment`, `N unregistered`, `N values from a pull` |
| Gate 3 report and lints | No `pending_enrichment` in the report, no `pending_enrichment` lint | Both |
| `workspace_status` | `settlement: "off"` (the mode it read the models with, in the workspace view and the one-directory view, `directory_path`, alike); no `pending`, `pending_unreadable` or `settlement` blocker; `settledWithSettlementOn: true` on a model with settlement records (below); `settlementSwitchNotOn: true` when `DETHEREAL_SETTLEMENT` is set but not to `on` (never the value) | `settlement: "on"`, in both views; all three blockers |
| Pull and push | Register nothing | Register the values the platform held or linked ([SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow)) |
| `model_state_prune` | Deletes the orphaned files; no settlement file, no key | Also logs the prune and re-signs the baseline |
| Approve hook (Claude Code) | Approves no `model_state_settle` action | Approves `model_state_settle` `prepare` |
| Session-start text | Nothing about the settlement, and none of its qualifiers, except `settled with the settlement on, which is now off` on a flagged model and, when `DETHEREAL_SETTLEMENT` is set but not to `on` (an empty value included), the fixed line ``Settlement off: DETHEREAL_SETTLEMENT is set, but not to `on`.`` at startup and after compaction | One line, at startup and after compaction: `Settlement on: values the operator has not confirmed hold back REVIEWED and a push.` |

**A switch from on to off is still seen.** With the settlement off, a model whose `.dethereal/` holds settlement records (`settlement-baseline.json` or `settlements.json`) is flagged: `workspace_status` gives it `settledWithSettlementOn: true`, and the session-start model line adds `settled with the settlement on, which is now off`. At startup the line shows only when the project has one model (startup reads one model and, with several, shows only a count); after compaction it shows on each model listed. Only the files' presence is checked; nothing in them is read. With the settlement on, nothing is added. This catches a switch made outside the guarded configuration.

With the settlement off, a pull, a push and every `model_state` change still keep this machine's files out of git through `.dethereal/.gitignore`. The write is idempotent and keeps any line the user added.

Both modes keep Gates 1–3, the Gate 3 waivers and their machine key, the orphaned-file prune and the secret-file guard.

**Hooks follow the switch.** The `approve` and `session-start` hooks and the `workspace-status --json` command read the mode by the server's rule, with one addition: a command that carries `--settlement` is on (`hookSettlement` in `src/utils/settlement-switch.ts`). Without the flag, its environment decides: on only when `DETHEREAL_SETTLEMENT` is exactly `on`. The flag only stands in where a harness gives hooks no environment block. A bundle generated with the settlement on adds the flag to the Claude Code and Codex hook commands, and sets the variable for OpenCode's plugin hooks. Shipped bundles leave it off. See [PLUGIN_ARCHITECTURE.md → Hooks](PLUGIN_ARCHITECTURE.md#6-hooks).

**The switch is the operator's.** The plugin's config guard refuses an agent edit that adds, removes or changes `DETHEREAL_SETTLEMENT`, in any spelling (upper or lower case), since the environment ignores case on Windows. The refusal says the edit changes whether the settlement is on. In Claude Code settings the guard refuses any other change to `env` too, since every process Claude Code starts reads it (see [PLUGIN_ARCHITECTURE.md → Config Guard](PLUGIN_ARCHITECTURE.md#config-guard)).

**A switch set but not on is said.** A repository's own settings can set the variable, so the session-start text never shows its value. When it is set to anything but exactly `on`, an empty value included, the text adds one fixed line, ``Settlement off: DETHEREAL_SETTLEMENT is set, but not to `on`.``, and `workspace_status` carries only the boolean `settlementSwitchNotOn: true`. A hook whose command carries `--settlement` does not read the environment, so it adds neither.

The manifest marks the inputs listed only with the settlement on as `settlementOnly`. Leaving them out saves every request their descriptions.

A tool called in-process can name the mode itself (`ToolContext.settlement`). Only the acceptance scorer does: it reads a run's model with the mode that run's server had. On a server that lists the row-list inputs, a `get` with `include` under the off mode is refused `settlement_off`.

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
3. Configuration gate (configProblem())
   ├─ An unusable platform URL (malformed, plain HTTP to a remote host, user name or
   │  password in the URL, plain HTTP with Node's env proxy on) or a Node runtime that
   │  cannot be trusted with the bearer: every tool except auth_status, logout and the
   │  local tools returns { error: "Configuration error", message, tool }
   │
   ▼
4. Build ToolContext
   ├─ Auth tools (login, logout, auth_status) and local tools (workspace_status,
   │  detect_drift, model_state, model_state_waive, model_state_settle,
   │  model_state_prune) get a bare context: the auth tools manage the session
   │  themselves, so auth_status never makes a network call it was not asked for;
   │  the local tools read files only
   ├─ Every other tool: buildToolContext()
   │  ├─ Fetch platform config if not cached (a failure is logged, not thrown)
   │  ├─ If authDisabled: unauthenticated Apollo client (no Authorization header)
   │  └─ Else:
   │     ├─ Load the session from the store (keyed by baseUrl); valid until 60 s
   │     │  before expiresAt — if expired, transparent refresh (bounded to 10 s)
   │     └─ Apollo client with the Bearer token (if a token is available),
   │        reused for the same token
   │
   ▼
5. Check client requirement
   ├─ If requiresClient && !apolloClient — branch on context.clientUnavailableReason:
   │  ├─ Reason set: { error: "Platform client unavailable", message: <reason>, tool }
   │  │  (the token was usable — /config unreachable or malformed, or auth-disabled
   │  │   mode; re-login cannot fix this and `login` answers "No login needed")
   │  └─ No reason: { error: "Authentication required", message: "...", tool }
   └─ Continue if satisfied (always satisfied when authDisabled)
   │
   ▼
6. Check platform capability (gated calls only: needsDataControls(tool, args))
   ├─ Gated: export_model, import_model, update_model, create_threat_model,
   │  update_attributes, manage_controls actions list / assign / push-greenfield,
   │  and query_controls list (it forwards to manage_controls in-process)
   ├─ missingPlatformCapability(apolloClient, baseUrl) queries Data.controls once
   │  per platform (a pass is cached; a refusal is re-asked on the next call)
   ├─ Refused: { error: "Platform too old for this Dethereal version",
   │  message: <names the platform's origin>, tool }
   └─ Continue if the field exists, or if the probe could not tell
   │
   ▼
7. tool.run(args, context): validate input with the Zod schema (safeParse)
   ├─ Validation failure: return { success: false, error: "Invalid input: ..." }
   │
   ▼
8. Execute tool.execute(input, context)
   │
   ▼
9. Format MCP response
   ├─ Success: { content: [{ type: 'text', text: JSON.stringify(data) }] }
   │  (compact JSON, no indentation; a top-level `warnings` is merged
   │   into `data`)
   ├─ Error: { content: [{ type: 'text', text: JSON.stringify({ error, data }) }], isError: true }
   └─ Thrown: { error: <message>, tool }, isError: true
   │
   ▼
10. Redact: every registered session token is replaced with "[redacted]" in the
    response text (the same pass runs on everything written to stderr)
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
    // modelId is required — it stamps manifest.model.id, which update_model
    // and the sync push path read back later.
    await applyIdMapping(input.directory_path, result.idMapping, result.model.id)

    // 5. Return structured result
    return { success: true, data: { model_id: result.model.id, ... } }
  }
}
```

The MITRE, security-element and analysis tools follow the **action-based pattern** — a single tool handles multiple operations via an `action` discriminator:

```typescript
export class QueryExposuresTool extends ClientDependentTool<ExposuresInput, unknown> {
  readonly name = 'query_exposures'
  readonly description = '...'
  readonly inputSchema = z.object({
    action: z.enum(['list', 'get']),
    element_id: ID.optional(),     // required for 'list'
    exposure_id: ID.optional(),    // required for 'get'
    limit: z.number().int().min(1).max(500).optional()
  }).strict()

  async execute(input: ExposuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    const dtExposure = new DtExposure(context.apolloClient!)

    switch (input.action) {
      case 'list': {
        const exposures = await dtExposure.getExposures({ elementId: input.element_id! })
        return { success: true, data: { exposures: exposures.slice(0, input.limit ?? 100), total: exposures.length } }
      }
      case 'get': {
        const exposure = await dtExposure.getExposure({ exposureId: input.exposure_id! })
        return { success: true, data: { exposure } }
      }
    }
  }
}
```

The example is simplified: the shipped `query_exposures` (in `query-security.tool.ts`) also checks each action's required fields, hands the platform call to an internal exposure reader that is not registered as a tool of its own, and has two more actions, `list_model` and `evidence` (see [`query_exposures`](#query_exposures)).

### Error Propagation

MCP tool errors propagate to the agent via `ToolResult`. Agent prompts include handling instructions:

| Error Type | Agent Behavior |
|------------|---------------|
| **Auth errors** ("Authentication required") | Agent suggests `/dethereal:login` and retries |
| **Client unavailable** ("Platform client unavailable") | Re-login cannot help — agent surfaces `message` and checks the platform URL and `/config` reachability |
| **Validation errors** (Zod parse failure) | Agent presents errors to user with suggested fixes |
| **Network errors** (platform unreachable) | Agent retries once after 5 seconds, then reports to user |
| **Platform errors** (GraphQL 500) | Agent reports to user without retry |
| **Not found** (model/element ID invalid) | Agent reports to user, suggests corrective action |

---

## 6. Tool Reference

### Authentication Tools (Client-Free)

None of the three tools accepts a credential as input or returns token material or the token-store path (D69).

#### `login`

Browser-based OAuth PKCE authentication.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ wait?: number, force_new?: boolean }` — seconds to wait for a browser sign-in to finish (0–45, default 30); start a new sign-in even if a session is stored or a sign-in is pending |
| **Output** | Signed in: `{ status: 'authenticated', authenticated: true, expiresIn, tokenType, fromCache?, refreshed?, platformUrl, email?, identityChanged?, previousEmail?, scopeShortfall?, message }`. Not yet: `{ status: 'pending' \| 'busy', authenticated: false, openUrl?, expiresInSeconds?, platformUrl, message }` |
| **dt-core class** | None (uses auth module directly) |

Reuses a valid stored session (`fromCache: true`) or refreshes an expired one (`refreshed: true`). Otherwise starts a browser sign-in (see [OAuth 2.0 with PKCE](#oauth-20-with-pkce)) and returns within `wait` seconds: signed in, or `pending` with `openUrl`, the local `/start` address, for the user to open; the agent never opens or fetches it itself. When no browser could be opened on this machine, the pending message says so. A later `login` reuses the pending sign-in. `busy` means another sign-in holds the local port. `platformUrl` is the platform origin and `email` comes from the ID token; `identityChanged` warns that the session belongs to a different user than the one stored before. Returns immediately with "No login needed" when `authDisabled` is true.

#### `logout`

Remove the locally stored session, then revoke it at its identity provider.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ clear_all?: boolean }` — sign out of every platform, not just the configured one |
| **Output** | `{ message, revocation }` — `revocation` has one entry per removed session: `{ platform, result: 'revoked' \| 'skipped' \| 'failed', reason? }` |
| **dt-core class** | None |

First cancels any sign-in still pending, in this session or another Dethereal session on this machine, so it cannot re-create the session. Then removes the stored session for the current platform (or all platforms) from the local token store and clears the Apollo client cache; the local removal never depends on the network. Finally it revokes each removed session's refresh token (RFC 7009) at its own platform's identity provider, with that platform's client id read from its `/config` at the time; a session that recorded its issuer is revoked only if the platform still names that issuer. At most 20 sessions are revoked per call, each bounded to 5 seconds; the rest, and platforms that cannot be reached, are reported as skipped or failed. With a configuration or runtime that cannot be trusted (see [API Security](#api-security)), nothing is sent and every entry is `skipped`.

#### `auth_status`

Read-only session report — the supported way for skills and agents to check authentication.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ verify?: boolean }` |
| **Output** | `{ platformUrl, urlSource, projectRoot, authDisabled, authenticated, pending, email?, expiresAt?, secondsRemaining?, scopeShortfall?, detail? }` |
| **dt-core class** | None |

| Field | Meaning |
|-------|---------|
| `platformUrl` | Origin of the platform this server talks to |
| `urlSource` | `'env'` when `DETHERNETY_URL` is set; otherwise `'user_config'` when `DETHERNETY_PLATFORM_URL` is (the Claude Code plugin's user config, or the URL a Codex or OpenCode install wrote); otherwise `'default'` |
| `projectRoot` | Directory model paths are resolved against |
| `authDisabled` | Whether the platform runs without authentication; `null` when the platform has not been reached |
| `authenticated` | `true` for a live session, or when the platform has authentication disabled |
| `pending` | Whether a sign-in is waiting for the browser |
| `email` | Signed-in user, from the ID token |
| `expiresAt` | Access-token expiry (ISO-8601) |
| `secondsRemaining` | Seconds until the access token expires, never negative |
| `scopeShortfall` | Scopes the platform asks for that the session was not granted |
| `detail` | Why the session is not usable (e.g. `not signed in`, `session expired; sign in again`, `platform unreachable: timeout`) |

Without `verify` the answer comes from local state only — no network. With `verify: true` it loads the platform config if it is not cached and refreshes an expired session first, both bounded to 10 seconds. `/dethereal:status`, `/dethereal:sync` (push, pull and status) and the push step of `/dethereal:threat-model` call it with `verify: true`.

Token refresh has no tool of its own: every call of a tool that is neither an auth tool nor a local tool refreshes an expired session transparently (see [Tool Execution Flow](#tool-execution-flow), step 4), and so do `login` and `auth_status` with `verify: true`.

### Reference Tools (Client-Free)

#### `get_model_schema`

Returns the SplitModel JSON schema and modeling guidelines.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ include_examples?: boolean }` — include example values in the schema (default `true`) |
| **Output** | `{ guidelines, directory_structure, schemas }` |
| **dt-core class** | None (reads from bundled data) |

> **Output size note:** The full schema exceeds 10,000 tokens. The workflow therefore embeds the modeling guidelines in its agent and skill prompts, or ships them as files beside the skills, instead of calling this tool; see [PLUGIN_ARCHITECTURE.md §9](PLUGIN_ARCHITECTURE.md#9-architecture-decision-mcp-vs-skills-for-documentation-d47).

#### `get_example_models`

Returns example model templates for reference.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ type?: 'simple' \| 'web_app' \| 'api_service' \| 'database' \| 'microservices', file_type?: 'manifest' \| 'structure' \| 'dataflows' \| 'data-items' \| 'attributes' \| 'all' }` — `type` defaults to `simple`; without `file_type` (or with `all`) every file is returned |
| **Output** | Example model JSON structures |
| **dt-core class** | None (reads from bundled data) |

### Validation Tool (Client-Free)

#### `validate_model_json`

Offline structural validation, quality scoring, control-coverage analysis, and boundary trust zoning.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ action?: 'validate' \| 'quality' \| 'coverage' \| 'zoning' \| 'gates' (default `validate`), directory_path?: string, data?: string \| object, file_type?: 'manifest' \| 'structure' \| 'dataflows' \| 'data-items' \| 'attributes', assets?: 'full' \| 'skeleton', detail?: 'summary' \| 'full' (default `full`; `gates` and `quality` only), include?: Array<'gates' \| 'zoning'> (`validate` with `directory_path` only), model_id? }` |
| **Output** | Validation errors (`validate`), quality score breakdown (`quality`), coverage summary (`coverage`), per-boundary trust determination + advisory findings (`zoning`), or the Gates 1–3 result with per-element failures (`gates`) |
| **dt-core class** | None for `validate`/`quality`/`zoning`/`gates` (local file computation; zoning runs the `dt-boundary` determination engine); `DtControl` for online `coverage` |

- `validate`: Structural checks — required fields, ID uniqueness, reference integrity, schema compliance. Includes conduit `peerId` integrity (peer must be a known boundary; self-conduits and lone-inbound conduits are rejected, so `validate` matches what the OUTBOUND-canonical write can persist). Over a directory, the reply is `{ valid, errors, warnings }`; an identical warning (same `file`, `path` and `message`) is listed once, with `count` when it stands for more than one. With `include`, the same call also returns the gates and the zoning — see **`validate` -> `include`** below.
- `quality`: Quality score computation using the formula from THREAT_MODELING_WORKFLOW.md (component classification rate, attribute completion, boundary hierarchy quality, data flow coverage, data classification, control coverage, credential coverage). The payload also carries a top-level `attribute_residual` — see below.
- `coverage`: Control-coverage analysis — online (authoritative MITRE-chain, requires `model_id` + auth) or offline (assignment heuristic from local files)
Either `directory_path` or `data` must be supplied. `directory_path` validates the whole model directory and takes precedence; `data` validates a single file inline (a JSON string or an already-parsed object), with `file_type` naming which schema to apply. `quality`, `zoning` and `gates` require `directory_path`.

- `zoning`: Offline per-boundary trust determination — computes each boundary's `{ declaredZone, resolvedZone, proposedTier, structural, summary? }` plus advisory coherence findings, entirely over the local files (the plugin computes; it never asks the LLM to walk the tree). The `assets` parameter selects the phase: `skeleton` sets external + exposure + `INTERNAL` and defers `RESTRICTED` (the Step-4 trust skeleton), `full` (default) is the close-of-Step-7 / Step-9 determination where qualifying `INTERNAL` boundaries promote to `RESTRICTED`. Each finding carries `{ kind, boundaryId, detail, severity, peerId? }`; an `external-ingress` crossing reached only through forwarding hops (load balancers, proxies, …) adds `via` / `viaIds`, the forwarders in order, and is reported in both phases since it depends on no asset. One rule is the server's own, applied over the engine's proposal in both phases: a non-structural boundary whose own attribute `allow_any_inbound` is `true` is proposed `PUBLIC` (reason `allows any inbound traffic (allow_any_inbound: true)`) unless the engine proposed `VENDOR` or `UNTRUSTED`; Gate 3's `zone_disagreements` compares against the same proposal. The engine does not see the rule: its findings, and its one-hop `EXPOSED` for the boundaries behind a public one, read the boundary as the engine proposed it. See [TRUST_ZONING.md](TRUST_ZONING.md) for the cascade, the six finding kinds, and the guided-workflow ratification points.
- `gates`: Gates 1–3 over the model directory, with the stored Gate 3 waivers applied: `{ lints, gate1, gate2, gate3 }`, each gate with its verdict and named checks (Gate 3: criteria C1–C9 plus `verdict_without_waivers`), and each failing check with its elements (at most 100, with `failing_total`) and remedy. The report does not repeat itself: a passing check (no failures, no waived failures) is just `{ verdict, value }`, and failures of C2, C3 and C8 carry `missing` and `placeholder` field lists instead of `detail`, which said the same in words; a failure without a field list keeps its `detail`. A failing Tier 1–2 flow in C8 whose transit is set only under a transit field of its class (such as `flow_tls_encrypted`, the fields C3 reads in place of `encryption_in_transit`) also carries `alias_present`, those fields; C8's remedy says to write `encryption_in_transit` beside it, from the same source, and each such flow adds a `floor_key_alias_only` lint (warning). Gate 3 also carries `loopback`, advisory: what a loop back to enrichment has to answer, built from the Gate 3 failures no waiver covers — `elements` (each with `element_id`, `name`, `kind` component|boundary|flow|data_item|model, `criteria` and the `fields` to settle) and `not_enrichable` (failures enrichment cannot answer: classification, a missing class template, no cross-boundary flow, the crown-jewel map; each with a `reason`), each list at most 100 with `elements_total` / `not_enrichable_total`, and both empty when Gate 3 passes; while `elements` is non-empty it also carries `arm`, the instruction to call `model_state` action `loop_back` before any write. An armed loop-back can hold Gate 3 back — see **`gates` -> the loop-back guard** below. See [THREAT_MODELING_WORKFLOW.md §8](THREAT_MODELING_WORKFLOW.md#three-tier-quality-gates).

**`validate` -> `include`.** One call in place of up to three. `validate` with `directory_path` takes `include: ['gates']`, `['zoning']` or both:

- The validate result comes back as before, plus `gates` and/or `zoning`, each exactly what its own action returns.
- `detail` applies to the gates part (see **`gates` / `quality` -> `detail`** below), `assets` to the zoning part.
- A part that cannot be computed comes back as `gates_unavailable` or `zoning_unavailable`, `{ code, message }`, and the rest still comes. `code` is the model file's code when a file could not be read for the gates (such as `missing` or `invalid_json`), otherwise `gates_failed` or `zoning_failed`.
- A validate that fails fails as before, with no parts.
- `include` with another action, or with inline `data`, is refused `include_scope`.

**`quality` -> `attribute_residual`.** The enrichment worklist that `attribute_completion_rate` compresses into one number:

```typescript
attribute_residual: {
  declared: number            // template fields seen across scored elements
  resolved: number
  unresolved: number
  elements_scored: number             // classified, with a cached template
  elements_unclassified: number       // no class binding — excluded from the ratio
  unclassified_open: number           // of those, less the root container and those left unclassified
  elements_without_template: number   // classified, no cached template — excluded
  basis: 'template' | 'file-presence'
  blocked: Array<{ element: string; class_id: string }>
  top_unresolved: Array<{ element: string; class: string; unresolved: number; declared: number; fields: string[] }>
}
```

`basis` is load-bearing. It is `template` when the rate was measured against real class template fields, and `file-presence` when no class cache exists and the rate fell back to counting attribute *files*. A consumer that reads only `quality_score` cannot tell a `1.0` that means "fully enriched" from a `1.0` that means "no class cache, so we counted files" — run `generate_attribute_stubs` to populate the cache. `blocked` names the classified elements the ratio could not measure; `top_unresolved` is capped so the payload stays usable on a large model.

**`gates` / `quality` -> `detail`.** `full` (default) keeps every failing element with its fields, the loop-back worklist (`gate3.loopback`) and `attribute_residual.top_unresolved` with its fields — what Step 9's gap list, a loop back and the enrichment worklist read. `summary` is for a progress check:

- `gates`: `{ detail: 'summary', lints_total, gate1, gate2, gate3 }`. Gates 1 and 2 carry their verdict and, per check, either its verdict (passing) or `{ verdict, failing_total, failing }`, `failing` being the element ids. A Gate 1 check whose verdict is `WARN` lists only its first 3 ids (`failing_total` counts them all); a failing Gate 1 check, and every check of Gates 2 and 3, lists every id. Gate 3 carries its verdict, `verdict_without_waivers`, the criteria in the same brief form, `waived_total`, the whole `report` and `loopback: { elements_total }`, plus `loop_back_round` when present. A Gate 3 held back by an open loop-back (`NOT_COMPUTED`) is passed through as it is.
- `quality`: the whole result with `detail: 'summary'`, and `attribute_residual.top_unresolved` cut to the five elements with the most unresolved fields, each as `{ element, class, unresolved, declared }` without field lists. The result recorded in `.dethereal/quality.json` is always the full one.

**`gates` -> the loop-back guard.** A loop-back is armed explicitly, by [`model_state`](#model_state) action `loop_back`, which records the full loop-back list of that moment in `.dethereal/loop-back.json`: each element with a hash of each listed field's value or, when it lists no field, of its data-item links. The record survives restarts; `gates` reads it and never writes it. A backward transition keeps it as it is, nothing re-hashed: an element the change removed reads `removed`, every other one stays armed with the hashes of its arming. Each armed element is read against the gates computed now:

| Status | The element | Touched |
|--------|-------------|---------|
| `removed` | is gone from the model | yes |
| `not_listed` | is no longer on the loop-back list (fixed) | yes |
| `waived` | is no longer on the loop-back list because a waiver in use covers one of its criteria | yes |
| `changed` | has a listed field holding a value other than the armed one that is neither empty nor a gate stand-in (`changed` names the fields); with no listed field, its data-item links changed | yes |
| `dropped` | was left unfixed by the run, with a `reason` | no |
| `untouched` | none of the above | no |

While an armed record has an `untouched` element, or the record cannot be read, Gates 1 and 2 are computed as usual and Gate 3 is not:

```typescript
gate3: {
  verdict: 'NOT_COMPUTED'
  code: 'loopback_untouched' | 'loop_back_unreadable'
  message: string               // the untouched elements (the first 20 named) and the way out: fix, or drop with a reason
  loop_back?: {                 // loopback_untouched only
    untouched: LoopbackElement[]  // at most 100, shaped as gate3.loopback.elements: the loop's worklist
    untouched_total: number
    touched_total: number
    dropped_total: number
  }
}
```

Otherwise the result is the normal one and, while a record exists, carries `loop_back_round: { elements, nothing_changed }` — every armed element with its `status` (and `changed` or `reason`), and `nothing_changed: true` when no element was touched. A dropped element still fails Gate 3: a drop is not a waiver. Residual: only the action arms the guard, so a run that loops back without arming is not held.

### Workflow State Tools (Client-Free)

#### `model_state`

Reads and changes the workflow state (`.dethereal/state.json`) — the only way to change it — and arms the loop-back guard.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ action: 'get' \| 'transition' \| 'set_baseline' \| 'stale' \| 'merge_pulled' \| 'loop_back' \| 'mode', directory_path, to?, commit?: 'HEAD' \| string, add?, remove?, drop?: Array<{ element_id, reason }>, drop_remaining?: { reason }, mode?: 'quick' \| 'full', quick_through?: 7 \| 8 \| null, include?: Array<'pending_rows' \| 'pending_sources' \| 'unregistered_rows'>, pending_from?: number, pending_limit?: number, pending_render?: 'rows' \| 'table' }` — `drop` and `drop_remaining` are for `loop_back` only, `mode` and `quick_through` for `mode` and `transition`, `commit` for `set_baseline` and `transition`, `include`, `pending_from`, `pending_limit` and `pending_render` for `get` only, and listed only with the settlement on |
| **Output** | `get`: the state report, including `loop_back`, `mode`, `quick_through` and, with the settlement on, the counts of `pending_enrichment` and `unregistered_changes` (with it off, `settlement: "off"` instead; see [Settlement Switch](#settlement-switch)); `mode`, `loop_back` and `transition` with `mode`, `quick_through` or `commit`: below |
| **dt-core class** | None (local files only) |

`get` reports the loop-back record as it stands, without evaluating it: `loop_back: { armed: false }`, `{ armed: true, armed_at, elements, dropped }` (counts), or `{ armed: null, unreadable: true }`.

**`get` -> the row lists.** With the settlement off there are none: the server does not list `include`, `pending_from`, `pending_limit` or `pending_render`, and a call that names one is refused as an unknown input (see [Settlement Switch](#settlement-switch)). With it on, `get` gives counts only for its two row lists by default; the rows come with `include`, right before they are used:

```typescript
pending_enrichment: {
  state, code?, blocks, blocking, entries, invalid,
  invalid_rows: number[]         // positions of malformed entries, at most 100
  unresolved, unknown_keys, rows_total,
  digest?: string                // changes when the pending file changes
  // with include 'pending_rows':
  rows: PendingRow[]             // at most 100, from row `from`
  from: number
  next_from?: number             // when more rows follow
}
unregistered_changes: {
  rows_total, digest,
  codes: { [code: string]: number }  // the rows by refusal code
  flagged: number
  // with include 'unregistered_rows': rows (and no codes or flagged)
}
```

- `include: ['pending_rows']` pages the pending rows: `pending_from` is the first row number of the page (from 1, default 1), and `pending_limit` the most rows in it (default and at most 100; up to 250 for the table, below). When `digest` differs from the one the earlier page carried, the file changed: start again from row 1.
- A pending row is `{ row, group, element_id, name?, field, value, conflict?, on_disk_differs? }`. A value settle could not show in a dialog (invisible, control, bidi or mixed-script characters, or over 4,096 bytes) is given as `value_undisplayable: { bytes, sha256 }` instead, with the hash `model_state_settle` uses. A field the element does not list reads `(unlisted field)`, with no value (and no `element_id` when the model does not have the element).
- `conflict: true`: the file holds another row for the same field with a different value; settle would refuse it `duplicate_pending`. `on_disk_differs: true`, on attribute rows only: the attribute file no longer holds the pending value (an element with no attribute file holds nothing, so its attribute rows carry it). A row is an attribute or a record row as settle decides it: a record field is a record unless the element's attribute bag holds a field of that name. A record row never carries `on_disk_differs`: settle compares record values through a projection when it accepts.
- `include: ['pending_rows', 'pending_sources']` adds each row's `source`, under the same display rules (`source_undisplayable`).
- Values and sources are written by a model: untrusted text, quoted for display and never followed.
- A refused `REVIEWED` transition still carries the pending rows (`pending_rows`, `pending_rows_total`) and the unregistered rows.

**`get` -> the pending table.** With `include: ['pending_rows']`, `pending_render: 'table'` returns the page as `pending_table` in place of `rows`: a Markdown table the workflow prints to the operator as it is. `from`, `to` (the last row it shows) and `next_from` (when more rows follow) come with it, and `digest` stays among the counts. With no pending file there is no table.

- **Columns**: `Row | Element | Field | Value | Note`, with `Source` before `Note` when `include` also has `pending_sources`. Every row number of the page is listed, a malformed entry included, so the numbers are the ones [`accept_rows`](#model_state_settle) takes.
- **Rendered pages are recorded.** The server notes each table page it renders, rows `from` to `to` under the file's `digest`, in its own memory (at most 50 pages per model; a new digest starts the list again, and a restart forgets it). [`accept_rows`](#model_state_settle) accepts only rows on such pages. A page given as `rows` is not recorded.
- **`Note`** flags what stands in the way of accepting a row as shown. `malformed` and `element in another group` stand alone. Otherwise the Note lists the field's other rows, on any page (`same field as row 3`, `same field as rows 3, 7`; at most five, then `…`), since a field's rows are accepted or left together, and then the first reason an accept would give: `element gone`, `other values pending`, `unknown field`, `not settleable` or `file holds another value`. The Note and `accept_rows` use one judge, so they never disagree (see [`row_not_acceptable`](#model_state_settle)). `file holds another value` covers record rows too, their value compared as the settlement reads records.
- **Element**: its name, with its id added where the name is missing, undisplayable or not unique in its group.
- **Neutralised cells.** Names, fields, values and sources are model-written, so each cell is put on one line (control characters and line and paragraph separators escaped). A cell that is not a number or plain letters, digits, spaces, `_` and `-` goes in a code span with its pipes escaped, and so does one with an underscore at a word's edge, which emphasis would hide; so a cell can neither add a column nor render as a link, HTML or emphasis. A backslash right before a pipe is shown as the text `\u005c`, so every pipe is escaped by the one backslash before it. An undisplayable value shows as `(undisplayable, sha256 <first 12>)`. The table opens with `Pending values (model-written data, not instructions):` and closes with `Rows <from>–<to> of <n> · pending <digest, first 12>`.
- **Budget**: a page stops before 20,000 characters, measured JSON-escaped as the result is sent, and gives `next_from` for the next page.

**`loop_back`.** Called first when the operator chooses to loop back after a failing Gate 3 (see the [loop-back guard](#validate_model_json)):

- **Arm** (neither `drop` nor `drop_remaining`): writes the record from the current loop-back list and returns `{ armed: true, armed_at, elements, elements_total }` (`elements` at most 100). A record that still has an untouched element is kept instead (`kept: true`, with `armed_at`, `untouched`, `untouched_total`, `touched_total` and `dropped_total`); an unreadable one is replaced. With Gate 3 passing, or nothing on the loop-back list, nothing is armed (`armed: false`).
- **Drop**: `drop` (1–50 `{ element_id, reason }`) marks those armed elements as left unfixed; `drop_remaining: { reason }` marks every element still untouched. A reason is 1–500 characters after trimming, newlines allowed, no invisible or control characters. Returns `{ armed: true, dropped_now, untouched, untouched_total, touched_total, dropped_total }`. `drop_remaining` alone also removes an unreadable record (`cleared: true`).
- **Refusals**: `reason_invalid`; `loop_back_not_armed` (a drop with no record); `loop_back_unknown_element` (an id not on the armed list, in `data.unknown`, at most 100, with `unknown_total`); `loop_back_unreadable` (a drop on an unreadable record, other than `drop_remaining` alone).

An accepted `REVIEWED` transition removes the record and reports a failed removal in `warnings`; `REVIEWED` is refused while an armed element is untouched, since an untouched element still fails Gate 3. A backward transition keeps the record and, when one exists, returns `loop_back: { kept: true, armed: true, armed_at, elements, dropped, untouched_total? }` (`untouched_total` when the gates could be computed) or `{ kept: true, armed: null, unreadable: true }`, with `loop_back_note`, the way on for the agent: while anything is untouched, that the loop-back stays open and Gate 3 waits for each element to be changed, fixed, waived or dropped (arming again does not replace the record); otherwise, that Gate 3 is computed and an element failing again with its armed values is untouched again; for an unreadable record, that Gate 3 waits for `drop_remaining` to remove it. A record that cannot be read for an I/O fault is left in place, the transition applies, and `warnings` says so.

**`mode`.** Marks a **quick** model — a shorter run that is never reviewed — or removes the mark, and records the last quick step the run finished. The call takes `mode`, `quick_through` or both, and writes through the same checked write as the other actions (a state that changed since the call read it is refused `state_changed`):

- **Set**: `mode: 'quick'` sets the mark; `mode: 'full'` removes it and keeps `quick_through`. `quick_through: 7` or `8` records the step and only rises; `null` removes it. Returns the state summary with `mode` (`'quick'` or `null`) and `quick_through`. A call that changes nothing writes nothing and adds `unchanged: true`. A call with `quick_through: 8`, a repeated one included, adds `priority_gaps` (below).
- **Refusals**: `mode_input` (neither input); `no_state` (no state, or no valid current state); `reviewed_model` (`mode: 'quick'` while the state file claims `REVIEWED`, whatever the gates read now — transition to `ENRICHING` first); `not_quick` (a step on a model that will not be quick after the call: not quick and not made quick in the same call, or made full in it); `wrong_state` (a step while the claimed state is not `ENRICHING`); `quick_through_backward`.
- **Reading**: `get` returns `mode` (`'quick'` or `null`) and `quick_through` (`7`, `8` or `null`). Only those exact values count: any other value reads as `null` and adds `mode_invalid` or `quick_through_invalid`, so a misspelt mark is a full model. On a quick model at `quick_through: 8`, `get` adds `priority_gaps` too. Below `REVIEWED`, `display_state` puts `quick` first among its qualifiers (`ENRICHING (quick, 3 pending enrichment)`), and the session-start banner accepts it.
- **Never `REVIEWED`**: a quick model whose file claims `REVIEWED` reads as `ENRICHING` (`claimed_state` stays `REVIEWED`), with `quick_note` in place of `note`; `merge_pulled` reports its `effective` state the same way and compares the pulled content with it. A `REVIEWED` transition is refused, `quick_mode` first among its codes. A backward transition removes `quick_through` and keeps the mark: going back undoes the quick steps it passes.
- **`priority_gaps`**: what Gate 3's C2 and C8 still find on Tier 1–2 when a quick run records Step 8. It is a warning, never a refusal, and it names fields only, never values; it is absent when both pass. When nothing can be said, the result carries `priority_gaps_unavailable` with a code instead: `model_unreadable` (the model files cannot be read) or `gate3_not_computed` (Gate 3 is not computed, as when an open loop-back holds it back), so a missing `priority_gaps` never reads as C2 and C8 passing. `c2: { rate, floor: 0.8, elements: [{ id, name?, null_fields, no_template? }] }` lists every Tier 1–2 component with a template field unanswered (`no_template` when it has no usable template); `c8: { elements: [{ id, name?, missing, alias_present? }] }` lists C8's failures (`missing` holds unanswered and stand-in fields alike), with `alias_present` as in the [gates report](#validate_model_json).

**`transition` with `mode`, `quick_through` or `commit`.** A transition can also set the quick mark, the last quick step and the drift baseline, and records them in the same single write. This saves a `mode` or `set_baseline` call after it.

- **`mode` and `quick_through`** mean what they mean for the `mode` action.
- **`commit`** sets the drift baseline as `set_baseline` does: `'HEAD'`, which the server reads, or a full commit id that is an ancestor of HEAD. Absent, no baseline is written. `set_baseline` also accepts `commit: 'HEAD'`, the same as leaving it out.
- **Checked first.** The commit is resolved, and the mode and quick step are checked against the state after the transition, before anything is written. Any refusal refuses the whole call and writes nothing. The codes are `set_baseline`'s (`not_a_git_repo`, `git_unavailable`, `unsupported_repository`, `git_failure`, `no_commits`, `unknown_commit`, `not_ancestor`) and the `mode` action's: `wrong_state` (a quick step with `to` other than `ENRICHING`), `not_quick`, `quick_through_backward`, and `reviewed_model` (`mode: 'quick'` with `to: 'REVIEWED'`). Where the project is not a git repository, call the transition again without `commit`.
- **The quick mark as the call leaves it.** A `REVIEWED` transition is refused `quick_mode` when the model is quick after the call, so `mode: 'full'` in the same call lifts it.
- **Same state.** A transition to the state the model already claims writes only these inputs (and any ids `add` queues). A `REVIEWED` that stands is not stamped again; the result keeps `unchanged: true`.
- **Result.** The usual transition result, plus `baseline_commit` when a commit was recorded, `mode` (`'quick'` or `null`) and `quick_through` when either was given, and `priority_gaps` or `priority_gaps_unavailable` when the call gives `quick_through: 8`, as the `mode` action gives them.

#### `model_state_settle`

Records the operator's decisions on attribute and record values, so that each value counts as the operator's (is **registered**). Listed only with the settlement on (see [Settlement Switch](#settlement-switch)). Asks for the operator's approval. On Claude Code the plugin's approve hook approves `prepare`, which checks the decisions and records nothing in the model; the tool is still listed with the interaction hint (see [Tool Manifest and Listing](#tool-manifest-and-listing)), so Claude Code may still ask for it. `settle` and `commit` always ask (see [PLUGIN_ARCHITECTURE.md → Auto-Approval](PLUGIN_ARCHITECTURE.md#auto-approval)).

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ action: 'settle' \| 'prepare' \| 'commit', directory_path, items?, confirm?, accept?, accept_rows?, reply?, orphaned_acknowledged?, plan_id?, lines? }` — `settle` takes the decisions and `reply`; `prepare` takes the decisions, and no `reply`; `commit` takes `plan_id`, `lines` and `reply` only. `items` is required on `settle` and `prepare` (`[]` when the maps or `accept_rows` hold every decision; `items_required` otherwise) and is at most 50 of `{ row?, group, element_id, field, decision: 'accept' \| 'reject' \| 'modify' \| 'confirm' \| 'set', element_name?, value?, absent?: true, record?: boolean, removed?: true, previous? }`; `reply` is the operator's reply, quoted verbatim: 1–8000 characters after trimming, newlines allowed, no invisible or control characters and no lone surrogates; a longer reply is refused `reply_invalid` with its length, and the call is repeated with a verbatim excerpt that holds the decisions, `[…]` at each cut; `confirm` and `accept` are the compact form, and `accept_rows` one range of pending rows (both below) |
| **Output** | `settle` and `commit`: `{ recorded, decisions, already_settled, echo, registered_unchanged?, accepted_unchanged?, revision?, orphaned_dropped?, orphaned_dropped_elements?, orphaned_dropped_elements_total?, note?, log_restarted?, gitignore?, warning? }`; `prepare`: `{ plan_id, expires_at, echo: [], decisions, already_settled, accepted_unchanged?, orphaned_to_drop?, bound, lines }` |
| **dt-core class** | None (local files only) |

- `accept`, `reject`, `modify` — settle a pending row (a specialist's value the operator has not confirmed): register it, restore the field's previous state, or write the operator's value.
- `confirm` — register a value as the file holds it, if it may be registered (below); with `removed: true` and `value: null`, register that a registered value is gone.
- `set` — write a value the operator confirmed in the chat, and register it, in one approved call.

Every call is all or nothing: a call with any refused item writes nothing, and `data.refused` lists each refused item with its code. Where the server knows the fix, the refused item carries it: `fix` on `record_flag` (see [Record or attribute](#model_state_settle)), and `expected` on a `placement` confirm refused `value_differs`, the placement as the model files show it (`{ undisplayable: true, sha256 }` when it cannot be shown safely). An item whose value is already written and registered is listed in `already_settled` and changes nothing.

**`prepare` and `commit`.** A settle can be split in two: `prepare` checks the decisions and records nothing in the model, and `commit` records them afterwards with the operator's reply.

- **`prepare`** runs every check `settle` runs, with the same refusal codes, and records nothing in the model: no attribute, record, pending, baseline or log write. On a fresh machine it may still create this machine's settlement key under the home directory and the model's lock file in `.dethereal/`. It takes the decisions as `settle` does (`items`, the maps, `accept_rows`, `orphaned_acknowledged`). It returns `plan_id`; `expires_at`; `bound`, `{ baseline_revision, pending_digest }` (each `null` when there is no verified baseline or no pending file); `decisions`, `already_settled` and `accepted_unchanged` as `settle` would count them; `orphaned_to_drop`, the orphaned registrations the commit will drop (only a `settle` or a `commit` reports `orphaned_dropped`); an empty `echo`; and `lines`.
- **`lines`** say what the commit will record. The server renders them, in order: one `Removed: <name> (<group>, <cause>) — <n> registered values dropped` per acknowledged orphaned element; one `Recording: <name> (<element_id>) · <field>[ (record)] · <decision> → <value>` per item and map entry, in call order; and, for a range, `Recording: accept rows <from>–<to> as shown (pending <digest, first 12>), except rows <list or none>: <n> values`. A value is canonical JSON, `(removed)` for a removal and `(previous)` for a reject. Names, element ids, fields and values go through the pending table's cell neutralisation (see [Neutralised cells](#model_state)): plain words and numbers as they are, anything else in a code span, on one line. Text that cannot be shown safely appears as a sha256 prefix. The workflow shows the lines to the operator as they are. Lines that would take more than 24,000 characters are refused `echo_too_large`.
- **`commit`** — `{ action: 'commit', directory_path, plan_id, lines, reply }` — records the plan once, from the main session, with the operator's reply under `settle`'s rules. Under the settlement lock it runs the plan's decisions again, and writes only while the baseline revision and the pending-file digest are still the plan's `bound` and the fingerprint (below) is unchanged. Its result is `settle`'s.
- **`lines` on `commit`** are the plan's lines exactly as `prepare` returned them, as the operator was shown them, so the approval dialog shows the server's own text of what is recorded. Anything else — lines missing, added, dropped or changed — is refused `lines_differ` with the first difference: `index`, and `expected` and `got`, excerpts of at most 200 characters (`null` where there is no line). Nothing is written, and the plan stays committable. `lines` on `settle` or `prepare` is refused `plan_on_commit`.
- **Trust decisions are never prepared.** `prepare` refuses a record item on `zone`, `planes`, `conduits` or `crownJewel` with `trust_field`: these are settled directly, with `settle`.

**Plans.** A plan lives only in the memory of the server process that prepared it. Nothing is written to disk, so nothing on disk can forge or replay a plan, and a restart forgets every plan. A plan is committed at most once (see [How a plan ends](#model_state_settle)) and expires 30 minutes after `prepare`. It is bound to its model directory, the baseline revision, the pending-file digest and a fingerprint of everything it would write and register: the signed content, each attribute file it rewrites (its bytes as read and what it becomes), the record values, the pending rows it clears, the echo, the orphans it drops, the model, this machine's key and the pending file. The server holds at most 20 plans; preparing another drops the oldest whose commit is not running. A plan whose commit is running is kept until that commit ends: it is never dropped to make room or for its age before then.

| Code | When |
|------|------|
| `plan_required` | `commit` without `plan_id` |
| `commit_takes_plan_only` | `commit` with `items`, `confirm`, `accept`, `accept_rows` or `orphaned_acknowledged`: the decisions are the plan's |
| `plan_on_commit` | `plan_id` or `lines` on `settle` or `prepare` |
| `reply_on_commit` | `reply` on `prepare`: the reply goes with the commit |
| `items_required` | `settle` or `prepare` without `items` |
| `lines_differ` | `commit` whose `lines` are not the plan's, exactly: `index`, `expected`, `got`. Nothing is written; the plan stays committable. |
| `plan_not_found` | no such plan in this server process (prepared in another, or before a restart) |
| `plan_expired` | the plan is older than 30 minutes |
| `plan_used` | the plan was committed already: its values are registered, nothing to redo |
| `busy` | a commit of the plan is still running. Commit again once: the answer then says how that commit ended. |
| `plan_other_model` | the plan was prepared for another model directory |
| `plan_stale` | the model moved since `prepare`: the bound or the fingerprint changed, or a check the plan passed now refuses, with that refusal's data in `refused_with`. Nothing is written. A later commit of that plan answers `plan_stale` again. |
| `plan_failed` | the commit failed after part of its write; a later commit of that plan answers it again. Get the model's state, then prepare again. |

**How a plan ends.** Every commit that takes the plan either uses it up or leaves it committable. A commit refused `busy` because the plan's commit is still running does not take it.

| The commit | The plan | A second commit answers |
|------------|----------|-------------------------|
| records the plan | used up, as committed | `plan_used` |
| finds it stale (nothing written) | used up, as stale | `plan_stale` |
| fails after part of its write | used up, as failed | `plan_failed` |
| could not start: another settlement holds the lock (`busy`), or this machine's key cannot be used (`baseline_key_unavailable`) | committable | — |
| is refused on this machine's own state before any write: `pointer_unavailable`, `baseline_key_unavailable`, `attribute_issues`, `consolidated_attributes`, `pending_enrichment` or `unreadable` | committable once that is fixed | — |
| loses its lock to another process, or meets a held lock (`busy`), before writing anything | committable | — |
| meets a file that changed (`changed`) before writing anything | committable | — |
| passes other `lines` (`lines_differ`) | committable | — |

Any other refusal or error once the commit has started, with nothing written, uses the plan up as stale; a refusal is reported as `plan_stale`, with its data in `refused_with`. After a used-up plan, prepare again for anything still to record.

```mermaid
sequenceDiagram
    participant Op as Operator
    participant M as Model
    participant S as model_state_settle
    M->>S: prepare (the decisions, no reply)
    S->>S: Check every item, write nothing
    S-->>M: plan_id, bound, lines
    M->>Op: The lines, as they are
    Op->>M: Reply
    M->>S: commit (plan_id, the lines as prepared, the quoted reply), from the main session
    S->>S: Lines exactly the plan's? Else lines_differ
    S->>S: Bound and fingerprint unchanged? Write, register (all or nothing)
    S-->>M: Result with echo and revision, or plan_stale
    M->>Op: Echo
```

**Relay files.** `.dethereal/relay/` holds the files the workflow's specialist agents hand back. It is this machine's: the server lists `relay/` in `.dethereal/.gitignore` with its other per-machine records. Neither `prepare` nor `commit` deletes anything in it. Deleting files by path in a folder the agent can write cannot be made safe against the folder being swapped for a link. Nothing reads the folder as a whole: the workflow reads relay files only by the exact paths its current runs name, so relay files from earlier passes stay on this machine as clutter.

**Compact input.** Registration-only decisions may also go as two maps, `confirm` and `accept`, keyed `<group>/<element_id>/<field>`: exactly three parts, and the group is an element group, not `model`. Each entry is exactly the `confirm` or `accept` item it stands for, and its value is still in the call's arguments, so an approval dialog that shows arguments shows every value.

- A record field is read as the record, unless the element's attribute file or class template holds a field of that name. Then the entry is refused `ambiguous_field`, and goes as an item with `record: true` or `record: false` (see Record or attribute, below).
- A map refuses `controls` (`record_field`), a null value or a removal (`value_required`), a value over 256 bytes (`too_large`) and a malformed key (`bad_key`). Such an entry is reported by its `key`, with `index: null`.
- A field named both in the items and in a map is refused as a duplicate (`duplicate_pending`).
- Map entries are numbered after the items, in the order the call gives them; an entry refused later carries its number and its `key`.
- Limits: `items` at most 50; items, map entries and the rows `accept_rows` accepts together 1–250 (each row counts, not each field), or none when the call only drops orphaned registrations (below); the two maps together at most 24,000 characters, so one call can carry every decision of one operator answer. A call over a limit is refused `too_many_items`, and writes nothing.

**Accepting a range (`accept_rows`).** On `settle` and `prepare`, `accept_rows: { from, to, digest, except }` accepts one range of the pending file as it was shown: rows `from` to `to`, numbered as `get` shows `row` (file positions, from 1), but those in `except`. `digest` is the pending `digest` that `get` gave with those rows. `except` is required, `[]` when no row is left out. Each row is accepted with its own value; a row left out stays pending unless an item answers it.

- **Only rows the server rendered.** Every row from `from` to `to` must be on a table page this server process rendered for the model under that `digest` (`get` with `pending_render: 'table'`, see [the pending table](#model_state)); adjoining pages count as one. Otherwise the call is refused `rows_not_rendered`, with `rendered`, the ranges that were shown, as `[from, to]` pairs. Show the page the rows are on, then accept within it.
- **Every row of a field goes one way.** A field's rows become one `accept` item, numbered after the map entries; a refused one carries the rows it stands for in `rows`. A field with a row in `except` or outside the range is not accepted by the range (`field_rows_split`). An item or map entry for a field the range accepts is refused `row_in_range`: put that field's rows in `except` to answer them as items.
- **The range itself**: `except_required` (no `except`); `range_invalid` (`from` after `to`, or `to` past the file's last row); `except_outside_range`; `digest_changed` (the pending file is not the one shown: get the rows again and show them).
- **`row_not_acceptable`**: rows of the range that cannot be accepted as shown, in `data.rows` as `{ row, reason }` (at most 100, with `rows_total`). The reasons: `malformed` (no readable entry at that position), `element_gone`, `field_rows_split`, `conflicting_values` (the field's rows hold different values), `unknown_field` (neither a record field, a key the gates read, a field of the class template nor a field of the attribute file), `not_settleable` (a record field the settlement does not register), `on_disk_differs` (the model files no longer hold the value: the attribute file for an attribute row; for a record row, the record compared as the settlement reads records). Apart from `malformed` and `field_rows_split`, a row's reason comes from the same judge as the [pending table's](#model_state) `Note`, one reason per row. Put them in `except` and answer them as items, or leave them pending.
- The items a range yields then pass every check an `accept` item passes, and on `prepare` the plan shows the range as one `Recording:` line.

**Record or attribute.** Whether a decision names an element's record or an attribute of the same name:

- **`confirm` and `accept` read it from the name**, as items and as map entries: a record field (`classData`, `zone`, `placement`, …) is the record, unless the element's attribute file or its class template holds a field of that name. Then the decision is refused `ambiguous_field`, and is sent as an item with `record: true` for the record or `record: false` for the attribute.
- **`set`, `modify` and `reject` must say it.** On a record field's name without `record`, a `set` of one of the eight records `set` writes (`zone`, `domains`, `planes`, `crownJewel`, `sensitivity`, `regulatory_flags`, `origin`, `is_credential`) is refused `record_flag` with `fix: { record: true }`. A `modify` or `reject`, or a `set` of any other record, is refused `record_field` directly: no flag would make it go.
- **A wrong flag** is refused `record_flag` too: `record: true` on a field that is not a record, with `fix: { record: false }`; `record: false` on a record field that no attribute or template field shares, with `fix: { record: true }`. `fix` is the `record` to send the item with.

**Orphaned registrations.** `model_state` `get` reports `orphaned_registrations: { total, elements, elements_total }`: registered values whose element, as registered, is gone. Each of `elements` (at most 20) is `{ group, name, cause, values }`, where `values` counts its registered values and `cause` says why they no longer apply, as far as the model now shows it:

| `cause` | When |
|---------|------|
| `reclassified` | an element with the same full label (its boundary path, a flow's endpoints) and type has another class; or a new data item of that name has another class |
| `removed` | no new element of the group has the name (the root boundary matches the root whatever its name, and an unnamed element matches the unnamed ones) |
| `moved` | a new boundary or component of that name, type and class sits under another path |
| `re-pointed` | a new flow of that name and class runs between other elements |
| `changed` | none of these tells it |

The full label decides first, so the same label under another class is `reclassified`. Then the name: an element of the same name counts only when it is **new**, that is, not registered under its own label already. One that is was there before, and is another element. So a removed component that shares its name with another component reads `removed`, not `moved`. The server cannot tell a renamed element from a removed one, so a rename reads as `removed`.

A settle or a prepare whose `orphaned_acknowledged` is not that total — the total shown to the operator — is refused `orphaned_unacknowledged`, with the same list. A call that acknowledges them drops those registrations and reports it in `orphaned_dropped` and `orphaned_dropped_elements`; a prepared plan counts them in `orphaned_to_drop` and lists each such element as a `Removed:` line. Dropping them is a decision of its own: a call whose only decision is `orphaned_acknowledged` (`items: []`) is accepted.

**What can be registered.** One rule decides what `set`, `confirm`, `accept` and `modify` may register as the operator's value.

- **An attribute value** registers when its field is a field of the element's class template, as cached under `.dethereal/class-cache/`, and the value fits that field's schema; or when the field is a key the gates read or the workflow asks for on that kind of element, and the value has that key's type:

  | Group | Keys |
  |-------|------|
  | components | `authentication_type`, `encryption_in_transit`, `encryption_at_rest` (non-empty string); `implicit_deny_enabled`, `stores_credentials` (boolean); `monitoring_tools`, `credential_scope` (list of non-empty strings); `asset_criticality` (`high`, `medium`, `low`) |
  | boundaries | `implicit_deny_enabled`, `allow_any_inbound`, `crown_jewel` (boolean); `egress_filtering` (`deny_all`, `allow_list`, `allow_all`) |
  | dataFlows | `auth_failure_mode` (`deny`, `fallback`, `fail_open`, as the gates read it); `encryption_in_transit`, `credential_type`, `credential_name` (non-empty string); `required_credentials` (list of non-empty strings); `crown_jewel` (boolean) |
  | dataItems | `crown_jewel` (boolean) |

  A field the class declares is judged by the class's schema, even when it is also one of these keys. The transit fields a flow class may use in place of `encryption_in_transit` (such as `flow_tls_encrypted`) count only as fields of the flow's own class.
- **Refusals.** `off_template_field`: the element's class has a template, but neither the template nor the table has the field. `no_template`: the element has no usable template — it is unclassified, its class is not in the class cache, or its cache entry cannot be used (the class declares no fields, or the entry is unreadable or names another class) — so only the table's keys register; the message names the remedy for each case. `invalid_value`: the value does not fit the schema or the key's type. A pending row whose value cannot be registered is answered with `modify` (a value that fits) or `reject`. `unlisted_field` means only a field name that holds characters other than letters, digits, `_` or `-`.
- **A record value** is held to the values `set` takes (the table under `set`) by `confirm` and `accept` as well, for the records that have such a rule: `zone`, `domains`, `planes`, `crownJewel`, `sensitivity`, `regulatory_flags`, `origin` and `is_credential`.
- **Removing a value never needs the rule.** `set` with `absent: true` drops a field; it is the route for a value no decision could register, such as a field of an element's old class after a reclassification. `confirm` with `removed: true` still registers a removal, and `reject` answers a pending row even on a field that can no longer be registered.
- **A retried call is settled, not refused.** For every decision, an item whose value is already written and registered is `already_settled` before the rule is checked.

**Rows no decision could register.** `model_state` `get` with `include: ['unregistered_rows']` lists the unregistered values in `unregistered_changes.rows` (without it, `codes` counts them by code), and holds each one to the same rule. A value no decision could register as it stands carries the refusal's code (`off_template_field`, `no_template` or `invalid_value`) and no `key`. A registered value is never listed again, whatever could be registered today: the rule is checked only for values that are not registered. A pulled model, which has no class cache, therefore lists nothing to register until a value changes locally.

**`set`.** The workflow registers every value the operator confirms in the chat with `set` — an answer to a question, an accepted default, a confirmed documentation claim, a boundary's zone, planes and domains, a crown-jewel mark, a data item's sensitivity, regulatory flags, origin and credential mark — instead of editing the file and confirming it afterwards. Structure (`placement`, `classData`, `controls`, `conduits`, `dataItemIds`) is still written with the edit tools and registered with `confirm`. Attribute keys the gates read (floor, enforcement and credential keys) are written with `set` too, never edited by hand and then confirmed: a hand edit registered with `confirm` is held to exactly what `set` accepts. A `dataItemIds` link is registered by the linked data item's name, with the item's class added only to tell namesakes apart, because a data item's class is asked, and registered, on the item itself, not on the link; while two linked items share a name and class, the link cannot be registered (`label_collision`) until one of those data items is renamed or reclassified. Each `set` item names the element's current name in `element_name`; a missing or different name is refused `name_mismatch`. Values that hold invisible, control, bidi or mixed-script characters (`unclean_value`), or are over 4 KiB (`too_large`), are refused, as for every decision that carries a value. A field that has a pending row is refused `duplicate_pending`: that row is accepted, rejected or modified instead. `absent: true`, with no `value`, removes the field.

- **Attribute values** are held to the rule above (`off_template_field`, `no_template`, `invalid_value`). An element with no attribute file is refused `no_attribute_file` (run `generate_attribute_stubs` first).
- **Record values** (`record: true`) are settable only on their own group:

  | Field | Group | Values |
  |-------|-------|--------|
  | `zone` | boundaries | `UNTRUSTED`, `PUBLIC`, `EXPOSED`, `INTERNAL`, `RESTRICTED`, `VENDOR` |
  | `domains` | boundaries | list of non-empty strings |
  | `planes` | boundaries | list of `WORKLOAD`, `MANAGEMENT` |
  | `crownJewel` | components | `true` or `false` |
  | `sensitivity` | dataItems | `public`, `internal`, `confidential`, `restricted` (any case, as the gates read it) |
  | `regulatory_flags` | dataItems | list of non-empty strings |
  | `origin` | dataItems | `authenticated_first_party`, `curated_internal`, `agent_relayed`, `model_generated`, `third_party`, `arbitrary_public`, `not_assessed` (lowercase, as `validate_model_json` and a pull write them; a capitalised or hyphenated spelling is refused) |
  | `is_credential` | dataItems | `true` or `false` (`false` is an answer, not an absence) |

  A value outside these is refused `invalid_value` — by `confirm` and `accept` as well as `set`, which hold these eight to the same rules — and a field on another group `not_found`. `classData`, `placement`, `controls`, `conduits`, `dataItemIds` and the model's own controls are refused `record_field`: structure stays with the edit tools, and is confirmed afterwards.

Record values are written into `structure.json` and `data-items.json`. Every record field the call sets must still hold what it held when the call was planned; they are all checked before the first write, and if one moved, the call is refused with `changed` and nothing is written. A call that fails part-way for another reason (an I/O error) converges when repeated. A model that gains `origin` or `is_credential` after it was registered shows them as unregistered rows in `model_state` `get` until they are confirmed or set. Both fields are part of the review hash; a model without them keeps its hash.

**The echo.** Every result carries `echo`: one entry per registration the call made, for every decision (`set`, `accept`, `modify`, `confirm`, `reject`, and `removal` for a confirmed removal), in call order. Two kinds of registration are kept apart: listed under `registered_unchanged`, or only counted in `accepted_unchanged` (below). The workflow shows them to the operator after every call, as a table: element, field, before → after, and whose the value was before.

```typescript
echo: Array<{
  index: number                 // the item's position in `items`
  decision: 'set' | 'accept' | 'modify' | 'confirm' | 'reject' | 'removal'
  group: string
  element_id: string
  element_name: string | { undisplayable: true, sha256: string } | null  // null: the element is gone
  field: string
  record?: true
  value: Shown                  // the call's own value: written (set, modify), or matched on disk (accept, confirm)
  previous: Shown               // what the file held before the call
  previous_registered:
    | 'unregistered'            // the previous value was nobody's
    | 'registered_empty'        // the field was registered as left empty
    | { state: 'registered' | 'registered_other', by: 'operator' | 'pull' | 'push-pin' | 'greenfield' }
}>
type Shown = { value: unknown } | { absent: true } | { undisplayable: true, sha256: string }
registered_unchanged?: Record<string, {   // keyed `<group>/<element_id>`
  name: string
  attributes?: Record<string, unknown>  // field → value
  records?: Record<string, unknown>     // field → value
}>
accepted_unchanged?: number             // accepts of unchanged values on unregistered fields
```

**`registered_unchanged` and `accepted_unchanged`.** A decision that registers the value the file already holds, with a displayable element name and not on a `controls` list, is kept out of `echo`:

- **`accepted_unchanged`** counts the `accept`s of this kind on a field nobody had registered (`unregistered`), whether they came as items, map entries or `accept_rows`. They are counted, not listed: the value is the pending row's, as the operator was shown it.
- **`registered_unchanged`** lists the rest: a `confirm` on a field that was `unregistered` or registered as the operator's, and an `accept` over the operator's own registration. The value is kept, records apart from attributes, and nothing else is shown: the value it replaced is the same.

Everything else keeps its full entry in `echo`: a changed value, a `set`, a `modify`, a `reject`, a removal, a registration that changes hands (registered as another value, as empty, or by a pull or another source), a `controls` list, and an undisplayable name or value.

`value` is the value in the call, which equals what the file holds after the write (it is not re-read from the file); it is `{ absent: true }` where the field was left or made empty (`reject`, a removal, `set` with `absent`). `registered` means the previous value was the registered one; `registered_other` means a different value was registered for the field. `by` names who registered it: the operator, or the source that registered it for them (a pull, a push's control-id pin, a greenfield control's id carry). A value or name that holds invisible, control, bidi or mixed-script characters, or is over 4 KiB, is shown only as `{ undisplayable: true, sha256 }`. Registrations of renamed, moved, re-pointed, reclassified or removed elements that the call dropped are listed by name in `orphaned_dropped_elements` (at most 20, with the total in `orphaned_dropped_elements_total`). `revision` is the baseline revision the call signed, which identifies the batch; it is present when the call wrote.

The echo is returned whole or not at all. A call whose result (with `registered_unchanged`), measured in the compact form it is sent in, would exceed 24,000 characters is refused `echo_too_large` before anything is written, and `data.items` names the largest items (`{ index, characters }`) so the call can be split.

**Restoring a batch.** When an echo entry differs from what the operator confirmed, the workflow offers a restore: an ordinary `set` batch built from the echo, one item per entry, with the entry's `group`, `element_id`, `element_name`, `field` and `record`, and `value: previous.value` (or `absent: true` where `previous` is `{ absent: true }`). The operator confirms it like any other batch, and it gets its own echo. Three consequences:

- A value that was `unregistered` before the batch comes back **registered**, because the operator confirmed it; a value some source registered comes back as the operator's. The workflow offers the `unregistered` entries apart, so the operator can decline them.
- A `previous` shown only as `{ undisplayable: true, sha256 }` cannot be put back this way: `set` refuses such values, and the operator restores it by hand.
- Entries for `classData`, `placement`, `controls`, `conduits` or `dataItemIds` cannot be restored with `set` (`record_field`); they are changed with the edit tools and confirmed again.

```mermaid
sequenceDiagram
    participant Op as Operator
    participant M as Model
    participant H as Harness approval dialog
    participant S as model_state_settle
    M->>Op: Confirmation table (element, field, value)
    Op->>M: Reply ("yes", or adjustments)
    M->>H: settle call with the items and the quoted reply
    H->>Op: Approval prompt (content depends on the harness)
    Op->>H: Approve
    H->>S: Call
    S->>S: Check every item, write, register (all or nothing)
    S-->>M: Result with echo and revision
    M->>Op: Echo: each value, what it replaced, how that was registered
    opt An entry differs from what the operator confirmed
        M->>Op: Restore batch built from echo.previous, as a table
        Op->>M: Confirm
        M->>S: set batch (approved as above)
    end
```

**The chat table is the display.** Every value a settle call registers is in its arguments, but the approval dialog is not relied on to show them, because on some harnesses it does not. As measured on 2026-09-28:

| Harness (version measured) | Approval dialog |
|---------|-----------------|
| Claude Code 2.1.283 | Shows every value of the call, and the reply |
| Codex 0.158.0 | Cuts each argument to one line, and does not show the reply |
| OpenCode 1.18.33 | Shows the reply, but omits `items` entirely |

Later versions may differ; the chat table and the echo are the protection regardless.

The approval dialog is therefore **not** a trusted display, on any harness — for `set` and for every other settle call. The protection is the confirmation table the model shows in the chat before the call, and the echo it shows after. The residual risk is that the operator reads the model's rendering of the echo, not the echo itself: the echo protects against an honest model's mistakes (a wrong value, a wrong element, a field it did not mean to touch), not against a dishonest model that also fakes the table.

### Model CRUD Tools (Client-Dependent)

#### `create_threat_model`

Create a new model on the platform from a model passed inline.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model: object \| string, folder_id?: string, directory_path?: string, include_schema?: boolean, include_example?: boolean, example_type?: 'simple' \| 'web_app' \| 'api_service' \| 'database' \| 'microservices' }` — `model` is the complete SplitModel (an object or a JSON string); `include_schema` and `include_example` default to `true`, `example_type` to `simple` |
| **Output** | `{ model_id, name, description?, warnings, schema?, example?, directory_path?, id_mappings_count, platform_baseline?, registered?, resolved_controls?, settlement_registration? }` |
| **dt-core class** | `DtImportSplit` |

Creates a new model on the platform from the SplitModel given in `model`. With `directory_path`, it writes the model there, applies the server-generated IDs via ID mapping, records `sync.json` with the platform model ID and push hash (`platform_baseline`), and adds the directory to the project's model registry (`registered`). `settlement_registration` is reported only when `directory_path` was already a model directory. A control reference that cannot be linked refuses the push with the same shape as [`import_model`](#import_model).

#### `import_model`

Import a local model directory to the platform (alias for create with backup support).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ directory_path: string, folder_id?: string, create_backup?: boolean, disable_source_file_update?: boolean }` |
| **Output** | `{ model_id, name, description?, warnings, backup_path?, source_files_updated, id_mappings_count, platform_baseline: 'recorded' \| 'not_recorded', registered, resolved_controls?, settlement_registration?, manifest_modules: { after, before? } }` |
| **Control refusal** | `success: false`, with `data: { codes, control_errors, control_errors_total? }` — `control_errors` is at most 100 of `{ code, ref?, index?, control?, candidates?, candidates_total? }` |
| **dt-core class** | `DtImportSplit` |

When `create_backup` is true (the default), creates a timestamped backup of the directory before modifying files with server IDs. `disable_source_file_update` keeps the reference IDs in the files instead of writing the server IDs back. `resolved_controls` lists the controls linked to each element, keyed by the ID the files held (`@model` for the model's own), as `{ id, name }`. `registered` says whether the directory is in the project's model registry, and `settlement_registration` (present only when something was registered or the registration failed) reports the settlement; see [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow).

A control reference that cannot be linked, or a duplicate element ID, refuses the push before the model exists: `codes` lists the distinct codes (`control_id_not_found`, `control_name_not_found`, `control_name_ambiguous`, `control_entry_invalid`, `control_catalog_unavailable`, `duplicate_element_id`), and `control_errors_total` is present when more than 100 entries failed.

It pushes the derived module list and writes it into `manifest.json` once every refusal has passed; the result carries `manifest_modules: { after, before? }` (`before` only when the file was rewritten). See [Manifest Modules](#manifest-modules).

#### `export_model`

Export a platform model to a local directory.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model_id: string, directory_path?: string, if_exists?: 'backup' \| 'update' \| 'error' }` |
| **Output** | `{ model_id: string, name?: string, directory_path: string, backup_path?: string, files_written: string[], platform_baseline: 'recorded' \| 'not_recorded', registered: boolean, settlement_registration?, warnings? }` |
| **dt-core class** | `DtExportSplit` |

Exports the full model including structure, data flows, data items, and attributes. When `directory_path` is omitted, a directory named after the model ID is created in the current working directory. Writes `sync.json` with pull metadata (`platform_model_id`, `platform_url`, `last_pull_at`, `pull_content_hash`, `baseline_element_ids`).

`if_exists` decides what happens when the target directory already holds a model, and is the only control a caller has over live local work:
- `backup` (default) — copy the existing directory to a timestamped path, then write; the copy is reported as `backup_path`.
- `update` — overwrite in place, no copy.
- `error` — refuse and fail.

Whatever `if_exists` says, a directory whose `sync.json` links it to another platform model is refused before any backup or platform call, with `data: { code: 'directory_linked_to_other_model', linked_model_id }`.

`registered` says whether the directory is in the project's model registry. `settlement_registration` (present only when something was registered or the registration failed) reports the pulled values registered in this machine's settlement; a failed registration also adds a warning.

#### `update_model`

Update an existing platform model from local files.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model_id: string, directory_path: string, delete_orphaned?: boolean, create_backup?: boolean, disable_source_file_update?: boolean, overwrite_changed?: string[], overwrite_revision?: string }` |
| **Output** | `{ model_id: string, name: string, stats: { created: number, updated: number, deleted: number }, warnings: string[], backup_path?: string, source_files_updated: boolean, platform_baseline: 'recorded' \| 'not_recorded', acknowledgement?: 'accepted' \| 'unused', resolved_controls?, settlement_registration?, manifest_modules: { after, before? } }` |
| **Platform-change refusal** | `success: false`, with `data: { code: 'PLATFORM_CHANGED_SINCE_SYNC', baseline, revision, changes_total, changes, changed_ids, acknowledgement? }` |
| **dt-core class** | `DtUpdateSplit` |

Applies structural changes (add/remove/modify elements) and attribute updates. The caller (e.g. the `/dethereal:sync` push path) resolves `model_id` from `manifest.model.id`. Optional flags:
- `delete_orphaned` (default `true`) — delete platform elements absent from the local files; this is the mechanism the sync C1/C2 conflict gate relies on.
- `create_backup` (default `true`) — snapshot the directory before applying changes.
- `disable_source_file_update` (default `false`) — skip the post-update re-export back to the source directory.
- `overwrite_changed` and `overwrite_revision` — the operator's consent to overwrite platform changes, described below.

**Platform-change check.** A push replaces each element it sends, so a change made on the platform since the last pull or push would be undone without a word. Every pull and push therefore records a signed fingerprint of the platform model in `.dethereal/sync.json`, and a push first compares the live platform model with it, over the fields it writes. When something changed, the push is refused with `PLATFORM_CHANGED_SINCE_SYNC`, listing the changes (at most 500) and their `changed_ids`, with a `revision`. To overwrite them, the operator says so, and the call is repeated with `overwrite_changed` set to exactly those `changed_ids` and `overwrite_revision` to the refusal's `revision`; the result then carries `acknowledgement: 'accepted'` (or `'unused'` when nothing had changed). The revision only proves the platform has not changed again since the refusal; a platform that changed again refuses again. It is not an authorisation: the tool's own approval prompt is. More than 5,000 changes cannot be named, and the operator pulls first. A missing or unverifiable record counts every element as changed.

Like `import_model`, it pushes the derived module list, writes it into `manifest.json` once every refusal (including the platform-change check) has passed, and reports `manifest_modules: { after, before? }`. See [Manifest Modules](#manifest-modules).

#### `list_models`

List threat models on the platform.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ folder_id?: string, name?: string }` |
| **Output** | `{ models: Array<{ id: string, name: string, description?: string }>, total: number }` |
| **dt-core class** | `DtModel` |

Wraps `DtModel.getModels({ folderId })`. The `name` filter is applied client-side after fetching (the backend API only supports `folderId` filtering). Note that `folder_id` is an *input* filter only — it is not echoed back on the result rows, so callers cannot re-filter by folder client-side.

### Element Management Tools (Client-Dependent)

#### `get_classes`

Query available classes from installed modules, or list the installed modules.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ class_id?, name?, class_type?: 'PROCESS' \| 'EXTERNAL_ENTITY' \| 'STORE' \| 'BOUNDARY' \| 'SECURITY_BOUNDARY' \| 'DATA_FLOW' \| 'DATA' \| 'CONTROL', category?, module_id?, module_name?, fields?: Array<'id' \| 'name' \| 'description' \| 'type' \| 'category' \| 'attributes' \| 'guide' \| 'module' \| 'enrich' \| 'template_keys'>, limit?: number (1–200, default 100), offset?: number, enrich_offset?: number, view?: 'classes' \| 'modules' }` |
| **Output** | `classes`: `{ classes, total, returned, offset, truncated, next_offset?, remaining_modules?, listing, oversized?, note? }`; `modules`: `{ modules: Array<{ id, name, class_counts }>, total }` |
| **dt-core class** | `DtModule`, `DtClass` |

- `view: 'classes'` (default) lists the classes that match the filters, in pages: when `truncated` is true, call again with `offset` = `next_offset`. A page also stops at a size budget (24,000 characters), and is sent without indentation. `listing` is a short hash of the matching class ids: a change between pages means the catalogue changed. `PROCESS`, `EXTERNAL_ENTITY` and `STORE` select component classes of that type.
- A truncated page also gives `remaining_modules`: the modules whose classes the later pages hold, in listing order. Its `note` names them, and says to call again with the offset or to narrow the listing with `module_name`.
- `fields` selects what each class carries; without it, every field but `enrich` and `template_keys` is returned. `attributes` (the JSON Schema template) and `guide` are large, so they, and `enrich`, which is built from them, need `class_id`, `name` or `category`: list with lean fields, then fetch one class's template by `class_id`.
- `enrich` is the compact view for enriching a class's attributes. For each template field, in the template's order, it gives `name`, `value_type` (the guide's, else the schema's `type`), `typical_values`, `enum` (from the schema property, or its `items`), `description` (the guide's full option description, else the schema's `description`) and `how_to_obtain`; each `how_to_obtain` step keeps only `type`, `instruction`, `file_path`, `navigation` and `source`, and a step given as plain text is kept as `{ instruction }`. The guide's commands, expected outputs and security impact are left out. A guide entry names its field by `attribute_name` where it has one (its `option_name` is then a title), else by `option_name`; the first entry for a field counts. A guide entry for a field the template lacks is dropped; a template field without a guide entry keeps its type and allowed values. `enrich` is returned only when `fields` names it, so `fields: ['id', 'name', 'enrich']` is the call to use when enriching. For the median of the 75 shipped `dethernety-general` classes it is about a third of the template plus guide; large classes page, as below.
- `enrich` pages by field. Every class entry that carries `enrich` also carries `enrich_total`, the template fields in all. A class whose enrich view is larger than the page budget comes back alone, with as many fields as fit and `enrich_next_offset`; the page's `note` says "N more fields of <name>: call again with class_id <id> and enrich_offset <k>", and `next_offset`, when there is one, still goes on to the next class. The next page is a call with the same `class_id`, `fields` including `enrich`, and `enrich_offset` set to that value. A single field larger than a page is sent alone, and the page is marked `oversized`. Across the shipped classes every page stays under the budget, and about a dozen classes take two pages.
- `template_keys` gives one class's template field names only, in the template's order. Use it to tell two close classes apart: `fields: ['id', 'name', 'template_keys']` with `class_id`. It is returned only when `fields` names it.
- Refusals: `enrich` together with `attributes` or `guide` (it is the compact view of them: ask for it without them); `template_keys` without `class_id` (it never lists); `template_keys` together with `attributes`, `guide` or `enrich`; `enrich_offset` without `class_id` and `enrich`; `enrich_offset` when the `class_id` matches more than one class (narrow it with `module_id`); and an `enrich_offset` past the end of the class's fields.
- `view: 'modules'` lists the installed modules with their class counts per type, and takes only `module_id` or `module_name`.
- **Hidden-edge classes are listed only when asked for.** The classes of the platform's hidden-edges module (`dethernety-hidden-edges`) record inferred paths the operator accepted, never an element of the system, so the classes view leaves that module out of a listing unless the call names a module (`module_id` or `module_name`) or a `class_id`. Asking by category (`Hidden Edge`) does not list them.

#### `match_classes`

Match elements against the class catalog and return ranked candidates.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ elements: Array<{ name: string, type?: string, description?: string }> (1--100), classLabel: 'COMPONENT' \| 'SECURITY_BOUNDARY' \| 'DATA_FLOW' \| 'DATA' \| 'CONTROL', componentType?: 'PROCESS' \| 'STORE' \| 'EXTERNAL_ENTITY', moduleIds?: string[], topN?: number (1--10, default 3), fields?: Array<'description' \| 'category' \| 'type'> }` |
| **Output** | `{ matches: Array<{ elementName: string, candidates: Array<{ classId, className, classDescription?, classCategory?, classType?, moduleId?, moduleName?, matchType, confidence, similarityScore? }> }>, module?: { id, name }, unmatched: string[], unmatched_type_only?: Array<{ elementName, class_type? }>, hint?: string, total_elements: number, matched_count: number, unmatched_count: number, vector_search_available: boolean, clarification?: string }` |
| **dt-core class** | `DtClass` |

Per element, the platform tries its tiers in order and returns up to `topN` ranked candidates, each with its `matchType`:

1. `exact_name` (confidence `high`) and `vector_similarity` (`medium`) run together: exact-name hits first, then the vector hits not already listed. The vector tier runs only for an element with a `description`.
2. Only when neither finds a class: `fuzzy_name` (`high`), whole-word name containment in either direction.
3. Only when that finds nothing either: `type_match` (`low`), the classes of `componentType`. Without `componentType`, this tier returns every class of the label (for `COMPONENT`, every component class across types), at low confidence.

`componentType` (allowed only with `classLabel: 'COMPONENT'`; otherwise the call is refused) filters every tier, and is the only hard type filter. An element's own `type` is embedded into the vector query text (`"<name>. <description>. Type: <type>."`), so it shapes the vector tier but filters nothing. The workflow therefore classifies components with one call per component type, each with `componentType`. Use this instead of repeated `get_classes` calls when classifying model elements: one call covers up to 100 elements. The tiers are described in [BACKEND_DELEGATION.md §4.1](BACKEND_DELEGATION.md#41-match_classes--class-recommendation-for-elements).

An element whose candidates are all `type_match` is moved to `unmatched`: those candidates are just classes of its type, in no useful order. It is also listed in `unmatched_type_only` as `{ elementName, class_type? }`, where `class_type` is the `get_classes` `class_type` to list its candidates with: the label's own type, or for a component the `componentType`, else the element's `type`. It is left out for a component whose type is not known. A `hint` then says to list the active modules' classes with `get_classes` and choose there, or to leave the element unclassified. An element whose candidates mix type matches with other matches is kept in `matches`. `matched_count` and `unmatched_count` count the elements after this move.

`vector_search_available` reports whether semantic (vector) search exists on the deployment. When it is `false`, matching is name- and type-based only and a human-readable `clarification` is included for the agent to relay.

The reply is trimmed for the agent's context:

- A class's `classDescription` is given only the first time that class appears among the reply's candidates; later candidates of the same class omit it. It is the description's first sentence, cut at 240 characters with `…`; `get_classes` has the full text.
- A field that is null is left out, and `similarityScore` is rounded to 2 decimal places.
- When every candidate comes from one module, `module: { id, name }` names it once at the top and no candidate carries `moduleId` or `moduleName`.
- The reply carries no GraphQL `__typename`.
- A hidden-edge class is never offered. The tool asks the platform for `topN` plus 4 (one class per hidden-edge kind) and drops every candidate whose `moduleName` is `dethernety-hidden-edges` before cutting to `topN`, so the result still holds `topN`.

> **Naming note:** this tool's parameters are camelCase (`classLabel`, `topN`), unlike the snake_case convention used by the rest of the tool surface.

#### `update_attributes`

Update element attributes only (no structural changes).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model_id: string, directory_path: string, overwrite_changed?: string[], overwrite_revision?: string }` |
| **Output** | `{ model_id: string, stats: { boundaries, components, dataFlows, dataItems, total: { updated: number, failed: number } }, attributes: { sent: number, withheld_unresolved: number, elements_without_class: number }, errors: Array<{ step, elementId?, elementName?, error }>, warnings: string[], platform_baseline?: 'recorded' \| 'not_recorded', acknowledgement?: 'accepted' \| 'unused' }` |
| **dt-core class** | `DtUpdateSplit.updateAttributesOnly()` |

Reads the `attributes/` subdirectory and pushes attribute values without touching model structure. There is no element filter — the whole directory is read. It runs the same platform-change check as [`update_model`](#update_model), over attribute values only, and takes the same overwrite consent.

`stats` counts **elements**, so on its own it cannot distinguish "29 elements fully enriched" from "29 elements whose every value is still unresolved". The `attributes` block is the attribute-level outcome, and `withheld_unresolved` is the number that matters: null-valued attributes are deliberately **not** pushed. A null in an attribute file means "template field, not yet resolved" (the enrichment checklist `generate_attribute_stubs` writes), but the platform write is a property merge that cannot store null — pushing one would either do nothing or erase a value somebody else established. The consequence worth knowing is that the plugin cannot *clear* a platform-side attribute by nulling it locally.

Its Gate 2 check judges the [derived module list](#manifest-modules), but it sends no modules and never writes `manifest.json`.

#### `generate_attribute_stubs`

Write class template attribute stubs to disk for classified elements.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ directory_path: string, element_ids?: string[] }` |
| **Output** | `{ generated: number, skipped: number, reclassified: number, cached_classes: number, failed: Array<{ element_id: string, reason: string }>, warnings: string[] }` |
| **dt-core class** | `DtClass` |

Auto-scans `structure.json`, `dataflows.json`, and `data-items.json` for classified elements (or just `element_ids`, when given), deduplicates class IDs so N elements with K unique classes cost K fetches, and merges template fields into existing attribute files. Template fields are seeded as `null`; **existing values always win**. Running it twice produces identical output.

Two side effects other tools depend on:
- `.dethereal/class-cache/` — the cached class templates. `validate_model_json(action: 'quality')` reads this to score attribute completion against real template fields; without it the score falls back to counting attribute files (`attribute_residual.basis: 'file-presence'`). Each entry also records the class's `module`, from which `manifest.json`'s module list is [derived](#manifest-modules).
- `.dethereal/template-fields/` — per-element template field manifests, used to detect reclassification.

Call it after classification so attribute files carry the exact field names the platform's policies evaluate.

### MITRE Framework Tools (Client-Dependent)

#### `search_mitre_attack`

Search and browse ATT&CK techniques, tactics, and mitigations (D26); resolve an exact ATT&CK or ATLAS id; match free text to candidate techniques.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'search' \| 'tactics' \| 'techniques_by_tactic' \| 'technique' \| 'mitigations' \| 'mitigation' \| 'lookup' \| 'match', query?: string, tactic_id?: string, attack_id?: string, framework?: 'attack' \| 'atlas' \| 'both', top_n?: number }` — `lookup` takes `attack_id` only; `match` takes `query`, `framework` and `top_n` only |
| **dt-core class** | `DtMitreAttack` (the browsing actions); `lookup` and `match` use the server's own documents |

| Action | dt-core Method | Required Params | Notes |
|--------|---------------|-----------------|-------|
| `search` | `findMitreAttackTechniques` | `query` | Matched on the platform as a technique-name `contains` filter. Returns at most 20, with `total` and `truncated`. |
| `tactics` | `getMitreAttackTactics` | -- | Returns all 15 tactics. |
| `techniques_by_tactic` | `getMitreAttackTactics`, then `getMitreAttackTechniquesByTactic` | `tactic_id`: the ATT&CK tactic id (e.g., "TA0008") | The platform selects a tactic by its node id, so the ATT&CK id is looked up among the platform's tactics first (a node id is still accepted). Returns `{ techniques, tactic_id }`, with the ATT&CK id. An unknown tactic is refused (`Tactic … not found`), not answered with an empty list. |
| `technique` | `getMitreAttackTechnique` | `attack_id` (e.g., "T1190") | Anti-hallucination guardrail: validates technique exists before annotating. |
| `mitigations` | `getMitreAttackMitigations` | -- | Returns all mitigations. |
| `mitigation` | `getMitreAttackMitigation` | `attack_id` (e.g., "M1036") | |
| `lookup` | -- | `attack_id`: an exact ATT&CK id (`T1078.001`) or ATLAS id (`AML.T0051`) | An id starting `AML.` is read as ATLAS, any other as ATT&CK. Returns `{ technique: { id, framework, attackId, name, description, deprecated, decreasedUsage, subtechnique, version, refUrl, parentTechnique, tacticNames } }`, where `id` is the internal node id. A miss is `not_found`: the technique does not exist on the platform. `deprecated` is ATLAS-only and advisory; `decreasedUsage` is ATT&CK-only, and such a technique is still valid. |
| `match` | -- | `query` (at most 500 characters) | Runs the platform's matching cascade (exact id, id prefix, name, description, vector similarity) over `framework` (`attack` by default, `atlas`, or `both`), `top_n` candidates (default 5, clamped to 1–20). Returns `{ query, candidates: [{ mitreId, name, description, tactic, kind, matchType, similarityScore }], unmatched, vectorAvailable, vectorDisabledReason }`. With `both`, the two frameworks' candidates merge by tier, then by similarity. A candidate carries no internal id: `lookup` is the id authority. |

> The plugin provides `search_mitre_attack` for user-initiated reference browsing. Systematic technique-to-component mapping (STRIDE-to-ATT&CK evaluation) is performed by platform analysis modules, not the plugin.

#### `get_mitre_defend`

Browse D3FEND defensive techniques (D24).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'tactics' \| 'techniques_by_tactic' \| 'technique', tactic_id?: string, d3fend_id?: string }` |
| **dt-core class** | `DtMitreDefend` |

Renamed from `search_mitre_defend` because the underlying `DtMitreDefend` class has no text search capability -- only tactic listing, technique-by-tactic browsing, and technique lookup by ID. The D3FEND data comes from the mitre-frameworks module, which ingests a pinned D3FEND release into the graph database. For free-text lookup the plugin offers only `search_mitre_attack`, which searches ATT&CK techniques by name; D3FEND techniques are found by tactic browsing or by ID with `get_mitre_defend`.

dt-core has no name search for D3FEND techniques, unlike ATT&CK's `findMitreAttackTechniques`; one would be needed before this tool could filter by name.

**`techniques_by_tactic`** takes `tactic_id` as the D3FEND tactic's name (e.g., "Harden"), as `tactics` lists them. The platform selects a tactic by its node id, so the tool first reads the tactics (`fetchMitreDefendTactics`) and looks the name up, in any letter case; a node id, the tactic's URI or the URI's fragment is still accepted. It then calls `getMitreDefendTechniquesByTactic` with the node id and returns `{ techniques, tactic_id }`, with the tactic's name. An unknown tactic is refused (`D3FEND tactic … not found`), naming the tactics there are, instead of being answered with an empty list.

### Security Element Tools (Client-Dependent)

Reading controls, exposures and countermeasures goes through the three read-only `query_*` tools, which run without an approval prompt; every write stays in a `manage_*` tool, which always asks. The `query_*` tools share `query-security.tool.ts`: each accepts only its read actions and a strict, bounded set of inputs (ids limited to `[A-Za-z0-9_-]`, at most 128 characters), and a `list` returns at most `limit` items (default 100, at most 500) with `total` holding the full count and `truncated: true` when items were cut.

#### `query_exposures`

Read-only access to platform-computed exposures (D25). It replaced `manage_exposures`, which is retired and no longer registered.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list' \| 'get' \| 'list_model' \| 'evidence', element_id?: string, exposure_id?: string, limit?: number, directory_path?: string, view?: 'partition' \| 'groups' \| 'rows', select?: 'stale' \| 'user' \| 'all', offset?: number, listing?: string }` |
| **dt-core class** | `DtExposure` (`list`, `get`); `list_model` and `evidence` use the server's own documents |

`list` reads the exposures of `element_id`; `get` reads one by `exposure_id`. Two actions serve triage:

- **`list_model`** (`directory_path`) reads the exposures of the platform model the directory was pushed as, and answers in one of three views (below). The directory must name a model in its sync record, synced with the platform this server is configured for (`not_synced`, `other_platform` otherwise). The server reads the whole model in one read, bounded to 60 seconds and 4 MiB of result (`read_timed_out`, `model_too_large`); a missing model is `model_not_found`. `element_id` narrows any view to one element; an id the model does not have is refused with `element_not_found`.
- **`evidence`** (`exposure_id`) reads one exposure's full evidence: description, references, techniques, tags, mitigation suggestions, detection methods, and the exploiting ATT&CK and ATLAS techniques with their internal ids.

**The `list_model` views.** A whole model in one answer can be larger than a harness takes inline: a model with a few hundred exposures came to about 280 KB. So `list_model` answers with one view of the model at a time, chosen by `view`. The views are built in `src/triage/model-views.ts`.

| View | What it returns | Result |
|------|-----------------|--------|
| `partition` (the default) | Counts only, no rows | `{ model_id, model_name, view, exposures, totals, triage, user_pending, elements, without_exposures, element?, warnings? }` |
| `groups` | The triage set, grouped on the server, in parts | `{ model_id, view, element_id?, groups, rows_total, parts_total, parts_left_over, returned, offset, truncated, next_offset?, listing }` |
| `rows` | The rows `select` picks | `{ model_id, view, select, element_id?, rows, total, returned, offset, truncated, next_offset?, listing }` |

- **`partition`.** `exposures` is the model's exposure count. `totals` counts `pending`, `confirmed`, `disposed`, `stale`, `user` and `system`. `triage` counts the pending exposures not created by USER (the triage set); `user_pending` the pending ones created by USER. `elements` is the model's element count; `without_exposures` holds the count of elements with no exposure, and names them (`elements`) only when there are at most 10. With `element_id`, `element` holds that element's id, name, kind and the same counts; the other numbers still count the whole model. Only this view adds the per-machine files, the triage files among them, to the model's `.dethereal/.gitignore` (see [The triage record](#the-triage-record)); a `.gitignore` it cannot update is a warning.
- **`groups`.** The triage set, grouped by the exact tuple (name, type, category, definition hash): two definitions that share a name never merge, and a null and an empty string are different values. The groups come in that tuple's order, with ids `g<k>`. A group's members, ordered by element id and exposure id, are filled into parts of at most 80 members and at most 20,000 characters; a group that needs more than one part has parts `g<k>#<m>`. Each part carries the group's shared fields once (`name`, `type`, `category`, `def_hash`, `attack_ids`, `atlas_ids`), `size` (the whole group's member count, across its parts) and its `members`, each `{ exposure_id, element_id, element_name, element_kind, element_class_id, score, attack_vector, unresolved_references_count }`. The view returns at most 999 parts across all its pages: `parts_total` counts them all, and `parts_left_over` those held back. `rows_total` counts the rows of the triage set. A part whose members all sit on hidden edges this machine accepted, for techniques those edges were accepted with, carries `inferred: true`: they are the edges' own findings (see [Hidden-Edge Tools](#hidden-edge-tools)).
- **`rows`.** `select` picks the rows: `stale` (a stale disposition, any lifecycle), `user` (created by USER, any lifecycle) or `all` (the default). Rows are ordered by name, type, category, definition hash, then exposure id. Each row carries the exposure, its element and the element's class, its lifecycle (`pending`, `confirmed` or `disposed`), its disposition fields, its ATT&CK and ATLAS ids and its definition hash. `total` counts the rows selected.

**Pages.** The groups and rows views come in pages: as many whole items (parts, or rows) as keep the result, as it is sent, under 24,000 characters, and at least one item a page. `returned` is the page's item count. A caller follows `next_offset`, passing `listing` back, until `truncated` is false. `listing` is a 16-hex-character hash of the rows the view pages over: each row's id, the fields its order and grouping rest on, its lifecycle, staleness and creator, and every field a group member carries (element id, name, kind and class id, score, attack vector, unresolved-reference count). So any change that would move where a group's parts split changes the listing. Past offset 0 it is required (`listing_required`). When the model's current listing differs from the one passed, the call is refused with `listing_changed`: the model changed between pages, so the caller starts again at offset 0.

**Caps on returned strings.** Every string a view returns is capped, counted in characters as it is sent, JSON escapes included; session secrets are redacted before the cut. Names and other text fields, the disposition reason included, are cut to 200 characters; a group member's element name to 64. An ATT&CK or ATLAS id list keeps its first 50 ids, each cut to 32 characters, with `attack_ids_count` or `atlas_ids_count` giving the full count when the list was cut. A class id (`element_class_id` on a group member, `element_class.id` on a row) is passed back to other tools, so it is never cut below 128 characters. In the rows view, `unresolved_references` keeps its first 5 entries of at most 200 characters each, with `unresolved_references_count` when it was cut. The full texts stay in `evidence`.

**Input rules.** The schema refuses `view` outside `list_model`, `select` outside the rows view, `offset` and `listing` outside the groups and rows views, and `listing` at offset 0, each with a message naming the field. `limit` applies to `list` only. The other refusals above (`not_synced`, `other_platform`, `model_not_found`, `read_timed_out`, `model_too_large`, `element_not_found`, `listing_required`, `listing_changed`) name their code in `data.codes`.

**Create/update/delete are NOT supported.** Exposures are computed by OPA/Rego policy evaluation on the platform. Plugin-created exposures would pollute the analysis engine's evidence chain (`Component → HAS_EXPOSURE → Exposure → EXPLOITED_BY → Technique`) with unverified claims.

After model import, the plugin reads back computed exposures: *"12 exposures found on your model. Run analysis for full findings and remediation roadmaps."*

#### `query_controls`

Read-only access to the platform's security controls.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list' \| 'get' \| 'rank', control_id?: string, folder_id?: string, class_ids?: string[], name?: string, class_type?: string, element_ids?: string[], module_id?: string, module_name?: string, element_types?: string[], top_n?: number, limit?: number }` |
| **dt-core class** | `DtControl` |

`list` filters controls by folder (or `'all'`), class IDs, name substring, class type, supported elements or module; `get` reads one by `control_id`; `rank` scores candidate controls for `element_types` (`PROCESS`, `EXTERNAL_ENTITY`, `STORE`, `BOUNDARY`, `DATA_FLOW`, `DATA`), optionally within `module_id`, and returns the top `top_n` (1–50, default 5). `limit` applies to `list` only; `element_types` and `top_n` to `rank` only.

#### `query_countermeasures`

Read-only access to a control's countermeasures.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list' \| 'get', control_id?: string, countermeasure_id?: string, limit?: number }` |
| **dt-core class** | `DtCountermeasure` |

`list` reads the countermeasures of `control_id`; `get` reads one by `countermeasure_id`.

#### `manage_controls`

Create, update, delete and assign security controls, and run the control-library sync actions. Listing, reading and ranking controls is [`query_controls`](#query_controls).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'create' \| 'update' \| 'delete' \| 'assign' \| 'pull-controls' \| 'push-greenfield' \| 'push-brownfield' \| 'tombstone' \| 'set-local-edited' \| 'promote-external-edit' \| 'inspect-wal' \| 'clear-wal', control_id?: string, name?: string, description?: string, folder_id?: string, class_ids?: string[], element_ids?: string[], directory_path?: string, ... }` |
| **dt-core class** | `DtControl`, `DtControlLibrary` |

`class_ids` on `create`/`update` assigns `DTControlClass` class IDs to the control instance; on `update` the list replaces the current bindings. `assign` links `control_id` to `element_ids`. The control-library actions take `directory_path` and are described in [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md). Use `get_classes(class_type: 'CONTROL')` to list the available control classes, and `match_classes(classLabel: 'CONTROL')` to find candidates for a control idea.

#### `manage_countermeasures`

Create, update and delete countermeasures, which link controls to exposures. Listing and reading countermeasures is [`query_countermeasures`](#query_countermeasures).

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | See below |
| **dt-core class** | `DtCountermeasure` |

```typescript
z.object({
  action: z.enum(['create', 'update', 'delete']),
  control_id: z.string().optional(),            // required for 'create'
  countermeasure_id: z.string().optional(),     // required for 'update', 'delete'
  name: z.string().optional(),                  // required for 'create'
  type: z.enum(['preventive', 'detective', 'corrective']).optional(),
  category: z.string().optional(),              // e.g., "access-control", "encryption", "monitoring"
  description: z.string().optional(),
  score: z.number().min(0).max(100).optional(), // effectiveness 0-100, defaults to 50 on create
  exposure_ids: z.array(z.string()).optional(), // links to addressed exposures
  defend_technique_ids: z.array(z.string()).optional(),
  mitigations: z.array(z.object({ id: z.string() })).optional(), // ATT&CK mitigation references
  references: z.string().optional()
})
```

On `update`, an omitted field stays unchanged, and a provided `exposure_ids`, `defend_technique_ids` or `mitigations` list replaces the current links.

`update` applies only to USER countermeasures. A SYSTEM countermeasure (or one with no `createdBy`) is rewritten from its control's class policy on each save of the control, so the tool refuses any update of one; supersede it into a USER copy (in the platform, **Customize as an editable copy**) and update the copy. `delete` is refused for the same countermeasures, since the next save re-creates one while its policy still derives it; change the control's attribute answers instead, or supersede it.

> **Temporal dependency:** Countermeasures created before model import will not have `exposure_ids` (no exposures exist yet). The guided workflow handles this in Step 11: after sync, read back platform-computed exposures via `query_exposures(action: 'list')` and present a batch linking table.

#### `get_control_gaps`

Model-wide control gap analysis over the MITRE framework chain.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ model_id: string, top_n?: number (1--20, default 3), limit?: number (1--200, default 50) }` |
| **Output** | `{ ..., coverageSummary: { totalExposures, ... } }` — unmitigated exposures, unaddressable exposures (no module covers them), recommended controls ranked by coverage, and a coverage summary with percentage |
| **dt-core class** | `DtControl.controlGaps()` |

The model-wide counterpart to `validate_model_json(action: 'coverage')`, which scores coverage for a directory. Requires a model that has already been analyzed for exposures — when `coverageSummary.totalExposures` is `0` the tool succeeds but returns a warning saying to run an exposure analysis first. `top_n` caps recommended controls; `limit` caps returned unmitigated exposures.

### Analysis Tool (Client-Dependent)

#### `manage_analyses`

List analysis classes, create/run analyses, get results.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'list_classes' \| 'list' \| 'create' \| 'run' \| 'status' \| 'results' \| 'delete', element_id?: string, analysis_id?: string, analysis_class_id?: string, name?: string, description?: string }` |
| **dt-core class** | `DtAnalysis` |

Analyses hang off a model **element**, not a model — there is no `model_id` parameter. A cross-field refinement enforces the per-action requirements: `element_id` for `list`; `element_id` + `name` + `analysis_class_id` for `create`; `analysis_id` for `run`, `status`, `results`, and `delete`.

**Polling contract** (streaming/subscription-based delivery cannot work through stateless MCP tools):

| Action | Returns | Next Step |
|--------|---------|-----------|
| `list_classes` | `{ analysis_classes }` — available analysis module classes | Select class for `create` |
| `list` | `{ analyses, total }` for the given `element_id` | -- |
| `create` | `{ analysis }` — the created analysis object, carrying its ID | Call `run` |
| `run` | `{ session_id, status: 'started', next }` | Poll `status` |
| `status` | `{ analysis_id, status }` | When complete, call `results` |
| `results` | `{ analysis_id, results }`, the analysis's main document (`getDocument` with `filter: { document: 'index' }`, the document the platform's own results view reads); or `{ analysis_id, status: 'no_results', message }` when the platform answers with nothing, an empty document, or a document holding only an error: the analysis has no results yet, does not exist, or its results could not be read | Display to user |
| `delete` | `{ deleted, analysis_id }` | -- |

The contract carries no progress or back-off metadata: `status` returns the raw status value with no `progress` object, and an incomplete `results` call returns `status: 'no_results'` rather than a `retry_after_seconds` hint. Callers must choose their own polling interval.

### Triage Tools

Triage reviews the platform's computed exposures for one model. The `triage` skill reads them through `query_exposures` `list_model`, which groups them on the server (see [`query_exposures`](#query_exposures)), has its specialist agents propose a disposition for each group, and puts the proposals to the operator. The tools make the review deterministic and gate every write:

- `triage_review` reads each of the operator's replies as one command, checks and writes the remediation task list, and reads back what became of the proposals published to the platform's Triage workspace.
- `manage_dispositions` writes what a closed review decided, only after the operator's answer to the apply question; or, for an untouched review, publishes its proposals to the platform's `dethermine-review` Triage workspace for a person to decide there, after the publish question, writing no disposition.
- `get_kg_chain` and `get_class_guide` supply read-only evidence.

What a disposition is, and what its kinds mean, is the platform's: see [ADR-007: Finding disposition lifecycle](../decisions/007-finding-disposition-lifecycle.md) and the [glossary](../../GLOSSARY.md#finding-disposition). Every triage tool that takes a model directory names its platform model the same way, from the directory's sync record, which must have been made against the platform this server is configured for (`not_synced`, `other_platform` otherwise). The decision to build triage into this server is [ADR-014](../decisions/014-open-source-triage-and-evaluator.md); the operator's view of a run is [Triaging Platform Findings](../../user/dethereal/TRIAGE.md).

```mermaid
sequenceDiagram
    participant O as Operator
    participant S as Main session (triage skill)
    participant R as triage_review
    participant D as manage_dispositions
    participant P as Platform
    S->>R: open (directory, mode, groups)
    R->>P: read the model's exposures
    R-->>S: review_id, grammar, ask
    loop each reply
        S->>O: the result, then ask
        O->>S: one reply
        S->>R: reply, verbatim
        R-->>S: command and decisions, or a refusal, with ask while open
    end
    Note over R: accept-all or done closes the review
    S->>D: prepare (review_id)
    D->>P: read the model again
    D-->>S: plan_id, lines, ask
    S->>O: the lines, then ask (the apply question)
    O->>S: yes or cancel
    S->>D: commit (plan_id, lines, reply)
    D->>P: read again, write only if nothing changed
    D-->>S: written, failed, outcomes
```

`prepare` and `commit` each pass through the harness's approval prompt, since `manage_dispositions` is a `prompt` tool (see [Tool Manifest and Listing](#tool-manifest-and-listing)).

#### `triage_review`

The operator's review of triage proposals.

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ action: 'open' \| 'reply' \| 'get' \| 'tasks' \| 'published', directory_path?, mode?: 'review' \| 'stale', groups?, review_id?, reply?, run?, text?, guides? }` — `open` takes `directory_path`, `mode` and `groups`; `reply` takes `review_id` and `reply`; `get` takes `review_id`; `tasks` takes `directory_path`, `run`, `text` and, optionally, `guides`; `published` takes `directory_path` and, optionally, `review_id` |
| **Output** | `open`: `{ review_id, mode, groups (their count), grammar, ask, review_workspace?, warnings? }`; `reply`: `{ review_id, command, decisions, closed, show?, ask?, warnings? }`; `get`: `{ review_id, mode, groups (as opened), decisions, closed, ask? }`; `tasks`: `{ written: true, path, chars, quotes_exempted, existing?, warnings? }`; `published`: `{ publishes, counts, rows, more, note }` |
| **dt-core class** | None: the model read is the server's own document |
| **Approval** | `auto`; held by the main session only |

**`open`** takes the proposals as the operator is shown them, one per numbered group of exposures: `{ group, exposure_ids, proposal?, needs_human?, per_row_only?, stale_superseded?, ambiguity? }`, with a proposal `{ op, kind?, reason?, modifications?, verified_technique_ids?, confidence?, citations?, objection? }`. A review (`mode: 'review'`) proposes `dispose` or `supersede`; a stale review (`mode: 'stale'`) proposes `reaffirm` or `clear` for dispositions the model's changes made stale.

The groups are checked on their own before anything is read:

- Each exposure is in one group only, and a review holds at most 200 exposures (`review_too_long`: open it in parts).
- A `dispose` names `AFFIRMED`, `NOT_APPLICABLE` or `FALSE_POSITIVE` and carries its reason. `COMPENSATING_CONTROL` and `RISK_ACCEPTED` are the operator's to choose, in an edit, and are never proposed.
- A `supersede` carries its `modifications` and is never `needs_human`: it is accepted or skipped.
- Every text is one line of at most 1,800 characters, with no invisible or control characters (`text_invalid`). A copy's name holds no single quote, because the platform finds a copy's source by the copy's name in single quotes. A group's reason, objection, ambiguity, citations and edits together hold at most 12 KiB, what the review workspace stores for one proposal.
- A dispose with a `low` confidence or an `objection` is `needs_human`; a supersede with an objection is `per_row_only`, and one with a `low` confidence is refused (it is not proposed).
- A citation is a locator only: `platform:<field>`, `kg:<id>`, `attributes:<path>` or `source:<path>:<line>[-<line>]`, at most 300 characters, never to a secret file or outside the project, and a `source:` file only among those `.dethereal/discovery.json` lists, when it lists any (`citation_invalid`).

`open` then reads the model once and keeps what each exposure of the review, and every other exposure on their elements, was at that moment; a plan later writes only exposures still as the review saw them. It refuses:

- an exposure not in the model (`not_in_model`);
- an exposure outside what the mode reviews now (`target_changed`, with the exposures listed): in a review, one no longer in the triage set (see [`query_exposures`](#query_exposures)) — decided since it was listed, or created by USER — so a proposal never replaces a decision no one reviewed; in a stale review, one that is not stale now;
- proposals the platform would refuse: the first refusal's code, with every refused exposure listed with its group, code and why (see the rejection codes under [`manage_dispositions`](#manage_dispositions));
- a review whose plan could outgrow what can be shown whole (`echo_too_large`, over 24,000 characters of compact JSON);
- a second `open` of the directory while a review of it is open (`review_open`, with its `review_id`, which `get` resumes).

In a stale review the server marks a group `stale_superseded` when any of its exposures is superseded; such a group is cleared or skipped, never reaffirmed.

**`review_workspace`.** With a platform session, `open` also asks the platform's `dethermine-review` module (`src/review-module/workspace.ts`), and answers `review_workspace: { status, module_version?, analysis_id?, fingerprints, pending?, detail? }`. `status` is `present`, `module_not_loaded` (the platform refused the capability document at validation), `session_refused` or `failed`. With the module present, `open` finds the model's Triage analysis, if one exists (it never creates one), reads the review's findings' fingerprints from it (`fingerprints: 'read'`, else `'none'` or `'failed'`), and counts the proposals still waiting there (`pending`). Nothing here fails an open: a publish reads again what open could not. The fingerprints themselves stay in the server, for a publish.

A `supersede`'s `modifications` are `{ name?, description?, score? (0–10), attackVector?, category?, techniques?: { add, remove } }`, with internal technique node ids as `search_mitre_attack` `lookup` returns them. Every added id must be among the proposal's `verified_technique_ids` and be an ATT&CK or ATLAS technique on the platform; every removed id must be on the exposure; the target must be undisposed or `AFFIRMED`.

**`reply`** takes one reply exactly as the operator gave it and reads it as one command:

| Mode | Commands |
|------|----------|
| `review` | `accept <n> [<n> …]` · `skip <n> [<n> …]` · `show <n>` · `edit <n> rationale: <text>` · `edit <n> kind: <KIND> [rationale: <text>]` · `accept-all` · `done` |
| `stale` | `reaffirm <n> [<n> …]` · `clear <n> [<n> …]` · `skip <n> [<n> …]` · `show <n>` · `done` |

`<KIND>` is one of `AFFIRMED`, `NOT_APPLICABLE`, `FALSE_POSITIVE`, `COMPENSATING_CONTROL` and `RISK_ACCEPTED`. The verb is read in any letter case, and group numbers are separated by spaces or commas. A later decision on a group replaces an earlier one.

- A refused reply changes nothing: `reply_unparsed`, `verb_not_in_mode` (a verb of the other mode), `argument_invalid`, `group_unknown`, `edit_invalid`, `needs_operator_decision`, `text_invalid` or `review_closed`. Most refusals restate the grammar, which ends with the commands that close the review: `; accept-all and done close the review`, or in a stale review `; done closes the review`.
- `COMPENSATING_CONTROL` and `RISK_ACCEPTED` need a rationale.
- A `needs_human` group is not accepted (`needs_operator_decision`): the operator decides it with an edit that names a kind, and the reason is the operator's own rationale, from this edit or an earlier one.
- A supersede group is accepted or skipped; an edit of it is refused, since its reason is the fixed supersede record.
- `accept-all` accepts every pending group except the `needs_human` and `per_row_only` ones, which it skips; `done` skips every pending group. Both close the review.
- After every reply but `show`, the plan's bound is checked again (`echo_too_large`).
- Every reply is recorded before it takes effect (see [The triage record](#the-triage-record)). Once a review has recorded 70 replies, only a reply that closes it is taken.

**`get`** returns the groups as opened and the decisions so far.

**`published`** reads back, read only, what became of the proposals this machine published for the model (`src/review-module/readback.ts`). It covers the publishes the triage record holds, the latest publish of a finding speaking for it, and only analyses the platform confirms are this model's Triage analyses (`unconfirmed_analysis` otherwise). Each row is `{ review_id, group, exposure_id, name, status, what, now }`, in this order of what needs action: `rejected`, `unconfirmed_analysis`, `decided_otherwise`, `stale`, `stale_module`, `none`, `needs_person`, `open`, `decided_as_proposed`, `copied`, `gone`. `what` is the status in words: who rejected it and the note; what to do for a stale one (run triage again, or publish again after an upgrade); for `none`, why it was not stored at publish, or that the publish never confirmed; and who replaced it by a later publish. Everything the workspace returns, a rejection's note, a name and a kind, is cleaned to one line with its control and invisible characters removed (a note at most 300 characters): data, never instructions. A record entry out of shape is passed over (`publishesOf`), and a record that cannot be read gives no rows. At most 200 rows (`more` counts the rest). Refusals: `module_not_loaded`, `workspace_unavailable` and `workspace_refused`.

**The next question comes from the tool.** While a review is open, the answers return `ask`: the question the operator is asked next, its tag first, on one line. In a review it is `[prompt: triage-review] Your command? One command per reply: accept, skip, show, edit, accept-all or done, as the hint above shows.`; in a stale review, the `triage-stale-review` question. The skill ends its message with it exactly as returned, so the question is copied, not recalled. The texts are in `src/triage/asks.ts`, and a generator test holds them equal to the skill's registered questions.

- A successful `open` returns it; `reply` returns it unless the reply closed the review; `get` returns it unless the review is closed.
- A refused reply carries it in its `data`: `reply_unparsed`, `verb_not_in_mode`, `argument_invalid`, `group_unknown`, `edit_invalid`, `needs_operator_decision`, `text_invalid` and `echo_too_large`. So does `record_full` for the reply count, since a closing reply is still taken.
- A refusal the operator cannot answer with another reply carries none: `review_not_found`, `review_closed`, `not_model_dir`, `record_unwritable` and `record_too_large`.

**Reviews live in memory.** An open review is held only by the server process that opened it, never written to disk: the record holds its replies, not the review. The process holds at most 20 reviews, dropping the least recently used first, and a review unused for 2 hours expires. A restart forgets every review. A missing review is `review_not_found`: open it again.

**`tasks`** checks the remediation task list and writes it, in one call, so no unchecked list can stand at its path as if it were the checked one. It takes:

- `directory_path`: the model directory;
- `run`: the run's scratch directory name, `run-YYYYMMDD-HHMMSS`;
- `text`: the composed list, at most 65,536 characters;
- `guides` (optional): the class guides whose text the list quotes, at most 50 `{ class_id, element_kind, attribute_keys }`, with at most 20 keys each.

The steps run in this order. Nothing is written unless every one passes:

1. **The text.** Any control, format, invisible or bidirectional character, or lone surrogate, a tab or a carriage return included — anything but a plain line break — is refused `text_invalid`: such a character can split a word past the check. In practice these are emoji (their variation selectors and joiners), tabs, soft hyphens, and invisible and bidirectional characters. The refusal names each one, at most five, as its code point and line, in the message and as `data.characters` (`[{ line, code }]`).
2. **The run directory.** The model directory holds `manifest.json` (`not_model_dir`), and `.dethereal`, `triage-run` and the run's directory already exist. They are checked one level at a time, without following or creating anything: a missing one is `run_not_found`, a link or a non-directory `not_confined`.
3. **The guides.** Only when `guides` is given. This is the one step that needs a session: without one, the usual sign-in refusal. Each class must be one that some element of this model names, in its structure, flows, data items or attribute files (`guide_not_in_model`). Each guide is read as `get_class_guide` reads it; a failed read is `guide_unread`.
4. **The check.** The text, without the lines that quote a guide (below), goes through dt-module's `lintRemediationText` (see [UTILITY_CLASSES.md → Pure subpaths](../modules/UTILITY_CLASSES.md#pure-subpaths-condition-groups-and-remediation-honesty)). Any claim found refuses `claims_found`, with `{ hits, written: false }`.
5. **The write.** The triage files are kept out of git (see [The triage record](#the-triage-record)). The list goes to `.dethereal/triage-run/<run>/remediation-tasks-<YYYY-MM-DD>.md`, the date being the run name's own, not today's. The file is created at its path directly, readable by its owner only (0600), with one exclusive open that follows no link (on macOS, none in any part of the path), so it never replaces anything. Before writing any content, the server confirms where the file was created from its descriptor, never from the path: on macOS the open itself followed no link, and on Linux it reads the kernel's own name for the descriptor. Only then does it write. After writing, it checks through the descriptor that the file at the path is the one it created and has no second name. A directory swapped for a link therefore leaves at most an empty file where the link led, removed when the server still can, and the call refuses `not_confined`. Where the place cannot be confirmed (any system but macOS and Linux, or Linux without `/proc`), the list is not written: `tasks_unwritable`. A file that could not be written (no permission, no space, the directory gone) is `tasks_unwritable`, naming the path relative to the model directory. A failed write leaves nothing at the path.

**A file already at the path** is left untouched. It counts as the list, and the call answers as written with `existing: true`, only when it is a plain file with no other name that holds exactly the bytes that just passed the check. A link, or a second name of another file, is never taken for the list. Anything else refuses `tasks_exist`, with `written: false`, naming the path and saying the call neither wrote nor checked that file.

The result is `{ written: true, path, chars, quotes_exempted, existing?, warnings? }`. `path` is relative to the model directory; `warnings` says when the model's `.dethereal/.gitignore` could not be updated.

**Quoted guide text.** A line of the list that quotes, whole, a field of a guide named in `guides` is the guide's words, not the list's, and is set aside before the check. `quotes_exempted` counts the lines set aside.

- **The fields.** Each `howToObtain` step's instruction and expected output, and each string typical value, of at least 24 characters.
- **The match.** Both sides are cleaned the same way: NFC, line breaks to spaces, control, invisible and bidirectional characters removed, NFC again, white space collapsed, trimmed. A line matches as written, or after an optional `- ` or `> ` prefix and one pair of surrounding straight or typographic quotes, so a field that itself starts with quotes or a prefix matches too.
- **The lines around a quote** are checked separately, run by run, so a multi-word term is never found across a quote, nor hidden by one.
- **What is not exempt.** The server reads the guide itself, so nothing the caller passes is exempt. A quote inside a longer sentence, one character off, or cut short is checked as usual, and so is one that the cleaning or a redaction changed.

#### `manage_dispositions`

Writes what a closed triage review decided, in two steps, with the operator's answer between them; or publishes an untouched review's proposals to the platform's Triage workspace instead.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'prepare' \| 'commit' \| 'prepare_publish' \| 'publish', directory_path, review_id?, plan_id?, lines?, reply? }` — `prepare` and `prepare_publish` take `review_id`; `commit` and `publish` take `plan_id`, `lines` and `reply` |
| **Output** | `prepare`: `{ plan_id, expires_at, count, operations, lines, ask? }`; `commit`: `{ plan_id, written, failed, outcomes, warnings? }`, or `{ plan_id, cancelled: true, written: 0 }`; `prepare_publish`: `{ plan_id, expires_at, groups, findings, not_sent, lines, ask? }`; `publish`: `{ plan_id, analysis_id, created?, groups, findings, results, not_stored, not_sent?, warnings? }`, or `{ plan_id, cancelled: true, sent: 0 }` |
| **dt-core class** | `DtExposure` (`disposeExposure`, `clearDisposition`, `getExposureTechniqueLinks`) and `executeSupersedeFlow`; for a publish, the `dethermine-review` module's documents (`src/review-module/contract.ts`) and the platform's `createAnalysisIdempotent` |
| **Approval** | `prompt`, with `requiresUser`; called from the main session only. Each of the four calls asks |

**`prepare`** needs a closed review of the same directory and the same platform model (`review_not_found`, `review_open`, `other_model`). It reads the model once, checks each operation of the review against the platform now and against what the review saw when it was opened, and writes nothing. Each operation is `{ index, group, exposure_id, op, kind?, status: 'ready' | 'rejected', code?, clone? }`; `count` is the number ready. A rejected operation carries one of these codes:

| Code | Why the operation is not applied |
|------|----------------------------------|
| `not_in_model` | The exposure is not in this model on the platform |
| `target_changed` | The exposure changed since the review was opened, or the element a copy would be created on did |
| `target_superseded` | The exposure is superseded: its copy is the live finding |
| `target_disposed` | A supersede needs the exposure undisposed or affirmed |
| `evidence_unread` | The exposure's evidence could not be read |
| `kind_not_pickable` | The kind cannot be set here |
| `reason_empty` | The reason is empty |
| `reason_too_long` | The reason is over 2,000 characters with its marker |
| `not_disposed` | The exposure has no disposition to reaffirm |
| `technique_not_verified` | A technique to add is not among the proposal's verified ids, or is no ATT&CK or ATLAS technique on the platform |
| `remove_not_present` | A technique to remove is not on the exposure |
| `empty_supersede` | The supersede changes no field and no technique |
| `copy_exists` | The element already has an exposure with the copy's name, or another supersede of the plan creates it |
| `copy_name_invalid` | The copy's name would hold a single quote |

**The lines** are what the operator is shown before the apply question, and what `commit` takes back. In order:

1. The platform model: `Platform model "<name>" (<id>)`.
2. A summary that counts the writes: dispose, supersede, clear and reaffirm, how many replace a disposition, how many set `COMPENSATING_CONTROL` or `RISK_ACCEPTED`, and how many are not applied.
3. Each group's writes: one line per kind and reason of its disposes, then its clears, its reaffirms and its supersedes.
4. One line per rejection code: `Not applied (<code>): <why>: <the exposures>`.

Platform and agent text in a line is put on one line, with every invisible or control character shown as `?`, and `"` and `\` escaped. Free texts are double-quoted; kinds and ids are escaped but not quoted. An exposure reads `"<name>" on "<element>" #<id>`, the id given whole or as its shortest tail of at least 8 characters that tells the plan's exposures apart (`#…<tail>`). A write over an existing disposition adds `(replacing <KIND>: "<reason>")`.

**What each write is:**

- **dispose** — the kind, and the reason followed by a marker: ` — AI-assisted triage, operator-approved`, or ` — AI-assisted triage, operator-edited` when the reason is the operator's own rationale. With the marker, a reason is at most 2,000 characters.
- **clear** — the disposition is cleared.
- **reaffirm** — the exposure's kind again, with its reason renewed: the earlier reason without its marker or an earlier renewal note, then ` [re-affirmed <YYYY-MM-DD> after model change]` and the approved marker.
- **supersede** — a user-authored copy named `<name> (custom)` is created on the element the review names (the element of the exposure's row in the model read, always an element of this model), with the changed fields, the techniques added and removed, and the source's references, mitigation suggestions, detection methods and tags. Its description ends with `(custom of '<source name>')`. The source is marked `SUPERSEDED` with the reason `Superseded by user-authored exposure '<copy name>'`.

**The apply question.** When `count` is at least 1, `prepare` returns it as `ask`, its tag first, on one line: `[prompt: triage-apply] Apply <count> dispositions? Type yes or cancel.` With no ready operation there is no `ask`, and nothing is asked. The skill shows the lines first, then ends its message with `ask` exactly as returned, as in the review (see [`triage_review`](#triage_review)).

**`commit`** is described under [The two-phase gate](#the-two-phase-gate).

**Publishing to the Triage workspace.** `prepare_publish` and `publish` send an untouched review's proposals to the platform's `dethermine-review` module for a person to decide there; no disposition is written. A plan is of one kind, `dispositions` or `publish`, and is refused across (`plan_kind`).

- **`prepare_publish`** refuses a review with a reply (`review_has_replies`), one already published unless its publish was never confirmed (`review_published`), a platform without the module (`module_not_loaded`), and a workspace that cannot be asked (`workspace_unavailable`). It refuses `nothing_to_publish` when no group is left to send, and `echo_too_large` for lines over the echo budget or over 400 lines. It reads the model once, leaves out each finding that changed since the review, and builds the groups as the module's publish takes them (`src/review-module/payload.ts`): a dispose's kind and reason as drafted, a supersede's edits, the confidence, the citations, the objection, the ambiguity, `needsHuman` and `perRowOnly`, and each finding's base (`baseKind`, `baseAt`) and fingerprint. A group or finding the module would refuse is left out, with why (`not_sent`): a current decision it cannot carry, a reaffirm of a decision no person picked, a clear with nothing to clear, a superseded finding in a stale review. The lines (`publishLines`): a first line with the counts, the model, `under your name, with the reasons as Dethereal's analysts drafted them` and what the findings propose by kind; then, when it replaces proposals still waiting there, that line; then the 30-minute line when it applies; every group with what it proposes, its findings, its reason, an edited copy's values old → new and its technique ids, the analyst's confidence, the objection, what to weigh and the citations; `Not sent (<n> items):` with one line per item; where they go; and a closing line naming what is sent with each, an edited copy's fields included. Every text is double-quoted, with a `"` or `\` inside it escaped. The publish question comes as `ask`: `[prompt: triage-publish] Publish <G> groups (<F> findings) to the Triage workspace? Type yes or cancel.`, with `It replaces <n> proposals still waiting there.` before `Type yes` when it does (`publishAsk`). A record that cannot take one more publish (5 per review) is refused before the question.
- **The fingerprints** come from `open` when the model had a Triage analysis then; otherwise they are read at `prepare_publish` from an analysis found by then, or at `publish` from the one it creates. Past 30 minutes after open, a plan whose fingerprints were not read at open sends every proposal as `needsHuman` and no supersede (`LATE_FINGERPRINT_MS`), and its lines say so; a plan whose fingerprints are still unread at `publish`, prepared inside the window and published past it, is `plan_stale`, checked before any analysis is created, so its question can say how the proposals go. When the proposals still waiting cannot be counted, the lines say `The proposals still waiting there could not be counted; this publish replaces any that are.`, and the question says it replaces any.
- **`publish`** takes the plan, the lines and the reply as `commit` does, through the same plan store, the same answer checks and the same record. On `yes` it ends the plan as `plan_stale`, sending nothing, when a finding changed, the review took a reply or another publish since prepare, or the model's Triage analysis is not the one prepare found. It then finds the model's Triage analysis (the deterministic id first, else the oldest bound to this model alone), or creates it with that id (`createAnalysisIdempotent`, so two harnesses meet in one), reads the fingerprints if still needed, and sends one `reviewPublishProposals` call, at most 900 KiB (`payload_too_large`). It answers the module's counts per result (`stored`, `stored_stale`, `already_decided`, `rejected`, `changed_since_review`, `finding_not_found`) and each finding not stored with why. A refusal by the module is `publish_refused`, and nothing was stored; one with a `field` means the module and this Dethereal disagree on the payload's shape, and the field is named only in its plain form (`[A-Za-z0-9_.[\]]`), else `(unnamed field)`. `not_triage` is said in words: the model's Triage analysis is linked to more than one model. **No answer is `write_error`:** the module may hold the proposals, the review is closed and its publish marked unconfirmed, and `prepare_publish` again sends it once more, safely; it is never committed. The skill reads back with `published` first.
- **A published review is never committed:** `prepare` and `commit` refuse it (`review_published`); for a publish never confirmed, the refusal says `published` shows whether it landed, or to run triage again to decide here.

#### `get_kg_chain`

Read-only evidence from the platform's knowledge graph.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'probe' \| 'chain' \| 'evaluate', class_id?, rule_name?, attributes? }` — `chain` takes `class_id` and, optionally, `rule_name`; `evaluate` takes `class_id`, `rule_name` and `attributes` |
| **dt-core class** | None: the server's own documents (`kgCapability`, `kgRules`) |
| **Approval** | `auto` |

- **`probe`** reports whether the graph can be used here: `{ regime: 'kg_present' }`, or `{ regime: 'kg_absent', reason, notice, marker }` with `reason` `module_not_loaded`, `not_entitled` or `no_data`. Absence is a normal answer. A missing module is detected by the platform refusing the capability document at validation. A probe that cannot tell — an error, or a missing or malformed capability answer — is a tool error with code `kg_probe_failed`, the line to show the operator in `notice`, and `marker`: the state is then unknown, which is never read as absent. Every probe clears the latch.
- **`chain`** reads one class's rules: `{ covered: false, classId }` when the class has none, otherwise `{ covered: true, classId, rules, threats, corpus, ruleMitreRefs }`. A rule is `{ ruleId, name, kind, conditionGroups, malformed?, readAttributes }`, with `malformed` when the stored groups are not an array of arrays. A rule is matched to an exposure by name. `rule_name` narrows the lists; whether the class is covered is decided before it.
- **`evaluate`** runs one rule's recorded condition groups, through the shared evaluator (see [UTILITY_CLASSES.md → Pure subpaths](../modules/UTILITY_CLASSES.md#pure-subpaths-condition-groups-and-remediation-honesty)), against the attribute map the caller supplies; the tool reads no attribute value itself, and an attribute that is not known is left out of the map. It returns `{ covered: true, classId, ruleId, ruleName, evaluatedAt, framing, verdicts, satisfied, unevaluable, deltas }`, where `framing` is the line the result is shown with: the rule's recorded condition evaluated against the supplied values, a counterfactual statement. Group indexes are the same in `chain` and `evaluate`. A rule the class does not have returns `{ covered, classId, rule_found: false }`, with `covered` saying whether the class has any rules.
- A refused session on `chain` or `evaluate` is a tool error naming `login`, not a loss of the graph. Every other failed read is answered as described under [The knowledge-graph latch](#the-knowledge-graph-latch).

#### `get_class_guide`

A class's authored configuration guidance, for the attributes asked about.

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ class_id, element_kind: 'component' \| 'securityBoundary' \| 'dataFlow' \| 'dataItem', attribute_keys: string[] }` — 1 to 100 keys |
| **Output** | `{ entries: [{ optionName, howToObtain: [{ type, instruction, command?, expectedOutput?, source? }], optionDescription?, typicalValues?, valueType? }] }` |
| **dt-core class** | None: the server's own document, one per class type |
| **Approval** | `auto` |

`element_kind` selects the class type whose `guide` is read. Only the entries for the requested keys with at least one usable step are returned. The authored security impact is never copied, so it cannot leave the tool. A missing or malformed guide, or keys with no guidance, return `{ entries: [] }`; a failed platform read is a tool error.

#### The two-phase gate

Nothing reaches the platform from a review until the operator has seen the plan's lines and answered the apply question. The gate has three stages:

1. **Review.** `triage_review` holds the open review in memory (at most 20 per process; one unused for 2 hours expires) and records each reply before it takes effect.
2. **Prepare.** `manage_dispositions` `prepare` checks the closed review and returns a plan: `plan_id` (128 random bits, in hex), `expires_at` and the lines. A plan is held only by the process that prepared it, never written to disk, and a restart forgets it. It expires 30 minutes after `prepare`, commits at most once, and the process holds at most 20 disposition plans, dropping the oldest whose commit is not running. It is bound to its model directory and to a fingerprint: a sha256 over the state of every exposure its ready operations touch (disposition kind, stale flag, definition hash, reason and time, name, score and attack vector).
3. **Commit.** `manage_dispositions` `commit` takes `plan_id`, the lines exactly as `prepare` returned them, and the operator's answer exactly as given.

`commit` runs in this order:

1. **The plan is taken.** `plan_not_found` (another process, or a restart), `plan_expired`, `plan_other_model` (another model directory), `busy` (a commit of it is running), or, for a plan already used, `plan_stale` or `plan_used`.
2. **The lines and the answer are checked.** Lines that are not the plan's, exactly, are refused `lines_differ`. An answer other than `yes` or `cancel` (trimmed, in any letter case; a trailing ` (recommended)` is dropped) is refused `reply_not_answer`. Either refusal is recorded, nothing is written, and the plan stays committable. `reply_not_answer` carries the apply question again in its `data` as `ask`, with the plan's count of ready operations; so does `record_full` when the refused answers are at their cap, since `yes` and `cancel` are still taken. `lines_differ` and every other `commit` refusal carry none.
3. **`cancel`** is recorded, uses the plan up, and writes nothing.
4. **`yes` is recorded first.** An answer the record cannot hold writes nothing (`record_full`, `record_too_large`, `record_unwritable`) and leaves the plan committable.
5. **One at a time.** The commits to one platform model run one at a time in this process.
6. **The targets are read again.** The directory's platform model and its exposures are read once more. A directory that now names another model, a fingerprint that differs, or a copy's name that has appeared on its element since `prepare`, ends the plan as stale: `plan_stale`, with the changed exposures in `changed`, and nothing written. A read that fails writes nothing and leaves the plan committable.
7. **The writes.** The ready operations are written in order, continuing past a failure. Each outcome is `{ index, exposure_id, op, status, kind?, reason?, clone_id?, clone_name?, content_warning?, error?, error_code? }`, with `status`:
   - `applied` — the write took;
   - `failed` — the platform refused it, or it could not be made. A supersede that failed did not mark its source `SUPERSEDED`; a copy that was created all the same is named in `clone_id`;
   - `partial` — a supersede created its copy, but the source was not marked `SUPERSEDED` (or whether it was is unknown), or the copy lacks the source's references, mitigations, detections and tags. The error names the copy; preparing again does not repair it.
8. **The outcome is recorded** on the recorded `yes`: the counts written and failed. A record that cannot be updated then is a warning; the writes stand. The plan is used up, as committed or as failed, and a second commit answers `plan_used`.

```mermaid
stateDiagram-v2
    [*] --> Prepared: prepare
    Prepared --> Prepared: lines_differ, reply_not_answer, record_full, record_too_large or record_unwritable on yes, read failure (nothing written)
    Prepared --> Expired: 30 minutes
    Prepared --> Cancelled: commit, cancel
    Prepared --> Stale: commit, yes, the targets changed
    Prepared --> Committed: commit, yes, every write applied
    Prepared --> Failed: commit, yes, a write failed or was partial
    Cancelled --> [*]
    Stale --> [*]
    Committed --> [*]
    Failed --> [*]
    Expired --> [*]
```

**What the gate does not do:**

- The server cannot tell the operator's `yes` from the model's: the harness's approval prompt for `commit` is the gate.
- A harness's built-in sub-agents, which are not Dethereal's agents, can reach `triage_review`; they write nothing to the platform without the `commit` prompt.
- Two server processes committing to one model do not hold each other back; each re-reads the model before writing.

#### The triage record

`.dethereal/triage-log.json`, in the model directory, is this machine's record of its reviews: every reply a review received, with what it did, and every answer to the apply question.

```typescript
{
  reviews: [{
    review_id, mode, opened_at, groups,          // groups: their count
    replies: [{ at, outcome: { verb } | { refused }, ...text }],
    applies: [{ at, plan_id, ...text,
                outcome: { answer: 'yes' } | { cancelled: true } | { written, failed } | { published, not_stored }
                       | { write_error: true } | { refused } }],
    published?: [{ at, plan_id, analysis_id, exposure_ids, group_of?, not_stored: [{ exposure_id, result }],
                   results, fingerprints: 'open' | 'prepare' | 'publish', unconfirmed? }]
  }]
}
// text: { reply } verbatim, or { reply_start, reply_length, reply_sha256 }
```

- **Verbatim or hashed.** A reply or answer of at most 2,000 characters that is clean text is kept verbatim. A longer one, or one holding invisible or control characters, is kept as its first 200 characters, its length and its sha256.
- **Recorded first.** A reply or an answer takes effect only once it is recorded. A record that cannot be written refuses it, with nothing taken: `record_unwritable` (for a record that cannot be read, the message asks the operator to move it aside and try again), `not_model_dir` (the directory has no `manifest.json`), or one of the caps below.
- **Publishes.** A published review keeps one `published` entry per publish: where it went, its findings and their groups, the module's answer, and when the fingerprints were read; one whose answer never came is `unconfirmed`. `triage_review` `published` reads it.
- **Two refusal codes for the caps.** `record_full` is a count reached; some replies or answers are still taken after it, as the table says. `record_too_large` is the record's size: after it nothing is taken, a closing `done` included.

| Cap | Value | When it is reached |
|-----|-------|--------------------|
| Reviews in the record | 20 | The oldest unpublished review is dropped; the active review never is, and a published review never is (`trimLog`): it is the record of what left this machine. A record that could drop only published reviews refuses `record_full`, asking to move `.dethereal/triage-log.json` aside to keep it |
| Size of the record | 896 KiB | The oldest unpublished reviews are dropped, as above; a reply or answer that would take the active review alone past it is refused `record_too_large` |
| Publishes per review | 5 | `prepare_publish` is refused `record_full` before its question: open a new review |
| Replies per review | 70 | A reply that does not close the review is refused `record_full`, with the review question as `ask`; `done` and `accept-all` are still taken, and a refused reply is answered unrecorded (`recorded: false`) |
| Refused answers per review | 20 | A further refused answer is `record_full`, with the apply question as `ask`; `yes` and `cancel` can still be given |
| Answers per review | 40 | Any further answer is `record_full`: open a new review |

**Kept out of git.** The record and `.dethereal/triage-run/`, where the skill writes its run files (dossiers and batch files) and `tasks` writes the task list, are this machine's. Before the server first writes the record or a task list in a process, and on `query_exposures` `list_model` in the partition view (the view a triage run reads first; the groups and rows views write nothing), it adds the server's per-machine files, `triage-log.json`, `triage-run/` and `hidden-edges-log.json` among them, to the model's `.dethereal/.gitignore`, keeping any line already there; a `.gitignore` it cannot update is a warning. Under `triage-run/` the server writes only the task list (see [`triage_review`](#triage_review) `tasks`).

#### The knowledge-graph latch

The knowledge graph is optional evidence: a failure to read it must not stop the triage that uses it, and must never be taken for a class without rules.

- **The latch.** The first `chain` or `evaluate` read that fails (other than a refused session) latches the server process. That answer is `{ unavailable: true, latched: true, classId, reason, loss_notice, marker }`, `reason` being one redacted line of at most 300 characters (`module_not_loaded` when the platform refused the document at validation). Every later `chain` and `evaluate` answers the same, without `loss_notice`, without asking the platform, until the next `probe` clears the latch. The latch belongs to the process: a new server process starts without it.
- **`kg_chain_unread` is not a latch.** A `chain` or `evaluate` read that returns no rules list is a tool error with code `kg_chain_unread` and `marker`: whether the class has rules is unknown, and the answer is never `covered: false`. The next call asks the platform again.
- **The marker.** `marker`, `[no knowledge-graph evidence]`, comes on every answer that leaves a proposal without graph evidence: `kg_absent`, `kg_probe_failed`, every latched answer and `kg_chain_unread`. The skill copies it into the proposals table as given.
- **The notices.** What the operator is told about the graph is fixed in `src/triage/notices.ts`, shown as written and pinned by a test byte for byte: `KG_NOT_AVAILABLE_NOTICE` (`module_not_loaded`, `not_entitled`), `KG_NO_DATA_NOTICE` (`no_data`), `KG_LOSS_NOTICE` (the read that set the latch) and `kgProbeFailureNotice(cause)` (`kg_probe_failed`). The user guide quotes them in [Triage With and Without the Knowledge Graph](../../user/dethereal/TRIAGE_AND_THE_KNOWLEDGE_GRAPH.md).

| Answer | The graph | Notice | Latch | Marker |
|--------|-----------|--------|-------|:-:|
| `probe`: `kg_present` | Present | -- | Cleared | -- |
| `probe`: `kg_absent`, `module_not_loaded` or `not_entitled` | Absent | `KG_NOT_AVAILABLE_NOTICE` | Cleared | yes |
| `probe`: `kg_absent`, `no_data` | Absent | `KG_NO_DATA_NOTICE` | Cleared | yes |
| `probe`: `kg_probe_failed` | Unknown | `kgProbeFailureNotice(cause)` | Cleared | yes |
| `chain` or `evaluate`: a failed read | Lost for this process | `KG_LOSS_NOTICE`, the first time | Set | yes |
| `chain` or `evaluate`: `kg_chain_unread` | Unknown for this class | -- | Unchanged | yes |
| `chain` or `evaluate`: a refused session | -- (tool error naming `login`) | -- | Unchanged | -- |

### Hidden-Edge Tools

A **hidden edge** is an attack path between two of a model's components that no declared flow shows. The platform's hidden-edges module (`dethernety-hidden-edges`) proposes candidates for a synced model from its exposures, their ATT&CK techniques and its structure; the `hidden-edges` skill has the hidden-edge-analyst argue for and against each one, and puts them to the operator. An accepted edge is written into the local files as a data flow of the class the candidate names, one of the hidden-edges module's data flow classes on the platform, and reaches the platform with the next push. The operator's view of a run is [Reviewing Hidden Edges](../../user/dethereal/HIDDEN_EDGES.md); how the platform computes candidates is the [hidden-edges module architecture](../dethernety-hidden-edges/README.md).

- `hidden_edges` opens a review of the module's candidates, takes the analyst's locators, and reads each of the operator's replies as one command. It writes no model file and nothing on the platform.
- `manage_hidden_edges` writes what a closed review decided, and takes back the accepted edge of a flow being removed, each only after the operator's answer to the apply question.

The design follows the triage tools: a review held in memory, a record written before each reply counts, and a two-phase gate with the plan's lines shown before the apply question (see [The two-phase gate](#the-two-phase-gate)). The module's answer is untrusted input to Dethereal, checked in full before anything is shown.

```mermaid
sequenceDiagram
    participant O as Operator
    participant S as Main session (hidden-edges skill)
    participant H as hidden_edges
    participant M as manage_hidden_edges
    participant P as Platform
    S->>H: open (directory)
    H->>P: read the exposures, call the hidden-edges module
    H-->>S: review_id, header, rows, grammar, ask
    S->>H: evidence (the analyst's locators)
    loop each reply
        S->>O: the result, then ask
        O->>S: one reply
        S->>H: reply, verbatim
        H-->>S: effect and choices, or a refusal, with ask while open
    end
    Note over H: accept-all or done closes the review
    S->>M: prepare (review_id)
    M->>P: read the exposures again
    M-->>S: plan_id, lines, ask
    S->>O: the lines, then ask (the apply question)
    O->>S: yes or cancel
    S->>M: commit (plan_id, lines, reply)
    M->>M: write flows and decisions to the local files
    M->>P: affirm the pending findings of one-by-one accepts
    M-->>S: written, failed, flows, outcomes
```

#### `hidden_edges`

| Property | Value |
|----------|-------|
| **Base class** | `ClientFreeTool` |
| **Input** | `{ action: 'open' \| 'evidence' \| 'reply' \| 'get', directory_path, review_id?, reply?, offset?, evidence? }` — `evidence`, `reply` and `get` take `review_id`; `reply` takes `reply`; `get` takes `offset`; `evidence` takes `evidence: [{ n, locators }]` |
| **Output** | `open`: `{ review_id, header, total, rows, next_offset?, grammar, ask, warnings? }`, or `{ header, total: 0, rows: [] }` with no candidates; `evidence`: `{ review_id, attached }`; `reply`: `{ review_id, effect, choices, closed, row?, ask?, warnings? }`; `get`: `{ review_id, closed, total, rows, next_offset? }` |
| **dt-core class** | None: the server's own documents (the module's candidate query, the model's exposures) |
| **Approval** | `auto`; held by the main session only |

**`open`** runs its reads in this order, holding nothing from an earlier run:

1. The directory names a platform model of the configured platform (`not_synced`, `other_platform`).
2. The model is in sync with no local changes, since the module reads the platform's copy: `push_first` when the files have local changes, `sync_first` when the model was never synced or its state cannot be told.
3. The local model (the gates' own read), the synced component ids in `sync.json`, this machine's decisions (`decisions_unreadable` when the file cannot be read), and the model's exposures.
4. One call of the module's `hiddenEdgeCandidates` query, with the candidate ids a standing decision keeps out (at most 2,000) and pending exposures included. The call is bounded to 40 seconds and a 1 MiB answer. A platform whose schema has no such field refuses the document at validation: the module is `module_not_loaded`. Any other failure, a timeout included, is `module_failed`. Neither is a refusal of `open`: the header carries the module's status, and there are no candidates. A refused session is: the tool error `session_refused`, naming `login`.
5. When the module answered, the hidden-edges module's data flow classes in category `Hidden Edge`, read from the platform by module name (`dethernety-hidden-edges`); Dethereal holds no copy of their ids. When they cannot be read, the module's status is `module_failed` ("the hidden-edge classes could not be read from the platform") and no review opens. Then the answer's checks (below), then the review, which is recorded in the hidden-edge record and held in memory.

**The header** is `{ model, module, regime?, kg_marker?, kg_notice?, table_hash?, counts, decisions, notes? }`. `module` is `{ status, detail?, version? }`, `status` being `answered` or why there is no answer. When the module ran without the knowledge graph (`regime.kg: 'kg_absent'`), `kg_notice` and `kg_marker` are triage's fixed texts (see [The knowledge-graph latch](#the-knowledge-graph-latch)). `counts` holds four numbers: `candidates`, `dropped_by_caps` (the module's own caps), `excluded_by_decision` and `dropped_by_validation`. `decisions` counts the standing `accepted` and `rejected` decisions, the accepts that do not verify here (`not_verified_here`) and the `malformed` entries. A note says when no exposure of the model is confirmed (affirmed or risk-accepted): the candidates then rest on pending or compensated findings only.

**The answer is untrusted.** It is refused whole, with the code as the module's status and no candidates, when it is not JSON or not an object (`answer_invalid`), is not contract 1 (`contract_mismatch`), is an in-band refusal of the module (`module_<code>`), has missing or unknown keys, a malformed version, table hash, regime or counts, more than 200 candidates, a candidate id that is not a string, or names one class for two kinds or two classes for one kind (`answer_invalid`). A candidate a standing decision covers is excluded and counted, whatever the module did with the excluded ids. Any other candidate is dropped and counted under `dropped_by_validation` unless:

- its keys are exact and every value is in its shape and caps (at most 10 techniques, 50 exposures, 50 facts, 10 fields);
- its kind is one of the four hidden-edge kinds, its `class` is exactly `{ id, name }` and its `id` is one of the hidden-edges module's data flow classes read in step 5, and its id is `he:` and the first 16 hex characters of the sha256 of its kind, source and target joined by NUL;
- its ends are distinct components of this model that both the platform (the synced ids) and the local files have, not both external entities;
- every cited exposure is in this run's read, is not disposed (pending, affirmed, risk-accepted or compensated), and is not on a flow of one of the hidden-edges module's classes;
- every fact is a locator: `attributes:<element>#<key>`, `control:<id>`, `exposure:<id>` (an exposure of this run's read), `kg:<id>` or `kg-class:<id>`;
- its fields hold none of the names Dethereal writes itself, and each value is lower-case letters, digits, `_` and `-`;
- it is not a repeat of a candidate already taken.

A candidate whose cited exposures are all pending is `pending_only`; `edgeLifecycle` in `src/hidden-edges/answer.ts` applies the module's rule, so a risk-accepted exposure counts as confirmed and a compensated one as pending.

**The rows** are compact: `{ n, id, kind, edge, tier, kg?, techniques, exposures, base, fields?, facts?, evidence?, pending_only?, in_accept_all, choice }`, names shown cleaned and cut, `kg: 'lowered'` when the knowledge graph lowered the tier, and `base` the three base values (`required_capability`, `required_privilege`, `granted_privilege`). A result carries rows of at most 20,000 characters, at least one; `next_offset` is the next page, read with `get`.

**`evidence`** attaches the analyst's locators to candidates by their numbers: at most 250 items, each with 1 to 10 locators of at most 400 characters. A locator is a place, never a value: `source:<file>:<line>` or `attributes:<file>#<key>`, with a relative path of plain characters and no `.` or `..` segment, `platform:<id>` or `kg:<id>`. The call is all or nothing (`locator_invalid`, `candidate_unknown`, `review_closed`), keeps at most 10 distinct locators per candidate, and returns how many were new. The analyst's stance is not held by the server.

**`reply`** takes one reply exactly as the operator gave it and reads it as one command:

| Command | Effect |
|---------|--------|
| `accept <n>[,<n>…]` · `skip <n>…` · `reject <n>…` | Sets each candidate's choice |
| `show <n>` · `show rejected` | One candidate's row in full; the rejected decisions in the decisions file |
| `edit <n> capability: <v>` | `opportunistic`, `targeted` or `advanced` |
| `edit <n> required: <v>` · `edit <n> granted: <v>` | `none`, `user`, `admin` or `system` |
| `edit <n> <field>: <v>` | A field the module set for this candidate: lower-case letters, digits, `_` and `-`, at most 64 (the class checks the value on push) |
| `edit <n> rationale: <text>` | The operator's rationale, at most 1,000 characters of plain text |
| `accept-all` | Accepts every open candidate that is neither `pending_only` nor edited, and closes the review |
| `done` | Closes the review |

The verb is read in any letter case, and candidate numbers are separated by spaces or commas. A later decision on a candidate replaces an earlier one. An edit marks the candidate edited: it is never in `accept-all`, and an accept of it writes `proposed_by: operator`. A candidate `accept-all` takes is marked as a bulk accept, which affirms nothing. A refused reply changes nothing: `reply_unparsed`, `argument_invalid`, `candidate_unknown` or `review_closed`.

Every reply is recorded before it takes effect, and a reply whose record fails is put back. Once a review has recorded 70 replies, only a reply that closes it is taken. A record that has grown too large to take a reply (`record_too_large`) lets an open review go at once, so a new one can be opened; a closed one is kept for `prepare`.

**The next question comes from the tool**, as in triage: `[prompt: hidden-edges-review] Your command? One command per reply: accept, skip, reject, edit, show, accept-all or done, as the hint above shows.` A successful `open` returns it as `ask`, so does a `reply` that leaves the review open, and so does a refused reply other than `review_closed` while the review is open. The texts are in `src/hidden-edges/asks.ts`, registered with the skill's questions.

**Reviews live in memory**, as triage's do: at most 20 per process, the least recently used dropped first, one unused for 2 hours expired, every one forgotten on a restart (`review_not_found`). A review is bound to its model directory (`other_model`).

#### `manage_hidden_edges`

| Property | Value |
|----------|-------|
| **Base class** | `ClientDependentTool` |
| **Input** | `{ action: 'prepare' \| 'record' \| 'commit', directory_path, review_id?, flow_id?, plan_id?, lines?, reply? }` — `prepare` takes `review_id`; `record` takes `flow_id`; `commit` takes `plan_id`, `lines` and `reply` |
| **Output** | `prepare` and `record`: `{ plan_id, expires_at, count, lines, ask }`; `commit`: `{ plan_id, written, failed, flows?, outcomes?, warnings? }`, or `{ plan_id, cancelled: true, written: 0 }` |
| **dt-core class** | `DtExposure` (`disposeExposure`), through the triage disposition writer, for the affirmations |
| **Approval** | `prompt`, with `requiresUser`; called from the main session only |

**`prepare`** needs a closed review of the same directory (`review_not_found`, `other_model`, `review_open`) that accepted or rejected at least one candidate (`nothing_to_apply`). The directory must still name the review's platform model (`other_model`), the model files and the decisions file must be as the review read them, and so must every exposure the candidates cite (`review_stale`, with the changed exposures in `changed`). A plan whose lines would pass 24,000 characters is refused `echo_too_large`. It writes nothing. Per decided candidate, the plan holds:

- **An accept:** a data flow of the candidate's class, its `classData` `{ id, name, module: { id, name } }` (the platform's class and its module), source to target, named `<Kind>: <source> → <target>`, its description listing the techniques, the cited exposures, the module's facts and the analyst's locators. Its id is `he-` and the candidate id's 16 hex characters, until a push gives it the platform's. Its attribute file holds the module's fields, the three base values as edited, `hidden_edge_kind`, `technique_ids`, `source_exposure_ids`, `proposed_by` (`rule`, or `operator` for an edited candidate), `tier` and, when given, `rationale`. A flow of the same class between the same two ends already in the files (pushed, or written without its decision) is bound to instead: its attribute file is written as shown, and no second flow is made. Then an accepted decision.
- **A one-by-one accept** also affirms each cited exposure that is still pending with no disposition: `AFFIRMED`, with the reason `Affirmed by the accepted hidden edge <ids>` and the marker ` — hidden edge accepted by the operator`. The affirmations are planned with the triage disposition planner, so one the platform would refuse is listed as `Not affirmed (<code>)`. An accept through `accept-all` affirms nothing.
- **A reject:** a rejected decision only. A disposition of a finding it rests on is triage's.

The lines are, in order: the platform model, a summary (`<a> hidden edge(s) to add to the local files, <r> to reject[, <k> exposure(s) to affirm on the platform]`), one `+ [<n>] …` entry per accept with the class its flow is written with (`…; class <name>`), its base values, fields, evidence count and rationale, one `- [<n>] reject …` line per reject, one line per affirmation, and a reminder that new flows reach the platform with the next push. `count` is the decisions plus the ready affirmations, and `ask` is `[prompt: hidden-edges-apply] Apply <count> hidden-edge change(s)? Type yes or cancel.`

**`record`** takes back the accepted edge of a flow the `remove` skill is about to remove. It needs a standing accepted decision of this machine for `flow_id` (`not_hidden_edge` otherwise: the flow is removed as an ordinary one, with nothing recorded) and plans one rejected decision with the same id, kind and ends. Its lines name the edge, say it is recorded as rejected and not proposed again, and list the cited exposures that are `AFFIRMED`, to clear in triage if the edge was their only ground. `count` is 1.

**`commit`** runs the triage gate's order (see [The two-phase gate](#the-two-phase-gate)): the plan is taken (`plan_not_found`, `plan_expired` after 30 minutes, `plan_other_model`, `busy`, or `plan_stale` / `plan_used` for a spent plan); lines that are not the plan's are `lines_differ`, and an answer other than `yes` or `cancel` is `reply_not_answer`, both recorded with the plan left committable; `cancel` is recorded and uses the plan up; `yes` is recorded first; and the commits to one platform model run one at a time in this process. Then:

1. **The plan is held to what it read.** The directory must still name the plan's platform model, the cited exposures must be unchanged, and the model files (for an apply) or the decisions file (for a record) must still hash as at `prepare`; otherwise `plan_stale`, nothing written.
2. **An accept needs this machine's key.** The key that signs the decisions is created here when there is none yet; a key that cannot be used is `key_unavailable`, nothing written: an accepted decision is never written unsigned.
3. **The local writes**, under the model's state lock: the flows' attribute files, then `dataflows.json` (the new flows appended), then the decisions file, each replaced only while its bytes are still what was read (`files_changed` and `flow_exists` refuse before the first write, and end the plan as stale). A flow without its decision counts as an ordinary flow, and a decision is never written for a flow that is not there; an attribute file a failed commit left behind, with no flow of its id, is taken over by the next. The cached quality result is then dropped.
4. **The affirmations**, on the platform, continuing past a failure, with outcomes as `manage_dispositions` reports them.
5. **The outcome is recorded** on the recorded `yes`. A `record` plan appends its rejected decision under the same lock, while the decisions file hashes as read.

`commit`'s result counts the local decisions and applied affirmations as `written`, the failed affirmations as `failed`, and the new flows as `flows`.

#### The hidden-edge decisions

`.dethereal/hidden-edges-decisions.json` is **committed with the model**, so teammates share it: `{ version: 1, decisions: [{ id, kind, source, target, verb, flow_id, technique_ids, exposure_ids, at, mac }] }`. It is read as untrusted input: an entry is used only with exactly these keys, each in its shape, and an id that is its kind's and ends'; the file holds at most 1,500 entries and 960 KiB. An entry that is not well-formed is counted as `malformed` and kept as it is.

- **An accept is signed.** `mac` is an HMAC-SHA256 under a subkey of this machine's key (the one Gate 3 waivers are signed with, kept in the home directory), over the model's hash (bound to the model directory's real path) and the whole entry, its time included, so an older accept cannot come back as new. It counts only where that key verifies it: a teammate's accept, a copied one or a hand edit counts as absent here, and the header counts it as `not_verified_here`.
- **A reject is not signed** (`flow_id` and `mac` are null). It only keeps a candidate out of a review, so it counts on every machine.
- **The latest decision stands.** For each candidate id, the standing decision is the latest, by `at`, of the verified accepts and the rejects (the later in the file on a tie). An unverified accept never stands. A reject's time is not signed: a hand edit can only take an edge back, which makes its flow count as an ordinary one again.
- **A push re-keys the accepts.** When a push gives a hidden-edge flow its platform id, each accept this machine's key verifies under the old id is re-signed with the new one. Any other entry is left as it is, with a warning; like the other sidecars' re-keying, this is best effort (see [SYNC_AND_SOURCE_OF_TRUTH.md → Push Flow](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow)).

#### Hidden edges in the checks

A flow is a hidden edge on this machine when its class is one of the hidden-edges module's classes, told by its class's module (`classData.module.name` is `dethernety-hidden-edges`: a pulled model carries the module on each element's `classData`, and an accepted edge is written with it), **and** a standing, verified accept of this machine names that flow and its two ends (`src/hidden-edges/predicate.ts`). Any other flow, a hidden-edge class set by hand or a teammate's accept included, is an ordinary flow and is never left out of a check.

A hidden edge records an inferred path the operator accepted, not a flow of the system. Its flow stays in the model files, but the checks that read flows leave it out (`ordinaryFlows` in `src/utils/gates.ts`): Gates 1–3 and the component tiers, the lints, the quality score, coverage and zoning in `validate_model_json`, the settlement's drift and the review hash. Each counts what it left out as `hidden_edge_flows` (in the gates report, the quality result's `element_counts` and `model_state` `get`). Adding or removing one is therefore no structural change, and never makes REVIEWED stale. The structure checks still read it, so its attribute file is never an orphan. The derived manifest module list skips the class of a flow that is a hidden edge on this machine (a verified accept for that flow and its ends): the class is the platform's own module's, which a push need not list. A flow that names the hidden-edges module with no accept here is an ordinary flow, and its class's module is listed (see [Manifest Modules](#manifest-modules)).

The class tools keep hidden-edge classes away from ordinary elements, by their module: `match_classes` never offers one, and `get_classes` lists one only when a module or a class id is asked for (see [`get_classes`](#get_classes) and [`match_classes`](#match_classes)).

#### The hidden-edge record

`.dethereal/hidden-edges-log.json` is this machine's record of its hidden-edge reviews and plans, with the triage record's shape and caps (see [The triage record](#the-triage-record)): a review entry has mode `hidden-edges`, and a plan's answers are kept under the review, or, for a `record` plan, under an entry of its own (mode `hidden-edges-record`). It keeps the last 20 entries and stays under 896 KiB; an entry takes at most 70 replies and 40 answers. The server lists it in `.dethereal/.gitignore` with its other per-machine files before it first writes it in a process.

**What the gate does not do** is what the triage gate does not do: the server cannot tell the operator's `yes` from the model's, so the harness's approval prompt for `commit` is the gate; a harness's built-in sub-agents can reach `hidden_edges`, but write nothing without the `commit` prompt; and two server processes committing to one model do not hold each other back.

---

## 7. Data Flow

### Split-File Model Format

```
model-directory/
├── manifest.json       # Schema version, model metadata, module refs (derived)
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

There is no `controls.json`. The canonical file names are fixed by `DEFAULT_FILE_NAMES` in dt-core's manifest schema, which defines exactly the five entries above. Controls ride as a `controls` reference array on the model and its elements inside `manifest.json`, `structure.json`, `dataflows.json` and `data-items.json`, and the control library materialises one file per control under a `controls/` **folder** (`<model-dir>/controls/{controlId}.json`) owned by the `manage_controls` sync state machine. Hand-writing a top-level `controls.json` has no effect — no reader looks for it.

**Data items' controls.** A data item can carry controls. Once its `controls` list is non-empty, the review content hash includes it (by control name, read the way a push matches it and once, as for the other elements), and so do the settlement's record of the item and the item's waiver fingerprint. A data item without controls reads exactly as before. A model already `REVIEWED` whose data items gain controls therefore reads its review as stale once. On any element, a `controls` value that is not a list, or an entry in it that is not a control entry (a string, a number, `null`, a nested list), is kept in the hash as it is written, so writing or changing one makes a review stale. A control entry with no string `name`, or a name that is empty once normalised (blank, or only zero-width characters), counts as an unnamed control rather than dropping out, so adding or removing one moves the hash. An unnamed entry is hashed as its own marker, so a control actually named "Control" does not read like one, and unnamed entries are not merged: each one counts, since two of them may be two different controls. The hash reads control names only, never ids, so changing only an entry's id does not move it. It reads each name through dt-core's `normaliseControlName`, the function a push's [strict control resolution](../dt-core/IMPORT_EXPORT.md#strict-control-resolution) compares names with: NFC-normalised, stripped of zero-width characters (U+200B–U+200D, U+2060, U+FEFF) and trimmed. Case matters, as it does for the push, and each distinct name counts once. Changing only a name's Unicode form, its zero-width characters or its surrounding spaces, or adding a second entry with the same name, does not move the hash: that is what a push rewrites when it writes the platform's spelling back and returns a control listed twice once. As an accepted limit, a second entry whose name normalises equal to an existing one does not move the hash even when its id links a different catalog control: two catalog controls can share a name, which alone cannot link either of them but an id can, and the hash cannot tell the same control listed twice from two controls with the same name without reading the catalog. Changing a name's case still moves it, since under strict matching that can be another control, and so does any other rename, or adding or removing a different control. An absent or empty list, or a list of control entries whose names are distinct once normalised and already NFC with no zero-width characters, hashes as before (the hash already trimmed names, so surrounding spaces alone never moved it). A model already `REVIEWED` that holds any malformed `controls` value, an unnamed control entry, a repeated name, or a name that normalisation changes beyond trimming (such as a decomposed Unicode form, or zero-width characters other than a byte-order mark at either end) reads its review as stale once; a waiver granted on such an element lapses once too, since its fingerprint is computed from the same record, and has to be granted again. A push that links a data item's control by name writes the linked id into `data-items.json`, as it does for components and flows. The hash also covers the controls linked to the model itself (`manifest.json` `model.controls`) and to the root boundary (`structure.json` `defaultBoundary.controls`, which has no record of its own), by name and under the same rules as an element's controls. Absent, `null` or an empty list, they drop out, so a model without them hashes as before; a model already `REVIEWED` that holds either reads its review as stale once. Waivers are unaffected: no Gate 3 criterion fails on the model or on a boundary, so no waiver can target either.

### Manifest Modules

The server derives `manifest.json`'s `modules` list, so it does not need to be written by hand. The derived list holds, in this order, deduplicated by module id (the first name seen wins) and written as `{ id, name }`:

1. the well-formed entries `manifest.json` already lists, in file order;
2. the scope's `activeModules` (`.dethereal/scope.json`), in scope order;
3. the module of every class the model uses — on components, boundaries, data flows and data items — sorted by module name, then id.

Derivation only adds. A module leaves the list only when it is deliberately edited out of `manifest.json`, with neither the scope nor a class of the model still bringing it in. An update push sets the platform model's modules to exactly this list.

**A class's module** comes from its class-cache entry (`.dethereal/class-cache/<class id>.json` records `module: { id, name }`, written by [`generate_attribute_stubs`](#generate_attribute_stubs) from the platform), else from the elements' `classData.module` (a pulled model carries it). An entry cached before the cache recorded modules has none; `generate_attribute_stubs` with platform access refreshes it.

**What cannot be derived fails Gate 2.** Each gap is a `manifest_complete` failure, named by class (with the elements that use it) or by file:

| Reason | Meaning |
|--------|---------|
| `module_unknown` | Neither the class cache nor the elements name a module for the class |
| `module_conflict` | The class cache and the elements, or two elements, name different modules for the class |
| `scope_unreadable` | `.dethereal/scope.json` could not be read, so its `activeModules` are unknown |
| `scope_module_invalid` | An `activeModules` entry is not `{ id, name }` |
| `manifest_module_invalid` | A `manifest.json` `modules` entry is not `{ id, name }` |

A well-formed entry has an id of the module-id shape (a letter or digit, then up to 127 letters, digits, `.`, `_`, `:` or `-`) and a non-empty name of at most 200 characters with no control characters. An empty derived list still fails as `manifest lacks modules`. The failure's remedy names the fix: refresh the class's cache entry, fix or remove the malformed entry, or, with nothing to derive from, confirm the model's modules into the scope's `activeModules`.

**Reading never writes.** Every gate reads the derived list in memory — `model_state` (`get`, `transition`), `validate_model_json`'s gates, `model_state_waive` and `model_state_settle` — and none of them writes `manifest.json`. When the file's list differs from the derived one, `model_state` `get` reports both as `manifest_modules: { on_disk, derived }`.

**Pushes write it, last.** `import_model` and `update_model` gate and send the derived list, and write it into `manifest.json` only after every refusal has passed (Gate 2; pending enrichment and the settlement, with the settlement on; for `update_model`, the platform-change check), after the backup (which keeps the file as it was) and just before the platform call. The file is rewritten only when its list differs, and only if it still holds the bytes the push read; otherwise the push refuses ("manifest.json changed while the push was being prepared, so nothing was pushed. Push again."), as it does when the file cannot be read back. A refused push leaves the directory byte-identical. `update_attributes` gates the derived list but never writes it, since it sends no modules. `create_threat_model` judges its inline model's own list; the target directory's module gaps do not apply to it.

**Machine-derived, not the operator's.** The list is never registered or settled, and writing it never creates an unregistered value: `manifest.json` is not a settlement target (the only manifest value the settlement tracks is the model's controls). The review content hash covers the modules as a sorted set of ids, so the platform's order and names on a pull never make a review stale.

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
                     │                │           attributes/*
                     │                │
                     │                ▼
                     │           Write sync.json
                     │           (platform_model_id,
                     │            platform_url,
                     │            last_pull_at,
                     │            pull_content_hash,
                     │            baseline_element_ids)
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

ID mapping is applied to all files in the directory (manifest, structure, dataflows, data-items, attribute files). Cross-references within the model (e.g., data flow source/target component IDs) are updated consistently.

### Sync Metadata (`sync.json`)

Written to `<model-directory>/.dethereal/sync.json` after each push/pull operation:

```json
{
  "platform_model_id": "abc-123-def-456",
  "platform_url": "https://dethernety.example.com",
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
  "referenced_models": ["xyz-789"]
}
```

Each pull and push also records `platform_baseline`, the signed fingerprint of the platform model that the next push's [platform-change check](#update_model) compares against.

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
| `DtClass` | `match_classes`, `generate_attribute_stubs`, `get_classes` | Class catalog matching and class template fetching |
| `DtExposure` | `query_exposures` (`list`, `get`), `manage_dispositions`, `manage_hidden_edges` (affirmations) | Read platform-computed exposures; write, clear and renew dispositions, and read a source's technique links for a supersede |
| `DtControl` | `manage_controls`, `query_controls`, `get_control_gaps`, `validate_model_json` (online `coverage`) | Writing, assigning, listing, reading and ranking security controls; model-wide control gap analysis |
| `DtControlLibrary` | `manage_controls` (control-library actions) | Control-library sync with the per-control files under `controls/` |
| `DtCountermeasure` | `manage_countermeasures`, `query_countermeasures` | Write and read the countermeasures that link controls to exposures |
| `DtMitreAttack` | `search_mitre_attack` (the browsing actions) | ATT&CK technique search and browsing |
| `DtMitreDefend` | `get_mitre_defend` | D3FEND technique browsing |
| `DtAnalysis` | `manage_analyses` | Analysis lifecycle (create, run, poll, results) |
| `executeSupersedeFlow` (a dt-core function) | `manage_dispositions` (supersede) | Create the user-authored copy, set its content, and mark the source `SUPERSEDED` |

### The server's own read documents

dt-core has no class for some reads, so the server sends its own GraphQL documents for them. Each is a read; every platform write still goes through dt-core.

| Document | Source | Used by |
|----------|--------|---------|
| Platform capability probe (`Data.controls`) | `src/client/platform-capabilities.ts` | The check before a gated call (see [Tool Execution Flow](#tool-execution-flow), step 6) |
| A model's exposures in one read; one exposure's evidence | `src/triage/exposures.ts` | `query_exposures` `list_model` and `evidence`, `triage_review` `open`, `manage_dispositions`, `hidden_edges` `open`, `manage_hidden_edges` |
| The hidden-edges module's candidates (`hiddenEdgeCandidates`) | `src/hidden-edges/platform.ts` | `hidden_edges` `open` |
| The technique ids a supersede adds | `src/triage/dispositions.ts` | `triage_review` `open`, `manage_dispositions` `prepare` |
| Knowledge-graph capability (`kgCapability`) and one class's rules (`kgRules`) | `src/triage/kg.ts` | `get_kg_chain` |
| A class's guide, one document per class type | `src/tools/get-class-guide.tool.ts` | `get_class_guide`, `triage_review` `tasks` |
| Exact ATT&CK and ATLAS technique lookup; the matching cascade (`matchMitreTechniques`) | `src/tools/search-mitre-attack.tool.ts` | `search_mitre_attack` `lookup` and `match` |

The knowledge-graph documents select only fields that a remotely served graph declares as well, so the same documents validate on every deployment that has a knowledge graph.

### Apollo Client Configuration

```typescript
// Created with the OAuth access token as the bearer
// When authDisabled, accessToken is omitted and no Authorization header is sent
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (accessToken) {
  headers.Authorization = `Bearer ${accessToken}`
}

const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: graphqlEndpoint,     // derived from the platform config
    fetch,
    headers
  }),
  cache: new InMemoryCache(),
  defaultOptions: {
    query: { fetchPolicy: 'no-cache', errorPolicy: 'none' },
    mutate: { fetchPolicy: 'no-cache', errorPolicy: 'none' }
  }
})
```

`buildToolContext()` asks `createApolloClient()` for a client on every platform tool call, and the factory keeps one client, keyed by its bearer (or by a fixed key for the unauthenticated client in auth-disabled mode), reusing it while the key is the same; a refreshed token replaces it, so no stale bearer stays pinned. `logout` clears that cache. Queries and mutations do not use the Apollo cache (`fetchPolicy: 'no-cache'`), and `errorPolicy: 'none'` makes a GraphQL error reject with its message instead of resolving as empty data.

### Platform Configuration

Fetched from `{DETHERNETY_URL}/config` (the backend's runtime config endpoint):

```typescript
interface PlatformConfig {
  authDisabled?: boolean      // True when auth is disabled (no-auth mode)
  oidcIssuer: string          // OIDC provider issuer URL
  oidcClientId: string        // OIDC client identifier
  oidcDomain: string          // Cognito hosted UI domain (Cognito only)
  oidcRedirectUri: string     // Default redirect URI (dethereal uses localhost instead)
  oidcProvider: string        // Provider type: cognito, keycloak, auth0, zitadel, generic
  oidcScope?: string          // Scope to request at login (default: "openid profile email")
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
| **Token Expiration** | Access and refresh-token lifetimes are set by the OIDC provider's configuration. `logout` removes the local session, then revokes its refresh token at the session's own identity provider (RFC 7009) |
| **Token Resolution** | Stored token (keyed by `baseUrl`) → transparent refresh if expired → auth-disabled fallback. No argument-level tokens (D61) |
| **Transparent Token Refresh** | When the access token has expired and the provider has not rejected the refresh token, `buildToolContext()` refreshes before creating the Apollo client, bounded to 10 seconds; a rejection is recorded (`refreshRejected`) and that session is never refreshed again |
| **Expiry Check** | The stored `expiresAt`, with a 60-second buffer, decides whether a token is used; the JWT is not decoded for this |
| **Credential Isolation** | Session tokens never reach the model: no tool takes a credential as input or returns token material or the token-store path; skills use `auth_status` instead of reading the token file; tool results and stderr are redacted of every registered session token (D69) |
| **Auth-Disabled Mode** | For no-auth deployments only; backend creates mock user for unauthenticated requests |

### API Security

| Mechanism | Implementation |
|-----------|----------------|
| **JWT Validation** | All GraphQL requests include Bearer token (validated by backend) |
| **URL Policy** | The platform URL must use HTTPS unless its host is `localhost`, `127.0.0.1` or `::1`; it may not carry a user name or password; and plain HTTP is refused while Node's environment proxy is on (`NODE_USE_ENV_PROXY`, or `--use-env-proxy` in `NODE_OPTIONS` or on the command line). The server starts anyway, so the harness does not show it as missing, but every platform tool reports the problem instead of reaching the network; `auth_status`, `logout` and the local tools still run (D61) |
| **Runtime Trust** | A Node runtime that could expose the bearer is refused the same way: a trust anchor, OpenSSL configuration or TLS key log the agent could have planted, or TLS checks turned off (`tls`); or code loaded before the server started — a preload, an inspector, a library injected by the loader (`tripwire`, which asks for the session to be signed out and revoked). `logout` then removes the local session but sends nothing |
| **Writes Through dt-core** | Every platform write goes through dt-core classes; the server's own documents are parameterized reads (see [The server's own read documents](#the-servers-own-read-documents)) |
| **Input Validation** | Zod schema validation on all tool inputs before execution |

### File System Security

| Mechanism | Implementation |
|-----------|----------------|
| **Backup Before Modify** | Timestamped backups on import/update (when `create_backup: true`) |
| **Path Containment** | `directory_path` must resolve, symlinks included, inside the project root, or inside a model directory registered in `~/.dethernety/models.json` `paths` (an absolute path that holds a `manifest.json`). The project root is `DETHEREAL_PROJECT_ROOT`, else `CLAUDE_PROJECT_DIR`, else the nearest directory at or above the working directory that holds `.dethernety/` or `.git`, else the working directory; the filesystem root, the home directory and its parents are never a root. Enforced by `validatePathConfinement()` (`utils/path-confinement.ts`) before file I/O (D61) |
| **No Arbitrary Execution** | Tools only read/write model files and sync metadata |
| **Protected Attribute Files** | An attribute file that fails to parse is never written over, renamed over, or unlinked — see below |
| **Token File Permissions** | `~/.dethernety/tokens.json` is written atomically with `0600` permissions; its directory must be a real directory owned by the current user (otherwise the store refuses) and is re-tightened to `0700` before every change |

**Protected attribute files.** An attribute file that cannot be parsed still holds enrichment that was never pushed, so overwriting it with the platform's copy destroys work. The invariant every mutation path under `attributes/` honours is: **a protected path is never written over, renamed over, or unlinked.**

The protected set is built from what the read reported (`protectedAttributeFiles(issues)`) and threaded into every write path — there are three (`writeAttributes`, `updateAndRenameAttributes`, `cleanupStaleAttributeFiles`), and guarding only one leaves the file just as destroyed by the other two. Unreadable files are excluded from push, merge-back, and coverage instead of being silently replaced. Comparison is case-folded so the guarantee also holds on case-insensitive filesystems; the cost is over-protection (a genuinely stale file may survive), which is the right direction to be wrong in.

> Any new write path under `attributes/` must accept and honour the protected set, or it reintroduces the destroy-on-next-push bug.

### OAuth Callback Security

| Mechanism | Implementation |
|-----------|----------------|
| **PKCE code exchange** | `code_verifier`/`code_challenge` prevents code interception from being useful |
| **`state` parameter** | Generated alongside PKCE codes. Validated on callback receipt — callbacks with missing or mismatched `state` are rejected to prevent CSRF-based code injection (D61) |
| **Callback server lifetime** | Closes after the callback, on cancellation, or 5 minutes after it started; `login` itself returns after `wait` seconds |
| **Fixed port** | Port 9876 required by OIDC providers that restrict redirect URIs |
| **Path restriction** | Server answers only `/start` and `/callback`, only to requests carrying the Host of the bound loopback port (DNS rebinding), and refuses web subresource requests by their fetch metadata |

### Exposure Management Security

The MCP server never creates, edits or deletes a platform-computed exposure: they are derived by the platform's policies, and plugin-written exposures would put unverified claims in the analysis evidence chain. What it writes about one is the platform's own decision record, through `manage_dispositions`: a disposition, and for a supersede the user-authored copy the platform's supersede flow creates. `manage_hidden_edges` writes one disposition kind, `AFFIRMED`, for the pending findings a hidden edge accepted one by one rests on. Those writes go through the [two-phase gate](#the-two-phase-gate) only, after the operator's `yes`. An accepted hidden edge is a flow in the model files, which the platform evaluates after a push like any flow; the plugin writes no exposure for it.

### Approval Display

A tool that asks for approval is only as safe as what the operator is shown, and on some harnesses the approval dialog does not show a call's values (the Codex and OpenCode dialogs do not show the values `model_state_settle` registers). The plugin therefore never relies on the dialog: on every harness, the display is the chat's confirmation table — for `model_state_settle` also the result's echo, and for `model_state_prune` the table of files the operator confirmed — see [`model_state_settle`: The chat table is the display](#model_state_settle). For `manage_dispositions` and `manage_hidden_edges` the display is the plan's lines, which the conversation shows before the apply question and which `commit` must pass back exactly as `prepare` (or `record`) returned them (see [The two-phase gate](#the-two-phase-gate)).

---

## 10. Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DETHERNETY_URL` | No | `http://127.0.0.1:3000` | Platform base URL. Wins over every other source when set |
| `DETHERNETY_PLATFORM_URL` | No | -- | Default platform base URL: the Claude Code plugin's `platform_url` user config (set by the plugin's MCP registration), or on Codex and OpenCode the URL the installer wrote into the server entry |
| `CLAUDE_PLUGIN_OPTION_PLATFORM_URL` | No | -- | The same user config as Claude Code passes it to plugin hooks, which run without the server's env block |
| `DEBUG` | No | `false` | Enable debug logging to stderr (`true` only) |
| `DETHEREAL_PROJECT_ROOT` | No | -- | The project root model paths are confined to; an absolute path to an existing directory, and a bad value is an error. Without it, see **Path Containment** in [§9](#file-system-security) |
| `DETHEREAL_SETTLEMENT` | No | off | `on` turns the settlement on; unset, or any other value, leaves it off (another value is reported on stderr at start). See [Settlement Switch](#settlement-switch) |

The URL is resolved in that order (`src/config.ts`); a value that is still an unsubstituted `${...}` placeholder, or empty, counts as unset.

### MCP Server Registration

**Claude Code** (the plugin's `bundles/claude/.mcp.json`, named by `mcpServers` in `.claude-plugin/plugin.json`; both are generated — see [PLUGIN_ARCHITECTURE.md §2](PLUGIN_ARCHITECTURE.md#2-plugin-structure)):

```json
{
  "mcpServers": {
    "dethereal": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "DETHERNETY_PLATFORM_URL": "${user_config.platform_url}"
      }
    }
  }
}
```

The plugin root is the npm package root, so the plugin runs the server build it ships. `dist/` bundles every runtime dependency: no install step, no `npx`.

> **Release invariant:** the plugin's prompts and the server they call ship in the same package and are always the same version — there is no separate server version to pin. The manifest's `version` must equal `package.json`'s (a test enforces it); after a version bump, regenerate the manifest with `pnpm golden:update` before publishing.

**Codex** and **OpenCode** are registered by `dethereal install --harness codex,opencode`, which runs the server from the installer's runtime copy with the recorded Node binary and writes each harness's approvals from the tool manifest; see [PLUGIN_ARCHITECTURE.md → Installer and Runtime](PLUGIN_ARCHITECTURE.md#installer-and-runtime). The templates, from `bundles/codex/config.fragment.toml` and `bundles/opencode/mcp.fragment.json` (the installer fills in the placeholders):

```toml
# Codex: config.toml (user, or a trusted project's .codex/)
[mcp_servers.dethereal]
command = "<node-abs>"
args = ["<runtime>/dist/index.js"]
env = { DETHERNETY_PLATFORM_URL = "<platform-url>" }
env_vars = ["NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "DEBUG", "DETHERNETY_URL", "DETHEREAL_SETTLEMENT"]
startup_timeout_sec = 30
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"

[mcp_servers.dethereal.tools.auth_status]
approval_mode = "approve"
# ... one such table per `auto` tool
```

```json
{
  "mcp": {
    "dethereal": {
      "type": "local",
      "command": ["<node-abs>", "<runtime>/dist/index.js"],
      "environment": { "DETHERNETY_PLATFORM_URL": "<platform-url>" },
      "timeout": 60000,
      "enabled": true
    }
  },
  "permission": {
    "dethereal_login": "ask",
    "dethereal_logout": "ask"
  }
}
```

The OpenCode entry goes into the scope's `opencode.json` (or `opencode.jsonc`), with one `ask` rule for each of the 16 `prompt` tools (two shown), and a rule that denies the built-in `explore` agent every `dethereal_*` tool.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dethereal": {
      "command": "node",
      "args": ["/path/to/dethereal/dist/index.js"],
      "env": {
        "DETHERNETY_URL": "https://dethernety.example.com",
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
      "args": ["@dether.net/dethereal"],
      "env": {
        "DETHERNETY_URL": "https://dethernety.example.com"
      }
    }
  }
}
```

---

## 11. History

This architecture grew out of the earlier, smaller MCP server described in [ARCHITECTURE.md](ARCHITECTURE.md). The upgrade kept the base classes, the auth module, the Apollo client and the MCP protocol layer, and added the platform tools for listing models, browsing MITRE ATT&CK and D3FEND, controls, countermeasures, exposures and analyses, together with `sync.json` and the `quality` action of `validate_model_json`. The tool surface has kept growing since; [Tool Categories](#tool-categories) lists the tools registered today. The decisions that shaped it are recorded in [DECISIONS.md](DECISIONS.md), among them D24 (`get_mitre_defend`), D25 (exposures are read-only), D26 (`search_mitre_attack`) and D28 (`manage_countermeasures`). The triage tools came with the `triage` skill; [ADR-014](../decisions/014-open-source-triage-and-evaluator.md) records why they are part of this server, and why their condition-group evaluator lives in dt-module. The hidden-edge tools came with the `hidden-edges` skill and reuse the triage tools' record, plan store and disposition writer.

---

## Related Documentation

- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Full plugin specification (skills, agents, hooks, settings)
- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — End-to-end workflow that orchestrates these tools
- [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) — Sync architecture (dual-authority model, conflict taxonomy, push flow)
- [Hidden-edges module](../dethernety-hidden-edges/README.md) — How the platform computes hidden-edge candidates
- [ARCHITECTURE.md](ARCHITECTURE.md) — Pre-upgrade MCP server snapshot, superseded by this document
- [User Guide](../../user/dethereal/README.md) — End-user documentation
- [dt-core](../dt-core/) — Data access layer architecture
- [Backend Architecture](../backend/BACKEND_ARCHITECTURE.md) — GraphQL API
