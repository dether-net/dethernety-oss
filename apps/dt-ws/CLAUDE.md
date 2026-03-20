# CLAUDE.md — dt-ws (Backend)

NestJS + Apollo Server + Bolt/Cypher backend API. Architecture docs: `docs/architecture/backend/`.

## Development

```bash
pnpm dev           # NestJS dev server on http://localhost:3003 (--watch)
pnpm build         # Build
pnpm test          # Jest unit tests (*.spec.ts)
pnpm test:e2e      # E2E tests (test/jest-e2e.json)
pnpm test:watch    # Watch mode
pnpm test:cov      # Coverage
pnpm generate:noauth-schema  # Generate auth-disabled GraphQL schema variant
```

## Bootstrap (`src/main.ts`)

- 1MB JSON/URL-encoded request limit
- Global ValidationPipe: whitelist, forbid non-whitelisted, transform
- Security headers (CSP, HSTS, X-Frame-Options) in production only
- Dynamic CORS with OIDC domain support
- Graceful shutdown on SIGTERM/SIGINT
- Log levels: production (error/warn/log), dev (all including debug/verbose)

## Key Directories

- `schema/schema.graphql` — Main GraphQL schema (~40KB), maps 1:1 to graph data layer
- `schema/schema-noauth.graphql` — Auth-disabled variant (generated)
- `src/gql/` — GraphQL module: resolvers, services, schema management
- `src/gql/gql.module.ts` — GraphQL module configuration
- `src/gql/services/schema.service.ts` — Dynamic schema builder
- `src/database/` — Bolt/Cypher (Neo4j/Memgraph) driver
- `src/modules/` — Module loading and registry
- `src/config/environment.validation.ts` — Environment variable validation

## Module Loading

ModuleRegistryService loads modules from `custom_modules/` at startup and registers them in the graph database. Modules provide component classes, controls, exposures, and analysis capabilities.
