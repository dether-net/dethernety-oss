# dt-core Package Overview

## Table of Contents
- [Introduction](#introduction)
- [Package Purpose](#package-purpose)
- [Dual-Language Architecture](#dual-language-architecture)
- [Core Responsibilities](#core-responsibilities)
- [Package Structure](#package-structure)
- [Consumers](#consumers)
- [Related Documentation](#related-documentation)

## Introduction

The `dt-core` packages provide the central data access layer for the Dethernety threat modeling framework. They abstract GraphQL operations and provide a clean, type-safe API for interacting with the graph database (Bolt/Cypher compatible, e.g., Neo4j, Memgraph).

## Package Purpose

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        dt-core Architecture                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│   │   Frontend      │    │   Backend       │    │   MCP Server    │     │
│   │   (Vue.js)      │    │   (NestJS)      │    │   (Python)      │     │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│            │                      │                      │              │
│            └──────────────────────┼──────────────────────┘              │
│                                   │                                     │
│                      ┌────────────┴────────────┐                        │
│                      │                         │                        │
│              ┌───────┴───────┐         ┌───────┴───────┐                │
│              │   dt-core     │         │  dt-core-py   │                │
│              │  (TypeScript) │         │   (Python)    │                │
│              └───────┬───────┘         └───────┬───────┘                │
│                      │                         │                        │
│                      └────────────┬────────────┘                        │
│                                   │                                     │
│                      ┌────────────┴────────────┐                        │
│                      │     GraphQL API         │                        │
│                      └────────────┬────────────┘                        │
│                                   │                                     │
│                      ┌────────────┴────────────┐                        │
│                      │  Graph DB (Bolt/Cypher) │                        │
│                      └─────────────────────────┘                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Value Propositions:**

| Capability | Description |
|------------|-------------|
| **Abstraction** | Hides GraphQL complexity from applications |
| **Type Safety** | Full TypeScript/Python type definitions |
| **Consistency** | Unified API across all consumers |
| **Resilience** | Built-in retry, mutex, and deduplication patterns |
| **Reusability** | Shared business logic across frontend, backend, and tooling |

---

## Dual-Language Architecture

The dt-core functionality is implemented in two languages to serve different parts of the system:

### TypeScript Package (`packages/dt-core`)

**Primary consumers:** Frontend (Vue.js), Backend (NestJS)

```typescript
import { DtModel, DtComponent, DtBoundary } from 'dt-core'

const dtModel = new DtModel(apolloClient)
const models = await dtModel.getModels()
```

### Python Package (`packages/dt-core-py`)

**Primary consumers:** MCP Server, AI Analysis Engine, CLI tools

```python
from dt_core import DtModel, DtComponent, DtBoundary

dt_model = DtModel(gql_client)
models = await dt_model.get_models()
```

### Shared Contract

Both packages implement the same:
- **Domain interfaces** - Identical entity structures
- **Method signatures** - Same operations with language-appropriate naming
- **GraphQL operations** - Shared query/mutation definitions
- **Error handling patterns** - Consistent error structures

---

## Core Responsibilities

### 1. Domain Model Definition

Defines all entities in the threat modeling domain:

| Entity Category | Examples |
|-----------------|----------|
| **Organizational** | `Folder`, `Module`, `Control` |
| **Model Elements** | `Model`, `ComponentData`, `BoundaryData`, `DataFlowData` |
| **Security Data** | `Exposure`, `Countermeasure`, `Issue` |
| **Frameworks** | `MitreAttackTechnique`, `MitreDefendTechnique` |
| **Analysis** | `Analysis`, `AnalysisClass`, `AnalysisSession` |

### 2. Data Access Operations

Each domain area has a dedicated class:

| Class | Purpose |
|-------|---------|
| `DtModel` | Model CRUD, data export |
| `DtComponent` | System component management |
| `DtBoundary` | Security boundary/trust zone management |
| `DtDataflow` | Data flow edge management |
| `DtDataItem` | Data classification management |
| `DtClass` | Entity classification and templates |
| `DtModule` | Module registry operations |
| `DtControl` | Security control management |
| `DtAnalysis` | AI analysis workflows |
| `DtIssue` | Issue tracking |
| `DtExport` | Model serialization to JSON |
| `DtImport` | Model deserialization from JSON |

### 3. Infrastructure Patterns

The packages provide resilient data access through:

- **Retry with exponential backoff** - Handles transient network failures
- **Mutex protection** - Prevents race conditions on concurrent operations
- **Request deduplication** - Avoids duplicate in-flight requests
- **Structured error handling** - Consistent error logging and propagation

---

## Package Structure

### TypeScript (`packages/dt-core/src/`)

```
dt-core/src/
├── index.ts                     # Package exports
├── interfaces/
│   └── core-types-interface.ts  # All domain interfaces
├── dt-utils/
│   └── dt-utils.ts              # Base utility class
├── dt-model/
│   ├── dt-model.ts              # Model operations
│   └── dt-model-gql.ts          # GraphQL definitions
├── dt-component/
│   ├── dt-component.ts
│   └── dt-component-gql.ts
├── dt-boundary/
│   ├── dt-boundary.ts
│   └── dt-boundary-gql.ts
├── dt-dataflow/
│   ├── dt-dataflow.ts
│   └── dt-dataflow-gql.ts
├── dt-dataitem/
│   ├── dt-dataitem.ts
│   └── dt-dataitem-gql.ts
├── dt-class/
│   ├── dt-class.ts
│   └── dt-class-gql.ts
├── dt-module/
│   ├── dt-module.ts
│   └── dt-module-gql.ts
├── dt-control/
│   ├── dt-control.ts
│   └── dt-control-gql.ts
├── dt-analysis/
│   ├── dt-analysis.ts
│   └── dt-analysis-gql.ts
├── dt-issue/
│   ├── dt-issue.ts
│   └── dt-issue-gql.ts
├── dt-folder/
│   ├── dt-folder.ts
│   └── dt-folder-gql.ts
├── dt-exposure/
│   ├── dt-exposure.ts
│   └── dt-exposure-gql.ts
├── dt-countermeasure/
│   ├── dt-countermeasure.ts
│   └── dt-countermeasure-gql.ts
├── dt-mitreattack/
│   ├── dt-mitreattack.ts
│   └── dt-mitreattack-gql.ts
├── dt-mitredefend/
│   ├── dt-mitredefend.ts
│   └── dt-mitredefend-gql.ts
├── dt-export/
│   └── dt-export.ts
└── dt-import/
    └── dt-import.ts
```

### Python (`packages/dt-core-py/dt_core/`)

```
dt_core/
├── __init__.py                  # Package exports
├── interfaces/
│   └── core_types.py            # Domain dataclasses
├── utils/
│   └── dt_utils.py              # Base utility class
├── model/
│   ├── dt_model.py
│   └── dt_model_gql.py
├── component/
│   ├── dt_component.py
│   └── dt_component_gql.py
├── boundary/
│   ├── dt_boundary.py
│   └── dt_boundary_gql.py
├── dataflow/
│   ├── dt_dataflow.py
│   └── dt_dataflow_gql.py
├── dataitem/
│   ├── dt_dataitem.py
│   └── dt_dataitem_gql.py
├── class_/
│   ├── dt_class.py
│   └── dt_class_gql.py
├── module/
│   ├── dt_module.py
│   └── dt_module_gql.py
├── control/
│   ├── dt_control.py
│   └── dt_control_gql.py
├── analysis/
│   ├── dt_analysis.py
│   └── dt_analysis_gql.py
├── issue/
│   ├── dt_issue.py
│   └── dt_issue_gql.py
├── folder/
│   ├── dt_folder.py
│   └── dt_folder_gql.py
├── exposure/
│   ├── dt_exposure.py
│   └── dt_exposure_gql.py
├── countermeasure/
│   ├── dt_countermeasure.py
│   └── dt_countermeasure_gql.py
├── mitre_attack/
│   ├── dt_mitre_attack.py
│   └── dt_mitre_attack_gql.py
├── mitre_defend/
│   ├── dt_mitre_defend.py
│   └── dt_mitre_defend_gql.py
├── export/
│   └── dt_export.py
└── import_/
    ├── dt_import.py
    └── dt_update.py
```

---

## Consumers

### Frontend (Vue.js)

The frontend uses dt-core through Pinia stores:

```typescript
// stores/flowStore.ts
import apolloClient from '@/plugins/apolloClient'
import { DtModel, DtComponent, DtBoundary, DtDataflow } from 'dt-core'

export const useFlowStore = defineStore('flow', () => {
  const dtModel = new DtModel(apolloClient)
  const dtComponent = new DtComponent(apolloClient)
  const dtBoundary = new DtBoundary(apolloClient)
  const dtDataflow = new DtDataflow(apolloClient)

  const loadModel = async (modelId: string) => {
    return dtModel.getModel({ modelId })
  }

  // ... store implementation
})
```

### Backend (NestJS)

The backend uses dt-core for validation and transformation:

```typescript
// services/model.service.ts
import { DtModel, DtExport } from 'dt-core'

@Injectable()
export class ModelService {
  private dtModel: DtModel
  private dtExport: DtExport

  constructor(apolloClient: ApolloClient) {
    this.dtModel = new DtModel(apolloClient)
    this.dtExport = new DtExport(apolloClient)
  }
}
```

### MCP Server (Python)

The MCP server uses dt-core-py for threat model operations:

```python
# mcp_server/handlers.py
from dt_core import DtImport, DtExport, DtModel

async def import_model(data: dict, folder_id: str):
    dt_import = DtImport(gql_client)
    result = await dt_import.import_model(data, ImportOptions(folder_id=folder_id))
    return result
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) | Core interfaces and entity relationships |
| [DATA_ACCESS_LAYER.md](./DATA_ACCESS_LAYER.md) | DtUtils patterns (retry, mutex, deduplication) |
| [GRAPHQL_OPERATIONS.md](./GRAPHQL_OPERATIONS.md) | Domain classes and method signatures |
| [IMPORT_EXPORT.md](./IMPORT_EXPORT.md) | Model serialization and ID mapping |
| [Architecture Overview](../ARCHITECTURE.md) | Overall platform architecture |
