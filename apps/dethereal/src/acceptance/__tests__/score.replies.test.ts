/**
 * The shared reply-matching rule: the operator's log against the operator input
 * the transcript records, after normalisation, one to one and in order.
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { matchReplies, normaliseAnswer, normaliseOperatorText, normaliseReply, operatorInputs } from '../score/replies.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import type { ReplyLine } from '../score/run-dir.js'
import { eventBuilder } from './helpers.js'

const builder = eventBuilder()
const ev = builder.ev
const reply = (prompt: string, text: string): ReplyLine => ({ ts: '2026-01-01T00:00:00Z', prompt, text, sha256: createHash('sha256').update(text).digest('hex') })

describe('normaliseOperatorText', () => {
  it('reduces a slash-command record to the command as typed', () => {
    expect(normaliseOperatorText('<command-message>dethereal:threat-model</command-message>\n<command-name>/dethereal:threat-model</command-name>\n<command-args>Threat-model this.</command-args>'))
      .toBe('/dethereal:threat-model Threat-model this.')
    expect(normaliseOperatorText('<command-name>/compact</command-name>\n  <command-message>compact</command-message>\n  <command-args></command-args>')).toBe('/compact')
  })
  it('unwraps pasted blocks and ignores surrounding whitespace', () => {
    expect(normaliseOperatorText('\n\n<pasted_content id="d62a">\nsystem_name: X\nscope: y\n</pasted_content id="d62a">\n')).toBe('system_name: X\nscope: y')
    expect(normaliseOperatorText('  Accept all.\n')).toBe('Accept all.')
  })
})

describe('matchReplies', () => {
  const transcript = () => {
    builder.reset()
    return [
      ev({ kind: 'user', text: '<command-name>/dethereal:threat-model</command-name>\n<command-args>Go.</command-args>' }),
      ev({ kind: 'ask', text: '[prompt: scope]' }),
      ev({ kind: 'answer', answers: ['Confirm as shown'] }),
      ev({ kind: 'notice', text: '<task-notification>done</task-notification>' }),
      ev({ kind: 'subagent_prompt', actor: 'scout', text: 'Scan the codebase' }),
      ev({ kind: 'user', text: '\n<pasted_content id="a">\nsystem_name: X\n</pasted_content id="a">\n' }),
      ev({ kind: 'compaction' }),
      ev({ kind: 'user', text: 'Continue the threat-model workflow.' }),
    ]
  }
  const log = [
    reply('invocation', '/dethereal:threat-model Go.'),
    reply('scope', 'Confirm as shown'),
    reply('blind-spots', 'system_name: X'),
    reply('fixed:compact', '/compact'),
    reply('fixed:after-compact', 'Continue the threat-model workflow.'),
  ]

  it('matches every reply, in order, and never counts notices or subagent tasks as operator input', () => {
    const r = matchReplies(transcript(), log)
    expect(r.mismatches).toEqual([])
    expect(r.pairs.map((p) => p.event)).toEqual([0, 2, 5, 6, 7])
  })

  it('matches a /compact reply with the recorded /compact message where the harness records one', () => {
    const events = transcript()
    events.splice(6, 0, ev({ kind: 'user', text: '<command-name>/compact</command-name>' }))
    events.forEach((e, i) => (e.seq = i))
    expect(matchReplies(events, log).ok).toBe(true)
    expect(operatorInputs(events).filter((i) => i.kind === 'compaction')).toHaveLength(1)
  })

  it('reports a reply that differs, a reply the transcript lacks, and input the log lacks', () => {
    const changed = [...log]
    changed[1] = reply('scope', 'Confirm')
    expect(matchReplies(transcript(), changed).mismatches).toEqual([{ line: 2, event: 2, reason: 'the reply does not match the next operator input in the transcript' }])
    expect(matchReplies(transcript(), [...log, reply('session-break', 'yes')]).mismatches.map((m) => m.reason)).toEqual(['no operator input left in the transcript for this reply'])
    expect(matchReplies(transcript(), log.slice(0, 4)).mismatches).toEqual([{ event: 7, reason: 'an operator input in the transcript has no reply in the log' }])
  })

  it('does not treat an automatic compaction as operator input', () => {
    const events = transcript()
    events.splice(1, 0, ev({ kind: 'compaction', trigger: 'auto' }))
    events.forEach((e, i) => (e.seq = i))
    const r = matchReplies(events, log)
    expect(r.ok).toBe(true)
  })
})

describe('a dialog answer against a logged pick', () => {
  const run = (answer: string, logged: string) => {
    builder.reset()
    return matchReplies([ev({ kind: 'ask', text: '[prompt: decomposition]' }), ev({ kind: 'answer', answers: [answer] })], [reply('decomposition', logged)])
  }

  it('matches the sheet pick against the label a harness marks as recommended', () => {
    expect(run('Continue (Recommended)', 'continue').ok).toBe(true)
    expect(run('Continue (Recommended)', 'Continue (Recommended)').ok).toBe(true)
    expect(run('Continue (recommended)', 'continue (RECOMMENDED)').ok).toBe(true)
  })

  it('matches a plain label, and one that differs only in case', () => {
    expect(run('later', 'later').ok).toBe(true)
    expect(run('Later', 'later').ok).toBe(true)
  })

  it('never matches a different option that starts the same way', () => {
    expect(run('Continue with narrowing', 'continue').ok).toBe(false)
    expect(run('Continue (Recommended)', 'continue with narrowing').ok).toBe(false)
    // Only one trailing mark is dropped, and only at the end.
    expect(run('Continue (Recommended) (Recommended)', 'continue').ok).toBe(false)
    expect(run('Continue (Recommended) now', 'continue now').ok).toBe(false)
    expect(normaliseAnswer('  Continue (Recommended)\n')).toBe('continue')
  })

  it('keeps the exact rule for a typed message', () => {
    builder.reset()
    const typed = [ev({ kind: 'user', text: 'Continue (Recommended)' })]
    expect(matchReplies(typed, [reply('decomposition', 'continue')]).ok).toBe(false)
    builder.reset()
    expect(matchReplies([ev({ kind: 'user', text: 'Accept all.' })], [reply('boundary-trust', 'accept all.')]).ok).toBe(false)
  })
})

describe('normaliseReply', () => {
  it('ignores case, markdown and closing punctuation', () => {
    expect(normaliseReply('  **Accept  all**.  ')).toBe('accept all')
    expect(normaliseReply('Use only the `dethernety-general` module!')).toBe('use only the dethernety-general module')
  })
})
