/**
 * Files the server records so the prose never writes them by hand: the quality
 * result (`.dethereal/quality.json`, which status and help read) and a new model's
 * registry entry (`.dethernety/models.json`) when its workflow state is created.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ToolContext } from '../base-tool.js'
import { validateModelTool } from '../validate-model.tool.js'
import { modelStateTool } from '../model-state.tool.js'
import { workspaceStatusTool } from '../workspace-status.tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'

const context: ToolContext = { debug: false }

describe('what the server records', () => {
  let tmp: string
  let project: string
  let dir: string
  const savedHome = process.env.HOME
  const quality = () => path.join(dir, '.dethereal', 'quality.json')
  const registry = () => path.join(project, '.dethernety', 'models.json')

  beforeEach(async () => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-records-')))
    project = path.join(tmp, 'project')
    dir = path.join(project, 'threat-models', 'shop')
    fs.mkdirSync(dir, { recursive: true })
    await writeGateModel(dir, gateModel())
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  describe('the quality result', () => {
    it('is recorded verbatim, and status reads the score from it', async () => {
      const r = await validateModelTool.run({ action: 'quality', directory_path: dir }, context)
      expect(r.success).toBe(true)
      expect(r.data).toMatchObject({ quality_recorded: true })
      const stored = JSON.parse(fs.readFileSync(quality(), 'utf8'))
      const { quality_recorded: _flag, ...payload } = r.data as unknown as Record<string, unknown>
      expect(stored).toEqual(payload)

      fs.mkdirSync(path.dirname(registry()), { recursive: true })
      fs.writeFileSync(registry(), JSON.stringify({ version: 1, models: [{ name: 'Shop', path: './threat-models/shop' }] }))
      const status = await workspaceStatusTool.run({}, context)
      expect((status.data as { models: Array<{ qualityScore?: number }> }).models[0]?.qualityScore).toBe(Math.round(stored.quality_score))
    })

    it('is not rewritten when unchanged, and no other action writes it', async () => {
      for (const action of ['validate', 'gates', 'coverage', 'zoning']) {
        await validateModelTool.run({ action, directory_path: dir }, context)
        expect(fs.existsSync(quality()), action).toBe(false)
      }
      await validateModelTool.run({ action: 'quality', directory_path: dir }, context)
      const before = fs.statSync(quality()).mtimeMs
      await new Promise((r) => setTimeout(r, 20))
      await validateModelTool.run({ action: 'quality', directory_path: dir }, context)
      expect(fs.statSync(quality()).mtimeMs).toBe(before)
    })

    it('is refused through a link, with a warning, and nothing outside is written', async () => {
      const outside = path.join(tmp, 'outside.json')
      fs.writeFileSync(outside, '{"planted":true}')
      fs.symlinkSync(outside, quality())
      const r = await validateModelTool.run({ action: 'quality', directory_path: dir }, context)
      expect(r.success).toBe(true)
      expect(r.data).toMatchObject({ quality_recorded: false })
      expect((r.data as { warnings: string[] }).warnings.join('\n')).toMatch(/\.dethereal\/quality\.json could not be recorded \(/)
      expect(fs.readFileSync(outside, 'utf8')).toBe('{"planted":true}')
    })

    it('and model_state, run together, leave both files whole', async () => {
      await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'INITIALIZED' }, context)
      for (let round = 0; round < 5; round++) {
        const [q, s] = await Promise.all([
          validateModelTool.run({ action: 'quality', directory_path: dir }, context),
          modelStateTool.run({ action: 'stale', directory_path: dir, add: [`c-${round}`] }, context),
        ])
        expect(q.data).toMatchObject({ quality_recorded: true })
        expect(s.success, JSON.stringify(s)).toBe(true)
      }
      expect(() => JSON.parse(fs.readFileSync(quality(), 'utf8'))).not.toThrow()
      const state = JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8'))
      expect(state.currentState).toBe('INITIALIZED')
    })
  })

  describe('a new model in the registry', () => {
    it('is registered when its state is created, under its manifest name, and only then', async () => {
      const first = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'SCOPE_DEFINED' }, context)
      expect(first.success, JSON.stringify(first)).toBe(true)
      expect(first.data).toMatchObject({ registered: true })
      const doc = JSON.parse(fs.readFileSync(registry(), 'utf8'))
      expect(doc.models).toEqual([expect.objectContaining({ name: gateModel().manifest.model.name, path: './threat-models/shop', source: 'local' })])

      fs.writeFileSync(registry(), JSON.stringify({ version: 1, models: [] }))
      const later = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'SCOPE_DEFINED' }, context)
      expect(later.success).toBe(true)
      expect(later.data).not.toHaveProperty('registered')
      expect(JSON.parse(fs.readFileSync(registry(), 'utf8')).models).toEqual([])
    })

    it('falls back to the directory name when the manifest names no model', async () => {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
      delete m.model.name
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m))
      await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'INITIALIZED' }, context)
      expect(JSON.parse(fs.readFileSync(registry(), 'utf8')).models[0].name).toBe('shop')
    })

    it('never blocks the state: a registry that cannot be written still leaves the transition done', async () => {
      // (model_state itself refuses without a project root, so the refusal comes from the registry.)
      fs.mkdirSync(path.dirname(registry()), { recursive: true })
      fs.writeFileSync(registry(), JSON.stringify({ models: { not: 'a list' } }))
      const r = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'INITIALIZED' }, context)
      expect(r.success, JSON.stringify(r)).toBe(true)
      expect(r.data).toMatchObject({ registered: false, warnings: [expect.stringMatching(/not registered in \.dethernety\/models\.json \(models_not_array\)/)] })
      expect(JSON.parse(fs.readFileSync(path.join(dir, '.dethereal', 'state.json'), 'utf8')).currentState).toBe('INITIALIZED')
      expect(JSON.parse(fs.readFileSync(registry(), 'utf8'))).toEqual({ models: { not: 'a list' } })
    })
  })
})
