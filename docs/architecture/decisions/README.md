# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Dethernety platform. ADRs document the reasoning behind significant technical decisions so that future contributors can understand *why* the system is built the way it is, not just *how*.

We use the [Nygard template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions): Context, Decision, Consequences.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-graph-native-data-model.md) | Graph-native data model (Bolt/Cypher) | Accepted |
| [002](002-graphql-api-layer.md) | GraphQL API layer | Accepted |
| [003](003-oidc-authentication.md) | OIDC authentication with multi-provider support | Accepted |
| [004](004-executable-module-system.md) | Executable module system | Accepted |
| [005](005-shared-data-access-layer.md) | Shared data access layer (dt-core) | Accepted |
| [006](006-defense-in-depth-security.md) | Defense-in-depth security | Accepted |

## Adding new ADRs

1. Copy an existing ADR as a template
2. Number sequentially (next: 007)
3. Set status to "Proposed" until reviewed
4. Add the entry to the index table above
