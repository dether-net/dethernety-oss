import { DtUtils } from '../dt-utils/dt-utils.js'
import { linkInput, LinkBaselines } from '../dt-utils/link-delta.js'
import { assertConnectId } from '../dt-utils/connect-id.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { ComponentData, DataItem, Model } from '../interfaces/core-types-interface.js'
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
        // Asset-context crown-jewel flag: set on the fresh node only when the
        // caller asserts it (undefined → omitted → platform default null/false).
        crownJewel: newNode.data?.crownJewel === true ? true : undefined,
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
    { updatedNode, defaultBoundaryId, baselineLinks }:
    { updatedNode: Node, defaultBoundaryId: string, baselineLinks?: LinkBaselines }
  ): Promise<ComponentData | null> => {
    try {
      // Asset-context crown-jewel: REPLACE only when the caller explicitly sets
      // it on the node. Follow-up updates (controls / data-item association in
      // dt-import & dt-update) build nodes without `crownJewel`, so this guard
      // keeps them from clobbering a flag set at create time. The primary
      // structure update always sets it (true/false) → true two-way replace.
      const crownJewelInput = updatedNode.data?.crownJewel !== undefined
        ? { crownJewel: { set: updatedNode.data.crownJewel === true } }
        : {}
      const controlsInput = linkInput(updatedNode.data?.controls, baselineLinks, 'controls')
      const dataItemsInput = linkInput(updatedNode.data?.dataItems, baselineLinks, 'dataItems')
      // EVERY field is gated on being defined on the node, the way crownJewel above and
      // controls/dataItems below already are. The contract is one sentence: a field the node does not
      // define is not written. That is what lets a caller send only what the user edited, instead of
      // the whole component as it last loaded it — and it is what stops one person's save from
      // rewriting a field somebody else changed in the meantime.
      const variables = {
        componentId: updatedNode.id,
        input: {
          ...(updatedNode.data?.label !== undefined && { name: { set: updatedNode.data.label } }),
          ...(updatedNode.data?.description !== undefined && { description: { set: updatedNode.data.description } }),
          // The two axes are ONE edit and are gated together: a node carrying no position at all would
          // otherwise throw on `.x`. Reading the axes inside the guard is what makes that safe — the
          // object literal is never evaluated when the guard is false.
          ...(updatedNode.position !== undefined && {
            positionX: { set: updatedNode.position.x },
            positionY: { set: updatedNode.position.y },
          }),
          ...(updatedNode.type !== undefined && { type: { set: updatedNode.type } }),
          ...crownJewelInput,
          // Gating the parent is NOT optional, and it is not the same kind of guard as the scalars
          // above. `connect` filters on an `eq` built from this value; an undefined one produces a
          // filter with no condition, which matches EVERY boundary — and the disconnect above it has
          // already run unconditionally. So a component whose node does not name a parent would be
          // detached from its own boundary and attached to all of them.
          //
          // An empty parent is the OTHER case, and it is a real edit rather than an absence: it means
          // "put me at the root", which is the default boundary. That only works while the default
          // boundary is known — before it resolves the caller passes an empty id, which matches nothing
          // and would leave the component with no parent at all. There is no correct payload for that,
          // so the write refuses and the caller keeps what it had.
          ...(updatedNode.parentNode !== undefined && {
            parentBoundary: {
              disconnect: {},
              connect: {
                where: {
                  node: {
                    id: {
                      eq: assertConnectId(
                        updatedNode.parentNode === '' ? defaultBoundaryId : updatedNode.parentNode,
                        'parentBoundary',
                      ),
                    },
                  },
                },
              },
            },
          }),
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
