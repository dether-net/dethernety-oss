# Backend Architecture Documentation

> Comprehensive technical documentation for the Dethernety backend platform

## Documentation Overview

This documentation provides a complete picture of the Dethernety backend architecture, from executive summaries suitable for due diligence to detailed implementation specifications.

---

## Quick Navigation

### Executive & Summary Documents

| Document | Audience | Description |
|----------|----------|-------------|
| [Technical Overview](./TECHNICAL_OVERVIEW.md) | Executives, Investors | High-level technical summary for due diligence |
| [Backend Architecture](./BACKEND_ARCHITECTURE.md) | Technical Leaders, Architects | Comprehensive architecture overview |

### Detailed Technical Documentation (LLD)

| Document | Description |
|----------|-------------|
| [Architecture Diagrams](./LLD/ARCHITECTURE.md) | Detailed system diagrams and component interactions |
| [GraphQL Module](./LLD/GRAPHQL_MODULE.md) | Main API layer documentation |
| [Database Module](./LLD/DATABASE_MODULE.md) | Database service and Neo4j integration |
| [API Reference](./LLD/API_REFERENCE.md) | Complete GraphQL API specifications |

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
├── TECHNICAL_OVERVIEW.md        ← Executive summary for due diligence
├── BACKEND_ARCHITECTURE.md      ← Comprehensive architecture overview
│
└── LLD/                         ← Low-Level Design documentation
    ├── ARCHITECTURE.md          ← System diagrams
    ├── GRAPHQL_MODULE.md        ← GraphQL API layer
    ├── DATABASE_MODULE.md       ← Database services
    ├── API_REFERENCE.md         ← API specifications
    ├── EXAMPLES.md              ← Code examples
    │
    ├── MODULE_REGISTRY.md              ← Module system improvements
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

### For Investment Due Diligence

1. Start with [Technical Overview](./TECHNICAL_OVERVIEW.md) - Executive-level summary
2. Review [Backend Architecture](./BACKEND_ARCHITECTURE.md) - Complete technical picture
3. Reference [Architecture Diagrams](./LLD/ARCHITECTURE.md) - Visual system overview

### For Technical Evaluation

1. [Backend Architecture](./BACKEND_ARCHITECTURE.md) - Architecture patterns and design
2. [GraphQL Module](./LLD/GRAPHQL_MODULE.md) - API layer details
3. [Database Module](./LLD/DATABASE_MODULE.md) - Data layer design
4. [Module Registry](./LLD/MODULE_REGISTRY_DOCUMENTATION.md) - Extensibility architecture

### For Development Teams

1. [Custom Resolver Services](./LLD/CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md) - Business logic patterns
2. [API Reference](./LLD/API_REFERENCE.md) - Complete API specs
3. [Examples](./LLD/EXAMPLES.md) - Implementation patterns
4. Quick references for specific services

---

## Key Architecture Highlights

### Technology Stack

- **Framework**: NestJS 11+ with TypeScript
- **Database**: Bolt-compatible graph database (Neo4j 7.x / Memgraph)
- **API**: GraphQL with Apollo Server
- **Real-time**: WebSocket or SSE subscriptions (SSE enables CloudFront VPC origin pattern)
- **Authentication**: OIDC/JWT

### Production Features

- Comprehensive security (auth, query protection, input validation)
- Full observability (logging, health checks, metrics)
- Resilient operations (retry, timeout, graceful degradation)
- Scalable design (stateless, connection pooling)

### Architecture Patterns

- Layered architecture with clear separation of concerns
- Dependency injection throughout
- Modern Neo4j v7 transaction patterns
- Extensible module/plugin system

---

## Related Documentation

- [System Architecture](../architecture.md) - Full system overview (frontend, backend, AI)
- [Infrastructure Architecture](../infrastructure/) - Deployment and infrastructure
- [Frontend Architecture](../frontend/) - UI architecture documentation
- [Production Deployment Guide](../../PRODUCTION_DEPLOYMENT_GUIDE.md) - Deployment documentation
- [Configuration Guide](../../CONFIGURATION_GUIDE.md) - Configuration reference
