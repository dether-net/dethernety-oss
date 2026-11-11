/**
 * The guards as OpenCode's plugin runs them: `hook secret-guard --harness opencode` before reads,
 * searches and shell commands, `hook config-guard --harness opencode` before every file write, each
 * answering `{"deny":false}` or `{"deny":true,"reason":…}`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawEventFrom } from '../config-guard.js'
import { runCli } from '../index.js'

let tmp: string
let home: string
let project: string
let saved: Record<string, string | undefined>

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'opencode-guards-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(project, { recursive: true })
  file('.dethernety/tokens.json', '{}\n', home)
  file('.dethernety/runtime/0.5.0/dist/index.js', 'export {}\n', home)
  file('.dethernety/runtime/current.json', '{}\n', home)
  file('.opencode/skills/dethereal-status/SKILL.md', '---\nname: dethereal-status\n---\n')
  file('deploy/orders/db-connection.yaml', 'apiVersion: v1\nkind: Secret\n')
  file('.env', 'TOKEN=x\n')
  file('src/app.ts', 'export {}\n')
  saved = { HOME: process.env.HOME, DETHEREAL_PROJECT_ROOT: process.env.DETHEREAL_PROJECT_ROOT, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
  process.env.HOME = home
  process.env.DETHEREAL_PROJECT_ROOT = project
  delete process.env.XDG_CONFIG_HOME
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(tmp, { recursive: true, force: true })
})

function file(rel: string, content: string, base = project): string {
  const f = path.join(base, rel)
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, content)
  return f
}

async function hook(command: 'secret-guard' | 'config-guard', tool: string, args: Record<string, unknown>): Promise<{ deny: boolean; reason?: string }> {
  const out: string[] = []
  const event = rawEventFrom(JSON.stringify({ tool, directory: project, args }))
  const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => event }
  expect(await runCli(['hook', command, '--harness', 'opencode'], io as never)).toBe(0)
  return JSON.parse(out.join('')) as { deny: boolean; reason?: string }
}

describe('OpenCode: the server folder in the home directory', () => {
  it('denies a read of tokens.json through `..` in a skill folder', async () => {
    const through = path.join(project, '.opencode/skills/dethereal-status/../../../../home/.dethernety/tokens.json')
    expect(await hook('secret-guard', 'read', { filePath: through })).toMatchObject({ deny: true, reason: expect.stringMatching(/server's own folder/) })
  })

  it('denies a write to the runtime dist and to current.json, which the plugin and the server execute', async () => {
    const dist = path.join(home, '.dethernety/runtime/0.5.0/dist/index.js')
    expect(await hook('config-guard', 'write', { filePath: dist, content: 'evil()' })).toMatchObject({ deny: true, reason: expect.stringMatching(/server's own folder/) })
    expect(await hook('config-guard', 'edit', { filePath: path.join(home, '.dethernety/runtime/current.json'), oldString: '{}', newString: '{"x":1}' })).toMatchObject({ deny: true })
    expect(await hook('config-guard', 'apply_patch', { patchText: `*** Begin Patch\n*** Update File: ${dist}\n@@\n+evil()\n*** End Patch` })).toMatchObject({ deny: true })
    symlinkSync(path.join(home, '.dethernety'), path.join(project, 'state'))
    expect(await hook('config-guard', 'write', { filePath: 'state/runtime/current.json', content: '{}' })).toMatchObject({ deny: true })
  })
})

describe("OpenCode: writes the config guard judges", () => {
  it("denies an opencode.json edit that widens what runs unasked, and allows one that doesn't", async () => {
    file('opencode.json', '{\n  "permission": { "dethereal_model_state_waive": "ask" }\n}\n')
    expect(await hook('config-guard', 'edit', { filePath: 'opencode.json', oldString: '"ask"', newString: '"allow"' })).toMatchObject({ deny: true })
    expect(await hook('config-guard', 'write', { filePath: 'opencode.json', content: '{\n  "permission": { "dethereal_model_state_waive": "ask" },\n  "theme": "x"\n}\n' })).toEqual({ deny: false })
  })

  it('denies any write to an OpenCode plugin folder', async () => {
    expect(await hook('config-guard', 'write', { filePath: '.opencode/plugins/x.ts', content: 'export const P = async () => ({})' })).toMatchObject({ deny: true })
    expect(await hook('config-guard', 'write', { filePath: path.join(home, '.config/opencode/plugin/x.js'), content: '' })).toMatchObject({ deny: true })
  })

  it('denies moving or editing a project secret into a readable form, and lets one be overwritten or deleted', async () => {
    expect(await hook('config-guard', 'apply_patch', { patchText: '*** Begin Patch\n*** Update File: deploy/orders/db-connection.yaml\n*** Move to: notes.txt\n@@\n kind: Secret\n*** End Patch' })).toMatchObject({ deny: true, reason: expect.stringMatching(/secret file/) })
    expect(await hook('config-guard', 'edit', { filePath: 'deploy/orders/db-connection.yaml', oldString: 'kind: Secret', newString: 'kind: ConfigMap' })).toMatchObject({ deny: true })
    expect(await hook('config-guard', 'multiedit', { filePath: '.env', edits: [{ oldString: 'TOKEN=x', newString: 'X' }] })).toMatchObject({ deny: true })
    expect(await hook('config-guard', 'write', { filePath: '.env', content: 'TOKEN=\n' })).toEqual({ deny: false })
    expect(await hook('config-guard', 'apply_patch', { patchText: '*** Begin Patch\n*** Delete File: .env\n*** End Patch' })).toEqual({ deny: false })
  })

  it('allows an ordinary write and edit', async () => {
    expect(await hook('config-guard', 'write', { filePath: 'src/new.ts', content: 'export {}\n' })).toEqual({ deny: false })
    expect(await hook('config-guard', 'edit', { filePath: 'src/app.ts', oldString: 'export {}', newString: 'export const a = 1' })).toEqual({ deny: false })
  })

  it('denies a write it cannot read, or a tool that is not a write', async () => {
    const out: string[] = []
    const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => ({ text: null, fields: new Map() }) }
    expect(await runCli(['hook', 'config-guard', '--harness', 'opencode'], io as never)).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ deny: true })
    expect(await hook('config-guard', 'read', { filePath: 'src/app.ts' })).toMatchObject({ deny: true })
  })
})
