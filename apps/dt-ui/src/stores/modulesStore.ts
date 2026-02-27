import { defineStore } from 'pinia'
import { DtModule, Module } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

export const useModulesStore = defineStore('modules', () => {
  // State
  const modules = ref<Module[]>([])
  const isLoading = ref<Record<string, boolean>>({
    fetchModules: false,
    saveModule: false,
    resetModule: false,
    getModuleById: false,
    getModuleByName: false,
    getAvailableFrontendModules: false,
    getModuleFrontendBundle: false
  })
  const error = ref<string>('')
  const successMessage = ref<string>('')
  const searchQuery = ref('')
  const lastFetch = ref<number>(0)
  
  // Dependencies
  const dtModule = new DtModule(apolloClient)
  
  // Constants
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  
  // Computed
  const filteredModules = computed(() => {
    if (!searchQuery.value.trim()) return modules.value
    const query = searchQuery.value.toLowerCase()
    return modules.value.filter(module => 
      module.name.toLowerCase().includes(query) ||
      module.description?.toLowerCase().includes(query)
    )
  })
  
  // Helper functions
  const handleApiError = (error: Error, operation: string): string => {
    console.error(`Error in ${operation}:`, error)
    
    if (error.message.includes('401')) return 'Please log in again'
    if (error.message.includes('403')) return 'Access denied'
    if (error.message.includes('404')) return 'Module not found'
    if (error.message.includes('network')) return 'Connection failed'
    return `Failed to ${operation}. Please try again.`
  }
  
  const validateModuleId = (moduleId: string): string => {
    if (!moduleId?.trim()) return 'Module ID is required'
    if (moduleId.length < 3) return 'Module ID too short'
    return ''
  }
  
  const validateAttributes = (attributes: string): string => {
    if (!attributes?.trim()) return 'Attributes are required'
    try {
      JSON.parse(attributes)
      return ''
    } catch {
      return 'Invalid JSON format in attributes'
    }
  }
  
  const moduleExists = (moduleId: string): boolean => {
    return modules.value.some(module => module.id === moduleId)
  }
  
  const showSuccess = (message: string) => {
    successMessage.value = message
    setTimeout(() => successMessage.value = '', 3000)
  }
  
  const shouldRefresh = (): boolean => {
    return Date.now() - lastFetch.value > CACHE_TTL
  }

  const resetStore = () => {
    modules.value = []
    isLoading.value = {
      fetchModules: false,
      saveModule: false,
      resetModule: false,
      getModuleById: false,
      getModuleByName: false,
      getAvailableFrontendModules: false,
      getModuleFrontendBundle: false
    }
    error.value = ''
    successMessage.value = ''
    searchQuery.value = ''
    lastFetch.value = 0
  }

  const getModuleById = async ({ moduleId }: { moduleId: string }): Promise<Module> => {
    const validationError = validateModuleId(moduleId)
    if (validationError) {
      error.value = validationError
      throw new Error(validationError)
    }
    
    try {
      isLoading.value.getModuleById = true
      error.value = ''
      return await dtModule.getModuleById(moduleId)
    } catch (err) {
      error.value = handleApiError(err as Error, 'load module')
      throw err
    } finally {
      isLoading.value.getModuleById = false
    }
  }

  const getModuleByName = async ({ moduleName }: { moduleName: string }): Promise<Module> => {
    if (!moduleName?.trim()) {
      error.value = 'Module name is required'
      throw new Error('Module name is required')
    }
    
    try {
      isLoading.value.getModuleByName = true
      error.value = ''
      return await dtModule.getModuleByName(moduleName)
    } catch (err) {
      error.value = handleApiError(err as Error, 'find module')
      throw err
    } finally {
      isLoading.value.getModuleByName = false
    }
  }
  
  const fetchModules = async ({ 
    ephemeral = false, 
    force = false 
  }: { 
    ephemeral?: boolean, 
    force?: boolean 
  } = {}): Promise<Module[]> => {
    if (!force && !ephemeral && !shouldRefresh()) {
      return modules.value
    }
    
    try {
      isLoading.value.fetchModules = true
      error.value = ''
      
      const results = await dtModule.getModules() as Module[]
      
      if (!ephemeral) {
        modules.value = results
        lastFetch.value = Date.now()
      }
      
      return results
    } catch (err) {
      error.value = handleApiError(err as Error, 'fetch modules')
      return ephemeral ? [] : modules.value
    } finally {
      isLoading.value.fetchModules = false
    }
  }

  const resetModule = async ({ moduleId }: { moduleId: string }): Promise<boolean> => {
    const validationError = validateModuleId(moduleId)
    if (validationError) {
      error.value = validationError
      throw new Error(validationError)
    }
    
    if (!moduleExists(moduleId)) {
      error.value = 'Module not found'
      throw new Error('Module not found')
    }
    
    try {
      isLoading.value.resetModule = true
      error.value = ''
      
      const result = await dtModule.resetModule(moduleId)
      
      if (result) {
        showSuccess('Module reset successfully')
        // Refresh the module data after reset
        await fetchModules({ force: true })
      }
      
      return result
    } catch (err) {
      error.value = handleApiError(err as Error, 'reset module')
      throw err
    } finally {
      isLoading.value.resetModule = false
    }
  }

  const saveModule = async ({ moduleId, attributes }: { moduleId: string, attributes: string }): Promise<Module> => {
    const moduleIdError = validateModuleId(moduleId)
    if (moduleIdError) {
      error.value = moduleIdError
      throw new Error(moduleIdError)
    }
    
    const attributesError = validateAttributes(attributes)
    if (attributesError) {
      error.value = attributesError
      throw new Error(attributesError)
    }
    
    try {
      isLoading.value.saveModule = true
      error.value = ''
      
      // Optimistic update
      const originalModule = modules.value.find(m => m.id === moduleId)
      if (originalModule) {
        const optimisticModule = { ...originalModule, attributes, pending: true }
        modules.value = modules.value.map(module => 
          module.id === moduleId ? optimisticModule : module
        )
      }
      
      const savedModule = await dtModule.saveModule({ moduleId, attributes })
      
      // Replace with real data
      modules.value = modules.value.map(module => 
        module.id === moduleId ? { ...savedModule, pending: false } : module
      )
      showSuccess('Module saved successfully')
      return savedModule
    } catch (err) {
      // Rollback optimistic update
      const originalModule = modules.value.find(m => m.id === moduleId && !(m as any).pending)
      if (originalModule) {
        modules.value = modules.value.map(module => 
          module.id === moduleId ? originalModule : module
        )
      }
      error.value = handleApiError(err as Error, 'save module')
      throw err
    } finally {
      isLoading.value.saveModule = false
    }
  }

  const getAvailableFrontendModules = async (): Promise<string[]> => {
    try {
      isLoading.value.getAvailableFrontendModules = true
      error.value = ''
      return await dtModule.getAvailableFrontendModules()
    } catch (err) {
      error.value = handleApiError(err as Error, 'get available frontend modules')
      throw err
    } finally {
      isLoading.value.getAvailableFrontendModules = false
    }
  }

  const getModuleFrontendBundle = async ({ moduleName }: { moduleName: string }): Promise<string> => {
    if (!moduleName) {
      error.value = 'Module name is required'
      throw new Error('Module name is required')
    }

    try {
      isLoading.value.getModuleFrontendBundle = true
      error.value = ''
      return await dtModule.getModuleFrontendBundle({ moduleName })
    } catch (err) {
      error.value = handleApiError(err as Error, 'get module frontend bundle')
      throw err
    } finally {
      isLoading.value.getModuleFrontendBundle = false
    }
  }

  return {
    // State
    modules: filteredModules,
    isLoading: readonly(isLoading),
    error: readonly(error),
    successMessage: readonly(successMessage),
    searchQuery,
    
    // Actions
    getModuleById,
    getModuleByName,
    fetchModules,
    resetModule,
    saveModule,
    getAvailableFrontendModules,
    getModuleFrontendBundle,
    resetStore,
    
    // Utils
    clearError: () => error.value = '',
    clearSuccess: () => successMessage.value = ''
  }
})