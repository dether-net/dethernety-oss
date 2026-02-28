import { defineStore } from 'pinia'
import { DtFolder, Folder } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

export const useFolderStore = defineStore('folder', () => {
  const folders = ref<Folder[]>([])
  const dtFolder = new DtFolder(apolloClient)
  const selectedFolder = ref<Folder | undefined>(undefined)
  
  // Error and loading state management
  const isLoading = ref(false)
  const error = ref<string>('')
  const operationLoading = ref<Record<string, boolean>>({})
  
  // Search functionality
  const searchQuery = ref('')

  // Helper function for API error handling
  const handleApiError = (error: Error, operation: string): string => {
    console.error(`Folder ${operation} error:`, error)
    
    if (error.message.includes('401')) return 'Please log in again'
    if (error.message.includes('403')) return 'Access denied to folders'
    if (error.message.includes('404')) return 'Folder not found'
    if (error.message.includes('network')) return 'Connection failed'
    if (error.message.includes('duplicate')) return 'Folder name already exists'
    
    return `Failed to ${operation} folder. Please try again.`
  }

  // Input validation
  const validateFolder = (folder: Folder): string[] => {
    const errors: string[] = []
    
    if (!folder.name?.trim()) {
      errors.push('Folder name is required')
    } else if (folder.name.trim().length > 100) {
      errors.push('Folder name must be less than 100 characters')
    }
    
    if (folder.description && folder.description.length > 500) {
      errors.push('Description must be less than 500 characters')
    }
    
    // Check for duplicate names (excluding current folder for updates)
    const duplicateExists = folders.value.some(existing => 
      existing.name?.toLowerCase() === folder.name?.toLowerCase() &&
      existing.id !== folder.id
    )
    
    if (duplicateExists) {
      errors.push('A folder with this name already exists')
    }
    
    return errors
  }

  // State synchronization helpers
  const syncFolderCreate = (newFolder: Folder) => {
    folders.value = [...folders.value, newFolder]
  }

  const syncFolderUpdate = (updatedFolder: Folder) => {
    folders.value = folders.value.map(folder => 
      folder.id === updatedFolder.id ? updatedFolder : folder
    )
  }

  const syncFolderDelete = (folderId: string) => {
    folders.value = folders.value.filter(folder => folder.id !== folderId)
    // Clear selection if deleted folder was selected
    if (selectedFolder.value?.id === folderId) {
      selectedFolder.value = undefined
    }
  }

  const fetchFolders = async (): Promise<void> => {
    try {
      isLoading.value = true
      error.value = ''
      const results = await dtFolder.getFolders()
      folders.value = [...results]
    } catch (err) {
      error.value = handleApiError(err as Error, 'fetch')
      throw err // Re-throw for component handling if needed
    } finally {
      isLoading.value = false
    }
  }

  const createFolder = async (folder: Folder): Promise<void> => {
    // Validate before API call
    const validationErrors = validateFolder(folder)
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      throw new Error(error.value)
    }

    const operationId = `create-${Date.now()}`
    
    try {
      operationLoading.value[operationId] = true
      error.value = ''
      
      const result = await dtFolder.createFolder(folder)
      if (result) {
        // Consistent: always sync with server response
        syncFolderCreate(result)
      }
    } catch (err) {
      error.value = handleApiError(err as Error, 'create')
      throw err
    } finally {
      delete operationLoading.value[operationId]
    }
  }

  const deleteFolder = async (folderId: string): Promise<void> => {
    const operationId = `delete-${folderId}`
    
    // Store original state for rollback
    const originalFolders = [...folders.value]
    const originalSelected = selectedFolder.value
    
    try {
      operationLoading.value[operationId] = true
      error.value = ''
      
      // Optimistic update
      syncFolderDelete(folderId)
      
      // Confirm with server
      const result = await dtFolder.deleteFolder(folderId)
      if (!result) {
        throw new Error('Delete operation failed')
      }
    } catch (err) {
      // Rollback on failure
      folders.value = originalFolders
      selectedFolder.value = originalSelected
      error.value = handleApiError(err as Error, 'delete')
      throw err
    } finally {
      delete operationLoading.value[operationId]
    }
  }

  const updateFolder = async (folder: Folder): Promise<void> => {
    // Validate before API call
    const validationErrors = validateFolder(folder)
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      throw new Error(error.value)
    }

    const operationId = `update-${folder.id}`
    
    // Store original state for rollback
    const originalFolders = [...folders.value]
    
    try {
      operationLoading.value[operationId] = true
      error.value = ''
      
      // Optimistic update
      syncFolderUpdate(folder)
      
      // Confirm with server
      const result = await dtFolder.updateFolder(folder)
      if (!result) {
        throw new Error('Update operation failed')
      }
    } catch (err) {
      // Rollback on failure
      folders.value = originalFolders
      error.value = handleApiError(err as Error, 'update')
      throw err
    } finally {
      delete operationLoading.value[operationId]
    }
  }

  // Computed property for filtered folders
  const filteredFolders = computed(() => {
    if (!searchQuery.value.trim()) return folders.value
    
    const query = searchQuery.value.toLowerCase()
    return folders.value.filter(folder => 
      folder.name?.toLowerCase().includes(query) ||
      folder.description?.toLowerCase().includes(query)
    )
  })

  // Computed properties for loading states
  const isCreating = computed(() => 
    Object.keys(operationLoading.value).some(key => key.startsWith('create-'))
  )
  
  const isDeleting = computed(() => 
    Object.keys(operationLoading.value).some(key => key.startsWith('delete-'))
  )
  
  const isUpdating = computed(() => 
    Object.keys(operationLoading.value).some(key => key.startsWith('update-'))
  )

  // Helper to check if specific folder operation is in progress
  const isFolderOperationLoading = (folderId: string, operation: 'delete' | 'update') => {
    return computed(() => operationLoading.value[`${operation}-${folderId}`] || false)
  }

  return {
    // State
    folders: filteredFolders, selectedFolder, searchQuery,
    
    // Loading states
    isLoading, isCreating, isDeleting, isUpdating, isFolderOperationLoading,
    
    // Error state
    error,
    
    // Actions
    fetchFolders, createFolder, deleteFolder, updateFolder,
  }
}, {
  persist: {
    pick: ['selectedFolder']
  }
})
