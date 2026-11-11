/**
 * The editors wired into the transaction: install a merge, let the user edit the
 * file, and uninstall; only the owned part leaves, and a changed owned value is reported.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ownedModified, unmergeRecord } from '../editors.js'
import { mergeJson } from '../merge-jsonc.js'
import { mergeToml } from '../merge-toml.js'
import { ensureStateRoot, type InstallerEnv, resolveRoot } from '../paths.js'
import { readTarget, resolveTarget, type AllowedTarget } from '../safe-write.js'
import { applyFileChange, revertFile, type TxContext } from '../transaction.js'

const JSONC_ALLOW = { format: 'jsonc' as const, paths: [['mcp', 'dethereal']] }
const TOML_ALLOW = { format: 'toml' as const, paths: [['mcp_servers', 'dethereal']] }

let tmp: string
let env: InstallerEnv
let ctx: TxContext
let allowed: AllowedTarget[]
beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-editors-')))
  const home = path.join(tmp, 'home')
  await fs.mkdir(home, { mode: 0o700 })
  env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
  const { paths } = await ensureStateRoot(env)
  ctx = { paths, env }
  const root = await resolveRoot(home, env, '~')
  allowed = [{ root, pattern: '.config/opencode/opencode.json' }, { root, pattern: '.codex/config.toml' }]
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function install(rel: string, original: string, merge: (b: Buffer | null) => { bytes: Buffer; owned: { path: string[]; valueSha256: string } }, format: 'jsonc' | 'toml') {
  const file = path.join(allowed[0]!.root, ...rel.split('/'))
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, original)
  const t = resolveTarget(file, allowed)
  const cur = (await readTarget(t, env))!
  const m = merge(cur.bytes)
  await applyFileChange(ctx, { key: format === 'toml' ? 'codex:user' : 'opencode:user', version: '0.5.0', target: t, format, expectPre: cur.sha256, next: m.bytes, owned: [m.owned] })
  return file
}

describe('uninstall through the editors', () => {
  it('takes only the owned key out of a JSONC file the user has edited, and reports a changed owned value', async () => {
    const original = '{\n  // mine\n  "theme": "dark",\n  "mcp": {\n    "other": { "command": ["x"] }\n  }\n}\n'
    const file = await install('.config/opencode/opencode.json', original, (b) => mergeJson(b, ['mcp', 'dethereal'], { command: ['node', 'a.js'] }, 'jsonc', 'opencode.json'), 'jsonc')
    const edited = (await fs.readFile(file, 'utf8')).replace('"theme": "dark"', '"theme": "light"').replace('"a.js"', '"b.js"')
    await fs.writeFile(file, edited)
    const rec = (await import('../manifest.js')).readManifest
    const record = (await rec(ctx.paths, env)).manifest.installs['opencode:user']!.files[0]!
    expect(ownedModified(Buffer.from(edited), record)).toEqual([['mcp', 'dethereal']])
    expect(await revertFile(ctx, 'opencode:user', file, allowed, (b, r) => unmergeRecord(b, r, 'opencode.json', JSONC_ALLOW))).toBe('unmerged')
    expect(await fs.readFile(file, 'utf8')).toBe(original.replace('"theme": "dark"', '"theme": "light"'))
  })

  it('takes the managed block out of a TOML file the user has edited', async () => {
    const original = 'model = "o4"\n\n[profiles.fast]\nmodel = "o4-mini"\n'
    const file = await install('.codex/config.toml', original, (b) => mergeToml(b, ['mcp_servers', 'dethereal'], '[mcp_servers.dethereal]\ncommand = "node"\n', 'config.toml'), 'toml')
    await fs.writeFile(file, 'approval_policy = "on-request"\n' + (await fs.readFile(file, 'utf8')))
    expect(await revertFile(ctx, 'codex:user', file, allowed, (b, r) => unmergeRecord(b, r, 'config.toml', TOML_ALLOW))).toBe('unmerged')
    expect(await fs.readFile(file, 'utf8')).toBe('approval_policy = "on-request"\n' + original)
  })

  it('leaves a file whose owned part the user removed by hand to the user', async () => {
    const original = 'model = "o4"\n'
    const file = await install('.codex/config.toml', original, (b) => mergeToml(b, ['mcp_servers', 'dethereal'], '[mcp_servers.dethereal]\ncommand = "node"\n', 'config.toml'), 'toml')
    await fs.writeFile(file, 'model = "o5"\n')
    expect(await revertFile(ctx, 'codex:user', file, allowed, (b, r) => unmergeRecord(b, r, 'config.toml', TOML_ALLOW))).toBe('manual')
    expect(await fs.readFile(file, 'utf8')).toBe('model = "o5"\n')
  })

  it('refuses owned paths or a format the writer does not allow, whatever the manifest says', async () => {
    const original = '{\n  "theme": "dark"\n}\n'
    const file = await install('.config/opencode/opencode.json', original, (b) => mergeJson(b, ['mcp', 'dethereal'], { command: ['x'] }, 'jsonc', 'opencode.json'), 'jsonc')
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('"dark"', '"light"'))
    const narrow = { format: 'jsonc' as const, paths: [['theme']] }
    expect(await revertFile(ctx, 'opencode:user', file, allowed, (b, r) => unmergeRecord(b, r, 'opencode.json', narrow))).toBe('refused')
    expect(await revertFile(ctx, 'opencode:user', file, allowed, (b, r) => unmergeRecord(b, r, 'opencode.json', { ...JSONC_ALLOW, format: 'json' }))).toBe('refused')
    expect(await fs.readFile(file, 'utf8')).toContain('"light"')
  })

  it('reports a file it can no longer parse as manual instead of stopping the uninstall', async () => {
    const file = await install('.config/opencode/opencode.json', '{}', (b) => mergeJson(b, ['mcp', 'dethereal'], { command: ['x'] }, 'jsonc', 'opencode.json'), 'jsonc')
    await fs.writeFile(file, '{ "mcp": ')
    expect(await revertFile(ctx, 'opencode:user', file, allowed, (b, r) => unmergeRecord(b, r, 'opencode.json', JSONC_ALLOW))).toBe('manual')
  })
})
