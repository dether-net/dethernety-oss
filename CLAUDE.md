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

### Shared Packages
- `packages/dt-core` — Core TypeScript interfaces (`src/interfaces/core-types-interface.ts`)
- `packages/dt-module` — Module system base classes and utilities

### Modules
- `modules/dethernety-module` — Default module with component classes, controls, exposures
- `modules/mitre-frameworks` — MITRE ATT&CK and D3FEND data + ingestion scripts

### Database
- Bolt/Cypher compatible (Neo4j or Memgraph)
- Schema documented in `docs/schema.md`

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

- `docs/how-it-works.md` — Core concepts and workflow
- `docs/CONFIGURATION_GUIDE.md` — Environment variables and setup
- `docs/schema.md` — Graph database schema reference
- `docs/architecture/` — Architecture documentation

## Build Tools

- **pnpm** workspaces for monorepo package management
- **Turborepo** for build orchestration (`turbo.json`)
- **Vite** for frontend builds
- **NestJS CLI** for backend builds
