# Implementation Patterns & Code Examples

## Table of Contents
- [Library Layer Patterns](#library-layer-patterns)
- [Store Layer Patterns](#store-layer-patterns)
- [Error Handling Patterns](#error-handling-patterns)
- [Concurrency Patterns](#concurrency-patterns)
- [State Management Patterns](#state-management-patterns)
- [Testing Patterns](#testing-patterns)

## Library Layer Patterns

### 1. Standard Library Class Structure

Every dt-core library follows this consistent pattern:

```typescript
import { DtUtils } from '../dt-utils/dt-utils.js'
import { ApolloClient, NormalizedCacheObject } from '@apollo/client/core'
import { SomeType, AnotherType } from '../interfaces/core-types-interface.js'
import { GRAPHQL_QUERIES } from './library-gql.js'

export class DtSomeLibrary {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  // Query operations (READ)
  getSomething = async (params: QueryParams): Promise<SomeType[]> => {
    try {
      return await this.dtUtils.performQuery<{ items: SomeType[] }>({
        query: GET_SOMETHING_QUERY,
        variables: params,
        dataPath: 'items',
        action: 'getSomething',
        fetchPolicy: 'network-only'
      })
    } catch (error) {
      throw error // Error is already logged by dtUtils
    }
  }

  // Mutation operations (CREATE/UPDATE/DELETE)
  createSomething = async (params: CreateParams): Promise<SomeType> => {
    try {
      return await this.dtUtils.performMutation<{ createItems: { items: SomeType[] } }>({
        mutation: CREATE_SOMETHING_MUTATION,
        variables: { input: [params] },
        dataPath: 'createItems.items.0',
        action: 'createSomething',
        deduplicationKey: `create-something-${params.name}-${params.parentId || 'root'}`
      })
    } catch (error) {
      throw error
    }
  }
}
```

### 2. DtUtils Core Methods

The centralized utility class that all libraries use:

```typescript
export class DtUtils {
  private apolloClient: ApolloClient<NormalizedCacheObject>
  private mutex: Map<string, Promise<any>> = new Map()
  private requestDeduplicator = new Map<string, Promise<any>>()
  private requestMetadata = new Map<string, { timestamp: number; count: number }>()

  // Main query method with all optimizations
  async performQuery<T>(params: {
    query: any,
    variables?: object,
    dataPath?: string,
    action: string,
    fetchPolicy?: string
  }): Promise<T> {
    const mutexKey = `${params.action}-${JSON.stringify(params.variables || {})}`
    
    return this.withMutex(mutexKey, async () => {
      return this.retryNetworkOperation(async () => {
        const response = await this.apolloClient!.query({
          query: params.query,
          variables: params.variables,
          fetchPolicy: params.fetchPolicy as any || 'network-only'
        })

        let data: any = response?.data
        if (params.dataPath) {
          data = this.getValueFromPath({ obj: data, path: params.dataPath })
        }

        if (!data) {
          throw new Error(`No data returned for ${params.action}`)
        }

        return data as T
      })
    })
  }

  // Main mutation method with deduplication
  async performMutation<T>(params: {
    mutation: any,
    variables: object,
    dataPath?: string,
    action: string,
    deduplicationKey?: string | false
  }): Promise<T> {
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

  // Error handling with structured logging
  handleError({ action, error, context }: {
    action: string,
    error: Error,
    context?: any
  }): void {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      action,
      message: error.message,
      type: error.constructor.name,
      stack: error.stack,
      context
    }
    
    console.error(`Library error in ${action}:`, errorInfo)
    throw error // Re-throw for store layer
  }
}
```

### 3. GraphQL Query Organization

Each library has a separate GraphQL file:

```typescript
// dt-analysis-gql.ts
import { gql } from '@apollo/client/core'

export const FIND_ANALYSES = gql`
  query FindAnalyses(
    $analysisId: String
    $elementId: String
    $classType: String
    $moduleId: String
    $classId: String
  ) {
    analyses(
      where: {
        AND: [
          { id: $analysisId }
          { elementId: $elementId }
          { analysisClass: { 
            type: $classType
            module: { id: $moduleId }
            id: $classId
          }}
        ]
      }
    ) {
      id
      name
      description
      type
      category
      elementId
      createdAt
      updatedAt
      analysisClass {
        id
        name
        type
        category
        module {
          id
          name
        }
      }
    }
  }
`

export const CREATE_ANALYSIS = gql`
  mutation CreateAnalysis($input: [AnalysisCreateInput!]!) {
    createAnalyses(input: $input) {
      analyses {
        id
        name
        description
        type
        category
        elementId
        createdAt
        updatedAt
        analysisClass {
          id
          name
          type
          category
        }
      }
    }
  }
`
```

## Store Layer Patterns

### 1. Standard Store Structure

Every Pinia store follows this pattern:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import apolloClient from '@/plugins/apolloClient'
import { DtSomeLibrary, SomeType } from '@dethernety/dt-core'

export const useSomeStore = defineStore('some', () => {
  // 1. Reactive State
  const items = ref<SomeType[]>([])
  const currentItem = ref<SomeType | null>(null)
  const error = ref<string>('')
  const loadingStates = ref({
    fetchingItems: false,
    creatingItem: false,
    updatingItem: false,
    deletingItem: false
  })

  // 2. Computed State
  const isLoading = computed(() => 
    Object.values(loadingStates.value).some(loading => loading)
  )

  // 3. Library Dependencies
  const dtLibrary = new DtSomeLibrary(apolloClient)

  // 4. Utility Functions
  const resetStore = (): void => {
    items.value = []
    currentItem.value = null
    error.value = ''
    Object.keys(loadingStates.value).forEach(key => {
      loadingStates.value[key as keyof typeof loadingStates.value] = false
    })
  }

  const handleApiError = (operation: string, err?: any): string => {
    console.error(`${operation} failed:`, err)
    if (err?.message?.includes('401')) return 'Please log in again'
    if (err?.message?.includes('403')) return 'Access denied'
    if (err?.message?.includes('404')) return 'Resource not found'
    if (err?.message?.includes('network')) return 'Connection failed'
    return `Failed to ${operation}. Please try again.`
  }

  // 5. Query Operations
  const fetchItems = async (params?: QueryParams): Promise<SomeType[]> => {
    try {
      loadingStates.value.fetchingItems = true
      error.value = ''
      
      const result = await dtLibrary.getItems(params || {})
      items.value = result.map(item => structuredClone(item))
      return result
    } catch (err) {
      error.value = handleApiError('fetch items', err)
      throw err
    } finally {
      loadingStates.value.fetchingItems = false
    }
  }

  // 6. Mutation Operations with Optimistic Updates
  const createItem = async (params: CreateParams): Promise<SomeType> => {
    // Input validation
    const validationErrors = validateCreateInput(params)
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      throw new Error(validationErrors.join(', '))
    }

    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticItem = {
      ...params,
      id: tempId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pending: true
    } as SomeType & { pending: boolean }

    try {
      loadingStates.value.creatingItem = true
      error.value = ''
      
      items.value.push(optimisticItem)
      
      const createdItem = await dtLibrary.createItem(params)
      
      // Replace optimistic with real data
      const index = items.value.findIndex(item => item.id === tempId)
      if (index !== -1) {
        const mutableItem = structuredClone(createdItem)
        items.value.splice(index, 1, mutableItem)
        return mutableItem
      }
      return createdItem!
    } catch (err) {
      // Remove failed optimistic update
      items.value = items.value.filter(item => item.id !== tempId)
      error.value = handleApiError('create item', err)
      throw err
    } finally {
      loadingStates.value.creatingItem = false
    }
  }

  // 7. Validation Functions
  const validateCreateInput = (params: CreateParams): string[] => {
    const errors: string[] = []
    if (!params.name?.trim()) errors.push('Name is required')
    if (!params.description?.trim()) errors.push('Description is required')
    // Add more business-specific validation
    return errors
  }

  return {
    // State
    items, currentItem, error, loadingStates, isLoading,
    // Operations
    fetchItems, createItem, updateItem, deleteItem,
    // Utilities
    resetStore, handleApiError
  }
})
```

### 2. State Synchronization Pattern

For maintaining consistency across related state:

```typescript
const syncItemUpdate = (updatedItem: SomeType): void => {
  // Update in main array
  const index = items.value.findIndex(item => item.id === updatedItem.id)
  if (index !== -1) {
    items.value.splice(index, 1, structuredClone(updatedItem))
  }
  
  // Sync current item if it matches
  if (currentItem.value?.id === updatedItem.id) {
    currentItem.value = structuredClone(updatedItem)
  }
  
  // Update any related arrays (e.g., filtered lists)
  if (filteredItems.value.some(item => item.id === updatedItem.id)) {
    filteredItems.value = filteredItems.value.map(item =>
      item.id === updatedItem.id ? structuredClone(updatedItem) : item
    )
  }
}

const updateItem = async (params: UpdateParams): Promise<SomeType> => {
  try {
    const updatedItem = await dtLibrary.updateItem(params)
    syncItemUpdate(updatedItem!)
    return updatedItem!
  } catch (err) {
    error.value = handleApiError('update item', err)
    throw err
  }
}
```

## Error Handling Patterns

### 1. Library Layer: Technical Error Handling

```typescript
// In DtUtils
private isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase()
  const networkIndicators = [
    'network', 'timeout', 'connection', 'fetch',
    '502', '503', '504', 'bad gateway',
    'service unavailable', 'gateway timeout',
    'econnrefused', 'enotfound', 'etimedout'
  ]
  
  return networkIndicators.some(indicator => message.includes(indicator))
}

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
        // Log the final error
        this.handleError({
          action: 'retryNetworkOperation',
          error: error as Error,
          context: { attempt, maxRetries: config.maxRetries }
        })
        throw error
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        config.maxDelay
      )
      
      console.log(
        `Network error, retrying operation (attempt ${attempt + 1}/${config.maxRetries + 1}) after ${delay}ms:`,
        error.message
      )
      
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}
```

### 2. Store Layer: User-Friendly Error Classification

```typescript
const handleApiError = (operation: string, err?: any): string => {
  console.error(`${operation} failed:`, err)
  
  // Authentication errors
  if (err?.message?.includes('401') || err?.status === 401) {
    return 'Your session has expired. Please log in again to continue.'
  }
  
  // Authorization errors
  if (err?.message?.includes('403') || err?.status === 403) {
    return 'You do not have permission to perform this action. Please contact your administrator.'
  }
  
  // Not found errors
  if (err?.message?.includes('404') || err?.status === 404) {
    return 'The requested resource was not found. It may have been deleted or moved.'
  }
  
  // Network connectivity errors
  if (err?.message?.includes('network') || err?.code === 'NETWORK_ERROR') {
    return 'Connection failed. Please check your internet connection and try again.'
  }
  
  // Timeout errors
  if (err?.message?.includes('timeout')) {
    return 'The operation took too long to complete. Please try again.'
  }
  
  // Business logic errors (from backend validation)
  if (err?.message?.includes('duplicate')) {
    return 'An item with this name already exists. Please choose a different name.'
  }
  
  if (err?.message?.includes('invalid format')) {
    return 'The data format is invalid. Please check your input and try again.'
  }
  
  // Library-specific errors (no data returned)
  if (err?.message?.includes('No data returned')) {
    return `The ${operation} operation completed but returned no data. Please try again.`
  }
  
  // Generic fallback with operation context
  return `Failed to ${operation.toLowerCase()}. Please try again or contact support if the problem persists.`
}

// Usage in store operations
const createItem = async (params: CreateParams): Promise<SomeType> => {
  try {
    // ... operation logic
  } catch (err) {
    // Set user-friendly error message
    error.value = handleApiError('create item', err)
    
    // Still throw for component-level error handling
    throw err
  }
}
```

### 3. Component Layer: Error Display and Recovery

```typescript
// In Vue component
<template>
  <div>
    <!-- Error display -->
    <v-alert v-if="store.error" type="error" dismissible @click:close="clearError">
      {{ store.error }}
      <template #append>
        <v-btn size="small" @click="retryLastOperation">Retry</v-btn>
      </template>
    </v-alert>
    
    <!-- Loading states -->
    <v-progress-linear v-if="store.isLoading" indeterminate />
    
    <!-- Content -->
    <div v-if="!store.isLoading">
      <!-- Your content here -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSomeStore } from '@/stores/someStore'

const store = useSomeStore()
let lastFailedOperation: (() => Promise<void>) | null = null

const createItem = async (params: CreateParams) => {
  try {
    await store.createItem(params)
    // Success - maybe show a success message
    showSuccess('Item created successfully!')
  } catch (err) {
    // Error is already handled by store, just save for retry
    lastFailedOperation = () => createItem(params)
  }
}

const retryLastOperation = async () => {
  if (lastFailedOperation) {
    store.error = '' // Clear current error
    await lastFailedOperation()
  }
}

const clearError = () => {
  store.error = ''
  lastFailedOperation = null
}
</script>
```

## Concurrency Patterns

### 1. Mutex Protection

Prevents race conditions in critical operations:

```typescript
// In DtUtils
private mutex: Map<string, Promise<any>> = new Map()

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

// Usage example: Prevent concurrent updates to the same resource
const updateItem = async (itemId: string, params: UpdateParams): Promise<SomeType> => {
  const mutexKey = `update-item-${itemId}`
  
  return this.withMutex(mutexKey, async () => {
    // This operation is now protected from concurrent execution
    return await this.dtUtils.performMutation({
      mutation: UPDATE_ITEM_MUTATION,
      variables: { id: itemId, input: params },
      action: 'updateItem'
    })
  })
}
```

### 2. Request Deduplication

Prevents duplicate concurrent requests:

```typescript
// In DtUtils
private requestDeduplicator = new Map<string, Promise<any>>()
private requestMetadata = new Map<string, { timestamp: number; count: number }>()

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

// Usage: Deduplicate create operations
const createItem = async (params: CreateParams): Promise<SomeType> => {
  const deduplicationKey = `create-item-${params.name}-${params.parentId || 'root'}`
  
  return this.dtUtils.performMutation({
    mutation: CREATE_ITEM_MUTATION,
    variables: { input: [params] },
    action: 'createItem',
    deduplicationKey
  })
}
```

## State Management Patterns

### 1. Immutable State Updates

Always create new objects instead of mutating existing ones:

```typescript
// Avoid: Direct mutation
const updateItemName = (itemId: string, newName: string) => {
  const item = items.value.find(i => i.id === itemId)
  if (item) {
    item.name = newName // Direct mutation - avoid this
  }
}

// Preferred: Immutable update
const updateItemName = (itemId: string, newName: string) => {
  const index = items.value.findIndex(i => i.id === itemId)
  if (index !== -1) {
    const updatedItem = { ...items.value[index], name: newName }
    items.value.splice(index, 1, updatedItem)
  }
}

// Preferred: Using structuredClone for deep immutability
const updateItemName = (itemId: string, newName: string) => {
  const index = items.value.findIndex(i => i.id === itemId)
  if (index !== -1) {
    const updatedItem = structuredClone(items.value[index])
    updatedItem.name = newName
    items.value.splice(index, 1, updatedItem)
  }
}
```

### 2. Optimistic Updates with Rollback

Provide immediate feedback with the ability to rollback on failure:

```typescript
const updateItem = async (itemId: string, params: UpdateParams): Promise<SomeType> => {
  // Store original state for rollback
  const originalIndex = items.value.findIndex(item => item.id === itemId)
  if (originalIndex === -1) {
    throw new Error('Item not found')
  }
  
  const originalItem = structuredClone(items.value[originalIndex])
  
  // Apply optimistic update
  const optimisticItem = { ...originalItem, ...params, pending: true }
  items.value.splice(originalIndex, 1, optimisticItem)

  try {
    loadingStates.value.updatingItem = true
    error.value = ''
    
    const updatedItem = await dtLibrary.updateItem(itemId, params)
    
    // Replace optimistic with real data
    const currentIndex = items.value.findIndex(item => item.id === itemId)
    if (currentIndex !== -1) {
      const mutableItem = structuredClone(updatedItem)
      delete (mutableItem as any).pending
      items.value.splice(currentIndex, 1, mutableItem)
      
      // Sync related state
      syncItemUpdate(mutableItem)
    }
    
    return updatedItem!
  } catch (err) {
    // Rollback optimistic update
    const currentIndex = items.value.findIndex(item => item.id === itemId)
    if (currentIndex !== -1) {
      items.value.splice(currentIndex, 1, originalItem)
    }
    
    error.value = handleApiError('update item', err)
    throw err
  } finally {
    loadingStates.value.updatingItem = false
  }
}
```

### 3. Computed State Management

Use computed properties for derived state:

```typescript
// Computed properties for filtered/sorted data
const filteredItems = computed(() => {
  if (!searchQuery.value.trim()) return items.value
  
  const query = searchQuery.value.toLowerCase()
  return items.value.filter(item =>
    item.name.toLowerCase().includes(query) ||
    item.description?.toLowerCase().includes(query)
  )
})

const sortedItems = computed(() => {
  return [...filteredItems.value].sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'created':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'updated':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      default:
        return 0
    }
  })
})

// Loading state aggregation
const isLoading = computed(() =>
  Object.values(loadingStates.value).some(loading => loading)
)

const hasErrors = computed(() => Boolean(error.value))

// Statistics
const itemStats = computed(() => ({
  total: items.value.length,
  pending: items.value.filter(item => (item as any).pending).length,
  completed: items.value.filter(item => !(item as any).pending).length
}))
```

## Testing Patterns

### 1. Library Layer Testing

```typescript
// dt-analysis.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DtAnalysis } from '../dt-analysis'
import { mockApolloClient } from '../__mocks__/apollo-client'

describe('DtAnalysis', () => {
  let dtAnalysis: DtAnalysis
  let mockClient: any

  beforeEach(() => {
    mockClient = mockApolloClient()
    dtAnalysis = new DtAnalysis(mockClient)
  })

  describe('findAnalysisClasses', () => {
    it('should return analysis classes when found', async () => {
      const mockClasses = [
        { id: '1', name: 'Test Class', type: 'security' }
      ]
      
      mockClient.query.mockResolvedValue({
        data: { analysisClasses: mockClasses }
      })

      const result = await dtAnalysis.findAnalysisClasses({
        classType: 'security'
      })

      expect(result).toEqual(mockClasses)
      expect(mockClient.query).toHaveBeenCalledWith({
        query: expect.any(Object),
        variables: { classType: 'security' },
        fetchPolicy: 'network-only'
      })
    })

    it('should throw error when no data returned', async () => {
      mockClient.query.mockResolvedValue({ data: null })

      await expect(
        dtAnalysis.findAnalysisClasses({ classType: 'security' })
      ).rejects.toThrow('No data returned')
    })

    it('should retry on network errors', async () => {
      mockClient.query
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValue({
          data: { analysisClasses: [] }
        })

      const result = await dtAnalysis.findAnalysisClasses({
        classType: 'security'
      })

      expect(result).toEqual([])
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })
})
```

### 2. Store Layer Testing

```typescript
// analysisStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAnalysisStore } from '../analysisStore'

// Mock the dt-core library
vi.mock('@dethernety/dt-core', () => ({
  DtAnalysis: vi.fn().mockImplementation(() => ({
    findAnalysisClasses: vi.fn(),
    createAnalysis: vi.fn(),
    updateAnalysis: vi.fn(),
    deleteAnalysis: vi.fn()
  }))
}))

describe('useAnalysisStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('fetchAnalysisClasses', () => {
    it('should fetch and store analysis classes', async () => {
      const store = useAnalysisStore()
      const mockClasses = [
        { id: '1', name: 'Test Class', type: 'security' }
      ]

      // Mock the library method
      const mockDtAnalysis = store.dtAnalysis as any
      mockDtAnalysis.findAnalysisClasses.mockResolvedValue(mockClasses)

      const result = await store.fetchAnalysisClasses({
        classType: 'security'
      })

      expect(result).toEqual(mockClasses)
      expect(store.analysisClasses).toEqual(mockClasses)
      expect(store.error).toBe('')
    })

    it('should handle errors and set error message', async () => {
      const store = useAnalysisStore()
      const mockError = new Error('Network failed')

      const mockDtAnalysis = store.dtAnalysis as any
      mockDtAnalysis.findAnalysisClasses.mockRejectedValue(mockError)

      await expect(
        store.fetchAnalysisClasses({ classType: 'security' })
      ).rejects.toThrow('Network failed')

      expect(store.error).toContain('Connection failed')
    })
  })

  describe('createAnalysis', () => {
    it('should perform optimistic update and rollback on failure', async () => {
      const store = useAnalysisStore()
      const mockError = new Error('Creation failed')
      const params = {
        elementId: 'element1',
        name: 'Test Analysis',
        description: 'Test Description',
        analysisClassId: 'class1'
      }

      const mockDtAnalysis = store.dtAnalysis as any
      mockDtAnalysis.createAnalysis.mockRejectedValue(mockError)

      // Store should be empty initially
      expect(store.analyses).toHaveLength(0)

      try {
        await store.createAnalysis(params)
      } catch (err) {
        // Expected to throw
      }

      // Optimistic update should be rolled back
      expect(store.analyses).toHaveLength(0)
      expect(store.error).toContain('create analysis')
    })
  })
})
```

### 3. Integration Testing

```typescript
// integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAnalysisStore } from '../stores/analysisStore'
import { setupTestServer } from '../__mocks__/server'

describe('Store-Library Integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupTestServer()
  })

  it('should handle complete create analysis workflow', async () => {
    const store = useAnalysisStore()
    
    // 1. Fetch analysis classes
    const classes = await store.fetchAnalysisClasses({
      classType: 'security'
    })
    expect(classes).toHaveLength(1)
    
    // 2. Create analysis using fetched class
    const analysis = await store.createAnalysis({
      elementId: 'element1',
      name: 'Security Analysis',
      description: 'Test security analysis',
      analysisClassId: classes[0].id
    })
    
    expect(analysis.id).toBeDefined()
    expect(store.analyses).toHaveLength(1)
    expect(store.analyses[0].id).toBe(analysis.id)
    
    // 3. Update the analysis
    const updatedAnalysis = await store.updateAnalysis({
      analysisId: analysis.id,
      name: 'Updated Security Analysis',
      description: 'Updated description'
    })
    
    expect(updatedAnalysis.name).toBe('Updated Security Analysis')
    expect(store.analyses[0].name).toBe('Updated Security Analysis')
    
    // 4. Delete the analysis
    const deleted = await store.deleteAnalysis({
      analysisId: analysis.id
    })
    
    expect(deleted).toBe(true)
    expect(store.analyses).toHaveLength(0)
  })
})
```

