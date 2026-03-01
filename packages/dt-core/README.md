# @dethernety/dt-core

Production-ready core API library for Dethernety threat modeling framework that provides a lightweight abstraction layer over GraphQL communication between the frontend and backend.

## Overview

The `dt-core` package is a **lightweight library layer** designed for production-ready Vue.js applications. It provides type-safe API access to Dethernety backend services with built-in reliability features including retry logic, request deduplication, mutex protection, and structured error handling.

### Key Features

- **🚀 Production Ready**: Built-in retry logic, error handling, and concurrency control
- **⚡ Performance Optimized**: Request deduplication, mutex protection, and intelligent caching
- **🔒 Type Safe**: Full TypeScript support with comprehensive type definitions
- **🧹 Clean Architecture**: Lightweight abstraction focused on data operations only
- **📊 Structured Logging**: Detailed error logging with context for debugging
- **🌐 Browser Optimized**: Lightweight patterns suitable for client-side execution

## Installation

```bash
pnpm add @dethernety/dt-core
```

## Architecture Principles

### Library Layer Responsibilities

The `dt-core` library is a **lightweight abstraction** focused solely on:

#### ✅ What the Library DOES:
- **Pure Data Operations**: GraphQL queries and mutations
- **Data Transformation**: Converting GraphQL responses to usable formats  
- **Network Communication**: HTTP/WebSocket connections with Apollo Client
- **Technical Error Handling**: Network timeouts, connection failures, transport errors
- **Mutex Protection**: Preventing concurrent execution of critical operations
- **Retry Logic**: Automatic retry for network-related failures with exponential backoff
- **Request Deduplication**: Preventing duplicate concurrent requests with TTL
- **Structured Logging**: Technical error logging for debugging

#### ❌ What the Library DOES NOT:
- **Business Logic**: Domain-specific rules are handled by the store layer
- **User-Facing Error Messages**: Only technical error handling
- **Input Validation**: Validation is the responsibility of the store layer
- **State Management**: No reactive state or caching beyond Apollo Client
- **User Experience Logic**: No optimistic updates or UI state management

### Error Handling Strategy

The library uses a **"throw errors, don't return null"** pattern:

```typescript
// ✅ Library methods throw errors for store layer to handle
const analysis = await dtAnalysis.createAnalysis(params) // Throws on error
// ❌ Library methods do NOT return null
const analysis = await dtAnalysis.createAnalysis(params) // Never returns null
```

This allows the Pinia store layer to properly classify and handle errors with user-friendly messages.

## Usage

### Basic Setup

Initialize the core API classes with an Apollo Client instance:

```typescript
import { ApolloClient, InMemoryCache } from '@apollo/client/core'
import { DtModel, DtAnalysis, DtUtils } from '@dethernety/dt-core'

// Create Apollo Client
const apolloClient = new ApolloClient({
  uri: 'http://localhost:3000/graphql',
  cache: new InMemoryCache(),
})

// Initialize core API classes (typically done in Pinia stores)
const dtModel = new DtModel(apolloClient)
const dtAnalysis = new DtAnalysis(apolloClient)

// Library methods throw errors instead of returning null
try {
  const models = await dtModel.getModels()
  // Process successful result
} catch (error) {
  // Handle error (typically done by store layer)
  console.error('Failed to fetch models:', error)
}
```

### Integration with Pinia Stores

The recommended usage is through Pinia stores that handle business logic and error classification:

```typescript
// In your Pinia store
import { defineStore } from 'pinia'
import { DtModel } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

export const useModelStore = defineStore('models', () => {
  const models = ref<Model[]>([])
  const error = ref<string>('')
  
  // Initialize library
  const dtModel = new DtModel(apolloClient)
  
  // Store handles business logic and error classification
  const fetchModels = async (): Promise<Model[]> => {
    try {
      const result = await dtModel.getModels() // Library throws on error
      models.value = result
      return result
    } catch (err) {
      // Store classifies technical errors into user-friendly messages
      error.value = classifyError(err, 'fetch models')
      throw err // Re-throw for component handling
    }
  }
  
  const classifyError = (error: Error, operation: string): string => {
    if (error.message.includes('401')) return 'Please log in again'
    if (error.message.includes('403')) return 'Access denied'
    if (error.message.includes('network')) return 'Connection failed'
    return `Failed to ${operation}. Please try again.`
  }
  
  return { models, error, fetchModels }
})
```

## Production-Ready Features

### 1. Retry Logic with Exponential Backoff

Automatic retry for network-related failures:

```typescript
// Automatically retries network errors with exponential backoff
const models = await dtModel.getModels() // Retries 502, 503, 504, timeout errors

// Retry configuration (handled internally by DtUtils)
const DEFAULT_NETWORK_RETRY = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000
}
```

### 2. Request Deduplication

Prevents duplicate concurrent requests:

```typescript
// Multiple concurrent calls to the same operation are deduplicated
const [result1, result2, result3] = await Promise.all([
  dtModel.createModel(params), // Only one actual network request
  dtModel.createModel(params), // Waits for the first request
  dtModel.createModel(params)  // Waits for the first request
])
```

### 3. Mutex Protection

Prevents race conditions in critical operations:

```typescript
// Concurrent updates to the same resource are serialized
await Promise.all([
  dtModel.updateModel({ id: 'model-1', name: 'Name A' }),
  dtModel.updateModel({ id: 'model-1', name: 'Name B' }) // Waits for first to complete
])
```

### 4. Structured Error Logging

Detailed error context for debugging:

```typescript
// Errors are logged with structured information:
// {
//   timestamp: "2025-01-27T10:30:00.000Z",
//   action: "createModel",
//   message: "Network timeout",
//   type: "Error",
//   context: { attempt: 2, maxRetries: 3 }
// }
```

## Architecture

### Centralized Utilities (DtUtils)

All libraries use the `DtUtils` class for common functionality:

```typescript
export class DtUtils {
  // Core GraphQL operations with all optimizations
  async performQuery<T>(params): Promise<T>
  async performMutation<T>(params): Promise<T>
  
  // Concurrency control
  async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T>
  
  // Error handling and logging
  handleError({ action, error, context }): void
  
  // Network error detection and retry logic
  private isNetworkError(error: Error): boolean
  private async retryNetworkOperation<T>(...): Promise<T>
  
  // Request deduplication
  private async withDeduplication<T>(...): Promise<T>
}
```

### Standard Library Pattern

Each entity library follows a consistent pattern:

```typescript
export class DtSomeEntity {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient) // Centralized utilities
  }

  // Query operations
  getSomething = async (params): Promise<SomeType[]> => {
    try {
      return await this.dtUtils.performQuery({
        query: GET_SOMETHING_QUERY,
        variables: params,
        action: 'getSomething',
        fetchPolicy: 'network-only'
      })
    } catch (error) {
      throw error // Error already logged by dtUtils
    }
  }

  // Mutation operations with deduplication
  createSomething = async (params): Promise<SomeType> => {
    try {
      return await this.dtUtils.performMutation({
        mutation: CREATE_SOMETHING_MUTATION,
        variables: { input: [params] },
        dataPath: 'createSomethings.items.0',
        action: 'createSomething',
        deduplicationKey: `create-something-${params.name}-${params.parentId || 'root'}`
      })
    } catch (error) {
      throw error
    }
  }
}
```

### Core Components

| Component | Description | Key Methods |
|-----------|-------------|-------------|
| `DtModel` | **Threat Model Management** - Operations for threat models including creation, updates, data export/import, and model lifecycle management | `getModels()`, `getModel()`, `createModel()`, `updateModel()`, `deleteModel()`, `dumpModelData()`, `getModelData()`, `getNotRepresentingModels()` |
| `DtComponent` | **System Components** - Operations for system components like processes, data stores, and external entities within threat models | `createComponentNode()`, `updateComponent()`, `updateComponentClass()`, `updateComponentRepresentedModel()`, `getComponentRepresentedModel()`, `deleteComponent()` |
| `DtBoundary` | **Security Boundaries** - Operations for security boundaries and trust zones that define security perimeters in threat models | `createBoundaryNode()`, `updateBoundaryNode()`, `updateBoundaryClass()`, `updateBoundaryRepresentedModel()`, `getBoundaryRepresentedModel()`, `getDescendants()`, `deleteBoundary()` |
| `DtDataFlow` | **Data Flows** - Operations for data flows between components, representing how data moves through the system | `createDataFlow()`, `updateDataFlow()`, `updateDataFlowClass()`, `deleteDataFlow()` |
| `DtDataItem` | **Data Items** - Operations for data items that are carried by data flows, representing the actual data being transmitted | `createDataItem()`, `updateDataItem()`, `deleteDataItem()` |
| `DtExposure` | **Security Exposures** - Operations for managing security exposures and vulnerabilities identified in threat models | `getExposures()`, `getExposure()`, `createExposure()`, `updateExposure()`, `deleteExposure()` |
| `DtControl` | **Security Controls** - Operations for security controls that mitigate threats and reduce risk in the system | `getControls()`, `getControl()`, `createControl()`, `updateControl()`, `deleteControl()` |
| `DtCountermeasure` | **Countermeasures** - Operations for countermeasures that are linked to security controls for threat mitigation | `getCountermeasuresFromControl()`, `getCountermeasure()`, `createCountermeasure()`, `updateCountermeasure()`, `deleteCountermeasure()` |
| `DtClass` | **Class Definitions** - Operations for component and control class definitions that provide templates and attributes | `getComponentClass()`, `getBoundaryClass()`, `getDataFlowClass()`, `getDataClass()`, `getControlClasses()`, `getControlClassById()`, `setInstantiationAttributes()`, `getAttributesFromClassRelationship()` |
| `DtModule` | **Module Management** - Operations for managing modules that provide reusable components, classes, and configurations | `getModules()`, `getModuleById()`, `getModuleByName()`, `saveModule()`, `resetModule()` |
| `DtAnalysis` | **AI-Powered Analysis** - Operations for AI-powered threat analysis, including analysis execution, chat interactions, and result processing | `findAnalysisClasses()`, `findAnalyses()`, `createAnalysis()`, `updateAnalysis()`, `deleteAnalysis()`, `runAnalysis()`, `resumeAnalysis()`, `getAnalysisValues()`, `subscribeToStream()`, `startChat()` |
| `DtMitreAttack` | **MITRE ATT&CK Integration** - Operations for integrating with the MITRE ATT&CK framework for threat intelligence | `getMitreAttackTechnique()`, `getMitreAttackMitigation()`, `getMitreAttackTactics()` |
| `DtMitreDefend` | **MITRE D3FEND Integration** - Operations for integrating with the MITRE D3FEND framework for defensive countermeasures | `getMitreDefendTechnique()`, `fetchMitreDefendTactics()` |
| `DtFolder` | **Folder Management** - Operations for organizing threat models and related artifacts in a hierarchical folder structure | `getFolders()`, `createFolder()`, `updateFolder()`, `deleteFolder()` |
| `DtIssue` | **Issue Tracking** - Operations for managing issues, findings, and action items identified during threat modeling activities | `findIssueClasses()`, `findIssues()`, `createIssue()`, `updateIssue()`, `deleteIssue()`, `addElementsToIssue()`, `removeElementFromIssue()` |
| `DtUtils` | **Core Utilities** - Centralized utilities providing error handling, retry logic, mutex protection, request deduplication, and GraphQL operations | `performQuery()`, `performMutation()`, `withMutex()`, `handleError()`, `deepMerge()`, `getValueFromPath()` |

## Example: Working with Models

```typescript
import { DtModel } from '@dethernety/dt-core'

const dtModel = new DtModel(apolloClient)

try {
  // Create a new model (throws on error, never returns null)
  const newModel = await dtModel.createModel({ 
    name: 'My Threat Model', 
    description: 'Description of my threat model',
    modules: ['module-id-1', 'module-id-2'] 
  })
  console.log('Model created:', newModel.id)

  // Get all models (with automatic retry on network errors)
  const models = await dtModel.getModels()
  
  // Get model data including components, boundaries, and data flows
  const modelData = await dtModel.dumpModelData({ modelId: newModel.id })

  // Update a model (with mutex protection against concurrent updates)
  const updatedModel = await dtModel.updateModel({
    id: newModel.id,
    name: 'Updated Model Name',
    description: 'Updated description',
    modules: ['module-id-1', 'module-id-2'],
    controls: ['control-id-1', 'control-id-2']
  })

  // Delete a model
  const deleteResult = await dtModel.deleteModel({ modelId: newModel.id })
  console.log('Model deleted:', deleteResult)
  
} catch (error) {
  // Library throws errors with detailed context
  // Store layer should handle error classification
  console.error('Model operation failed:', error.message)
}
```

## Example: Working with Analysis

```typescript
import { DtAnalysis } from '@dethernety/dt-core'

const dtAnalysis = new DtAnalysis(apolloClient)

try {
  // Find analysis classes (with request deduplication)
  const analysisClasses = await dtAnalysis.findAnalysisClasses({
    classType: 'security',
    moduleId: 'security-module-id'
  })

  // Create analysis (with automatic deduplication of concurrent requests)
  const newAnalysis = await dtAnalysis.createAnalysis({
    elementId: 'component-id',
    name: 'Security Analysis',
    description: 'Automated security analysis',
    analysisClassId: analysisClasses[0].id
  })

  // Run analysis (with retry logic for network failures)
  const sessionId = await dtAnalysis.runAnalysis({
    analysisId: newAnalysis.id,
    additionalParams: { depth: 'comprehensive' }
  })

  // Subscribe to analysis stream
  const subscription = dtAnalysis.subscribeToStream({ sessionId })
  subscription?.subscribe({
    next: (result) => console.log('Analysis update:', result),
    error: (err) => console.error('Stream error:', err),
    complete: () => console.log('Analysis completed')
  })

} catch (error) {
  // All errors are thrown with context, never returns null
  console.error('Analysis operation failed:', error.message)
}
```

## Example: Working with Components

```typescript
import { DtComponent, DtClass } from '@dethernety/dt-core'

const dtComponent = new DtComponent(apolloClient)
const dtClass = new DtClass(apolloClient)

try {
  // Get component class for instantiation
  const webServerClass = await dtClass.getComponentClass({
    classId: 'web-server-class-id'
  })

  // Create a component (with deduplication key to prevent duplicates)
  const newComponent = await dtComponent.createComponentNode({
    modelId: 'model-id',
    boundaryId: 'boundary-id',
    name: 'Web Server',
    description: 'Frontend web server',
    classId: webServerClass.id,
    positionX: 100,
    positionY: 200
  })

  // Update component with instantiation attributes
  await dtClass.setInstantiationAttributes({
    componentId: newComponent.id,
    attributes: JSON.stringify({
      deploymentType: 'container',
      credentialStorage: 'encrypted',
      httpPort: 443,
      httpsEnabled: true
    })
  })

  // Update component class (with mutex protection)
  await dtComponent.updateComponentClass({
    componentId: newComponent.id,
    classId: 'updated-web-server-class-id'
  })

} catch (error) {
  // Detailed error information for debugging
  console.error('Component operation failed:', error.message)
  // Error contains full context: timestamp, action, type, etc.
}
```

## Error Handling

### Library Layer: Technical Error Handling

All API methods use centralized error handling through the `DtUtils` class:

```typescript
// Library methods throw errors (never return null)
try {
  const models = await dtModel.getModels()
  // Success - process the result
} catch (error) {
  // Error is already logged with structured context by DtUtils:
  // {
  //   timestamp: "2025-01-27T10:30:00.000Z",
  //   action: "getModels", 
  //   message: "Network timeout",
  //   type: "Error",
  //   stack: "...",
  //   context: { attempt: 2, maxRetries: 3 }
  // }
  
  // Library focuses on technical errors only
  // Store layer should classify errors for users
  throw error // Re-throw for store layer
}
```

### Network Error Retry

The library automatically retries network-related failures:

```typescript
// These errors trigger automatic retry with exponential backoff:
// - Network timeouts
// - Connection failures  
// - HTTP 502, 503, 504 errors
// - DNS resolution failures

// These errors do NOT trigger retry:
// - HTTP 400, 401, 403, 404 (client errors)
// - GraphQL validation errors
// - Business logic errors

const models = await dtModel.getModels()
// Automatically retries up to 3 times for network errors
// Throws immediately for non-retryable errors
```

### Error Classification in Stores

The recommended pattern is to handle error classification in Pinia stores:

```typescript
// In your Pinia store
const handleApiError = (operation: string, error: Error): string => {
  console.error(`${operation} failed:`, error)
  
  // Classify technical errors into user-friendly messages
  if (error.message.includes('401')) {
    return 'Your session has expired. Please log in again.'
  }
  if (error.message.includes('403')) {
    return 'You do not have permission to perform this action.'
  }
  if (error.message.includes('404')) {
    return 'The requested resource was not found.'
  }
  if (error.message.includes('network') || error.message.includes('timeout')) {
    return 'Connection failed. Please check your internet connection.'
  }
  if (error.message.includes('No data returned')) {
    return `The ${operation} completed but returned no data. Please try again.`
  }
  
  return `Failed to ${operation.toLowerCase()}. Please try again or contact support.`
}

const createModel = async (params) => {
  try {
    const model = await dtModel.createModel(params) // Throws on error
    return model
  } catch (err) {
    error.value = handleApiError('create model', err)
    throw err // Re-throw for component handling
  }
}
```

## Best Practices

### 1. Always Use Through Stores

❌ **Don't use dt-core directly in components:**
```typescript
// BAD: Direct usage in components
import { DtModel } from '@dethernety/dt-core'
const dtModel = new DtModel(apolloClient)
const models = await dtModel.getModels() // No error classification
```

✅ **Use through Pinia stores:**
```typescript
// GOOD: Use through store layer
const modelStore = useModelStore()
const models = await modelStore.fetchModels() // Proper error handling
```

### 2. Handle All Errors

❌ **Don't ignore errors:**
```typescript
// BAD: Unhandled errors
const models = await dtModel.getModels()
```

✅ **Always handle errors:**
```typescript
// GOOD: Proper error handling
try {
  const models = await dtModel.getModels()
  // Process success
} catch (error) {
  // Handle or re-throw error
  console.error('Failed to fetch models:', error)
  throw error
}
```

### 3. Leverage Built-in Features

✅ **Use deduplication for mutations:**
```typescript
// Automatic deduplication prevents duplicate creates
await dtModel.createModel({
  name: 'My Model',
  // ... other params
}) // Uses deduplication key based on name and parent
```

✅ **Rely on automatic retry:**
```typescript
// Network errors are automatically retried
const models = await dtModel.getModels() // Retries network failures
```

## Development

### Adding a New Entity Type

1. **Create entity directory:**
   ```bash
   mkdir src/dt-{entity-type}
   ```

2. **Create required files:**
   ```
   src/dt-{entity-type}/
   ├── dt-{entity-type}.ts      # Main entity class
   ├── dt-{entity-type}-gql.ts  # GraphQL queries/mutations
   └── index.ts                 # Exports
   ```

3. **Implement entity class following the standard pattern:**
   ```typescript
   export class DtEntityType {
     private dtUtils: DtUtils
     private apolloClient: ApolloClient<NormalizedCacheObject>

     constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
       this.apolloClient = apolloClient
       this.dtUtils = new DtUtils(apolloClient)
     }

     // Follow standard patterns for all methods
     getEntities = async (params): Promise<EntityType[]> => {
       try {
         return await this.dtUtils.performQuery({
           query: GET_ENTITIES_QUERY,
           variables: params,
           action: 'getEntities',
           fetchPolicy: 'network-only'
         })
       } catch (error) {
         throw error
       }
     }
   }
   ```

4. **Export from main index:**
   ```typescript
   // src/index.ts
   export { DtEntityType } from './dt-{entity-type}'
   export type { EntityType } from './interfaces/core-types-interface'
   ```

### Building

```bash
# Build the package
pnpm build

# Watch for changes during development  
pnpm dev

# Run tests
pnpm test

# Type checking
pnpm type-check
```

### Testing

Follow the established testing patterns:

```typescript
// entity.test.ts
describe('DtEntityType', () => {
  let dtEntity: DtEntityType
  let mockClient: any

  beforeEach(() => {
    mockClient = mockApolloClient()
    dtEntity = new DtEntityType(mockClient)
  })

  it('should handle successful operations', async () => {
    mockClient.query.mockResolvedValue({
      data: { entities: [{ id: '1', name: 'Test' }] }
    })

    const result = await dtEntity.getEntities({})
    expect(result).toEqual([{ id: '1', name: 'Test' }])
  })

  it('should handle errors properly', async () => {
    mockClient.query.mockRejectedValue(new Error('Network error'))
    
    await expect(dtEntity.getEntities({}))
      .rejects.toThrow('Network error')
  })
})
```

## License

Copyright © 2025 Dethernety. All rights reserved. 