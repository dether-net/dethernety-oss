import { defineStore } from 'pinia'
import apolloClient from '@/plugins/apolloClient'
import { FetchResult, Observable } from '@apollo/client'
import {
  // Core classes
  DtAnalysis, DtMitreAttack, DtMitreDefend,

  // Core types
  Analysis, AnalysisClass, MitreAttackMitigation, MitreAttackTechnique, MitreDefendTechnique,
} from '@dethernety/dt-core'

import { ref, computed } from 'vue'

export const useAnalysisStore = defineStore('analysis', () => {
  const analyses = ref<Analysis[]>([])
  const analysisClasses = ref<AnalysisClass[]>([])
  const currentAnalysis = ref<Analysis | null>(null)
  const currentChatResults = ref<Record<string, string>>({})
  
  // Error and loading state management
  const error = ref<string>('')
  const loadingStates = ref({
    fetchingAnalyses: false,
    fetchingAnalysisClasses: false,
    creatingAnalysis: false,
    updatingAnalysis: false,
    deletingAnalysis: false,
    runningAnalysis: false,
    resumingAnalysis: false
  })
  
  const isLoading = computed(() => 
    Object.values(loadingStates.value).some(loading => loading)
  )

  const dtAnalysis = new DtAnalysis(apolloClient)
  const dtMitreAttack = new DtMitreAttack(apolloClient)
  const dtMitreDefend = new DtMitreDefend(apolloClient)

  const resetStore = (): void => {
    analyses.value = []
    currentAnalysis.value = null
    currentChatResults.value = {}
    error.value = ''
    // Reset all loading states
    Object.keys(loadingStates.value).forEach(key => {
      loadingStates.value[key as keyof typeof loadingStates.value] = false
    })
  }
  
  // Error handling helper
  const handleApiError = (operation: string, err?: any): string => {
    console.error(`${operation} failed:`, err)
    if (err?.message?.includes('401') || err?.status === 401) {
      return 'Please log in again to continue'
    }
    if (err?.message?.includes('403') || err?.status === 403) {
      return 'Access denied - insufficient permissions'
    }
    if (err?.message?.includes('404') || err?.status === 404) {
      return 'Resource not found'
    }
    if (err?.message?.includes('network') || err?.code === 'NETWORK_ERROR') {
      return 'Connection failed - please check your internet connection'
    }
    return `Failed to ${operation.toLowerCase()}. Please try again.`
  }
  
  // State synchronization helper
  const syncAnalysisUpdate = (updatedAnalysis: Analysis): void => {
    // Update in analyses array
    const index = analyses.value.findIndex(a => a.id === updatedAnalysis.id)
    if (index !== -1) {
      analyses.value.splice(index, 1, structuredClone(updatedAnalysis))
    }
    
    // Sync currentAnalysis if it matches
    if (currentAnalysis.value?.id === updatedAnalysis.id) {
      currentAnalysis.value = structuredClone(updatedAnalysis)
    }
  }

  const setCurrentAnalysis = (analysis: Analysis): void => {
    currentAnalysis.value = analysis
  }

  const fetchAnalysisClasses = async (
    { classType, moduleId, classId, className }:
    { classType?: string, moduleId?: string, classId?: string, className?: string }
  ): Promise<AnalysisClass[]> => {
    try {
      loadingStates.value.fetchingAnalysisClasses = true
      error.value = ''
      
      const classes = await dtAnalysis.findAnalysisClasses({ classType, moduleId, classId, className });
      analysisClasses.value = classes ?? [];
      return classes ?? [];
    } catch (err) {
      error.value = handleApiError('fetch analysis classes', err)
      throw err
    } finally {
      loadingStates.value.fetchingAnalysisClasses = false
    }
  }

  const fetchAnalyses = async (
    { analysisId, elementId, classType, moduleId, classId }:
    { analysisId?: string, elementId?: string, classType?: string, moduleId?: string, classId?: string }
  ): Promise<Analysis[]> => {
    try {
      loadingStates.value.fetchingAnalyses = true
      error.value = ''
      
      const result = await dtAnalysis.findAnalyses({ analysisId, elementId, classType, moduleId, classId });
      const safeResult = result ?? [];
      analyses.value = safeResult.map(analysis => structuredClone(analysis));
      return safeResult;
    } catch (err) {
      error.value = handleApiError('fetch analyses', err)
      throw err
    } finally {
      loadingStates.value.fetchingAnalyses = false
    }
  }

  const createAnalysis = async (
    { elementId, name, description, type, category, analysisClassId }:
    { elementId: string, name: string, description: string, type?: string, category?: string, analysisClassId: string }
  ): Promise<Analysis> => {
    // Validation
    const validationErrors: string[] = []
    if (!name?.trim()) validationErrors.push('Analysis name is required')
    if (!elementId?.trim()) validationErrors.push('Element ID is required')
    if (!analysisClassId?.trim()) validationErrors.push('Analysis class is required')
    
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      throw new Error(validationErrors.join(', '))
    }

    // Optimistic update setup
    const tempId = `temp-${Date.now()}`
    const optimisticAnalysis = {
      id: tempId,
      elementId,
      name: name.trim(),
      description: description || '',
      type: type || '',
      category: category || '',
      analysisClass: { id: analysisClassId },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pending: true
    } as Analysis & { pending: boolean }

    try {
      loadingStates.value.creatingAnalysis = true
      error.value = ''
      
      // Add optimistic update
      analyses.value.push(optimisticAnalysis)
      
      const analysis = await dtAnalysis.createAnalysis({
        elementId,
        name: name.trim(),
        description,
        type,
        category,
        analysisClassId,
      })
      
      // Replace optimistic with real data
      const index = analyses.value.findIndex(a => a.id === tempId)
      if (index !== -1 && analysis) {
        const mutableAnalysis = structuredClone(analysis)
        analyses.value.splice(index, 1, mutableAnalysis)
        return mutableAnalysis
      }
      return analysis!
    } catch (err) {
      // Remove failed optimistic update
      analyses.value = analyses.value.filter(a => a.id !== tempId)
      error.value = handleApiError('create analysis', err)
      throw err
    } finally {
      loadingStates.value.creatingAnalysis = false
    }
  }

  const updateAnalysis = async (
    { analysisId, name, description, type, category }:
    { analysisId: string, name: string, description: string, type?: string, category?: string }
  ): Promise<Analysis> => {
    // Validation
    const validationErrors: string[] = []
    if (!analysisId?.trim()) validationErrors.push('Analysis ID is required')
    if (!name?.trim()) validationErrors.push('Analysis name is required')
    
    if (validationErrors.length > 0) {
      error.value = validationErrors.join(', ')
      throw new Error(validationErrors.join(', '))
    }

    try {
      loadingStates.value.updatingAnalysis = true
      error.value = ''
      
      const updatedAnalysis = await dtAnalysis.updateAnalysis({ 
        analysisId, 
        name: name.trim(), 
        description, 
        type, 
        category 
      })
      
      // Use the synchronization helper to update both arrays and currentAnalysis
      syncAnalysisUpdate(updatedAnalysis!)
      return updatedAnalysis!
    } catch (err) {
      error.value = handleApiError('update analysis', err)
      throw err
    } finally {
      loadingStates.value.updatingAnalysis = false
    }
  }

  const getOrCreateAnalysis = async (
    { elementId, classType, moduleId, classId, className, analysisName, analysisDescription }:
    { elementId: string, classType?: string, moduleId?: string, classId?: string, className?: string, analysisName?: string, analysisDescription?: string }
  ): Promise<Analysis> => {
    if (!elementId) {
      throw new Error('Element ID is required')
    }
    
    const analysis = await dtAnalysis.findAnalyses({ elementId, classType, moduleId, classId })
    if (analysis && analysis.length > 0) {
      return analysis[0]
    }
    
    const analysisClasses = await dtAnalysis.findAnalysisClasses({ classType, moduleId, classId, className })
    if (analysisClasses && analysisClasses.length > 0) {
      const analysisClass = analysisClasses[0]
      const createdAnalysis = await dtAnalysis.createAnalysis({
        elementId,
        name: analysisName || className || classType || 'New Analysis',
        description: analysisDescription || '',
        type: analysisClass.type,
        category: analysisClass.category,
        analysisClassId: analysisClass.id,
      })
      return createdAnalysis!
    }
    
    throw new Error('No analysis classes found for the specified criteria')
  }

  const findAnalysis = async (
    { name, analysisId, classId, elementId, classType, moduleId }:
    { name?: string, analysisId?: string, classId?: string, elementId?: string, classType?: string, moduleId?: string }
  ): Promise<Analysis | null> => {
    const analysis = await dtAnalysis.findAnalyses({ name, analysisId, classId, elementId, classType, moduleId })
    if (analysis && analysis.length > 0) {
      return analysis[0]
    }
    return null
  }

  const findAnalyses = async (
    { name, analysisId, classId, elementId, classType, moduleId }:
    { name?: string, analysisId?: string, classId?: string, elementId?: string, classType?: string, moduleId?: string }
  ): Promise<Analysis[] | null> => {
    const analysis = await dtAnalysis.findAnalyses({ name, analysisId, classId, elementId, classType, moduleId })
    if (analysis && analysis.length > 0) {
      return analysis
    }
    return null
  }

  const deleteAnalysis = async ({ analysisId }: { analysisId: string }): Promise<boolean> => {
    if (!analysisId?.trim()) {
      error.value = 'Analysis ID is required'
      throw new Error('Analysis ID is required')
    }

    try {
      loadingStates.value.deletingAnalysis = true
      error.value = ''
      
      const result = await dtAnalysis.deleteAnalysis({ analysisId })
      if (result) {
        analyses.value = analyses.value.filter(analysis => analysis.id !== analysisId)
        
        // Clear currentAnalysis if it was the deleted one
        if (currentAnalysis.value?.id === analysisId) {
          currentAnalysis.value = null
        }
      }
      return result
    } catch (err) {
      error.value = handleApiError('delete analysis', err)
      throw err
    } finally {
      loadingStates.value.deletingAnalysis = false
    }
  }

  const runAnalysis = async ({ analysisId, additionalParams }: { analysisId: string, additionalParams?: object | undefined }): Promise<string> => {
    if (!analysisId?.trim()) {
      error.value = 'Analysis ID is required to run analysis'
      throw new Error('Analysis ID is required to run analysis')
    }

    try {
      loadingStates.value.runningAnalysis = true
      error.value = ''
      
      return (await dtAnalysis.runAnalysis({ analysisId, additionalParams }))!
    } catch (err) {
      error.value = handleApiError('run analysis', err)
      throw err
    } finally {
      loadingStates.value.runningAnalysis = false
    }
  }

  const resumeAnalysis = async ({ analysisId, userInput }: { analysisId: string, userInput?: string }): Promise<string> => {
    if (!analysisId?.trim()) {
      error.value = 'Analysis ID is required to resume analysis'
      throw new Error('Analysis ID is required to resume analysis')
    }

    try {
      loadingStates.value.resumingAnalysis = true
      error.value = ''
      
      return (await dtAnalysis.resumeAnalysis({ analysisId, userInput }))!
    } catch (err) {
      error.value = handleApiError('resume analysis', err)
      throw err
    } finally {
      loadingStates.value.resumingAnalysis = false
    }
  }

  const getAnalysisValues = async ({ analysisId, valueKey }: { analysisId: string, valueKey: string }): Promise<object | null> => {
    return dtAnalysis.getAnalysisValues({ analysisId, valueKey })
  }

  const subscribeToStream = ({ sessionId }: { sessionId: string }): Observable<FetchResult<any>> | null => {
    return dtAnalysis.subscribeToStream({ sessionId })
  }

  const getMitreAttackTechnique = async ({ attackId }: { attackId: string }): Promise<MitreAttackTechnique | null> => {
    return dtMitreAttack.getMitreAttackTechnique({ attackId })
  }

  const getMitreAttackMitigation = async ({ attackId }: { attackId: string }): Promise<MitreAttackMitigation | null> => {
    return dtMitreAttack.getMitreAttackMitigation({ attackId })
  }

  const getMitreDefendTechnique = async ({ d3fendId }: { d3fendId: string }): Promise<MitreDefendTechnique | null> => {
    return dtMitreDefend.getMitreDefendTechnique({ d3fendId })
  }

  const getDocument = async ({ analysisId, filter }: { analysisId: string, filter: object }): Promise<object | null> => {
    return dtAnalysis.getDocument({ analysisId, filter })
  }

  const setChatResults = ({ analysisId, results }: { analysisId: string, results: string }): void => {
    currentChatResults.value[analysisId] = results
  }

  const getChatResults = (analysisId: string): string => {
    return currentChatResults.value[analysisId] || ''
  }

  const startChat = async (
    { analysisId, userQuestion }:
    { analysisId: string, userQuestion: string }):
  Promise<{ sessionId: string } | null> => {
    return dtAnalysis.startChat({ analysisId, userQuestion })
  }

  return {
    // State
    analyses,
    analysisClasses,
    currentAnalysis,
    
    // Error and loading state
    error,
    loadingStates,
    isLoading,

    // Utility functions
    resetStore,

    // Analysis functions
    fetchAnalysisClasses,
    getOrCreateAnalysis,
    findAnalysis,
    findAnalyses,
    deleteAnalysis,
    runAnalysis,
    resumeAnalysis,
    getAnalysisValues,
    subscribeToStream,
    fetchAnalyses,
    createAnalysis,
    updateAnalysis,
    getMitreAttackTechnique,
    getMitreAttackMitigation,
    getMitreDefendTechnique,
    setCurrentAnalysis,
    getDocument,
    setChatResults,
    getChatResults,
    startChat,
  }
})
