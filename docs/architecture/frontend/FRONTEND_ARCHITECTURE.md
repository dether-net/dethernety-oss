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
├── reporting/                   # Report kit for module exports
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
| **FolderStore** | Folder hierarchy | Folder tree management, model organization, navigation state, the content index behind the [Browser search](#browser-search) (`fetchContentIndex`) |
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
const handleRefusal = createRefusalHandler({ auth: () => useAuthStore(), leave: leaveForOnce, basePath: BASE_URL });

const errorLink = new ErrorLink(({ error, operation, forward }) => {
  if (CombinedGraphQLErrors.is(error)) {
    // UNAUTHENTICATED is what the API says to every refused credential.
    // refusalAction() decides: sign in, refresh and retry once, or not admitted.
    return handleRefusal({ error, operation, forward });
  } else if (error.statusCode === 401 || error.statusCode === 403) {
    authStore.clearState(); leaveForOnce(`${BASE_URL}login`);
  }
});
```

A refusal of a token the browser believes current is answered with a forced token refresh and one retry: a failed refresh ends the session (`/login`), a successful retry shows nothing, and only a **freshly issued token that is refused again** means the deployment does not admit the account (see `DEPLOYMENT_ALLOWLIST` in the [Configuration guide](../../CONFIGURATION_GUIDE.md#deployment-access-multi-tenant-idp)). Then the SPA leaves for `/auth/not-admitted` — never `/login`, which would loop through the identity provider. A stale or absent token gets the ordinary sign-in without a retry. Details in [LLD/APOLLO_CLIENT.md → Error Link](./LLD/APOLLO_CLIENT.md#error-link).

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
- Neighbourhood highlight on selection (see [Neighbourhood highlight](#neighbourhood-highlight))
- Search the canvas by name with Ctrl/⌘F (see [Canvas search](#canvas-search))
- View mode and edit mode behind a padlock on the canvas rail (see [Edit lock](#edit-lock))

#### Edit lock

The canvas is either in view mode (locked) or edit mode, held in `flowStore.editMode` and toggled by the padlock button on the canvas rail. A model with elements opens locked; an empty model opens unlocked, since the only thing to do with it is add to it. Locked, the canvas does not move, connect or reroute elements, Backspace deletes nothing, and boundaries show no resize handles.

- Dropping an element from the palette onto a locked canvas turns edit mode on, creates the element and says so in a snackbar ("Edit mode is on. Click the padlock to lock the canvas again."). It is the drop that unlocks, not opening the palette or starting the drag, so a cancelled drag changes nothing.
- A drag let go over the palette itself is taken back, locked or not: a drop there would put the element where the panel hides it.
- Anything else dragged onto a locked canvas, a file from the desktop say, is refused.
- The palette's drag state ends with the drag, dropped or not (`useDragAndDrop` clears it on the document's `drop` and `dragend`), so a later drag from outside the page is never taken for one from the palette.

**Source:** `apps/dt-ui/src/stores/flowStore.ts` (`editMode`, `openedEmpty`, set in `fetchData`); padlock in `components/DataFlow/DataFlowBackground.vue`; the lock-bound Vue Flow props and the drop in `components/DataFlow/DataFlow.vue` (`handleDragOver`, `onCanvasDrop`); resize handles in `components/DataFlow/Nodes/BoundaryNode.vue`; drag state in `utils/dataFlowUtils.ts` (`useDragAndDrop`). Tests: `components/DataFlow/__tests__/DataFlow.paletteDrop.test.ts`, `utils/__tests__/dataFlowUtils.dragAndDrop.test.ts`.

#### Neighbourhood highlight

Selecting a component (process, store or external entity) brings its neighbourhood forward: its inbound flows draw in the `flow-in` colour and its outbound flows in `flow-out`, both thicker and with an arrowhead of the same colour, and the components at their other ends are outlined. Selecting a data flow draws that flow thicker in the foreground colour and outlines its two ends. Everything else on the canvas dims.

- Boundaries never dim: they show which flows cross a trust boundary.
- Dimmed elements keep the pointer, so clicking one moves the highlight to it.
- A selected boundary, the empty canvas (which selects the default boundary) or no selection gives no highlight.
- A flow from a component to itself counts as outbound.
- The highlight follows `flowStore.selectedItem` (a single selection) and is read from the current `nodes` and `edges`, not the selected object, so a deleted element clears it and a rerouted or reloaded one updates it.

**Mechanism.** `neighbourhood()` computes the focus, its inbound and outbound flow ids and its neighbouring components; `neighbourhoodCss()` turns that into rules that name the lit elements by Vue Flow's `data-id` attribute. `DataFlow.vue` writes the rules into one `<style data-dt-flow-focus>` element in the document head (through `textContent`, never markup), drops it when there is no highlight and removes it on unmount, and sets the `dt-flow-focus` class on the VueFlow root while a highlight is active. The same element and class carry the [canvas search](#canvas-search)'s matches while it has a query: `canvasCss` picks the search's rules or the neighbourhood's.

- Nothing is written to the store's elements or to `node.class`, which the [crown-jewel class](./LLD/FLOW_STORE.md#crown-jewel-node-class) and the drag-intersection feedback already use.
- Ids are escaped as CSS string values, so an unexpected id cannot end the attribute string or the rule.
- The static dimming in `main.css` sits at `:where()` specificity, so the per-selection rules win whatever order the two stylesheets load in.
- The arrowheads are two markers of their own (`FLOW_ARROW_IN`, `FLOW_ARROW_OUT`) in a hidden SVG `<defs>`: an edge's Vue Flow arrowhead keeps the colour of its marker definition, not the line's stroke. Their size is fixed in canvas units (`markerUnits="userSpaceOnUse"`), so a thicker line does not grow its arrow.
- The two colours are the `flow-in` and `flow-out` theme tokens, defined in both the light and dark themes.

**Source:** `apps/dt-ui/src/utils/flowNeighbourhood.ts` (`neighbourhood`, `neighbourhoodCss`, `searchCss`, `FLOW_ARROW_IN`, `FLOW_ARROW_OUT`), applied in `components/DataFlow/DataFlow.vue` (`focus`, `canvasCss`); dimming in `components/DataFlow/Style/main.css` ("Neighbourhood focus"); colours in `plugins/vuetify.ts`.

#### Canvas search

Ctrl+F (⌘F on macOS) or the magnifier button at the top of the canvas rail opens a search field next to the rail. Typing lights every component, boundary and data flow whose name contains the text, and dims the rest: matched components and boundaries are outlined, matched flows drawn thicker in the foreground colour. A list under the field shows the best matches, each with its type and where it is: the boundary that holds it, or a flow's two ends ("web → db"). Picking a result selects it, frames it as an [element link](#linking-to-an-element) does, and closes the search. Esc or the close icon closes it and leaves the selection as it was.

- Matching ignores case, accents and repeated whitespace. The whole name ranks first, then the name's start, then a word's start inside it, then anywhere; within a rank by name, then components before boundaries before flows.
- An element with no name is never found, and neither is the model's default boundary, which is not a canvas node; its name is the context of what sits at the root.
- The list shows at most 50 results; the canvas lights every match. A query with no matches shows "No matches" and dims nothing.
- While the search has a query, its matches replace the selection's neighbourhood on the canvas; with the query emptied or the search closed, the neighbourhood shows again.
- Leaving the field hides the list only: the query and the lit matches stay while the canvas is panned or a match is clicked, and clicking back into the field shows the list again.
- The arrow keys move through the list and wrap; Enter picks the active result. Esc goes no further than the search.
- The shortcut takes the F key by letter or by position, so a non-Latin layout works. It stands down while typing in another input, text area or editable text, and while a dialog or menu is open (a tooltip or snackbar does not count), leaving the browser's find to them; inside the search's own field it stays the search's. Asking for the search while it is open puts the cursor back in the field.
- The search starts empty each time it opens, and closes when the editor switches to another model.

**Mechanism.** `searchCanvas()` compares the query with node labels and flow labels, both folded by `normalise()`, and returns every match, ranked. `CanvasSearch.vue` is a text field with a result list of its own rather than `v-autocomplete`, which clears its search text on blur and sets it to the picked value, while here the query must outlive the field's focus. It emits every match while it is open with a query (`matches`, `null` otherwise) and the picked result (`pick`), and exposes `focus()`.

- `DataFlow.vue` keeps `searchOpen` and `searchMatches`. `canvasCss` uses `searchCss()` while there is a match list and `neighbourhoodCss()` otherwise, in the same per-selection stylesheet as the [Neighbourhood highlight](#neighbourhood-highlight); an empty match list gives no rules, so nothing dims.
- A pick resolves through `resolveEditorLink`, and `selectAndFrame`, shared with the element link, selects it in the store and in Vue Flow and fits the view on it: a node on itself, a flow on its two ends. A result no longer on the canvas selects nothing.
- `openSearch` serves both the shortcut (`onSearchShortcut`, a document `keydown` listener from mount to unmount) and the rail button (`open-search` from `DataFlowBackground.vue`), and always refocuses the field.

**Source:** `apps/dt-ui/src/utils/flowSearch.ts` (`searchCanvas`, `CanvasSearchResult`) and `components/DataFlow/CanvasSearch.vue`; name matching in `utils/nameMatch.ts` (`normalise`, `rankName`), shared with the [Browser search](#browser-search); lighting in `utils/flowNeighbourhood.ts` (`searchCss`); wired in `components/DataFlow/DataFlow.vue` (`canvasCss`, `openSearch`, `onSearchShortcut`, `selectAndFrame`); rail button in `components/DataFlow/DataFlowBackground.vue`.

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

Runtime-extensible architecture for frontend plugins. A module frontend is a bundle plus a manifest naming the component keys it registers. No module frontend is fetched before the app mounts; a module's bundle loads the first time one of its keys is needed.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Module Loading Flow                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. App Startup                                                         │
│     └─→ initializeApolloClient(), authStore.initializeAuthMode()        │
│     └─→ ModuleLoader.exposeHostDependencies()                           │
│         └─→ window.__HOST_DEPENDENCIES__                                │
│     └─→ app.mount('#app')            (no module frontend fetched)       │
│                                                                         │
│  2. First Use                                                           │
│     └─→ moduleLoader.ensure(key)                                        │
│         ├─→ getFrontendModuleManifest (once): key → owning module       │
│         └─→ GET /module-bundles/<name>/<sha256>/bundle.js (once each)   │
│                                                                         │
│  3. Module Installation                                                 │
│     ├─→ Check the bytes against the hash, if crypto.subtle exists       │
│     ├─→ Dynamic import(blobUrl)                                         │
│     └─→ module.install(hostDependencies)                                │
│         └─→ componentRegistry scoped to the module's own keys           │
│                                                                         │
│  4. Render                                                              │
│     └─→ Reactive registry lookup renders the component                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Host Dependencies:**

```typescript
// Exposed to modules via window.__HOST_DEPENDENCIES__ (services/ModuleLoader.ts)
interface HostDependencies {
  useHostContext: typeof useHostContext;
  services: {
    componentRegistry: typeof componentRegistry; // install() gets a scoped view
  };
  __VUE__?: any;                // the host's Vue runtime
  __JSONFORMS__?: {             // the host's JSONForms engine, no renderers
    core: typeof JsonFormsCore;
    vue: typeof JsonFormsVue;
  };
  __APP_CONTEXT__?: any;        // the host app context
  reporting?: ReportingKit;     // the report kit (optional; see 9. Report Kit)
}

// The version of this shape; a module's manifest names the range it supports.
const HOST_API_VERSION = 1;
```

The loading flow, failure handling and scoped registry are in [Dynamic Module System](./LLD/MODULE_SYSTEM.md).

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

**Unlinked references.** [`components/Disposition/UnresolvedReferencesBadge.vue`](../../../apps/dt-ui/src/components/Disposition/UnresolvedReferencesBadge.vue) renders a finding's read-only `unresolvedReferences` as an outlined warning chip, "N unlinked", with the references listed in a tooltip. It sits next to the technique chips in the exposures table and the exposure detail view, and in the control dialog's countermeasure rows. It renders nothing when every reference linked. The backend sets the marker; see [Reference resolution](../backend/LLD/SET_INSTANTIATION_ATTRIBUTES.md#reference-resolution).

**Supersede (Fork) flow.** Selecting "Customize as your own copy" calls `flowStore.supersedeExposure` / `controlsStore.supersedeCountermeasure`, which delegate to the pure dt-core orchestrators (`executeSupersedeFlow` / `executeSupersedeCountermeasureFlow`). The flow clones the SYSTEM finding into an editable USER copy and disposes the original as `SUPERSEDED`. If the disposal half fails after the copy is created, the venue shows a `warning` snackbar with a **Retry** action. Stores are thin passthroughs to dt-core; the venue refetches after a successful write. See [Implementation Patterns — Shared Surface Patterns](./LLD/Data%20architecture/IMPLEMENTATION_PATTERNS.md#shared-surface-patterns) for the composable / dialog / passthrough / partial-failure mechanics, and the [dt-core disposition operations](../dt-core/GRAPHQL_OPERATIONS.md#disposition-operations) for the result-envelope contract.

### 8. MITRE Technique Picker

A drawer / inline picker for attaching MITRE techniques, defenses, or mitigations to a finding. It blends instant local matching with server-side semantic search, and degrades gracefully when the semantic tier is unavailable.

| Piece | File | Role |
|-------|------|------|
| Wrapper | [`components/Mitre/TechniquePicker/TechniquePicker.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePicker.vue) | Multi-bind `v-model: string[]` of `mitreId`s; composes chips + inline input + browse drawer; pushes recents on commit |
| Inline input | [`components/Mitre/TechniquePicker/TechniquePickerInline.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePickerInline.vue) | Typeahead with synchronous local tier and 300 ms-debounced vector tier; exposes `seedSearch()` for "Suggest matches" |
| Result rows | [`components/Mitre/TechniquePicker/TechniquePickerResults.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePickerResults.vue) | Shared row: monospace ID + name + tactic + one-line description; 3-dot similarity meter for `VECTOR_SIMILARITY` |
| Preview pane | [`components/Mitre/TechniquePicker/TechniquePreview.vue`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/TechniquePreview.vue) | Detail card for the browse drawer; kind-aware ID label, tactic row hidden for the mitigation kinds (`ATTACK_MITIGATION`, `ATLAS_MITIGATION`) |
| Tactic facets | [`components/Mitre/TechniquePicker/tacticFacets.ts`](../../../apps/dt-ui/src/components/Mitre/TechniquePicker/tacticFacets.ts) | Browse-drawer tactic chips with entry counts, in matrix order: ATT&CK and ATLAS by each entry's `tacticOrder`, D3FEND by its own fixed order; a tactic without a position goes last; no facets for mitigation kinds |
| Store | [`stores/techniqueSuggestionsStore.ts`](../../../apps/dt-ui/src/stores/techniqueSuggestionsStore.ts) | Vector-tier match results + locally hydrated catalog, keyed by `MitreKind` (all five kinds, ATLAS included); tracks `vectorAvailable` + `vectorDisabledReason` |
| Recents | [`composables/useRecentTechniques.ts`](../../../apps/dt-ui/src/composables/useRecentTechniques.ts) | Auth-scoped, model + kind scoped localStorage MRU list (max 8) |

**Two-tier matching.** The inline input runs a synchronous scan over the store's hydrated catalog for the deterministic tiers (`EXACT_ID` / `PREFIX_ID` / `NAME_MATCH` / `DESCRIPTION_MATCH`), giving instant feedback. When the query is at least 4 characters and has no local exact-ID hit, it also fires a debounced server call to the vector tier (`VECTOR_SIMILARITY`) through `techniqueSuggestionsStore.matchTechniques` → `DtMitre.matchTechniques`. Vector results that duplicate a local row are suppressed.

**Suggest matches.** Host dialogs ([`Dialogs/DataFlow/ExposureDialog.vue`](../../../apps/dt-ui/src/components/Dialogs/DataFlow/ExposureDialog.vue), [`Dialogs/Control/CounterMeasureDialog.vue`](../../../apps/dt-ui/src/components/Dialogs/Control/CounterMeasureDialog.vue)) expose a **Suggest matches** affordance that calls the picker's `seedSearch()` with the finding's description. This seeds the vector tier directly — bypassing the keystroke debounce — and widens the per-query budget (`topN = 10`) because description-seeded queries are diffuse and the genuinely relevant technique can rank below the typed-input default of 3.

**Graceful degradation.** When the server reports `vectorAvailable: false`, the picker keeps the deterministic tiers working and shows a caption explaining why semantic search is unavailable — one of four messages mapped from `vectorDisabledReason` (`EMBEDDING_DISABLED`, `NO_VECTORS`, `MODEL_MISMATCH`, `EMBEDDER_BUSY`). For `EMBEDDING_DISABLED` (the embedder is off or not ready, or the database cannot run vector search) it reads *Semantic search is unavailable on this deployment right now — showing name-based matches.* For `EMBEDDER_BUSY` (the embedder was too busy to embed that request's query in time) it reads *Semantic search is busy right now — showing name-based matches. Try again in a moment.* The catalog is hydrated through the `DtMitreAttack` / `DtMitreDefend` / `DtMitreAtlas` surfaces; `DtMitre` is used only for the vector tier. For ATT&CK and ATLAS techniques each catalog entry carries its earliest tactic by `matrix_order`, with that position as `tacticOrder`, which the tactic facets sort by. See the [dt-core `DtMitre` operations](../dt-core/GRAPHQL_OPERATIONS.md#dtmitre) and the [MITRE technique matching types](../dt-core/DOMAIN_MODEL.md#mitre-technique-matching).

**ATLAS links are display-only.** The exposures panel shows the ATLAS techniques that exploit an exposure, and the control dialog's countermeasures table shows the ATLAS mitigations a countermeasure implements, as chips next to the ATT&CK and D3FEND ones. Each ATLAS chip links to its atlas.mitre.org page ([`utils/mitreUrl.ts`](../../../apps/dt-ui/src/utils/mitreUrl.ts) builds ATT&CK and ATLAS page URLs from the id). The store knows the `ATLAS_TECHNIQUE` and `ATLAS_MITIGATION` kinds, but the exposure and countermeasure dialogs do not edit ATLAS links, and saving a dialog leaves them as they are.

### 9. Report Kit

`src/reporting/` is the report kit that module views use to export a report. The host exposes one kit per page, as `window.__HOST_DEPENDENCIES__.reporting` and as `useHostContext().reporting`. It frames a module's sections into one self-contained, printable HTML document with the installation's brand, draws the model diagram from a report's stored graph, reads an analysis's report details, and saves the file.

| File | Role |
|------|------|
| `index.ts` | The `ReportingKit` interface and the page's one kit (`getReportingKit`) |
| `frame.ts`, `frame.css.ts` | `buildReport`: cover, sections, footer, print stylesheet, `FrameStrings` |
| `diagram.ts` | `renderModelDiagram`: the stored model graph as SVG |
| `brand.ts` | `brand()`: the brand from `/config`, with the logo inlined as a data URI |
| `reportDetails.ts` | `reportDetails.get()`, and the queries the Report details dialog uses |
| `user.ts`, `userName.ts` | `currentUser()`: the signed-in user's display name, never an opaque id |
| `escape.ts` | `escapeHtml`, and the CSS string escaping the page margins use |
| `download.ts` | `download()`: the only code that knows the output format |

The frame, the diagram and escaping are pure functions: strings and data in, a string out. Only three members read anything: `brand()` fetches `/config` and the logo once per page load, `reportDetails.get()` runs one GraphQL query, and `currentUser()` reads the auth store. `download()` is the one function that touches the DOM.

The analysis results page (`pages/analysisresults.vue`) hosts the **Report details** dialog (`components/Dialogs/Analysis/ReportDetailsDialog.vue`), so no module builds its own editor. The module contract, its rules and an example are in [Dynamic Module System → Report Kit](./LLD/MODULE_SYSTEM.md#report-kit).

The dialog edits the client, the author and the project, each with a counter, and up to ten custom fields: rows of a label and a value with a remove button, added with **Add field**.

- **It mirrors the server's rules** (see [ReportDetailsResolverService](../backend/LLD/CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md#10-reportdetailsresolverservice)): lengths counted in code points, a label with a visible letter or digit, labels unique as a reader sees them, and the 4 KiB size of the stored details, so a form with every field within its limit can still be too large in total. It does not check for control or text-direction characters; the server refuses them, and the dialog shows the message for the code. A row's problem shows once the user moves out of one of its fields. The limits, the label rules and the message for each server error code are in `utils/reportDetailsInput.ts`; the server stays the one that enforces them.
- **Save sends only the keys the user changed,** so it leaves what another editor set in other keys. A changed custom-field list is sent whole.
- **The suggestion** (`suggestReportDetails`) is offered only when the form is entirely empty, as a one-line summary. **Use these details** fills every field from it; nothing is saved until **Save**.

### 10. Browser

`pages/browser.vue` (`/browser?dir=<folder id>`, `dir=root` for Home) shows one folder: its subfolders, then its models and controls as tiles. The header holds the [folder path](#folder-path), the [Browser search](#browser-search) and the folder buttons. The folder shown is also `folderStore.selectedFolder`, which is persisted, so the left rail's **Browser** link, which names no `dir`, returns to it.

#### Browser search

A field in the header, between the folder path and the folder buttons (placeholder "Search models and controls"), finds models and controls by name in every folder. Folders themselves are not searched. A list under the field shows up to 50 results, each with its kind (Model or Control) and its folder path. Enter or a click opens a result: a model in the data flow editor, a control in its dialog over the Browser. Alt+Enter or the row's folder icon (**Show in folder**) goes to the result's folder, scrolls its tile into view and outlines it for 2.5 seconds.

- Matching is the [canvas search](#canvas-search)'s: case, accents and repeated whitespace are ignored, and the whole name ranks first, then the name's start, then a word's start inside it, then anywhere. Within a rank: by name, then models before controls, then by folder path. An item with no name is never found.
- A path longer than four entries shows as Home / … / the last two, as the [folder path](#folder-path) does; the row's tooltip has the full path.
- The arrow keys move through the list and wrap. Esc clears the query; with the field empty, Esc leaves it. The field's clear button empties it. Leaving the field hides the list and keeps the query.
- Below a window width of 1100px the field is a magnifier button. The field it opens folds back into the button when it loses the focus with nothing typed. A window narrowed while the field is in use keeps the field open.
- Until the first index arrives the list reads "Searching…". If that fetch fails it reads "The search is unavailable right now. Click into the field to try again."

**Mechanism.** The content index is the id, name and folder id of every model and control. `DtFolder.getContentIndex()` reads it in one light query (`GET_CONTENT_INDEX`, `network-only`), and `folderStore.fetchContentIndex()` passes it on without keeping it in the store's state, resolving `null` on failure. `BrowserSearch.vue` fetches it, and the folder list with it (`folderStore.fetchFolders({ quiet: true })`, which leaves the page's loading and error state alone), each time the field gains the focus, so items and folders created, renamed or moved since, here or elsewhere, are found and placed. The last index stays in use while the next loads or if it fails, and an earlier fetch that answers late is dropped. Matching runs in the browser: `searchContent()` folds and ranks names with `normalise()` and `rankName()` from `utils/nameMatch.ts`, the functions the canvas search uses, and builds each path from the store's folder list with `folderAncestors()`, the walk the folder path uses.

- Like `CanvasSearch.vue`, the field is a text field with a list of its own (the combobox pattern), so the query outlives the focus.
- The list is teleported to the app root (`.v-application`, so the theme applies) and placed under the field with `position: fixed`, from the field's box, again on resize and on any scroll while it shows. Inside the header it would be clipped by the header card, which is also translucent and painted over by the content below it.
- Opening a model (`openFromSearch`) first sets `folderStore.selectedFolder` to the model's folder and replaces the Browser's URL with that folder's `dir`, then pushes `/dataflow?id=<model>`. Back and the rail's **Browser** link then return to the model's folder. A flag (`leavingForModel`) stops that interim navigation from fetching the folder's models and controls. If the editor navigation is refused or throws (a guard, or the editor's code failing to load), the flag is cleared and the page loads the folder its URL now names.
- Show in folder (`showInFolder`) pushes the folder's `dir` when it is not the one shown and sets `foundId`. Once models and controls have loaded, the tile whose `data-browser-item` is that id scrolls into view and carries `tile-found` until the timer clears it.
- A control from another folder is not in `controlsStore.controls`, which holds the folder shown; `ControlDialog` then takes its title from the name the control was last saved with.

**Source:** `apps/dt-ui/src/components/Browser/BrowserSearch.vue`; matching in `utils/browserSearch.ts` (`searchContent`, `pathText`, `BrowserSearchResult`) and `utils/nameMatch.ts` (`normalise`, `rankName`); wired in `pages/browser.vue` (`openFromSearch`, `showInFolder`, `compactSearch`); index in `stores/folderStore.ts` (`fetchContentIndex`) and dt-core's `DtFolder.getContentIndex` (see [DtFolder](../dt-core/GRAPHQL_OPERATIONS.md#dtfolder)). Tests: `components/Browser/__tests__/BrowserSearch.test.ts`, `pages/__tests__/browser.search.test.ts`, `utils/__tests__/browserSearch.test.ts`, `utils/__tests__/nameMatch.test.ts`.

#### Folder path

The header's breadcrumbs show the path from Home to the folder shown. A trail of more than four entries, Home included, shows Home, a "…" button and the last two folders; the button opens a menu of the folders in between. Each name is cut with an ellipsis after 180px, with the full name as its tooltip. The trail takes the room the search and the folder buttons leave, and gives way first.

**Source:** `apps/dt-ui/src/utils/breadcrumbs.ts` (`folderAncestors`, `collapseTrail`, both also used for the search's paths), applied in `pages/browser.vue` (`buildBreadcrumbs`, `trail`). Tests: `utils/__tests__/breadcrumbs.test.ts`, `pages/__tests__/browser.search.test.ts`.

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
      '/graphql': { target: 'http://localhost:3003/graphql', ws: true },
      '/module-bundles': { target: 'http://localhost:3003', changeOrigin: true },
      // Anchored: a plain key matches by prefix and would take a route such as /configuration
      '^/config$': { target: 'http://localhost:3003', changeOrigin: true },
      '^/branding/': { target: 'http://localhost:3003', changeOrigin: true }
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

  // The installation's brand for reports; null or absent when unbranded
  branding?: BrandingConfig | null;
}
```

**Branding.** `/config` carries the installation's brand as `branding`. `src/config/branding.ts` (`parseBrandingConfig`) checks it again on the client: a brand needs a name, the URL must be https with no user name or password, and a logo is kept only at its `/branding/logo/<sha256>` path with both dimensions. Anything else is dropped. A development build reads its config from the `VITE_` variables and leaves `branding` null; there the report kit reads `/config` itself, through the dev server's proxy.

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
| `pages/dataflow.vue` | `/dataflow?id=<model>&element=<id>&tab=<name>`: `id` opens the model; `element` and `tab` are optional, see [Linking to an element](#linking-to-an-element) | Yes |
| `pages/browser.vue` | `/browser?dir=<folder>`: `dir` is a folder id, or `root` for Home; without it the remembered folder opens, see [Browser](#10-browser) | Yes |
| `pages/issues.vue` | `/issues` | Yes |
| `pages/modules.vue` | `/modules` | Yes |
| `pages/login.vue` | `/login` | No |
| `pages/auth/callback.vue` | `/auth/callback` | No |
| `pages/auth/logout.vue` | `/auth/logout` | No |
| `pages/auth/not-admitted.vue` | `/auth/not-admitted` | No — reached *while* signed in, when the deployment refuses a freshly issued token (see [Error Handling](#2-graphql-client-apollo)); under `/auth/` so the guard lets a signed-in person reach it without a loop through the identity provider |

### Linking to an element

`/dataflow?id=<model>&element=<id>` selects that component, boundary or data flow once the model has loaded, and centres it on the canvas. A data flow is framed on its two endpoints. The model's default (root) boundary is selected as a click on the empty canvas selects it.

`&tab=<name>` also opens the element's settings window on that tab. The names are the settings window's own: `general`, `zoning`, `attributes`, `data`, `controls`, `exposures`. Zoning shows only for a boundary other than the default one.

- An unknown tab, or a tab the element does not show, only selects, without a message.
- An id that is not one of the loaded model's components, boundaries or data flows (another model's element, a data item, a deleted one) selects nothing and shows a short warning: "The linked element is not in this model."
- Each parameter must appear once, as a plain string; a repeated parameter is ignored. An `element` that is missing, repeated, empty or not a plain string shows no warning.
- The link is read when the editor page opens, as `id` is, and is one attempt, on the first load of the linked model. If that load fails or is overtaken by another, the link is dropped, and a later load of the model does not apply it.

**Source:** `apps/dt-ui/src/utils/editorLink.ts` (`resolveEditorLink`, `isSettingsTabShown`), applied in `components/DataFlow/DataFlow.vue`.

**A link survives the sign-in.** A link opened in a tab that is not signed in goes to `/login`, and once the tab is signed in it returns to the linked address, not the home page:

- **What qualifies is the router's call.** The address must be one the router resolves to one of the app's pages: never a sign-in route (`login`, `auth-callback`, `auth-logout`, `auth-not-admitted`) and never the catch-all. It must be a plain path under this origin (no `//`, no backslash or control character, at most 2,048 characters).
- **Anything else goes home**, as does an address kept more than ten minutes, or one kept when storage is not available.
- **Per tab, taken once.** The address is kept in the tab's `sessionStorage`, as the sign-in is per tab, and a later signed-out request replaces it. The callback takes it once the sign-in succeeds, checks it again (anything in the origin can write that storage), and redirects to the parsed address, never the stored string. A failed sign-in does not take it, so a retry still returns there. Clearing the session (`clearState`) clears it.

**Not covered yet:** a session that ends in an open tab, an expired session or a refused token, still returns home after signing in again.

**Source:** `apps/dt-ui/src/router/returnPath.ts` (`rememberReturnPath`, `takeReturnPath`, `isReturnPath`), `router/guard.ts` (`createAuthGuard`), and `stores/authStore.ts` (`handleCallback`).

### Navigation Guard

The guard is `createAuthGuard` in `router/guard.ts`, registered in `router/index.ts`:

```typescript
// router/index.ts
setRouteResolver((to) => router.resolve(to))   // what returnPath.ts asks
const authGuard = createAuthGuard()
router.beforeEach((to) => authGuard(to, useAuthStore()))

// router/guard.ts
export function createAuthGuard() {
  let authInitialized = false
  return async function authGuard(to, authStore): Promise<true | string> {
    if (!authInitialized) {
      await authStore.initializeAuthMode()   // once, before the first navigation
      authInitialized = true
    }
    if (authStore.authDisabled) return true  // no-auth: every route opens
    if (to.path === '/login' || to.path.startsWith('/auth/')) return true
    if (!authStore.isAuthenticated) {
      rememberReturnPath(to.fullPath)        // the address the sign-in returns to
      return '/login'
    }
    return true
  }
}
```

After a successful callback, `handleCallback` redirects to `takeReturnPath(BASE, window.location.origin) ?? ROUTES.HOME`.

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
- **Proxy**: `/graphql`, `/module-bundles`, `/config` and `/branding/` → `localhost:3003`
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
6. **Host Dependencies**: Vue runtime exposed to dynamically loaded modules, whose frontends load on first use
7. **Persistent State**: Auth tokens and UI state survive page reloads

This architecture provides a responsive, real-time threat modeling interface while maintaining extensibility through the dynamic module system and flexibility through multi-provider authentication support.
