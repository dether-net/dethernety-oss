# Frontend Technical Overview

Dethernety's frontend is a Vue 3 single-page application providing an interactive threat modeling interface with real-time analysis integration and a dynamic module system.

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

## Core Technologies

| Technology | Purpose |
|------------|---------|
| **Vue 3** | Reactive UI framework with Composition API and TypeScript support |
| **Vuetify 3** | Material Design components with accessibility and theming |
| **Pinia** | Composition API-based state management with devtools integration |
| **Apollo Client** | GraphQL client with caching, subscriptions, and error handling |
| **Vue Flow** | Interactive node-based diagram editor |
| **JSONForms** | Dynamic form generation from JSON Schema |
| **Vite** | Build tool with HMR and optimized production bundling |

---

## Data Flow Editor

The main interface is a drag-and-drop diagram editor built on Vue Flow. Users create DFD diagrams with processes, stores, external entities, and trust boundaries. Boundaries support nesting for hierarchical security zones. Changes persist immediately, and property panels use JSONForms with module-defined schemas for element configuration. MITRE ATT&CK techniques can be assigned directly on diagram elements.

## Dynamic Module System

Modules are fetched from the backend and installed at runtime. Each module can register custom Vue components through a component registry. The host application exposes Vue runtime and composables to modules, allowing them to integrate with the existing store and GraphQL infrastructure without bundling their own copies.

## State Management

Pinia stores are the single integration point between UI components and the backend. All GraphQL operations use shared query classes from `@packages/dt-core`, so the same queries are used across the UI, CLI tool, and MCP server.

## Authentication

OIDC/OAuth2 with PKCE flow, supporting multiple providers (Cognito, Keycloak, Auth0, Zitadel). Tokens are managed with auto-refresh before expiration, and Bearer tokens are injected into all GraphQL requests via Apollo link middleware.

---

## Contributing

Key entry points for extending the frontend:

1. **New diagram node types** — see `src/components/DataFlow/`
2. **Custom module UI components** — see `src/services/ModuleLoader.ts`
3. **New stores or data operations** — see `src/stores/` and `@packages/dt-core`

---

## Further Reading

- [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) — complete technical reference with implementation details
- [Architecture Overview](../README.md) — platform-level architecture
