import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_EXPOSURES = gql`
  query GetExposures($elementId: String!) {
    getExposuresForElement(elementId: $elementId) {
      id
      name
      description
      type
      category
      score
      exploitedBy {
        id
        name
        description
        attack_id
      }
    }
  }
`

export const GET_EXPOSURE = gql`
  query GetExposure($exposureId: ID!) {
    exposures(where: { id: { eq: $exposureId } }) {
      id
      name
      description
      type
      category
      score
      exploitedBy {
        id
        name
        description
        attack_id
      }
    }
  }
`

export const ADD_EXPOSURE = gql`
  mutation AddExposure($input: [ExposureCreateInput!]!) {
    createExposures( input: $input) {
      exposures {
        id
        name
        description
        type
        category
        score
        exploitedBy {
          id
          name
          description
          attack_id
        }
      }
    } 
  }
`

export const UPDATE_EXPOSURE = gql`
  mutation UpdateExposure($exposureId: ID!, $input: ExposureUpdateInput!) {
    updateExposures(where: { id: { eq: $exposureId } }, update: $input) {
      exposures {
        id
        name
        description
        type
        category
        score
        mitigationSuggestions
        detectionMethods
        tags
        exploitedBy {
          id
          name
          description
          attack_id
        }
      }
    }
  }
`

export const DELETE_EXPOSURE = gql`
  mutation DeleteExposure($exposureId: ID!) {
    deleteExposures(where: { id: { eq: $exposureId } }) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`