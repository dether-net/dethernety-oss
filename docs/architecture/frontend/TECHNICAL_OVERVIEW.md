# Frontend Technical Overview

> Executive-level technical summary for investment due diligence

## Platform Architecture at a Glance

Dethernety's frontend is built on a modern, enterprise-grade technology stack designed for real-time interaction, extensibility, and maintainability.

```
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                            USER INTERFACE                                │
   │                                                                          │
   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
   │  │  Data Flow   │ │   Analysis   │ │    Issue     │ │   Module     │     │
   │  │   Editor     │ │   Results    │ │   Manager    │ │   Browser    │     │
   │  │ (Vue Flow)   │ │  (Charts)    │ │  (Tables)    │ │  (Dynamic)   │     │
   │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘     │
   │                                                                          │
   │    UI Framework: Vuetify 3 │ Dynamic Forms: JSONForms │ Charts: Chart.js │
   └──────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                               STATE MANAGEMENT                                 │
│                                                                                │
│      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│      │    Flow      │ │   Analysis   │ │    Auth      │ │   Models     │       │
│      │    Store     │ │    Store     │ │    Store     │ │    Store     │       │
│      │  (Diagram)   │ │    (AI)      │ │   (OIDC)     │ │   (CRUD)     │       │
│      └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│                                                                                │
│    Single Point of Backend Integration │ Persistence: LocalStorage │ Type-Safe │
└────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                                DATA LAYER                               │
   │                                                                         │
   │  ┌──────────────────────────────────────────────────────────────────┐   │
   │  │                     Apollo Client (GraphQL)                      │   │
   │  │     Queries │ Mutations │ Subscriptions (SSE/WebSocket)          │   │
   │  └──────────────────────────────────────────────────────────────────┘   │
   │                                                                         │
   │    Caching │ Optimistic Updates │ Error Handling │ Auth Token Injection │
   └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                          EXTERNAL INTEGRATIONS                          │
   │                                                                         │
   │  ┌─────────────────────────────────────┐  ┌───────────────┐             │
   │  │ Backend GraphQL API                 │  │ Identity      │             │
   │  │ (Queries, Mutations, Subscriptions) │  │ (OIDC/JWT)    │             │
   │  └─────────────────────────────────────┘  └───────────────┘             │
   │                                                                         │
   │  ┌─────────────────────────────────────┐                                │
   │  │ Dynamic Module System               │                                │
   │  │ (Runtime Component Loading)         │                                │
   │  └─────────────────────────────────────┘                                │
   └─────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Selection Rationale

### Core Technologies

| Technology | Selection Rationale | Industry Adoption |
|------------|--------------------|--------------------|
| **Vue 3** | Composition API enables better code organization, TypeScript support, and reactive primitives | Alibaba, GitLab, Adobe |
| **TypeScript** | Type safety reduces bugs, improves maintainability, enables better tooling | Microsoft, Google, Slack |
| **Vuetify 3** | Material Design components with comprehensive accessibility and theming | Enterprise applications |
| **Pinia** | Modern Vue state management with TypeScript support and devtools integration | Official Vue recommendation |
| **Apollo Client** | Production GraphQL client with caching, subscriptions, and error handling | Airbnb, The New York Times |
| **Vue Flow** | Performant diagram library for interactive node-based editors | n8n |

### Why This Stack?

1. **Developer Productivity**: Vue 3 Composition API + TypeScript enables rapid feature development
2. **User Experience**: Vuetify provides polished, accessible UI components out of the box
3. **Real-Time Capability**: Apollo subscriptions with SSE/WebSocket support for live updates
4. **Maintainability**: Pinia stores as single point of backend integration; shared GraphQL query classes (`@packages/dt-core`) ensure consistency across UI, CLI, and MCP server
5. **Extensibility**: Dynamic module system enables runtime plugin loading
6. **Performance**: Vite build tool with optimized chunking for fast initial load

---

## Key Technical Differentiators

### 1. Interactive Data Flow Editor

Purpose-built threat modeling interface using Vue Flow:
- **Drag-and-Drop Modeling**: Create DFD diagrams with processes, stores, external entities, and trust boundaries
- **Nested Boundaries**: Support for hierarchical security zones with parent-child relationships
- **Real-Time Sync**: Changes persist to backend immediately
- **Dynamic Property Panels**: JSONForms-powered configuration with module-defined schemas
- **MITRE Integration**: Direct ATT&CK technique selection on diagram elements

### 2. Dynamic Module System

Runtime-extensible frontend architecture:
- **Hot Module Loading**: Modules fetched from backend and installed at runtime
- **Component Registry**: Modules can register custom Vue components for specialized rendering
- **Host Dependency Injection**: Vue runtime and composables exposed to modules
- **Zero-Downtime Updates**: New modules loaded without page refresh

---

## Security Architecture

### Defense in Depth

```
┌────────────────────────────────────────────────────────────────┐
│ Transport Layer: HTTPS Only (TLS 1.2+)                         │
├────────────────────────────────────────────────────────────────┤
│ Authentication: OIDC/OAuth2 with PKCE                          │
├────────────────────────────────────────────────────────────────┤
│ Token Management: Secure storage, auto-refresh, validation     │
├────────────────────────────────────────────────────────────────┤
│ API Security: Bearer token injection on all GraphQL requests   │
├────────────────────────────────────────────────────────────────┤
│ Error Handling: Automatic logout on 401/403 responses          │
└────────────────────────────────────────────────────────────────┘
```

### Security Highlights

- **Standards-Based Auth**: OIDC/OAuth2 with PKCE for secure token exchange
- **Token Auto-Refresh**: Prevents session expiration during active use
- **Secure State**: Cryptographic nonce and state parameters for OIDC flow
- **Error Isolation**: GraphQL errors handled without exposing internals

---

## Code Quality & Maintainability

### Engineering Standards

| Standard | Implementation |
|----------|----------------|
| **Type Safety** | Full TypeScript with strict configuration |
| **Code Organization** | Feature-based directory structure with clear boundaries |
| **Auto-Import** | Composables and components auto-imported with type generation |
| **State Management** | Composition API-based Pinia stores with persistence |
| **Build Optimization** | Vendor chunking for optimal caching |

### Build Configuration

- **Vite 7**: Modern build tool with fast HMR and optimized production builds
- **Chunk Splitting**: Separate bundles for Vue, Apollo, Vuetify, Vue Flow, JSONForms
- **Tree Shaking**: Unused code eliminated in production builds
- **Source Maps**: Development source maps for debugging

---

## Integration Capabilities

### Current Integrations

| System | Integration Type | Purpose |
|--------|-----------------|---------|
| **Backend GraphQL API** | Apollo Client | All data operations |
| **OIDC Providers** | Native OAuth2 | Enterprise identity (Cognito, Keycloak, Auth0, Zitadel) |
| **Real-Time Updates** | SSE/WebSocket | Live analysis results and collaboration |
| **Dynamic Modules** | Runtime Loading | Extensible UI components |

### Extension Points

1. **Module Components**: Custom Vue components loaded at runtime from modules
2. **JSONForms Renderers**: Custom form controls for specialized inputs
3. **Node Types**: Additional data flow diagram node types
4. **Theme Customization**: Vuetify theming for brand consistency

---

## Summary: Investment Considerations

### Technical Strengths

- **Modern Architecture**: Vue 3 Composition API with TypeScript
- **Interactive UX**: Purpose-built data flow editor for threat modeling
- **Real-Time**: Live updates via GraphQL subscriptions
- **Extensible**: Runtime module loading for market adaptation
- **Maintainable**: Clear separation of concerns with Pinia stores

### Competitive Advantages

1. **Visual Threat Modeling**: Interactive DFD editor purpose-built for security analysis
2. **Dynamic Configuration**: Module-defined property schemas via JSONForms
3. **Runtime Extensibility**: Plugin architecture for UI components without redeployment
4. **MITRE Integration**: Direct ATT&CK technique mapping on diagram elements
5. **Deployment Flexibility**: SSE/WebSocket transport selection for CDN or on-premise

---

## Detailed Documentation Reference

For deeper technical analysis, comprehensive documentation is available covering:

- Frontend architecture patterns and implementation
- State management with Pinia stores
- GraphQL client configuration
- Authentication flow details
- Data flow editor implementation
- Dynamic module system

See [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) for the complete technical reference.

For the overall platform architecture, see [Architecture Overview](../ARCHITECTURE.md).
