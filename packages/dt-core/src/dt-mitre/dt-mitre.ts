/**
 * MITRE search wrapper.
 *
 * Thin façade over the `matchMitreTechniques` GraphQL query. Mirrors
 * `DtClass.matchClasses` structurally — same cancel-on-replace discipline via
 * `dtUtils.withCancellableLatest`, same `network-only` fetch policy, same
 * pattern of letting the server own the result shape.
 *
 * Cancellation key is `matchTechniques:${kind}` — rapid keystrokes from a
 * single picker instance (same kind) supersede each other. Mixed kinds (e.g.
 * the CounterMeasureDialog with both DEFEND_TECHNIQUE and ATTACK_MITIGATION
 * pickers open) get distinct keys and proceed in parallel.
 *
 * Domain note: this only covers semantic matching. Direct catalog access
 * (listAttackTactics, getMitreAttackTechnique, etc.) remains on DtMitreAttack
 * and DtMitreDefend. The picker hydrates its catalog through those existing
 * classes; DtMitre is the new vector-tier surface.
 */

import * as Apollo from '@apollo/client'
import { DtUtils } from '../dt-utils/dt-utils.js'
import {
  MatchMitreTechniquesResult,
  MitreKind,
} from '../interfaces/core-types-interface.js'
import { MATCH_MITRE_TECHNIQUES } from './dt-mitre-gql.js'

export class DtMitre {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Match user-typed queries against the MITRE corpus.
   *
   * @param queries - User-typed strings. Each becomes a TechniqueQueryInput in
   *   the server batch. Empty array is rejected client-side (caller should not
   *   issue the call). Max length per string is enforced server-side (MAX_QUERY_LENGTH=500).
   * @param kind - Which corpus to consult — ATTACK_TECHNIQUE / DEFEND_TECHNIQUE / ATTACK_MITIGATION.
   *   Determines the HNSW index the server reads and the deterministic-tier
   *   schema applied (ATT&CK uses attack_id, D3FEND uses d3fendId).
   * @param topN - Optional cap on candidates per query. Server clamps to [1, 50].
   *   Defaults to 3 on the server when omitted.
   * @returns MatchMitreTechniquesResult — matches[] parallel to queries[],
   *   plus vectorAvailable + vectorDisabledReason describing vector-tier health.
   *   `vectorAvailable === false` means the picker should silently show the
   *   deterministic-only tiers; `vectorDisabledReason` drives the caption.
   */
  matchTechniques = async ({
    queries,
    kind,
    topN,
  }: {
    queries: string[]
    kind: MitreKind
    topN?: number
  }): Promise<MatchMitreTechniquesResult> => {
    // Cancel-on-replace keyed per kind: rapid-fire keystrokes from the same picker
    // supersede each other; mixed-kind pickers (CounterMeasureDialog) proceed in parallel.
    const key = `matchTechniques:${kind}`
    return this.dtUtils.withCancellableLatest(key, async () => {
      const response = await this.dtUtils.performQuery<{ matchMitreTechniques: MatchMitreTechniquesResult }>({
        query: MATCH_MITRE_TECHNIQUES,
        variables: {
          input: {
            // Schema shape: TechniqueQueryInput { query: String! }. The wrapper accepts
            // bare strings for ergonomics and maps to the input shape here.
            queries: queries.map(q => ({ query: q })),
            kind,
            ...(topN !== undefined ? { topN } : {}),
          },
        },
        action: 'matchMitreTechniques',
        fetchPolicy: 'network-only',
      })
      return response.matchMitreTechniques
    })
  }
}
