/**
 * A regular expression's `test` in time linear in the text: the same answer as JavaScript's own engine on every
 * pattern of the part of the syntax it reads, and a refusal of the rest.
 */
import { describe, expect, it } from 'vitest'
import { linearPattern } from '../linear-pattern.js'
import { seeded, timed } from '../../test-setup/crafted-input.js'

describe('a linear pattern', () => {
  it('answers as the regular expression does, on random patterns and texts, with and without the i flag', () => {
    const random = seeded(12345)
    const tokens = ['a', 'b', 'A', '/', '.', '[^/]', '[^/]*', '[ab]', '[^a]', '[]', '[^]', '[a-c]', '\\.', '\\[', '\\\\', '\\s', '\\S', '\\d', '\\w',
      '\\b', '\\B', '(?:', '(', ')', '|', '*', '+', '?', '*?', '^', '$', '(?:[^/]+/)*', '.*', 'k', 'K', '\u212a', '\u017f', 's', ' ']
    // The Kelvin sign and the long s fold to ASCII letters only under the u flag, which this never takes.
    const chars = ['a', 'b', 'A', 'B', '/', '.', '[', '\\', ' ', '\n', '\r', '\u2028', 'k', 'K', '\u212a', 's', 'S', '\u017f', '1', '_', '-', 'c']
    let compared = 0
    let matched = 0
    const differs: string[] = []
    for (let r = 0; r < 30_000; r++) {
      let source = ''
      for (let k = 1 + random.int(8); k > 0; k--) source += random.pick(tokens)
      const flags = r % 2 ? 'i' : ''
      let expected: RegExp
      try {
        expected = new RegExp(source, flags)
      } catch {
        expect(() => linearPattern(source, flags), source).toThrow()
        continue
      }
      const pattern = linearPattern(source, flags)
      for (let q = 0; q < 12; q++) {
        let text = ''
        for (let k = random.int(7); k > 0; k--) text += random.pick(chars)
        compared++
        if (expected.test(text)) matched++
        if (expected.test(text) !== pattern.test(text)) differs.push(`/${source}/${flags} ${JSON.stringify(text)}`)
      }
    }
    expect(differs).toEqual([])
    expect(compared).toBeGreaterThan(150_000)
    expect(matched).toBeGreaterThan(30_000)
  })

  it('refuses what it does not read rather than read it wrongly', () => {
    for (const source of ['a{2}', '(?=a)', '(?!a)', '(?<n>a)', '\\1', '\\x41', '\\u0041', '\\cA', '\\p{L}']) expect(() => linearPattern(source), source).toThrow()
    expect(() => linearPattern('a', 'g')).toThrow()
    expect(() => linearPattern('(')).toThrow()
    expect(() => linearPattern('*')).toThrow()
  })

  it('takes time linear in the text, where backtracking takes far longer', () => {
    const stars = linearPattern(`^${'[^/]*'.repeat(30)}Q$`)
    expect(timed(() => stars.test('x'.repeat(10_000)))).toBeLessThan(500)
    const runs = linearPattern(`^${'[^/]*e'.repeat(12)}[^/]*Q$`)
    expect(timed(() => runs.test('e'.repeat(255)))).toBeLessThan(50)
    const many = linearPattern(`^${'[^/]*'.repeat(20_000)}Q$`)
    expect(timed(() => many.test('x'.repeat(100)))).toBeLessThan(500)
    expect(many.test(`${'x'.repeat(99)}Q`)).toBe(true)
  })

  it('calls `every` as it works, and stops when it throws', () => {
    const p = linearPattern(`^${'[^/]*'.repeat(2_000)}Q$`)
    let calls = 0
    expect(p.test('x'.repeat(1_000), () => calls++)).toBe(false)
    expect(calls).toBeGreaterThan(10)
    expect(() => p.test('x'.repeat(1_000), () => {
      throw new Error('out of time')
    })).toThrow('out of time')
  })

  it('gives each call its own answer: what one call reached does not carry into the next', () => {
    const p = linearPattern('^ab$')
    expect([p.test('ab'), p.test('a'), p.test('ab'), p.test('b'), p.test('')]).toEqual([true, false, true, false, false])
  })
})
