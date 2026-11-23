/**
 * A review's groups as the review workspace takes them: every field it would refuse left out before sending, with
 * why, so one publish is never refused whole for one group.
 */
import { describe, it, expect } from 'vitest'
import { openReview, type ReviewGroup } from '../../triage/review.js'
import { row, viewFor } from '../../triage/__tests__/fixtures.js'
import { buildPublish, payloadOf, withFingerprints } from '../payload.js'

const FP = `sha256:${'b'.repeat(64)}`
const stale = (kind: string | null, at: string | null = '2026-11-01T00:00:00.000Z') => (id: string) => row(id, { disposition_kind: kind, dispositioned_at: at, disposition_stale: true, lifecycle: kind ? 'disposed' : 'pending' })

describe('the payload', () => {
  it('a dispose carries its kind and reason; an edited copy its edits and never a reason; verified ids stay here', () => {
    const groups: ReviewGroup[] = [
      { group: 1, exposure_ids: ['e1'], proposal: { op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'internal', confidence: 'high', citations: ['platform:score'] } },
      { group: 2, exposure_ids: ['e2'], proposal: { op: 'supersede', reason: 'ignored', modifications: { score: 2, techniques: { add: ['n-1'], remove: [] } }, verified_technique_ids: ['n-1'], objection: 'no', confidence: 'medium' }, per_row_only: true },
      { group: 3, exposure_ids: ['e3'], needs_human: true },
    ]
    const review = openReview('r1', '/m', 'review', groups, viewFor(groups))
    const built = withFingerprints(buildPublish({ review, drifted: new Set(), late: false }), new Map(['e1', 'e2', 'e3'].map((id) => [id, { fingerprint: FP, fpVersion: 3 }])))
    expect(JSON.parse(payloadOf('r1', built))).toEqual({
      reviewId: 'r1',
      groups: [
        { groupId: '1', proposal: { op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'internal', confidence: 'high', citations: ['platform:score'] }, needsHuman: false, perRowOnly: false, findings: [{ exposureId: 'e1', baseKind: null, baseAt: null, fingerprint: FP, fpVersion: 3 }] },
        { groupId: '2', proposal: { op: 'supersede', modifications: { score: 2, techniques: { add: ['n-1'], remove: [] } }, confidence: 'medium', objection: 'no' }, needsHuman: false, perRowOnly: true, findings: [{ exposureId: 'e2', baseKind: null, baseAt: null, fingerprint: FP, fpVersion: 3 }] },
        { groupId: '3', needsHuman: true, perRowOnly: false, findings: [{ exposureId: 'e3', baseKind: null, baseAt: null, fingerprint: FP, fpVersion: 3 }] },
      ],
    })
  })

  it('a stale review: a group with no proposal goes for a person; a superseded one is cleared, never reaffirmed; bases it cannot carry stay here', () => {
    const groups: ReviewGroup[] = [
      { group: 1, exposure_ids: ['s1'] },
      { group: 2, exposure_ids: ['s2'], proposal: { op: 'reaffirm' } },
      { group: 3, exposure_ids: ['s3'], proposal: { op: 'clear' } },
      { group: 4, exposure_ids: ['s4'], proposal: { op: 'reaffirm' } },
      { group: 5, exposure_ids: ['s5'], proposal: { op: 'reaffirm' } },
      // a time with no kind: the workspace takes both or neither
      { group: 6, exposure_ids: ['s6'] },
    ]
    const kinds: Record<string, (id: string) => ReturnType<typeof row>> = { s1: stale('NOT_APPLICABLE'), s2: stale('SUPERSEDED'), s3: stale('SUPERSEDED'), s4: stale('WAIVED'), s5: stale('LEGACY_KIND'), s6: stale(null, '2026-11-01T00:00:00.000Z') }
    const review = openReview('r2', '/m', 'stale', groups, viewFor(groups, (id) => kinds[id]!(id)))
    const built = buildPublish({ review, drifted: new Set(), late: false })
    expect(built.groups.map((g) => [g.groupId, g.proposal?.op ?? null, g.needsHuman])).toEqual([['1', null, true], ['3', 'clear', false]])
    expect(built.left).toEqual([
      { group: 2, why: 'a superseded finding is cleared or decided by a person, never reaffirmed' },
      { group: 4, exposure_id: 's4', why: 'only a decision a person picked is reaffirmed' },
      { group: 5, exposure_id: 's5', why: 'its current decision is one the workspace cannot carry' },
      { group: 6, exposure_id: 's6', why: 'its current decision is one the workspace cannot carry' },
    ])
  })

  it('a finding the workspace answers gone, or one that drifted, is left out; a group left empty goes', () => {
    const groups: ReviewGroup[] = [{ group: 1, exposure_ids: ['e1', 'e2'], proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'r' } }, { group: 2, exposure_ids: ['e3'], proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'r' } }]
    const review = openReview('r3', '/m', 'review', groups, viewFor(groups))
    const built = withFingerprints(buildPublish({ review, drifted: new Set(['e3']), late: false }), new Map([['e1', { fingerprint: FP, fpVersion: 3 }]]))
    expect(built.groups.map((g) => g.findings.map((f) => f.exposureId))).toEqual([['e1']])
    expect(built.left.map((l) => [l.exposure_id, l.why])).toEqual([['e3', 'changed since the review: open a new review to judge it again'], ['e2', 'no longer in the model']])
  })
})
