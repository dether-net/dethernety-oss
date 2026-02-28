// composables/useModuleManager.ts
export function useModuleManager() {
  const installModule = async (moduleConfig: { moduleId: string, frontendEntry: string }) => {
    try {
      // Dynamic import of module
      const moduleExports = await import(/* @vite-ignore */ moduleConfig.frontendEntry)
      const module = moduleExports.default
      
      // Install module components
      await module.install()
      
      console.log(`Module ${moduleConfig.moduleId} installed successfully`)
      return true
    } catch (error) {
      console.error(`Failed to install module ${moduleConfig.moduleId}:`, error)
      return false
    }
  }
  
  const uninstallModule = async (moduleId: string) => {
    // Call module's uninstall method if it exists
    // This will clean up the component registry
  }
  
  return { installModule, uninstallModule }
}