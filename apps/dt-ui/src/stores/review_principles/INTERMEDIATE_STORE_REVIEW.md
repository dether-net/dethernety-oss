# Intermediate Store Review Template

## Usage
This template is for reviewing stores with API integration, moderate business logic, and cross-store interactions. Use when the store has 5-15 actions, multiple API endpoints, or complex state management.

## Inherits All Simple Store Checks
First apply all checks from `SIMPLE_STORE_REVIEW.md`, then add these additional patterns.

## Critical Issues (Must Fix)

### 🔴 API Integration Problems
```typescript
// ❌ BAD: No error differentiation
const fetchData = async () => {
  try {
    const result = await api.getData()
    data.value = result
  } catch (error) {
    // All errors treated the same
    errorMessage.value = 'Something went wrong'
  }
}

// ✅ GOOD: Start simple, then enhance
// Step 1: Basic error classification
const handleApiError = (error: Error): string => {
  if (error.message.includes('401')) return 'Please log in again'
  if (error.message.includes('403')) return 'Access denied'
  if (error.message.includes('404')) return 'Resource not found'
  if (error.message.includes('network')) return 'Connection failed'
  return 'Something went wrong. Please try again.'
}

// Step 2: Apply to fetch function
const fetchData = async (): Promise<void> => {
  try {
    isLoading.value = true
    error.value = ''
    const result = await api.getData()
    data.value = result
  } catch (err) {
    error.value = handleApiError(err as Error)
  } finally {
    isLoading.value = false
  }
}
```

### 🔴 State Synchronization Problems
```typescript
// ❌ BAD: Inconsistent state updates
const updateUser = (user: User) => {
  currentUser.value = user
  // Forgot to update users array - state now inconsistent
}

// ✅ GOOD: Step-by-step improvement
// Step 1: Basic synchronization
const updateUser = (user: User) => {
  currentUser.value = user
  const index = users.value.findIndex(u => u.id === user.id)
  if (index >= 0) {
    users.value[index] = user
  }
}

// Step 2: Extract helper for reuse
const syncUserUpdate = (updatedUser: User) => {
  currentUser.value = updatedUser
  users.value = users.value.map(user => 
    user.id === updatedUser.id ? updatedUser : user
  )
}
```

### 🔴 Unmanaged Watchers and Side Effects
```typescript
// ❌ BAD: Watchers never cleaned up
const setupSearch = () => {
  watch(searchQuery, (newQuery) => {
    fetchResults(newQuery)
  })
}

// ✅ GOOD: Progressive cleanup approach
// Step 1: Basic cleanup
const stopWatcher = watch(searchQuery, fetchResults)
onScopeDispose(stopWatcher)

// Step 2: Multiple watchers
const watcherStops: Array<() => void> = []

const setupWatchers = () => {
  watcherStops.push(
    watch(searchQuery, fetchResults),
    watch(filters, applyFilters)
  )
}

const cleanup = () => {
  watcherStops.forEach(stop => stop())
  watcherStops.length = 0
}

onScopeDispose(cleanup)
```

### 🔴 Cross-Store Dependency Issues
```typescript
// ❌ BAD: Hidden dependencies
const createOrder = async (orderData: CreateOrderRequest) => {
  const userStore = useUserStore() // Hidden dependency
  // ...
}

// ✅ GOOD: Explicit dependencies at top
const useOrderStore = defineStore('orders', () => {
  // Declare all dependencies at the top
  const userStore = useUserStore()
  const inventoryStore = useInventoryStore()
  
  const createOrder = async (orderData: CreateOrderRequest) => {
    if (!userStore.isAuthenticated) {
      throw new Error('Authentication required')
    }
    
    const available = await inventoryStore.checkStock(orderData.items)
    if (!available) {
      throw new Error('Items out of stock')
    }
    
    // ... proceed with order
  }
  
  return { createOrder }
})
```

## Important Issues (Should Fix)

### 🟡 Missing Optimistic Updates
```typescript
// ✅ GOOD: Simple optimistic update pattern
const addItem = async (newItem: CreateItemRequest): Promise<void> => {
  // Step 1: Optimistically update UI
  const tempId = `temp-${Date.now()}`
  const optimisticItem = { ...newItem, id: tempId, pending: true }
  items.value = [...items.value, optimisticItem]
  
  try {
    // Step 2: Send to server
    const savedItem = await api.createItem(newItem)
    
    // Step 3: Replace optimistic item with real data
    items.value = items.value.map(item =>
      item.id === tempId ? savedItem : item
    )
  } catch (error) {
    // Step 4: Remove failed optimistic update
    items.value = items.value.filter(item => item.id !== tempId)
    throw error
  }
}
```

### 🟡 Basic Form State Management
```typescript
// ✅ GOOD: Start simple, build up
// Step 1: Basic form state
const formData = ref({
  name: '',
  email: '',
  message: ''
})
const formErrors = ref<Record<string, string>>({})

// Step 2: Simple validation
const validateEmail = (email: string): string => {
  return email.includes('@') ? '' : 'Invalid email format'
}

// Step 3: Field update with validation
const updateField = (field: keyof typeof formData.value, value: string) => {
  formData.value[field] = value
  
  // Clear error when user starts typing
  if (formErrors.value[field]) {
    formErrors.value = { ...formErrors.value, [field]: '' }
  }
}
```

### 🟡 Basic Caching (When Appropriate)
```typescript
// ✅ GOOD: Simple cache pattern
const cache = ref(new Map<string, { data: any; timestamp: number }>())
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Step 1: Basic cache check
const getCached = (key: string) => {
  const cached = cache.value.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  return null
}

// Step 2: Cache with fetch
const fetchWithCache = async (key: string, fetcher: () => Promise<any>) => {
  const cached = getCached(key)
  if (cached) return cached
  
  const data = await fetcher()
  cache.value.set(key, { data, timestamp: Date.now() })
  return data
}

// ⚠️ DON'T cache when:
// - Data changes frequently (real-time updates)
// - Small datasets (< 100 items)
// - User-specific data that varies per request
```

### 🟡 Missing Pagination Handling
```typescript
// ✅ GOOD: Essential pagination pattern
const items = ref<Item[]>([])
const currentPage = ref(1)
const hasMore = ref(true)
const isLoadingMore = ref(false)

const loadNextPage = async (): Promise<void> => {
  if (!hasMore.value || isLoadingMore.value) return
  
  try {
    isLoadingMore.value = true
    const result = await api.getItems({
      page: currentPage.value + 1,
      limit: 20
    })
    
    items.value = [...items.value, ...result.items]
    currentPage.value += 1
    hasMore.value = result.items.length === 20 // Full page means more available
  } finally {
    isLoadingMore.value = false
  }
}
```

### 🟡 Missing Data Validation
```typescript
// ✅ GOOD: Progressive validation approach
// Step 1: Required field validation
const validateRequired = (value: string, fieldName: string): string => {
  return value.trim() ? '' : `${fieldName} is required`
}

// Step 2: Combine validations
const validateCreateRequest = (data: CreateItemRequest): string[] => {
  const errors: string[] = []
  
  const nameError = validateRequired(data.name, 'Name')
  if (nameError) errors.push(nameError)
  
  if (data.price <= 0) {
    errors.push('Price must be positive')
  }
  
  return errors
}
```

## Minor Issues (Consider Fixing)

### 🟢 Basic Search and Filtering
```typescript
// ✅ GOOD: Start with simple search
const searchQuery = ref('')

const filteredItems = computed(() => {
  if (!searchQuery.value.trim()) return items.value
  
  const query = searchQuery.value.toLowerCase()
  return items.value.filter(item => 
    item.name.toLowerCase().includes(query)
  )
})

// Then add filters when needed
const filters = ref({ category: '', status: '' })

const searchAndFilter = computed(() => {
  let result = items.value
  
  // Apply search first
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(item => 
      item.name.toLowerCase().includes(query)
    )
  }
  
  // Then apply filters
  if (filters.value.category) {
    result = result.filter(item => item.category === filters.value.category)
  }
  
  return result
})
```

### 🟢 Simple Retry Logic
```typescript
// ✅ GOOD: Intermediate-appropriate retry
const fetchWithRetry = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    // Don't retry client errors (4xx)
    if ((error as any).status?.toString().startsWith('4')) {
      throw error
    }
    
    // Simple one retry for network/server errors
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await operation()
  }
}
```

### 🟢 Basic Conflict Resolution
```typescript
// ✅ GOOD: Simple conflict detection
const updateWithConflictCheck = async (id: string, updates: Partial<Item>) => {
  try {
    const result = await api.updateItem(id, {
      ...updates,
      lastModified: items.value.find(i => i.id === id)?.lastModified
    })
    
    // Update local state with server response
    syncItemUpdate(result)
  } catch (error) {
    if (error.message.includes('conflict')) {
      // Simple resolution: show user the conflict
      conflictError.value = 'Item was modified by another user. Please refresh and try again.'
    }
    throw error
  }
}
```

## Review Checklist

### ✅ API Integration (Critical)
- [ ] Basic error classification (401, 403, 404, network)
- [ ] User-friendly error messages
- [ ] Loading states for all async operations
- [ ] Proper async error handling

### ✅ State Management (Critical)
- [ ] Explicit cross-store dependencies declared at top
- [ ] Synchronized state updates across related data
- [ ] Proper watcher cleanup with onScopeDispose
- [ ] State validation for user inputs

### ✅ User Experience (Important)
- [ ] Optimistic updates for immediate feedback
- [ ] Form state management with validation
- [ ] Basic pagination (load more, page tracking)
- [ ] Simple conflict resolution messaging

### ✅ Performance (Important)
- [ ] Simple caching for expensive operations (when appropriate)
- [ ] Efficient computed properties for search/filtering
- [ ] Granular loading states for different operations
- [ ] Avoid over-caching fast or changing data

### ✅ Reliability (Minor)
- [ ] Simple retry logic for network failures
- [ ] Basic request deduplication
- [ ] Memory cleanup (watchers, timers)
- [ ] Progressive enhancement approach

## Common Intermediate Patterns

### Simple Contact Form
```typescript
export const useContactFormStore = defineStore('contactForm', () => {
  const formData = ref({ name: '', email: '', message: '' })
  const errors = ref<Record<string, string>>({})
  const isSubmitting = ref(false)
  
  const updateField = (field: string, value: string) => {
    formData.value[field as keyof typeof formData.value] = value
    // Clear error when user starts typing
    if (errors.value[field]) {
      errors.value = { ...errors.value, [field]: '' }
    }
  }
  
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.value.name.trim()) newErrors.name = 'Name is required'
    if (!formData.value.email.includes('@')) newErrors.email = 'Invalid email'
    if (formData.value.message.length < 10) newErrors.message = 'Message too short'
    
    errors.value = newErrors
    return Object.keys(newErrors).length === 0
  }
  
  const submitForm = async (): Promise<boolean> => {
    if (!validateForm()) return false
    
    try {
      isSubmitting.value = true
      await api.submitContact(formData.value)
      
      // Reset on success
      formData.value = { name: '', email: '', message: '' }
      return true
    } catch (error) {
      errors.value = { submit: 'Failed to submit form' }
      return false
    } finally {
      isSubmitting.value = false
    }
  }
  
  return { formData, errors, isSubmitting, updateField, submitForm }
})
```

### Search with Pagination
```typescript
export const useProductSearchStore = defineStore('productSearch', () => {
  const products = ref<Product[]>([])
  const searchQuery = ref('')
  const isLoading = ref(false)
  const hasMore = ref(true)
  const page = ref(1)
  
  const search = async (query?: string): Promise<void> => {
    if (query !== undefined) {
      searchQuery.value = query
      page.value = 1
      products.value = []
      hasMore.value = true
    }
    
    if (!hasMore.value || isLoading.value) return
    
    try {
      isLoading.value = true
      const result = await api.searchProducts({
        query: searchQuery.value,
        page: page.value
      })
      
      if (page.value === 1) {
        products.value = result.products
      } else {
        products.value = [...products.value, ...result.products]
      }
      
      page.value += 1
      hasMore.value = result.products.length === 20
    } finally {
      isLoading.value = false
    }
  }
  
  return { products, searchQuery, isLoading, hasMore, search }
})
```

## When to Upgrade

Consider moving to Enterprise Store Review if the store has:
- Race conditions in concurrent operations
- Complex external service integrations (multiple APIs)
- High-frequency real-time updates
- Advanced caching needs (LRU, distributed)
- Critical business logic (payments, auth)
- Performance requirements for large datasets (1000+ items)
- Multi-environment deployment complexity

## Analysis Output Format

**Issue Priority**: Critical 🔴 | Important 🟡 | Minor 🟢

**For each issue found:**
1. **Issue**: Brief description with category (API/State/UX/Performance)
2. **Location**: Specific code location
3. **Impact**: How this affects functionality/performance/maintainability
4. **Solution**: Specific fix with progressive enhancement approach
5. **Priority**: Critical/Important/Minor

**Summary:**
- X Critical issues (API: X, State: X, Cross-Store: X)
- X Important issues (UX: X, Performance: X, Validation: X)
- X Minor issues (Search: X, Retry: X, Cleanup: X)
- **Complexity Assessment**: Appropriate/Over-engineered/Under-engineered
- **Upgrade Recommendation**: Stay Intermediate/Consider Enterprise patterns