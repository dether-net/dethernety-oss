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
  partitionAndSort,
  rowClass,
  emptyDispositionDialogState,
  dispositionStateFor,
  type DispositionableFinding,
} from '../useFindingDisposition'

describe('dispositionKindLabel', () => {
  it('labels every kind including WAIVED', () => {
    expect(dispositionKindLabel('NOT_APPLICABLE')).toBe('Not Applicable')
    expect(dispositionKindLabel('FALSE_POSITIVE')).toBe('False Positive')
    expect(dispositionKindLabel('COMPENSATING_CONTROL')).toBe('Compensating Control')
    expect(dispositionKindLabel('RISK_ACCEPTED')).toBe('Risk Accepted')
    expect(dispositionKindLabel('WAIVED')).toBe('Waived')
    expect(dispositionKindLabel('SUPERSEDED')).toBe('Superseded')
  })

  it('returns empty string for null / undefined', () => {
    expect(dispositionKindLabel(null)).toBe('')
    expect(dispositionKindLabel(undefined)).toBe('')
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
