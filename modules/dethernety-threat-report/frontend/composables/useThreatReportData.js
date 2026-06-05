// frontend/composables/useThreatReportData.js — the module's data-access seam.
//
// The single place the report reads the graph, always through the host's
// dtUtils (useHostContext().utils.dtUtils) — never a module-private Apollo
// client and never a hand-rolled fetch. Holds the live structural fingerprint
// (for staleness) and the live graded-coverage fetch; both share the same
// dedup/cancel discipline.

import { THREAT_REPORT_FINGERPRINT, GRADED_COVERAGE } from '../graphql/queries.js'

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

/**
 * Fetch + parse the graded MITRE coverage facts for a model.
 *
 * Returns the parsed CoverageResult object (see dethernety-coverage-tools'
 * aggregateCoverage), or null when coverage is UNAVAILABLE — which is a normal,
 * non-error state, not a failure:
 *   - the `gradedCoverage` field is absent (coverage-tools not deployed) → the
 *     query errors and we degrade to null so the report ships without the
 *     Coverage & Gaps matrix (never a silent-green empty grid; the caller renders the
 *     "coverage module not available" / never-generated affordance instead);
 *   - the resolver returns null (no/empty modelId);
 *   - a superseded call (CancelledError) — only the latest answer drives the UI.
 * A parse failure is logged and also degrades to null (never a torn matrix).
 *
 * Same withCancellableLatest + performQuery(network-only) discipline as the
 * fingerprint fetch.
 *
 * @param {object} dtUtils  host dtUtils (useHostContext().utils.dtUtils)
 * @param {string} modelId  the model (analysis scope) id
 * @returns {Promise<object|null>} the parsed coverage facts, or null if unavailable
 */
export async function fetchGradedCoverage(dtUtils, modelId) {
  if (!dtUtils || !modelId) return null
  let raw
  try {
    const data = await dtUtils.withCancellableLatest(
      `threat-report-coverage:${modelId}`,
      () =>
        dtUtils.performQuery({
          query: GRADED_COVERAGE,
          variables: { modelId },
          action: 'gradedCoverage',
          fetchPolicy: 'network-only',
        }),
    )
    raw = data?.gradedCoverage ?? null
  } catch (err) {
    if (err?.name === 'CancelledError' || err?.constructor?.name === 'CancelledError') {
      return null
    }
    // Field-absent (coverage-tools not deployed) or a network failure: degrade
    // to null — the report renders its no-coverage affordance, never a fake grid.
    console.error('[threat-report] graded coverage fetch failed:', err)
    return null
  }
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error('[threat-report] graded coverage parse failed:', err)
    return null
  }
}
