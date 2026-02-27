import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { Folder } from '../interfaces/core-types-interface.js'
import { GET_FOLDERS, CREATE_FOLDER, DELETE_FOLDER, UPDATE_FOLDER } from './dt-folder-gql.js'

export class DtFolder {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Get all folders
   * @returns Promise of an array of folders
   */
  getFolders = async (): Promise<Folder[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ folders: Folder[] }>({
        query: GET_FOLDERS,
        action: 'getFolders',
        fetchPolicy: 'network-only'
      })
      
      if (response.folders) {
        const folders = response.folders.map((folder: Folder) => {
          // If parentFolder is an array, extract the id from the first element
          return {
            ...folder,
            parentFolder: folder.parentFolder && Array.isArray(folder.parentFolder) && folder.parentFolder.length > 0
              ? { id: folder.parentFolder[0].id } as Folder
              : undefined,
          }
        })
        return folders as Folder[]
      }
      return []
    } catch (error) {
      throw error
    }
  }

  /**
   * Create a folder
   * @param folder - The folder to create
   * @returns Promise of the created folder
   */
  createFolder = async (folder: Folder): Promise<Folder> => {
    try {
      const folderInput: any = {
        name: folder.name,
        description: folder.description,
      }
      
      if (folder.parentFolder) {
        folderInput.parentFolder = {
          connect: { where: { node: { id: { eq: folder.parentFolder.id } } } },
        }
      }
      
      const response = await this.dtUtils.performMutation<{ createFolders: { folders: Folder[] } }>({
        mutation: CREATE_FOLDER,
        variables: { input: [folderInput] },
        dataPath: '',
        action: 'createFolder',
        deduplicationKey: `create-folder-${folder.name}-${folder.parentFolder?.id || 'root'}`
      })
      
      if (!response?.createFolders?.folders?.length) {
        throw new Error('No folder returned from create operation')
      }
      
      const createdFolder = response.createFolders.folders[0]
      return {
        ...createdFolder,
        parentFolder: createdFolder.parentFolder && Array.isArray(createdFolder.parentFolder) && createdFolder.parentFolder.length > 0
          ? { id: createdFolder.parentFolder[0].id } as Folder
          : undefined,
      } as Folder
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a folder
   * @param folderId - The ID of the folder to delete
   * @returns Promise of a boolean indicating if the folder was deleted
   */
  deleteFolder = async (folderId: string): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<{ deleteFolders: { nodesDeleted: number } }>({
        mutation: DELETE_FOLDER,
        variables: { id: folderId },
        dataPath: '',
        action: 'deleteFolder',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return response?.deleteFolders?.nodesDeleted > 0 || false
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a folder
   * @param folder - The folder to update
   * @returns Promise of a boolean indicating if the folder was updated
   */
  updateFolder = async (folder: Folder): Promise<boolean> => {
    try {
      const folderInput: any = {
        name: { set: folder.name || '' },
        description: { set: folder.description || '' },
      }

      if (folder.parentFolder) {
        folderInput.parentFolder = {
          disconnect: {},
          connect: { where: { node: { id: { eq: folder.parentFolder.id } } } },
        }
      } else {
        folderInput.parentFolder = {
          disconnect: {},
        }
      }
      
      const response = await this.dtUtils.performMutation<{ updateFolders: { folders: Folder[] } }>({
        mutation: UPDATE_FOLDER,
        variables: { id: folder.id, input: folderInput },
        dataPath: '',
        action: 'updateFolder',
        deduplicationKey: `update-folder-${folder.id}`
      })
      
      // Transform the returned folder data to handle parentFolder array structure
      if (response?.updateFolders?.folders && response.updateFolders.folders.length > 0) {
        const updatedFolder = response.updateFolders.folders[0]
        // Create a new object with the transformed parentFolder
        response.updateFolders.folders[0] = {
          ...updatedFolder,
          parentFolder: updatedFolder.parentFolder && Array.isArray(updatedFolder.parentFolder) && updatedFolder.parentFolder.length > 0
            ? { id: updatedFolder.parentFolder[0].id } as Folder
            : undefined,
        }
      }
      
      return response?.updateFolders?.folders?.length > 0 || false
    } catch (error) {
      throw error
    }
  }
}