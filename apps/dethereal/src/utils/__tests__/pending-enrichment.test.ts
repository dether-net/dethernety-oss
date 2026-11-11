/**
 * Pending enrichment: values an enricher wrote into empty fields that the
 * operator has not confirmed yet. Every well-formed entry blocks until the
 * workflow removes it; anything the reader cannot trust blocks as well.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { gateModel, writeGateModel } from './fixtures/gate-model.js'
import {
  computeGates,
  directoryPushRefusal,
  loadGateInput,
  PENDING_ENRICHMENT_FILE,
  PENDING_LIMITS,
  pendingEnrichment,
  readPendingEnrichment,
  reviewContentHash,
} from '../gates.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(process.cwd(), '.test-pending-'))
  await writeGateModel(dir, gateModel())
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const entry = (extra: Record<string, unknown> = {}) => ({
  batch: 'b-1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema',
  source: 'app/server.py:12', previous: 'null', ...extra,
})
const write = (doc: unknown) => fs.writeFile(path.join(dir, PENDING_ENRICHMENT_FILE), typeof doc === 'string' ? doc : JSON.stringify(doc))
const pending = async () => pendingEnrichment(await loadGateInput(dir))

describe('reading the pending file', () => {
  it('reads no file as nothing pending', async () => {
    expect(await readPendingEnrichment(dir)).toMatchObject({ state: 'none', entries: [], invalid: [] })
    expect(await pending()).toMatchObject({ state: 'none', blocks: false, blocking: 0 })
  })

  it('reads an empty entry list as nothing pending', async () => {
    await write({ version: 1, entries: [] })
    expect(await pending()).toMatchObject({ state: 'none', blocks: false })
  })

  it('refuses a file it cannot trust, with a code, and blocks', async () => {
    const cases: Array<[unknown, string]> = [
      ['{"version": 1, "entries": [', 'invalid_json'],
      ['[1, 2]', 'not_object'],
      [{ version: 2, entries: [] }, 'unsupported_version'],
      [{ entries: [] }, 'unsupported_version'],
      [{ version: 1, entries: {} }, 'entries_not_a_list'],
      [{ version: 1, entries: Array.from({ length: PENDING_LIMITS.entries + 1 }, () => entry()) }, 'too_many_entries'],
    ]
    for (const [doc, code] of cases) {
      await write(doc)
      const p = await pending()
      expect(p, code).toMatchObject({ state: 'unreadable', code, blocks: true })
    }
  })

  it('refuses a symlinked, hard-linked or oversized file', async () => {
    const outside = path.join(dir, 'elsewhere.json')
    await fs.writeFile(outside, JSON.stringify({ version: 1, entries: [] }))
    await fs.symlink(outside, path.join(dir, PENDING_ENRICHMENT_FILE))
    expect(await pending()).toMatchObject({ state: 'unreadable', code: 'symlink', blocks: true })
    await fs.rm(path.join(dir, PENDING_ENRICHMENT_FILE))
    await fs.link(outside, path.join(dir, PENDING_ENRICHMENT_FILE))
    expect(await pending()).toMatchObject({ state: 'unreadable', code: 'hardlinked', blocks: true })
    await fs.rm(path.join(dir, PENDING_ENRICHMENT_FILE))
    await write({ version: 1, entries: [entry({ source: 'x'.repeat(10) })], pad: 'y'.repeat(1024 * 1024) })
    expect(await pending()).toMatchObject({ state: 'unreadable', code: 'too_large', blocks: true })
  })
})

describe('what blocks', () => {
  it('blocks on every well-formed entry, whatever the attribute file now holds', async () => {
    await write({ version: 1, entries: [entry(), entry({ element_id: 'c-db', field: 'backups_encrypted', value: true, previous: 'absent' })] })
    const p = await pending()
    expect(p).toMatchObject({ state: 'present', blocks: true, blocking: 2, entries: 2, invalid: 0, unresolved: 0 })
    expect(p.rows).toEqual([
      { row: 1, element_id: 'c-web', name: 'Web frontend', field: 'input_validation' },
      { row: 2, element_id: 'c-db', name: 'Orders database', field: 'backups_encrypted' },
    ])
  })

  it('counts one entry per element and field', async () => {
    await write({ version: 1, entries: [entry(), entry({ value: 'allow_list' }), entry()] })
    expect(await pending()).toMatchObject({ entries: 1, blocking: 1 })
  })

  it('keeps blocking when the element is gone', async () => {
    await write({ version: 1, entries: [entry({ element_id: 'c-gone' })] })
    const p = await pending()
    expect(p).toMatchObject({ blocks: true, blocking: 1, unresolved: 1 })
    expect(p.rows).toEqual([{ row: 1, field: '(unlisted field)' }])
  })

  it('reads malformed entries as invalid, blocks on them, and gives their positions', async () => {
    const bad = [
      entry({ previous: null }), entry({ previous: 'unknown' }), entry({ value: null }), (({ value, ...rest }) => rest)(entry()),
      entry({ group: 'things' }), entry({ field: 'a.b' }), entry({ element_id: '../x' }), entry({ batch: 'b 1' }),
      entry({ source: 's'.repeat(PENDING_LIMITS.sourceChars + 1) }), 'not an entry', null, [entry()],
    ]
    await write({ version: 1, entries: [entry(), ...bad] })
    const p = await pending()
    expect(p).toMatchObject({ blocks: true, entries: 1, invalid: bad.length, blocking: 1 + bad.length })
    expect(p.invalid_rows).toEqual(bad.map((_, i) => i + 2))
  })

  it('reads an id that exists only in another group as invalid', async () => {
    await write({ version: 1, entries: [entry({ group: 'dataFlows' })] })
    expect(await pending()).toMatchObject({ entries: 0, invalid: 1, invalid_rows: [1], blocks: true })
  })

  it('accepts record fields and floor keys, and hides any field the element does not have', async () => {
    await write({ version: 1, entries: [
      entry({ group: 'dataItems', element_id: 'd-card', field: 'sensitivity', value: 'restricted' }),
      entry({ field: 'monitoring_tools', value: ['siem'] }),
      entry({ element_id: 'c-db', field: 'canary-secret-value', value: 1 }),
    ] })
    const p = await pending()
    expect(p.rows.map((r) => r.field)).toEqual(['sensitivity', 'monitoring_tools', '(unlisted field)'])
    expect(JSON.stringify(p)).not.toContain('canary-secret-value')
  })

  it('counts unknown keys without naming them, and never echoes value, source, previous or batch', async () => {
    await write({ version: 1, 'canary-secret-key': 1, entries: [entry({
      value: 'canary-secret-value', source: 'canary-secret-source', batch: 'canary-secret-batch', 'canary-secret-extra': 2,
    })] })
    const p = await pending()
    expect(p.unknown_keys).toBe(2)
    const text = JSON.stringify(p) + JSON.stringify(computeGates(await loadGateInput(dir))) + (await directoryPushRefusal(dir))
    expect(text).not.toMatch(/canary-secret/)
  })

  it('caps the rows and keeps the totals', async () => {
    await write({ version: 1, entries: Array.from({ length: PENDING_LIMITS.rows + 5 }, (_, i) => entry({ field: `f${i}` })) })
    const p = await pending()
    expect(p.rows).toHaveLength(PENDING_LIMITS.rows)
    expect(p).toMatchObject({ rows_total: PENDING_LIMITS.rows + 5, blocking: PENDING_LIMITS.rows + 5 })
  })
})

describe('where it shows', () => {
  it('adds a warning lint and a report entry while it blocks, and nothing once it is cleared', async () => {
    await write({ version: 1, entries: [entry()] })
    let g = computeGates(await loadGateInput(dir))
    expect(g.lints.filter((l) => l.rule === 'pending_enrichment')).toHaveLength(1)
    expect(g.gate3.report.pending_enrichment).toEqual({ state: 'present', blocking: 1, blocks: true })
    await write({ version: 1, entries: [] })
    g = computeGates(await loadGateInput(dir))
    expect(g.lints.filter((l) => l.rule === 'pending_enrichment')).toHaveLength(0)
    expect(g.gate3.report.pending_enrichment).toEqual({ state: 'none', blocking: 0, blocks: false })
  })

  it('refuses a push in one order: Gate 2 first, then unconfirmed enrichment', async () => {
    const m = gateModel()
    const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-web') delete c.positionX; (b.boundaries ?? []).forEach(walk) }
    walk(m.structure.defaultBoundary)
    await writeGateModel(dir, m)
    await write({ version: 1, entries: [entry()] })
    expect(await directoryPushRefusal(dir)).toMatch(/Gate 2 fails/)
    await writeGateModel(dir, gateModel())
    expect(await directoryPushRefusal(dir)).toMatch(/\(pending_enrichment\)/)
  })

  it('is not part of the review hash: adding or clearing entries never stales a review', async () => {
    const before = reviewContentHash(await loadGateInput(dir))
    await write({ version: 1, entries: [entry()] })
    expect(reviewContentHash(await loadGateInput(dir))).toBe(before)
    await fs.rm(path.join(dir, PENDING_ENRICHMENT_FILE))
    expect(reviewContentHash(await loadGateInput(dir))).toBe(before)
  })
})
