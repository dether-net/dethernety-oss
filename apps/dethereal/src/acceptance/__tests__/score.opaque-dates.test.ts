/**
 * Changes the replay could not see: which push renamed the ids in them, and
 * when H5 takes them to have been written.
 */
import { describe, it, expect } from 'vitest'
import { pushes } from '../score/id-remap.js'
import { writtenAt } from '../score/h5.js'
import { settledAt } from '../score/settled-at.js'
import type { ElementChange } from '../score/element-changes.js'
import type { TextChange } from '../transcripts/replay.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { eventBuilder } from './helpers.js'

const SETTLE = 'dethereal.model_state_settle'
const IMPORT = 'dethereal.import_model'
const UPDATE = 'dethereal.update_model'

/** A run's events: each server tool as call, result and write, in that order; `other` any other event. */
function run(steps: Array<{ tool: string; result?: unknown; error?: boolean } | { other: TranscriptEvent['kind'] } | { edit: { old_string: string; new_string: string } }>) {
  const { ev } = eventBuilder()
  const events: TranscriptEvent[] = []
  const writes: number[] = []
  steps.forEach((s, i) => {
    if ('other' in s) {
      events.push(ev({ kind: s.other }))
      writes.push(events.length - 1)
      return
    }
    if ('edit' in s) {
      events.push(ev({ kind: 'tool_call', tool: 'Edit', callId: `e${i}`, input: { file_path: '/p/m/structure.json', ...s.edit } }))
      events.push(ev({ kind: 'file_write', tool: 'Edit', callId: `e${i}`, path: 'm/structure.json' }))
      writes.push(events.length - 1)
      return
    }
    const callId = `c${i}`
    events.push(ev({ kind: 'tool_call', tool: s.tool, callId, input: {} }))
    events.push(ev({ kind: 'tool_result', tool: s.tool, callId, text: typeof s.result === 'string' ? s.result : JSON.stringify(s.result ?? {}), isError: s.error ?? false }))
    events.push(ev({ kind: 'server_write', tool: s.tool, callId }))
    writes.push(events.length - 1)
  })
  return { events, writes }
}

const structure = (ids: string[]) => JSON.stringify({ defaultBoundary: { id: 'root', name: 'root', components: ids.map((id, i) => ({ id, name: `c${i}` })) } })
const textChange = (since: number, covered: number[]): TextChange => ({
  path: 'm/structure.json', before: structure(['a', 'b']), after: structure(['x', 'y']), opaque: { since, resyncedAt: 99, alsoCovered: covered },
})

describe('the push behind a change', () => {
  it('finds a push that only covered a window an earlier write opened', () => {
    const { events, writes } = run([{ tool: SETTLE }, { tool: IMPORT }])
    const found = pushes(events, [textChange(writes[0]!, [writes[1]!])])
    expect(found.map((p) => [p.seq, [...p.map]])).toEqual([[writes[1], [['a', 'x'], ['b', 'y']]]])
  })

  it('keeps the push the window opened at, whatever pushed after it', () => {
    const { events, writes } = run([{ tool: IMPORT }, { tool: UPDATE }])
    expect(pushes(events, [textChange(writes[0]!, [writes[1]!])]).map((p) => p.seq)).toEqual([writes[0]])
  })

  it('finds none when two pushes covered a window another write opened', () => {
    const { events, writes } = run([{ tool: SETTLE }, { tool: IMPORT }, { tool: UPDATE }])
    expect(pushes(events, [textChange(writes[0]!, [writes[1]!, writes[2]!])])).toEqual([])
  })
})

const echo = (entries: Array<Record<string, unknown>>) => ({ recorded: entries.length, echo: entries })
const setEntry = (value: unknown, previous: unknown, extra: Record<string, unknown> = {}) =>
  ({ decision: 'set', group: 'components', element_id: 'c-db', field: 'f', value: { value }, previous: previous === undefined ? { absent: true } : { value: previous }, ...extra })
const change = (window: number[], after: unknown = true, extra: Partial<ElementChange> = {}): ElementChange => ({
  path: 'm/attributes/components/c-db.json', element: 'c-db', field: 'f', before: null, after,
  opaque: { since: window[0]!, resyncedAt: 99, alsoCovered: window.slice(1) }, ...extra,
} as ElementChange)

describe('the settle that wrote a change', () => {
  it('dates a value at the settle that set it over another, after a refused one opened the window', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true, result: 'settle refused' }, { tool: SETTLE, result: echo([setEntry(true, null)]) }])
    expect(settledAt(change(writes), events, [])).toBe(writes[1])
    expect(writtenAt(change(writes), events, [])).toBe(writes[1])
  })

  it('reads a field the settle added, and a modify', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(true, undefined)]) }])
    expect(settledAt(change(writes), events, [])).toBe(writes[1])
    const m = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(true, false, { decision: 'modify' })]) }])
    expect(settledAt(change(m.writes), m.events, [])).toBe(m.writes[1])
  })

  it('never dates a value an accept or a confirm only found', () => {
    for (const decision of ['accept', 'confirm']) {
      const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(true, null, { decision })]) }])
      expect(settledAt(change(writes), events, []), decision).toBeUndefined()
      expect(writtenAt(change(writes), events, []), decision).toBe(writes[0])
    }
  })

  it('never dates a value set over an equal one: something wrote it before', () => {
    const { events, writes } = run([{ other: 'shell' }, { tool: SETTLE, result: echo([setEntry(true, true)]) }])
    expect(settledAt(change(writes), events, [])).toBeUndefined()
  })

  it('never dates it from an echo it cannot read, or one that shows another value', () => {
    const cases: Array<unknown> = ['not json', { recorded: 1 }, echo([{ ...setEntry(true, null), value: { undisplayable: true, sha256: 'x' } }]), echo([setEntry(false, null)]), echo([setEntry(true, null, { field: 'g' })])]
    for (const result of cases) {
      const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result }])
      expect(settledAt(change(writes), events, []), JSON.stringify(result)).toBeUndefined()
    }
    // A settle it cannot read comes first: it may have written the value, so a later one dates nothing.
    for (const first of ['not json', { recorded: 1 }, echo([{ ...setEntry(true, null), value: { undisplayable: true, sha256: 'x' } }])]) {
      const { events, writes } = run([{ tool: SETTLE, result: first }, { tool: SETTLE, result: echo([setEntry(true, null)]) }])
      expect(settledAt(change(writes), events, []), JSON.stringify(first)).toBeUndefined()
    }
  })

  it('never dates it at a refused settle, whatever its result shows', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true, result: echo([setEntry(true, null)]) }])
    expect(settledAt(change(writes), events, [])).toBeUndefined()
  })

  it('keeps the window opening when another server tool, or a settle of another value, wrote first', () => {
    const other = run([{ tool: 'dethereal.update_attributes' }, { tool: SETTLE, result: echo([setEntry(true, null)]) }])
    expect(settledAt(change(other.writes), other.events, [])).toBeUndefined()
    const earlier = run([{ tool: SETTLE, result: echo([setEntry(false, null)]) }, { tool: SETTLE, result: echo([setEntry(true, false)]) }])
    expect(settledAt(change(earlier.writes), earlier.events, [])).toBeUndefined()
  })

  it('reads the writers in order, however the window lists them', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: 'dethereal.update_attributes' }, { tool: SETTLE, result: echo([setEntry(true, null)]) }])
    // The other tool's write is listed after the settle, but came before it.
    const c = change([writes[0]!], true, { opaque: { since: writes[0]!, resyncedAt: 99, alsoCovered: [writes[2]!, writes[1]!] } } as Partial<ElementChange>)
    expect(settledAt(c, events, [])).toBeUndefined()
  })

  it('never credits a later settle once one showed the value already there', () => {
    // An edit wrote it, a settle then echoed it over itself, and a later settle set it again over a changed value.
    const flipped = run([{ other: 'file_write' }, { tool: SETTLE, result: echo([setEntry(true, true)]) }, { tool: SETTLE, result: echo([setEntry(true, false)]) }])
    const c = change([flipped.writes[1]!, flipped.writes[2]!], true, { opaque: { since: flipped.writes[1]!, resyncedAt: 99, alsoCovered: [flipped.writes[2]!], alsoWritten: [flipped.writes[0]!] } } as Partial<ElementChange>)
    expect(settledAt(c, flipped.events, [])).toBeUndefined()
    for (const decision of ['accept', 'confirm']) {
      const found = run([{ tool: SETTLE, result: echo([setEntry(true, null, { decision })]) }, { tool: SETTLE, result: echo([setEntry(true, false)]) }])
      expect(settledAt(change(found.writes), found.events, []), decision).toBeUndefined()
    }
  })

  it('never dates it at a settle that only reports the item already settled', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: { recorded: 0, already_settled: [{ element_id: 'c-db', field: 'f' }], echo: [] } }])
    expect(settledAt(change(writes), events, [])).toBeUndefined()
  })

  it('carries the echo\'s element id through a later push', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(true, null, { element_id: 'old' })]) }])
    const renamed = [{ seq: writes[1]! + 1, map: new Map([['old', 'c-db']]) }]
    expect(settledAt(change(writes), events, renamed)).toBe(writes[1])
    expect(settledAt(change(writes), events, [])).toBeUndefined()
  })

  it('never dates a change earlier than the push that created its file', () => {
    const { events, writes } = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { tool: IMPORT }])
    const c = change([writes[0]!, writes[1]!])
    // The settle wrote it at the first write, but the file is named by an id the push introduced.
    expect(writtenAt(c, events, [], new Map([['c-db', writes[1]!]]))).toBe(writes[1])
    expect(writtenAt(c, events, [])).toBe(writes[0])
  })

  it('dates a seen write at itself', () => {
    expect(writtenAt({ path: 'p', element: 'e', field: 'f', before: null, after: 1, event: 7 } as ElementChange, [], [])).toBe(7)
  })
})

describe('the settle that left the final value', () => {
  const opaque = (since: number, covered: number[], written: number[] = []) => ({ since, resyncedAt: 99, alsoCovered: covered, alsoWritten: written })
  const at = (w: number[], written: number[] = [], after: unknown = true) => change([w[0]!], after, { opaque: opaque(w[0]!, w.slice(1), written) } as Partial<ElementChange>)

  it('reads the last settle that names the field, past one that only confirmed the value', () => {
    const { events, writes } = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(true, null)]) }, { tool: SETTLE, result: echo([setEntry(true, null, { decision: 'confirm' })]) }])
    expect(settledAt(at(writes), events, [], 'last')).toBe(writes[1])
  })

  it('looks past a later settle that set the value over itself', () => {
    const { events, writes } = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { tool: SETTLE, result: echo([setEntry(true, true)]) }])
    expect(settledAt(at(writes), events, [], 'last')).toBe(writes[0])
  })

  it('reads the last write of the value, where the first reading would take an earlier one', () => {
    // A sets it, B changes it, C sets it back: the final value is C's.
    const { events, writes } = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { tool: SETTLE, result: echo([setEntry(false, true)]) }, { tool: SETTLE, result: echo([setEntry(true, false)]) }])
    expect(settledAt(at(writes), events, [], 'last')).toBe(writes[2])
    expect(settledAt(at(writes), events, [], 'first')).toBe(writes[0])
  })

  it('passes over an edit that leaves the field alone, and stops at one that may have changed it', () => {
    const leaves = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { edit: { old_string: '"f": true\n}', new_string: '"f": true,\n"conduits": []\n}' } }])
    expect(settledAt(at([leaves.writes[0]!], [leaves.writes[1]!]), leaves.events, [], 'last')).toBe(leaves.writes[0])
    const changes = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { edit: { old_string: '"f": false', new_string: '"f": true' } }])
    expect(settledAt(at([changes.writes[0]!], [changes.writes[1]!]), changes.events, [], 'last')).toBeUndefined()
    // A multi-edit leaves the field alone only when every edit does; lines naming it may come in another order.
    const multi = (edits: Array<{ old_string: string; new_string: string }>) => {
      const r = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { edit: edits[0]! }])
      r.events[r.writes[1]! - 1] = { ...r.events[r.writes[1]! - 1]!, input: { file_path: '/p/m/structure.json', edits } }
      // Dated at the settle's write, or not at all.
      return settledAt(at([r.writes[0]!], [r.writes[1]!]), r.events, [], 'last') === r.writes[0]
    }
    expect(multi([{ old_string: '"f": true,\n"g": 1', new_string: '"g": 1,\n"f": true' }, { old_string: 'a', new_string: 'b' }])).toBe(true)
    expect(multi([{ old_string: 'a', new_string: 'b' }, { old_string: '"f": false', new_string: '"f": true' }])).toBe(false)
    const shell = run([{ tool: SETTLE, result: echo([setEntry(true, null)]) }, { other: 'shell' }])
    expect(settledAt(at(shell.writes), shell.events, [], 'last')).toBeUndefined()
  })
})

describe('the stubs tool and the ids inside a value', () => {
  it('passes over the stubs tool only when nothing unseen came before it', () => {
    const settles = run([{ tool: SETTLE, error: true }, { tool: 'dethereal.generate_attribute_stubs' }, { tool: SETTLE, result: echo([setEntry(true, null)]) }])
    expect(settledAt(change(settles.writes), settles.events, [])).toBe(settles.writes[2])
    // A shell may have written the value, and the stubs tool may have dropped it: the settle proves nothing.
    const shell = run([{ other: 'shell' }, { tool: 'dethereal.generate_attribute_stubs' }, { tool: SETTLE, result: echo([setEntry(true, null)]) }])
    expect(settledAt(change(shell.writes), shell.events, [])).toBeUndefined()
  })

  it('carries the ids inside the value and its previous value through a later push', () => {
    const conduits = (peer: string) => [{ peerId: peer, direction: 'OUTBOUND' }]
    const renamed = (seq: number) => [{ seq, map: new Map([['b-old', 'uuid-new']]) }]
    // Set over nothing, the peer renamed later: a write of the final value.
    const fresh = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(conduits('b-old'), null)]) }])
    expect(settledAt(change(fresh.writes, conduits('uuid-new')), fresh.events, renamed(fresh.writes[1]! + 1))).toBe(fresh.writes[1])
    // Set over the same list (written before, unseen): no write, once both sides are carried.
    const same = run([{ tool: SETTLE, error: true }, { tool: SETTLE, result: echo([setEntry(conduits('b-old'), conduits('b-old'))]) }])
    expect(settledAt(change(same.writes, conduits('uuid-new')), same.events, renamed(same.writes[1]! + 1))).toBeUndefined()
  })
})

