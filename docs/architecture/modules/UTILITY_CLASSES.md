# Module Utility Classes

## Table of Contents
- [Overview](#overview)
- [DbOps - Database Operations](#dbops---database-operations)
- [DtLgAnalysisOps - LangGraph Analysis Operations](#dtlganalysisops---langgraph-analysis-operations)
- [DtLgDocumentOps - LangGraph Document Operations](#dtlgdocumentops---langgraph-document-operations)
- [Ad-hoc Rego Evaluation (rego-adhoc)](#ad-hoc-rego-evaluation-rego-adhoc)
- [Utility Class Patterns](#utility-class-patterns)

## Overview

The `dt-module` package provides utility classes that encapsulate common operations needed by module implementations. These classes follow a consistent pattern of dependency injection and can be used independently or composed within base classes.

**Source Files:**
- `packages/dt-module/src/db-ops.ts`
- `packages/dt-module/src/dt-lg-analysis-ops.ts`
- `packages/dt-module/src/dt-lg-document-ops.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Utility Class Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                           ┌──────────────────┐     │
│  │     DbOps       │                           │  DtLgAnalysisOps │     │
│  │                 │                           │                  │     │
│  │ Graph DB ops    │                           │ LangGraph        │     │
│  │                 │                           │ analysis         │     │
│  └────────┬────────┘                           └────────┬─────────┘     │
│           │                                             │               │
│           ▼                                             ▼               │
│  ┌─────────────────┐                           ┌──────────────────┐     │
│  │ Graph DB Driver │                           │ LangGraph Client │     │
│  └─────────────────┘                           └──────────────────┘     │
│                                                                         │
│                         ┌─────────────────┐                             │
│                         │ DtLgDocumentOps │                             │
│                         │                 │                             │
│                         │ LangGraph store │                             │
│                         └────────┬────────┘                             │
│                                  │                                      │
│                                  ▼                                      │
│                         ┌─────────────────┐                             │
│                         │ LangGraph Store │                             │
│                         └─────────────────┘                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## DbOps - Database Operations

Helper class for graph database (Bolt/Cypher) operations related to module elements.

**Source File:** `packages/dt-module/src/db-ops.ts`

### Constructor

```typescript
constructor(driver: any)
```

**Parameters:**
- `driver` - Bolt/Cypher compatible driver instance (Neo4j Driver or Memgraph Bolt)

### Methods

#### getAttribute()

Retrieves a single attribute from any node by ID.

```typescript
async getAttribute(id: string, attribute: string): Promise<any>
```

**Parameters:**
- `id` - Node ID
- `attribute` - Attribute name to retrieve

**Returns:** The attribute value

**Example:**
```typescript
const dbOps = new DbOps(graphDbDriver);
const dtClassId = await dbOps.getAttribute(classId, 'dt_class_id');
const regoPolicies = await dbOps.getAttribute(dtClassId, 'regoPolicies');
```

**Cypher Query:**
```cypher
MATCH (n) WHERE n.id = $id RETURN n.{attribute} AS {attribute}
```

---

#### getModuleAttributes()

Retrieves parsed JSON attributes for a module.

```typescript
async getModuleAttributes(name: string): Promise<object>
```

**Parameters:**
- `name` - Module name

**Returns:** Parsed attributes object or empty object

**Cypher Query:**
```cypher
MATCH (m:Module {name: $name}) RETURN m.attributes AS attributes
```

---

#### getClassId() / getClassIds()

Retrieves the class ID(s) that an element is an instance of.

```typescript
async getClassId(id: string): Promise<string>
async getClassIds(id: string): Promise<string[]>
```

**Parameters:**
- `id` - Element node ID

**Returns:** Class ID or array of class IDs

**Cypher Query:**
```cypher
MATCH (n {id: $id})-[:IS_INSTANCE_OF]->(c) RETURN c.id AS classId
```

---

#### getInstantiationAttributes()

Retrieves the attributes stored on the `IS_INSTANCE_OF` relationship between an element and its class.

```typescript
async getInstantiationAttributes(id: string, classId: string): Promise<any>
```

**Parameters:**
- `id` - Element node ID
- `classId` - Class node ID

**Returns:** Unflattened attributes object

**Example:**
```typescript
// Element has IS_INSTANCE_OF relationship to class with properties:
// { "authentication.enabled": true, "encryption.tls.version": "1.3" }
const attrs = await dbOps.getInstantiationAttributes(componentId, classId);
// Returns: { authentication: { enabled: true }, encryption: { tls: { version: "1.3" } } }
```

**Cypher Query:**
```cypher
MATCH (c {id: $id})
OPTIONAL MATCH (c)-[r:IS_INSTANCE_OF]->(c2)
WHERE c2.id = $classId
RETURN COALESCE(r, {}) AS attributes
```

---

#### unflattenProperties()

Converts flat dot-notation properties to nested objects. Handles both object properties and array indices.

```typescript
unflattenProperties(obj: any): any
```

**Parameters:**
- `obj` - Flat object with dot-notation keys

**Returns:** Nested object structure

**Example:**
```typescript
const flat = {
  "server.port": 8080,
  "server.ssl.enabled": true,
  "endpoints[0].path": "/api",
  "endpoints[0].method": "GET",
  "endpoints[1].path": "/health"
};

const nested = dbOps.unflattenProperties(flat);
// Returns:
// {
//   server: { port: 8080, ssl: { enabled: true } },
//   endpoints: [
//     { path: "/api", method: "GET" },
//     { path: "/health" }
//   ]
// }
```

---

## DtLgAnalysisOps - LangGraph Analysis Operations

Helper class for managing LangGraph analysis sessions and execution. Used by `DtLgModule`. Requires an external LangGraph-compatible server.

**Source File:** `packages/dt-module/src/dt-lg-analysis-ops.ts`

### Constructor

```typescript
constructor(
  client: Client,
  config: LgAnalysisConfig,
  logger: Logger
)
```

**Parameters:**
- `client` - LangGraph SDK Client
- `config` - Analysis configuration with graph definitions
- `logger` - NestJS Logger

### Session Management

#### createSession()

Creates or retrieves a LangGraph thread for analysis.

```typescript
async createSession(id: string, scope: string): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Session/thread ID
- `scope` - Scope identifier (usually model ID)

**Returns:** `{ sessionId: string }`

**LangGraph API:**
```typescript
client.threads.create({
  metadata: { scope },
  threadId: id,
  ifExists: 'do_nothing'
})
```

---

#### deleteSession()

Deletes a LangGraph thread.

```typescript
async deleteSession(id: string): Promise<boolean>
```

---

### Analysis Execution

#### runAnalysis()

Starts an analysis workflow with streaming results.

```typescript
async runAnalysis(
  sessionId: string,
  assistantId: string,
  graphName: string,
  scope: string,
  pubSub: ExtendedPubSubEngine,
  driver?: any,
  additionalParams?: object
): Promise<AnalysisSession>
```

**Parameters:**
- `sessionId` - Session identifier
- `assistantId` - LangGraph assistant ID
- `graphName` - Graph name (key in `config.graphs`)
- `scope` - Scope identifier
- `pubSub` - GraphQL subscription engine
- `driver` - Optional Neo4j driver for input building
- `additionalParams` - Optional additional parameters

**Flow:**
1. Look up graph config by `graphName`
2. Build input payload via `graphConfig.input(scope, sessionId, driver, additionalParams)`
3. Start streaming via `client.runs.stream(sessionId, assistantId, payload)`
4. Publish chunks to GraphQL subscription via `pubSub.publish('streamResponse', ...)`

---

#### startChat()

Starts an interactive chat session.

```typescript
async startChat(
  sessionId: string,
  assistantId: string,
  userQuestion: string,
  scope: string,
  pubSub: ExtendedPubSubEngine
): Promise<AnalysisSession>
```

**Parameters:**
- `sessionId` - Session identifier
- `assistantId` - LangGraph assistant ID
- `userQuestion` - User's initial question
- `scope` - Scope identifier
- `pubSub` - GraphQL subscription engine

---

#### resumeAnalysis()

Resumes a paused/interrupted analysis.

```typescript
async resumeAnalysis(
  sessionId: string,
  assistantId: string,
  input: any,
  pubSub: ExtendedPubSubEngine
): Promise<AnalysisSession>
```

**Parameters:**
- `sessionId` - Session to resume
- `assistantId` - LangGraph assistant ID
- `input` - Resume input (interrupt response)
- `pubSub` - GraphQL subscription engine

---

### Status and Values

#### getStatus()

Gets the current analysis status including messages and interrupts.

```typescript
async getStatus(sessionId: string): Promise<AnalysisStatus>
```

**Returns:**
```typescript
{
  createdAt: string;      // Thread creation time
  updatedAt: string;      // Last update time
  status: string;         // 'idle', 'running', 'interrupted', 'failed'
  interrupts: object;     // Pending interrupts
  messages: object[];     // Conversation messages
  metadata: object;       // Thread metadata
}
```

---

#### getValueKeys() / getValue()

Retrieves values from the analysis state.

```typescript
async getValueKeys(sessionId: string): Promise<string[]>
async getValue(sessionId: string, key: string): Promise<object>
```

**Example:**
```typescript
const keys = await analysisOps.getValueKeys(sessionId);
// Returns: ['messages', 'scenarios', 'analysis_result']

const scenarios = await analysisOps.getValue(sessionId, 'scenarios');
// Returns: [{ name: "SQL Injection", steps: [...] }, ...]
```

---

## DtLgDocumentOps - LangGraph Document Operations

Helper class for retrieving documents from the LangGraph store. Used by `DtLgModule`. Requires an external LangGraph-compatible server.

**Source File:** `packages/dt-module/src/dt-lg-document-ops.ts`

### Constructor

```typescript
constructor(
  client: Client,
  config: LgAnalysisConfig,
  logger: Logger
)
```

### Methods

#### getDocument()

Retrieves a document using filter criteria.

```typescript
async getDocument(
  scope: string,
  analysisId: string,
  graphName: string,
  filter: object
): Promise<object>
```

**Parameters:**
- `scope` - Scope identifier
- `analysisId` - Analysis session ID
- `graphName` - Graph name (key in `config.graphs`)
- `filter` - Filter criteria

**Filter Modes:**

1. **Index document** - Uses graph config's `index_document` function:
```typescript
await documentOps.getDocument(modelId, analysisId, 'attack_scenario_analysis', {
  document: 'index'
});
// Uses: graphConfig.index_document(scope, analysisId) to get namespace/key
```

2. **Direct lookup** - Specifies namespace and key directly:
```typescript
await documentOps.getDocument(modelId, analysisId, 'attack_scenario_analysis', {
  namespace: ['attack_scenarios', modelId],
  key: 'scenario_index',
  attribute: 'scenarios'  // Optional: extract specific attribute
});
```

---

#### getFromStore()

Direct store lookup without graph config.

```typescript
async getFromStore(namespace: string[], key: string): Promise<Record<string, any>>
```

**Parameters:**
- `namespace` - Namespace path array
- `key` - Document key

**Example:**
```typescript
const doc = await documentOps.getFromStore(
  ['attack_scenarios', 'model-123'],
  'scenario_index'
);
```

---

## Ad-hoc Rego Evaluation (rego-adhoc)

One-shot Rego checking and evaluation for authoring-time tooling — linters, editor feedback, generated-policy validation, packaging checks. Two functions, not a class:

**Source File:** `packages/dt-module/src/rego-adhoc.ts`

```typescript
checkRegoSource(policy: string): RegoCheckResult
// { ok, errors: string[], warnings: string[] } — static lint + a real parse

evaluateRegoAdHoc(policy: string, rule: string, input: unknown): RegoAdHocResult
// { findings: unknown[] | null, errors: string[] | null } — exactly one is null
```

Each call builds a throwaway Regorus engine, uses it once, and frees it — nothing is shared, nothing persists, and concurrent calls cannot observe each other.

**Contract: fail-contained.** This is the deliberate inverse of `RegoEngine`'s fail-loud runtime contract. At runtime an engine error throws, because silently under-reporting findings is the dangerous failure; at authoring time errors come back as data, because they are shown to whoever produced the broken policy — the errors *are* the product. Error strings are one line per defect and preserve the engine's `file:line:col` position token.

Two properties keep the authoring verdict aligned with the runtime:

- **Isolation is enforced, not skipped.** A policy reading another package's `data` document is rejected (as the runtime registry rejects it at load), rather than evaluated to a silent "nothing fired".
- **`checkRegoSource` is a superset of the packaging gate.** It combines `lintPolicySource` (builtin partition, length limits, isolation — defects a parse cannot see, because the engine resolves function names lazily) with a real parse (syntax errors the static lint cannot see). A policy that passes here cannot later fail packaging for a reason its author never saw.

**No resource bounds.** Rego's strong normalization guarantees termination, not bounded time or memory. The caller owns input-size caps, and should consider `worker_threads` isolation (with `resourceLimits`) before wiring these functions to untrusted policy or input.

---

## Utility Class Patterns

### Composition in Base Classes

All utility classes are designed to be composed within module base classes:

```typescript
// DtFileOpaModule composition
class DtFileOpaModule implements DTModule {
  private readonly dbOps: DbOps;
  private readonly regoEngine = new RegoEngine();

  constructor(moduleDataDir: string, moduleName: string, driver: any, logger?: Logger) {
    this.dbOps = new DbOps(driver);
    // Policies are registered into the in-process engine from disk in getMetadata().
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const attributes = await this.dbOps.getInstantiationAttributes(id, classId);
    const result = this.regoEngine.evaluate(key, 'exposures', attributes);
    // ...
  }
}

// DtLgModule composition
class DtLgModule implements DTModule {
  protected readonly analysisOps: DtLgAnalysisOps;
  protected readonly documentOps: DtLgDocumentOps;

  constructor(moduleName: string, driver: any, logger: Logger, options: LgModuleOptions) {
    const client = new Client({ apiUrl: options.langgraphApiUrl });
    this.analysisOps = new DtLgAnalysisOps(client, options.analysisConfig, logger);
    this.documentOps = new DtLgDocumentOps(client, options.analysisConfig, logger);
  }

  async runAnalysis(...): Promise<AnalysisSession> {
    return this.analysisOps.runAnalysis(...);
  }
}
```

### Standalone Usage

Utility classes can also be used independently:

```typescript
import { DbOps } from '@dethernety/dt-module';

// In a custom service
const dbOps = new DbOps(graphDbDriver);
const attributes = await dbOps.getInstantiationAttributes(elementId, classId);
```

### Error Handling Pattern

All utility classes follow consistent error handling:

```typescript
async someOperation(params): Promise<Result> {
  try {
    // Perform operation
    return result;
  } catch (error) {
    console.error('Operation failed', {
      params,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error; // or return default value
  }
}
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core interface definition |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Module implementation patterns |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step development guide |
