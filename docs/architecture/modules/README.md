# Module System Overview

## Table of Contents
- [Introduction](#introduction)
- [Module System Architecture](#module-system-architecture)
- [Module Types](#module-types)
- [Documentation Structure](#documentation-structure)
- [Quick Reference](#quick-reference)

## Introduction

The Dethernety module system provides an extensible architecture for adding threat modeling capabilities, security analysis, and AI-powered features. Modules can provide component classifications, security policies, exposure detection rules, and AI analysis workflows.

**Key Packages:**
- `packages/dt-module` - TypeScript library for module development
- `modules/` - Module implementations (deployable packages)

**Available Modules:**
| Module | Description |
|--------|-------------|
| `dethernety-module` | Core threat modeling classes with OPA/Rego policies |
| `mitre-frameworks` | MITRE ATT&CK and D3FEND data ingestion |

Additional analysis and custom modules can be developed using the DTModule interface (see [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)).

---

## Module System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Module System Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Module Registry Service                    │    │
│  │                       (apps/dt-ws/src)                          │    │
│  │                                                                 │    │
│  │   • Discovers and loads modules at startup                      │    │
│  │   • Registers module metadata in graph database                 │    │
│  │   • Routes GraphQL requests to appropriate modules              │    │
│  │   • Manages module lifecycle                                    │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│          ┌─────────────────┼─────────────────┐                          │
│          │                 │                 │                          │
│          ▼                 ▼                 ▼                          │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                  │
│  │  Dethernety   │ │   Analysis    │ │    Custom     │                  │
│  │   Module      │ │    Module     │ │   Modules     │                  │
│  │               │ │               │ │               │                  │
│  │ OPA/Rego      │ │ AI Analysis   │ │ JSON Logic    │                  │
│  │ Policies      │ │ Analysis      │ │ Rules         │                  │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘                  │
│          │                 │                 │                          │
│          └─────────────────┼─────────────────┘                          │
│                            │                                            │
│              ┌─────────────┴─────────────┐                              │
│              │                           │                              │
│              ▼                           ▼                              │
│  ┌───────────────────────┐   ┌───────────────────────┐                  │
│  │   Graph Database      │   │  External Services    │                  │
│  │   (Bolt/Cypher)       │   │                       │                  │
│  │ • Module metadata     │   │ • OPA Server          │                  │
│  │ • Class definitions   │   │ • Analysis APIs        │                  │
│  │ • Model instances     │   │ • AI Providers        │                  │
│  │ • Rego policies       │   │                       │                  │
│  └───────────────────────┘   └───────────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Module Types

Dethernety supports multiple module implementation patterns:

### 1. Database-Backed OPA Modules

**Base Class:** `DtNeo4jOpaModule`

Stores class definitions and Rego policies in the graph database. Evaluates exposures and countermeasures using OPA server.

```typescript
import { DtNeo4jOpaModule } from '@dethernety/dt-module';

class MyModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    super('my-module', driver, logger);
  }
}
```

**Use Cases:**
- Production modules with dynamic class updates
- Centralized policy management
- Multi-instance deployments

### 2. File-Based OPA Modules

**Base Class:** `DtFileOpaModule`

Loads class definitions from JSON files and evaluates Rego policies via OPA server.

```typescript
import { DtFileOpaModule } from '@dethernety/dt-module';

class MyModule extends DtFileOpaModule {
  constructor(driver: any) {
    super('./module-data', 'my-module', driver);
  }
}
```

**Use Cases:**
- Development and testing
- Standalone deployments
- Version-controlled module configurations

### 3. File-Based JSON Logic Modules

**Base Class:** `DtFileJsonModule`

Uses JSON Logic rules for exposure/countermeasure evaluation instead of OPA.

```typescript
import { DtFileJsonModule } from '@dethernety/dt-module';

class MyModule extends DtFileJsonModule {
  constructor(driver: any) {
    super('./module-data', 'my-module', driver);
  }
}
```

**Use Cases:**
- Simple rule evaluation
- No OPA server dependency
- Embedded deployments

### 4. Analysis Modules

**Base Class:** `DtLgModule`

Integrates with an external LangGraph-compatible server for AI-powered security analysis workflows. Requires `LANGGRAPH_API_URL` to be configured.

```typescript
import { DtLgModule } from '@dethernety/dt-module';

class MyAnalysisModule extends DtLgModule {
  constructor(driver: any, logger: Logger) {
    super('my-analysis', driver, logger, {
      analysisConfig: myGraphConfig,
      metadata: {
        description: 'AI-powered threat analysis',
        version: '1.0.0',
        author: 'My Team'
      }
    });
  }
}
```

**Use Cases:**
- AI-powered threat analysis
- Attack scenario generation
- Interactive security chat

---

## Documentation Structure

This folder contains the following documentation:

| Document | Description |
|----------|-------------|
| **README.md** (this file) | Module system introduction and navigation |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Implementation patterns (OPA, JSON, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, OpaOps, LangGraph ops) |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step module development guide |
| [MODULE_PACKAGE_DESIGN.md](./MODULE_PACKAGE_DESIGN.md) | Module packaging and deployment system |

---

## Quick Reference

### DTModule Interface Methods

| Method | Required | Description |
|--------|----------|-------------|
| `getMetadata()` | Yes | Returns module name, classes, version |
| `getModuleTemplate()` | No | JSON Schema for module configuration |
| `getClassTemplate(id)` | No | JSON Schema for class attributes |
| `getClassGuide(id)` | No | Usage guidance for class configuration |
| `getExposures(id, classId)` | No | Evaluate exposures for an element |
| `getCountermeasures(id, classId)` | No | Evaluate countermeasures for an element |
| `runAnalysis(...)` | No | Start an analysis workflow |
| `startChat(...)` | No | Start interactive analysis chat |
| `resumeAnalysis(...)` | No | Resume paused analysis |
| `getAnalysisStatus(id)` | No | Get analysis execution status |
| `deleteAnalysis(id)` | No | Delete analysis session |

### Class Types

Modules can provide these class types:

| Class Type | Graph Label | Description |
|------------|-------------|-------------|
| Component | `DTComponentClass` | System components (PROCESS, EXTERNAL_ENTITY, STORE) |
| DataFlow | `DTDataFlowClass` | Data flow connections |
| SecurityBoundary | `DTSecurityBoundaryClass` | Trust zones and boundaries |
| Data | `DTDataClass` | Data classifications |
| Control | `DTControlClass` | Security controls |
| Issue | `DTIssueClass` | Issue types for tracking |
| Analysis | `AnalysisClass` | AI analysis workflows |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPA_COMPILE_SERVER_URL` | `http://localhost:8181` | OPA server URL for Rego evaluation |

> `LANGGRAPH_API_URL` (default: `http://localhost:8123`) is required only when using `DtLgModule`. See [BASE_CLASSES.md](./BASE_CLASSES.md) for details.

---

## Related Documentation

| Document | Location |
|----------|----------|
| Architecture Overview | [../README.md](../README.md) |
| dt-core Package | [../dt-core/](../dt-core/) |
| Backend Architecture | [../backend/](../backend/) |
| Frontend Module System | [../frontend/LLD/MODULE_SYSTEM.md](../frontend/LLD/MODULE_SYSTEM.md) |
