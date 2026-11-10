import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentWritable, nodeOptions, runtimeProblemOf, type RuntimeContext } from '../runtime-trust.js'

let project: string
let outside: string
let temp: string

beforeAll(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-rt-project-')))
  // Neither the project nor a temporary directory: a directory beside this package's sources.
  outside = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.test-rt-outside-')))
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-rt-temp-')))
})
afterAll(() => {
  for (const d of [project, outside, temp]) fs.rmSync(d, { recursive: true, force: true })
})

// The project root of these tests lies under the temporary directory, as a sandbox's would: judge it
// as the project, and `outside` as a place no agent writes.
const ctx = (over: Partial<RuntimeContext> = {}): RuntimeContext => ({
  env: {}, execArgv: [], execPath: '/usr/local/bin/node', cwd: outside, projectRoot: project, ...over,
})
const kindOf = (over: Partial<RuntimeContext>) => runtimeProblemOf(ctx(over))?.kind

describe('what counts as agent-writable', () => {
  it('is the project and the temporary directories, by real path, through links either way', () => {
    const c = ctx()
    expect(agentWritable(path.join(project, 'ca.pem'), c)).toBe(true)
    expect(agentWritable(path.join(os.tmpdir(), 'x', 'ca.pem'), c)).toBe(true)
    expect(agentWritable('/tmp/ca.pem', c)).toBe(true)
    expect(agentWritable(path.join(outside, 'ca.pem'), c)).toBe(false)
    // A link outside that leads into a temporary directory, and one inside that leads out.
    fs.symlinkSync(temp, path.join(outside, 'to-temp'))
    fs.symlinkSync(outside, path.join(temp, 'to-outside'))
    expect(agentWritable(path.join(outside, 'to-temp', 'ca.pem'), c)).toBe(true)
    expect(agentWritable(path.join(temp, 'to-outside', 'ca.pem'), c)).toBe(false)
    // A relative path is read against the working directory.
    expect(agentWritable('ca.pem', { ...c, cwd: project })).toBe(true)
    expect(agentWritable('ca.pem', c)).toBe(false)
  })

  it("counts macOS's per-user temporary directory even when TMPDIR is not set, by either spelling", () => {
    const saved = process.env.TMPDIR
    delete process.env.TMPDIR
    try {
      // With no TMPDIR, os.tmpdir() is /tmp: the per-user folder is not among the roots.
      for (const p of ['/var/folders/ab/cd123/T/x/preload.mjs', '/private/var/folders/ab/cd123/T/preload.mjs', '/var/folders/ab/cd123/T']) {
        expect([p, agentWritable(p, ctx())]).toEqual([p, true])
      }
      // The user's cache and the folder above are other places.
      expect(agentWritable('/var/folders/ab/cd123/C/x.mjs', ctx())).toBe(false)
      expect(agentWritable('/var/folders/ab/x.mjs', ctx())).toBe(false)
      expect(kindOf({ execArgv: ['--import', '/var/folders/ab/cd123/T/preload.mjs'] })).toBe('tripwire')
    } finally {
      if (saved === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = saved
    }
  })
})

describe('Node options', () => {
  it('reads every spelling: =value, a following value, a short option, _ for -', () => {
    expect(nodeOptions(['--require=a', '--require', 'b', '-r', 'c', '--experimental_loader', 'd', '--inspect', '--tls_keylog=e'])).toEqual([
      { name: '--require', value: 'a' }, { name: '--require', value: 'b' }, { name: '-r', value: 'c' },
      { name: '--experimental-loader', value: 'd' }, { name: '--inspect' }, { name: '--tls-keylog', value: 'e' },
    ])
  })
})

describe('a runtime that cannot be trusted with the session', () => {
  it('passes a clean runtime, and this test process with its own preloads from node_modules', () => {
    expect(runtimeProblemOf(ctx())).toBeUndefined()
    expect(runtimeProblemOf(ctx({ execArgv: process.execArgv, execPath: process.execPath, cwd: process.cwd() }))).toBeUndefined()
  })

  it('refuses TLS checks turned off (only by "0", as Node reads it) and a key log wherever it is written', () => {
    expect(kindOf({ env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } })).toBe('tls')
    expect(kindOf({ env: { NODE_TLS_REJECT_UNAUTHORIZED: '' } })).toBeUndefined()
    expect(kindOf({ env: { NODE_TLS_REJECT_UNAUTHORIZED: 'false' } })).toBeUndefined()
    const keylog = runtimeProblemOf(ctx({ env: { SSLKEYLOGFILE: path.join(outside, 'keys') } }))
    expect(keylog?.kind).toBe('tls')
    expect(keylog?.message).toMatch(/dev-plugin-root/)
    for (const argv of [['--tls-keylog=/var/log/k'], ['--tls_keylog', '/var/log/k']]) expect(kindOf({ execArgv: argv }), argv.join(' ')).toBe('tls')
    expect(kindOf({ env: { NODE_OPTIONS: '--tls-keylog="/var/log/my keys"' } })).toBe('tls')
  })

  it('refuses trust anchors and OpenSSL configuration an agent could have written, and names the variable and the fix', () => {
    for (const name of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF', 'OPENSSL_MODULES', 'OPENSSL_ENGINES']) {
      const inProject = runtimeProblemOf(ctx({ env: { [name]: path.join(project, 'ca.pem') } }))
      expect(inProject?.kind, name).toBe('tls')
      expect(inProject?.message, name).toMatch(new RegExp(`${name}.*move it`))
      expect(kindOf({ env: { [name]: path.join(temp, 'ca.pem') } }), name).toBe('tls')
      expect(kindOf({ env: { [name]: path.join(outside, 'ca.pem') } }), name).toBeUndefined()
    }
    expect(kindOf({ env: { NODE_EXTRA_CA_CERTS: 'certs/ca.pem' }, cwd: project })).toBe('tls')
    expect(kindOf({ execArgv: ['--openssl-config', path.join(project, 'o.cnf')] })).toBe('tls')
  })

  it('refuses an inspector outright, with a way to debug instead', () => {
    for (const argv of [['--inspect'], ['--inspect-brk'], ['--inspect_wait'], ['--inspect-port=9230'], ['--inspect=0.0.0.0:9229']]) {
      const p = runtimeProblemOf(ctx({ execArgv: argv }))
      expect(p?.kind, argv[0]).toBe('tripwire')
      expect(p?.message).toMatch(/dev-plugin-root/)
    }
    expect(kindOf({ env: { NODE_OPTIONS: '--max-old-space-size=100 --inspect' } })).toBe('tripwire')
  })

  it('refuses code loaded before the server from an agent-writable place or a URL, and asks for the session to be revoked', () => {
    const cases: Array<[Partial<RuntimeContext>, string]> = [
      [{ execArgv: ['--require', path.join(project, 'x.cjs')] }, 'require from the project'],
      [{ execArgv: ['-r', path.join(temp, 'x.cjs')] }, 'short -r from a temp dir'],
      [{ env: { NODE_OPTIONS: `--import="${pathToFileURL(path.join(project, 'x y.mjs')).href}"` } }, 'a file: URL, quoted, with a space'],
      [{ execArgv: ['--import', 'data:text/javascript,console.log(1)'] }, 'a data: URL'],
      [{ execArgv: ['--experimental-loader=https://example.com/l.mjs'] }, 'an https: URL'],
      [{ execArgv: ['--import', 'tsx'], cwd: project }, 'a bare name, read against the project'],
      [{ execArgv: ['--env-file', '.env'], cwd: project }, 'an env file in the project'],
      [{ execArgv: ['--heapsnapshot-signal=SIGUSR2'], cwd: project }, 'heap snapshots into the project'],
      [{ env: { NODE_COMPILE_CACHE: path.join(temp, 'cache') } }, 'a compile cache in a temp dir'],
      [{ env: { LD_PRELOAD: `/usr/lib/libfoo.so:${path.join(project, 'evil.so')}` } }, 'a preloaded library from the project'],
      [{ execPath: path.join(temp, 'node') }, 'Node itself from a temp dir'],
    ]
    for (const [over, what] of cases) {
      const p = runtimeProblemOf(ctx(over))
      expect(p?.kind, what).toBe('tripwire')
    }
    expect(runtimeProblemOf(ctx({ execArgv: ['--require', path.join(project, 'x.cjs')] }))?.message).toMatch(/revoke the session/)
    // A dependency's own file, and anything outside the agent's reach, is not judged.
    expect(kindOf({ execArgv: ['--import', pathToFileURL(path.join(project, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href] })).toBeUndefined()
    expect(kindOf({ execArgv: ['--require', path.join(outside, 'x.cjs')] })).toBeUndefined()
    expect(kindOf({ execArgv: ['--heapsnapshot-signal=SIGUSR2', `--diagnostic-dir=${outside}`], cwd: project })).toBeUndefined()
  })
})
