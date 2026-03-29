# CLAUDE.md — Dethereal (MCP Server + Claude Code Plugin)

TypeScript MCP server and Claude Code plugin for AI-integrated threat modeling via the Dethernety platform. ESM-only. Architecture docs: `docs/architecture/dethereal/`.

## Development

```bash
pnpm dev       # Development mode (MCP server)
pnpm build     # Build
pnpm test      # Vitest (src/**/*.test.ts)
```

Bin entry: `dethereal` (CLI executable via shebang)

### Plugin Testing

```bash
claude --plugin-dir oss/apps/dethereal    # Test plugin locally
/reload-plugins                            # Reload after changes (inside session)
```

## Plugin Structure

```
oss/apps/dethereal/
├── .claude-plugin/plugin.json    # Plugin manifest
├── .mcp.json                     # MCP server configuration
├── settings.json                 # Plugin settings (no default agent)
├── agents/                       # 4 threat modeling agents
├── skills/                       # Slash command workflows (14 skills)
├── hooks/hooks.json              # Lifecycle hooks
├── scripts/                      # Hook and helper scripts
├── docs/                         # Guidelines (core + layout)
├── src/                          # MCP server TypeScript source
└── dist/                         # Compiled output
```

## Agents

| Agent | Purpose | Effort |
|-------|---------|--------|
| `threat-modeler` | Primary modeling — creates/edits threat models | high |
| `infrastructure-scout` | Read-only codebase discovery | medium |
| `security-enricher` | MITRE ATT&CK/D3FEND enrichment, security attributes | high |
| `model-reviewer` | Read-only quality auditing and readiness assessment | medium |

No default agent (D64). Users invoke via skills or `@dethereal:agent-name`.

## Skills (Slash Commands)

### Foundation (Sprint 2)
| Skill | Description |
|-------|-------------|
| `/dethereal:status` | Connection status, auth state, local model summary |
| `/dethereal:login` | Browser-based OAuth authentication |
| `/dethereal:help` | Context-aware command list with suggestions |
| `/dethereal:view` | Model summary (tree/json/yaml format) |

### Modeling (Sprint 3)
| Skill | Description |
|-------|-------------|
| `/dethereal:create` | Create or import a new threat model |
| `/dethereal:discover` | Auto-discover infrastructure from codebase |
| `/dethereal:add` | Add components, boundaries, flows incrementally |
| `/dethereal:remove` | Remove elements with dependency checking |

### Classification & Enrichment (Sprint 4)
| Skill | Description |
|-------|-------------|
| `/dethereal:classify` | Assign classes with two-pass classification and crown jewel tagging |
| `/dethereal:enrich` | Security attributes, MITRE ATT&CK, credentials, monitoring tools |

### Sync (Sprint 5)
| Skill | Description |
|-------|-------------|
| `/dethereal:sync` | Push/pull model to/from platform, sync status |

### Review & Integration (Sprint 6)
| Skill | Description |
|-------|-------------|
| `/dethereal:review` | Quality dashboard, structural validation, readiness assessment |
| `/dethereal:surface` | Attack surface summary with control gap analysis |
| `/dethereal:threat-model` | Guided end-to-end threat modeling workflow |

## Hooks

| Hook | Event | Script |
|------|-------|--------|
| First-session orientation | `SessionStart` | `scripts/first-session-check.sh` |
| Auto-validate after edits | `PostToolUse` (Write\|Edit) | `scripts/post-write-validate.sh` |
| Context preservation | `PreCompact` | `scripts/pre-compact-summary.sh` |

## MCP Server Architecture

- Entry: `src/index.ts` — MCP Server v3.0.0 + Stdio transport
- Config: `src/config.ts` — validation, HTTPS enforcement, debug mode

### Tools (`src/tools/`) — 20 total

| Category | Tools |
|----------|-------|
| Auth (3) | login, logout, refresh_token |
| Reference (2) | get_model_schema, get_example_models |
| Validation (1) | validate_model_json (validate + quality score) |
| Model CRUD (5) | create_threat_model, import_model, export_model, update_model, list_models |
| Elements (3) | get_classes, update_attributes, generate_attribute_stubs |
| MITRE (2) | search_mitre_attack, get_mitre_defend |
| Security (3) | manage_exposures, manage_controls, manage_countermeasures |
| Analysis (1) | manage_analyses |

### Auth (`src/auth/`)

OAuth 2.0 PKCE flow. Auth strategy: stored-token → transparent-refresh → auth-disabled fallback.

### GraphQL Client

`src/client/apollo-client.ts` — Apollo Client with auth headers for communicating with dt-ws.

## Guidelines

Split into two files (D47):
- `docs/guidelines-core.md` (~3KB) — always loaded by threat-modeler agent. Component types, boundary hierarchy, state management schemas.
- `docs/guidelines-layout.md` (~2KB) — loaded only during editing skills. Coordinates, handles, sizing.

The MCP tool `get_model_schema` retains its own copy for backward compatibility with external clients.

## State Management

- **`.dethernety/`** (project root) — model registry (`models.json`), plugin config
- **`.dethereal/`** (per-model) — workflow state (`state.json`), quality cache (`quality.json`), scope (`scope.json`), sync metadata (`sync.json`)
- 6 workflow states: INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE → ENRICHING → REVIEWED
