// src/services/ModuleLoader.ts
import { useModulesStore } from '@/stores/modulesStore'
import { useHostContext } from '@/composables/useHostContext'
import { componentRegistry } from '@/services/ComponentRegistry'

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
  __APP_CONTEXT__?: any,
}

export interface FrontendModuleConfig {
  name: string
}

export interface HostDependencies {
  useHostContext: typeof useHostContext
  services: {
    componentRegistry: typeof componentRegistry
  }
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
      if (import.meta.env.DEV) {
        console.error('Failed to load available modules:', error)
      }
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
        } else if (import.meta.env.DEV) {
          console.warn(`Module ${config.name} does not have an install function`, module)
        }
      } finally {
        // Clean up the blob URL to free memory
        URL.revokeObjectURL(moduleUrl)
      }

    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(`Failed to load module ${config.name}:`, error)
      }
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