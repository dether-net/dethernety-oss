# Backend Technical Overview

Dethernety's backend is a NestJS application with a Bolt/Cypher graph database, a GraphQL API, and an extensible module system.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CLIENT APPLICATIONS                            │
│                    (Web UI, API Integrations, MCP)                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY LAYER                             │
│    ┌────────────────────────┐    ┌────────────────────────────────┐     │
│    │    GraphQL API         │    │    WebSocket / SSE Server      │     │
│    │    (CRUD + Business)   │    │    (Real-time AI Streaming)    │     │
│    └────────────────────────┘    └────────────────────────────────┘     │
│                                                                         │
│    Security: JWT Auth │ Query Protection │ Input Validation             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS LOGIC LAYER                            │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │   Analysis   │ │   Template   │ │    Issue     │ │   Module     │    │
│  │   Service    │ │   Service    │ │    Sync      │ │   System     │    │
│  │  (AI Int.)   │ │  (Content)   │ │  (External)  │ │  (Plugins)   │    │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘    │
│                                                                         │
│    Features: Caching │ Monitoring │ Error Handling │ Type Safety        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATA PERSISTENCE LAYER                         │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Bolt + Cypher Compatible Graph Database             │   │
│  │                     (Neo4j / Memgraph)                           │   │
│  │    Threat Models │ Security Data │ MITRE Frameworks │ AI Context │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│    Connection Pooling │ Health Monitoring │ Transaction Management      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL INTEGRATIONS                            │
│                                                                         │
│  ┌─────────────────────────────────────────┐  ┌───────────────┐         │
│  │ DTModule Interface                      │  │ Identity      │         │
│  │ (Analysis, Design Classes, Security     │  │ (OIDC/JWT)    │         │
│  │  Logic, Issue Sync, Configuration)      │  └───────────────┘         │
│  └─────────────────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Technologies

| Technology | Purpose |
|------------|---------|
| **NestJS** | Node.js framework with dependency injection and modular architecture |
| **TypeScript** | Type-safe development across the entire backend |
| **Bolt + Cypher** | Graph database protocol supporting Neo4j and Memgraph |
| **GraphQL** | API layer with strong typing, flexible queries, and subscription support |
| **DTModule Interface** | Abstraction layer for pluggable analysis engines and integrations |

---

## Graph-Native Architecture

The backend uses Bolt protocol and Cypher queries, which allows deployment on multiple graph databases (Neo4j, Memgraph). Threat models are stored as graph structures, making it straightforward to traverse relationships between components, data flows, exposures, and controls.

The graph also stores ingested MITRE ATT&CK and D3FEND frameworks for technique mapping, and can hold vector embeddings for AI context retrieval.

## Module System (DTModule Interface)

All extensibility flows through the `DTModule` interface:

- **Design Classes**: ComponentClass, SecurityBoundaryClass, DataFlowClass, ControlClass, DataClass
- **Security Logic**: Exposure detection rules and countermeasure mappings via pluggable rule engines (OPA, JsonLogic, custom)
- **Issue Integration**: External issue tracker synchronization (Jira, GitHub, Azure DevOps, ServiceNow)
- **Analysis Engines**: Pluggable AI, query-based, or rule-based analysis with unified result retrieval
- **Configuration**: Dynamic UI schemas and documentation per class

Reference implementations (`DtFileJsonModule`, `DtNeo4jOpaModule`, `DtLgModule`) demonstrate different patterns — from simple file-based to database-backed with policy engines.

## Pluggable Resolver Architecture

New GraphQL capabilities are added by implementing the `ResolverService` interface. A factory pattern automatically collects resolver contributions and merges them into the schema. Each resolver handles its own domain logic independently while sharing centralized authorization, monitoring, and caching services.

## Analysis Engine Abstraction

Analysis engines are abstracted through the `DTModule` interface, supporting AI-powered, query-based, rule-based, or hybrid analysis behind a unified GraphQL API. Long-running operations (15+ minutes) stream progress via WebSocket or SSE.

---

## Security Model

```
┌────────────────────────────────────────────────────────────────┐
│ Transport Layer: TLS/HTTPS Encryption                          │
├────────────────────────────────────────────────────────────────┤
│ Authentication: OIDC JWT Token Validation (JWKS)               │
├────────────────────────────────────────────────────────────────┤
│ Query Protection: Depth Limiting + Complexity Scoring          │
├────────────────────────────────────────────────────────────────┤
│ Input Validation: Comprehensive Parameter Checking             │
├────────────────────────────────────────────────────────────────┤
│ Error Handling: Sanitized Responses (No Internal Leakage)      │
├────────────────────────────────────────────────────────────────┤
│ Module Security: Whitelisting + File Validation                │
└────────────────────────────────────────────────────────────────┘
```

---

## Current Integrations

| System | Integration Type | Purpose |
|--------|-----------------|---------|
| **MITRE ATT&CK** | Data + Linking | Attack technique mapping |
| **MITRE D3FEND** | Data + Linking | Defense technique mapping |
| **Analysis Engines** | Real-time (DTModule) | AI, query-based, or rule-based analysis |
| **OPA (Open Policy Agent)** | Security Logic (DTModule) | Rego-based policy evaluation for exposures/countermeasures |
| **OIDC Providers** | Authentication | Enterprise identity (Cognito, Keycloak, Auth0, Zitadel) |

---

## Contributing

When working on the backend:

- All services use NestJS dependency injection; follow existing patterns in `src/gql/resolver-services/` for new resolvers
- The GraphQL schema is dynamically built by `SchemaService` from resolver contributions — you do not edit a monolithic schema file
- Module development follows the `DTModule` interface defined in `packages/dt-module/`
- Type definitions shared across packages live in `packages/dt-core/src/interfaces/core-types-interface.ts`
- Run `pnpm lint` and `pnpm test` before submitting changes

---

## Further Reading

- [Backend Architecture](./BACKEND_ARCHITECTURE.md) — complete technical reference with implementation details
- [Architecture Overview](../README.md) — platform-level architecture
