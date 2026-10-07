import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import {
  Countermeasure,
  COUNTERMEASURE_TECHNIQUE_LINK_FIELDS,
  CountermeasureTechniqueLinks,
  DispositionKind,
  DispositionMutationResult,
} from '../interfaces/core-types-interface.js'
import { fromLinkConnection, techniqueLinkConnect, TechniqueLinkConnection } from '../dt-utils/technique-links.js'
import { buildLinkOps } from '../dt-utils/link-delta.js'
import { CREATE_COUNTERMEASURE, GET_COUNTERMEASURES_FROM_CONTROL, GET_COUNTERMEASURE, GET_COUNTERMEASURE_TECHNIQUE_LINKS, GET_COUNTERMEASURE_RESPONSE_LINKS, UPDATE_COUNTERMEASURE, DELETE_COUNTERMEASURE, DISPOSE_COUNTERMEASURE, CLEAR_COUNTERMEASURE_DISPOSITION, FLIP_SUPERSEDED_COUNTERMEASURE_STALE } from './dt-countermeasure-gql.js'

export class DtCountermeasure {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Get all countermeasures from a control
   * @param controlId - The ID of the control
   * @returns An array of countermeasures or null if an error occurs
   */
  getCountermeasuresFromControl = async (
    { controlId }: { controlId: string }
  ): Promise<Countermeasure[] | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ controls: Array<{ countermeasures: Countermeasure[] }> }>({
        query: GET_COUNTERMEASURES_FROM_CONTROL,
        variables: { controlId },
        action: 'getCountermeasuresFromControl',
        fetchPolicy: 'network-only'
      })
      
      if (response.controls && response.controls[0]?.countermeasures) {
        return response.controls[0].countermeasures
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a countermeasure by ID
   * @param countermeasureId - The ID of the countermeasure
   * @returns The countermeasure or null if an error occurs
   */
  getCountermeasure = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<Countermeasure | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ countermeasures: Countermeasure[] }>({
        query: GET_COUNTERMEASURE,
        variables: { countermeasureId },
        action: 'getCountermeasure',
        fetchPolicy: 'network-only'
      })
      
      if (response.countermeasures && response.countermeasures.length > 0) {
        return response.countermeasures[0]
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Every MITRE link of a countermeasure, with each edge's justification: every field in
   * COUNTERMEASURE_TECHNIQUE_LINK_FIELDS (ATT&CK, D3FEND and their ATLAS siblings).
   * @param countermeasureId - The ID of the countermeasure
   * @returns The links by field, or null when the countermeasure does not exist
   */
  getCountermeasureTechniqueLinks = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<CountermeasureTechniqueLinks | null> => {
    const response = await this.dtUtils.performQuery<{ countermeasures: Array<Record<string, TechniqueLinkConnection>> }>({
      query: GET_COUNTERMEASURE_TECHNIQUE_LINKS,
      variables: { countermeasureId },
      action: 'getCountermeasureTechniqueLinks',
      fetchPolicy: 'network-only'
    })
    const row = response.countermeasures?.[0]
    if (!row) return null
    const links: CountermeasureTechniqueLinks = {}
    for (const field of COUNTERMEASURE_TECHNIQUE_LINK_FIELDS) {
      links[field] = fromLinkConnection(row[`${field}Connection`])
    }
    return links
  }

  /**
   * Create a countermeasure
   * @param controlId - The ID of the control
   * @param countermeasure - The countermeasure to create
   * @param techniqueLinks - MITRE links to create with their justification, by field; a field given
   *   here replaces the countermeasure's own `mitigations` / `defendedTechniques` / `mitigationsAtlas` list
   * @returns The created countermeasure or false if an error occurs
   */
  createCountermeasure = async (
    { controlId, countermeasure, techniqueLinks }:
    { controlId: string, countermeasure: Countermeasure, techniqueLinks?: CountermeasureTechniqueLinks }
  ): Promise<Countermeasure | null> => {
    try {
      const links: CountermeasureTechniqueLinks = {
        mitigations: countermeasure.mitigations?.map(mitigation => ({ id: mitigation.id })),
        defendedTechniques: countermeasure.defendedTechniques?.map(technique => ({ id: technique.id })),
        mitigationsAtlas: countermeasure.mitigationsAtlas?.map(mitigation => ({ id: mitigation.id })),
        ...techniqueLinks,
      }
      const linkInput: Record<string, { connect: ReturnType<typeof techniqueLinkConnect>[] }> = {}
      for (const field of COUNTERMEASURE_TECHNIQUE_LINK_FIELDS) {
        const fieldLinks = links[field]
        if (fieldLinks?.length) {
          linkInput[field] = { connect: fieldLinks.map(techniqueLinkConnect) }
        }
      }
      const mutuationInput = {
        name: countermeasure.name,
        description: countermeasure.description,
        type: countermeasure.type,
        category: countermeasure.category,
        score: Number(countermeasure.score),
        references: countermeasure.references,
        addressedExposures: countermeasure.addressedExposures,
        control: {
          connect: {
            where: {
              node: { id: { eq: controlId } },
            },
          },
        },
        ...linkInput,
      }

      const createdCountermeasure = await this.dtUtils.performMutation<Countermeasure>({
        mutation: CREATE_COUNTERMEASURE,
        variables: { input: [mutuationInput] },
        dataPath: 'createCountermeasures.countermeasures[0]',
        action: 'createCountermeasure',
        deduplicationKey: `create-countermeasure-${controlId}-${countermeasure.name}`
      })
      
      return createdCountermeasure || null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a countermeasure
   * @param countermeasureId - The ID of the countermeasure
   * @param countermeasure - The countermeasure to update
   * @returns The updated countermeasure or false if an error occurs
   */
  updateCountermeasure = async (
    { countermeasureId, countermeasure }: { countermeasureId: string, countermeasure: Countermeasure }
  ): Promise<Countermeasure | null> => {
    return this.dtUtils.withMutex(`updateCountermeasure_${countermeasureId}`, async () => {
      try {
        // The MITRE links are written as a delta against the links the countermeasure has now:
        // only ids that left a list are disconnected and only new ids are connected, so a link
        // the user kept keeps its edge and the justification on it. A list the caller does not
        // give (undefined) is not written at all.
        // Read and write under one per-countermeasure mutex, as updateExposure does: two saves
        // in flight would otherwise both see a new id as missing and both connect it.
        const response = await this.dtUtils.performQuery<{ countermeasures: Array<Record<string, TechniqueLinkConnection>> }>({
          query: GET_COUNTERMEASURE_RESPONSE_LINKS,
          variables: { countermeasureId },
          action: 'updateCountermeasure',
          fetchPolicy: 'network-only'
        })
        const current = response.countermeasures?.[0]
        if (!current) {
          throw new Error(`updateCountermeasure: countermeasure ${countermeasureId} not found`)
        }
        const delta = (
          field: 'mitigations' | 'defendedTechniques' | 'mitigationsAtlas',
          list: Array<{ id: string }> | undefined,
        ) => list === undefined
          ? undefined
          : buildLinkOps(list.map(item => item.id), fromLinkConnection(current[`${field}Connection`]).map(link => link.id))
        const links = {
          mitigations: delta('mitigations', countermeasure.mitigations),
          defendedTechniques: delta('defendedTechniques', countermeasure.defendedTechniques),
          mitigationsAtlas: delta('mitigationsAtlas', countermeasure.mitigationsAtlas),
        }

        // @neo4j/graphql v7 wraps every UPDATE-input field in a *Mutations
        // type. Plain scalars become `StringScalarMutations` / `IntScalarMutations`
        // (object with `{ set }`); scalar lists become `ListStringMutations`
        // (object with `{ set, push, pop, popFront }`). Sending raw values fails
        // coercion (`Expected type "StringScalarMutations" to be an object`).
        // CREATE inputs still take plain types; only UPDATE is affected. Mirrors
        // the pattern in dt-control.updateControl.
        const mutuationInput = {
          name: { set: countermeasure.name },
          description: { set: countermeasure.description },
          type: { set: countermeasure.type },
          category: { set: countermeasure.category },
          score: { set: Number(countermeasure.score) },
          references: { set: countermeasure.references },
          addressedExposures: { set: countermeasure.addressedExposures ?? [] },
          ...Object.fromEntries(Object.entries(links).filter(([, ops]) => ops !== undefined)),
        }

        const updatedCountermeasure = await this.dtUtils.performMutation<Countermeasure>({
          mutation: UPDATE_COUNTERMEASURE,
          variables: { countermeasureId, input: mutuationInput },
          dataPath: 'updateCountermeasures.countermeasures[0]',
          action: 'updateCountermeasure',
          deduplicationKey: `update-countermeasure-${countermeasureId}`
        })

        return updatedCountermeasure || null
      } catch (error) {
        throw error
      }
    })
  }


  /**
   * Delete a countermeasure.
   *
   * On USER-copy delete, fires a
   * fire-and-forget `updateCountermeasures` follow-up to flip
   * `dispositionStale: true` on any SYSTEM countermeasure previously superseded
   * by this USER copy. The companion match keys on the single-quote-wrapped name
   * in `dispositionReason` emitted by the Supersede flow. Companion failures are
   * logged, never thrown. Mirrors `dt-exposure.deleteExposure`.
   *
   * @param countermeasureId - The ID of the countermeasure
   * @param countermeasureName - The countermeasure's `name` captured BEFORE delete.
   *   Optional: when omitted the companion is skipped (the only safe default —
   *   without a name a wildcard substring match would flip unrelated dispositions).
   * @returns True if the countermeasure was deleted, false otherwise
   */
  deleteCountermeasure = async (
    { countermeasureId, countermeasureName }: { countermeasureId: string, countermeasureName?: string }
  ): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<any>({
        mutation: DELETE_COUNTERMEASURE,
        variables: { countermeasureId },
        dataPath: 'deleteCountermeasures',
        action: 'deleteCountermeasure',
        deduplicationKey: false // Disable deduplication for delete operations
      })

      if (response) {
        // Companion call — fire-and-forget. Failure does not block the delete return.
        if (countermeasureName) {
          void this.flipSupersededCountermeasureStaleByName(countermeasureName).catch(error => {
            this.dtUtils.handleError({
              action: 'flipSupersededCountermeasureStaleByName',
              error,
              context: { deletedCountermeasureId: countermeasureId, deletedCountermeasureName: countermeasureName },
            })
          })
        }
        return true
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * Author or replace a disposition
   * on a countermeasure. Calls the `disposeCountermeasure` custom mutation.
   * Domain errors (validation, not-found, database) return `success: false` with
   * `errorCode` + `errorMessage` set; transport / network errors propagate via
   * `performMutation`. Mirrors `dt-exposure.disposeExposure`.
   */
  disposeCountermeasure = async (
    { countermeasureId, kind, reason }:
    { countermeasureId: string, kind: DispositionKind, reason: string }
  ): Promise<DispositionMutationResult> => {
    return this.dtUtils.performMutation<DispositionMutationResult>({
      mutation: DISPOSE_COUNTERMEASURE,
      variables: { countermeasureId, kind, reason },
      dataPath: 'disposeCountermeasure',
      action: 'disposeCountermeasure',
    })
  }

  /**
   * Clear a countermeasure
   * disposition. Idempotent — a no-op clear on an already-undispositioned
   * countermeasure returns `success: true` with all five disposition fields null.
   * Mirrors `dt-exposure.clearDisposition`.
   */
  clearCountermeasureDisposition = async (
    { countermeasureId }: { countermeasureId: string }
  ): Promise<DispositionMutationResult> => {
    return this.dtUtils.performMutation<DispositionMutationResult>({
      mutation: CLEAR_COUNTERMEASURE_DISPOSITION,
      variables: { countermeasureId },
      dataPath: 'clearCountermeasureDisposition',
      action: 'clearCountermeasureDisposition',
    })
  }

  /**
   * Private companion: flip `dispositionStale: true` on any SYSTEM countermeasure
   * whose `dispositionReason` contains the single-quote-wrapped form of the deleted
   * USER copy's name. Match relies on the wrapping emitted by the Supersede flow:
   * the reason text reads `Superseded by user-authored countermeasure
   * '<name>'`, so the filter searches for the substring `'<name>'` (with quotes) to
   * suppress false positives where the bare name appears in unrelated prose.
   * This accepts the residual substring false-positive
   * risk; the structured-backreference v2 is the same deferred fix as the exposure side.
   * Mirrors `dt-exposure.flipSupersededStaleByName`.
   *
   * Scope: like the exposure companion, the `where` carries no model/tenant
   * filter and is safe under the one-database-per-tenant/model deployment
   * invariant. A shared-database deployment would need element-scoped filtering.
   *
   * All failures are caught and logged here — the caller's outer `.catch()` is
   * belt-and-braces.
   *
   * @neo4j/graphql v7 filter syntax: `{ contains: <value> }`.
   */
  private flipSupersededCountermeasureStaleByName = async (countermeasureName: string): Promise<void> => {
    try {
      const response = await this.dtUtils.performMutation({
        mutation: FLIP_SUPERSEDED_COUNTERMEASURE_STALE,
        variables: {
          where: {
            dispositionKind: { eq: 'SUPERSEDED' },
            dispositionReason: { contains: `'${countermeasureName}'` },
          },
          update: {
            dispositionStale: { set: true },
          },
        },
        dataPath: 'updateCountermeasures',
        action: 'flipSupersededCountermeasureStaleByName',
      })
      if (!response) {
        console.warn('flipSupersededCountermeasureStaleByName: companion mutation returned null', {
          deletedCountermeasureName: countermeasureName,
        })
      }
    } catch (error) {
      this.dtUtils.handleError({
        action: 'flipSupersededCountermeasureStaleByName',
        error,
        context: { deletedCountermeasureName: countermeasureName },
      })
    }
  }
}
