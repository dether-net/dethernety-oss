// frontend/composables/useThreatReportData.js — the module's data-access seam.
//
// The single place the report reads the graph, always through the host's
// dtUtils (useHostContext().utils.dtUtils) — never a module-private Apollo
// client and never a hand-rolled fetch. Sprint 1 needs only the live
// fingerprint; the batched exposures/controls fan-out for the ledger lands here
// in a later sprint, reusing the same dedup/cancel discipline.

import { THREAT_REPORT_FINGERPRINT } from '../graphql/queries.js'

/**
 * Fetch the live structural fingerprint for a model.
 *
 * Wrapped in dtUtils.withCancellableLatest keyed by model: if the report
 * re-queries (e.g. a fast Recreate) before an older call settles, the older
 * call rejects with CancelledError and we resolve to null — only the latest
 * answer drives the UI. dtUtils.performQuery additionally mutexes identical
 * concurrent (action, variables) pairs, so duplicate in-flight queries dedup.
 *
 * @param {object} dtUtils  host dtUtils (useHostContext().utils.dtUtils)
 * @param {string} modelId  the model (analysis scope) id
 * @returns {Promise<string|null>} the live fingerprint, or null if unavailable
 */
export async function fetchLiveFingerprint(dtUtils, modelId) {
  if (!dtUtils || !modelId) return null
  try {
    const data = await dtUtils.withCancellableLatest(
      `threat-report-fingerprint:${modelId}`,
      () =>
        dtUtils.performQuery({
          query: THREAT_REPORT_FINGERPRINT,
          variables: { modelId },
          action: 'threatReportFingerprint',
          fetchPolicy: 'network-only',
        }),
    )
    return data?.threatReportFingerprint ?? null
  } catch (err) {
    // A superseded call is expected churn, not an error — swallow to null.
    if (err?.name === 'CancelledError' || err?.constructor?.name === 'CancelledError') {
      return null
    }
    // A real failure: don't fabricate staleness — log and fall back to null
    // (deriveLifecycle treats null live as "assume fresh").
    console.error('[threat-report] live fingerprint fetch failed:', err)
    return null
  }
}
