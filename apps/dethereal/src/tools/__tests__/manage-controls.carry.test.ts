/**
 * manage_controls carries the operator's registrations of a local control to the id the platform gave it,
 * after each journal operation: in the replay before any action, and in push-greenfield. A failed carry
 * never fails the action; it is a warning, and push-greenfield reports its own control's carry.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { ToolContext } from '../base-tool.js'

const h = vi.hoisted(() => ({
  replayOps: [] as Array<Record<string, unknown>>,
  pushOps: [] as Array<Record<string, unknown>>,
  carries: [] as unknown[],
  carryResult: (_op: { tempId: string }): unknown => ({ status: 'registered', registered: 1 }),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const file = { id: 'greenfield-new1', name: 'New control', source: 'declared', lifecycle: 'greenfield', classes: [] }
  return {
    ...actual,
    acquireLock: async () => ({}),
    releaseLock: async () => undefined,
    // The journal replay: each stranded operation, then the callback with it (the whole operation is offered).
    applyPendingRewrites: async (_dir: string, options?: { afterOperation?: (op: unknown) => Promise<void> }) => {
      for (const op of h.replayOps) await options?.afterOperation?.(op)
      return h.replayOps.length
    },
    readControlFile: async () => file,
    DtClass: class { constructor(_c: unknown) {} getClassById = async () => ({ id: 'ctrl-class' }) },
    DtControlLibrary: class {
      constructor(_c: unknown) {}
      pushGreenfieldControl = async (args: { afterOperation?: (op: unknown) => Promise<void> }) => {
        for (const op of h.pushOps) await args.afterOperation?.(op)
        return { ...file, id: 'srv-new1', lifecycle: 'brownfield' }
      }
    },
  }
})

vi.mock('../../utils/settlement-writers.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    carryGreenfield: async (dir: string, op: { tempId: string; serverId: string }) => {
      h.carries.push([dir, op])
      const r = h.carryResult(op)
      if (r instanceof Error) throw r
      return r
    },
  }
})

const { manageControlsTool } = await import('../manage-controls.tool.js')

const context: ToolContext = { debug: false, apolloClient: {} as never }
const dir = fs.mkdtempSync(path.join(process.cwd(), '.test-carry-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const pushGreenfield = () => manageControlsTool.execute({
  action: 'push-greenfield',
  directory_path: dir,
  control_id: 'greenfield-new1',
  supporting_element_ids: [],
  live_assigned_model_ids: [],
} as never, context) as Promise<any>

beforeEach(() => {
  h.replayOps = []
  h.pushOps = []
  h.carries = []
  h.carryResult = () => ({ status: 'registered', registered: 1 })
})

describe('manage_controls carries local controls to their platform ids', () => {
  it('carries after the replay and after push-greenfield, with the ids only; push-greenfield reports its own carry', async () => {
    h.replayOps = [{ kind: 'greenfield-id-rewrite', tempId: 'greenfield-old', serverId: 'srv-old', filePaths: ['structure.json'] }]
    h.pushOps = [{ tempId: 'greenfield-new1', serverId: 'srv-new1' }]
    h.carryResult = (op) => (op.tempId === 'greenfield-old' ? { status: 'nothing' } : { status: 'registered', registered: 2 })
    const r = await pushGreenfield()
    expect(r.success, r.error).toBe(true)
    expect(h.carries.map(([d]: any) => d)).toEqual([fs.realpathSync(dir), fs.realpathSync(dir)])
    expect(h.carries.map(([, op]: any) => op)).toEqual([
      { tempId: 'greenfield-old', serverId: 'srv-old' },
      { tempId: 'greenfield-new1', serverId: 'srv-new1' },
    ])
    expect(r.data.settlement_registration).toEqual({ status: 'registered', registered: 2 })
    expect(r.data).not.toHaveProperty('warnings')
  })

  it("reports this control's carry, not another operation's carried after it", async () => {
    h.pushOps = [{ tempId: 'greenfield-new1', serverId: 'srv-new1' }, { tempId: 'greenfield-other', serverId: 'srv-other' }]
    h.carryResult = (op) => (op.tempId === 'greenfield-new1' ? { status: 'registered', registered: 1 } : { status: 'nothing' })
    const r = await pushGreenfield()
    expect(r.data.settlement_registration).toEqual({ status: 'registered', registered: 1 })
  })

  it("leaves settlement_registration out when this control's carry had nothing to do", async () => {
    h.pushOps = [{ tempId: 'greenfield-new1', serverId: 'srv-new1' }]
    h.carryResult = () => ({ status: 'nothing' })
    const r = await pushGreenfield()
    expect(r.data).not.toHaveProperty('settlement_registration')
  })

  it('a failed or throwing carry never fails the action: each is a warning naming the temporary id', async () => {
    h.replayOps = [{ tempId: 'greenfield-old', serverId: 'srv-old' }]
    h.pushOps = [{ tempId: 'greenfield-new1', serverId: 'srv-new1' }]
    h.carryResult = (op) => (op.tempId === 'greenfield-old' ? new Error('lock') : { status: 'failed', code: 'busy' })
    const r = await pushGreenfield()
    expect(r.success, r.error).toBe(true)
    expect(r.data.settlement_registration).toEqual({ status: 'failed', code: 'busy' })
    expect(r.data.warnings).toEqual([
      'The settlement still names greenfield-old (carry_threw): confirm the new control id with model_state_settle.',
      'The settlement still names greenfield-new1 (busy): confirm the new control id with model_state_settle.',
    ])
  })
})
