
import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
type FetchResult<T> = Apollo.FetchResult<T>
type Observable<T> = Apollo.Observable<T>
import { Analysis, AnalysisClass } from '../interfaces/core-types-interface.js'
import {
  FIND_ANALYSES,
  FIND_ANALYSIS_CLASSES,
  CREATE_ANALYSIS,
  DELETE_ANALYSIS,
  RUN_ANALYSIS,
  GET_ANALYSIS_VALUES,
  GET_DOCUMENT,
  RESUME_ANALYSIS,
  UPDATE_ANALYSIS,
  SUBSCRIBE_TO_STREAM,
  START_ANALYSIS_CHAT,
} from './dt-analysis-gql.js'

export class DtAnalysis {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Find analysis classes
   * @param classType - The type of the class to find
   * @param moduleId - The ID of the module to find the class in
   * @param classId - The ID of the class to find
   * @param className - The name of the class to find
   * @returns The analysis classes or null if the class type, module ID, class ID or class name is invalid
   */
  findAnalysisClasses = async (
    { classType, moduleId, classId, className }:
    { classType?: string, moduleId?: string, classId?: string, className?: string }
  ): Promise<AnalysisClass[] | null> => {
    try {
      let condition: {
        id?: { eq?: string },
        name?: { eq?: string },
        type?: { eq?: string },
        module?: {
          single?: {
            id?: { eq?: string }
          }
        },
      } = {}
      if (classId) condition.id = { eq: classId }
      if (className) condition.name = { eq: className }
      if (classType) condition.type = { eq: classType }
      if (moduleId) {
        condition.module = { single: { id: { eq: moduleId } } }
      }

      const response = await this.dtUtils.performQuery<{ analysisClasses: AnalysisClass[] }>({
        query: FIND_ANALYSIS_CLASSES,
        variables: { condition: { "AND": condition } },
        action: 'findAnalysisClasses',
        fetchPolicy: 'network-only'
      })

      return response.analysisClasses || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Find analyses
   * @param name - The name of the analysis to find
   * @param analysisId - The ID of the analysis to find
   * @param classId - The ID of the class to find the analysis in
   * @param elementId - The ID of the element to find the analysis in
   * @param classType - The type of the class to find the analysis in
   * @param moduleId - The ID of the module to find the analysis in
   * @returns The analyses or null if the name, analysis ID, class ID, element ID, class type or module ID is invalid
   */
  findAnalyses = async (
    { name, analysisId, classId, elementId, classType, moduleId }:
    { name?: string, analysisId?: string, classId?: string | null, elementId?: string, classType?: string, moduleId?: string }
  ): Promise<Analysis[] | null> => {
    try {
      let condition: {
        id?: { eq?: string },
        name?: { eq?: string },
        analysisClass?: {
          single?: {
            id?: { eq?: string }
            type?: { eq?: string }
          }
        } | null,
        element?: {
          single?: {
            id?: { eq?: string }
          }
        },
        module?: {
          single?: {
            id?: { eq?: string }
          }
        }
      } = {}
      if (name) condition.name = { eq: name }
      if (analysisId) condition.id = { eq: analysisId }
      if (classId) {
        condition.analysisClass = { single: { id: { eq: classId } } }
      }
      if (classType) {
        if (!condition.analysisClass) {
          condition.analysisClass = { single: { type: { eq: classType } } }
        } else if (condition.analysisClass.single) {
          condition.analysisClass.single.type = { eq: classType }
        }
      }
      if (elementId) {
        condition.element = { single: { id: { eq: elementId } } }
      }
      if (moduleId) {
        condition.module = { single: { id: { eq: moduleId } } }
      }

      const response = await this.dtUtils.performQuery<{ analyses: Analysis[] }>({
        query: FIND_ANALYSES,
        variables: { condition: { "AND": condition } },
        action: 'findAnalyses',
        fetchPolicy: 'network-only'
      })
      
      if (response.analyses) {
        const analyses = response.analyses.map((analysis: Analysis) => ({
          ...analysis,
          analysisClass: analysis.analysisClass && Array.isArray(analysis.analysisClass) && analysis.analysisClass.length > 0
            ? { id: analysis.analysisClass[0].id }
            : { id: analysis.analysisClass?.id || '' },
          element: [
            ...(Array.isArray(analysis.model) ? analysis.model : []),
            ...(Array.isArray(analysis.component) ? analysis.component : []),
            ...(Array.isArray(analysis.dataFlow) ? analysis.dataFlow : []),
            ...(Array.isArray(analysis.securityBoundary) ? analysis.securityBoundary : []),
            ...(Array.isArray(analysis.control) ? analysis.control : []),
            ...(Array.isArray(analysis.data) ? analysis.data : []),
          ][0] || null as unknown as Element,
        }))
        return analyses
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Create a new analysis
   * @param elementId - The ID of the element to create the analysis in
   * @param name - The name of the analysis to create
   * @param description - The description of the analysis to create
   * @param analysisClassId - The ID of the class to create the analysis in
   * @returns The created analysis or null if the element ID, name, description or analysis class ID is invalid
   */
  createAnalysis = async (
    { elementId, name, description, type, category, analysisClassId }:
    { elementId: string, name: string, description: string, type?: string, category?: string, analysisClassId: string }
  ): Promise<Analysis | null> => {
    try {
      const response = await this.dtUtils.performMutation<Analysis[]>({
        mutation: CREATE_ANALYSIS,
        variables: { elementId, name, description, type: type || '', category: category || '', analysisClassId },
        dataPath: 'createAnalyses.analyses',
        action: 'createAnalysis',
        deduplicationKey: `create-analysis-${elementId}-${name}-${analysisClassId}`
      })
      
      if (response && response.length > 0) {
        const analysis = response[0]
        return {
          ...analysis,
          analysisClass: analysis.analysisClass && Array.isArray(analysis.analysisClass) && analysis.analysisClass.length > 0
            ? { id: analysis.analysisClass[0].id, name: analysis.analysisClass[0].name }
            : { id: analysis.analysisClass?.id || '', name: analysis.analysisClass?.name || '' },
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete an analysis
   * @param analysisId - The ID of the analysis to delete
   * @returns True if the analysis was deleted, false otherwise
   */
  deleteAnalysis = async ({ analysisId }: { analysisId: string }): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<boolean>({
        mutation: DELETE_ANALYSIS,
        variables: { analysisId },
        dataPath: '',
        action: 'deleteAnalysis',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      return Boolean(response)
    } catch (error) {
      return false
    }
  }

  updateAnalysis = async (
    { analysisId, name, description, type, category }:
    { analysisId: string, name: string, description: string, type?: string, category?: string }
  ): Promise<Analysis | null> => {
    const mutexKey = `updateAnalysis_${analysisId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const input = {
          name: { set: name },
          description: { set: description },
          type: { set: type },
          category: { set: category },
        }
        const response = await this.dtUtils.performMutation<Analysis[]>({
          mutation: UPDATE_ANALYSIS,
          variables: { analysisId, input },
          dataPath: 'updateAnalyses.analyses',
          action: 'updateAnalysis',
          deduplicationKey: `update-analysis-${analysisId}`
        })

        if (response && response.length > 0) {
          return {
            ...response[0],
            analysisClass: response[0].analysisClass && Array.isArray(response[0].analysisClass) && response[0].analysisClass.length > 0
              ? { id: response[0].analysisClass[0].id, name: response[0].analysisClass[0].name }
              : { id: response[0].analysisClass?.id || '', name: response[0].analysisClass?.name || '' },
          }
        }
        return null
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateAnalysis', error })
        return null
      }
    })
  }

  /**
   * Run an analysis
   * @param analysisId - The ID of the analysis to run
   * @returns The ID of the analysis thread or null if the analysis ID is invalid
   */
  runAnalysis = async (
    { analysisId, additionalParams }:
    { analysisId: string | undefined, additionalParams?: object | undefined }):
  Promise<string | null> => {
    if (!analysisId) return null
    
    try {
      const variables = { analysisId, additionalParams: additionalParams || {} }
      const response = await this.dtUtils.performMutation<{ sessionId: string }>({
        mutation: RUN_ANALYSIS,
        variables: variables,
        dataPath: 'runAnalysis',
        action: 'runAnalysis',
        deduplicationKey: false // Don't deduplicate run operations
      })
      
      return response?.sessionId || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Resume an analysis
   * @param analysisId - The ID of the analysis to resume
   * @param userInput - The user input to resume the analysis with
   * @returns The ID of the analysis thread or null if the analysis ID or user input is invalid
   */
  resumeAnalysis = async (
    { analysisId, userInput }:
    { analysisId: string | undefined, userInput: string | undefined }):
  Promise<string | null> => {
    if (!analysisId || !userInput) return null
    
    try {
      const response = await this.dtUtils.performMutation<{ sessionId: string }>({
        mutation: RESUME_ANALYSIS,
        variables: { analysisId, userInput },
        dataPath: 'resumeAnalysis',
        action: 'resumeAnalysis',
        deduplicationKey: false // Don't deduplicate resume operations
      })
      
      return response?.sessionId || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Get the values of an analysis
   * @param analysisId - The ID of the analysis to get the values of
   * @param valueKey - The key of the value to get
   * @returns The values of the analysis or null if the analysis ID or value key is invalid
   */
  getAnalysisValues = async (
    { analysisId, valueKey }:
    { analysisId: string, valueKey: string }
  ): Promise<object | null> => {
    if (!analysisId || !valueKey) return null
    
    try {
      const response = await this.dtUtils.performQuery<{ getAnalysisValues: object }>({
        query: GET_ANALYSIS_VALUES,
        variables: { analysisId, valueKey },
        action: 'getAnalysisValues',
        fetchPolicy: 'network-only'
      })
      
      return response.getAnalysisValues || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Subscribe to analysis response
   * @param sessionId - The ID of the session to subscribe to
   * @returns The subscription or null if the session ID is invalid
   */
  subscribeToStream = (
    { sessionId }: { sessionId: string }):
  Observable<FetchResult<any>> | null => {
    try {
      console.debug('[DtAnalysis] Subscribing to analysis stream with sessionId:', sessionId)
      const subscription = this.apolloClient.subscribe({
        query: SUBSCRIBE_TO_STREAM,
        variables: { sessionId },
        fetchPolicy: 'network-only',
      })
      return subscription || null
    } catch (error) {
      this.dtUtils.handleError({ action: 'subscribeToStream', error })
      return null
    }
  }

  getDocument = async ({ analysisId, filter }: { analysisId: string, filter: object }): Promise<object | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ getDocument: object }>({
        query: GET_DOCUMENT,
        variables: { analysisId, filter },
        action: 'getDocument',
        fetchPolicy: 'network-only'
      })
      
      return response.getDocument || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Start a chat
   * @param analysisId - The ID of the analysis to start the chat for
   * @param userQuestion - The user question to start the chat with
   * @returns The session ID or null if the analysis ID or user question is invalid
   */
  startChat = async (
    { analysisId, userQuestion }:
    { analysisId: string, userQuestion: string }):
  Promise<{ sessionId: string } | null> => {
    try {
      const response = await this.dtUtils.performMutation<{ sessionId: string }>({
        mutation: START_ANALYSIS_CHAT,
        variables: { analysisId, userQuestion },
        dataPath: 'startChat',
        action: 'startChat',
        deduplicationKey: false // Don't deduplicate chat operations
      })
      
      return response || null
    } catch (error) {
      throw error
    }
  }
}
