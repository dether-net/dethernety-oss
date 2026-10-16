# ModuleManagementService

## Overview

The `ModuleManagementService` provides security, monitoring, error handling, and type safety for managing the external modules of the application.

Features:
- Modern Neo4j v5 transactions with `executeRead()`/`executeWrite()` patterns
- Error handling with structured logging
- Input validation for all operations
- Full TypeScript type safety
- Security hardening and injection prevention
- Performance monitoring and statistics
- Configuration management integration

## Neo4j v5 Transaction Management

### Database Session Configuration
```typescript
const session = this.neo4jDriver.session({
  database: this.configService.get('database.name') || 'neo4j',
});
```

### Read Operations
```typescript
// Using executeRead for query operations
const result = await session.executeRead(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});
```

### Write Operations
```typescript
// Using executeWrite for mutation operations
await session.executeWrite(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});
```

## Security

### Cypher Injection Prevention
```typescript
// Secure with whitelist validation
private readonly ALLOWED_CLASS_LABELS = new Set([
  'ComponentClass', 'DataFlowClass', 'SecurityBoundaryClass', ...
]);

private validateClassLabel(classLabel: string): void {
  if (!ALLOWED_CLASS_LABELS.has(classLabel)) {
    throw new Error(`Invalid class label: ${classLabel}`);
  }
}
```

### Input Validation
```typescript
private validateMetadata(metadata: DTMetadata): ModuleValidationResult {
  const errors: ValidationError[] = [];

  // Required field validation
  if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push({
      field: 'name',
      message: 'Module name is required and must be a string',
      value: metadata.name
    });
  }

  // Length validation
  if (metadata.name && metadata.name.length > 100) {
    errors.push({
      field: 'name',
      message: 'Module name must be less than 100 characters'
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}
```

### Data Sanitization
```typescript
sanitizePropertyKeys(obj: any): FlattenedProperties {
  const sanitizedObj: any = {};
  for (const key in obj) {
    // Sanitize keys to prevent injection
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_.]/g, '_');
    // ... secure processing
  }
}
```

## Monitoring and Observability

### Structured Logging
```typescript
this.logger.log('Module upsert completed successfully', {
  moduleName: installedModuleName,
  moduleId,
  classesProcessed,
  duration,
  version: metadata.version,
});

this.logger.error('Module upsert failed', {
  moduleName: metadata?.name,
  error: error.message,
  stack: error.stack,
  duration,
  classesProcessed,
});
```

### Performance Metrics
```typescript
interface ModuleStatistics {
  totalModules: number;
  totalClasses: number;
  operationCount: number;
  averageOperationTime: number;
  lastOperationAt?: Date;
}

private recordOperation(operationName: string, duration: number, metadata?: any): void {
  this.statistics.operationCount++;
  const totalTime = this.statistics.averageOperationTime * (this.statistics.operationCount - 1) + duration;
  this.statistics.averageOperationTime = totalTime / this.statistics.operationCount;
  this.statistics.lastOperationAt = new Date();
}
```

### Operation Tracking
```typescript
async upsertModule(tx: DatabaseTransaction, metadata: DTMetadata): Promise<UpsertResult> {
  const startTime = Date.now();
  let classesProcessed = 0;

  try {
    // ... operation logic

    const duration = Date.now() - startTime;
    return {
      moduleId,
      moduleName: installedModuleName,
      classesProcessed,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error('Operation failed', { duration, error: error.message });
    throw error;
  }
}
```

## Error Handling

### Error Handling Pattern
```typescript
try {
  const result = await tx.run(query, parameters);
  this.recordOperation('operationName', duration, metadata);
  this.logger.debug('Operation successful', { operationDetails });
} catch (error) {
  this.logger.error('Operation failed', {
    operation: 'operationName',
    error: error.message,
    stack: error.stack,
    parameters,
    duration: Date.now() - startTime,
  });
  throw new Error(`Operation failed: ${error.message}`);
}
```

### Fallback Behavior
```typescript
// Continue processing other modules even if one fails. Each module installs
// in its OWN write transaction, so a failed write rolls back only that module.
for (const [moduleName, { metadata, vectors }] of resolved) {
  try {
    const result = await session.executeWrite((tx: DatabaseTransaction) =>
      this.upsertModule(tx, metadata, options, vectors),
    );
    modulesInstalled.push(result.moduleName);
    processedCount++;
  } catch (error) {
    errorCount++;
    this.logger.error('Failed to upsert module during bulk update', { moduleName, error: error.message });
    // Continue with other modules instead of failing completely
  }
}
```

See [Install phases](#install-phases) for why the transaction is per module.

### Validation with Detailed Errors
```typescript
interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

interface ModuleValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
}
```

## Type Safety

### Interfaces
```typescript
async upsertModule(
  tx: DatabaseTransaction,
  metadata: DTMetadata,
  options: ModuleOperationOptions = {}
): Promise<UpsertResult>
```

### Type-Safe Results
```typescript
interface UpsertResult {
  moduleId: string;
  moduleName: string;
  classesProcessed: number;
  duration: number;
}

interface ModuleOperationOptions {
  skipValidation?: boolean;
  timeout?: number;
  retryCount?: number;
}
```

### Security Constants
```typescript
export const ALLOWED_CLASS_LABELS = new Set([
  'ComponentClass',
  'DataFlowClass',
  'SecurityBoundaryClass',
  'ControlClass',
  'DataClass',
  'AnalysisClass',
  'IssueClass',
]);

export const MODULE_CLASS_CONFIGS: ModuleClassDefinition[] = [
  { key: 'componentClasses', label: 'ComponentClass' },
  { key: 'dataFlowClasses', label: 'DataFlowClass' },
  // ...
];
```

## Performance Optimizations

### Efficient Error Handling
- Continue processing on individual failures
- Detailed performance tracking
- Operation-level timeout support

### Resource Management
```typescript
// Proper session management
const session = this.neo4jDriver.session();
try {
  await session.writeTransaction(async (tx) => {
    // Operations
  });
} finally {
  await session.close(); // Always close sessions
}
```

### Statistics Tracking
```typescript
getStatistics(): ModuleStatistics {
  return { ...this.statistics };
}

resetStatistics(): void {
  this.statistics = {
    totalModules: 0,
    totalClasses: 0,
    operationCount: 0,
    averageOperationTime: 0,
  };
}
```

## Configuration Integration

### Service Configuration
```typescript
constructor(
  @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  private readonly configService: ConfigService,
) {
  this.config = this.configService.get<GqlConfig>('gql')!;

  this.logger.log('ModuleManagementService initialized', {
    allowedClassLabels: Array.from(ALLOWED_CLASS_LABELS),
    moduleClassConfigs: MODULE_CLASS_CONFIGS.length,
  });
}
```

### Operation Options
```typescript
interface ModuleOperationOptions {
  skipValidation?: boolean;    // Skip metadata validation
  timeout?: number;           // Operation timeout
  retryCount?: number;        // Retry attempts
}
```

## Bulk Operations
```typescript
async updateAllModules(
  modules: Map<string, DTModule>,
  options: ModuleOperationOptions = {},
): Promise<void> {
  // Queued behind any install already running; waits for the embedder, within a bound
  // Phase A: skip-gate read + resolve vectors per module, outside any transaction
  // Phase B: one write transaction per module
  // Obsolescence sweep (deleteOldModules) in its own final write transaction
  // afterInstall hooks, post-commit
  // onModulesInstalled listeners, with the modules this install wrote
  // Track success/failure rates; logging and metrics
}
```

### Install phases

`updateAllModules` never holds a write transaction open while class vectors are being made, and never lets one module's failed write take the others down with it:

1. **Wait for the embedder, within a bound.** It awaits `EmbeddingService.whenStartupChecked()`, so an embedder that is about to be ready embeds this install instead of every module being installed `partial`. The embedder runs in process; what the install waits for depends on whether its weights are on disk:
   - **Files already in place** — `weightsPlaced` (`@dethernety/embedder`) checks, by size only, with no hashing and no network, that the profile's weight files are in place, so no download is due. The install then waits until the embedder is `ready` or `failed`, for at most 60 s, the platform healthcheck's start period; verify, load and warm-up took about 8 s on a 4-CPU host. When the bound runs out it logs `Embedder not ready after the start-up wait; the module install continues and catches up when it is` and carries on.
   - **Download due** — no wait. A download can take minutes and is never waited for.

   The model loads on the embedder's worker thread (`createWorkerEmbedder`, `@dethernety/embedder`), not on the event loop the install runs on, so the 60 s bound is a real one: when it runs out the install carries on while the load continues, and the worker's own load timeout (120 s) fails a load that hangs. A module this install leaves `partial` for want of an embedder is installed again when the embedder becomes ready (see [Catch-up when the embedder becomes ready](#catch-up-when-the-embedder-becomes-ready)).
2. **Phase A — resolve vectors, outside any transaction.** One read of every `:Module` node's stored state, with embedding on one read of the class vectors, and one read of the class policy hashes feed the [content-hash skip gate](#content-hash-skip-gate); a forced run makes neither class read. For each module the gate does not skip, `resolveVectors` makes the class vectors. It gives every class the module declares a vector, or fails: an embedder that returns another number of vectors than classes, or a vector that cannot be stored (`vectorDefect`: not a list, the wrong length, a non-finite value or a zero norm), throws. A pre-computed vector from the module's `getEmbedding()` that cannot be stored is not an error: it is logged (`Pre-computed embedding cannot be stored; falling through to on-the-fly`, with the defect) and the class is embedded on the fly, as one of the wrong length is. A module whose metadata or vectors fail is logged and left out of this round, unchanged in the graph; the rest carry on.
3. **Phase B — one write transaction per module.** Each resolved module's `upsertModule` runs in its **own** `session.executeWrite`, with the vectors from Phase A (no embedding requests inside the transaction). A module whose write fails rolls back only its own transaction; every other module still commits.
4. **Obsolescence sweep — its own final transaction.** After every module upsert has committed, `deleteOldModules` runs in one more write transaction. It protects every module **present on disk this round**, not only the ones that installed, so a module that failed this time is never taken for a removed one and deleted with its classes. A failed sweep is logged and does not stop start-up; an obsolete module then lingers until the next sweep.
5. **Post-commit hooks.** Each installed or skipped module's `afterInstall` hook runs (see [below](#afterinstall-post-commit-hook-invocation)).
6. **Installed-modules notification.** When the install wrote at least one module, its listeners are told which (see [Installed-modules notification](#installed-modules-notification)).

**Why per module.** In one shared transaction, a database-level error in any module (for example, a class id collision) aborts the whole transaction: every later statement, the sweep included, fails and the entire batch rolls back. A per-module `try`/`catch` inside that transaction cannot contain the failure; a transaction per module does.

### Content-hash skip gate

Before it resolves any class vectors, `updateAllModules` reads every `:Module` node's stored `contentHash`, `lastInstallStatus` and `embeddingProfile` in one read. A module is **skipped** — no vector resolution, no graph write — when all five of these hold:

- its `contentHash` equals the one stored on its `:Module` node,
- its last install was `authoritative`,
- the `embeddingProfile` stored on its `:Module` node equals the active embedder's (see [The recorded embedder](#the-recorded-embedder)), and
- none of the searchable classes it declares holds a vector the active embedder did not make (see [The class vector check](#the-class-vector-check)), and
- every class it declares that reports a `policyHash` holds that hash on its stored node (see [The class policy hash check](#the-class-policy-hash-check)).

A skipped module still counts as installed: `deleteOldModules` keeps it, and its `afterInstall` hook still runs (see [below](#afterinstall-post-commit-hook-invocation)). Every other case is a full install: no stored node, a different hash, a `partial` last install, a different or missing `embeddingProfile`, a declared searchable class whose vector the active embedder did not make, a failed class vector check, a declared class reporting a `policyHash` its stored node does not hold, a failed class policy hash read, or a forced run (`MODULE_LOAD_FORCE=1`, which `ModuleRegistryService` passes as `options.force`).

**Where the hash comes from.**

| Module | `contentHash` the gate compares |
|---|---|
| Ships one in its metadata (a file module: `module.json`, written by `scripts/hash-module.mjs`) | The shipped hash, as is |
| Ships none and does not implement `getEmbedding()` (a module written in code) | A **computed hash** (below) |
| Ships none and implements `getEmbedding()` | None — installed on every start |

**The computed hash.** `computedContentHash` (`module-content-hash.ts`) returns `sha256:<hex>` over the canonical JSON (object keys sorted at every depth) of:

- the module's `getMetadata()` result, without any `contentHash` field, and
- the platform version: the `version` in dt-ws's `package.json` (`platform-version.ts`).

The install stores the computed hash on the `:Module` node exactly like a shipped one, so the next start skips the module while nothing changed. A change to the metadata — any class, any class field, the module `version`, the `idRebindPolicy` — or to the platform version yields a different hash and a full reinstall. A platform upgrade therefore reinstalls each such module once, then the gate skips it again.

**Why these inputs are complete.** An install writes the `:Module` node and its classes from `getMetadata()` alone. The platform's own install code does the writing, and an upgrade may write the same metadata differently, so the platform version is an input too. The embedder that makes the class vectors is not a hash input: the gate checks it for every module through the recorded `embeddingProfile`. A file module is unaffected: the gate compares its shipped hash as is. Templates, guides, exposures, countermeasures and Rego policies are not install inputs: the platform asks the module for them when they are used, so a skipped install cannot leave a stale one behind. A policy's hash is an input: it is part of the class metadata (see [Class policy hash](#class-policy-hash)), so the computed hash covers it, and a file module's shipped hash covers its `policies.rego` files. `update-all-modules.skip-gate.spec.ts` pins this — the install reads nothing from a module except `getMetadata`, `getEmbedding` and `afterInstall`. If the install ever reads another input, that input belongs in the computed hash.

**The `getEmbedding()` exception.** A module that implements `getEmbedding()` hands the install pre-computed vectors from a source its metadata does not show, so a hash over the metadata cannot vouch for them. Such a module gets no computed hash and is installed on every start unless it ships its own `contentHash`. `DtFileOpaModule` implements `getEmbedding()`, so a file module whose `module.json` carries no `contentHash` is likewise installed on every start.

### The recorded embedder

An install writes `embeddingProfile` on the `:Module` node: the embedder the module's class vectors are made with, as returned by `embedderFingerprint` (`module-content-hash.ts`) — `<model>/<dimensions>` while embedding is enabled or pending, otherwise `off`. It follows the configuration, not readiness, so a pending embedder counts as on and the value does not change while the model loads. An install made while the embedder is still pending keeps the stored vectors and writes no `embeddingProfile`, so the node keeps the record of the embedder that made them; the install is `partial` and is repeated when the embedder becomes ready (see [Catch-up when the embedder becomes ready](#catch-up-when-the-embedder-becomes-ready)), or else at the next start. `reindexClassEmbeddings` writes it too, on each `:Module` whose searchable classes (the labels in `CLASS_LABELS`) it re-embedded, all of them; a module with such a class left without a new vector keeps its old record. Analysis and issue classes, which no vector search reads, keep their vectors. That way the next start does not reinstall those modules only to embed them again.

When a module's hash matches and its last install was `authoritative` but the stored `embeddingProfile` differs from the active one, the gate logs `Embedding model changed — reinstalling the module so its classes are embedded with the active model` (with `from` and `to`) and installs it in full. A change of model, of dimensions, or switching embedding on or off therefore re-embeds the classes of every module, whatever its content hash. A matching record is not enough on its own: the gate also checks the classes' stored vectors (see [The class vector check](#the-class-vector-check)).

**Upgrade.** A `:Module` node written before the platform recorded the embedder has no `embeddingProfile`, so every module is reinstalled once on the first start after the upgrade (logged as `Embedding model not recorded for this module yet — reinstalling it once to record it`, `from: unrecorded`); later starts skip it again. Under an unchanged embedding model that reinstall uses the vectors a module ships or publishes for that model and embeds only the classes that have none; under a changed model the classes are embedded again. With the in-process embedder, a start whose install runs while the model is still downloading or loading leaves the modules `partial`, and the catch-up installs them again once the model is ready.

### The class vector check

The recorded `embeddingProfile` can disagree with the classes it describes. A platform version that does not record the embedder may have installed the module again since the record was written — a rollback to an older version that keeps the current graph, or an older version's forced install after a newer one recorded the embedder. The classes then hold that version's vectors under a record that still matches, and the record alone would never have them embedded again: the class vector tier stays off.

So when embedding is enabled or pending and the run is not forced, `updateAllModules` makes one more read before the gate, `readStaleClassKeys`, for every module at once. It lists each class reached through `HAS_CLASS` that carries a searchable label (`CLASS_LABELS`: `ComponentClass`, `ControlClass`, `DataFlowClass`, `SecurityBoundaryClass`, `DataClass`) and whose stored vector the active embedder did not make:

- no `embedding`, or no `embeddingModel`,
- an `embeddingModel` other than the active profile id (`getModel()`), or
- an `embedding` whose length is not the active dimensions (`getDimensions()`).

These are the vectors the class vector search does not score. For a module whose hash, last install and record all match, `staleDeclaredClasses` counts the listed classes the module **declares** in its metadata, matched by label and `id`. A count above zero is logged as `Class vectors do not match the recorded embedding model — reinstalling the module so its classes are embedded with the active model` (with `moduleName`, `staleClasses` — the count — and `profile`), and the module is installed in full. A module that declares no classes is skipped as before.

**What does not count.** Counting any of these would reinstall the module to no effect, at every start or after every reindex:

| Not counted | Why |
|---|---|
| Analysis and issue classes | No search reads their vectors, and `reindexClassEmbeddings` leaves them as they are while it records the embedder |
| Orphaned classes (`HAS_ORPHANED_CLASS`) | An install does not write them |
| A stale class node the module does not declare | An install does not write it either |

**Why one install clears it.** An install gives every class the module declares a vector from the active embedder, or fails (see [Install phases](#install-phases)), so an `authoritative` install leaves no declared searchable class stale, and the next start skips the module again.

**When no read is made.** With embedding off, the record `off` covers it: no class vectors are made. A forced run installs every module anyway.

**While the embedder is pending.** The read is made, since the recorded embedder counts a pending embedder as on. A module with stale classes is installed, keeps its stored vectors and ends `partial`, with no record written; the catch-up installs it again when the embedder is ready (see [below](#catch-up-when-the-embedder-becomes-ready)).

**When the read fails.** It is logged as `Class vector check failed — installing every module in full` (with `error`), every module is installed in full, and the start goes on: without the read the gate cannot vouch for any module.

### The class policy hash check

A module's content can be unchanged while its class nodes lack the `policyHash` it reports: classes installed before the platform wrote the hash, or written by an install that failed part-way. Its elements would then never be [re-evaluated](./SET_INSTANTIATION_ATTRIBUTES.md#re-evaluation-after-a-class-policy-change), since the sweep skips a class with no hash.

So when the run is not forced, whatever the embedding setting, `updateAllModules` makes one more read before the gate, `readClassPolicyHashes`, for every module at once: the `policyHash` stored on each class reached through `HAS_CLASS` that carries a module class label (`MODULE_CLASS_CONFIGS`), keyed by module name and `<label>:<id>`. For a module that passes the other four conditions, `policyDriftClasses` counts the classes it **declares** whose metadata reports a `policyHash` that its stored node, matched by label and `id`, does not hold (another hash, none, or no node). A count above zero is logged as `Class policy hashes are not recorded or out of date — reinstalling the module so its elements can be re-evaluated` (with `moduleName` and `classes`, the count), and the module is installed in full. The install writes the hashes, and its [notification](#installed-modules-notification) starts a re-evaluation sweep.

- **A class that reports no hash never counts.** A remote module's classes, an issue class, or a class whose policy failed to register report none, so they cannot have their module installed at every start.
- **Why one install clears it.** The install writes each declared class's reported `policyHash` on its node (see [Class policy hash](#class-policy-hash)), so the next start finds them equal and skips the module again.
- **Upgrade.** On the first start after the upgrade, a module that passes every other condition but whose classes' hashes are not recorded is reinstalled once, so that start's re-evaluation also covers the elements of modules whose content did not change.
- **When the read fails.** It is logged as `Class policy hash check failed — installing every module in full` (with `error`), every module is installed in full, and the start goes on.
- **Forced run.** No read is made: a forced run installs every module anyway.

### Catch-up when the embedder becomes ready

An install that runs before the embedder is ready leaves modules waiting for it: installed `partial`, their stored vectors kept (see [The recorded embedder](#the-recorded-embedder)). The catch-up installs them again, with vectors, without a restart.

- **Wiring.** `ModuleRegistryService.onModuleInit` calls `enableCatchUp` before the start-up install, passing a function that returns the healthy loaded modules. `enableCatchUp` registers a listener with `EmbeddingService.onReady(listener)`.
- **The ready signal.** `onReady` calls its listeners on each move into `ready`: the in-process model loaded and warmed up. It returns a function that removes the listener; a listener that throws is logged and does not stop the others.
- **What runs.** On each ready signal, if the last full install left a module waiting for the embedder, the install runs once more over the modules healthy at that moment, logged as `Embedder ready — installing the modules that were waiting for it`. The [skip gate](#content-hash-skip-gate) keeps every module already installed `authoritative` with the active embedder, so only the waiting modules are installed again. Unlike the start-up install, a catch-up runs no obsolescence sweep — a module missing from its set may only be unhealthy right now, and must not be deleted with its classes — and runs `afterInstall` only for the modules it installed again, since the platform is already serving.
- **When nothing runs.** If the last install left no module waiting, a ready signal does nothing. Several ready signals queue several catch-ups, but only the first finds a module waiting; it clears the mark, so the others do nothing. A catch-up that throws is logged as `Catch-up module install failed` and keeps the waiting modules marked; the next start installs any module still `partial`.

For operators: a deployment whose in-process model downloads at first start gets its classes embedded once the model is ready, without a restart.

### Installs run one at a time

`updateAllModules` and `resetSingleModule` queue on one chain: each runs after every install queued before it has finished, successfully or not. The start-up install, a catch-up and a module reset therefore never overlap; a reset requested while the start-up install runs waits for it.

### afterInstall post-commit hook invocation

`updateAllModules` upserts each module's `:Module` node and element classes inside **that module's own write transaction** (see [Install phases](#install-phases)). Only *after* that transaction commits is a module's own `:Module` node visible to a fresh session — so the platform runs each module's optional [`afterInstall`](../../modules/DT_MODULE_INTERFACE.md#afterinstallctx) hook **post-commit**: once every per-module write transaction and the obsolescence sweep have returned.

The private helper `runAfterInstall(session, moduleName, instance)` performs one invocation:

```typescript
// After every per-module write transaction and the obsolescence sweep have
// returned, iterate the installed set (installed OR content-hash-skipped) and
// fire each module's hook. A module whose write failed is not in the set.
for (const name of modulesInstalled) {
  await this.runAfterInstall(session, name, modules.get(name));
}
```

- **When it fires.** From `updateAllModules` at boot, and on a [catch-up](#catch-up-when-the-embedder-becomes-ready), for every module in the installed set — which includes **content-hash-skipped (unchanged) modules**, so an unchanged module still re-runs its hook each boot. Also from `resetSingleModule` (the operator "reset a broken module" path), which re-runs the hook for the single reset module post-commit.
- **What it passes.** The hook receives `{ driver, moduleName, databaseName }` — the raw driver (not a `tx`), so the hook opens its **own** session. The authoring contract for that session lives in the [DTModule interface → afterInstall(ctx)](../../modules/DT_MODULE_INTERFACE.md#afterinstallctx).
- **Timeout bound.** The call is wrapped in a `Promise.race` against `MODULE_LOAD_TIMEOUT` (default 30 000 ms). A hook that exceeds it is treated as a failure.
- **Failure isolation + self-heal.** A throw *or* a timeout is caught and logged, then downgrades **only this module** — `SET m.lastInstallStatus = 'partial'` on its `:Module` node. The content-hash skip gate reinstalls a `partial` module on the next boot and re-invokes its hook, so a transient failure self-heals. `runAfterInstall` **never throws**: a failing hook never aborts the batch, and sibling modules in the same run are unaffected.

### Class vectors need no index

Install writes each class's `embedding` and `embeddingModel` and nothing more. Class matching by meaning is an exact cosine search in the database, with no vector index (see [Class and control resolver spec → Vector tier](./CLASS_AND_CONTROL_RESOLVER_SPEC.md#vector-tier-optional-requires-embeddings)), so neither `updateAllModules` nor `resetSingleModule` creates, checks or rebuilds a class vector index, and the service does not depend on the class-matching resolver.

### Class policy hash

Each class's metadata may carry `policyHash`: the sha256 of the policy source its evaluation compiles. `DtFileOpaModule` sets it (see [Base classes → getMetadata()](../../modules/BASE_CLASSES.md#getmetadata)): the hash of the empty source for a class with no policy, and none for an issue class or a class whose policy failed to register. `upsertModule` writes it on the class node on every install, and writes `null` when the metadata has none, so a class whose policy no longer registers loses the hash of the one it had.

The hash is what [`FindingReevaluationService`](./SET_INSTANTIATION_ATTRIBUTES.md#re-evaluation-after-a-class-policy-change) compares each element's policy stamp against. A class with no hash has nothing to compare against, so its elements are not re-evaluated. An unchanged module whose class nodes do not hold the hashes it reports is installed again (see [The class policy hash check](#the-class-policy-hash-check)).

### Installed-modules notification

`onModulesInstalled(listener)` registers a listener that is called with the names of the modules an install wrote, after that install has committed and run its `afterInstall` hooks:

- a full install (`updateAllModules`: the start-up install or a catch-up) that wrote at least one module; the modules the [skip gate](#content-hash-skip-gate) skipped are not writes, so an install that skipped every module calls no listener;
- every `resetSingleModule`, with the reset module.

The call is synchronous and happens inside the install's slot on the [install chain](#installs-run-one-at-a-time), so a listener must hand long work off rather than await it. A listener that throws is logged as `A module-installed listener failed` and never fails the install. `FindingReevaluationService` registers one at application bootstrap, after the start-up install has run, and requests a [re-evaluation sweep](./SET_INSTANTIATION_ATTRIBUTES.md#re-evaluation-after-a-class-policy-change) from it; it sweeps once at bootstrap for the start-up install itself.

## Health Monitoring
```typescript
getStatistics(): ModuleStatistics {
  return {
    totalModules: this.statistics.totalModules,
    totalClasses: this.statistics.totalClasses,
    operationCount: this.statistics.operationCount,
    averageOperationTime: this.statistics.averageOperationTime,
    lastOperationAt: this.statistics.lastOperationAt,
  };
}
```

## Audit Trail
- Every operation logged with context
- Performance metrics tracked
- Error details preserved
- Success/failure rates monitored

## API Reference

### Method Signatures
```typescript
async upsertModule(
  tx: DatabaseTransaction,
  metadata: DTMetadata,
  options: ModuleOperationOptions = {}
): Promise<UpsertResult>
```

### Backward Compatibility
- All existing method signatures maintained
- Return types enhanced but compatible
- Optional parameters for new features

### Other Capabilities
```typescript
// Statistics and monitoring
getStatistics(): ModuleStatistics
resetStatistics(): void

// Called with the names of the modules each install wrote (see Installed-modules notification)
onModulesInstalled(listener: (moduleNames: string[]) => void): void

// Validation
validateMetadata(metadata: DTMetadata): ModuleValidationResult
validateClassLabel(classLabel: string): void
validateClassObject(cls: any, classLabel: string): void
```
