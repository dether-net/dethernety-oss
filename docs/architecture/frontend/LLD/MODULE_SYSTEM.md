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

    // Stores (limited set for security)
    stores: {
      analysisStore,
      issueStore
    },

    // Services
    services: {
      componentRegistry
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

    // Utilities
    utils: {
      resolveComponent: safeResolveComponent,
      getPageDisplayName
    }
  }
}
```

### Exposed Vue Primitives

| Category | Functions |
|----------|-----------|
| **Reactivity** | `ref`, `reactive`, `computed`, `watch` |
| **Lifecycle** | `onMounted`, `onUnmounted` |
| **Dependency Injection** | `provide`, `inject` |
| **Component** | `resolveComponent`, `getCurrentInstance` |
| **Async** | `nextTick` |

### Why Limited Store Exposure?

Only `analysisStore` and `issueStore` are exposed:
- Prevents modules from accessing sensitive auth data
- Limits scope of potential module bugs
- Enforces separation of concerns

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

// Access utilities
const getPageDisplayName = utils.getPageDisplayName

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
| Stores | From `useHostContext().stores` | `const { analysisStore } = stores` |
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
│  TRUSTED                          UNTRUSTED                             │
│  ────────                         ─────────                             │
│  - Backend module registry        - Module code execution               │
│  - GraphQL API                    - Dynamic imports                     │
│  - Host application               - Third-party module content          │
│                                                                         │
│  Security relies on:                                                    │
│  1. Backend validates module sources                                    │
│  2. Module whitelist in production                                      │
│  3. Limited store exposure                                              │
│  4. No access to authStore                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Mitigations

| Risk | Mitigation |
|------|------------|
| Malicious module code | Backend module whitelist in production |
| Token theft | authStore not exposed to modules |
| Data exfiltration | Limited store exposure |
| XSS via module | CSP headers, module content review |
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
