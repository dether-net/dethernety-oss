/**
 * The platform export for scoring: the exported model's files, plus every
 * element's exposures with the ATT&CK ids that exploit them, taken through the
 * server's tools (a fake caller here).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportPlatformModel, exportTriageModel, type CallTool } from '../platform-export.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-pexport-')) })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

function fakeServer(calls: Array<[string, Record<string, unknown>]>): CallTool {
  return async (name, args) => {
    calls.push([name, args])
    if (name === 'export_model') {
      const dir = String(args.directory_path)
      const write = (rel: string, v: unknown) => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
        fs.writeFileSync(path.join(dir, rel), JSON.stringify(v))
      }
      write('manifest.json', { model: { name: 'm' } })
      write('structure.json', { defaultBoundary: { id: 'b0', layout: { id: 'not-an-element' }, boundaries: [{ id: 'b1' }], components: [{ id: 'c1', classData: { id: 'class-x' } }] } })
      write('dataflows.json', [{ id: 'f1', source: { id: 'c1' }, target: { id: 'c1' } }])
      write('data-items.json', [])
      write('attributes/components/c1.json', { elementId: 'c1', attributes: { a: 1 } })
      write('.dethereal/sync.json', { local: true })
      return { success: true }
    }
    if (name === 'query_exposures') {
      if (args.element_id === 'big') return { exposures: [], total: 900, truncated: true }
      if (args.element_id === 'c1') return { exposures: [{ id: 'e1', name: 'Weak auth', exploitedBy: [{ attack_id: 'T1110' }, { attack_id: 'T1078' }, { name: 'no id' }] }], total: 1 }
      return { exposures: [], total: 0 }
    }
    throw new Error(`unexpected ${name}`)
  }
}

describe('exportPlatformModel', () => {
  it('exports the model files and each element\'s exposures, with sorted ATT&CK ids', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const out = await exportPlatformModel(fakeServer(calls), 'model-1', path.join(tmp, 'x'), new Date('2026-01-01T00:00:00Z'))
    expect(out.schemaVersion).toBe(1)
    expect(out.modelId).toBe('model-1')
    expect(out.exportedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(Object.keys(out.files).sort()).toEqual(['attributes/components/c1.json', 'data-items.json', 'dataflows.json', 'manifest.json', 'structure.json'])
    expect(out.exposures).toEqual({ c1: [{ id: 'e1', name: 'Weak auth', exploitedBy: ['T1078', 'T1110'] }] })
    expect(calls[0]).toEqual(['export_model', { model_id: 'model-1', directory_path: path.join(tmp, 'x'), if_exists: 'error' }])
    // Every element id is asked for, never a class or layout id.
    expect(calls.filter(([n]) => n === 'query_exposures').map(([, a]) => a.element_id)).toEqual(['b0', 'b1', 'c1', 'f1'])
    // Through the read-only tool, asking for its largest page.
    expect(calls.find(([n]) => n === 'query_exposures')?.[1]).toMatchObject({ action: 'list', limit: 500 })
  })

  it('fails rather than drop exposures a single read cannot return', async () => {
    const server = fakeServer([])
    const call = async (name: string, args: Record<string, unknown>) => {
      if (name === 'export_model') {
        const out = await server(name, args)
        const s = path.join(String(args.directory_path), 'structure.json')
        fs.writeFileSync(s, JSON.stringify({ defaultBoundary: { id: 'b0', components: [{ id: 'big' }] } }))
        return out
      }
      return server(name, args)
    }
    await expect(exportPlatformModel(call, 'm', path.join(tmp, 'y'))).rejects.toThrow(/more exposures/)
  })

  it('refuses an export directory that exists', async () => {
    fs.mkdirSync(path.join(tmp, 'x'))
    await expect(exportPlatformModel(fakeServer([]), 'm', path.join(tmp, 'x'))).rejects.toThrow(/exists/)
  })
})

describe('exportTriageModel', () => {
  /** The fake server, with list_model answering the given rows for the exported directory. */
  const withRows = (calls: Array<[string, Record<string, unknown>]>, rows: unknown[], modelId = 'model-1'): CallTool => {
    const base = fakeServer(calls)
    return async (name, args) => (name === 'query_exposures' && args.action === 'list_model' ? (calls.push([name, args]), { model_id: modelId, rows }) : base(name, args))
  }

  it('adds each exposure\'s lifecycle and def_hash from list_model over the exported directory', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const out = await exportTriageModel(withRows(calls, [{ exposure_id: 'e1', lifecycle: 'pending', def_hash: 'h1' }]), 'model-1', path.join(tmp, 'x'), new Date('2026-01-01T00:00:00Z'))
    expect(out.exposures).toEqual({ c1: [{ id: 'e1', name: 'Weak auth', exploitedBy: ['T1078', 'T1110'], lifecycle: 'pending', def_hash: 'h1' }] })
    expect(calls.at(-1)).toEqual(['query_exposures', { action: 'list_model', directory_path: path.join(tmp, 'x') }])
  })

  /** The fake server, with list_model answering in views: the partition by default, the rows view in pages of `size`. */
  const withViews = (calls: Array<[string, Record<string, unknown>]>, rows: unknown[], size: number, changes = 0, modelId = 'model-1'): CallTool => {
    const base = fakeServer(calls)
    let left = changes
    return async (name, args) => {
      if (name !== 'query_exposures' || args.action !== 'list_model') return base(name, args)
      calls.push([name, args])
      if (args.view === undefined) return { model_id: modelId, view: 'partition', exposures: rows.length }
      const offset = Number(args.offset ?? 0)
      if (offset > 0 && left > 0) {
        left--
        throw Object.assign(new Error("the model's exposures changed since the first page — start again at offset 0"), { data: { codes: ['listing_changed'] } })
      }
      const page = rows.slice(offset, offset + size)
      const next = offset + size < rows.length ? offset + size : undefined
      return { model_id: modelId, view: 'rows', select: 'all', rows: page, total: rows.length, returned: page.length, offset, truncated: next !== undefined, ...(next !== undefined ? { next_offset: next } : {}), listing: 'abcdef0123456789' }
    }
  }
  const twoRows = [{ exposure_id: 'e1', lifecycle: 'pending', def_hash: 'h1' }]

  it('walks the rows view page by page, passing the listing back, and exports the same as the one-reply shape', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const out = await exportTriageModel(withViews(calls, twoRows, 1), 'model-1', path.join(tmp, 'x'), new Date('2026-01-01T00:00:00Z'))
    const old = await exportTriageModel(withRows([], twoRows), 'model-1', path.join(tmp, 'y'), new Date('2026-01-01T00:00:00Z'))
    expect({ ...out, files: undefined }).toEqual({ ...old, files: undefined })
    const listCalls = calls.filter(([n, a]) => n === 'query_exposures' && a.action === 'list_model').map(([, a]) => a)
    expect(listCalls[1]).toMatchObject({ view: 'rows', select: 'all' })
  })

  it('reads every page of a longer list, and restarts once when the model changed between pages', async () => {
    const extra = [{ exposure_id: 'e1', lifecycle: 'pending', def_hash: 'h1' }, { exposure_id: 'e9', lifecycle: 'pending', def_hash: null }]
    await expect(exportTriageModel(withViews([], extra, 1), 'model-1', path.join(tmp, 'a'))).rejects.toThrow(/no element read returned/)
    const calls: Array<[string, Record<string, unknown>]> = []
    const many = Array.from({ length: 3 }, () => twoRows[0])
    const server = withViews(calls, many, 1, 1)
    // e1 three times over: the walk reads all three pages, after one restart.
    await exportTriageModel(server, 'model-1', path.join(tmp, 'b'))
    const pages = calls.filter(([n, a]) => n === 'query_exposures' && a.view === 'rows')
    expect(pages.map(([, a]) => a.offset ?? 0)).toEqual([0, 1, 0, 1, 2])
    expect(pages[1]![1]).toMatchObject({ listing: 'abcdef0123456789' })
    await expect(exportTriageModel(withViews([], many, 1, 2), 'model-1', path.join(tmp, 'c'))).rejects.toThrow(/changed since the first page/)
  })

  it('fails when the two reads do not name the same exposures, or list_model reads another model', async () => {
    await expect(exportTriageModel(withRows([], []), 'model-1', path.join(tmp, 'a'))).rejects.toThrow(/not in list_model/)
    await expect(exportTriageModel(withRows([], [{ exposure_id: 'e1', lifecycle: 'pending', def_hash: 'h1' }, { exposure_id: 'e9', lifecycle: 'pending', def_hash: null }]), 'model-1', path.join(tmp, 'b'))).rejects.toThrow(/no element read returned/)
    await expect(exportTriageModel(withRows([], [{ exposure_id: 'e1', lifecycle: 'pending', def_hash: 'h1' }], 'model-2'), 'model-1', path.join(tmp, 'c'))).rejects.toThrow(/another model/)
    await expect(exportTriageModel(withRows([], [{ exposure_id: 'e1', def_hash: 'h1' }]), 'model-1', path.join(tmp, 'd'))).rejects.toThrow(/without its id, lifecycle or def_hash/)
  })
})

