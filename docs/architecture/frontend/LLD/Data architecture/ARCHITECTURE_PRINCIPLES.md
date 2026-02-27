# Architecture Principles & Patterns

## Table of Contents
- [Overview](#overview)
- [Layered Architecture](#layered-architecture)
- [Library Layer (dt-core)](#library-layer-dt-core)
- [Store Layer (Pinia)](#store-layer-pinia)
- [Implementation Patterns](#implementation-patterns)
- [Error Handling Strategy](#error-handling-strategy)
- [Performance Optimizations](#performance-optimizations)
- [Best Practices](#best-practices)

## Overview

This application follows a **clean, layered architecture** designed for production-ready Vue.js applications. The architecture emphasizes separation of concerns, maintainability, and robust error handling while avoiding over-engineering for browser-based environments.

### Core Design Principles

1. **Separation of Concerns**: Clear boundaries between data access, business logic, and presentation
2. **Single Responsibility**: Each layer has a specific, well-defined purpose
3. **Error Propagation**: Structured error handling that preserves context through the stack
4. **Production Readiness**: Built for reliability with retry logic, deduplication, and mutex protection
5. **Browser Optimization**: Lightweight patterns suitable for client-side execution

## Layered Architecture

```
┌─────────────────────────────────────┐
│           UI Layer (Vue/Vuetify)    │
│  - Components, Pages, Layouts       │
│  - User Interface Logic             │
└─────────────────────────────────────┘
                    │
┌─────────────────────────────────────┐
│         Store Layer (Pinia)         │
│  - Business Logic                   │
│  - State Management                 │
│  - Error Classification             │
│  - State-Aware Validation           │
│  - Optimistic Updates               │
└─────────────────────────────────────┘
                    │
┌─────────────────────────────────────┐
│       Library Layer (dt-core)       │
│  - Pure Data Operations             │
│  - GraphQL Queries/Mutations        │
│  - Data Transformation              │
│  - Network Communication            │
│  - Mutex Protection                 │
│  - Retry Logic                      │
│  - Request Deduplication            │
└─────────────────────────────────────┘
                    │
┌─────────────────────────────────────┐
│         Backend (GraphQL)           │
│  - Data Persistence                 │
│  - Server-Side Business Logic       │
│  - Authentication/Authorization     │
└─────────────────────────────────────┘
```

## Library Layer (dt-core)

The library layer is a **lightweight abstraction** over GraphQL operations, focused solely on data access and network communication.

### Responsibilities

#### ✅ What the Library Layer DOES:
- **Pure Data Operations**: GraphQL queries and mutations
- **Data Transformation**: Converting GraphQL responses to usable formats
- **Network Communication**: Handling HTTP/WebSocket connections
- **Technical Error Handling**: Network timeouts, connection failures, transport errors
- **Mutex Protection**: Preventing concurrent execution of critical operations
- **Retry Logic**: Automatic retry for network-related failures
- **Request Deduplication**: Preventing duplicate concurrent requests
- **Structured Logging**: Technical error logging for debugging

#### ❌ What the Library Layer DOES NOT:
- **Business Logic**: No domain-specific rules or workflows
- **User-Facing Error Messages**: Only technical error handling
- **Input Validation**: Validation is handled by the store layer
- **State Management**: No reactive state or caching
- **User Experience Logic**: No optimistic updates or UI state
- **Configuration Management**: Browser-based apps don't need complex config

### Core Architecture Pattern

```typescript
export class DtAnalysis {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient) // Centralized utilities
  }

  // All methods follow this pattern:
  methodName = async (params): Promise<ReturnType> => {
    try {
      return await this.dtUtils.performQuery({
        query: GRAPHQL_QUERY,
        variables: params,
        action: 'methodName',
        fetchPolicy: 'network-only',
        deduplicationKey: `method-${JSON.stringify(params)}`
      })
    } catch (error) {
      // Error is logged by dtUtils and re-thrown
      throw error
    }
  }
}
```

### Centralized Utilities (DtUtils)

The `DtUtils` class provides all shared functionality:

```typescript
export class DtUtils {
  private apolloClient: ApolloClient<NormalizedCacheObject>
  private mutex: Map<string, Promise<any>> = new Map()
  private requestDeduplicator = new Map<string, Promise<any>>()
  private requestMetadata = new Map<string, { timestamp: number; count: number }>()

  // Core operations
  async performQuery<T>(params): Promise<T>
  async performMutation<T>(params): Promise<T>
  
  // Concurrency control
  async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T>
  
  // Error handling
  handleError({ action, error, context }): void
  
  // Utility functions
  deepMerge(target: any, source: any): any
  getValueFromPath({ obj, path }): any
}
```

## Store Layer (Pinia)

The store layer acts as the **primary interface** between the Vue.js frontend and the backend, handling all business logic and state management.

### Responsibilities

#### ✅ What the Store Layer DOES:
- **Business Logic**: Domain-specific rules, workflows, and processes
- **State Management**: Reactive state for UI components
- **Error Classification**: Converting technical errors to user-friendly messages
- **Input Validation**: State-aware validation with business rules
- **Optimistic Updates**: Immediate UI feedback with rollback capabilities
- **State Synchronization**: Keeping different parts of the state in sync
- **Loading State Management**: Tracking operation progress for UI indicators
- **Caching Strategy**: Intelligent data refresh and cache invalidation
- **User Experience**: Retry logic, success messages, and error recovery

#### ❌ What the Store Layer DOES NOT:
- **Direct GraphQL Operations**: Always goes through the library layer
- **Network-Level Error Handling**: Technical errors are handled by libraries
- **Data Transformation**: Raw data transformation is done by libraries
- **Mutex/Concurrency**: Technical concurrency is handled by libraries

### Store Architecture Pattern

```typescript
export const useAnalysisStore = defineStore('analysis', () => {
  // 1. Reactive State
  const analyses = ref<Analysis[]>([])
  const currentAnalysis = ref<Analysis | null>(null)
  const error = ref<string>('')
  const loadingStates = ref({
    fetchingAnalyses: false,
    creatingAnalysis: false,
    // ... other loading states
  })

  // 2. Library Dependencies
  const dtAnalysis = new DtAnalysis(apolloClient)
  const dtMitreAttack = new DtMitreAttack(apolloClient)

  // 3. Error Classification
  const handleApiError = (operation: string, err?: any): string => {
    console.error(`${operation} failed:`, err)
    if (err?.message?.includes('401')) return 'Please log in again'
    if (err?.message?.includes('403')) return 'Access denied'
    if (err?.message?.includes('404')) return 'Resource not found'
    if (err?.message?.includes('network')) return 'Connection failed'
    return `Failed to ${operation}. Please try again.`
  }

  // 4. Business Operations
  const createAnalysis = async (params): Promise<Analysis> => {
    // Input validation (business rules)
    const validationErrors = validateInput(params)
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      throw new Error(validationErrors.join(', '))
    }

    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticAnalysis = { ...params, id: tempId, pending: true }
    analyses.value.push(optimisticAnalysis)

    try {
      loadingStates.value.creatingAnalysis = true
      error.value = ''
      
      // Library call (throws on error)
      const analysis = await dtAnalysis.createAnalysis(params)
      
      // Replace optimistic with real data
      const index = analyses.value.findIndex(a => a.id === tempId)
      if (index !== -1) {
        analyses.value.splice(index, 1, structuredClone(analysis))
      }
      return analysis!
    } catch (err) {
      // Remove failed optimistic update
      analyses.value = analyses.value.filter(a => a.id !== tempId)
      error.value = handleApiError('create analysis', err)
      throw err // Re-throw for component error handling
    } finally {
      loadingStates.value.creatingAnalysis = false
    }
  }

  return {
    // State
    analyses, currentAnalysis, error, loadingStates,
    // Operations
    createAnalysis, updateAnalysis, deleteAnalysis,
    // Utilities
    resetStore, handleApiError
  }
})
```

## Implementation Patterns

### 1. Error Handling Strategy

#### Library Layer Error Handling
```typescript
// dt-core libraries: Technical error handling only
async performQuery<T>(params): Promise<T> {
  return this.withMutex(mutexKey, async () => {
    return this.retryNetworkOperation(async () => {
      const response = await this.apolloClient.query({
        query: params.query,
        variables: params.variables,
        fetchPolicy: 'network-only'
      })
      
      const data = this.getValueFromPath({ obj: response.data, path: params.dataPath })
      if (!data) {
        throw new Error(`No data returned for ${params.action}`)
      }
      
      return data as T
    }, params.retryConfig)
  })
}

handleError({ action, error, context }): void {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    action,
    message: error.message,
    type: error.constructor.name,
    context
  }
  console.error('Library error:', errorInfo)
  // Re-throw for store layer to handle
  throw error
}
```

#### Store Layer Error Classification
```typescript
const handleApiError = (operation: string, err?: any): string => {
  console.error(`${operation} failed:`, err)
  
  // Authentication errors
  if (err?.message?.includes('401') || err?.status === 401) {
    return 'Please log in again to continue'
  }
  
  // Authorization errors
  if (err?.message?.includes('403') || err?.status === 403) {
    return 'Access denied - insufficient permissions'
  }
  
  // Not found errors
  if (err?.message?.includes('404') || err?.status === 404) {
    return 'Resource not found'
  }
  
  // Network errors
  if (err?.message?.includes('network') || err?.code === 'NETWORK_ERROR') {
    return 'Connection failed - please check your internet connection'
  }
  
  // Business logic errors
  if (err?.message?.includes('duplicate')) {
    return 'Item already exists'
  }
  
  // Generic fallback
  return `Failed to ${operation.toLowerCase()}. Please try again.`
}
```

### 2. Mutex Protection Pattern

Prevents concurrent execution of critical operations:

```typescript
async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing operation with the same key
  if (this.mutex.has(key)) {
    await this.mutex.get(key)
  }

  // Create new promise for this execution
  const promise = fn()
  this.mutex.set(key, promise)

  try {
    return await promise
  } finally {
    // Always clean up the mutex entry
    this.mutex.delete(key)
  }
}

// Usage in library methods
const mutexKey = `${action}-${JSON.stringify(variables)}`
return this.withMutex(mutexKey, async () => {
  // Critical operation here
})
```

### 3. Request Deduplication Pattern

Prevents multiple identical concurrent requests:

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
    console.log(`Deduplicating request ${key} (${metadata.count} concurrent requests)`)
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

// Usage in mutations
async performMutation<T>(params): Promise<T> {
  const mutexKey = `${params.action}-${JSON.stringify(params.variables)}`
  
  return this.withMutex(mutexKey, async () => {
    // Only deduplicate if enabled and key provided
    if (params.deduplicationKey !== false && params.deduplicationKey) {
      return this.withDeduplication(
        params.deduplicationKey, 
        () => this.executeActualMutation(params)
      )
    }
    return this.executeActualMutation(params)
  })
}
```

### 4. Retry Logic Pattern

Automatic retry for network-related failures with exponential backoff:

```typescript
private async retryNetworkOperation<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_NETWORK_RETRY
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      // Only retry network/transport failures
      if (!this.isNetworkError(error as Error) || attempt === config.maxRetries) {
        throw error
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        config.maxDelay
      )
      
      console.log(`Retrying operation (attempt ${attempt + 1}/${config.maxRetries + 1}) after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}

private isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase()
  const networkIndicators = [
    'network', 'timeout', 'connection', 'fetch',
    '502', '503', '504', 'bad gateway', 
    'service unavailable', 'gateway timeout'
  ]
  
  return networkIndicators.some(indicator => message.includes(indicator))
}
```

### 5. Optimistic Updates Pattern

Immediate UI feedback with rollback capabilities:

```typescript
const createAnalysis = async (params): Promise<Analysis> => {
  // Validation
  const validationErrors = validateInput(params)
  if (validationErrors.length > 0) {
    error.value = validationErrors.join(', ')
    throw new Error(validationErrors.join(', '))
  }

  // Optimistic update setup
  const tempId = `temp-${Date.now()}`
  const optimisticAnalysis = {
    ...params,
    id: tempId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pending: true // Flag for UI indication
  } as Analysis & { pending: boolean }

  try {
    loadingStates.value.creatingAnalysis = true
    error.value = ''
    
    // Add optimistic update immediately
    analyses.value.push(optimisticAnalysis)
    
    // Perform actual operation
    const analysis = await dtAnalysis.createAnalysis(params)
    
    // Replace optimistic with real data
    const index = analyses.value.findIndex(a => a.id === tempId)
    if (index !== -1) {
      const mutableAnalysis = structuredClone(analysis)
      analyses.value.splice(index, 1, mutableAnalysis)
      return mutableAnalysis
    }
    return analysis!
  } catch (err) {
    // Remove failed optimistic update
    analyses.value = analyses.value.filter(a => a.id !== tempId)
    error.value = handleApiError('create analysis', err)
    throw err
  } finally {
    loadingStates.value.creatingAnalysis = false
  }
}
```

### 6. State Synchronization Pattern

Keeping different parts of the state consistent:

```typescript
const syncAnalysisUpdate = (updatedAnalysis: Analysis): void => {
  // Update in analyses array
  const index = analyses.value.findIndex(a => a.id === updatedAnalysis.id)
  if (index !== -1) {
    analyses.value.splice(index, 1, structuredClone(updatedAnalysis))
  }
  
  // Sync currentAnalysis if it matches
  if (currentAnalysis.value?.id === updatedAnalysis.id) {
    currentAnalysis.value = structuredClone(updatedAnalysis)
  }
  
  // Trigger any dependent computations
  // (reactive system handles this automatically)
}

const updateAnalysis = async (params): Promise<Analysis> => {
  try {
    const updatedAnalysis = await dtAnalysis.updateAnalysis(params)
    
    // Use centralized sync helper
    syncAnalysisUpdate(updatedAnalysis!)
    return updatedAnalysis!
  } catch (err) {
    error.value = handleApiError('update analysis', err)
    throw err
  }
}
```

## Performance Optimizations

### 1. Cache Policies
- **Default Policy**: `'network-only'` for most operations to ensure fresh data
- **Selective Caching**: Apollo Client cache for frequently accessed reference data
- **TTL-based Refresh**: Time-based cache invalidation for static data

### 2. Request Optimization
- **Deduplication**: Prevent duplicate concurrent requests with configurable TTL
- **Mutex Protection**: Serialize critical operations to prevent race conditions
- **Batch Operations**: Where possible, batch multiple operations into single requests

### 3. Memory Management
- **Immutability**: Use `structuredClone()` to prevent accidental mutations
- **Cleanup**: Automatic cleanup of temporary state and pending operations
- **Garbage Collection**: Proper cleanup of event listeners and subscriptions

## Best Practices

### 1. Error Handling
- **Fail Fast**: Validate inputs early and throw meaningful errors
- **Preserve Context**: Always re-throw errors to maintain stack traces
- **User-Friendly Messages**: Convert technical errors to actionable user messages
- **Structured Logging**: Include context, timestamps, and error details

### 2. State Management
- **Single Source of Truth**: All state modifications go through store actions
- **Immutable Updates**: Never mutate state directly, always create new objects
- **Optimistic Updates**: Provide immediate feedback with rollback capabilities
- **Loading States**: Track operation progress for better UX

### 3. Code Organization
- **Separation of Concerns**: Clear boundaries between layers
- **Consistent Patterns**: Use the same patterns across all libraries/stores
- **Centralized Utilities**: Share common functionality through utility classes
- **Type Safety**: Leverage TypeScript for compile-time error detection

### 4. Testing Strategy
- **Unit Tests**: Test individual library methods and store actions
- **Integration Tests**: Test the interaction between layers
- **Error Scenarios**: Test error handling and recovery mechanisms
- **Performance Tests**: Validate retry logic, deduplication, and mutex behavior

### 5. Production Readiness
- **Error Recovery**: Graceful degradation when operations fail
- **Monitoring**: Structured logging for production debugging
- **Performance**: Optimized for browser environments with minimal overhead
- **Scalability**: Patterns that work well as the application grows

## Summary

This architecture provides:

1. **Clean Separation**: Clear responsibilities between UI, business logic, and data access
2. **Production Ready**: Built-in retry, deduplication, error handling, and concurrency control
3. **Maintainable**: Consistent patterns and centralized utilities
4. **Type Safe**: Full TypeScript support with proper error propagation
5. **User Focused**: Optimistic updates, proper loading states, and user-friendly error messages
6. **Browser Optimized**: Lightweight patterns suitable for client-side execution

The result is a robust, maintainable, and user-friendly application architecture that scales well and provides excellent developer experience.
