# Frontend Architecture

> Frontend architecture for the Dethernety platform

## Overview

The Dethernety frontend is a Vue 3 single-page application providing an interactive threat modeling interface. It features a visual data flow editor, real-time AI analysis integration, and a dynamic module system for extensibility.

---

## Technology Stack

### Core Framework

| Technology | Purpose |
|------------|---------|
| **Vue 3** | Reactive UI framework with Composition API |
| **TypeScript** | Type-safe development |
| **Vite** | Build tool with HMR and optimized bundling |
| **Vue Router** | File-based routing with auto-generation |

### UI Components

| Technology | Purpose |
|------------|---------|
| **Vuetify** | Material Design component library |
| **Vue Flow** | Node-based diagram editor |
| **JSONForms** | Dynamic form generation from JSON Schema |
| **Chart.js** | Data visualization |
| **Mermaid** | Diagram rendering |

### State & Data

| Technology | Purpose |
|------------|---------|
| **Pinia** | Composition API-based state management |
| **Apollo Client** | GraphQL client with caching |
| **graphql-ws** | WebSocket subscription transport |
| **graphql-sse** | SSE subscription transport |

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

Pinia stores are the **single point of backend integration** for all data operations. All GraphQL queries, mutations, and subscriptions flow through stores—whether the data is persisted as application state or retrieved ephemerally for immediate use.

**Shared Query Classes**: All GraphQL operations are implemented as reusable classes in `@packages/dt-core`, not as inline queries. Pinia stores exclusively use these shared classes for all backend communication. The same query implementations are used by the UI, CLI tool, and MCP server.

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
| **ModulesStore** | Module management | Available modules, module metadata, class definitions, class-identity admin actions (`fetchModulesWithIdentity`, `migrateClassId`, `reviveOrphanedClass`, `deleteOrphanedClass`, `runIdentityMigration`) |
| **ClassIdentityStore** | Class-identity event log | In-memory event ring buffer (rebind / rebind-conflict / collision / orphan / revive); polling lifecycle for the Operations tab |

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

#### Boundary Zoning

Boundary **zoning** lets the modeller classify each security boundary by a trust tier and record how
it connects to its peers. A boundary carries four zoning fields in `node.data`:

| Field | Shape | Meaning |
|-------|-------|---------|
| `zone` | `Zone \| null` | Declared trust tier (`PUBLIC`, `EXPOSED`, `INTERNAL`, `RESTRICTED`, `UNTRUSTED`, `VENDOR`). `null` means "inherit". |
| `domains` | `string[]` | Free-form business-function tags (e.g. `payments`, `erp`). |
| `planes` | `Plane[]` | Operational role, projected to/from a 4-state `Role` (`UNDECIDED` / `WORKLOAD` / `MANAGEMENT` / `BOTH`). |
| `conduits` | `Conduit[]` | Directed "approved channels" to peer boundaries (a declared, justified connection). |

Zoning records **declared design intent, not a verified verdict.** The frontend computes no legality
or compliance result — it captures what the modeller asserts and presents it for review. A prospective
"does this channel hold up" verdict is deliberately left unimplemented in this surface.

**Effective zone and inheritance.** A boundary with `zone === null` inherits the nearest ancestor's
declared zone by walking the containment chain (`node.parentNode`). With no ancestor declaring a zone,
it resolves to a default of `INTERNAL`. The resolution is a pure tree walk — no backend call:

```
Resolution of a boundary's effective zone (walk node.parentNode upward):

  default boundary  ──────────────  no zone declared anywhere
        │                                  ↓
   ┌────┴─────────┐               source = 'default'  → INTERNAL  (pill hidden)
   │  "Corp net"  │  zone = INTERNAL
   │              │               source = 'declared' → INTERNAL  (solid pill)
   │   ┌──────────┴──┐
   │   │ "App tier"  │  zone = null
   │   │             │            source = 'inherited' from "Corp net" → INTERNAL  (dimmed pill)
   │   │   ┌─────────┴──┐
   │   │   │ "CDE"      │  zone = RESTRICTED
   │   │   │            │         source = 'declared' → RESTRICTED  (solid pill)
   │   │   └────────────┘
   │   └─────────────────┘
   └──────────────────────┘
```

`resolveEffectiveZone` returns `{ zone, source: 'declared' | 'inherited' | 'default', from? }`, where
`from` names the ancestor for an `'inherited'` result. The walk is depth-capped (`MAX_DEPTH = 50`) and
cycle-guarded, mirroring the server-side containment traversal ceiling.

**Supporting pure utilities.** The read-side logic lives in framework-free, unit-testable modules under
`apps/dt-ui/src/utils/`, so the components stay thin consumers:

| Module | Key exports | Role |
|--------|-------------|------|
| `effectiveZone.ts` | `resolveEffectiveZone`, `EffectiveZone`, `DEFAULT_ZONE` (`INTERNAL`), `MAX_DEPTH` | Inheritance walk over the boundary graph. |
| `boundaryTree.ts` | `buildBoundaryTree`, `flattenBoundaryTree`, `isAncestorBoundary` | Flat `Node[]` → containment forest; pre-order flatten with depth; cycle-safe ancestor test. |
| `zoneColor.ts` | `ZONE_LABEL`, `ZONE_PILL_WORD`, `ZONE_HINT`, `ZONE_COLOR`, `zonePill`, `Role`, `planesToRole` / `roleToPlanes` | Display vocabulary: plain-language labels, short pill words, "reachable by" hints, the colour ramp, the pill decision, and the `planes` ↔ `Role` mapping. |

Colour is **reinforcement only** — the pill always shows a word, so the encoding stays colourblind-safe.

**Components.** Zoning is authored, reviewed, and rendered through four surfaces, all reading the store's
[zoning getters](./LLD/FLOW_STORE.md#boundary-zoning-getters) (`boundaryById`, `allBoundaries`,
`effectiveZone`):

| Component | File | Role |
|-----------|------|------|
| **Zone pill** | [`DataFlow/Nodes/BoundaryNode.vue`](../../../apps/dt-ui/src/components/DataFlow/Nodes/BoundaryNode.vue) | Renders the effective zone on the boundary in the diagram via `zonePill`: solid for `declared`, dimmed + italic for `inherited`, hidden for `default`. |
| **Zoning tab** | [`DataFlow/SettingsTabs/SettingsZoningTab.vue`](../../../apps/dt-ui/src/components/DataFlow/SettingsTabs/SettingsZoningTab.vue) | Buffered authoring of `zone` / `domains` / role / conduits for one boundary; the parent owns the buffer and commits via the boundary's existing **Save**. |
| **Peer picker** | [`DataFlow/BoundaryPicker/BoundaryPickerSheet.vue`](../../../apps/dt-ui/src/components/DataFlow/BoundaryPicker/BoundaryPickerSheet.vue) + [`BoundaryPeerPreview.vue`](../../../apps/dt-ui/src/components/DataFlow/BoundaryPicker/BoundaryPeerPreview.vue) | Drawer for declaring a directed conduit to a peer boundary; previews the peer's resolved zone/role/domains and warns (never blocks) on a structurally-nested pick. |
| **Zoning overview** | [`DataFlow/BoundaryZoning/BoundaryZoningOverview.vue`](../../../apps/dt-ui/src/components/DataFlow/BoundaryZoning/BoundaryZoningOverview.vue) | Model-wide nesting tree with inline zone edit, bulk-set + Undo, an unclassified count/filter, and collapsed-parent roll-up badges. Opened from the canvas toolbar's shield button in [`DataFlow/DataFlowBackground.vue`](../../../apps/dt-ui/src/components/DataFlow/DataFlowBackground.vue). |

The overview is an **immediate-persist** surface (each edit writes at once, with Undo as the safety net),
whereas the tab is **buffered** (edits accumulate and commit on Save). Both write through the store's
`updateNode`. See [Implementation Patterns — Boundary zoning](./LLD/Data%20architecture/IMPLEMENTATION_PATTERNS.md#4-boundary-zoning--buffered-tab-vs-immediate-persist-overview)
for the buffer-vs-immediate-persist mechanics.

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

### 6. Modules Page

[`pages/modules.vue`](../../../apps/dt-ui/src/pages/modules.vue) hosts two tabs:

| Tab | Audience | Surface |
|-----|----------|---------|
| **Configuration** | All authenticated users | Existing per-module `ModuleCard` for editing module attributes (save + reset) |
| **Operations** | Admin role only — gated client-side via `authStore.hasRole('admin')`, defence-in-depth in front of the server-side `requireAdmin(ctx)` gate | Class-identity diagnostics + reconciliation |

The Operations tab is the UI for the backend class-identity admin surface. Its components live in [`components/Modules/`](../../../apps/dt-ui/src/components/Modules/) and [`components/Dialogs/Module/`](../../../apps/dt-ui/src/components/Dialogs/Module/):

| Component | Purpose |
|-----------|---------|
| [`BlockedInstallsBanner`](../../../apps/dt-ui/src/components/Modules/BlockedInstallsBanner.vue) | Top-of-tab alert when one or more modules have `lastInstallStatus = 'unavailable'`. Click-through opens `ConflictResolutionDialog` for the affected module |
| [`ModuleHealthTable`](../../../apps/dt-ui/src/components/Modules/ModuleHealthTable.vue) | Per-module row with `lastInstallStatus`, `lastAttemptedInstall`, `lastAuthoritativeInstall`, `idRebindPolicy`, `constraintsHealthy`, conflict count, and orphan count. Row click filters the event timeline by module |
| [`OrphanedClassesPanel`](../../../apps/dt-ui/src/components/Modules/OrphanedClassesPanel.vue) | Expandable list of `Module.orphanedComponentClasses` + the six sibling lists. Per-row revive / delete actions emit events that the page wires to the store actions |
| [`IdentityEventTimeline`](../../../apps/dt-ui/src/components/Modules/IdentityEventTimeline.vue) | Renders `ClassIdentityEvent[]` (rebind / rebind-conflict / collision / orphan / revive). Polls the server on a 10-second interval when enabled; visibility-aware (paused when the tab is hidden) |
| [`IdentityMigrationPanel`](../../../apps/dt-ui/src/components/Modules/IdentityMigrationPanel.vue) | Wraps `runIdentityMigration` with a dry-run / apply toggle and renders the returned `IdentityMigrationReport.details` |
| [`ConflictResolutionDialog`](../../../apps/dt-ui/src/components/Dialogs/Module/ConflictResolutionDialog.vue) | Per-class resolution UI for `Module.rebindConflicts`. Calls `migrateClassId(newId: moduleDeclaredId)` for the canonical "adopt-module-id" direction |
| [`CascadeDeleteDialog`](../../../apps/dt-ui/src/components/Dialogs/Module/CascadeDeleteDialog.vue) | Confirms hard-delete of an orphaned class. Surfaces the `incomingInstancesByType` breakdown so operators can see "this includes Analyses (user work)" before approving cascade. State machine in [`utils/cascadeState.ts`](../../../apps/dt-ui/src/utils/cascadeState.ts) |

The page lazily loads admin data the first time the Operations tab is opened (`fetchModulesWithIdentity` + `fetchEvents`), and the event timeline supports opt-in 10-second polling — visibility-paused so a hidden tab doesn't generate background load.

### 7. Finding Disposition Surface

Users can record a structured decision on a SYSTEM-generated finding (an Exposure or a Countermeasure) instead of deleting it. The same surface renders in two venues; shared logic lives in a composable so they cannot drift.

| Piece | File | Role |
|-------|------|------|
| Composable | [`composables/useFindingDisposition.ts`](../../../apps/dt-ui/src/composables/useFindingDisposition.ts) | Provenance icon matrix, kind label (incl. `WAIVED`), active-before-disposed sort (`partitionAndSort`), stale `rowClass`, dialog-state shape + opener, shared `ERROR_MESSAGES` |
| Dialog | [`components/Dialogs/Exposure/DispositionDialog.vue`](../../../apps/dt-ui/src/components/Dialogs/Exposure/DispositionDialog.vue) | Shared dialog; `findingType: 'EXPOSURE' \| 'COUNTERMEASURE'` prop drives pickable kinds, title, and Save/Clear dispatch |
| Exposure venue | [`components/DataFlow/SettingsTabs/SettingsExposuresTab.vue`](../../../apps/dt-ui/src/components/DataFlow/SettingsTabs/SettingsExposuresTab.vue) | Exposures table: provenance chip-stack, asymmetric SYSTEM/USER actions, Supersede, stale Review, tab stale-count |
| Countermeasure venue | [`components/Dialogs/Control/ControlDialog.vue`](../../../apps/dt-ui/src/components/Dialogs/Control/ControlDialog.vue) | Countermeasures sub-table mirrors the same treatment; `(N)` stale badge on the Countermeasures tab |

**Asymmetric actions.** `isUserAuthored(item)` splits the per-row action column. SYSTEM findings cannot be edited or deleted directly — they offer **Customize as your own copy** (Supersede) plus **Dispose**; when a SYSTEM disposition has gone stale the dispose control becomes a visible **Review** button. USER findings (including Supersede clones) offer the normal **Edit** and **Delete**.

**Staleness.** Each venue computes a stale count (`dispositionStale === true`) and surfaces it as a tab badge — `(N)` next to the Countermeasures tab, an `update:staleCount` emit on the exposures tab. Stale rows render with a `row-stale` left-border treatment via the shared `rowClass` helper.

**Supersede (Fork) flow.** Selecting "Customize as your own copy" calls `flowStore.supersedeExposure` / `controlsStore.supersedeCountermeasure`, which delegate to the pure dt-core orchestrators (`executeSupersedeFlow` / `executeSupersedeCountermeasureFlow`). The flow clones the SYSTEM finding into an editable USER copy and disposes the original as `SUPERSEDED`. If the disposal half fails after the copy is created, the venue shows a `warning` snackbar with a **Retry** action. Stores are thin passthroughs to dt-core; the venue refetches after a successful write. See [Implementation Patterns — Shared Surface Patterns](./LLD/Data%20architecture/IMPLEMENTATION_PATTERNS.md#shared-surface-patterns) for the composable / dialog / passthrough / partial-failure mechanics, and the [dt-core disposition operations](../dt-core/GRAPHQL_OPERATIONS.md#disposition-operations) for the result-envelope contract.

### 8. MITRE Technique Picker

A drawer / inline picker for attaching MITRE techniques, defenses, or mitigations to a finding. It blends instant local matching with server-side semantic search, and degrades gracefully when the semantic tier is unavailable.

| Piece | File | Role |
|-------|------|------|
| Wrapper | [`components/Mitre/TechniquePicker/TechniquePicker.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePicker.vue) | Multi-bind `v-model: string[]` of `mitreId`s; composes chips + inline input + browse drawer; pushes recents on commit |
| Inline input | [`components/Mitre/TechniquePicker/TechniquePickerInline.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePickerInline.vue) | Typeahead with synchronous local tier and 300 ms-debounced vector tier; exposes `seedSearch()` for "Suggest matches" |
| Result rows | [`components/Mitre/TechniquePicker/TechniquePickerResults.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePickerResults.vue) | Shared row: monospace ID + name + tactic + one-line description; 3-dot similarity meter for `VECTOR_SIMILARITY` |
| Preview pane | [`components/Mitre/TechniquePicker/TechniquePreview.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePreview.vue) | Detail card for the browse drawer; kind-aware ID label, tactic row hidden for `ATTACK_MITIGATION` |
| Store | [`stores/techniqueSuggestionsStore.ts`](../../../apps/dt-ui/src/stores/techniqueSuggestionsStore.ts) | Vector-tier match results + locally hydrated catalog, keyed by `MitreKind`; tracks `vectorAvailable` + `vectorDisabledReason` |
| Recents | [`composables/useRecentTechniques.ts`](../../../apps/dt-ui/src/composables/useRecentTechniques.ts) | Auth-scoped, model + kind scoped localStorage MRU list (max 8) |

**Two-tier matching.** The inline input runs a synchronous scan over the store's hydrated catalog for the deterministic tiers (`EXACT_ID` / `PREFIX_ID` / `NAME_MATCH` / `DESCRIPTION_MATCH`), giving instant feedback. When the query is at least 4 characters and has no local exact-ID hit, it also fires a debounced server call to the vector tier (`VECTOR_SIMILARITY`) through `techniqueSuggestionsStore.matchTechniques` → `DtMitre.matchTechniques`. Vector results that duplicate a local row are suppressed.

**Suggest matches.** Host dialogs ([`Dialogs/DataFlow/ExposureDialog.vue`](../../../apps/dt-ui/src/components/Dialogs/DataFlow/ExposureDialog.vue), [`Dialogs/Control/CounterMeasureDialog.vue`](../../../apps/dt-ui/src/components/Dialogs/Control/CounterMeasureDialog.vue)) expose a **Suggest matches** affordance that calls the picker's `seedSearch()` with the finding's description. This seeds the vector tier directly — bypassing the keystroke debounce — and widens the per-query budget (`topN = 10`) because description-seeded queries are diffuse and the genuinely relevant technique can rank below the typed-input default of 3.

**Graceful degradation.** When the server reports `vectorAvailable: false`, the picker keeps the deterministic tiers working and shows a caption explaining why semantic search is unavailable — one of four messages mapped from `vectorDisabledReason` (`EMBEDDING_DISABLED`, `NO_INDEX_MODULE`, `NO_VECTORS`, `MODEL_MISMATCH`). The catalog is hydrated through the existing `DtMitreAttack` / `DtMitreDefend` surfaces; `DtMitre` is used only for the vector tier. See the [dt-core `DtMitre` operations](../dt-core/GRAPHQL_OPERATIONS.md#dtmitre) and the [MITRE technique matching types](../dt-core/DOMAIN_MODEL.md#mitre-technique-matching).

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

1. **Single Backend Integration Layer**: All backend communication flows through Pinia stores using shared query classes from `@packages/dt-core`, so the same queries run across UI, CLI, and MCP server
2. **SSE Default**: Server-Sent Events as default subscription transport for CDN compatibility
3. **Optimistic Updates**: UI updates immediately while GraphQL operations complete
4. **File-Based Routing**: Automatic route generation from page components
5. **Chunk Splitting**: Vendor code separated for optimal caching
6. **Host Dependencies**: Vue runtime exposed to dynamically loaded modules
7. **Persistent State**: Auth tokens and UI state survive page reloads

This architecture provides a responsive, real-time threat modeling interface while maintaining extensibility through the dynamic module system and flexibility through multi-provider authentication support.
