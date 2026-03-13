
import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { BoundaryData, Control, DataItem, DirectDescendant, Model } from '../interfaces/core-types-interface.js'
import { Node } from '@vue-flow/core'
import { ADD_BOUNDARY, UPDATE_BOUNDARY, GET_DIRECT_DESCENDANTS, DELETE_BOUNDARY, GET_BOUNDARY_REPRESENTED_MODEL } from './dt-boundary-gql.js'

export class DtBoundary {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Create a boundary node
   * @param newNode - The new node to create
   * @param classId - The class ID of the new node
   * @param defaultBoundaryId - The default boundary ID
   * @returns The created node or null if the node is not a boundary
   */
  createBoundaryNode = async (
    { newNode, classId, defaultBoundaryId }:
    { newNode: Node, classId: string, defaultBoundaryId: string }
  ): Promise<Node | null> => {
    try {
      // For boundaries, parentBoundaryId is optional in the API
      let parentId = ''
      if (newNode.parentNode && Array.isArray(newNode.parentNode) && newNode.parentNode.length > 0) {
        parentId = newNode.parentNode[0].id
      } else {
        parentId = defaultBoundaryId
      }

      const variables = {
        parentBoundaryId: parentId,
        classId,
        name: newNode.data.label,
        description: newNode.data.description,
        x: newNode.position.x,
        y: newNode.position.y,
        width: newNode.width,
        height: newNode.height,
      }
      
      const createdBoundary = await this.dtUtils.performMutation<BoundaryData>({
        mutation: ADD_BOUNDARY,
        variables,
        dataPath: 'createSecurityBoundaries.securityBoundaries[0]',
        action: 'createBoundaryNode',
        deduplicationKey: `create-boundary-${classId}-${newNode.data.label}`
      })
      
      if (createdBoundary) {
        newNode.id = createdBoundary.id
        return newNode
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Get the represented model of a boundary
   * @param boundaryId - The ID of the boundary to get the represented model for
   * @returns The represented model of the boundary
   */
  getBoundaryRepresentedModel = async ({ boundaryId }: { boundaryId: string }): Promise<Model | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ securityBoundaries: Array<{ representedModel: Model[] }> }>({
        query: GET_BOUNDARY_REPRESENTED_MODEL,
        variables: { boundaryId },
        action: 'getBoundaryRepresentedModel',
        fetchPolicy: 'network-only'
      })
      
      const result = response.securityBoundaries?.[0]?.representedModel?.[0]
      return result || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a boundary node
   * @param updatedNode - The updated node
   * @param defaultBoundaryId - The default boundary ID
   * @returns The updated node or null if the node is not a boundary
   */
  updateBoundaryNode = async (
    { updatedNode, defaultBoundaryId }:
    { updatedNode: Node, defaultBoundaryId: string }
  ): Promise<BoundaryData | null> => {
    try {
      let parentBoundaryInput = undefined
      if (updatedNode.id === defaultBoundaryId || updatedNode.parentNode === undefined) {
        parentBoundaryInput = undefined
      } else {
        parentBoundaryInput = {
          disconnect: {},
          connect: {
            where: {
              node: {
                id: { eq: updatedNode.parentNode === '' ? defaultBoundaryId: updatedNode.parentNode },
              },
            },
          },
        }
      }
      
      const variables = {
        boundaryId: updatedNode.id,
        input: {
          name: { set: updatedNode.data.label },
          description: { set: updatedNode.data.description },
          positionX: { set: updatedNode.position.x },
          positionY: { set: updatedNode.position.y },
          dimensionsWidth: { set: updatedNode.width },
          dimensionsHeight: { set: updatedNode.height },
          dimensionsMinWidth: { set: updatedNode.data.minWidth },
          dimensionsMinHeight: { set: updatedNode.data.minHeight },
          ...(parentBoundaryInput !== undefined && { parentBoundary: parentBoundaryInput }),
          controls: {
            disconnect: updatedNode.data.controls === undefined ? {} : {},
            connect: updatedNode.data.controls === undefined ? [] : updatedNode.data.controls.map((control: Control) => ({
              where: { node: { id: { eq: control } } },
            })),
          },
          dataItems: {
            disconnect: updatedNode.data.dataItems === undefined ? {} : {},
            connect: updatedNode.data.dataItems === undefined ? [] : updatedNode.data.dataItems.map((dataItem: DataItem) => ({
              where: { node: { id: { eq: dataItem } } },
            })),
          },
        },
      }
      
      const result = await this.dtUtils.performMutation<BoundaryData>({
        mutation: UPDATE_BOUNDARY,
        variables,
        dataPath: 'updateSecurityBoundaries.securityBoundaries[0]',
        action: 'updateBoundaryNode',
        deduplicationKey: `update-boundary-${updatedNode.id}`
      })
      
      if (result) {
        const updatedBoundary = {
          ...result,
          parentBoundary: result.parentBoundary && Array.isArray(result.parentBoundary) && result.parentBoundary.length > 0
            ? { id: result.parentBoundary[0].id }
            : { id: defaultBoundaryId },
          dataItems: result.dataItems?.map((dataItem: DataItem) => ({
            ...dataItem,
            dataClass: Array.isArray(dataItem.dataClass) && dataItem.dataClass.length > 0
              ? dataItem.dataClass[0]
              : dataItem.dataClass,
          })),
        }
        return updatedBoundary
      }
      return null
    } catch (error) {
      throw error
    }
  }


  /**
   * Update the represented model of a boundary node
   * @param boundaryId - The ID of the boundary node
   * @param modelId - The ID of the model to represent
   * @returns True if the represented model was updated, false otherwise
   */
  updateBoundaryRepresentedModel = async (
    { boundaryId, modelId }:
    { boundaryId: string, modelId: string }
  ): Promise<boolean> => {
    const mutexKey = `updateBoundaryRepresentedModel_${boundaryId}_${modelId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
      const variables = {
        boundaryId,
        input: {
          securityBoundaryClass: {
            disconnect: {},
          },
          representedModel: {
            disconnect: {},
            connect: { where: { node: { id: { eq: modelId } } } },
          },
        },
      }
      const result = await this.dtUtils.performMutation<BoundaryData>({
        mutation: UPDATE_BOUNDARY,
        variables,
        dataPath: 'updateSecurityBoundaries.securityBoundaries[0]',
        action: 'updateBoundaryRepresentedModel',
      })
      if (result) {
        return true
      }
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateBoundaryRepresentedModel', error })
      }
      return false
    })
  }

  /**
   * Update the class of a boundary node
   * @param boundaryId - The ID of the boundary node
   * @param classId - The ID of the class to update the boundary node to
   * @returns True if the class was updated, false otherwise
   */
  updateBoundaryClass = async (
    { boundaryId, classId }:
    { boundaryId: string, classId: string }
  ): Promise<boolean> => {
    const mutexKey = `updateBoundaryClass_${boundaryId}_${classId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
      const variables = {
        boundaryId,
        input: {
          securityBoundaryClass: {
            disconnect: {},
            connect: { where: { node: { id: { eq: classId } } } },
          },
          representedModel: {
            disconnect: {},
          },
        },
      }
      const updatednode = await this.dtUtils.performMutation<BoundaryData>({
        mutation: UPDATE_BOUNDARY,
        variables,
        dataPath: 'updateSecurityBoundaries.securityBoundaries[0]',
        action: 'updateBoundaryClass',
      })
      if (updatednode) {
        return true
      }
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateBoundaryClass', error })
      }
      return false
    })
  }

  /**
   * Get the descendants of a boundary node
   * @param boundaryId - The ID of the boundary node
   * @returns The descendants of the boundary node or null if the node is not a boundary
   */
  getDescendants = async (
    { boundaryId }: { boundaryId: string }
  ): Promise<{ components: DirectDescendant[], securityBoundaries: DirectDescendant[] } | null> => {
    try {
      // Fetch direct descendants of the boundary being deleted
      const response = await this.dtUtils.performQuery<{ components: DirectDescendant[], securityBoundaries: DirectDescendant[] }>({
        query: GET_DIRECT_DESCENDANTS,
        variables: { parentId: boundaryId },
        action: 'getDescendants',
        fetchPolicy: 'network-only'
      })

      if (response) {
        const components: DirectDescendant[] = response.components.map((component: DirectDescendant) => ({
          ...component,
          parentBoundary: component.parentBoundary && Array.isArray(component.parentBoundary) && component.parentBoundary.length > 0
            ? {
              ...component.parentBoundary[0],
              parentBoundary: component.parentBoundary[0].parentBoundary && Array.isArray(component.parentBoundary[0].parentBoundary) && component.parentBoundary[0].parentBoundary.length > 0
                ? component.parentBoundary[0].parentBoundary[0]
                : undefined,
            }
            : component.parentBoundary
        }))
        const securityBoundaries: DirectDescendant[] = response.securityBoundaries.map((securityBoundary: DirectDescendant) => ({
          ...securityBoundary,
          parentBoundary: securityBoundary.parentBoundary && Array.isArray(securityBoundary.parentBoundary) && securityBoundary.parentBoundary.length > 0
            ? {
              ...securityBoundary.parentBoundary[0],
              parentBoundary: securityBoundary.parentBoundary[0].parentBoundary && Array.isArray(securityBoundary.parentBoundary[0].parentBoundary) && securityBoundary.parentBoundary[0].parentBoundary.length > 0
                ? securityBoundary.parentBoundary[0].parentBoundary[0]
                : undefined,
            }
            : securityBoundary.parentBoundary,
        }))
        return { components, securityBoundaries }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a boundary node
   * @param boundaryId - The ID of the boundary node
   * @returns True if the boundary node was deleted, false otherwise
   */
  deleteBoundary = async ({ boundaryId }: { boundaryId: string }): Promise<boolean> => {
    try {
      const variables = { boundaryId }
      const result = await this.dtUtils.performMutation<any>({
        mutation: DELETE_BOUNDARY,
        variables,
        dataPath: '',
        action: 'deleteBoundary',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return Boolean(result)
    } catch (error) {
      return false
    }
  }
}
