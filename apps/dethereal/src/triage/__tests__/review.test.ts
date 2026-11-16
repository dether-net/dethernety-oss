/**
 * The review parser: opening a review from proposals, reading each reply as one command (or refusing it and
 * changing nothing), and the operation list a closed review hands to a disposition plan.
 */
import { describe, it, expect } from 'vitest'
import {
  applyReply,
  decisionsOf,
  grammarOf,
  openReview,
  operationsOf,
  REVIEW_LIMITS,
  ReviewRefusal,
  textProblem,
  type Review,
  type ReviewGroup,
} from '../review.js'
import { copyOf } from '../store.js'
import { row, viewFor } from './fixtures.js'

const ID = 'a'.repeat(32)

const dispose = (group: number, ids: string[], extra: Partial<ReviewGroup> = {}): ReviewGroup => ({
  group,
  exposure_ids: ids,
  proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: `reason ${group}` },
  ...extra,
})

function review(groups?: ReviewGroup[]): Review {
  return open('review', groups ?? [
    dispose(1, ['e1', 'e2']),
    dispose(2, ['e3']),
    { group: 3, exposure_ids: ['e4'], needs_human: true },
    { group: 4, exposure_ids: ['e5'], proposal: { op: 'supersede', modifications: { score: 3 }, verified_technique_ids: [] } },
    dispose(5, ['e6'], { per_row_only: true }),
  ])
}

const staleRow = (id: string) => row(id, { disposition_kind: id === 's3' ? 'SUPERSEDED' : 'NOT_APPLICABLE', disposition_stale: true, full_reason: 'old reason' })

function stale(): Review {
  return openStale([
    { group: 1, exposure_ids: ['s1'], proposal: { op: 'reaffirm' } },
    { group: 2, exposure_ids: ['s2'] },
    { group: 3, exposure_ids: ['s3'] },
  ])
}

const open = (mode: 'review' | 'stale', groups: ReviewGroup[]) => openReview(ID, '/m', mode, groups, viewFor(groups, mode === 'stale' ? staleRow : undefined))
const openStale = (groups: ReviewGroup[]) => open('stale', groups)

/** The refusal `fn` throws, after checking it changed nothing. */
function refusalOf(r: Review, reply: string): ReviewRefusal {
  const before = JSON.stringify(decisionsOf(r)) + String(r.closed)
  let caught: unknown
  try {
    applyReply(r, reply)
  } catch (err) {
    caught = err
  }
  expect(caught, `"${reply}" should be refused`).toBeInstanceOf(ReviewRefusal)
  expect(JSON.stringify(decisionsOf(r)) + String(r.closed)).toBe(before)
  return caught as ReviewRefusal
}

const decision = (r: Review, n: number) => r.decisions.get(n)!

describe('openReview', () => {
  it('orders the groups and starts every decision pending', () => {
    const r = open('review', [dispose(2, ['b']), dispose(1, ['a'])])
    expect([...r.groups.keys()]).toEqual([1, 2])
    expect(decisionsOf(r)).toEqual([{ group: 1, decision: 'pending' }, { group: 2, decision: 'pending' }])
    expect(r.closed).toBe(false)
    expect(r.replies).toBe(0)
  })

  const invalid: Array<[string, ReviewGroup[], string]> = [
    ['no groups', [], 'argument_invalid'],
    ['a group named twice', [dispose(1, ['a']), dispose(1, ['b'])], 'argument_invalid'],
    ['an exposure in two groups', [dispose(1, ['a']), dispose(2, ['a'])], 'argument_invalid'],
    ['no proposal and not needs_human', [{ group: 1, exposure_ids: ['a'] }], 'argument_invalid'],
    ['a reaffirm in a review', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'reaffirm' } }], 'argument_invalid'],
    ['a dispose without a kind', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', reason: 'r' } }], 'argument_invalid'],
    ['a dispose with SUPERSEDED', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', kind: 'SUPERSEDED', reason: 'r' } }], 'argument_invalid'],
    ['a proposed RISK_ACCEPTED', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', kind: 'RISK_ACCEPTED', reason: 'r' } }], 'argument_invalid'],
    ['a proposed COMPENSATING_CONTROL', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', kind: 'COMPENSATING_CONTROL', reason: 'r' } }], 'argument_invalid'],
    ['a dispose without a reason', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', kind: 'AFFIRMED' } }], 'argument_invalid'],
    ['a supersede without modifications', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'supersede' } }], 'argument_invalid'],
    ['stale_superseded in a review', [dispose(1, ['a'], { stale_superseded: true })], 'argument_invalid'],
    ['a two-line reason', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', kind: 'AFFIRMED', reason: 'a\nb' } }], 'text_invalid'],
    ['an empty reason', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'dispose', kind: 'AFFIRMED', reason: '  ' } }], 'text_invalid'],
    ['an invisible character in a name', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'supersede', modifications: { name: 'x\u200by' } } }], 'text_invalid'],
    ['an over-long description', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'supersede', modifications: { description: 'd'.repeat(REVIEW_LIMITS.textChars + 1) } } }], 'text_invalid'],
  ]
  it.each(invalid)('refuses %s', (_what, groups, code) => {
    expect(() => open('review', groups)).toThrow(expect.objectContaining({ code }))
  })

  it('refuses an exposure the model does not hold, naming it', () => {
    const groups = [dispose(1, ['a', 'b'])]
    expect(() => openReview(ID, '/m', 'review', groups, viewFor([{ exposure_ids: ['a'] }]))).toThrow(expect.objectContaining({ code: 'not_in_model', details: { exposures: ['b'] } }))
  })

  it('refuses a stale review of an exposure that is not stale now', () => {
    const groups = [{ group: 1, exposure_ids: ['s1', 's2'] }]
    const view = viewFor(groups, (id) => row(id, { disposition_kind: 'AFFIRMED', disposition_stale: id === 's1' }))
    expect(() => openReview(ID, '/m', 'stale', groups, view)).toThrow(expect.objectContaining({ code: 'target_changed', details: { exposures: ['s2'] } }))
  })

  it('marks a stale group superseded from the model, whatever the proposal says', () => {
    const r = stale()
    expect([...r.groups.values()].map((g) => g.stale_superseded)).toEqual([false, false, true])
  })

  it('refuses a copy name holding a single quote', () => {
    expect(() => open('review', [{ group: 1, exposure_ids: ['a'], proposal: { op: 'supersede', modifications: { name: "it's open" } } }])).toThrow(expect.objectContaining({ code: 'text_invalid' }))
  })

  it('refuses a supersede proposal marked needs_human', () => {
    expect(() => open('review', [{ group: 1, exposure_ids: ['a'], needs_human: true, proposal: { op: 'supersede', modifications: { score: 1 } } }])).toThrow(expect.objectContaining({ code: 'argument_invalid' }))
  })

  it('keeps what the model held for the named exposures and the others on their elements, and nothing else', () => {
    const groups = [dispose(1, ['a'])]
    const view = viewFor([{ exposure_ids: ['a', 'b', 'c'] }], (id) => row(id, { element_id: id === 'c' ? 'c2' : 'c1' }))
    const r = openReview(ID, '/m', 'review', groups, view)
    expect([...r.seen.keys()]).toEqual(['a', 'b'])
    expect([...r.evidence.keys()]).toEqual(['a'])
    expect(r).toMatchObject({ model_id: 'model-1', model_name: 'Shop' })
  })

  it('refuses a stale review that proposes a dispose, or marks needs_human or per_row_only', () => {
    expect(() => open('stale', [dispose(1, ['a'])])).toThrow(expect.objectContaining({ code: 'argument_invalid' }))
    for (const extra of [{ needs_human: true }, { per_row_only: true }]) {
      expect(() => open('stale', [{ group: 1, exposure_ids: ['a'], ...extra }])).toThrow(expect.objectContaining({ code: 'argument_invalid' }))
    }
  })

  it(`takes ${REVIEW_LIMITS.operations} exposures and refuses one more`, () => {
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => `e${from + i}`)
    expect(open('review', [dispose(1, ids(0, 100)), dispose(2, ids(100, 100))]).groups.size).toBe(2)
    expect(() => open('review', [dispose(1, ids(0, 100)), dispose(2, ids(100, 101))])).toThrow(expect.objectContaining({ code: 'review_too_long' }))
  })
})

describe('applyReply: accept, skip and show', () => {
  it('accepts several groups in one reply, separated by spaces or commas', () => {
    const r = review()
    expect(applyReply(r, 'accept 1, 2').command).toEqual({ verb: 'accept', groups: [1, 2] })
    expect(decision(r, 1).decision).toBe('accept')
    expect(decision(r, 2).decision).toBe('accept')
    expect(decision(r, 4).decision).toBe('pending')
  })

  it('reads the verb in any case, and trims the reply', () => {
    const r = review()
    expect(applyReply(r, '  ACCEPT 1  ').command.verb).toBe('accept')
    expect(applyReply(r, 'Skip 2').command.verb).toBe('skip')
  })

  it('lets a later decision on a group replace an earlier one', () => {
    const r = review()
    applyReply(r, 'accept 1')
    applyReply(r, 'skip 1')
    expect(decision(r, 1).decision).toBe('skip')
    applyReply(r, 'edit 1 kind: NOT_APPLICABLE')
    applyReply(r, 'accept 1')
    expect(decision(r, 1)).toEqual({ decision: 'accept' })
  })

  it('refuses accept on a needs-human group, naming it, and accepts none of the reply', () => {
    const r = review()
    const err = refusalOf(r, 'accept 1 3')
    expect(err.code).toBe('needs_operator_decision')
    expect(err.details).toEqual({ groups: [3] })
  })

  it('accepts a per-row-only group by number', () => {
    const r = review()
    applyReply(r, 'accept 5')
    expect(decision(r, 5).decision).toBe('accept')
  })

  it('shows one group as opened, with its decision, and changes nothing', () => {
    const r = review()
    applyReply(r, 'skip 2')
    const result = applyReply(r, 'show 2')
    expect(result.show).toEqual({ ...dispose(2, ['e3']), decision: { decision: 'skip' } })
    expect(decision(r, 2).decision).toBe('skip')
  })

  const malformed: Array<[string, string]> = [
    ['accept', 'argument_invalid'],
    ['accept x', 'argument_invalid'],
    ['accept 1 two', 'argument_invalid'],
    ['accept 1000', 'argument_invalid'],
    ['accept -1', 'argument_invalid'],
    ['skip', 'argument_invalid'],
    ['show', 'argument_invalid'],
    ['show 1 2', 'argument_invalid'],
    ['accept 9', 'group_unknown'],
    ['skip 1 9', 'group_unknown'],
    ['show 0', 'group_unknown'],
    ['accept-all now', 'argument_invalid'],
    ['done 1', 'argument_invalid'],
    ['', 'reply_unparsed'],
    ['yes', 'reply_unparsed'],
    ['looks good to me, go ahead', 'reply_unparsed'],
    ['please accept 1', 'reply_unparsed'],
    ['accept1', 'reply_unparsed'],
    ['reaffirm 1', 'verb_not_in_mode'],
    ['clear 2', 'verb_not_in_mode'],
  ]
  it.each(malformed)('refuses "%s" with %s, changing nothing', (reply, code) => {
    const r = review()
    applyReply(r, 'accept 2')
    expect(refusalOf(r, reply).code).toBe(code)
  })

  it('states the grammar in every parse refusal', () => {
    for (const reply of ['accept', 'hello', 'reaffirm 1']) expect(refusalOf(review(), reply).message).toContain(grammarOf('review'))
  })

  it('names the unknown groups and the known ones', () => {
    const err = refusalOf(review(), 'accept 7 8')
    expect(err.details).toEqual({ groups: [7, 8] })
    expect(err.message).toContain('groups 1, 2, 3, 4, 5')
  })
})

describe('applyReply: edit', () => {
  it('sets a kind, a rationale, or both, and keeps what an earlier edit set', () => {
    const r = review()
    expect(applyReply(r, 'edit 1 kind: not_applicable').command).toEqual({ verb: 'edit', groups: [1], fields: { kind: 'NOT_APPLICABLE' } })
    expect(decision(r, 1)).toEqual({ decision: 'edit', kind: 'NOT_APPLICABLE' })
    applyReply(r, 'edit 1 rationale: only on the build host')
    expect(decision(r, 1)).toEqual({ decision: 'edit', kind: 'NOT_APPLICABLE', rationale: 'only on the build host' })
    applyReply(r, 'edit 1 kind: AFFIRMED rationale: it applies after all')
    expect(decision(r, 1)).toEqual({ decision: 'edit', kind: 'AFFIRMED', rationale: 'it applies after all' })
  })

  it('takes an operator-only kind whose rationale an earlier edit gave', () => {
    const r = review()
    applyReply(r, 'edit 2 rationale: accepted by the owner')
    applyReply(r, 'edit 2 kind: RISK_ACCEPTED')
    expect(decision(r, 2)).toEqual({ decision: 'edit', kind: 'RISK_ACCEPTED', rationale: 'accepted by the owner' })
  })

  it('takes a rationale that mentions a kind: field without naming a kind', () => {
    const r = review()
    applyReply(r, 'edit 1 rationale: the kind: field of the scan was wrong')
    expect(decision(r, 1).rationale).toBe('the kind: field of the scan was wrong')
  })

  it('takes an operator-only kind with a rationale, and refuses it without one', () => {
    const r = review()
    expect(refusalOf(r, 'edit 2 kind: RISK_ACCEPTED').code).toBe('edit_invalid')
    applyReply(r, 'edit 2 kind: RISK_ACCEPTED rationale: accepted by the owner until March')
    expect(decision(r, 2)).toEqual({ decision: 'edit', kind: 'RISK_ACCEPTED', rationale: 'accepted by the owner until March' })
    applyReply(r, 'edit 1 kind: compensating_control rationale: the WAF blocks it')
    expect(decision(r, 1).kind).toBe('COMPENSATING_CONTROL')
  })

  it('refuses any edit of a supersede proposal', () => {
    for (const reply of ['edit 4 kind: AFFIRMED', 'edit 4 rationale: keep the score']) expect(refusalOf(review(), reply).code).toBe('edit_invalid')
  })

  it('refuses a rationale-only edit of a needs-human group as needing a decision', () => {
    const err = refusalOf(review(), 'edit 3 rationale: not reachable from outside')
    expect(err.code).toBe('needs_operator_decision')
    expect(err.details).toEqual({ groups: [3] })
  })

  it('refuses a kind-only edit of a needs-human group as needing a decision, and takes one with a rationale', () => {
    const r = review()
    const err = refusalOf(r, 'edit 3 kind: NOT_APPLICABLE')
    expect(err.code).toBe('needs_operator_decision')
    expect(err.details).toEqual({ groups: [3] })
    expect(err.message).toContain('edit 3 kind: NOT_APPLICABLE rationale: <text>')
    applyReply(r, 'edit 3 kind: NOT_APPLICABLE rationale: the port is closed')
    expect(decision(r, 3)).toEqual({ decision: 'edit', kind: 'NOT_APPLICABLE', rationale: 'the port is closed' })
    applyReply(r, 'edit 3 kind: FALSE_POSITIVE')
    expect(decision(r, 3)).toEqual({ decision: 'edit', kind: 'FALSE_POSITIVE', rationale: 'the port is closed' })
  })

  it('refuses a rationale-only edit of a needs-human group, naming the kind an earlier edit set', () => {
    const r = review()
    applyReply(r, 'edit 3 kind: NOT_APPLICABLE rationale: the port is closed')
    const err = refusalOf(r, 'edit 3 rationale: the port is closed on every host')
    expect(err.code).toBe('needs_operator_decision')
    expect(err.message).toContain('edit 3 kind: NOT_APPLICABLE rationale: <text>')
  })

  it('refuses a kind-only edit of a needs-human group even when its proposal carries a reason: the rationale is the operator\'s', () => {
    const r = review([{ group: 1, exposure_ids: ['a'], needs_human: true, proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'the scan is wrong' } }])
    for (const reply of ['edit 1 kind: NOT_APPLICABLE', 'edit 1 kind: RISK_ACCEPTED']) expect(refusalOf(r, reply).code).toBe('needs_operator_decision')
    expect(decision(r, 1)).toEqual({ decision: 'pending' })
    applyReply(r, 'edit 1 kind: NOT_APPLICABLE rationale: nothing listens there')
    expect(operationsOf({ ...r, closed: true })).toEqual([{ group: 1, exposure_id: 'a', op: 'dispose', edited: true, operator_reason: true, kind: 'NOT_APPLICABLE', reason: 'nothing listens there' }])
  })

  const malformed: Array<[string, string]> = [
    ['edit', 'argument_invalid'],
    ['edit 1', 'argument_invalid'],
    ['edit one kind: AFFIRMED', 'argument_invalid'],
    ['edit 9 kind: AFFIRMED', 'group_unknown'],
    ['edit 1 make it affirmed', 'edit_invalid'],
    ['edit 1 kind:', 'edit_invalid'],
    ['edit 1 kind: MAYBE', 'edit_invalid'],
    ['edit 1 kind: SUPERSEDED', 'edit_invalid'],
    ['edit 1 rationale:', 'edit_invalid'],
    ['edit 1 rationale: why kind: AFFIRMED', 'edit_invalid'],
    ['edit 1 rationale: the risk kind:risk_accepted fits', 'edit_invalid'],
    ['edit 1 kind: AFFIRMED because', 'edit_invalid'],
  ]
  it.each(malformed)('refuses "%s" with %s, changing nothing', (reply, code) => {
    expect(refusalOf(review(), reply).code).toBe(code)
  })

  it('refuses a rationale that is too long or holds an invisible character', () => {
    expect(refusalOf(review(), `edit 1 rationale: ${'r'.repeat(REVIEW_LIMITS.textChars + 1)}`).code).toBe('text_invalid')
    expect(refusalOf(review(), 'edit 1 rationale: a\u202eb').code).toBe('text_invalid')
  })
})

describe('applyReply: accept-all, done, and limits', () => {
  it('accept-all accepts the pending groups it may, skips the rest, and closes the review', () => {
    const r = review()
    applyReply(r, 'skip 2')
    expect(applyReply(r, 'accept-all').command).toEqual({ verb: 'accept-all', groups: [1, 4] })
    expect(decisionsOf(r).map((d) => d.decision)).toEqual(['accept', 'skip', 'skip', 'accept', 'skip'])
    expect(r.closed).toBe(true)
  })

  it('done skips every pending group and closes the review', () => {
    const r = review()
    applyReply(r, 'accept 1')
    expect(applyReply(r, 'done').command).toEqual({ verb: 'done', groups: [] })
    expect(decisionsOf(r).map((d) => d.decision)).toEqual(['accept', 'skip', 'skip', 'skip', 'skip'])
    expect(r.closed).toBe(true)
  })

  it('refuses every reply once closed', () => {
    const r = review()
    applyReply(r, 'done')
    for (const reply of ['accept 1', 'show 1', 'done']) expect(refusalOf(r, reply).code).toBe('review_closed')
  })

})

describe('a stale review', () => {
  it('reaffirms, clears and skips groups, and closes with done', () => {
    const r = stale()
    applyReply(r, 'reaffirm 1')
    applyReply(r, 'clear 2 3')
    expect(decisionsOf(r).map((d) => d.decision)).toEqual(['reaffirm', 'clear', 'clear'])
    applyReply(r, 'skip 3')
    applyReply(r, 'done')
    expect(r.closed).toBe(true)
    expect(operationsOf(r)).toEqual([
      { group: 1, exposure_id: 's1', op: 'reaffirm', edited: false },
      { group: 2, exposure_id: 's2', op: 'clear', edited: false },
    ])
  })

  it('refuses a reaffirm of a superseded group', () => {
    const err = refusalOf(stale(), 'reaffirm 1 3')
    expect(err.code).toBe('argument_invalid')
    expect(err.details).toEqual({ groups: [3] })
  })

  it('refuses the review verbs', () => {
    for (const reply of ['accept 1', 'edit 1 kind: AFFIRMED', 'accept-all']) expect(refusalOf(stale(), reply).code).toBe('verb_not_in_mode')
  })

  it('states its own grammar', () => {
    expect(refusalOf(stale(), 'what now').message).toContain(grammarOf('stale'))
  })
})

describe('operationsOf', () => {
  it('lists accepted and edited groups in group then exposure order, with the reasons unmarked', () => {
    const r = review()
    applyReply(r, 'accept 4')
    applyReply(r, 'edit 2 kind: AFFIRMED rationale: it is real')
    applyReply(r, 'edit 3 kind: NOT_APPLICABLE rationale: the port is closed')
    applyReply(r, 'accept 1')
    applyReply(r, 'done')
    expect(operationsOf(r)).toEqual([
      { group: 1, exposure_id: 'e1', op: 'dispose', edited: false, operator_reason: false, kind: 'FALSE_POSITIVE', reason: 'reason 1' },
      { group: 1, exposure_id: 'e2', op: 'dispose', edited: false, operator_reason: false, kind: 'FALSE_POSITIVE', reason: 'reason 1' },
      { group: 2, exposure_id: 'e3', op: 'dispose', edited: true, operator_reason: true, kind: 'AFFIRMED', reason: 'it is real' },
      { group: 3, exposure_id: 'e4', op: 'dispose', edited: true, operator_reason: true, kind: 'NOT_APPLICABLE', reason: 'the port is closed' },
      { group: 4, exposure_id: 'e5', op: 'supersede', edited: false, modifications: { score: 3 }, verified_technique_ids: [] },
    ])
  })

  it('keeps the proposed reason for an edit that changes only the kind', () => {
    const r = review()
    applyReply(r, 'edit 1 kind: NOT_APPLICABLE')
    applyReply(r, 'done')
    expect(operationsOf(r).map((o) => [o.kind, o.reason, o.edited, o.operator_reason])).toEqual([
      ['NOT_APPLICABLE', 'reason 1', true, false],
      ['NOT_APPLICABLE', 'reason 1', true, false],
    ])
  })

  it('counts a rationale an earlier edit gave as the operator\'s', () => {
    const r = review()
    applyReply(r, 'edit 1 rationale: the scanner misread the banner')
    applyReply(r, 'edit 1 kind: NOT_APPLICABLE')
    applyReply(r, 'done')
    expect(operationsOf(r)[0]).toMatchObject({ kind: 'NOT_APPLICABLE', reason: 'the scanner misread the banner', operator_reason: true })
  })

  it('is empty when nothing was accepted', () => {
    const r = review()
    applyReply(r, 'done')
    expect(operationsOf(r)).toEqual([])
  })
})

describe('textProblem', () => {
  it('takes one line of words and names what is wrong otherwise', () => {
    expect(textProblem('fine', 'x')).toBeNull()
    expect(textProblem('', 'the reason')).toBe('the reason is empty')
    expect(textProblem('a\r\nb', 'x')).toBe('x must be one line')
    expect(textProblem('a\u0007b', 'x')).toBe('x holds an invisible or control character')
    expect(textProblem('t'.repeat(REVIEW_LIMITS.textChars), 'x')).toBeNull()
    expect(textProblem('t'.repeat(REVIEW_LIMITS.textChars + 1), 'x')).toMatch(/at most 1800/)
  })
})

describe('copyOf', () => {
  it('copies the decisions, so a change to the copy leaves the original alone', () => {
    const r = review()
    const c = copyOf(r)
    applyReply(c, 'accept 1')
    expect(decision(r, 1).decision).toBe('pending')
    expect(decision(c, 1).decision).toBe('accept')
  })
})
