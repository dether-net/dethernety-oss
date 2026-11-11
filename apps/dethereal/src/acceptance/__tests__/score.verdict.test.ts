import { describe, it, expect } from 'vitest'
import { adjudicate, departsFromSheet, findingItem } from '../score/verdict.js'
import { parseAnswerSheet } from '../answer-sheet.js'
import type { ShownPrompt } from '../score/prompts.js'
import type { GateOutcome } from '../score/outcome.js'

describe('adjudications', () => {
  it('settle only the finding they name: the same refs at another event stay open', () => {
    const gates: GateOutcome[] = [{
      gate: 'H4', verdict: 'needs-review', findings: [
        { verdict: 'needs-review', code: 'unparseable_table', detail: 'x', refs: ['b-data'], events: [12] },
        { verdict: 'needs-review', code: 'unparseable_table', detail: 'y', refs: ['b-data'], events: [40] },
      ],
    }]
    const item = findingItem('H4', gates[0]!.findings[0]!)
    expect(item).toBe('H4/unparseable_table/{"refs":["b-data"],"events":[12]}')
    const { gates: out, settled } = adjudicate(gates, [{ item, adjudicator: 'operator', verdict: 'pass', reason: 'ratified in the reply' } as never])
    expect(settled).toEqual([{ item, verdict: 'pass' }])
    expect(out[0]!.findings.map((f) => f.events)).toEqual([[40]])
    expect(out[0]!.verdict).toBe('needs-review')
  })

  it('keeps refs holding separators apart', () => {
    const a = findingItem('H3', { verdict: 'needs-review', code: 'c', detail: '', refs: ['a,b'] })
    const b = findingItem('H3', { verdict: 'needs-review', code: 'c', detail: '', refs: ['a', 'b'] })
    expect(a).not.toBe(b)
  })
})

describe('replies against the sheet', () => {
  const sheetOf = (entry: string) => parseAnswerSheet(`version: 1\nprompts:\n  - id: loop\n    trigger: "x"\n    mandatory: true\n    required: if_shown\n${entry}`)
  const LOOP = [
    '    how: option-or-typed', '    reply: "Fix what the source supports, then check again."', '    picks: ["loop back"]',
    '    variants:', '      - from_showing: 3', '        reply: "skip to sync anyway"', '        picks: ["skip to sync anyway"]',
  ].join('\n')
  const showing = (event: number): ShownPrompt => ({ id: 'loop', event, complete: true, missing: [], answeredBy: event + 1, segment: 0 })
  const shown = [showing(10), showing(20), showing(30)]

  it('accepts the reply, a listed pick in any case or punctuation, and a variant only from its showing', () => {
    const sheet = sheetOf(LOOP)
    const departs = (text: string, asked?: ShownPrompt) => departsFromSheet(sheet, { prompt: 'loop', text }, asked, shown, 'loopback')
    expect(departs('Fix what the source supports, then check again.', shown[0])).toBe(false)
    expect(departs('Loop back.', shown[1])).toBe(false)
    expect(departs('skip to sync anyway', shown[0])).toBe(true)
    expect(departs('skip to sync anyway', shown[2])).toBe(false)
    // From the third answered showing the sheet's answer is the variant's alone.
    expect(departs('Loop back', shown[2])).toBe(true)
    // A showing nobody answered (a message and a dialog in one turn) does not count toward the third.
    const unanswered: ShownPrompt = { id: 'loop', event: 15, complete: true, missing: [], segment: 0 }
    expect(departsFromSheet(sheet, { prompt: 'loop', text: 'skip to sync anyway' }, shown[1], [shown[0]!, unanswered, shown[1]!, shown[2]!], 'loopback')).toBe(true)
    expect(departs('skip to sync anyway')).toBe(true)
    expect(departs('waive', shown[2])).toBe(true)
    expect(departsFromSheet(sheet, { prompt: 'off-sheet', text: 'anything' }, shown[0], shown, 'loopback')).toBe(false)
  })

  it('refuses picks where a pick cannot carry the reply, and a variant without exactly one condition', () => {
    const bad = [
      '    how: typed\n    reply: "x"\n    picks: ["a"]',
      '    how: option-or-typed\n    reply: "x"\n    ratifies: all\n    picks: ["a"]',
      '    how: option-or-typed\n    reply: "x"\n    variants:\n      - from_showing: 1\n        reply: "y"',
      '    how: option-or-typed\n    reply: "x"\n    variants:\n      - if_table_contains_any: ["t"]\n        reply: "y"\n        picks: ["y"]',
      '    how: option-or-typed\n    reply: "x"\n    picks: []',
    ]
    for (const entry of bad) expect(() => sheetOf(entry), entry).toThrow()
    expect(sheetOf(LOOP).prompts[0]!.variants[0]).toEqual({ fromShowing: 3, reply: 'skip to sync anyway', picks: ['skip to sync anyway'] })
  })
})

describe('items not on the fixture', () => {
  it('leaves an n/a item out of the verdict: it neither passes nor fails a run', async () => {
    const { verdict } = await import('../score/verdict.js')
    const { binary, notOnFixture } = await import('../score/rubric.js')
    const input = (rubric: ReturnType<typeof binary>[]) => ({
      gates: [{ gate: 'H1', verdict: 'PASS', findings: [] }] as unknown as GateOutcome[], rubric, adjudications: [], shown: [], registry: new Map(), mode: 'loopback' as const, replies: [], pairs: [],
      clean: true, hashes: { bundle: 'b', dist: 'd', rcBundle: 'b', rcDist: 'd' },
    })
    const na = notOnFixture('credentials.shared', 'credential shared between flows')
    expect(na).toMatchObject({ kind: 'n/a', pass: false })
    expect(verdict(input([binary('a', true, ''), na])).verdict).toBe('PASS')
    expect(verdict(input([binary('a', false, ''), na])).verdict).toBe('FAIL')
  })

  it('reports an informational item without letting it fail a run', async () => {
    const { verdict } = await import('../score/verdict.js')
    const { binary } = await import('../score/rubric.js')
    const input = (rubric: ReturnType<typeof binary>[]) => ({
      gates: [{ gate: 'H1', verdict: 'PASS', findings: [] }] as unknown as GateOutcome[], rubric, adjudications: [], shown: [], registry: new Map(), mode: 'loopback' as const, replies: [], pairs: [],
      clean: true, hashes: { bundle: 'b', dist: 'd', rcBundle: 'b', rcDist: 'd' },
    })
    const info = { ...binary('data_items.credential_flags', false, ''), informational: true as const }
    expect(verdict(input([binary('a', true, ''), info])).verdict).toBe('PASS')
    expect(verdict(input([binary('a', false, ''), info])).verdict).toBe('FAIL')
  })
})
