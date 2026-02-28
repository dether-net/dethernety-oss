import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { Class, Control } from '../interfaces/core-types-interface.js'
import { CREATE_CONTROL, DELETE_CONTROL, GET_CONTROLS, UPDATE_CONTROL } from './dt-control-gql.js'

export class DtControl {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
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
}