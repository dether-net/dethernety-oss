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
| `dethernety-general` | General-purpose threat-model classes — components, controls, data flows, data assets, and security boundaries — with OPA/Rego policies (`DtFileOpaModule`) |
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
│  │ OPA/Rego      │ │ AI Analysis   │ │ Custom        │                  │
│  │ Policies      │ │ Analysis      │ │ Logic         │                  │
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
│  │ • Module metadata     │   │ • Analysis APIs       │                  │
│  │ • Class definitions   │   │ • AI Providers        │                  │
│  │ • Model instances     │   │                       │                  │
│  │                       │   │                       │                  │
│  └───────────────────────┘   └───────────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Module Types

Dethernety supports multiple module implementation patterns:

### 1. File-Based OPA Modules

**Base Class:** `DtFileOpaModule`

Loads class definitions from files and evaluates Rego policies in-process via the vendored Regorus WASM engine. This is the default policy-evaluating base class, used by the built-in `dethernety-general`.

```typescript
import { DtFileOpaModule } from '@dethernety/dt-module';

class MyModule extends DtFileOpaModule {
  constructor(driver: any) {
    super('./module-data', 'my-module', driver);
  }
}
```

**Use Cases:**
- Component classes with exposure/countermeasure policies
- Standalone deployments
- Version-controlled module configurations

### 2. Analysis Modules

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

### 3. Remote Content Modules

**Base Class:** `DtRemoteModule`

Serves its content — metadata, class templates, guides, embeddings, and evaluation — from an HTTP content service over the module content wire protocol, instead of from a local data directory. It is a sibling of `DtFileOpaModule` implementing the same `DTModule` contract, so the platform cannot tell it apart from a file-backed module. It carries no policy engine (evaluation is remote).

```typescript
import { DtRemoteModule } from '@dethernety/dt-module';

class MyRemoteModule extends DtRemoteModule {
  constructor(driver: any, logger: Logger) {
    super({ moduleKey: 'my-module', pin: 'sha256:…' }, driver, logger);
  }
}
```

Configuration is deployment-global: `MODULE_CONTENT_BASE_URL` (the content service; no default, so an unset value leaves the module inert) and `MODULE_CONTENT_CACHE_DIR` (**must be co-durable with the graph database** — see the [DtRemoteModule reference](./DT_MODULE_INTERFACE.md#remote-content-modules-dtremotemodule)). The `pin` is an immutable content-hash the operator advances by editing the stub and restarting.

**Use Cases:**
- Consuming hosted module content without shipping the content locally
- Content that is updated centrally rather than per-deployment

---

## Documentation Structure

This folder contains the following documentation:

| Document | Description |
|----------|-------------|
| **README.md** (this file) | Module system introduction and navigation |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Implementation patterns (OPA, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, LangGraph ops) |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step module development guide |
| [MODULE_PACKAGE_DESIGN.md](./MODULE_PACKAGE_DESIGN.md) | Module packaging and deployment system |

---

## Quick Reference

### DTModule Interface Methods

| Method | Required | Description |
|--------|----------|-------------|
| `getMetadata()` | Yes | Returns module name, classes, version |
| `getModuleTemplate()` | No | JSON Schema for module configuration |
| `getClassTemplate(id, token?)` | No | JSON Schema for class attributes |
| `getClassGuide(id, token?)` | No | Usage guidance for class configuration |
| `getExposures(id, classId, token?)` | No | Evaluate exposures for an element |
| `getCountermeasures(id, classId, token?)` | No | Evaluate countermeasures for an element |
| `isContentCallerVariant()` | No | Opt-in: content varies per caller → bypass the template cache |
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

Rego policy evaluation is in-process (the vendored Regorus WASM engine) and takes no configuration — there is no policy server to point at and no engine to select.

> `LANGGRAPH_API_URL` (default: `http://localhost:8123`) is required only when using `DtLgModule`. See [BASE_CLASSES.md](./BASE_CLASSES.md) for details.

---

## Related Documentation

| Document | Location |
|----------|----------|
| Architecture Overview | [../README.md](../README.md) |
| dt-core Package | [../dt-core/](../dt-core/) |
| Backend Architecture | [../backend/](../backend/) |
| Frontend Module System | [../frontend/LLD/MODULE_SYSTEM.md](../frontend/LLD/MODULE_SYSTEM.md) |
