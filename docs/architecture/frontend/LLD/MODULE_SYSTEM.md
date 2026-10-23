# Dynamic Module System

## Table of Contents
- [Overview](#overview)
- [Module Loading Flow](#module-loading-flow)
- [Failure Handling](#failure-handling)
- [Host Dependency Injection](#host-dependency-injection)
- [Component Registry](#component-registry)
- [Host Context Composable](#host-context-composable)
- [Application Initialization](#application-initialization)
- [Module Development Guide](#module-development-guide)
- [Security Considerations](#security-considerations)
- [API Surface](#api-surface)
- [Debugging](#debugging)

## Overview

The dynamic module system lets a module ship Vue components that dt-ui loads at runtime, without rebuilding the frontend application. A module frontend is two files, `frontend/bundle.js` and `frontend/frontend-manifest.json`; the manifest names the component keys the bundle registers (see [DTModule Interface → Module frontend](../../modules/DT_MODULE_INTERFACE.md#module-frontend)).

dt-ui loads **no module frontend before it mounts**. A module's bundle is fetched the first time one of its component keys is needed, once per module.

**Primary Source Files:**
- `apps/dt-ui/src/services/ModuleLoader.ts`
- `apps/dt-ui/src/services/ComponentRegistry.ts`
- `apps/dt-ui/src/composables/useHostContext.ts`
- `apps/dt-ui/src/pages/analysisresults.vue` (the page that renders module components)
- `apps/dt-ws/src/gql/module-management-services/module-frontend.ts` (dt-ws: reading and serving bundles)
- `apps/dt-ws/src/modules/module-bundle.controller.ts` (dt-ws: the bundle route)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Module Loading Architecture                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Application Startup (no module is fetched)                          │
│     └─→ ModuleLoader.exposeHostDependencies()                           │
│         └─→ window.__HOST_DEPENDENCIES__                                │
│     └─→ app.mount('#app')                                               │
│                                                                         │
│  2. First Use: moduleLoader.ensure(key)                                 │
│     └─→ Key already registered? Return the component                    │
│     └─→ Otherwise read the manifest (getFrontendModuleManifest, once)   │
│         └─→ key → owning module                                         │
│                                                                         │
│  3. Bundle Fetch (once per module)                                      │
│     └─→ GET /module-bundles/<name>/<sha256>/bundle.js                   │
│         └─→ Bearer token; same origin as the API; no redirects          │
│     └─→ Check the bytes against the manifest hash                       │
│                                                                         │
│  4. Dynamic Import                                                      │
│     └─→ Blob → object URL → import(blobUrl) → revoke the URL            │
│                                                                         │
│  5. Module Installation                                                 │
│     └─→ module.install(hostDependencies)                                │
│         └─→ componentRegistry scoped to the module's own keys           │
│                                                                         │
│  6. Render                                                              │
│     └─→ The registry is reactive: the waiting view renders the          │
│         component once it is registered                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Module Loading Flow

### What dt-ws holds

When the module registry loads or reloads a module, it reads `frontend/bundle.js` and `frontend/frontend-manifest.json` once and holds, on the module's registry entry, the bundle bytes, their sha256, gzip and brotli copies, and the validated manifest. A request never reads the disk. A reload replaces the whole held copy at once, so a URL carrying an old hash is never answered with new bytes.

A frontend that cannot be used is refused and logged by module name (`Module frontend not loaded`, with the reason); the module itself stays loaded. Refusals:

- one of the two files without the other;
- a file that is not a regular file (a symlink, a FIFO), or `frontend/` that is not a directory;
- a manifest over 64 KiB or a bundle over 32 MiB;
- a manifest that does not validate (`parseFrontendManifest` from `@dethernety/dt-module`).

**Source:** `module-frontend.ts` (`loadModuleFrontend`), `module-registry.service.ts` (`attachFrontend`)

### The manifest query

`getFrontendModuleManifest` returns one entry per module that is on the module allow-list (`ALLOWED_MODULES`) and has a frontend, sorted by name. It carries no bundle text.

| Field | Meaning |
|-------|---------|
| `name`, `version` | The module |
| `available` | `false` while the module is unhealthy; its bundle route then answers `503` |
| `hash` | sha256 of the bundle, lowercase hex |
| `size` | Bundle size in bytes, uncompressed |
| `url` | `/module-bundles/<name>/<hash>/bundle.js` |
| `components` | The component keys the bundle registers |
| `hostApi` | `{ min, max }`, the host dependency versions the bundle works with |

dt-ui reads it through `DtModule.getFrontendModuleManifest()` (dt-core, `network-only`) via `modulesStore.getFrontendModuleManifest()`.

### The bundle route

`GET /module-bundles/:name/:hash/bundle.js`, behind `JwtAuthGuard`, as the SSE route is.

| Condition | Response |
|-----------|----------|
| No registered module of that name, no frontend, or not on the module allow-list | `404` |
| The module is unhealthy | `503` |
| `:hash` is not the current bundle's sha256 | `404` |
| Otherwise | `200`, the held bytes |
| `If-None-Match` matches the ETag | `304` |

A `200` or `304` carries `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: private, max-age=31536000, immutable`, `Vary: Accept-Encoding` and an ETag per encoding (`"<hash>"`, `"<hash>-gz"`, `"<hash>-br"`). The encoding follows `Accept-Encoding`: brotli, then gzip, then none.

The hash makes the URL content-addressed: a bundle never changes under its URL, so the browser keeps it for a year, and a new bundle gets a new URL.

**Source:** `module-bundle.controller.ts`, `module-frontend.ts` (`lookupBundle`, `bundleResponse`). The SPA fallback skips `/module-bundles`, and the dt-ui dev server proxies it to dt-ws.

### `ensure(key)`

**Source:** `ModuleLoader.ts`

```typescript
async ensure(key: string): Promise<Component>
```

1. If the registry already has `key`, return it.
2. Read the manifest on first use, and index it: component key → owning module.
3. No module owns `key`: forget the manifest (a module may have been installed since) and fail.
4. Load the owner, once per module: fetch the bundle from the manifest's `url`, check its hash, import it, call `install()`.
5. Return the registered component. If `install()` did not register the key it declared, forget the load and fail.

Every failure is a `ModuleFrontendError` with a `kind`: `unloadable`, `unavailable` or `host-api`.

### `prefetch(moduleName)`

Starts loading a module's frontend ahead of need, when the caller knows the owning module before it knows the key. A module that cannot be used now is left for `ensure()` to report; `prefetch()` never throws.

### Bundle fetch

**Source:** `ModuleLoader.ts` (`fetchBundle`)

- The `url` from the manifest is resolved against the API server's URL (the configured GraphQL URL). The result must have the API server's origin and a path under `/module-bundles/`; anything else is refused before a request is made.
- The request carries `Authorization: Bearer <token>` unless auth is disabled, and uses `redirect: 'error'`, so a redirect fails the fetch. The token never leaves the API origin.
- Where `crypto.subtle` exists, the bytes' sha256 must equal the manifest's `hash`. `crypto.subtle` exists only in a secure context, so over plain HTTP on a host other than `localhost` or a loopback address the check is skipped.

### Dynamic import and install

The bundle text is wrapped in a `Blob` (`application/javascript`), imported from an object URL with `/* @vite-ignore */`, and the URL is revoked in a `finally` block. The default export (or the module namespace) must have an `install` function.

`install()` receives the host dependencies (`window.__HOST_DEPENDENCIES__`) with one change: `services.componentRegistry` is a registry **scoped to the keys this module owns** (see [Scoped registry](#scoped-registry)).

### The analysis results page

`pages/analysisresults.vue` renders an analysis document's first non-`metadata.*` key as a module component.

1. When the analysis is fetched, the page calls `moduleLoader.prefetch()` with the analysis class's module name, so the bundle loads alongside the index document instead of after it.
2. When the index document arrives and its key is not registered, the page calls `ensure(key)` and shows **Loading analysis view…**.
3. The component renders once it is registered.
4. On failure the page shows an error with **Retry**, which calls `ensure(key)` again.

| Error kind | Message |
|------------|---------|
| `unloadable` | This analysis view couldn't be loaded. |
| `unavailable` | This analysis view is unavailable right now. Try again shortly. |
| `host-api` | This analysis view needs a different version of the app. Reload the page; if that doesn't help, ask an administrator to update the module. |

### User Timing marks

Read them with `performance.getEntriesByType('measure')`. Each measure carries `detail.ok`.

| Measure | From → to | `detail.ok` |
|---------|-----------|-------------|
| `dt:mount` | `dt:boot` → `dt:mounted` | `false` if initialization threw |
| `dt:module:<name>` | Start → end of one module frontend load | `false` for a failed load |
| `dt:view:<key>` | The analysis fetch → its module component rendering it | Always `true`; a failed view is not measured |

**Source:** `utils/userTiming.ts`. A timing call never throws.

---

## Failure Handling

| Situation | What the loader does | Error kind |
|-----------|----------------------|------------|
| Manifest query fails | Forgets the manifest; the next `ensure()` asks again | `unloadable` |
| No module declares the key | Forgets the manifest | `unloadable` |
| A key is declared by two or more modules | Gives it to neither; logs both names | `unloadable` |
| `available: false` | No fetch; forgets the manifest, to notice recovery | `unavailable` |
| `HOST_API_VERSION` outside the module's `hostApi` range | No fetch | `host-api` |
| Bundle URL off the API origin or outside `/module-bundles/` | No fetch | `unloadable` |
| `401` | Refreshes the token and retries once (not when auth is disabled) | `unloadable` if it still fails |
| `404` (a stale hash: the module changed since the manifest was read) | Rereads the manifest once and fetches the new URL | `unloadable` if it still fails |
| `503` | — | `unavailable` |
| Other non-2xx, a redirect, a network error | — | `unloadable` |
| Hash mismatch | Does not import | `unloadable` |
| No `install` function, or `install()` throws | — | `unloadable` |
| `install()` does not register a key it declared | Forgets the load | `unloadable` |

A failed load is forgotten, so the next `ensure()`, the page's **Retry**, starts again. Failures are logged to the console (`Failed to load module <name>:`) and are never silenced.

---

## Host Dependency Injection

### Global Exposure

**Source:** `ModuleLoader.ts` (`exposeHostDependencies`)

```typescript
static exposeHostDependencies(VueRuntime?: any, appContext?: any): void {
  window.__HOST_DEPENDENCIES__ = {
    useHostContext,
    services: {
      componentRegistry,
    },
    __VUE__: VueRuntime,
    __JSONFORMS__: { core: JsonFormsCore, vue: JsonFormsVue },
    __APP_CONTEXT__: appContext,
  }
}
```

### HostDependencies Interface

**Source:** `ModuleLoader.ts`

```typescript
export interface HostDependencies {
  useHostContext: typeof useHostContext
  services: {
    componentRegistry: typeof componentRegistry
  }
  __VUE__?: any
  // The host's JSONForms engine: @jsonforms/core and @jsonforms/vue only.
  // Modules supply their own renderer set.
  __JSONFORMS__?: {
    core: typeof JsonFormsCore
    vue: typeof JsonFormsVue
  }
  __APP_CONTEXT__?: any
}

export const HOST_API_VERSION = 1
```

`HOST_API_VERSION` is the version of this shape. A module frontend's manifest names the range it works with (`hostApi`); the host raises the version when the shape changes incompatibly, and refuses a module whose range excludes it.

### Why Window Global?

Dynamic imports cannot access the host application's module scope. The window global provides a bridge:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Host Application                                │
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │  Vue Runtime    │    │  Pinia Stores   │    │  Component      │      │
│  │                 │    │                 │    │  Registry       │      │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘      │
│           │                      │                      │               │
│           └──────────────────────┼──────────────────────┘               │
│                                  │                                      │
│                   ┌──────────────┴────────────────┐                     │
│                   │  window.__HOST_DEPENDENCIES__ │                     │
│                   └──────────────┬────────────────┘                     │
│                                  │                                      │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────────────┐
│                   Dynamically Loaded Module                             │
│                                  │                                      │
│                 ┌────────────────┴────────────────┐                     │
│                 │  const { useHostContext,        │                     │
│                 │    services } =                 │                     │
│                 │    window.__HOST_DEPENDENCIES__ │                     │
│                 └─────────────────────────────────┘                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Registry

**Source:** `ComponentRegistry.ts`

The registry maps a component key to `{ component, moduleId, globalName }` and tracks which keys each `moduleId` registered.

| Method | Purpose |
|--------|---------|
| `register(key, component, moduleId?)` | Store the component (`markRaw` unless it is a loader function) and a global name: `my_component` → `DynamicMyComponent` |
| `unregister(key)` / `unregisterModule(moduleId)` | Remove one key, or every key a module registered |
| `get(key)` | The component, or `undefined` |
| `getComponent(key)` | As `get`, with a console warning when the key is missing |
| `getComponentName(key)` | The global name |
| `hasComponent(key)`, `getAvailableComponents()`, `getModuleComponents(moduleId)`, `getAllModules()`, `getComponentInfo(key)` | Lookups |
| `scoped(owns, onRefused)` | The per-module view `install()` receives |

**markRaw:** keeps Vue from making a component reactive, which saves memory and render work.

### Reactive lookups

The maps are plain, so Vue would not see a change. Every change increments a `shallowRef` revision and every lookup reads it, so a `computed` over `get(key)` re-runs when a module frontend that loads later registers its components. This is how the analysis results page renders a component that was not registered when the page opened.

### Scoped registry

`scoped(owns, onRefused)` returns a `ModuleComponentRegistry`: the registry's public methods and none of its state.

- `register` and `unregister` act only on keys `owns(key)` accepts; any other key is refused, logged (`Module <name> touched the component "<key>", which it does not own: ignored`) and not registered.
- `unregisterModule` removes only the owned keys.
- Lookups read the whole registry.

The loader's `owns` accepts the keys the manifest index gives the module. A key two modules declare belongs to neither, so neither can register it, and a view that needs it fails visibly instead of rendering whichever module loaded last.

This prevents accidental collisions between modules. It is **not isolation**: a module frontend runs with full page privilege and can reach the unscoped registry through `window.__HOST_DEPENDENCIES__`.

---

## Host Context Composable

### Context Structure

**Source:** `useHostContext.ts:22-65`

```typescript
export function useHostContext() {
  // Vue Router
  const router = useRouter()
  const route = useRoute()

  // Pinia Stores (selective exposure)
  const analysisStore = useAnalysisStore()
  const issueStore = useIssueStore()

  // Safe component resolution with error handling
  const safeResolveComponent = (name: string) => {
    try {
      return resolveComponent(name)
    } catch {
      console.warn(`[useHostContext] Component not found: ${name}`)
      return null
    }
  }

  return {
    // Navigation
    router,
    route,

    // Pinia stores: analysisStore + issueStore only. This is an API-surface / coupling
    // choice (modules shouldn't reach into flowStore internals), NOT a data boundary —
    // modules already hold full token-scoped GraphQL via `utils` below. See "Module
    // trust model" for the honest surface.
    stores: {
      analysisStore,
      issueStore
    },

    // Services
    services: {
      componentRegistry,
      openDispositionDialog
    },

    // Vue Composition API primitives
    vue: {
      ref,
      reactive,
      computed,
      watch,
      getCurrentInstance,
      provide,
      inject,
      nextTick,
      onMounted,
      onUnmounted,
      resolveComponent
    },

    // Utilities — INCLUDING full token-scoped GraphQL. The dt-core accessors below are
    // constructed on the host's shared *authenticated* Apollo client, so a module can
    // read AND write (create/update/delete); authorization is enforced only server-side,
    // exactly as for the host UI. This is the real module trust surface — see below.
    utils: {
      resolveComponent: safeResolveComponent,
      getPageDisplayName,
      dtUtils: new DtUtils(apolloClient),
      dtModel: new DtModel(apolloClient),
      dtClass: new DtClass(apolloClient),
      dtMitreAttack: new DtMitreAttack(apolloClient)
    }
  }
}
```

### Exposed Services

The `services` object gives a module bundle controlled access to host capabilities it cannot construct on its own:

| Service | Signature | Purpose |
|---------|-----------|---------|
| `componentRegistry` | `register(key, component, moduleId)` / `getComponent(key)` | Register a module's Vue components by key so the host can resolve and render them (e.g. an analysis-results page resolving a module's document component). |
| `openDispositionDialog` | `(args: OpenDispositionArgs) => Promise<DispositionMutationResult \| null>` | Open the platform's shared finding-disposition dialog from anywhere — including module bundles and host pages that have no access to `flowStore` or dt-ui components. Now supports an **affirm mode** (the dialog with its kind locked to `AFFIRMED`, only the reason editable). |
| `affirmFinding` | `({ finding }) => Promise<DispositionMutationResult>` | One-click affirm — dispose the finding with kind `AFFIRMED` (reviewed and confirmed a real, live risk). |
| `clearFindingDisposition` | `({ finding }) => Promise<DispositionMutationResult>` | Lift any disposition (including Undo of an affirm). Idempotent. |
| `supersedeFinding` | `({ finding, elementId }) => Promise<…>` | Clone a SYSTEM finding into a USER-editable copy and dispose the original as `SUPERSEDED`. |
| `deleteFinding` | `({ finding }) => Promise<boolean>` | Delete a USER-authored finding. |
| `openFindingIssueSelector` | `({ finding, elementId, modelId, elementLabel? }) => Promise<FindingIssueResult \| null>` | Open the platform's finding → issue workflow (the same picker as the exposures tab: "Add to Issue board", or create a real issue of a chosen class attached to the element). |

**Finding-action services — narrow action functions, never the store.** The five
services above (`affirmFinding`, `clearFindingDisposition`, `supersedeFinding`,
`deleteFinding`, `openFindingIssueSelector`) each map a finding reference onto a
single canonical `flowStore` → `dt-core` mutation — the *same* write path the
dt-ui exposures tab calls — so a module-loaded surface (e.g. the Threat Report's
Residual Risk ledger) gets behaviour that cannot drift from the platform's. This
preserves the trust model: the Pinia `flowStore` itself is **never** handed to a
module; only these bounded, session-scoped action functions are, each returning a
result envelope. The caller owns feedback (snackbar/Undo) and refresh. The
disposition lifecycle (`AFFIRMED` as the one live-keeping kind, Supersede,
re-derivation survival) is specified in
[ADR-010](../../decisions/010-finding-affirmation-lifecycle.md), which extends
[ADR-007](../../decisions/007-finding-disposition-lifecycle.md).

**`openDispositionDialog` — finding triage from a module.** A single `<DispositionDialog>` is mounted once in `layouts/default.vue` and bound to a small `dispositionDialogStore`. A caller invokes `openDispositionDialog(args)` and awaits the returned promise, which resolves with the mutation result on **save/clear** or `null` on **cancel/close**. A new call supersedes any pending one (resolving the prior as cancelled).

```typescript
interface OpenDispositionArgs {
  finding: DispositionableFinding
  findingType?: FindingType // defaults to 'EXPOSURE'
}
```

The dialog itself owns the write path (`flowStore.disposeExposure` / `controlsStore.disposeCountermeasure`); this service only marshals open/close state and the pending promise. It **does not widen scope** — disposal remains bounded by the platform's session-scoped, authenticated mutation. This lets a module (such as the Threat Report's Residual Risk ledger) route a finding's disposition action through the platform's real triage flow rather than reimplementing it.

**`openFindingIssueSelector` — the finding → issue workflow.** The same
singleton-dialog pattern backs the issue workflow. A `stores/issueDialogStore.ts`
drives a single global `<FindingIssueDialog>` mounted once in
`layouts/default.vue` (alongside the global `<DispositionDialog>`). A caller
invokes `openFindingIssueSelector(args)` and awaits the picker outcome — "Add to
Issue board" (copy + redirect) or a real issue created of a chosen class and
attached to the element. The host owns all issue logic; the module only triggers
it, so there is no drift and no second issue implementation in module code.
The issue's description is `finding.description` as the caller gives it; a finding
passed without one is described as `Exposure: <name>`. The finding's id, the element
and the model are linked to the issue, each only when it names a node, and an id the
caller leaves out is never sent.

> Note: the window-level `HostDependencies.services` (exposed via `ModuleLoader.exposeHostDependencies`) carries only `componentRegistry`; the finding-action services (`openDispositionDialog`, `affirmFinding`, `clearFindingDisposition`, `supersedeFinding`, `deleteFinding`, `openFindingIssueSelector`) are provided through the `useHostContext()` composable, which is the surface modules call.

### Exposed Vue Primitives

| Category | Functions |
|----------|-----------|
| **Reactivity** | `ref`, `reactive`, `computed`, `watch` |
| **Lifecycle** | `onMounted`, `onUnmounted` |
| **Dependency Injection** | `provide`, `inject` |
| **Component** | `resolveComponent`, `getCurrentInstance` |
| **Async** | `nextTick` |

### Module trust model — full-trust, governed server-side

Runtime-loaded modules are **first-party, trusted code**. Beyond the two Pinia stores,
`useHostContext().utils` hands each module `DtUtils` / `DtModel` / `DtClass` /
`DtMitreAttack` constructed on the host's shared **authenticated** Apollo client — i.e.
full, token-scoped GraphQL **including create / update / delete**. There is **no
client-side capability boundary**; authorization is enforced only server-side (per-request
JWT), exactly as for the host UI itself.

Two things are commonly mistaken for a security boundary but are not:

- **Limiting the exposed Pinia *store* set to `analysisStore` + `issueStore`** is an
  API-surface / coupling choice (modules shouldn't reach into `flowStore` internals). It is
  **not** a data-access or exfiltration control — a module already has the full GraphQL
  surface via `utils.dtUtils` and can read or mutate anything the session is authorized for.
- **`authStore` not being handed out** means a module can't read the raw refresh token, but
  a module *can* still make authenticated requests through the bridged client.

The real control is the same as the backend's: **only load modules you trust** (backend
allowlist + source validation in production; see
[SECURITY_MODEL.md](../../../SECURITY_MODEL.md)). Treat a loaded module as part of the
application's trust base.

---

## Application Initialization

### Startup Sequence

**Source:** `main.ts` (`initializeApp`)

```typescript
const initializeApp = async () => {
  timingMark('dt:boot')
  try {
    // 1. Apollo client (async: fetches the runtime config)
    await initializeApolloClient()

    // 2. Auth mode, including no-auth, before anything authenticated runs
    await useAuthStore().initializeAuthMode()

    // 3. Host dependencies, for module frontends loaded later
    ModuleLoader.exposeHostDependencies(VueRuntime, app._context)

    // 4. Mount. No module frontend has been fetched.
    app.mount('#app')
    markMounted(true)   // dt:mounted, measure dt:mount
  } catch (error) {
    app.mount('#app')
    markMounted(false)
  }
}
```

Plugins (Pinia, router, Vuetify) are registered by `registerPlugins(app)` before `initializeApp()` runs.

**Order:**
1. Auth mode is resolved before mount, so the first authenticated request after mount, GraphQL or a module bundle, knows whether to send a token.
2. Host dependencies are exposed before mount, so any later `install()` finds them.
3. Module frontends load on first use, after mount (`moduleLoader.ensure`).

---

## Module Development Guide

**Reference implementation:** `modules/dethernety-threat-report/frontend/`

### Module Directory Structure

```
modules/my-module/frontend/
├── index.js                 # Module entry point with install/uninstall
├── frontend-manifest.json   # The component keys install() registers, and the hostApi range
├── vite.config.mjs          # Build configuration
├── externals/
│   └── vue-shim.js          # Vue runtime redirect to host
├── components/
│   ├── MyComponent.vue      # SFC components
│   └── AnotherComponent.vue
├── __tests__/
│   └── frontendManifest.test.js  # Contract test: install() registers exactly the manifest's keys
├── dist/
│   └── bundle.js            # Build output
└── bundle.js                # Copied from dist/; the packager takes this file and the manifest
```

### Frontend Manifest

```json
{
  "manifestVersion": 1,
  "components": ["my_component", "another_component"],
  "hostApi": { "min": 1, "max": 1 }
}
```

`components` must list exactly the keys `install()` registers. A bundle without a valid manifest is not loaded. The format, the validator and the contract test are in [DTModule Interface → Module frontend](../../modules/DT_MODULE_INTERFACE.md#module-frontend).

### Module Entry Point

A module exports `id`, `install`, and optionally `uninstall`:

**Example:** `modules/my-module/frontend/index.js`

```javascript
import MyComponent from './components/MyComponent.vue'
import AnotherComponent from './components/AnotherComponent.vue'

export default {
  id: "my-module-id",

  async install(hostDependencies) {
    if (!hostDependencies) {
      console.error('Host dependencies not provided to module')
      return
    }

    // Scoped to the keys this module's manifest declares
    const { componentRegistry } = hostDependencies.services || {}

    if (!componentRegistry) {
      console.error('Component registry not available')
      return
    }

    // Keys match the document keys the module's getDocument() returns,
    // and frontend-manifest.json's "components"
    const componentsToRegister = [
      { key: "my_component", component: MyComponent },
      { key: "another_component", component: AnotherComponent },
    ]

    componentsToRegister.forEach(({ key, component }) => {
      try {
        componentRegistry.register(key, component, "my-module-id")
      } catch (error) {
        console.error(`Failed to register component ${key}:`, error)
      }
    })
  },

  uninstall() {
    const deps = window.__HOST_DEPENDENCIES__
    if (deps?.services?.componentRegistry) {
      deps.services.componentRegistry.unregisterModule('my-module-id')
    }
  }
}
```

### Vue Shim Pattern (Critical for SFCs)

Modules using Single File Components (`.vue` files) must redirect Vue imports to the host runtime. This is achieved via a shim file and Vite alias.

**Example:** `modules/my-module/frontend/externals/vue-shim.js`

```javascript
// vue-shim.js - Redirects Vue imports to host runtime
const runtime = window.__HOST_DEPENDENCIES__?.__VUE__
if (!runtime) {
  throw new Error('[module] Host Vue runtime not found on window.__HOST_DEPENDENCIES__.__VUE__')
}

export default runtime

// Re-export all Vue APIs used by SFC compiler
export const {
  // Reactivity
  ref, shallowRef, reactive, readonly, computed, watch, watchEffect,
  toRef, toRefs, unref, isRef, isReactive, isReadonly, toRaw, markRaw,

  // Lifecycle
  onMounted, onUnmounted, onBeforeMount, onBeforeUnmount,
  onUpdated, onBeforeUpdate, onErrorCaptured,

  // App/Context
  provide, inject, getCurrentInstance, nextTick,

  // Component helpers
  defineComponent, defineAsyncComponent, h,

  // SFC compiler helpers (used in compiled templates)
  openBlock, createBlock, createVNode, createElementVNode, createElementBlock,
  createTextVNode, createCommentVNode, withCtx, withDirectives, withModifiers,
  renderList, renderSlot, createSlots, normalizeClass, normalizeStyle,
  resolveComponent, resolveDirective, Fragment, Teleport, Suspense,
  Transition, TransitionGroup,

  // v-model helpers
  vModelText, vModelCheckbox, vModelSelect, vModelDynamic,

  // Composition helpers
  useAttrs, useSlots,
} = runtime
```

### Vite Build Configuration

**Example:** `modules/my-module/frontend/vite.config.mjs`

```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    cssInjectedByJsPlugin()  // Injects CSS into JS bundle
  ],
  resolve: {
    alias: {
      // CRITICAL: Redirect 'vue' imports to shim
      vue: path.resolve(__dirname, 'externals/vue-shim.js'),
    },
  },
  build: {
    target: 'esnext',
    lib: {
      entry: './index.js',
      name: 'MyModule',
      fileName: () => 'bundle.js',
      formats: ['es']
    },
    rollupOptions: {
      output: {
        format: 'es',
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    },
    cssCodeSplit: false,  // CSS goes into JS for injection
    outDir: './dist',
    emptyOutDir: true
  }
})
```

**Key Configuration Points:**

| Setting | Purpose |
|---------|---------|
| `alias: { vue: 'vue-shim.js' }` | Redirects all Vue imports to host runtime |
| `cssInjectedByJsPlugin()` | Embeds CSS in JS bundle (no external CSS files) |
| `formats: ['es']` | ES module format for dynamic import |
| `inlineDynamicImports: true` | Single bundle file |

### SFC Component Pattern

Components access host context directly via `window.__HOST_DEPENDENCIES__`:

**Example:** `modules/my-module/frontend/components/MyComponent.vue`

```vue
<script setup lang="ts">
// Access host dependencies at component level
const { useHostContext } = window.__HOST_DEPENDENCIES__
const { router, stores, services, vue, utils } = useHostContext()

// Destructure Vue primitives from host context
const { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = vue

// Access stores
const analysisStore = stores.analysisStore
const issueStore = stores.issueStore

// Access utilities — incl. full token-scoped GraphQL (governed server-side)
const getPageDisplayName = utils.getPageDisplayName
const dtUtils = utils.dtUtils // read/write GraphQL: dtUtils.performQuery / performMutation

// Define component props and emits
interface Props {
  content: any
  analysisId: string
  scopeId: string
}
const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:content'): void
  (e: 'redirect:issue'): void
}>()

// Use reactive state with host Vue primitives
const selectedItems = ref<string[]>([])
const isLoading = ref(false)

// Lifecycle hooks from host context
onMounted(() => {
  // Initialization logic
})

onUnmounted(() => {
  // Cleanup logic
})

// Computed properties
const filteredItems = computed(() => {
  // Computation logic
})

// Watch for changes
watch(() => props.content, (newContent) => {
  // Handle content changes
}, { deep: true, immediate: true })
</script>

<template>
  <!-- Use Vuetify components from host -->
  <v-container>
    <v-card>
      <v-card-title>{{ props.content?.title }}</v-card-title>
      <v-card-text>
        <!-- Component template -->
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
/* Scoped styles are injected via cssInjectedByJsPlugin */
</style>
```

### Import Pattern Summary

| What | How | Example |
|------|-----|---------|
| Vue primitives | From `useHostContext().vue` | `const { ref, computed } = vue` |
| Stores (Pinia) | From `useHostContext().stores` | `const { analysisStore } = stores` (only these two; not a security boundary) |
| GraphQL (full CRUD) | From `useHostContext().utils` | `utils.dtUtils.performMutation(...)` — authenticated, governed server-side |
| Router | From `useHostContext().router` | `router.push('/path')` |
| Utilities | From `useHostContext().utils` | `utils.getPageDisplayName()` |
| Other module components | Direct import | `import MyDialog from './MyDialog.vue'` |
| Host components (Vuetify) | Use in template directly | `<v-card>`, `<v-btn>` |

### Building and Packaging

```bash
# From the module's frontend directory
cd modules/my-module/frontend

# Build the bundle and place it beside the manifest
vite build && cp dist/bundle.js bundle.js
```

The module's packager (`scripts/package-module.js`) takes `frontend/bundle.js` and `frontend/frontend-manifest.json` into the package, and refuses a `frontend/` that lacks either; see [Module Package Design → Module frontend](../../modules/MODULE_PACKAGE_DESIGN.md#module-frontend). dt-ws reads both when it loads the module.

---

## Security Considerations

### Trust Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Module Trust Boundary                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  A loaded module runs as FIRST-PARTY TRUSTED code inside the host       │
│  application. It receives full token-scoped GraphQL (create/update/     │
│  delete) via useHostContext().utils.dtUtils — there is NO client-side   │
│  capability sandbox. The trust boundary is at LOAD TIME, not runtime.   │
│                                                                         │
│  Security relies on:                                                    │
│  1. Backend validates module sources                                    │
│  2. Module allowlist in production (only load modules you trust)        │
│  3. Server-side authorization on every GraphQL request (per-request JWT)│
│                                                                         │
│  NOT security controls (common misconceptions):                        │
│  - "Limited store exposure" — an API-surface choice, not a data boundary│
│  - "authStore not exposed" — hides the raw token, but the module still  │
│    makes authenticated requests through the bridged client              │
│  - "Scoped component registry" — prevents accidental key collisions;    │
│    a module can still reach the unscoped registry                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Mitigations

Because a loaded module is trusted first-party code with full token-scoped GraphQL, the
mitigations are all at **load time** and **server-side** — there is no client-side
capability sandbox to rely on.

| Risk | Mitigation |
|------|------------|
| Malicious / untrusted module code | Backend module allowlist + source validation in production ("only load modules you trust") |
| Unauthorized data access or mutation | Server-side authorization on every GraphQL request (per-request JWT) — the same control that governs the host UI |
| Raw refresh-token theft | `authStore` not exposed (module can still make authenticated requests, but cannot read the raw token) |
| XSS via module | Module allowlist, module content review. **Not** the CSP — it deliberately permits `blob:` so module bundles can execute (see [SECURITY_MODEL.md](../../../SECURITY_MODEL.md#module-frontends)) |
| Bearer token sent off the API origin | The loader fetches only same-origin `/module-bundles/` URLs and refuses redirects |
| Bundle replaced in transit or by a stale cache | sha256 check against the manifest hash where `crypto.subtle` exists; hash-addressed URLs |
| Two modules claiming the same component key | The key belongs to neither; the view fails visibly |
| Memory leaks | Blob URL revoked in a `finally` block |

The bundle route's authentication, caching and their limits are in [SECURITY_MODEL.md → Module frontends](../../../SECURITY_MODEL.md#module-frontends).

---

## API Surface

### GraphQL

**Source:** `dt-core/src/dt-module/dt-module-gql.ts` (`GET_FRONTEND_MODULE_MANIFEST`)

```graphql
query GetFrontendModuleManifest {
  getFrontendModuleManifest {
    name
    version
    available
    hash
    size
    url
    components
    hostApi {
      min
      max
    }
  }
}
```

### REST

```
GET /module-bundles/:name/:hash/bundle.js
```

The bundle bytes. See [The bundle route](#the-bundle-route).

---

## Debugging

### Console Logs

dt-ui logs:

```
Component registered: my_component (module: my-module-id) as DynamicMyComponent
Failed to load module my-module: ModuleFrontendError: Module my-module bundle: HTTP 500
Failed to load the module frontend manifest: <error>
The component "my_component" is declared by more than one module (module-a, module-b): not loaded
Module my-module touched the component "other_key", which it does not own: ignored
```

dt-ws logs `Module frontend loaded` (with `moduleName`, `hash`, `size`, and `components`, the number of keys) or `Module frontend not loaded` (with `moduleName` and the `reason`, or `error` when reading the files threw) at module load and reload.

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| dt-ws logs `Module frontend not loaded … frontend/bundle.js without frontend/frontend-manifest.json` | The module ships no manifest | Add `frontend/frontend-manifest.json` and repackage |
| dt-ws logs `invalid frontend-manifest.json: …` | The manifest fails validation | Fix the problems it names; run the contract test |
| "No module frontend owns the component" | No allowed module with a frontend declares the key, or two modules do | Check `getFrontendModuleManifest` and `ALLOWED_MODULES` |
| "did not register the component … it declares" | `install()` and the manifest disagree | Run `assertFrontendManifest` in the module's tests |
| "needs host API …" | The module's `hostApi` range excludes this host's `HOST_API_VERSION` | Update the module, or the app |
| "bundle does not match its hash" | The bytes received are not the ones the manifest names | Check any proxy in front of dt-ws |
| "Refusing a module bundle URL off the API server" | The manifest `url` resolves to another origin or path | Check the configured API URL |
| "Module <name> has no install function" | Module doesn't export `install` | Check module's default export |
