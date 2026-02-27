import { defineStore } from 'pinia'
import { ref } from 'vue'
import apolloClient from '@/plugins/apolloClient'
import {
  // Core classes
  DtClass, DtIssue,

  // Core types
  Class, Issue,
} from '@dethernety/dt-core'
import { LocationQueryRaw } from 'vue-router'

export const useIssueStore = defineStore('issue', () => {
  // State
  const issues = ref<Issue[]>([])
  const issueClasses = ref<Class[]>([])
  const issueDataClipboard = ref<{
    name: string
    description: string
    elementIds: string[]
    returnTo: {
      name: string
      path: string
      query: LocationQueryRaw
    }
  } | null>(null)

  // Loading states
  const isLoading = ref(false)
  const isCreating = ref(false)
  const isUpdating = ref(false)
  const isDeleting = ref(false)
  const isAddingElements = ref(false)
  const isRemovingElement = ref(false)

  // Error states
  const error = ref<string>('')
  const fieldErrors = ref<Record<string, string>>({})

  // Dependencies - declared at top for clarity
  const dtIssue = new DtIssue(apolloClient)
  const dtClass = new DtClass(apolloClient)

  // Helper functions
  const handleApiError = (error: Error, operation: string): string => {
    const errorMessage = error.message || error.toString()
    
    if (errorMessage.includes('401')) return 'Please log in again'
    if (errorMessage.includes('403')) return `You don't have permission to ${operation}`
    if (errorMessage.includes('404')) return 'Issue not found'
    if (errorMessage.includes('network') || errorMessage.includes('fetch')) return 'Connection failed. Please try again.'
    if (errorMessage.includes('timeout')) return 'Request timed out. Please try again.'
    
    return `Failed to ${operation}. Please try again.`
  }

  const clearError = (): void => {
    error.value = ''
    fieldErrors.value = {}
  }

  const validateIssue = (issue: Issue): string[] => {
    const errors: string[] = []
    
    if (!issue.name?.trim()) errors.push('Issue name is required')
    if (issue.name && issue.name.length > 200) errors.push('Issue name must be less than 200 characters')
    if (!issue.issueClass?.id) errors.push('Issue class is required')
    if (issue.description && issue.description.length > 1000) errors.push('Description must be less than 1000 characters')
    
    return errors
  }

  const syncIssueUpdate = (updatedIssue: Issue): void => {
    const index = issues.value.findIndex(i => i.id === updatedIssue.id)
    if (index >= 0) {
      issues.value[index] = updatedIssue
    } else {
      issues.value = [updatedIssue, ...issues.value]
    }
  }

  const removeIssueFromState = (issueId: string): void => {
    issues.value = issues.value.filter(i => i.id !== issueId)
  }
  const resetStore = (): void => {
    issues.value = []
    issueClasses.value = []
    issueDataClipboard.value = null
    clearError()
    // Reset all loading states
    isLoading.value = false
    isCreating.value = false
    isUpdating.value = false
    isDeleting.value = false
    isAddingElements.value = false
    isRemovingElement.value = false
  }

  const resetIssue = (): void => {
    issues.value = []
    issueDataClipboard.value = null
    clearError()
  }

  const fetchIssueClasses = async (
    { classType, moduleId, classId, className, moduleName, classCategory }:
    { classType?: string, moduleId?: string, classId?: string, className?: string, moduleName?: string, classCategory?: string }
  ): Promise<Class[]> => {
    try {
      isLoading.value = true
      clearError()
      
      const result = await dtIssue.findIssueClasses({ classType, moduleId, classId, className, moduleName, classCategory })
      issueClasses.value = result
      return result
    } catch (err) {
      const errorMessage = handleApiError(err as Error, 'fetch issue classes')
      error.value = errorMessage
      console.error('Error fetching issue classes:', err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const setIssueDataClipboard = (data: { name: string, description: string, elementIds: string[], returnTo: { name: string, path: string, query: LocationQueryRaw } }): void => {
    // Validate clipboard data
    if (!data.name?.trim()) {
      throw new Error('Issue name is required for clipboard data')
    }
    if (!data.elementIds?.length) {
      throw new Error('At least one element ID is required for clipboard data')
    }
    
    issueDataClipboard.value = data
    
    // Auto-clear after 30 minutes to prevent memory leaks
    setTimeout(() => {
      if (issueDataClipboard.value === data) {
        issueDataClipboard.value = null
      }
    }, 30 * 60 * 1000)
  }

  const getIssueDataClipboard = (): { name: string, description: string, elementIds: string[], returnTo: { name: string, path: string, query: LocationQueryRaw } } | null => {
    return issueDataClipboard.value
  }

  const clearIssueDataClipboard = (): void => {
    issueDataClipboard.value = null
  }

  const fetchIssues = async (
    { name, issueId, classId, elementIds, classType, moduleId, moduleName, issueStatus }:
    { name?: string, issueId?: string, classId?: string, elementIds?: string[], classType?: string, moduleId?: string, moduleName?: string, issueStatus?: string }
  ): Promise<Issue[]> => {
    try {
      isLoading.value = true
      clearError()
      
      const result = await dtIssue.findIssues({ name, issueId, classId, elementIds, classType, moduleId, moduleName, issueStatus })
      issues.value = result
      return result
    } catch (err) {
      const errorMessage = handleApiError(err as Error, 'fetch issues')
      error.value = errorMessage
      console.error('Error fetching issues:', err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getIssueById = (issueId: string): Issue | null => {
    const result = issues.value.find((issue: Issue) => issue.id === issueId)
    return result ?? null
  }

  const createIssue = async (issue: Issue): Promise<Issue | null> => {
    // Validate input first
    const validationErrors = validateIssue(issue)
    if (validationErrors.length > 0) {
      fieldErrors.value = { validation: validationErrors.join(', ') }
      throw new Error(validationErrors.join(', '))
    }

    // Step 1: Optimistically update UI
    const tempId = `temp-${Date.now()}-${Math.random()}`
    const optimisticIssue: Issue = {
      ...issue,
      id: tempId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as Issue & { pending?: boolean }
    // Mark as pending for UI feedback
    ;(optimisticIssue as any).pending = true
    issues.value = [optimisticIssue, ...issues.value]

    try {
      isCreating.value = true
      clearError()
      
      // Step 2: Send to server
      const result = await dtIssue.createIssue({
        name: issue.name,
        issueClassId: issue.issueClass!.id,
        description: issue.description || undefined,
        type: issue.type || undefined,
        category: issue.category || undefined,
        attributes: issue.attributes || undefined,
        comments: issue.comments || [],
      })
      
      if (result) {
        // Step 3: Replace optimistic item with real data
        const finalResult = { ...result } as Issue & { pending?: boolean }
        ;(finalResult as any).pending = false
        issues.value = issues.value.map(i =>
          i.id === tempId ? finalResult : i
        )
        return result
      } else {
        throw new Error('No result returned from server')
      }
    } catch (err) {
      // Step 4: Remove failed optimistic update
      issues.value = issues.value.filter(i => i.id !== tempId)
      
      const errorMessage = handleApiError(err as Error, 'create issue')
      error.value = errorMessage
      console.error('Error creating issue:', err)
      throw new Error(errorMessage)
    } finally {
      isCreating.value = false
    }
  }

  const updateIssue = async (issue: Issue): Promise<Issue | null> => {
    // Validate input first
    if (!issue.id) {
      throw new Error('Issue ID is required for update')
    }
    
    const validationErrors = validateIssue(issue)
    if (validationErrors.length > 0) {
      fieldErrors.value = { validation: validationErrors.join(', ') }
      throw new Error(validationErrors.join(', '))
    }

    // Store original for rollback
    const originalIssue = issues.value.find(i => i.id === issue.id)
    if (!originalIssue) {
      throw new Error('Issue not found in local state')
    }

    // Step 1: Optimistically update UI
    const optimisticIssue = {
      ...issue,
      updatedAt: new Date().toISOString()
    } as Issue & { pending?: boolean }
    ;(optimisticIssue as any).pending = true
    syncIssueUpdate(optimisticIssue)

    try {
      isUpdating.value = true
      clearError()
      
      // Step 2: Send to server
      const result = await dtIssue.updateIssue({
        issueId: issue.id,
        name: issue.name,
        description: issue.description,
        type: issue.type,
        category: issue.category,
        attributes: issue.attributes,
        issueStatus: issue.issueStatus,
        comments: issue.comments,
        issueClassId: issue.issueClass?.id,
      })
      
      if (result) {
        // Step 3: Update with server response
        const finalResult = { ...result } as Issue & { pending?: boolean }
        ;(finalResult as any).pending = false
        syncIssueUpdate(finalResult)
        return result
      } else {
        throw new Error('No result returned from server')
      }
    } catch (err) {
      // Step 4: Rollback optimistic update
      syncIssueUpdate(originalIssue)
      
      const errorMessage = handleApiError(err as Error, 'update issue')
      error.value = errorMessage
      console.error('Error updating issue:', err)
      throw new Error(errorMessage)
    } finally {
      isUpdating.value = false
    }
  }

  const deleteIssue = async (issueId: string): Promise<boolean> => {
    if (!issueId?.trim()) {
      throw new Error('Issue ID is required for deletion')
    }

    // Store original for rollback
    const originalIssue = issues.value.find(i => i.id === issueId)
    if (!originalIssue) {
      throw new Error('Issue not found in local state')
    }

    // Step 1: Optimistically remove from UI
    removeIssueFromState(issueId)

    try {
      isDeleting.value = true
      clearError()
      
      // Step 2: Send delete request to server
      const result = await dtIssue.deleteIssue({ issueId })
      
      if (result) {
        // Deletion successful, item already removed optimistically
        return true
      } else {
        throw new Error('Delete operation failed')
      }
    } catch (err) {
      // Step 3: Rollback optimistic deletion
      syncIssueUpdate(originalIssue)
      
      const errorMessage = handleApiError(err as Error, 'delete issue')
      error.value = errorMessage
      console.error('Error deleting issue:', err)
      throw new Error(errorMessage)
    } finally {
      isDeleting.value = false
    }
  }

  const addElementsToIssue = async ({ issueId, elementIds }: { issueId: string, elementIds: string[] }): Promise<number> => {
    if (!issueId?.trim()) {
      throw new Error('Issue ID is required')
    }
    if (!elementIds?.length) {
      throw new Error('At least one element ID is required')
    }

    try {
      isAddingElements.value = true
      clearError()
      
      const result = await dtIssue.addElementsToIssue({ issueId, elementIds })
      return result || 0
    } catch (err) {
      const errorMessage = handleApiError(err as Error, 'add elements to issue')
      error.value = errorMessage
      console.error('Error adding elements to issue:', err)
      throw new Error(errorMessage)
    } finally {
      isAddingElements.value = false
    }
  }

  const removeElementFromIssue = async ({ issueId, elementId }: { issueId: string, elementId: string }): Promise<boolean> => {
    if (!issueId?.trim()) {
      throw new Error('Issue ID is required')
    }
    if (!elementId?.trim()) {
      throw new Error('Element ID is required')
    }

    try {
      isRemovingElement.value = true
      clearError()
      
      const result = await dtIssue.removeElementFromIssue({ issueId, elementId })
      return result || false
    } catch (err) {
      const errorMessage = handleApiError(err as Error, 'remove element from issue')
      error.value = errorMessage
      console.error('Error removing element from issue:', err)
      throw new Error(errorMessage)
    } finally {
      isRemovingElement.value = false
    }
  }

  const getAttributesFromClassRelationship = async ({ componentId, classId }: { componentId: string, classId: string }): Promise<object> => {
    if (!componentId?.trim()) {
      throw new Error('Component ID is required')
    }
    if (!classId?.trim()) {
      throw new Error('Class ID is required')
    }

    try {
      return await dtClass.getAttributesFromClassRelationship({ componentId, classId }) || {}
    } catch (err) {
      const errorMessage = handleApiError(err as Error, 'get attributes from class relationship')
      error.value = errorMessage
      console.error('Error getting attributes from class relationship:', err)
      throw new Error(errorMessage)
    }
  }

  const setInstantiationAttributes = async ({ componentId, classId, attributes }: { componentId: string, classId: string, attributes: object }): Promise<boolean> => {
    if (!componentId?.trim()) {
      throw new Error('Component ID is required')
    }
    if (!classId?.trim()) {
      throw new Error('Class ID is required')
    }
    if (!attributes || typeof attributes !== 'object') {
      throw new Error('Valid attributes object is required')
    }

    try {
      return await dtClass.setInstantiationAttributes({ componentId, classId, attributes }) || false
    } catch (err) {
      const errorMessage = handleApiError(err as Error, 'set instantiation attributes')
      error.value = errorMessage
      console.error('Error setting instantiation attributes:', err)
      throw new Error(errorMessage)
    }
  }

  return {
    // State
    issues, issueClasses, issueDataClipboard,
    
    // Loading states
    isLoading, isCreating, isUpdating, isDeleting, isAddingElements, isRemovingElement,
    
    // Error states
    error, fieldErrors,
    
    // Helper functions
    clearError,
    
    // Store management
    resetStore, resetIssue,
    
    // Clipboard operations
    setIssueDataClipboard, getIssueDataClipboard, clearIssueDataClipboard,
    
    // Fetch operations
    fetchIssueClasses, fetchIssues, getIssueById,
    
    // CRUD operations
    createIssue, updateIssue, deleteIssue,
    
    // Element operations
    addElementsToIssue, removeElementFromIssue,
    
    // Class relationship operations
    getAttributesFromClassRelationship, setInstantiationAttributes,
  }
})
