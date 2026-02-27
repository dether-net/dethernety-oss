# Frontend Architecture

> Comprehensive technical documentation for the Dethernety frontend platform

## Overview

The Dethernety frontend is a Vue 3 single-page application providing an interactive threat modeling interface. It features a visual data flow editor, real-time AI analysis integration, and a dynamic module system for extensibility.

---

## Technology Stack

### Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vue 3** | 3.5+ | Reactive UI framework with Composition API |
| **TypeScript** | 5.9+ | Type-safe development |
| **Vite** | 7.2+ | Build tool with HMR and optimized bundling |
| **Vue Router** | 4.6+ | File-based routing with auto-generation |

### UI Components

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vuetify** | 3.9+ | Material Design component library |
| **Vue Flow** | 1.47+ | Node-based diagram editor |
| **JSONForms** | 3.7+ | Dynamic form generation from JSON Schema |
| **Chart.js** | 4.5+ | Data visualization |
| **Mermaid** | 11.12+ | Diagram rendering |

### State & Data

| Technology | Version | Purpose |
|------------|---------|---------|
| **Pinia** | 3.0+ | Composition API-based state management |
| **Apollo Client** | 3.14+ | GraphQL client with caching |
| **graphql-ws** | 2.6+ | WebSocket subscription transport |
| **graphql-sse** | 2.6+ | SSE subscription transport |

### Authentication

| Technology | Purpose |
|------------|---------|
| **OIDC/OAuth2** | Enterprise identity integration |
| **jwt-decode** | Token parsing and validation |
| **PKCE Flow** | Secure authorization code exchange |

---

## Application Structure

```
apps/dt-ui/src/
│
├── main.ts                      # Application entry point
├── App.vue                      # Root component
│
├── pages/                       # Auto-routed page components
│   ├── index.vue               # Dashboard
│   ├── dataflow.vue            # Data flow editor
│   ├── browser.vue             # Model browser
│   ├── issues.vue              # Issue management
│   ├── modules.vue             # Module configuration
│   ├── analysisresults.vue     # Analysis results viewer
│   └── auth/                   # Authentication routes
│
├── components/                  # Reusable components
│   ├── DataFlow/               # Data flow editor components
│   │   ├── DataFlow.vue        # Main editor
│   │   ├── Nodes/              # Node type renderers
│   │   └── SettingsTabs/       # Property panel tabs
│   └── Dialogs/                # Dialog components by feature
│
├── stores/                      # Pinia state stores
│   ├── authStore.ts            # Authentication state
│   ├── flowStore.ts            # Diagram state
│   ├── analysisStore.ts        # Analysis execution
│   ├── modelsStore.ts          # Model CRUD
│   ├── modulesStore.ts         # Module management
│   ├── controlsStore.ts        # Security controls
│   └── issueStore.ts           # Issue tracking
│
├── plugins/                     # Vue plugins
│   ├── apolloClient.ts         # GraphQL client setup
│   └── vuetify.ts              # UI framework config
│
├── composables/                 # Reusable composition functions
├── services/                    # Service classes
├── config/                      # Configuration management
├── layouts/                     # Page layouts
├── types/                       # TypeScript definitions
└── utils/                       # Utility functions
```

---

## Core Modules

### 1. Data Layer (Pinia Stores)

Pinia stores serve as the **single point of backend integration** for all data operations. This architectural pattern ensures that all GraphQL queries, mutations, and subscriptions flow through stores—whether the data is persisted as application state or retrieved ephemerally for immediate use.

**Shared Query Classes**: All GraphQL operations are implemented as reusable classes in `@packages/dt-core`, not as inline queries. Pinia stores exclusively use these shared classes for all backend communication. This ensures **consistency across all interfaces**—the same query implementations are used by the UI, CLI tool, and MCP server.

This centralized approach provides:
- **Consistent API access patterns** across all components and interfaces
- **Single source of truth** for GraphQL operations (`@packages/dt-core`)
- **Unified error handling and loading states**
- **Automatic cache management** where appropriate
- **Clear separation** between UI components and data fetching logic

#### Store Overview

| Store | Purpose | Key Capabilities |
|-------|---------|------------------|
| **AuthStore** | Authentication & OIDC | PKCE flow, token refresh, multi-provider support (Cognito, Keycloak, Auth0, Zitadel) |
| **FlowStore** | Data flow diagram | Node/edge management, optimistic updates, undo/redo, Vue Flow integration |
| **AnalysisStore** | AI analysis | Analysis execution, real-time result streaming via subscriptions, status tracking |
| **ModelsStore** | Threat model CRUD | Model listing, creation, deletion, metadata management |
| **FolderStore** | Folder hierarchy | Folder tree management, model organization, navigation state |
| **IssueStore** | Issue tracking | Issue CRUD, status management, element linkage |
| **ControlsStore** | Security controls | Control management, countermeasure handling, MITRE D3FEND integration |
| **ModulesStore** | Module management | Available modules, module metadata, class definitions |

> **Note**: Detailed store documentation including state interfaces, actions, and implementation patterns is available in the [LLD documentation](./LLD/).

### 2. GraphQL Client (Apollo)

Centralized GraphQL client configuration with authentication and subscription support.

```typescript
// apolloClient.ts - Key Configuration

const apolloClient = new ApolloClient({
  link: ApolloLink.from([
    authLink,       // Injects Bearer token
    errorLink,      // Handles errors globally
    splitLink       // Routes to HTTP or subscription transport
  ]),
  cache: new InMemoryCache({
    typePolicies: { /* Custom merge policies */ }
  })
});
```

**Subscription Transport Selection:**

```typescript
// SSE (default) - CDN/CloudFront compatible
const sseLink = new SSELink({
  url: '/graphql',
  headers: () => ({ Authorization: `Bearer ${token}` })
});

// WebSocket - On-premise deployments
const wsLink = new GraphQLWsLink(
  createClient({ url: wsUrl, connectionParams: { token } })
);
```

**Error Handling:**

```typescript
const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ extensions }) => {
      if (extensions?.code === 'UNAUTHENTICATED') {
        authStore.logout();
      }
    });
  }
});
```

### 3. Data Flow Editor

Interactive diagram editor built on Vue Flow.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Data Flow Editor                                │
├─────────────────────────────────────────────────────────────────────────┤
│    ┌─────────────────────────────────────────────┐  ┌───────────────┐   │
│    │              Canvas                         │  │   Palette     │   │
│    │                                             │  │               │   │
│    │   ┌─────┐         ┌─────┐                   │  │  [Process]    │   │
│    │   │ P1  │─────────│ S1  │                   │  │  [Store]      │   │
│    │   └─────┘         └─────┘                   │  │  [ExtEntity]  │   │
│    │                                             │  │  [Boundary]   │   │
│    │   ┌─────────────────────────────────────┐   │  │               │   │
│    │   │        Trust Boundary               │   │  └───────────────┘   │
│    │   │   ┌─────┐                           │   │                      │
│    │   │   │ P2  │                           │   │                      │
│    │   │   └─────┘                           │   │                      │
│    │   └─────────────────────────────────────┘   │                      │
│    └─────────────────────────────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Properties Panel (JSONForms)                 │    │
│  │  Name: [___________]  Type: [Process ▼]  MITRE: [T1190 ▼]       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Node Types:**

| Node Type | Component | Visual |
|-----------|-----------|--------|
| Process | `ProcessNode.vue` | Circle |
| Store | `StoreNode.vue` | Cylinder |
| External Entity | `ExtEntNode.vue` | Rectangle |
| Trust Boundary | `BoundaryNode.vue` | Dashed container |

**Key Features:**
- Drag-and-drop from palette
- Edge creation via connection handles
- Multi-select with Shift+Click
- Nested boundaries with parent-child relationships
- Real-time property editing with JSONForms

### 4. Dynamic Module System

Runtime-extensible architecture for frontend plugins.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Module Loading Flow                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. App Startup                                                         │
│     └─→ ModuleLoader.exposeHostDependencies()                           │
│         └─→ Exposes Vue, Pinia, composables to window                   │
│                                                                         │
│  2. Module Discovery                                                    │
│     └─→ ModuleLoader.loadAvailableModules()                             │
│         └─→ GraphQL query for module bundles                            │
│                                                                         │
│  3. Module Installation                                                 │
│     └─→ For each module:                                                │
│         ├─→ Create blob URL from bundle string                          │
│         ├─→ Dynamic import(blobUrl)                                     │
│         └─→ Call module.install(hostDependencies)                       │
│                                                                         │
│  4. Component Registration                                              │
│     └─→ ComponentRegistry.register(name, component)                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Host Dependencies:**

```typescript
// Exposed to modules via window.__DETHERNETY_HOST__
interface HostDependencies {
  vue: typeof Vue;
  pinia: Pinia;
  apolloClient: ApolloClient;
  composables: {
    useHostContext: () => HostContext;
    useModuleManager: () => ModuleManager;
  };
}
```

### 5. Authentication Flow

OIDC/OAuth2 implementation with PKCE.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Authentication Flow                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User clicks Login                                                   │
│     └─→ authStore.login()                                               │
│         ├─→ Generate state, nonce, code_verifier                        │
│         ├─→ Store in sessionStorage                                     │
│         └─→ Redirect to OIDC provider                                   │
│                                                                         │
│  2. Provider redirects back with code                                   │
│     └─→ /auth/callback route                                            │
│         └─→ authStore.handleCallback()                                  │
│             ├─→ Validate state parameter                                │
│             ├─→ Exchange code for tokens (with code_verifier)           │
│             └─→ Store tokens, decode user info                          │
│                                                                         │
│  3. Authenticated requests                                              │
│     └─→ Apollo authLink                                                 │
│         └─→ Injects Authorization: Bearer {token}                       │
│                                                                         │
│  4. Token refresh (before expiration)                                   │
│     └─→ authStore.ensureValidToken()                                    │
│         └─→ If token expires in < 5 min                                 │
│             └─→ authStore.refreshToken()                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Supported Providers:**

| Provider | Configuration |
|----------|---------------|
| AWS Cognito | Hosted UI with custom domain support |
| Keycloak | Realm-based endpoints |
| Auth0 | Tenant URL configuration |
| Zitadel | Standard OIDC discovery |
| Generic OIDC | Manual endpoint configuration |

---

## Build Configuration

### Vite Configuration

```typescript
// vite.config.mts - Key settings

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    VueRouter({ /* auto-routes from pages/ */ }),
    AutoImport({ /* Vue composables */ }),
    Components({ /* auto-register components */ }),
  ],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-apollo': ['@apollo/client', 'graphql'],
          'vendor-ui': ['vuetify'],
          'vue-flow': ['@vue-flow/core', '@vue-flow/background', ...],
          'json-forms': ['@jsonforms/core', '@jsonforms/vue', ...],
        }
      }
    }
  },

  server: {
    host: '0.0.0.0',
    port: 3005,
    proxy: {
      '/graphql': 'http://localhost:3003',
      '/health': 'http://localhost:3003'
    }
  }
});
```

### Chunk Strategy

| Chunk | Contents | Caching Strategy |
|-------|----------|------------------|
| `vendor-vue` | Vue, Router, Pinia | Long-term (framework) |
| `vendor-apollo` | Apollo, GraphQL | Long-term (stable) |
| `vendor-ui` | Vuetify | Long-term (UI framework) |
| `vue-flow` | Diagram library | Medium-term |
| `json-forms` | Form library | Medium-term |
| `app` | Application code | Short-term (frequent updates) |

---

## Configuration Management

### Environment Variables

```typescript
// config/environment.ts

interface FrontendConfig {
  // Application
  nodeEnv: 'development' | 'production';
  appUrl: string;
  appBaseUrl: string;

  // API
  apiBaseUrl: string;
  graphqlUrl: string;
  subscriptionTransport: 'sse' | 'ws';
  graphqlWsUrl?: string;

  // Authentication
  oidcIssuer: string;
  oidcClientId: string;
  oidcRedirectUri: string;
  oidcProvider: 'cognito' | 'keycloak' | 'auth0' | 'zitadel' | 'generic';

  // Features
  debugAuth: boolean;
  enableDevTools: boolean;
}
```

### Configuration Loading

```typescript
// Async loading with provider auto-detection
const config = await getConfig();

// Provider detection from issuer URL
if (issuer.includes('cognito')) provider = 'cognito';
else if (issuer.includes('keycloak')) provider = 'keycloak';
// ...
```

---

## Routing

### File-Based Routes

Routes auto-generated from `pages/` directory:

| File | Route | Auth Required |
|------|-------|---------------|
| `pages/index.vue` | `/` | Yes |
| `pages/dataflow.vue` | `/dataflow` | Yes |
| `pages/browser.vue` | `/browser` | Yes |
| `pages/issues.vue` | `/issues` | Yes |
| `pages/modules.vue` | `/modules` | Yes |
| `pages/login.vue` | `/login` | No |
| `pages/auth/callback.vue` | `/auth/callback` | No |

### Navigation Guard

```typescript
// router/index.ts
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();

  if (to.path.startsWith('/auth') || to.path === '/login') {
    next();
  } else if (!authStore.isAuthenticated) {
    next('/login');
  } else {
    next();
  }
});
```

---

## Performance Optimizations

### Code Splitting

- **Lazy Routes**: Pages loaded on-demand via dynamic imports
- **Vendor Chunks**: Framework code cached separately from app code
- **Component Auto-Import**: Tree-shaking removes unused components

### State Persistence

```typescript
// stores/index.ts
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

// Individual store configuration
export const useAuthStore = defineStore('auth', () => {
  // ...
}, {
  persist: {
    paths: ['token', 'refreshToken', 'user']
  }
});
```

### Apollo Cache

```typescript
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        models: {
          merge(existing = [], incoming) {
            return [...existing, ...incoming];
          }
        }
      }
    }
  }
});
```

---

## Development Workflow

### Commands

```bash
# Development server with HMR
pnpm dev

# Type checking
vue-tsc --noEmit

# Production build
pnpm build:production

# Docker build
pnpm build:docker
```

### Development Server

- **Port**: 3005
- **Proxy**: `/graphql` → `localhost:3003`
- **HMR**: Full hot module replacement
- **Source Maps**: Enabled for debugging

---

## Summary

### Architecture Highlights

- **Vue 3 + TypeScript**: Modern reactive framework with full type safety
- **Pinia Stores**: Composition API-based state management with persistence
- **Apollo Client**: Production GraphQL with dual subscription transports
- **Vue Flow**: Interactive diagram editor for threat modeling
- **JSONForms**: Dynamic form generation from module schemas
- **Dynamic Modules**: Runtime-extensible component system
- **OIDC Authentication**: Enterprise identity with multi-provider support

### Key Design Decisions

1. **Single Backend Integration Layer**: All backend communication flows through Pinia stores using shared query classes from `@packages/dt-core`, ensuring consistency across UI, CLI, and MCP server
2. **SSE Default**: Server-Sent Events as default subscription transport for CDN compatibility
3. **Optimistic Updates**: UI updates immediately while GraphQL operations complete
4. **File-Based Routing**: Automatic route generation from page components
5. **Chunk Splitting**: Vendor code separated for optimal caching
6. **Host Dependencies**: Vue runtime exposed to dynamically loaded modules
7. **Persistent State**: Auth tokens and UI state survive page reloads

This architecture provides a responsive, real-time threat modeling interface while maintaining extensibility through the dynamic module system and flexibility through multi-provider authentication support.
