import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { canonicalJson, canonicalJsonOmit } from '../canonical-json.js'
import { MAC_TAGS, macHex, subkey, verifyMacHex } from '../gates.js'

// The forms the shared functions replaced, verbatim: stored hashes were computed with them.
function nullForm(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(nullForm).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${nullForm((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}
function omitForm(value: unknown): string {
  const sortKeys = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sortKeys)
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(x).sort()) {
        const v = (x as Record<string, unknown>)[key]
        if (v !== undefined) out[key] = sortKeys(v)
      }
      return out
    }
    return x
  }
  return JSON.stringify(sortKeys(value))
}

const CORPUS: unknown[] = [
  null, undefined, true, false, 0, -1.5, Number.NaN, 'text', '', 'ünïcödé',
  [], [undefined, null, 1], [[{ b: 1, a: 2 }]],
  {}, { b: 1, a: undefined, c: null }, { z: { y: [3, { x: undefined }] } },
  JSON.parse('{"__proto__": {"polluted": true}, "a": 1}'),
  { nested: { deep: { list: ['b', 'a'], flag: false } } },
]

describe('canonical JSON', () => {
  it('prints what each replaced copy printed, for every value in the corpus', () => {
    for (const v of CORPUS) {
      expect(canonicalJson(v), JSON.stringify(v) ?? 'undefined').toBe(nullForm(v))
      expect(canonicalJsonOmit(v), JSON.stringify(v) ?? 'undefined').toBe(omitForm(v))
    }
  })
})

describe('keyed MACs', () => {
  const key = Buffer.alloc(32, 7)

  it('derives the same subkeys and MACs as the code they replaced', () => {
    expect(subkey(key, MAC_TAGS.journal).equals(createHmac('sha256', key).update('dethereal-journal-v1').digest())).toBe(true)
    expect(subkey(key, MAC_TAGS.platformBaseline).equals(createHmac('sha256', key).update('dethereal-platform-baseline-v1').digest())).toBe(true)
    expect(macHex(key, 'payload')).toBe(createHmac('sha256', key).update('payload').digest('hex'))
  })

  it('keeps every purpose apart: distinct tags, none of them JSON', () => {
    const tags = Object.values(MAC_TAGS)
    expect(new Set(tags).size).toBe(tags.length)
    for (const t of tags) expect(t.startsWith('{'), t).toBe(false)
  })

  it('verifies only a well-formed, matching MAC, and never throws', () => {
    const mac = macHex(key, 'payload')
    expect(verifyMacHex(key, 'payload', mac)).toBe(true)
    expect(verifyMacHex(key, 'other', mac)).toBe(false)
    for (const bad of [mac.slice(2), `${mac}00`, mac.toUpperCase(), `zz${mac.slice(2)}`, '', 42, null, undefined]) {
      expect(verifyMacHex(key, 'payload', bad), String(bad)).toBe(false)
    }
  })
})
