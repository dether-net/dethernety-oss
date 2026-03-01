# dt-core Package Overview

## Table of Contents
- [Introduction](#introduction)
- [Package Purpose](#package-purpose)
- [Architecture](#architecture)
- [Core Responsibilities](#core-responsibilities)
- [Package Structure](#package-structure)
- [Consumers](#consumers)
- [Related Documentation](#related-documentation)

## Introduction

The `dt-core` package provides the central data access layer for the Dethernety threat modeling framework. It abstracts GraphQL operations and provides a clean, type-safe API for interacting with the graph database (Bolt/Cypher compatible, e.g., Neo4j, Memgraph).

## Package Purpose

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        dt-core Architecture                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│   │   Frontend      │    │   Backend       │    │   MCP Server    │     │
│   │   (Vue.js)      │    │   (NestJS)      │    │  (TypeScript)   │     │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│            │                      │                      │              │
│            └──────────────────────┼──────────────────────┘              │
│                                   │                                     │
│                      ┌────────────┴────────────┐                        │
│                      │       dt-core           │                        │
│                      │     (TypeScript)        │                        │
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

Applications interact with dt-core classes instead of writing GraphQL queries directly. The package is fully typed in TypeScript and includes retry, mutex, and deduplication patterns for network reliability. Because all consumers share the same implementation, a bug fix in dt-core applies everywhere.

---

## Architecture

The `dt-core` TypeScript package (`packages/dt-core`) is the shared data access layer used by the Frontend (Vue.js), Backend (NestJS), and MCP Server.

```typescript
import { DtModel, DtComponent, DtBoundary } from 'dt-core'

const dtModel = new DtModel(apolloClient)
const models = await dtModel.getModels()
```

The package provides:
- Domain interfaces — entity type definitions shared across all consumers
- Method signatures — standard operations per domain class
- GraphQL operations — shared query and mutation definitions
- Error handling — structured error logging and propagation

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

Network reliability patterns provided by `DtUtils` (used via composition):

- Retry with exponential backoff for transient network failures
- Mutex protection against race conditions on concurrent operations
- Request deduplication to avoid duplicate in-flight requests
- Structured error logging and propagation

---

## Package Structure

### Directory Layout (`packages/dt-core/src/`)

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

### MCP Server (TypeScript)

The MCP server uses dt-core for threat model operations:

```typescript
// MCP Server tools
import { DtImport, DtExport, DtModel } from 'dt-core'

const dtImport = new DtImport(apolloClient)
const result = await dtImport.importModel(data, { folderId })
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) | Core interfaces and entity relationships |
| [DATA_ACCESS_LAYER.md](./DATA_ACCESS_LAYER.md) | DtUtils patterns (retry, mutex, deduplication) |
| [GRAPHQL_OPERATIONS.md](./GRAPHQL_OPERATIONS.md) | Domain classes and method signatures |
| [IMPORT_EXPORT.md](./IMPORT_EXPORT.md) | Model serialization and ID mapping |
| [Architecture Overview](../README.md) | Overall platform architecture |
