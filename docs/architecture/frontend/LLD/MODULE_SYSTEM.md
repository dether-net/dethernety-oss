# Dynamic Module System

## Table of Contents
- [Overview](#overview)
- [Module Loading Flow](#module-loading-flow)
- [Host Dependency Injection](#host-dependency-injection)
- [Component Registry](#component-registry)
- [Host Context Composable](#host-context-composable)
- [Application Initialization](#application-initialization)
- [Module Development Guide](#module-development-guide)
- [Security Considerations](#security-considerations)

## Overview

The dynamic module system enables runtime extensibility by loading Vue components and functionality from the backend without rebuilding the frontend application.

**Primary Source Files:**
- `apps/dt-ui/src/services/ModuleLoader.ts`
- `apps/dt-ui/src/services/ComponentRegistry.ts`
- `apps/dt-ui/src/composables/useHostContext.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Module Loading Architecture                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Application Startup                                                 │
│     └─→ ModuleLoader.exposeHostDependencies()                           │
│         └─→ Exposes Vue, Pinia, composables to window                   │
│                                                                         │
│  2. Module Discovery                                                    │
│     └─→ modulesStore.getAvailableFrontendModules()                      │
│         └─→ GraphQL query returns module names                          │
│                                                                         │
│  3. Module Fetch                                                        │
│     └─→ For each module:                                                │
│         └─→ modulesStore.getModuleFrontendBundle(name)                  │
│             └─→ Returns JavaScript bundle as string                     │
│                                                                         │
│  4. Dynamic Import                                                      │
│     └─→ Create Blob from bundle string                                  │
│     └─→ Create Object URL from Blob                                     │
│     └─→ import(blobUrl)                                                 │
│                                                                         │
│  5. Module Installation                                                 │
│     └─→ Call module.install(hostDependencies)                           │
│         └─→ Module registers components via componentRegistry           │
│                                                                         │
│  6. Cleanup                                                             │
│     └─→ Revoke blob URL                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Module Loading Flow

### Discovery Phase

**Source:** `ModuleLoader.ts:41-57`

```typescript
async loadAvailableModules(): Promise<void> {
  // Get list of modules with frontend bundles
  const moduleNames = await this.modulesStore.getAvailableFrontendModules()

  console.log(`[ModuleLoader] Found ${moduleNames.length} frontend modules`)

  // Load each module sequentially (maintains load order)
  for (const moduleName of moduleNames) {
    await this.loadModule({ name: moduleName })
  }
}
```

**Why Sequential Loading:**
- Produces a deterministic load order
- Prevents race conditions in component registration
- Allows modules to depend on previously loaded modules

### Fetch Phase

**Source:** `ModuleLoader.ts:59-74`

```typescript
private async loadModule({ name }: { name: string }): Promise<void> {
  console.log(`[ModuleLoader] Loading module: ${name}`)

  // Fetch bundle content from backend
  const bundleContent = await this.modulesStore.getModuleFrontendBundle({ name })

  if (!bundleContent) {
    console.warn(`[ModuleLoader] No bundle found for module: ${name}`)
    return
  }

  await this.installModule({ name, bundleContent })
}
```

### Dynamic Import Phase

**Source:** `ModuleLoader.ts:76-100`

```typescript
private async installModule({
  name,
  bundleContent
}: {
  name: string
  bundleContent: string
}): Promise<void> {
  let moduleUrl: string | null = null

  try {
    // Create Blob from bundle string
    const blob = new Blob([bundleContent], { type: 'application/javascript' })

    // Create Object URL for dynamic import
    moduleUrl = URL.createObjectURL(blob)

    // Dynamic import (Vite ignore directive prevents bundling)
    const moduleExports = await import(/* @vite-ignore */ moduleUrl)

    // Extract default export or use full module
    const moduleInstance = moduleExports.default || moduleExports

    // Call module's install function with host dependencies
    if (typeof moduleInstance.install === 'function') {
      moduleInstance.install(window.__HOST_DEPENDENCIES__)
      console.log(`[ModuleLoader] Module ${name} installed successfully`)
    } else {
      console.warn(`[ModuleLoader] Module ${name} has no install function`)
    }
  } catch (error) {
    console.error(`[ModuleLoader] Failed to install module ${name}:`, error)
  } finally {
    // Always cleanup blob URL to prevent memory leaks
    if (moduleUrl) {
      URL.revokeObjectURL(moduleUrl)
    }
  }
}
```

**Key Implementation Details:**

| Step | Purpose |
|------|---------|
| `new Blob([bundleContent], ...)` | Convert string to importable module |
| `URL.createObjectURL(blob)` | Create temporary URL for import |
| `/* @vite-ignore */` | Prevent Vite from analyzing import |
| `URL.revokeObjectURL(moduleUrl)` | Free memory after import |

---

## Host Dependency Injection

### Global Exposure

**Source:** `ModuleLoader.ts:123-135`

```typescript
static exposeHostDependencies(VueRuntime?: any, appContext?: any): void {
  window.__HOST_DEPENDENCIES__ = {
    // Composable for accessing router, stores, services
    useHostContext,

    // Services for component registration
    services: {
      componentRegistry,
    },

    // Vue runtime for module components
    __VUE__: VueRuntime,

    // App context for advanced integration
    __APP_CONTEXT__: appContext,
  }
}
```

### HostDependencies Interface

**Source:** `ModuleLoader.ts:14-21`

```typescript
export interface HostDependencies {
  useHostContext: typeof useHostContext
  services: {
    componentRegistry: typeof componentRegistry
  }
  __VUE__?: any
  __APP_CONTEXT__?: any
}

// TypeScript global declaration
declare global {
  interface Window {
    __HOST_DEPENDENCIES__: HostDependencies
  }
}
```

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

### Registry Implementation

**Source:** `ComponentRegistry.ts:1-107`

```typescript
class ComponentRegistry {
  // Component storage: key -> { component, moduleId, globalName }
  private components: Map<string, {
    component: Component | (() => Promise<Component>)
    moduleId?: string
    globalName: string
  }> = new Map()

  // Module to components mapping for bulk operations
  private moduleComponents: Map<string, Set<string>> = new Map()
}
```

### Component Registration

**Source:** `ComponentRegistry.ts:15-38`

```typescript
register(
  key: string,
  component: Component | (() => Promise<Component>),
  moduleId?: string
): void {
  // Wrap component with markRaw to prevent Vue reactivity overhead
  const wrappedComponent = typeof component === 'function'
    ? component
    : markRaw(component)

  // Generate global name: my_component -> DynamicMyComponent
  const globalName = `Dynamic${key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')}`

  // Store component with metadata
  this.components.set(key, {
    component: wrappedComponent,
    moduleId,
    globalName
  })

  // Track module-to-component relationship
  if (moduleId) {
    if (!this.moduleComponents.has(moduleId)) {
      this.moduleComponents.set(moduleId, new Set())
    }
    this.moduleComponents.get(moduleId)!.add(key)
  }

  console.log(`[ComponentRegistry] Registered: ${key} as ${globalName}`)
}
```

**markRaw Importance:**
- Prevents Vue from making components reactive
- Reduces memory overhead
- Improves render performance

### Component Lookup

**Source:** `ComponentRegistry.ts:57-107`

```typescript
// Direct lookup (returns component or undefined)
get(key: string): Component | (() => Promise<Component>) | undefined {
  return this.components.get(key)?.component
}

// Safe lookup with warning
getComponent(key: string): Component | (() => Promise<Component>) | undefined {
  const entry = this.components.get(key)
  if (!entry) {
    console.warn(`[ComponentRegistry] Component not found: ${key}`)
    return undefined
  }
  return entry.component
}

// Get global name for template usage
getComponentName(key: string): string | undefined {
  return this.components.get(key)?.globalName
}

// List all components from a module
getModuleComponents(moduleId: string): string[] {
  const componentKeys = this.moduleComponents.get(moduleId)
  return componentKeys ? Array.from(componentKeys) : []
}

// Check existence
hasComponent(key: string): boolean {
  return this.components.has(key)
}

// List all registered keys
getAllComponentKeys(): string[] {
  return Array.from(this.components.keys())
}
```

### Module Unregistration

**Source:** `ComponentRegistry.ts:50-55`

```typescript
unregisterModule(moduleId: string): void {
  const componentKeys = this.moduleComponents.get(moduleId)
  if (componentKeys) {
    componentKeys.forEach(key => this.components.delete(key))
    this.moduleComponents.delete(moduleId)
    console.log(`[ComponentRegistry] Unregistered module: ${moduleId}`)
  }
}
```

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

**Source:** `main.ts:26-47`

```typescript
async function bootstrap() {
  // 1. Create Vue app instance
  const app = createApp(App)

  // 2. Initialize Apollo client (async - fetches config)
  await initializeApolloClient()

  // 3. Setup plugins
  app.use(createPinia())
  app.use(router)
  app.use(vuetify)

  // 4. Expose host dependencies BEFORE loading modules
  ModuleLoader.exposeHostDependencies(VueRuntime, app._context)

  // 5. Load all available modules
  const moduleLoader = new ModuleLoader()
  await moduleLoader.loadAvailableModules()

  // 6. Mount application
  app.mount('#app')
}

bootstrap()
```

**Order Critical:**
1. Apollo client needed for module fetching
2. Host dependencies must be exposed before module install
3. Modules loaded before mount to ensure components available

---

## Module Development Guide

**Reference Implementation:** `modules/example-analysis-module/frontend/`

### Module Directory Structure

```
modules/my-module/frontend/
├── index.js                 # Module entry point with install/uninstall
├── vite.config.js           # Build configuration
├── externals/
│   └── vue-shim.js          # Vue runtime redirect to host
├── components/
│   ├── MyComponent.vue      # SFC components
│   └── AnotherComponent.vue
└── dist/
    └── bundle.js            # Built bundle (uploaded to backend)
```

### Module Entry Point

A module exports `id`, `install`, and optionally `uninstall`:

**Source:** `modules/example-analysis-module/frontend/index.js`

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

    const { componentRegistry } = hostDependencies.services || {}

    if (!componentRegistry) {
      console.error('Component registry not available')
      return
    }

    // Register components with keys matching backend class windowComponent
    const componentsToRegister = [
      { key: "my_component", component: MyComponent },
      { key: "another_component", component: AnotherComponent },
    ]

    componentsToRegister.forEach(({ key, component }) => {
      try {
        componentRegistry.register(key, component, "my-module-id")
        console.log(`Registered component: ${key}`)
      } catch (error) {
        console.error(`Failed to register component ${key}:`, error)
      }
    })

    console.log('Module components registered successfully')
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

**Source:** `modules/example-analysis-module/frontend/externals/vue-shim.js`

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

**Source:** `modules/example-analysis-module/frontend/vite.config.js`

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

**Source:** `modules/example-analysis-module/frontend/components/AttackScenarioSummaryWindow.vue`

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

### Building and Deploying

```bash
# Navigate to module frontend directory
cd modules/my-module/frontend

# Install dependencies (if any)
pnpm install

# Build bundle
pnpm build  # or: npx vite build

# Output: dist/bundle.js
# Upload to backend module configuration
```

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
| XSS via module | Module allowlist, module content review. **Not** the CSP — it deliberately permits `blob:` so module bundles can execute (see [SECURITY_MODEL.md](../../../SECURITY_MODEL.md)) |
| Memory leaks | Blob URL cleanup in finally block |

### Production Configuration

In production, the backend should:
1. Only serve whitelisted module bundles
2. Validate module signatures (if implemented)
3. Disable hot module reload
4. Log module loading events

---

## GraphQL Queries

### Module Discovery

**Source:** `dt-core/src/dt-module/dt-module-gql.ts`

```graphql
query GetAvailableFrontendModules {
  modules(where: { frontendBundle_NOT: null }) {
    name
  }
}
```

### Bundle Fetch

```graphql
query GetModuleFrontendBundle($name: String!) {
  modules(where: { name: $name }) {
    frontendBundle
  }
}
```

---

## Debugging

### Console Logs

The module system logs at key points:

```
[ModuleLoader] Found 3 frontend modules
[ModuleLoader] Loading module: dt-analysis-module
[ModuleLoader] Module dt-analysis-module installed successfully
[ComponentRegistry] Registered: analysis_results as DynamicAnalysisResults
```

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Module has no install function" | Module doesn't export `install` | Check module's default export |
| "Component not found" | Component not registered | Verify `register()` called in install |
| "Cannot access before initialization" | Apollo client not ready | Ensure async startup sequence |
| Memory growth | Blob URLs not revoked | Check finally block cleanup |
