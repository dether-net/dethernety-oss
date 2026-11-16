/**
 * The read-only query tools: each returns what the matching manage tool returns
 * for the same read, refuses every writing action and every write-only input,
 * caps lists, and is registered where a missing client reports its real reason.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ToolContext } from '../base-tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'

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
import { resultText } from '../base-tool.js'
import { LIST_MODEL_PAGE_CHARS, PARTS_MAX } from '../../triage/model-views.js'
import { exposureOf, largeModel } from '../../triage/__tests__/model-fixture.js'
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
    [queryExposuresTool, { action: 'list_model' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '' }],
    [queryExposuresTool, { action: 'evidence' }],
    [queryExposuresTool, { action: 'evidence', exposure_id: '../x' }],
    [queryExposuresTool, { action: 'list', element_id: 'e', directory_path: '.' }],
    [queryExposuresTool, { action: 'get', exposure_id: 'x', directory_path: '.' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', exposure_id: 'x' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', limit: 5 }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'tree' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', select: 'stale' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'groups', select: 'stale' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'partition', offset: 1 }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', listing: '0123456789abcdef' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'rows', listing: '0123456789abcdef' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'rows', offset: 0, listing: '0123456789abcdef' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'rows', offset: 3, listing: 'xyz' }],
    [queryExposuresTool, { action: 'list_model', directory_path: '.', view: 'rows', offset: -1 }],
    [queryExposuresTool, { action: 'list', element_id: 'e', view: 'rows' }],
    [queryExposuresTool, { action: 'get', exposure_id: 'x', offset: 2 }],
    [queryExposuresTool, { action: 'evidence', exposure_id: 'x', element_id: 'e' }],
    [queryExposuresTool, { action: 'evidence', exposure_id: 'x', directory_path: '.' }],
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

describe('exposures of a whole model', () => {
  const URL_SAVED = process.env.DETHERNETY_URL
  const PLATFORM = 'http://127.0.0.1:9'
  let tmp: string
  let repo: string

  const exposure = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `exp ${id}`, description: 'desc', type: '1', category: 'cat', score: 5, attackVector: 'NETWORK',
    createdBy: 'SYSTEM', authoredBy: null, dispositionKind: null, dispositionReason: null, dispositionedBy: null,
    dispositionedAt: null, dispositionStale: null, unresolvedReferences: null,
    exploitedBy: [{ attack_id: 'T1040' }], exploitedByAtlas: [], ...over,
  })
  const model = {
    id: 'model-1',
    name: 'M',
    dataItems: [{ id: 'di-1', name: 'store', dataClass: [], exposures: [exposure('e-1', { dispositionKind: 'WAIVED', dispositionReason: 'w'.repeat(300), dispositionedBy: 'op' })] }],
    defaultBoundary: [{
      id: 'b-1', name: 'Edge', securityBoundaryClass: [], exposures: [],
      allDescendantBoundaries: [], allDescendantComponents: [{ id: 'c-1', name: 'api', componentClass: [], exposures: [exposure('e-2')] }], allDescendantDataFlows: [],
    }],
  }
  const withClient = (query: (o: any) => Promise<unknown>) => ({ debug: false, apolloClient: { query } }) as unknown as ToolContext

  /** A model directory in the project whose sync record names `sync`. */
  const modelDir = (sync: Record<string, unknown> | null) => {
    const dir = path.join(repo, 'model')
    fs.mkdirSync(path.join(dir, '.dethereal'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ model: { id: 'local', name: 'M' } }))
    if (sync) fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify(sync))
    return dir
  }

  beforeEach(() => {
    process.env.DETHERNETY_URL = PLATFORM
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-query-exposures-')))
    repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo)
    initProjectRoot({ cwd: repo, env: {} })
  })
  afterEach(() => {
    resetProjectRoot()
    if (URL_SAVED === undefined) delete process.env.DETHERNETY_URL
    else process.env.DETHERNETY_URL = URL_SAVED
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('list_model reads the synced platform model, and answers the partition by default, with no rows', async () => {
    const dir = modelDir({ platform_model_id: 'model-1', platform_url: `${PLATFORM}/` })
    const calls: any[] = []
    const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, withClient(async (o) => { calls.push(o); return { data: { models: [model] } } }))
    expect(r.success, r.error).toBe(true)
    expect(calls.map((c) => c.variables)).toEqual([{ modelId: 'model-1' }])
    expect(r.data).toEqual({
      model_id: 'model-1', model_name: 'M', view: 'partition', exposures: 2,
      totals: { pending: 1, confirmed: 0, disposed: 1, stale: 0, user: 0, system: 2 },
      triage: 1, user_pending: 0, elements: 3,
      without_exposures: { count: 1, elements: [{ id: 'b-1', name: 'Edge', kind: 'securityBoundary' }] },
    })
  })

  it('list_model view rows leaves out the full reason and cuts the listed one', async () => {
    const dir = modelDir({ platform_model_id: 'model-1', platform_url: `${PLATFORM}/` })
    const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view: 'rows' }, withClient(async () => ({ data: { models: [model] } })))
    expect(r.success, r.error).toBe(true)
    const data = r.data as any
    expect(data).toMatchObject({ model_id: 'model-1', view: 'rows', select: 'all', total: 2, returned: 2, offset: 0, truncated: false })
    expect(data.listing).toMatch(/^[0-9a-f]{16}$/)
    expect(data.rows.map((row: any) => [row.exposure_id, row.element_kind, row.lifecycle])).toEqual([['e-1', 'dataItem', 'disposed'], ['e-2', 'component', 'pending']])
    for (const row of data.rows) expect(row).not.toHaveProperty('full_reason')
    expect(data.rows[0].disposition_reason).toHaveLength(200)
  })

  it('list_model keeps the triage files out of git in the partition view only', async () => {
    const dir = modelDir({ platform_model_id: 'model-1', platform_url: `${PLATFORM}/` })
    const ignore = path.join(dir, '.dethereal', '.gitignore')
    for (const view of ['groups', 'rows'] as const) {
      const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view }, withClient(async () => ({ data: { models: [model] } })))
      expect(r.success, r.error).toBe(true)
      expect(fs.existsSync(ignore)).toBe(false)
    }
    await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view: 'partition' }, withClient(async () => ({ data: { models: [model] } })))
    expect(fs.existsSync(ignore)).toBe(true)
  })

  it('list_model keeps the triage files out of git, leaving the entries already there in place', async () => {
    const dir = modelDir({ platform_model_id: 'model-1', platform_url: `${PLATFORM}/` })
    const ignore = path.join(dir, '.dethereal', '.gitignore')
    fs.writeFileSync(ignore, '# mine\nnotes.md\n')
    const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, withClient(async () => ({ data: { models: [model] } })))
    expect(r.success, r.error).toBe(true)
    const text = fs.readFileSync(ignore, 'utf8')
    expect(text.startsWith('# mine\nnotes.md\n')).toBe(true)
    for (const entry of ['triage-log.json', 'triage-run/', 'sync.json']) expect(text.split('\n')).toContain(entry)
    await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, withClient(async () => ({ data: { models: [model] } })))
    expect(fs.readFileSync(ignore, 'utf8')).toBe(text)
  })

  it('list_model on a model never pushed: not_synced, and no platform read', async () => {
    let called = false
    const client = withClient(async () => { called = true; return { data: { models: [model] } } })
    for (const sync of [null, { platform_url: PLATFORM }, { platform_model_id: '../m', platform_url: PLATFORM }]) {
      fs.rmSync(path.join(repo, 'model'), { recursive: true, force: true })
      const r = await queryExposuresTool.run({ action: 'list_model', directory_path: modelDir(sync) }, client)
      expect(r).toMatchObject({ success: false, data: { codes: ['not_synced'] } })
      expect(r.error).toMatch(/has not been pushed/)
    }
    expect(called).toBe(false)
  })

  it('list_model on a model synced with another platform: other_platform', async () => {
    const dir = modelDir({ platform_model_id: 'model-1', platform_url: 'https://elsewhere.example' })
    const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, withClient(async () => ({ data: { models: [model] } })))
    expect(r).toEqual({
      success: false,
      error: `this model was synced with https://elsewhere.example, not the configured ${PLATFORM}`,
      data: { codes: ['other_platform'] },
    })
  })

  it('list_model on a model the platform no longer has: model_not_found', async () => {
    const dir = modelDir({ platform_model_id: 'gone', platform_url: PLATFORM })
    const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, withClient(async () => ({ data: { models: [] } })))
    expect(r).toEqual({ success: false, error: 'the platform has no model gone', data: { codes: ['model_not_found'] } })
  })

  it('list_model outside the project is refused before any read', async () => {
    let called = false
    const outside = fs.mkdtempSync(path.join(tmp, 'outside-'))
    const r = await queryExposuresTool.run({ action: 'list_model', directory_path: outside }, withClient(async () => { called = true; return {} }))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/outside the allowed directory/)
    expect(called).toBe(false)
  })

  describe('the views of a model the size of a real one', () => {
    const fixture = largeModel()
    const read = withClient(async () => ({ data: { models: [fixture.model] } }))
    const dirOf = () => modelDir({ platform_model_id: 'model-large', platform_url: PLATFORM })
    /** The result as the server sends it. */
    const sent = (r: { data?: unknown }) => resultText(r.data)

    async function walkView(dir: string, input: Record<string, unknown>, client = read) {
      const pages: any[] = []
      let offset = 0
      let listing: string | undefined
      for (;;) {
        const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir, ...input, ...(offset ? { offset, listing } : {}) }, client)
        expect(r.success, r.error).toBe(true)
        expect(sent(r).length).toBeLessThanOrEqual(LIST_MODEL_PAGE_CHARS)
        pages.push(r.data)
        listing = (r.data as any).listing
        if (!(r.data as any).truncated) return pages
        offset = (r.data as any).next_offset
      }
    }

    it('the partition stays small and its triage count equals the groups walk', async () => {
      const dir = dirOf()
      const partition = await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, read)
      expect(sent(partition).length).toBeLessThan(2_000)
      const pages = await walkView(dir, { view: 'groups' })
      expect(pages.length).toBeGreaterThan(1)
      const members = pages.flatMap((p) => p.groups.flatMap((g: any) => g.members))
      expect(members).toHaveLength((partition.data as any).triage)
      for (const p of pages) expect(p).toMatchObject({ view: 'groups', rows_total: (partition.data as any).triage, parts_left_over: 0 })
    })

    it('the rows walk counts what the partition totals', async () => {
      const dir = dirOf()
      const partition = (await queryExposuresTool.run({ action: 'list_model', directory_path: dir }, read)).data as any
      const rows = (await walkView(dir, { view: 'rows', select: 'all' })).flatMap((p) => p.rows)
      expect(rows).toHaveLength(partition.exposures)
      const count = (f: (r: any) => boolean) => rows.filter(f).length
      expect({
        pending: count((r) => r.lifecycle === 'pending'), confirmed: count((r) => r.lifecycle === 'confirmed'), disposed: count((r) => r.lifecycle === 'disposed'),
        stale: count((r) => r.disposition_stale === true), user: count((r) => r.created_by === 'USER'), system: count((r) => r.created_by !== 'USER'),
      }).toEqual(partition.totals)
      const stale = (await walkView(dir, { view: 'rows', select: 'stale' })).flatMap((p) => p.rows)
      expect(stale).toHaveLength(partition.totals.stale)
    })

    it('narrows every view to one element, and refuses an element the model does not have', async () => {
      const dir = dirOf()
      const partition = (await queryExposuresTool.run({ action: 'list_model', directory_path: dir, element_id: 'c-04' }, read)).data as any
      expect(partition.element).toMatchObject({ id: 'c-04', kind: 'component' })
      const groups = (await walkView(dir, { view: 'groups', element_id: 'c-04' }))
      expect(groups[0].element_id).toBe('c-04')
      expect(groups.flatMap((p) => p.groups.flatMap((g: any) => g.members))).toHaveLength(partition.element.triage)
      const rows = (await walkView(dir, { view: 'rows', element_id: 'c-04' })).flatMap((p) => p.rows)
      expect(rows).toHaveLength(partition.element.exposures)
      for (const view of ['partition', 'groups', 'rows'] as const) {
        const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view, element_id: 'nope' }, read)
        expect(r).toEqual({ success: false, error: 'No element nope in this model', data: { codes: ['element_not_found'] } })
      }
    })

    it('a page past offset 0 needs the listing, before any read', async () => {
      let called = false
      const r = await queryExposuresTool.run({ action: 'list_model', directory_path: dirOf(), view: 'rows', offset: 5 }, withClient(async () => { called = true; return {} }))
      expect(r).toMatchObject({ success: false, data: { codes: ['listing_required'] } })
      expect(called).toBe(false)
    })

    it('a model that changed between pages is refused; an unchanged one keeps its listing', async () => {
      const dir = dirOf()
      for (const view of ['groups', 'rows'] as const) {
        const first = (await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view }, read)).data as any
        expect(first.truncated).toBe(true)
        const again = await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view, offset: first.next_offset, listing: first.listing }, read)
        expect(again.success, again.error).toBe(true)
        expect((again.data as any).listing).toBe(first.listing)
        // A rename that keeps the order: an element's name.
        const renamed = structuredClone(fixture.model)
        renamed.defaultBoundary[0]!.allDescendantComponents[0]!.name += ' v2'
        const changed = await queryExposuresTool.run({ action: 'list_model', directory_path: dir, view, offset: first.next_offset, listing: first.listing }, withClient(async () => ({ data: { models: [renamed] } })))
        expect(changed).toMatchObject({ success: false, data: { codes: ['listing_changed'] } })
        expect(changed.error).toMatch(/start again at offset 0/)
      }
    })

    it('returns at most 999 parts across its pages, and says how many it held back', async () => {
      const many = {
        id: 'model-large', name: 'M', dataItems: [],
        defaultBoundary: [{
          id: 'b', name: 'B', securityBoundaryClass: [], exposures: [], allDescendantBoundaries: [], allDescendantDataFlows: [],
          allDescendantComponents: [{ id: 'c', name: 'c', componentClass: [], exposures: Array.from({ length: 1003 }, (_, i) => exposureOf(`e-${String(i).padStart(4, '0')}`, { name: `n ${String(i).padStart(4, '0')}` })) }],
        }],
      }
      const pages = await walkView(dirOf(), { view: 'groups' }, withClient(async () => ({ data: { models: [many] } })))
      expect(pages.flatMap((p) => p.groups)).toHaveLength(PARTS_MAX)
      for (const p of pages) expect(p).toMatchObject({ parts_total: 1003, parts_left_over: 4, rows_total: 1003 })
    })
  })

  it('evidence returns the exposure', async () => {
    const raw = { ...exposure('e-1'), references: null, mitigationSuggestions: [], detectionMethods: [], tags: [], techniques: ['T1040'], exploitedBy: [{ id: 'n', attack_id: 'T1040', name: 'Network Sniffing', description: null }], exploitedByAtlas: [], element: [{ id: 'c-1', name: 'api' }] }
    const r = await queryExposuresTool.run({ action: 'evidence', exposure_id: 'e-1' }, withClient(async (o) => ({ data: { exposures: o.variables.exposureId === 'e-1' ? [raw] : [] } })))
    expect(r.success, r.error).toBe(true)
    expect((r.data as any).exposure).toMatchObject({ exposure_id: 'e-1', lifecycle: 'pending', techniques: ['T1040'] })
    expect((r.data as any).exposure).not.toHaveProperty('elements')
  })

  it('evidence for no such exposure: not_found', async () => {
    const r = await queryExposuresTool.run({ action: 'evidence', exposure_id: 'nope' }, withClient(async () => ({ data: { exposures: [] } })))
    expect(r).toEqual({ success: false, error: 'Exposure nope not found', data: { codes: ['not_found'] } })
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

  it('query_exposures describes the three views of list_model and how to page them', () => {
    for (const phrase of ["View 'partition' (the default)", "View 'groups'", "View 'rows'", 'select (stale, user, all)', 'next_offset', 'listing', 'listing_changed']) {
      expect(queryExposuresTool.description).toContain(phrase)
    }
  })

  it('query_exposures takes exactly the actions and inputs its manifest entry lists', () => {
    const json = z.toJSONSchema(queryExposuresTool.inputSchema, { target: 'draft-07' }) as { properties: Record<string, { enum?: string[] }> }
    const entry = manifestTool('query_exposures')!
    expect(Object.keys(json.properties).sort()).toEqual(Object.keys(entry.inputs).sort())
    expect([...json.properties.action!.enum!].sort()).toEqual([...entry.actions!].sort())
  })
})
