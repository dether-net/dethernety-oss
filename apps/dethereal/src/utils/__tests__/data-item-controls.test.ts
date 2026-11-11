/**
 * A data item's controls, once it has any, are part of what a review signs and what the settlement registers: adding
 * one moves the review hash and the item's waiver fingerprint. A data item without controls reads as before, so a
 * model from before data items carried controls keeps its review and its registrations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadGateInput, prepareWaiver, recordProjector, reviewContentHash } from '../gates.js'
import { gateModel, writeGateModel, type GateModel } from './fixtures/gate-model.js'
import { modelStateTool } from '../../tools/model-state.tool.js'
import { initProjectRoot, resetProjectRoot } from '../project-root.js'

vi.setConfig({ testTimeout: 30_000 })

let tmp: string
const savedHome = process.env.HOME
let seq = 0
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-item-controls-')))
  fs.mkdirSync(path.join(tmp, 'home'))
  process.env.HOME = path.join(tmp, 'home')
  initProjectRoot({ cwd: tmp, env: {} })
})
afterEach(() => {
  resetProjectRoot()
  process.env.HOME = savedHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

const CONTROL = { id: 'ctl-t', name: 'Tokenisation' }
async function dirOf(controls?: unknown, mutate?: (m: GateModel) => void): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  if (controls !== undefined) m.dataItems.find((i) => i.id === 'd-card')!.controls = controls
  const dir = path.join(tmp, `m${seq++}`)
  await writeGateModel(dir, m)
  return dir
}
/**
 * d-card in a class whose sensitivity floor comes from its name, not from the fixed table, below that floor: a C7
 * failure that may be waived, among enough items C7 assesses that one of them may be.
 */
function waivableCard(m: GateModel): void {
  const notes = { id: 'cls-customer-notes', name: 'Customer Notes' }
  Object.assign(m.dataItems.find((i) => i.id === 'd-card')!, { classData: notes, sensitivity: 'internal', regulatory_flags: [] })
  const db = m.structure.defaultBoundary.boundaries.flatMap((b: { components?: Array<{ id: string; dataItemIds?: string[] }> }) => b.components ?? [])
    .find((c: { id: string }) => c.id === 'c-db')
  for (let n = 1; n <= 6; n++) {
    m.dataItems.push({ id: `d-note-${n}`, name: `Customer note ${n}`, description: 'A note.', classData: notes, sensitivity: 'confidential', regulatory_flags: [] })
    db?.dataItemIds?.push(`d-note-${n}`)
  }
}

const hashOf = async (controls?: unknown) => reviewContentHash(await loadGateInput(await dirOf(controls)))

describe('a data item\'s controls', () => {
  it('leave the review hash as it was while the item has none, and move it once it has one', async () => {
    const before = await hashOf()
    expect(await hashOf([])).toBe(before)
    expect(await hashOf(null)).toBe(before)
    expect(await hashOf([CONTROL])).not.toBe(before)
    // The review keeps names only, as for the other elements.
    expect(await hashOf([{ ...CONTROL, id: 'ctl-other' }])).toBe(await hashOf([CONTROL]))
  })

  it('are a registered record value only once the item has one', async () => {
    const values = async (controls?: unknown) => recordProjector(await loadGateInput(await dirOf(controls))).values
      .filter((v) => v.group === 'dataItems' && v.field === 'controls')
    expect(await values()).toEqual([])
    expect(await values([])).toEqual([])
    expect(await values([CONTROL])).toEqual([expect.objectContaining({ id: 'd-card', projected: [{ id: 'ctl-t', name: 'Tokenisation' }] })])
  })

  it('move the item\'s waiver fingerprint once it has one', async () => {
    const fingerprint = async (controls?: unknown) => {
      const r = prepareWaiver(await loadGateInput(await dirOf(controls, waivableCard)), 'C7', ['d-card'])
      expect(r.refused, JSON.stringify(r.refused)).toEqual([])
      return r.fingerprints['d-card']
    }
    const before = await fingerprint()
    expect(before).toMatch(/^[0-9a-f]{64}$/)
    expect(await fingerprint([])).toBe(before)
    expect(await fingerprint([CONTROL])).not.toBe(before)
  })

  it('a control added to a reviewed data item makes the review stale', async () => {
    const dir = await dirOf([])
    fs.writeFileSync(path.join(dir, '.dethereal', 'state.json'), JSON.stringify({ currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'] }))
    // With the settlement off, only the gates and the review hash decide: nothing here is registered.
    const context = { debug: false, settlement: 'off' as const }
    const reviewed = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, context)
    expect(reviewed.success, reviewed.error).toBe(true)
    const get = async () => (await modelStateTool.run({ action: 'get', directory_path: dir }, context)).data as Record<string, unknown>
    expect(await get()).toMatchObject({ state: 'REVIEWED', reviewed_stale: false })
    const file = path.join(dir, 'data-items.json')
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    ;(Array.isArray(doc) ? doc : doc.dataItems).find((i: { id: string }) => i.id === 'd-card').controls = [CONTROL]
    fs.writeFileSync(file, JSON.stringify(doc))
    expect(await get()).toMatchObject({ state: 'REVIEWED', reviewed_stale: true })
  })
})

describe('controls that are not a list of control entries', () => {
  type Holder = 'model' | 'root' | 'boundary' | 'component' | 'flow' | 'item'
  const HOLDERS: readonly Holder[] = ['model', 'root', 'boundary', 'component', 'flow', 'item']
  /**
   * The review hash with `controls` set on the model, the root boundary b-root, boundary b-edge, component c-web, flow
   * f-submit and data item d-card, or on those named.
   */
  const hashWith = async (controls: unknown, on: readonly Holder[] = HOLDERS) => {
    const m = gateModel()
    const walk = (b: { id?: string; controls?: unknown; components?: Array<Record<string, unknown>>; boundaries?: unknown[] }) => {
      if (on.includes('root') && b.id === 'b-root') b.controls = controls
      if (on.includes('boundary') && b.id === 'b-edge') b.controls = controls
      for (const c of b.components ?? []) if (on.includes('component') && c.id === 'c-web') c.controls = controls
      for (const n of b.boundaries ?? []) walk(n as typeof b)
    }
    walk(m.structure.defaultBoundary as never)
    if (on.includes('model')) (m.manifest.model as Record<string, unknown>).controls = controls
    if (on.includes('flow')) m.dataFlows.find((f) => f.id === 'f-submit')!.controls = controls
    if (on.includes('item')) m.dataItems.find((i) => i.id === 'd-card')!.controls = controls
    const dir = path.join(tmp, `m${seq++}`)
    await writeGateModel(dir, m)
    return reviewContentHash(await loadGateInput(dir))
  }

  it('hash as before when absent, empty or well formed, and a control is still read by its name', async () => {
    const none = await hashWith(undefined)
    expect(await hashWith([])).toBe(none)
    expect(await hashWith(null)).toBe(none)
    expect(await hashWith([{ id: 'a', name: 'WAF' }])).toBe(await hashWith([{ id: 'b', name: 'WAF' }]))
  })

  it('move the hash when a value that is no list, or an entry that is no control, is written or changed', async () => {
    const none = await hashWith(undefined)
    const seen = new Set([none])
    for (const controls of ['WAF', { name: 'WAF' }, 7, '', 0, false, {}, ['WAF'], ['IDS'], [''], [null], [['WAF']], [{}]]) {
      const h = await hashWith(controls)
      expect(seen.has(h), JSON.stringify(controls)).toBe(false)
      seen.add(h)
    }
    expect(await hashWith({ name: 'WAF' })).not.toBe(await hashWith([{ name: 'WAF' }]))
  })

  it('count a control with a blank name, which the push still links by its id', async () => {
    const none = await hashWith(undefined)
    expect(await hashWith([{ id: 'ctl-1', name: '' }])).not.toBe(none)
    expect(await hashWith([{ id: 'ctl-1', name: '  ' }])).not.toBe(none)
    expect(await hashWith([{ name: 'WAF' }, { id: 'ctl-1', name: '' }])).not.toBe(await hashWith([{ name: 'WAF' }]))
    expect(await hashWith([{ id: 'ctl-1', name: '' }])).toBe(await hashWith([{}]))
  })

  it('move the hash on each kind of element alone', async () => {
    const none = await hashWith(undefined)
    for (const holder of HOLDERS) {
      for (const controls of ['WAF', [null], [{ id: 'ctl-1', name: '' }], [{ name: 'WAF' }]]) {
        expect(await hashWith(controls, [holder]), `${holder} ${JSON.stringify(controls)}`).not.toBe(none)
      }
    }
    // A control moved between the model and its root boundary is a change too.
    expect(await hashWith([{ name: 'WAF' }], ['model'])).not.toBe(await hashWith([{ name: 'WAF' }], ['root']))
  })

  it('read a name as the push matches it: case matters; its Unicode form, invisible marks, spaces and a repeat do not', async () => {
    const zw = String.fromCharCode(0x200b)
    // The same name, as one code point and as a letter with a combining accent.
    const composed = 'Caf' + String.fromCharCode(0xe9)
    const decomposed = 'Cafe' + String.fromCharCode(0x301)
    for (const holder of HOLDERS) {
      const base = await hashWith([{ id: 'a', name: 'WAF' }, { name: composed }], [holder])
      for (const same of [
        [{ name: ' WAF ' }, { name: decomposed }],
        [{ name: 'WAF' + zw }, { name: composed }],
        [{ name: 'WAF' }, { name: 'WAF' }, { name: composed }, { name: decomposed }],
        [{ name: 'WAF' }, { id: 'b', name: zw + 'WAF' }, { name: composed }],
      ]) {
        expect(await hashWith(same, [holder]), `${holder} ${JSON.stringify(same)}`).toBe(base)
      }
      for (const other of [
        [{ name: 'waf' }, { name: composed }],
        [{ name: 'WAF2' }, { name: composed }],
        [{ name: 'WAF' }, { name: 'waf' }, { name: composed }],
        [{ name: 'W AF' }, { name: composed }],
      ]) {
        expect(await hashWith(other, [holder]), `${holder} ${JSON.stringify(other)}`).not.toBe(base)
      }
    }
  })

  it('keep a control named control apart from an unnamed one, and count each unnamed one', async () => {
    for (const name of ['Control', 'control']) expect(await hashWith([{ name }]), name).not.toBe(await hashWith([{}]))
    // Entries that are no control are never merged either.
    expect(await hashWith([null, null])).not.toBe(await hashWith([null]))
    expect(await hashWith([{}, {}])).not.toBe(await hashWith([{}]))
    expect(await hashWith([{ name: String.fromCharCode(0x200b, 0xfeff) }])).toBe(await hashWith([{}]))
  })
})
