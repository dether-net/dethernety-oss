# Dethernety Platform Architecture

> Executive-level architecture overview for investment due diligence

## Table of Contents
- [Executive Summary](#executive-summary)
- [Architecture Vision](#architecture-vision)
- [System Architecture](#system-architecture)
- [Technology Strategy](#technology-strategy)
- [Key Differentiators](#key-differentiators)
- [Security Architecture](#security-architecture)
- [Scalability & Deployment](#scalability--deployment)
- [Detailed Documentation](#detailed-documentation)

---

## Executive Summary

Dethernety is a **graph-native threat modeling platform** with AI-powered security analysis. Unlike document-based or form-driven alternatives, Dethernety models security relationships as first-class graph structures—components, data flows, trust boundaries, exposures, and controls are interconnected nodes and edges that can be traversed, queried, and analyzed programmatically.

The platform integrates industry-standard frameworks (MITRE ATT&CK, D3FEND) and combines visual threat modeling with pluggable analysis backends to identify potential security issues early in development.

### Strategic Moats

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STRATEGIC DIFFERENTIATORS                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. GRAPH-NATIVE ARCHITECTURE                                               │
│     ─────────────────────────                                               │
│     Threat models stored as native graph structures in Bolt/Cypher          │
│     database. GraphQL API maps 1:1 to the graph data layer—queries          │
│     traverse relationships directly. Enables complex traversal queries      │
│     impossible with relational databases: "find all paths from internet-    │
│     facing components to PII stores through unencrypted data flows."        │
│                                                                             │
│  2. SWAPPABLE ANALYSIS BACKEND                                              │
│     ─────────────────────────                                               │
│     Analysis engine is abstracted through DTModule interface:               │
│     • Query-based analysis (Cypher traversals, pattern matching)            │
│     • Single-agent AI (LLM-powered reasoning)                               │
│     • Multi-agent AI (LangGraph orchestrated workflows)                     │
│     • Rule-based (OPA/Rego policy evaluation)                               │
│     Same API regardless of backend—swap engines without UI changes.         │
│                                                                             │
│  3. EXECUTABLE MODULE SYSTEM                                                │
│     ─────────────────────────                                               │
│     Modules are real JavaScript/TypeScript classes loaded at runtime:       │
│     • Define component classes with custom attributes and validation        │
│     • Implement exposure detection with OPA/Rego or custom logic            │
│     • Provide AI analysis workflows via LangGraph integration               │
│     • Sync with external systems (Jira, cloud APIs, CMDBs)                  │
│     Not configuration files—executable code with full platform access.      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Highlights

| Characteristic | Implementation |
|----------------|----------------|
| **Data Model** | Graph-native (Bolt/Cypher on Neo4j or Memgraph) |
| **Analysis Engine** | Pluggable backends: query, rule-based, single-agent AI, multi-agent AI |
| **Module System** | Runtime-loaded JavaScript classes with full platform API access |
| **Frontend** | Vue 3 + TypeScript with interactive graph visualization |
| **Backend** | NestJS GraphQL with module-routed resolvers |
| **Deployment** | Multi-tenant SaaS with customer isolation |
| **Integration** | OIDC/OAuth2, GraphQL, MCP Protocol, Issue Trackers |

---

## Architecture Vision

### Design Principles

The Dethernety architecture is guided by five core principles:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ARCHITECTURE PRINCIPLES                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. EXTENSIBILITY          Modules can add capabilities without core        │
│     ───────────────        modifications. New component types, security     │
│                            rules, and AI analyses plug in seamlessly.       │
│                                                                             │
│  2. GRAPH-NATIVE           Security relationships modeled naturally as      │
│     ───────────────        nodes and edges. Threats, controls, and data     │
│                            flows represent interconnected reality.          │
│                                                                             │
│  3. AI-INTEGRATED          AI is a first-class citizen, not an add-on.      │
│     ───────────────        LangGraph workflows execute complex multi-step   │
│                            security analysis with human oversight.          │
│                                                                             │
│  4. STANDARDS-BASED        MITRE ATT&CK and D3FEND integrated natively.     │
│     ───────────────        Industry frameworks provide shared vocabulary    │
│                            and actionable threat intelligence.              │
│                                                                             │
│  5. SECURE BY DESIGN       Defense-in-depth throughout. Multi-tenant        │
│     ───────────────        isolation, JWT/OIDC auth, encrypted data,        │
│                            least-privilege access.                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Strategic Goals

| Goal | Implementation Strategy |
|------|------------------------|
| **Security Modeling Fidelity** | Graph-native data model maps data flows, attack paths, and attack states as first-class relationships—enables queries impossible with SQL (path traversals, reachability, pattern matching) |
| **Market Adaptability** | Module system enables new security domains (cloud, IoT, OT) without platform changes |
| **Enterprise Integration** | OIDC/OAuth2 supports Cognito, Keycloak, Auth0, Zitadel; GraphQL enables custom tooling |
| **AI Evolution** | Analysis engine abstraction allows swapping AI models and adding new reasoning patterns |
| **Cost Optimization** | Bolt/Cypher compatibility enables Memgraph deployment for cost-sensitive environments |

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DETHERNETY PLATFORM                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                            PRESENTATION LAYER                             │  │
│  │                                                                           │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐     │  │
│  │  │   Web UI         │  │   MCP Server     │  │   CLI / SDK          │     │  │
│  │  │   (Vue 3)        │  │   (Python)       │  │   (TypeScript/Python)│     │  │
│  │  │                  │  │                  │  │                      │     │  │
│  │  │  • Data Flow     │  │  • AI Assistant  │  │  • Automation        │     │  │
│  │  │    Editor        │  │    Integration   │  │  • CI/CD Integration │     │  │
│  │  │  • Analysis      │  │  • Model Import/ │  │  • Scripting         │     │  │
│  │  │    Dashboard     │  │    Export        │  │                      │     │  │
│  │  │  • Issue Manager │  │                  │  │                      │     │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘     │  │
│  │           │                     │                       │                 │  │
│  └───────────┼─────────────────────┼───────────────────────┼─────────────────┘  │
│              │                     │                       │                    │
│              └─────────────────────┼───────────────────────┘                    │
│                                    │                                            │
│                          ┌─────────┴─────────┐                                  │
│                          │    dt-core        │                                  │
│                          │ (Shared Data      │                                  │
│                          │  Access Layer)    │                                  │
│                          └─────────┬─────────┘                                  │
│                                    │                                            │
│  ┌─────────────────────────────────┼───────────────────────────────────────┐    │
│  │                     API LAYER   │                                       │    │
│  │                                 ▼                                       │    │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │    │
│  │  │                    GraphQL API (NestJS)                           │  │    │
│  │  │                                                                   │  │    │
│  │  │   • Queries & Mutations (CRUD)    • Real-time Subscriptions       │  │    │
│  │  │   • Module-routed Requests        • JWT/OIDC Authentication       │  │    │
│  │  │   • Query Depth Protection        • Input Validation              │  │    │
│  │  └───────────────────────────────────────────────────────────────────┘  │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                    │                                            │
│  ┌─────────────────────────────────┼───────────────────────────────────────┐    │
│  │               BUSINESS LOGIC    │                                       │    │
│  │                                 ▼                                       │    │
│  │  ┌──────────────────────────────────────────────────────────────────┐   │    │
│  │  │                    Module System                                 │   │    │
│  │  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │   │    │
│  │  │  │  Dethernety     │  │   Dethermine    │  │   Custom        │   │   │    │
│  │  │  │  Module         │  │   Modules       │  │   Modules       │   │   │    │
│  │  │  │                 │  │                 │  │                 │   │   │    │
│  │  │  │ • Component     │  │ • Attack        │  │ • Cloud         │   │   │    │
│  │  │  │   Classes       │  │   Scenario      │  │   Security      │   │   │    │
│  │  │  │ • OPA/Rego      │  │   Analysis      │  │ • Compliance    │   │   │    │
│  │  │  │   Policies      │  │ • Interactive   │  │ • Industry-     │   │   │    │
│  │  │  │ • Exposure      │  │   Studio        │  │   Specific      │   │   │    │
│  │  │  │   Detection     │  │                 │  │                 │   │   │    │
│  │  │  └─────────────────┘  └─────────────────┘  └─────────────────┘   │   │    │
│  │  └──────────────────────────────────────────────────────────────────┘   │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                    │                                            │
│  ┌─────────────────────────────────┼───────────────────────────────────────┐    │
│  │                   DATA LAYER    │                                       │    │
│  │                                 ▼                                       │    │
│  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐  │    │
│  │  │   Graph Database    │  │    LangGraph        │  │   Vector        │  │    │
│  │  │   (Bolt/Cypher)     │  │    Store            │  │   Store         │  │    │
│  │  │                     │  │                     │  │                 │  │    │
│  │  │ • Threat Models     │  │ • Analysis State    │  │ • Embeddings    │  │    │
│  │  │ • MITRE Data        │  │ • Chat History      │  │ • Similarity    │  │    │
│  │  │ • Module Metadata   │  │ • AI Artifacts      │  │   Search        │  │    │
│  │  │ • Rego Policies     │  │                     │  │                 │  │    │
│  │  └─────────────────────┘  └─────────────────────┘  └─────────────────┘  │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                    │                                            │
│  ┌─────────────────────────────────┼───────────────────────────────────────┐    │
│  │              EXTERNAL SERVICES  │                                       │    │
│  │                                 ▼                                       │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │    │
│  │  │  OPA Server     │  │  LangGraph API  │  │  Identity Provider      │  │    │
│  │  │                 │  │                 │  │  (OIDC)                 │  │    │
│  │  │ • Rego Policy   │  │ • AI Workflows  │  │                         │  │    │
│  │  │   Evaluation    │  │ • Multi-agent   │  │ • Cognito / Keycloak    │  │    │
│  │  │ • Exposure      │  │   Orchestration │  │ • Auth0 / Zitadel       │  │    │
│  │  │   Detection     │  │ • Streaming     │  │ • Custom OIDC           │  │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Layer | Component | Technology | Purpose |
|-------|-----------|------------|---------|
| **Presentation** | Web UI | Vue 3 + Vuetify + Vue Flow | Interactive threat modeling interface |
| **Presentation** | MCP Server | Python + dt-core-py | AI assistant integration (Claude, etc.) |
| **Shared** | dt-core | TypeScript + Python | Unified data access layer across all clients |
| **API** | GraphQL Server | NestJS + Apollo | Unified API with subscriptions |
| **Business** | Module System | DTModule interface | Extensible threat modeling capabilities |
| **Business** | Analysis Engine | LangGraph | AI-powered security analysis |
| **Data** | Graph Database | Neo4j / Memgraph | Threat models, relationships, policies |
| **Data** | Vector Store | PostgreSQL + pgvector | Similarity search for AI context |
| **External** | OPA Server | Open Policy Agent | Rego policy evaluation |
| **External** | OIDC Provider | Cognito/Keycloak/Auth0 | Enterprise authentication |

---

## Technology Strategy

### Build vs. Buy Decisions

| Capability | Decision | Rationale |
|------------|----------|-----------|
| **Graph Database** | Buy (Neo4j/Memgraph) | Security relationships are inherently graph-structured; no viable alternative |
| **UI Framework** | Buy (Vue 3) | Modern, performant, excellent TypeScript support |
| **AI Orchestration** | Buy (LangGraph) | Complex agent workflows require proven orchestration |
| **Policy Engine** | Buy (OPA) | Industry-standard, Rego is well-suited for security rules |
| **Module System** | Build | Core differentiator requiring tight platform integration |
| **Data Access Layer** | Build (dt-core) | Consistency across all clients requires shared implementation |
| **Threat Modeling UI** | Build | Purpose-built interface is competitive advantage |

### Technology Rationale

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TECHNOLOGY SELECTION RATIONALE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GRAPH DATABASE (Bolt/Cypher)                                               │
│  ─────────────────────────────                                              │
│  Security data is inherently relational: components connect via data flows, │
│  threats map to techniques, controls mitigate exposures. Graph databases    │
│  model these relationships natively, enabling efficient traversal queries   │
│  that would be expensive in relational databases.                           │
│                                                                             │
│  Protocol flexibility (Bolt/Cypher) enables:                                │
│  • Neo4j for enterprise deployments requiring rich features                 │
│  • Memgraph for cost-optimized deployments (fraction of Neo4j cost)         │
│                                                                             │
│  LANGGRAPH (AI Orchestration)                                               │
│  ─────────────────────────────                                              │
│  Security analysis requires multi-step reasoning: identify attack vectors,  │
│  evaluate likelihood, recommend mitigations. LangGraph provides:            │
│  • Stateful workflows with checkpointing                                    │
│  • Human-in-the-loop for critical decisions                                 │
│  • Streaming for real-time progress visibility                              │
│  • Persistence for long-running analysis sessions                           │
│                                                                             │
│  OPA/REGO (Policy Engine)                                                   │
│  ─────────────────────────────                                              │
│  Exposure detection rules are security policies. OPA provides:              │
│  • Declarative Rego language suited for security logic                      │
│  • Hot-reload without server restart                                        │
│  • Partial evaluation for debugging                                         │
│  • Industry adoption in Kubernetes, service mesh, IAM                       │
│                                                                             │
│  GRAPHQL (API Layer)                                                        │
│  ─────────────────────────────                                              │
│  Threat models are hierarchical with varying depth requirements:            │
│  • Summary views need model-level data only                                 │
│  • Detail views need deep component trees                                   │
│  GraphQL eliminates over-fetching and enables efficient caching.            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Differentiators

### 1. Extensible Module System

The `DTModule` interface enables unlimited platform extension without core modifications. The `packages/dt-module` library provides not just the interface, but production-ready abstract base classes that handle database operations, policy evaluation, and LangGraph integration—new modules require minimal configuration to extend these foundations.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DTMODULE CAPABILITIES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DESIGN CLASSES              Can integrate with live data sources           │
│  ──────────────────          • Kubernetes API → container components        │
│                              • AWS API → cloud resources                    │
│                              • CMDBs → enterprise inventory                 │
│                                                                             │
│  SECURITY LOGIC              Pluggable rule engines                         │
│  ──────────────────          • OPA/Rego for policy-as-code                  │
│                              • JSON Logic for simple rules                  │
│                              • Custom engines for proprietary logic         │
│                                                                             │
│  AI ANALYSIS                 Multiple analysis patterns                     │
│  ──────────────────          • Attack scenario generation                   │
│                              • Interactive threat modeling chat             │
│                              • Compliance gap analysis                      │
│                                                                             │
│  ISSUE INTEGRATION           External tracker sync                          │
│  ──────────────────          • Jira, GitHub Issues, Azure DevOps            │
│                              • ServiceNow, custom systems                   │
│                                                                             │
│  CONFIGURATION               Dynamic UI schemas                             │
│  ──────────────────          • JSONForms-powered property panels            │
│                              • Module-specific documentation                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Module Development Library (`dt-module`)

The `packages/dt-module` library provides abstract base classes that handle common patterns:

| Base Class | Storage | Rule Engine | Use Case |
|------------|---------|-------------|----------|
| `DtNeo4jOpaModule` | Graph database | OPA/Rego | Production modules with centralized policy management |
| `DtFileOpaModule` | JSON files | OPA/Rego | Development, version-controlled configurations |
| `DtFileJsonModule` | JSON files | JSON Logic | Simple rules without OPA dependency |
| `DtLgModule` | Graph database | LangGraph | AI-powered analysis workflows |

Each base class provides:
- Automatic class registration and metadata management
- Built-in database operations (DbOps)
- Policy evaluation helpers (OpaOps)
- LangGraph operations (DtLgAnalysisOps, DtLgDocumentOps)
- GraphQL resolver integration

**Developer Experience**: Creating a new OPA-based module requires only defining class schemas and Rego policies—the base class handles database persistence, GraphQL integration, and policy evaluation automatically.

#### AI-Assisted Module Creation

The platform includes LangGraph workflows that dramatically lower the barrier to module development:

| Workflow | Input | Output |
|----------|-------|--------|
| **Component Class Graph** | Existing component instance | Exposure vectors, OPA/Rego policies, JSONForms schemas, configuration guides |
| **Control Class Graph** | Natural language description | Control class with countermeasures, MITRE D3FEND/ATT&CK mappings, Rego policies |

Both workflows include human-in-the-loop approval before persisting generated artifacts. Users can describe security controls in plain English and receive production-ready module code.

**Market Advantage**: New security domains (cloud security, OT/ICS, IoT) can be added as modules without platform changes, enabling rapid market expansion. AI-assisted creation further reduces time-to-value for custom security logic.

### 2. Graph-Native Threat Modeling

Threat models are graph structures, not document trees:

| Traditional Approach | Dethernety Approach |
|---------------------|---------------------|
| Documents/spreadsheets | Native graph representation |
| Manual relationship tracking | Automatic traversal queries |
| Static MITRE mapping | Dynamic technique linking |
| Siloed analysis | Cross-model threat correlation |

**Technical Advantage**: Cypher queries like "find all components reachable from internet-facing processes that handle PII" are single-query operations.

### 3. AI-Integrated Analysis

AI is architecturally embedded, not bolted on:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AI ANALYSIS ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Analysis   │───►│   LangGraph  │───►│   Results    │                   │
│  │   Request    │    │   Workflow   │    │   Store      │                   │
│  └──────────────┘    └──────┬───────┘    └──────────────┘                   │
│                             │                                               │
│           ┌─────────────────┼─────────────────┐                             │
│           │                 │                 │                             │
│           ▼                 ▼                 ▼                             │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                   │
│  │  Graph Context │ │  Vector Search │ │  Human Review  │                   │
│  │  (Threat Model)│ │  (Similar      │ │  (Interrupt    │                   │
│  │                │ │   Patterns)    │ │   Points)      │                   │
│  └────────────────┘ └────────────────┘ └────────────────┘                   │
│                                                                             │
│  FEATURES:                                                                  │
│  • Real-time streaming of analysis progress                                 │
│  • Human-in-the-loop for critical decisions                                 │
│  • Long-running sessions (15+ minutes)                                      │
│  • Resumable after interruption                                             │
│  • Unified retrieval API regardless of storage backend                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4. Unified Data Access Layer (dt-core)

The `dt-core` packages provide consistent data access across all platform clients:

| Client | Language | Package |
|--------|----------|---------|
| Web UI | TypeScript | `dt-core` |
| Backend | TypeScript | `dt-core` |
| MCP Server | Python | `dt-core-py` |
| CLI Tools | TypeScript/Python | `dt-core` / `dt-core-py` |

**Engineering Advantage**: Single implementation of GraphQL operations ensures consistency; bug fixes apply everywhere.

---

## Security Architecture

### Security Principles

The infrastructure is designed around five core security principles:

| Principle | Implementation |
|-----------|----------------|
| **Least Privilege** | IAM roles with hardcoded ARNs (no wildcards); customer roles scoped to own resources only |
| **Defense in Depth** | Multiple security layers at each tier; triple validation on management API |
| **Blast Radius Isolation** | Customer compromise cannot affect other customers; self-service provisioning with isolated IAM |
| **Zero Trust** | All requests validated at every hop; management-service re-validates JWT even after API Gateway |
| **Encryption Everywhere** | TLS 1.2+ in transit; AES-256 at rest (S3, EBS, Secrets Manager) |

### Defense in Depth

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SECURITY LAYERS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 1: NETWORK & INFRASTRUCTURE (Zero-Trust)                             │
│  ───────────────────────────────────────────────                            │
│  • TLS 1.2+ for all communications                                          │
│  • Customer VPC isolation (dedicated /28 subnets, 4000+ capacity)           │
│  • No public IPs on EC2—traffic via CloudFront VPC Origin only              │
│  • CloudFront custom header validation (X-CloudFront-Secret)                │
│  • Security groups: only CloudFront ENI and Lambda can reach EC2            │
│  • Split-horizon DNS (public vs private Route53 zones)                      │
│  • Self-service deployment: each customer's infra deployed by their own     │
│    Lambda/Fargate with IAM scoped exclusively to their resources            │
│                                                                             │
│  LAYER 2: AUTHENTICATION                                                    │
│  ─────────────────────                                                      │
│  • OIDC/OAuth2 with PKCE flow (no client secrets)                           │
│  • JWT validation against JWKS endpoints                                    │
│  • Token auto-refresh preventing session expiration                         │
│  • MFA support (TOTP) via Cognito                                           │
│  • Support for enterprise IdPs (Cognito, Keycloak, Auth0, Zitadel)          │
│                                                                             │
│  LAYER 3: API PROTECTION                                                    │
│  ─────────────────────                                                      │
│  • GraphQL query depth limiting                                             │
│  • Complexity scoring to prevent DoS                                        │
│  • Input validation on all parameters                                       │
│  • Sanitized error responses (no internal leakage)                          │
│  • Management API: triple validation (API Gateway → Lambda → nginx → app)   │
│                                                                             │
│  LAYER 4: MODULE SECURITY                                                   │
│  ─────────────────────                                                      │
│  • Sigstore/cosign package signing (keyless OIDC, no key management)        │
│  • Identity-based verification against allowlist before installation        │
│  • Signatures recorded in Sigstore Rekor transparency log for audit         │
│  • Production module whitelisting                                           │
│  • Lifecycle scripts execute in isolated Podman container (no network,      │
│    read-only, dropped capabilities)                                         │
│                                                                             │
│  LAYER 5: OS & CONTAINER SECURITY                                           │
│  ─────────────────────────────                                              │
│  • Fedora CoreOS: immutable OS, read-only root filesystem                   │
│  • SELinux enforcing mode with container-specific policies                  │
│  • Podman rootless containers with dropped capabilities                     │
│  • Instance replacement on update (no in-place modification)                │
│                                                                             │
│  LAYER 6: DATA PROTECTION                                                   │
│  ─────────────────────                                                      │
│  • AES-256 encryption at rest (S3, EBS, Terraform state)                    │
│  • Customer data isolation in graph database                                │
│  • Credential masking in logs                                               │
│  • S3 versioning for recovery; public access blocked                        │
│  • Audit logging for compliance                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Management API Security

The management API (key management, service control) uses a zero-trust architecture with minimal attack surface:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          MANAGEMENT API REQUEST FLOW                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  [Client] ──JWT──► [API Gateway] ──JWT──► [Lambda] ──JWT + Secret──► [nginx] ──►    │
│                           │                  │                          │           │
│                           ▼                  ▼                          ▼           │
│                     Cognito JWT          VPC-isolated             X-Lambda-Secret   │
│                     authorizer           (no public IP)          header validation  │
│                                                                                     │
│  ──► [management-service (Go)]                                                      │
│              │                                                                      │
│              ▼                                                                      │
│      Zero-trust JWT                                                                 │
│      re-validation                                                                  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

| Security Property | Implementation |
|-------------------|----------------|
| **Zero Trust** | JWT validated at every hop—API Gateway, then re-validated by management-service against Cognito JWKS |
| **Minimal Attack Surface** | Go static binary in scratch container (~7MB, no shell, no package manager) |
| **Network Isolation** | Lambda in VPC private subnet; management-service only reachable via localhost |
| **Secret Chaining** | X-Lambda-Secret header ensures only Lambda (not direct access) can reach nginx |
| **Restricted Privileges** | Service control via loopback SSH to `mgmt-restart` user with sudoers limited to specific `systemctl` commands |
| **No Key Exposure** | `/keys/status` returns only `true`/`false`, never actual API key values |

### Multi-Tenant Isolation

Each customer receives completely isolated infrastructure:

| Resource | Isolation Level |
|----------|-----------------|
| Network | Dedicated /28 subnet (no cross-customer routing) |
| Compute | Dedicated EC2 instance (Fedora CoreOS, SELinux) |
| Storage | Dedicated EBS volume + S3 buckets (hardcoded ARN policies) |
| DNS | Split-horizon Route53 zones (EC2 can only write TXT records) |
| CDN | Dedicated CloudFront distribution with VPC Origin |
| Identity | Dedicated Cognito user pool with PKCE |
| IAM | Customer-scoped roles with hardcoded ARNs (no wildcards) |
| Provisioning | Dedicated Lambda/Fargate with isolated IAM credentials |

**Blast Radius**: Each customer's provisioner runs with IAM credentials scoped exclusively to their own resources. Compromise of one customer's provisioner cannot affect any other customer.

---

## Scalability & Deployment

### Multi-Tenant SaaS Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DEPLOYMENT ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         AWS Region (eu-central-1)                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     SHARED INFRASTRUCTURE                           │    │
│  │                                                                     │    │
│  │  • Management VPC (10.1.0.0/16)                                     │    │
│  │  • NAT instance for outbound internet                               │    │
│  │  • ECR repositories for container images                            │    │
│  │  • S3 buckets for artifacts and configuration                       │    │
│  │  • Route53 parent zone (dethernety.io)                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     CUSTOMER VPC (10.0.0.0/16)                      │    │
│  │                                                                     │    │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐    │    │
│  │  │  Customer A      │  │  Customer B      │  │  Customer N     │    │    │
│  │  │  10.0.0.16/28    │  │  10.0.0.32/28    │  │  10.0.x.x/28    │    │    │
│  │  │                  │  │                  │  │                 │    │    │
│  │  │  EC2 + Services  │  │  EC2 + Services  │  │  EC2 + Services │    │    │
│  │  │  CloudFront CDN  │  │  CloudFront CDN  │  │  CloudFront CDN │    │    │
│  │  │  S3 Storage      │  │  S3 Storage      │  │  S3 Storage     │    │    │
│  │  └──────────────────┘  └──────────────────┘  └─────────────────┘    │    │
│  │                                                                     │    │
│  │  CAPACITY: 4,000+ customers per AWS account                         │    │
│  │                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Self-Service Provisioning

Customer infrastructure is provisioned through isolated, least-privilege execution:

1. **Registration** - Cognito user pool created; customer can log in immediately
2. **Payment** - Account resources provisioned (subnet, DNS, IAM roles, provisioning Lambda)
3. **Deployment** - Customer triggers self-service deployment; dedicated Lambda executes Terraform
4. **Operational** - Full access to platform at `{customer_id}.dethernety.io`

**Security**: Each customer's provisioner runs with IAM credentials scoped exclusively to their own resources.

### Horizontal Scaling

| Component | Scaling Strategy |
|-----------|-----------------|
| Web UI | CloudFront edge caching |
| API Server | Stateless; add instances behind load balancer |
| Graph Database | Read replicas for query distribution |
| AI Engine | LangGraph horizontal pod autoscaling |
| Vector Store | PostgreSQL connection pooling |

---

## Detailed Documentation

### Architecture Documentation Map

```
docs/architecture/
├── ARCHITECTURE.md                    ← This document (executive overview)
│
├── frontend/                          # Frontend architecture
│   ├── TECHNICAL_OVERVIEW.md          # Executive summary
│   ├── FRONTEND_ARCHITECTURE.md       # Complete technical reference
│   └── LLD/                           # Low-level design
│       ├── Data architecture/         # Generic patterns
│       ├── AUTHENTICATION.md          # OIDC/PKCE flow
│       ├── APOLLO_CLIENT.md           # GraphQL client setup
│       ├── FLOW_STORE.md              # Optimistic updates
│       └── MODULE_SYSTEM.md           # Dynamic module loading
│
├── backend/                           # Backend architecture
│   ├── TECHNICAL_OVERVIEW.md          # Executive summary
│   ├── BACKEND_ARCHITECTURE.md        # Complete technical reference
│   └── LLD/                           # Low-level design (17 documents)
│       ├── 01-gql-module.md           # GraphQL module
│       ├── 02-schema-service.md       # Dynamic schema builder
│       ├── 03-module-registry.md      # Module lifecycle
│       └── ...                        # Additional services
│
├── dt-core/                           # Shared data access layer
│   ├── OVERVIEW.md                    # Package introduction
│   ├── DOMAIN_MODEL.md                # Core interfaces
│   ├── DATA_ACCESS_LAYER.md           # Utility patterns
│   ├── GRAPHQL_OPERATIONS.md          # Domain classes
│   └── IMPORT_EXPORT.md               # Model serialization
│
├── modules/                           # Module system
│   ├── OVERVIEW.md                    # Module system introduction
│   ├── DT_MODULE_INTERFACE.md         # Core contract
│   ├── BASE_CLASSES.md                # Implementation patterns
│   ├── UTILITY_CLASSES.md             # Helper classes
│   ├── AI_ASSISTED_CREATION.md        # AI-powered class generation
│   ├── module-development.md          # Development guide
│   └── MODULE_PACKAGE_DESIGN.md       # Cloud deployment
│
├── dethereal/                         # MCP Server (AI integration)
│   ├── README.md                      # Quick reference
│   └── ARCHITECTURE.md                # Complete technical reference
│
└── infrastructure/                    # Cloud infrastructure
    ├── 01-architecture-overview.md    # Deployment model
    ├── 02-deployment-stages.md        # Phase breakdown
    ├── 03-customer-provisioning.md    # Self-service flow
    └── 04-security-architecture.md    # Security controls
```

### Quick Reference Links

| Topic | Document |
|-------|----------|
| **Frontend Technical Overview** | [frontend/TECHNICAL_OVERVIEW.md](./frontend/TECHNICAL_OVERVIEW.md) |
| **Backend Technical Overview** | [backend/TECHNICAL_OVERVIEW.md](./backend/TECHNICAL_OVERVIEW.md) |
| **dt-core Package** | [dt-core/OVERVIEW.md](./dt-core/OVERVIEW.md) |
| **Module System** | [modules/OVERVIEW.md](./modules/OVERVIEW.md) |
| **Infrastructure Overview** | [infrastructure/01-architecture-overview.md](./infrastructure/01-architecture-overview.md) |
| **Security Architecture** | [infrastructure/04-security-architecture.md](./infrastructure/04-security-architecture.md) |

---

## Summary: Investment Considerations

### Strategic Moats

| Moat | Defensibility |
|------|---------------|
| **Graph-Native Data Model** | Competitors using relational databases cannot retrofit graph traversal capabilities. Security relationships require native graph structures for meaningful analysis. |
| **Swappable Analysis Backend** | DTModule abstraction enables any analysis engine (query, rule, AI) through unified API. Protects against AI model commoditization—can swap providers without platform changes. |
| **Executable Module System** | Real JavaScript classes with full platform access. Not YAML/JSON config—enables sophisticated integrations (cloud APIs, CMDBs, compliance frameworks) that config-based systems cannot match. |

### Technical Strengths

| Strength | Evidence |
|----------|----------|
| **Graph-Native Architecture** | Bolt/Cypher database with native traversal queries |
| **Analysis Engine Flexibility** | Query-based, rule-based, single-agent AI, multi-agent AI—same API |
| **Runtime Module Loading** | JavaScript classes loaded at runtime with full platform access |
| **Modern Stack** | Vue 3, NestJS, TypeScript, LangGraph—current best practices |
| **Enterprise-Ready** | Multi-tenant isolation, OIDC/OAuth2, comprehensive security |

### Competitive Advantages

1. **Graph-Native Threat Modeling** - Security relationships as first-class graph structures, not document attachments
2. **Pluggable Analysis Engines** - Swap between query, rule-based, and AI analysis without API changes
3. **Executable Modules** - Real code, not configuration—enables sophisticated integrations
4. **Database Flexibility** - Neo4j or Memgraph deployment options (cost optimization)
5. **Standards Integration** - MITRE ATT&CK and D3FEND built-in
6. **Enterprise Authentication** - Multi-IdP support (Cognito, Keycloak, Auth0, Zitadel)

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **AI Model Commoditization** | Analysis engine abstraction allows model swapping; not locked to single provider |
| **Technology Lock-in** | Standards-based (Bolt/Cypher, OIDC, GraphQL) |
| **Scaling Limitations** | Stateless design, horizontal scaling ready |
| **Security Vulnerabilities** | Defense-in-depth, multi-tenant isolation |
| **Maintenance Burden** | TypeScript type safety, comprehensive documentation |

---

*This document provides an executive-level overview. For detailed technical information, refer to the domain-specific documentation linked above.*
