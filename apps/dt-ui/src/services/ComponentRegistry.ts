// src/services/ComponentRegistry.ts
import type { Component } from 'vue'
import { markRaw } from 'vue'

export interface ComponentDefinition {
  component: Component | (() => Promise<Component>)
  moduleId?: string
  globalName?: string // Store the global component name for app.component()
}

export class ComponentRegistry {
  private components = new Map<string, ComponentDefinition>()
  private moduleComponents = new Map<string, Set<string>>()

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

    console.log(`Component registered: ${key}${moduleId ? ` (module: ${moduleId})` : ''} as ${globalName}`)
  }

  unregister(key: string) {
    const definition = this.components.get(key)
    if (definition?.moduleId) {
      const moduleKeys = this.moduleComponents.get(definition.moduleId)
      moduleKeys?.delete(key)
    }
    this.components.delete(key)
    console.log(`Component unregistered: ${key}`)
  }

  unregisterModule(moduleId: string) {
    const moduleKeys = this.moduleComponents.get(moduleId) || new Set()
    moduleKeys.forEach(key => this.components.delete(key))
    this.moduleComponents.delete(moduleId)
    console.log(`Module unregistered: ${moduleId} (${moduleKeys.size} components removed)`)
  }

  get(key: string): Component | (() => Promise<Component>) | undefined {
    const definition = this.components.get(key)
    return definition?.component
  }

  // Get the global component name for use in templates
  getComponentName(key: string): string | undefined {
    const definition = this.components.get(key)
    return definition?.globalName
  }

  // Method to get component safely for use in templates
  getComponent(key: string): Component | (() => Promise<Component>) | undefined {
    const definition = this.components.get(key)
    if (!definition) {
      console.warn(`Component not found: ${key}`)
      return undefined
    }
    return definition.component
  }

  getAvailableComponents(): string[] {
    return Array.from(this.components.keys())
  }

  getModuleComponents(moduleId: string): string[] {
    return Array.from(this.moduleComponents.get(moduleId) || [])
  }

  getAllModules(): string[] {
    return Array.from(this.moduleComponents.keys())
  }

  // Helper method to check if component exists
  hasComponent(key: string): boolean {
    return this.components.has(key)
  }

  // Get component info for debugging
  getComponentInfo(key: string) {
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
}

// Global instance
export const componentRegistry = new ComponentRegistry()