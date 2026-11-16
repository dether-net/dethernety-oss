/**
 * Disposition plans: each operation checked against the platform's state, the lines the operator is shown, what a
 * supersede will create, the state a commit is bound to, the apply answer, and the writes (against a stub client).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApolloClient } from '@apollo/client'

const calls: Array<[string, unknown]> = []
const flow = vi.fn()
let linksOf: (id: string) => unknown = () => ({ exploitedBy: [], exploitedByAtlas: [] })
let disposeResult: (input: { exposureId: string }) => unknown = () => ({ success: true, dispositionKind: 'FALSE_POSITIVE', dispositionReason: 'r' })

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dethernety/dt-core')>()
  class DtExposure {
    async disposeExposure(input: { exposureId: string }) {
      calls.push(['dispose', input])
      return disposeResult(input)
    }
    async clearDisposition(input: { exposureId: string }) {
      calls.push(['clear', input])
      return { success: true, dispositionKind: null, dispositionReason: null }
    }
    async getExposureTechniqueLinks(input: { exposureId: string }) {
      calls.push(['links', input])
      return linksOf(input.exposureId)
    }
  }
  return { ...real, DtExposure, executeSupersedeFlow: (...args: unknown[]) => flow(...args) }
})

const { SupersedeCloneError, SupersedeDisposeError } = await import('@dethernety/dt-core')
const {
  applyAnswer,
  changedSince,
  CLONE_SUFFIX,
  fingerprintOf,
  linesOf,
  MARKER_APPROVED,
  MARKER_EDITED,
  planOperations,
  REASON_MAX,
  reaffirmReason,
  shown,
  SHOWN_MAX,
  readTechniques,
  WHY,
  writeOperations,
} = await import('../dispositions.js')
type PrepareInput = import('../dispositions.js').PrepareInput
type ExposureState = import('../exposures.js').ExposureState
type ExposureEvidence = import('../exposures.js').ExposureEvidence
type ReviewOperation = import('../review.js').ReviewOperation

const client = {} as ApolloClient

function state(id: string, over: Partial<ExposureState> = {}): ExposureState {
  return {
    exposure_id: id,
    name: `Exposure ${id}`,
    type: 'weakness',
    category: 'network',
    score: 5,
    attack_vector: 'NETWORK',
    created_by: 'system',
    authored_by: null,
    disposition_kind: null,
    disposition_reason: null,
    dispositioned_by: null,
    dispositioned_at: null,
    disposition_stale: null,
    lifecycle: 'pending',
    element_id: 'c1',
    element_name: 'API',
    element_kind: 'component',
    element_class: { id: 'k1', name: 'Web API' },
    attack_ids: ['T1190'],
    atlas_ids: [],
    unresolved_references: null,
    def_hash: 'h1',
    full_reason: null,
    ...over,
  }
}

function evidence(id: string, over: Partial<ExposureEvidence> = {}): ExposureEvidence {
  return {
    exposure_id: id,
    name: `Exposure ${id}`,
    description: 'An open port',
    type: 'weakness',
    category: 'network',
    score: 5,
    attack_vector: 'NETWORK',
    references: 'https://example.test/advisory',
    mitigation_suggestions: ['close it'],
    detection_methods: ['scan'],
    tags: ['net'],
    techniques: ['T1190'],
    created_by: 'system',
    authored_by: null,
    disposition_kind: null,
    disposition_reason: null,
    dispositioned_by: null,
    dispositioned_at: null,
    disposition_stale: null,
    unresolved_references: null,
    lifecycle: 'pending',
    def_hash: 'h1',
    exploited_by: [{ id: 'n-t1190', attack_id: 'T1190', name: 'Exploit Public-Facing Application', description: null }],
    exploited_by_atlas: [{ id: 'n-aml0049', atlas_id: 'AML.T0049', name: 'Exploit Public-Facing Application', description: null }],
    ...over,
  }
}

const op = (o: Partial<ReviewOperation> & Pick<ReviewOperation, 'exposure_id' | 'op'>): ReviewOperation => ({ group: 1, edited: false, ...o })

function input(operations: ReviewOperation[], over: Partial<PrepareInput> = {}): PrepareInput {
  const ids = [...new Set(operations.map((o) => o.exposure_id))]
  return {
    operations,
    state: new Map(ids.filter((id) => id !== 'gone').map((id) => [id, state(id)])),
    evidence: new Map(ids.filter((id) => id !== 'gone').map((id) => [id, evidence(id)])),
    techniques: { attack: new Map([['n-t1059', 'T1059']]), atlas: new Map([['n-aml0051', 'AML.T0051']]) },
    date: '2026-11-11',
    ...over,
  }
}

describe('planOperations: dispose', () => {
  it('marks the reason as approved, or as edited when the operator wrote it', () => {
    const [a, b, c] = planOperations(input([
      op({ exposure_id: 'x1', op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'the scanner misread it' }),
      op({ exposure_id: 'x2', op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'no listener', edited: true, operator_reason: true }),
      // An edit of the kind alone: the reason is still the proposal's, approved.
      op({ exposure_id: 'x3', op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'proposed', edited: true, operator_reason: false }),
    ]))
    expect(a).toMatchObject({ status: 'ready', kind: 'FALSE_POSITIVE', reason: `the scanner misread it${MARKER_APPROVED}` })
    expect(b).toMatchObject({ status: 'ready', kind: 'NOT_APPLICABLE', reason: `no listener${MARKER_EDITED}` })
    expect(c).toMatchObject({ status: 'ready', kind: 'NOT_APPLICABLE', reason: `proposed${MARKER_APPROVED}` })
  })

  it('pins the markers', () => {
    expect(MARKER_APPROVED).toBe(' — AI-assisted triage, operator-approved')
    expect(MARKER_EDITED).toBe(' — AI-assisted triage, operator-edited')
  })

  it(`takes a reason of ${REASON_MAX} characters with its marker, and rejects one more`, () => {
    const fits = 'r'.repeat(REASON_MAX - MARKER_APPROVED.length)
    expect(planOperations(input([op({ exposure_id: 'x', op: 'dispose', kind: 'AFFIRMED', reason: fits })]))[0]!.status).toBe('ready')
    const [over] = planOperations(input([op({ exposure_id: 'x', op: 'dispose', kind: 'AFFIRMED', reason: `${fits}r` })]))
    expect(over).toMatchObject({ status: 'rejected', code: 'reason_too_long' })
  })

  it('writes an operator-only kind only from an edit, which carries the operator\'s rationale', () => {
    const [proposed, edited] = planOperations(input([
      op({ exposure_id: 'x1', op: 'dispose', kind: 'RISK_ACCEPTED', reason: 'proposed' }),
      op({ exposure_id: 'x2', op: 'dispose', kind: 'RISK_ACCEPTED', reason: 'owner accepts until March', edited: true, operator_reason: true }),
    ]))
    expect(proposed).toMatchObject({ status: 'rejected', code: 'kind_not_pickable' })
    expect(edited).toMatchObject({ status: 'ready', reason: `owner accepts until March${MARKER_EDITED}` })
  })

  const rejected: Array<[string, Partial<ReviewOperation>, Partial<ExposureState> | null, string]> = [
    ['an exposure not in the model', { exposure_id: 'gone' }, null, 'not_in_model'],
    ['an unpickable kind', { kind: 'SUPERSEDED' }, {}, 'kind_not_pickable'],
    ['no kind', { kind: undefined }, {}, 'kind_not_pickable'],
    ['a superseded target', {}, { disposition_kind: 'SUPERSEDED' }, 'target_superseded'],
    ['an empty reason', { reason: '   ' }, {}, 'reason_empty'],
    ['no reason', { reason: undefined }, {}, 'reason_empty'],
  ]
  it.each(rejected)('rejects %s', (_what, o, s, code) => {
    const operation = op({ exposure_id: 'x', op: 'dispose', kind: 'AFFIRMED', reason: 'r', ...o })
    const i = input([operation])
    if (s) i.state.set(operation.exposure_id, state(operation.exposure_id, s))
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code, op: 'dispose', index: 0 })
  })
})

describe('planOperations: reaffirm and clear', () => {
  it('renews the current reason without its marker, dated, as approved', () => {
    const i = input([op({ exposure_id: 'x', op: 'reaffirm' })])
    i.state.set('x', state('x', { disposition_kind: 'NOT_APPLICABLE', disposition_stale: true, full_reason: `no listener${MARKER_APPROVED}` }))
    i.evidence.set('x', evidence('x', { disposition_reason: `no listener${MARKER_APPROVED}` }))
    expect(planOperations(i)[0]).toMatchObject({ status: 'ready', kind: 'NOT_APPLICABLE', reason: `no listener [re-affirmed 2026-11-11 after model change]${MARKER_APPROVED}` })
  })

  it('drops an earlier renewal note, so renewals do not pile up', () => {
    const once = reaffirmReason(`no listener${MARKER_APPROVED}`, '2026-01-01')
    expect(reaffirmReason(once, '2026-11-11')).toBe(`no listener [re-affirmed 2026-11-11 after model change]${MARKER_APPROVED}`)
  })

  it('strips either marker, and only at the end', () => {
    expect(reaffirmReason(`a${MARKER_EDITED}`, 'D')).toBe(`a [re-affirmed D after model change]${MARKER_APPROVED}`)
    expect(reaffirmReason(`a${MARKER_APPROVED} b`, 'D')).toBe(`a${MARKER_APPROVED} b [re-affirmed D after model change]${MARKER_APPROVED}`)
    expect(reaffirmReason('plain', 'D')).toBe(`plain [re-affirmed D after model change]${MARKER_APPROVED}`)
  })

  it('rejects a reaffirm with no disposition, a superseded one, or one whose renewed reason is too long', () => {
    const i = input([op({ exposure_id: 'a', op: 'reaffirm' }), op({ exposure_id: 'b', op: 'reaffirm' }), op({ exposure_id: 'c', op: 'reaffirm' })])
    i.state.set('b', state('b', { disposition_kind: 'SUPERSEDED' }))
    i.state.set('c', state('c', { disposition_kind: 'AFFIRMED', full_reason: 'r'.repeat(REASON_MAX) }))
    i.evidence.set('c', evidence('c', { disposition_reason: 'r'.repeat(REASON_MAX) }))
    expect(planOperations(i).map((o) => o.code)).toEqual(['not_disposed', 'target_superseded', 'reason_too_long'])
  })

  it('clears any exposure in the model', () => {
    const i = input([op({ exposure_id: 'x', op: 'clear' }), op({ exposure_id: 'gone', op: 'clear' })])
    i.state.set('x', state('x', { disposition_kind: 'SUPERSEDED' }))
    expect(planOperations(i).map((o) => o.status)).toEqual(['ready', 'rejected'])
  })
})

describe('planOperations: supersede', () => {
  const supersede = (modifications: ReviewOperation['modifications'], verified: string[] = []) =>
    op({ exposure_id: 'x', op: 'supersede', modifications, verified_technique_ids: verified })

  it('describes the copy: its name, changes, techniques and copied content, and the source reason', () => {
    const [p] = planOperations(input([supersede({ score: 2, techniques: { add: ['n-t1059', 'n-aml0051'], remove: ['n-t1190'] } }, ['n-t1059', 'n-aml0051'])]))
    expect(p).toMatchObject({ status: 'ready', op: 'supersede' })
    expect(p!.clone).toEqual({
      source_exposure_id: 'x',
      source_name: 'Exposure x',
      element_id: 'c1',
      element_name: 'API',
      name: `Exposure x${CLONE_SUFFIX}`,
      changes: { score: 2 },
      description: { from: 'source', note: "(custom of 'Exposure x')" },
      techniques: { add: ['n-t1059', 'n-aml0051'], remove: ['n-t1190'], attack: ['n-t1059'], atlas: ['n-aml0049', 'n-aml0051'] },
      content: { copied: ['references', 'mitigation_suggestions', 'detection_methods', 'tags'], techniques: ['T1059', 'AML.T0049', 'AML.T0051'] },
      source_reason: `Superseded by user-authored exposure 'Exposure x (custom)'`,
    })
    expect(p!.mitre).toEqual({ add: ['T1059', 'AML.T0051'], remove: ['T1190'] })
  })

  it('names the copy after a renamed source, while its note still names the source', () => {
    const [p] = planOperations(input([supersede({ name: 'Open admin port', description: 'Admin port open' })]))
    expect(p!.clone!.name).toBe('Open admin port (custom)')
    expect(p!.clone!.changes).toEqual({ name: 'Open admin port', description: 'Admin port open' })
    expect(p!.clone!.description).toEqual({ from: 'changes', note: "(custom of 'Exposure x')" })
  })

  it('supersedes an affirmed exposure, and rejects one disposed otherwise', () => {
    const i = input([supersede({ score: 1 })])
    i.state.set('x', state('x', { disposition_kind: 'AFFIRMED' }))
    expect(planOperations(i)[0]!.status).toBe('ready')
    i.state.set('x', state('x', { disposition_kind: 'FALSE_POSITIVE' }))
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'target_disposed' })
    i.state.set('x', state('x', { disposition_kind: 'SUPERSEDED' }))
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'target_superseded' })
  })

  it('rejects a second copy of one name on one element within the plan', () => {
    const i = input([
      op({ exposure_id: 'x', op: 'supersede', modifications: { name: 'Weak TLS' } }),
      op({ exposure_id: 'y', op: 'supersede', modifications: { name: 'Weak TLS' } }),
    ])
    expect(planOperations(i).map((o) => [o.status, o.code])).toEqual([['ready', undefined], ['rejected', 'copy_exists']])
  })

  it('rejects a supersede whose evidence differs from the row it is bound to', () => {
    const i = input([supersede({ score: 1 })])
    i.evidence.set('x', evidence('x', { def_hash: 'other' }))
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'target_changed' })
  })

  it('rejects a copy whose name would hold a single quote', () => {
    const i = input([supersede({ score: 1 })])
    i.state.set('x', state('x', { name: "Admin's port" }))
    i.evidence.set('x', evidence('x', { name: "Admin's port" }))
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'copy_name_invalid' })
  })

  it('rejects a supersede whose copy would take a name the element already has', () => {
    const i = input([supersede({ score: 1 })])
    i.state.set('y', state('y', { name: 'Exposure x (custom)', created_by: 'USER' }))
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'copy_exists' })
    i.state.set('y', state('y', { name: 'Exposure x (custom)', element_id: 'c9' }))
    expect(planOperations(i)[0]!.status).toBe('ready')
  })

  const rejected: Array<[string, ReviewOperation['modifications'], string[], string]> = [
    ['a technique not among the verified ids', { techniques: { add: ['n-t1059'], remove: [] } }, [], 'technique_not_verified'],
    ['a technique the platform does not know', { techniques: { add: ['n-nope'], remove: [] } }, ['n-nope'], 'technique_not_verified'],
    ['removing a technique the exposure does not have', { techniques: { add: [], remove: ['n-t1059'] } }, [], 'remove_not_present'],
    ['no change at all', {}, [], 'empty_supersede'],
    ['an empty technique change', { techniques: { add: [], remove: [] } }, [], 'empty_supersede'],
  ]
  it.each(rejected)('rejects %s', (_what, m, verified, code) => {
    expect(planOperations(input([supersede(m, verified)]))[0]).toMatchObject({ status: 'rejected', code })
  })

  it('says what it checks of a technique: listed as verified, and on the platform', () => {
    const [unlisted] = planOperations(input([supersede({ techniques: { add: ['n-t1059'], remove: [] } })]))
    expect(unlisted!.detail).toBe("technique n-t1059 is not among the proposal's verified_technique_ids: only ids listed there are added")
    const [unknown] = planOperations(input([supersede({ techniques: { add: ['n-nope'], remove: [] } }, ['n-nope'])]))
    expect(unknown!.detail).toBe('technique n-nope is no ATT&CK or ATLAS technique on the platform')
    expect(WHY.technique_not_verified).not.toMatch(/looked up/)
  })

  it('rejects a supersede whose exposure could not be read', () => {
    const i = input([supersede({ score: 1 })])
    i.evidence.delete('x')
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'evidence_unread', detail: WHY.evidence_unread })
  })

  it('creates the copy on the row\'s element from the model read, never on an element another read lists', () => {
    const i = input([supersede({ score: 1 })])
    i.state.set('x', state('x', { element_id: 'c7', element_name: 'Orders' }))
    // An evidence read that carried elements of another model first: nothing of it names the copy's element.
    const foreign = [{ id: 'other-1', name: 'Customer' }, { id: 'c1', name: 'API' }, { id: 'c7', name: 'Orders' }]
    i.evidence.set('x', { ...evidence('x'), elements: foreign } as ExposureEvidence)
    expect(planOperations(i)[0]).toMatchObject({ status: 'ready', element: 'Orders', clone: { element_id: 'c7', element_name: 'Orders' } })
  })
})

describe('linesOf', () => {
  const MODEL = { model_id: 'model-1', model_name: 'Shop' }

  it('shows the model, each group\'s writes, then what is not applied, by why', () => {
    const i = input([
      op({ exposure_id: 'gone', op: 'dispose', kind: 'AFFIRMED', reason: 'r' }),
      op({ exposure_id: 'a', op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'misread' }),
      op({ exposure_id: 'a2', op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'misread' }),
      op({ group: 2, exposure_id: 'b', op: 'clear' }),
      op({ group: 3, exposure_id: 'c', op: 'supersede', modifications: { score: 2, attackVector: 'LOCAL', techniques: { add: ['n-t1059'], remove: ['n-t1190'] } }, verified_technique_ids: ['n-t1059'] }),
    ])
    i.state.set('a2', state('a2', { disposition_kind: 'RISK_ACCEPTED', full_reason: 'accepted\nby the owner' }))
    i.state.set('b', state('b', { disposition_kind: 'NOT_APPLICABLE' }))
    i.state.set('c', state('c', { disposition_kind: 'AFFIRMED', full_reason: 'confirmed' }))
    expect(linesOf(MODEL, planOperations(i))).toEqual([
      'Platform model "Shop" (model-1)',
      '4 write(s): 2 dispose, 1 supersede, 1 clear, 0 reaffirm; 2 replace a disposition; 0 set COMPENSATING_CONTROL or RISK_ACCEPTED; 1 not applied',
      `Group 1: dispose as FALSE_POSITIVE with "misread${MARKER_APPROVED}": "Exposure a" on "API" #a; "Exposure a2" on "API" #a2 (replacing RISK_ACCEPTED: "accepted by the owner")`,
      'Group 2: clear the disposition of "Exposure b" on "API" #b (NOT_APPLICABLE)',
      `Group 3: supersede "Exposure c" on "API" #c (replacing AFFIRMED: "confirmed"): create "Exposure c (custom)" on "API"; score 5 → 2; attack vector "NETWORK" → "LOCAL"; techniques added T1059; techniques removed T1190; references, mitigations, detections and tags copied; the description ends with "(custom of 'Exposure c')"; "Exposure c" on "API" #c marked SUPERSEDED with "Superseded by user-authored exposure 'Exposure c (custom)'"`,
      'Not applied (not_in_model): the exposure is not in this model on the platform: "gone" on an unknown element #gone',
    ])
  })

  it('shows platform text on one line, with invisible characters marked, and cuts a long name', () => {
    expect(shown('a\u202eb\u200bc\r\nd')).toBe('a?b?c d')
    expect(shown('n'.repeat(500), SHOWN_MAX)).toHaveLength(SHOWN_MAX)
    const i = input([op({ exposure_id: 'a', op: 'clear' })])
    i.state.set('a', state('a', { name: 'evil\n"name"', element_name: 'api\u202e' }))
    expect(linesOf(MODEL, planOperations(i))[2]).toBe('Group 1: clear the disposition of "evil \\"name\\"" on "api?" #a (none)')
  })

  it('escapes a quote or a backslash, so no text can close its quotes', () => {
    const i = input([op({ exposure_id: 'a', op: 'dispose', kind: 'AFFIRMED', reason: 'ok" : "Exposure b" on "API' })])
    i.state.set('a', state('a', { name: 'x\\" on "API" #b; "y', element_name: 'A"PI' }))
    const line = linesOf(MODEL, planOperations(i))[2]!
    expect(line).toBe(`Group 1: dispose as AFFIRMED with "ok\\" : \\"Exposure b\\" on \\"API${MARKER_APPROVED}": "x\\\\\\" on \\"API\\" #b; \\"y" on "A\\"PI" #a`)
    // Every quote the texts brought is escaped: the unescaped ones are only the line's own, in pairs.
    expect(line.replace(/\\./g, '').match(/"/g)).toHaveLength(6)
  })

  it('tells same-named exposures apart by the shortest id tail of at least 8 characters that differs', () => {
    const ids = ['exposure-0000-a11112222', 'exposure-0000-b11112222', 'short']
    const i = input(ids.map((exposure_id) => op({ exposure_id, op: 'clear' })))
    for (const id of ids) i.state.set(id, state(id, { name: 'Weak TLS' }))
    expect(linesOf(MODEL, planOperations(i))[2]).toBe('Group 1: clear the disposition of "Weak TLS" on "API" #…a11112222 (none); "Weak TLS" on "API" #…b11112222 (none); "Weak TLS" on "API" #short (none)')
    const one = input([op({ exposure_id: ids[0]!, op: 'clear' })])
    expect(linesOf(MODEL, planOperations(one))[2]).toBe('Group 1: clear the disposition of "Exposure exposure-0000-a11112222" on "API" #…11112222 (none)')
  })

  it('quotes and escapes every free text of a supersede line: category, attack vector, the note', () => {
    const forged = 'x; "Other" on "DB" #abc marked SUPERSEDED with "y'
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { category: forged, attackVector: forged } })])
    i.state.set('x', state('x', { name: 'A "b"' }))
    i.evidence.set('x', evidence('x', { name: 'A "b"', category: 'c"d' }))
    const line = linesOf(MODEL, planOperations(i))[2]!
    const esc = 'x; \\"Other\\" on \\"DB\\" #abc marked SUPERSEDED with \\"y'
    expect(line).toContain(`attack vector "NETWORK" → "${esc}"; category "c\\"d" → "${esc}"; `)
    expect(line).toContain('the description ends with "(custom of \'A \\"b\\"\')"; ')
    // Every quote the texts brought is escaped: an even count of unescaped quotes, each pair the line's own.
    expect(line.replace(/\\./g, '').match(/"/g)!.length % 2).toBe(0)
    expect(line.replace(/\\./g, '')).not.toMatch(/"Other"/)
  })

  it('rejects a supersede whose copy\'s element changed since the review was opened', () => {
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { score: 1 } })])
    i.seen = new Map([['x', state('x')]])
    expect(planOperations(i)[0]!.status).toBe('ready')
    for (const change of [{ element_name: 'A much longer name for the API' }, { element_id: 'c7' }] as Array<Partial<ExposureState>>) {
      i.state.set('x', state('x', change))
      expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'target_changed', detail: 'the element the copy would be created on changed since the review was opened' })
    }
  })

  it('names a copy\'s element with no name as unknown', () => {
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { score: 1 } })])
    i.state.set('x', state('x', { element_name: null as unknown as string }))
    expect(linesOf(MODEL, planOperations(i))[2]).toContain(': create "Exposure x (custom)" on an unknown element; ')
  })

  it('names the element the copy is created on, and a changed description from old to new', () => {
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { description: 'Admin "port" open' } })])
    i.state.set('x', state('x', { element_id: 'c7', element_name: 'Gateway' }))
    const line = linesOf(MODEL, planOperations(i))[2]!
    expect(line).toContain('supersede "Exposure x" on "Gateway" #x: create "Exposure x (custom)" on "Gateway"; description "An open port" → "Admin \\"port\\" open"; ')
    i.state.set('x', state('x'))
    i.evidence.set('x', evidence('x', { description: null }))
    expect(linesOf(MODEL, planOperations(i))[2]).toContain('; description none → "Admin \\"port\\" open"; ')
  })

  it('holds only the model and summary lines for an empty plan', () => {
    expect(linesOf(MODEL, planOperations(input([])))).toEqual([
      'Platform model "Shop" (model-1)',
      '0 write(s): 0 dispose, 0 supersede, 0 clear, 0 reaffirm; 0 replace a disposition; 0 set COMPENSATING_CONTROL or RISK_ACCEPTED; 0 not applied',
    ])
  })
})

describe('planOperations: what the review saw', () => {
  it('rejects an exposure whose bound state changed since the review was opened', () => {
    for (const change of [{ disposition_kind: 'AFFIRMED' }, { disposition_stale: true }, { def_hash: 'h2' }, { full_reason: 'x' }, { name: 'renamed' }, { score: 9 }, { attack_vector: 'LOCAL' }] as Array<Partial<ExposureState>>) {
      const i = input([op({ exposure_id: 'a', op: 'clear' })])
      i.seen = new Map([['a', state('a')]])
      i.state.set('a', state('a', change))
      expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'target_changed' })
    }
  })

  it('names a vanished exposure as the review saw it', () => {
    const i = input([op({ exposure_id: 'gone', op: 'clear' })])
    i.seen = new Map([['gone', state('gone', { name: 'Old name' })]])
    expect(planOperations(i)[0]).toMatchObject({ status: 'rejected', code: 'not_in_model', name: 'Old name' })
  })
})

describe('fingerprintOf and changedSince', () => {
  const ops = () => planOperations(input([op({ exposure_id: 'a', op: 'clear' }), op({ exposure_id: 'gone', op: 'clear' })]))
  const before = () => new Map([['a', state('a')], ['z', state('z')]])

  it('binds to the ready operations only', () => {
    const changedElsewhere = before()
    changedElsewhere.set('z', state('z', { disposition_kind: 'AFFIRMED' }))
    expect(fingerprintOf(ops(), before())).toBe(fingerprintOf(ops(), changedElsewhere))
    expect(changedSince(ops(), before(), changedElsewhere)).toEqual([])
  })

  const changes: Array<[string, Partial<ExposureState>]> = [
    ['the kind', { disposition_kind: 'AFFIRMED' }],
    ['staleness', { disposition_stale: true }],
    ['the definition', { def_hash: 'h2' }],
    ['the reason', { full_reason: 'other' }],
    ['the time', { dispositioned_at: '2026-11-11T00:00:00Z' }],
  ]
  it.each(changes)('sees a change of %s', (_what, over) => {
    const after = before()
    after.set('a', state('a', over))
    expect(fingerprintOf(ops(), before())).not.toBe(fingerprintOf(ops(), after))
    expect(changedSince(ops(), before(), after)).toEqual(['a'])
  })

  it('sees an exposure gone', () => {
    const after = before()
    after.delete('a')
    expect(changedSince(ops(), before(), after)).toEqual(['a'])
  })

  it('ignores what the plan is not bound to', () => {
    const after = before()
    after.set('a', state('a', { element_name: 'renamed', category: 'other' }))
    expect(changedSince(ops(), before(), after)).toEqual([])
  })
})

describe('applyAnswer', () => {
  it.each([
    ['yes', 'yes'],
    ['  YES ', 'yes'],
    ['Yes (Recommended)', 'yes'],
    ['cancel', 'cancel'],
    ['Cancel (recommended)', 'cancel'],
    ['y', null],
    ['yes please', null],
    ['yes (Recommended) (Recommended)', null],
    ['no', null],
    ['', null],
  ])('reads %j as %s', (reply, answer) => {
    expect(applyAnswer(reply)).toBe(answer)
  })
})

describe('readTechniques', () => {
  it('asks nothing for no ids, and maps what the platform returns', async () => {
    const query = vi.fn(async () => ({ data: { mitreAttackTechniques: [{ id: 'n1', attack_id: 'T1001' }], mitreAtlasTechniques: [{ id: 'n2', atlas_id: 'AML.T0002' }] } }))
    expect(await readTechniques({ query } as unknown as ApolloClient, [])).toEqual({ attack: new Map(), atlas: new Map() })
    expect(query).not.toHaveBeenCalled()
    const known = await readTechniques({ query } as unknown as ApolloClient, ['n1', 'n2'])
    expect([...known.attack]).toEqual([['n1', 'T1001']])
    expect([...known.atlas]).toEqual([['n2', 'AML.T0002']])
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ variables: { ids: ['n1', 'n2'] }, fetchPolicy: 'no-cache' }))
  })
})

describe('writeOperations', () => {
  beforeEach(() => {
    calls.length = 0
    flow.mockReset()
    linksOf = () => ({ exploitedBy: [{ id: 'n-t1190', justification: 'kept' }], exploitedByAtlas: [{ id: 'n-aml0049' }] })
    disposeResult = () => ({ success: true, dispositionKind: 'FALSE_POSITIVE', dispositionReason: 'r' })
  })

  it('writes the ready operations in order, skips the rejected ones, and goes on past a failure', async () => {
    disposeResult = (i) => (i.exposureId === 'a' ? { success: false, errorMessage: 'refused', errorCode: 'FORBIDDEN' } : { success: true, dispositionKind: 'AFFIRMED', dispositionReason: 'ok' })
    const planned = planOperations(input([
      op({ exposure_id: 'a', op: 'dispose', kind: 'AFFIRMED', reason: 'r' }),
      op({ exposure_id: 'gone', op: 'dispose', kind: 'AFFIRMED', reason: 'r' }),
      op({ exposure_id: 'b', op: 'dispose', kind: 'AFFIRMED', reason: 'r' }),
      op({ exposure_id: 'c', op: 'clear' }),
    ]))
    const outcomes = await writeOperations(client, planned, new Map())
    expect(calls.map(([what, i]) => [what, (i as { exposureId: string }).exposureId])).toEqual([['dispose', 'a'], ['dispose', 'b'], ['clear', 'c']])
    expect(outcomes).toEqual([
      { index: 0, exposure_id: 'a', op: 'dispose', status: 'failed', error: 'refused', error_code: 'FORBIDDEN' },
      { index: 2, exposure_id: 'b', op: 'dispose', status: 'applied', kind: 'AFFIRMED', reason: 'ok' },
      { index: 3, exposure_id: 'c', op: 'clear', status: 'applied', kind: null, reason: null },
    ])
    expect(calls[0]![1]).toEqual({ exposureId: 'a', kind: 'AFFIRMED', reason: `r${MARKER_APPROVED}` })
  })

  it('records a thrown write as failed', async () => {
    disposeResult = () => {
      throw new Error('network down')
    }
    const outcomes = await writeOperations(client, planOperations(input([op({ exposure_id: 'a', op: 'dispose', kind: 'AFFIRMED', reason: 'r' })])), new Map())
    expect(outcomes).toEqual([{ index: 0, exposure_id: 'a', op: 'dispose', status: 'failed', error: 'network down' }])
  })

  const supersedePlan = () => {
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { score: 2, techniques: { add: ['n-t1059'], remove: [] } }, verified_technique_ids: ['n-t1059'] })])
    return { planned: planOperations(i), evidence: i.evidence }
  }

  it('supersedes with the kept links as they are now, the added ones bare, and the copied content', async () => {
    flow.mockResolvedValue({ userCopy: { id: 'copy-1' }, systemDispositionResult: { success: true, dispositionKind: 'SUPERSEDED', dispositionReason: 'sr' } })
    const { planned, evidence: ev } = supersedePlan()
    const outcomes = await writeOperations(client, planned, ev)
    expect(flow).toHaveBeenCalledTimes(1)
    const arg = flow.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      systemExposureId: 'x',
      systemExposure: { id: 'x', name: 'Exposure x', description: 'An open port', type: 'weakness', category: 'network', score: 2, attackVector: 'NETWORK' },
      elementId: 'c1',
      copyName: 'Exposure x (custom)',
      techniqueLinks: { exploitedBy: [{ id: 'n-t1190', justification: 'kept' }, { id: 'n-t1059' }], exploitedByAtlas: [{ id: 'n-aml0049' }] },
      cloneContent: { references: 'https://example.test/advisory', mitigationSuggestions: ['close it'], detectionMethods: ['scan'], tags: ['net'], techniques: ['T1190', 'T1059', 'AML.T0049'] },
    })
    expect(outcomes).toEqual([{ index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'applied', clone_id: 'copy-1', kind: 'SUPERSEDED', reason: 'sr' }])
  })

  it('creates the copy on the row\'s element, whatever the evidence read carried', async () => {
    flow.mockResolvedValue({ userCopy: { id: 'copy-1' }, systemDispositionResult: { success: true, dispositionKind: 'SUPERSEDED', dispositionReason: 'sr' } })
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { score: 2 } })])
    i.state.set('x', state('x', { element_id: 'c7', element_name: 'Orders' }))
    i.evidence.set('x', { ...evidence('x'), elements: [{ id: 'other-1', name: 'Customer' }] } as ExposureEvidence)
    await writeOperations(client, planOperations(i), i.evidence)
    expect(flow).toHaveBeenCalledTimes(1)
    expect(flow.mock.calls[0]![0]).toMatchObject({ elementId: 'c7' })
  })

  it('gives a renaming supersede the source\'s name, for the note, and the copy\'s name apart', async () => {
    flow.mockResolvedValue({ userCopy: { id: 'copy-1' }, systemDispositionResult: { success: true, dispositionKind: 'SUPERSEDED', dispositionReason: 'sr' } })
    const i = input([op({ exposure_id: 'x', op: 'supersede', modifications: { name: 'Admin port' } })])
    await writeOperations(client, planOperations(i), i.evidence)
    expect(flow.mock.calls[0]![0]).toMatchObject({ systemExposure: { name: 'Exposure x' }, copyName: 'Admin port (custom)' })
  })

  it('reports a copy whose source could not be marked because the call failed, with its id', async () => {
    flow.mockRejectedValue(new SupersedeDisposeError('Supersede incomplete: network down', 'copy-3'))
    const { planned, evidence: ev } = supersedePlan()
    expect(await writeOperations(client, planned, ev)).toEqual([
      { index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'partial', clone_id: 'copy-3', error: 'Supersede incomplete: network down' },
    ])
  })

  it('reports a copy whose content step failed as partial, with its id and the warning, though the source was marked', async () => {
    flow.mockResolvedValue({ userCopy: { id: 'copy-1' }, contentWarning: 'tags not copied', systemDispositionResult: { success: true, dispositionKind: 'SUPERSEDED', dispositionReason: 'sr' } })
    const { planned, evidence: ev } = supersedePlan()
    expect(await writeOperations(client, planned, ev)).toEqual([{
      index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'partial', clone_id: 'copy-1', kind: 'SUPERSEDED', reason: 'sr',
      content_warning: 'tags not copied', error: "the copy copy-1 was created and the source marked SUPERSEDED, but the copy lacks the source's references, mitigations, detections and tags: add them to the copy on the platform; preparing again does not",
    }])
  })

  it('keeps the content warning of a copy whose source could not be marked because the call failed', async () => {
    flow.mockRejectedValue(new SupersedeDisposeError('Supersede incomplete: network down', 'copy-3', 'tags not copied'))
    const { planned, evidence: ev } = supersedePlan()
    expect(await writeOperations(client, planned, ev)).toEqual([
      { index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'partial', clone_id: 'copy-3', error: 'Supersede incomplete: network down', content_warning: 'tags not copied' },
    ])
  })

  it('reports a copy whose content step failed, and a source that could not be marked', async () => {
    flow.mockResolvedValue({ userCopy: { id: 'copy-1' }, contentWarning: 'tags not copied', systemDispositionResult: { success: false, errorMessage: 'locked' } })
    const { planned, evidence: ev } = supersedePlan()
    expect(await writeOperations(client, planned, ev)).toEqual([
      { index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'partial', clone_id: 'copy-1', error: 'locked', content_warning: 'tags not copied' },
    ])
  })

  it('names the copy left behind when the link step fails', async () => {
    flow.mockRejectedValue(new SupersedeCloneError('the links could not be set', 'copy-2'))
    const { planned, evidence: ev } = supersedePlan()
    expect(await writeOperations(client, planned, ev)).toEqual([
      { index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'failed', clone_id: 'copy-2', error: 'the links could not be set' },
    ])
  })

  it('creates nothing when the source is gone', async () => {
    linksOf = () => null
    const { planned, evidence: ev } = supersedePlan()
    expect(await writeOperations(client, planned, ev)).toEqual([
      { index: 0, exposure_id: 'x', op: 'supersede', clone_name: 'Exposure x (custom)', status: 'failed', error: 'the exposure is gone: nothing was created' },
    ])
    expect(flow).not.toHaveBeenCalled()
  })
})
