# Backend Technical Overview

> Executive-level technical summary for investment due diligence

## Platform Architecture at a Glance

Dethernety's backend is built on a modern, enterprise-grade technology stack designed for scalability, security, and maintainability.

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

## Technology Selection Rationale

### Core Technologies

| Technology | Selection Rationale | Industry Adoption |
|------------|--------------------|--------------------|
| **NestJS** | Enterprise Node.js framework with built-in dependency injection, modular architecture, and TypeScript-first design | Netflix, Roche, Adidas |
| **TypeScript** | Type safety reduces bugs, improves maintainability, enables better tooling | Microsoft, Google, Slack |
| **Bolt + Cypher** | Standards-based graph database protocol; supports Neo4j, Memgraph (cost-optimized default) | NASA, eBay, Walmart |
| **GraphQL** | Flexible queries, reduced over-fetching, strong typing, excellent developer experience | Facebook, GitHub, Shopify |
| **DTModule Interface** | Abstraction layer enabling pluggable analysis engines (AI, query-based, rule-based) | Custom architecture pattern |

### Why This Stack?

1. **Scalability**: Stateless design supports horizontal scaling
2. **Maintainability**: TypeScript + NestJS enables long-term code health
3. **Performance**: Graph database optimized for interconnected security data
4. **Schema-First Integration**: Native Bolt + Cypher compatible library enables schema-based GraphQL database integration
5. **Developer Experience**: Modern tooling and comprehensive type system
6. **AI-Ready**: Built-in support for long-running AI operations and streaming

---

## Key Technical Differentiators

### 1. Graph-Native Architecture

Using Bolt protocol and Cypher query language enables deployment on multiple graph databases (Neo4j, Memgraph), providing:
- Natural representation of interconnected threat models
- Efficient traversal of component-dataflow-exposure-control relationships
- Fast queries for complex security analysis patterns
- Vector storage for AI context retrieval
- Deployment flexibility (Memgraph for cost-optimized environments)

### 2. Extensible Module System (DTModule Interface)

The `DTModule` interface enables unlimited integrations:
- **Design Classes**: Custom ComponentClass, SecurityBoundaryClass, DataFlowClass, ControlClass, DataClass - can integrate with live data sources (Kubernetes API, cloud provider APIs, CMDBs)
- **Security Logic**: Exposure detection rules and countermeasure mappings via pluggable rule engines (OPA, JsonLogic, custom) - can integrate with AWS IAM, K8s RBAC, compliance frameworks
- **Issue Integration**: External issue tracker synchronization (Jira, GitHub, Azure DevOps, ServiceNow)
- **Analysis Engines**: Pluggable AI, query-based, or rule-based analysis with unified result retrieval
- **Configuration**: Dynamic UI schemas and documentation per class

Reference implementations (`DtFileJsonModule`, `DtNeo4jOpaModule`, `DtLgModule`) demonstrate different integration patterns - from simple file-based to enterprise database-backed with policy engines.

Any implementation of `DTModule` integrates seamlessly - enabling custom security frameworks, proprietary engines, or domain-specific capabilities.

### 3. Pluggable Analysis Engine Architecture

Analysis engines abstracted through `DTModule` interface:
- **Engine Agnostic**: Supports AI-powered, query-based, rule-based, or hybrid analysis
- **Storage Abstraction**: Unified document retrieval from any backend (vector store, LangGraph, custom)
- **Long-running Operations**: 15+ minute analysis sessions with progress streaming
- **Real-time Updates**: WebSocket or SSE streaming for live results
- **Unified API**: Same GraphQL interface regardless of underlying engine

### 4. Pluggable Resolver Architecture

Structured approach to custom business logic:
- **Modular Design**: Each resolver service handles specific domain logic independently
- **Auto-Registration**: Factory pattern automatically collects and merges resolvers into GraphQL schema
- **Shared Services**: Centralized authorization, monitoring, and caching services
- **Type-Safe Contracts**: All resolvers implement `ResolverService` interface
- **Easy Extension**: Add new capabilities without modifying core GraphQL setup
- **Testability**: NestJS dependency injection enables comprehensive testing

---

## Security Architecture

### Defense in Depth

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

### Security Highlights

- **Standards-Based Auth**: OIDC/JWT with JWKS validation
- **Query Abuse Prevention**: Configurable depth/complexity limits
- **Module Isolation**: Production whitelisting, no hot reload
- **Credential Protection**: Secure logging with masking
- **Error Security**: Production errors sanitized

---

## Operational Capabilities

### Monitoring & Observability

| Capability | Implementation |
|------------|----------------|
| **Health Checks** | Database, schema, module status endpoints |
| **Structured Logging** | JSON format, operation context, performance metrics |
| **Performance Tracking** | Response times, success rates, cache hit ratios |
| **Alerting Support** | Configurable thresholds for health monitoring |

### Deployment Flexibility

| Environment | Configuration |
|-------------|---------------|
| **Development** | Full debugging, playground enabled, relaxed limits |
| **Staging** | Production-like with debugging support |
| **Production** | Hardened security, disabled playground, strict limits |

### Scalability Characteristics

- **Stateless Design**: Any instance can handle any request
- **Connection Pooling**: Efficient database resource usage
- **Horizontal Scaling**: Add instances behind load balancer
- **Cache Strategy**: Memory-efficient with intelligent invalidation

---

## Code Quality & Maintainability

### Engineering Standards

| Standard | Implementation |
|----------|----------------|
| **Type Safety** | Full TypeScript with strict configuration |
| **Code Organization** | Modular architecture with clear boundaries |
| **Error Handling** | Consistent patterns across all services |
| **Documentation** | Comprehensive inline and architecture docs |
| **Testing** | Unit, integration, and E2E test coverage |

### Technical Debt Management

- **Modern Patterns**: Neo4j v7 APIs, latest NestJS practices
- **Clean Interfaces**: Clear service contracts enable refactoring
- **Backward Compatibility**: Legacy support with deprecation paths
- **Comprehensive Logging**: Easy debugging and troubleshooting

---

## Integration Capabilities

### Current Integrations

| System | Integration Type | Purpose |
|--------|-----------------|---------|
| **MITRE ATT&CK** | Data + Linking | Attack technique mapping |
| **MITRE D3FEND** | Data + Linking | Defense technique mapping |
| **Analysis Engines** | Real-time (DTModule) | AI, query-based, or rule-based analysis |
| **OPA (Open Policy Agent)** | Security Logic (DTModule) | Rego-based policy evaluation for exposures/countermeasures |
| **OIDC Providers** | Authentication | Enterprise identity |

### Integration Possibilities via DTModule

| Capability | Potential Integrations |
|------------|------------------------|
| **Design Classes** | Kubernetes, AWS/Azure/GCP, VMware, CMDBs, Container Registries |
| **Security Logic** | Cloud Security Posture tools, Compliance frameworks (CIS, NIST) |
| **Analysis Engines** | Custom AI pipelines, query engines, rule systems |
| **Issue Tracking** | Jira, GitHub Issues, Azure DevOps, ServiceNow |

### Extension Points

1. **DTModule Implementation**: Full integration capabilities via standardized interface
2. **Custom Resolvers**: Additional business logic without core modifications
3. **Database Schema**: Extend data model as needed
4. **External APIs**: Integrate additional services

---

## Summary: Investment Considerations

### Technical Strengths

- **Modern Architecture**: Current best practices, not legacy constraints
- **Production Proven**: Comprehensive security, monitoring, error handling
- **Scalable Design**: Supports growth from startup to enterprise
- **AI-Native**: Purpose-built for AI-powered security analysis
- **Extensible**: Plugin architecture enables market expansion

### Risk Mitigation

- **Type Safety**: Reduces bugs and maintenance costs
- **Observability**: Early detection of issues
- **Standards-Based**: Uses proven, widely-adopted technologies
- **Documentation**: Comprehensive architecture documentation
- **Clean Architecture**: Enables future evolution

### Competitive Advantages

1. **Graph-Native**: Natural fit for security relationship modeling
2. **Database Flexibility**: Bolt/Cypher standards enable Neo4j or Memgraph deployment (cost optimization)
3. **Analysis Engine Abstraction**: Supports AI, query-based, rule-based, or hybrid engines via `DTModule` interface
4. **MITRE Integration**: Standards compliance built-in
5. **Real-Time**: Live analysis streaming (WebSocket/SSE)
6. **Extensibility**: Plugin architecture for market adaptation
7. **Maintainability**: Pluggable resolver architecture ensures long-term code health

---

## Detailed Documentation Reference

For deeper technical analysis, comprehensive Low-Level Design documentation is available covering:

- GraphQL API architecture and implementation
- Database service patterns and configuration
- Module system security and lifecycle
- Individual resolver service documentation
- API specifications and examples

See [Backend Architecture](./BACKEND_ARCHITECTURE.md) for the complete technical reference.

For the overall platform architecture, see [Architecture Overview](../ARCHITECTURE.md).
