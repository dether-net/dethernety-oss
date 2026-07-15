/**
 * Shared disposition-surface logic for both finding types (Exposure and
 * Countermeasure). Lifted out of SettingsExposuresTab so the exposure tab and
 * the ControlDialog countermeasures sub-table render dispositions identically
 * and can't drift.
 *
 * Holds the pure / mostly-pure pieces: provenance icon matrix, kind label,
 * active-before-disposed sort, stale row class, and the dialog-state shape +
 * opener. The Supersede orchestration stays in each host — the stores and
 * orchestrators differ (flowStore.supersedeExposure vs
 * controlsStore.supersedeCountermeasure) — but the partial-failure copy uses
 * the shared ERROR_MESSAGES map.
 */

import { computed } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import type { DispositionKind, DispositionErrorCode } from '@dethernety/dt-core'

export type FindingType = 'EXPOSURE' | 'COUNTERMEASURE'
export type ProvenanceKind = 'user' | 'system' | 'none'

export interface ProvenanceDisplay {
  kind: ProvenanceKind
  tooltip: string
  iconName: string
  iconColor: string
}

/** Structural shape both Exposure and Countermeasure satisfy. */
export interface DispositionableFinding {
  id: string
  name?: string | null
  createdBy?: string | null
  authoredBy?: string | null
  dispositionKind?: DispositionKind | null
  dispositionReason?: string | null
  dispositionedBy?: string | null
  dispositionedAt?: string | null
  dispositionStale?: boolean | null
}

export interface DispositionDialogState {
  show: boolean
  findingId: string
  findingName: string
  initialKind: DispositionKind | null
  initialReason: string
  isStale: boolean
  lockKind: boolean
  initialDispositionedBy: string
  initialDispositionedAt: string
}

export interface SnackBarState {
  show: boolean
  color: 'success' | 'error' | 'warning' | 'info'
  message: string
  action?: { label: string; handler: () => Promise<void> | void } | null
  // Explicit auto-dismiss window (ms). When set it overrides the default
  // `action ? -1 : 5000` rule, so an actioned snackbar (e.g. affirm + Undo) can
  // still auto-dismiss instead of lingering forever.
  timeout?: number
}

// Icon pinned to mdi-shield-off-outline for both finding types — most direct
// semantic match for "this finding is dispositioned"; glyph parity with the
// exposure side preserves the recognition cue.
const DISPOSE_ICON = 'mdi-shield-off-outline'

// One-click affirm action — an icon (no text label) so the row's action cluster
// stays a compact grid of equal-size icon buttons.
const AFFIRM_ICON = 'mdi-check-circle-outline'

// User-language snackbar copy. Raw errorCode enum values stay in the console /
// monitoring path, never in user-facing copy. EXPOSURE_NOT_FOUND is reused as
// the not-found code for both finding types; its copy is
// noun-agnostic.
const ERROR_MESSAGES: Record<DispositionErrorCode | string, string> = {
  DATABASE_ERROR: 'a server error',
  EXPOSURE_NOT_FOUND: 'the original was already removed',
  VALIDATION_ERROR: 'an input error',
}

const KIND_LABELS: Record<DispositionKind, string> = {
  NOT_APPLICABLE: 'Not Applicable',
  FALSE_POSITIVE: 'False Positive',
  COMPENSATING_CONTROL: 'Compensating Control',
  RISK_ACCEPTED: 'Risk Accepted',
  WAIVED: 'Waived',
  SUPERSEDED: 'Superseded',
  AFFIRMED: 'Affirmed',
}

export function dispositionKindLabel(kind: DispositionKind | null | undefined): string {
  return kind ? KIND_LABELS[kind] ?? '' : ''
}

// ===== Lifecycle derivation =====
// `pending` / `confirmed` / `disposed` are DERIVED from dispositionKind + provenance,
// never stored. AFFIRMED is the one kind that keeps a finding LIVE; every other kind
// mutes it. A USER-authored undisposed finding is born `confirmed`; a SYSTEM (or
// legacy-null) one is `pending` until reviewed.

export type LifecycleStatus = 'pending' | 'confirmed' | 'disposed'

/** A finding is live (not muted) when it has no disposition, or is explicitly AFFIRMED. */
export function isLiveKind(kind: DispositionKind | null | undefined): boolean {
  return kind == null || kind === 'AFFIRMED'
}

export function isLive(item: DispositionableFinding): boolean {
  return isLiveKind(item.dispositionKind)
}

export function lifecycleStatus(item: DispositionableFinding): LifecycleStatus {
  const k = item.dispositionKind ?? null
  // Forensic guard: an AFFIRMED write with no server-stamped actor (an unattributed
  // direct-GraphQL spoof) is NOT a real confirmation — derive `pending`, not `confirmed`.
  if (k === 'AFFIRMED') return item.dispositionedBy ? 'confirmed' : 'pending'
  if (k != null) return 'disposed'
  return item.createdBy === 'USER' ? 'confirmed' : 'pending'
}

/** Default affirm reason, branched by finding type — satisfies the mandatory-reason contract. */
export function affirmReasonFor(findingType: FindingType): string {
  return findingType === 'COUNTERMEASURE'
    ? 'Confirmed this countermeasure is in place.'
    : 'Confirmed as a live risk.'
}

export interface LifecycleBadge {
  kind: LifecycleStatus
  text: string
  color: string
  variant: 'flat' | 'outlined'
}

/**
 * Presentation descriptor for a finding's lifecycle badge, or `null` when the row
 * should carry NO per-row chip (pending — surfaced by the per-tab PendingBadge so a
 * fresh model's backlog doesn't make every row look alarming). Type-asymmetric:
 *  - confirmed → a FILLED chip. Exposure = "Confirmed risk", risk-toned (NEVER green —
 *    a confirmed exposure is bad news). Countermeasure = "In place", green/success
 *    (the one place green is right — a present control is good news).
 *  - disposed → the existing outlined kind chip.
 *  - pending → null. An AFFIRMED finding with a null `dispositionedBy` derives pending
 *    (forensic guard), so no "Confirmed" badge is ever manufactured for an unattributed affirm.
 */
export function lifecycleBadgeFor(
  item: DispositionableFinding,
  findingType: FindingType,
): LifecycleBadge | null {
  const status = lifecycleStatus(item)
  if (status === 'pending') return null
  if (status === 'confirmed') {
    return findingType === 'COUNTERMEASURE'
      ? { kind: 'confirmed', text: 'In place', color: 'success', variant: 'flat' }
      // 'error' (not 'warning'): risk-toned and distinct from the stale-row warning
      // border / Review button, so a confirmed risk doesn't read as "needs review".
      : { kind: 'confirmed', text: 'Confirmed risk', color: 'error', variant: 'flat' }
  }
  return {
    kind: 'disposed',
    text: dispositionKindLabel(item.dispositionKind),
    // No explicit colour — a muted/disposed chip stays the quiet outlined default
    // (matches the pre-lifecycle chip; '' → undefined at the binding site).
    color: '',
    variant: 'outlined',
  }
}

/** Affirm-edit dialog title — lifecycle-aware, never "Dispose". */
export function affirmDialogTitleFor(findingType: FindingType, isStale: boolean): string {
  const noun = findingType === 'COUNTERMEASURE' ? 'Countermeasure' : 'Exposure'
  return isStale ? `Review ${noun}` : `Re-affirm ${noun}`
}

/** Save-button label: affirm-aware when the dialog is locked to AFFIRMED, else the dispose default. */
export function saveLabelFor(
  lockKind: boolean,
  initialKind: DispositionKind | null,
  isStale: boolean,
): string {
  if (lockKind && initialKind === 'AFFIRMED') return isStale ? 'Re-affirm' : 'Affirm'
  return isStale ? 'Re-affirm' : 'Save'
}

/** Active (undisposed OR affirmed) findings first, disposed at the bottom; intra-group order preserved. */
export function partitionAndSort<T extends { dispositionKind?: DispositionKind | null }>(items: T[]): T[] {
  const active: T[] = []
  const disposed: T[] = []
  for (const item of items) {
    if (item.dispositionKind && item.dispositionKind !== 'AFFIRMED') disposed.push(item)
    else active.push(item)
  }
  return [...active, ...disposed]
}

export function rowClass(item: { dispositionStale?: boolean | null }): string {
  return item.dispositionStale ? 'row-stale' : ''
}

export function emptyDispositionDialogState(): DispositionDialogState {
  return {
    show: false,
    findingId: '',
    findingName: '',
    initialKind: null,
    initialReason: '',
    isStale: false,
    lockKind: false,
    initialDispositionedBy: '',
    initialDispositionedAt: '',
  }
}

/**
 * Seed the dialog's editable reason. A caller-supplied `prefillReason` is a convenience
 * default only, never a replacement: it seeds the field when the finding has no authored
 * reason, and is appended after a blank line when one already exists — so author-written
 * text is never silently overwritten. With no prefill the result is the existing reason
 * (or ''), exactly as before this seam.
 */
export function seedDialogReason(
  existingReason: string | null | undefined,
  prefillReason?: string,
): string {
  const existing = existingReason ?? ''
  const prefill = prefillReason ?? ''
  if (!prefill) return existing // no prefill → unchanged
  if (!existing.trim()) return prefill // no authored text → seed with the prefill
  return `${existing}\n\n${prefill}` // author text wins; prefill appended after a blank line
}

/**
 * Build the open-dialog state from a finding row (dispose / re-affirm entry point).
 * An optional `prefillReason` seeds the editable reason per {@link seedDialogReason}
 * (only when the finding has no authored reason; appended after a blank line otherwise).
 */
export function dispositionStateFor(
  item: DispositionableFinding,
  prefillReason?: string,
): DispositionDialogState {
  return {
    show: true,
    findingId: item.id,
    findingName: item.name ?? '',
    initialKind: item.dispositionKind ?? null,
    initialReason: seedDialogReason(item.dispositionReason, prefillReason),
    isStale: Boolean(item.dispositionStale),
    lockKind: false,
    initialDispositionedBy: item.dispositionedBy ?? '',
    initialDispositionedAt: item.dispositionedAt ?? '',
  }
}

/**
 * Build the open-dialog state for the affirm-edit path (stale re-affirm / "Add note…").
 * The kind is locked to AFFIRMED so the dialog never converts a confirmed finding into a
 * disposal; only the reason is editable. Consumed by the affirm-edit dialog variant.
 * An optional `prefillReason` seeds the editable reason per {@link seedDialogReason}
 * (only when the finding has no authored reason; appended after a blank line otherwise).
 */
export function affirmDialogStateFor(
  item: DispositionableFinding,
  prefillReason?: string,
): DispositionDialogState {
  return {
    show: true,
    findingId: item.id,
    findingName: item.name ?? '',
    initialKind: 'AFFIRMED',
    initialReason: seedDialogReason(item.dispositionReason, prefillReason),
    isStale: Boolean(item.dispositionStale),
    lockKind: true,
    initialDispositionedBy: item.dispositionedBy ?? '',
    initialDispositionedAt: item.dispositionedAt ?? '',
  }
}

export function useFindingDisposition() {
  const authStore = useAuthStore()
  const currentUserId = computed(() => authStore.user?.id ?? null)

  const provenanceInfo = (item: DispositionableFinding): ProvenanceDisplay => {
    const createdBy = item.createdBy ?? null
    const authoredBy = item.authoredBy ?? null
    if (createdBy === 'USER') {
      const isSelf = authoredBy && currentUserId.value && authoredBy === currentUserId.value
      return {
        kind: 'user',
        tooltip: isSelf ? 'Authored by you' : `Authored by ${authoredBy ?? 'a user'}`,
        iconName: 'mdi-account-outline',
        iconColor: 'primary',
      }
    }
    if (createdBy === 'SYSTEM' && authoredBy) {
      return {
        kind: 'system',
        tooltip: `Source: ${authoredBy}`,
        iconName: 'mdi-database-outline',
        iconColor: 'grey',
      }
    }
    return { kind: 'none', tooltip: '', iconName: '', iconColor: '' }
  }

  const isUserAuthored = (item: DispositionableFinding): boolean => item.createdBy === 'USER'

  return {
    currentUserId,
    provenanceInfo,
    isUserAuthored,
    dispositionKindLabel,
    isLiveKind,
    isLive,
    lifecycleStatus,
    lifecycleBadgeFor,
    affirmReasonFor,
    partitionAndSort,
    rowClass,
    emptyDispositionDialogState,
    dispositionStateFor,
    affirmDialogStateFor,
    DISPOSE_ICON,
    AFFIRM_ICON,
    ERROR_MESSAGES,
  }
}
