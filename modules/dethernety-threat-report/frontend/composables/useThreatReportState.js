// frontend/composables/useThreatReportState.js — the snapshot lifecycle state.
//
// State is a module-scoped reactive singleton (module-level refs), NOT a Pinia
// store: the host does not expose its Pinia instance to module bundles, and a
// module-local Pinia would be a separate, unsynced instance. One report renders
// at a time (the analysis-results page), so a single shared cell is correct;
// the root component resets it on mount.

import { ref } from 'vue'

/**
 * Pure lifecycle derivation — the single source of truth for which state the
 * report is in. Unit-tested directly (no Vue, no network).
 *
 *  - generating: a Generate/Recreate run is in flight (overrides everything).
 *  - never:      no snapshot has ever been generated → show the Generate CTA.
 *  - stale:      a snapshot exists but the live fingerprint no longer matches
 *                it → the model changed since generation; offer Recreate.
 *  - fresh:      a snapshot exists and still matches the live model.
 *
 * `live == null` (not yet fetched, or the fetch failed) is treated as "assume
 * fresh": we never cry stale on missing evidence (an honest empty-of-evidence
 * state, not a false alarm).
 */
export function deriveLifecycle({ generated, stored, live, generating }) {
  if (generating) return 'generating'
  if (!generated) return 'never'
  if (live && stored && live !== stored) return 'stale'
  return 'fresh'
}

// Module-scoped singletons shared by the root + ScopeBanner.
const generating = ref(false)
const liveFingerprint = ref(null)

export function useThreatReportState() {
  return { generating, liveFingerprint }
}
