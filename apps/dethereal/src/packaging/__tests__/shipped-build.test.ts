/**
 * The shipped build, built here with the shipped options: it runs with nothing
 * but Node and its own files (copied to a plugin-cache-like path with a space,
 * no node_modules anywhere above), the installer accepts it as a self-contained
 * runtime, its notices cover every bundled package, and the Node floor is the
 * same everywhere it is stated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { shippedBuild } from '../shipped-build.js'
import { LICENSE_ALLOWLIST } from '../metafile-checks.js'
import { manifestToolNames } from '../../tools/manifest.js'
import { shippedToolNames } from '../../utils/settlement-switch.js'
import { ensureStateRoot, type InstallerEnv } from '../../installer/core/paths.js'
import { installRuntime, NODE_FLOOR } from '../../installer/core/runtime.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PACKAGE_VERSION = (JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string }).version

describe('the shipped build', () => {
  let outDir: string
  let tmp: string

  beforeAll(async () => {
    const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    outDir = fs.mkdtempSync(path.join(cacheDir, 'dethereal-shipped-'))
    await build({ ...shippedBuild, config: false, entry: { index: path.join(pkgRoot, 'src', 'index.ts') }, outDir, clean: false, silent: true })
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-shipped-')))
  }, 120_000)

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true })
    if (tmp) {
      const unlock = (dir: string) => {
        fs.chmodSync(dir, 0o700)
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) unlock(path.join(dir, e.name))
      }
      unlock(tmp)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('ships code, notices and an inventory, and no source maps', () => {
    const files = fs.readdirSync(outDir)
    expect(files).toContain('index.js')
    expect(files).toContain('THIRD_PARTY_NOTICES')
    expect(files).toContain('bundle-inputs.json')
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([])
    const inventory = JSON.parse(fs.readFileSync(path.join(outDir, 'bundle-inputs.json'), 'utf8')) as Array<{ name: string; version: string; license: string }>
    const notices = fs.readFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES'), 'utf8')
    expect(inventory.length).toBeGreaterThan(5)
    for (const p of inventory) {
      expect(p.license.replace(/[()]/g, '').split(/\s+OR\s+/).some((l) => LICENSE_ALLOWLIST.has(l)), `${p.name} ${p.license}`).toBe(true)
      expect(notices).toContain(`${p.name}@${p.version} (${p.license})`)
    }
    for (const name of ['open', 'cross-fetch', 'node-fetch', 'whatwg-url']) expect(inventory.map((p) => p.name)).not.toContain(name)

    // The republish guard watches exactly what the bundle holds, at the versions the lockfile resolves.
    const guard = JSON.parse(execFileSync(process.execPath, [path.join(pkgRoot, 'scripts', 'check-republish.mjs'), '--describe'], { cwd: pkgRoot, encoding: 'utf8' })) as { bundledPackages: string[]; resolved: string[] }
    expect([...guard.bundledPackages].sort()).toEqual([...new Set(inventory.map((p) => p.name))].sort())
    expect([...guard.resolved].sort()).toEqual(inventory.map((p) => `${p.name}@${p.version}`).sort())

    // Every file the manifest points at is built.
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { main?: string; types?: string; bin?: Record<string, string> }
    for (const target of [manifest.main, manifest.types, ...Object.values(manifest.bin ?? {})].filter((t): t is string => !!t)) {
      expect(target.startsWith('dist/'), target).toBe(true)
      expect(files, target).toContain(target.slice('dist/'.length))
    }
  })

  it('runs from a plugin-cache-like copy with no node_modules, and lists every tool', async () => {
    const root = path.join(tmp, 'plugins', 'cache', 'market place', 'dethereal', '1.2.3')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    for (const f of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, f), path.join(root, 'dist', f))
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n')
    const cwd = path.join(tmp, 'elsewhere')
    const home = path.join(tmp, 'home')
    fs.mkdirSync(cwd, { recursive: true })
    fs.mkdirSync(home, { recursive: true })
    // A hostile package.json above the working directory changes nothing.
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"commonjs","imports":{"#x":"./nope.js"}}\n')

    const connect = async (env: Record<string, string>) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, 'dist', 'index.js')],
        cwd,
        env: { HOME: home, PATH: process.env.PATH ?? '', DETHERNETY_URL: 'http://127.0.0.1:9', DETHEREAL_REGISTER_STUBS: '1', ...env },
        stderr: 'pipe',
      })
      const client = new Client({ name: 'shipped-build-test', version: '1.0.0' })
      await client.connect(transport)
      return client
    }
    const client = await connect({ DETHEREAL_SETTLEMENT: 'on' })
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([...manifestToolNames()].sort())
      // The version the build stamped in: the package.json beside this copy names none.
      expect(client.getServerVersion()).toMatchObject({ name: 'dethereal', version: PACKAGE_VERSION })
      const status = await client.callTool({ name: 'workspace_status', arguments: {} })
      expect(status.isError ?? false).toBe(false)
    } finally {
      await client.close()
    }
    // As shipped, the settlement is off: its tool is not listed, not even as a placeholder.
    const off = await connect({})
    try {
      const { tools } = await off.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual(shippedToolNames().sort())
    } finally {
      await off.close()
    }
  }, 60_000)

  it('is accepted by the installer as a self-contained runtime', async () => {
    const home = path.join(tmp, 'install-home')
    fs.mkdirSync(home, { mode: 0o700 })
    const env: InstallerEnv = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
    const source = path.join(tmp, 'package')
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true })
    for (const f of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, f), path.join(source, 'dist', f))
    // With every bundle the package ships: the Codex and OpenCode writers read theirs from the runtime.
    fs.cpSync(path.join(pkgRoot, 'bundles'), path.join(source, 'bundles'), { recursive: true })
    const { paths } = await ensureStateRoot(env)
    const rt = await installRuntime(paths, env, source, '1.2.3')
    expect(fs.existsSync(path.join(rt.runtimePath, 'dist', 'index.js'))).toBe(true)
    for (const harness of ['claude', 'codex', 'opencode']) expect(fs.existsSync(path.join(rt.runtimePath, 'bundles', harness, 'bundle.json')), harness).toBe(true)
  }, 60_000)

  it('stamps the package version in, so the server never reports one of its own', () => {
    const bundle = fs.readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(outDir, f), 'utf8')).join('\n')
    expect(bundle).toContain(JSON.stringify(PACKAGE_VERSION))
    expect(bundle).not.toMatch(/version:"3\.0\.0"/)
  })

  it('states one Node floor: engines, the installer and the entry point', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { engines: { node: string } }
    expect(manifest.engines.node).toBe(`>=${NODE_FLOOR}`)
    const entry = fs.readFileSync(path.join(pkgRoot, 'src', 'index.ts'), 'utf8')
    expect(entry).toContain(`const NODE_FLOOR = [${NODE_FLOOR.split('.').join(', ')}]`)
  })
})
