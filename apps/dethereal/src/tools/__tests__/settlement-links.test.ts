/**
 * The data items an element links, as the settlement registers them: by the
 * item's name, and by its class only where another item has the same name. A
 * first class or a reclassification is asked on the item, never again on every
 * link; any change to which items are linked is still a row.
 *
 * Every test runs with its own HOME, so this machine's key and its pointer file
 * never carry over from another test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import { modelStateSettleTool } from '../model-state-settle.tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { elementRefs, loadGateInput, recordProjector, updateBaselinePointers, waiverKeyState, withPointerLock } from '../../utils/gates.js'
import { contentOf, entryKey, modelHashOf, parseBaseline, signedBaseline, valueHash, type BaselineContent } from '../../utils/settlement.js'
import { payloadDrift, payloadValues } from '../../utils/settlement-state.js'
import { registerAll, type Row } from './helpers/settle.js'

// Each test registers whole models (several settle calls): slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-settlement-links-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-settlement-links-homes-')))
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
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const OTHER_CLASS = { id: 'cls-other-data', name: 'Other data' }

/** A registered model directory. */
async function registered(mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
  await registerAll(dir)
  return dir
}

const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows', 'pending_rows'] }, context)) as any).data
const rows = async (dir: string): Promise<Row[]> => (await get(dir)).unregistered_changes.rows
/** The link rows: `[holder id, code]`, sorted. */
const linkRows = async (dir: string) => (await rows(dir)).filter((r) => r.field === 'dataItemIds').map((r) => [r.element_id, r.code ?? null]).sort()
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const editJson = async (p: string, fn: (d: any) => void) => {
  const d = readJson(p)
  fn(d)
  await fs.writeFile(p, JSON.stringify(d, null, 2))
}
const editItems = (dir: string, fn: (items: any[]) => void) => editJson(path.join(dir, 'data-items.json'), (d) => fn(Array.isArray(d) ? d : d.dataItems))
const item = (items: any[], id: string) => items.find((i) => i.id === id)
const editFlow = (dir: string, id: string, fn: (f: any) => void) =>
  editJson(path.join(dir, 'dataflows.json'), (d) => fn((Array.isArray(d) ? d : d.dataFlows).find((f: any) => f.id === id)))
/** A data item beside the fixture's, linked from nothing. */
const addItem = (m: GateModel, id: string, name: string, classData: unknown) =>
  m.dataItems.push({ id, name, description: `${name}.`, ...(classData ? { classData } : {}), sensitivity: 'internal', regulatory_flags: [] })

describe('a data item class is asked on the item, never again on its links', () => {
  it('shows no link row when a linked item gets its first class', async () => {
    const dir = await registered((m) => {
      addItem(m, 'd-new', 'Receipt', null)
      m.dataFlows.find((f) => f.id === 'f-checkout')!.dataItemIds.push('d-new')
    })
    await editItems(dir, (items) => { item(items, 'd-new').classData = { id: OTHER_CLASS.id, name: OTHER_CLASS.name } })
    expect(await linkRows(dir)).toEqual([])
    expect((await rows(dir)).filter((r) => r.element_id === 'd-new').map((r) => r.field)).toContain('classData')
  })

  it('shows no link row when a linked item is reclassified; the item itself is asked again', async () => {
    const dir = await registered()
    await editItems(dir, (items) => { item(items, 'd-card').classData = { id: OTHER_CLASS.id, name: OTHER_CLASS.name } })
    expect(await linkRows(dir)).toEqual([])
    const g = await get(dir)
    expect(g.orphaned_registrations.elements).toEqual([{ group: 'dataItems', name: 'Card data', cause: 'reclassified', values: expect.any(Number) }])
    // The push gate reads the same.
    const { drift } = await payloadDrift(dir, await loadGateInput(dir))
    expect(drift.rows.filter((r) => r.field === 'dataItemIds')).toEqual([])
  })
})

describe('any change to which items an element links is a row', () => {
  it('asks again when a linked item is renamed, on every element linking it', async () => {
    const dir = await registered()
    await editItems(dir, (items) => { item(items, 'd-card').name = 'Payment card' })
    expect(await linkRows(dir)).toEqual([['c-db', null], ['f-checkout', null], ['f-write', null]])
  })

  it('asks for a link added, removed, doubled, or pointed at no item', async () => {
    for (const change of [
      (f: any) => f.dataItemIds.push('d-order'),
      (f: any) => f.dataItemIds.splice(0, 1),
      (f: any) => f.dataItemIds.push('d-card'),
      (f: any) => { f.dataItemIds[0] = 'd-gone' },
    ]) {
      const dir = await registered()
      await editFlow(dir, 'f-checkout', change)
      expect(await linkRows(dir)).toEqual([['f-checkout', null]])
    }
  })

  it('tells apart items that share a name by their class, linked or not', async () => {
    // "Receipt" twice, two classes, one linked from one flow and the other from nothing: moving the link is a row.
    const dir = await registered((m) => {
      addItem(m, 'd-x', 'Receipt', { id: 'cls-a', name: 'Class A' })
      addItem(m, 'd-y', 'Receipt', OTHER_CLASS)
      m.dataFlows.find((f) => f.id === 'f-checkout')!.dataItemIds.push('d-x')
    })
    await editFlow(dir, 'f-checkout', (f) => { f.dataItemIds[f.dataItemIds.indexOf('d-x')] = 'd-y' })
    expect(await linkRows(dir)).toEqual([['f-checkout', null]])
  })

  it('reads the name trimmed, as the item label does, and with its case', async () => {
    // "Card data " is "Card data": the two share the name, so their classes tell them apart.
    const spaced = await registered((m) => addItem(m, 'd-card2', 'Card data ', OTHER_CLASS))
    await editFlow(spaced, 'f-checkout', (f) => { f.dataItemIds[f.dataItemIds.indexOf('d-card')] = 'd-card2' })
    expect(await linkRows(spaced)).toEqual([['f-checkout', null]])
    // "card data" is another name, even in the same class.
    const cased = await registered((m) => addItem(m, 'd-card2', 'card data', m.dataItems.find((i) => i.id === 'd-card')!.classData))
    await editFlow(cased, 'f-checkout', (f) => { f.dataItemIds[f.dataItemIds.indexOf('d-card')] = 'd-card2' })
    expect(await linkRows(cased)).toEqual([['f-checkout', null]])
  })

  it('never reads a name holding the class separator as another name with a class', async () => {
    // "A" twice (two classes), and an item whose name spells the first one's name and class: all three stay apart.
    for (const spelled of ['A#cls-a', `A#${JSON.stringify('cls-a')}`, `"A"#"cls-a"`]) {
      const dir = await registered((m) => {
        addItem(m, 'd-x', 'A', { id: 'cls-a', name: 'Class A' })
        addItem(m, 'd-y', 'A', OTHER_CLASS)
        addItem(m, 'd-w', spelled, OTHER_CLASS)
        m.dataFlows.find((f) => f.id === 'f-checkout')!.dataItemIds = ['d-x']
      })
      await editFlow(dir, 'f-checkout', (f) => { f.dataItemIds = ['d-w'] })
      expect([spelled, await linkRows(dir)]).toEqual([spelled, [['f-checkout', null]]])
    }
  })

  it('asks for the links of both items when an item is renamed onto another one\'s name', async () => {
    const dir = await registered((m) => addItem(m, 'd-other', 'Receipt', OTHER_CLASS))
    await editItems(dir, (items) => { item(items, 'd-other').name = 'Card data' })
    // Nothing links the renamed item; every element linking the one whose name it took is asked again.
    expect(await linkRows(dir)).toEqual([['c-db', null], ['f-checkout', null], ['f-write', null]])
  })

  it('asks for the links of an item that shares its name when it is reclassified', async () => {
    const dir = await registered((m) => addItem(m, 'd-card2', 'Card data', OTHER_CLASS))
    await editItems(dir, (items) => { item(items, 'd-card').classData = { id: 'cls-third', name: 'Third' } })
    expect(await linkRows(dir)).toEqual([['c-db', null], ['f-checkout', null], ['f-write', null]])
  })
})

describe('items that cannot be told apart', () => {
  it('never registers a link to one of two items with the same name and class', async () => {
    const dir = await registered()
    const card = gateModel().dataItems.find((i) => i.id === 'd-card')!
    await editItems(dir, (items) => items.push({ ...card, id: 'd-card2' }))
    expect(await linkRows(dir)).toEqual([['c-db', 'label_collision'], ['f-checkout', 'label_collision'], ['f-write', 'label_collision']])
    const flow = readJson(path.join(dir, 'dataflows.json')).find((f: any) => f.id === 'f-checkout')
    const r = await modelStateSettleTool.run({
      action: 'settle', directory_path: dir, reply: 'Confirmed.',
      items: [{ group: 'dataFlows', element_id: 'f-checkout', field: 'dataItemIds', record: true, decision: 'confirm', value: flow.dataItemIds }],
    } as never, context) as any
    expect(r.success).toBe(false)
    expect(r.data.refused).toEqual([expect.objectContaining({ code: 'label_collision', message: expect.stringContaining('rename or reclassify one of them') })])
    // Nor by set, a removal, or accepting a pending row.
    const link = { group: 'dataFlows', element_id: 'f-checkout', field: 'dataItemIds', record: true }
    await fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 1, entries: [
      { batch: 'b1', group: 'dataFlows', element_id: 'f-checkout', field: 'dataItemIds', value: flow.dataItemIds, source: 'app/server.py:12', previous: 'absent' },
    ] }))
    for (const decision of [
      { ...link, decision: 'set', element_name: 'Checkout request', value: flow.dataItemIds },
      { ...link, decision: 'confirm', value: null, removed: true },
      { ...link, decision: 'accept', value: flow.dataItemIds },
    ]) {
      const refused = await modelStateSettleTool.run({ action: 'settle', directory_path: dir, reply: 'Confirmed.', items: [decision] } as never, context) as any
      expect([decision.decision, refused.data?.refused?.[0]?.code]).toEqual([decision.decision, 'label_collision'])
    }
    // A pull never registers it either: the value carries the code.
    const { values } = payloadValues(await loadGateInput(dir))
    expect(values.find((v) => v.group === 'dataFlows' && v.id === 'f-checkout' && v.field === 'dataItemIds')?.code).toBe('label_collision')
  })

  it('makes a reclassification into a namesake\'s class a collision', async () => {
    const dir = await registered((m) => addItem(m, 'd-card2', 'Card data', OTHER_CLASS))
    await editItems(dir, (items) => { item(items, 'd-card').classData = { id: OTHER_CLASS.id, name: OTHER_CLASS.name } })
    expect((await linkRows(dir)).map(([, code]) => code)).toEqual(['label_collision', 'label_collision', 'label_collision'])
  })
})

describe('the projection', () => {
  it('names a link by the item, quoted after its own prefix; the element labels stay as they were', () => {
    const m = gateModel()
    addItem(m, 'd-card2', 'Card data', OTHER_CLASS)
    addItem(m, 'd-blank', '', null)
    m.dataFlows.find((f) => f.id === 'f-audit')!.dataItemIds = ['d-audit', 'd-blank']
    const records = recordProjector(m as never)
    const links = (id: string) => new Set(records.values.find((v) => v.id === id && v.field === 'dataItemIds')!.projected as string[])
    const cardClass = m.dataItems.find((i) => i.id === 'd-card')!.classData.id
    expect(links('f-checkout')).toEqual(new Set([`I:"Card data"#"${cardClass}"`, 'I:"Session token"']))
    // An unnamed item's link is kept.
    expect(links('f-audit')).toEqual(new Set(['I:""', 'I:"Audit event"']))
    expect(elementRefs(m as never).dataItems.get('d-card')!.label).toBe(`D:Card data#${cardClass}`)
  })

  it('asks once again for a link registered before links were named this way', async () => {
    const dir = await registered()
    const input = await loadGateInput(dir)
    const ref = elementRefs(input).dataFlows.get('f-checkout')!
    const labels = new Map(input.dataItems.map((i) => [i.id, `D:${i.name}#${i.classData?.id ?? ''}`]))
    const flow = input.dataFlows.find((f) => f.id === 'f-checkout')!
    await resign(dir, (c) => { c.values[entryKey(ref, 'record', 'dataItemIds')] = valueHash((flow.dataItemIds ?? []).map((d) => labels.get(d)).sort()) })
    expect(await linkRows(dir)).toEqual([['f-checkout', null]])
    await registerAll(dir)
    expect(await linkRows(dir)).toEqual([])
  })
})

/** Re-sign the directory's verified baseline with changes, as this machine. */
async function resign(dir: string, change: (c: BaselineContent) => void): Promise<void> {
  const key = (await waiverKeyState(true, dir)).key!
  const modelHash = modelHashOf(key, await fs.realpath(dir))
  const file = path.join(dir, '.dethereal', 'settlement-baseline.json')
  const parsed = parseBaseline(readFileSync(file))!
  const content = contentOf(parsed)
  change(content)
  content.revision = parsed.revision + 1
  await fs.writeFile(file, signedBaseline(key, modelHash, content))
  await withPointerLock((lock) => updateBaselinePointers({ [modelHash]: content.revision }, lock, dir))
}
