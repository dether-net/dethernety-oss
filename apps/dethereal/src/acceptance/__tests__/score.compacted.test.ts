/**
 * A question pending when the operator compacted the session: `/compact` is never
 * its answer. The session finds its place by asking again; one it never asks
 * again is a finding.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseAnswerSheet } from '../answer-sheet.js'
import { h7, postCompaction } from '../score/h7.js'
import { shownPrompts, type Registry, type ShownPrompt } from '../score/prompts.js'
import { departsFromSheet } from '../score/verdict.js'
import { FIXTURE } from './fixtures/clean-run.js'
import { eventBuilder } from './helpers.js'

const builder = eventBuilder()
const ev = builder.ev
const registry: Registry = new Map([['unregistered-confirm', { mandatory: true, requires: [] }], ['orphaned-drop', { mandatory: true, requires: [] }]])
const sheet = parseAnswerSheet(fs.readFileSync(path.join(FIXTURE, 'key', 'answer-sheet.yaml'), 'utf8'))
const ask = (id: string) => ev({ kind: 'assistant', text: `[prompt: ${id}] Confirm?` })
const codes = (shown: ShownPrompt[]) => h7({ sheet, shown, replies: [], pairs: [], mode: 'loopback' }).findings.map((f) => `${f.verdict}:${f.code}:${f.refs?.[0]}`)

describe('a question pending at a compaction', () => {
  it("is compacted by the operator's /compact, with or without arguments, never answered by it", () => {
    for (const text of ['<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>', '<command-name>/compact</command-name>\n<command-args>keep the tables</command-args>']) {
      builder.reset()
      const shown = shownPrompts([ask('unregistered-confirm'), ev({ kind: 'user', text }), ev({ kind: 'compaction', trigger: 'manual' }), ev({ kind: 'user', text: 'confirm all' })], registry)
      expect(shown).toEqual([{ id: 'unregistered-confirm', event: 0, complete: true, missing: [], compacted: true, segment: 0 }])
    }
  })

  it('is compacted by a compaction not recorded as automatic, and still answered after an automatic one', () => {
    builder.reset()
    // A harness that records no trigger, and no /compact message.
    expect(shownPrompts([ask('unregistered-confirm'), ev({ kind: 'compaction' }), ev({ kind: 'user', text: 'confirm all' })], registry)[0]).toMatchObject({ compacted: true })
    builder.reset()
    const auto = shownPrompts([ask('unregistered-confirm'), ev({ kind: 'compaction', trigger: 'auto' }), ev({ kind: 'user', text: 'confirm all' })], registry)[0]!
    expect(auto).toMatchObject({ answeredBy: 2 })
    expect(auto.compacted).toBeUndefined()
  })

  it('needs nothing when asked again and answered; fails a mandatory question never asked again, and has another reviewed', () => {
    const at = (id: string, event: number, extra: Partial<ShownPrompt>): ShownPrompt => ({ id, event, complete: true, missing: [], segment: 0, ...extra })
    expect(codes([at('crown-jewel-confirm', 5, { compacted: true }), at('crown-jewel-confirm', 9, { answeredBy: 10, segment: 1 })])
      .filter((c) => c.includes('crown-jewel-confirm'))).toEqual([])
    expect(codes([at('crown-jewel-confirm', 5, { compacted: true })]).filter((c) => c.includes('crown-jewel-confirm')))
      .toEqual(['FAIL:prompt_compacted:crown-jewel-confirm'])
    // A question asked only when the run has something to ask: compacted and never asked again, it needs review.
    expect(codes([at('classification-confirm', 5, { compacted: true })]).filter((c) => c.includes('classification-confirm')))
      .toEqual(['needs-review:prompt_compacted:classification-confirm'])
    expect(codes([at('classification-gap', 5, { compacted: true })]).filter((c) => c.includes('classification-gap')))
      .toEqual(['needs-review:prompt_compacted:classification-gap'])
    // Never read as a question the session did not wait on.
    expect(codes([at('classification-gap', 5, { compacted: true })]).some((c) => c.includes('prompt_not_awaited'))).toBe(false)
  })

  it('is not a question the session failed to wait on after a compaction', () => {
    builder.reset()
    const events = [ev({ kind: 'compaction', trigger: 'manual' }), ask('unregistered-confirm'), ev({ kind: 'user', text: '<command-name>/compact</command-name>' }), ev({ kind: 'compaction', trigger: 'manual' })]
    const shown = shownPrompts(events, registry)
    expect(shown[0]).toMatchObject({ compacted: true })
    expect(postCompaction(events, shown).findings.map((f) => f.code)).not.toContain('question_not_awaited')
  })

  it('counts toward the showing a sheet variant starts from', () => {
    const at = (event: number, extra: Partial<ShownPrompt>): ShownPrompt => ({ id: 'gate3-loopback', event, complete: true, missing: [], segment: 0, ...extra })
    const third = at(30, { answeredBy: 31 })
    // The operator saw the first showing, then compacted: the third showing still takes the third-showing reply.
    const shown = [at(10, { compacted: true }), at(20, { answeredBy: 21 }), third]
    expect(departsFromSheet(sheet, { prompt: 'gate3-loopback', text: 'skip to sync anyway' }, third, shown, 'loopback')).toBe(false)
  })
})
