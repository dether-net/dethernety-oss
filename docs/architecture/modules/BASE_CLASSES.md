# Module Base Classes

## Table of Contents
- [Overview](#overview)
- [Class Hierarchy](#class-hierarchy)
- [DtNeo4jOpaModule](#dtneo4jopamodule)
- [DtFileOpaModule](#dtfileopamodule)
- [DtFileJsonModule](#dtfilejsonmodule)
- [DtNeo4jJsonModule](#dtneo4jjsonmodule)
- [DtLgModule](#dtlgmodule)
- [Choosing the Right Base Class](#choosing-the-right-base-class)

## Overview

The `dt-module` package provides several base classes that implement the `DTModule` interface. Each base class represents a different approach to storing class definitions and evaluating security rules.

**Source Files:**
- `packages/dt-module/src/dt-neo4j-opa-module.ts`
- `packages/dt-module/src/dt-file-opa-module.ts`
- `packages/dt-module/src/dt-file-json-module.ts`
- `packages/dt-module/src/dt-neo4j-json-module.ts`
- `packages/dt-module/src/dt-lg-module.ts`

---

## Class Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Module Base Class Hierarchy                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                          <<interface>>                                  │
│                           DTModule                                      │
│                              │                                          │
│          ┌───────────────────┼───────────────────┐                      │
│          │                   │                   │                      │
│          ▼                   ▼                   ▼                      │
│  ┌──────────────────┐  ┌─────────────────┐  ┌───────────────┐           │
│  │ DtNeo4jOpaModule │  │ DtFileOpaModule │  │   DtLgModule  │           │
│  │                  │  │                 │  │               │           │
│  │ • DB storage     │  │ • File storage  │  │ • LangGraph   │           │
│  │ • OPA policies   │  │ • OPA policies  │  │   integration │           │
│  └──────────────────┘  └─────────────────┘  │ • AI analysis │           │
│          │                     │            └───────────────┘           │
│          │                     │                                        │
│          ▼                     ▼                                        │
│  ┌─────────────────┐   ┌────────────────┐                               │
│  │DtNeo4jJsonModule│   │DtFileJsonModule│                               │
│  │                 │   │                │                               │
│  │ • DB storage    │   │ • File storage │                               │
│  │ • JSON Logic    │   │ • JSON Logic   │                               │
│  └─────────────────┘   └────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Storage vs Evaluation Matrix

| Base Class | Storage | Rule Evaluation | Use Case |
|------------|---------|-----------------|----------|
| `DtNeo4jOpaModule` | Graph DB | OPA/Rego | Production, centralized |
| `DtFileOpaModule` | File System | OPA/Rego | Development, version-controlled |
| `DtNeo4jJsonModule` | Graph DB | JSON Logic | Production, no OPA dependency |
| `DtFileJsonModule` | File System | JSON Logic | Development, embedded |
| `DtLgModule` | N/A | LangGraph | AI analysis workflows |

---

## DtNeo4jOpaModule

The primary base class for database-backed modules. Stores class definitions in the graph database (Bolt/Cypher compatible, e.g., Neo4j, Memgraph) and evaluates Rego policies using an OPA server.

**Source File:** `packages/dt-module/src/dt-neo4j-opa-module.ts`

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DtNeo4jOpaModule Architecture                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      DtNeo4jOpaModule                           │    │
│  │                                                                 │    │
│  │   ┌───────────────────┐  ┌──────────────────┐  ┌─────────────┐  │    │
│  │   │   DbOps           │  │   OpaOps         │  │   Logger    │  │    │
│  │   │                   │  │                  │  │             │  │    │
│  │   │ • getAttribute    │  │ • evaluate       │  │ • log       │  │    │
│  │   │ • getInstantiation│  │ • installPolicies│  │ • error     │  │    │
│  │   └──────┬────────────┘  └──────┬───────────┘  └─────────────┘  │    │
│  │          │                      │                               │    │
│  └──────────┼──────────────────────┼───────────────────────────────┘    │
│             │                      │                                    │
│             ▼                      ▼                                    │
│    ┌───────────────────┐  ┌─────────────────┐                           │
│    │  Graph Database   │  │   OPA Server    │                           │
│    │  (Bolt/Cypher)    │  │                 │                           │
│    │ • DTModule        │  │ • Rego policies │                           │
│    │ • DTComponentClass│  │ • Policy eval   │                           │
│    │ • DTDataFlowClass │  │                 │                           │
│    │ • regoPolicies    │  │                 │                           │
│    └───────────────────┘  └─────────────────┘                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Constructor

```typescript
constructor(moduleName: string, driver: any, logger: Logger)
```

**Parameters:**
- `moduleName` - Unique module identifier (must match DTModule.name in database)
- `driver` - Bolt/Cypher compatible driver instance (Neo4j Driver or Memgraph Bolt)
- `logger` - NestJS Logger for structured logging

### Key Methods

#### getMetadata()

Retrieves module and class metadata from the graph database, then resets OPA policies.

```typescript
async getMetadata(): Promise<DTMetadata>
```

**Flow:**
1. Query graph database for module record (`DTModule {name: moduleName}`)
2. Query for all class types via `MODULE_PROVIDES_CLASS` relationships
3. Extract `regoPolicies` from each class
4. Call `resetPolicies()` to update OPA server
5. Return `DTMetadata` object

**Cypher Query Pattern:**
```cypher
MATCH (module:DTModule {name: $moduleName})
RETURN module.name, module.description, module.version, module.author

MATCH (module:DTModule {name: $moduleName})-[:MODULE_PROVIDES_CLASS]->(cc:DTComponentClass)
RETURN cc.name, cc.type, cc.category, cc.regoPolicies, cc.id
```

#### getExposures() / getCountermeasures()

Evaluates Rego policies against element attributes.

```typescript
async getExposures(id: string, classId: string): Promise<Exposure[]>
async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]>
```

**Flow:**
1. Get element attributes via `DbOps.getInstantiationAttributes()`
2. Get class's `dt_class_id` via `DbOps.getAttribute()`
3. Get `regoPolicies` from database class node
4. Extract Rego package name from policy
5. Evaluate via `OpaOps.evaluate(policyPath, attributes)`
6. Map results to `Exposure[]` or `Countermeasure[]`

**Policy Path Construction:**
```typescript
const policyPath = regoPackageName?.replaceAll('.', '/') + '/exposures';
// e.g., "dethernety/webserver/exposures"
```

### Usage Example

```typescript
import { DtNeo4jOpaModule } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';

class DthernetyModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    super('dethernety-module', driver, logger);
  }
}

// In ModuleRegistryService
const module = new DthernetyModule(graphDbDriver, logger);
const metadata = await module.getMetadata();
```

---

## DtFileOpaModule

File-based storage with OPA policy evaluation. Loads class definitions from the file system.

**Source File:** `packages/dt-module/src/dt-file-opa-module.ts`

### Directory Structure

```
moduleDataDir/
└── module-name/
    ├── metadata.json              # Module metadata
    ├── ComponentClasses/
    │   └── WebServer/
    │       ├── metadata.json      # Class metadata
    │       ├── template.json      # JSON Schema template
    │       └── policies.rego      # OPA policies
    ├── DataFlowClasses/
    │   └── HTTPFlow/
    │       ├── metadata.json
    │       ├── template.json
    │       └── policies.rego
    ├── SecurityBoundaryClasses/
    ├── ControlClasses/
    └── DataClasses/
```

### Constructor

```typescript
constructor(moduleDataDir: string, moduleName: string, driver: any)
```

**Parameters:**
- `moduleDataDir` - Base directory containing module data
- `moduleName` - Module identifier (subdirectory name)
- `driver` - Bolt/Cypher compatible driver instance (for `DbOps` instance lookups)

The OPA server URL is read from the `OPA_COMPILE_SERVER_URL` or `OPA_SERVER_URL` environment variable (default: `http://localhost:8181`).

### Key Methods

#### getMetadata()

Scans directory structure and loads metadata from JSON files.

```typescript
async getMetadata(): Promise<DTMetadata>
```

**Flow:**
1. Delete existing OPA policies for this module (by prefix)
2. Read `metadata.json` from module directory
3. Scan each class type directory (`ComponentClasses/`, `DataFlowClasses/`, etc.)
4. For each class subdirectory, read `metadata.json` and install `policies.rego` via `OpaOps.installPolicies()`
5. Return aggregated `DTMetadata`

#### getExposures() / getCountermeasures()

Reads Rego policies from files and evaluates via OPA.

```typescript
async getExposures(id: string, classId: string): Promise<Exposure[]>
```

**Flow:**
1. Get class `path` attribute from graph database (stored during registration)
2. Read `policies.rego` from class directory
3. Extract Rego package name
4. Evaluate via OPA server using `OpaOps.evaluate()`

### Usage Example

```typescript
import { DtFileOpaModule } from '@dethernety/dt-module';

class DevModule extends DtFileOpaModule {
  constructor(driver: any) {
    super('./module-data', 'dev-module', driver);
  }
}
```

---

## DtFileJsonModule

File-based storage with JSON Logic rule evaluation. No OPA server required.

**Source File:** `packages/dt-module/src/dt-file-json-module.ts`

### Directory Structure

```
moduleDataDir/
└── module-name/
    ├── metadata.json
    ├── ComponentClasses/
    │   └── WebServer/
    │       ├── metadata.json
    │       ├── template.json
    │       ├── exposure-rules.json      # JSON Logic rules
    │       └── countermeasure-rules.json
    └── ...
```

### Rule File Format

#### exposure-rules.json

```json
{
  "exposures": [
    {
      "condition": {
        "!": { "var": "authentication_enabled" }
      },
      "exposureTemplate": {
        "name": "Missing Authentication",
        "description": "Authentication is not enabled",
        "type": "vulnerability",
        "category": "access_control",
        "score": { "var": "exposure_score" },
        "exploitedBy": ["T1078"]
      }
    }
  ]
}
```

#### countermeasure-rules.json

```json
{
  "countermeasures": [
    {
      "condition": {
        "var": "tls_enabled"
      },
      "countermeasureTemplate": {
        "name": "TLS Encryption",
        "description": "Transport layer security is enabled",
        "type": "encryption",
        "category": "data_protection",
        "score": 8,
        "respondsWith": ["D3-NI"]
      }
    }
  ]
}
```

### Key Methods

#### getExposures()

Evaluates JSON Logic conditions against attributes.

```typescript
async getExposures(id: string, classId: string): Promise<Exposure[]>
```

**Flow:**
1. Get class path from graph database
2. Read `exposure-rules.json`
3. For each rule, evaluate `condition` using `jsonLogic.apply(condition, attributes)`
4. If condition matches, create `Exposure` from `exposureTemplate`
5. Dynamic score calculation via JSON Logic

```typescript
// Rule evaluation
const isMatch = jsonLogic.apply(condition, attributes);
if (isMatch) {
  exposures.push({
    name: exposureTemplate.name,
    score: jsonLogic.apply(exposureTemplate.score, attributes),
    // ...
  });
}
```

### Usage Example

```typescript
import { DtFileJsonModule } from '@dethernety/dt-module';

class EmbeddedModule extends DtFileJsonModule {
  constructor(driver: any) {
    super('./module-data', 'embedded-module', driver);
  }
}
```

---

## DtNeo4jJsonModule

Graph database storage with JSON Logic evaluation. Combines centralized storage with embedded rule evaluation.

**Source File:** `packages/dt-module/src/dt-neo4j-json-module.ts`

### Architecture

Similar to `DtNeo4jOpaModule` but stores JSON Logic rules in the graph database instead of Rego policies and evaluates them locally without an OPA server.

### Constructor

```typescript
constructor(moduleName: string, driver: any)
```

**Parameters:**
- `moduleName` - Unique module identifier (must match DTModule.name in database)
- `driver` - Bolt/Cypher compatible driver instance

Note: Unlike `DtNeo4jOpaModule`, this class does not require a logger parameter since it has no external service dependency (OPA) to manage.

### Key Differences from DtNeo4jOpaModule

| Aspect | DtNeo4jOpaModule | DtNeo4jJsonModule |
|--------|------------------|-------------------|
| Rule storage | `regoPolicies` property | `jsonLogicRules` property |
| Evaluation | OPA server | Local `jsonLogic.apply()` |
| Dependencies | OPA server required | No external dependencies |
| Rule complexity | Full Rego language | JSON Logic expressions |

---

## DtLgModule

Base class for LangGraph-integrated AI analysis modules. Requires an external LangGraph-compatible server configured via `LANGGRAPH_API_URL`. Modules that implement their own analysis logic can extend `DTModule` directly instead -- see [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md).

**Source File:** `packages/dt-module/src/dt-lg-module.ts`

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DtLgModule Architecture                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         DtLgModule                              │    │
│  │                                                                 │    │
│  │   ┌─────────────────┐   ┌─────────────────┐                     │    │
│  │   │ DtLgAnalysisOps │   │ DtLgDocumentOps │                     │    │
│  │   │                 │   │                 │                     │    │
│  │   │ • runAnalysis   │   │ • getDocument   │                     │    │
│  │   │ • startChat     │   │                 │                     │    │
│  │   │ • resumeAnalysis│   │                 │                     │    │
│  │   │ • getStatus     │   │                 │                     │    │
│  │   └────────┬────────┘   └────────┬────────┘                     │    │
│  │            │                     │                              │    │
│  └────────────┼─────────────────────┼──────────────────────────────┘    │
│               │                     │                                   │
│               └──────────┬──────────┘                                   │
│                          │                                              │
│                          ▼                                              │
│              ┌───────────────────────┐                                  │
│              │   LangGraph Client    │                                  │
│              │                       │                                  │
│              │ • SDK Client          │                                  │
│              │ • assistants.search() │                                  │
│              │ • runs.stream()       │                                  │
│              │ • store.getItem()     │                                  │
│              └───────────┬───────────┘                                  │
│                          │                                              │
│                          ▼                                              │
│              ┌───────────────────────┐                                  │
│              │   LangGraph Server    │                                  │
│              │                       │                                  │
│              │ • Assistants (graphs) │                                  │
│              │ • Threads (sessions)  │                                  │
│              │ • Store (documents)   │                                  │
│              └───────────────────────┘                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Constructor

```typescript
constructor(
  moduleName: string,
  driver: any,
  logger: Logger,
  options: LgModuleOptions
)
```

**Parameters:**
- `moduleName` - Module identifier
- `driver` - Graph database driver for model data access
- `logger` - NestJS Logger
- `options` - LangGraph configuration:
  - `langgraphApiUrl` - LangGraph server URL
  - `analysisConfig` - Graph configurations
  - `metadata` - Module description, version, author

### Analysis Configuration

```typescript
const analysisConfig: LgAnalysisConfig = {
  graphs: {
    'attack_scenario_analysis': {
      description: 'Generates attack scenarios for threat models',
      type: 'model_analysis',
      category: 'attack_scenario',

      // Build input payload
      input: async (scope, analysisId, driver, additionalParams) => {
        // Query model data from graph database
        const modelData = await getModelData(driver, scope);
        return {
          model_id: scope,
          model_data: modelData,
          ...additionalParams
        };
      },

      // Document storage location
      index_document: async (scope, analysisId) => ({
        namespace: ['attack_scenarios', scope],
        key: 'scenarios'
      }),

      // Post-process results
      post_process: async (result) => {
        return result.scenarios?.map(formatScenario);
      }
    }
  }
};
```

### Key Methods

#### getMetadata()

Returns metadata with `analysisClasses` populated from LangGraph assistants.

```typescript
async getMetadata(): Promise<DTMetadata>
```

**Flow:**
1. Query LangGraph for available assistants
2. Map assistant names to `analysisConfig.graphs`
3. Build `AnalysisClassMetadata[]` from mapping

#### runAnalysis()

Starts a new LangGraph analysis workflow.

```typescript
async runAnalysis(
  id: string,
  analysisClassId: string,
  scope: string,
  pubSub: ExtendedPubSubEngine,
  additionalParams?: object
): Promise<AnalysisSession>
```

**Flow:**
1. Delete existing session (if any)
2. Create new LangGraph thread
3. Find assistant by `analysisClassId`
4. Build input using `analysisConfig.graphs[name].input()`
5. Stream execution via LangGraph SDK
6. Publish results to GraphQL subscription via `pubSub`

#### startChat()

Starts an interactive chat session.

```typescript
async startChat(
  id: string,
  analysisClassId: string,
  scope: string,
  userQuestion: string,
  pubSub: ExtendedPubSubEngine,
  additionalParams?: object
): Promise<AnalysisSession>
```

#### getDocument()

Retrieves documents from LangGraph store.

```typescript
async getDocument(
  scope: string,
  analysisId: string,
  analysisClassId: string,
  filter: object
): Promise<object>
```

### Usage Example

```typescript
import { DtLgModule, LgAnalysisConfig } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';

const attackScenarioConfig: LgAnalysisConfig = {
  graphs: {
    'attack_scenario_analysis': {
      description: 'AI-powered attack scenario generation',
      type: 'model_analysis',
      category: 'attack_scenario',
      input: async (scope, analysisId, driver) => {
        // Build input from model data
        return { model_id: scope };
      }
    }
  }
};

class AttackScenarioModule extends DtLgModule {
  constructor(driver: any, logger: Logger) {
    super('example-attack-scenario', driver, logger, {
      analysisConfig: attackScenarioConfig,
      metadata: {
        description: 'Attack scenario analysis using AI',
        version: '1.0.0',
        author: 'Dethernety Team'
      }
    });
  }
}
```

---

## Choosing the Right Base Class

### Decision Tree

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Which Base Class Should I Use?                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Need AI-powered analysis?                                              │
│       │                                                                 │
│       ├── Yes ──────► DtLgModule                                        │
│       │                                                                 │
│       └── No ──► Need centralized storage?                              │
│                      │                                                  │
│                      ├── Yes ──► Can use OPA server?                    │
│                      │               │                                  │
│                      │               ├── Yes ──► DtNeo4jOpaModule       │
│                      │               │                                  │
│                      │               └── No ───► DtNeo4jJsonModule      │
│                      │                                                  │
│                      └── No ───► Can use OPA server?                    │
│                                      │                                  │
│                                      ├── Yes ──► DtFileOpaModule        │
│                                      │                                  │
│                                      └── No ───► DtFileJsonModule       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Comparison Table

| Feature | GraphDB+OPA | File+OPA | GraphDB+JSON | File+JSON | LangGraph |
|---------|-------------|----------|--------------|-----------|-----------|
| **Storage** | Centralized | Local files | Centralized | Local files | N/A |
| **Rule Language** | Rego | Rego | JSON Logic | JSON Logic | Python |
| **Dependencies** | Graph DB, OPA | OPA | Graph DB | None | LangGraph |
| **Rule Complexity** | High | High | Medium | Medium | Very High |
| **Dynamic Updates** | Yes | Restart | Yes | Restart | Yes |
| **Best For** | Production | Development | Production (no OPA) | Embedded | AI Analysis |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core interface definition |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | DbOps, OpaOps, LangGraph ops |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step development guide |
