/**
 * Unit tests for useFindingDisposition — the shared disposition-surface helpers
 * consumed by both SettingsExposuresTab and the ControlDialog countermeasures
 * sub-table. Mocks useAuthStore to
 * control currentUserId for the provenance matrix.
 */

import { describe, it, expect, vi } from 'vitest'

const mockAuthStore: { user: { id: string } | undefined } = { user: { id: 'u1' } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => mockAuthStore,
}))

import {
  useFindingDisposition,
  dispositionKindLabel,
  isLiveKind,
  isLive,
  lifecycleStatus,
  affirmReasonFor,
  lifecycleBadgeFor,
  affirmDialogTitleFor,
  saveLabelFor,
  partitionAndSort,
  rowClass,
  emptyDispositionDialogState,
  dispositionStateFor,
  affirmDialogStateFor,
  type DispositionableFinding,
} from '../useFindingDisposition'

describe('dispositionKindLabel', () => {
  it('labels every kind including WAIVED and AFFIRMED', () => {
    expect(dispositionKindLabel('NOT_APPLICABLE')).toBe('Not Applicable')
    expect(dispositionKindLabel('FALSE_POSITIVE')).toBe('False Positive')
    expect(dispositionKindLabel('COMPENSATING_CONTROL')).toBe('Compensating Control')
    expect(dispositionKindLabel('RISK_ACCEPTED')).toBe('Risk Accepted')
    expect(dispositionKindLabel('WAIVED')).toBe('Waived')
    expect(dispositionKindLabel('SUPERSEDED')).toBe('Superseded')
    expect(dispositionKindLabel('AFFIRMED')).toBe('Affirmed')
  })

  it('returns empty string for null / undefined', () => {
    expect(dispositionKindLabel(null)).toBe('')
    expect(dispositionKindLabel(undefined)).toBe('')
  })
})

describe('isLiveKind / isLive', () => {
  it('is live for null and AFFIRMED only', () => {
    expect(isLiveKind(null)).toBe(true)
    expect(isLiveKind(undefined)).toBe(true)
    expect(isLiveKind('AFFIRMED')).toBe(true)
  })

  it('is muted for every disposing kind', () => {
    for (const k of [
      'NOT_APPLICABLE',
      'FALSE_POSITIVE',
      'COMPENSATING_CONTROL',
      'RISK_ACCEPTED',
      'WAIVED',
      'SUPERSEDED',
    ] as const) {
      expect(isLiveKind(k)).toBe(false)
    }
  })

  it('isLive reads the finding row', () => {
    expect(isLive({ id: 'x', dispositionKind: 'AFFIRMED' })).toBe(true)
    expect(isLive({ id: 'x', dispositionKind: null })).toBe(true)
    expect(isLive({ id: 'x', dispositionKind: 'WAIVED' })).toBe(false)
  })
})

describe('lifecycleStatus', () => {
  it('SYSTEM + null ⇒ pending (AC-6)', () => {
    expect(lifecycleStatus({ id: 'x', createdBy: 'SYSTEM', dispositionKind: null })).toBe('pending')
  })

  it('legacy createdBy:null + null ⇒ pending (AC-6)', () => {
    expect(lifecycleStatus({ id: 'x', dispositionKind: null })).toBe('pending')
  })

  it('USER + null ⇒ confirmed, born-confirmed (AC-5)', () => {
    expect(lifecycleStatus({ id: 'x', createdBy: 'USER', dispositionKind: null })).toBe('confirmed')
  })

  it('AFFIRMED + server-stamped actor ⇒ confirmed', () => {
    expect(
      lifecycleStatus({ id: 'x', dispositionKind: 'AFFIRMED', dispositionedBy: 'auth0|x' }),
    ).toBe('confirmed')
  })

  it('AFFIRMED + no actor ⇒ pending, forensic guard (AC-8)', () => {
    expect(lifecycleStatus({ id: 'x', dispositionKind: 'AFFIRMED', dispositionedBy: null })).toBe(
      'pending',
    )
    expect(lifecycleStatus({ id: 'x', dispositionKind: 'AFFIRMED' })).toBe('pending')
  })

  it('any disposing kind ⇒ disposed', () => {
    for (const k of ['NOT_APPLICABLE', 'WAIVED', 'SUPERSEDED'] as const) {
      expect(lifecycleStatus({ id: 'x', createdBy: 'USER', dispositionKind: k })).toBe('disposed')
    }
  })

  it('un-affirm: clearing AFFIRMED (→ null) re-derives by provenance', () => {
    // SYSTEM finding: AFFIRMED → cleared ⇒ pending (AC-4)
    expect(lifecycleStatus({ id: 'x', createdBy: 'SYSTEM', dispositionKind: null })).toBe('pending')
    // USER finding: clearing any disposition ⇒ confirmed, never pending (AC-7)
    expect(lifecycleStatus({ id: 'x', createdBy: 'USER', dispositionKind: null })).toBe('confirmed')
  })
})

describe('affirmReasonFor', () => {
  it('branches the default reason by finding type', () => {
    expect(affirmReasonFor('EXPOSURE')).toBe('Confirmed as a live risk.')
    expect(affirmReasonFor('COUNTERMEASURE')).toBe('Confirmed this countermeasure is in place.')
  })
})

describe('lifecycleBadgeFor', () => {
  const affirmed = (over = {}): DispositionableFinding => ({
    id: 'x', dispositionKind: 'AFFIRMED', dispositionedBy: 'auth0|x', ...over,
  })

  it('exposure confirmed → "Confirmed risk", filled, risk-toned (never green)', () => {
    const b = lifecycleBadgeFor(affirmed(), 'EXPOSURE')
    expect(b).toMatchObject({ kind: 'confirmed', text: 'Confirmed risk', variant: 'flat' })
    expect(b?.color).not.toBe('success')
  })

  it('countermeasure confirmed → "In place", filled, green', () => {
    expect(lifecycleBadgeFor(affirmed(), 'COUNTERMEASURE')).toMatchObject({
      kind: 'confirmed', text: 'In place', color: 'success', variant: 'flat',
    })
  })

  it('disposed → outlined kind-label chip', () => {
    expect(lifecycleBadgeFor({ id: 'x', dispositionKind: 'WAIVED' }, 'COUNTERMEASURE')).toMatchObject({
      kind: 'disposed', text: 'Waived', variant: 'outlined',
    })
  })

  it('pending → null (no per-row chip)', () => {
    expect(lifecycleBadgeFor({ id: 'x', createdBy: 'SYSTEM', dispositionKind: null }, 'EXPOSURE')).toBeNull()
  })

  it('AFFIRMED with null dispositionedBy → null (forensic guard, no manufactured Confirmed)', () => {
    expect(lifecycleBadgeFor(affirmed({ dispositionedBy: null }), 'EXPOSURE')).toBeNull()
  })
})

describe('affirmDialogTitleFor / saveLabelFor', () => {
  it('affirm-edit title is lifecycle-aware and never "Dispose"', () => {
    expect(affirmDialogTitleFor('EXPOSURE', false)).toBe('Re-affirm Exposure')
    expect(affirmDialogTitleFor('COUNTERMEASURE', true)).toBe('Review Countermeasure')
    expect(affirmDialogTitleFor('EXPOSURE', false)).not.toContain('Dispose')
  })

  it('saveLabel is affirm-aware only when locked to AFFIRMED', () => {
    expect(saveLabelFor(true, 'AFFIRMED', false)).toBe('Affirm')
    expect(saveLabelFor(true, 'AFFIRMED', true)).toBe('Re-affirm')
    expect(saveLabelFor(false, 'RISK_ACCEPTED', false)).toBe('Save')
    expect(saveLabelFor(false, 'RISK_ACCEPTED', true)).toBe('Re-affirm')
  })
})

describe('partitionAndSort', () => {
  it('puts active (undisposed) findings before disposed, preserving intra-group order', () => {
    const items = [
      { id: 'a', dispositionKind: null },
      { id: 'b', dispositionKind: 'WAIVED' as const },
      { id: 'c', dispositionKind: null },
      { id: 'd', dispositionKind: 'NOT_APPLICABLE' as const },
    ]
    expect(partitionAndSort(items).map(i => i.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('keeps AFFIRMED in the active partition, not disposed', () => {
    const items = [
      { id: 'a', dispositionKind: 'AFFIRMED' as const },
      { id: 'b', dispositionKind: 'WAIVED' as const },
      { id: 'c', dispositionKind: null },
    ]
    expect(partitionAndSort(items).map(i => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op ordering when nothing is disposed', () => {
    const items = [{ id: 'a', dispositionKind: null }, { id: 'b', dispositionKind: null }]
    expect(partitionAndSort(items).map(i => i.id)).toEqual(['a', 'b'])
  })
})

describe('rowClass', () => {
  it('flags stale rows', () => {
    expect(rowClass({ dispositionStale: true })).toBe('row-stale')
    expect(rowClass({ dispositionStale: false })).toBe('')
    expect(rowClass({})).toBe('')
  })
})

describe('dispositionStateFor / emptyDispositionDialogState', () => {
  it('seeds the dialog state from a finding row', () => {
    const item: DispositionableFinding = {
      id: 'cm-1',
      name: 'MFA',
      dispositionKind: 'WAIVED',
      dispositionReason: 'internal tool',
      dispositionStale: true,
      dispositionedBy: 'auth0|x',
      dispositionedAt: '2026-05-20T00:00:00Z',
    }
    expect(dispositionStateFor(item)).toEqual({
      show: true,
      findingId: 'cm-1',
      findingName: 'MFA',
      initialKind: 'WAIVED',
      initialReason: 'internal tool',
      isStale: true,
      lockKind: false,
      initialDispositionedBy: 'auth0|x',
      initialDispositionedAt: '2026-05-20T00:00:00Z',
    })
  })

  it('empty state is closed with blank identity', () => {
    const s = emptyDispositionDialogState()
    expect(s.show).toBe(false)
    expect(s.findingId).toBe('')
    expect(s.initialKind).toBeNull()
  })

  it('affirmDialogStateFor locks the kind to AFFIRMED and keeps the reason editable', () => {
    const item: DispositionableFinding = {
      id: 'exp-1',
      name: 'Open S3 bucket',
      dispositionKind: 'AFFIRMED',
      dispositionReason: 'Confirmed as a live risk.',
      dispositionStale: true,
      dispositionedBy: 'auth0|x',
      dispositionedAt: '2026-06-01T00:00:00Z',
    }
    expect(affirmDialogStateFor(item)).toEqual({
      show: true,
      findingId: 'exp-1',
      findingName: 'Open S3 bucket',
      initialKind: 'AFFIRMED',
      initialReason: 'Confirmed as a live risk.',
      isStale: true,
      lockKind: true,
      initialDispositionedBy: 'auth0|x',
      initialDispositionedAt: '2026-06-01T00:00:00Z',
    })
  })
})

describe('useFindingDisposition.provenanceInfo', () => {
  it('USER authored by the current user reads "Authored by you"', () => {
    mockAuthStore.user = { id: 'u1' }
    const { provenanceInfo } = useFindingDisposition()
    const info = provenanceInfo({ id: 'x', createdBy: 'USER', authoredBy: 'u1' })
    expect(info.kind).toBe('user')
    expect(info.tooltip).toBe('Authored by you')
    expect(info.iconName).toBe('mdi-account-outline')
  })

  it('USER authored by another user names them', () => {
    mockAuthStore.user = { id: 'u1' }
    const { provenanceInfo } = useFindingDisposition()
    const info = provenanceInfo({ id: 'x', createdBy: 'USER', authoredBy: 'someone-else' })
    expect(info.tooltip).toBe('Authored by someone-else')
  })

  it('SYSTEM with authoredBy shows the source', () => {
    const { provenanceInfo } = useFindingDisposition()
    const info = provenanceInfo({ id: 'x', createdBy: 'SYSTEM', authoredBy: 'dethernety-module' })
    expect(info.kind).toBe('system')
    expect(info.tooltip).toBe('Source: dethernety-module')
    expect(info.iconName).toBe('mdi-database-outline')
  })

  it('no provenance when createdBy is absent', () => {
    const { provenanceInfo } = useFindingDisposition()
    expect(provenanceInfo({ id: 'x' }).kind).toBe('none')
  })

  it('isUserAuthored reflects createdBy', () => {
    const { isUserAuthored } = useFindingDisposition()
    expect(isUserAuthored({ id: 'x', createdBy: 'USER' })).toBe(true)
    expect(isUserAuthored({ id: 'x', createdBy: 'SYSTEM' })).toBe(false)
  })
})
