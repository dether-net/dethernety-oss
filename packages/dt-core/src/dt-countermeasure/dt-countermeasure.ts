import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { Countermeasure } from '../interfaces/core-types-interface.js'
import { CREATE_COUNTERMEASURE, GET_COUNTERMEASURES_FROM_CONTROL, GET_COUNTERMEASURE, UPDATE_COUNTERMEASURE, DELETE_COUNTERMEASURE } from './dt-countermeasure-gql.js'

export class DtCountermeasure {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Get all countermeasures from a control
   * @param controlId - The ID of the control
   * @returns An array of countermeasures or null if an error occurs
   */
  getCountermeasuresFromControl = async (
    { controlId }: { controlId: string }
  ): Promise<Countermeasure[] | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ controls: Array<{ countermeasures: Countermeasure[] }> }>({
        query: GET_COUNTERMEASURES_FROM_CONTROL,
        variables: { controlId },
        action: 'getCountermeasuresFromControl',
        fetchPolicy: 'network-only'
      })
      
      if (response.controls && response.controls[0]?.countermeasures) {
        return response.controls[0].countermeasures
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a countermeasure by ID
   * @param countermeasureId - The ID of the countermeasure
   * @returns The countermeasure or null if an error occurs
   */
  getCountermeasure = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<Countermeasure | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ countermeasures: Countermeasure[] }>({
        query: GET_COUNTERMEASURE,
        variables: { countermeasureId },
        action: 'getCountermeasure',
        fetchPolicy: 'network-only'
      })
      
      if (response.countermeasures && response.countermeasures.length > 0) {
        return response.countermeasures[0]
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Create a countermeasure
   * @param controlId - The ID of the control
   * @param countermeasure - The countermeasure to create
   * @returns The created countermeasure or false if an error occurs
   */
  createCountermeasure = async (
    { controlId, countermeasure }: { controlId: string, countermeasure: Countermeasure }
  ): Promise<Countermeasure | null> => {
    try {
      const mutuationInput = {
        name: countermeasure.name,
        description: countermeasure.description,
        type: countermeasure.type,
        category: countermeasure.category,
        score: Number(countermeasure.score),
        references: countermeasure.references,
        addressedExposures: countermeasure.addressedExposures,
        control: {
          connect: {
            where: {
              node: { id: controlId },
            },
          },
        },
        defendedTechniques: {
          connect: countermeasure.defendedTechniques?.map(technique => ({
            where: {
              node: { id: technique.id },
            },
          })),
        },
        mitigations: {
          connect: countermeasure.mitigations?.map(mitigation => ({
            where: {
              node: { id: mitigation.id },
            },
          })),
        },
      }
      
      const createdCountermeasure = await this.dtUtils.performMutation<Countermeasure>({
        mutation: CREATE_COUNTERMEASURE,
        variables: { input: [mutuationInput] },
        dataPath: 'createCountermeasures.countermeasures[0]',
        action: 'createCountermeasure',
        deduplicationKey: `create-countermeasure-${controlId}-${countermeasure.name}`
      })
      
      return createdCountermeasure || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a countermeasure
   * @param countermeasureId - The ID of the countermeasure
   * @param countermeasure - The countermeasure to update
   * @returns The updated countermeasure or false if an error occurs
   */
  updateCountermeasure = async (
    { countermeasureId, countermeasure }: { countermeasureId: string, countermeasure: Countermeasure }
  ): Promise<Countermeasure | null> => {
    try {
      const mutuationInput = {
        name: countermeasure.name,
        description: countermeasure.description,
        type: countermeasure.type,
        category: countermeasure.category,
        score: Number(countermeasure.score),
        references: countermeasure.references,
        addressedExposures: countermeasure.addressedExposures,
        mitigations: {
          disconnect: {},
          connect: countermeasure.mitigations?.map(mitigation => ({
            where: { node: { id: mitigation.id } },
          })),
        },
        defendedTechniques: {
          disconnect: {},
          connect: countermeasure.defendedTechniques?.map(technique => ({
            where: { node: { id: technique.id } },
          })),
        },
      }
      
      const updatedCountermeasure = await this.dtUtils.performMutation<Countermeasure>({
        mutation: UPDATE_COUNTERMEASURE,
        variables: { countermeasureId, input: mutuationInput },
        dataPath: 'updateCountermeasures.countermeasures[0]',
        action: 'updateCountermeasure',
        deduplicationKey: `update-countermeasure-${countermeasureId}`
      })
      
      return updatedCountermeasure || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a countermeasure
   * @param countermeasureId - The ID of the countermeasure
   * @returns True if the countermeasure was deleted, false otherwise
   */
  deleteCountermeasure = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<any>({
        mutation: DELETE_COUNTERMEASURE,
        variables: { countermeasureId },
        dataPath: 'deleteCountermeasures',
        action: 'deleteCountermeasure',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return Boolean(response)
    } catch (error) {
      return false
    }
  }
}
