/**
 * model_state_settle: the operator's decisions on attribute and record values,
 * and the signed baseline that makes a value count as theirs.
 *
 * Every test runs with its own HOME, so this machine's key and its pointer file
 * never carry over from another test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import { modelStateSettleTool } from '../model-state-settle.tool.js'
import { ORPHAN_CAUSE, SETTLE_LIMITS } from '../../utils/settlement.js'
import { updateModelTool } from '../update-model.tool.js'
import { validateModelTool } from '../validate-model.tool.js'
import { applyIdMapping, readModelDirectory } from '../../utils/directory-utils.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { confirmItem, registerAll, type Row } from './helpers/settle.js'

// Each test registers whole models (several settle calls): slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const base = process.cwd()
const realHome = process.env.HOME
let root: string
let homes: string
let home: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(base, '.test-settle-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-settle-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  home = await freshHome()
})

/** A new, empty home directory: a machine that never saw a key or a baseline. */
async function freshHome(): Promise<string> {
  const h = path.join(homes, `h${seq++}`)
  await fs.mkdir(h)
  process.env.HOME = h
  return h
}

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const REPLY = 'Yes, those are the values.'

/** The fields these tests write on components, as their class templates declare them: only a field of the class registers. */
const TEST_FIELDS = { session_timeout: { type: 'integer' }, log_level: { type: 'string' }, notes: { type: 'string' } }

/** Remove a component's class-only fields (anything but the floor keys) from its attribute file. */
function stripClassFields(m: GateModel, id: string): void {
  const a = m.attributes.components[id]!.attributes
  for (const k of Object.keys(a)) if (!['authentication_type', 'encryption_in_transit', 'encryption_at_rest', 'implicit_deny_enabled', 'monitoring_tools'].includes(k)) delete a[k]
}

/** Give boundary b-app a class whose template declares an attribute `zone` (the record of the same name is the boundary's own). */
function segmentClass(m: GateModel): void {
  const b = m.structure.defaultBoundary.boundaries!.find((x: any) => x.id === 'b-app') as any
  b.classData = { id: 'cls-segment', name: 'Network Segment' }
  m.classCache['cls-segment'] = { classId: 'cls-segment', className: 'Network Segment', classType: 'boundary', template: { schema: { type: 'object', properties: { zone: { type: 'string' } } } } }
}

/**
 * The reference model. `testFields: false` keeps the stock templates, for a model the gates judge: an extra field
 * nobody answers would lower each component's answered share.
 */
async function model(mutate?: (m: GateModel) => void, state: Record<string, unknown> | null = null, options: { testFields?: boolean } = {}): Promise<string> {
  const m = gateModel()
  if (options.testFields !== false) for (const e of Object.values(m.classCache)) if (e.classType === 'component') Object.assign(e.template.schema.properties, TEST_FIELDS)
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  if (state) await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(state))
  return dir
}

const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'] }, context)) as any).data
const settle = (dir: string, items: Array<Record<string, unknown>>, reply = REPLY) =>
  modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply, items } as never, context) as Promise<any>
/** A settle call acknowledging the model's orphaned registrations, as the workflow does after showing them. */
const settleAck = async (dir: string, items: Array<Record<string, unknown>>) =>
  modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: REPLY, items, orphaned_acknowledged: (await get(dir)).orphaned_registrations.total } as never, context) as Promise<any>
const transition = (dir: string) => modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' } as never, context) as Promise<any>
const attrPath = (dir: string, group: string, id: string) => path.join(dir, 'attributes', group, `${id}.json`)
const attrs = (dir: string, group: string, id: string) => JSON.parse(readFileSync(attrPath(dir, group, id), 'utf8')).attributes
const editAttrs = async (dir: string, group: string, id: string, fn: (a: any, doc: any) => void) => {
  const doc = JSON.parse(readFileSync(attrPath(dir, group, id), 'utf8'))
  fn(doc.attributes, doc)
  await fs.writeFile(attrPath(dir, group, id), JSON.stringify(doc, null, 2))
}
const editStructure = async (dir: string, fn: (s: any) => void) => {
  const p = path.join(dir, 'structure.json')
  const s = JSON.parse(readFileSync(p, 'utf8'))
  fn(s)
  await fs.writeFile(p, JSON.stringify(s, null, 2))
}
const component = (s: any, id: string): any => {
  let found: any
  const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === id) found = c; (b.boundaries ?? []).forEach(walk) }
  walk(s.defaultBoundary)
  return found
}
const baselineFile = (dir: string) => path.join(dir, '.dethereal', 'settlement-baseline.json')
const pointerFile = () => path.join(home, '.dethernety', 'baseline-pointers.json')
const pendingFile = (dir: string) => path.join(dir, '.dethereal', 'enrichment-pending.json')
const writePending = (dir: string, entries: Array<Record<string, unknown>>) =>
  fs.writeFile(pendingFile(dir), JSON.stringify({ version: 1, entries }))
const pending = (extra: Record<string, unknown>) => ({ batch: 'b1', group: 'components', element_id: 'c-web', source: 'app/server.py:12', previous: 'absent', ...extra })
const pendingEntries = (dir: string) => JSON.parse(readFileSync(pendingFile(dir), 'utf8')).entries
const rowsOf = (g: any) => g.unregistered_changes.rows.map((r: Row) => `${r.element_id}.${r.record ? 'record:' : ''}${r.field}${r.removed ? ':removed' : ''}${r.code ? `:${r.code}` : ''}`)
const attrItem = (dir: string, id: string, field: string) => confirmItem(dir, { group: 'components', element_id: id, field })

describe('a model nobody registered', () => {
  it('reports every attribute and record value as unregistered, without the values', async () => {
    const dir = await model()
    const g = await get(dir)
    expect(g).toMatchObject({ exists: false, claimed_state: null, baseline: 'missing', settlements_total: 0, settlements_verified: false, declined_fields: { rows: [], total: 0 } })
    expect(g.baseline_code).toBeUndefined()
    expect(g).not.toHaveProperty('baseline_initialized')
    expect(g.content_hash).toMatch(/^[0-9a-f]{64}$/)
    const rows: Row[] = g.unregistered_changes.rows
    expect(rows.some((r) => !r.record)).toBe(true)
    // Records: every element's placement (with its shown form), classes, crown jewels, data items carried
    // (the rows are capped at 100, components first; data item and boundary records come later).
    expect(g.unregistered_changes.rows_total).toBeGreaterThan(rows.length)
    for (const f of ['placement', 'classData', 'crownJewel', 'dataItemIds']) {
      expect(rows.some((r) => r.record && r.field === f), f).toBe(true)
    }
    expect(rows.find((r) => r.record && r.field === 'placement' && r.element_id === 'c-web')?.shown).toBe('Edge / Web frontend (PROCESS)')
    for (const r of rows) {
      expect(r).not.toHaveProperty('value')
      expect(r.code).toBeUndefined()
    }
    // Reading never creates a key.
    expect(existsSync(path.join(home, '.dethernety', 'waiver.key'))).toBe(false)
  })

  it('blocks REVIEWED with the rows, and shows the count in the display state', async () => {
    const dir = await model(undefined, ENRICHING, { testFields: false })
    const g = await get(dir)
    expect(g.display_state).toBe(`ENRICHING (${g.unregistered_changes.rows_total} unregistered)`)
    const t = await transition(dir)
    expect(t.success).toBe(false)
    expect(t.data.codes).toContain('unregistered_changes')
    await registerAll(dir)
    const ok = await transition(dir)
    expect(ok.success, ok.error).toBe(true)
  })
})

describe('no count-only registration', () => {
  it('has no baseline action: a call naming one fails the schema', async () => {
    const dir = await model()
    const u = (await get(dir)).unregistered_changes
    for (const input of [
      { action: 'baseline', directory_path: dir, reply: REPLY },
      { action: 'settle', directory_path: dir, reply: REPLY, items: [], unregistered: u.rows_total, unregistered_digest: u.digest },
    ]) {
      const r = await modelStateSettleTool.run(input as never, context) as any
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/Invalid input/)
    }
    expect(existsSync(baselineFile(dir))).toBe(false)
    expect((await settle(dir, [])).data.codes).toEqual(['too_many_items'])
  })

  it('registers 120 values in exactly 3 confirm calls, each naming its values', async () => {
    const dir = await model()
    // Trim attribute values until the model holds exactly 120 unregistered values.
    let total = (await get(dir)).unregistered_changes.rows_total
    for (const group of ['dataFlows', 'components']) {
      for (const f of await fs.readdir(path.join(dir, 'attributes', group))) {
        const id = f.slice(0, -'.json'.length)
        for (const k of Object.keys(attrs(dir, group, id))) {
          if (total <= 120) break
          await editAttrs(dir, group, id, (a) => { delete a[k] })
          total--
        }
      }
    }
    expect((await get(dir)).unregistered_changes.rows_total).toBe(120)
    expect(await registerAll(dir)).toBe(3)
    expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
  })
})

describe('settle', () => {
  it('confirms a hand edit only with the value on disk, and a retry is already settled', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    expect(rowsOf(await get(dir))).toEqual(['c-web.input_validation'])
    const wrong = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'input_validation', decision: 'confirm', value: 'schema' }])
    expect(wrong.data.refused).toEqual([{ index: 0, code: 'value_differs', message: expect.any(String) }])
    const item = attrItem(dir, 'c-web', 'input_validation')
    expect((await settle(dir, [item])).data).toMatchObject({ recorded: 1 })
    expect(rowsOf(await get(dir))).toEqual([])
    expect((await settle(dir, [item])).data).toMatchObject({ recorded: 0, already_settled: [0] })
  })

  it('accepts a pending value only with its value, and removes the row', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 })])
    const accept = (value?: unknown) => settle(dir, [{ row: 7, group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'accept', ...(value === undefined ? {} : { value }) }])
    expect((await accept()).data.refused[0].code).toBe('value_required')
    expect((await accept(901)).data.refused[0].code).toBe('value_differs')
    expect((await accept('900')).data.refused[0].code).toBe('value_differs')
    const ok = await accept(900)
    expect(ok.data).toMatchObject({ recorded: 1, decisions: { accept: 1 } })
    expect(pendingEntries(dir)).toEqual([])
    expect(rowsOf(await get(dir))).toEqual([])
    expect((await accept(900)).data).toMatchObject({ recorded: 0, already_settled: [0] })
  })

  // Some model providers accept only string enums in a tool schema, so the flags are plain booleans: false is unset.
  it('reads absent, record and removed set to false as unset', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    const item = { ...attrItem(dir, 'c-web', 'input_validation'), absent: false, record: false, removed: false }
    expect((await settle(dir, [item])).data).toMatchObject({ recorded: 1 })
    expect(rowsOf(await get(dir))).toEqual([])
  })

  it('refuses an accept whose value changed on disk after the row was written', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 1200 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 })])
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'accept', value: 900 }])
    expect(r.data.refused[0].code).toBe('value_changed')
  })

  it('rejects to the previous state, and lists the fields the operator left empty as declined', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900; a.log_level = 'debug' })
    await writePending(dir, [
      pending({ field: 'session_timeout', value: 900, previous: 'null' }),
      pending({ field: 'log_level', value: 'debug', previous: 'absent' }),
    ])
    const r = await settle(dir, [
      { group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'reject' },
      { group: 'components', element_id: 'c-web', field: 'log_level', decision: 'reject' },
    ], 'No, drop both.')
    expect(r.data).toMatchObject({ recorded: 2, decisions: { reject: 2 } })
    const a = attrs(dir, 'components', 'c-web')
    expect(a.session_timeout).toBeNull()
    expect(a).not.toHaveProperty('log_level')
    const g = await get(dir)
    expect(rowsOf(g)).toEqual([])
    expect(g.declined_fields).toEqual({ rows: [
      { group: 'components', element_id: 'c-web', name: 'Web frontend', field: 'log_level' },
      { group: 'components', element_id: 'c-web', name: 'Web frontend', field: 'session_timeout' },
    ], total: 2 })
    // A value written later is a change like any other.
    await editAttrs(dir, 'components', 'c-web', (x) => { x.session_timeout = 300 })
    const later = await get(dir)
    expect(rowsOf(later)).toEqual(['c-web.session_timeout'])
    expect(later.declined_fields.total).toBe(1)
  })

  it('registers a value the operator gives later for a declined field, which then leaves declined_fields', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900, previous: 'null' })])
    await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'reject' }], 'No.')
    expect((await get(dir)).declined_fields.rows.map((r: any) => r.field)).toEqual(['session_timeout'])
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', element_name: 'Web frontend', field: 'session_timeout', decision: 'set', value: 300 }], 'I checked with the platform team: 300 seconds.')
    expect(r.data).toMatchObject({ recorded: 1, decisions: { set: 1 } })
    expect(attrs(dir, 'components', 'c-web').session_timeout).toBe(300)
    const g = await get(dir)
    expect(g.declined_fields).toEqual({ rows: [], total: 0 })
    expect(rowsOf(g)).toEqual([])
  })

  it('refuses a reject whose previous state contradicts a registered value', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    await writePending(dir, [pending({ field: 'input_validation', value: 'allow_list', previous: 'null' })])
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'input_validation', decision: 'reject' }])
    expect(r.data.refused[0].code).toBe('previous_contradicts_baseline')
  })

  it('writes and registers a modified value, and keeps the reply out of get', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 })])
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'modify', value: 600 }], 'Make it 600.')
    expect(r.data).toMatchObject({ recorded: 1, decisions: { modify: 1 } })
    expect(attrs(dir, 'components', 'c-web').session_timeout).toBe(600)
    expect(rowsOf(await get(dir))).toEqual([])
    expect(readFileSync(path.join(dir, '.dethereal', 'settlements.json'), 'utf8')).toContain('Make it 600.')
    expect(JSON.stringify(await get(dir))).not.toContain('Make it 600.')
  })

  it('settles duplicate rows of one field together, and refuses them when their values differ', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 }), pending({ field: 'session_timeout', value: 900, batch: 'b2' })])
    const item = { group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'accept', value: 900 }
    expect((await settle(dir, [item])).data).toMatchObject({ recorded: 1 })
    expect(pendingEntries(dir)).toEqual([])
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 }), pending({ field: 'session_timeout', value: 901, batch: 'b2' })])
    expect((await settle(dir, [item])).data.refused[0].code).toBe('duplicate_pending')
  })

  it('removes a rejected row whose element is gone, and writes no attribute file', async () => {
    const dir = await model()
    await registerAll(dir)
    await writePending(dir, [pending({ element_id: 'c-gone', field: 'session_timeout', value: 900 })])
    const r = await settle(dir, [{ group: 'components', element_id: 'c-gone', field: 'session_timeout', decision: 'reject' }])
    expect(r.data).toMatchObject({ recorded: 1 })
    expect(pendingEntries(dir)).toEqual([])
    expect(existsSync(attrPath(dir, 'components', 'c-gone'))).toBe(false)
  })

  it('is all or nothing: one refused item and nothing is written', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    await editAttrs(dir, 'components', 'c-orders', (a) => { a.input_validation = 'allow_list' })
    const before = readFileSync(baselineFile(dir))
    const r = await settle(dir, [
      attrItem(dir, 'c-web', 'input_validation'),
      { group: 'components', element_id: 'c-orders', field: 'input_validation', decision: 'confirm', value: 'schema' },
    ])
    expect(r.success).toBe(false)
    expect(r.data.refused).toEqual([{ index: 1, code: 'value_differs', message: expect.any(String) }])
    expect(readFileSync(baselineFile(dir)).equals(before)).toBe(true)
    expect(rowsOf(await get(dir)).sort()).toEqual(['c-orders.input_validation', 'c-web.input_validation'])
  })

  it('refuses values that do not display as they are, and a reply with hidden characters', async () => {
    const dir = await model()
    await registerAll(dir)
    const RLO = String.fromCharCode(0x202e)
    const ZWSP = String.fromCharCode(0x200b)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 })])
    const modify = (value: unknown) => settle(dir, [{ group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'modify', value }])
    expect((await modify(`600${RLO}`)).data.refused[0].code).toBe('unclean_value')
    expect((await modify({ [`ke${ZWSP}y`]: 1 })).data.refused[0].code).toBe('unclean_value')
    expect((await modify('x'.repeat(5000))).data.refused[0].code).toBe('too_large')
    expect((await modify(`p${String.fromCharCode(0x0430)}ssword`)).data.refused[0].code).toBe('unclean_value')
    const bell = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'accept', value: 900 }], `yes${String.fromCharCode(7)}`)
    expect(bell.data.codes).toEqual(['reply_invalid'])
    const multiLine = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'accept', value: 900 }], 'Yes.\nKeep 900.')
    expect(multiLine.success, multiLine.error).toBe(true)
  })

  it('takes the operator\'s whole reply up to its limit, and says what to send for a longer one', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 })])
    const item = { group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'accept', value: 900 }
    const log = path.join(dir, '.dethereal', 'settlements.json')
    const LIMIT = SETTLE_LIMITS.replyChars
    expect(LIMIT).toBe(8000)
    // Over the limit (surrounding whitespace not counted): refused with its length and the excerpt rule, nothing written.
    const long = `${'Keep 900, as the runbook says. '.repeat(300).slice(0, LIMIT)}x`
    const over = await settle(dir, [item], `  ${long}\n`)
    expect(over.data.codes).toEqual(['reply_invalid'])
    expect(over.error).toContain(`reply has ${LIMIT + 1} characters, over ${LIMIT}`)
    expect(over.error).toMatch(/whole reply when it fits.*verbatim excerpt.*never reworded.*\[…\] where text was cut/)
    expect(existsSync(log)).toBe(true)
    const before = readFileSync(log)
    // A lone surrogate is no visible word.
    expect((await settle(dir, [item], `Keep 900${String.fromCharCode(0xd800)}`)).data.codes).toEqual(['reply_invalid'])
    // Far beyond the limit, the schema refuses it outright.
    expect((await settle(dir, [item], 'y'.repeat(2 * LIMIT + 385))).success).toBe(false)
    expect(readFileSync(log).equals(before)).toBe(true)
    // At the limit, with newlines, accents, an emoji and quotes: stored as sent, trimmed.
    // Whole units only, so no emoji is cut in half; then filled up with dots.
    const unit = 'Szia, ez maradjon így 😀. '
    let exact = '"Keep 900."\n'
    while (exact.length + unit.length < LIMIT) exact += unit
    exact += '.'.repeat(LIMIT - exact.length)
    expect(exact.length).toBe(LIMIT)
    const ok = await settle(dir, [item], `\n${exact}  `)
    expect(ok.success, ok.error).toBe(true)
    const entries = JSON.parse(readFileSync(log, 'utf8')).entries
    expect(entries.at(-1).reply).toBe(exact)
  })

  it('refuses more than 50 items', async () => {
    const dir = await model()
    const many = Array.from({ length: 51 }, (_, i) => ({ group: 'components', element_id: `c-${i}`, field: 'f', decision: 'reject' }))
    expect((await settle(dir, many)).success).toBe(false)
  })

  it('converges when a write fails part-way and the call is repeated', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.session_timeout = 900 })
    await writePending(dir, [pending({ field: 'session_timeout', value: 900 })])
    const item = { group: 'components', element_id: 'c-web', field: 'session_timeout', decision: 'modify', value: 600 }
    for (const failAfter of [1, 2, 3]) {
      modelStateSettleTool.storeOptions = { failAfterReplaces: failAfter }
      try {
        expect((await settle(dir, [item])).success).toBe(false)
      } finally {
        modelStateSettleTool.storeOptions = {}
      }
    }
    const done = await settle(dir, [item])
    expect(done.success, done.error).toBe(true)
    expect(attrs(dir, 'components', 'c-web').session_timeout).toBe(600)
    expect(pendingEntries(dir)).toEqual([])
    expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 }, settlements_verified: true })
  })

  it('binds the log to the baseline: an edited log is reported as not verified', async () => {
    const dir = await model()
    await registerAll(dir)
    expect((await get(dir)).settlements_verified).toBe(true)
    const log = path.join(dir, '.dethereal', 'settlements.json')
    const doc = JSON.parse(readFileSync(log, 'utf8'))
    doc.entries[0].reply = 'Edited afterwards.'
    await fs.writeFile(log, JSON.stringify(doc))
    expect((await get(dir)).settlements_verified).toBe(false)
  })
})

describe('record fields', () => {
  it('confirms a record with the value the file holds, and refuses to modify or reject one', async () => {
    const dir = await model()
    await registerAll(dir)
    await editStructure(dir, (s) => { component(s, 'c-web').classData = { id: 'cls-gateway', name: 'API Gateway' } })
    const g = await get(dir)
    // A new class: every value of the element is confirmed again under it.
    expect(rowsOf(g)).toEqual(expect.arrayContaining(['c-web.record:classData', 'c-web.record:placement', 'c-web.input_validation:off_template_field']))
    const classData = { group: 'components', element_id: 'c-web', field: 'classData', record: true }
    expect((await settleAck(dir, [{ ...classData, decision: 'confirm', value: { id: 'cls-service', name: 'Application Service' } }])).data.refused[0].code).toBe('value_differs')
    expect((await settleAck(dir, [{ ...classData, decision: 'modify', value: { id: 'cls-service' } }])).data.refused[0].code).toBe('record_field')
    expect((await settleAck(dir, [{ ...classData, decision: 'reject' }])).data.refused[0].code).toBe('record_field')
    expect((await settleAck(dir, [{ ...classData, decision: 'confirm', value: { id: 'cls-gateway', name: 'API Gateway' } }])).data).toMatchObject({ recorded: 1 })
    // The old class's fields are dropped: removing a value never needs the rule.
    const leftovers = rowsOf(await get(dir)).filter((r: string) => r.endsWith(':off_template_field')).map((r: string) => r.split('.')[1]!.split(':')[0]!)
    expect(leftovers.length).toBeGreaterThan(0)
    const drop = await settle(dir, leftovers.map((field: string) => ({ group: 'components', element_id: 'c-web', element_name: 'Web frontend', field, decision: 'set', absent: true })))
    expect(drop.data, JSON.stringify(drop)).toMatchObject({ recorded: leftovers.length })
    for (const f of leftovers) expect(attrs(dir, 'components', 'c-web')).not.toHaveProperty(f)
    await registerAll(dir)
    expect(rowsOf(await get(dir))).toEqual([])
  })

  it('raises a row when a boundary\'s zone changes', async () => {
    const dir = await model()
    await registerAll(dir)
    await editStructure(dir, (s) => { s.defaultBoundary.boundaries.find((b: any) => b.id === 'b-app').zone = 'RESTRICTED' })
    expect(rowsOf(await get(dir))).toEqual(['b-app.record:zone'])
    await registerAll(dir)
    expect(rowsOf(await get(dir))).toEqual([])
  })

  it('raises a placement row when an element moves, confirmed with its shown form', async () => {
    const dir = await model()
    await registerAll(dir)
    await editStructure(dir, (s) => {
      const edge = s.defaultBoundary.boundaries.find((b: any) => b.id === 'b-edge')
      const app = s.defaultBoundary.boundaries.find((b: any) => b.id === 'b-app')
      const web = edge.components.find((c: any) => c.id === 'c-web')
      edge.components = edge.components.filter((c: any) => c.id !== 'c-web')
      app.components.push(web)
    })
    const rows: Row[] = (await get(dir)).unregistered_changes.rows
    const placement = rows.find((r) => r.element_id === 'c-web' && r.record && r.field === 'placement')
    expect(placement?.shown).toBe('Application / Web frontend (PROCESS)')
    const wrong = await settleAck(dir, [{ group: 'components', element_id: 'c-web', field: 'placement', record: true, decision: 'confirm', value: 'Edge / Web frontend (PROCESS)' }])
    expect(wrong.data.refused[0].code).toBe('value_differs')
    await registerAll(dir)
    expect(rowsOf(await get(dir))).toEqual([])
  })

  it('accepts a pending record row against the record', async () => {
    const dir = await model()
    await registerAll(dir)
    const sensitivity = JSON.parse(readFileSync(path.join(dir, 'data-items.json'), 'utf8')).find((d: any) => d.id === 'd-card').sensitivity
    await writePending(dir, [pending({ group: 'dataItems', element_id: 'd-card', field: 'sensitivity', value: sensitivity })])
    const r = await settle(dir, [{ group: 'dataItems', element_id: 'd-card', field: 'sensitivity', record: true, decision: 'accept', value: sensitivity }])
    expect(r.data).toMatchObject({ recorded: 1 })
    expect(pendingEntries(dir)).toEqual([])
    expect(rowsOf(await get(dir))).toEqual([])
  })
})

describe('removals', () => {
  it('raises a row when a registered value is gone, and registers it only as a removal', async () => {
    const dir = await model()
    await registerAll(dir)
    await editStructure(dir, (s) => { delete component(s, 'c-db').crownJewel })
    const data = JSON.parse(readFileSync(path.join(dir, 'data-items.json'), 'utf8'))
    data.find((d: any) => d.id === 'd-card').regulatory_flags = []
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify(data))
    await editAttrs(dir, 'components', 'c-web', (a) => { delete a.input_validation })
    const g = await get(dir)
    expect(rowsOf(g).sort()).toEqual(['c-db.record:crownJewel:removed', 'c-web.input_validation:removed', 'd-card.record:regulatory_flags:removed'])
    // The crown jewel switched off is a downgrade: it blocks REVIEWED and a push until the operator confirms it.
    const jewel = { group: 'components', element_id: 'c-db', field: 'crownJewel', record: true, decision: 'confirm' }
    expect((await settle(dir, [{ ...jewel, value: true }])).data.refused[0].code).toBe('not_found')
    expect((await settle(dir, [{ ...jewel, value: false, removed: true }])).data.refused[0].code).toBe('value_differs')
    await editStructure(dir, (s) => { component(s, 'c-db').crownJewel = true })
    expect((await settle(dir, [{ ...jewel, value: null, removed: true }])).data.refused[0].code).toBe('not_removed')
    await editStructure(dir, (s) => { delete component(s, 'c-db').crownJewel })
    expect((await settle(dir, [{ ...jewel, value: null, removed: true }])).data).toMatchObject({ recorded: 1, decisions: { removal: 1 } })
    await registerAll(dir)
    expect(rowsOf(await get(dir))).toEqual([])
    // A confirmed removal of an attribute counts as declined.
    expect((await get(dir)).declined_fields.rows.map((r: any) => r.field)).toEqual(['input_validation'])
  })

  it('counts the registrations of a renamed element, so a rename that drops a value is seen; confirming prunes them', async () => {
    const dir = await model()
    await registerAll(dir)
    const registered = Object.keys(attrs(dir, 'components', 'c-notify')).length
    await editStructure(dir, (s) => { component(s, 'c-notify').name = 'Mailer' })
    await editAttrs(dir, 'components', 'c-notify', (a) => { delete a.input_validation })
    const g = await get(dir)
    // A rename looks like a removal: no component has the old name. The flow into it keeps its name, between other labels.
    expect(g.orphaned_registrations.elements).toEqual(expect.arrayContaining([
      { group: 'components', name: 'Application / Notifier', cause: 'removed', values: expect.any(Number) },
      { group: 'dataFlows', name: 'Order notification', cause: 're-pointed', values: expect.any(Number) },
    ]))
    // Every registered value of the old label counts, the dropped one included: more than the element now holds.
    expect(g.orphaned_registrations.total).toBeGreaterThan(registered)
    expect(rowsOf(g)).not.toContain('c-notify.input_validation:removed')
    // The operator's acknowledgement is in the call: without it, or with another number, nothing is written.
    const item = confirmItem(dir, g.unregistered_changes.rows[0])
    const total = g.orphaned_registrations.total
    for (const ack of [undefined, total - 1, total + 1]) {
      const r = await modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: REPLY, items: [item], ...(ack === undefined ? {} : { orphaned_acknowledged: ack }) } as never, context) as any
      expect(r.data.codes, String(ack)).toEqual(['orphaned_unacknowledged'])
      expect(r.data.orphaned_registrations.total).toBe(total)
      expect(r.error).toMatch(/Application \/ Notifier/)
      expect(r.error).toContain(`belong to elements that were ${ORPHAN_CAUSE} (`)
    }
    expect((await get(dir)).orphaned_registrations.total).toBe(total)
    const ok = await modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: REPLY, items: [item], orphaned_acknowledged: total } as never, context) as any
    expect(ok.data).toMatchObject({ recorded: 1, orphaned_dropped: total })
    expect((await get(dir)).orphaned_registrations).toEqual({ total: 0, elements: [], elements_total: 0 })
    // With nothing orphaned, a stale acknowledgement is refused.
    const stale = await modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: REPLY, items: [item], orphaned_acknowledged: 3 } as never, context) as any
    expect(stale.data.codes).toEqual(['orphaned_unacknowledged'])
    expect(stale.error).toContain('no registered value belongs to a removed, moved, reclassified, re-pointed or changed element: leave out orphaned_acknowledged. Nothing was written.')
    await registerAll(dir)
    expect(await get(dir)).toMatchObject({ unregistered_changes: { rows_total: 0 } })
  })

  it('carries registrations made before an element had a class over to its first class', async () => {
    const DATA = { id: 'cls-data-x', name: 'Security Logs' }
    const dir = await model((m) => {
      const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-notify') delete c.classData; (b.boundaries ?? []).forEach(walk) }
      walk(m.structure.defaultBoundary)
      // Unclassified, it holds only the keys the workflow asks for: its class's own fields come with the class.
      stripClassFields(m, 'c-notify')
      delete m.dataFlows.find((f) => f.id === 'f-audit')!.classData
      // A transit alias counts only as a field of the flow's class: unclassified, the flow holds none.
      delete m.attributes.dataFlows['f-audit']?.attributes.flow_tls_encrypted
      delete m.dataItems.find((i) => i.id === 'd-audit')!.classData
    })
    await registerAll(dir)
    await editStructure(dir, (s) => { component(s, 'c-notify').classData = { id: 'cls-service', name: 'Application Service' } })
    const flows = JSON.parse(readFileSync(path.join(dir, 'dataflows.json'), 'utf8'))
    flows.find((f: any) => f.id === 'f-audit').classData = { id: 'cls-query', name: 'Database Query' }
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify(flows))
    const items = JSON.parse(readFileSync(path.join(dir, 'data-items.json'), 'utf8'))
    items.find((i: any) => i.id === 'd-audit').classData = DATA
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify(items))
    const g = await get(dir)
    // Nothing orphaned, and only the new classes (and the data item's new label in the lists that carry it) to confirm.
    expect(g.orphaned_registrations.total).toBe(0)
    expect(rowsOf(g).filter((r: string) => !r.includes('record:dataItemIds')).sort()).toEqual(['c-notify.record:classData', 'd-audit.record:classData', 'f-audit.record:classData'])
    await registerAll(dir)
    expect(await get(dir)).toMatchObject({ orphaned_registrations: { total: 0 }, unregistered_changes: { rows_total: 0 } })
  })

  it('orphans on a class change, and on a first class that comes with another label', async () => {
    const dir = await model((m) => {
      const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-notify') delete c.classData; (b.boundaries ?? []).forEach(walk) }
      walk(m.structure.defaultBoundary)
      // Unclassified, it holds only the keys the workflow asks for: its class's own fields come with the class.
      stripClassFields(m, 'c-notify')
    })
    await registerAll(dir)
    await editStructure(dir, (s) => { const c = component(s, 'c-notify'); c.classData = { id: 'cls-service', name: 'Application Service' }; c.name = 'Mailer' })
    expect((await get(dir)).orphaned_registrations.elements).toEqual(expect.arrayContaining([{ group: 'components', name: 'Application / Notifier', cause: 'removed', values: expect.any(Number) }]))
    await registerAll(dir)
    await editStructure(dir, (s) => { component(s, 'c-orders').classData = { id: 'cls-gateway', name: 'API Gateway' } })
    const changed = await get(dir)
    expect(changed.orphaned_registrations.elements).toEqual(expect.arrayContaining([{ group: 'components', name: 'Application / Order service', cause: 'reclassified', values: expect.any(Number) }]))
    // The old class's fields the new class lacks are leftovers no decision can register as they are.
    expect(rowsOf(changed)).toContain('c-orders.input_validation:off_template_field')
  })

  it('pins what catches a deleted crown-jewel element: C6 when it was a jewel\'s only element', async () => {
    const dir = await model()
    await registerAll(dir)
    await editStructure(dir, (s) => {
      const data = s.defaultBoundary.boundaries.find((b: any) => b.id === 'b-data')
      data.components = data.components.filter((c: any) => c.id !== 'c-db')
    })
    const gates = ((await validateModelTool.run({ action: 'gates', directory_path: dir } as never, context)) as any).data
    expect(gates.gate3.criteria.C6.verdict).toBe('FAIL')
    expect(gates.gate3.report.crown_jewel_map.dangling_ids).toContain('c-db')
  })
})

describe('row codes', () => {
  it('flags values written on elements, orphan files, colliding labels, doubled files and unlisted field names', async () => {
    const dir = await model((m) => {
      m.dataFlows.find((f) => f.id === 'f-notify')!.attributes = { encryption_in_transit: 'none' }
      m.attributes.components['c-ghost'] = { elementId: 'c-ghost', elementType: 'component', elementName: 'Ghost', attributes: { runs_as_root: true } }
      m.attributes.components['c-web']!.attributes['bad field!'] = 'x'
      const batch = m.structure.defaultBoundary.boundaries.find((b: any) => b.id === 'b-batch')
      batch.components.find((c: any) => c.id === 'c-report').name = 'Job runner'
    })
    await fs.writeFile(path.join(dir, 'attributes', 'components', 'c-orders-copy.json'),
      JSON.stringify({ elementId: 'c-orders', elementType: 'component', elementName: 'Order service', attributes: { input_validation: 'none' } }))
    const coded = rowsOf(await get(dir)).filter((r: string) => /:[a-z_]+$/.test(r) && !r.endsWith(':removed'))
    expect(coded).toEqual(expect.arrayContaining([
      'f-notify.encryption_in_transit:inline_attributes',
      'c-ghost.runs_as_root:orphan_attributes',
      'c-jobs.input_validation:label_collision',
      'c-report.record:classData:label_collision',
      'c-orders.input_validation:ambiguous_attribute_file',
      'c-web.(unlisted field):unlisted_field',
    ]))
    const refused = await settle(dir, [
      { group: 'dataFlows', element_id: 'f-notify', field: 'encryption_in_transit', decision: 'confirm', value: 'none' },
      { group: 'components', element_id: 'c-ghost', field: 'runs_as_root', decision: 'confirm', value: true },
      attrItem(dir, 'c-jobs', 'input_validation'),
    ])
    expect(refused.data.refused.map((r: any) => r.code)).toEqual(['inline_attributes', 'orphan_attributes', 'label_collision'])
  })
})

describe('a baseline that does not verify', () => {
  it('tampered: registers nothing, so its values block as rows; confirming them recovers', async () => {
    const dir = await model(undefined, ENRICHING, { testFields: false })
    await registerAll(dir)
    const doc = JSON.parse(readFileSync(baselineFile(dir), 'utf8'))
    const k = Object.keys(doc.values)[0]!
    doc.values[k] = doc.values[k].replace(/^./, (c: string) => (c === '0' ? '1' : '0'))
    await fs.writeFile(baselineFile(dir), JSON.stringify(doc))
    const g = await get(dir)
    expect(g).toMatchObject({ baseline: 'unverified', baseline_code: 'tampered' })
    expect(g.unregistered_changes.rows_total).toBeGreaterThan(0)
    const t = await transition(dir)
    expect(t.data.codes).toEqual(['unregistered_changes'])
    const push = await updateModelTool.run({ model_id: 'model-1', directory_path: dir } as never, { debug: false, apolloClient: {} as any })
    expect(push.error).toMatch(/unregistered_changes/)
    const first = await settle(dir, [attrItem(dir, 'c-web', 'input_validation')])
    expect(first.data.note).toMatch(/did not verify \(tampered\)/)
    await registerAll(dir)
    expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
  })

  it('deleted: every value is unregistered again, and confirming recovers', async () => {
    const dir = await model()
    await registerAll(dir)
    await fs.rm(baselineFile(dir))
    expect(await get(dir)).toMatchObject({ baseline: 'missing', baseline_code: 'rolled_back' })
    await registerAll(dir)
    expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
  })

  it('restored from an older revision: rolled back', async () => {
    const dir = await model()
    await registerAll(dir)
    const older = readFileSync(baselineFile(dir))
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    await settle(dir, [attrItem(dir, 'c-web', 'input_validation')])
    await fs.writeFile(baselineFile(dir), older)
    expect(await get(dir)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })

  it('an edited revision in a file that does not verify cannot push the revisions out of reach', async () => {
    const dir = await model()
    await registerAll(dir)
    const doc = JSON.parse(readFileSync(baselineFile(dir), 'utf8'))
    doc.revision = 2 ** 53 - 1
    await fs.writeFile(baselineFile(dir), JSON.stringify(doc))
    expect((await get(dir)).baseline_code).toBe('tampered')
    await registerAll(dir)
    expect(JSON.parse(readFileSync(baselineFile(dir), 'utf8')).revision).toBeLessThan(20)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    await settle(dir, [attrItem(dir, 'c-web', 'input_validation')])
    const earlier = readFileSync(baselineFile(dir))
    await editAttrs(dir, 'components', 'c-orders', (a) => { a.input_validation = 'allow_list' })
    await settle(dir, [attrItem(dir, 'c-orders', 'input_validation')])
    await fs.writeFile(baselineFile(dir), earlier)
    expect(await get(dir)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })

  it('a call that finds nothing to do still records the newest baseline on this machine', async () => {
    const dir = await model()
    await registerAll(dir)
    const older = readFileSync(baselineFile(dir))
    await editAttrs(dir, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    const item = attrItem(dir, 'c-web', 'input_validation')
    await settle(dir, [item])
    // As if the call had failed after signing the baseline, before recording it here.
    const pointer = JSON.parse(readFileSync(pointerFile(), 'utf8'))
    for (const m of Object.values(pointer.models) as Array<{ revision: number }>) m.revision -= 1
    await fs.writeFile(pointerFile(), JSON.stringify(pointer), { mode: 0o600 })
    expect((await settle(dir, [item])).data).toMatchObject({ recorded: 0, already_settled: [0] })
    await fs.writeFile(baselineFile(dir), older)
    expect(await get(dir)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })

  it('another machine: other_key, and its values are confirmed here', async () => {
    const dir = await model()
    await registerAll(dir)
    await freshHome()
    const g = await get(dir)
    expect(g).toMatchObject({ baseline: 'unverified', baseline_code: 'other_key' })
    expect(g.unregistered_changes.rows_total).toBeGreaterThan(0)
    await registerAll(dir)
    expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
  })
})

describe('moves and copies: one directory keeps the registrations', () => {
  it('a moved model carries its baseline; the first write retires the old path', async () => {
    const dir = await model()
    await registerAll(dir)
    const signed = readFileSync(baselineFile(dir))
    const moved = `${dir}-moved`
    await fs.rename(dir, moved)
    expect(await get(moved)).toMatchObject({ baseline: 'verified', baseline_carried: true, unregistered_changes: { rows_total: 0 } })
    await editAttrs(moved, 'components', 'c-web', (a) => { a.input_validation = 'allow_list' })
    await settle(moved, [attrItem(moved, 'c-web', 'input_validation')])
    const g = await get(moved)
    expect(g).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
    expect(g).not.toHaveProperty('baseline_carried')
    // A restore of the old path's latest file is older than the retired source.
    await writeGateModel(dir, gateModel())
    await fs.writeFile(baselineFile(dir), signed)
    expect(await get(dir)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })

  it('a copy verifies until one of the two writes; the other then reads rolled back', async () => {
    const a = await model()
    await registerAll(a)
    const c = `${a}-copy`
    await fs.cp(a, c, { recursive: true })
    expect(await get(c)).toMatchObject({ baseline: 'verified', baseline_carried: true })
    await editAttrs(c, 'components', 'c-web', (x) => { x.input_validation = 'allow_list' })
    await settle(c, [attrItem(c, 'c-web', 'input_validation')])
    expect(await get(c)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
    expect(await get(a)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })

  it('copy-back: the copy\'s file placed in the original after it moved on reads rolled back', async () => {
    const a = await model()
    await registerAll(a)
    const c = `${a}-copy`
    await fs.cp(a, c, { recursive: true })
    await editAttrs(a, 'components', 'c-web', (x) => { x.session_timeout = 900 })
    await settle(a, [attrItem(a, 'c-web', 'session_timeout')])
    await fs.copyFile(baselineFile(c), baselineFile(a))
    expect(await get(a)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })

  it('a graft: another model\'s file placed in a directory this machine signed for reads rolled back', async () => {
    const a = await model()
    const b = await model()
    await registerAll(a)
    await registerAll(b)
    await fs.copyFile(baselineFile(a), baselineFile(b))
    expect(await get(b)).toMatchObject({ baseline: 'unverified', baseline_code: 'rolled_back' })
  })
})

describe('one model, however its path is spelled', () => {
  it('reads a model through a symlink, and through another letter case where the file system ignores case, as itself', async () => {
    const dir = await model()
    await registerAll(dir)
    const link = `${dir}-link`
    await fs.symlink(dir, link)
    const viaLink = await get(link)
    expect(viaLink).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
    expect(viaLink).not.toHaveProperty('baseline_carried')
    const variant = path.join(path.dirname(dir), path.basename(dir).toUpperCase())
    if (variant !== dir && existsSync(variant)) {
      const viaCase = await get(variant)
      expect(viaCase).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
      expect(viaCase).not.toHaveProperty('baseline_carried')
    }
  })

  it('reads a baseline of the earlier format as malformed: its values are confirmed again', async () => {
    const dir = await model()
    await fs.writeFile(baselineFile(dir), JSON.stringify({
      version: 1, v: 1, initialized: true, revision: 1, key_id: 'a'.repeat(16), model_hash: 'b'.repeat(64), values: {}, signed_at: '2026-09-27T00:00:00.000Z', mac: 'c'.repeat(64),
    }))
    const g = await get(dir)
    expect(g).toMatchObject({ baseline: 'unverified', baseline_code: 'malformed' })
    expect(g.unregistered_changes.rows_total).toBeGreaterThan(0)
  })
})

describe('what a value may hold, and which row a pending entry is', () => {
  it('refuses a carriage return that is not part of a line break', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.notes = 'First.\rOverwritten.' })
    const r = await settle(dir, [attrItem(dir, 'c-web', 'notes')])
    expect(r.data.refused[0].code).toBe('unclean_value')
    await editAttrs(dir, 'components', 'c-web', (a) => { a.notes = 'First.\r\nSecond.' })
    expect((await settle(dir, [attrItem(dir, 'c-web', 'notes')])).data).toMatchObject({ recorded: 1 })
  })

  it('shows the removal of an attribute while a record row of the same name is pending, as settle reads them', async () => {
    const dir = await model(segmentClass)
    await fs.mkdir(path.join(dir, 'attributes', 'boundaries'), { recursive: true })
    await fs.writeFile(attrPath(dir, 'boundaries', 'b-app'), JSON.stringify({ elementId: 'b-app', elementType: 'boundary', elementName: 'Application', attributes: { zone: 'segment-7' } }))
    await registerAll(dir)
    // The attribute goes, while a pending row names the record field of that name.
    await editAttrs(dir, 'boundaries', 'b-app', (a) => { delete a.zone })
    await writePending(dir, [pending({ group: 'boundaries', element_id: 'b-app', field: 'zone', value: 'INTERNAL' })])
    expect(rowsOf(await get(dir))).toContain('b-app.zone:removed')
    // The class template declares an attribute zone, so the name alone does not say which: the item says it.
    const unsaid = await settle(dir, [{ group: 'boundaries', element_id: 'b-app', field: 'zone', decision: 'confirm', value: null, removed: true }])
    expect(unsaid.data.refused.map((r: any) => r.code)).toEqual(['ambiguous_field'])
    const removal = await settle(dir, [{ group: 'boundaries', element_id: 'b-app', field: 'zone', record: false, decision: 'confirm', value: null, removed: true }])
    expect(removal.data).toMatchObject({ recorded: 1 })
  })

  it('confirms a value written over several lines', async () => {
    const dir = await model()
    await registerAll(dir)
    await editAttrs(dir, 'components', 'c-web', (a) => { a.notes = 'First line.\nSecond line.\tTabbed.' })
    expect((await settle(dir, [attrItem(dir, 'c-web', 'notes')])).data).toMatchObject({ recorded: 1 })
  })

  it('refuses a field name it cannot show with the row\'s own code', async () => {
    const dir = await model()
    const r = await settle(dir, [{ group: 'components', element_id: 'c-web', field: 'bad field!', decision: 'confirm', value: 'x' }])
    expect(r.data.refused[0].code).toBe('unlisted_field')
  })

  it('keeps a record and an attribute of the same name apart: the attribute\'s pending row never blocks the record', async () => {
    const dir = await model(segmentClass)
    await registerAll(dir)
    await fs.mkdir(path.join(dir, 'attributes', 'boundaries'), { recursive: true })
    await fs.writeFile(attrPath(dir, 'boundaries', 'b-app'), JSON.stringify({ elementId: 'b-app', elementType: 'boundary', elementName: 'Application', attributes: { zone: 'segment-7' } }))
    await writePending(dir, [pending({ group: 'boundaries', element_id: 'b-app', field: 'zone', value: 'segment-7' })])
    await editStructure(dir, (s) => { s.defaultBoundary.boundaries.find((b: any) => b.id === 'b-app').zone = 'RESTRICTED' })
    const record = await settle(dir, [{ group: 'boundaries', element_id: 'b-app', field: 'zone', record: true, decision: 'confirm', value: 'RESTRICTED' }])
    expect(record.data).toMatchObject({ recorded: 1 })
    const attribute = await settle(dir, [{ group: 'boundaries', element_id: 'b-app', field: 'zone', record: false, decision: 'accept', value: 'segment-7' }])
    expect(attribute.data).toMatchObject({ recorded: 1 })
    expect(pendingEntries(dir)).toEqual([])
  })
})

describe('this machine\'s key and pointer file', () => {
  it('a key that cannot be used: unavailable, nothing settles, REVIEWED is blocked', async () => {
    const dir = await model(undefined, ENRICHING, { testFields: false })
    await registerAll(dir)
    await fs.chmod(path.join(home, '.dethernety', 'waiver.key'), 0o644)
    expect(await get(dir)).toMatchObject({ baseline: 'unavailable', baseline_code: 'key_mode' })
    expect((await settle(dir, [attrItem(dir, 'c-web', 'input_validation')])).data.codes).toEqual(['baseline_key_unavailable'])
    expect((await transition(dir)).data.codes).toContain('baseline_key_unavailable')
    process.env.HOME = await fs.mkdtemp(path.join(root, 'home-'))
    expect(await get(dir)).toMatchObject({ baseline: 'unavailable', baseline_code: 'key_in_project' })
  })

  it('a pointer file that cannot be trusted fails closed, and is never overwritten', async () => {
    const dir = await model(undefined, ENRICHING, { testFields: false })
    await registerAll(dir)
    expect(statSync(pointerFile()).mode & 0o777).toBe(0o600)
    await fs.chmod(pointerFile(), 0o644)
    expect(await get(dir)).toMatchObject({ baseline: 'unavailable', baseline_code: 'pointer_unavailable' })
    expect((await settle(dir, [attrItem(dir, 'c-web', 'input_validation')])).data.codes).toEqual(['pointer_unavailable'])
    expect((await transition(dir)).data.codes).toContain('pointer_unavailable')
    const push = await updateModelTool.run({ model_id: 'model-1', directory_path: dir } as never, { debug: false, apolloClient: {} as any })
    expect(push.error).toMatch(/pointer_unavailable/)
    await fs.chmod(pointerFile(), 0o600)
    expect(await get(dir)).toMatchObject({ baseline: 'verified' })
  })

  it('two settlements at once both record their revisions (the pointer is updated under its lock)', async () => {
    const [a, b] = [await model(), await model()]
    await Promise.all([registerAll(a), registerAll(b)])
    const models = JSON.parse(readFileSync(pointerFile(), 'utf8')).models
    expect(Object.keys(models)).toHaveLength(2)
    // Each model's latest file is at its pointer: neither update was lost.
    for (const dir of [a, b]) {
      expect(Object.values(models).map((m: any) => m.revision)).toContain(JSON.parse(readFileSync(baselineFile(dir), 'utf8')).revision)
      expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
    }
  })

  it('refuses to record a model past the pointer file\'s capacity, rather than drop another model\'s entry', async () => {
    const { updateBaselinePointers, withPointerLock } = await import('../../utils/gates.js')
    const dir = await model()
    await registerAll(dir)
    const before = readFileSync(pointerFile(), 'utf8')
    await expect(withPointerLock((lock) => updateBaselinePointers({ ['f'.repeat(64)]: 1 }, lock, undefined, { max: 1 }))).rejects.toThrow(/pointer unavailable/)
    expect(readFileSync(pointerFile(), 'utf8')).toBe(before)
  })

  it('stores hashes only: neither the pointer file nor the baseline names the model path', async () => {
    const dir = await model()
    await registerAll(dir)
    for (const text of [readFileSync(pointerFile(), 'utf8'), readFileSync(baselineFile(dir), 'utf8')]) {
      expect(text).not.toContain(dir)
      expect(text).not.toContain('TLS 1.3')
    }
  })
})

describe('a push', () => {
  it('keeps the baseline verified when the platform re-keys every element', async () => {
    const dir = await model()
    await registerAll(dir)
    const local = await readModelDirectory(dir)
    const ids = [
      ...local.dataFlows.map((f) => f.id), ...local.dataItems.map((i) => i.id),
      ...JSON.stringify(local.structure).match(/"id":"[^"]+"/g)!.map((x) => x.slice(6, -1)),
    ]
    await applyIdMapping(dir, new Map(ids.map((id, i) => [id, `uuid-${i}`])), 'model-1')
    expect(await get(dir)).toMatchObject({ baseline: 'verified', unregistered_changes: { rows_total: 0 } })
  })

  it('update_model refuses unregistered values before any platform call, and names the remedy', async () => {
    const dir = await model()
    const push = await updateModelTool.run({ model_id: 'model-1', directory_path: dir } as never, { debug: false, apolloClient: {} as any })
    expect(push.success).toBe(false)
    expect(push.error).toMatch(/unregistered_changes/)
    expect(push.error).toMatch(/model_state get with include \['unregistered_rows'\] lists the rows/)
    expect(push.error).not.toContain(dir)
  })
})
