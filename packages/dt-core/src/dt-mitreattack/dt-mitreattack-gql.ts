import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_MITRE_ATTACK_TECHNIQUES_BY_TACTIC = gql`
  query GetMitreAttackTechniquesByTactic($mitreAttackTacticId: ID!) {
    mitreAttackTactics(where: {  id: { eq: $mitreAttackTacticId } }) {
      name
      attack_id
      description
      techniques(where: { parentTechnique: null }) {
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

export const FIND_MITRE_ATTACK_TECHNIQUE = gql`
  query FindMitreAttackTechnique($filter: MitreAttackTechniqueFilter! ) {
    mitreAttackTechniques(where: $filter) {
      id
      name
      description
      attack_id
      attack_version
      stix_created
      stix_id
      stix_modified
      stix_revoked
      stix_spec_version
      stix_type
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
