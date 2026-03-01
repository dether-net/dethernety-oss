import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { DataFlowData, Control, DataItem } from '../interfaces/core-types-interface.js'
import { Edge } from '@vue-flow/core'
import { ADD_DATA_FLOW, UPDATE_DATA_FLOW, DELETE_DATA_FLOW } from './dt-dataflow-gql.js'

export class DtDataflow {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Create a data flow
   * @param newEdge - The new edge to create
   * @param classId - The class ID of the new edge
   * @returns The created edge or null if the edge is not a data flow
   */
  createDataFlow = async ({ newEdge, classId }: { newEdge: Edge, classId: string }): Promise<Edge | null> => {
    try {
      const variables = {
        name: newEdge.label,
        description: newEdge.data.description,
        classId,
        source: newEdge.source,
        target: newEdge.target,
        sourceHandle: newEdge.sourceHandle,
        targetHandle: newEdge.targetHandle,
      }
      
      const createdDataFlow = await this.dtUtils.performMutation<DataFlowData>({
        mutation: ADD_DATA_FLOW,
        variables,
        dataPath: 'createDataFlows.dataFlows[0]',
        action: 'createDataFlow',
        deduplicationKey: `create-dataflow-${newEdge.source}-${newEdge.target}-${classId}`
      })
      
      if (createdDataFlow) {
        newEdge.id = createdDataFlow.id
        return newEdge
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a data flow
   * @param edge - The edge to update
   * @param updates - The updates to apply to the edge
   * @returns The updated edge or null if the edge is not a data flow
   */
  updateDataFlow = async ({ edge, updates }: { edge: Edge, updates: object }): Promise<DataFlowData | null> => {
    try {
      this.dtUtils.deepMerge(edge, updates)
      const variables = {
        dataFlowId: edge.id,
        input: {
          name: { set: edge.label },
          description: { set: edge.data.description },
          source: {
            disconnect: {},
            connect: {
              where: {
                node: {
                  id: { eq: edge.source },
                },
              },
            },
          },
          target: {
            disconnect: {},
            connect: {
              where: {
                node: {
                  id: { eq: edge.target },
                },
              },
            },
          },
          sourceHandle: { set: edge.sourceHandle },
          targetHandle: { set: edge.targetHandle },
          controls: {
            disconnect: edge.data.controls === undefined ? {} : {},
            connect: edge.data.controls === undefined ? [] : edge.data.controls.map((control: Control) => ({
              where: { node: { id: { eq: control } } },
            })),
          },
          dataItems: {
            disconnect: edge.data.dataItems === undefined ? {} : {},
            connect: edge.data.dataItems === undefined ? [] : edge.data.dataItems.map((dataItem: DataItem) => ({
              where: { node: { id: { eq: dataItem } } },
            })),
          },
        },
      }
      
      const result = await this.dtUtils.performMutation<DataFlowData>({
        mutation: UPDATE_DATA_FLOW,
        variables,
        dataPath: 'updateDataFlows.dataFlows[0]',
        action: 'updateDataFlow',
        deduplicationKey: `update-dataflow-${edge.id}`
      })
      
      if (result) {
        const updatedDataFlow = {
          ...result,
          source: result.source && Array.isArray(result.source) && result.source.length > 0
            ? result.source[0]
            : result.source,
          target: result.target && Array.isArray(result.target) && result.target.length > 0
            ? result.target[0]
            : result.target,
          dataItems: result.dataItems?.map((dataItem: DataItem) => ({
            ...dataItem,
            dataClass: Array.isArray(dataItem.dataClass) && dataItem.dataClass.length > 0
              ? dataItem.dataClass[0]
              : dataItem.dataClass,
          })),
        }
        return updatedDataFlow
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update the class of a data flow
   * @param dataFlowId - The ID of the data flow
   * @param classId - The ID of the class to update the data flow to
   * @returns True if the class was updated, false otherwise
   */
  updateDataFlowClass = async (
    { dataFlowId, classId }:
    { dataFlowId: string, classId: string }
  ): Promise<boolean> => {
    const mutexKey = `updateDataFlowClass_${dataFlowId}_${classId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const variables = {
          dataFlowId,
          input: {
            dataFlowClass: {
              disconnect: {},
              connect: { where: { node: { id: { eq: classId } } } },
            },
          },
        }
        const updatedDataFlow = await this.dtUtils.performMutation<DataFlowData>({
          mutation: UPDATE_DATA_FLOW,
          variables,
          dataPath: 'updateDataFlows.dataFlows[0]',
          action: 'updateDataFlowClass',
        })
        if (updatedDataFlow) {
          return true
        }
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateDataFlowClass', error })
      }
      return false
    })
  }

  /**
   * Delete a data flow
   * @param dataFlowId - The ID of the data flow to delete
   * @returns True if the data flow was deleted, false otherwise
   */
  deleteDataFlow = async ({ dataFlowId }: { dataFlowId: string }): Promise<boolean> => {
    try {
      const variables = { dataFlowId }
      const result = await this.dtUtils.performMutation<any>({
        mutation: DELETE_DATA_FLOW,
        variables,
        dataPath: 'deleteDataFlows',
        action: 'deleteDataFlow',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return Boolean(result)
    } catch (error) {
      return false
    }
  }

}
