/**
 * The loop-back record, read against a gates view: what each armed element became, and what the report says.
 */
import { describe, it, expect } from 'vitest'
import type { LoopbackKind, LoopbackView } from '../gates.js'
import { armedRecord, evaluate, parseRecord, reasonProblem, roundOf, tally, untouchedMessage, type LoopBackRecord } from '../loop-back.js'

const H = (c: string) => c.repeat(64)

/** A view over plain maps: what is listed now, what exists, what is waived, and each field's hash and stand-in flag. */
function view(state: {
  listed: Array<{ id: string; kind?: LoopbackKind; criteria?: string[]; fields?: string[] }>
  exists?: string[]
  waived?: string[]
  fields?: Record<string, { hash: string | null; standIn?: boolean }>
  links?: Record<string, string | null>
}): LoopbackView {
  const all = new Set([...(state.exists ?? []), ...state.listed.map((e) => e.id)])
  return {
    elements: state.listed.map((e) => ({ element_id: e.id, kind: e.kind ?? 'component', criteria: (e.criteria ?? ['C2']) as never, fields: e.fields ?? ['f'] })),
    exists: (id) => all.has(id),
    waived: (id) => (state.waived ?? []).includes(id),
    field: (_k, id, f) => ({ hash: state.fields?.[`${id}.${f}`]?.hash ?? null, standIn: state.fields?.[`${id}.${f}`]?.standIn ?? false }),
    links: (_k, id) => state.links?.[id] ?? null,
  }
}

const armed = (elements: Array<Partial<LoopBackRecord['elements'][number]> & { element_id: string }>): LoopBackRecord => ({
  version: 1, armed_at: '2026-10-08T00:00:00.000Z',
  elements: elements.map((e) => ({ kind: 'component', criteria: ['C2'], fields: ['f'], values: { f: null }, links: null, ...e } as never)),
})

describe('an armed element, read again', () => {
  it('is untouched, changed, removed, no longer listed, waived or dropped', () => {
    const rec = armed([
      { element_id: 'same', values: { f: H('a') } },
      { element_id: 'real', values: { f: null } },
      { element_id: 'standin', values: { f: null } },
      { element_id: 'emptied', values: { f: H('a') } },
      { element_id: 'gone' },
      { element_id: 'fixed' },
      { element_id: 'waived' },
      { element_id: 'left', dropped: { reason: 'operator: not sure', at: 't' } },
      { element_id: 'links', fields: [], values: {}, links: H('1') },
    ])
    const v = view({
      listed: [{ id: 'same' }, { id: 'real' }, { id: 'standin' }, { id: 'emptied' }, { id: 'left' }, { id: 'links', fields: [] }],
      exists: ['fixed', 'waived'],
      waived: ['waived'],
      fields: { 'same.f': { hash: H('a') }, 'real.f': { hash: H('b') }, 'standin.f': { hash: H('c'), standIn: true }, 'emptied.f': { hash: null } },
      links: { links: H('2') },
    })
    const out = Object.fromEntries(evaluate(rec, v).map((o) => [o.element_id, o.status]))
    expect(out).toEqual({
      same: 'untouched', real: 'changed', standin: 'untouched', emptied: 'untouched',
      gone: 'removed', fixed: 'not_listed', waived: 'waived', left: 'dropped', links: 'changed',
    })
    const counts = tally(evaluate(rec, v))
    expect(counts).toMatchObject({ untouched_total: 3, touched_total: 5, dropped_total: 1 })
    expect(counts.untouched.map((e) => e.element_id)).toEqual(['same', 'standin', 'emptied'])
    expect(roundOf(evaluate(armed([{ element_id: 'left', dropped: { reason: 'r', at: 't' } }]), v)).nothing_changed).toBe(true)
  })

  it('is armed with each listed field\'s hash, or its links when it lists none', () => {
    const v = view({ listed: [{ id: 'a', fields: ['f', 'g'] }, { id: 'b', fields: [] }], fields: { 'a.f': { hash: H('1') } }, links: { b: H('2') } })
    const rec = armedRecord(v, new Date('2026-10-08T00:00:00Z'))
    expect(rec.elements.map((e) => [e.element_id, e.values, e.links])).toEqual([['a', { f: H('1'), g: null }, null], ['b', {}, H('2')]])
    expect(parseRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec)
  })
})

describe('the record file', () => {
  const good = () => JSON.parse(JSON.stringify(armed([{ element_id: 'c-web', values: { f: null } }])))
  it('reads only a record of the shape it writes', () => {
    expect(parseRecord(good())).not.toBeNull()
    const breaks: Array<(r: any) => void> = [
      (r) => { r.version = 2 },
      (r) => { r.elements[0].kind = 'server' },
      (r) => { r.elements[0].criteria = ['C10'] },
      (r) => { r.elements[0].values = { other: null } },
      (r) => { r.elements[0].values.f = 'not-a-hash' },
      (r) => { r.elements[0].links = 7 },
      (r) => { r.elements[0].dropped = { reason: '', at: 't' } },
      (r) => { r.elements = 'x' },
      (r) => { delete r.elements[0].element_id },
    ]
    for (const [i, b] of breaks.entries()) {
      const r = good()
      b(r)
      expect(parseRecord(r), String(i)).toBeNull()
    }
  })
})

describe('what the run says', () => {
  it('names at most 20 elements and counts the rest', () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ element_id: `c-${i}`, kind: 'component' as const, criteria: ['C2' as const], fields: ['f'] }))
    const m = untouchedMessage(many, 23)
    expect(m).toContain('23 loop-back element(s)')
    expect(m).toContain('component c-19 (c-19): C2 — f')
    expect(m).not.toContain('c-20 (c-20)')
    expect(m).toContain('(+3 more).')
  })

  it('takes a reason of visible words, 1–500 characters', () => {
    expect(reasonProblem('The operator does not know.')).toBeNull()
    expect(reasonProblem('line one\nline two')).toBeNull()
    for (const r of ['', '  ', 'x'.repeat(501), `a${String.fromCharCode(0x200b)}b`, String.fromCharCode(0xd800)]) expect(reasonProblem(r)).toBe('reason_invalid')
  })
})
