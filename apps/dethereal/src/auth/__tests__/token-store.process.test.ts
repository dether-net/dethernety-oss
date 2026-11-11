/**
 * The token store shared by separate processes, as one server per harness session
 * shares it. Each worker is a real Node process running the real store, lock,
 * refresh and revocation code with HOME set to a sandbox; only the network is
 * scripted (see fixtures/scripted-fetch.ts).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..', '..', '..')
const PLATFORM = 'http://127.0.0.1:43219'

let worker: string
let outDir: string
let root: string
let home: string
let fakeNet: string

function start(args: string[]): { child: ChildProcess; done: Promise<{ code: number | null; out: string }> } {
  const child = spawn(process.execPath, [worker, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: home, DETHERNETY_URL: PLATFORM, DETHEREAL_FAKE_NET: fakeNet },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()))
  child.stderr!.resume()
  const done = new Promise<{ code: number | null; out: string }>((resolve) =>
    child.on('close', (code) => resolve({ code, out: out.trim() }))
  )
  return { child, done }
}

const run = async (...args: string[]) => (await start(args).done).out
const storeDir = () => path.join(home, '.dethernety')
const storeFile = async () => JSON.parse(await readFile(path.join(storeDir(), 'tokens.json'), 'utf8'))
const calls = async () =>
  existsSync(path.join(fakeNet, 'calls.jsonl'))
    ? (await readFile(path.join(fakeNet, 'calls.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { pid: number; host: string; path: string; token?: string })
    : []
const until = async (predicate: () => boolean | Promise<boolean>, ms = 10_000) => {
  const t0 = Date.now()
  while (!(await predicate())) {
    if (Date.now() - t0 > ms) throw new Error('condition not reached')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('token store across processes', () => {
  beforeAll(async () => {
    const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
    await mkdir(cacheDir, { recursive: true })
    outDir = await mkdtemp(path.join(cacheDir, 'dethereal-token-worker-'))
    await build({
      config: false,
      entry: { worker: path.join(here, 'fixtures', 'token-store-worker.ts') },
      format: ['esm'],
      target: 'node20',
      outDir,
      bundle: true,
      // Bundled, so that the alias below replaces it (an external module is never aliased).
      noExternal: ['cross-fetch'],
      dts: false,
      sourcemap: false,
      clean: false,
      silent: true,
      esbuildOptions(options) {
        options.alias = { 'cross-fetch': path.join(here, 'fixtures', 'scripted-fetch.ts') }
      },
    })
    worker = path.join(outDir, 'worker.js')
    expect(existsSync(worker)).toBe(true)
  }, 60_000)

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
    if (root) await rm(root, { recursive: true, force: true })
  })

  beforeEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'dethereal-token-procs-')))
    home = path.join(root, 'home')
    fakeNet = path.join(root, 'net')
    await mkdir(home, { recursive: true })
    await mkdir(fakeNet, { recursive: true })
    await writeFile(
      path.join(fakeNet, 'config.json'),
      JSON.stringify({ oidcClientId: 'client-p', oidcDomain: 'auth.p.test', oidcIssuer: 'https://auth.p.test', graphqlUrl: '/graphql' })
    )
  })

  it('loses no session when many processes save at once', async () => {
    const results = (await Promise.all(Array.from({ length: 8 }, (_, i) => run('save', '10', `w${i}`)))).map(
      (out) => JSON.parse(out) as { saved: string[]; busy: string[]; errors: number }
    )
    // Every save ends as saved or as a coded busy (a lock wait that ran out on a loaded host)...
    for (const r of results) {
      expect(r.errors).toBe(0)
      expect(r.saved.length + r.busy.length).toBe(10)
    }
    // ...and every save that succeeded is in the store: no write is lost.
    const file = await storeFile()
    const saved = results.flatMap((r) => r.saved)
    expect(Object.keys(file.tokens).sort()).toEqual([...saved].sort())
    expect(saved.length).toBeGreaterThan(0)
    expect((await stat(path.join(storeDir(), 'tokens.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(storeDir())).mode & 0o777).toBe(0o700)
    expect(await readdir(storeDir())).toEqual(['tokens.json'])
  }, 60_000)

  it('stays signed out when a logout in another process lands during a refresh', async () => {
    expect(await run('seed-expired', 'refresh-token-before-logout-01')).toBe('ok')
    await writeFile(
      path.join(fakeNet, 'token.json'),
      JSON.stringify({
        access_token: 'access-token-minted-meanwhile',
        id_token: 'id-token-minted-meanwhile',
        refresh_token: 'refresh-token-rotated-meanwhile',
        expires_in: 3600,
        token_type: 'Bearer',
      })
    )
    const refresher = start(['refresh'])
    // The refresh request is in flight: its process holds no lock.
    await until(() => existsSync(path.join(fakeNet, `token-requested-${refresher.child.pid}`)))
    const revoked = JSON.parse(await run('logout'))
    expect(revoked).toEqual([{ platform: PLATFORM, result: 'revoked' }])
    await writeFile(path.join(fakeNet, 'release'), '')

    expect((await refresher.done).out).toBe('signed-out')
    expect((await storeFile()).tokens).toEqual({})
    const revocations = (await calls()).filter((c) => c.path === '/oauth2/revoke')
    expect(revocations.map((c) => c.token).sort()).toEqual(
      ['refresh-token-before-logout-01', 'refresh-token-rotated-meanwhile'].sort()
    )
    expect(revocations.every((c) => c.host === 'auth.p.test')).toBe(true)
  }, 60_000)

  it('takes over the lock of a process killed while holding it', async () => {
    const holder = start(['hold'])
    await until(() => existsSync(path.join(storeDir(), 'tokens.lock')))
    holder.child.kill('SIGKILL')
    await holder.done
    const t0 = Date.now()
    expect(JSON.parse(await run('save', '1', 'after-crash')).saved).toHaveLength(1)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(Object.keys((await storeFile()).tokens)).toEqual(['https://after-crash-0.example.test'])
  }, 60_000)

  it('leaves no tmp file of a writer killed mid-write behind a logout', async () => {
    expect(JSON.parse(await run('save', '1', 'before')).saved).toHaveLength(1)
    await start(['tmp-then-die']).done
    expect((await readdir(storeDir())).some((f) => f.endsWith('.tmp'))).toBe(true)
    await run('logout')
    expect((await readdir(storeDir())).filter((f) => f.endsWith('.tmp'))).toEqual([])
  }, 60_000)

  it('refuses to save a sign-in that a logout in another process overtook', async () => {
    const epoch = await run('signin-begin')
    expect(epoch).toMatch(/^[0-9a-f]{16}$/)
    await run('logout')
    expect(await run('signin-commit', epoch)).toBe('superseded')
    expect((await storeFile()).tokens).toEqual({})

    const fresh = await run('signin-begin')
    expect(await run('signin-commit', fresh)).toBe('saved')
  }, 60_000)
})
