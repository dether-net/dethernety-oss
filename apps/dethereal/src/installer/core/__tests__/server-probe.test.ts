/**
 * Doctor's server probe: the real shipped server, started from a node the test
 * controls, answers as the server sees itself; a child that hangs is killed with
 * what it started; the environment is cut to its list; an entry that is not a
 * server's entry file is never started.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { shippedBuild } from '../../../packaging/shipped-build.js'
import { shippedToolNames } from '../../../utils/settlement-switch.js'
import type { InstallerEnv } from '../paths.js'
import { nodeVersion, probeServer } from '../server-probe.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

let tmp: string
let server: string
let node: string
let env: InstallerEnv

/** A 0755 file the test owns, standing in for a Node binary: the runner's own may sit in a group-writable cache. */
async function fakeNode(name: string, body: string): Promise<string> {
  const p = path.join(tmp, 'bin', name)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `#!/bin/sh\n${body}\n`)
  await fs.chmod(p, 0o755)
  return p
}

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-probe-')))
  const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
  await fs.mkdir(cacheDir, { recursive: true })
  const out = await fs.mkdtemp(path.join(cacheDir, 'dethereal-probe-'))
  await build({ ...shippedBuild, config: false, entry: { index: path.join(pkgRoot, 'src', 'index.ts') }, outDir: path.join(out, 'dist'), clean: false, silent: true })
  server = path.join(out, 'dist', 'index.js')
  node = await fakeNode('node', `exec ${JSON.stringify(process.execPath)} "$@"`)
  const home = path.join(tmp, 'home')
  await fs.mkdir(home, { mode: 0o700 })
  env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
}, 120_000)

afterAll(async () => {
  await fs.rm(path.dirname(path.dirname(server)), { recursive: true, force: true })
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('the server probe', () => {
  it('starts the shipped server and reads its tools and its view of the platform, read-only', async () => {
    const cwd = path.join(tmp, 'cwd')
    await fs.mkdir(cwd, { recursive: true })
    const r = await probeServer({ node, entry: server, cwd, env: { HOME: env.home, PATH: process.env.PATH ?? '', DETHERNETY_URL: 'http://127.0.0.1:9' } }, env)
    expect(r.started).toBe(true)
    // As shipped, the settlement is off: its tool is not listed.
    expect([...r.tools!].sort()).toEqual(shippedToolNames().sort())
    expect(r.auth).toMatchObject({ platformUrl: 'http://127.0.0.1:9', reachable: false, authenticated: false })
    // verify:false never writes a session store.
    await expect(fs.access(path.join(env.home, '.dethernety', 'tokens.json'))).rejects.toThrow()
  }, 60_000)

  it('kills a server that never answers, with what it started', async () => {
    const marker = path.join(tmp, 'grandchild-ran')
    const hang = await fakeNode('hang', `/bin/sh -c 'sleep 1; touch ${marker}' & sleep 60`)
    const entry = path.join(tmp, 'srv', 'dist', 'index.js')
    const r = await probeServer({ node: hang, entry, cwd: tmp, env: {} }, env, { timeoutMs: 300 })
    expect(r).toMatchObject({ started: false, failure: 'timeout' })
    await new Promise((res) => setTimeout(res, 1500))
    await expect(fs.access(marker)).rejects.toThrow()
  })

  it('cuts the environment to its list: no loader, no debug switch, nothing else', async () => {
    const dump = path.join(tmp, 'env.txt')
    const show = await fakeNode('show-env', `env > ${dump}`)
    await probeServer({ node: show, entry: path.join(tmp, 'srv', 'dist', 'index.js'), cwd: tmp, env: {
      HOME: env.home, PATH: '/usr/bin', DETHERNETY_URL: 'http://x', NODE_OPTIONS: '--require /evil.js', NODE_PATH: '/evil', DEBUG: '1', DYLD_INSERT_LIBRARIES: '/evil.dylib', SECRET: 's',
    } }, env, { timeoutMs: 2000 })
    const keys = (await fs.readFile(dump, 'utf8')).split('\n').filter(Boolean).map((l) => l.split('=')[0]!)
    for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'DEBUG', 'DYLD_INSERT_LIBRARIES', 'SECRET']) expect(keys, k).not.toContain(k)
    for (const k of ['HOME', 'DETHERNETY_URL']) expect(keys, k).toContain(k)
  })

  it('never starts an entry that is not a server entry file, nor an unchecked node', async () => {
    for (const entry of ['relative/dist/index.js', path.join(tmp, 'x.js'), path.join(tmp, 'dist', 'index.js', '..', 'other.js')]) {
      expect(await probeServer({ node, entry, cwd: tmp, env: {} }, env), entry).toMatchObject({ started: false, failure: 'spawn' })
    }
    const writable = await fakeNode('writable-node', 'exit 0')
    await fs.chmod(writable, 0o777)
    expect(await probeServer({ node: writable, entry: server, cwd: tmp, env: {} }, env)).toMatchObject({ started: false, failure: 'spawn' })
  })

  it('asks auth_status read-only, again until the platform answers', async () => {
    // A stand-in server: reachable from the third auth_status on, logging every call's arguments.
    const srv = path.join(tmp, 'fake-srv', 'dist', 'index.js')
    const log = path.join(tmp, 'fake-srv', 'calls.jsonl')
    await fs.mkdir(path.dirname(srv), { recursive: true })
    await fs.writeFile(srv, `
      const fs = require('node:fs'); let n = 0
      require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
        const m = JSON.parse(l); if (m.id === undefined) return
        const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
        if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'f', version: '0' } })
        if (m.method === 'tools/list') return reply({ tools: [{ name: 'auth_status' }] })
        fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(m.params) + '\\n'); n++
        reply({ content: [{ type: 'text', text: JSON.stringify({ platformUrl: 'http://p', urlSource: 'env', authDisabled: n >= 3 ? false : null, authenticated: false }) }] })
      })`)
    await fs.writeFile(path.join(tmp, 'fake-srv', 'package.json'), '{"type":"commonjs"}')
    const r = await probeServer({ node, entry: srv, cwd: tmp, env: {} }, env)
    expect(r.auth).toMatchObject({ reachable: true })
    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(c).toEqual({ name: 'auth_status', arguments: { verify: false } })
  }, 30_000)

  it('reads a node\'s own version, or nothing when it cannot run', async () => {
    expect(await nodeVersion(await fakeNode('v22', 'echo v22.11.0'), env, tmp)).toBe('22.11.0')
    expect(await nodeVersion(await fakeNode('garbage', 'echo hello'), env, tmp)).toBeNull()
    expect(await nodeVersion(path.join(tmp, 'missing'), env, tmp)).toBeNull()
  })
})
