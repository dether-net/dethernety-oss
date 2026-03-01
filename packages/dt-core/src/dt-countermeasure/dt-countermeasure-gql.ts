import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_COUNTERMEASURE = gql`
  query GetCountermeasure($countermeasureId: ID!) {
    countermeasures(where: { id: { eq: $countermeasureId } }) {
      id
      name
      description
      type
      category
      score
      references
      addressedExposures
      mitigations {
        id
        name
        description
      }
      defendedTechniques {
        id
        name
        description
        uri
        d3fendId
      }
    }
  }
`

export const CREATE_COUNTERMEASURE = gql`
  mutation CreateCountermeasure($input: [CountermeasureCreateInput!]!) {
    createCountermeasures(input: $input) {
      countermeasures {
        id
        name
        description
        type
        category
        score
        references
        addressedExposures
        mitigations {
          id
          name
          description
        }
      }
    }
  }
`

export const UPDATE_COUNTERMEASURE = gql`
  mutation UpdateCountermeasure($countermeasureId: ID!, $input: CountermeasureUpdateInput!) {
    updateCountermeasures(
      where: { id: { eq: $countermeasureId } }
      update: $input
    ) {
      countermeasures {
        id
        name
        description
        type
        category
        score
        references
        addressedExposures
        mitigations {
          id
          name
          description
        }
      }
    }
  }
`

export const DELETE_COUNTERMEASURE = gql`
  mutation DeleteCountermeasure($countermeasureId: ID!) {
    deleteCountermeasures(where: { id: { eq: $countermeasureId } }) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`

export const GET_COUNTERMEASURES_FROM_CONTROL = gql`
  query GetCountermeasuresFromControl($controlId: ID!) {
    controls(where: { id: { eq: $controlId } }) {
      countermeasures {
        id
        name
        description
        type
        category
        score
        references
        addressedExposures
        tags
        mitigations {
          id
          name
          description
          attack_id
        }
        defendedTechniques {
          id
          name
          description
          uri
          d3fendId
        }
      }
    }
  }
`