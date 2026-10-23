// src/services/ComponentRegistry.ts
import type { Component } from 'vue'
import { markRaw, shallowRef } from 'vue'

export interface ComponentDefinition {
  component: Component | (() => Promise<Component>)
  moduleId?: string
  globalName?: string // Store the global component name for app.component()
}

/** The registry as a module frontend sees it: its public methods, nothing of its state. */
export type ModuleComponentRegistry = Pick<
  ComponentRegistry,
  | 'register' | 'unregister' | 'unregisterModule' | 'get' | 'getComponentName' | 'getComponent'
  | 'getAvailableComponents' | 'getModuleComponents' | 'getAllModules' | 'hasComponent' | 'getComponentInfo'
>

export class ComponentRegistry {
  private components = new Map<string, ComponentDefinition>()
  private moduleComponents = new Map<string, Set<string>>()
  // The maps are plain, so nothing reactive would see a change. Every change bumps this and every
  // read reads it, so a computed over a lookup re-runs once a module frontend that loads later
  // registers its components.
  private readonly revision = shallowRef(0)

  register(key: string, component: Component | (() => Promise<Component>), moduleId?: string) {
    // Use markRaw to prevent Vue from making the component reactive
    const wrappedComponent = typeof component === 'function' 
      ? component 
      : markRaw(component)
    
    // Generate global name for app.component() registration
    const globalName = `Dynamic${key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`
    
    this.components.set(key, { 
      component: wrappedComponent, 
      moduleId,
      globalName 
    })
    
    if (moduleId) {
      if (!this.moduleComponents.has(moduleId)) {
        this.moduleComponents.set(moduleId, new Set())
      }
      this.moduleComponents.get(moduleId)!.add(key)
    }

    this.revision.value++
    console.log(`Component registered: ${key}${moduleId ? ` (module: ${moduleId})` : ''} as ${globalName}`)
  }

  unregister(key: string) {
    const definition = this.components.get(key)
    if (definition?.moduleId) {
      const moduleKeys = this.moduleComponents.get(definition.moduleId)
      moduleKeys?.delete(key)
    }
    this.components.delete(key)
    this.revision.value++
    console.log(`Component unregistered: ${key}`)
  }

  unregisterModule(moduleId: string) {
    const moduleKeys = this.moduleComponents.get(moduleId) || new Set()
    moduleKeys.forEach(key => this.components.delete(key))
    this.moduleComponents.delete(moduleId)
    this.revision.value++
    console.log(`Module unregistered: ${moduleId} (${moduleKeys.size} components removed)`)
  }

  get(key: string): Component | (() => Promise<Component>) | undefined {
    void this.revision.value
    const definition = this.components.get(key)
    return definition?.component
  }

  // Get the global component name for use in templates
  getComponentName(key: string): string | undefined {
    void this.revision.value
    const definition = this.components.get(key)
    return definition?.globalName
  }

  // Method to get component safely for use in templates
  getComponent(key: string): Component | (() => Promise<Component>) | undefined {
    void this.revision.value
    const definition = this.components.get(key)
    if (!definition) {
      console.warn(`Component not found: ${key}`)
      return undefined
    }
    return definition.component
  }

  getAvailableComponents(): string[] {
    void this.revision.value
    return Array.from(this.components.keys())
  }

  getModuleComponents(moduleId: string): string[] {
    void this.revision.value
    return Array.from(this.moduleComponents.get(moduleId) || [])
  }

  getAllModules(): string[] {
    void this.revision.value
    return Array.from(this.moduleComponents.keys())
  }

  // Helper method to check if component exists
  hasComponent(key: string): boolean {
    void this.revision.value
    return this.components.has(key)
  }

  // Get component info for debugging
  getComponentInfo(key: string) {
    void this.revision.value
    const definition = this.components.get(key)
    if (!definition) return null
    
    return {
      key,
      moduleId: definition.moduleId,
      globalName: definition.globalName,
      hasComponent: !!definition.component,
      componentType: typeof definition.component
    }
  }

  /**
   * A view of this registry for one module frontend's install(): it registers and unregisters only
   * the keys `owns` accepts, and exposes no internal state. A guard against modules colliding by
   * mistake, not isolation: module frontends run with full page privilege and can reach this
   * registry through the host dependencies.
   */
  scoped(owns: (key: string) => boolean, onRefused: (key: string) => void): ModuleComponentRegistry {
    return {
      register: (key, component, moduleId) => (owns(key) ? this.register(key, component, moduleId) : onRefused(key)),
      unregister: key => (owns(key) ? this.unregister(key) : onRefused(key)),
      unregisterModule: moduleId => this.getModuleComponents(moduleId).filter(owns).forEach(key => this.unregister(key)),
      get: key => this.get(key),
      getComponentName: key => this.getComponentName(key),
      getComponent: key => this.getComponent(key),
      getAvailableComponents: () => this.getAvailableComponents(),
      getModuleComponents: moduleId => this.getModuleComponents(moduleId),
      getAllModules: () => this.getAllModules(),
      hasComponent: key => this.hasComponent(key),
      getComponentInfo: key => this.getComponentInfo(key),
    }
  }
}

// Global instance
export const componentRegistry = new ComponentRegistry()