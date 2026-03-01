import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { MitreDefendTactic, MitreDefendTechnique } from '../interfaces/core-types-interface.js'
import { GET_MITRE_DEFEND_TACTICS, GET_MITRE_DEFEND_TECHNIQUE_BY_TACTIC, GET_MITRE_DEFEND_TECHNIQUE } from './dt-mitredefend-gql.js'

export class DtMitreDefend {
  private dtUtils: DtUtils
  private apolloClient: ApolloClient<NormalizedCacheObject>

  private tacticsOrder = (['Model', 'Harden', 'Detect', 'Isolate', 'Deceive', 'Evict', 'Restore'])

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Fetch Mitre Defend Tactics
   * @returns Mitre Defend Tactics
   */
  fetchMitreDefendTactics = async (): Promise<MitreDefendTactic[] | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreDefendTactics: MitreDefendTactic[] }>({
        query: GET_MITRE_DEFEND_TACTICS,
        action: 'fetchMitreDefendTactics',
        fetchPolicy: 'network-only'
      })
      
      if (response.mitreDefendTactics) {
        // Create a mutable copy before filtering/sorting since GraphQL responses are often frozen
        return [...response.mitreDefendTactics]
          .filter(t => this.tacticsOrder.includes(t.name || ''))
          .sort(
            (a: MitreDefendTactic, b: MitreDefendTactic) =>
              this.tacticsOrder.indexOf(a.name || '') - this.tacticsOrder.indexOf(b.name || '')
          )
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Get Mitre Defend Techniques by Tactic
   * @param tacticId - The ID of the tactic
   * @returns Mitre Defend Techniques
   */
  getMitreDefendTechniquesByTactic = async (
    { tacticId }: { tacticId: string }
  ): Promise<MitreDefendTechnique[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreDefendTactics: Array<{ techniques: MitreDefendTechnique[] }> }>({
        query: GET_MITRE_DEFEND_TECHNIQUE_BY_TACTIC,
        variables: { tacticId },
        action: 'getMitreDefendTechniquesByTactic',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreDefendTactics?.[0]?.techniques || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get Mitre Defend Technique
   * @param d3fendId - The ID of the technique
   * @returns Mitre Defend Technique
   */
  getMitreDefendTechnique = async (
    { d3fendId }:
    { d3fendId: string }):
  Promise<MitreDefendTechnique | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreDefendTechniques: MitreDefendTechnique[] }>({
        query: GET_MITRE_DEFEND_TECHNIQUE,
        variables: { d3fendId },
        action: 'getMitreDefendTechnique',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreDefendTechniques?.[0] || null
    } catch (error) {
      return null
    }
  }
}