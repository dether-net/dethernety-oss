import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { Exposure } from '../interfaces/core-types-interface.js'
import { GET_EXPOSURES, GET_EXPOSURE, ADD_EXPOSURE, UPDATE_EXPOSURE, DELETE_EXPOSURE } from './dt-exposure-gql.js'

export class DtExposure {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Get all exposures for an element
   * @param elementId - The ID of the element to get exposures for
   * @returns An array of exposures
   */
  getExposures = async ({ elementId }: { elementId: string }): Promise<Exposure[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ getExposuresForElement: Exposure[] }>({
        query: GET_EXPOSURES,
        variables: { elementId },
        action: 'getExposures',
        fetchPolicy: 'network-only'
      })
      
      return response.getExposuresForElement || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get an exposure by ID
   * @param exposureId - The ID of the exposure to get
   * @returns The exposure
   */
  getExposure = async ({ exposureId }: { exposureId: string }): Promise<Exposure> => {
    const mutexKey = `getExposure_${exposureId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const response = await this.apolloClient.query({
          query: GET_EXPOSURE,
          variables: { exposureId },
          fetchPolicy: 'network-only',
        })
        return response.data.exposures[0]
      } catch (error) {
        this.dtUtils.handleError({ action: 'getExposure', error })
        throw error
      }
    })
  }

  /**
   * Create an exposure
   * @param exposure - The exposure to create
   * @param elementId - The ID of the element to create the exposure for
   * @param attackTechniqueIds - The IDs of the attack techniques to connect to the exposure
   * @returns The created exposure
   */
  createExposure = async (
    { exposure, elementId, attackTechniqueIds }:
    { exposure: Exposure, elementId: string, attackTechniqueIds: string[] }
  ): Promise<Exposure> => {
    try {
      const variables = {
        input: {
          name: exposure.name,
          description: exposure.description,
          type: Number.parseInt(exposure.type ?? '0'),
          category: exposure.category,
          score: exposure.score,
          element: {
            connect: { where: { node: { id: { eq: elementId } } } },
          },
          exploitedBy: {
            connect: attackTechniqueIds.map(attackTechniqueId => ({ where: { node: { id: { eq: attackTechniqueId } } } })),
          },
        },
      }
      
      const response = await this.dtUtils.performMutation<Exposure>({
        mutation: ADD_EXPOSURE,
        variables,
        dataPath: 'createExposures.exposures[0]',
        action: 'createExposure',
        deduplicationKey: `create-exposure-${elementId}-${exposure.name}`
      })
      
      return response
    } catch (error) {
      throw error
    }
  }

  /**
   * Update an exposure
   * @param exposureId - The ID of the exposure to update
   * @param exposure - The exposure to update
   * @param attackTechniqueIds - The IDs of the attack techniques to connect to the exposure
   * @returns The updated exposure
   */
  updateExposure = async (
    { exposureId, exposure, attackTechniqueIds }:
    { exposureId: string, exposure: Exposure, attackTechniqueIds: string[] }
  ): Promise<Exposure> => {
    const mutexKey = `updateExposure_${exposureId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const variables = {
          exposureId,
          input: {
            name: exposure.name,
            description: exposure.description,
            type: exposure.type,
            category: exposure.category,
            score: exposure.score,
            exploitedBy: {
              disconnect: {},
              connect: attackTechniqueIds.map(id => ({ where: { node: { id } } })),
            },
          },
        }
        const response = await this.dtUtils.performMutation<Exposure>({
          mutation: UPDATE_EXPOSURE,
          variables,
          dataPath: 'updateExposures.exposures[0]',
          action: 'updateExposure',
        })
        return response
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateExposure', error })
        throw error
      }
    })
  }

  /**
   * Delete an exposure
   * @param exposureId - The ID of the exposure to delete
   * @returns True if the exposure was deleted, false otherwise
   */
  deleteExposure = async ({ exposureId }: { exposureId: string }): Promise<boolean> => {
    const mutexKey = `deleteExposure_${exposureId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const variables = { exposureId }
        const response = await this.dtUtils.performMutation({
          mutation: DELETE_EXPOSURE,
          variables,
          dataPath: 'deleteExposures',
          action: 'deleteExposure',
        })
        if (response) {
          return true
        }
        return false
      } catch (error) {
        this.dtUtils.handleError({ action: 'deleteExposure', error })
        return false
      }
    })
  }
}