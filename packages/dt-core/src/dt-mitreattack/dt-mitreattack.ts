import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
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
  private apolloClient: ApolloClient<NormalizedCacheObject>
  private  tacticsOrder = (['Reconnaissance', 'Resource Development', 'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access', 'Discovery', 'Lateral Movement', 'Collection', 'Command and Control', 'Exfiltration', 'Impact'])

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
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
            this.tacticsOrder.indexOf(a.name || '') - this.tacticsOrder.indexOf(b.name || '')
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
