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
  // Phase A: skip-gate read + resolve vectors per module, outside any transaction
  // Phase B: one write transaction per module
  // Obsolescence sweep (deleteOldModules) in its own final write transaction
  // afterInstall hooks, post-commit
  // Track success/failure rates; logging and metrics
}
```

### Install phases

`updateAllModules` never holds a write transaction open while class vectors are being made, and never lets one module's failed write take the others down with it:

1. **Wait for the embedder's start-up check.** It awaits `EmbeddingService.whenStartupChecked()`, so a reachable HTTP embedding endpoint embeds this install instead of every module being installed `partial`.
2. **Phase A — resolve vectors, outside any transaction.** One read of every `:Module` node's stored state feeds the [content-hash skip gate](#content-hash-skip-gate). For each module the gate does not skip, `resolveVectors` makes the class vectors. A module whose metadata or vectors fail is logged and left out of this round; the rest carry on.
3. **Phase B — one write transaction per module.** Each resolved module's `upsertModule` runs in its **own** `session.executeWrite`, with the vectors from Phase A (no embedding requests inside the transaction). A module whose write fails rolls back only its own transaction; every other module still commits.
4. **Obsolescence sweep — its own final transaction.** After every module upsert has committed, `deleteOldModules` runs in one more write transaction. It protects every module **present on disk this round**, not only the ones that installed, so a module that failed this time is never taken for a removed one and deleted with its classes. A failed sweep is logged and does not stop start-up; an obsolete module then lingers until the next sweep.
5. **Post-commit hooks.** Each installed or skipped module's `afterInstall` hook runs (see [below](#afterinstall-post-commit-hook-invocation)).

**Why per module.** In one shared transaction, a database-level error in any module (for example, a class id collision) aborts the whole transaction: every later statement, the sweep included, fails and the entire batch rolls back. A per-module `try`/`catch` inside that transaction cannot contain the failure; a transaction per module does.

### Content-hash skip gate

Before it resolves any class vectors, `updateAllModules` reads every `:Module` node's stored `contentHash` and `lastInstallStatus` in one read. A module is **skipped** — no vector resolution, no graph write — when both of these hold:

- its `contentHash` equals the one stored on its `:Module` node, and
- its last install was `authoritative`.

A skipped module still counts as installed: `deleteOldModules` keeps it, and its `afterInstall` hook still runs (see [below](#afterinstall-post-commit-hook-invocation)). Every other case is a full install: no stored node, a different hash, a `partial` last install, or a forced run (`MODULE_LOAD_FORCE=1`, which `ModuleRegistryService` passes as `options.force`).

**Where the hash comes from.**

| Module | `contentHash` the gate compares |
|---|---|
| Ships one in its metadata (a file module: `module.json`, written by `scripts/hash-module.mjs`) | The shipped hash, as is |
| Ships none and does not implement `getEmbedding()` (a module written in code) | A **computed hash** (below) |
| Ships none and implements `getEmbedding()` | None — installed on every start |

**The computed hash.** `computedContentHash` (`module-content-hash.ts`) returns `sha256:<hex>` over the canonical JSON (object keys sorted at every depth) of:

- the module's `getMetadata()` result, without any `contentHash` field,
- the active embedder: `<model>/<dimensions>` while embedding is enabled or pending, otherwise `off`, and
- the platform version: the `version` in dt-ws's `package.json` (`platform-version.ts`).

The install stores the computed hash on the `:Module` node exactly like a shipped one, so the next start skips the module while nothing changed. A change to the metadata — any class, any class field, the module `version`, the `idRebindPolicy` — to the embedder (model, dimensions, on/off) or to the platform version yields a different hash and a full reinstall. A platform upgrade therefore reinstalls each such module once, then the gate skips it again.

**Why these inputs are complete.** An install writes the `:Module` node and its classes from `getMetadata()` alone, plus one vector per class that the active embedder makes from that metadata. The platform's own install code does the writing, and an upgrade may write the same metadata differently, so the platform version is an input too. A file module is unaffected: the gate compares its shipped hash as is. Templates, guides, exposures, countermeasures and Rego policies are not install inputs: the platform asks the module for them when they are used, so a skipped install cannot leave a stale one behind. `update-all-modules.skip-gate.spec.ts` pins this — the install reads nothing from a module except `getMetadata`, `getEmbedding` and `afterInstall`. If the install ever reads another input, that input belongs in the computed hash.

**The `getEmbedding()` exception.** A module that implements `getEmbedding()` hands the install pre-computed vectors from a source its metadata does not show, so a hash over the metadata cannot vouch for them. Such a module gets no computed hash and is installed on every start unless it ships its own `contentHash`. `DtFileOpaModule` implements `getEmbedding()`, so a file module whose `module.json` carries no `contentHash` is likewise installed on every start.

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

- **When it fires.** From `updateAllModules` at boot for every module in the installed set — which includes **content-hash-skipped (unchanged) modules**, so an unchanged module still re-runs its hook each boot. Also from `resetSingleModule` (the operator "reset a broken module" path), which re-runs the hook for the single reset module post-commit.
- **What it passes.** The hook receives `{ driver, moduleName, databaseName }` — the raw driver (not a `tx`), so the hook opens its **own** session. The authoring contract for that session lives in the [DTModule interface → afterInstall(ctx)](../../modules/DT_MODULE_INTERFACE.md#afterinstallctx).
- **Timeout bound.** The call is wrapped in a `Promise.race` against `MODULE_LOAD_TIMEOUT` (default 30 000 ms). A hook that exceeds it is treated as a failure.
- **Failure isolation + self-heal.** A throw *or* a timeout is caught and logged, then downgrades **only this module** — `SET m.lastInstallStatus = 'partial'` on its `:Module` node. The content-hash skip gate reinstalls a `partial` module on the next boot and re-invokes its hook, so a transient failure self-heals. `runAfterInstall` **never throws**: a failing hook never aborts the batch, and sibling modules in the same run are unaffected.

### Class vectors need no index

Install writes each class's `embedding` and `embeddingModel` and nothing more. Class matching by meaning is an exact cosine search in the database, with no vector index (see [Class and control resolver spec → Vector tier](./CLASS_AND_CONTROL_RESOLVER_SPEC.md#vector-tier-optional-requires-embeddings)), so neither `updateAllModules` nor `resetSingleModule` creates, checks or rebuilds a class vector index, and the service does not depend on the class-matching resolver.

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

// Validation
validateMetadata(metadata: DTMetadata): ModuleValidationResult
validateClassLabel(classLabel: string): void
validateClassObject(cls: any, classLabel: string): void
```
