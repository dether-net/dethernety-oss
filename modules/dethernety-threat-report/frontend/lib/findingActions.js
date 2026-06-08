// frontend/lib/findingActions.js — the lifecycle×provenance action state machine
// for a single finding, as a pure function (no Vue, no host access). Mirrors the
// dt-ui exposures tab (SettingsExposuresTab.vue) but report-scoped: the report is a
// read view, so attribute authoring (edit/create exposure) is omitted — every other
// disposition/affirmation action is offered and routed to the host via the
// FindingActions.vue leaf's events.
//
// Each descriptor is { key, icon, label, title, event, accent? }:
//   - key    : stable identity for v-for / tests
//   - icon   : the compact glyph rendered (icon-button form, like the dt-ui 2×2);
//              the text label rides in the tooltip + aria-label
//   - label  : accessible name (aria-label)
//   - title  : tooltip text
//   - event  : the semantic event FindingActions.vue emits when clicked
//   - accent : optional visual accent — 'affirm' (distinct cyan, reads at a glance),
//              'danger' (delete), 'warn' (stale review); undefined = neutral chrome.
//
// Order is the 2×2 reading order: the triage/lifecycle action(s) lead, then the
// structural action (supersede), then Issue last — so a pending SYSTEM row reads as
// [Affirm Dispose] / [Supersede Issue] and fewer-action states degrade cleanly.

import { lifecycleStatus, provenanceOf, dispositionKindLabel } from './aggregateLedger.js'

const ISSUE = { key: 'issue', icon: '⚑', label: 'Issue', title: 'Copy to the Issues board', event: 'issue' }
// The user-facing action is "Customize" (matching the model UI's "Customize as
// an editable copy"); "Superseded" is the resulting STATE of the original, not
// the action. The internal key/event stay `supersede` (the host service +
// SUPERSEDED disposition kind).
const SUPERSEDE = {
  key: 'supersede',
  icon: '⧉',
  label: 'Customize',
  title: 'Customize as an editable copy — the original is marked superseded',
  event: 'supersede',
}

/**
 * The ordered action descriptors for a finding.
 *
 * @param {object} finding a ledger finding (raw or aggregateLedger-annotated)
 * @returns {Array<{key,label,title,event,accent?}>}
 */
export function actionsFor(finding) {
  if (!finding) return []

  // USER-authored findings are owned by the user: delete + issue. No affirm/dispose
  // (a finding the user wrote is theirs to remove, not to triage), no attribute
  // edit (out of a read report's scope).
  if (provenanceOf(finding) === 'USER') {
    return [
      { key: 'delete', icon: '🗑', label: 'Delete', title: 'Delete this finding', event: 'delete', accent: 'danger' },
      ISSUE,
    ]
  }

  // SYSTEM. A stale disposition (model changed since it was authored) leads with a
  // single Review that re-opens the right dialog — re-affirm when it's a live
  // confirmation, else the dispose dialog.
  if (finding.dispositionStale === true) {
    const confirmed = lifecycleStatus(finding) === 'confirmed'
    return [
      {
        key: 'review',
        icon: '⟳',
        label: 'Review',
        title: 'Model changed — review and re-affirm this finding',
        event: confirmed ? 'add-note' : 'dispose',
        accent: 'warn',
      },
      ISSUE,
    ]
  }

  switch (lifecycleStatus(finding)) {
    // Un-triaged live finding — the full 2×2.
    case 'pending':
      return [
        { key: 'affirm', icon: '✓', label: 'Affirm', title: 'Affirm — confirm this is a real, live risk', event: 'affirm', accent: 'affirm' },
        { key: 'dispose', icon: '⊘', label: 'Dispose', title: 'Dispose — mute with a reason (not applicable, accepted, …)', event: 'dispose' },
        SUPERSEDE,
        ISSUE,
      ]
    // Affirmed & attributed (kept live) — revisit the confirmation, restructure, issue.
    case 'confirmed':
      return [
        { key: 'add-note', icon: '✎', label: 'Add note', title: 'Add a note to this confirmation', event: 'add-note' },
        SUPERSEDE,
        ISSUE,
      ]
    // Disposed (muted partition) — edit the existing disposition, or raise an issue.
    default:
      return [
        {
          key: 'edit',
          icon: '✎',
          label: 'Edit disposition',
          title: `Edit disposition (${dispositionKindLabel(finding.dispositionKind)})`,
          event: 'dispose',
        },
        ISSUE,
      ]
  }
}

/**
 * The inline lifecycle chip descriptor for a finding, or null when none applies.
 * Only an explicitly AFFIRMED-and-attributed (confirmed) finding earns a chip — so
 * an affirmed finding in the open table is no longer indistinguishable from an
 * un-triaged one. Risk-toned (NOT green, NOT a solid stoplight): a confirmed finding
 * is still an open risk. USER-born-confirmed gets no chip (it would be noise).
 *
 * @param {object} finding
 * @returns {{ text: string, title: string } | null}
 */
export function lifecycleChipFor(finding) {
  if (finding?.dispositionKind === 'AFFIRMED' && lifecycleStatus(finding) === 'confirmed') {
    return { text: 'Confirmed', title: 'Reviewed and confirmed as a real, live risk (kept open)' }
  }
  return null
}
