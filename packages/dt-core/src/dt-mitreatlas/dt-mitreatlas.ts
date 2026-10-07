import { DtUtils } from '../dt-utils/dt-utils.js'
import * as Apollo from '@apollo/client'
import { MitreAtlasMitigation, MitreAtlasTactic, MitreAtlasTechnique } from '../interfaces/core-types-interface.js'
import { sortByMatrixOrder, warnUnplacedTactics } from '../dt-utils/matrix-order.js'
import {
  FIND_MITRE_ATLAS_TECHNIQUES,
  GET_MITRE_ATLAS_MITIGATIONS,
  GET_MITRE_ATLAS_TACTICS,
} from './dt-mitreatlas-gql.js'

/**
 * Read access to the MITRE ATLAS reference data. ATLAS is its own framework: its own types
 * and `atlas_id` key, and its own matrix, ordered by `matrix_order` like ATT&CK's.
 */
export class DtMitreAtlas {
  private dtUtils: DtUtils

  constructor(apolloClient: Apollo.ApolloClient) {
    this.dtUtils = new DtUtils(apolloClient)
  }

  /** ATLAS techniques matching a `MitreAtlasTechniqueWhere` filter, each with its tactics in matrix order. */
  findMitreAtlasTechniques = async ({ query }: { query: object }): Promise<MitreAtlasTechnique[]> => {
    const response = await this.dtUtils.performQuery<{ mitreAtlasTechniques: MitreAtlasTechnique[] }>({
      query: FIND_MITRE_ATLAS_TECHNIQUES,
      variables: { filter: query },
      action: 'findMitreAtlasTechniques',
      fetchPolicy: 'network-only'
    })
    return (response.mitreAtlasTechniques || []).map(technique => ({
      ...technique,
      tactics: technique.tactics ? sortByMatrixOrder(technique.tactics, tactic => tactic.atlas_id) : technique.tactics,
    }))
  }

  /** Every ATLAS mitigation. */
  getMitreAtlasMitigations = async (): Promise<MitreAtlasMitigation[]> => {
    const response = await this.dtUtils.performQuery<{ mitreAtlasMitigations: MitreAtlasMitigation[] }>({
      query: GET_MITRE_ATLAS_MITIGATIONS,
      action: 'getMitreAtlasMitigations',
      fetchPolicy: 'network-only'
    })
    return response.mitreAtlasMitigations || []
  }

  /** Every ATLAS tactic, in ATLAS matrix order; a tactic without a position sorts last. */
  getMitreAtlasTactics = async (): Promise<MitreAtlasTactic[]> => {
    const response = await this.dtUtils.performQuery<{ mitreAtlasTactics: MitreAtlasTactic[] }>({
      query: GET_MITRE_ATLAS_TACTICS,
      action: 'getMitreAtlasTactics',
      fetchPolicy: 'network-only'
    })
    const tactics = response.mitreAtlasTactics || []
    warnUnplacedTactics(tactics, 'MITRE ATLAS')
    return sortByMatrixOrder(tactics, tactic => tactic.atlas_id)
  }
}
