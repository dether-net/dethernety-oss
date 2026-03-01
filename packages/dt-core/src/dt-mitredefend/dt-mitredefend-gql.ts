import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_MITRE_DEFEND_TACTICS = gql`
  query GetMitreDefendTactics {
    mitreDefendTactics {
      id
      name
      description
      uri
    }
  }
`

export const GET_MITRE_DEFEND_TECHNIQUE_BY_TACTIC = gql`
  query GetMitreDefendTechniqueByTactic($tacticId: ID!) {
    mitreDefendTactics(where: { id: { eq: $tacticId } }) {
      id
      name
      description
      techniques {
        id
        name
        description
        uri
        subTechniques {
          id
          name
          description
          uri
          subTechniques {
            id
            name
            description
            uri
          }
        }
      }
    }
  }
`

export const GET_MITRE_DEFEND_TECHNIQUE = gql`
  query getMitreDefendTechnique($d3fendId: String) {
    mitreDefendTechniques(
      where: {d3fendId: { eq: $d3fendId}})
    {
      name
      description
      uri
    }
  }
`