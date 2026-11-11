/**
 * export_model never exports over a directory that holds another platform model: whatever
 * if_exists says, the refusal comes before any backup or platform call, so nothing changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const { exportCalls } = vi.hoisted(() => ({ exportCalls: { n: 0 } }))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const { richExport } = await import('./fixtures/platform-export.js')
  return {
    ...actual,
    DtExportSplit: class {
      constructor(_client: any) {}
      exportModelToSplit = async () => {
        exportCalls.n++
        return richExport()
      }
    },
  }
})

const { exportModelTool } = await import('../export-model.tool.js')
const { writeSyncJson } = await import('../../utils/sync-utils.js')
const { initProjectRoot, resetProjectRoot } = await import('../../utils/project-root.js')

const context = { apolloClient: {} as any, debug: false }

/** Every file under <dir>, by relative path and content hash. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p)] = createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    }
  }
  walk(dir)
  return out
}

describe('export_model and a directory linked to another platform model', () => {
  let tmp: string
  let project: string
  let dir: string
  const savedHome = process.env.HOME

  beforeEach(async () => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-export-linked-')))
    project = path.join(tmp, 'project')
    dir = path.join(project, 'model')
    fs.mkdirSync(path.join(dir, '.dethereal'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: '2.0.0', format: 'split', model: { id: 'other-model', name: 'Other' } }))
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
    exportCalls.n = 0
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('refuses, whatever if_exists says, before any backup or platform call', async () => {
    await writeSyncJson(dir, { platform_model_id: 'other-model', platform_url: 'http://localhost:3000' })
    const before = snapshot(project)
    for (const ifExists of ['backup', 'update', 'error'] as const) {
      const r = await exportModelTool.run({ model_id: 'm-1', directory_path: dir, if_exists: ifExists }, context)
      expect(r.success, ifExists).toBe(false)
      expect(r.error).toContain('directory_linked_to_other_model')
      expect(r.data).toMatchObject({ code: 'directory_linked_to_other_model', linked_model_id: 'other-model' })
    }
    expect(exportCalls.n).toBe(0)
    expect(snapshot(project)).toEqual(before)
  })

  it('exports over the same platform model', async () => {
    await writeSyncJson(dir, { platform_model_id: 'm-1', platform_url: 'http://localhost:3000' })
    const r = await exportModelTool.run({ model_id: 'm-1', directory_path: dir, if_exists: 'backup' }, context)
    expect(r.success, r.error).toBe(true)
    expect(exportCalls.n).toBe(1)
  })

  it('exports into a directory with no platform model recorded', async () => {
    for (const record of [null, { platform_model_id: '', platform_url: 'x' }]) {
      if (record) await writeSyncJson(dir, record)
      const r = await exportModelTool.run({ model_id: 'm-1', directory_path: dir, if_exists: 'backup' }, context)
      expect(r.success, `${JSON.stringify(record)}: ${r.error}`).toBe(true)
    }
    expect(exportCalls.n).toBe(2)
  })
})
