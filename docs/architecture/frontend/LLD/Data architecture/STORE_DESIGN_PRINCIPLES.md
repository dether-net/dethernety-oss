# Pinia Store Design Principles & Patterns

## Overview

This document outlines the design principles, patterns, and best practices for Pinia stores in the Dethernety frontend. These guidelines ensure consistency, maintainability, type safety, and reliability across all store implementations.

## Table of Contents

1. [Core Architecture Patterns](#core-architecture-patterns)
2. [Complexity Guidelines](#complexity-guidelines)
3. [Type Safety Requirements](#type-safety-requirements)
4. [Configuration & Flexibility](#configuration--flexibility)
5. [State Management Patterns](#state-management-patterns)
6. [External Library Integration](#external-library-integration)
7. [Store Composition & Cross-Store Patterns](#store-composition--cross-store-patterns)
8. [Error Handling Standards](#error-handling-standards)
9. [Async Operations & Race Conditions](#async-operations--race-conditions)
10. [Performance & Bundle Size Considerations](#performance--bundle-size-considerations)
11. [Vue Reactivity Optimization](#vue-reactivity-optimization)
12. [Logging & Debugging](#logging--debugging)
13. [Testing Considerations](#testing-considerations)
14. [Documentation Standards](#documentation-standards)

---

## Core Architecture Patterns

### 1. Store Structure Template

```typescript
// 1. Interfaces and Types (at top)
interface StoreConfig {
  // Configuration options
}

interface StoreState {
  // State shape definition
}

// 2. Constants and Defaults
const DEFAULT_CONFIG: Required<StoreConfig> = {
  // Default configuration
}

// 3. Utility Functions (pure, testable)
const utilityFunction = (param: Type): ReturnType => {
  // Pure utility logic
}

// 4. Store Factory Function
const createStore = (config: StoreConfig = {}) => {
  const storeConfig = { ...DEFAULT_CONFIG, ...config }
  
  return defineStore('storeName', () => {
    // State, computed, actions
  }, { persist: true })
}

// 5. Default Export
export const useStoreName = createStore()
```

### 2. Separation of Concerns

**State Management Layer:**
- Raw reactive state
- Computed properties
- Basic getters/setters

**Business Logic Layer:**
- Complex operations
- API interactions
- Data transformations

**Utility Layer:**
- Pure functions
- Reusable helpers
- Configuration utilities

---

## Complexity Guidelines

### When to Use Different Pattern Levels

Not every store needs the full pattern suite. Choose complexity based on your store's requirements:

#### **Simple Pattern (UI State, Flags, Basic Data)**
```typescript
// Preferred: Simple store for UI state
export const useUIStore = defineStore('ui', () => {
  const sidebarOpen = ref(false)
  const theme = ref<'light' | 'dark'>('light')
  const notifications = ref<Notification[]>([])
  
  const toggleSidebar = () => {
    sidebarOpen.value = !sidebarOpen.value
  }
  
  const addNotification = (notification: Notification) => {
    notifications.value.push(notification)
  }
  
  return {
    sidebarOpen, theme, notifications,
    toggleSidebar, addNotification
  }
}, { persist: true })

// No need for: factory functions, dependency injection, complex error handling
```

#### **Intermediate Pattern (API Integration, Business Logic)**
```typescript
// Preferred: Store with API integration and moderate complexity
export const useProductStore = defineStore('products', () => {
  const products = ref<Product[]>([])
  const isLoading = ref(false)
  const error = ref('')
  
  // Simple error handling
  const handleError = (err: Error) => {
    error.value = err.message
    isLoading.value = false
  }
  
  const fetchProducts = async () => {
    try {
      isLoading.value = true
      error.value = ''
      const response = await api.get('/products')
      products.value = response.data
    } catch (err) {
      handleError(err as Error)
    } finally {
      isLoading.value = false
    }
  }
  
  return { products, isLoading, error, fetchProducts }
})

// Add: basic error handling, loading states
// Skip: factory functions, complex retry logic, dependency injection
```

#### **Advanced Pattern (Critical Systems, External Dependencies)**
```typescript
// Preferred: Full pattern for critical authentication store
const createAuthStore = (config: AuthConfig = {}) => {
  const authConfig = { ...DEFAULT_CONFIG, ...config }
  
  return defineStore('auth', () => {
    // Full pattern implementation with:
    // - Dependency injection
    // - Promise-based mutex
    // - Error handling
    // - Retry logic with backoff
    // - Extensive logging
    // - Automatic cleanup
    // - Configuration flexibility
  })
}

// Use for: authentication, payment processing, critical business logic
```

### **Decision Matrix**

| Store Type | Simple | Intermediate | Advanced |
|------------|--------|-------------|------------|
| UI State | Yes | -- | -- |
| Local Data Cache | Yes | Yes | -- |
| API Integration | -- | Yes | Yes |
| External Services | -- | -- | Yes |
| Critical Business Logic | -- | -- | Yes |
| Multi-Environment | -- | Yes | Yes |
| High Concurrency | -- | -- | Yes |

### **Pattern Upgrade Path**

Start simple and upgrade as requirements grow:

```typescript
// Stage 1: Simple store
const useStore = defineStore('store', () => { /* basic logic */ })

// Stage 2: Add configuration when needed
const useStore = (config = {}) => {
  const storeConfig = { ...defaults, ...config }
  return defineStore('store', () => { /* enhanced logic */ })
}

// Stage 3: Full pattern when requirements demand it
const createStore = (config: StoreConfig = {}) => {
  // Full implementation with DI, retry, logging, etc.
}
```

---

## Type Safety Requirements

### 1. Interface Definitions

```typescript
// Preferred: Complete type definitions
interface User {
  id: string
  email: string
  name: string
}

interface ApiResponse<T> {
  data: T
  status: number
  message?: string
}

// Avoid: Using 'any' or incomplete types
const user = ref<any>({})
```

### 2. Generic Constraints

```typescript
// Preferred: Proper generic constraints
const processApiResponse = <T>(response: ApiResponse<T>): T => {
  return response.data
}

// Avoid: Unconstrained generics
const processData = <T>(data: any): T => {
  return data as T
}
```

### 3. Return Type Annotations

```typescript
// Preferred: Explicit return types
const fetchData = async (): Promise<User[]> => {
  // Implementation
}

// Avoid: Inferred return types for public methods
const fetchData = async () => {
  // Implementation - return type unclear
}
```

---

## Configuration & Flexibility

### 1. Configuration Interface Pattern

```typescript
interface StoreConfig {
  // Optional overrides with sensible defaults
  apiTimeout?: number
  retryAttempts?: number
  enableLogging?: boolean
  customEndpoints?: Record<string, string>
}

const DEFAULT_CONFIG: Required<StoreConfig> = {
  apiTimeout: 5000,
  retryAttempts: 3,
  enableLogging: import.meta.env.DEV,
  customEndpoints: {}
}
```

### 2. Environment-Aware Defaults

```typescript
const DEFAULT_CONFIG: Required<StoreConfig> = {
  enableLogging: import.meta.env.DEV,
  apiTimeout: import.meta.env.PROD ? 10000 : 5000,
  retryAttempts: import.meta.env.PROD ? 3 : 1
}
```

### 3. Provider-Agnostic Design

```typescript
// Preferred: Configurable data extraction
const createDataExtractor = (config: StoreConfig) => {
  return (rawData: unknown): ProcessedData => {
    const fieldPath = config.dataFieldPath || 'data'
    return extractNestedField(rawData, fieldPath)
  }
}

// Avoid: Hard-coded provider-specific logic
const extractData = (rawData: any) => {
  return rawData.specificProvider.data.field
}
```

---

## State Management Patterns

### 1. State Organization

```typescript
// Preferred: Logical state grouping
const useStore = defineStore('store', () => {
  // Core Data State
  const items = ref<Item[]>([])
  const selectedItem = ref<Item | null>(null)
  
  // UI State
  const isLoading = ref(false)
  const error = ref('')
  
  // Cache State
  const lastFetch = ref(0)
  const cacheTimeout = ref(5 * 60 * 1000)
  
  // Computed Properties
  const hasItems = computed(() => items.value.length > 0)
  const isStale = computed(() => Date.now() - lastFetch.value > cacheTimeout.value)
  
  return {
    // Group exports logically
    // Core Data
    items, selectedItem, hasItems,
    // UI State  
    isLoading, error,
    // Cache
    isStale,
    // Actions
    fetchItems, selectItem, clearError
  }
})
```

### 2. Computed Property Patterns

```typescript
// Preferred: Meaningful computed properties
const filteredItems = computed(() => 
  items.value.filter(item => item.status === 'active')
)

const sortedItems = computed(() => 
  [...items.value].sort((a, b) => a.createdAt - b.createdAt)
)

// Avoid: Complex logic in computed
const complexComputed = computed(() => {
  // 50 lines of complex logic
  // Should be extracted to helper functions
})
```

### 3. State Reset Patterns

```typescript
// Preferred: Full state reset
const resetState = (): void => {
  items.value = []
  selectedItem.value = null
  error.value = ''
  isLoading.value = false
  
  // Clear any timers/intervals
  clearPendingOperations()
  
  // Reset any promises/mutexes
  clearAsyncState()
}
```

---

## External Library Integration

### 1. Interface Abstraction Strategy

When integrating external libraries, decide between abstraction and direct usage based on criticality and complexity.

#### **When to Abstract External Libraries**

```typescript
// Preferred: Abstract critical dependencies
interface DataClient {
  query<T>(query: string, variables?: Record<string, any>): Promise<T>
  mutate<T>(mutation: string, variables?: Record<string, any>): Promise<T>
  subscribe<T>(subscription: string, variables?: Record<string, any>): Observable<T>
}

// Wrapper for Apollo Client
class ApolloDataClient implements DataClient {
  constructor(private client: ApolloClient<any>) {}
  
  async query<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const result = await this.client.query({ 
      query: gql(query), 
      variables,
      errorPolicy: 'all'
    })
    
    if (result.errors?.length) {
      throw new Error(result.errors[0].message)
    }
    
    return result.data
  }
  
  async mutate<T>(mutation: string, variables?: Record<string, any>): Promise<T> {
    const result = await this.client.mutate({ 
      mutation: gql(mutation), 
      variables 
    })
    return result.data
  }
  
  subscribe<T>(subscription: string, variables?: Record<string, any>): Observable<T> {
    return this.client.subscribe({ 
      query: gql(subscription), 
      variables 
    }).map(result => result.data)
  }
}

// Store uses abstraction
const createAnalysisStore = (dataClient: DataClient) => {
  return defineStore('analysis', () => {
    const analyses = ref<Analysis[]>([])
    
    const fetchAnalyses = async (filters: AnalysisFilters) => {
      const query = `
        query GetAnalyses($filters: AnalysisFilters) {
          analyses(filters: $filters) { id name description }
        }
      `
      const result = await dataClient.query<{ analyses: Analysis[] }>(query, { filters })
      analyses.value = result.analyses
    }
    
    return { analyses, fetchAnalyses }
  })
}
```

#### **When to Use Libraries Directly**

```typescript
// Preferred: Direct usage for simple, stable utilities
import { format, parseISO } from 'date-fns'
import { debounce } from 'lodash-es'

export const useUtilityStore = defineStore('utility', () => {
  const formatDate = (dateString: string) => {
    return format(parseISO(dateString), 'MMM dd, yyyy')
  }
  
  const debouncedSearch = debounce((query: string) => {
    // Search implementation
  }, 300)
  
  return { formatDate, debouncedSearch }
})

// No abstraction needed for:
// - Simple, stable utilities (date-fns, lodash)
// - Framework-native libraries (Vue Router)
// - Libraries with stable, simple APIs
```

### 2. Dependency Injection Pattern

```typescript
// Preferred: Explicit dependency injection
interface StoreDependencies {
  graphqlClient: DataClient
  httpClient: HttpClient
  logger: Logger
  cache: CacheProvider
  eventBus: EventBus
}

interface StoreConfig {
  // External service configuration
  externalServices?: {
    graphql?: {
      endpoint: string
      headers?: Record<string, string>
      timeout?: number
    }
    api?: {
      baseUrl: string
      timeout: number
      retryAttempts: number
    }
    cache?: {
      ttl: number
      maxSize: number
    }
  }
  
  // Feature flags
  features?: {
    enableRealTimeUpdates?: boolean
    enableOfflineMode?: boolean
    enableAnalytics?: boolean
  }
}

const createStoreDependencies = (config: StoreConfig): StoreDependencies => {
  const apolloClient = new ApolloClient({
    uri: config.externalServices?.graphql?.endpoint,
    headers: config.externalServices?.graphql?.headers,
    defaultOptions: {
      watchQuery: { errorPolicy: 'all' },
      query: { errorPolicy: 'all' }
    }
  })
  
  return {
    graphqlClient: new ApolloDataClient(apolloClient),
    httpClient: createHttpClient(config.externalServices?.api),
    logger: createLogger(config),
    cache: createCacheProvider(config.externalServices?.cache),
    eventBus: createEventBus()
  }
}

const createAnalysisStore = (deps: StoreDependencies, config: StoreConfig) => {
  return defineStore('analysis', () => {
    // Store implementation using dependencies
    const runAnalysis = async (analysisId: string) => {
      try {
        const result = await deps.graphqlClient.mutate(
          'mutation RunAnalysis($id: ID!) { runAnalysis(id: $id) { sessionId } }',
          { id: analysisId }
        )
        
        if (config.features?.enableRealTimeUpdates) {
          // Subscribe to real-time updates
          const subscription = deps.graphqlClient.subscribe(
            'subscription AnalysisUpdates($sessionId: ID!) { analysisUpdates(sessionId: $sessionId) { status progress } }'
          )
          // Handle subscription...
        }
        
        return result
      } catch (error) {
        deps.logger.error('Analysis execution failed', error)
        throw error
      }
    }
    
    return { runAnalysis }
  })
}

// Usage
const config: StoreConfig = {
  externalServices: {
    graphql: { endpoint: '/graphql' },
    api: { baseUrl: '/api', timeout: 5000 }
  },
  features: {
    enableRealTimeUpdates: true
  }
}

const deps = createStoreDependencies(config)
export const useAnalysisStore = createAnalysisStore(deps, config)
```

### 3. Library-Specific Patterns

#### **GraphQL Integration (Apollo Client)**

```typescript
// Preferred: Structured GraphQL integration
const createGraphQLStore = (client: ApolloClient<any>) => {
  return defineStore('graphql', () => {
    const loading = ref(false)
    const error = ref<string | null>(null)
    
    const executeQuery = async <T>(
      query: DocumentNode,
      variables?: Record<string, any>,
      options?: QueryOptions
    ): Promise<T> => {
      try {
        loading.value = true
        error.value = null
        
        const result = await client.query({
          query,
          variables,
          errorPolicy: 'all',
          fetchPolicy: options?.cache ? 'cache-first' : 'network-only',
          ...options
        })
        
        if (result.errors?.length) {
          throw new Error(result.errors[0].message)
        }
        
        return result.data
      } catch (err) {
        error.value = (err as Error).message
        throw err
      } finally {
        loading.value = false
      }
    }
    
    const executeMutation = async <T>(
      mutation: DocumentNode,
      variables?: Record<string, any>
    ): Promise<T> => {
      const result = await client.mutate({
        mutation,
        variables,
        errorPolicy: 'all'
      })
      
      if (result.errors?.length) {
        throw new Error(result.errors[0].message)
      }
      
      return result.data
    }
    
    return { loading, error, executeQuery, executeMutation }
  })
}
```

#### **HTTP Client Integration (Axios/Fetch)**

```typescript
// Preferred: HTTP client abstraction
interface HttpClient {
  get<T>(url: string, config?: RequestConfig): Promise<T>
  post<T>(url: string, data?: any, config?: RequestConfig): Promise<T>
  put<T>(url: string, data?: any, config?: RequestConfig): Promise<T>
  delete<T>(url: string, config?: RequestConfig): Promise<T>
}

class AxiosHttpClient implements HttpClient {
  constructor(private axios: AxiosInstance) {}
  
  async get<T>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.axios.get(url, config)
    return response.data
  }
  
  // ... other methods
}

// Store usage
const createApiStore = (httpClient: HttpClient) => {
  return defineStore('api', () => {
    const fetchData = async <T>(endpoint: string): Promise<T> => {
      return httpClient.get<T>(endpoint)
    }
    
    return { fetchData }
  })
}
```

### 4. External Library Error Handling

```typescript
// Preferred: Library-specific error handling
const handleGraphQLError = (error: ApolloError): string => {
  if (error.networkError) {
    return 'Network connection failed. Please check your internet connection.'
  }
  
  if (error.graphQLErrors?.length) {
    const graphQLError = error.graphQLErrors[0]
    
    if (graphQLError.extensions?.code === 'UNAUTHENTICATED') {
      return 'Session expired. Please log in again.'
    }
    
    if (graphQLError.extensions?.code === 'FORBIDDEN') {
      return 'You do not have permission to perform this action.'
    }
    
    return graphQLError.message
  }
  
  return 'An unexpected error occurred. Please try again.'
}

const handleHttpError = (error: AxiosError): string => {
  if (error.code === 'NETWORK_ERROR') {
    return 'Network error. Please check your connection.'
  }
  
  if (error.response?.status === 429) {
    return 'Too many requests. Please wait a moment before trying again.'
  }
  
  if (error.response?.status === 401) {
    return 'Authentication required. Please log in.'
  }
  
  return error.response?.data?.message || 'Request failed. Please try again.'
}
```

### 5. Bundle Size Considerations

```typescript
// Preferred: Conditional imports and tree shaking
const createOptionalFeatures = (config: StoreConfig) => {
  const features: any = {}
  
  // Only import analytics if enabled
  if (config.features?.enableAnalytics) {
    features.analytics = import('./analytics').then(m => m.createAnalytics())
  }
  
  // Only import real-time features if needed
  if (config.features?.enableRealTimeUpdates) {
    features.realtime = import('./realtime').then(m => m.createRealtime())
  }
  
  return features
}

// Preferred: Lazy loading of heavy dependencies
const useLargeLibrary = async () => {
  const { heavyLibrary } = await import('heavy-library')
  return heavyLibrary
}

// Avoid: Always importing heavy libraries
import { heavyLibrary } from 'heavy-library' // Always bundled
```

---

## Store Composition & Cross-Store Patterns

### 1. Store Dependency Management

```typescript
// Preferred: Explicit dependency declaration
const useOrderStore = defineStore('orders', () => {
  // Declare store dependencies at the top
  const userStore = useUserStore()
  const inventoryStore = useInventoryStore()
  const paymentStore = usePaymentStore()
  
  const orders = ref<Order[]>([])
  
  const createOrder = async (orderData: CreateOrderRequest) => {
    // Validate user is authenticated
    if (!userStore.isAuthenticated) {
      throw new Error('Authentication required')
    }
    
    // Check inventory availability
    const available = await inventoryStore.checkAvailability(orderData.items)
    if (!available) {
      throw new Error('Some items are out of stock')
    }
    
    // Process payment
    const paymentResult = await paymentStore.processPayment(orderData.payment)
    
    // Create order
    const order = await api.createOrder({
      ...orderData,
      userId: userStore.currentUser.id,
      paymentId: paymentResult.id
    })
    
    // Update inventory
    await inventoryStore.reserveItems(orderData.items)
    
    orders.value.push(order)
    return order
  }
  
  return { orders, createOrder }
})

// Avoid: Accessing stores inside functions without declaration
const useOrderStore = defineStore('orders', () => {
  const createOrder = async (orderData: CreateOrderRequest) => {
    const userStore = useUserStore() // Hidden dependency
    const inventoryStore = useInventoryStore() // Hard to track
    // ...
  }
})
```

### 2. Event-Driven Communication

```typescript
// Preferred: Event bus for loose coupling
interface StoreEvents {
  'user:login': { userId: string; timestamp: number }
  'user:logout': { userId: string; reason: string }
  'order:created': { orderId: string; userId: string; total: number }
  'inventory:updated': { productId: string; quantity: number }
}

const eventBus = createEventBus<StoreEvents>()

// User store emits events
const useUserStore = defineStore('user', () => {
  const login = async (credentials: LoginCredentials) => {
    const user = await authService.login(credentials)
    currentUser.value = user
    
    // Emit event instead of directly calling other stores
    eventBus.emit('user:login', {
      userId: user.id,
      timestamp: Date.now()
    })
  }
  
  return { login }
})

// Order store listens to events
const useOrderStore = defineStore('orders', () => {
  const userOrders = ref<Order[]>([])
  
  // Listen to user events
  eventBus.on('user:login', ({ userId }) => {
    loadUserOrders(userId)
  })
  
  eventBus.on('user:logout', () => {
    userOrders.value = []
  })
  
  return { userOrders }
})

// Analytics store listens to multiple events
const useAnalyticsStore = defineStore('analytics', () => {
  eventBus.on('user:login', (data) => {
    trackEvent('user_login', data)
  })
  
  eventBus.on('order:created', (data) => {
    trackEvent('order_created', data)
  })
  
  return {}
})
```

### 3. Shared State Patterns

```typescript
// Preferred: Shared computed state
const useSharedComputations = () => {
  const userStore = useUserStore()
  const orderStore = useOrderStore()
  const inventoryStore = useInventoryStore()
  
  // Computed properties that depend on multiple stores
  const userOrderSummary = computed(() => ({
    totalOrders: orderStore.userOrders.length,
    totalSpent: orderStore.userOrders.reduce((sum, order) => sum + order.total, 0),
    favoriteProducts: orderStore.getMostOrderedProducts(5)
  }))
  
  const availableProductsForUser = computed(() => {
    const userRegion = userStore.currentUser?.region
    return inventoryStore.products.filter(product => 
      product.availableInRegions.includes(userRegion) && 
      product.quantity > 0
    )
  })
  
  return {
    userOrderSummary,
    availableProductsForUser
  }
}

// Usage in components
const { userOrderSummary } = useSharedComputations()
```

### 4. Store Composition Patterns

```typescript
// Preferred: Composable store features
const createCacheFeature = <T>(keyPrefix: string) => {
  const cache = ref(new Map<string, { data: T; timestamp: number }>())
  
  const get = (key: string): T | null => {
    const cached = cache.value.get(`${keyPrefix}:${key}`)
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes
      return cached.data
    }
    return null
  }
  
  const set = (key: string, data: T): void => {
    cache.value.set(`${keyPrefix}:${key}`, {
      data,
      timestamp: Date.now()
    })
  }
  
  const clear = (): void => {
    cache.value.clear()
  }
  
  return { get, set, clear }
}

const createLoadingFeature = () => {
  const loadingStates = ref(new Map<string, boolean>())
  
  const setLoading = (key: string, loading: boolean): void => {
    loadingStates.value.set(key, loading)
  }
  
  const isLoading = (key: string): boolean => {
    return loadingStates.value.get(key) || false
  }
  
  const withLoading = async <T>(
    key: string, 
    operation: () => Promise<T>
  ): Promise<T> => {
    try {
      setLoading(key, true)
      return await operation()
    } finally {
      setLoading(key, false)
    }
  }
  
  return { setLoading, isLoading, withLoading }
}

// Compose features into stores
const useProductStore = defineStore('products', () => {
  const products = ref<Product[]>([])
  
  // Compose features
  const cache = createCacheFeature<Product[]>('products')
  const loading = createLoadingFeature()
  
  const fetchProducts = async (filters: ProductFilters) => {
    const cacheKey = JSON.stringify(filters)
    
    // Try cache first
    const cached = cache.get(cacheKey)
    if (cached) {
      products.value = cached
      return cached
    }
    
    // Fetch with loading state
    const result = await loading.withLoading('fetch-products', async () => {
      return api.getProducts(filters)
    })
    
    // Cache result
    cache.set(cacheKey, result)
    products.value = result
    
    return result
  }
  
  return {
    products,
    fetchProducts,
    isLoadingProducts: computed(() => loading.isLoading('fetch-products'))
  }
})
```

### 5. Cross-Store Validation

```typescript
// Preferred: Cross-store business rule validation
const useBusinessRules = () => {
  const userStore = useUserStore()
  const orderStore = useOrderStore()
  const inventoryStore = useInventoryStore()
  
  const validateOrderCreation = (orderData: CreateOrderRequest): ValidationResult => {
    const errors: string[] = []
    
    // User validation
    if (!userStore.isAuthenticated) {
      errors.push('User must be authenticated')
    }
    
    if (userStore.currentUser?.status === 'suspended') {
      errors.push('Account is suspended')
    }
    
    // Order validation
    const dailyOrderLimit = userStore.currentUser?.tier === 'premium' ? 50 : 10
    const todaysOrders = orderStore.getTodaysOrderCount()
    
    if (todaysOrders >= dailyOrderLimit) {
      errors.push(`Daily order limit (${dailyOrderLimit}) exceeded`)
    }
    
    // Inventory validation
    for (const item of orderData.items) {
      const product = inventoryStore.getProduct(item.productId)
      if (!product || product.quantity < item.quantity) {
        errors.push(`Insufficient inventory for ${product?.name || item.productId}`)
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    }
  }
  
  return { validateOrderCreation }
}
```

---

## Error Handling Standards

### 1. Error Classification System

```typescript
// Error message constants
const ERROR_MESSAGES = {
  // User-facing messages
  NETWORK_ERROR: 'Network error. Please check your connection.',
  VALIDATION_ERROR: 'Invalid data. Please check your input.',
  PERMISSION_ERROR: 'You do not have permission to perform this action.',
  
  // Technical error categories
  API_ERROR: 'API request failed',
  CONFIG_ERROR: 'Configuration error detected'
} as const

// Error classification function
const classifyError = (error: Error, context: string): string => {
  const message = error.message.toLowerCase()
  
  if (message.includes('network') || message.includes('fetch')) {
    return ERROR_MESSAGES.NETWORK_ERROR
  }
  
  if (message.includes('validation') || message.includes('invalid')) {
    return ERROR_MESSAGES.VALIDATION_ERROR
  }
  
  // Context-specific fallbacks
  return getContextualError(context)
}
```

### 2. Error State Management

```typescript
// Preferred: Structured error handling
const handleError = (error: Error, context: string): void => {
  const userMessage = classifyError(error, context)
  
  // Update UI state
  setErrorState(userMessage)
  
  // Log technical details (development only)
  debugLog(config, `${context} error:`, error.message)
  
  // Clear loading states
  isLoading.value = false
  
  // Trigger error recovery if applicable
  scheduleRetryIfApplicable(context, error)
}

// Avoid: Generic error handling
const handleError = (error: any) => {
  console.error(error)
  errorMessage.value = error.message || 'Something went wrong'
}
```

### 3. Retry Logic Pattern

```typescript
const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  baseDelay: number,
  context: string
): Promise<T> => {
  let lastError: Error
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      // Don't retry certain error types
      if (isNonRetryableError(error)) {
        throw error
      }
      
      if (attempt === maxAttempts) {
        throw new Error(`${context} failed after ${maxAttempts} attempts`)
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}
```

---

## Async Operations & Race Conditions

### 1. Promise-Based Mutex Pattern

```typescript
// Preferred: Promise-based concurrency control
let operationPromise: Promise<void> | null = null

const performOperation = async (): Promise<void> => {
  // Return existing promise if operation in progress
  if (operationPromise) {
    return operationPromise
  }
  
  // Start new operation
  operationPromise = doActualOperation()
  
  try {
    await operationPromise
  } finally {
    operationPromise = null
  }
}

// Avoid: Boolean-based mutex (race conditions possible)
let operationInProgress = false

const performOperation = async (): Promise<void> => {
  if (operationInProgress) {
    // Race condition window here
    while (operationInProgress) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return
  }
  
  operationInProgress = true
  // ... rest of implementation
}
```

### 2. Request Deduplication

```typescript
// Preferred: Request deduplication by key
const pendingRequests = new Map<string, Promise<any>>()

const fetchWithDeduplication = async <T>(
  key: string, 
  fetcher: () => Promise<T>
): Promise<T> => {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key)!
  }
  
  const promise = fetcher().finally(() => {
    pendingRequests.delete(key)
  })
  
  pendingRequests.set(key, promise)
  return promise
}
```

### 3. Cleanup Patterns

```typescript
// Preferred: Proper async cleanup
const cleanup = (): void => {
  // Clear timers
  if (timeoutId) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
  
  // Clear intervals
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  
  // Abort pending requests
  abortController?.abort()
  abortController = new AbortController()
  
  // Clear promise references
  operationPromise = null
  
  // Clear caches
  pendingRequests.clear()
}
```

---

## Logging & Debugging

### 1. Conditional Logging System

```typescript
// Preferred: Structured logging with levels
const createLogger = (config: StoreConfig, storeName: string) => {
  const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]) => {
    if (!config.enableLogging) return
    
    const prefix = `[${storeName}]`
    const timestamp = new Date().toISOString()
    
    switch (level) {
      case 'debug':
        if (config.logLevel === 'debug') {
          console.log(`${timestamp} ${prefix} ${message}`, ...args)
        }
        break
      case 'info':
        console.info(`${timestamp} ${prefix} ${message}`, ...args)
        break
      case 'warn':
        console.warn(`${timestamp} ${prefix} ${message}`, ...args)
        break
      case 'error':
        console.error(`${timestamp} ${prefix} ${message}`, ...args)
        break
    }
  }
  
  return {
    debug: (message: string, ...args: any[]) => log('debug', message, ...args),
    info: (message: string, ...args: any[]) => log('info', message, ...args),
    warn: (message: string, ...args: any[]) => log('warn', message, ...args),
    error: (message: string, ...args: any[]) => log('error', message, ...args)
  }
}

// Avoid: Direct console usage
console.log('User logged in') // Always executes, not configurable
```

### 2. Debug Information Pattern

```typescript
// Preferred: Rich debug context
const debugOperation = (operation: string, data?: any): void => {
  logger.debug(`${operation} started`, {
    timestamp: Date.now(),
    state: getCurrentState(),
    context: data
  })
}

// Avoid: Minimal debug info
console.log('Operation started')
```

---

## Performance & Bundle Size Considerations

### 1. Bundle Size Impact Analysis

Different patterns have varying bundle size implications. Choose based on your performance budget:

#### **Pattern Bundle Costs**

| Pattern | Bundle Impact | When Worth It |
|---------|---------------|---------------|
| Simple Store | ~1-2KB | Always |
| Factory Functions | +0.5KB | Multi-environment apps |
| Dependency Injection | +1-3KB | Complex external integrations |
| Extensive Logging | +2-5KB | Development/debugging needs |
| Retry Logic | +1-2KB | Critical operations |
| Event Bus | +1-3KB | Complex store interactions |

#### **Bundle Optimization Strategies**

```typescript
// Preferred: Conditional feature loading
const createStoreFeatures = (config: StoreConfig) => {
  const features: any = {}
  
  // Only load analytics in production
  if (import.meta.env.PROD && config.features?.enableAnalytics) {
    features.analytics = () => import('./analytics').then(m => m.createAnalytics())
  }
  
  // Only load complex logging in development
  if (import.meta.env.DEV && config.enableDebugLogging) {
    features.logger = () => import('./advanced-logger').then(m => m.createLogger())
  } else {
    features.logger = () => ({ log: () => {}, error: () => {} }) // Noop logger
  }
  
  return features
}

// Preferred: Tree-shakeable utilities
export const createRetryLogic = (config: RetryConfig) => {
  // This will be tree-shaken if not imported
  return retryWithBackoff
}

// Avoid: Always bundled heavy features
import { complexAnalytics } from './heavy-analytics' // Always bundled
import { advancedLogger } from './detailed-logger' // Always bundled

const useStore = defineStore('store', () => {
  // Heavy features always included
  const analytics = complexAnalytics()
  const logger = advancedLogger()
})
```

### 2. Runtime Performance Optimization

#### **Caching with Size Limits and LRU Eviction**

```typescript
// Preferred: Caching with memory management
class LRUCache<T> {
  private cache = new Map<string, { data: T; timestamp: number; accessCount: number }>()
  private accessOrder: string[] = []
  
  constructor(
    private maxSize: number = 100,
    private ttl: number = 5 * 60 * 1000 // 5 minutes
  ) {}
  
  get(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) return null
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key)
      return null
    }
    
    // Update access order for LRU
    entry.accessCount++
    this.moveToEnd(key)
    
    return entry.data
  }
  
  set(key: string, data: T): void {
    // Remove oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.accessOrder[0]
      this.delete(oldestKey)
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1
    })
    
    this.moveToEnd(key)
  }
  
  private moveToEnd(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    this.accessOrder.push(key)
  }
  
  private delete(key: string): void {
    this.cache.delete(key)
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }
  
  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }
  
  // Cleanup method for memory management
  cleanup(): void {
    const now = Date.now()
    const keysToDelete: string[] = []
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        keysToDelete.push(key)
      }
    }
    
    keysToDelete.forEach(key => this.delete(key))
  }
}

// Usage in store
const createCacheFeature = <T>(config: CacheConfig) => {
  const cache = new LRUCache<T>(config.maxSize, config.ttl)
  
  // Periodic cleanup to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    cache.cleanup()
  }, config.cleanupInterval || 60000) // 1 minute
  
  const cleanup = () => {
    clearInterval(cleanupInterval)
    cache.clear()
  }
  
  return { cache, cleanup }
}
```

#### **Request Deduplication with Memory Management**

```typescript
// Preferred: Memory-safe request deduplication
class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<any>>()
  private requestCounts = new Map<string, number>()
  
  async deduplicate<T>(
    key: string, 
    fetcher: () => Promise<T>,
    ttl: number = 5000 // 5 seconds
  ): Promise<T> {
    // Check if request is already pending
    if (this.pendingRequests.has(key)) {
      this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1)
      return this.pendingRequests.get(key)!
    }
    
    // Start new request
    const promise = fetcher().finally(() => {
      // Clean up after request completes
      this.pendingRequests.delete(key)
      this.requestCounts.delete(key)
    })
    
    this.pendingRequests.set(key, promise)
    this.requestCounts.set(key, 1)
    
    // Cleanup stale requests after TTL
    setTimeout(() => {
      if (this.pendingRequests.has(key)) {
        this.pendingRequests.delete(key)
        this.requestCounts.delete(key)
      }
    }, ttl)
    
    return promise
  }
  
  // Get statistics for monitoring
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      totalRequests: Array.from(this.requestCounts.values()).reduce((a, b) => a + b, 0)
    }
  }
  
  clear() {
    this.pendingRequests.clear()
    this.requestCounts.clear()
  }
}
```

### 3. Advanced Retry Strategies

```typescript
// Preferred: Smart retry logic with different strategies for different errors
interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
  jitter: boolean
}

const createSmartRetry = (config: RetryConfig) => {
  const retry = async <T>(
    operation: () => Promise<T>,
    context: string,
    customConfig?: Partial<RetryConfig>
  ): Promise<T> => {
    const finalConfig = { ...config, ...customConfig }
    let lastError: Error
    
    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error
        
        // Different strategies for different error types
        const shouldRetry = shouldRetryError(error as Error, attempt)
        if (!shouldRetry || attempt === finalConfig.maxAttempts) {
          throw error
        }
        
        // Calculate delay with different strategies
        const delay = calculateDelay(error as Error, attempt, finalConfig)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    throw lastError!
  }
  
  const shouldRetryError = (error: Error, attempt: number): boolean => {
    const message = error.message.toLowerCase()
    
    // Never retry certain errors
    if (message.includes('unauthorized') || message.includes('forbidden')) {
      return false
    }
    
    // Always retry network errors
    if (message.includes('network') || message.includes('timeout')) {
      return true
    }
    
    // Retry server errors but not client errors
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return true
    }
    
    return false
  }
  
  const calculateDelay = (error: Error, attempt: number, config: RetryConfig): number => {
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1)
    
    // Special handling for rate limiting
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      // Use exponential backoff with longer delays for rate limiting
      delay = Math.min(delay * 2, 30000) // Cap at 30 seconds
    }
    
    // Apply jitter to avoid thundering herd
    if (config.jitter) {
      delay += Math.random() * 1000
    }
    
    return Math.min(delay, config.maxDelay)
  }
  
  return { retry }
}
```

---

## Vue Reactivity Optimization

### 1. Choosing the Right Reactivity Primitives

```typescript
// Preferred: Optimized reactivity choices
export const useOptimizedStore = defineStore('optimized', () => {
  // Use ref for primitive values that change frequently
  const count = ref(0)
  const isLoading = ref(false)
  
  // Use shallowRef for large objects that are replaced entirely
  const largeDataset = shallowRef<LargeObject[]>([])
  
  // Use readonly for data that shouldn't be mutated externally
  const configuration = readonly(ref({
    apiUrl: '/api',
    timeout: 5000,
    features: ['feature1', 'feature2']
  }))
  
  // Use markRaw for objects that should never be reactive
  const thirdPartyLibInstance = markRaw(new ThirdPartyLibrary())
  
  // Use shallowReactive for objects with many properties that don't all need deep reactivity
  const userPreferences = shallowReactive({
    theme: 'dark',
    language: 'en',
    notifications: true,
    // ... many other properties
  })
  
  return {
    count, isLoading, largeDataset, configuration,
    thirdPartyLibInstance, userPreferences
  }
})
```

### 2. Performance-Optimized Computed Properties

```typescript
// Preferred: Efficient computed properties
export const usePerformantStore = defineStore('performant', () => {
  const items = ref<Item[]>([])
  const filters = ref<FilterOptions>({})
  
  // Use shallowRef for computed that returns large arrays/objects
  const filteredItems = computed(() => {
    const result = items.value.filter(item => matchesFilters(item, filters.value))
    // Return shallowRef to avoid deep reactivity on large results
    return markRaw(result) // Prevent reactivity on the result array
  })
  
  // Use computed with custom equality for expensive operations
  const expensiveComputation = computed(() => {
    return items.value.reduce((acc, item) => {
      // Expensive computation here
      return acc + complexCalculation(item)
    }, 0)
  })
  
  // Memoized computed for stable references
  const stableReference = computed(() => {
    const result = processItems(items.value)
    // Use JSON.stringify for deep equality check
    return result
  })
  
  // Debounced computed for frequently changing values
  const debouncedSearch = ref('')
  const searchResults = computed(() => {
    // This will be debounced externally
    return searchItems(items.value, debouncedSearch.value)
  })
  
  return {
    items, filteredItems, expensiveComputation,
    stableReference, searchResults
  }
})
```

### 3. Memory Management and Cleanup

```typescript
// Preferred: Proper memory management
export const useMemoryManagedStore = defineStore('memory', () => {
  const data = ref<any[]>([])
  const subscriptions: (() => void)[] = []
  const timers: number[] = []
  
  // Track subscriptions for cleanup
  const addSubscription = (unsubscribe: () => void) => {
    subscriptions.push(unsubscribe)
  }
  
  // Track timers for cleanup
  const addTimer = (timerId: number) => {
    timers.push(timerId)
  }
  
  // Cleanup function
  const cleanup = () => {
    // Clear all subscriptions
    subscriptions.forEach(unsubscribe => unsubscribe())
    subscriptions.length = 0
    
    // Clear all timers
    timers.forEach(timerId => clearTimeout(timerId))
    timers.length = 0
    
    // Clear reactive data
    data.value = []
  }
  
  // Auto-cleanup on store disposal
  onScopeDispose(() => {
    cleanup()
  })
  
  return {
    data,
    addSubscription,
    addTimer,
    cleanup
  }
})
```

### 4. Reactivity Edge Cases and Solutions

```typescript
// Preferred: Handling reactivity edge cases
export const useEdgeCaseStore = defineStore('edgeCase', () => {
  // Problem: Large arrays with frequent updates
  const largeList = shallowRef<Item[]>([])
  
  // Solution: Use shallowRef and replace entire array
  const updateLargeList = (newItems: Item[]) => {
    largeList.value = newItems // Triggers reactivity once
  }
  
  // Problem: Nested object updates not triggering reactivity
  const nestedData = ref<NestedObject>({})
  
  // Solution: Use proper update patterns
  const updateNestedProperty = (path: string[], value: any) => {
    const newData = structuredClone(nestedData.value)
    setNestedProperty(newData, path, value)
    nestedData.value = newData
  }
  
  // Problem: Circular references causing issues
  const circularData = ref<any>(null)
  
  // Solution: Use markRaw for objects with circular references
  const setCircularData = (data: any) => {
    circularData.value = markRaw(data)
  }
  
  // Problem: Third-party objects triggering unnecessary reactivity
  const apiClient = markRaw(new ApiClient())
  
  // Problem: Computed properties with side effects
  const computedWithSideEffect = computed(() => {
    const result = processData(largeList.value)
    // Avoid: Side effect in computed
    // logResult(result)
    return result
  })
  
  // Solution: Use watchEffect for side effects
  watchEffect(() => {
    const result = computedWithSideEffect.value
    logResult(result) // Side effect belongs in watchEffect
  })
  
  return {
    largeList, updateLargeList,
    nestedData, updateNestedProperty,
    circularData, setCircularData,
    apiClient, computedWithSideEffect
  }
})
```

---

## Performance Optimization

### 1. Computed Property Optimization

```typescript
// Preferred: Efficient computed properties
const expensiveComputed = computed(() => {
  // Use getter for expensive operations only when needed
  return items.value
    .filter(item => item.active)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 10)
})

// Avoid: Reactive expensive operations
const processedItems = ref([])
watch(items, () => {
  // Runs on every change, even if not used
  processedItems.value = expensiveProcessing(items.value)
}, { immediate: true })
```

### 2. Caching Strategies

```typescript
// Preferred: Smart caching with invalidation
const cache = new Map<string, { data: any; timestamp: number }>()

const getCachedData = async (key: string, fetcher: () => Promise<any>): Promise<any> => {
  const cached = cache.get(key)
  const isStale = !cached || (Date.now() - cached.timestamp) > cacheTimeout
  
  if (!isStale) {
    return cached.data
  }
  
  const data = await fetcher()
  cache.set(key, { data, timestamp: Date.now() })
  return data
}

// Cache invalidation
const invalidateCache = (pattern?: string): void => {
  if (pattern) {
    for (const key of cache.keys()) {
      if (key.includes(pattern)) {
        cache.delete(key)
      }
    }
  } else {
    cache.clear()
  }
}
```

### 3. Batch Operations

```typescript
// Preferred: Batched updates
const batchedUpdates = ref<Update[]>([])
let batchTimeout: number | null = null

const queueUpdate = (update: Update): void => {
  batchedUpdates.value.push(update)
  
  if (batchTimeout) return
  
  batchTimeout = setTimeout(() => {
    processBatch(batchedUpdates.value)
    batchedUpdates.value = []
    batchTimeout = null
  }, 100) // 100ms batch window
}

// Avoid: Individual updates
const updateItem = (item: Item): void => {
  // Triggers reactivity on every call
  items.value = items.value.map(i => i.id === item.id ? item : i)
}
```

---

## Testing Considerations

### 1. Testable Store Structure

```typescript
// Preferred: Separable concerns for testing
export const createStoreLogic = (dependencies: Dependencies) => {
  // Pure business logic that can be tested independently
  const processData = (data: RawData): ProcessedData => {
    // Pure function - easy to test
  }
  
  const validateInput = (input: Input): ValidationResult => {
    // Pure validation logic
  }
  
  return { processData, validateInput }
}

export const useStore = (config: Config = {}) => {
  const logic = createStoreLogic(createDependencies(config))
  
  return defineStore('store', () => {
    // Store implementation using logic
  })
}
```

### 2. Mock-Friendly Patterns

```typescript
// Preferred: Dependency injection for testing
interface Dependencies {
  apiClient: ApiClient
  logger: Logger
  config: Config
}

const createDependencies = (config: Config): Dependencies => ({
  apiClient: new ApiClient(config.apiUrl),
  logger: createLogger(config),
  config
})

// Avoid: Hard-coded dependencies
const apiClient = new ApiClient('https://api.example.com')
const logger = console
```

### 3. State Inspection Utilities

```typescript
// Preferred: Testing utilities
export const getStoreState = () => ({
  items: items.value,
  isLoading: isLoading.value,
  error: error.value,
  // ... other state
})

export const setStoreState = (state: Partial<StoreState>) => {
  if (state.items !== undefined) items.value = state.items
  if (state.isLoading !== undefined) isLoading.value = state.isLoading
  // ... other state
}
```

---

## Documentation Standards

### 1. JSDoc Requirements

```typescript
/**
 * Fetches items from the API with optional filtering
 * 
 * @param filters - Optional filters to apply to the request
 * @param options - Request configuration options
 * @returns Promise that resolves to the fetched items
 * 
 * @throws {NetworkError} When the network request fails
 * @throws {ValidationError} When the filters are invalid
 * 
 * @example
 * ```typescript
 * const items = await fetchItems({ status: 'active' })
 * console.log(items.length)
 * ```
 */
const fetchItems = async (
  filters?: ItemFilters,
  options?: RequestOptions
): Promise<Item[]> => {
  // Implementation
}
```

### 2. Interface Documentation

```typescript
/**
 * Configuration options for the store
 */
interface StoreConfig {
  /** API request timeout in milliseconds @default 5000 */
  apiTimeout?: number
  
  /** Maximum number of retry attempts @default 3 */
  maxRetries?: number
  
  /** Enable debug logging @default import.meta.env.DEV */
  enableLogging?: boolean
  
  /** 
   * Custom API endpoints mapping
   * @example { users: '/api/v2/users', items: '/api/v1/items' }
   */
  endpoints?: Record<string, string>
}
```

### 3. Usage Examples

```typescript
/**
 * @example Basic usage
 * ```typescript
 * const store = useMyStore()
 * await store.fetchData()
 * console.log(store.items)
 * ```
 * 
 * @example With custom configuration
 * ```typescript
 * const customStore = createMyStore({
 *   apiTimeout: 10000,
 *   enableLogging: true
 * })
 * ```
 * 
 * @example Error handling
 * ```typescript
 * try {
 *   await store.performAction()
 * } catch (error) {
 *   console.error('Action failed:', error.message)
 * }
 * ```
 */
```

---

## Implementation Checklist

When creating or reviewing a Pinia store, ensure the following:

### Architecture & Structure
- [ ] Clear separation of concerns (state, computed, actions, utilities)
- [ ] Appropriate complexity level for requirements (simple/intermediate/advanced)
- [ ] Configurable factory function pattern (when needed)
- [ ] Proper TypeScript interfaces for all data structures
- [ ] Logical grouping of related functionality

### Type Safety
- [ ] No `any` types in public interfaces
- [ ] Explicit return types for all public methods
- [ ] Generic constraints where appropriate
- [ ] Complete interface definitions

### External Dependencies
- [ ] Appropriate abstraction level for external libraries
- [ ] Dependency injection for critical services
- [ ] Library-specific error handling
- [ ] Bundle size impact considered

### Store Composition
- [ ] Explicit dependency declaration between stores
- [ ] Event-driven communication for loose coupling
- [ ] Shared computed properties where beneficial
- [ ] Cross-store validation patterns

### Error Handling
- [ ] User-friendly error messages
- [ ] Error classification system
- [ ] Proper error state management
- [ ] Context-specific retry logic with appropriate strategies

### Async Operations
- [ ] Promise-based mutex for race condition prevention
- [ ] Request deduplication with memory management
- [ ] Proper cleanup of timers, intervals, and promises
- [ ] AbortController usage for cancellable requests

### Performance & Bundle Size
- [ ] Efficient computed properties
- [ ] LRU caching with size limits and cleanup
- [ ] Batch operations where beneficial
- [ ] Conditional feature loading to reduce bundle size
- [ ] Tree-shakeable utility exports

### Vue Reactivity
- [ ] Appropriate reactivity primitives (ref, shallowRef, markRaw)
- [ ] Optimized computed properties for large datasets
- [ ] Proper memory management and cleanup
- [ ] Reactivity edge cases handled (circular refs, third-party objects)

### Configuration
- [ ] Environment-aware defaults
- [ ] Provider-agnostic design
- [ ] Runtime configuration options
- [ ] Feature flags for optional functionality
- [ ] Sensible default values

### Logging & Debugging
- [ ] Conditional logging based on environment
- [ ] Structured log messages with context
- [ ] Debug utilities for development
- [ ] No production console pollution
- [ ] Bundle impact of logging infrastructure considered

### Testing
- [ ] Separable business logic
- [ ] Mock-friendly dependency injection
- [ ] State inspection utilities
- [ ] Testable pure functions
- [ ] External dependencies easily mockable

### Documentation
- [ ] JSDoc for public methods
- [ ] Interface documentation with examples
- [ ] Usage examples in comments
- [ ] Configuration option documentation
- [ ] Complexity level and use case guidance

---

## Anti-Patterns to Avoid

### State Mutations
```typescript
// BAD: Direct state mutation
const addItem = (item: Item) => {
  items.value.push(item) // Mutates existing array
}

// GOOD: Immutable updates
const addItem = (item: Item) => {
  items.value = [...items.value, item]
}
```

### Unhandled Promises
```typescript
// BAD: Fire and forget
const saveData = () => {
  apiCall() // Promise not handled
}

// GOOD: Proper async handling
const saveData = async () => {
  try {
    await apiCall()
  } catch (error) {
    handleError(error, 'saveData')
  }
}
```

### Memory Leaks
```typescript
// BAD: Uncleared timers
const startPolling = () => {
  setInterval(pollData, 5000) // Never cleared
}

// GOOD: Proper cleanup
let pollInterval: number | null = null

const startPolling = () => {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(pollData, 5000)
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
```

### Blocking Operations
```typescript
// BAD: Synchronous expensive operations
const processData = () => {
  const result = expensiveSync Operation(largeDataSet)
  processedData.value = result
}

// GOOD: Async processing with loading states
const processData = async () => {
  isProcessing.value = true
  try {
    const result = await expensiveAsyncOperation(largeDataSet)
    processedData.value = result
  } finally {
    isProcessing.value = false
  }
}
```

---

## Conclusion

These patterns and principles support the following goals for Pinia stores:

- **Maintainable**: Clear structure and separation of concerns
- **Reliable**: Proper error handling and race condition prevention
- **Performant**: Optimized reactivity and caching strategies
- **Testable**: Separable business logic and mock-friendly dependencies
- **Flexible**: Configurable for different environments and use cases
- **Type-Safe**: Full TypeScript interfaces and constraints
