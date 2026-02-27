import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const ADD_COMPONENT = gql`
  mutation AddComponentToModel(
    $parentBoundaryId: ID!,
    $classId: ID,
    $name: String!,
    $description: String,
    $type: ComponentType!,
    $x: Float!, $y:
    Float!)
  {
  createComponents (
      input: {
        name: $name
        type: $type
        description: $description
        positionX: $x
        positionY: $y
        parentBoundary: {
          connect: {
            where: {
              node: { id: { eq: $parentBoundaryId } }
            }
          }
        }
        componentClass: {
          connect: {
            where: {
              node: { id: { eq: $classId } }
            }
          }
        }
      }
  ) {
      components {
        id
        name
        description
        type
        positionX
        positionY
        parentBoundary {
          id
        }
      }
    }
  }
`

export const GET_COMPONENT_REPRESENTED_MODEL = gql`
  query GetComponentRepresentedModel($componentId: ID!) {
    components( where: {
      id: { eq: $componentId }
    }) {
      representedModel {
        id
        name
        description
      }
    }
  }
`

export const UPDATE_COMPONENT = gql`
  mutation UpdateComponenet(
    $componentId: ID!,
    $input: ComponentUpdateInput!
  ) {
    updateComponents(
      where: {
        id: { eq: $componentId }
      }
      update: $input
    ) {
      components {
        id
        name
        description
        positionX
        positionY
        type
        parentBoundary {
          id
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
        dataItems {
          id
          name
          description
          dataClass {
            id
            name
          }
          # elements {
          #   id
          # }
        }
      }
    }
  }
`

export const DELETE_COMPONENT = gql`
  mutation DeleteComponent($componentId: ID!) {
    deleteExposures(where: { element: { some: { id: { eq: $componentId }}}}) {
      nodesDeleted
      relationshipsDeleted
    }
    deleteAnalyses( where: { element: { some: { id: { eq: $componentId }}}}) {
      nodesDeleted
      relationshipsDeleted
    }
    deleteDataFlows(where: { OR: [
        { source: { some: { id: { eq: $componentId }}}},
        { target: { some: { id: { eq: $componentId }}}}
      ]}
    ) {
      nodesDeleted
      relationshipsDeleted
    }
    deleteComponents(
      where: { id: { eq: $componentId } }
       # delete: { flowsTo: {}, flowsFrom: {}, exposures: {} }
    ) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`
