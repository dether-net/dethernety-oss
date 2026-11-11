/**
 * The platform export for scoring: the exported model's files, plus every
 * element's exposures with the ATT&CK ids that exploit them, taken through the
 * server's tools (a fake caller here).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportPlatformModel, type CallTool } from '../platform-export.js'

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
