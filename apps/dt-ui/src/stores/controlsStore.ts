// stores/modelsStore.js
import { defineStore } from 'pinia'
import apolloClient from '@/plugins/apolloClient'
import {
  // Core classes
  DtClass, DtControl, DtCountermeasure, DtMitreAttack,
  DtMitreDefend, DtModule, DtUtils,

  // Core types
  Class, Control, Countermeasure, MitreAttackMitigation,
  MitreDefendTactic, MitreDefendTechnique, Module,
} from '@dethernety/dt-core'

export const useControlsStore = defineStore('controls', () => {
  // State
  const controls = ref<Control[]>([])
  const modules = ref<Module[]>([])
  const mitreAttackMitigations = ref<MitreAttackMitigation[]>([])
  const mitreDefendTactics = ref<MitreDefendTactic[]>([])

  // Loading states
  const isLoading = ref(false)
  const operationStates = ref<Record<string, boolean>>({
    fetchingControls: false,
    creatingControl: false,
    updatingControl: false,
    deletingControl: false,
    fetchingModules: false,
    fetchingClasses: false,
    fetchingMitreAttack: false,
    fetchingMitreDefend: false,
  })

  // Error states
  const errors = ref<Record<string, string>>({})

  // Explicit dependencies
  const dtUtils = new DtUtils(apolloClient)
  const dtControl = new DtControl(apolloClient)
  const dtClass = new DtClass(apolloClient)
  const dtCountermeasure = new DtCountermeasure(apolloClient)
  const dtMitreAttack = new DtMitreAttack(apolloClient)
  const dtMitreDefend = new DtMitreDefend(apolloClient)
  const dtModule = new DtModule(apolloClient)

  // Error handling utilities
  const handleApiError = (error: Error, action: string): string => {
    const errorMessage = error.message || error.toString()
    
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      return 'Please log in again to continue'
    }
    if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
      return 'You do not have permission to perform this action'
    }
    if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
      return 'The requested resource was not found'
    }
    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return 'Connection failed. Please check your internet connection'
    }
    if (errorMessage.includes('timeout')) {
      return 'Request timed out. Please try again'
    }
    
    return `Failed to ${action}. Please try again.`
  }

  const setError = (operation: string, error: Error, action: string) => {
    const message = handleApiError(error, action)
    errors.value = { ...errors.value, [operation]: message }
    dtUtils.handleError({ action, error }) // Keep existing logging
  }

  const clearError = (operation: string) => {
    if (errors.value[operation]) {
      errors.value = { ...errors.value, [operation]: '' }
    }
  }

  const setOperationLoading = (operation: string, loading: boolean) => {
    operationStates.value = { ...operationStates.value, [operation]: loading }
    
    // Update global loading state
    const hasActiveOperation = Object.values(operationStates.value).some(state => state)
    isLoading.value = hasActiveOperation
  }
  // State synchronization utilities
  const syncControlUpdate = (updatedControl: Control) => {
    const index = controls.value.findIndex(c => c.id === updatedControl.id)
    if (index >= 0) {
      controls.value = controls.value.map(control => 
        control.id === updatedControl.id ? updatedControl : control
      )
    } else {
      controls.value = [updatedControl, ...controls.value]
    }
  }

  // Validation utilities
  const validateControl = (control: Partial<Control>): string[] => {
    const errors: string[] = []
    
    if (!control.name?.trim()) {
      errors.push('Control name is required')
    } else if (control.name.trim().length < 3) {
      errors.push('Control name must be at least 3 characters long')
    }
    
    if (!control.description?.trim()) {
      errors.push('Control description is required')
    } else if (control.description.trim().length < 10) {
      errors.push('Control description must be at least 10 characters long')
    }
    
    return errors
  }

  // Simple caching utilities
  const cache = ref(new Map<string, { data: any; timestamp: number }>())
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  const getCached = (key: string) => {
    const cached = cache.value.get(key)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }
    return null
  }

  const setCache = (key: string, data: any) => {
    cache.value.set(key, { data, timestamp: Date.now() })
  }

  const clearCache = (key?: string) => {
    if (key) {
      cache.value.delete(key)
    } else {
      cache.value.clear()
    }
  }

  // Retry logic for network failures
  const retryOperation = async <T>(
    operation: () => Promise<T>,
    maxRetries: number = 1
  ): Promise<T> => {
    try {
      return await operation()
    } catch (error: any) {
      // Don't retry client errors (4xx)
      if (error?.status?.toString().startsWith('4')) {
        throw error
      }
      
      // Don't retry if no retries left
      if (maxRetries <= 0) {
        throw error
      }
      
      // Wait 1 second before retry
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Retry once more
      return await operation()
    }
  }

  const resetStore = () => {
    controls.value = []
    modules.value = []
    mitreAttackMitigations.value = []
    mitreDefendTactics.value = []
    errors.value = {}
    operationStates.value = {
      fetchingControls: false,
      creatingControl: false,
      updatingControl: false,
      deletingControl: false,
      fetchingModules: false,
      fetchingClasses: false,
      fetchingMitreAttack: false,
      fetchingMitreDefend: false,
    }
    isLoading.value = false
    clearCache() // Clear all cached data
  }

  const fetchControls = async ({ folderId, ephemeral }: { folderId?: string | undefined, ephemeral?: boolean } = {}): Promise<Control[]> => {
    const operation = 'fetchingControls'
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const response = await retryOperation(() => 
        dtControl.getControls({ folderId: folderId || undefined })
      )
      
      if (!ephemeral) {
        controls.value = response
      }
      
      return response as Control[]
    } catch (error) {
      setError(operation, error as Error, 'fetch controls')
      return []
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const fetchClasses = async (
    { moduleWhere, classWhere }: { moduleWhere: any, classWhere: any }
  ) => {
    const operation = 'fetchingClasses'
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const response = await dtClass.getControlClasses({ moduleWhere, classWhere })
      return response
    } catch (error) {
      setError(operation, error as Error, 'fetch classes')
      return []
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const fetchModules = async (useCache: boolean = true): Promise<boolean> => {
    const operation = 'fetchingModules'
    const cacheKey = 'modules'
    
    // Check cache first
    if (useCache) {
      const cached = getCached(cacheKey)
      if (cached) {
        modules.value = cached
        return true
      }
    }
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const results = await dtModule.getModules()
      modules.value = results as Module[]
      
      // Cache the results
      setCache(cacheKey, results)
      
      return true
    } catch (error) {
      setError(operation, error as Error, 'fetch modules')
      return false
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const getModuleByName = async ({ moduleName }: { moduleName: string }): Promise<Module> => {
    return dtModule.getModuleByName(moduleName)
  }
  const getModuleById = async ({ moduleId }: { moduleId: string }): Promise<Module> => {
    return dtModule.getModuleById(moduleId)
  }
  const resetModule = async ({ moduleId }: { moduleId: string}): Promise<Boolean> => {
    if (!moduleId) return false
    return dtModule.resetModule(moduleId)
  }

  const getControl = async ({ controlId }: { controlId: string }): Promise<Control | null> => {
    return dtControl.getControl({ controlId })
  }

  const createControl = async (
    { newControl, classIds, folderId, updateLocalState = true }:
    { newControl: Control, classIds: string[] | null, folderId: string | undefined, updateLocalState?: boolean }
  ): Promise<Control | null> => {
    const operation = 'creatingControl'
    
    // Validate input
    const validationErrors = validateControl(newControl)
    if (validationErrors.length > 0) {
      setError(operation, new Error(validationErrors.join(', ')), 'create control')
      return null
    }
    
    let tempId: string | null = null
    
    // Optimistic update (only if we want to update local state)
    if (updateLocalState) {
      tempId = `temp-${Date.now()}`
      const optimisticControl = { ...newControl, id: tempId, pending: true }
      controls.value = [optimisticControl, ...controls.value]
    }
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const createdControl = await retryOperation(() =>
        dtControl.createControl({ newControl, classIds, folderId })
      )
      
      if (createdControl) {
        if (updateLocalState && tempId) {
          // Replace optimistic update with real data
          controls.value = controls.value.map(control =>
            control.id === tempId ? createdControl : control
          )
        }
        return createdControl
      } else {
        if (updateLocalState && tempId) {
          // Remove failed optimistic update
          controls.value = controls.value.filter(control => control.id !== tempId)
        }
        setError(operation, new Error('Failed to create control'), 'create control')
        return null
      }
    } catch (error) {
      if (updateLocalState && tempId) {
        // Remove failed optimistic update
        controls.value = controls.value.filter(control => control.id !== tempId)
      }
      setError(operation, error as Error, 'create control')
      return null
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const deleteControl = async ({ controlId }: { controlId: string }): Promise<boolean> => {
    const operation = 'deletingControl'
    
    // Check if we have the control in our local state
    const hasLocalControl = controls.value.some(control => control.id === controlId)
    
    // Store original state for rollback (only if we have local state)
    const originalControls = hasLocalControl ? [...controls.value] : null
    
    // Optimistic update - remove immediately (only if we have it locally)
    if (hasLocalControl) {
      controls.value = controls.value.filter(control => control.id !== controlId)
    }
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const success = await retryOperation(() =>
        dtControl.deleteControl({ controlId })
      )
      
      if (!success) {
        // Rollback on failure (only if we have local state)
        if (hasLocalControl && originalControls) {
          controls.value = originalControls
        }
        setError(operation, new Error('Failed to delete control'), 'delete control')
        return false
      }
      
      return true
    } catch (error) {
      // Rollback on error (only if we have local state)
      if (hasLocalControl && originalControls) {
        controls.value = originalControls
      }
      setError(operation, error as Error, 'delete control')
      return false
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const updateControl = async (
    { controlId, name, description, controlClasses, folderId }:
    { controlId: string, name: string, description: string, controlClasses: string[], folderId: string | undefined }
  ): Promise<Control | null> => {
    const operation = 'updatingControl'
    
    // Validate input
    const validationErrors = validateControl({ name, description })
    if (validationErrors.length > 0) {
      setError(operation, new Error(validationErrors.join(', ')), 'update control')
      return null
    }
    
    // Check if we have the control in our local state
    const controlIndex = controls.value.findIndex(control => control.id === controlId)
    const hasLocalControl = controlIndex !== -1
    
    // Store original state for rollback (only if we have local state)
    const originalControls = hasLocalControl ? [...controls.value] : null
    
    // Optimistic update (only if we have the control locally)
    if (hasLocalControl) {
      const optimisticUpdate = { 
        ...controls.value[controlIndex], 
        name, 
        description, 
        pending: true 
      }
      controls.value = controls.value.map(control =>
        control.id === controlId ? optimisticUpdate : control
      )
    }
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const updatedControl = await retryOperation(() =>
        dtControl.updateControl({ 
          controlId, name, description, controlClasses, folderId 
        })
      )
      
      if (updatedControl) {
        // Update local state only if we have it
        if (hasLocalControl) {
          syncControlUpdate(updatedControl)
        }
        return updatedControl
      } else {
        // Rollback on failure (only if we have local state)
        if (hasLocalControl && originalControls) {
          controls.value = originalControls
        }
        setError(operation, new Error('Failed to update control'), 'update control')
        return null
      }
    } catch (error) {
      // Rollback on error (only if we have local state)
      if (hasLocalControl && originalControls) {
        controls.value = originalControls
      }
      setError(operation, error as Error, 'update control')
      return null
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const getClass = async ({ classId }: { classId: string }): Promise<Class | null> => {
    return dtClass.getControlClassById({ classId })
  }

  const setInstantiationAttributes = async (
    { componentId, classId, attributes }:
    { componentId: string, classId: string, attributes: object }
  ): Promise<boolean> => {
    return dtClass.setInstantiationAttributes({ componentId, classId, attributes })
  }

  const getAttributesFromClassRelationship = async ({ componentId, classId }: { componentId: string, classId: string }): Promise<object> => {
    return dtClass.getAttributesFromClassRelationship({ componentId, classId })
  }

  const getCountermeasuresFromControl = async (
    { controlId }: { controlId: string }
  ): Promise<Countermeasure[] | null> => {
    return dtCountermeasure.getCountermeasuresFromControl({ controlId })
  }

  const getCountermeasure = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<Countermeasure | null> => {
    return dtCountermeasure.getCountermeasure({ countermeasureId })
  }

  const createCountermeasure = async (
    { controlId, countermeasure }: { controlId: string, countermeasure: Countermeasure }
  ): Promise<Countermeasure | null> => {
    return dtCountermeasure.createCountermeasure({ controlId, countermeasure })
  }

  const updateCountermeasure = async (
    { countermeasureId, countermeasure }: { countermeasureId: string, countermeasure: Countermeasure }
  ): Promise<Countermeasure | null> => {
    return dtCountermeasure.updateCountermeasure({ countermeasureId, countermeasure })
  }

  const deleteCountermeasure = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<boolean> => {
    return dtCountermeasure.deleteCountermeasure({ countermeasureId })
  }

  const fetchMitreAttackMitigations = async (useCache: boolean = true): Promise<boolean> => {
    const operation = 'fetchingMitreAttack'
    const cacheKey = 'mitreAttackMitigations'
    
    // Check cache first
    if (useCache) {
      const cached = getCached(cacheKey)
      if (cached) {
        mitreAttackMitigations.value = cached
        return true
      }
    }
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const response = await dtMitreAttack.getMitreAttackMitigations()
      mitreAttackMitigations.value = response
      
      // Cache the results
      setCache(cacheKey, response)
      
      return true
    } catch (error) {
      setError(operation, error as Error, 'fetch MITRE ATT&CK mitigations')
      return false
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const fetchMitreDefendTactics = async (useCache: boolean = true): Promise<boolean> => {
    const operation = 'fetchingMitreDefend'
    const cacheKey = 'mitreDefendTactics'
    
    // Check cache first
    if (useCache) {
      const cached = getCached(cacheKey)
      if (cached) {
        mitreDefendTactics.value = cached
        return true
      }
    }
    
    try {
      setOperationLoading(operation, true)
      clearError(operation)
      
      const response = await dtMitreDefend.fetchMitreDefendTactics()
      if (response) {
        mitreDefendTactics.value = response
        
        // Cache the results
        setCache(cacheKey, response)
        
        return true
      }
      
      setError(operation, new Error('No tactics returned'), 'fetch MITRE D3FEND tactics')
      return false
    } catch (error) {
      setError(operation, error as Error, 'fetch MITRE D3FEND tactics')
      return false
    } finally {
      setOperationLoading(operation, false)
    }
  }

  const getMitreDefendTechniquesByTactic = async (
    { tacticId }: { tacticId: string }
  ): Promise<MitreDefendTechnique[]> => {
    return dtMitreDefend.getMitreDefendTechniquesByTactic({ tacticId })
  }

  return {
    // State
    controls,
    modules,
    mitreAttackMitigations,
    mitreDefendTactics,
    
    // Loading states
    isLoading,
    operationStates,
    
    // Error states
    errors,
    
    // Utility functions
    clearError,
    clearCache,
    
    // Resetting functions
    resetStore,
    
    // Fetching functions
    fetchClasses, fetchControls, fetchModules, getClass,
    
    // Module functions
    getModuleByName, getModuleById, resetModule,
    
    // Control functions
    getControl, createControl, deleteControl, updateControl,
    
    // Instantiation attributes
    setInstantiationAttributes, getAttributesFromClassRelationship,
    
    // Countermeasures
    getCountermeasuresFromControl, fetchMitreAttackMitigations, fetchMitreDefendTactics, getMitreDefendTechniquesByTactic,
    createCountermeasure, updateCountermeasure, getCountermeasure, deleteCountermeasure,
  }
})
