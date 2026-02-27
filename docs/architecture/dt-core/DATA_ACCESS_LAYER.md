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

## Overview

The `DtUtils` class provides the foundation for all GraphQL operations in dt-core. It implements resilient data access patterns that handle network failures, prevent race conditions, and avoid duplicate requests.

**Source Files:**
- TypeScript: `packages/dt-core/src/dt-utils/dt-utils.ts`
- Python: `packages/dt-core-py/dt_core/utils/dt_utils.py`

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

```python
# Python
from gql import Client

class DtUtils:
    def __init__(self, client: Client):
        self.client = client
        self._mutex: Dict[str, asyncio.Future] = {}
        self._request_cache: Dict[str, asyncio.Future] = {}
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

All domain classes extend DtUtils patterns:

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
