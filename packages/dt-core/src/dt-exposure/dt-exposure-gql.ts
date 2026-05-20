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
      attackVector
      createdBy
      authoredBy
      dispositionKind
      dispositionReason
      dispositionedBy
      dispositionedAt
      dispositionStale
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
      attackVector
      createdBy
      authoredBy
      dispositionKind
      dispositionReason
      dispositionedBy
      dispositionedAt
      dispositionStale
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
        attackVector
        dispositionKind
        dispositionReason
        dispositionedBy
        dispositionedAt
        dispositionStale
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
        attackVector
        mitigationSuggestions
        detectionMethods
        tags
        createdBy
        authoredBy
        dispositionKind
        dispositionReason
        dispositionedBy
        dispositionedAt
        dispositionStale
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

// Structured disposition mutations.
// disposeExposure and clearDisposition both return DispositionMutationResult — on domain
// errors (validation, not-found) the server returns success=false + errorCode/errorMessage
// rather than throwing. Transport / network errors still propagate via performMutation.
export const DISPOSE_EXPOSURE = gql`
  mutation DisposeExposure($exposureId: ID!, $kind: DispositionKind!, $reason: String!) {
    disposeExposure(exposureId: $exposureId, kind: $kind, reason: $reason) {
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

export const CLEAR_DISPOSITION = gql`
  mutation ClearDisposition($exposureId: ID!) {
    clearDisposition(exposureId: $exposureId) {
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

// USER-copy-delete companion. After deleteExposures succeeds on a USER-authored
// exposure, fire-and-forget this updateExposures to flip dispositionStale on any
// SYSTEM exposure that was previously superseded by the deleted USER copy. The
// match rides on the single-quote-wrapped name in dispositionReason emitted by
// executeSupersedeFlow.
// @neo4j/graphql v7 filter syntax: `{ contains: <value> }`.
export const FLIP_SUPERSEDED_STALE = gql`
  mutation FlipSupersededStaleByName($where: ExposureWhere!, $update: ExposureUpdateInput!) {
    updateExposures(where: $where, update: $update) {
      exposures {
        id
      }
    }
  }
`