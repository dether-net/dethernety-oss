import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { DispositionKind, DispositionMutationResult, Exposure } from '../interfaces/core-types-interface.js'
import {
  GET_EXPOSURES,
  GET_EXPOSURE,
  ADD_EXPOSURE,
  UPDATE_EXPOSURE,
  DELETE_EXPOSURE,
  DISPOSE_EXPOSURE,
  CLEAR_DISPOSITION,
  FLIP_SUPERSEDED_STALE,
} from './dt-exposure-gql.js'

export class DtExposure {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  /**
   * Get all exposures for an element
   * @param elementId - The ID of the element to get exposures for
   * @returns An array of exposures
   */
  getExposures = async ({ elementId }: { elementId: string }): Promise<Exposure[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ getExposuresForElement: Exposure[] }>({
        query: GET_EXPOSURES,
        variables: { elementId },
        action: 'getExposures',
        fetchPolicy: 'network-only'
      })
      
      return response.getExposuresForElement || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get an exposure by ID
   * @param exposureId - The ID of the exposure to get
   * @returns The exposure
   */
  getExposure = async ({ exposureId }: { exposureId: string }): Promise<Exposure> => {
    const mutexKey = `getExposure_${exposureId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const response = await this.apolloClient.query({
          query: GET_EXPOSURE,
          variables: { exposureId },
          fetchPolicy: 'network-only',
        })
        return (response.data as any).exposures[0]
      } catch (error) {
        this.dtUtils.handleError({ action: 'getExposure', error })
        throw error
      }
    })
  }

  /**
   * Create an exposure
   * @param exposure - The exposure to create
   * @param elementId - The ID of the element to create the exposure for
   * @param attackTechniqueIds - The IDs of the attack techniques to connect to the exposure
   * @returns The created exposure
   */
  createExposure = async (
    { exposure, elementId, attackTechniqueIds }:
    { exposure: Exposure, elementId: string, attackTechniqueIds: string[] }
  ): Promise<Exposure> => {
    try {
      const variables = {
        input: {
          name: exposure.name,
          description: exposure.description,
          type: Number.parseInt(exposure.type ?? '0'),
          category: exposure.category,
          score: exposure.score,
          attackVector: exposure.attackVector ?? null,
          element: {
            connect: { where: { node: { id: { eq: elementId } } } },
          },
          exploitedBy: {
            connect: attackTechniqueIds.map(attackTechniqueId => ({ where: { node: { id: { eq: attackTechniqueId } } } })),
          },
        },
      }
      
      const response = await this.dtUtils.performMutation<Exposure>({
        mutation: ADD_EXPOSURE,
        variables,
        dataPath: 'createExposures.exposures[0]',
        action: 'createExposure',
        deduplicationKey: `create-exposure-${elementId}-${exposure.name}`
      })
      
      return response
    } catch (error) {
      throw error
    }
  }

  /**
   * Update an exposure
   * @param exposureId - The ID of the exposure to update
   * @param exposure - The exposure to update
   * @param attackTechniqueIds - The IDs of the attack techniques to connect to the exposure
   * @returns The updated exposure
   */
  updateExposure = async (
    { exposureId, exposure, attackTechniqueIds }:
    { exposureId: string, exposure: Exposure, attackTechniqueIds: string[] }
  ): Promise<Exposure> => {
    const mutexKey = `updateExposure_${exposureId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const variables = {
          exposureId,
          input: {
            name: { set: exposure.name },
            description: { set: exposure.description },
            type: { set: exposure.type },
            category: { set: exposure.category },
            score: { set: exposure.score },
            attackVector: { set: exposure.attackVector },
            exploitedBy: {
              disconnect: {},
              connect: attackTechniqueIds.map(id => ({ where: { node: { id: { eq: id } } } })),
            },
          },
        }
        const response = await this.dtUtils.performMutation<Exposure>({
          mutation: UPDATE_EXPOSURE,
          variables,
          dataPath: 'updateExposures.exposures[0]',
          action: 'updateExposure',
        })
        return response
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateExposure', error })
        throw error
      }
    })
  }

  /**
   * Delete an exposure.
   *
   * On USER-copy delete, fires a fire-and-forget
   * `updateExposures` follow-up to flip `dispositionStale: true` on any SYSTEM
   * exposure that was previously superseded by this USER copy. The companion
   * match keys on the single-quote-wrapped name in `dispositionReason` emitted
   * by `executeSupersedeFlow`. Companion failures are logged via
   * `dtUtils.handleError`, never thrown — invariant D5b.
   *
   * @param exposureId - The ID of the exposure to delete
   * @param exposureName - The exposure's `name` captured BEFORE delete. Optional:
   *   when omitted, the companion is skipped (the only safe default — without a
   *   name we cannot build the filter and a wildcard substring match would flip
   *   unrelated dispositions). Callers that want the companion path must capture
   *   the name from local state before invoking delete.
   */
  deleteExposure = async (
    { exposureId, exposureName }: { exposureId: string, exposureName?: string }
  ): Promise<boolean> => {
    const mutexKey = `deleteExposure_${exposureId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const variables = { exposureId }
        const response = await this.dtUtils.performMutation({
          mutation: DELETE_EXPOSURE,
          variables,
          dataPath: 'deleteExposures',
          action: 'deleteExposure',
        })
        if (response) {
          // Companion call — fire-and-forget. Failure does not block the delete return.
          // The companion itself swallows all errors internally (see implementation
          // below) so the outer .catch() here is belt-and-braces for any throws that
          // escape its try/catch (e.g. a sync error before the try block).
          if (exposureName) {
            void this.flipSupersededStaleByName(exposureName).catch(error => {
              this.dtUtils.handleError({
                action: 'flipSupersededStaleByName',
                error,
                context: { deletedExposureId: exposureId, deletedExposureName: exposureName },
              })
            })
          }
          return true
        }
        return false
      } catch (error) {
        this.dtUtils.handleError({ action: 'deleteExposure', error })
        return false
      }
    })
  }

  /**
   * Author or replace a disposition on an exposure. Calls the
   * `disposeExposure` custom mutation. Domain errors (validation, not-found,
   * database) return `success: false` with `errorCode` + `errorMessage` set;
   * transport / network errors propagate via `performMutation`. Backend Cypher
   * for re-affirm is identical to fresh authoring (always clears stale).
   *
   * Last-writer-wins; no client-side mutex.
   */
  disposeExposure = async (
    { exposureId, kind, reason }:
    { exposureId: string, kind: DispositionKind, reason: string }
  ): Promise<DispositionMutationResult> => {
    return this.dtUtils.performMutation<DispositionMutationResult>({
      mutation: DISPOSE_EXPOSURE,
      variables: { exposureId, kind, reason },
      dataPath: 'disposeExposure',
      action: 'disposeExposure',
    })
  }

  /**
   * Clear a disposition. Idempotent — a no-op clear on an
   * already-undispositioned exposure returns `success: true` with all five
   * disposition fields null.
   */
  clearDisposition = async (
    { exposureId }: { exposureId: string }
  ): Promise<DispositionMutationResult> => {
    return this.dtUtils.performMutation<DispositionMutationResult>({
      mutation: CLEAR_DISPOSITION,
      variables: { exposureId },
      dataPath: 'clearDisposition',
      action: 'clearDisposition',
    })
  }

  /**
   * Thin alias for disposeExposure. Backend Cypher is identical
   * (always clears stale). The alias exists for caller-narrative clarity —
   * "I'm re-affirming an existing stale disposition" reads differently from
   * "authoring fresh" even though the wire call is the same.
   */
  reAffirmDisposition = (args: {
    exposureId: string
    kind: DispositionKind
    reason: string
  }) => this.disposeExposure(args)

  /**
   * Private companion: flip `dispositionStale: true` on any SYSTEM exposure whose
   * `dispositionReason` contains the single-quote-wrapped form of the deleted
   * USER copy's name. Match relies on the wrapping emitted by
   * `executeSupersedeFlow`: the reason text always reads
   * `Superseded by user-authored exposure '<name>'`, so the filter searches for
   * the substring `'<name>'` (with quotes) to suppress false positives where
   * the bare name appears in unrelated narrative prose. This
   * accepts the residual substring false-positive risk for exposure names that
   * share substrings; the structured-backreference v2 is tracked as a follow-up.
   *
   * Scope: the `where` carries no model/tenant filter, so it matches across the
   * whole database. This is safe under the deployment invariant that each
   * tenant/model has its own database — a name collision cannot reach an
   * unrelated model. A shared-database deployment would need the filter scoped
   * to the deleted copy's element (pairs with the structured-backreference v2).
   *
   * All failures are caught and logged here — the caller's outer `.catch()` is
   * belt-and-braces.
   *
   * @neo4j/graphql v7 filter syntax: `{ contains: <value> }`.
   */
  private flipSupersededStaleByName = async (exposureName: string): Promise<void> => {
    try {
      const response = await this.dtUtils.performMutation({
        mutation: FLIP_SUPERSEDED_STALE,
        variables: {
          where: {
            dispositionKind: { eq: 'SUPERSEDED' },
            dispositionReason: { contains: `'${exposureName}'` },
          },
          update: {
            dispositionStale: { set: true },
          },
        },
        dataPath: 'updateExposures',
        action: 'flipSupersededStaleByName',
      })
      if (!response) {
        // Field-level error path: performMutation resolved without throwing
        // but the result envelope was null/falsy. handleError's network-error
        // gate would silently skip this; log explicitly so the failure is
        // visible in operator logs.

        console.warn('flipSupersededStaleByName: companion mutation returned null', {
          deletedExposureName: exposureName,
        })
      }
    } catch (error) {
      this.dtUtils.handleError({
        action: 'flipSupersededStaleByName',
        error,
        context: { deletedExposureName: exposureName },
      })
    }
  }
}