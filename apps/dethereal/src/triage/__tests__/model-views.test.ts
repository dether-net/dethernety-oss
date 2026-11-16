/**
 * The list_model views over a model the size of a real one: the partition's counts, the triage set's groups and
 * their parts, the rows selections, the caps on every returned string, the page budget, and the listing check.
 * Every expected number is counted here from the raw model, not through the fold.
 */
import { describe, it, expect } from 'vitest'
import { foldModel, type ExposureState } from '../exposures.js'
import {
  cap,
  GROUP_PART_CHARS,
  GROUP_PART_MAX,
  groupTriageSet,
  LIST_MODEL_PAGE_CHARS,
  listingOf,
  pageOf,
  partitionView,
  rowOf,
  selectRows,
  triageRows,
} from '../model-views.js'
import { exposureOf, largeModel, type RawExposure } from './model-fixture.js'
import { registerSecret } from '../../auth/redact.js'

type RawModel = Parameters<typeof foldModel>[0]

const fixture = largeModel()
const folded = foldModel(fixture.model as RawModel)

/** The lifecycle of a raw exposure, written out here rather than taken from the fold. */
const lifecycle = (e: RawExposure) =>
  e.dispositionKind === 'AFFIRMED' ? (e.dispositionedBy ? 'confirmed' : 'pending') : e.dispositionKind != null ? 'disposed' : e.createdBy === 'USER' ? 'confirmed' : 'pending'
const raw = fixture.exposures
const triageRaw = raw.filter((e) => lifecycle(e) === 'pending' && e.createdBy !== 'USER')

/** Walk every page of a view from offset 0, as a caller does. */
function walk<T>(items: T[], shape: Parameters<typeof pageOf<T>>[2]) {
  const pages: Array<Record<string, any>> = []
  let offset = 0
  for (;;) {
    const page = pageOf(items, offset, shape) as Record<string, any>
    pages.push(page)
    if (!page.truncated) return pages
    offset = page.next_offset
  }
}
const groupsShape = (listing: string) => (page: unknown[], next: number | undefined, returned: number) => ({
  model_id: 'model-large', view: 'groups', groups: page, rows_total: 0, parts_total: 0, parts_left_over: 0,
  returned, offset: 0, truncated: next !== undefined, ...(next !== undefined ? { next_offset: next } : {}), listing,
})

describe('the partition view', () => {
  const view = partitionView(folded)

  it('counts the model independently of the rows, and returns no rows', () => {
    expect(view).not.toHaveProperty('rows')
    expect(view).not.toHaveProperty('groups')
    expect(view.exposures).toBe(387)
    expect(view.totals).toEqual({
      pending: raw.filter((e) => lifecycle(e) === 'pending').length,
      confirmed: raw.filter((e) => lifecycle(e) === 'confirmed').length,
      disposed: raw.filter((e) => lifecycle(e) === 'disposed').length,
      stale: raw.filter((e) => e.dispositionStale === true).length,
      user: raw.filter((e) => e.createdBy === 'USER').length,
      system: raw.filter((e) => e.createdBy !== 'USER').length,
    })
    expect(view.triage).toBe(triageRaw.length)
    expect(view.user_pending).toBe(raw.filter((e) => lifecycle(e) === 'pending' && e.createdBy === 'USER').length)
    expect(view.user_pending).toBeGreaterThan(0)
    expect(view.totals.stale).toBeGreaterThan(0)
  })

  it('adds up', () => {
    const t = view.totals
    expect(t.pending + t.confirmed + t.disposed).toBe(view.exposures)
    expect(t.user + t.system).toBe(view.exposures)
    expect(view.triage + view.user_pending).toBe(t.pending)
  })

  it('names the elements without exposures up to ten, and only counts them past ten', () => {
    expect(view.elements).toBe(55)
    expect(view.without_exposures).toEqual({ count: 2, elements: [{ id: 'c-quiet-1', name: 'Idle worker', kind: 'component' }, { id: 'c-quiet-2', name: 'Batch job', kind: 'component' }] })
    const quiet = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q-${i}`, name: `quiet ${i}`, componentClass: [], exposures: [] }))
    const at = (n: number) => partitionView(foldModel({ id: 'm', name: 'M', defaultBoundary: [{ id: 'b', name: 'B', securityBoundaryClass: [], exposures: [exposureOf('e')], allDescendantComponents: quiet(n) }] } as RawModel)).without_exposures
    expect(at(10).elements).toHaveLength(10)
    expect(at(11)).toEqual({ count: 11 })
  })

  it('gives one element its own counts', () => {
    const view = partitionView(folded, 'c-03')
    const mine = raw.filter((e) => fixture.model.defaultBoundary[0]!.allDescendantComponents.find((c) => c.id === 'c-03')!.exposures.includes(e))
    expect(view.element).toMatchObject({ id: 'c-03', kind: 'component', exposures: mine.length, triage: mine.filter((e) => lifecycle(e) === 'pending' && e.createdBy !== 'USER').length })
    expect(view.exposures).toBe(387)
    expect(partitionView(folded, 'c-quiet-1').element).toMatchObject({ exposures: 0, triage: 0, user_pending: 0 })
  })
})

describe('the groups view', () => {
  const parts = groupTriageSet(folded.rows)

  it('groups exactly the triage set by (name, type, category, definition)', () => {
    const members = parts.flatMap((p) => p.members.map((m) => m.exposure_id))
    expect(new Set(members).size).toBe(members.length)
    expect(members.sort()).toEqual(triageRaw.map((e) => e.id).sort())
    // An independent group-by of the raw exposures: by name, type, category and description plus technique ids.
    const key = (e: RawExposure) => JSON.stringify([e.name, e.type, e.category, e.description, [...e.exploitedBy.map((t) => t.attack_id), ...e.exploitedByAtlas.map((t) => t.atlas_id)].sort()])
    const expected = new Map<string, string[]>()
    for (const e of triageRaw) expected.set(key(e), [...(expected.get(key(e)) ?? []), e.id])
    const byGroup = new Map<string, string[]>()
    for (const p of parts) {
      const k = p.group.split('#')[0]!
      byGroup.set(k, [...(byGroup.get(k) ?? []), ...p.members.map((m) => m.exposure_id)])
    }
    expect([...byGroup.values()].map((ids) => ids.sort().join()).sort()).toEqual([...expected.values()].map((ids) => ids.sort().join()).sort())
  })

  it('keeps two definitions with one display name apart', () => {
    const named = parts.filter((p) => p.name === 'Default credentials')
    expect(new Set(named.map((p) => p.def_hash)).size).toBe(2)
    expect(new Set(named.map((p) => p.group)).size).toBe(2)
  })

  it('leaves out USER-created and non-pending rows', () => {
    const byId = new Map(raw.map((e) => [e.id, e]))
    for (const m of parts.flatMap((p) => p.members)) {
      const e = byId.get(m.exposure_id)!
      expect(e.createdBy).not.toBe('USER')
      expect(lifecycle(e)).toBe('pending')
    }
  })

  it('splits the 170-member group into parts of 80, 80 and 10, each with the group size', () => {
    const big = parts.filter((p) => p.name === 'Unencrypted transport')
    expect(big.map((p) => [p.group.replace(/^g\d+/, 'g'), p.members.length, p.size])).toEqual([['g#1', 80, 170], ['g#2', 80, 170], ['g#3', 10, 170]])
    for (const p of parts) expect(p.members.length).toBeLessThanOrEqual(GROUP_PART_MAX)
  })

  it('numbers the groups in tuple order and orders members by element, then exposure', () => {
    const ids = [...new Set(parts.map((p) => p.group.split('#')[0]))]
    expect(ids).toEqual(ids.map((_, i) => `g${i + 1}`))
    for (const p of parts) {
      const keys = p.members.map((m) => `${m.element_id}\u0000${m.exposure_id}`)
      expect(keys).toEqual([...keys].sort())
    }
  })

  it('carries what the proposals table needs on each member, with the reference count', () => {
    const member = parts.flatMap((p) => p.members).find((m) => m.unresolved_references_count > 0)
    expect(member?.unresolved_references_count).toBe(40)
    expect(Object.keys(member!).sort()).toEqual(['attack_vector', 'element_class_id', 'element_id', 'element_kind', 'element_name', 'exposure_id', 'score', 'unresolved_references_count'])
  })

  it('returns a class id whole, as the tools it is passed back to take it', () => {
    const uuid = '0f0e0d0c-0b0a-4908-8706-050403020100'
    const row = { ...triageRows(folded.rows)[0]!, element_class: { id: uuid, name: 'Service' } }
    expect(groupTriageSet([row])[0]!.members[0]!.element_class_id).toBe(uuid)
    expect((rowOf(row).element_class as { id: string }).id).toBe(uuid)
  })

  it('keeps a null and an empty type apart', () => {
    const base = triageRows(folded.rows)[0]!
    const parts = groupTriageSet([{ ...base, exposure_id: 'n1', type: null }, { ...base, exposure_id: 'n2', type: '' }])
    expect(parts).toHaveLength(2)
  })

  it('narrows to one element', () => {
    const one = groupTriageSet(folded.rows, 'f-02')
    expect(one.flatMap((p) => p.members.map((m) => m.element_id))).toEqual(expect.arrayContaining(['f-02']))
    expect(new Set(one.flatMap((p) => p.members.map((m) => m.element_id)))).toEqual(new Set(['f-02']))
  })

  it('fills a part by its budget before 80 members when every field is at its cap', () => {
    const long = 'n'.repeat(500)
    const rows: ExposureState[] = Array.from({ length: 90 }, (_, i) => ({
      ...folded.rows[0]!, exposure_id: `x-${String(i).padStart(3, '0')}`, element_id: `el-${String(i).padStart(3, '0')}`,
      name: long, type: long, category: long, attack_vector: long, element_name: long, lifecycle: 'pending', created_by: 'SYSTEM',
      element_class: { id: 'k'.repeat(200), name: long }, attack_ids: Array.from({ length: 80 }, (_, j) => `T${j}${'9'.repeat(100)}`), atlas_ids: [], def_hash: 'h',
    }))
    const capped = groupTriageSet(rows)
    expect(capped.length).toBeGreaterThan(1)
    expect(capped[0]!.members.length).toBeLessThan(GROUP_PART_MAX)
    for (const p of capped) expect(JSON.stringify(p).length).toBeLessThanOrEqual(GROUP_PART_CHARS)
    expect(capped[0]).toMatchObject({ attack_ids_count: 80 })
    expect(capped[0]!.attack_ids).toHaveLength(50)
    expect(capped[0]!.name).toHaveLength(200)
    expect(capped[0]!.members[0]!.element_name).toHaveLength(64)
    const pages = walk(capped, groupsShape('0'.repeat(16)))
    for (const page of pages) expect(JSON.stringify(page).length).toBeLessThanOrEqual(LIST_MODEL_PAGE_CHARS)
  })

  it('pages whole parts under the budget, every triage row reached once', () => {
    const pages = walk(parts, groupsShape(listingOf(triageRows(folded.rows))))
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(LIST_MODEL_PAGE_CHARS)
      expect(page.returned).toBe(page.groups.length)
      expect(page.groups.length).toBeGreaterThan(0)
    }
    const seen = pages.flatMap((p) => p.groups.flatMap((g: any) => g.members.map((m: any) => m.exposure_id)))
    expect(seen.sort()).toEqual(triageRaw.map((e) => e.id).sort())
  })
})

describe('the rows view', () => {
  it('selects stale, USER-created or all rows, as a direct filter does', () => {
    const ids = (rows: ExposureState[]) => rows.map((r) => r.exposure_id).sort()
    expect(ids(selectRows(folded.rows, 'stale'))).toEqual(raw.filter((e) => e.dispositionStale === true).map((e) => e.id).sort())
    expect(ids(selectRows(folded.rows, 'user'))).toEqual(raw.filter((e) => e.createdBy === 'USER').map((e) => e.id).sort())
    expect(ids(selectRows(folded.rows, 'all'))).toEqual(raw.map((e) => e.id).sort())
    expect(new Set(selectRows(folded.rows, 'all', 'di-1').map((r) => r.element_id))).toEqual(new Set(['di-1']))
  })

  it('caps every field of a row, keeping the counts of what it cut, and leaves out the full reason', () => {
    const row = rowOf(folded.rows.find((r) => r.unresolved_references?.length === 40)!)
    expect(row.unresolved_references_count).toBe(40)
    expect(row.unresolved_references).toHaveLength(5)
    for (const ref of row.unresolved_references as string[]) expect(ref).toHaveLength(200)
    expect(row).not.toHaveProperty('full_reason')
    const long = 'z'.repeat(1000)
    const worst = rowOf({
      ...folded.rows[0]!, name: long, type: long, category: long, attack_vector: long, created_by: long, authored_by: long,
      disposition_kind: long, disposition_reason: long, dispositioned_by: long, dispositioned_at: long, element_name: long,
      element_class: { id: long, name: long }, attack_ids: Array.from({ length: 70 }, () => long), atlas_ids: Array.from({ length: 70 }, () => long),
      unresolved_references: Array.from({ length: 40 }, () => long),
    })
    expect(worst).toMatchObject({ attack_ids_count: 70, atlas_ids_count: 70, unresolved_references_count: 40 })
    expect((worst.attack_ids as string[]).length).toBe(50)
    expect(JSON.stringify(worst).length).toBeLessThan(8_000)
  })

  it('pages under the budget and reaches every row once; an offset past the end gives an empty page with its total', () => {
    const rows = selectRows(folded.rows, 'all').map(rowOf)
    const shape = (page: unknown[], next: number | undefined, returned: number) => ({
      model_id: 'model-large', view: 'rows', select: 'all', rows: page, total: rows.length, returned, offset: 0,
      truncated: next !== undefined, ...(next !== undefined ? { next_offset: next } : {}), listing: '0'.repeat(16),
    })
    const pages = walk(rows, shape)
    expect(pages.length).toBeGreaterThan(5)
    for (const page of pages) expect(JSON.stringify(page).length).toBeLessThanOrEqual(LIST_MODEL_PAGE_CHARS)
    const seen = pages.flatMap((p) => p.rows.map((r: any) => r.exposure_id))
    expect(seen).toEqual(rows.map((r) => r.exposure_id))
    expect(pageOf(rows, 10_000, shape)).toMatchObject({ rows: [], total: 387, returned: 0, truncated: false })
  })

  it('returns one item even when it alone is over the budget', () => {
    const big = { text: 'x'.repeat(LIST_MODEL_PAGE_CHARS) }
    const page = pageOf([big, big], 0, (page, next, returned) => ({ rows: page, returned, ...(next !== undefined ? { next_offset: next } : {}) })) as any
    expect(page.rows).toHaveLength(1)
    expect(page.next_offset).toBe(1)
  })
})

describe('the listing check', () => {
  it('is stable on an unchanged model, and changes on a rename that keeps the order', () => {
    const rows = selectRows(folded.rows, 'all')
    expect(listingOf(rows)).toMatch(/^[0-9a-f]{16}$/)
    expect(listingOf(selectRows(foldModel(largeModel().model as RawModel).rows, 'all'))).toBe(listingOf(rows))
    const renamed = rows.map((r, i) => (i === 3 ? { ...r, name: `${r.name} ` } : r))
    expect(listingOf(renamed)).not.toBe(listingOf(rows))
    const elementRenamed = rows.map((r, i) => (i === 3 ? { ...r, element_name: 'other' } : r))
    expect(listingOf(elementRenamed)).not.toBe(listingOf(rows))
    const decided = rows.map((r, i) => (i === 3 ? { ...r, lifecycle: 'confirmed' as const } : r))
    expect(listingOf(decided)).not.toBe(listingOf(rows))
  })

  it('changes on any member field that moves where a group’s parts split', () => {
    const rows = triageRows(folded.rows)
    const changes: Array<Partial<ExposureState>> = [
      { attack_vector: 'LOCAL' }, { element_class: null }, { element_kind: 'dataItem' }, { unresolved_references: ['x'] }, { score: 9.9 },
    ]
    for (const change of changes) expect(listingOf(rows.map((r, i) => (i === 3 ? { ...r, ...change } : r)))).not.toBe(listingOf(rows))
  })
})

describe('cap', () => {
  it('cuts to n characters as sent, never inside a surrogate pair', () => {
    expect(cap('abc', 5)).toBe('abc')
    expect(cap('abcdef', 3)).toBe('abc')
    expect(cap('ab😀', 3)).toBe('ab')
    expect(cap('ab😀c', 4)).toBe('ab😀')
    expect(cap(null, 3)).toBeNull()
    expect(cap('a"b', 3)).toBe('a"')
    const controls = '\u0001'.repeat(200)
    expect(JSON.stringify(cap(controls, 200)).length - 2).toBeLessThanOrEqual(200)
    expect(cap(controls, 200)).toHaveLength(33)
  })

  it('redacts a session secret before the cut, so no piece of it is left', () => {
    const secret = 'tok_' + 'q'.repeat(60)
    registerSecret(secret)
    const cut = cap('x'.repeat(180) + secret, 200)
    expect(cut).not.toContain('qqqq')
    expect(cut).toContain('[redacted]')
  })

  it('keeps a row at every cap, in escaped characters, well inside a page', () => {
    const worst = '\u0001'.repeat(1000)
    const row = rowOf({
      ...folded.rows[0]!, name: worst, type: worst, category: worst, attack_vector: worst, created_by: worst, authored_by: worst,
      disposition_kind: worst, disposition_reason: worst, dispositioned_by: worst, dispositioned_at: worst, element_name: worst,
      element_class: { id: worst, name: worst }, attack_ids: Array.from({ length: 70 }, () => worst), atlas_ids: Array.from({ length: 70 }, () => worst),
      unresolved_references: Array.from({ length: 40 }, () => worst),
    })
    expect(JSON.stringify(row).length).toBeLessThan(LIST_MODEL_PAGE_CHARS / 2)
  })
})
