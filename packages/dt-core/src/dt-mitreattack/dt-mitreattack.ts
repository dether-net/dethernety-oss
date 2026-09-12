import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { MitreAttackTechnique, MitreAttackTactic, MitreAttackMitigation } from '../interfaces/core-types-interface.js'
import {
  GET_MITRE_ATTACK_TACTICS,
  FIND_MITRE_ATTACK_TECHNIQUE,
  GET_MITRE_ATTACK_TECHNIQUES_BY_TACTIC,
  GET_MITRE_ATTACK_MITIGATIONS,
  GET_MITRE_ATTACK_MITIGATION,
  GET_MITRE_ATTACK_TECHNIQUE,
} from './dt-mitreattack-gql.js'

export class DtMitreAttack {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient
  // MITRE ATT&CK Enterprise tactics in matrix order. ATT&CK v19 retired Defense
  // Evasion, splitting it into Stealth (which kept the TA0005 id) and the new
  // Defense Impairment (TA0112).
  private  tacticsOrder = (['Reconnaissance', 'Resource Development', 'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation', 'Stealth', 'Defense Impairment', 'Credential Access', 'Discovery', 'Lateral Movement', 'Collection', 'Command and Control', 'Exfiltration', 'Impact'])

  /**
   * Retired tactic names mapped to the current name that occupies their slot.
   *
   * TRANSITIONAL: a dataset built before v19 still reports `Defense Evasion`,
   * and this client sorts by NAME, so without the alias that list would order
   * the tactic last until the data catches up. Drop an entry once no reachable
   * dataset reports it.
   */
  private retiredTacticNames: Record<string, string> = {
    'Defense Evasion': 'Stealth',
  }

  /**
   * Matrix rank for a tactic name, for ordering only.
   *
   * A name this list does not carry sorts to the END and is still returned.
   * `indexOf` on its own yields -1, which would sort an unrecognized tactic to
   * the FRONT of the matrix — so a tactic renamed by an ATT&CK release silently
   * leads the list instead of trailing it. Unknown names tie, so their relative
   * order is left as the server returned it.
   */
  private tacticRank = (name?: string | null): number => {
    const current = this.retiredTacticNames[name || ''] ?? name ?? ''
    const index = this.tacticsOrder.indexOf(current)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Find Mitre Attack Techniques
   * @param query - The query to find the techniques
   * @returns The techniques
   */
  findMitreAttackTechniques = async ({ query }: { query: object }): Promise<MitreAttackTechnique[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreAttackTechniques: MitreAttackTechnique[] }>({
        query: FIND_MITRE_ATTACK_TECHNIQUE,
        variables: { filter: query },
        action: 'findMitreAttackTechniques',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreAttackTechniques || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get Mitre Attack Tactics
   * @returns The tactics
   */
  getMitreAttackTactics = async (): Promise<MitreAttackTactic[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreAttackTactics: MitreAttackTactic[] }>({
        query: GET_MITRE_ATTACK_TACTICS,
        action: 'getMitreAttackTactics',
        fetchPolicy: 'network-only'
      })
      
      if (response.mitreAttackTactics) {
        // Create a mutable copy before sorting since GraphQL responses are often frozen
        return [...response.mitreAttackTactics].sort(
          (a: MitreAttackTactic, b: MitreAttackTactic) =>
            this.tacticRank(a.name) - this.tacticRank(b.name)
        )
      }
      return []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get Mitre Attack Techniques by Tactic
   * @param tacticId - The ID of the tactic
   * @returns The techniques
   */
  getMitreAttackTechniquesByTactic = async ({ tacticId }: { tacticId: string }): Promise<MitreAttackTechnique[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreAttackTactics: Array<{ techniques: MitreAttackTechnique[] }> }>({
        query: GET_MITRE_ATTACK_TECHNIQUES_BY_TACTIC,
        variables: { mitreAttackTacticId: tacticId },
        action: 'getMitreAttackTechniquesByTactic',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreAttackTactics?.[0]?.techniques || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get Mitre Attack Mitigations
   * @returns The mitigations
   */
  getMitreAttackMitigations = async (): Promise<MitreAttackMitigation[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreAttackMitigations: MitreAttackMitigation[] }>({
        query: GET_MITRE_ATTACK_MITIGATIONS,
        action: 'getMitreAttackMitigations',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreAttackMitigations || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get Mitre Attack Technique
   * @param attackId - The ID of the attack
   * @returns The technique
   */
  getMitreAttackTechnique = async (
    { attackId }:
    { attackId: string }):
  Promise<MitreAttackTechnique | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreAttackTechniques: MitreAttackTechnique[] }>({
        query: GET_MITRE_ATTACK_TECHNIQUE,
        variables: { attack_id: attackId },
        action: 'getMitreAttackTechnique',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreAttackTechniques?.[0] || null
    } catch (error) {
      return null
    }
  }

  /**
   * Get Mitre Attack Mitigation
   * @param attackId - The ID of the attack
   * @returns The mitigation
   */
  getMitreAttackMitigation = async (
    { attackId }:
    { attackId: string }):
  Promise<MitreAttackMitigation | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ mitreAttackMitigations: MitreAttackMitigation[] }>({
        query: GET_MITRE_ATTACK_MITIGATION,
        variables: { attack_id: attackId },
        action: 'getMitreAttackMitigation',
        fetchPolicy: 'network-only'
      })
      
      return response.mitreAttackMitigations?.[0] || null
    } catch (error) {
      return null
    }
  }
}
