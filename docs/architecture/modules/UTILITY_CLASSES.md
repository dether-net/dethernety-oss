# Module Utility Classes

## Table of Contents
- [Overview](#overview)
- [DbOps - Database Operations](#dbops---database-operations)
- [DtLgAnalysisOps - LangGraph Analysis Operations](#dtlganalysisops---langgraph-analysis-operations)
- [DtLgDocumentOps - LangGraph Document Operations](#dtlgdocumentops---langgraph-document-operations)
- [Ad-hoc Rego Evaluation (rego-adhoc)](#ad-hoc-rego-evaluation-rego-adhoc)
- [Graph Engine and Schema Helpers](#graph-engine-and-schema-helpers)
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

**Returns:** The attribute value. Throws a descriptive error (`No node found for id "…"`) when no node matches, rather than surfacing an opaque `TypeError`.

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

**Returns:** Unflattened attributes object, or `null` when the element node does not exist (a node that exists without an `IS_INSTANCE_OF` edge returns `{}` via the `COALESCE`). neo4j `Integer` values are coerced to plain JS numbers (out-of-range → decimal string) at the leaf, including inside native lists, so numeric policy comparisons evaluate correctly and identically on Neo4j and Memgraph.

**Example:**
```typescript
// Element has IS_INSTANCE_OF relationship to class with properties:
// { "authentication.enabled": true, "encryption.tls.version": "1.3", "port": Integer(8080) }
const attrs = await dbOps.getInstantiationAttributes(componentId, classId);
// Returns: { authentication: { enabled: true }, encryption: { tls: { version: "1.3" } }, port: 8080 }
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

Converts flat dot-notation properties to nested objects. Handles both object properties and array indices, and coerces any neo4j `Integer` leaf value to a plain JS number (out-of-range → decimal string).

```typescript
unflattenProperties(obj: any): any
```

**Parameters:**
- `obj` - Flat object with dot-notation keys

**Returns:** Nested object structure with neo4j Integers coerced to plain values

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
await documentOps.getDocument(modelId, analysisId, 'example_analysis', {
  document: 'index'
});
// Uses: graphConfig.index_document(scope, analysisId) to get namespace/key
```

2. **Direct lookup** - Specifies namespace and key directly:
```typescript
await documentOps.getDocument(modelId, analysisId, 'example_analysis', {
  namespace: ['example_findings', modelId],
  key: 'findings_index',
  attribute: 'findings'  // Optional: extract specific attribute
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
  ['example_findings', 'model-123'],
  'findings_index'
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

## Graph Engine and Schema Helpers

Functions for modules that create their own indexes and constraints, or write the graph directly, and must run on either supported graph engine. Memgraph and Neo4j share no schema DDL syntax, so a module declares what it needs and these helpers write the statements in the engine's dialect.

These functions and types are part of dt-module's public API. They are exported from the package root (`@dethernety/dt-module`), and any module can use them.

**Source Files:**
- `packages/dt-module/src/engine.ts` — engine detection
- `packages/dt-module/src/ddl.ts` — per-engine DDL builders
- `packages/dt-module/src/schema.ts` — apply and drop a declared schema
- `packages/dt-module/src/locks.ts` — a node write lock for check-then-write statements

### Engine detection (engine.ts)

```typescript
probeEngine(driver: any, databaseName?: string): Promise<EngineInfo>
resolveEngine(context: Pick<ModuleResolverContext, 'driver' | 'databaseName' | 'getEngine'>): Promise<EngineInfo>
// EngineInfo = { engine: Dialect ('memgraph' | 'neo4j'), edition: string | null, version: string | null }
```

`probeEngine` runs `CALL dbms.components()` once in a session of its own. An unrecognised component name throws `EngineProbeError` rather than guessing. `resolveEngine` uses the resolver context's `getEngine` when the platform supplies it, and otherwise probes the context's driver, memoized per driver (see [ModuleResolverContext](./DT_MODULE_INTERFACE.md#moduleresolvercontext)).

### DDL builders (ddl.ts)

| Function | Builds |
|----------|--------|
| `buildIndexDdl` / `buildDropIndexDdl` | Range index on `label(property)` |
| `buildRelationshipIndexDdl` / `buildDropRelationshipIndexDdl` | Range index on a relationship type's property (an edge index on Memgraph) |
| `buildConstraintDdl` / `buildDropConstraintDdl` | Uniqueness (single or composite) or existence constraint; `null` for an existence constraint on Neo4j other than Enterprise |
| `indexName` / `relationshipIndexName` / `constraintName` | The deterministic Neo4j name (`dt_idx__…`, `dt_ridx__…`, `dt_uniq__…`, `dt_exists__…`) |

Neo4j statements carry the deterministic name and `IF NOT EXISTS` / `IF EXISTS`; Memgraph statements use its unnamed legacy forms. Labels, relationship types and properties are interpolated into the statement, so each must be a plain identifier; anything else throws.

### Declared schema (schema.ts)

```typescript
ensureSchema(run: CypherRunner, engineInfo: EngineInfo, plan: SchemaPlan): Promise<SchemaReport>
dropSchemaObject(run: CypherRunner, engineInfo: EngineInfo, target: SchemaTarget): Promise<SchemaReport>
// SchemaPlan  = { indexes?: IndexSpec[], relationshipIndexes?: RelationshipIndexSpec[], constraints?: ConstraintSpec[] }
// SchemaReport = { applied: string[], existed: string[], skipped: string[], failed: { statement, error }[] }
```

`run` executes one statement and must use an auto-commit (implicit) transaction: Memgraph rejects schema changes inside an explicit one. `ensureSchema` validates every spec before it runs anything and throws on an invalid one; once statements run, it never throws for one: each failure lands in `failed` and the rest still run. It absorbs the engine differences a module would otherwise handle itself:

- **Memgraph** answers an existing index with "already exists"; that counts as `existed`, not `failed`.
- **Neo4j** backs a uniqueness constraint with its own index, so a plain index on a key that already has a uniqueness constraint or node key (declared or existing) is skipped, and a plain index in the way of a declared constraint is dropped first (and restored if the constraint then fails).
- **Duplicate keys block a uniqueness constraint on both engines.** Before each uniqueness constraint it attempts, `ensureSchema` scans the label once and counts the key values held by more than one node and the nodes that lack a key property. With duplicates, the constraint is not run: it lands in `failed` with the counts, and on Neo4j the plain index in its way is left alone. Nodes lacking a key property do not stop the constraint; their count is appended to the error if it then fails. On Neo4j a constraint `SHOW CONSTRAINTS` already lists is not checked. If the scan itself fails, the constraint is attempted as is.
- **Neo4j drops by name only.** `dropSchemaObject` looks the name up with `SHOW INDEXES` / `SHOW CONSTRAINTS` and drops every matching object by its actual name, so objects created before names were deterministic are dropped too. A name read back that is not a plain word (a letter or underscore, then letters, digits, underscores, as every name Neo4j generates) is refused and reported in `failed` rather than quoted into the statement.

```typescript
import { ensureSchema, resolveEngine, type SchemaPlan } from '@dethernety/dt-module';

const PLAN: SchemaPlan = {
  indexes: [{ label: 'MyNode', property: 'kind' }],
  constraints: [{ label: 'MyNode', properties: ['id'], kind: 'unique' }],
};

const engineInfo = await resolveEngine(context);
const report = await ensureSchema(
  async (cypher) => {
    const session = context.driver.session({ database: context.databaseName });
    try { return await session.run(cypher); } finally { await session.close(); }
  },
  engineInfo,
  PLAN,
);
```

### Write lock (locks.ts)

```typescript
writeLockClause(variable: string): string
// 'SET v._lock = true REMOVE v._lock' for the bound node variable v
```

A statement that reads a node and then writes based on what it read (compare a revision, check that a key is free) needs the node locked first, and the two engines differ here:

- **Neo4j** runs read-committed. Without a lock, two writers can both pass the same check, and a read can act on a value another transaction has already changed. Writing a property takes the node's exclusive lock until commit. A concurrent writer that took it first makes this one wait, and every read after the lock sees the latest committed state.
- **Memgraph** runs snapshot isolation. The same write makes a concurrent writer of the node fail with a conflict instead of waiting.

The clause sets a property and removes it again, so nothing is left on the node. Put it right after the `MATCH` that binds the node and before any read the write depends on. The variable must be a plain identifier; anything else throws.

```typescript
import { writeLockClause } from '@dethernety/dt-module';

await tx.run(
  `MATCH (n:MyNode {id: $id}) ${writeLockClause('n')}
   WITH n WHERE n.rev = $expectedRev
   SET n.value = $value, n.rev = n.rev + 1`,
  { id, expectedRev, value },
);
```

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
