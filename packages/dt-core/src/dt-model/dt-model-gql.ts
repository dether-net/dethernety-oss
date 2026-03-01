import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_NOT_REPRESENTING_MODELS = gql`
  query GetNotRepresentingModels($modelId: String!) {
    getNotRepreseningModels (modelId: $modelId) {
      id
      name
      description
    }
  }
`

export const GET_MODELS = gql`
  query GetModels($query: ModelWhere) {
    models(where: $query) {
      id
      name
      description
      modules {
        id
        name
      }
      controls {
        id
        name
        description
        controlClasses {
          id
          name
          description
          supportedTypes
          supportedCategories
        }
      }
      folder {
        id
      }
    }
  }
`


export const CREATE_MODEL = gql`
  mutation CreateModel($input: [ModelCreateInput!]!){
    createModels (input: $input) {
      models {
        id
        name
        description
        folder {
          id
        }
      }
    }
  }
`

export const DELETE_MODEL = gql`
  mutation DeleteModel($modelId: ID!) {
    deleteModel(modelId: $modelId) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`

export const UPDATE_MODEL = gql`
  mutation UpdateModel($id: ID!, $input: ModelUpdateInput!) {
    updateModels(where: {
      id: { eq: $id }
    } update: $input ) {
      models {
        id
        name
        description
        modules {
          id
          name
        }
        controls {
          id
          name
          description
          controlClasses {
            id
            name
            description
            supportedTypes
            supportedCategories
          }
        }
      }
    }
  }
`


export const DUMP_MODEL_DATA = gql`
  query DumpModelData($modelId: ID!) {
    models(where: { id: { eq: $modelId } }) {
      id
      name
      description
      controls {
        id
      }
      defaultBoundary {
        id
        name
        description
        allDescendantComponents {
          id
          name
          description
          type
          positionX
          positionY
          parentBoundary {
            id
          }
          controls {
            id
            name
          }
          dataItems {
            id
          }
        }
        allDescendantBoundaries {
          id
          name
          description
          positionX
          positionY
          dimensionsWidth
          dimensionsHeight
          dimensionsMinWidth
          dimensionsMinHeight
          parentBoundary {
            id
          }
          controls {
            id
            name
          }
          dataItems {
            id
          }
        }
        allDescendantDataFlows {
          id
          name
          description
          source {
            id
          }
          target {
            id
          }
          controls {
            id
            name
          }
          dataItems {
            id
          }
          sourceHandle
          targetHandle
        }
      }
      dataItems {
        id
        name
        description
        dataClass {
          id
          name
        }
      }
      modules {
        id
        name
        description
        componentClasses {
          id
          name
          description
          type
          category
        }
        securityBoundaryClasses {
          id
          name
          description
          type
          category
        }
        dataFlowClasses {
          id
          name
          description
          type
          category
        }
        dataClasses {
          id
          name
          description
          type
          category
        }
        controlClasses {
          id
          name
          description
          type
          category
        }
      }
    }
  }
`

export const GET_DUMP_MODEL_DATA = gql`
  query GetDumpModelData($modelId: ID!) {
    getDumpModelData(modelId: $modelId)
  }
`

export const GET_MODEL_BOUNDARIES = gql`
  query GetModelBoundaries($modelId: ID!) {
    models(where: { id: { eq: $modelId } }) {
      defaultBoundary {
        allDescendantBoundaries {
          id
          name
          description
          positionX
          positionY
          dimensionsWidth
          dimensionsHeight
          dimensionsMinWidth
          dimensionsMinHeight
          parentBoundary {
            id
          }
          controls {
            id
            name
          }
          dataItems {
            id
          }
        }
      }
    }
  }
`

export const GET_MODEL_DATAFLOWS = gql`
  query GetModelDataFlows($modelId: ID!) {
    models(where: { id: { eq: $modelId } }) {
      defaultBoundary {
        allDescendantDataFlows {
          id
          name
          description
          source {
            id
          }
          target {
            id
          }
          controls {
            id
            name
          }
          dataItems {
            id
          }
          sourceHandle
          targetHandle
        }
      }
    }
  }
`

export const GET_MODEL_DATAITEMS = gql`
  query GetModelDataItems($modelId: ID!) {
    models(where: { id: { eq: $modelId } }) {
      dataItems {
        id
        name
        description
        dataClass {
          id
          name
        }
      }
    }
  }
`
