import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { DataItem } from '../interfaces/core-types-interface.js'
import { ADD_DATA_ITEM, UPDATE_DATA_ITEM, DELETE_DATA_ITEM } from './dt-dataitem-gql.js'
export class DtDataItem {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Create a new data item
   * @param name - The name of the data item
   * @param description - The description of the data item
   * @param classId - The ID of the class of the data item
   * @param elementId - The ID of the element of the data item
   * @param modelId - The ID of the model of the data item
   * @returns The created data item
   */
  createDataItem = async (
    { name, description, classId, elementId, modelId }:
    { name: string, description: string, elementId: string, classId: string | null, modelId: string }
  ): Promise<DataItem | null> => {
    try {
      const variables = {
        input: [{
          name,
          description,
          model: {
            connect: {
              where: {
                node: { id: { eq: modelId } },
              },
            },
          },
          component: {
            connect: {
              where: {
                node: { id: { eq: elementId } },
              },
            },
          },
          dataFlow: {
            connect: {
              where: {
                node: { id: { eq: elementId } },
              },
            },
          },
          securityBoundary: {
            connect: {
              where: {
                node: { id: { eq: elementId } },
              },
            },
          },
          // elements: {
          //   connect: {
          //     where: {
          //       node: { id: { eq: elementId } }
          //     }
          //   }
          // },
          dataClass: classId ? {
            connect: {
              where: {
                node: { id: { eq: classId } },
              },
            },
          } : {},
        }],
      }
      
      const result = await this.dtUtils.performMutation<DataItem>({
        mutation: ADD_DATA_ITEM,
        variables,
        dataPath: 'createData.data[0]',
        action: 'createDataItem',
        deduplicationKey: `create-dataitem-${elementId}-${name}-${modelId}`
      })
      
      if (result) {
        return {
          ...result,
          dataClass: result.dataClass && Array.isArray(result.dataClass) && result.dataClass.length > 0
            ? result.dataClass[0]
            : result.dataClass,
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a data item
   * @param dataItemId - The ID of the data item to update
   * @param name - The name of the data item
   * @param description - The description of the data item
   * @param classId - The ID of the class of the data item
   * @param attributes - The attributes of the data item
   * @returns The updated data item
   */
  updateDataItem = async (
    { dataItemId, name, description, classId, attributes }:
    { dataItemId: string | null, name: string, description: string, classId?: string | null, attributes?: object }
  ): Promise<DataItem | null> => {
    if (!dataItemId) return null
    
    try {
      const variables = {
        dataId: dataItemId,
        input: {
          name: { set: name },
          description: { set: description },
          dataClass: classId ? {
            disconnect: {},
            connect: {
              where: {
                node: { id: { eq: classId } },
              },
            },
          } : {
            disconnect: {},
          },
        },
      }
      
      const result = await this.dtUtils.performMutation<DataItem>({
        mutation: UPDATE_DATA_ITEM,
        variables,
        dataPath: 'updateData.data[0]',
        action: 'updateDataItem',
        deduplicationKey: `update-dataitem-${dataItemId}`
      })
      
      if (result) {
        return {
          ...result,
          dataClass: result.dataClass && Array.isArray(result.dataClass) && result.dataClass.length > 0
            ? result.dataClass[0]
            : result.dataClass,
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a data item
   * @param dataItemId - The ID of the data item to delete
   * @returns True if the data item was deleted, false otherwise
   */
  deleteDataItem = async ({ dataItemId }: { dataItemId: string }): Promise<boolean> => {
    try {
      const variables = { dataId: dataItemId }
      const result = await this.dtUtils.performMutation<any>({
        mutation: DELETE_DATA_ITEM,
        variables,
        dataPath: '',
        action: 'deleteDataItem',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return Boolean(result)
    } catch (error) {
      return false
    }
  }

}