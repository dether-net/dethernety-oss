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
}

// Icon pinned to mdi-shield-off-outline for both finding types — most direct
// semantic match for "this finding is dispositioned"; glyph parity with the
// exposure side preserves the recognition cue.
const DISPOSE_ICON = 'mdi-shield-off-outline'

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
}

export function dispositionKindLabel(kind: DispositionKind | null | undefined): string {
  return kind ? KIND_LABELS[kind] ?? '' : ''
}

/** Active (undisposed) findings first, disposed at the bottom; intra-group order preserved. */
export function partitionAndSort<T extends { dispositionKind?: DispositionKind | null }>(items: T[]): T[] {
  const active: T[] = []
  const disposed: T[] = []
  for (const item of items) {
    if (item.dispositionKind) disposed.push(item)
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

/** Build the open-dialog state from a finding row (dispose / re-affirm entry point). */
export function dispositionStateFor(item: DispositionableFinding): DispositionDialogState {
  return {
    show: true,
    findingId: item.id,
    findingName: item.name ?? '',
    initialKind: item.dispositionKind ?? null,
    initialReason: item.dispositionReason ?? '',
    isStale: Boolean(item.dispositionStale),
    lockKind: false,
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
    partitionAndSort,
    rowClass,
    emptyDispositionDialogState,
    dispositionStateFor,
    DISPOSE_ICON,
    ERROR_MESSAGES,
  }
}
