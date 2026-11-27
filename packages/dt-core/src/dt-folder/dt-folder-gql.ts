import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

/** Every model and control with only what a search over the folders needs: id, name and the folder that holds it. */
export const GET_CONTENT_INDEX = gql`
  query GetContentIndex {
    models {
      id
      name
      folder {
        id
      }
    }
    controls {
      id
      name
      folder {
        id
      }
    }
  }
`

export const GET_FOLDERS = gql`
  query GetFolders {
    folders {
      id
      name
      description
      parentFolder {
        id
      }
      childrenFolders {
        id
      }
      models {
        id
      }
      controls {
        id
      }
    }
  }
`

export const CREATE_FOLDER = gql`
  mutation CreateFolder($input: [FolderCreateInput!]!){
    createFolders (input: $input) {
      folders {
        id
        name
        description
        parentFolder {
          id
        }
      }
    }
  }
`

export const DELETE_FOLDER = gql`
  mutation DeleteFolder($id: ID!){
    deleteFolders (where: { id: { eq: $id } }) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`

export const UPDATE_FOLDER = gql`
  mutation UpdateFolder($id: ID!, $input: FolderUpdateInput!){
    updateFolders (where: {id: { eq: $id }}, update: $input) {
			folders {
				id
				name
				description
				parentFolder {
					id
				}
			}
		}
	}
`