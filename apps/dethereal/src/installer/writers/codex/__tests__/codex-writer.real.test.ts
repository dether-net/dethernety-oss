/**
 * The Codex writer against the real `codex` CLI, in a fresh home with no sign-in:
 * install, upgrade and uninstall, checked with Codex's own listings. No model is
 * called. Runs only with DETHEREAL_CODEX_TEST=1 and DETHEREAL_CODEX_BIN naming the
 * codex binary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { PACKAGE_GOLDENS } from '../../../../generator/cli.js'
import { readManifest, withStateLock } from '../../../core/manifest.js'
import { ensureStateRoot, type InstallerEnv, type StatePaths } from '../../../core/paths.js'
import { installRuntime } from '../../../core/runtime.js'
import { installCodex, uninstallCodex } from '../index.js'
import { listMcpServers } from '../cli.js'

const enabled = process.env.DETHEREAL_CODEX_TEST === '1' && !!process.env.DETHEREAL_CODEX_BIN
const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', '..')

describe.skipIf(!enabled)('the Codex writer with the real codex CLI', () => {
  let root: string
  let home: string
  let codexHome: string
  let env: InstallerEnv
  let paths: StatePaths
  const savedPath = process.env.PATH
  const codex = (...args: string[]) => execFileSync(process.env.DETHEREAL_CODEX_BIN!, args, {
    encoding: 'utf8', env: { PATH: savedPath, HOME: home, CODEX_HOME: codexHome }, cwd: home,
  })

  async function runtime(version: string) {
    const src = path.join(root, `src-${version}`)
    await fs.mkdir(path.join(src, 'dist'), { recursive: true })
    await fs.writeFile(path.join(src, 'dist', 'index.js'), 'export {}\n')
    await fs.cp(path.join(PACKAGE_GOLDENS, 'codex', 'bundles', 'codex'), path.join(src, 'bundles', 'codex'), { recursive: true })
    const pj = path.join(src, 'bundles', 'codex', 'plugins', 'dethereal', '.codex-plugin', 'plugin.json')
    await fs.writeFile(pj, (await fs.readFile(pj, 'utf8')).replace(/"version": "[^"]+"/, `"version": "${version}"`))
    return installRuntime(paths, env, src, version)
  }
  const install = async (version: string) => {
    const rt = await runtime(version)
    return withStateLock(paths, env, (lock) => installCodex({
      ctx: { paths, env, lock }, scope: 'user', platformUrl: 'http://127.0.0.1:9', runtime: { version: rt.version, runtimePath: rt.runtimePath }, node: process.execPath,
    }))
  }

  beforeAll(async () => {
    // The runner takes codex only from a PATH entry outside node_modules and the temp folders.
    root = await fs.realpath(await fs.mkdtemp(path.join(PKG_ROOT, '.test-codex-real-')))
    await fs.mkdir(path.join(root, 'bin'))
    await fs.symlink(process.env.DETHEREAL_CODEX_BIN!, path.join(root, 'bin', 'codex'))
    process.env.PATH = `${path.join(root, 'bin')}${path.delimiter}${savedPath ?? ''}`
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codex-real-home-')))
    codexHome = path.join(home, '.codex')
    await fs.mkdir(codexHome, { mode: 0o700 })
    env = { home, vars: { HOME: home, CODEX_HOME: codexHome }, euid: process.geteuid!(), platform: process.platform }
    paths = (await ensureStateRoot(env)).paths
  })
  afterAll(async () => {
    process.env.PATH = savedPath
    execFileSync('chmod', ['-R', 'u+w', home])
    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(root, { recursive: true, force: true })
  })

  it('installs, upgrades and uninstalls, leaving config.toml as it was', async () => {
    const before = 'model = "gpt-5"\n\n[projects."/tmp/elsewhere"]\ntrust_level = "trusted"\n'
    await fs.writeFile(path.join(codexHome, 'config.toml'), before)

    await install('0.5.0')
    expect(codex('mcp', 'list')).toMatch(/^dethereal\s/m)
    expect((await listMcpServers({ env, cwd: home })).find((s) => s.name === 'dethereal')).toMatchObject({
      enabled: true, transport: { command: process.execPath, args: [path.join(paths.runtime, '0.5.0', 'dist', 'index.js')], env: { DETHERNETY_PLATFORM_URL: 'http://127.0.0.1:9' } },
    })
    // the install URL is a default: Codex passes a DETHERNETY_URL from its own environment through
    expect((await listMcpServers({ env, cwd: home })).find((s) => s.name === 'dethereal')?.transport.env_vars).toContain('DETHERNETY_URL')
    const skills = new Set(codex('debug', 'prompt-input').match(/dethereal:[a-z0-9-]+:/g))
    expect(skills.size).toBe(17)
    expect(JSON.parse(codex('plugin', 'list', '--json')).installed).toEqual([expect.objectContaining({ pluginId: 'dethereal@dethereal-local', version: '0.5.0' })])
    expect((await fs.readdir(path.join(codexHome, 'agents'))).filter((n) => n.startsWith('dethereal-'))).toHaveLength(5)

    await install('0.5.1')
    const text = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')
    expect(text.match(/# >>> dethereal managed >>>/g)).toHaveLength(1)
    expect(JSON.parse(codex('plugin', 'list', '--json')).installed).toEqual([expect.objectContaining({ version: '0.5.1' })])
    expect((await readManifest(paths, env)).manifest.installs['codex:user']?.runtimes).toEqual(['0.5.1'])

    const r = await withStateLock(paths, env, (lock) => uninstallCodex({ ctx: { paths, env, lock }, scope: 'user' }))
    expect(r.manual).toEqual([])
    expect(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).toBe(before)
    expect(JSON.parse(codex('plugin', 'list', '--json')).installed).toEqual([])
    expect(JSON.parse(codex('plugin', 'marketplace', 'list', '--json')).marketplaces).toEqual([])
    expect(codex('mcp', 'list')).not.toMatch(/^dethereal\s/m)
  }, 120_000)

  it('upgrades and uninstalls after Codex rewrote its table on `codex mcp add`, keeping the other server', async () => {
    const before = 'model = "gpt-5"\n'
    await fs.writeFile(path.join(codexHome, 'config.toml'), before)
    await install('0.6.0')
    codex('mcp', 'add', 'zz', '--', '/usr/bin/true')
    // Codex re-serialized every server table and dropped our opening marker.
    expect(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).not.toContain('# >>> dethereal managed >>>')
    const r = await install('0.6.1')
    expect(r.reset).toEqual([])
    const text = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')
    expect(text.match(/# >>> dethereal managed >>>/g)).toHaveLength(1)
    expect(text.match(/# <<< dethereal managed <<</g)).toHaveLength(1)
    expect(codex('mcp', 'list')).toMatch(/^zz\s/m)
    codex('mcp', 'add', 'yy', '--', '/usr/bin/true')
    const u = await withStateLock(paths, env, (lock) => uninstallCodex({ ctx: { paths, env, lock }, scope: 'user' }))
    expect(u.manual).toEqual([])
    const after = parseToml(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')) as Record<string, Record<string, unknown>>
    expect(Object.keys(after.mcp_servers ?? {}).sort()).toEqual(['yy', 'zz'])
    expect(after.model).toBe('gpt-5')
    expect(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).not.toMatch(/dethereal/)
  }, 120_000)
})
