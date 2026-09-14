import { DtUtils } from '../dt-utils/dt-utils.js'
import { linkInput, LinkBaselines } from '../dt-utils/link-delta.js'
import { assertConnectId } from '../dt-utils/connect-id.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { DataFlowData, DataItem } from '../interfaces/core-types-interface.js'
import { Edge } from '@vue-flow/core'
import { ADD_DATA_FLOW, UPDATE_DATA_FLOW, DELETE_DATA_FLOW } from './dt-dataflow-gql.js'

export class DtDataflow {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
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
        // Key on the client edge id when present (each drawn/imported edge is unique);
        // fall back to topology+handles+label so distinct parallel edges between the
        // same pair+class don't collapse into one create. A genuine double-submit of
        // the same edge still shares an identity and dedups. (MERGE-by-client-id
        // is a separate, future change.)
        deduplicationKey: `create-dataflow-${newEdge.id || `${newEdge.source}-${newEdge.target}-${newEdge.sourceHandle ?? ''}-${newEdge.targetHandle ?? ''}-${newEdge.label ?? ''}`}-${classId}`
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
  updateDataFlow = async (
    { edge, updates, baselineLinks }:
    { edge: Edge, updates: object, baselineLinks?: LinkBaselines }
  ): Promise<DataFlowData | null> => {
    try {
      this.dtUtils.deepMerge(edge, updates)
      const controlsInput = linkInput(edge.data?.controls, baselineLinks, 'controls')
      const dataItemsInput = linkInput(edge.data?.dataItems, baselineLinks, 'dataItems')
      const variables = {
        dataFlowId: edge.id,
        input: {
          // Gated exactly like controls/dataItems below, and for the same reason extended to the whole
          // input: a field the edge does not define is not written, so a caller can send only what the
          // user edited instead of the flow as it last loaded it.
          ...(edge.label !== undefined && { name: { set: edge.label } }),
          ...(edge.data?.description !== undefined && { description: { set: edge.data.description } }),
          // The endpoints are gated because an undefined one is not "no change" — `connect` filters on
          // an `eq` built from it, and an undefined `eq` is a filter with no condition, matching EVERY
          // node after the unconditional disconnect above has already run. An edge that does not name
          // its endpoints must leave them alone.
          //
          // An endpoint that is named but empty has nowhere to fall back to — unlike a parent boundary
          // there is no root to mean — so it refuses. Writing it would disconnect the real endpoint and
          // connect nothing, leaving a flow that runs from nowhere.
          ...(edge.source !== undefined && {
            source: {
              disconnect: {},
              connect: {
                where: {
                  node: {
                    id: { eq: assertConnectId(edge.source, 'source') },
                  },
                },
              },
            },
          }),
          ...(edge.target !== undefined && {
            target: {
              disconnect: {},
              connect: {
                where: {
                  node: {
                    id: { eq: assertConnectId(edge.target, 'target') },
                  },
                },
              },
            },
          }),
          ...(edge.sourceHandle !== undefined && { sourceHandle: { set: edge.sourceHandle } }),
          ...(edge.targetHandle !== undefined && { targetHandle: { set: edge.targetHandle } }),
          // An absent list omits the key entirely, leaving the association untouched — the conduit and
          // import "safe node" passes rely on this to preserve controls/dataItems.
          //
          // A PRESENT list is written one of two ways, and which one depends on whether the caller told
          // us what the list held before. Without that it can only assert the whole list, so the write
          // is an unconditional disconnect-all then connect — correct for a bulk write, and destructive
          // for two people editing one element, because the second save disconnects what the first just
          // attached. With a baseline the write is the delta instead, and the two saves compose.
          //
          // The disconnect in the REPLACE shape must stay unconditional: `connect` compiles to a bare
          // relationship CREATE, so a disconnect that spares the incoming ids leaves every
          // already-attached pair to be re-created — one extra parallel edge per element per save. It is
          // safe because the translator emits disconnect before connect for the same field.
          ...(controlsInput !== undefined && { controls: controlsInput }),
          ...(dataItemsInput !== undefined && { dataItems: dataItemsInput }),
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
