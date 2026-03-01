// stores/modelsStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import apolloClient from '@/plugins/apolloClient'
import { DtModel, DtModule, Model, Module } from '@dethernety/dt-core'

export const useModelsStore = defineStore('models', () => {
  const models = ref<Model[]>([])
  const modules = ref<Module[]>([])
  const error = ref<string>('')
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

  const fetchModels = async ({ folderId, ephemeral, updateStore = true }: { folderId?: string | undefined, ephemeral?: boolean, updateStore?: boolean } = {}): Promise<Model[]> => {
    try {
      isLoading.value = true
      error.value = ''
      const results = await dtModel.getModels({ folderId })
      if (updateStore && !ephemeral) {
        models.value = results as Model[]
      }
      return results as Model[]
    } catch (err) {
      error.value = handleApiError(err as Error, 'load models')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const fetchModules = async (): Promise<void> => {
    try {
      isLoading.value = true
      error.value = ''
      const results = await dtModule.getModules()
      modules.value = results as Module[]
    } catch (err) {
      error.value = handleApiError(err as Error, 'load modules')
      throw err
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

  const validateUpdateRequest = (data: { id: string, name: string, description: string, modules: string[], controls: string[], folderId: string | undefined }): string[] => {
    const errors: string[] = []
    if (!data.id?.trim()) errors.push('Model ID is required')
    if (!data.name?.trim()) errors.push('Name is required')
    // if (!data.modules?.length) errors.push('At least one module is required')
    return errors
  }

  const syncModelUpdate = (updatedModel: Model) => {
    const index = models.value.findIndex(model => model.id === updatedModel.id)
    if (index >= 0) {
      models.value[index] = updatedModel
    }
  }

  const updateModel = async (
    { id, name, description, modules, controls, folderId }:
    { id: string, name: string, description: string, modules: string[], controls: string[], folderId: string | undefined }
  ): Promise<boolean> => {
    // Validate input
    const validationErrors = validateUpdateRequest({ id, name, description, modules, controls, folderId })
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      return false
    }

    // Check if model exists in store (for rollback capability)
    const originalModel = models.value.find(model => model.id === id)
    const hasLocalModel = !!originalModel

    // Only do optimistic update if we have the model in store
    if (hasLocalModel) {
      const optimisticModel = { 
        ...originalModel,
        name, 
        description, 
        modules: modules.map(moduleId => ({ id: moduleId, name: '' })),
        controls: controls?.map(controlId => ({ id: controlId, name: '', description: '' })) || [],
        folderId 
      } as Model
      syncModelUpdate(optimisticModel)
    }

    try {
      isUpdating.value = true
      error.value = ''
      const updatedModel = await dtModel.updateModel({ id, name, description, modules, controls, folderId })
      
      // Update store if we have the model locally
      if (hasLocalModel) {
        syncModelUpdate(updatedModel)
      }
      return true
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
      console.log('deleteModel:', modelId)
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
    models, modules, error, isLoading, isCreating, isUpdating, isDeleting,
    
    // Actions
    resetStore, fetchModules, fetchModels, getModel, createModel, updateModel, deleteModel,
    
    // Utilities
    fetchWithDeduplication,
  }
})
