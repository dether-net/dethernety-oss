/**
 * Quick mode in the workflow state: `model_state` action `mode` marks or unmarks a quick model and records the last
 * quick step it finished; a quick model is never REVIEWED, shows `quick` first wherever its state is shown, and a
 * backward transition undoes its quick steps.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { modelStateTool } from '../model-state.tool.js'
import type { ToolContext } from '../base-tool.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { registerAll } from './helpers/settle.js'
import { DISPLAY_STATE } from '../../cli/session-start.js'

vi.setConfig({ testTimeout: 30_000 })

const context: ToolContext = { debug: false }
let root: string
let seq = 0
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-model-state-mode-'))
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
})
afterAll(async () => {
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
})

async function model(state?: Record<string, unknown>): Promise<string> {
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, gateModel())
  await registerAll(dir)
  if (state) await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(state))
  return dir
}
const call = (input: Record<string, unknown>) => modelStateTool.run(input as never, context) as Promise<{ success: boolean; data?: any; error?: string }>
const get = async (dir: string) => (await call({ action: 'get', directory_path: dir })).data
const mode = (dir: string, extra: Record<string, unknown>) => call({ action: 'mode', directory_path: dir, ...extra })
const stateOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8'))
const enriching = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const reviewed = { currentState: 'REVIEWED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED'], staleElements: [] }

describe('model_state mode', () => {
  it('marks a quick model, records its steps rising, and clears the mark while keeping the steps', async () => {
    const dir = await model(enriching)
    expect((await get(dir))).toMatchObject({ mode: null, quick_through: null })
    expect((await mode(dir, { mode: 'quick' })).data).toMatchObject({ mode: 'quick', quick_through: null })
    expect(await get(dir)).toMatchObject({ mode: 'quick', quick_through: null, display_state: 'ENRICHING (quick)', unknown_keys: [] })
    expect((await mode(dir, { quick_through: 7 })).success).toBe(true)
    expect((await mode(dir, { quick_through: 8 })).data).toMatchObject({ quick_through: 8 })
    const back = await mode(dir, { quick_through: 7 })
    expect(back.success).toBe(false)
    expect(back.data.codes).toEqual(['quick_through_backward'])
    expect((await mode(dir, { mode: 'full' })).data).toMatchObject({ mode: null, quick_through: 8 })
    expect(stateOf(dir)).not.toHaveProperty('mode')
    expect((await get(dir)).display_state).toBe('ENRICHING')
    expect((await mode(dir, { quick_through: null })).data).toMatchObject({ quick_through: null })
    expect(stateOf(dir)).not.toHaveProperty('quickThrough')
  })

  it('sets the mark and the step in one call', async () => {
    const dir = await model(enriching)
    expect((await mode(dir, { mode: 'quick', quick_through: 7 })).data).toMatchObject({ mode: 'quick', quick_through: 7 })
  })

  it('refuses a call with nothing to set, and a model with no state', async () => {
    const dir = await model(enriching)
    expect((await mode(dir, {})).data.codes).toEqual(['mode_input'])
    for (const quick_through of [6, 7.5, 9, '8']) expect((await mode(dir, { mode: 'quick', quick_through })).success, String(quick_through)).toBe(false)
    expect(stateOf(dir)).not.toHaveProperty('mode')
    const fresh = await model()
    expect((await mode(fresh, { mode: 'quick' })).data.codes).toEqual(['no_state'])
  })

  it('records a quick step only on a quick model at ENRICHING', async () => {
    const full = await model(enriching)
    expect((await mode(full, { quick_through: 7 })).data.codes).toEqual(['not_quick'])
    const quick = await model({ ...enriching, mode: 'quick' })
    expect((await mode(quick, { mode: 'full', quick_through: 7 })).data.codes).toEqual(['not_quick'])
    expect(stateOf(quick)).toMatchObject({ mode: 'quick' })
    const early = await model({ ...enriching, currentState: 'STRUCTURE_COMPLETE', mode: 'quick' })
    expect((await mode(early, { quick_through: 7 })).data.codes).toEqual(['wrong_state'])
    expect(stateOf(early)).not.toHaveProperty('quickThrough')
  })

  it('writes nothing when nothing changes', async () => {
    const dir = await model(enriching)
    const before = readFileSync(path.join(dir, '.dethereal', 'state.json'))
    expect((await mode(dir, { mode: 'full' })).data).toMatchObject({ unchanged: true, mode: null })
    expect((await mode(dir, { quick_through: null })).data).toMatchObject({ unchanged: true })
    expect(readFileSync(path.join(dir, '.dethereal', 'state.json')).equals(before)).toBe(true)
  })

  it('refuses to mark quick a model whose file claims REVIEWED, even when it reads ENRICHING', async () => {
    const dir = await model({ ...reviewed })
    const g = await get(dir)
    expect(g.claimed_state).toBe('REVIEWED')
    const r = await mode(dir, { mode: 'quick' })
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['reviewed_model'])
    expect(stateOf(dir)).not.toHaveProperty('mode')
  })

  it('refuses to mark a REVIEWED model quick', async () => {
    const dir = await model(enriching)
    expect((await call({ action: 'transition', directory_path: dir, to: 'REVIEWED' })).success).toBe(true)
    const r = await mode(dir, { mode: 'quick' })
    expect(r.success).toBe(false)
    expect(r.data.codes).toEqual(['reviewed_model'])
    expect(stateOf(dir)).not.toHaveProperty('mode')
  })
})

describe('a quick model is never REVIEWED', () => {
  it('refuses the transition, with its own code', async () => {
    const dir = await model(enriching)
    await mode(dir, { mode: 'quick' })
    const r = await call({ action: 'transition', directory_path: dir, to: 'REVIEWED' })
    expect(r.success).toBe(false)
    expect(r.data.codes[0]).toBe('quick_mode')
    expect(stateOf(dir).currentState).toBe('ENRICHING')
  })

  it('reads a state that claims REVIEWED while quick as ENRICHING, with a note', async () => {
    const dir = await model({ ...reviewed, mode: 'quick' })
    const g = await get(dir)
    expect(g).toMatchObject({ claimed_state: 'REVIEWED', state: 'ENRICHING', mode: 'quick', display_state: 'ENRICHING (quick)' })
    expect(g.quick_note).toMatch(/reads as ENRICHING/)
    expect(g).not.toHaveProperty('note')
  })

  it('takes only the exact mark: another spelling is a full model', async () => {
    const dir = await model({ ...enriching, mode: 'Quick', quickThrough: '8' })
    expect(await get(dir)).toMatchObject({ mode: null, quick_through: null, display_state: 'ENRICHING', mode_invalid: true, quick_through_invalid: true })
  })
})

describe('going back', () => {
  it('clears the quick steps and keeps the mark', async () => {
    const dir = await model(enriching)
    await mode(dir, { mode: 'quick', quick_through: 8 })
    expect((await call({ action: 'transition', directory_path: dir, to: 'STRUCTURE_COMPLETE' })).success).toBe(true)
    expect(stateOf(dir)).toMatchObject({ mode: 'quick' })
    expect(stateOf(dir)).not.toHaveProperty('quickThrough')
    expect((await get(dir)).display_state).toBe('STRUCTURE_COMPLETE (quick)')
  })
})

describe('the session-start banner', () => {
  it('accepts the quick qualifier, first or alone', () => {
    for (const s of ['ENRICHING (quick)', 'DISCOVERED (quick)', 'ENRICHING (quick, 3 pending enrichment)']) expect(DISPLAY_STATE.test(s), s).toBe(true)
  })
})
