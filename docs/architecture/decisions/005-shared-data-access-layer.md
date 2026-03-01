# ADR-005: Shared data access layer (dt-core)

**Status:** Accepted
**Date:** 2025-01-15

## Context

The platform has three TypeScript clients that interact with the GraphQL API: the Vue.js frontend, the NestJS backend (for module operations), and the MCP server. Each client needs the same domain operations -- create a model, list components, run analysis, export data.

Without a shared layer, each client would write its own GraphQL queries and mutation logic. Bugs would need to be fixed in three places. Type definitions would drift. The MCP server (which runs headless for AI agents) would need to reimplement everything the frontend already does.

## Decision

Create a single TypeScript package (`packages/dt-core`) that contains all domain interfaces, GraphQL operations, and data access classes. Every client imports dt-core instead of writing GraphQL queries directly.

The package provides domain classes (`DtModel`, `DtComponent`, `DtBoundary`, `DtDataflow`, `DtControl`, `DtAnalysis`, `DtIssue`, `DtExport`, `DtImport`) that take an Apollo Client instance and expose typed methods. Retry logic, mutex protection for concurrent writes, and request deduplication are built into the package so clients get these for free.

## Consequences

**Positive:**
- A bug fix in dt-core applies to all three clients at once. No risk of one client having a different behavior than another.
- The MCP server (used by AI agents) has identical data access capabilities to the web UI. Anything a human can do through the UI, an AI agent can do through MCP.
- Retry logic, mutex, and deduplication are implemented once and shared. Individual clients don't need to worry about concurrent access patterns.

**Negative:**
- dt-core is a coupling point. A breaking change in dt-core forces updates in all three clients. This is mitigated by the monorepo structure (all clients are updated together).
- The package must work in both browser (frontend) and Node.js (backend, MCP server) environments. Some patterns (like how the Apollo Client is configured) differ between environments.
- Adding a new domain operation requires updating dt-core even if only one client needs it. The package grows with the platform.

## References

- [dt-core overview](../dt-core/README.md)
- [Domain model](../dt-core/DOMAIN_MODEL.md)
- [Data access layer](../dt-core/DATA_ACCESS_LAYER.md)
- [GraphQL operations](../dt-core/GRAPHQL_OPERATIONS.md)
