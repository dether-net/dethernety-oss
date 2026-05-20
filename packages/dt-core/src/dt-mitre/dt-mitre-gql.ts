import { gql } from 'graphql-tag'

/**
 * matchMitreTechniques query.
 *
 * Distinct from matchClasses — techniques are not type-filtered, the server
 * returns at most one tier of results per query, and the vector tier carries
 * a structured `vectorDisabledReason` for the picker caption.
 *
 * Batch shape — picker sends single-element arrays today; server clamps queries
 * to MAX_QUERIES (25) and topN to [1, 50].
 */
export const MATCH_MITRE_TECHNIQUES = gql`
  query MatchMitreTechniques($input: MatchMitreTechniquesInput!) {
    matchMitreTechniques(input: $input) {
      matches {
        query
        candidates {
          mitreId
          name
          description
          tactic
          kind
          matchType
          similarityScore
        }
      }
      unmatched
      vectorAvailable
      vectorDisabledReason
    }
  }
`
