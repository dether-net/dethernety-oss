/**
 * model_state_settle's compact forms: a confirm or accept of the value the file already holds is echoed under its
 * element with its value, and such decisions may be sent as `confirm` / `accept` maps keyed
 * `<group>/<element_id>/<field>`, each entry exactly the item it stands for.
 *
 * Every test runs with its own HOME, so this machine's key and pointer never carry over.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Row } from './helpers/settle.js'

const { modelStateTool } = await import('../model-state.tool.js')
const { modelStateSettleTool, splitEcho, MAP_LIMITS } = await import('../model-state-settle.tool.js')
const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
const { confirmItem } = await import('./helpers/settle.js')
const { inputStrings } = await import('../../acceptance/score/h4.js')

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-settle-compact-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-settle-compact-homes-')))
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
  modelStateSettleTool.storeOptions = {}
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const REPLY = 'Confirmed as shown.'

/** A model nobody has registered yet. */
async function model(): Promise<string> {
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, gateModel())
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
  return dir
}
const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'] }, context)) as any).data
const settle = (dir: string, input: Record<string, unknown>) =>
  modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: REPLY, items: [], ...input } as never, context) as Promise<any>
const rowsOf = async (dir: string): Promise<Row[]> => (await get(dir)).unregistered_changes.rows
const keyOf = (r: Row) => `${r.group}/${r.element_id}/${r.field}`
const valueOf = (dir: string, r: Row) => (confirmItem(dir, r) as { value: unknown }).value

describe('a confirm of the value the file holds', () => {
  it('is listed under its element with its value, records apart from attributes, and leaves the full echo', async () => {
    const dir = await model()
    const rows = (await rowsOf(dir)).filter((r) => r.element_id === 'c-web' && !r.removed && r.field !== 'controls')
    expect(rows.some((r) => r.record) && rows.some((r) => !r.record)).toBe(true)
    const r = await settle(dir, { items: rows.map((row) => confirmItem(dir, row)) })
    expect(r.success, r.error).toBe(true)
    expect(r.data.echo).toEqual([])
    const entry = r.data.registered_unchanged['components/c-web']
    expect(entry.name).toBe('Web frontend')
    for (const row of rows) expect((row.record ? entry.records : entry.attributes)[row.field]).toEqual(valueOf(dir, row))
    expect(r.data.recorded).toBe(rows.length)
  })

  it('keeps a full entry for everything that changes a value or hands', () => {
    const base = { decision: 'confirm', group: 'components', element_id: 'c-web', element_name: 'Web frontend', field: 'runs_as_root', value: { value: false }, previous: { value: false } }
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ['unregistered, same value', { previous_registered: 'unregistered' }, true],
      ["the operator's, same value", { previous_registered: { state: 'registered', by: 'operator' } }, true],
      ['registered by a pull', { previous_registered: { state: 'registered', by: 'pull' } }, false],
      ['registered as another value', { previous_registered: { state: 'registered_other', by: 'operator' } }, false],
      ['registered as empty', { previous_registered: 'registered_empty' }, false],
      ['a changed value', { value: { value: true }, previous_registered: 'unregistered' }, false],
      ['an undisplayable value', { value: { undisplayable: true, sha256: 'x' }, previous: { undisplayable: true, sha256: 'x' }, previous_registered: 'unregistered' }, false],
      ['an undisplayable name', { element_name: { undisplayable: true, sha256: 'x' }, previous_registered: 'unregistered' }, false],
      ['a controls list', { field: 'controls', record: true, value: { value: [] }, previous: { value: [] }, previous_registered: 'unregistered' }, false],
      ['a set of the same value', { decision: 'set', previous_registered: 'unregistered' }, false],
    ]
    for (const [label, extra, compact] of cases) {
      const { full, unchanged } = splitEcho([{ index: 0, ...base, ...extra }])
      expect(Object.keys(unchanged).length === 1, label).toBe(compact)
      expect(full.length === 1, label).toBe(!compact)
    }
  })

  it('keeps two elements of the same name apart: the group and id name the entry', () => {
    const e = (group: string, id: string) => ({ index: 0, decision: 'confirm', group, element_id: id, element_name: 'Orders', field: 'placement', record: true, value: { value: 'x' }, previous: { value: 'x' }, previous_registered: 'unregistered' })
    expect(Object.keys(splitEcho([e('components', 'c-orders'), e('dataItems', 'd-order')]).unchanged).sort()).toEqual(['components/c-orders', 'dataItems/d-order'])
  })
})

describe('the confirm map', () => {
  it('registers exactly what the same items would, values in the arguments', async () => {
    const a = await model()
    const b = await model()
    const rows = (await rowsOf(a)).filter((r) => !r.removed && r.field !== 'controls' && !r.code).slice(0, 40)
    const viaItems = await settle(a, { items: rows.map((row) => confirmItem(a, row)) })
    const viaMap = await settle(b, { confirm: Object.fromEntries(rows.map((row) => [keyOf(row), valueOf(b, row)])) })
    expect(viaItems.success, viaItems.error).toBe(true)
    expect(viaMap.success, viaMap.error).toBe(true)
    expect(viaMap.data.recorded).toBe(viaItems.data.recorded)
    expect(viaMap.data.registered_unchanged).toEqual(viaItems.data.registered_unchanged)
    const left = async (dir: string) => (await rowsOf(dir)).map(keyOf).sort()
    expect(await left(b)).toEqual(await left(a))
    const log = (dir: string) => JSON.parse(readFileSync(path.join(dir, '.dethereal', 'settlements.json'), 'utf8')).entries.at(-1)
    expect(log(b)).toMatchObject({ action: 'settle', items: rows.length, decisions: { confirm: rows.length } })
  })

  it('names the element and field to the push gate check through its keys', () => {
    const text = inputStrings({ action: 'settle', confirm: { 'boundaries/b-app/zone': 'INTERNAL' } })
    expect(text).toContain('b-app')
    expect(text).toContain('INTERNAL')
  })

  const refusals: Array<[string, (dir: string, rows: Row[]) => Record<string, unknown>, string]> = [
    ['a key of two parts', () => ({ confirm: { 'components/c-web': 'x' } }), 'bad_key'],
    ['a key of four parts', () => ({ confirm: { 'components/c-web/a/b': 'x' } }), 'bad_key'],
    ["the model's own record", () => ({ confirm: { 'model/@model/controls': [] } }), 'bad_key'],
    ['controls', () => ({ confirm: { 'components/c-web/controls': [] } }), 'record_field'],
    ['a null value', () => ({ confirm: { 'components/c-web/runs_as_root': null } }), 'value_required'],
    ['a long value', () => ({ confirm: { 'components/c-web/input_validation': 'x'.repeat(MAP_LIMITS.valueBytes + 1) } }), 'too_large'],
    ['a value the file does not hold', () => ({ confirm: { 'components/c-web/input_validation': 'none' } }), 'value_differs'],
    ['a field named in the items and the map', (dir, rows) => {
      const row = rows.find((r) => r.element_id === 'c-web' && r.field === 'runs_as_root')!
      return { items: [confirmItem(dir, row)], confirm: { [keyOf(row)]: valueOf(dir, row) } }
    }, 'duplicate_pending'],
  ]
  it.each(refusals)('refuses %s, and nothing is written', async (_label, build, code) => {
    const dir = await model()
    const before = await rowsOf(dir)
    const r = await settle(dir, build(dir, before))
    expect(r.success).toBe(false)
    expect(r.data.codes).toContain(code)
    expect((await rowsOf(dir)).length).toBe(before.length)
  })

  it('refuses a record field whose name the attribute bag also holds: that goes as an item', async () => {
    const dir = await model()
    const file = path.join(dir, 'attributes', 'components', 'c-web.json')
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    doc.attributes.placement = 'somewhere'
    await fs.writeFile(file, JSON.stringify(doc, null, 2))
    const row = (await rowsOf(dir)).find((r) => r.element_id === 'c-web' && r.field === 'placement' && r.record)!
    const r = await settle(dir, { confirm: { [keyOf(row)]: valueOf(dir, row) } })
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['ambiguous_field'])
    expect(r.data.refused[0]).toMatchObject({ index: null, key: keyOf(row) })
  })

  it(`takes at most ${MAP_LIMITS.decisions} decisions in one call`, async () => {
    const dir = await model()
    const confirm = Object.fromEntries(Array.from({ length: MAP_LIMITS.decisions + 1 }, (_, i) => [`components/c-web/f${i}`, 'x']))
    const r = await settle(dir, { confirm })
    expect(r.success).toBe(false)
    expect(r.data?.codes ?? []).toContain('too_many_items')
  })
})
