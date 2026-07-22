// stores/modelsStore.js
import { ref } from 'vue'
import { defineStore } from 'pinia'
import apolloClient from '@/plugins/apolloClient'
import {
  // Core classes
  DtClass, DtControl, DtCountermeasure, DtMitreAttack,
  DtMitreDefend, DtModule, DtUtils,

  // Core types
  Class, Control, Countermeasure, MitreAttackMitigation,
  MitreDefendTactic, MitreDefendTechnique, Module,
  UpdateControlResult, DispositionKind, DispositionMutationResult,

  // Orchestration
  executeSupersedeCountermeasureFlow,
} from '@dethernety/dt-core'

export const useControlsStore = defineStore('controls', () => {
  // State
  const controls = ref<Control[]>([])
  const mitreAttackMitigations = ref<MitreAttackMitigation[]>([])
  const mitreDefendTactics = ref<MitreDefendTactic[]>([])

  // Loading states
  const isLoading = ref(false)
  const operationStates = ref<Record<string, boolean>>({
    fetchingControls: false,
    creatingControl: false,
    updatingControl: false,
    deletingControl: false,
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
    mitreAttackMitigations.value = []
    mitreDefendTactics.value = []
    errors.value = {}
    operationStates.value = {
      fetchingControls: false,
      creatingControl: false,
      updatingControl: false,
      deletingControl: false,
      fetchingMitreAttack: false,
      fetchingMitreDefend: false,
    }
    isLoading.value = false
    clearCache() // Clear all cached data
  }

  // Request-generation token: folder-switch fires overlapping fetches (widened by the
  // up-to-1s retryOperation delay); only the latest may publish to `controls`.
  let fetchControlsGen = 0
  const fetchControls = async ({ folderId, ephemeral }: { folderId?: string | undefined, ephemeral?: boolean } = {}): Promise<Control[]> => {
    // Ephemeral callers (ContentSelectDialog) only want the array back — they must not touch
    // shared grid state (controls/error/loading) nor bump the publish generation, or they'd
    // supersede an in-flight grid fetch and blank the grid on a successful load.
    if (ephemeral) {
      try {
        return (await retryOperation(() =>
          dtControl.getControls({ folderId: folderId || undefined })
        )) as Control[]
      } catch {
        return []
      }
    }

    const operation = 'fetchingControls'
    const gen = ++fetchControlsGen

    try {
      setOperationLoading(operation, true)
      clearError(operation)

      const response = await retryOperation(() =>
        dtControl.getControls({ folderId: folderId || undefined })
      )

      if (gen === fetchControlsGen) {
        controls.value = response
      }

      return response as Control[]
    } catch (error) {
      if (gen === fetchControlsGen) {
        setError(operation, error as Error, 'fetch controls')
      }
      return []
    } finally {
      if (gen === fetchControlsGen) {
        setOperationLoading(operation, false)
      }
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
  ): Promise<UpdateControlResult> => {
    const operation = 'updatingControl'

    // Validate input
    const validationErrors = validateControl({ name, description })
    if (validationErrors.length > 0) {
      setError(operation, new Error(validationErrors.join(', ')), 'update control')
      return { control: null, bindingResult: null, residualOk: false }
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

      const result = await retryOperation(() =>
        dtControl.updateControl({
          controlId, name, description, controlClasses, folderId
        })
      )

      // Rollback whenever the binding portion failed or the residual portion
      // failed, so local optimistic state never diverges from server truth.
      const failed = result.bindingResult?.errorCode != null || !result.residualOk
      if (failed) {
        if (hasLocalControl && originalControls) {
          controls.value = originalControls
        }
        setError(operation, new Error(
          result.bindingResult?.errorMessage ?? 'Failed to update control'
        ), 'update control')
        return result
      }

      if (result.control && hasLocalControl) {
        syncControlUpdate(result.control)
      }
      return result
    } catch (error) {
      // Rollback on error (only if we have local state)
      if (hasLocalControl && originalControls) {
        controls.value = originalControls
      }
      setError(operation, error as Error, 'update control')
      return { control: null, bindingResult: null, residualOk: false }
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
    { countermeasureId, countermeasureName }: { countermeasureId: string, countermeasureName?: string }
  ): Promise<boolean> => {
    // Forward the name so dt-core fires the USER-copy-delete
    // companion that flips dispositionStale on any SUPERSEDED countermeasure
    // whose reason references this USER copy.
    return dtCountermeasure.deleteCountermeasure({ countermeasureId, countermeasureName })
  }

  /**
   * Supersede flow for countermeasures — frontend
   * orchestrated. Composes createCountermeasure (clone onto the Control) +
   * disposeCountermeasure(SUPERSEDED) via the pure dt-core helper. Returns the
   * full result so the caller (ControlDialog) can render the partial-failure
   * snackbar with a Retry when step 2 fails but step 1 succeeded.
   */
  const supersedeCountermeasure = async (
    { countermeasureId, controlId, countermeasure }:
    { countermeasureId: string, controlId: string, countermeasure: Countermeasure }
  ): Promise<{ userCopy: Countermeasure, systemDispositionResult: DispositionMutationResult }> => {
    return executeSupersedeCountermeasureFlow({
      systemCountermeasureId: countermeasureId,
      systemCountermeasure: countermeasure,
      controlId,
      dtCountermeasure,
    })
  }

  const disposeCountermeasure = async (
    { countermeasureId, kind, reason }: { countermeasureId: string, kind: DispositionKind, reason: string }
  ): Promise<DispositionMutationResult> => {
    return dtCountermeasure.disposeCountermeasure({ countermeasureId, kind, reason })
  }

  const clearCountermeasureDisposition = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<DispositionMutationResult> => {
    return dtCountermeasure.clearCountermeasureDisposition({ countermeasureId })
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
    fetchControls, getClass,
    
    // Module functions
    getModuleByName, getModuleById, resetModule,
    
    // Control functions
    getControl, createControl, deleteControl, updateControl,
    
    // Instantiation attributes
    setInstantiationAttributes, getAttributesFromClassRelationship,
    
    // Countermeasures
    getCountermeasuresFromControl, fetchMitreAttackMitigations, fetchMitreDefendTactics, getMitreDefendTechniquesByTactic,
    createCountermeasure, updateCountermeasure, getCountermeasure, deleteCountermeasure,
    disposeCountermeasure, clearCountermeasureDisposition, supersedeCountermeasure,
  }
})
