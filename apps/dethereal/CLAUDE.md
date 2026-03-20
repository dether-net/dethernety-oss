# CLAUDE.md — dethereal (MCP Server)

TypeScript MCP server for Claude/AI integration via Model Context Protocol. ESM-only. Architecture docs: `docs/architecture/dethereal/`.

## Development

```bash
pnpm dev       # Development mode
pnpm build     # Build
pnpm test      # Vitest (src/**/*.test.ts)
```

Bin entry: `dethereal` (CLI executable via shebang)

## Architecture

- Entry: `src/index.ts` — MCP Server + Stdio transport
- Config: `src/config.ts` — validation and debug mode

### Tools (`src/tools/`)

10+ pluggable tools implementing the ToolContext interface from `src/tools/base-tool.ts`:

create-model, update-model, validate-model, get-schema, get-classes, get-examples, import-model, export-model, update-attributes

### Auth (`src/auth/`)

OAuth 2.0 PKCE flow for authenticating with the Dethernety platform:
- `oauth-flow.ts` / `oauth-server.ts` — PKCE authorization flow with local callback server
- `token-store.ts` — Persistent token storage with expiry
- `platform-config.ts` — Platform configuration caching
- `browser.ts` — Browser launch for auth

Auth strategy chain: token-from-args → stored-token → auth-disabled fallback

### GraphQL Client

`src/client/apollo-client.ts` — Apollo Client with auth headers for communicating with dt-ws.
