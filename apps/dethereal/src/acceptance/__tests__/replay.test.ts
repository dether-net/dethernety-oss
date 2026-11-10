/**
 * The replay's parts: strict diff application, JSON leaf diffs, the per-file
 * known / unknown / absent state, write attribution, opaque changes, the shell
 * and server-write classifications, checkpoints, and the cross-check.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyUnifiedDiff, PatchMismatch, parseHunks, sameIgnoringIndent, structuredPatchText } from '../transcripts/unified-diff.js'
import { diffJson, diffTexts } from '../transcripts/json-diff.js'
import { afterLeadingCd, covers, isModelFile, modelDirOf, replay, serverWriteScope, shellModelWrites } from '../transcripts/replay.js'
import { parseRun } from '../transcripts/index.js'
import { classifyUserText, parseClaude } from '../transcripts/claude.js'
import { reconcile } from '../transcripts/reconcile.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { eventBuilder } from './helpers.js'

describe('applyUnifiedDiff', () => {
  const text = 'a\nb\nc\nd\ne\n'
  it('applies hunks exactly, several in one diff', () => {
    expect(applyUnifiedDiff(text, '@@ -2,2 +2,2 @@\n-b\n+B\n c\n@@ -5,1 +5,2 @@\n e\n+f')).toBe('a\nB\nc\nd\ne\nf\n')
  })
  it('refuses a hunk whose context does not match, instead of guessing', () => {
    expect(() => applyUnifiedDiff(text, '@@ -2,2 +2,2 @@\n-x\n+B\n c')).toThrow(PatchMismatch)
    expect(() => applyUnifiedDiff(text, '@@ -3,1 +3,1 @@\n-b\n+B')).toThrow(PatchMismatch)
    expect(() => applyUnifiedDiff(text, 'no hunks here')).toThrow(PatchMismatch)
  })
  it('adds to an empty file and keeps a missing final newline', () => {
    expect(applyUnifiedDiff('', '@@ -0,0 +1,2 @@\n+x\n+y')).toBe('x\ny\n')
    expect(applyUnifiedDiff('a\nb', '@@ -2,1 +2,1 @@\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file')).toBe('a\nc')
  })
  it('skips file headers, and reads Claude structured patches', () => {
    const diff = `Index: x\n===\n--- x\n+++ x\n${structuredPatchText([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }])}`
    expect(parseHunks(diff)).toHaveLength(1)
    expect(applyUnifiedDiff(text, diff)).toBe('A\nb\nc\nd\ne\n')
  })
  it('compares a display diff without indentation, only when asked', () => {
    const file = '{\n    "a": 1,\n    "b": 2\n}\n'
    const shown = '@@ -2,2 +2,3 @@\n   "a": 1,\n+  "c": 3,\n   "b": 2'
    expect(() => applyUnifiedDiff(file, shown)).toThrow(PatchMismatch)
    const loose = applyUnifiedDiff(file, shown, { ignoreIndent: true })
    expect(sameIgnoringIndent(loose, '{\n    "a": 1,\n    "c": 3,\n    "b": 2\n}\n')).toBe(true)
    expect(sameIgnoringIndent(loose, '{\n    "a": 1,\n    "b": 2\n}\n')).toBe(false)
  })
})

describe('diffJson / diffTexts', () => {
  it('lists changed leaves by JSON pointer, escaping keys', () => {
    expect(diffJson({ a: 1, b: { c: 2 }, 'x/y': 1 }, { a: 1, b: { c: 3 }, 'x/y': 2, d: [true] })).toEqual([
      { pointer: '/b/c', before: 2, after: 3 },
      { pointer: '/d/0', before: undefined, after: true },
      { pointer: '/x~1y', before: 1, after: 2 },
    ])
  })
  it('treats a type change as every old and new leaf', () => {
    expect(diffJson({ a: { b: 1 } }, { a: 'none' })).toEqual([
      { pointer: '/a/b', before: 1, after: undefined },
      { pointer: '/a', before: undefined, after: 'none' },
    ])
  })
  it('keeps an empty object or array, and null, as leaves', () => {
    expect(diffJson(undefined, { a: [], b: {}, c: null })).toEqual([
      { pointer: '/a', before: undefined, after: [] },
      { pointer: '/b', before: undefined, after: {} },
      { pointer: '/c', before: undefined, after: null },
    ])
  })
  it('is one whole-file change for a text that is not JSON', () => {
    expect(diffTexts('x = 1', 'x = 2')).toEqual([{ pointer: '', before: 'x = 1', after: 'x = 2' }])
    expect(diffTexts('{"a":1}', '{"a":1}')).toEqual([])
  })
})

describe('model files and scopes', () => {
  it('knows a model directory by its files', () => {
    for (const p of ['m/manifest.json', 'm/structure.json', 'm/dataflows.json', 'm/data-items.json', 'm/attributes/components/c.json', 'm/.dethereal/state.json', '.dethernety/models.json']) {
      expect(isModelFile(p), p).toBe(true)
    }
    for (const p of ['m/README.md', 'm/attributes/other/c.json', 'm/.dethereal/cache/x.json', 'src/app.json']) expect(isModelFile(p), p).toBe(false)
    expect(modelDirOf('tm/x/attributes/components/c.json')).toBe('tm/x')
    expect(modelDirOf('tm/x/.dethereal/state.json')).toBe('tm/x')
  })
  it('scopes a server write to what the tool writes, and ignores readers', () => {
    const rel = (p: string) => p.replace('/work/project/', '')
    expect(serverWriteScope('dethereal.import_model', { directory_path: '/work/project/tm/x' }, rel)).toEqual(['tm/x/', '.dethernety/', 'tm/x.backup-*'])
    expect(serverWriteScope('dethereal.generate_attribute_stubs', { directory_path: 'tm/x' }, rel)).toEqual(['tm/x/attributes/', 'tm/x/.dethereal/'])
    expect(serverWriteScope('dethereal.model_state', { directory_path: 'tm/x/' }, rel)).toEqual(['tm/x/.dethereal/'])
    expect(serverWriteScope('dethereal.model_state_settle', { directory_path: 'tm/x' }, rel)).toEqual(['tm/x/'])
    expect(serverWriteScope('dethereal.validate_model_json', { directory_path: 'tm/x' }, rel)).toBeNull()
    expect(serverWriteScope('Write', {}, rel)).toBeNull()
    // A writer without a directory could have written anything; an unknown dethereal tool with one, all of it.
    expect(serverWriteScope('dethereal.import_model', {}, rel)).toEqual(['*'])
    expect(serverWriteScope('dethereal.some_new_tool', { directory_path: 'tm/x' }, rel)).toEqual(['tm/x/', '.dethernety/', 'tm/x.backup-*'])
    expect(serverWriteScope('dethereal.some_new_tool', {}, rel)).toEqual(['*'])
    expect(covers('tm/x.backup-*', 'tm/x.backup-2026/.dethereal/state.json')).toBe(true)
    expect(covers('tm/x/', 'tm/xy/state.json')).toBe(false)
  })
  it('flags a shell command that writes, moves or deletes a model path', () => {
    const dirs = ['tm/x']
    expect(shellModelWrites("sed -i '' 's/a/b/' tm/x/structure.json", '', dirs)).toEqual(['tm/x/structure.json'])
    expect(shellModelWrites('cat > /work/project/tm/x/.dethereal/state.json <<EOF', '', dirs, '/work/project')).toEqual(['tm/x/.dethereal/state.json'])
    expect(shellModelWrites('rm -rf tm/x', '', dirs)).toEqual(['tm/x/'])
    expect(shellModelWrites('mv tm tm-old', '', dirs)).toEqual(['tm/'])
    expect(shellModelWrites('rm -rf tm/x/attributes/components', '', dirs)).toEqual(['tm/x/attributes/components/'])
    expect(shellModelWrites("python3 -c \"import json; json.dump(d, open('structure.json','w'))\"", 'tm/x', dirs)).toEqual(['tm/x/structure.json'])
    // Writes that name no model file, and reads of model files, are not model writes.
    expect(shellModelWrites('echo hi > notes.txt', '', dirs)).toEqual([])
    expect(shellModelWrites('cat tm/x/structure.json | jq .', '', dirs)).toEqual([])
    expect(shellModelWrites('ls tm/x', '', dirs)).toEqual([])
    // A write through a command that only mentions a model file name, without a path the replay can place: anything.
    expect(shellModelWrites('node script.js > out && echo manifest.json', '/elsewhere', [], '/work/project')).toEqual(['*'])
  })
})

const builder = eventBuilder({ risingTs: true })
const ev = builder.ev
const P = 'tm/x/.dethereal/state.json'
const write = (content: string, extra: Partial<TranscriptEvent> = {}) => ev({ kind: 'file_write', path: P, modelFile: true, tool: 'Write', fileOp: { op: 'write', content }, ...extra })

describe('replay', () => {
  it('attributes each changed value to the write that set it', () => {
    builder.reset()
    const r = replay([write('{"s":"A","n":1}'), ev({ kind: 'file_write', path: P, modelFile: true, tool: 'Edit', fileOp: { op: 'replace', oldString: '"A"', newString: '"B"', replaceAll: false } })])
    expect(r.attributions.map((a) => [a.event, a.pointer, a.before, a.after])).toEqual([[0, '/n', undefined, 1], [0, '/s', undefined, 'A'], [1, '/s', 'A', 'B']])
    expect(r.notes).toEqual([])
  })

  it('makes files a server write covers unknown, and settles them as opaque when read again', () => {
    builder.reset()
    const events = [
      write('{"s":"A"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'file_read', path: P, modelFile: true, content: '{"s":"B"}' }),
    ]
    const r = replay(events)
    expect(r.opaque).toEqual([{ path: P, since: 1, resyncedAt: 2, pointer: '/s', before: 'A', after: 'B' }])
    expect(r.attributions.every((a) => a.event === 0)).toBe(true)
  })

  it('names the writes made while a file was unknown, since the change may be theirs', () => {
    builder.reset()
    const r = replay([
      write('{"s":"A"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'file_write', path: P, modelFile: true, tool: 'Edit', fileOp: { op: 'replace', oldString: 'x', newString: 'y', replaceAll: false } }),
      ev({ kind: 'file_read', path: P, modelFile: true, content: '{"s":"C"}' }),
    ])
    expect(r.opaque[0]).toMatchObject({ since: 1, alsoWritten: [2] })
    expect(r.notes.map((n) => n.note)).toContain('an edit to a file whose content is unknown')
  })

  it('treats a file first seen under a covered prefix as unknown, not absent', () => {
    builder.reset()
    const r = replay([
      ev({ kind: 'server_write', tool: 'dethereal.export_model', touches: ['tm/x/'] }),
      ev({ kind: 'file_read', path: 'tm/x/structure.json', modelFile: true, content: '{"a":1}' }),
    ])
    expect(r.opaque).toEqual([{ path: 'tm/x/structure.json', since: 0, resyncedAt: 1, pointer: '/a', before: undefined, after: 1 }])
    expect(r.notes).toEqual([])
  })

  it('notes a whole-file write over unknown content, and settles a file the harness says did not exist', () => {
    builder.reset()
    const r = replay([
      write('{"s":"A"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      write('{"s":"C"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      write('{"s":"D"}', { beforeAbsent: true }),
    ])
    expect(r.notes.map((n) => n.event)).toEqual([2])
    expect(r.attributions.find((a) => a.event === 2)).toMatchObject({ beforeUnknown: true, after: 'C' })
    // The server deleted it: the deletion is an opaque change, and the write after it starts from nothing.
    expect(r.opaque).toEqual([{ path: P, since: 3, resyncedAt: 4, pointer: '/s', before: 'C', after: undefined }])
    expect(r.attributions.find((a) => a.event === 4)).toMatchObject({ before: undefined, after: 'D' })
  })

  it('ends the main session\'s last turn with the transcript', () => {
    builder.reset()
    const r = replay([ev({ kind: 'user' }), ev({ kind: 'assistant' })])
    expect(r.checkpoints.map((c) => [c.reason, c.after])).toEqual([['user', 0], ['turn_end', 1]])
  })

  it('reports a read that differs from a known file as an unobserved change', () => {
    builder.reset()
    const r = replay([write('{"s":"A"}'), ev({ kind: 'file_read', path: P, modelFile: true, content: '{"s":"Z"}' })])
    expect(r.opaque).toEqual([{ path: P, since: -1, resyncedAt: 1, pointer: '/s', before: 'A', after: 'Z' }])
    expect(r.notes[0]!.note).toMatch(/unobserved change/)
  })

  it("resyncs from a file tool's own record of the file before the change", () => {
    builder.reset()
    const r = replay([
      write('{"s":"A"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      write('{"s":"C"}', { before: '{"s":"B"}' }),
    ])
    expect(r.opaque.map((o) => [o.since, o.after])).toEqual([[1, 'B']])
    expect(r.attributions.at(-1)).toMatchObject({ event: 2, before: 'B', after: 'C' })
  })

  it('marks a change that does not apply, and keeps the file unknown rather than guessing', () => {
    builder.reset()
    const events = [write('a\nb\n'), ev({ kind: 'file_write', path: P, modelFile: true, tool: 'apply_patch', fileOp: { op: 'patch', hunks: '@@ -1,1 +1,1 @@\n-z\n+y' } })]
    const r = replay(events)
    expect(events[1]!.replayMismatch).toMatch(/does not match/)
    expect(r.checkpoints).toEqual([])
    expect(replay([...events, ev({ kind: 'ask' })]).checkpoints[0]!.files[P]).toMatchObject({ state: 'unknown', since: 1 })
  })

  it("uses a file tool's own record of the change when the replay disagrees", () => {
    builder.reset()
    const events = [
      write('a\nb\n'),
      ev({ kind: 'file_write', path: P, modelFile: true, tool: 'Edit', fileOp: { op: 'replace', oldString: 'b', newString: 'c', replaceAll: false }, expectedPatch: '@@ -2,1 +2,1 @@\n-b\n+d' }),
    ]
    const r = replay(events)
    expect(events[1]!.expectedMismatch).toBe(true)
    expect(r.attributions.at(-1)).toMatchObject({ before: 'a\nb\n', after: 'a\nd\n' })
  })

  it('takes checkpoints after questions, replies, compactions and each actor\'s turn end, in event order', () => {
    builder.reset()
    const r = replay([
      ev({ kind: 'assistant' }),
      ev({ kind: 'assistant', actor: 'scout' }),
      write('{}'),
      ev({ kind: 'user' }),
      ev({ kind: 'ask' }),
      ev({ kind: 'answer' }),
      ev({ kind: 'compaction' }),
    ])
    expect(r.checkpoints.map((c) => [c.seq, c.reason, c.after])).toEqual([[0, 'turn_end', 0], [1, 'user', 3], [2, 'ask', 4], [3, 'answer', 5], [4, 'compaction', 6]])
    expect(r.checkpoints[0]!.files).toEqual({})
    expect(r.checkpoints[1]!.files[P]).toMatchObject({ state: 'known', lastWrite: 2 })
  })

  it('follows a shell command that writes a model file', () => {
    builder.reset()
    const events = [write('{"s":"A"}'), ev({ kind: 'shell', text: `sed -i 's/A/B/' ${P}` }), ev({ kind: 'file_read', path: P, modelFile: true, content: '{"s":"B"}' })]
    const r = replay(events)
    expect(events[1]).toMatchObject({ writesModel: true, touches: [P] })
    expect(r.opaque).toEqual([{ path: P, since: 1, resyncedAt: 2, pointer: '/s', before: 'A', after: 'B' }])
  })
})

describe('opaque attribution', () => {
  it('dates a file first seen under several covering writes from the earliest, and lists the later ones', () => {
    builder.reset()
    const r = replay([
      ev({ kind: 'server_write', tool: 'dethereal.generate_attribute_stubs', touches: ['tm/x/attributes/'] }),
      ev({ kind: 'shell', text: "sed -i 's/a/b/' tm/x/attributes/components/c.json" }),
      ev({ kind: 'file_read', path: 'tm/x/attributes/components/c.json', modelFile: true, content: '{"a":1}' }),
    ])
    expect(r.opaque).toEqual([{ path: 'tm/x/attributes/components/c.json', since: 0, resyncedAt: 2, pointer: '/a', before: undefined, after: 1, alsoCovered: [1] }])
  })
  it('picks the earliest of several covering prefixes for a file first seen under all of them', () => {
    builder.reset()
    const r = replay([
      ev({ kind: 'server_write', tool: 'dethereal.generate_attribute_stubs', touches: ['tm/x/attributes/'] }),
      ev({ kind: 'server_write', tool: 'dethereal.import_model', touches: ['tm/x/'] }),
      ev({ kind: 'server_write', tool: 'dethereal.export_model', touches: ['tm/x/'] }),
      ev({ kind: 'file_read', path: 'tm/x/attributes/components/c.json', modelFile: true, content: '{"a":1}' }),
    ])
    expect(r.opaque).toEqual([{ path: 'tm/x/attributes/components/c.json', since: 0, resyncedAt: 3, pointer: '/a', before: undefined, after: 1, alsoCovered: [1, 2] }])
  })

  it('does not carry later covers from one unknown episode into the next', () => {
    builder.reset()
    const r = replay([
      write('{"s":"A"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'server_write', tool: 'dethereal.model_state_waive', touches: ['tm/x/.dethereal/'] }),
      write('{"s":"B"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'file_read', path: P, modelFile: true, content: '{"s":"C"}' }),
    ])
    expect(r.opaque).toEqual([{ path: P, since: 4, resyncedAt: 5, pointer: '/s', before: 'B', after: 'C' }])
  })

  it('lists later covering writes for a file that was known, too', () => {
    builder.reset()
    const r = replay([
      write('{"s":"A"}'),
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'server_write', tool: 'dethereal.model_state_waive', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'file_read', path: P, modelFile: true, content: '{"s":"B"}' }),
    ])
    expect(r.opaque).toEqual([{ path: P, since: 1, resyncedAt: 3, pointer: '/s', before: 'A', after: 'B', alsoCovered: [2] }])
  })
  it('dates a model file a settle call changed at that call, never as an unobserved change', () => {
    builder.reset()
    const files = ['tm/x/attributes/components/c.json', 'tm/x/structure.json', 'tm/x/data-items.json']
    const r = replay([
      ...files.map((path) => ev({ kind: 'file_write', path, modelFile: true, tool: 'Write', fileOp: { op: 'write', content: '{"v":"before"}' } })),
      ev({ kind: 'user', text: 'Yes, set them.' }),
      ev({ kind: 'server_write', tool: 'dethereal.model_state_settle', touches: ['tm/x/'] }),
      ...files.map((path) => ev({ kind: 'file_read', path, modelFile: true, content: '{"v":"after"}' })),
    ])
    expect(r.opaque.map((o) => [o.path, o.since, o.before, o.after])).toEqual(files.map((f) => [f, 4, 'before', 'after']))
  })
  it('never invents a final newline from a numbered read', () => {
    builder.reset()
    const r = replay([
      ev({ kind: 'server_write', tool: 'dethereal.model_state', touches: ['tm/x/.dethereal/'] }),
      ev({ kind: 'file_read', path: P, modelFile: true, content: 'a\nb', source: 'numbered' }),
      ev({ kind: 'file_write', path: P, modelFile: true, tool: 'apply_patch', fileOp: { op: 'patch', hunks: '@@ -2,1 +2,1 @@\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file' } }),
    ])
    expect(r.notes).toEqual([])
    expect(r.attributions.at(-1)).toMatchObject({ before: 'a\nb', after: 'a\nc' })
  })
})

describe('Claude Code user messages', () => {
  it('tells the operator from what the harness wrote in the operator\'s place', () => {
    expect(classifyUserText('Accept all')).toEqual({ kind: 'user' })
    expect(classifyUserText('<command-name>/compact</command-name>')).toEqual({ kind: 'user', source: 'command' })
    expect(classifyUserText('<task-notification>\n<task-id>x</task-id>')).toEqual({ kind: 'notice', source: 'task-notification' })
    expect(classifyUserText('<local-command-stdout>done</local-command-stdout>')).toEqual({ kind: 'notice', source: 'local-command' })
    expect(classifyUserText('[Request interrupted by user for tool use]')).toEqual({ kind: 'notice', source: 'interrupt' })
  })

  it('marks a question dialog the operator dismissed, and not one that failed or was answered', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-claude-dialogs-'))
    try {
      const lines: string[] = []
      const dialog = (id: string, result: string, record: Record<string, unknown>) => {
        lines.push(JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', uuid: `a-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [] } }] } }))
        lines.push(JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z', uuid: `u-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: true }] }, ...record }))
      }
      dialog('rejected', "The user doesn't want to proceed with this tool use. STOP what you are doing and wait for the user to tell you how to proceed.", { toolUseResult: 'User rejected tool use', toolDenialKind: 'user-rejected' })
      dialog('dismissed', 'The user dismissed the question without answering.', { toolUseResult: 'Error: The user dismissed the question without answering.', toolDenialKind: 'permission-rule' })
      dialog('failed', 'Tool permission request failed: AbortError: Stream closed', { toolUseResult: 'Error: Tool permission request failed: AbortError: Stream closed', toolDenialKind: 'permission-rule' })
      dialog('answered', 'answered', { toolUseResult: { answers: { q: 'Yes' } }, toolDenialKind: 'user-rejected' })
      fs.writeFileSync(path.join(dir, 'main.jsonl'), `${lines.join('\n')}\n`)
      const answers = parseClaude(dir).events.filter((e) => e.kind === 'answer')
      expect(answers.map((e) => [e.callId, e.dismissed ?? false])).toEqual([['rejected', true], ['dismissed', true], ['failed', false], ['answered', false]])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('reconcile', () => {
  const tracked = (path: string, from: string, extra: Partial<TranscriptEvent> = {}) => ev({ kind: 'harness_change', path, modelFile: true, source: `patch:${from}`, ...extra })

  it('reports a tracked change with no write in its window as unobserved, noting a shell there', () => {
    builder.reset()
    const start = '2026-01-01T00:00:00Z'
    const events = [
      ev({ kind: 'shell', text: 'node fix.js structure.json' }),
      tracked('tm/x/structure.json', start),
      write('{}', { seq: 2 }),
      tracked(P, start),
    ]
    const r = reconcile('opencode', events)
    expect(r.crossCheck).toBe('available')
    expect(r.unobserved).toEqual([{ path: 'tm/x/structure.json', harnessEvent: 1, window: [0, 1], shellInWindow: true }])
    expect(r.untracked).toEqual([])
  })

  it('never counts a refused shell as the writer of a tracked change, nor as a shell in its window', () => {
    builder.reset()
    const start = '2026-01-01T00:00:00Z'
    const events = [
      ev({ kind: 'shell', text: 'cat > tm/x/structure.json <<EOF', writesModel: true, touches: ['tm/x/structure.json'], denied: 'user-rejected' }),
      tracked('tm/x/structure.json', start),
    ]
    expect(reconcile('opencode', events).unobserved).toEqual([{ path: 'tm/x/structure.json', harnessEvent: 1, window: [0, 1], shellInWindow: false }])
  })

  it('reports a write the harness did not track, without failing it', () => {
    builder.reset()
    const r = reconcile('opencode', [tracked('tm/x/other.json', '2026-01-01T00:00:00Z'), write('{}')])
    expect(r.untracked).toEqual([{ path: P, event: 1 }])
  })

  it('is unavailable, never passed, where the harness keeps no independent record', () => {
    builder.reset()
    const events = [tracked('tm/x/structure.json', '2026-01-01T00:00:00Z')]
    expect(reconcile('codex', events)).toMatchObject({ crossCheck: 'unavailable', unobserved: [] })
    expect(reconcile('opencode', [write('{}')])).toMatchObject({ crossCheck: 'unavailable', note: 'the transcript holds no change records' })
    expect(reconcile('claude', events).crossCheck).toBe('partial')
  })
})

describe('a shell call\'s working directory', () => {
  const rel = (p: string) => (p.startsWith('/work/project/') ? p.slice('/work/project/'.length) : p)
  it('follows the cds a command begins with, however they are separated, and stops at one it cannot read', () => {
    expect(afterLeadingCd('cd tm/x && ls', '', rel)).toBe('tm/x')
    expect(afterLeadingCd('cd tm; cd x; ls', '', rel)).toBe('tm/x')
    expect(afterLeadingCd('cd "tm/x y" && ls', '', rel)).toBe('tm/x y')
    expect(afterLeadingCd("cd 'tm' && ls", 'a', rel)).toBe('a/tm')
    expect(afterLeadingCd('cd tm/x\npython3 - <<EOF', '', rel)).toBe('tm/x')
    expect(afterLeadingCd('cd /work/project/tm && ls', 'elsewhere', rel)).toBe('tm')
    expect(afterLeadingCd('cd /tmp && ls', 'tm', rel)).toBe('/tmp')
    expect(afterLeadingCd('cd ~ && cd tm && ls', 'a', rel)).toBe('a')
    expect(afterLeadingCd('cd $D && ls', 'a', rel)).toBe('a')
    expect(afterLeadingCd('ls && cd tm', 'a', rel)).toBe('a')
  })

  it('reads a Codex command inside its login-shell wrapper, and marks one the operator declined', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-codex-cwd-'))
    try {
      const thread = '00000000-0000-4000-8000-000000000001'
      fs.writeFileSync(path.join(dir, 'codex-threads.json'), JSON.stringify([{ id: thread, agent_role: null, agent_path: null, created_at_ms: 1 }]))
      const item = (n: number, d: Record<string, unknown>) => ({ thread_id: thread, turn_id: 't', item_id: `i${n}`, rollout_ordinal: n, created_at_ms: n, completed_at_ms: n, item_type: 'commandExecution', item_json: JSON.stringify({ type: 'commandExecution', id: `i${n}`, cwd: '/work/project', exitCode: 0, aggregatedOutput: '', ...d }) })
      fs.writeFileSync(path.join(dir, 'codex-thread-items.json'), JSON.stringify([
        item(1, { command: "/bin/zsh -lc 'cd tm/x/attributes && ls'", status: 'completed' }),
        item(2, { command: "/bin/zsh -lc 'cat > tm/x/structure.json <<EOF'", status: 'declined' }),
      ]))
      const shells = parseRun('codex', dir, { projectRoot: '/work/project' }).events.filter((e) => e.kind === 'shell')
      expect(shells.map((e) => [e.cwdRel, e.denied ?? null])).toEqual([['tm/x/attributes', null], ['', 'declined']])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
