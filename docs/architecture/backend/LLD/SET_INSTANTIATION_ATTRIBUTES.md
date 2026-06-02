# SetInstantiationAttributesService

## Overview

The `SetInstantiationAttributesService` handles component configuration and integrates with the MITRE ATT&CK framework while supporting batch processing for frontend auto-save functionality.

## Key Features

### Neo4j v5 Transaction Management
- **Native Neo4j Implementation**: Uses `executeRead()`/`executeWrite()` methods as per [Neo4j JavaScript Driver documentation](https://neo4j.com/docs/javascript-manual/current/transactions/)
- **Proper Session Management**: Guaranteed session cleanup using try/finally patterns
- **Transaction Safety**: Complete transaction management without local rollback mechanisms
- **Connection Efficiency**: Optimized session lifecycle with proper database configuration

### Batch Processing for Auto-Save
- **Debounced Operations**: 1-second debounce for frequent frontend updates
- **Auto-Save Optimization**: Handles rapid successive updates from frontend auto-save
- **Latest Wins Strategy**: Processes the most recent attributes when batching
- **Configurable Batching**: Batch size and debounce timing can be adjusted

### Architecture
- **Structured Logging**: Complete replacement of `console.*` with NestJS Logger
- **Error Handling**: Fallback behavior and detailed error context
- **Input Validation**: Thorough parameter validation with detailed error messages
- **Type Safety**: Complete TypeScript interfaces replacing all `any` types
- **Resource Management**: Proper database session lifecycle and cleanup

## Design Decisions

### Neo4j v5 Transaction Patterns
```typescript
// Using executeWrite as per Neo4j documentation
await session.executeWrite(async (tx: DatabaseTransaction) => {
  const result = await tx.run(query, parameters);
  // Process result within transaction
});
```

### Batch Processing for Frontend Auto-Save
```typescript
// Debounced handling for frequent frontend updates
private async setAttributesWithBatching(
  request: SetAttributesRequest,
  context?: AuthorizationContext,
): Promise<SetAttributesResult> {
  // Add to batch queue with debounce timeout
  // Process latest request when debounce period expires
}

// Configuration for auto-save optimization
batchEnabled: true,
batchDebounceTime: 1000, // 1 second debounce
maxBatchSize: 10,
```

### Concurrency Control
```typescript
// Following established pattern from other resolvers
private async executeWithConcurrencyControl(
  componentId: string,
  operation: () => Promise<SetAttributesResult>,
): Promise<SetAttributesResult> {
  // Same mutex pattern as other services
  // Timeout handling and cleanup
}
```

### Authorization
```typescript
// Authorization handled by GraphQL schema directives (@authentication)
private async checkAuthorization(
  context: AuthorizationContext | undefined,
  operation: string,
  resource: Record<string, any>,
): Promise<void> {
  return; // Schema-level authorization
}
```

## Monitoring and Observability

### Metrics
- **Operation Statistics**: Success rates, response times, operation counts by type
- **Batch Processing Metrics**: Batch sizes, wait times, debouncing activity
- **Concurrency Tracking**: Active operations, mutex usage, resource contention
- **Database Performance**: Transaction times, session usage, connection efficiency

### Health Monitoring
```typescript
interface SetInstantiationStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageResponseTime: number;
  longestOperation: number;
  shortestOperation: number;
  operationsByType: {
    setAttributes: number;
    upsertExposures: number;
    upsertCountermeasures: number;
    linkExternalObjects: number;
  };
  batchProcessing: BatchProcessingStatistics;
}
```

## Core Service Methods

### Main Operations
- `setAttributes()` - Set component instantiation attributes with Neo4j v5 patterns
- `processControlCountermeasures()` - Handle countermeasures for control components
- `processComponentExposures()` - Handle exposures for non-control components

### Database Operations (Neo4j v5)
- `upsertExposures()` - Upsert exposures using `executeWrite` pattern (owns its own session + transaction)
- `upsertCountermeasures()` - Upsert countermeasures using `executeWrite` pattern (owns its own session + transaction)
- `upsertExposuresInTx(tx, request)` - **Public tx-bound helper.** Runs the scoped Cypher upsert inside a caller-supplied `DatabaseTransaction`. Performs no session management of its own; used by `ElementBindingService` to fold the constructive-upsert step into its single `executeWrite` block. See [Tx-bound helpers shared with `changeElementBinding`](#tx-bound-helpers-shared-with-changeelementbinding).
- `upsertCountermeasuresInTx(tx, request)` - **Public tx-bound helper.** Same pattern as `upsertExposuresInTx`, for Countermeasures.
- `linkToExternalObject()` - Link to MITRE ATT&CK techniques/mitigations
- `deleteObsoleteExternalObjects()` - Clean up obsolete security objects

### Tx-bound helpers shared with `changeElementBinding`

`upsertExposuresInTx` and `upsertCountermeasuresInTx` are the public, transaction-bound forms of the standard upsert helpers. They take an already-open `DatabaseTransaction` as their first argument and perform no session management of their own, so a caller can fold the constructive-upsert step into its own `executeWrite` block.

The atomic class-change resolver in [`ElementBindingService`](../../../../apps/dt-ws/src/gql/resolver-services/element-binding.service.ts) is the second caller. Its single `executeWrite` runs in sequence:

1. In-tx authoritative read of the current binding.
2. Identity short-circuit (if target matches current, exit with zero deltas).
3. Destructive sweep of stale SYSTEM-derived findings (predicate: `createdBy = 'SYSTEM' OR createdBy IS NULL`).
4. Rewire of the `IS_INSTANCE_OF` / `REPRESENTS_MODEL` edges.
5. **`upsertExposuresInTx` / `upsertCountermeasuresInTx`** for the newly-bound classes.

All five steps share one Bolt transaction. On any error, Bolt rolls back the rewire and the upsert together — no partial graph state can land. The shared module-attribute sanitiser lives in [`src/gql/resolver-services/shared/finding-attrs.ts`](../../../../apps/dt-ws/src/gql/resolver-services/shared/finding-attrs.ts); both write paths (the `setInstantiationAttributes` mutation and `changeElementBinding`) apply the same positive allowlist (`EXPOSURE_ATTR_KEYS`, `COUNTERMEASURE_ATTR_KEYS`) to keys returned by module SDKs. This excludes server-owned fields (`id`, `createdBy`) and any module-supplied keys not in the schema.

### Batch Processing
- `setAttributesWithBatching()` - Debounced batch processing for auto-save
- `processBatch()` - Process batched operations with latest-wins strategy

### Management Operations
- `getStatistics()` - Operation statistics
- `resetStatistics()` - Reset metrics for monitoring systems
- `getHealthStatus()` - Complete health check with issue detection

## Security and Authorization

### Authorization Framework
```typescript
// Authorization handled by GraphQL schema directives (@authentication)
private async checkAuthorization(
  context: AuthorizationContext | undefined,
  operation: string,
  resource: Record<string, any>,
): Promise<void> {
  return; // Schema-level authorization
}
```

### Input Validation
- **Parameter validation**: All inputs validated before processing
- **Type Safety**: Strong typing throughout the service
- **Error Context**: Detailed validation error messages
- **External Object Validation**: MITRE ATT&CK reference validation

## Database and Transaction Management

### Neo4j v5 Patterns
```typescript
// Session management with guaranteed cleanup
const session = this.neo4jDriver.session({
  database: this.configService.get('database.name') || 'neo4j',
}) as DatabaseSession;

try {
  // Use executeWrite pattern
  const result = await session.executeWrite(async (tx: DatabaseTransaction) => {
    return await tx.run(query, parameters);
  });
  // Process result
} finally {
  await session.close();
}
```

### Transaction Safety
- **Native Neo4j Transactions**: No local rollback mechanisms as per requirements
- **Proper Error Handling**: Database errors propagated correctly
- **Connection Management**: Efficient session lifecycle management
- **Query Optimization**: Optimized Cypher queries for performance

## Error Handling and Resilience

### Structured Error Types
```typescript
type SetInstantiationErrorType =
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'MODULE_ERROR'
  | 'TRANSACTION_ERROR'
  | 'EXTERNAL_LINK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UNKNOWN_ERROR';
```

### Fallback Behavior
- **Structured Error Responses**: Return detailed error context instead of throwing
- **Operation Context**: Maintain operation context through error chains
- **Resource Cleanup**: Automatic cleanup of failed operations
- **Retry Logic**: Configurable retry attempts for transient failures

## Performance Optimizations

### Batch Processing
- **Reduced Database Load**: Batch multiple rapid updates into single operation
- **Frontend Optimization**: Handle auto-save scenarios efficiently
- **Latest Wins**: Process most recent attributes, avoiding stale updates
- **Configurable Debouncing**: Adjustable timing for different use cases

### Database Efficiency
- **Transaction Patterns**: Optimized Neo4j v5 transaction usage
- **Session Pooling**: Proper session lifecycle management
- **Query Optimization**: Efficient Cypher queries for exposures/countermeasures
- **Connection Management**: Minimized connection overhead

### Monitoring Integration
- **Operation Timing**: Track response times for all operations
- **Success Rate Monitoring**: Monitor failure rates and trends
- **Resource Usage Tracking**: Database sessions, concurrent operations, batch queues
- **Alert Thresholds**: Configurable thresholds for health monitoring

## Configuration

```typescript
interface SetInstantiationConfig {
  // Batch processing settings
  batchEnabled: boolean;
  batchDebounceTime: number; // milliseconds
  maxBatchSize: number;

  // Operation settings
  operationTimeout: number;
  maxConcurrentOperations: number;

  // Database settings
  transactionTimeout: number;
  retryAttempts: number;

  // Monitoring settings
  enableDetailedMetrics: boolean;
  metricsRetentionPeriod: number;
}
```

## Shared Services Integration

### Shared Service Architecture
- **AuthorizationService**: Centralized authorization context extraction
- **MonitoringService**: Unified operation metrics and health monitoring
- **Consistent Patterns**: Same concurrency control and error handling patterns

### MITRE ATT&CK Integration
- **External Object Linking**: Links exposures to MITRE techniques (`EXPLOITED_BY`)
- **Countermeasure Mapping**: Maps countermeasures to MITRE mitigations + D3FEND techniques (`RESPONDS_WITH`, the identity block)
- **Data Consistency**: Maintains referential integrity with external frameworks
- **Validation**: Validates MITRE references for data quality (`validateExternalObjectTarget` — label/property/value, Cypher-identifier regex)

#### Countermeasure verb edges
- **Closed verb set**: beyond the identity `RESPONDS_WITH`, a countermeasure carries per-verb relations to the ATT&CK **Techniques** it counters — `COUNTERMEASURE_MITIGATES`, `_PROTECTS_AGAINST`, `_DETECTS`, `_ISOLATES`, `_DECEIVES`, `_EVICTS`, `_RESTORES`, `_RESPONDS_TO`. The verb→edge-type map (`COUNTERMEASURE_VERB_EDGES`) is the single source of truth; adding a verb is a deliberate cross-layer change (the dt-module `Countermeasure` interface + this map + the GraphQL schema).
- **Relationship-type safety**: an edge's `relationName` is **only ever** a compile-time constant (a map value or the `RESPONDS_WITH`/`EXPLOITED_BY` literals) — never data-derived. The `linkToExternalObject` identifier regex is a backstop.
- **Edge provenance (`justification`)**: each ref may carry edge `attributes`, written via `SET rel += $attributes`. Edge attributes are **key-allowlisted** (`EDGE_ATTR_KEYS = ['justification']`) and primitive-guarded (`describeNonPrimitiveValue`), mirroring the node-property allowlist in `shared/finding-attrs.ts`. A non-allowlisted key is dropped; a non-primitive value is dropped **with a warning, never thrown** — a bad provenance string must not abort the upsert.
- **Stale-key caveat**: `SET rel += $attributes` *merges*, it does not replace. A key written by an earlier policy version and removed in a later one persists on the edge. The allowlist bounds this to `justification` (the only key that can ever land).
- **Append-only / durability limit**: verb edges are **never pruned** — the obsolete-cleanup path operates at the node level only. Stale verb edges from a prior policy version persist by design, so analyses that referenced edges at their run time stay valid even as the model evolves.

## Business Logic

### Component Type Handling
- **Component Type Handling**: Preserves existing Issue/Control/Component logic
- **Module Integration**: Maintains existing module interface patterns
- **Exposure/Countermeasure Processing**: Same business logic with improved reliability
- **MITRE Framework Integration**: Consistent external object linking

### Frontend Auto-Save Optimization
- **Debounced Updates**: Handles rapid successive updates efficiently
- **Latest Wins Strategy**: Most recent data wins
- **Reduced Server Load**: Batches frequent updates to reduce database operations
- **User Experience**: Maintains responsive frontend while optimizing backend
