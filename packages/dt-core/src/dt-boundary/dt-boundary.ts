
import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { BoundaryData, Control, DataItem, DirectDescendant, Model, Conduit } from '../interfaces/core-types-interface.js'
import { Node } from '@vue-flow/core'
import { ADD_BOUNDARY, UPDATE_BOUNDARY, GET_DIRECT_DESCENDANTS, DELETE_BOUNDARY, GET_BOUNDARY_REPRESENTED_MODEL } from './dt-boundary-gql.js'
import { sanitizeZone, sanitizeDomains, normalizePlanes, buildConduitOps, flattenConduits } from './boundary-zoning-utils.js'

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
    { updatedNode, defaultBoundaryId, baselineConduits = [] }:
    { updatedNode: Node, defaultBoundaryId: string, baselineConduits?: Conduit[] }
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
      
      // Conduits reconcile only when the buffer is present (undefined = leave edges untouched,
      // mirroring controls/dataItems). Membership is a baseline-driven delta — `connect` is NOT
      // idempotent for CONDUIT (re-connecting an existing peer duplicates the edge), so we connect
      // only added peers, disconnect only removed, and `update` only changed-justification peers.
      const conduitsBuf: Conduit[] | undefined = updatedNode.data.conduits
      const outboundOps = conduitsBuf === undefined
        ? undefined
        : buildConduitOps('OUTBOUND', conduitsBuf, baselineConduits, updatedNode.id)
      const inboundOps = conduitsBuf === undefined
        ? undefined
        : buildConduitOps('INBOUND', conduitsBuf, baselineConduits, updatedNode.id)

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
          // Zoning scalars are partial-update: emit a `{ set }` only when the key is present on node.data.
          // An absent key leaves the field untouched (mirrors controls/dataItems/conduits below); a present
          // `null`/`[]` still writes (explicit clear/inherit). This protects callers that rebuild node.data
          // without zoning (the import/update controls & dataItems association passes) from clobbering it.
          ...(updatedNode.data.zone !== undefined && { zone: { set: sanitizeZone(updatedNode.data.zone ?? null) } }),
          ...(updatedNode.data.domains !== undefined && { domains: { set: sanitizeDomains(updatedNode.data.domains) } }),
          // `planes` is a `[String!]` field (NOT a GraphQL enum): @neo4j/graphql v7 generates a broken
          // enum-list mutation input (both `set` and `push` required, resolver forbids both), so the enum
          // form was unwritable. Stored as String, the values stay constrained to the `Plane` union by
          // `normalizePlanes` (app-side validation). Same shape as `domains`.
          ...(updatedNode.data.planes !== undefined && { planes: { set: normalizePlanes(updatedNode.data.planes) } }),
          ...(outboundOps !== undefined && { outboundConduits: outboundOps }),
          ...(inboundOps !== undefined && { inboundConduits: inboundOps }),
          ...(parentBoundaryInput !== undefined && { parentBoundary: parentBoundaryInput }),
          // Guard the whole relationship key like the zoning scalars above: an
          // absent field (undefined) omits it entirely, leaving the association
          // untouched — the conduit/import "safe node" passes rely on this to
          // preserve controls/dataItems. A PRESENT
          // array REPLACEs, via an unconditional disconnect-all then connect.
          //
          // The disconnect MUST stay unconditional. `connect` compiles to a bare
          // relationship CREATE, so a disconnect that spares the incoming ids
          // leaves every already-attached pair to be re-created — one extra
          // parallel edge per element per save. Disconnect-all is safe because
          // the translator emits disconnect before connect for the same field,
          // and it also collapses duplicates already on disk.
          ...(updatedNode.data.controls !== undefined && {
            controls: {
              disconnect: {},
              connect: updatedNode.data.controls.map((control: Control) => ({
                where: { node: { id: { eq: control } } },
              })),
            },
          }),
          ...(updatedNode.data.dataItems !== undefined && {
            dataItems: {
              disconnect: {},
              connect: updatedNode.data.dataItems.map((dataItem: DataItem) => ({
                where: { node: { id: { eq: dataItem } } },
              })),
            },
          }),
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
          // Re-derive the flattened conduits from the server response so the store can re-pin its
          // baseline to server truth after the reconcile.
          conduits: flattenConduits(result),
        }
        return updatedBoundary
      }
      return null
    } catch (error) {
      throw error
    }
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
