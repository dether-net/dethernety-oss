import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_MITRE_ATTACK_TECHNIQUES_BY_TACTIC = gql`
  query GetMitreAttackTechniquesByTactic($mitreAttackTacticId: ID!) {
    mitreAttackTactics(where: {  id: { eq: $mitreAttackTacticId } }) {
      name
      attack_id
      description
      techniques(where: { parentTechnique: { none: {} } }) {
        id
        name
        attack_id
        description
        attack_version
        stix_id
        stix_spec_version
        stix_type
        subTechniques {
          id
          name
          description
          attack_id
          attack_version
          stix_id
          stix_spec_version
          stix_type
        }
      }
    }
  }
`

// `MitreAttackTechniqueWhere` is the @neo4j/graphql v7 auto-generated input type;
// the legacy v1 name `*Filter` no longer exists in the codegen output.
// stix_created / stix_modified / stix_revoked are not properties on the
// MitreAttackTechnique schema type — removed.
//
// `tactics { name }` is selected so the TechniquePicker sheet's tactic-facet
// filter can resolve a tactic name per catalog entry. A technique can belong
// to multiple tactics; the picker uses the first one (mirrors the
// deterministic-tactic projection on the backend).
export const FIND_MITRE_ATTACK_TECHNIQUE = gql`
  query FindMitreAttackTechnique($filter: MitreAttackTechniqueWhere!) {
    mitreAttackTechniques(where: $filter) {
      id
      name
      description
      attack_id
      attack_version
      stix_id
      stix_spec_version
      stix_type
      tactics {
        name
      }
    }
  }
`

export const GET_MITRE_ATTACK_TACTICS = gql`
  query GetMitreAttackTactics {
    mitreAttackTactics {
      id
      name
      description
      attack_id
      attack_version
      stix_id
      stix_spec_version
      stix_type
    }
  }
`

export const GET_MITRE_ATTACK_MITIGATIONS = gql`
  query GetMitreAttackMitigations {
    mitreAttackMitigations {
      id
      name
      description
      attack_id
    }
  }
`

export const GET_MITRE_ATTACK_TECHNIQUE = gql`
  query getMitreAttackTechnique($attack_id: String) {
    mitreAttackTechniques(
      where: {attack_id: { eq: $attack_id}})
    {
      name
      description
    }
  }
`
export const GET_MITRE_ATTACK_MITIGATION = gql`
  query GetMitreAttackMitigation($attack_id: String) {
    mitreAttackMitigations(
      where: {attack_id: { eq: $attack_id}})
    {
      name
      description
    }
  }
`
