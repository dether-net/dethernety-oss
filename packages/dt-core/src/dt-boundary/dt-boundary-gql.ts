import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const ADD_BOUNDARY = gql`
  mutation AddComponentToModel(
    $parentBoundaryId: ID,
    $classId: ID,
    $name: String!, $description:
    String, $x: Float!,
    $y: Float,
    $width: Float,
    $height: Float
  ) {
    createSecurityBoundaries(
      input: {
        name: $name
        description: $description
        positionX: $x
        positionY: $y
        dimensionsWidth: $width
        dimensionsHeight: $height
        trustLevel: UNTRUSTED
        parentBoundary: {
          connect: {
            where: {
              node: { id: { eq: $parentBoundaryId } }
            }
          }
        }
        securityBoundaryClass: {
          connect: {
            where: {
              node: { id: { eq: $classId } }
            }
          }
        }
      }
    ) {
      securityBoundaries {
        id
        name
        positionX
        positionY
        dimensionsWidth
        dimensionsHeight
        parentBoundary {
          id
        }
      }
    }
  }
`

export const GET_BOUNDARY_REPRESENTED_MODEL = gql`
  query GetBoundaryRepresentedModel($boundaryId: ID!) {
    securityBoundaries( where: {
      id: { eq: $boundaryId }
    }) {
      representedModel {
        id
        name
        description
      }
    }
  }
`

export const UPDATE_BOUNDARY = gql`
  mutation UpdateBoundary(
    $boundaryId: ID!,
    $input: SecurityBoundaryUpdateInput!
  ) {
    updateSecurityBoundaries(
      where: {
        id: { eq: $boundaryId }
      }
      update: $input
    ) {
      securityBoundaries {
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

export const DELETE_BOUNDARY = gql`
  mutation DeleteSecurityBoundary($boundaryId: ID!) {
    deleteExposures(where: { element: { some: { id: { eq: $boundaryId }}}}) {
			nodesDeleted
			relationshipsDeleted
		}
		deleteAnalyses( where: { element: { some: { id: { eq: $boundaryId }}}}) {
			nodesDeleted
			relationshipsDeleted
		}
    deleteSecurityBoundaries(
      where: { id: { eq: $boundaryId } }
      # delete: { exposures: {}, analyses: {} }
    ) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`

export const GET_DIRECT_DESCENDANTS = gql`
  query GetDirectDescendents($parentId: ID!) {
    securityBoundaries(where: {parentBoundary: { all: { id: { eq: $parentId} } } }) {
      id
      positionX
      positionY
      parentBoundary {
        id
        positionX
        positionY
        parentBoundary {
          id
          positionX
          positionY
        }
      }
    }
    components(where: {parentBoundary: { all: { id: { eq: $parentId} } } }) {
      id
      type
      positionX
      positionY
      parentBoundary {
        id
        positionX
        positionY
        parentBoundary {
          id
          positionX
          positionY
        }
      }
    }
  }
`