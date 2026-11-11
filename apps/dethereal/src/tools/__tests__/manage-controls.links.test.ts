/**
 * manage_controls against a model directory whose repository planted links or a
 * journal. Runs the real control library (not mocked): every refusal must come
 * before the lock, any replay, or any platform call, and nothing outside the
 * project may change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setJournalAuthenticator, appendOperation } from '@dethernety/dt-core'
import { manageControlsTool, installJournalAuthenticator } from '../manage-controls.tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import type { ToolContext } from '../base-tool.js'

const TEMP_ID = 'greenfield-abc123'
const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('manage_controls with a planted tree', () => {
  let tmp: string
  let project: string
  let model: string
  let outside: string
  const savedHome = process.env.HOME
  const context = { debug: false, apolloClient: {} } as unknown as ToolContext

  const snapshot = (dir: string) =>
    Object.fromEntries(
      fs.readdirSync(dir, { recursive: true }).map(String).sort().map((f) => {
        const st = fs.lstatSync(path.join(dir, f))
        return [f, st.isFile() ? fs.readFileSync(path.join(dir, f), 'utf8') : st.isDirectory() ? '<dir>' : '<other>']
      })
    )
  const run = (action: string) => manageControlsTool.execute({ action, directory_path: model, control_ids: [] } as never, context)
  const lockPresent = () => fs.existsSync(path.join(model, '.dethereal', '.control-library.lock'))

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-controls-')))
    project = path.join(tmp, 'project')
    model = path.join(project, 'model')
    outside = path.join(tmp, 'outside')
    fs.mkdirSync(path.join(model, '.dethereal'), { recursive: true })
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'keep.json'), '{"secret":"CANARY"}')
    fs.writeFileSync(path.join(outside, `${TEMP_ID}.json`), JSON.stringify({ id: TEMP_ID }))
    fs.writeFileSync(path.join(model, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(model, 'structure.json'), JSON.stringify({ c: [{ id: TEMP_ID }] }))
    fs.writeFileSync(path.join(model, 'dataflows.json'), '{}')
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it.each(['pull-controls', 'push-brownfield', 'inspect-wal', 'clear-wal'])(
    '%s refuses a linked controls/ before the lock, and nothing outside changes',
    async (action) => {
      fs.symlinkSync(outside, path.join(model, 'controls'))
      const before = snapshot(outside)
      const result = await run(action)
      expect(result).toMatchObject({ success: false, error: 'MODEL_TREE_UNSAFE', data: { path: 'controls', code: 'symlink' } })
      expect(JSON.stringify(result)).not.toContain(tmp)
      expect(lockPresent()).toBe(false)
      expect(snapshot(outside)).toEqual(before)
    }
  )

  it('refuses an audit log that is a link before any platform change', async () => {
    fs.symlinkSync(path.join(outside, 'keep.json'), path.join(model, '.dethereal', 'control-audit.log'))
    const result = await run('push-brownfield')
    expect(result).toMatchObject({ error: 'MODEL_TREE_UNSAFE', data: { path: '.dethereal/control-audit.log', code: 'symlink' } })
    expect(fs.readFileSync(path.join(outside, 'keep.json'), 'utf8')).toBe('{"secret":"CANARY"}')
  })

  it('never replays a journal committed to the repository, and says to inspect and clear it', async () => {
    fs.mkdirSync(path.join(model, 'controls'))
    fs.writeFileSync(path.join(model, 'controls', `${TEMP_ID}.json`), JSON.stringify({ id: TEMP_ID }))
    fs.writeFileSync(
      path.join(model, '.dethereal', 'pending-id-rewrite.json'),
      JSON.stringify({
        operations: [
          {
            kind: 'greenfield-id-rewrite',
            tempId: TEMP_ID,
            serverId: SERVER_ID,
            filePaths: ['structure.json', 'dataflows.json', `controls/${TEMP_ID}.json`],
            controlFileRename: { from: `controls/${TEMP_ID}.json`, to: `controls/${SERVER_ID}.json` },
            createdAt: '2026-04-18T12:00:00Z',
          },
        ],
      })
    )
    const before = snapshot(model)
    const result = await run('pull-controls')
    expect(result).toMatchObject({ success: false, error: 'WAL_JOURNAL_REJECTED', data: { reason: 'unverified', recoveryHint: 'repair-wal' } })
    expect(lockPresent()).toBe(false)
    expect(snapshot(model)).toEqual(before)

    const inspection = await run('inspect-wal')
    expect(inspection).toMatchObject({ success: true, data: { present: true, verified: false } })
  })

  it('signs journals with a key from outside the project only', async () => {
    installJournalAuthenticator()
    fs.mkdirSync(path.join(model, 'controls'))
    const op = {
      kind: 'greenfield-id-rewrite',
      tempId: TEMP_ID,
      serverId: SERVER_ID,
      filePaths: ['structure.json', 'dataflows.json', `controls/${TEMP_ID}.json`],
      controlFileRename: { from: `controls/${TEMP_ID}.json`, to: `controls/${SERVER_ID}.json` },
      createdAt: '2026-04-18T12:00:00Z',
    }
    const journal = () => JSON.parse(fs.readFileSync(path.join(model, '.dethereal', 'pending-id-rewrite.json'), 'utf8'))

    // A key directory inside the project is refused: the journal is still written, unsigned.
    process.env.HOME = path.join(project, 'home-inside')
    fs.mkdirSync(process.env.HOME)
    await appendOperation(model, op as never)
    expect(journal().mac).toBeUndefined()
    expect(fs.existsSync(path.join(project, 'home-inside', '.dethernety'))).toBe(false)

    fs.rmSync(path.join(model, '.dethereal', 'pending-id-rewrite.json'))
    process.env.HOME = path.join(tmp, 'home')
    await appendOperation(model, op as never)
    expect(journal().mac).toMatch(/^[0-9a-f]{64}$/)
  })

  it('installs the journal authenticator once; nothing can replace it afterwards', () => {
    installJournalAuthenticator()
    expect(() => installJournalAuthenticator()).not.toThrow()
    expect(() => setJournalAuthenticator({ sign: async () => null, verify: async () => true })).toThrow(/already installed/)
  })
})
