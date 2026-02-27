# Apollo Client Configuration

## Table of Contents
- [Overview](#overview)
- [Multi-Transport Architecture](#multi-transport-architecture)
- [Link Chain Architecture](#link-chain-architecture)
- [Authentication Integration](#authentication-integration)
- [Subscription Transports](#subscription-transports)
- [Cache Configuration](#cache-configuration)
- [Initialization Pattern](#initialization-pattern)
- [Error Handling](#error-handling)

## Overview

The Apollo Client configuration provides a production-ready GraphQL client with:
- Dual subscription transport support (SSE/WebSocket)
- Automatic token injection and refresh
- Structured error handling with auth failure detection
- Optimized cache policies for threat modeling data

**Primary Source File:** `apps/dt-ui/src/plugins/apolloClient.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Apollo Client Architecture                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                        ┌─────────────────────┐                          │
│                        │   Apollo Client     │                          │
│                        │    (Lazy Init)      │                          │
│                        └──────────┬──────────┘                          │
│                                   │                                     │
│                        ┌──────────┴──────────┐                          │
│                        │      Split Link     │                          │
│                        └──────────┬──────────┘                          │
│                    ┌──────────────┴──────────────┐                      │
│                    │                             │                      |
│               Subscriptions            Queries/Mutations                │
│                    │                             │                      │
│          ┌─────────┴─────────┐     ┌─────────────┴─────────────┐        │
│          │ SSE/WS Transport  │     │      Error Link           │        │
│          └───────────────────┘     └─────────────┬─────────────┘        │
│                                    ┌─────────────┴─────────────┐        │
│                                    │       Auth Link           │        │
│                                    │  (ensureValidToken)       │        │
│                                    └─────────────┬─────────────┘        │
│                                    ┌─────────────┴─────────────┐        │
│                                    │       HTTP Link           │        │
│                                    └───────────────────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Transport Architecture

### Transport Selection

**Source:** `apolloClient.ts:16-20`

The transport type is determined at runtime from configuration:

```typescript
async function createApolloClient() {
  const config = await getConfig()
  const useWebSocket = config.subscriptionTransport === 'ws'

  console.log(`[ApolloClient] Subscription transport: ${useWebSocket ? 'WebSocket' : 'SSE'}`)

  // ... transport-specific setup
}
```

### When to Use Each Transport

| Transport | Use Case | Benefits | Limitations |
|-----------|----------|----------|-------------|
| **SSE** | CDN deployments, CloudFront | Works through CDN/proxy, HTTP-based | Unidirectional, reconnection overhead |
| **WebSocket** | Direct server access | Bidirectional, lower latency | May not work through CDN/proxy |

**Default:** SSE (for broader infrastructure compatibility)

---

## Link Chain Architecture

### Link Order (Critical)

**Source:** `apolloClient.ts:152-163`

The order of links matters for correct behavior:

```typescript
const httpChain = from([
  errorLink,    // 1. First: Catch all errors
  authLink,     // 2. Second: Inject auth token
  httpLink      // 3. Last: Execute request
])

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query)
    return (
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'subscription'
    )
  },
  subscriptionLink,  // Subscriptions bypass error/auth links
  httpChain          // Queries/mutations go through full chain
)
```

**Why This Order:**
1. **errorLink first**: Catches GraphQL and network errors before they propagate
2. **authLink second**: Ensures token is valid and attached before request
3. **httpLink last**: Actually sends the request

### Split Link Routing

```
┌─────────────────────────────────────────────────────────┐
│                    Incoming Operation                   │
└─────────────────────────────┬───────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  Is Subscription? │
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │                   │
                   Yes                  No
                    │                   │
         ┌──────────┴──────────┐   ┌────┴────────────────────┐
         │  Subscription Link  │   │ errorLink → authLink →  │
         │  (SSE or WebSocket) │   │ httpLink                │
         └─────────────────────┘   └─────────────────────────┘
```

---

## Authentication Integration

### Auth Link Implementation

**Source:** `apolloClient.ts:44-59`

```typescript
const authLink = setContext(async (_, { headers }) => {
  const authStore = useAuthStore()

  // CRITICAL: This call may trigger token refresh
  // If token is expiring soon (< 5 min), refreshToken is called
  await authStore.ensureValidToken()

  const token = authStore.token

  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }
})
```

**Key Behavior:**
- `ensureValidToken()` is async - waits for refresh if needed
- Token refresh uses mutex to prevent concurrent refreshes
- Empty token results in no Authorization header (unauthenticated request)

### ensureValidToken Flow

```
┌─────────────────────────────────────────────────────────┐
│               ensureValidToken() Called                  │
└─────────────────────────────┬───────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │ Token valid and   │
                    │ not expiring soon?│
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │                   │
                   Yes                  No
                    │                   │
              Return immediately    ┌───┴───┐
                                    │       │
                          Refresh in progress?
                                    │       │
                                   Yes      No
                                    │       │
                            Await existing  Start new
                            promise         refresh
```

---

## Subscription Transports

### WebSocket Transport

**Source:** `apolloClient.ts:85-110`

```typescript
const createWebSocketLink = () => {
  const wsClient = createWsClient({
    url: wsUrl,

    // Auth: Token passed via connection parameters
    connectionParams: () => {
      const authStore = useAuthStore()
      const token = authStore.token
      return token ? { Authorization: `Bearer ${token}` } : {}
    },

    // Reconnection settings
    retryAttempts: 5,
    connectionAckWaitTimeout: 10000,

    // Error handling
    on: {
      error: (error: unknown) => {
        console.error('[WebSocket] Error:', error)

        // Detect auth failures
        const errorMessage = (error as any)?.message || ''
        if (errorMessage.includes('Unauthorized') ||
            errorMessage.includes('401')) {
          const authStore = useAuthStore()
          authStore.clearState()
          window.location.href = '/login'
        }
      }
    }
  })

  return new GraphQLWsLink(wsClient)
}
```

**WebSocket Auth Notes:**
- Token is passed at connection time via `connectionParams`
- Token refresh requires reconnection (WebSocket limitation)
- 401 errors trigger session clear and redirect

### SSE Transport

**Source:** `apolloClient.ts:112-149`

```typescript
const createSSELink = () => {
  const sseClient = createSseClient({
    url: sseUrl,

    // Auth: Token passed via HTTP headers
    headers: (): Record<string, string> => {
      const authStore = useAuthStore()
      const token = authStore.token
      if (token) {
        return { Authorization: `Bearer ${token}` }
      }
      return {}
    }
  })

  // Wrap SSE client in Apollo Link
  return new ApolloLink((operation) => {
    return new Observable((observer) => {
      const { query, variables, operationName } = operation

      const subscription = sseClient.subscribe({
        query: print(query),  // Convert to string
        variables,
        operationName
      }, {
        next: (data) => observer.next(data),
        error: (err) => observer.error(err),
        complete: () => observer.complete()
      })

      return () => subscription.unsubscribe()
    })
  })
}
```

**SSE Advantages:**
- Headers sent per-request (token always current)
- Works through CDN/proxy (HTTP-based)
- Automatic reconnection by browser

---

## Cache Configuration

### Type Policies

**Source:** `apolloClient.ts:167-224`

Cache policies define how Apollo merges and stores data:

```typescript
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        // Replace arrays entirely (don't merge)
        folders: {
          merge(existing, incoming) {
            return incoming
          }
        },
        analyses: {
          merge(existing, incoming) {
            return incoming
          }
        }
      }
    },

    Folder: {
      fields: {
        // Nested folder fields
        models: { merge: (_, incoming) => incoming },
        childFolders: { merge: (_, incoming) => incoming },
        analyses: { merge: (_, incoming) => incoming }
      }
    },

    Issue: {
      fields: {
        // Issue element relationships
        elements: { merge: (_, incoming) => incoming },
        elementsWithExtendedInfo: { merge: (_, incoming) => incoming }
      }
    }
  }
})
```

**Merge Strategy:**
- **Replace incoming**: Always use server data, never merge with cache
- **Prevents stale data**: Important for real-time collaborative editing

### Why Not Merge?

```typescript
// Problem with default merge:
// Cache: { models: [A, B] }
// Server: { models: [A, C] }
// Default merge: { models: [A, B, C] }  <- WRONG!
// Replace merge: { models: [A, C] }      <- CORRECT!
```

---

## Initialization Pattern

### Lazy Initialization

**Source:** `apolloClient.ts:229-255`

The client uses lazy initialization with a proxy pattern:

```typescript
// Private state
let apolloClient: ApolloClient<NormalizedCacheObject> | null = null
let initPromise: Promise<ApolloClient<NormalizedCacheObject>> | null = null

// Async getter
export async function getApolloClient(): Promise<ApolloClient<NormalizedCacheObject>> {
  if (apolloClient) {
    return apolloClient
  }

  if (!initPromise) {
    initPromise = createApolloClient()
  }

  apolloClient = await initPromise
  return apolloClient
}

// Synchronous proxy for immediate access
export default new Proxy({} as ApolloClient<NormalizedCacheObject>, {
  get(target, prop) {
    if (!apolloClient) {
      throw new Error('Apollo client accessed before initialization')
    }
    return (apolloClient as any)[prop]
  }
})
```

**Usage Pattern:**

```typescript
// In application startup (main.ts)
await initializeApolloClient()

// In stores (after initialization)
import apolloClient from '@/plugins/apolloClient'
const dtAnalysis = new DtAnalysis(apolloClient)
```

### Initialization Sequence

**Source:** `main.ts:26-47`

```typescript
async function bootstrap() {
  const app = createApp(App)

  // 1. Initialize Apollo client (async - fetches config)
  await initializeApolloClient()

  // 2. Setup plugins (router, pinia, vuetify)
  app.use(createPinia())
  app.use(router)
  app.use(vuetify)

  // 3. Expose host dependencies for modules
  ModuleLoader.exposeHostDependencies(VueRuntime, app._context)

  // 4. Load dynamic modules
  await ModuleLoader.loadAvailableModules()

  // 5. Mount application
  app.mount('#app')
}
```

---

## Error Handling

### Error Link

**Source:** `apolloClient.ts:61-80`

```typescript
const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  // GraphQL errors (validation, resolver errors)
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path, extensions }) => {
      console.error(
        `[GraphQL Error] ${message}`,
        { locations, path, extensions, operation: operation.operationName }
      )
    })
  }

  // Network errors (connection, timeout)
  if (networkError) {
    console.error('[Network Error]', networkError)

    // Detect auth failures
    const statusCode = (networkError as any)?.statusCode
    if (statusCode === 401 || statusCode === 403) {
      const authStore = useAuthStore()
      authStore.clearState()
      window.location.href = '/login'
    }
  }
})
```

### Error Flow

```
┌─────────────────────────────────────────────────────────┐
│                    GraphQL Operation                    │
└─────────────────────────────┬───────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Error Occurs    │
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │                   │
              GraphQL Error        Network Error
                    │                   │
              Log with context    ┌─────┴─────┐
                    │             │           │
                    │          401/403      Other
                    │             │           │
                    │        Clear auth   Log error
                    │        Redirect
                    │             │
                    └──────┬──────┘
                           │
                    Propagate to caller
```

### HTTP Link Configuration

**Source:** `apolloClient.ts:30-42`

```typescript
const httpLink = createHttpLink({
  uri: graphqlUrl,
  fetch: (uri, options) => {
    // Custom fetch with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    return fetch(uri, {
      ...options,
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId))
  }
})
```

---

## Configuration Reference

### URL Configuration

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_GRAPHQL_URL` | GraphQL HTTP endpoint | `https://api.example.com/graphql` |
| `VITE_WS_URL` | WebSocket endpoint | `wss://api.example.com/graphql` |
| `VITE_SSE_URL` | SSE endpoint | `https://api.example.com/graphql/stream` |
| `VITE_SUBSCRIPTION_TRANSPORT` | Transport type | `sse` or `ws` |

### Runtime Configuration

```typescript
// Fetched from /config endpoint in production
interface FrontendConfig {
  graphqlUrl: string
  wsUrl?: string
  sseUrl?: string
  subscriptionTransport: 'sse' | 'ws'
  // ... other config
}
```

---

## Integration with dt-core

### Query Class Pattern

**Source:** `packages/dt-core/src/dt-utils/dt-utils.ts`

All dt-core classes receive the Apollo client at construction:

```typescript
export class DtAnalysis {
  private apolloClient: ApolloClient<NormalizedCacheObject>
  private dtUtils: DtUtils

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  findAnalyses = async (params: QueryParams): Promise<Analysis[]> => {
    return this.dtUtils.performQuery({
      query: FIND_ANALYSES,
      variables: params,
      action: 'findAnalyses',
      fetchPolicy: 'network-only'
    })
  }
}
```

### Store Initialization

**Source:** `stores/flowStore.ts:18-29`

```typescript
import apolloClient from '@/plugins/apolloClient'

export const useFlowStore = defineStore('flow', () => {
  // Initialize all dt-core classes with the shared client
  const dtUtils = new DtUtils(apolloClient)
  const dtModel = new DtModel(apolloClient)
  const dtComponent = new DtComponent(apolloClient)
  const dtBoundary = new DtBoundary(apolloClient)
  const dtDataflow = new DtDataflow(apolloClient)
  // ... more classes

  // Store actions use these classes
  const loadModel = async (modelId: string) => {
    const model = await dtModel.getModel({ modelId })
    // ...
  }
})
```
