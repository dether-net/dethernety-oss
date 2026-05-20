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
      createdBy
      authoredBy
      dispositionKind
      dispositionReason
      dispositionedBy
      dispositionedAt
      dispositionStale
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
        createdBy
        authoredBy
        dispositionKind
        dispositionReason
        dispositionedBy
        dispositionedAt
        dispositionStale
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
        createdBy
        authoredBy
        dispositionKind
        dispositionReason
        dispositionedBy
        dispositionedAt
        dispositionStale
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
        createdBy
        authoredBy
        dispositionKind
        dispositionReason
        dispositionedBy
        dispositionedAt
        dispositionStale
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

// Structured disposition mutations,
// parallel to disposeExposure / clearDisposition. Both return the shared
// DispositionMutationResult — on domain errors (validation, not-found) the
// server returns success=false + errorCode/errorMessage rather than throwing.
// The result-type field is named exposureId (reused unchanged);
// it carries the countermeasure id in this path.
export const DISPOSE_COUNTERMEASURE = gql`
  mutation DisposeCountermeasure($countermeasureId: ID!, $kind: DispositionKind!, $reason: String!) {
    disposeCountermeasure(countermeasureId: $countermeasureId, kind: $kind, reason: $reason) {
      success
      exposureId
      dispositionKind
      dispositionReason
      dispositionedBy
      dispositionedAt
      dispositionStale
      errorCode
      errorMessage
    }
  }
`

export const CLEAR_COUNTERMEASURE_DISPOSITION = gql`
  mutation ClearCountermeasureDisposition($countermeasureId: ID!) {
    clearCountermeasureDisposition(countermeasureId: $countermeasureId) {
      success
      exposureId
      dispositionKind
      dispositionReason
      dispositionedBy
      dispositionedAt
      dispositionStale
      errorCode
      errorMessage
    }
  }
`

// USER-copy-delete companion. After deleteCountermeasures succeeds on a USER-authored
// countermeasure, fire-and-forget this updateCountermeasures to flip dispositionStale on
// any SYSTEM countermeasure that was previously superseded by the deleted USER copy. The
// match rides on the single-quote-wrapped name in dispositionReason emitted by the
// Supersede flow. Mirrors dt-exposure.FLIP_SUPERSEDED_STALE.
// @neo4j/graphql v7 filter syntax: `{ contains: <value> }`.
export const FLIP_SUPERSEDED_COUNTERMEASURE_STALE = gql`
  mutation FlipSupersededCountermeasureStaleByName($where: CountermeasureWhere!, $update: CountermeasureUpdateInput!) {
    updateCountermeasures(where: $where, update: $update) {
      countermeasures {
        id
      }
    }
  }
`