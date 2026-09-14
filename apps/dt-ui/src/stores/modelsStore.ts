// stores/modelsStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import apolloClient from '@/plugins/apolloClient'
import { DtModel, DtModule, Model, Module, ModelScopeLocal } from '@dethernety/dt-core'

export const useModelsStore = defineStore('models', () => {
  const models = ref<Model[]>([])
  const modules = ref<Module[]>([])
  const error = ref<string>('')
  // Fetch-scoped error, distinct from the shared `error` ref (which create/update/
  // delete/getModel/fetchModules also write). The models grid reads this so an
  // unrelated op's failure never flips the grid into an error state.
  const fetchModelsError = ref<string>('')
  const isLoading = ref<boolean>(false)
  const isCreating = ref<boolean>(false)
  const isUpdating = ref<boolean>(false)
  const isDeleting = ref<boolean>(false)

  const dtModel = new DtModel(apolloClient)
  const dtModule = new DtModule(apolloClient)

  const handleApiError = (error: Error, action: string): string => {
    if (error.message.includes('401')) return 'Please log in again'
    if (error.message.includes('403')) return 'Access denied'
    if (error.message.includes('404')) return 'Resource not found'
    if (error.message.includes('network')) return 'Connection failed'
    return `Failed to ${action}. Please try again.`
  }

  const resetStore = () => {
    models.value = []
    modules.value = []
    error.value = ''
    isLoading.value = false
    isCreating.value = false
    isUpdating.value = false
    isDeleting.value = false
  }

  // Request-generation token: folder-switch fires overlapping fetches; only the latest
  // may publish to `models`, so an older response can't clobber a newer grid.
  let fetchModelsGen = 0
  const fetchModels = async ({ folderId, ephemeral, updateStore = true }: { folderId?: string | undefined, ephemeral?: boolean, updateStore?: boolean } = {}): Promise<Model[]> => {
    // Non-publishing callers (ephemeral, or updateStore:false — e.g. ContentSelectDialog) only
    // want the array back. Isolate them from shared grid state and the publish generation, or
    // they'd supersede an in-flight grid fetch and blank the grid on a successful load.
    if (ephemeral || !updateStore) {
      try {
        return (await dtModel.getModels({ folderId })) as Model[]
      } catch {
        return []
      }
    }

    const gen = ++fetchModelsGen
    try {
      isLoading.value = true
      error.value = ''
      fetchModelsError.value = ''
      const results = await dtModel.getModels({ folderId })
      if (gen === fetchModelsGen) {
        models.value = results as Model[]
      }
      return results as Model[]
    } catch (err) {
      // Return the empty sentinel (no re-throw): the grid reads fetchModelsError.
      const message = handleApiError(err as Error, 'load models')
      if (gen === fetchModelsGen) {
        error.value = message
        fetchModelsError.value = message
      }
      return []
    } finally {
      if (gen === fetchModelsGen) {
        isLoading.value = false
      }
    }
  }

  const fetchModules = async (): Promise<void> => {
    try {
      isLoading.value = true
      error.value = ''
      const results = await dtModule.getModules()
      modules.value = results as Module[]
    } catch (err) {
      // Set error state and resolve (no re-throw): the sole caller is fire-and-forget.
      error.value = handleApiError(err as Error, 'load modules')
    } finally {
      isLoading.value = false
    }
  }

  const getModel = async ({ modelId }: { modelId: string }): Promise<Model | null> => {
    try {
      error.value = ''
      const model = await dtModel.getModel({ modelId })
      return model
    } catch (err) {
      error.value = handleApiError(err as Error, 'load model')
      throw err
    }
  }

  const validateCreateRequest = (data: { name: string, description: string, modules: string[], folderId: string | undefined }): string[] => {
    const errors: string[] = []
    if (!data.name?.trim()) errors.push('Name is required')
    return errors
  }

  const createModel = async (
    { name, description, modules, folderId }:
    { name: string, description: string, modules: string[], folderId: string | undefined }
  ): Promise<Model | null> => {
    // Validate input
    const validationErrors = validateCreateRequest({ name, description, modules, folderId })
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      return null
    }

    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticModel = { 
      id: tempId, 
      name, 
      description, 
      modules: modules.map(id => ({ id, name: '' })), 
      folderId,
      pending: true 
    } as Model & { pending: boolean }
    models.value = [...models.value, optimisticModel]

    try {
      isCreating.value = true
      error.value = ''
      const createdModel = await dtModel.createModel({ name, description, modules, folderId })
      
      // Replace optimistic with real data
      models.value = models.value.map(model =>
        model.id === tempId ? createdModel : model
      )
      return createdModel
    } catch (err) {
      // Remove failed optimistic update
      models.value = models.value.filter(model => model.id !== tempId)
      error.value = handleApiError(err as Error, 'create model')
      throw err
    } finally {
      isCreating.value = false
    }
  }

  const validateUpdateRequest = (data: { id: string, name?: string }): string[] => {
    const errors: string[] = []
    if (!data.id?.trim()) errors.push('Model ID is required')
    // An update is partial: a field that is not supplied is not being written, so there is nothing to
    // validate about it. A name that IS supplied still cannot be blank.
    if (data.name !== undefined && !data.name.trim()) errors.push('Name is required')
    return errors
  }

  const syncModelUpdate = (updatedModel: Model) => {
    const index = models.value.findIndex(model => model.id === updatedModel.id)
    if (index >= 0) {
      models.value[index] = updatedModel
    }
  }

  /**
   * Write PART of a model. Every field but the id is optional, and one that is not supplied is not
   * written — so a caller can send the rename it made instead of the whole model as it last loaded it,
   * and stop reverting what somebody else changed in between.
   *
   * `baselineControls` is what the caller knew the control list to be before its own edit. With it the
   * control write is a delta and two people's additions compose; without it the list is asserted whole.
   *
   * Returns the updated model rather than a flag, because a caller holding a baseline needs the
   * server's answer to re-pin it — a baseline that drifts re-offers an id that is already attached.
   */
  const updateModel = async (
    { id, name, description, modules, controls, folderId, scope, baselineControls }:
    {
      id: string, name?: string, description?: string, modules?: string[], controls?: string[],
      folderId?: string, scope?: ModelScopeLocal, baselineControls?: string[],
    }
  ): Promise<Model | null> => {
    // Validate input
    const validationErrors = validateUpdateRequest({ id, name })
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      return null
    }

    // Check if model exists in store (for rollback capability)
    const originalModel = models.value.find(model => model.id === id)
    const hasLocalModel = !!originalModel

    // Only do optimistic update if we have the model in store
    if (hasLocalModel) {
      // Merge ONLY what is being written. Rebuilding the whole record would blank in the store exactly
      // the fields this write is leaving alone — a rename would empty the module list on screen.
      const optimisticModel = {
        ...originalModel,
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(modules !== undefined && { modules: modules.map(moduleId => ({ id: moduleId, name: '' })) }),
        ...(controls !== undefined && {
          controls: controls.map(controlId => ({ id: controlId, name: '', description: '' })),
        }),
        ...(folderId !== undefined && { folderId }),
      } as Model
      syncModelUpdate(optimisticModel)
    }

    try {
      isUpdating.value = true
      error.value = ''
      const updatedModel = await dtModel.updateModel({
        id,
        // Spread rather than pass through: a key present and undefined is not the same thing to read
        // as a key that is absent, and the boundary is easier to reason about when only what is being
        // written travels across it.
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(modules !== undefined && { modules }),
        ...(controls !== undefined && { controls }),
        ...(folderId !== undefined && { folderId }),
        ...(scope !== undefined && { scope }),
        ...(baselineControls !== undefined && { baselineLinks: { controls: baselineControls } }),
      })

      // Update store if we have the model locally
      if (hasLocalModel) {
        syncModelUpdate(updatedModel)
      }
      return updatedModel
    } catch (err) {
      // Rollback optimistic update only if we had local model
      if (hasLocalModel && originalModel) {
        syncModelUpdate(originalModel)
      }
      error.value = handleApiError(err as Error, 'update model')
      throw err
    } finally {
      isUpdating.value = false
    }
  }

  const deleteModel = async ({ modelId }: { modelId: string }):
  Promise<{ nodesDeleted: number, relationshipsDeleted: number } | null> => {
    if (!modelId?.trim()) {
      error.value = 'Model ID is required'
      return null
    }

    // Check if model exists in store (for rollback capability)
    const originalModel = models.value.find(model => model.id === modelId)
    const hasLocalModel = !!originalModel

    // Only do optimistic update if we have the model in store
    if (hasLocalModel) {
      models.value = models.value.filter(model => model.id !== modelId)
    }

    try {
      isDeleting.value = true
      error.value = ''
      const deleteInfo = await dtModel.deleteModel({ modelId })
      
      return deleteInfo
    } catch (err) {
      // Rollback optimistic update only if we had local model
      if (hasLocalModel && originalModel) {
        models.value = [...models.value, originalModel]
      }
      error.value = handleApiError(err as Error, 'delete model')
      throw err
    } finally {
      isDeleting.value = false
    }
  }

  // Request deduplication
  const activeRequests = ref(new Set<string>())

  const fetchWithDeduplication = async <T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> => {
    if (activeRequests.value.has(key)) {
      // Return a promise that waits for the existing request
      return new Promise((resolve, reject) => {
        const checkComplete = () => {
          if (!activeRequests.value.has(key)) {
            // Re-run the fetcher since we can't access the original result
            fetcher().then(resolve).catch(reject)
          } else {
            setTimeout(checkComplete, 100)
          }
        }
        checkComplete()
      })
    }

    try {
      activeRequests.value.add(key)
      return await fetcher()
    } finally {
      activeRequests.value.delete(key)
    }
  }

  return {
    // State
    models, modules, error, fetchModelsError, isLoading, isCreating, isUpdating, isDeleting,
    
    // Actions
    resetStore, fetchModules, fetchModels, getModel, createModel, updateModel, deleteModel,
    
    // Utilities
    fetchWithDeduplication,
  }
})
