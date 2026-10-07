import { gql } from 'graphql-tag'

// MITRE ATLAS techniques by filter, with their tactics so the picker can resolve a tactic per
// entry. A technique can belong to several tactics; callers take the earliest in matrix order.
export const FIND_MITRE_ATLAS_TECHNIQUES = gql`
  query FindMitreAtlasTechniques($filter: MitreAtlasTechniqueWhere!) {
    mitreAtlasTechniques(where: $filter) {
      id
      name
      description
      atlas_id
      ref_url
      tactics {
        id
        name
        atlas_id
        matrix_order
      }
    }
  }
`

export const GET_MITRE_ATLAS_MITIGATIONS = gql`
  query GetMitreAtlasMitigations {
    mitreAtlasMitigations {
      id
      name
      description
      atlas_id
      ref_url
    }
  }
`

export const GET_MITRE_ATLAS_TACTICS = gql`
  query GetMitreAtlasTactics {
    mitreAtlasTactics {
      id
      name
      description
      atlas_id
      matrix_order
    }
  }
`
