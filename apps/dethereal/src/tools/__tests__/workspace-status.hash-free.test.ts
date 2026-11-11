/**
 * Only an explicit one-model request hashes a model. The workspace listing, the
 * session-start hook and `workspace-status --json` run on every session start and
 * must stay cheap: they never compute a content hash.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { calls } = vi.hoisted(() => ({ calls: { localChangeStatus: 0 } }))

vi.mock('../../utils/sync-utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/sync-utils.js')
  return {
    ...actual,
    localChangeStatus: async (dir: string) => {
      calls.localChangeStatus += 1
      return actual.localChangeStatus(dir)
    },
  }
})

import { workspaceStatusTool, collectWorkspaceStatus } from '../workspace-status.tool.js'
import { runCli } from '../../cli/index.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'

describe('the workspace listing never hashes a model', () => {
  let tmp: string
  let root: string
  let dir: string
  const savedHome = process.env.HOME

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-hashfree-')))
    root = path.join(tmp, 'project')
    dir = path.join(root, 'models', 'a')
    fs.mkdirSync(path.join(root, '.git'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.dethereal'), { recursive: true })
    fs.mkdirSync(path.join(root, '.dethernety'))
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{"model":{"name":"A"}}')
    fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify({ last_push_at: '2026-09-26T10:00:00Z', push_content_hash: 'sha256:v2:x' }))
    fs.writeFileSync(path.join(root, '.dethernety', 'models.json'), JSON.stringify({ models: [{ name: 'A', path: 'models/a' }] }))
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: root, env: {} })
    calls.localChangeStatus = 0
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('the listing, the session-start hook and workspace-status --json', async () => {
    const io = { stdout: () => undefined, stderr: () => undefined, stdin: async () => null }
    await collectWorkspaceStatus()
    await workspaceStatusTool.run({}, { debug: false })
    for (const source of ['startup', 'compact']) {
      expect(await runCli(['hook', 'session-start', '--source', source], io)).toBe(0)
    }
    expect(await runCli(['workspace-status', '--json'], io)).toBe(0)
    expect(calls.localChangeStatus).toBe(0)
  })

  it('only a one-model request does', async () => {
    await workspaceStatusTool.run({ directory_path: dir }, { debug: false })
    expect(calls.localChangeStatus).toBe(1)
  })
})
