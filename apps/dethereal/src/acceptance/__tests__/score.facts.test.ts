/**
 * The operator facts a sheet reply gives only when its question asks for them: how the sheet lists them, how the
 * reply is composed from the turn's table rows and the run's reply mode, and what the scorer reads back from a run.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AnswerSheetError, chooseReply, parseAnswerSheet, replyForms, requiredIn, tableRows, withFacts } from '../answer-sheet.js'
import { checkFacts, tableRowsFor } from '../score/facts.js'
import { h7 } from '../score/h7.js'
import type { ShownPrompt } from '../score/prompts.js'
import { departsFromSheet } from '../score/verdict.js'
import { key, sheet } from './fixtures/clean-run.js'
import { eventBuilder } from './helpers.js'

const PACKAGE = path.resolve(__dirname, '../../..')

/** A one-prompt sheet: the given prompt lines after `  - id: relay`. */
const sheetOf = (lines: string[]) => parseAnswerSheet(['version: 1', 'prompts:', '  - id: relay', '    trigger: "x"', '    mandatory: true', '    required: always', '    how: typed', ...lines].join('\n') + '\n')
const RELAY = [
  '    reply: |', '      Accept all. What I can add:', '      - Gateway: fine.', '      {facts}', '      Anything else stays unknown.',
  '    facts:',
  '      - id: A', '        if_table_contains_any: ["implicit_deny_enabled"]', '        text: "The cluster enforces the policies."', '        only_modes: ["bar", "quick"]',
  '      - id: B', '        if_table_contains_any: ["on failure"]', '        text: "The vendor rejects a bad key."',
]

describe('the sheet lists facts', () => {
  it('reads each fact with its triggers, text and modes', () => {
    const p = sheetOf(RELAY).prompts[0]!
    expect(p.facts).toEqual([
      { id: 'A', ifTableContainsAny: ['implicit_deny_enabled'], text: 'The cluster enforces the policies.', onlyModes: ['bar', 'quick'] },
      { id: 'B', ifTableContainsAny: ['on failure'], text: 'The vendor rejects a bad key.' },
    ])
  })

  it('refuses a facts line it cannot fill, and facts no reply holds', () => {
    const bad = (lines: string[], why: RegExp) => expect(() => sheetOf(lines)).toThrow(why)
    bad(['    reply: "Accept all."', ...RELAY.slice(5)], /no reply holds \{facts\}/)
    bad(['    reply: |', '      Accept.', '      {facts}'], /lists no facts/)
    bad(['    reply: |', '      Accept.', '      {facts}', '      {facts}', ...RELAY.slice(5)], /more than once/)
    bad(['    reply: "Accept: {facts}"', ...RELAY.slice(5)], /line of its own/)
    bad([...RELAY, '      - id: A', '        if_table_contains_any: ["x"]', '        text: "Again."'], /listed twice/)
    bad([...RELAY.slice(0, 6), '      - id: A', '        text: "No triggers."'], /needs if_table_contains_any/)
    // With nothing asked for, a reply of the facts line alone would be empty.
    bad(['    reply: |', '      {facts}', ...RELAY.slice(5)], /nothing but \{facts\}/)
  })

  it('refuses a mode it does not know, wherever a mode is named', () => {
    // A typo reads as a sheet error, never as a mode that never holds.
    expect(() => sheetOf([...RELAY.slice(0, 9), '        only_modes: ["bra"]'])).toThrow(/only_modes must list reply modes/)
    expect(() => sheetOf(['    reply: "a"', '    variants:', '      - if_mode: full', '        reply: "b"'])).toThrow(/if_mode must be a reply mode/)
    expect(() => sheetOf(['    required_by_mode: {"bra": "if_shown"}', '    reply: "a"'])).toThrow(/required_by_mode must map/)
    expect(() => sheetOf(['    required_by_mode: {"bar": "sometimes"}', '    reply: "a"'])).toThrow(/required_by_mode must map/)
  })

  it('keeps a variant to one condition, and a field after the facts list to no variant', () => {
    expect(() => sheetOf(['    reply: "a"', '    variants:', '      - from_showing: 2', '        if_mode: bar', '        reply: "b"'])).toThrow(AnswerSheetError)
    // A reply indented under the facts list belongs to no variant: the line is not understood.
    expect(() => sheetOf(['    reply: "a"', '    variants:', '      - from_showing: 2', '        reply: "b"', ...RELAY.slice(5, 9), '        reply: "c"'])).toThrow(/unknown prompt field/)
  })

  it('reads the required level per mode', () => {
    const p = sheetOf(['    required_by_mode: {"bar": "if_shown"}', '    reply: "a"']).prompts[0]!
    expect([requiredIn(p, 'bar'), requiredIn(p, 'loopback'), requiredIn(p, 'quick')]).toEqual(['if_shown', 'always', 'always'])
  })
})

describe('the reply a question gets', () => {
  const relay = sheetOf(RELAY).prompts[0]!
  const rows = (...headers: string[]) => tableRows(headers.map((h) => `| ${h} |`))

  it('gives a fact only when a table row asks for it, in sheet order, in its modes', () => {
    expect(chooseReply(relay, { showing: 1, rows: rows('on failure', 'implicit_deny_enabled'), mode: 'bar' })).toEqual({
      text: 'Accept all. What I can add:\n- Gateway: fine.\n- The cluster enforces the policies.\n- The vendor rejects a bad key.\nAnything else stays unknown.\n', facts: ['A', 'B'],
    })
    expect(chooseReply(relay, { showing: 1, rows: rows('on failure'), mode: 'bar' }).facts).toEqual(['B'])
    // A loopback run gives the platform fact at the loop-back instead; a fact for every mode is still given.
    expect(chooseReply(relay, { showing: 1, rows: rows('implicit_deny_enabled', 'on failure'), mode: 'loopback' }).facts).toEqual(['B'])
    expect(chooseReply(relay, { showing: 1, rows: rows('implicit_deny_enabled'), mode: 'quick' }).facts).toEqual(['A'])
  })

  it('drops the facts line when no fact is asked for, and reads only table rows', () => {
    expect(chooseReply(relay, { showing: 1, rows: tableRows(['implicit_deny_enabled in prose', 'on failure']), mode: 'bar' })).toEqual({
      text: 'Accept all. What I can add:\n- Gateway: fine.\nAnything else stays unknown.\n', facts: [],
    })
  })

  it('gives no fact in a variant reply without the facts line, and reads no withheld fact into it', () => {
    const lines = [...RELAY.slice(0, 5), '    variants:', '      - from_showing: 2', '        reply: "skip"', ...RELAY.slice(5)]
    const p = sheetOf(lines).prompts[0]!
    expect(chooseReply(p, { showing: 2, rows: rows('on failure'), mode: 'bar' })).toEqual({ text: 'skip', variant: 1, facts: [] })
    const { ev } = eventBuilder()
    const events = [ev({ kind: 'assistant', text: '| on failure |' }), ev({ kind: 'user', text: 'skip' })]
    const line = { ts: '2026-01-01T00:00:00Z', prompt: 'relay', variant: 1, text: 'skip', sha256: '' }
    expect(checkFacts(sheetOf(lines), events, [line], [{ line: 1, event: 1 }], 'bar')).toEqual({ unasked: [], withheld: [] })
  })

  it('takes the first variant whose condition holds, in sheet order', () => {
    const p = sheetOf(['    reply: "loop back"', '    variants:', '      - from_showing: 2', '        reply: "skip"', '      - if_mode: bar', '        reply: "skip, bar"', '      - if_table_contains_any: ["store"]', '        reply: "store"']).prompts[0]!
    expect(chooseReply(p, { showing: 1, rows: '', mode: 'loopback' })).toEqual({ text: 'loop back', facts: [] })
    expect(chooseReply(p, { showing: 2, rows: '', mode: 'bar' })).toEqual({ text: 'skip', variant: 1, facts: [] })
    expect(chooseReply(p, { showing: 1, rows: rows('store'), mode: 'bar' })).toEqual({ text: 'skip, bar', variant: 2, facts: [] })
    expect(chooseReply(p, { showing: 1, rows: rows('store'), mode: 'loopback' })).toEqual({ text: 'store', variant: 3, facts: [] })
  })

  it('lists every form a reply can be pasted in: any facts of the mode, in sheet order', () => {
    expect(replyForms(relay, relay.reply, 'bar').map((t) => t.split('\n')[2])).toEqual([
      'Anything else stays unknown.', '- The cluster enforces the policies.', '- The vendor rejects a bad key.', '- The cluster enforces the policies.',
    ])
    expect(replyForms(relay, relay.reply, 'loopback')).toHaveLength(2)
    expect(replyForms(relay, 'no facts line', 'bar')).toEqual(['no facts line'])
    expect(withFacts('  {facts}', relay.facts)).toBe('  - The cluster enforces the policies.\n  - The vendor rejects a bad key.')
  })
})

describe('a logged reply against the sheet', () => {
  const relaySheet = sheetOf(RELAY)
  const relay = relaySheet.prompts[0]!
  const at: ShownPrompt = { id: 'relay', event: 0, complete: true, missing: [], answeredBy: 1, segment: 0 }
  const departs = (text: string, mode: 'bar' | 'loopback') => departsFromSheet(relaySheet, { prompt: 'relay', text }, at, [at], mode)
  const asked = (rows: string) => chooseReply(relay, { showing: 1, rows, mode: 'bar' }).text

  it('is on the sheet with any of its mode\'s facts, in order, and off it otherwise', () => {
    expect(departs(asked(tableRows(['| on failure |'])), 'bar')).toBe(false)
    expect(departs(asked(tableRows(['| on failure | implicit_deny_enabled |'])), 'bar')).toBe(false)
    expect(departs(withFacts(relay.reply, []), 'bar')).toBe(false)
    expect(departs(withFacts(relay.reply, [relay.facts[1]!, relay.facts[0]!]), 'bar')).toBe(true)
    expect(departs(relay.reply, 'bar')).toBe(true)
    // In a loopback run the platform fact is not the relay's to give.
    expect(departs(withFacts(relay.reply, [relay.facts[0]!]), 'loopback')).toBe(true)
  })

  it('answers the synthetic loop-back by mode: the facts in a loopback run, the skip in a bar run', () => {
    const p = sheet.prompts.find((x) => x.id === 'gate3-loopback')!
    const first: ShownPrompt = { id: p.id, event: 0, complete: true, missing: [], answeredBy: 1, segment: 0 }
    const off = (text: string, mode: 'bar' | 'loopback') => departsFromSheet(sheet, { prompt: p.id, text }, first, [first], mode)
    expect(off(p.reply, 'loopback')).toBe(false)
    expect(off('skip to sync anyway', 'loopback')).toBe(true)
    expect(off('skip to sync anyway', 'bar')).toBe(false)
    expect(off(p.reply, 'bar')).toBe(true)
  })
})

describe('the rows a reply answered', () => {
  const { ev } = eventBuilder()
  const events = [
    ev({ kind: 'assistant', text: '| implicit_deny_enabled |\nOld table.' }),
    ev({ kind: 'user', text: 'next' }),
    ev({ kind: 'assistant', text: 'Credentials\n| F# | flow | on failure |' }),
    ev({ kind: 'compaction' }),
    ev({ kind: 'assistant', text: 'Open fields\n| 1 | db | role_grants_least_privilege |\n\n[prompt: relay] Accept all?' }),
    ev({ kind: 'assistant', actor: 'enricher', text: '| secret_manager |' }),
    ev({ kind: 'user', text: 'the reply' }),
    ev({ kind: 'assistant', text: '| after the reply |' }),
  ]

  it('are the main session\'s table rows since the operator\'s last input, a compaction aside, up to the reply', () => {
    expect(tableRowsFor(events, 6)).toBe('| f# | flow | on failure |\n| 1 | db | role_grants_least_privilege |')
    expect(tableRowsFor(events, 1)).toBe('| implicit_deny_enabled |')
  })

  it('show a fact volunteered or out of its modes as a protocol breach, and one withheld as a reason to doubt', () => {
    const pairs = [{ line: 1, event: 6 }]
    const relay = sheetOf(RELAY)
    const log = (text: string) => [{ ts: '2026-01-01T00:00:00Z', prompt: 'relay', text, sha256: '' }]
    const reply = (ids: string[]) => withFacts(relay.prompts[0]!.reply, relay.prompts[0]!.facts.filter((f) => ids.includes(f.id)))
    expect(checkFacts(relay, events, log(reply(['B'])), pairs, 'bar')).toEqual({ unasked: [], withheld: [] })
    const unasked = checkFacts(relay, events, log(reply(['A', 'B'])), pairs, 'bar')
    expect(unasked.unasked).toEqual([{ code: 'fact_unasked', detail: 'replies.jsonl line 1 (relay) gives fact A, and no table row before the question asked for it' }])
    expect(checkFacts(relay, events, log(reply([])), pairs, 'bar')).toEqual({ unasked: [], withheld: ['replies.jsonl line 1 (relay) was asked for fact B and did not give it'] })
    const outOfMode = [ev({ kind: 'assistant', text: '| implicit_deny_enabled |' }), ev({ kind: 'user', text: 'x' })]
    expect(checkFacts(relay, outOfMode, log(reply(['A'])), [{ line: 1, event: outOfMode[1]!.seq }], 'loopback').unasked[0]!.detail).toMatch(/fact A, which a loopback run never gives/)
    // Only the lines of the prompt that owns the facts are read.
    expect(checkFacts(relay, events, [{ ...log(reply(['A']))[0]!, prompt: 'off-sheet' }], pairs, 'bar')).toEqual({ unasked: [], withheld: [] })
  })
})

describe('the synthetic relay\'s facts', () => {
  const relay = sheet.prompts.find((p) => p.id === 'enrichment-relay')!
  /** The facts that name a document describing the deployed system: its values are written only when it is named. */
  const DOCUMENT_FACTS = new Set(['F6', 'F7'])
  const SOURCE = path.join(PACKAGE, 'src/acceptance/fixtures/synthetic/source')

  it('are the platform facts, given in bar and quick runs only, and the documents that describe the deployed system, in every mode', () => {
    expect(relay.facts.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'])
    for (const f of relay.facts.filter((x) => !DOCUMENT_FACTS.has(x.id))) expect(f.onlyModes, f.id).toEqual(['bar', 'quick'])
    for (const id of DOCUMENT_FACTS) expect(relay.facts.find((x) => x.id === id)!.onlyModes, id).toBeUndefined()
    expect(relay.reply.split('\n').filter((l) => l === '{facts}')).toHaveLength(1)
  })

  it('names a document only when the relay\'s claims table shows its marker row, for a document of the fixture', () => {
    // The protocol's own marker row for a document's claims; each document fact asks for exactly one, by its path.
    const protocol = fs.readFileSync(path.join(PACKAGE, 'workflow/shared/enrichment-protocol.md'), 'utf8')
    expect(protocol).toContain('`| Document: <path> | | | | |`')
    for (const id of DOCUMENT_FACTS) {
      const f = relay.facts.find((x) => x.id === id)!
      expect(f.ifTableContainsAny, id).toHaveLength(1)
      const m = /^\| document: (.+)$/.exec(f.ifTableContainsAny[0]!)
      expect(m, id).not.toBeNull()
      const file = fs.readdirSync(SOURCE, { recursive: true }).map(String).find((p) => p.toLowerCase() === m![1])
      expect(file, `${id}: ${m![1]} is a file of the fixture`).toBeDefined()
      expect(f.text.toLowerCase(), id).toContain(m![1])
    }
  })

  it('are asked for by the relay\'s own table headers or field names, and the secret store by the names the key leaves out', () => {
    // The relay's table headers as the workflow lays them out, and every field the key settles.
    const tables = fs.readFileSync(path.join(PACKAGE, 'workflow/shared/enrichment-tables.md'), 'utf8')
    const headers = [...tables.matchAll(/`(\|[^`]+\|)`/g)].map((m) => m[1]!.toLowerCase())
    expect(headers.length).toBeGreaterThanOrEqual(4)
    const fields = Object.values(key.fields).flatMap((group) => Object.values(group).flatMap((f) => Object.keys(f)))
    for (const f of relay.facts.filter((x) => x.id !== 'F5' && !DOCUMENT_FACTS.has(x.id))) {
      for (const t of f.ifTableContainsAny) expect(headers.some((h) => h.includes(t)) || fields.some((k) => k.includes(t)), `${f.id}: ${t}`).toBe(true)
    }
    const aliases = (key.out_of_model ?? []).flatMap((e) => e.aliases)
    for (const t of relay.facts.find((x) => x.id === 'F5')!.ifTableContainsAny) expect(aliases, t).toContain(t)
  })

  it('requires the loop-back only of a loopback run', () => {
    const shown: ShownPrompt[] = []
    const notShown = (mode: 'bar' | 'loopback') => h7({ sheet, shown, replies: [], pairs: [], mode }).findings.filter((f) => f.refs?.[0] === 'gate3-loopback').map((f) => f.code)
    expect(notShown('loopback')).toEqual(['prompt_not_shown'])
    expect(notShown('bar')).toEqual([])
  })
})
