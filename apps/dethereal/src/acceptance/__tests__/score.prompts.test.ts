/**
 * When a question counts as shown: its tag and every phrase the registry
 * requires, in a dialog or in plain assistant text that ends the turn; a
 * typed reply, a number included, answers it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseAnswerSheet } from '../answer-sheet.js'
import { readRegistry, renderPhrase, rejectedPromptCalls, shownPrompts, type Registry } from '../score/prompts.js'
import { departsFromSheet, verdict } from '../score/verdict.js'
import type { ReplyMatch } from '../score/replies.js'
import type { ReplyLine } from '../score/run-dir.js'
import { h7 } from '../score/h7.js'
import { FIXTURE } from './fixtures/clean-run.js'
import { parseClaude } from '../transcripts/claude.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { eventBuilder } from './helpers.js'

const builder = eventBuilder()
const ev = builder.ev
const registry: Registry = new Map([['boundary-trust', { mandatory: true, requires: ['Accept all'] }]])

describe('shownPrompts', () => {
  it('counts a plain-message table ask that ends the turn, answered by a number', () => {
    builder.reset()
    const events = [
      ev({ kind: 'assistant', text: '| Boundary | Zone |\n|---|---|\n| Edge | PUBLIC |\n\n[prompt: boundary-trust] How do you want to proceed?\n1. Accept all\n2. Change a zone' }),
      ev({ kind: 'user', text: '2' }),
    ]
    expect(shownPrompts(events, registry)).toEqual([{ id: 'boundary-trust', event: 0, complete: true, missing: [], answeredBy: 1, segment: 0 }])
  })

  it('does not count a question the session did not wait on, and names a missing phrase', () => {
    builder.reset()
    const events = [
      ev({ kind: 'assistant', text: '[prompt: boundary-trust] Proceeding with the proposal.' }),
      ev({ kind: 'tool_call', tool: 'Write' }),
      ev({ kind: 'user', text: 'ok' }),
    ]
    expect(shownPrompts(events, registry)).toEqual([{ id: 'boundary-trust', event: 0, complete: false, missing: ['Accept all'], segment: 0 }])
  })

  it('counts a dialog answered by its picked label', () => {
    builder.reset()
    const events = [
      ev({ kind: 'ask', input: { questions: [{ question: '[prompt: boundary-trust] Accept all?', options: [{ label: 'Accept all' }] }] } }),
      ev({ kind: 'answer', answers: ['Accept all'] }),
    ]
    expect(shownPrompts(events, registry)[0]).toMatchObject({ complete: true, answeredBy: 1 })
  })

  it('reads a phrase without its punctuation or markup, but never across a different word', () => {
    builder.reset()
    const reg: Registry = new Map([['enrichment-relay', { mandatory: true, requires: ['Accept, reject or adjust specific rows?'] }]])
    const shown = (text: string) => shownPrompts([ev({ kind: 'assistant', text: `[prompt: enrichment-relay] ${text}` }), ev({ kind: 'user', text: 'ok' })], reg)[0]
    // A serial comma, bold markup and a trailing space are the same phrase.
    expect(shown('All pending. **Accept, reject, or adjust specific rows?**')).toMatchObject({ complete: true, missing: [] })
    // Another word is not.
    expect(shown('All pending. Accept, reject or change specific rows?')).toMatchObject({ complete: false, missing: ['Accept, reject or adjust specific rows?'] })
  })

  it('meets a choice list by offering each choice, never by a word in the prose or the tag', () => {
    builder.reset()
    const reg: Registry = new Map([
      ['items-confirm', { mandatory: true, requires: ['(accept all / adjust)'] }],
      ['review-record', { mandatory: true, requires: ['(record / skip)'] }],
      ['yes-no', { mandatory: true, requires: ['(yes / no)'] }],
      ['file-read', { mandatory: false, requires: ['(not read)'] }],
      ['inline', { mandatory: false, requires: ['say (keep / drop) here'] }],
    ])
    const say = (text: string) => ev({ kind: 'assistant', text })
    const ask = (question: string, labels: string[]) => ev({ kind: 'ask', input: { questions: [{ question, options: labels.map((label) => ({ label })) }] } })
    const events = [
      say('[prompt: items-confirm] Confirm these items?\n1. accept all\n2. adjust'), ev({ kind: 'user', text: '1' }),
      ask('[prompt: items-confirm] Confirm these items?', ['Accept all', 'Adjust specific rows']), ev({ kind: 'answer', answers: ['Accept all'] }),
      say('[prompt: items-confirm] Confirm these items? (accept all / adjust)'), ev({ kind: 'user', text: 'accept all' }),
      say('[prompt: review-record] Record the model now?'), ev({ kind: 'user', text: 'yes' }),
      say('[prompt: yes-no] Is this now correct, or do you know better?\n- yes\n- not now'), ev({ kind: 'user', text: 'yes' }),
      say('[prompt: file-read] The file was skipped (not read).'), ev({ kind: 'user', text: 'ok' }),
      say('[prompt: file-read] The file was not read.'), ev({ kind: 'user', text: 'ok' }),
      say('[prompt: items-confirm] Confirm these items?\n- Accept all rows\n* adjust'), ev({ kind: 'user', text: 'adjust' }),
      say('[prompt: inline] Which?\n1. keep\n2. drop'), ev({ kind: 'user', text: 'keep' }),
    ]
    expect(shownPrompts(events, reg).map((p) => [p.id, p.complete])).toEqual([
      ['items-confirm', true], ['items-confirm', true], ['items-confirm', true],
      ['review-record', false], ['yes-no', false], ['file-read', true], ['file-read', false],
      // Bulleted items offer choices too; a phrase with a choice list inside it is a literal phrase.
      ['items-confirm', true], ['inline', false],
    ])
  })

  it('meets a phrase of alternatives by any one of them, its choice list kept whole', () => {
    builder.reset()
    const reg: Registry = new Map([['orphaned-drop', { mandatory: true, requires: ['renamed | moved | re-pointed | reclassified | removed', '(drop / stop)'] }]])
    const ask = (question: string) => ev({ kind: 'ask', input: { questions: [{ question, options: [{ label: 'drop' }, { label: 'stop' }] }] } })
    const events = [
      ask('[prompt: orphaned-drop] 1 registered value belongs to an element that was reclassified. Drop it?'), ev({ kind: 'answer', answers: ['drop'] }),
      ask('[prompt: orphaned-drop] 2 registered values belong to elements that were renamed or removed. Drop them?'), ev({ kind: 'answer', answers: ['drop'] }),
      ask('[prompt: orphaned-drop] 1 registered value belongs to an element that changed. Drop it?'), ev({ kind: 'answer', answers: ['drop'] }),
    ]
    expect(shownPrompts(events, reg).map((p) => [p.complete, p.missing])).toEqual([
      [true, []], [true, []], [false, ['renamed | moved | re-pointed | reclassified | removed']],
    ])
  })

  it('marks a dialog the operator dismissed, and not one that failed', () => {
    builder.reset()
    const ask = (callId: string) => ev({ kind: 'ask', callId, input: { questions: [{ question: '[prompt: boundary-trust] Accept all?' }] } })
    const events = [
      ask('a'), ev({ kind: 'answer', callId: 'a', isError: true, dismissed: true }),
      ask('b'), ev({ kind: 'answer', callId: 'b', isError: true }),
      ask('c'), ev({ kind: 'answer', callId: 'c', answers: ['Accept all'] }),
    ]
    expect(shownPrompts(events, registry).map((p) => [p.event, p.answeredBy ?? null, p.dismissed ?? false])).toEqual([[0, null, true], [2, null, false], [4, 5, false]])
  })

  it('takes a dismissal only from the dialog\'s own answer', () => {
    builder.reset()
    // Two dialogs in one message: the first, untagged, is dismissed; the tagged one's answer comes after it.
    const events = [
      ev({ kind: 'ask', callId: 'x', input: { questions: [{ question: 'Which folder?' }] } }),
      ev({ kind: 'ask', callId: 'y', input: { questions: [{ question: '[prompt: boundary-trust] Accept all?' }] } }),
      ev({ kind: 'answer', callId: 'x', isError: true, dismissed: true }),
      ev({ kind: 'answer', callId: 'y', answers: ['Accept all'] }),
    ]
    expect(shownPrompts(events, registry)[0]).not.toHaveProperty('dismissed')
  })
})

describe("a required phrase that names a command, as the run's harness shows it", () => {
  const REGISTRY = path.join(path.dirname(new URL(import.meta.url).pathname), '../../../workflow/shared/prompts.yaml')

  it('renders the command token for each harness, and keeps it as written without one', () => {
    expect(renderPhrase('{{cmd:login}}', 'claude')).toBe('/dethereal:login')
    expect(renderPhrase('{{cmd:login}}', 'codex')).toBe('$dethereal:login')
    expect(renderPhrase('{{cmd:login}}', 'opencode')).toBe('/dethereal-login')
    expect(readRegistry(REGISTRY, 'codex').get('auth-missing')!.requires).toContain('$dethereal:login')
    expect(readRegistry(REGISTRY).get('auth-missing')!.requires).toContain('{{cmd:login}}')
  })

  it('counts a sign-in question complete when it names the command as the harness spells it', () => {
    builder.reset()
    const events = [
      ev({ kind: 'assistant', text: '[prompt: auth-missing] Not signed in to the platform. Sign in with `$dethereal:login` first, or skip this step for now? (signed in / skip)' }),
      ev({ kind: 'user', text: 'skip' }),
    ]
    const codex = new Map([['auth-missing', readRegistry(REGISTRY, 'codex').get('auth-missing')!]])
    const claude = new Map([['auth-missing', readRegistry(REGISTRY, 'claude').get('auth-missing')!]])
    expect(shownPrompts(events, codex)[0]).toMatchObject({ id: 'auth-missing', complete: true, missing: [] })
    expect(shownPrompts(events, claude)[0]).toMatchObject({ complete: false, missing: ['/dethereal:login'] })
  })
})

describe('a dialog question headed by the prompt id', () => {
  const loopback: Registry = new Map([['gate3-loopback', { mandatory: true, requires: ['loop back', 'waive', 'skip to sync anyway', 'un-REVIEWED'] }]])
  const QUESTION = 'Gate 3 did not pass. Loop back to Step 8 to fill the gaps, waive named elements, or skip to sync anyway (the model stays un-REVIEWED)?'
  const headed = (header: string, question = QUESTION) =>
    ev({ kind: 'ask', input: { questions: [{ header, question, options: [{ label: 'loop back' }, { label: 'waive' }, { label: 'skip to sync anyway' }] }] } })

  it('shows the prompt, as a tag in its text would, with the required phrases read from the text', () => {
    builder.reset()
    const events = [headed('gate3-loopback'), ev({ kind: 'answer', answers: ['loop back'] })]
    expect(shownPrompts(events, loopback)).toEqual([{ id: 'gate3-loopback', event: 0, complete: true, missing: [], answeredBy: 1, segment: 0 }])
    builder.reset()
    const bare = ev({ kind: 'ask', input: { questions: [{ header: 'gate3-loopback', question: 'Gate 3 did not pass. Loop back, or move on?' }] } })
    const short = shownPrompts([bare, ev({ kind: 'user', text: 'loop back' })], loopback)[0]
    expect(short).toMatchObject({ id: 'gate3-loopback', complete: false, missing: ['waive', 'skip to sync anyway', 'un-REVIEWED'] })
  })

  it('takes only a registry id, exactly as written, and counts a header and a tag for the same prompt once', () => {
    for (const header of ['Gate3-loopback', 'gate3-loopback ', 'gate3', 'Gate 3']) {
      builder.reset()
      expect(shownPrompts([headed(header), ev({ kind: 'answer', answers: ['loop back'] })], loopback), header).toEqual([])
    }
    builder.reset()
    expect(shownPrompts([headed('gate3-loopback', `[prompt: gate3-loopback] ${QUESTION}`), ev({ kind: 'answer', answers: ['loop back'] })], loopback).map((p) => p.id)).toEqual(['gate3-loopback'])
    // A header names a prompt only on a dialog: plain text that merely says the id shows nothing.
    builder.reset()
    expect(shownPrompts([ev({ kind: 'assistant', text: `gate3-loopback: ${QUESTION}` }), ev({ kind: 'user', text: 'loop back' })], loopback)).toEqual([])
  })

  it('counts toward the showing a sheet variant starts from', () => {
    builder.reset()
    const shown = shownPrompts([
      headed('gate3-loopback'), ev({ kind: 'answer', answers: ['loop back'] }),
      ev({ kind: 'tool_call', tool: 'dethereal.validate_model_json' }),
      headed('gate3-loopback'), ev({ kind: 'answer', answers: ['skip to sync anyway'] }),
    ], loopback)
    expect(shown.map((p) => [p.event, p.answeredBy])).toEqual([[0, 1], [3, 4]])
    const sheet = parseAnswerSheet(fs.readFileSync(path.join(FIXTURE, 'key', 'answer-sheet.yaml'), 'utf8'))
    // The second showing takes the second-showing reply; without the header it would read as off the sheet.
    expect(departsFromSheet(sheet, { prompt: 'gate3-loopback', text: 'skip to sync anyway' }, shown[1], shown, 'loopback')).toBe(false)
    expect(departsFromSheet(sheet, { prompt: 'gate3-loopback', text: 'skip to sync anyway' }, undefined, [], 'loopback')).toBe(true)
  })

  it('names a rejected call by its header too, when the registry is given', () => {
    builder.reset()
    const events = [{ ...headed('gate3-loopback'), callId: 'q1' }, ev({ kind: 'answer', callId: 'q1', isError: true, inputRejected: true })]
    expect(rejectedPromptCalls(events, loopback)).toEqual([{ id: 'gate3-loopback', event: 0 }])
    expect(rejectedPromptCalls(events)).toEqual([])
  })
})

describe('a message followed at once by a dialog asking the same question', () => {
  const two: Registry = new Map([...registry, ['scope', { mandatory: true, requires: [] }]])
  const sheet = parseAnswerSheet(fs.readFileSync(path.join(FIXTURE, 'key', 'answer-sheet.yaml'), 'utf8'))
  const message = () => ev({ kind: 'assistant', text: '| Boundary | Zone |\n|---|---|\n| Edge | PUBLIC |\n\n[prompt: boundary-trust] Accept all, or adjust specific rows?' })
  const dialog = (callId: string, id = 'boundary-trust') => ev({ kind: 'ask', callId, input: { questions: [{ header: 'Trust', question: `[prompt: ${id}] Proceed with the zones above?` }] } })
  const trust = (shown: ReturnType<typeof shownPrompts>) =>
    h7({ sheet, shown, replies: [], pairs: [], mode: 'bar' }).findings.filter((f) => f.refs?.includes('boundary-trust')).map((f) => `${f.verdict}:${f.code}`)

  it('waits with the dialog: the message takes its answer and names it, and its wording is the dialog\'s to judge', () => {
    builder.reset()
    const events = [message(), ev({ kind: 'assistant', text: 'One question:' }), dialog('d'), ev({ kind: 'answer', callId: 'd', answers: ['yes'] })]
    const shown = shownPrompts(events, registry)
    expect(shown).toEqual([
      { id: 'boundary-trust', event: 0, complete: true, missing: [], answeredBy: 3, segment: 0, via: 2 },
      { id: 'boundary-trust', event: 2, complete: false, missing: ['Accept all'], answeredBy: 3, segment: 0 },
    ])
    expect(trust(shown)).toEqual(['needs-review:prompt_wording'])
  })

  it('does not wait with a dialog asking something else, or one after another action, or one the harness rejected', () => {
    builder.reset()
    const other = shownPrompts([message(), dialog('d', 'scope'), ev({ kind: 'answer', callId: 'd', answers: ['yes'] })], two)
    expect(other[0]).toEqual({ id: 'boundary-trust', event: 0, complete: true, missing: [], segment: 0 })
    expect(trust(other)).toEqual(['FAIL:prompt_not_awaited'])
    builder.reset()
    const acted = shownPrompts([message(), ev({ kind: 'tool_call', tool: 'Write' }), dialog('d'), ev({ kind: 'answer', callId: 'd', answers: ['yes'] })], registry)
    expect(acted[0]).toEqual({ id: 'boundary-trust', event: 0, complete: true, missing: [], segment: 0 })
    expect(trust(acted)).toContain('FAIL:prompt_not_awaited')
    builder.reset()
    const rejected = shownPrompts([message(), dialog('d'), ev({ kind: 'answer', callId: 'd', isError: true, inputRejected: true })], registry)
    expect(rejected).toEqual([{ id: 'boundary-trust', event: 0, complete: true, missing: [], segment: 0 }])
    expect(trust(rejected)).toEqual(['FAIL:prompt_not_awaited'])
    // Only a message waits with the dialog after it: a dialog is a showing of its own.
    builder.reset()
    const twice = shownPrompts([dialog('a'), dialog('b'), ev({ kind: 'answer', callId: 'b', answers: ['yes'] })], registry)
    expect(twice.map((p) => [p.event, p.answeredBy ?? null, p.via ?? null])).toEqual([[0, null, null], [1, 2, null]])
  })

  it('passes over a dialog the harness rejected, to the retry', () => {
    builder.reset()
    const shown = shownPrompts([
      message(), dialog('r'), ev({ kind: 'answer', callId: 'r', isError: true, inputRejected: true }), dialog('d'), ev({ kind: 'answer', callId: 'd', answers: ['yes'] }),
    ], registry)
    expect(shown.map((p) => [p.event, p.answeredBy ?? null, p.via ?? null])).toEqual([[0, 4, 3], [3, 4, null]])
    expect(trust(shown)).toEqual(['needs-review:prompt_wording'])
  })

  it('waits through a compaction recorded as automatic, never through one the operator asked for', () => {
    builder.reset()
    const auto = shownPrompts([message(), ev({ kind: 'compaction', trigger: 'auto' }), dialog('d'), ev({ kind: 'answer', callId: 'd', answers: ['yes'] })], registry)
    expect(auto.map((p) => [p.event, p.answeredBy ?? null, p.via ?? null])).toEqual([[0, 3, 2], [2, 3, null]])
    builder.reset()
    const manual = shownPrompts([message(), ev({ kind: 'compaction', trigger: 'manual' }), dialog('d'), ev({ kind: 'answer', callId: 'd', answers: ['yes'] })], registry)
    expect(manual.map((p) => [p.event, p.compacted ?? false, p.via ?? null])).toEqual([[0, true, null], [2, false, null]])
  })

  it('takes a dismissal from the dialog, reported once, on the dialog', () => {
    builder.reset()
    const shown = shownPrompts([message(), dialog('d'), ev({ kind: 'answer', callId: 'd', isError: true, dismissed: true })], registry)
    expect(shown.map((p) => [p.event, p.dismissed ?? false, p.via ?? null])).toEqual([[0, true, 1], [1, true, null]])
    const found = h7({ sheet, shown, replies: [], pairs: [], mode: 'bar' }).findings.filter((f) => f.refs?.includes('boundary-trust'))
    expect(found.map((f) => [f.code, f.events])).toEqual([['prompt_dismissed', [1]]])
  })

  it('counts the pair as one showing toward a sheet variant', () => {
    builder.reset()
    const loopback: Registry = new Map([['gate3-loopback', { mandatory: true, requires: [] }]])
    const ask = (callId: string) => ev({ kind: 'ask', callId, input: { questions: [{ header: 'gate3-loopback', question: 'Loop back?' }] } })
    const shown = shownPrompts([
      ev({ kind: 'assistant', text: '[prompt: gate3-loopback] Gate 3 did not pass.' }), ask('a'), ev({ kind: 'answer', callId: 'a', answers: ['loop back'] }),
    ], loopback)
    expect(shown.map((p) => [p.event, p.answeredBy, p.via ?? null])).toEqual([[0, 2, 1], [1, 2, null]])
    // One showing so far: the second-showing reply is off the sheet here.
    expect(departsFromSheet(sheet, { prompt: 'gate3-loopback', text: 'skip to sync anyway' }, shown[1], shown, 'loopback')).toBe(true)
  })

  it('judges a reply at the dialog it answered, never at the message beside it', () => {
    builder.reset()
    const loopback: Registry = new Map([['gate3-loopback', { mandatory: true, requires: [] }]])
    const pair = (callId: string, reply: string) => [
      ev({ kind: 'assistant', text: '[prompt: gate3-loopback] Gate 3 did not pass.' }),
      ev({ kind: 'ask', callId, input: { questions: [{ header: 'gate3-loopback', question: 'Loop back?' }] } }),
      ev({ kind: 'answer', callId, answers: [reply] }),
    ]
    const events = [...pair('a', 'loop back'), ev({ kind: 'tool_call', tool: 'dethereal.validate_model_json' }), ...pair('b', 'skip to sync anyway')]
    const shown = shownPrompts(events, loopback)
    const replies = [{ prompt: 'gate3-loopback', text: 'skip to sync anyway' }] as ReplyLine[]
    // The second dialog is the prompt's second showing: its reply is the sheet's from that showing on.
    const v = verdict({
      gates: [], rubric: [], adjudications: [], shown, registry: loopback, sheet, mode: 'loopback', replies,
      pairs: [{ line: 1, event: 6 }] as ReplyMatch['pairs'], clean: true, hashes: { bundle: 'x', dist: 'y' },
    })
    expect(v.marginalReasons.filter((r) => r.includes('off-sheet'))).toEqual([])
  })
})

describe('a question call the harness rejected on its input', () => {
  it('is no showing, as Claude Code records the rejection, and is listed as a rejected call', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-rejected-ask-'))
    try {
      const at = (n: number) => `2026-01-01T00:00:0${n}.000Z`
      const question = '[prompt: boundary-trust] Accept all, or adjust specific rows?'
      const rejection = '<tool_use_error>InputValidationError: [\n  {\n    "origin": "array",\n    "code": "too_small",\n    "minimum": 2,\n    "inclusive": true,\n    "path": [\n      "questions", 0, "options"\n    ],\n    "message": "Too small: expected array to have >=2 items"\n  }\n]</tool_use_error>'
      const lines = [
        { type: 'assistant', timestamp: at(1), uuid: 'u1', cwd: '/w', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [{ question, header: 'Trust', options: [{ label: 'Accept all' }] }] } }] } },
        { type: 'user', timestamp: at(2), uuid: 'u2', cwd: '/w', toolUseResult: rejection.replace(/^<tool_use_error>|<\/tool_use_error>$/g, ''), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: rejection, is_error: true }] } },
      ]
      fs.writeFileSync(path.join(dir, 'session.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
      const { events } = parseClaude(dir)
      const seqd = events.map((e, seq) => ({ ...e, seq }) as TranscriptEvent)
      expect(seqd.find((e) => e.kind === 'answer')?.inputRejected).toBe(true)
      expect(shownPrompts(seqd, registry)).toEqual([])
      expect(rejectedPromptCalls(seqd).map((r) => r.id)).toEqual(['boundary-trust'])
      // With a denial kind it is a refusal of a shown call, never a rejected input.
      fs.writeFileSync(path.join(dir, 'session.jsonl'), [lines[0], { ...lines[1], toolDenialKind: 'permission-rule' }].map((l) => JSON.stringify(l)).join('\n') + '\n')
      expect(parseClaude(dir).events.find((e) => e.kind === 'answer')?.inputRejected).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
