/**
 * The settlement prompt after an orphaned-drop: the dropped values asked again,
 * and nothing else, is what a correct run does; any other showing needs review.
 */
import { describe, it, expect } from 'vitest'
import { settlementPromptFindings } from '../score/model-gates.js'
import { shownPrompts, type Registry } from '../score/prompts.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { eventBuilder } from './helpers.js'

const builder = eventBuilder()
const ev = builder.ev
const registry: Registry = new Map([['unregistered-confirm', { mandatory: true, requires: [] }], ['orphaned-drop', { mandatory: true, requires: [] }]])
const GET = 'dethereal.model_state'
const SETTLE = 'dethereal.model_state_settle'
let calls = 0
const call = (tool: string, input: unknown, result: unknown, isError = false) => {
  const callId = `c${calls++}`
  return [ev({ kind: 'tool_call', tool, callId, input }), ev({ kind: 'tool_result', tool, callId, text: JSON.stringify(result), ...(isError ? { isError } : {}) })]
}
const get = (result: Record<string, unknown>) => call(GET, { action: 'get', directory_path: '/p/m' }, result)
/** Rows as `get` shows them: `[group, element id, name, field]`; a placement row shows the element's path. */
type RowSpec = [string, string, string, string, string?]
const rows = (...r: RowSpec[]) => ({
  rows_total: r.length,
  rows: r.map(([group, element_id, name, field, path]) => ({ group, element_id, name, field, record: true, ...(field === 'placement' ? { shown: `${path} (boundary)` } : {}) })),
})
const STORE: RowSpec = ['components', 'c-store', 'Secret Store', 'placement', 'Cloud / Secret Store']
const SUBNET: RowSpec = ['boundaries', 'b-ops', 'Operations Subnet (10.20.9.0/28)', 'placement', 'VPC / Operations Subnet (10.20.9.0/28)']
const DROPPED = ['Cloud / Secret Store', 'VPC / Operations Subnet (10.20.9.0 / 28)']

interface Run {
  answer?: string
  dropped?: number
  elements?: string[]
  elementsTotal?: number
  settleError?: 'error' | 'error-then-retry' | 'none'
  lastGet?: 'after' | 'none'
  serverWrite?: boolean
  hashAfter?: string
  shownRows?: ReturnType<typeof rows>
  between?: (e: typeof ev) => TranscriptEvent[]
}
/** A drop of registrations on two elements, its acknowledging settle, the `get` after it and the settlement prompt. */
function run(o: Run = {}): TranscriptEvent[] {
  builder.reset()
  calls = 0
  const settleResult = { recorded: 0, orphaned_dropped: o.dropped ?? 22, orphaned_dropped_elements: o.elements ?? DROPPED, orphaned_dropped_elements_total: o.elementsTotal ?? (o.elements ?? DROPPED).length }
  return [
    ...get({ content_hash: 'h1', orphaned_registrations: { total: 22 }, unregistered_changes: { rows_total: 0, rows: [] } }),
    ev({ kind: 'ask', input: { questions: [{ question: '[prompt: orphaned-drop] Drop those registrations?' }] } }),
    ev({ kind: 'answer', answers: [o.answer ?? 'drop'] }),
    ...(o.settleError === 'none' ? [] : o.settleError === 'error' ? call(SETTLE, { orphaned_acknowledged: 22 }, { error: 'x' }, true)
      : o.settleError === 'error-then-retry' ? [...call(SETTLE, { orphaned_acknowledged: 22 }, { error: 'x' }, true), ...call(SETTLE, { orphaned_acknowledged: 22 }, settleResult)]
        : call(SETTLE, { orphaned_acknowledged: 22 }, settleResult)),
    ...(o.serverWrite === false ? [] : [ev({ kind: 'server_write', tool: SETTLE })]),
    ...(o.lastGet === 'none' ? [] : get({ content_hash: o.hashAfter ?? 'h1', orphaned_registrations: { total: 0 },
      unregistered_changes: o.shownRows ?? rows(STORE, ['components', 'c-store', 'Secret Store', 'zone'], SUBNET, ['boundaries', 'b-ops', 'Operations Subnet (10.20.9.0/28)', 'planes']) })),
    ...(o.between?.(ev) ?? []),
    ev({ kind: 'assistant', text: '[prompt: unregistered-confirm] Confirm these values? (confirm all / adjust / not now)' }),
    ev({ kind: 'user', text: 'confirm all' }),
  ]
}
const flagged = (events: TranscriptEvent[]) => settlementPromptFindings(shownPrompts(events, registry), events).map((f) => f.code)

describe('the settlement prompt after an orphaned-drop', () => {
  it('needs nothing when it asks again for exactly the dropped values, on the same model, and the operator picked drop', () => {
    expect(flagged(run())).toEqual([])
    expect(flagged(run({ answer: 'Drop the old registrations' }))).toEqual([])
    // A settle refused and then retried is still the drop.
    expect(flagged(run({ settleError: 'error-then-retry' }))).toEqual([])
  })

  it('needs review without a drop the server made', () => {
    expect(flagged(run({ answer: 'stop' }))).toEqual(['settlement_prompt_shown'])
    expect(flagged(run({ settleError: 'none' }))).toEqual(['settlement_prompt_shown'])
    expect(flagged(run({ settleError: 'error' }))).toEqual(['settlement_prompt_shown'])
    // The dropped elements not all named: the rows cannot be tied to them.
    expect(flagged(run({ elementsTotal: 30 }))).toEqual(['settlement_prompt_shown'])
  })

  it('needs review when the model changed, or may have, since the orphans were reported', () => {
    // The settle wrote values too, or anything else did: the model the rows describe is not the one the drop saw.
    expect(flagged(run({ hashAfter: 'h2' }))).toEqual(['settlement_prompt_shown'])
    // No get after the settle: the rows are not known, and the get from before the drop does not stand for it.
    expect(flagged(run({ lastGet: 'none' }))).toEqual(['settlement_prompt_shown'])
    expect(flagged(run({ lastGet: 'none', serverWrite: false }))).toEqual(['settlement_prompt_shown'])
    for (const write of [
      (e: typeof ev) => [e({ kind: 'file_write', path: 'threat-models/m/attributes/components/c-a.json' })],
      (e: typeof ev) => [e({ kind: 'shell', text: 'python3 edit.py', writesModel: true })],
      (e: typeof ev) => [e({ kind: 'server_write', tool: 'dethereal.update_attributes' })],
      (e: typeof ev) => [e({ kind: 'file_write', actor: 'dethereal:security-enricher', path: 'threat-models/m/structure.json' })],
    ]) expect(flagged(run({ between: write }))).toEqual(['settlement_prompt_shown'])
    // A read in between changes nothing.
    expect(flagged(run({ between: (e) => [e({ kind: 'shell', text: 'python3 -c "print(1)"' })] }))).toEqual([])
  })

  it('needs review when a row is not a dropped value', () => {
    expect(flagged(run({ dropped: 2 }))).toEqual(['settlement_prompt_shown'])
    expect(flagged(run({ shownRows: rows(STORE, ['components', 'c-api', 'Orders API', 'placement', 'Cloud / Orders API'], ['components', 'c-api', 'Orders API', 'required_credentials']) })))
      .toEqual(['settlement_prompt_shown'])
    // Another element with a dropped element's name, in another group: its row is not the dropped one's.
    expect(flagged(run({ shownRows: rows(STORE, ['dataItems', 'd-store', 'Secret Store', 'sensitivity']) }))).toEqual(['settlement_prompt_shown'])
    // A row whose element shows no placement row cannot be placed.
    expect(flagged(run({ shownRows: rows(['components', 'c-store', 'Secret Store', 'zone']) }))).toEqual(['settlement_prompt_shown'])
    // A get that lists only part of its rows cannot be checked.
    expect(flagged(run({ shownRows: { ...rows(STORE), rows_total: 3 } }))).toEqual(['settlement_prompt_shown'])
    // A path only ending like a dropped element's is another element.
    expect(flagged(run({ shownRows: rows(['components', 'c-x', 'Store', 'placement', 'Store']) }))).toEqual(['settlement_prompt_shown'])
  })

  it('reads each showing against the latest drop before it', () => {
    const first = run()
    const later = [
      ...first,
      ev({ kind: 'ask', input: { questions: [{ question: '[prompt: orphaned-drop] Drop those registrations?' }] } }),
      ev({ kind: 'answer', answers: ['stop'] }),
      ev({ kind: 'assistant', text: '[prompt: unregistered-confirm] Confirm these values?' }),
      ev({ kind: 'user', text: 'confirm all' }),
    ]
    const findings = settlementPromptFindings(shownPrompts(later, registry), later)
    expect(findings.map((f) => f.events)).toEqual([[later.length - 2]])
  })
})
