# CLAUDE.md

This file provides guidance to Claude Code when working with the Dethernety open-source project.

## Project Overview

Dethernety is an AI-integrated cybersecurity threat modeling framework. It combines interactive data flow diagram modeling with graph-based analysis, an extensible module system, and MITRE ATT&CK/D3FEND integration.

## Development Commands

```bash
pnpm install              # Install all dependencies
pnpm dev                  # Start all development servers
pnpm build                # Build all packages and apps
pnpm lint                 # Run ESLint
pnpm format               # Format with Prettier
pnpm test                 # Run all tests
pnpm m-ingest             # Ingest MITRE framework data
pnpm docker:build         # Build Docker image
pnpm docker:run           # Run Docker container
```

## Architecture

### Frontend (`apps/dt-ui`)
- Vue 3 + Vuetify + Vite
- Vue Flow for drag-and-drop data flow diagram editing
- Apollo Client for GraphQL
- JSONForms for dynamic module configuration
- Pinia stores in `apps/dt-ui/src/stores/`

### Backend (`apps/dt-ws`)
- NestJS + Apollo Server + Bolt/Cypher driver
- GraphQL schema: `apps/dt-ws/schema/schema.graphql`
- Module registry loads modules at startup
- WebSocket/SSE for real-time subscriptions

### MCP Server (`apps/dethereal`)
- TypeScript MCP server for Claude/AI integration via Model Context Protocol
- Threat model CRUD, analysis tools, auth flow

### Shared Packages
- `packages/dt-core` — Core TypeScript interfaces and data access layer (`src/interfaces/core-types-interface.ts`)
- `packages/dt-module` — Module system base classes and utilities
- `packages/eslint-config` — Shared ESLint configuration
- `packages/typescript-config` — Shared TypeScript configuration

### Modules
- `modules/dethernety-module` — Default module with component classes, controls, exposures
- `modules/mitre-frameworks` — MITRE ATT&CK and D3FEND data + ingestion scripts

### Database
- Bolt/Cypher compatible (Neo4j or Memgraph)
- Schema defined in `apps/dt-ws/schema/schema.graphql`

## Key Patterns

- GraphQL API maps 1:1 to graph data layer
- Modules are runtime-loaded JavaScript classes with full platform access
- Authentication via OIDC/JWT tokens validated at every hop
- Frontend uses runtime configuration (no build-time env injection)

## Important Files

- `apps/dt-ui/src/main.ts` — Frontend entry point
- `apps/dt-ws/src/app.module.ts` — Backend main module
- `apps/dt-ws/src/gql/services/schema.service.ts` — Dynamic GraphQL schema builder
- `packages/dt-core/src/interfaces/core-types-interface.ts` — Core type definitions

## Documentation

Architecture documentation lives in `docs/architecture/`:

| Path | Description |
|------|-------------|
| `docs/architecture/README.md` | Platform architecture overview (start here) |
| `docs/architecture/frontend/` | Vue.js frontend architecture and LLD |
| `docs/architecture/backend/` | NestJS backend architecture and LLD |
| `docs/architecture/dt-core/` | Shared data access layer |
| `docs/architecture/modules/` | DTModule system and development guide |
| `docs/architecture/dethereal/` | MCP server architecture |
| `docs/architecture/decisions/` | Architecture Decision Records (ADR 001–006) |

Other documentation:
- `docs/CONFIGURATION_GUIDE.md` — Environment and deployment configuration
- `docs/GLOSSARY.md` — Project terminology
- `docs/SECURITY_MODEL.md` — Security architecture and trust model
- `docs/user/` — End-user guides

## Build Tools

- **pnpm** workspaces for monorepo package management
- **Turborepo** for build orchestration (`turbo.json`)
- **Vite** for frontend builds
- **NestJS CLI** for backend builds
