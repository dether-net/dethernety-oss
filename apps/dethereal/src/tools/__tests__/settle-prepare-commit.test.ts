/**
 * model_state_settle prepare and commit, and the decisions that come with them: one range of pending rows accepted
 * as shown, records told from attributes, the lines a plan shows, and the relay files a commit leaves alone.
 *
 * Every test runs with its own HOME, so this machine's key and its pointer file never carry over.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync, promises as fs, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import { modelStateSettleTool } from '../model-state-settle.tool.js'
import { PLAN_LIMITS } from '../../utils/settle-plans.js'
import { clearRendered } from '../../utils/rendered-pages.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { registerAll } from './helpers/settle.js'
import { serverWriteReading, settledAt } from '../../acceptance/score/settled-at.js'
import { eventBuilder } from '../../acceptance/__tests__/helpers.js'
import type { ElementChange } from '../../acceptance/score/element-changes.js'
import type { TranscriptEvent } from '../../acceptance/transcripts/types.js'

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const base = process.cwd()
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(base, '.test-settle-plan-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-settle-plan-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  const h = path.join(homes, `h${seq++}`)
  await fs.mkdir(h)
  process.env.HOME = h
  modelStateSettleTool.plans.clear()
  clearRendered()
  planLines.clear()
  modelStateSettleTool.plans.clockOffsetMs = 0
})

const REPLY = 'Accept all.'
const TEST_FIELDS = { session_timeout: { type: 'integer' }, log_level: { type: 'string' }, notes: { type: 'string' } }

async function model(mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  for (const e of Object.values(m.classCache)) if (e.classType === 'component') Object.assign(e.template.schema.properties, TEST_FIELDS)
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  return dir
}

/** Each plan's lines as prepare returned them: a commit passes them back, as the main session does. */
const planLines = new Map<string, string[]>()
const run = async (input: Record<string, unknown>) => {
  const withLines = input.action === 'commit' && !('lines' in input) && planLines.has(String(input.plan_id)) ? { ...input, lines: planLines.get(String(input.plan_id)) } : input
  const r = (await modelStateSettleTool.run(withLines as never, context)) as any
  if (input.action === 'prepare' && r.success) planLines.set(r.data.plan_id, r.data.lines)
  return r
}
const get = async (dir: string, extra: Record<string, unknown> = {}) =>
  ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'], ...extra } as never, context)) as any).data
const attrPath = (dir: string, group: string, id: string) => path.join(dir, 'attributes', group, `${id}.json`)
const attrs = (dir: string, group: string, id: string) => JSON.parse(readFileSync(attrPath(dir, group, id), 'utf8')).attributes
const editAttrs = async (dir: string, group: string, id: string, fn: (a: any) => void) => {
  const doc = JSON.parse(readFileSync(attrPath(dir, group, id), 'utf8'))
  fn(doc.attributes)
  await fs.writeFile(attrPath(dir, group, id), JSON.stringify(doc, null, 2))
}
const pendingFile = (dir: string) => path.join(dir, '.dethereal', 'enrichment-pending.json')
const writePending = (dir: string, entries: unknown[]) => fs.writeFile(pendingFile(dir), JSON.stringify({ version: 1, entries }))
const row = (element_id: string, field: string, value: unknown, extra: Record<string, unknown> = {}) =>
  ({ batch: 'b1', group: 'components', element_id, field, value, source: 'app/server.py:12', previous: 'absent', ...extra })
const pendingEntries = (dir: string) => JSON.parse(readFileSync(pendingFile(dir), 'utf8')).entries
/** Every file of a model directory, by path, with its bytes: what a call that writes nothing leaves as it was. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p)] = readFileSync(p).toString('base64')
    }
  }
  walk(dir)
  return out
}

/** A registered model with three enricher rows on c-web, the file holding each value as the row says. */
async function withRows(rows = [row('c-web', 'log_level', 'debug'), row('c-web', 'notes', 'Behind the gateway.'), row('c-web', 'session_timeout', 30)]): Promise<string> {
  const dir = await model()
  await registerAll(dir)
  await editAttrs(dir, 'components', 'c-web', (a) => { for (const r of rows as any[]) if (r.group === 'components' && r.element_id === 'c-web' && r.field) a[r.field] = r.value })
  await writePending(dir, rows)
  return dir
}
/** The pending rows shown as the operator sees them, a table page of every row: its digest, to accept from. */
const digestOf = async (dir: string) => (await get(dir, { include: ['pending_rows'], pending_render: 'table', pending_limit: 250 })).pending_enrichment.digest as string

describe('prepare and commit', () => {
  it('prepare checks the call and writes nothing; commit writes what a settle would', async () => {
    const a = await withRows()
    const b = await withRows()
    const before = snapshot(a)
    const p = await run({ action: 'prepare', directory_path: a, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(a), except: [] } })
    expect(p.success, JSON.stringify(p)).toBe(true)
    expect(p.data).toMatchObject({ plan_id: expect.stringMatching(/^[0-9a-f]{32}$/), echo: [], decisions: { accept: 3 }, accepted_unchanged: 3 })
    expect(p.data.lines).toEqual([expect.stringMatching(/^Recording: accept rows 1–3 as shown \(pending [0-9a-f]{12}\), except rows none: 3 values$/)])
    expect(snapshot(a)).toEqual(before)
    const c = await run({ action: 'commit', directory_path: a, plan_id: p.data.plan_id, reply: REPLY })
    const s = await run({ action: 'settle', directory_path: b, reply: REPLY, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(b), except: [] } })
    expect(c.success, JSON.stringify(c)).toBe(true)
    const { revision: _r1, ...committed } = c.data
    const { revision: _r2, ...settled } = s.data
    expect(committed).toEqual(settled)
    expect(pendingEntries(a)).toEqual([])
    expect(attrs(a, 'components', 'c-web')).toEqual(attrs(b, 'components', 'c-web'))
    expect((await get(a)).unregistered_changes.rows_total).toBe(0)
  })

  it('a plan is committed once; an unknown, an expired or another directory\'s plan is refused', async () => {
    const dir = await withRows()
    const other = await withRows()
    const prepare = async (to = 3) => (await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to, digest: await digestOf(dir), except: [] } })).data.plan_id
    const id = await prepare()
    expect((await run({ action: 'commit', directory_path: other, plan_id: id, reply: REPLY })).data.codes).toEqual(['plan_other_model'])
    expect((await run({ action: 'commit', directory_path: dir, plan_id: id, reply: '' })).data.codes).toEqual(['reply_invalid'])
    // Neither used it up.
    expect((await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })).success).toBe(true)
    expect((await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })).data.codes).toEqual(['plan_used'])
    expect((await run({ action: 'commit', directory_path: dir, plan_id: '0'.repeat(32), reply: REPLY })).data.codes).toEqual(['plan_not_found'])
    await editAttrs(dir, 'components', 'c-web', (a) => { a.log_level = 'warn' })
    await writePending(dir, [row('c-web', 'log_level', 'warn')])
    const late = await prepare(1)
    expect(late).toMatch(/^[0-9a-f]{32}$/)
    modelStateSettleTool.plans.clockOffsetMs = PLAN_LIMITS.ttlMs
    expect((await run({ action: 'commit', directory_path: dir, plan_id: late, reply: REPLY })).data.codes).toEqual(['plan_expired'])
  })

  it('two commits of one plan at once: one writes, the other is told a commit of it is running, and later that it is used', async () => {
    const dir = await withRows()
    const id = (await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] } })).data.plan_id
    const results = await Promise.all([1, 2].map(() => run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })))
    expect(results.map((r) => r.success).sort()).toEqual([false, true])
    expect(results.find((r) => !r.success)!.data.codes).toEqual(['busy'])
    expect((await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })).data.codes).toEqual(['plan_used'])
  })

  it('a commit writes nothing when the model moved since prepare: the pending file, the value, or another settle', async () => {
    for (const move of [
      async (dir: string) => writePending(dir, [...pendingEntries(dir), row('c-web', 'runs_as_root', false)]),
      async (dir: string) => editAttrs(dir, 'components', 'c-web', (a) => { a.log_level = 'info' }),
      async (dir: string) => {
        await editAttrs(dir, 'components', 'c-orders', (a) => { a.notes = 'Changed.' })
        expect((await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: 'components', element_id: 'c-orders', field: 'notes', decision: 'confirm', value: 'Changed.', record: false }] })).success).toBe(true)
      },
    ]) {
      const dir = await withRows()
      const id = (await run({ action: 'prepare', directory_path: dir, items: [{ group: 'components', element_id: 'c-web', field: 'log_level', decision: 'accept', value: 'debug' }] })).data.plan_id
      await move(dir)
      const before = snapshot(dir)
      const c = await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })
      expect(c.data.codes, JSON.stringify(c.data)).toEqual(['plan_stale'])
      expect(snapshot(dir)).toEqual(before)
      // A stale plan is used up, and stays stale: it was never recorded.
      expect((await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })).data.codes).toEqual(['plan_stale'])
    }
  })

  it('a lock held elsewhere leaves the plan to be committed again', async () => {
    const dir = await withRows()
    const id = (await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] } })).data.plan_id
    const saved = modelStateSettleTool.storeOptions
    modelStateSettleTool.storeOptions = { lock: { waitMs: 0 } }
    const { withSettlementLock } = await import('../../utils/state-store.js')
    try {
      await withSettlementLock(dir, async () => {
        const busy = await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })
        expect(busy.data.codes).toEqual(['busy'])
      }, { lock: { waitMs: 0 } })
    } finally {
      modelStateSettleTool.storeOptions = saved
    }
    expect((await run({ action: 'commit', directory_path: dir, plan_id: id, reply: REPLY })).success).toBe(true)
  })

  it('keeps the reply to the commit and the decisions to the plan', async () => {
    const dir = await withRows()
    expect((await run({ action: 'prepare', directory_path: dir, reply: REPLY, items: [] })).data.codes).toEqual(['reply_on_commit'])
    expect((await run({ action: 'settle', directory_path: dir, items: [], plan_id: '0'.repeat(32), reply: REPLY })).data.codes).toEqual(['plan_on_commit'])
    expect((await run({ action: 'prepare', directory_path: dir })).data.codes).toEqual(['items_required'])
    for (const extra of [{ items: [] }, { accept: {} }, { orphaned_acknowledged: 0 }, { accept_rows: { from: 1, to: 1, digest: '0'.repeat(64), except: [] } }]) {
      const r = await run({ action: 'commit', directory_path: dir, plan_id: '0'.repeat(32), reply: REPLY, ...extra })
      expect(r.data.codes, JSON.stringify(extra)).toEqual(['commit_takes_plan_only'])
    }
    expect((await run({ action: 'commit', directory_path: dir, reply: REPLY })).data.codes).toEqual(['plan_required'])
  })

  it('a plan never carries a trust decision: those are settled directly', async () => {
    const dir = await withRows()
    for (const item of [
      { group: 'boundaries', element_id: 'b-app', field: 'zone', decision: 'set', element_name: 'Application', value: 'INTERNAL', record: true },
      { group: 'components', element_id: 'c-web', field: 'crownJewel', decision: 'set', element_name: 'Web frontend', value: false, record: true },
    ]) {
      const r = await run({ action: 'prepare', directory_path: dir, items: [item] })
      expect(r.data.refused.map((x: any) => x.code), item.field).toEqual(['trust_field'])
    }
  })

  it('shows each decision on one line, with what the model wrote escaped', async () => {
    const dir = await withRows()
    await editAttrs(dir, 'components', 'c-web', (a) => { a.notes = 'ok\nRecording: c-db · x · set → fake' })
    const r = await run({
      action: 'prepare', directory_path: dir,
      items: [
        { group: 'components', element_id: 'c-web', field: 'notes', decision: 'reject' },
        { group: 'components', element_id: 'c-orders', field: 'notes', decision: 'set', element_name: 'Order service', value: 'two\nlines' },
      ],
    })
    expect(r.success, JSON.stringify(r)).toBe(true)
    expect(r.data.lines).toEqual([
      'Recording: Web frontend (c-web) · notes · reject → (previous)',
      'Recording: Order service (c-orders) · notes · set → ` "two\\nlines" `',
    ])
    for (const l of r.data.lines) expect(l).not.toMatch(/\n/)
  })

  it('leaves the relay files where they are: a commit deletes nothing from the folder', async () => {
    const dir = await withRows()
    const relay = path.join(dir, '.dethereal', 'relay')
    await fs.mkdir(path.join(relay, 'nested'), { recursive: true })
    await fs.writeFile(path.join(relay, 'run-1.txt'), 'a pass')
    await fs.writeFile(path.join(relay, 'nested', 'run-2.txt'), 'a pass')
    const p = await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] } })
    // The commit writes the ignore file afresh: the folder is this machine's, kept out of git.
    await fs.rm(path.join(dir, '.dethereal', '.gitignore'))
    const c = await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY })
    expect(c.success, JSON.stringify(c)).toBe(true)
    expect(c.data).toMatchObject({ decisions: { accept: 3 } })
    expect(Object.keys(c.data).filter((k) => k.startsWith('relay'))).toEqual([])
    expect(readdirSync(relay).sort()).toEqual(['nested', 'run-1.txt'])
    expect(readdirSync(path.join(relay, 'nested'))).toEqual(['run-2.txt'])
    expect(readFileSync(path.join(dir, '.dethereal', '.gitignore'), 'utf8')).toContain('relay/\n')
  })

  it('takes no instruction to clear the relay files', async () => {
    const asked = await run({ action: 'prepare', directory_path: await withRows(), items: [], clear_relay: true })
    expect(asked.success).toBe(false)
    expect(asked.error).toMatch(/"code": "unrecognized_keys"[\s\S]*"clear_relay"/)
  })

  it('refuses a plan that decides nothing', async () => {
    expect((await run({ action: 'prepare', directory_path: await withRows(), items: [] })).data.codes).toEqual(['too_many_items'])
  })

  it('commits only with the plan\'s own lines, and a wrong set leaves the plan to commit', async () => {
    const dir = await withRows()
    const p = await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] } })
    for (const lines of [undefined, [], ['Recording: accept rows 1–999 as shown'], [...p.data.lines, 'Recording: more']]) {
      const r = await modelStateSettleTool.run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY, ...(lines ? { lines } : {}) } as never, context) as any
      expect(r.data.codes, JSON.stringify(lines)).toEqual(['lines_differ'])
      expect(r.data).toHaveProperty('index')
    }
    expect(pendingEntries(dir)).toHaveLength(3)
    expect((await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY })).success).toBe(true)
  })

  it('a commit that fails before writing leaves the plan to commit; one that fails partway says so, and the plan stays failed', async () => {
    const saved = modelStateSettleTool.storeOptions
    try {
      const dir = await withRows()
      const p = await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] } })
      modelStateSettleTool.storeOptions = { failAfterReplaces: 0 }
      const early = await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY })
      expect(early.data.codes).toEqual(['unreadable'])
      modelStateSettleTool.storeOptions = saved
      expect((await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY })).success).toBe(true)

      const part = await withRows()
      const q = await run({ action: 'prepare', directory_path: part, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(part), except: [] } })
      modelStateSettleTool.storeOptions = { failAfterReplaces: 1 }
      const failed = await run({ action: 'commit', directory_path: part, plan_id: q.data.plan_id, reply: REPLY })
      expect(failed.data.codes).toEqual(['plan_failed'])
      modelStateSettleTool.storeOptions = saved
      expect((await run({ action: 'commit', directory_path: part, plan_id: q.data.plan_id, reply: REPLY })).data.codes).toEqual(['plan_failed'])
    } finally {
      modelStateSettleTool.storeOptions = saved
    }
  })

  it('prepares a plan that only drops the registrations of gone elements, and commits it', async () => {
    const dir = await withRows()
    const s = JSON.parse(readFileSync(path.join(dir, 'structure.json'), 'utf8'))
    const walk = (b: any) => { b.components = (b.components ?? []).filter((c: any) => c.id !== 'c-notify'); (b.boundaries ?? []).forEach(walk) }
    walk(s.defaultBoundary)
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(s))
    const total = (await get(dir)).orphaned_registrations.total
    const p = await run({ action: 'prepare', directory_path: dir, items: [], orphaned_acknowledged: total })
    expect(p.success, JSON.stringify(p)).toBe(true)
    expect(p.data.lines.every((l: string) => l.startsWith('Removed: '))).toBe(true)
    const c = await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: 'Remove it.' })
    expect(c.data).toMatchObject({ orphaned_dropped: total })
    expect((await get(dir)).orphaned_registrations.total).toBe(0)
  })

  it('names the elements whose registrations a plan drops, with why', async () => {
    const dir = await withRows()
    const s = JSON.parse(readFileSync(path.join(dir, 'structure.json'), 'utf8'))
    const walk = (b: any) => { b.components = (b.components ?? []).filter((c: any) => c.id !== 'c-notify'); (b.boundaries ?? []).forEach(walk) }
    walk(s.defaultBoundary)
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(s))
    const orphans = (await get(dir)).orphaned_registrations
    expect(orphans.elements).toEqual(expect.arrayContaining([expect.objectContaining({ group: 'components', name: 'Application / Notifier', cause: 'removed' })]))
    const p = await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] }, orphaned_acknowledged: orphans.total })
    expect(p.success, JSON.stringify(p)).toBe(true)
    // A prepare drops nothing yet: the count is the plan's, under another name than a commit's.
    expect(p.data).toMatchObject({ orphaned_to_drop: orphans.total })
    expect(p.data.orphaned_dropped).toBeUndefined()
    expect(p.data.lines).toEqual(expect.arrayContaining([expect.stringMatching(/^Removed: ` Application \/ Notifier ` \(components, removed\) — \d+ registered values? dropped$/)]))
    const c = await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY })
    expect(c.data).toMatchObject({ orphaned_dropped: orphans.total, orphaned_dropped_elements_total: orphans.elements_total })
  })

  it('leaves a relay folder that is a link, and what it points to, alone', async () => {
    const dir = await withRows()
    const elsewhere = path.join(root, `elsewhere-${seq++}`)
    await fs.mkdir(elsewhere)
    await fs.writeFile(path.join(elsewhere, 'run-1.txt'), '{}')
    await fs.symlink(elsewhere, path.join(dir, '.dethereal', 'relay'))
    const p = await run({ action: 'prepare', directory_path: dir, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [] } })
    const c = await run({ action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: REPLY })
    expect(c.success, JSON.stringify(c)).toBe(true)
    expect(existsSync(path.join(elsewhere, 'run-1.txt'))).toBe(true)
  })
})

describe('accept_rows', () => {
  it('accepts the range but the rows left out, which stay pending', async () => {
    const dir = await withRows()
    const r = await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [{ group: 'components', element_id: 'c-web', field: 'notes', decision: 'reject' }], accept_rows: { from: 1, to: 3, digest: await digestOf(dir), except: [2] } })
    expect(r.success, JSON.stringify(r)).toBe(true)
    expect(r.data.decisions).toEqual({ accept: 2, reject: 1 })
    expect(pendingEntries(dir)).toEqual([])
    const s = await withRows()
    const kept = await run({ action: 'settle', directory_path: s, reply: REPLY, items: [], accept_rows: { from: 1, to: 3, digest: await digestOf(s), except: [3] } })
    expect(kept.data.decisions).toEqual({ accept: 2 })
    expect(pendingEntries(s).map((e: any) => e.field)).toEqual(['session_timeout'])
  })

  it('accepts only rows of a table page rendered for that pending file', async () => {
    const dir = await withRows()
    const digest = (await get(dir)).pending_enrichment.digest as string
    const unshown = await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept_rows: { from: 1, to: 3, digest, except: [] } })
    expect(unshown.data).toMatchObject({ codes: ['rows_not_rendered'], rendered: [] })
    await get(dir, { include: ['pending_rows'], pending_render: 'table', pending_limit: 2 })
    const past = await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept_rows: { from: 1, to: 3, digest, except: [] } })
    expect(past.data).toMatchObject({ codes: ['rows_not_rendered'], rendered: [[1, 2]] })
    await get(dir, { include: ['pending_rows'], pending_render: 'table', pending_from: 3 })
    expect((await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept_rows: { from: 1, to: 3, digest, except: [] } })).success).toBe(true)
  })

  it('refuses a range it cannot take as given', async () => {
    const dir = await withRows()
    const digest = await digestOf(dir)
    const codes = async (accept_rows: Record<string, unknown>) => (await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept_rows })).data.codes
    expect(await codes({ from: 1, to: 3, digest })).toEqual(['except_required'])
    expect(await codes({ from: 3, to: 1, digest, except: [] })).toEqual(['range_invalid'])
    expect(await codes({ from: 1, to: 4, digest, except: [] })).toEqual(['range_invalid'])
    expect(await codes({ from: 1, to: 2, digest, except: [3] })).toEqual(['except_outside_range'])
    expect(await codes({ from: 1, to: 3, digest: '0'.repeat(64), except: [] })).toEqual(['digest_changed'])
    expect(pendingEntries(dir)).toHaveLength(3)
  })

  it('refuses an item for a field of the range unless its rows are left out', async () => {
    const dir = await withRows()
    const digest = await digestOf(dir)
    const reject = { group: 'components', element_id: 'c-web', field: 'notes', decision: 'reject' }
    const inRange = await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [reject], accept_rows: { from: 1, to: 3, digest, except: [] } })
    expect(inRange.data.refused.map((x: any) => x.code)).toEqual(['row_in_range'])
    const mapped = await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept: { 'components/c-web/notes': 'Behind the gateway.' }, accept_rows: { from: 1, to: 3, digest, except: [] } })
    expect(mapped.data.refused.map((x: any) => [x.code, x.key])).toEqual([['row_in_range', 'components/c-web/notes']])
  })

  it('takes rows by their place in the file, a malformed row included, and a field\'s rows together', async () => {
    const dir = await withRows([
      { broken: true } as any,
      row('c-web', 'log_level', 'debug'),
      row('c-web', 'log_level', 'debug', { batch: 'b2' }),
      row('c-web', 'notes', 'Behind the gateway.'),
    ])
    const digest = await digestOf(dir)
    const codes = async (accept_rows: Record<string, unknown>) => (await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept_rows })).data
    const malformed = await codes({ from: 1, to: 4, digest, except: [] })
    expect(malformed.codes).toEqual(['row_not_acceptable'])
    expect(malformed.rows).toEqual([{ row: 1, reason: 'malformed' }])
    // Row 3 repeats row 2's field: left out, row 2 cannot go alone.
    const split = await codes({ from: 2, to: 4, digest, except: [3] })
    expect(split.rows).toEqual([{ row: 2, reason: 'field_rows_split' }])
    const ok = await codes({ from: 2, to: 4, digest, except: [] })
    expect(ok.decisions).toEqual({ accept: 2 })
    // The malformed row stays.
    expect(pendingEntries(dir)).toEqual([{ broken: true }])
  })

  it('says why a row cannot be accepted as shown', async () => {
    const dir = await withRows([
      row('c-web', 'log_level', 'debug'),
      row('c-web', 'log_level', 'trace', { batch: 'b2' }),
      row('c-web', 'no_such_field', 'x'),
      row('c-ghost', 'notes', 'x'),
      row('c-web', 'notes', 'Behind the gateway.'),
    ])
    await editAttrs(dir, 'components', 'c-web', (a) => { a.notes = 'Something else.'; delete a.no_such_field })
    const r = await run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], accept_rows: { from: 1, to: 5, digest: await digestOf(dir), except: [] } })
    expect(r.data.rows).toEqual([
      { row: 1, reason: 'conflicting_values' },
      { row: 2, reason: 'conflicting_values' },
      { row: 3, reason: 'unknown_field' },
      { row: 4, reason: 'element_gone' },
      { row: 5, reason: 'on_disk_differs' },
    ])
  })
})

describe('records and attributes', () => {
  it('reads a confirm or accept as the record when only a record has the name', async () => {
    const dir = await model()
    await registerAll(dir)
    const items = JSON.parse(readFileSync(path.join(dir, 'data-items.json'), 'utf8'))
    items.find((i: any) => i.id === 'd-card').sensitivity = 'confidential'
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify(items))
    const r = await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: 'dataItems', element_id: 'd-card', field: 'sensitivity', decision: 'confirm', value: 'confidential' }] })
    expect(r.success, JSON.stringify(r)).toBe(true)
  })

  it('refuses a set whose record flag is missing or wrong, saying how to send it', async () => {
    const dir = await model()
    await registerAll(dir)
    const missing = await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: 'dataItems', element_id: 'd-card', field: 'sensitivity', decision: 'set', element_name: 'Card data', value: 'confidential' }] })
    expect(missing.data.refused).toEqual([expect.objectContaining({ code: 'record_flag', fix: { record: true } })])
    const wrong = await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: 'boundaries', element_id: 'b-app', field: 'egress_filtering', decision: 'set', element_name: 'Application', value: 'allow_list', record: true }] })
    expect(wrong.data.refused).toEqual([expect.objectContaining({ code: 'record_flag', fix: { record: false } })])
  })

  it('refuses a record that set, modify or reject cannot write as such, not with a flag to try next', async () => {
    const dir = await model()
    await registerAll(dir)
    for (const item of [
      { group: 'dataItems', element_id: 'd-card', field: 'sensitivity', decision: 'modify', value: 'internal' },
      { group: 'boundaries', element_id: 'b-app', field: 'placement', decision: 'set', element_name: 'Application', value: 'x' },
    ]) {
      const r = await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [item] })
      expect(r.data.refused.map((x: any) => x.code), item.field).toEqual(['record_field'])
    }
  })

  it('gives the placement as the rows show it when a confirm got it wrong', async () => {
    const dir = await model()
    const g = await get(dir)
    const placement = g.unregistered_changes.rows.find((r: any) => r.field === 'placement' && r.shown)
    expect(placement, JSON.stringify(g.unregistered_changes.rows.slice(0, 3))).toBeDefined()
    const r = await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: placement.group, element_id: placement.element_id, field: 'placement', decision: 'confirm', value: `Shop / ${placement.shown}` }] })
    expect(r.data.refused).toEqual([expect.objectContaining({ code: 'value_differs', expected: placement.shown })])
    const other = await run({ action: 'settle', directory_path: dir, reply: 'Yes.', items: [{ group: 'dataItems', element_id: 'd-card', field: 'sensitivity', decision: 'confirm', value: 'internal' }] })
    expect(other.data.refused[0].expected).toBeUndefined()
  })
})

/** The tool's results as the frozen acceptance scorer reads them: here, because the inputs are the tool's own results. */
describe('the acceptance scorer reads a prepare and its commit', () => {
  it('looks past a prepare in a subagent and dates the write at the commit in the main session', async () => {
    const dir = await withRows()
    const input = { action: 'prepare', directory_path: dir, items: [{ group: 'components', element_id: 'c-orders', field: 'log_level', decision: 'set', element_name: 'Order service', value: 'info' }] }
    const p = await run(input)
    expect(p.success, JSON.stringify(p)).toBe(true)
    const commitInput = { action: 'commit', directory_path: dir, plan_id: p.data.plan_id, reply: 'Yes, info.' }
    const c = await run(commitInput)
    expect(c.success, JSON.stringify(c)).toBe(true)
    const SETTLE = 'dethereal.model_state_settle'
    const { ev } = eventBuilder()
    const call = (actor: string, id: string, inp: unknown, result: unknown): TranscriptEvent[] => [
      ev({ actor, kind: 'tool_call', tool: SETTLE, callId: id, input: inp as never }),
      ev({ actor, kind: 'tool_result', tool: SETTLE, callId: id, isError: false, text: JSON.stringify(result) }),
      ev({ actor, kind: 'server_write', tool: SETTLE, callId: id }),
    ]
    const events = [...call('enrichment-settler', 'p', input, p.data), ...call('main', 'c', commitInput, c.data)]
    const change = { path: 'm/attributes/components/c-orders.json', element: 'c-orders', field: 'log_level', before: undefined, after: 'info', opaque: { since: 2, resyncedAt: events.length, alsoCovered: [5] } } as ElementChange
    expect(serverWriteReading(events[2]!, change, events, [])).toBe('passes')
    expect(serverWriteReading(events[5]!, change, events, [])).toBe('writes')
    expect(settledAt(change, events, [], 'first')).toBe(5)
    expect(settledAt(change, events, [], 'last')).toBe(5)
  })
})
