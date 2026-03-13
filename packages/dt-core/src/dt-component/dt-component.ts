import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { ComponentData, Control, DataItem, Model } from '../interfaces/core-types-interface.js'
import { ADD_COMPONENT, UPDATE_COMPONENT, DELETE_COMPONENT, GET_COMPONENT_REPRESENTED_MODEL } from './dt-component-gql.js'
import { Node } from '@vue-flow/core'

export class DtComponent {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Create a component node
   * @param newNode - The new node to create
   * @param classId - The class ID of the new node
   * @param defaultBoundaryId - The default boundary ID
   * @returns The created node or null if the node is not a component
   */
  createComponentNode = async (
    { newNode, classId, defaultBoundaryId }:
    { newNode: Node, classId: string, defaultBoundaryId: string }
  ): Promise<Node | null> => {
    try {
      // For components, parentBoundaryId is required by the API
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
        type: newNode.type,
        x: newNode.position.x,
        y: newNode.position.y,
      }
      
      const createdComponent = await this.dtUtils.performMutation<ComponentData>({
        mutation: ADD_COMPONENT,
        variables,
        dataPath: 'createComponents.components[0]',
        action: 'createComponentNode',
        deduplicationKey: `create-component-${classId}-${newNode.data.label}`
      })
      
      if (createdComponent) {
        newNode.id = createdComponent.id
        return newNode
      }
      return null
    } catch (error) {
      throw error
    }
  }
  
  /**
   * Get the represented model of a component
   * @param componentId - The ID of the component to get the represented model for
   * @returns The represented model of the component
   */
  getComponentRepresentedModel = async ({ componentId }: { componentId: string }): Promise<Model | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ components: Array<{ representedModel: Model[] }> }>({
        query: GET_COMPONENT_REPRESENTED_MODEL,
        variables: { componentId },
        action: 'getComponentRepresentedModel',
        fetchPolicy: 'network-only'
      })
      
      return response.components?.[0]?.representedModel?.[0] || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a component node
   * @param updatedNode - The updated node
   * @param defaultBoundaryId - The default boundary ID
   * @returns The updated node or null if the node is not a component
   */
  updateComponent = async (
    { updatedNode, defaultBoundaryId }:
    { updatedNode: Node, defaultBoundaryId: string }
  ): Promise<ComponentData | null> => {
    try {
      const variables = {
        componentId: updatedNode.id,
        input: {
          name: { set: updatedNode.data.label },
          description: { set: updatedNode.data.description },
          positionX: { set: updatedNode.position.x },
          positionY: { set: updatedNode.position.y },
          type: { set: updatedNode.type },
          parentBoundary: {
            disconnect: {},
            connect: {
              where: {
                node: { id: { eq: updatedNode.parentNode === '' ? defaultBoundaryId: updatedNode.parentNode } },
              },
            },
          },
          controls: {
            disconnect: updatedNode.data.controls === undefined ? {} : {
              where: {
                NOT: {
                  OR: updatedNode.data.controls.map((control: Control) => ({
                    node: { id: { eq: control } },
                  })),
                },
              },
            },
            connect: updatedNode.data.controls === undefined ? [] : updatedNode.data.controls.map((control: Control) => ({
              where: { node: { id: { eq: control } } },
            })),
          },
          dataItems: {
            disconnect: updatedNode.data.dataItems === undefined ? {} : {
              where: {
                NOT: {
                  OR: updatedNode.data.dataItems.map((dataItem: DataItem) => ({
                    node: { id: { eq: dataItem } },
                  })),
                },
              },
            },
            connect: updatedNode.data.dataItems === undefined ? [] : updatedNode.data.dataItems.map((dataItem: DataItem) => ({
              where: { node: { id: { eq: dataItem } } },
            })),
          },
        },
      }
      
      const result = await this.dtUtils.performMutation<ComponentData>({
        mutation: UPDATE_COMPONENT,
        variables,
        dataPath: 'updateComponents.components[0]',
        action: 'updateComponentNode',
        deduplicationKey: `update-component-${updatedNode.id}`
      })
      
      if (result) {
        const updatedComponent = {
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
        return updatedComponent
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update the class of a component node
   * @param componentId - The ID of the component node
   * @param classId - The ID of the class to update the component node to
   * @returns True if the class was updated, false otherwise
   */
  updateComponentClass = async (
    { componentId, classId }:
    { componentId: string, classId: string }
  ): Promise<boolean> => {
    const mutexKey = `updateComponentClass_${componentId}_${classId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
      const variables = {
        componentId,
        input: {
          componentClass: {
            disconnect: {},
            connect: { where: { node: { id: { eq: classId } } } },
          },
          representedModel: {
            disconnect: {},
          },
        },
      }
      const updatednode = await this.dtUtils.performMutation<ComponentData>({
        mutation: UPDATE_COMPONENT,
        variables,
        dataPath: 'updateComponents.components[0]',
        action: 'updateComponentClass',
      })
      if (updatednode) {
        return true
      }
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateComponentClass', error })
      }
      return false
    })
  }

  /**
   * Update the represented model of a component node
   * @param componentId - The ID of the component node
   * @param modelId - The ID of the model to represent
   * @returns True if the represented model was updated, false otherwise
   */
  updateComponentRepresentedModel = async (
    { componentId, modelId }:
    { componentId: string, modelId: string }
  ): Promise<boolean> => {
    const mutexKey = `updateComponentRepresentedModel_${componentId}_${modelId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
      const variables = {
        componentId,
        input: {
          componentClass: {
            disconnect: {},
          },
          representedModel: {
            disconnect: {},
            connect: { where: { node: { id: { eq: modelId } } } },
          },
        },
      }
      const updatednode = await this.dtUtils.performMutation<ComponentData>({
        mutation: UPDATE_COMPONENT,
        variables,
        dataPath: 'updateComponents.components[0]',
        action: 'updateComponentClass',
      })
      if (updatednode) {
        return true
      }
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateComponentRepresentedModel', error })
      }
      return false
    })
  }

  /**
   * Delete a component node
   * @param componentId - The ID of the component node
   * @returns True if the component node was deleted, false otherwise
   */
  deleteComponent= async ({ componentId }: { componentId: string }) => {
    try {
      const variables = { componentId }
      const deletedComponent = await this.dtUtils.performMutation<any>({
        mutation: DELETE_COMPONENT,
        variables,
        dataPath: 'deleteComponents',
        action: 'deleteComponent',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return Boolean(deletedComponent)
    } catch (error) {
      return false
    }
  }
}
