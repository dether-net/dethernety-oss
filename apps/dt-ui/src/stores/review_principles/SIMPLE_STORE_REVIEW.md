# Simple Store Review Template

## Usage
This template is for reviewing basic Pinia stores handling UI state, flags, or simple data operations. Use this when the store has < 10 actions and minimal external dependencies.

## Critical Issues (Must Fix)

### 🔴 Type Safety Violations
```typescript
// ❌ BAD
const data = ref<any>({})
const fetchData = async () => { /* no return type */ }

// ✅ GOOD
const data = ref<User | null>(null)
const fetchData = async (): Promise<User[]> => { /* implementation */ }
```

**Check for:**
- `any` types in state or function parameters
- Missing return type annotations on public methods
- Incomplete interface definitions

### 🔴 State Mutation Anti-Patterns
```typescript
// ❌ BAD: Direct mutation
const addItem = (item: Item) => {
  items.value.push(item) // Mutates existing array
}

// ✅ GOOD: Immutable updates
const addItem = (item: Item) => {
  items.value = [...items.value, item]
}
```

### 🔴 Missing Error Handling
```typescript
// ❌ BAD: Unhandled async operations
const fetchData = async () => {
  const result = await api.getData() // Can throw
  data.value = result
}

// ✅ GOOD: Basic error handling
const fetchData = async () => {
  try {
    isLoading.value = true
    const result = await api.getData()
    data.value = result
    error.value = ''
  } catch (err) {
    const error = err as Error
    if (error.message.includes('network')) {
      errorMessage.value = 'Connection failed. Please try again.'
    } else {
      errorMessage.value = 'Something went wrong. Please try again.'
    }
  } finally {
    isLoading.value = false
  }
}
```

### 🔴 Memory leaks in simple stores
```typescript
// ❌ BAD: Timer never cleared
const startPolling = () => {
  setInterval(fetchData, 5000) // Memory leak
}

// ✅ GOOD: Proper cleanup
let pollInterval: number | null = null
const startPolling = () => {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(fetchData, 5000)
}
```

### 🔴 Enhanced Type Safety Checks**:
```typescript
// ❌ BAD: Type assertion escape hatch
const user = response.data as User

// ✅ GOOD: Proper type validation
const user = validateUser(response.data)
```
## Important Issues (Should Fix)

### 🟡 Missing Loading States
```typescript
// Add loading states for async operations
const isLoading = ref(false)
const error = ref('')
```

###  Inconsistent State Shape
```typescript
// ✅ GOOD: Consistent state organization
const useStore = defineStore('store', () => {
  // Data State
  const items = ref<Item[]>([])
  const selectedItem = ref<Item | null>(null)
  
  // UI State
  const isLoading = ref(false)
  const error = ref('')
  
  // Computed
  const hasItems = computed(() => items.value.length > 0)
  
  return {
    // Group exports logically
    items, selectedItem, hasItems,
    isLoading, error,
    fetchItems, selectItem
  }
})
```

### 🟡 Missing State Reset
```typescript
// ✅ GOOD: Provide cleanup method
const resetState = (): void => {
  items.value = []
  selectedItem.value = null
  error.value = ''
  isLoading.value = false
}
```

## Minor Issues (Consider Fixing)

### 🟢 JSDoc Documentation
```typescript
/**
 * Fetches items from the API
 * @param filters - Optional filters to apply
 */
const fetchItems = async (filters?: ItemFilters): Promise<void> => {
  // implementation
}
```

### 🟢 Computed Property Optimization
```typescript
// ✅ GOOD: Simple, focused computed properties
const activeItems = computed(() => 
  items.value.filter(item => item.active)
)

// ❌ AVOID: Complex logic in computed
const complexComputed = computed(() => {
  // 20+ lines of complex logic - extract to helper function
})
```

### 🟢 Performance Considerations for Simple Stores
```typescript
// For large arrays in simple stores
const largeList = shallowRef<Item[]>([])

// For third-party objects
const apiClient = markRaw(new ApiClient())
```

## Review Checklist

### ✅ Type Safety (Critical)
- [ ] No `any` types in public interfaces
- [ ] Explicit return types for all public methods
- [ ] Complete TypeScript interfaces
- [ ] Proper generic constraints

### ✅ State Management (Critical)
- [ ] Immutable state updates
- [ ] Consistent state structure
- [ ] Logical state grouping
- [ ] State reset functionality

### ✅ Error Handling (Critical)
- [ ] Try-catch blocks for async operations
- [ ] Error state management
- [ ] Loading state management
- [ ] User-friendly error messages

### ✅ Code Organization (Important)
- [ ] Clear separation of data/UI/computed state
- [ ] Logical export grouping
- [ ] Consistent naming conventions
- [ ] Helper functions extracted when needed

### ✅ Performance (Minor)
- [ ] Efficient computed properties
- [ ] Avoid unnecessary reactivity
- [ ] Simple state structures

## Common Simple Store Patterns

### UI State Store
```typescript
export const useUIStore = defineStore('ui', () => {
  const sidebarOpen = ref(false)
  const theme = ref<'light' | 'dark'>('light')
  
  const toggleSidebar = () => {
    sidebarOpen.value = !sidebarOpen.value
  }
  
  return { sidebarOpen, theme, toggleSidebar }
}, { persist: true })
```

### Basic Data Store
```typescript
export const useItemStore = defineStore('items', () => {
  const items = ref<Item[]>([])
  const isLoading = ref(false)
  const error = ref('')
  
  const fetchItems = async (): Promise<void> => {
    try {
      isLoading.value = true
      error.value = ''
      items.value = await api.getItems()
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      isLoading.value = false
    }
  }
  
  const addItem = (item: Item): void => {
    items.value = [...items.value, item]
  }
  
  return { items, isLoading, error, fetchItems, addItem }
})
```

## When to Upgrade

Consider moving to Intermediate Store Review if the store has:
- Multiple API endpoints
- Complex business logic
- Cross-store dependencies
- Caching requirements
- More than 10 actions/methods

## Analysis Output Format

**Issue Priority**: Critical ðŸ”´ | Important ðŸŸ¡ | Minor ðŸŸ¢

**For each issue found:**
1. **Issue**: Brief description
2. **Location**: Specific code location
3. **Problem**: Why this is problematic
4. **Solution**: Specific fix with code example
5. **Priority**: Critical/Important/Minor

**Summary:**
- X Critical issues found
- X Important issues found  
- X Minor issues found
- Overall assessment: Good/Needs Work/Poor
