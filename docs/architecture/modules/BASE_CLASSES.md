# Module Base Classes

## Table of Contents
- [Overview](#overview)
- [Class Hierarchy](#class-hierarchy)
- [DtFileOpaModule](#dtfileopamodule)
- [DtLgModule](#dtlgmodule)
- [Choosing the Right Base Class](#choosing-the-right-base-class)

## Overview

The `dt-module` package provides base classes that implement the `DTModule` interface. Each base class represents a different approach to loading class definitions and evaluating security rules.

**Source Files:**
- `packages/dt-module/src/dt-file-opa-module.ts`
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
│                  ┌───────────┴───────────┐                              │
│                  │                       │                              │
│                  ▼                       ▼                              │
│          ┌─────────────────┐    ┌───────────────┐                       │
│          │ DtFileOpaModule │    │   DtLgModule  │                       │
│          │                 │    │               │                       │
│          │ • File storage  │    │ • LangGraph   │                       │
│          │ • Rego policies │    │   integration │                       │
│          └─────────────────┘    │ • AI analysis │                       │
│                                 └───────────────┘                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Storage vs Evaluation Matrix

| Base Class | Storage | Rule Evaluation | Use Case |
|------------|---------|-----------------|----------|
| `DtFileOpaModule` | File System | Rego (in-process) | Policy-evaluating modules, version-controlled |
| `DtLgModule` | N/A | LangGraph | AI analysis workflows |

---

## DtFileOpaModule

File-based storage with in-process Rego policy evaluation. Loads class definitions from the file system and evaluates their `policies.rego` through the vendored Regorus WASM engine — one engine per class, with no external policy server.

> The `Opa` in the name is historical: the class predates the in-process engine and every shipped module extends it by this name, so the name outlived the OPA server it once talked to.

**Source File:** `packages/dt-module/src/dt-file-opa-module.ts`

### Directory Structure

```
moduleDataDir/
└── module-name/
    ├── module.json                # Module metadata (name, description, version, contentHash)
    ├── component/
    │   └── web-server/
    │       ├── class.json         # Class metadata
    │       ├── schema.json        # JSONForms template {schema, uiSchema}
    │       ├── policies.rego      # Rego policies
    │       └── guide.json         # Per-option security guidance (optional)
    ├── dataFlow/
    │   └── http-flow/
    │       ├── class.json
    │       ├── schema.json
    │       └── policies.rego
    ├── securityBoundary/
    ├── control/
    ├── data/
    └── issue/                     # Issue classes carry no policies
```

### Constructor

```typescript
constructor(moduleDataDir: string, moduleName: string, driver: any)
```

**Parameters:**
- `moduleDataDir` - Base directory containing module data
- `moduleName` - Module identifier (subdirectory name)
- `driver` - Bolt/Cypher compatible driver instance (for `DbOps` instance lookups)

Each instance owns one in-process Rego engine (`RegoEngine`), which holds one Regorus engine per registered class policy. Policy evaluation needs no configuration and contacts no server.

### dispose()

Frees the in-process Rego engines. The platform calls `dispose()` before discarding an instance; without it every module reload would strand its policies on the WASM heap, which the garbage collector never reclaims.

### Key Methods

#### getMetadata()

Scans directory structure and loads metadata from JSON files.

```typescript
async getMetadata(): Promise<DTMetadata>
```

**Flow:**
1. Read `module.json` from the module directory
2. Scan each class type directory (`component/`, `dataFlow/`, etc.)
3. For each class subdirectory, read `class.json` and eagerly register its `policies.rego` in the in-process engine (one Regorus engine per class). Registering eagerly means a policy that cannot be parsed or is not self-contained fails here, at load, rather than at the first analysis that needs it.
4. Prune: free the engines of any classes that no longer exist on disk. A class whose policy failed to register is also pruned, so every later evaluation of it throws rather than answering from a stale engine.
5. Return aggregated `DTMetadata`

#### getExposures() / getCountermeasures()

Reads a class's Rego policy from disk and evaluates it in-process.

```typescript
async getExposures(id: string, classId: string): Promise<Exposure[]>
```

**Flow:**
1. Get class `path` attribute from graph database (stored during registration)
2. Read `policies.rego` from the class directory
3. Look up the class's Regorus engine (registered at load; registered on first use as a fallback)
4. Evaluate the `exposures` / `countermeasures` rule in-process. Evaluation is fail-loud — an engine error throws rather than degrading to "no findings".

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

#### getSchemaExtension()

Returns a GraphQL SDL string read from `schema.graphql` in the compiled module directory. This is the default implementation provided by `DtLgModule` using the `readSchemaExtension(__dirname)` utility exported from `@dethernety/dt-module`.

```typescript
getSchemaExtension(): string | undefined
```

If `schema.graphql` does not exist in the module directory, the method returns `undefined` and the module does not contribute to the merged schema. Other base classes do not provide a default implementation; see [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md#schema-extensions) for how to add one manually.

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
  additionalParams?: object,
  token?: string
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
│  What does the module do?                                               │
│       │                                                                 │
│       ├── Policy evaluation (exposures/countermeasures) ► DtFileOpaModule│
│       │                                                                 │
│       ├── AI-powered analysis ────────────────────────► DtLgModule      │
│       │                                                                 │
│       └── Data only (no policies, no analysis) ───────► no base class   │
│                                                          (implement      │
│                                                           DTModule, or   │
│                                                           ship data only)│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Comparison Table

| Feature | File+OPA | LangGraph |
|---------|----------|-----------|
| **Storage** | Local files | N/A |
| **Rule Language** | Rego | Python |
| **Dependencies** | Regorus WASM (in-process, vendored) | LangGraph |
| **Rule Complexity** | High | Very High |
| **Dynamic Updates** | Restart | Yes |
| **Best For** | Policy evaluation | AI Analysis |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core interface definition |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | DbOps, LangGraph ops |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step development guide |
