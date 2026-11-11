/**
 * `beginsWithComma` decides whether the gap between the last property and the closing brace already holds
 * a trailing comma, past whitespace and comments. It reads that gap in one linear pass; the former
 * comment-skip regex could backtrack super-linearly. The recorded table pins the scan to the regex's
 * verdicts on short, well-formed fragments — the only fragments that reach it, since the document has
 * already parsed. A comment-shaped input that the regex choked on returns at once here.
 */
import { describe, expect, it } from 'vitest'
import { beginsWithComma } from '../merge-jsonc.js'
import verdicts from './fixtures/comment-skip-verdicts.json' with { type: 'json' }

describe('beginsWithComma', () => {
  it('reproduces the former regex on every recorded short fragment', () => {
    const differ = (verdicts.cases as Array<[string, boolean]>).filter(([input, want]) => beginsWithComma(input) !== want)
    expect(differ).toEqual([])
  })

  it('reads a comma past whitespace, line comments and block comments', () => {
    expect(beginsWithComma(',')).toBe(true)
    expect(beginsWithComma('  ,')).toBe(true)
    expect(beginsWithComma('\n\t,')).toBe(true)
    expect(beginsWithComma('// c\n,')).toBe(true)
    expect(beginsWithComma('/* c */,')).toBe(true)
    expect(beginsWithComma('/* , */ // keep\n ,')).toBe(true)
  })

  it('finds no comma when the last property is not followed by one', () => {
    expect(beginsWithComma('')).toBe(false)
    expect(beginsWithComma('\n  ')).toBe(false)
    expect(beginsWithComma('// c\n')).toBe(false)
    expect(beginsWithComma('/* c */')).toBe(false)
    expect(beginsWithComma('/* c */ x')).toBe(false)
    // A line comment with no newline cannot end before the brace, so there is no comma after it.
    expect(beginsWithComma('// no newline')).toBe(false)
  })

  it('reads a block comment to its first close, as the parser does', () => {
    // A stray `*/` is a parse error, so `load()` rejects it before this runs; the scan still stops at the
    // first close and keeps linear, where the former regex would absorb the stray closer by backtracking.
    expect(beginsWithComma('/* */*/,')).toBe(false)
  })

  it('returns at once on a comment-shaped fragment that made the former regex backtrack', () => {
    const pathological = '/*' + ' '.repeat(50_000) + '*'.repeat(50_000)
    const start = process.hrtime.bigint()
    expect(beginsWithComma(pathological)).toBe(false)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    expect(ms).toBeLessThan(50)
  })
})
