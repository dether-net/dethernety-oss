# ADR-001: Graph-native data model (Bolt/Cypher)

**Status:** Accepted
**Date:** 2025-01-15

## Context

Threat models consist of components connected by data flows, grouped by trust boundaries, annotated with controls and exposures. These relationships are the primary thing you query -- "which components are reachable from this entry point?", "what exposures exist on paths to PII stores?", "which controls mitigate this technique?".

Relational databases can represent these relationships with join tables, but traversal queries (variable-depth paths, reachability, pattern matching) are expensive and require complex SQL. Document databases flatten the structure entirely, losing traversal capability.

We needed a storage layer where relationships are first-class objects, not foreign keys.

## Decision

Store all threat model data in a Bolt/Cypher-compatible graph database (Neo4j or Memgraph). Components, data flows, trust boundaries, exposures, controls, and MITRE framework data are nodes and edges in the graph.

Use the Bolt protocol and Cypher query language rather than a vendor-specific API, so the platform works with both Neo4j (feature-rich, enterprise) and Memgraph (lightweight, cost-optimized).

## Consequences

**Positive:**
- Traversal queries are single Cypher statements instead of recursive SQL joins. "Find all paths from internet-facing components to PII stores through unencrypted data flows" is one query.
- The data model maps directly to how security engineers think about architectures -- nodes and edges, not rows and columns.
- Memgraph support means the platform can run without a Neo4j license, reducing the barrier for small teams and OSS users.

**Negative:**
- The team needs Cypher expertise, which is less common than SQL.
- Graph databases have weaker tooling for bulk data operations (migrations, backups, bulk imports) compared to PostgreSQL or MySQL.
- Two database backends (Neo4j, Memgraph) means testing against both. Some Cypher dialect differences exist.

## References

- [Platform architecture](../README.md) -- Technology Strategy section
- [Configuration guide](../../CONFIGURATION_GUIDE.md) -- Database settings
