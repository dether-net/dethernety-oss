# Flow Store & Optimistic Updates

## Table of Contents
- [Overview](#overview)
- [Temporary Node Tracking](#temporary-node-tracking)
- [Three-Phase Node Creation](#three-phase-node-creation)
- [Deferred Update Mechanism](#deferred-update-mechanism)
- [Error Handling & Rollback](#error-handling--rollback)
- [Vue Flow Integration](#vue-flow-integration)
- [State Synchronization](#state-synchronization)
- [DtUtils Concurrency Patterns](#dtutils-concurrency-patterns)

## Overview

The flowStore manages the data flow diagram editor, implementing advanced optimistic update patterns for responsive user experience during threat modeling.

**Primary Source File:** `apps/dt-ui/src/stores/flowStore.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Optimistic Update Flow                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User Action: Drop component on canvas                                  │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 1: Optimistic Update                                      │    │
│  │ - Create temp node with temp-{timestamp} ID                     │    │
│  │ - Add to pendingNodes set                                       │    │
│  │ - Insert into nodes array immediately                           │    │
│  │ - User sees node appear instantly                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 2: API Call                                               │    │
│  │ - Send create request to backend                                │    │
│  │ - Queue any user updates to deferredUpdates                     │    │
│  │ - Server returns real node with real ID                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 3: Reconciliation                                         │    │
│  │ - Replace temp node with real node                              │    │
│  │ - Map temp ID to real ID in tempNodeMapping                     │    │
│  │ - Apply all deferred updates                                    │    │
│  │ - Clean up tracking state                                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Temporary Node Tracking

### Data Structures

**Source:** `flowStore.ts:50-54`

```typescript
// Track nodes that are being created (temp ID exists, real ID pending)
const pendingNodes = ref<Set<string>>(new Set())

// Map temporary IDs to real IDs after server response
const tempNodeMapping = ref<Map<string, string>>(new Map())

// Queue updates that arrive while node is still being created
const deferredUpdates = ref<Map<string, Array<{
  updates: object
  timestamp: number
}>>>(new Map())
```

### Helper Functions

**Source:** `flowStore.ts:102-115`

```typescript
// Check if a node is in pending state (being created)
const isPendingNode = (nodeId: string): boolean => {
  return pendingNodes.value.has(nodeId)
}

// Resolve a temp ID to its real ID (if creation completed)
const getRealNodeId = (nodeId: string): string => {
  return tempNodeMapping.value.get(nodeId) || nodeId
}

// Queue an update for a temp node to apply after creation
const queueUpdateForTempNode = (tempId: string, updates: object): void => {
  if (!deferredUpdates.value.has(tempId)) {
    deferredUpdates.value.set(tempId, [])
  }
  deferredUpdates.value.get(tempId)!.push({
    updates,
    timestamp: Date.now()
  })
}
```

---

## Three-Phase Node Creation

### Phase 1: Optimistic Update

**Source:** `flowStore.ts:326-347`

```typescript
const createComponentNode = async ({ newNode, classId }): Promise<Node | null> => {
  const operationKey = `createComponent-${Date.now()}`

  // Generate temporary ID
  const tempId = `temp-${Date.now()}`

  // Create optimistic node for immediate UI feedback
  const optimisticNode = {
    id: tempId,
    type: newNode.type,
    position: newNode.position,
    data: {
      ...newNode.data,
      pending: true,              // Flag for UI indication
      label: newNode.data?.label || 'Creating...'
    }
  }

  // Track as pending
  pendingNodes.value.add(tempId)

  // Add to nodes array IMMEDIATELY
  nodes.value.push(optimisticNode)

  // Update selection to the new node
  selectedItem.value = optimisticNode

  // ... Phase 2 & 3 continue
}
```

**UI Indication:**
- `pending: true` flag can be used to show loading spinner
- Label shows "Creating..." as placeholder

### Phase 2: API Call

**Source:** `flowStore.ts:349-353`

```typescript
try {
  // Execute actual API call
  const createdComponent = await dtComponent.createComponentNode({
    newNode,
    classId,
    defaultBoundaryId: defaultBoundaryId.value || ''
  })

  // Phase 3 follows on success...
```

**During this phase:**
- User can interact with the temp node
- Any updates are queued via `updateNode()` detecting pending status

### Phase 3: Reconciliation

**Source:** `flowStore.ts:355-380`

```typescript
if (createdComponent) {
  // Find and replace optimistic node
  const index = nodes.value.findIndex((n: any) => n.id === tempId)
  if (index !== -1) {
    nodes.value.splice(index, 1, createdComponent)

    // Map temp ID to real ID for future lookups
    tempNodeMapping.value.set(tempId, createdComponent.id)

    // Update selection if it was pointing to temp node
    if (selectedItem.value && (selectedItem.value as any).id === tempId) {
      selectedItem.value = createdComponent
    }

    // Force Vue reactivity
    nodes.value = nodes.value.slice()
  }

  // Apply any updates that were queued during creation
  await applyDeferredUpdates(tempId, createdComponent.id)

  // Cleanup tracking state
  pendingNodes.value.delete(tempId)

  // Keep mapping for a short time for late-arriving updates
  setTimeout(() => tempNodeMapping.value.delete(tempId), 1000)
}
```

---

## Deferred Update Mechanism

### Why Deferred Updates?

```
Timeline:
─────────────────────────────────────────────────────────────────────────►
    │                                    │                           │
    │                                    │                           │
  User drops                         User changes              Server returns
  component                          node name                 real node
    │                                    │                           │
    ▼                                    ▼                           ▼
  tempId created                   Update queued              Apply deferred
  API call starts                  (node pending)             updates to real ID
```

Without deferred updates, the name change would be lost because the temp node doesn't exist on the server yet.

### Update Detection

**Source:** `flowStore.ts:482-514`

```typescript
const updateNode = async ({
  nodeId,
  updates,
  skipDeferredQueue = false
}): Promise<boolean> => {

  // Check if this is a temporary node
  if (!skipDeferredQueue && isPendingNode(nodeId)) {
    console.log(`Queueing update for temporary node ${nodeId}:`, updates)

    // Queue the update for later
    queueUpdateForTempNode(nodeId, updates)

    // Also update the UI optimistically
    const tempNodeIndex = nodes.value.findIndex(n => n.id === nodeId)
    if (tempNodeIndex !== -1) {
      const tempNode = nodes.value[tempNodeIndex]
      dtUtils.deepMerge(tempNode, updates)
      nodes.value = nodes.value.slice()  // Force reactivity
    }

    return true  // Indicate update was handled (queued)
  }

  // Regular update flow for non-pending nodes
  // ...
}
```

### Applying Deferred Updates

**Source:** `flowStore.ts:117-172`

```typescript
const applyDeferredUpdates = async (tempId: string, realId: string) => {
  const updates = deferredUpdates.value.get(tempId)
  if (!updates || updates.length === 0) return

  // Separate class updates from regular updates
  // (class updates have priority)
  let classId: string | undefined
  const nodeUpdates: any = {}

  updates.forEach(({ updates: update }) => {
    if ('classId' in update) {
      classId = (update as any).classId  // Take latest class update
    } else {
      dtUtils.deepMerge(nodeUpdates, update)  // Merge all other updates
    }
  })

  // Small delay to ensure server has committed the node
  await new Promise(resolve => setTimeout(resolve, 100))

  // Verify real node exists before applying
  const realNodeExists = getNodeById({ nodeId: realId }) ||
                         realId === defaultBoundaryId.value
  if (!realNodeExists) {
    console.warn(`Real node ${realId} not found. Skipping deferred updates.`)
    return
  }

  // Apply class update first (if any)
  if (classId) {
    try {
      await updateNodeClass({ nodeId: realId, classId })
    } catch (error) {
      console.error('Failed to apply deferred class update:', error)
    }
  }

  // Apply merged regular updates
  if (Object.keys(nodeUpdates).length > 0) {
    try {
      // skipDeferredQueue prevents infinite loop
      await updateNode({ nodeId: realId, updates: nodeUpdates, skipDeferredQueue: true })
    } catch (error) {
      console.error('Failed to apply deferred node updates:', error)
    }
  }

  // Cleanup
  deferredUpdates.value.delete(tempId)
}
```

**Update Priority:**
1. Class updates applied first (changes node type/schema)
2. Regular updates merged and applied second
3. Latest class update wins (if multiple)
4. Regular updates are deep-merged together

---

## Error Handling & Rollback

### Node Creation Failure

**Source:** `flowStore.ts:385-401`

```typescript
catch (error) {
  // Remove the failed optimistic node
  nodes.value = nodes.value.filter(n => n.id !== tempId)

  // Clear selection if it was the failed node
  selectedItem.value = null

  // Clean up all tracking state
  pendingNodes.value.delete(tempId)
  deferredUpdates.value.delete(tempId)
  tempNodeMapping.value.delete(tempId)

  // Set user-friendly error
  const errorMessage = handleApiError(error as Error, 'create component')
  setError(operationKey, errorMessage)

  return null
}
```

**Rollback Guarantees:**
- Optimistic node removed from UI
- Selection cleared
- All tracking maps cleaned up
- Error message set for UI display

### Update Failure (Non-Pending Node)

```typescript
const updateNode = async ({ nodeId, updates }): Promise<boolean> => {
  // Store original for rollback
  const originalNode = structuredClone(nodes.value.find(n => n.id === nodeId))

  // Optimistic update
  const nodeIndex = nodes.value.findIndex(n => n.id === nodeId)
  dtUtils.deepMerge(nodes.value[nodeIndex], updates)

  try {
    await dtComponent.updateNode({ nodeId, updates })
    return true
  } catch (error) {
    // Rollback to original
    if (originalNode && nodeIndex !== -1) {
      nodes.value.splice(nodeIndex, 1, originalNode)
    }
    throw error
  }
}
```

---

## Vue Flow Integration

### Node/Edge State

**Source:** `flowStore.ts:32-36`

```typescript
// Vue Flow reactive state
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])

// Related data
const controls = ref<Control[]>([])
const dataItems = ref<DataItem[]>([])
const modules = ref<Module[]>([])
```

### Selection Tracking

**Source:** `flowStore.ts:42, 316`

```typescript
// Currently selected element (node or edge)
const selectedItem = ref<Node | Edge | null>(null)

const setSelectedItem = ({ item }: { item: Node | Edge | null }) => {
  selectedItem.value = item
}
```

**Selection During Optimistic Updates:**
- Line 347: `selectedItem.value = optimisticNode` (immediate)
- Lines 365-367: Update selection when temp replaced with real
- Line 389: Clear selection on failure

### Boundary Nesting

**Source:** `flowStore.ts:403-480` (createBoundaryNode)

Boundaries support hierarchical nesting:

```typescript
const createBoundaryNode = async ({ newNode, classId, parentBoundaryId }) => {
  const tempId = `temp-${Date.now()}`

  const optimisticNode = {
    id: tempId,
    type: 'BOUNDARY',
    position: newNode.position,
    data: {
      ...newNode.data,
      pending: true,
      parentId: parentBoundaryId,  // Hierarchical relationship
      style: {
        width: newNode.data?.style?.width || 300,
        height: newNode.data?.style?.height || 200
      }
    }
  }

  // Same three-phase pattern as components...
}
```

---

## State Synchronization

### Sync Helpers

**Source:** `flowStore.ts:175-197`

When a node update returns related data (data items, controls), sync helpers ensure consistency:

```typescript
const syncDataItems = (newDataItems: DataItem[]) => {
  newDataItems?.forEach((dataItem: DataItem) => {
    const index = getDataItemIndexById({ dataItemId: dataItem.id })
    if (index !== -1) {
      // Update existing
      dataItems.value.splice(index, 1, dataItem)
    } else {
      // Add new
      dataItems.value.push(dataItem)
    }
  })
  // Force reactivity
  dataItems.value = [...dataItems.value]
}

const syncControls = (newControls: Control[]) => {
  newControls?.forEach((control: Control) => {
    const index = getControlIndexById({ controlId: control.id })
    if (index !== -1) {
      controls.value.splice(index, 1, control)
    } else {
      controls.value.push(control)
    }
  })
  controls.value = [...controls.value]
}
```

### Usage in Node Updates

**Source:** `flowStore.ts:583-584, 653-654, 769-770`

```typescript
const updateComponentNode = async ({ updatedNode }) => {
  const result = await dtComponent.updateComponentNode({ updatedNode })

  // Sync any returned related data
  syncDataItems(result.dataItems)
  syncControls(result.controls)

  return result
}
```

---

## DtUtils Concurrency Patterns

### Promise-Based Mutex

**Source:** `packages/dt-core/src/dt-utils/dt-utils.ts:31-47`

Prevents concurrent execution of the same operation:

```typescript
private mutex: Map<string, Promise<any>> = new Map()

async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for existing operation to complete
  if (this.mutex.has(key)) {
    await this.mutex.get(key)
  }

  // Create new promise for this execution
  const promise = fn()
  this.mutex.set(key, promise)

  try {
    return await promise
  } finally {
    this.mutex.delete(key)
  }
}
```

**Mutex Key Pattern:**
```typescript
const mutexKey = `${action}-${JSON.stringify(variables)}`
// Example: "updateNode-{\"nodeId\":\"123\",\"updates\":{...}}"
```

### Request Deduplication

**Source:** `dt-utils.ts:163-194`

Prevents duplicate concurrent requests:

```typescript
private requestDeduplicator = new Map<string, Promise<any>>()
private requestMetadata = new Map<string, { timestamp: number; count: number }>()

private async withDeduplication<T>(
  key: string,
  operation: () => Promise<T>,
  ttl: number = 5000
): Promise<T> {
  // Return existing promise if request in flight
  if (this.requestDeduplicator.has(key)) {
    const metadata = this.requestMetadata.get(key)!
    metadata.count++
    console.debug(`Deduplicating request ${key} (${metadata.count} concurrent)`)
    return this.requestDeduplicator.get(key)!
  }

  // Start new request
  const promise = operation().finally(() => {
    this.requestDeduplicator.delete(key)
    this.requestMetadata.delete(key)
  })

  this.requestDeduplicator.set(key, promise)
  this.requestMetadata.set(key, { timestamp: Date.now(), count: 1 })

  // Auto-cleanup after TTL (memory safety)
  setTimeout(() => {
    this.requestDeduplicator.delete(key)
    this.requestMetadata.delete(key)
  }, ttl)

  return promise
}
```

### Deep Merge Utility

**Source:** `dt-utils.ts:54-68`

Used for merging deferred updates:

```typescript
deepMerge(target: any, updates: any): any {
  for (const key in updates) {
    if (
      updates[key] &&
      typeof updates[key] === 'object' &&
      !Array.isArray(updates[key])
    ) {
      // Recursive merge for nested objects
      target[key] = target[key] || {}
      this.deepMerge(target[key], updates[key])
    } else {
      // Direct assignment for primitives and arrays
      target[key] = updates[key]
    }
  }
  return target
}
```

### Retry with Exponential Backoff

**Source:** `dt-utils.ts:130-158`

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

      // Exponential backoff: 1s, 2s, 4s (capped at maxDelay)
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt),
        config.maxDelay
      )

      console.warn(`Retrying (attempt ${attempt + 1}/${config.maxRetries + 1}) after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
```

**Default Configuration:**
```typescript
const DEFAULT_NETWORK_RETRY = {
  maxRetries: 3,
  baseDelay: 1000,  // 1 second
  maxDelay: 5000    // 5 seconds cap
}
```

---

## Error Classification

### Error State Management

**Source:** `flowStore.ts:45-90`

```typescript
const errors = ref<Record<string, string>>({})
const operationStates = ref<Record<string, boolean>>({})

const setError = (key: string, message: string) => {
  errors.value = { ...errors.value, [key]: message }
}

const clearError = (key: string) => {
  const newErrors = { ...errors.value }
  delete newErrors[key]
  errors.value = newErrors
}

const setOperationLoading = (operation: string, loading: boolean) => {
  operationStates.value = { ...operationStates.value, [operation]: loading }
}
```

**Key Pattern:**
- Operation-specific error keys isolate failures
- Example: `createComponent-1234567890` vs `updateNode-abc123`
- UI can display errors per-operation without interference

### handleApiError

```typescript
const handleApiError = (error: Error, operation: string): string => {
  console.error(`${operation} failed:`, error)

  if (error.message.includes('401')) {
    return 'Session expired. Please log in again.'
  }
  if (error.message.includes('network')) {
    return 'Connection failed. Please check your internet.'
  }

  return `Failed to ${operation}. Please try again.`
}
```

---

## Complete State Reset

**Source:** `flowStore.ts:254-270`

```typescript
const resetStore = () => {
  // Clear Vue Flow state
  nodes.value = []
  edges.value = []
  selectedItem.value = null

  // Clear related data
  controls.value = []
  dataItems.value = []
  modules.value = []

  // Clear temporary tracking
  pendingNodes.value.clear()
  tempNodeMapping.value.clear()
  deferredUpdates.value.clear()

  // Clear error state
  errors.value = {}
  operationStates.value = {}

  // Clear model context
  currentModelId.value = ''
  defaultBoundaryId.value = ''
}
```
