import { describe, expect, it } from 'vitest'
import { extractRules, ruleHash } from '../rules.js'

const units = (text: string) => extractRules(text).map((r) => [r.line, r.kind, r.text])

describe('rule extraction', () => {
  it('splits a document into items, rows, code blocks and sentences', () => {
    const text = [
      '---',
      'name: x',
      'description: frontmatter is not a rule',
      '---',
      '# Heading',
      '',
      'First sentence here. Second one follows! A third?',
      '',
      '- An item',
      '  continued on an indented line',
      '- Another item',
      'lazily continued',
      '',
      '1. Numbered step',
      '',
      '| Col A | Col B |',
      '|-------|-------|',
      '| row one | value |',
      '| row two | value |',
      '',
      '```json',
      '{ "a": 1 }',
      '```',
      '',
      '> Quoted advice. With two sentences.',
      '',
      '---',
      '<!-- a comment',
      'spanning lines -->',
      '***',
    ].join('\n')
    expect(units(text)).toEqual([
      [7, 'sentence', 'First sentence here.'],
      [7, 'sentence', 'Second one follows!'],
      [7, 'sentence', 'A third?'],
      [9, 'item', 'An item continued on an indented line'],
      [11, 'item', 'Another item lazily continued'],
      [14, 'item', 'Numbered step'],
      [18, 'row', '| row one | value |'],
      [19, 'row', '| row two | value |'],
      [21, 'code', '{ "a": 1 }'],
      [25, 'sentence', 'Quoted advice.'],
      [25, 'sentence', 'With two sentences.'],
    ])
  })

  it('keeps nested items apart and leaves units without letters out', () => {
    expect(units('- outer\n  - inner\n- 42\n')).toEqual([
      [1, 'item', 'outer'],
      [2, 'item', 'inner'],
    ])
  })

  it('does not split on abbreviations followed by lowercase, or inside code spans', () => {
    expect(units('Use e.g. the schema. Call `a. B` then.').map((u) => u[2])).toEqual(['Use e.g. the schema.', 'Call `a. B` then.'])
  })

  it('treats an unterminated fence as one code unit', () => {
    expect(units('```\nline one\nline two')).toEqual([[1, 'code', 'line one\nline two']])
  })

  it('derives ids from the text, stable under reordering and whitespace, with suffixes for repeats', () => {
    const a = extractRules('- Validate after every write\n- Never guess\n- Validate after every write\n')
    expect(a.map((r) => r.id)).toEqual([ruleHash('Validate after every write'), ruleHash('Never guess'), `${ruleHash('Validate after every write')}-2`])
    const b = extractRules('- Never guess\n- Validate   after every\n  write\n')
    expect(b.map((r) => r.id)).toEqual([ruleHash('Never guess'), ruleHash('Validate after every write')])
    expect(ruleHash('Validate after every write')).toMatch(/^[0-9a-f]{10}$/)
  })

  it('reads CRLF text the same as LF', () => {
    const lf = 'Para one. Para two.\n\n- item\n'
    expect(extractRules(lf.replace(/\n/g, '\r\n'))).toEqual(extractRules(lf))
  })
})
