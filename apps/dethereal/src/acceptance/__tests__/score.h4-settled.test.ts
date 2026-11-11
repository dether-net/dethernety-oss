/**
 * H4 on a gate value the replay could not see: the settle whose echo shows it set the final value dates the write,
 * and the gate question is read against that write.
 */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAnswerSheet } from '../answer-sheet.js'
import { displayNames, h4 } from '../score/h4.js'
import { matchModel, type RunModel } from '../score/match.js'
import type { ElementChange } from '../score/element-changes.js'
import type { ShownPrompt } from '../score/prompts.js'
import type { FileOp, TranscriptEvent } from '../transcripts/types.js'
import { key } from './fixtures/clean-run.js'
import { eventBuilder } from './helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const names = displayNames(fs.readFileSync(path.resolve(__dirname, '../../../workflow/shared/guidelines-core.md'), 'utf8'))
const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-h4-settled-'))
afterAll(() => fs.rmSync(modelDir, { recursive: true, force: true }))

const SETTLE = 'dethereal.model_state_settle'
const REPLY = 'Accept all.'
const sheet = parseAnswerSheet(`version: 1\nprompts:\n  - id: boundary-trust\n    trigger: "x"\n    mandatory: true\n    required: always\n    how: typed\n    reply: "${REPLY}"\n    ratifies: all\n`)
const run: RunModel = { boundaries: [{ id: 'b1', name: 'Orders', parentId: null, zone: 'INTERNAL', componentIds: [] }], components: [], flows: [], dataItems: [] }

/** A settle that echoes the zone decisions given, as call, result and write. */
const settle = (ev: ReturnType<typeof eventBuilder>['ev'], id: string, zones: Array<[string, unknown, unknown]>): TranscriptEvent[] => [
  ev({ kind: 'tool_call', tool: SETTLE, callId: id, input: {} }),
  ev({ kind: 'tool_result', tool: SETTLE, callId: id, isError: false, text: JSON.stringify({ echo: zones.map(([decision, value, previous]) => ({ decision, group: 'boundaries', element_id: 'b1', field: 'zone', value: { value }, previous: previous === undefined ? { absent: true } : { value: previous } })) }) }),
  ev({ kind: 'server_write', tool: SETTLE, callId: id }),
]
const gate = (ev: ReturnType<typeof eventBuilder>['ev']): TranscriptEvent[] => [
  ev({ kind: 'assistant', text: '| Boundary | Zone |\n|---|---|\n| Orders | Internal |\n\n[prompt: boundary-trust] Accept the zones?' }),
  ev({ kind: 'user', text: REPLY }),
]

function score(events: TranscriptEvent[], writes: number[], pushes: Array<{ seq: number; map: Map<string, string> }> = []) {
  const shownAt = events.findIndex((e) => e.kind === 'assistant')
  const shown = [{ id: 'boundary-trust', event: shownAt, complete: true, missing: [], answeredBy: shownAt + 1, segment: 0 }] as unknown as ShownPrompt[]
  const change = { path: 'm/structure.json', element: 'b1', field: 'zone', before: undefined, after: 'INTERNAL', opaque: { since: writes[0]!, resyncedAt: events.length, alsoCovered: writes.slice(1) } } as ElementChange
  return h4({ events, changes: [change], modelRel: 'm', modelDir, run, matching: matchModel(run, key), key, sheet, shown, displayNames: names, pushes }).findings.map((f) => f.code)
}

describe('a gate value a settle set out of sight', () => {
  it('is read against the question it answered, when a later settle set it', () => {
    const { ev } = eventBuilder()
    // The window opens at a settle of something else; the zone is set after the reply.
    const events = [...settle(ev, 'a', []), ...gate(ev), ...settle(ev, 'b', [['set', 'INTERNAL', undefined]])]
    expect(score(events, [2, 7])).toEqual([])
  })

  it('stays under review when no settle shows the write', () => {
    const { ev } = eventBuilder()
    const events = [...settle(ev, 'a', []), ...gate(ev), ...settle(ev, 'b', [['confirm', 'INTERNAL', 'INTERNAL']])]
    expect(score(events, [2, 7])).toEqual(['opaque_write'])
  })

  it('follows the settle\'s element through a later push that renamed it', () => {
    const { ev } = eventBuilder()
    const events = [...settle(ev, 'a', []), ...gate(ev), ...settle(ev, 'b', [['set', 'INTERNAL', undefined]])]
    // The settle names the boundary by its id before a push; the final model knows it as b1.
    const text = events[6]!.text!.replace('"element_id":"b1"', '"element_id":"b-orders"')
    events[6] = { ...events[6]!, text }
    expect(score(events, [2, 7])).toEqual(['opaque_write'])
    expect(score(events, [2, 7], [{ seq: 8, map: new Map([['b-orders', 'b1']]) }])).toEqual([])
  })

  it('reads the write that left the final value, not an earlier one of the same value', () => {
    const { ev } = eventBuilder()
    // Set before the question, changed, then set back after the reply: the last write is the one the reply covers.
    const events = [...settle(ev, 'a', [['set', 'INTERNAL', undefined]]), ...settle(ev, 'b', [['set', 'PUBLIC', 'INTERNAL']]), ...gate(ev), ...settle(ev, 'c', [['set', 'INTERNAL', 'PUBLIC']])]
    expect(score(events, [2, 5, 10])).toEqual([])
  })
})

describe('a gate value a file write set out of sight', () => {
  /** The structure file when the replay knew it again: b1 holds `b1zone` (a line, or empty), b2 is Internal. */
  const text = (b1zone = '"zone": "INTERNAL",', b1id = 'b1') => `{
  "defaultBoundary": {
    "id": "root",
    "boundaries": [
      {
        "id": "${b1id}",
        "name": "Orders",
        ${b1zone}
        "components": []
      },
      {
        "id": "b2",
        "name": "Edge",
        "zone": "INTERNAL",
        "components": []
      }
    ]
  }
}`
  type Ev = ReturnType<typeof eventBuilder>['ev']
  /** A write as call, file write and result. */
  const write = (ev: Ev, id: string, fileOp: FileOp, isError = false): TranscriptEvent[] => [
    ev({ kind: 'tool_call', tool: fileOp.op === 'patch' ? 'apply_patch' : 'Edit', callId: id, input: {} }),
    ev({ kind: 'file_write', tool: fileOp.op === 'patch' ? 'apply_patch' : 'Edit', callId: id, path: 'm/structure.json', fileOp, ...(isError ? { isError: true } : {}) }),
  ]
  const replace = (oldString: string, newString: string, replaceAll = false): FileOp => ({ op: 'replace', oldString, newString, replaceAll })
  /** Puts b1's zone in after its name. */
  const setsB1 = replace('"name": "Orders",', '"name": "Orders",\n        "zone": "INTERNAL",')
  const shell = (ev: Ev): TranscriptEvent[] => [ev({ kind: 'shell', tool: 'Bash', callId: 'sh', input: { command: 'sed -i s/x/y/ m/structure.json' } })]

  function judge(events: TranscriptEvent[], options: { since?: number; text?: string; pushes?: Array<{ seq: number; map: Map<string, string> }> } = {}) {
    const shownAt = events.findIndex((e) => e.kind === 'assistant')
    const shown = [{ id: 'boundary-trust', event: shownAt, complete: true, missing: [], answeredBy: shownAt + 1, segment: 0 }] as unknown as ShownPrompt[]
    const since = options.since ?? events.findIndex((e) => e.kind === 'server_write' || e.kind === 'shell')
    const window = events.filter((e) => e.seq > since && (e.kind === 'file_write' || e.kind === 'server_write' || e.kind === 'shell'))
    const change = {
      path: 'm/structure.json', element: 'b1', field: 'zone', before: undefined, after: 'INTERNAL', text: options.text ?? text(),
      opaque: { since, resyncedAt: events.length, alsoWritten: window.filter((e) => e.kind === 'file_write').map((e) => e.seq), alsoCovered: window.filter((e) => e.kind !== 'file_write').map((e) => e.seq) },
    } as ElementChange
    return h4({ events, changes: [change], modelRel: 'm', modelDir, run, matching: matchModel(run, key), key, sheet, shown, displayNames: names, pushes: options.pushes ?? [] }).findings.map((f) => f.code)
  }

  it('dates the value at the write that put it in, judged against the reply', () => {
    let { ev } = eventBuilder()
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', setsB1)])).toEqual([])
    ;({ ev } = eventBuilder())
    expect(judge([...settle(ev, 'a', []), ...write(ev, 'e1', setsB1), ...gate(ev)])).toEqual(['no_gate'])
  })

  it('takes the last of several writes that show it', () => {
    // Two writes that both put it in: the later one left it. Before rev 2 this was review.
    let { ev } = eventBuilder()
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', setsB1), ...write(ev, 'e2', setsB1)])).toEqual([])
    // Put in before the question and again after the reply: the reply covers the later one.
    ;({ ev } = eventBuilder())
    expect(judge([...settle(ev, 'a', []), ...write(ev, 'e1', setsB1), ...gate(ev), ...write(ev, 'e2', setsB1)])).toEqual([])
  })

  it('does not take a write that only carried the value through', () => {
    // Something out of sight set it before the question; a later edit renames the boundary and keeps the zone line.
    const { ev } = eventBuilder()
    const carry = replace('"name": "Order",\n        "zone": "INTERNAL",', '"name": "Orders",\n        "zone": "INTERNAL",')
    expect(judge([...shell(ev), ...gate(ev), ...write(ev, 'e1', carry)])).toEqual(['opaque_write'])
  })

  it('stays under review when anything after the writer may have changed it', () => {
    let { ev } = eventBuilder()
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', setsB1), ...shell(ev)])).toEqual(['opaque_write'])
    // A settle that set another value after it.
    ;({ ev } = eventBuilder())
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', setsB1), ...settle(ev, 'b', [['set', 'PUBLIC', 'INTERNAL']])])).toEqual(['opaque_write'])
    // Every occurrence replaced: which one is b1's is unknown.
    ;({ ev } = eventBuilder())
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', replace('"zone": "PUBLIC"', '"zone": "INTERNAL"', true))])).toEqual(['opaque_write'])
    // Its text cut through by a later write: where it went is unknown.
    ;({ ev } = eventBuilder())
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', replace('"name": "Orders",', '"name": "Order",\n        "zone": "INTERNAL",'))])).toEqual(['opaque_write'])
  })

  it('passes by what leaves the value alone after the writer', () => {
    let { ev } = eventBuilder()
    // A settle that only confirmed it, the stubs tool, an edit of another boundary and a failed edit.
    const stubs = (): TranscriptEvent[] => [ev({ kind: 'tool_call', tool: 'dethereal.generate_attribute_stubs', callId: 'st', input: {} }), ev({ kind: 'tool_result', tool: 'dethereal.generate_attribute_stubs', callId: 'st', isError: false, text: '{}' }), ev({ kind: 'server_write', tool: 'dethereal.generate_attribute_stubs', callId: 'st' })]
    const events = [...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', setsB1), ...settle(ev, 'b', [['confirm', 'INTERNAL', 'INTERNAL']]), ...stubs(),
      ...write(ev, 'e2', replace('"name": "Edge",', '"name": "Edge",\n        "zone": "INTERNAL",')), ...write(ev, 'e3', replace('"components": []', '"components": [1]'), true)]
    expect(judge(events)).toEqual([])
    // The write that opened the window, when the replay could not apply it.
    ;({ ev } = eventBuilder())
    const opened = [...gate(ev), ...write(ev, 'e1', setsB1)]
    expect(judge(opened, { since: 3 })).toEqual([])
  })

  it('carries the write\'s ids through a later push', () => {
    const { ev } = eventBuilder()
    const events = [...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'e1', replace('"id": "b-orders",\n        "name": "Orders",', '"id": "b-orders",\n        "name": "Orders",\n        "zone": "INTERNAL",'))]
    expect(judge(events)).toEqual(['opaque_write'])
    expect(judge(events, { pushes: [{ seq: events.length, map: new Map([['b-orders', 'b1']]) }] })).toEqual([])
  })

  it('reads a patch by its + lines', () => {
    let { ev } = eventBuilder()
    const hunk = (body: string): FileOp => ({ op: 'patch', hunks: `@@ -6,2 +6,3 @@\n${body}` })
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'p1', hunk('         "name": "Orders",\n+        "zone": "INTERNAL",\n         "components": []'))])).toEqual([])
    // On a - line only, the patch took it out: it did not put it in.
    ;({ ev } = eventBuilder())
    expect(judge([...settle(ev, 'a', []), ...gate(ev), ...write(ev, 'p1', hunk('         "name": "Orders",\n-        "zone": "INTERNAL",\n         "components": []'))])).toEqual(['opaque_write'])
  })
})

