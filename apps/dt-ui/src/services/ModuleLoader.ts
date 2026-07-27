// src/services/ModuleLoader.ts
import { useModulesStore } from '@/stores/modulesStore'
import { useHostContext } from '@/composables/useHostContext'
import { componentRegistry } from '@/services/ComponentRegistry'
// Re-export the host's already-bundled JSONForms engine to module bundles via
// __HOST_DEPENDENCIES__.__JSONFORMS__ (see exposeHostDependencies). Namespace imports
// resolve to the single host-bundled copy, so modules share one JSONForms bound to the
// host's one Vue — no duplicate instance, no version skew.
import * as JsonFormsCore from '@jsonforms/core'
import * as JsonFormsVue from '@jsonforms/vue'

declare global {
  interface Window {
    __HOST_DEPENDENCIES__: HostDependencies
    __TEMP_MODULE_EXPORT__?: any
    [key: string]: any
  }
}

export interface HostDependencies {
  useHostContext: typeof useHostContext
  services: {
    componentRegistry: typeof componentRegistry
  }
  __VUE__?: any
  // Host's already-bundled JSONForms engine shared with module bundles (see
  // exposeHostDependencies). `@jsonforms/core` + `@jsonforms/vue` only — modules supply
  // their own renderer set, so the host's vue-vuetify renderers are not exposed.
  __JSONFORMS__?: {
    core: typeof JsonFormsCore
    vue: typeof JsonFormsVue
  }
  __APP_CONTEXT__?: any,
}

export interface FrontendModuleConfig {
  name: string
}

export class ModuleLoader {
  private loadedModules = new Set<string>()
  
  private get modulesStore() {
    return useModulesStore()
  }

  async loadAvailableModules(): Promise<void> {
    try {
      if (import.meta.env.DEV) {
        console.log('Loading available frontend modules...')
      }

      const moduleNames: string[] = await this.modulesStore.getAvailableFrontendModules()
      if (import.meta.env.DEV) {
        console.log(`Found ${moduleNames.length} available modules:`, moduleNames)
      }

      // Load modules sequentially to avoid context issues
      for (const moduleName of moduleNames) {
        await this.loadModule({ name: moduleName })
      }

      if (import.meta.env.DEV) {
        console.log(`Module loading completed. Successfully loaded: ${this.loadedModules.size}`)
      }
    } catch (error) {
      // Always logged, in every build. A module-loading failure produces an
      // app that looks completely healthy and simply has no features, so a
      // DEV-only log means nobody finds out.
      console.error('Failed to load available modules:', error)
    }
  }

  private async loadModule(config: FrontendModuleConfig): Promise<void> {
    try {
      if (import.meta.env.DEV) {
        console.log(`Loading module: ${config.name}`)
      }

      // Ensure host dependencies are available
      if (!window.__HOST_DEPENDENCIES__) {
        throw new Error('Host dependencies not available. Modules must be loaded after app initialization.')
      }

      // Fetch bundle content using GraphQL
      if (import.meta.env.DEV) {
        console.log(`Fetching bundle content for module: ${config.name}`)
      }
      const bundleContent = await this.modulesStore.getModuleFrontendBundle({ moduleName: config.name })

      if (!bundleContent) {
        throw new Error(`No bundle content received for module: ${config.name}`)
      }

      // Create a blob URL from the bundle content
      const blob = new Blob([bundleContent], { type: 'application/javascript' })
      const moduleUrl = URL.createObjectURL(blob)

      if (import.meta.env.DEV) {
        console.log(`Created blob URL for module ${config.name}`)
      }

      try {
        const moduleExports = await import(/* @vite-ignore */ moduleUrl)
        const module = moduleExports.default || moduleExports

        if (module && typeof module.install === 'function') {
          await module.install(window.__HOST_DEPENDENCIES__)
          this.loadedModules.add(config.name)
          if (import.meta.env.DEV) {
            console.log(`Module ${config.name} loaded successfully`)
          }
        } else {
          // Not DEV-gated: a bundle that loads but installs nothing is the same
          // "app works but has no modules" failure as the catch below.
          console.error(`Module ${config.name} does not have an install function`, module)
        }
      } finally {
        // Clean up the blob URL to free memory
        URL.revokeObjectURL(moduleUrl)
      }

    } catch (error) {
      // See loadAvailableModules: never silence this. A CSP that blocks the
      // blob: import, a bad bundle, or a missing host dependency all land
      // here, and all of them present as "the app works but has no modules".
      console.error(`Failed to load module ${config.name}:`, error)
    }
  }

  getLoadedModules(): string[] {
    return Array.from(this.loadedModules)
  }

  isModuleLoaded(moduleId: string): boolean {
    return this.loadedModules.has(moduleId)
  }

  get isLoadingModules(): boolean {
    return this.modulesStore.isLoading.getAvailableFrontendModules
  }

  get isLoadingBundle(): boolean {
    return this.modulesStore.isLoading.getModuleFrontendBundle
  }

  get error(): string {
    return this.modulesStore.error
  }

  // Static method to set up host dependencies
  static exposeHostDependencies(VueRuntime?: any, appContext?: any): void {
    window.__HOST_DEPENDENCIES__ = {
      useHostContext,
      services: {
        componentRegistry,
      },
      __VUE__: VueRuntime,
      // Share the host's already-bundled JSONForms engine with module bundles so a
      // module can render a class's schema/uiSchema through JSONForms with its own
      // renderer set. Same single-instance discipline as __VUE__ (one JSONForms bound
      // to the host's one Vue). The host's vue-vuetify renderer set is intentionally
      // not exposed — modules supply renderers in their own design language.
      __JSONFORMS__: { core: JsonFormsCore, vue: JsonFormsVue },
      __APP_CONTEXT__: appContext,
    }
    
    if (import.meta.env.DEV) {
      console.log('Host dependencies exposed with composable approach')
    }
  }
}

// Global instance
export const moduleLoader = new ModuleLoader()

// Add type declaration for window
declare global {
  interface Window {
    __HOST_DEPENDENCIES__: HostDependencies
    __TEMP_MODULE_EXPORT__?: any
  }
}