# Data Access Layer
## Table of Contents
- [Overview](#overview)
- [DtUtils Class](#dtutils-class)
- [Retry Pattern](#retry-pattern)
- [Mutex Protection](#mutex-protection)
- [Request Deduplication](#request-deduplication)
- [Error Handling](#error-handling)
- [Query and Mutation Execution](#query-and-mutation-execution)
- [Utility Methods](#utility-methods)
- [Boundary Zoning Utilities](#boundary-zoning-utilities)
## Overview
The `DtUtils` class is used by all dt-core domain classes via composition. It handles retry logic, mutex locking, and request deduplication so that individual domain classes only need to define their GraphQL queries and mutations.
**Source Files:**
- TypeScript: `packages/dt-core/src/dt-utils/dt-utils.ts`
```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DtUtils Architecture                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Incoming Request                           │    │
│  └─────────────────────────────┬───────────────────────────────────┘    │
│                                │                                        │
│                      ┌─────────┴─────────┐                              │
│                      │    withMutex()    │ ◀── Prevents parallel        │
│                      │                   │     execution of same        │
│                      │   Acquire lock    │     operation                │
│                      └─────────┬─────────┘                              │
│                                │                                        │
│                      ┌─────────┴─────────┐                              │
│                      │ withDeduplication │ ◀── Reuses in-flight         │
│                      │                   │     requests                 │
│                      │  Check cache      │                              │
│                      └─────────┬─────────┘                              │
│                                │                                        │
│                      ┌─────────┴─────────┐                              │
│                      │retryNetworkOp()   │ ◀── Handles transient        │
│                      │                   │     failures                 │
│                      │ Exponential       │                              │
│                      │ backoff           │                              │
│                      └─────────┬─────────┘                              │
│                                │                                        │
│                      ┌─────────┴─────────┐                              │
│                      │  Apollo Client    │                              │
│                      │                   │                              │
│                      │ query() / mutate()│                              │
│                      └─────────┬─────────┘                              │
│                                │                                        │
│                      ┌─────────┴─────────┐                              │
│                      │   handleError()   │ ◀── Structured logging       │
│                      │                   │     and error context        │
│                      └───────────────────┘                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```
---
## DtUtils Class
### Constructor
```typescript
// TypeScript
import { ApolloClient, NormalizedCacheObject } from '@apollo/client/core'
class DtUtils {
  private apolloClient: ApolloClient<NormalizedCacheObject> | null = null
  private mutex: Map<string, Promise<any>> = new Map()
  private requestDeduplicator = new Map<string, Promise<any>>()
  private requestMetadata = new Map<string, { timestamp: number; count: number }>()
  constructor(client: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = client
  }
}
```
---
## Retry Pattern
### Configuration
```typescript
interface RetryConfig {
  maxRetries: number    // Maximum retry attempts (default: 3)
  baseDelay: number     // Initial delay in ms (default: 1000)
  maxDelay: number      // Maximum delay cap in ms (default: 5000)
}
const DEFAULT_NETWORK_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000
}
```
### Exponential Backoff Flow
```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Retry with Exponential Backoff                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Attempt 0: Execute operation                                           │
│       │                                                                 │
│       ├── Success → Return result                                       │
│       │                                                                 │
│       └── Network Error?                                                │
│               │                                                         │
│               ├── No → Throw immediately (not retryable)                │
│               │                                                         │
│               └── Yes → Wait 1000ms (baseDelay × 2^0)                   │
│                                                                         │
│  Attempt 1: Execute operation                                           │
│       │                                                                 │
│       ├── Success → Return result                                       │
│       │                                                                 │
│       └── Network Error → Wait 2000ms (baseDelay × 2^1)                 │
│                                                                         │
│  Attempt 2: Execute operation                                           │
│       │                                                                 │
│       ├── Success → Return result                                       │
│       │                                                                 │
│       └── Network Error → Wait 4000ms (capped at maxDelay: 5000ms)      │
│                                                                         │
│  Attempt 3: Execute operation (final attempt)                           │
│       │                                                                 │
│       ├── Success → Return result                                       │
│       │                                                                 │
│       └── Failure → Throw error                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```
### Implementation
```typescript
private async retryNetworkOperation<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_NETWORK_RETRY
): Promise<T> {
  let lastError: any
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      // Only retry network/transport failures
      if (attempt === config.maxRetries || !this.isNetworkError(error)) {
        throw error
      }
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt),
        config.maxDelay
      )
      console.warn(`[DtUtils] Retrying (attempt ${attempt + 1}) after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
```
### Network Error Detection
```typescript
private isNetworkError(error: any): boolean {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  const networkIndicators = [
    'network', 'timeout', 'fetch', 'connection',
    'offline', 'unreachable', '502', '503', '504'
  ]
  return networkIndicators.some(indicator => message.includes(indicator)) ||
         error.networkError ||
         error.code === 'NETWORK_ERROR'
}
```
---
## Mutex Protection
The mutex pattern prevents parallel execution of the same operation, avoiding race conditions.
### Use Case
```
Without Mutex:                      With Mutex:
┌────────────────────────┐         ┌────────────────────────┐
│ Request A: Update X    │         │ Request A: Update X    │
│ Request B: Update X    │         │      (executing)       │
│      (parallel)        │         │                        │
│         │              │         │ Request B: Update X    │
│    ┌────┴────┐         │         │      (waiting)         │
│    ▼         ▼         │         │         │              │
│ DB: X=A   DB: X=B      │         │         ▼              │
│    │         │         │         │ Request A completes    │
│    └────┬────┘         │         │         │              │
│         ▼              │         │         ▼              │
│  Race condition!       │         │ Request B executes     │
│  Final value unknown   │         │         │              │
│                        │         │         ▼              │
│                        │         │  Consistent result     │
└────────────────────────┘         └────────────────────────┘
```
### Implementation
```typescript
async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // If there's already a promise for this key, wait for it
  if (this.mutex.has(key)) {
    await this.mutex.get(key)
  }
  // Create new promise for this execution
  const promise = fn()
  this.mutex.set(key, promise)
  try {
    return await promise
  } finally {
    // Clean up the mutex entry
    this.mutex.delete(key)
  }
}
```
### Key Generation
Mutex keys are generated from operation name + parameters:
```typescript
const mutexKey = `${action}-${JSON.stringify(variables)}`
```
---
## Request Deduplication
Deduplication reuses in-flight requests for identical operations, reducing server load.
### Flow
```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Request Deduplication                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Request A: getModel("123")     Request B: getModel("123")              │
│       │                              │                                  │
│       ▼                              │                                  │
│  Check cache: empty                  ▼                                  │
│       │                         Check cache: has A's promise            │
│       ▼                              │                                  │
│  Start network request               ▼                                  │
│  Store promise in cache         Return same promise                     │
│       │                              │                                  │
│       │◀─────────────────────────────┘                                  │
│       │                                                                 │
│       ▼                                                                 │
│  Network response received                                              │
│       │                                                                 │
│       ├─────────────────────────────┐                                   │
│       ▼                             ▼                                   │
│  Request A resolved          Request B resolved                         │
│  (same data)                 (same data)                                │
│                                                                         │
│  Result: 1 network request, 2 consumers                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```
### Implementation
```typescript
private async withDeduplication<T>(
  key: string,
  operation: () => Promise<T>,
  ttl: number = 5000
): Promise<T> {
  // Check for existing request
  if (this.requestDeduplicator.has(key)) {
    const metadata = this.requestMetadata.get(key)!
    metadata.count++
    console.debug(`[DtUtils] Deduplicating ${key} (${metadata.count} requests)`)
    return this.requestDeduplicator.get(key)!
  }
  // Start new request
  const promise = operation().finally(() => {
    this.requestDeduplicator.delete(key)
    this.requestMetadata.delete(key)
  })
  this.requestDeduplicator.set(key, promise)
  this.requestMetadata.set(key, { timestamp: Date.now(), count: 1 })
  // Auto-cleanup after TTL
  setTimeout(() => {
    if (this.requestDeduplicator.has(key)) {
      this.requestDeduplicator.delete(key)
      this.requestMetadata.delete(key)
    }
  }, ttl)
  return promise
}
```
---
## Error Handling
### Structured Error Logging
```typescript
handleError({ action, error, context }: {
  action: string,
  error: any,
  context?: any
}) {
  const timestamp = new Date().toISOString()
  const errorInfo = {
    timestamp,
    action,
    message: error?.message || 'Unknown error',
    type: error?.constructor?.name || 'Error',
    networkError: this.isNetworkError(error),
    context
  }
  console.error(`[DtUtils] Network error in ${action}:`, errorInfo)
}
```
### Error Info Structure
| Field | Description |
|-------|-------------|
| `timestamp` | ISO timestamp of error occurrence |
| `action` | Operation name (e.g., "getModel", "createComponent") |
| `message` | Error message text |
| `type` | Error constructor name |
| `networkError` | Boolean indicating if it's a network failure |
| `context` | Additional context (variables, fetch policy, etc.) |
---
## Query and Mutation Execution
### performQuery
Execute GraphQL queries with retry and mutex:
```typescript
async performQuery<T>({
  query,
  variables = {},
  action,
  fetchPolicy = 'network-only',
  retryConfig
}: {
  query: any,
  variables?: object,
  action: string,
  fetchPolicy?: string,
  retryConfig?: RetryConfig
}): Promise<T> {
  const mutexKey = `${action}-${JSON.stringify(variables)}`
  return this.withMutex(mutexKey, async () => {
    try {
      return await this.retryNetworkOperation(async () => {
        const response = await this.apolloClient?.query({
          query,
          variables,
          fetchPolicy: fetchPolicy as any
        })
        return response?.data as T
      }, retryConfig)
    } catch (error) {
      this.handleError({ action, error, context: { variables, fetchPolicy } })
      throw error
    }
  })
}
```
### performMutation
Execute GraphQL mutations with retry, mutex, and optional deduplication:
```typescript
async performMutation<T>({
  mutation,
  variables,
  dataPath,
  action,
  retryConfig,
  deduplicationKey
}: {
  mutation: any,
  variables: object,
  dataPath: string,
  action: string,
  retryConfig?: RetryConfig,
  deduplicationKey?: string | false
}): Promise<T> {
  const mutexKey = `${action}-${JSON.stringify(variables)}`
  return this.withMutex(mutexKey, async () => {
    try {
      if (deduplicationKey !== false && deduplicationKey) {
        return this.withDeduplication(deduplicationKey, () =>
          this.executeActualMutation(mutation, variables, dataPath, action)
        )
      }
      return this.executeActualMutation(mutation, variables, dataPath, action)
    } catch (error) {
      this.handleError({ action, error, context: { variables, dataPath } })
      throw error
    }
  })
}
```
### Data Path Extraction
The `dataPath` parameter extracts nested data from GraphQL responses:
```typescript
// Response: { data: { createComponent: { component: { id: "123" } } } }
// dataPath: "createComponent.component"
// Result: { id: "123" }
private getValueFromPath({ obj, path }: { obj: any, path: string }): any {
  return path.split('.').reduce((acc, key) => {
    // Handle array indices
    const arrayMatch = key.match(/^([^[]+)\[(\d+)\]$/)
    if (arrayMatch) {
      const arrayKey = arrayMatch[1]
      const index = parseInt(arrayMatch[2], 10)
      return acc && acc[arrayKey] && acc[arrayKey][index]
    } else {
      return acc && acc[key]
    }
  }, obj)
}
```
---
## Utility Methods
### deepMerge
Recursively merge objects:
```typescript
deepMerge(target: any, updates: any) {
  for (const key in updates) {
    if (
      updates[key] &&
      typeof updates[key] === 'object' &&
      !Array.isArray(updates[key])
    ) {
      target[key] = target[key] || {}
      this.deepMerge(target[key], updates[key])
    } else {
      target[key] = updates[key]
    }
  }
  return target
}
```
### Usage in Domain Classes
All domain classes use DtUtils via a private field:
```typescript
// Example: DtModel class
class DtModel {
  private dtUtils: DtUtils
  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.dtUtils = new DtUtils(apolloClient)
  }
  getModels = async (params?: { folderId?: string }): Promise<Model[]> => {
    const data = await this.dtUtils.performQuery<{ models: Model[] }>({
      query: GET_MODELS,
      variables: params || {},
      action: 'getModels',
      fetchPolicy: 'network-only'
    })
    return data?.models || []
  }
  createModel = async (params: CreateModelParams): Promise<Model> => {
    return this.dtUtils.performMutation<Model>({
      mutation: CREATE_MODEL,
      variables: params,
      dataPath: 'createModels.models[0]',
      action: 'createModel'
    })
  }
}
```

---

## Boundary Zoning Utilities

**Source:** `packages/dt-core/src/dt-boundary/boundary-zoning-utils.ts`

Pure helpers (no Apollo, no Vue) that prepare a boundary's zoning fields and conduit edges for the write path. [`DtBoundary.updateBoundaryNode`](./GRAPHQL_OPERATIONS.md#dtboundary) calls them to build its `updateSecurityBoundaries` input. They sanitize declared intent and turn the boundary's conduit buffer into a minimal set of graph edge operations. The zoning types (`Zone`, `Plane`, `Conduit`, `ConduitEdge`, `ConduitDirection`) are defined in the [Domain Model](./DOMAIN_MODEL.md#boundary-zoning).

### Sanitizers

These guard against stale, out-of-range, or duplicate input before it reaches the graph. Each is total — it always returns a valid value, never throws.

| Function | Signature | Behavior |
|----------|-----------|----------|
| `sanitizeZone` | `(z: Zone \| null \| undefined) => Zone \| null` | Returns `z` if it is a member of the canonical `Zone` set, otherwise `null` (= inherit/undecided). |
| `sanitizeDomains` | `(domains: string[] \| undefined) => string[]` | Trims each entry, drops empties, de-dupes case-insensitively (keeps first casing), caps entry length to 64 chars and the list to 16 entries. |
| `normalizePlanes` | `(planes: Plane[] \| undefined) => Plane[]` | Keeps valid `Plane` members, de-dupes, and returns them in a fixed canonical order (`WORKLOAD`, `MANAGEMENT`) so equal sets serialize to equal arrays. |
| `sanitizeJustification` | `(s: string \| null \| undefined) => string \| undefined` | Trims and caps to 500 chars; empty → `undefined` (so it is not written as an empty string). |

`planes` is stored as a `[String!]` graph field rather than a GraphQL enum list; `normalizePlanes` is the app-side validation that keeps the values constrained to the `Plane` union.

### flattenConduits

```typescript
flattenConduits(
  raw: Pick<BoundaryData, 'outboundConduitsConnection' | 'inboundConduitsConnection'> | null | undefined,
): Conduit[]
```

Folds the two raw directed-edge connection reads (`outboundConduitsConnection` / `inboundConduitsConnection`) into a single flat `Conduit[]`. Each edge contributes one `Conduit` whose `direction` is derived from **which connection it came from** (`OUTBOUND` for outbound edges, `INBOUND` for inbound) — direction is never a stored field. Edges with no `node.id` are dropped; `justification` / `controlRefs` are lifted off the edge `properties`. This is the inverse of the write reconcile: reads flatten, writes diff.

### buildConduitOps — baseline delta reconcile

```typescript
buildConduitOps(
  direction: ConduitDirection,
  current: Conduit[] | undefined,
  baseline: Conduit[] | undefined,
  selfId: string,
): (ConduitOps | ConduitUpdateOp)[] | undefined
```

Builds the `outboundConduits` / `inboundConduits` mutation value for **one direction** as a delta of the boundary's current conduit buffer against a **baseline** snapshot. The baseline is the conduits as they were on the server *before* any optimistic edit (the caller snapshots and passes it as `baselineConduits`). Returns `undefined` when there is nothing to do, so the caller can omit the key entirely.

For the given direction it compares `current` against `baseline` (both first passed through `dedupeByPeer`, which drops self-conduits and per-direction duplicates, first-wins) and emits:

- a single membership op `{ connect: [...added], disconnect: [...removed] }` — included only if `connect` or `disconnect` is non-empty;
- one `{ update: ... }` op per peer present in both whose **justification changed** (justification is compared after `sanitizeJustification`, so whitespace-only and over-cap differences do not produce spurious updates).

**Why a delta and not connect-all.** The graph `CONDUIT` `connect` is **not idempotent**: re-connecting an existing peer creates a *duplicate parallel edge* rather than being a no-op. Membership must therefore be expressed as the difference against the last known server state — connect only the newly added peers, disconnect only the removed ones, and `update` only the peers whose justification changed. A naive connect-all would silently accumulate duplicate edges on every save.

```
baseline (server)        current (edited)        ops emitted
─────────────────        ─────────────────       ─────────────────────────────
A (just: "x")            A (just: "x")           (unchanged → no op)
B (just: "y")            B (just: "z")           update B → justification "z"
C (just: "w")            —                       disconnect C
—                        D (just: "v")           connect D

  result for this direction:
    { connect: [D], disconnect: [C] }    // single membership op
    { update: B → justification "z" }    // one update op
```

After the mutation, `updateBoundaryNode` calls `flattenConduits` on the server response to re-derive the boundary's `conduits` so the caller can re-pin its baseline to server truth before the next edit.

### Framing

These utilities persist **declared intent** only. They sanitize and reconcile what the author asserted about a boundary's trust zone, segmentation domains, planes, and conduits; they compute **no verdict** over that intent — they neither validate a conduit against the zones it connects nor flag zone/plane combinations. dt-core does carry a separate, pure-computation module — the [zone determination engine](./ZONE_DETERMINATION.md) — that derives *advisory* trust tiers and coherence findings from a model, but it is read-side only and shares no state with these write utilities; it likewise computes no enforced verdict.
