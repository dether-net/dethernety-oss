/**
 * workspace_status reads every model through the server: its state with the
 * qualifiers that hold it back, whether it is ready for platform analysis and
 * why not, and, for a claimed REVIEWED, whether that still holds and why not.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectWorkspaceStatus } from '../workspace-status.tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { registerAll } from './helpers/settle.js'

describe('workspace_status: readiness and review', () => {
  let tmp: string
  let project: string
  let dir: string
  const savedHome = process.env.HOME

  const state = (s: Record<string, unknown>) => fs.writeFileSync(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(s))
  const first = async () => (await collectWorkspaceStatus()).models[0]!
  const pending = () => {
    fs.writeFileSync(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 1, entries: [{
      batch: 'b1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema', source: 'app/server.py:12', previous: 'null',
    }] }))
  }
  /** The reference model with one Gate 2 failure: a component without a position. */
  const breakGate2 = () => {
    const file = path.join(dir, 'structure.json')
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-web') delete c.positionX; (b.boundaries ?? []).forEach(walk) }
    walk(s.defaultBoundary)
    fs.writeFileSync(file, JSON.stringify(s))
  }

  beforeEach(async () => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-readiness-')))
    project = path.join(tmp, 'project')
    dir = path.join(project, 'models', 'shop')
    fs.mkdirSync(dir, { recursive: true })
    await writeGateModel(dir, gateModel())
    fs.mkdirSync(path.join(project, '.dethernety'))
    fs.writeFileSync(path.join(project, '.dethernety', 'models.json'), JSON.stringify({ models: [{ name: 'Shop', path: 'models/shop' }] }))
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('a model that passes the gates with every value registered is ready', async () => {
    await registerAll(dir)
    state({ currentState: 'ENRICHING' })
    const m = await first()
    expect(m).toMatchObject({ state: 'ENRICHING', displayState: 'ENRICHING', readiness: { ready: true, blockers: [] } })
    expect(m).not.toHaveProperty('review')
  })

  it('shows unregistered values and pending enrichment in the state, and as what stops analysis', async () => {
    state({ currentState: 'ENRICHING' })
    pending()
    const m = await first()
    expect(m.displayState).toMatch(/^ENRICHING \(1 pending enrichment, \d+ unregistered\)$/)
    expect(m.readiness).toEqual({ ready: false, blockers: ['pending', 'settlement'] })
    const s = await collectWorkspaceStatus()
    expect(s.contextLine).toBe(`model "Shop" — ${m.displayState}`)
  })

  it('an unreadable pending file stops analysis too', async () => {
    await registerAll(dir)
    state({ currentState: 'ENRICHING' })
    fs.writeFileSync(path.join(dir, '.dethereal', 'enrichment-pending.json'), '{ not json')
    const m = await first()
    expect(m.displayState).toBe('ENRICHING (pending enrichment unreadable)')
    expect(m.readiness).toEqual({ ready: false, blockers: ['pending_unreadable'] })
  })

  it('names why a claimed REVIEWED no longer holds, never with an empty list', async () => {
    await registerAll(dir)
    breakGate2()
    state({ currentState: 'REVIEWED', staleElements: ['c-web'] })
    const m = await first()
    expect(m.state).toBe('ENRICHING')
    expect(m.review).toEqual({ holds: false, stale: null, blockers: ['gate2', 'stale_queue'] })
    expect(m.readiness).toEqual({ ready: false, blockers: ['gate2'] })
  })

  it('reports a claimed REVIEWED that holds, and whether the model changed since the review', async () => {
    await registerAll(dir)
    // No review hash recorded: the review cannot be tied to this content, so it reads as stale.
    state({ currentState: 'REVIEWED' })
    const m = await first()
    expect(m.state).toBe('REVIEWED')
    expect(m.review).toEqual({ holds: true, stale: true, blockers: [] })
    expect(m.readiness).toEqual({ ready: true, blockers: [] })
  })

  it('a quick model that claims REVIEWED reads ENRICHING (quick), and its review names quick mode first', async () => {
    await registerAll(dir)
    state({ currentState: 'REVIEWED', mode: 'quick' })
    const s = await collectWorkspaceStatus()
    const m = s.models[0]!
    expect(m).toMatchObject({ state: 'ENRICHING', displayState: 'ENRICHING (quick)', readiness: { ready: true, blockers: [] } })
    expect(m.review).toEqual({ holds: false, stale: null, blockers: ['quick_mode'] })
    expect(s.contextLine).toBe('model "Shop" — ENRICHING (quick)')
    expect(s.suggestions.map((x) => x.command)).toContain('enrich')
    expect(s.suggestions.map((x) => x.command)).not.toContain('sync push')
    breakGate2()
    expect((await first()).review?.blockers).toEqual(['quick_mode', 'gate2'])
  })

  it('a quick model at ENRICHING has no review to report', async () => {
    await registerAll(dir)
    state({ currentState: 'ENRICHING', mode: 'quick' })
    const m = await first()
    expect(m).toMatchObject({ state: 'ENRICHING', displayState: 'ENRICHING (quick)' })
    expect(m).not.toHaveProperty('review')
  })

  it('a quick model that claims REVIEWED reads ENRICHING (quick) when the server cannot read its state', async () => {
    // Read here under a larger cap than the server's own, so the server's reading fails.
    state({ currentState: 'REVIEWED', mode: 'quick', pad: 'x'.repeat(1_100_000) })
    const s = await collectWorkspaceStatus({ stateMaxBytes: 2 * 1024 * 1024 })
    const m = s.models[0]!
    expect(m).toMatchObject({ state: 'ENRICHING', displayState: 'ENRICHING (quick)', problem: 'unreadable' })
    expect(m).not.toHaveProperty('review')
    expect(m).not.toHaveProperty('readiness')
    expect(s.suggestions.map((x) => x.command)).not.toContain('sync push')
  })

  it('a model the server cannot assess is not ready', async () => {
    fs.writeFileSync(path.join(dir, 'structure.json'), '{ not json')
    state({ currentState: 'ENRICHING' })
    const m = await first()
    expect(m.readiness?.ready).toBe(false)
    expect(m.readiness?.blockers).toContain('unavailable')
  })
})
