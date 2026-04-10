import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { Class, Control, ControlGapsResult } from '../interfaces/core-types-interface.js'
import {
  CREATE_CONTROL,
  DELETE_CONTROL,
  GET_CONTROLS,
  UPDATE_CONTROL,
  FIND_CONTROLS,
  CONTROL_IDS_BY_ELEMENTS,
  CONTROL_GAPS,
  ASSIGN_CONTROL_TO_ELEMENTS,
} from './dt-control-gql.js'

export class DtControl {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Get all controls
   * @returns An array of controls or null if an error occurs
   */
  getControls = async ({ folderId }: { folderId?: string | undefined }): Promise<Control[]> => {
    try {
      let query = null
      if (folderId) {
        if (folderId === 'all') {
          query = null
        } else {
          query = { folder: { single: { id: { eq: folderId }, }, }, }
        }
      } else {
        query = { folder: { none: null } }
      }
      
      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: GET_CONTROLS,
        variables: { query },
        action: 'getControls',
        fetchPolicy: 'network-only'
      })
      
      if (response.controls) {
        const controls = response.controls.map((control: Control) => ({
          ...control,
          folder: control.folder && Array.isArray(control.folder) && control.folder.length > 0
            ? control.folder[0]
            : control.folder,
          controlClasses: control.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }))
        return controls
      }
      return []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a control
   * @param controlId - The ID of the control
   * @returns The control or null if an error occurs
   */
  getControl = async ({ controlId }: { controlId: string | undefined }): Promise<Control | null> => {
    if (!controlId) return null

    try {
      const query = { id: { eq: controlId }, }
      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: GET_CONTROLS,
        variables: { query },
        action: 'getControl',
        fetchPolicy: 'network-only'
      })
      
      if (response.controls && response.controls.length > 0) {
        const control = response.controls[0]
        return {
          ...control,
          folder: control.folder && Array.isArray(control.folder) && control.folder.length > 0
            ? control.folder[0]
            : control.folder,
          controlClasses: control.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Create a control
   * @param newControl - The new control
   * @param classIds - The IDs of the classes
   * @returns The created control or null if an error occurs
   */
  createControl = async (
    { newControl, classIds, folderId }:
    { newControl: Control, classIds: string[] | null, folderId: string | undefined }
  ): Promise<Control | null> => {
    try {
      const mutuationInput = {
        name: newControl.name,
        description: newControl.description,
        controlClasses: {
          connect: classIds?.map(classId => ({
            where: {
              node: { id: { eq: classId } },
            },
          })),
        },
        folder: { },
      }
      if (folderId) {
        mutuationInput.folder = {
          connect: {
            where: { node: { id: { eq: folderId } } },
          },
        }
      }
      
      const result = await this.dtUtils.performMutation<Control>({
        mutation: CREATE_CONTROL,
        variables: { input: [mutuationInput] },
        dataPath: 'createControls.controls[0]',
        action: 'createControl',
        deduplicationKey: `create-control-${newControl.name}-${folderId || 'no-folder'}`
      })
      
      if (result) {
        return {
          ...result,
          folder: result.folder && Array.isArray(result.folder) && result.folder.length > 0
            ? result.folder[0]
            : result.folder,
          controlClasses: result.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a control
   * @param controlId - The ID of the control
   * @returns True if the control was deleted, false otherwise
   */
  deleteControl = async ({ controlId }: { controlId: string }): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<{ nodesDeleted: number, relationshipsDeleted: number }>({
        mutation: DELETE_CONTROL,
        variables: { controlId },
        dataPath: 'deleteControls',
        action: 'deleteControl',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      if (response && (response.nodesDeleted > 0 || response.relationshipsDeleted > 0)) {
        return true
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * Update a control
   * @param controlId - The ID of the control
   * @param name - The name of the control
   * @param description - The description of the control
   * @param controlClasses - The IDs of the classes
   * @returns The updated control or null if an error occurs
   */
  updateControl = async (
    { controlId, name, description, controlClasses, folderId }:
    { controlId: string, name: string, description: string, controlClasses: string[], folderId: string | undefined }
  ): Promise<Control | null> => {
    if (!controlId) return null
    
    try {
      const variables = {
        controlId,
        input: {
          name: { set: name },
          description: { set: description },
          controlClasses: {
            disconnect: {
              where: {
                NOT: {
                  OR: controlClasses.map((cls: string) => ({
                    node: { id: { eq: cls } },
                  })),
                },
              },
            },
            connect: controlClasses.map((cls: string) => ({
              where: { node: { id: { eq: cls } } },
            })),
          },
          folder: { },
        },
        countermeasureDeletion: {
          control: {
            some: {
              id: { eq: controlId },
            },
          },
          controlClass: {
            some: {
              NOT: {
                OR: controlClasses.map((cls: string) => ({ id: { eq: cls } })),
              },
            },
          },
        },
      }
      if (folderId) {
        variables.input.folder = {
          disconnect: {},
          connect: {
            where: { node: { id: { eq: folderId } } },
          },
        }
      } else {
        variables.input.folder = {
          disconnect: {},
        }
      }
      
      const result = await this.dtUtils.performMutation<Control>({
        mutation: UPDATE_CONTROL,
        variables,
        dataPath: 'updateControls.controls[0]',
        action: 'updateControl',
        deduplicationKey: `update-control-${controlId}`
      })
      
      if (result) {
        return {
          ...result,
          folder: result.folder && Array.isArray(result.folder) && result.folder.length > 0
            ? result.folder[0]
            : result.folder,
          controlClasses: result.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Find controls with flexible filtering.
   * Uses a dual-path approach: elementIds go through a Cypher helper for performance
   * (avoids polymorphic interface query), other filters use auto-generated GraphQL.
   * @param controlId - Optional specific control ID
   * @param name - Optional name substring match
   * @param classId - Optional control class ID filter
   * @param classType - Optional control class type filter
   * @param elementIds - Optional element IDs (uses Cypher helper for performance)
   * @param moduleId - Optional module ID filter
   * @param moduleName - Optional module name filter
   * @returns Array of matching controls
   */
  findControls = async ({
    controlId,
    name,
    classId,
    classType,
    elementIds,
    moduleId,
    moduleName,
  }: {
    controlId?: string
    name?: string
    classId?: string
    classType?: string
    elementIds?: string[]
    moduleId?: string
    moduleName?: string
  }): Promise<Control[]> => {
    try {
      const condition: Record<string, any> = {}

      // Path 1: elementIds provided — use Cypher helper for performance
      // (polymorphic interface queries are slow on Memgraph, same issue as findIssues)
      if (elementIds && elementIds.length > 0) {
        const helperResponse = await this.dtUtils.performQuery<{ controlIdsByElements: string[] }>({
          query: CONTROL_IDS_BY_ELEMENTS,
          variables: { elementIds },
          action: 'controlIdsByElements',
          fetchPolicy: 'network-only'
        })

        const controlIds = helperResponse.controlIdsByElements
        if (!controlIds || controlIds.length === 0) {
          return []
        }

        condition.id = { in: controlIds }
      }

      // Path 2 (and additional filters for Path 1): build condition
      if (controlId) condition.id = { eq: controlId }
      if (name) condition.name = { contains: name }

      if (classId || classType) {
        const classFilter: Record<string, any> = {}
        if (classId) classFilter.id = { eq: classId }
        if (classType) classFilter.type = { eq: classType }
        condition.controlClasses = { some: classFilter }
      }

      if (moduleId || moduleName) {
        const moduleFilter: Record<string, any> = {}
        if (moduleId) moduleFilter.id = { eq: moduleId }
        if (moduleName) moduleFilter.name = { eq: moduleName }
        condition.controlClasses = {
          ...condition.controlClasses,
          some: {
            ...condition.controlClasses?.some,
            module: { single: moduleFilter }
          }
        }
      }

      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: FIND_CONTROLS,
        variables: { condition: { "AND": condition } },
        action: 'findControls',
        fetchPolicy: 'network-only'
      })

      if (response.controls) {
        const controls = response.controls.map((control: Control) => ({
          ...control,
          folder: control.folder && Array.isArray(control.folder) && control.folder.length > 0
            ? control.folder[0]
            : control.folder,
          controlClasses: control.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }))
        return controls
      }
      return []
    } catch (error) {
      throw error
    }
  }

  /**
   * Assign a control to elements by creating SUPPORTS edges (append-only).
   * Uses GraphQL connect on the polymorphic elements relationship.
   * Idempotent — calling with the same args does not create duplicate edges.
   * @param controlId - The ID of the control
   * @param elementIds - The IDs of the elements to connect
   * @returns The updated control or null if an error occurs
   */
  assignControlToElements = async ({
    controlId,
    elementIds,
  }: {
    controlId: string
    elementIds: string[]
  }): Promise<Control | null> => {
    if (!controlId || !elementIds || elementIds.length === 0) return null

    try {
      const variables = {
        controlId,
        input: {
          elements: {
            connect: elementIds.map(id => ({
              where: { node: { id: { eq: id } } }
            }))
          }
        }
      }

      const result = await this.dtUtils.performMutation<Control>({
        mutation: ASSIGN_CONTROL_TO_ELEMENTS,
        variables,
        dataPath: 'updateControls.controls[0]',
        action: 'assignControlToElements',
        deduplicationKey: `assign-control-${controlId}-${elementIds.slice().sort().join(',')}`
      })

      if (result) {
        return {
          ...result,
          folder: result.folder && Array.isArray(result.folder) && result.folder.length > 0
            ? result.folder[0]
            : result.folder,
          controlClasses: result.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Analyze control gaps for a model by traversing the MITRE framework chain.
   * Returns unmitigated/unaddressable exposures, recommended controls, and coverage summary.
   * @param modelId - The model ID to analyze
   * @param topN - Number of top recommended controls (default 3)
   * @param limit - Maximum exposures to return (default 50)
   * @returns Control gap analysis result
   */
  controlGaps = async ({
    modelId,
    topN,
    limit,
  }: {
    modelId: string
    topN?: number
    limit?: number
  }): Promise<ControlGapsResult> => {
    try {
      const response = await this.dtUtils.performQuery<{ controlGaps: ControlGapsResult }>({
        query: CONTROL_GAPS,
        variables: { input: { modelId, topN, limit } },
        action: 'controlGaps',
        fetchPolicy: 'network-only'
      })
      return response.controlGaps
    } catch (error) {
      throw error
    }
  }
}