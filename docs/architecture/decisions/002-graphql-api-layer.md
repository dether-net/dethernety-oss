# ADR-002: GraphQL API layer

**Status:** Accepted
**Date:** 2025-01-15

## Context

The platform has multiple clients (web UI, MCP server, CLI tools) that need different slices of the same data. A threat model summary view needs the model name and component count. A detail view needs the full component tree with all attributes. An analysis view needs exposures, techniques, and countermeasures in a single request.

REST endpoints would require either over-fetching (fat endpoints returning everything) or a proliferation of specialized endpoints for each view. The graph data model is hierarchical with variable depth -- a model contains components, which have exposures, which map to techniques, which have mitigations. Fixed REST responses don't match this structure well.

## Decision

Use GraphQL as the API layer, built with NestJS and Apollo Server. The GraphQL schema maps 1:1 to the graph data model, so each node type is a GraphQL type and each relationship is a field. The `@neo4j/graphql` library generates resolvers directly from the schema.

Module-specific operations (templates, analysis, exposure detection) are handled through custom resolvers routed by the Module Registry Service.

## Consequences

**Positive:**
- Clients fetch exactly the data they need. The UI's summary view and detail view use the same endpoint with different query shapes.
- The schema acts as a typed contract between frontend and backend. Breaking changes are visible in the schema diff.
- Subscriptions and SSE provide real-time updates for long-running analysis sessions without polling.

**Negative:**
- GraphQL introduces query complexity and depth as attack vectors. We mitigate this with depth limiting (default 10) and complexity scoring (default 1,000).
- Caching is harder than REST because queries don't map to URLs. Apollo Client's normalized cache handles this, but it adds complexity.
- The `@neo4j/graphql` library is a dependency we don't control. Schema customization sometimes requires working around its conventions.

## References

- [Backend architecture](../backend/BACKEND_ARCHITECTURE.md)
- [GraphQL API reference](../backend/GRAPHQL_API_REFERENCE.md)
- [Configuration guide](../../CONFIGURATION_GUIDE.md) -- GraphQL settings
