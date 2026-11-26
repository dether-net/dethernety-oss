/**
 * The review module's GraphQL surface as Dethereal uses it: `dethermine-review`, a platform module whose Triage
 * workspace holds proposals for a person to decide. Every answer is a JSON string, checked by the caller; every read
 * and write starts from a Triage analysis of one model. Detection is the capability query: a schema without the field
 * refuses the document at validation, which is how a platform without the module is told apart.
 */
import { gql } from '@apollo/client'

export const REVIEW_MODULE = 'dethermine-review'

/** The module's own bounds, which Dethereal keeps under rather than learns from a refusal. */
export const REVIEW_LIMITS = {
  /** The module's deadline is 25 s under the platform's 30 s, so 40 s covers a slow answer. */
  timeoutMs: 40_000,
  answerChars: 4 * 1024 * 1024,
  idsPerCall: 2000,
  payloadBytes: 900 * 1024,
  /** One group's text: its reason, objection, ambiguity and citations. */
  proposalTextBytes: 12 * 1024,
  citations: 50,
  citationChars: 300,
} as const

export const REVIEW_CAPABILITY = gql`
  query ReviewCapability { reviewCapability }
`

export const REVIEW_FINDING_STATES = gql`
  query ReviewFindingStates($analysisId: String!, $exposureIds: [String!]!) { reviewFindingStates(analysisId: $analysisId, exposureIds: $exposureIds) }
`

export const REVIEW_PROPOSALS = gql`
  query ReviewProposals($analysisId: String!, $exposureIds: [String!]!) { reviewProposals(analysisId: $analysisId, exposureIds: $exposureIds) }
`

export const REVIEW_PUBLISH = gql`
  mutation ReviewPublishProposals($analysisId: String!, $payload: String!) { reviewPublishProposals(analysisId: $analysisId, payload: $payload) }
`

/** The Hidden edges workspace: each named edge's fingerprint, whether the model holds it and whether it is rejected. */
export const REVIEW_EDGE_STATES = gql`
  query ReviewEdgeStates($analysisId: String!, $edges: String!) { reviewEdgeStates(analysisId: $analysisId, edges: $edges) }
`

export const REVIEW_EDGE_PROPOSALS = gql`
  query ReviewEdgeProposals($analysisId: String!, $candidateIds: [String!]!) { reviewEdgeProposals(analysisId: $analysisId, candidateIds: $candidateIds) }
`

export const REVIEW_PUBLISH_EDGES = gql`
  mutation ReviewPublishEdgeProposals($analysisId: String!, $payload: String!) { reviewPublishEdgeProposals(analysisId: $analysisId, payload: $payload) }
`

/** The model's analyses of one class (Triage, Hidden edges), with when each was made and the models each is bound to. */
export const TRIAGE_REVIEW_ANALYSES = gql`
  query TriageReviewAnalyses($classId: ID!, $modelId: ID!) {
    analyses(where: { analysisClass: { single: { id: { eq: $classId } } }, model: { some: { id: { eq: $modelId } } } }) {
      id
      createdAt
      model { id }
    }
  }
`

/** The platform's idempotent create: a MERGE by the caller's id, so two harnesses publishing one model meet in one analysis. */
export const CREATE_TRIAGE_ANALYSIS = gql`
  mutation CreateTriageAnalysis($id: ID!, $name: String!, $description: String, $elementId: ID!, $analysisClassId: ID!) {
    createAnalysisIdempotent(id: $id, name: $name, description: $description, elementId: $elementId, analysisClassId: $analysisClassId) { id }
  }
`

/** The statuses in which a stored proposal is still waiting for a person. */
export const WAITING_STATUSES: ReadonlySet<string> = new Set(['open', 'stale', 'stale_module', 'needs_person'])
