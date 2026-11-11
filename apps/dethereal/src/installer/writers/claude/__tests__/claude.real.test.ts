/**
 * The writer with the real `claude` CLI: the shipped build in a local
 * marketplace, installed for the user and for a project in a fresh home with no
 * sign-in, checked as Claude reports it (listed, enabled, its MCP server
 * connected), and uninstalled again to nothing.
 *
 * It needs the `claude` CLI on PATH and changes nothing outside its own folder, so
 * it runs only with DETHEREAL_CLAUDE_TEST=1. No step reaches a model.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { shippedBuild } from '../../../../packaging/shipped-build.js'
import { ensureStateRoot, type InstallerEnv } from '../../../core/paths.js'
import { installClaude, uninstallClaude } from '../index.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')

describe.skipIf(process.env.DETHEREAL_CLAUDE_TEST !== '1')('the Claude writer with the real CLI', () => {
  let root: string
  let home: string
  let mkt: string
  let plugin: string
  let project: string
  let env: InstallerEnv

  const claude = (args: string[], cwd = root) =>
    spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: 120_000, env: { HOME: home, PATH: process.env.PATH ?? '', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } })
  const settings = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'))

  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(pkgRoot, '.test-claude-real-')))
    home = path.join(root, 'home')
    project = path.join(root, 'project')
    mkt = path.join(root, 'mkt')
    plugin = path.join(mkt, 'dethereal')
    await fs.mkdir(home, { mode: 0o700 })
    await fs.mkdir(project)
    await fs.mkdir(path.join(mkt, '.claude-plugin'), { recursive: true })
    // The plugin as the package ships it: the shipped build, the generated plugin root, the manifest.
    await build({ ...shippedBuild, config: false, entry: { index: path.join(pkgRoot, 'src', 'index.ts') }, outDir: path.join(plugin, 'dist'), clean: false, silent: true })
    for (const f of ['package.json', '.claude-plugin', 'bundles/claude']) await fs.cp(path.join(pkgRoot, f), path.join(plugin, f), { recursive: true })
    await fs.writeFile(path.join(mkt, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'dethereal-rc', owner: { name: 'test' }, plugins: [{ name: 'dethereal', source: './dethereal' }] }))
    env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
  }, 180_000)

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('installs for the user and a project, runs, and uninstalls to nothing', async () => {
    const ctx = { paths: (await ensureStateRoot(env)).paths, env }
    const user = await installClaude({ ctx, packageRoot: plugin, scope: 'user', marketplaceDir: mkt, platformUrl: 'http://127.0.0.1:9' })
    expect(user).toMatchObject({ id: 'dethereal@dethereal-rc', plugin: 'installed', marketplace: { added: true } })
    const listed = JSON.parse(claude(['plugin', 'list', '--json']).stdout) as Array<{ id: string; scope: string; enabled: boolean }>
    expect(listed).toEqual([expect.objectContaining({ id: 'dethereal@dethereal-rc', scope: 'user', enabled: true })])
    expect(claude(['mcp', 'list']).stdout).toMatch(/^plugin:dethereal:dethereal: .*Connected$/m)
    expect((await settings(path.join(home, '.claude', 'settings.json'))).pluginConfigs['dethereal@dethereal-rc'].options.platform_url).toBe('http://127.0.0.1:9')

    const proj = await installClaude({ ctx, packageRoot: plugin, scope: 'project', project, marketplaceDir: mkt })
    expect(proj).toMatchObject({ plugin: 'installed', marketplace: { added: false } })
    expect(await settings(path.join(project, '.claude', 'settings.json'))).toEqual({ enabledPlugins: { 'dethereal@dethereal-rc': true } })

    expect(await uninstallClaude({ ctx, scope: 'project', project })).toMatchObject({ plugin: 'uninstalled', marketplace: 'kept' })
    expect(await uninstallClaude({ ctx, scope: 'user' })).toMatchObject({ plugin: 'uninstalled', marketplace: 'removed' })
    expect(JSON.parse(claude(['plugin', 'list', '--json']).stdout)).toEqual([])
    expect(JSON.parse(claude(['plugin', 'marketplace', 'list', '--json']).stdout)).toEqual([])
    const s = await settings(path.join(home, '.claude', 'settings.json'))
    expect(s.enabledPlugins ?? {}).toEqual({})
    expect(s.pluginConfigs ?? {}).toEqual({})
    expect(s.extraKnownMarketplaces ?? {}).toEqual({})
    expect((await settings(path.join(project, '.claude', 'settings.json'))).enabledPlugins ?? {}).toEqual({})
  }, 300_000)

  // A pinned npm entry installs exactly that version; one that is not this package's is refused and rolled back.
  it('refuses a marketplace that serves another version, and leaves nothing behind', async () => {
    const pinned = path.join(root, 'mkt-npm')
    await fs.mkdir(path.join(pinned, '.claude-plugin'), { recursive: true })
    const other = JSON.parse(await fs.readFile(path.join(plugin, 'package.json'), 'utf8')).version === '0.4.8' ? '0.4.7' : '0.4.8'
    await fs.writeFile(path.join(pinned, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      name: 'dethereal-pin', owner: { name: 'test' }, plugins: [{ name: 'dethereal', source: { source: 'npm', package: '@dether.net/dethereal', version: other } }],
    }))
    const ctx = { paths: (await ensureStateRoot(env)).paths, env }
    await expect(installClaude({ ctx, packageRoot: plugin, scope: 'user', marketplaceDir: pinned })).rejects.toMatchObject({ code: 'harness_cli_refused' })
    expect(JSON.parse(claude(['plugin', 'list', '--json']).stdout)).toEqual([])
    expect(JSON.parse(claude(['plugin', 'marketplace', 'list', '--json']).stdout)).toEqual([])
  }, 300_000)
})
