/**
 * The read-only query tools: each returns what the matching manage tool returns
 * for the same read, refuses every writing action and every write-only input,
 * caps lists, and is registered where a missing client reports its real reason.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const m = vi.hoisted(() => ({
  getControls: vi.fn(), findControls: vi.fn(), getControl: vi.fn(), controlCandidatesForType: vi.fn(),
  createControl: vi.fn(), updateControl: vi.fn(), deleteControl: vi.fn(),
  getExposures: vi.fn(), getExposure: vi.fn(),
  getCountermeasuresFromControl: vi.fn(), getCountermeasure: vi.fn(), createCountermeasure: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtControl: class {
      constructor(_c: unknown) {}
      getControls = m.getControls
      findControls = m.findControls
      getControl = m.getControl
      controlCandidatesForType = m.controlCandidatesForType
      createControl = m.createControl
      updateControl = m.updateControl
      deleteControl = m.deleteControl
    },
    DtExposure: class {
      constructor(_c: unknown) {}
      getExposures = m.getExposures
      getExposure = m.getExposure
    },
    DtCountermeasure: class {
      constructor(_c: unknown) {}
      getCountermeasuresFromControl = m.getCountermeasuresFromControl
      getCountermeasure = m.getCountermeasure
      createCountermeasure = m.createCountermeasure
    },
  }
})

import { manageControlsTool } from '../manage-controls.tool.js'
import { manageCountermeasuresTool } from '../manage-countermeasures.tool.js'
import { manageExposuresTool } from '../manage-exposures.tool.js'
import { DEFAULT_LIMIT, queryControlsTool, queryCountermeasuresTool, queryExposuresTool } from '../query-security.tool.js'
import { clientDependentTools, allTools } from '../index.js'
import { manifestTool } from '../manifest.js'

const context = { debug: false, apolloClient: {} } as unknown as ToolContext
/** A short, stable case label: the tool and the input. */
const label = (tool: { name: string }, input: unknown) => `${tool.name} ${JSON.stringify(input).slice(0, 60)}`
const items = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}` }))
const candidate = (id: string) => ({ controlId: id, controlName: id, totalCountermeasures: 1, assignedElementIds: [], classes: [{ compatible: true, countermeasureCount: 1 }] })

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset()
  // A distinct result per read method, so a read routed to the wrong method shows.
  m.getControls.mockResolvedValue(items('folder-control', 3))
  m.findControls.mockResolvedValue(items('found-control', 2))
  m.getControl.mockResolvedValue({ id: 'ctl-1', name: 'One control' })
  m.controlCandidatesForType.mockResolvedValue([candidate('cand-a'), candidate('cand-b')])
  m.getExposures.mockResolvedValue(items('exposure', 4))
  m.getExposure.mockResolvedValue({ id: 'exp-1' })
  m.getCountermeasuresFromControl.mockResolvedValue(items('cm', 2))
  m.getCountermeasure.mockResolvedValue({ id: 'cm-1' })
})

describe('parity with the manage tools', () => {
  it.each([
    [queryControlsTool, manageControlsTool, { action: 'list', folder_id: 'all' }],
    [queryControlsTool, manageControlsTool, { action: 'list', name: 'firewall' }],
    [queryControlsTool, manageControlsTool, { action: 'get', control_id: 'ctl-1' }],
    [queryControlsTool, manageControlsTool, { action: 'rank', element_types: ['PROCESS'], top_n: 2 }],
    [queryExposuresTool, manageExposuresTool, { action: 'list', element_id: 'el-1' }],
    [queryExposuresTool, manageExposuresTool, { action: 'get', exposure_id: 'exp-1' }],
    [queryCountermeasuresTool, manageCountermeasuresTool, { action: 'list', control_id: 'ctl-1' }],
    [queryCountermeasuresTool, manageCountermeasuresTool, { action: 'get', countermeasure_id: 'cm-1' }],
  ] as const)('%# returns what the manage tool returns', async (query, manage, input) => {
    const q = await query.run(input, context)
    const w = await manage.execute(input as never, context)
    expect(q.success, q.error).toBe(true)
    expect(q).toEqual(w)
  })

  it('routes each action to its own read', async () => {
    const rank = await queryControlsTool.run({ action: 'rank', element_types: ['STORE'] }, context)
    expect((rank.data as any).candidates.map((c: any) => c.controlId)).toEqual(['cand-a', 'cand-b'])
    expect(m.getControls).not.toHaveBeenCalled()
  })
})

describe('rank', () => {
  it('ranks a control whose class sets no element types as compatible, above one configured for another type', async () => {
    // The backend reports a class with no supportedTypes as compatible with every element type; a configured class
    // that lists other types is incompatible and costs its control.
    const cls = (classId: string, compatible: boolean) => ({ classId, className: classId, moduleId: 'm', moduleName: 'general', compatible, countermeasureCount: 1 })
    m.controlCandidatesForType.mockResolvedValue([
      { controlId: 'store-only', controlName: 'Store only', totalCountermeasures: 1, assignedElementIds: [], classes: [cls('cc-store', false)] },
      { controlId: 'typeless', controlName: 'Typeless', totalCountermeasures: 1, assignedElementIds: [], classes: [cls('cc-any', true)] },
    ])
    const r = await queryControlsTool.run({ action: 'rank', element_types: ['PROCESS'] }, context)
    expect(r.success, r.error).toBe(true)
    expect((r.data as any).candidates.map((c: any) => [c.controlId, c.score, c.relevance])).toEqual([['typeless', 1, 'strong'], ['store-only', -1, 'weak']])
  })

  it('ranks for flows and data items too, passing their types on', async () => {
    m.controlCandidatesForType.mockResolvedValue([])
    const r = await queryControlsTool.run({ action: 'rank', element_types: ['DATA_FLOW', 'DATA'] }, context)
    expect(r.success, r.error).toBe(true)
    expect(m.controlCandidatesForType.mock.calls.at(-1)![0]).toMatchObject({ elementTypes: ['DATA_FLOW', 'DATA'] })
  })
})

describe('read only', () => {
  it.each(([
    [queryControlsTool, { action: 'create', name: 'x' }],
    [queryControlsTool, { action: 'delete', control_id: 'c' }],
    [queryControlsTool, { action: 'push-greenfield', control_id: 'c', directory_path: '.' }],
    [queryControlsTool, { action: 'list', directory_path: '.' }],
    [queryControlsTool, { action: 'list', new_attributes: { a: 1 } }],
    [queryControlsTool, { action: 'list', decision: {} }],
    [queryExposuresTool, { action: 'list', element_id: 'e', score: 1 }],
    [queryCountermeasuresTool, { action: 'create', control_id: 'c', name: 'x' }],
    [queryCountermeasuresTool, { action: 'list', control_id: 'c', score: 5 }],
  ] as const).map(([tool, input]) => [label(tool, input), tool, input] as const))('refuses %s', async (_label, tool, input) => {
    const r = await tool.run(input, context)
    expect(r.success).toBe(false)
    expect(m.createControl).not.toHaveBeenCalled()
    expect(m.deleteControl).not.toHaveBeenCalled()
    expect(m.createCountermeasure).not.toHaveBeenCalled()
  })

  it('refuses a writing action even when the schema is bypassed', async () => {
    for (const tool of [queryControlsTool, queryExposuresTool, queryCountermeasuresTool]) {
      const r = await tool.execute({ action: 'create', name: 'x', control_id: 'c' } as never, context)
      expect(r).toEqual({ success: false, error: '"create" is not a read action' })
    }
    expect(m.createControl).not.toHaveBeenCalled()
    expect(m.createCountermeasure).not.toHaveBeenCalled()
  })

  it('passes only the fields an action reads, whatever else the input carries', async () => {
    const spy = vi.spyOn(manageControlsTool, 'execute')
    try {
      await queryControlsTool.execute({ action: 'get', control_id: 'ctl-1', directory_path: '/elsewhere', name: 'n' } as never, context)
      expect(spy).toHaveBeenCalledWith({ action: 'get', control_id: 'ctl-1' }, context)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('per-action requirements and bounds', () => {
  it.each(([
    [queryControlsTool, { action: 'get' }],
    [queryControlsTool, { action: 'rank' }],
    [queryControlsTool, { action: 'rank', element_types: [] }],
    [queryControlsTool, { action: 'rank', element_types: ['ROUTER'] }],
    [queryControlsTool, { action: 'get', control_id: '../etc' }],
    [queryControlsTool, { action: 'list', name: 'x'.repeat(201) }],
    [queryControlsTool, { action: 'list', element_ids: Array.from({ length: 501 }, (_, i) => `e${i}`) }],
    [queryControlsTool, { action: 'get', control_id: 'c', limit: 5 }],
    [queryControlsTool, { action: 'list', top_n: 3 }],
    [queryControlsTool, { action: 'rank', element_types: ['PROCESS'], top_n: 51 }],
    [queryControlsTool, { action: 'list', limit: 501 }],
    [queryExposuresTool, { action: 'list' }],
    [queryExposuresTool, { action: 'get' }],
    [queryCountermeasuresTool, { action: 'list' }],
    [queryCountermeasuresTool, { action: 'get' }],
  ] as const).map(([tool, input]) => [label(tool, input), tool, input] as const))('refuses %s', async (_label, tool, input) => {
    expect((await tool.run(input, context)).success).toBe(false)
  })

  it('caps a list, keeps the full total, and says so only when it cut', async () => {
    m.getControls.mockResolvedValue(items('c', DEFAULT_LIMIT + 7))
    const capped = (await queryControlsTool.run({ action: 'list', folder_id: 'all' }, context)).data as any
    expect(capped.controls).toHaveLength(DEFAULT_LIMIT)
    expect(capped).toMatchObject({ total: DEFAULT_LIMIT + 7, truncated: true })
    const small = (await queryExposuresTool.run({ action: 'list', element_id: 'e', limit: 10 }, context)).data as any
    expect(small).toEqual({ exposures: items('exposure', 4), total: 4 })
  })

  it('keeps the warnings of the filtered list', async () => {
    const r = (await queryControlsTool.run({ action: 'list', class_ids: ['a', 'b'], name: 'firewall' }, context)).data as any
    expect(r.warnings?.[0]).toMatch(/class_ids\[0\] only/)
  })
})

describe('registration', () => {
  it('registers the three tools as client tools, auto-approved and conformant', () => {
    for (const name of ['query_controls', 'query_exposures', 'query_countermeasures']) {
      expect(allTools.some((t) => t.name === name)).toBe(true)
      expect(clientDependentTools.some((t) => t.name === name)).toBe(true)
      expect(manifestTool(name)).toMatchObject({ approval: 'auto', status: 'conformant' })
    }
  })
})
