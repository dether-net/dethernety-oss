# Backend Architecture Documentation

> Backend architecture for the Dethernety platform

## Documentation Overview

Documentation for the NestJS backend, GraphQL API, module system, and graph database integration.

---

## Quick Navigation

### Summary Documents

| Document | Audience | Description |
|----------|----------|-------------|
| [Technical Overview](./TECHNICAL_OVERVIEW.md) | Developers, Contributors | Technical overview |
| [Backend Architecture](./BACKEND_ARCHITECTURE.md) | Technical Leaders, Architects | Full architecture reference |
| [Database Schema](./LLD/SCHEMA.md) | Developers | Graph database node types, properties, and relationships |

### Detailed Technical Documentation (LLD)

| Document | Description |
|----------|-------------|
| [Architecture Diagrams](./LLD/ARCHITECTURE.md) | Detailed system diagrams and component interactions |
| [GraphQL Module](./LLD/GRAPHQL_MODULE.md) | Main API layer documentation |
| [Database Module](./LLD/DATABASE_MODULE.md) | Database service and Neo4j integration |
| [API Reference](./LLD/API_REFERENCE.md) | Complete GraphQL API specifications |
| [GraphQL API Reference](./GRAPHQL_API_REFERENCE.md) | Auto-generated schema reference (types, queries, mutations) |

### Module System Documentation

| Document | Description |
|----------|-------------|
| [Module Registry](./LLD/MODULE_REGISTRY_DOCUMENTATION.md) | Plugin system architecture and lifecycle |
| [Module Registry Quick Reference](./LLD/MODULE_REGISTRY_QUICK_REFERENCE.md) | Quick reference for module development |
| [Module Management Service](./LLD/MODULE_MANAGEMENT_SERVICE.md) | Module database operations |

### Resolver Service Documentation

| Document | Description |
|----------|-------------|
| [Custom Resolver Services](./LLD/CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md) | Overview of all custom resolvers |
| [Custom Resolver API Reference](./LLD/CUSTOM_RESOLVER_API_REFERENCE.md) | Detailed API specifications |
| [Custom Resolver Quick Reference](./LLD/CUSTOM_RESOLVER_SERVICES_QUICK_REFERENCE.md) | Quick reference guide |
| [Analysis Resolver](./LLD/ANALYSIS_RESOLVER.md) | AI integration service |
| [Template Resolver](./LLD/TEMPLATE_RESOLVER.md) | Content management service |
| [Issue Resolver](./LLD/ISSUE_RESOLVER.md) | External system synchronization |
| [Set Instantiation Attributes](./LLD/SET_INSTANTIATION_ATTRIBUTES.md) | Component configuration service |

### Additional Resources

| Document | Description |
|----------|-------------|
| [Examples](./LLD/EXAMPLES.md) | Implementation examples and patterns |

---

## Document Hierarchy

```
docs/architecture/backend/
│
├── README.md                    ← You are here (Navigation Guide)
├── TECHNICAL_OVERVIEW.md        ← Technical overview
├── BACKEND_ARCHITECTURE.md      ← Full architecture reference
├── GRAPHQL_API_REFERENCE.md     ← Auto-generated schema reference
│
└── LLD/                         ← Low-Level Design documentation
    ├── SCHEMA.md                ← Graph database schema
    ├── ARCHITECTURE.md          ← System diagrams
    ├── GRAPHQL_MODULE.md        ← GraphQL API layer
    ├── DATABASE_MODULE.md       ← Database services
    ├── API_REFERENCE.md         ← API specifications
    ├── EXAMPLES.md              ← Code examples
    │
    ├── MODULE_REGISTRY_DOCUMENTATION.md ← Full module docs
    ├── MODULE_REGISTRY_QUICK_REFERENCE.md ← Module quick ref
    ├── MODULE_MANAGEMENT_SERVICE.md    ← Module DB operations
    │
    ├── CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md ← Resolver overview
    ├── CUSTOM_RESOLVER_API_REFERENCE.md          ← Resolver APIs
    ├── CUSTOM_RESOLVER_SERVICES_QUICK_REFERENCE.md ← Resolver quick ref
    │
    ├── ANALYSIS_RESOLVER.md            ← AI analysis service
    ├── TEMPLATE_RESOLVER.md            ← Template service
    ├── ISSUE_RESOLVER.md               ← Issue sync service
    └── SET_INSTANTIATION_ATTRIBUTES.md ← Attributes service
```

---

## Reading Guide

### Getting Started

1. [Technical Overview](./TECHNICAL_OVERVIEW.md) - Architecture overview and key concepts
2. [Backend Architecture](./BACKEND_ARCHITECTURE.md) - Detailed architecture reference
3. [API Reference](./LLD/API_REFERENCE.md) - GraphQL API specs
4. [Examples](./LLD/EXAMPLES.md) - Implementation patterns

### Deep Dives

- [GraphQL Module](./LLD/GRAPHQL_MODULE.md) - API layer internals
- [Database Module](./LLD/DATABASE_MODULE.md) - Data layer design
- [Module Registry](./LLD/MODULE_REGISTRY_DOCUMENTATION.md) - Plugin system architecture
- [Custom Resolver Services](./LLD/CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md) - Business logic patterns

---

## Technology Stack

- **Framework**: NestJS with TypeScript
- **Database**: Bolt-compatible graph database (Neo4j / Memgraph)
- **API**: GraphQL with Apollo Server
- **Real-time**: WebSocket or SSE subscriptions
- **Authentication**: OIDC/JWT

---

## Related Documentation

- [System Architecture](../README.md) - Full system overview (frontend, backend, AI)
- [Frontend Architecture](../frontend/) - UI architecture documentation
