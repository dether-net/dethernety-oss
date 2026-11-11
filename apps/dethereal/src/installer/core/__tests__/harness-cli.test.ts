/**
 * The harness CLI runner, driven with fake `claude` binaries. The fakes live in a
 * folder inside the package (the runner never takes a binary from a temp directory)
 * and record what they were given.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { errorLine, harnessEnv, inputArg, resolveHarnessCli, runHarnessCli, runHarnessJson } from '../harness-cli.js'
import type { InstallerEnv } from '../paths.js'

let root: string
let bin: string
let shadow: string
let log: string
let env: InstallerEnv
const savedPath = process.env.PATH

/** A fake CLI: logs argv, cwd and env as JSON lines, then runs `body` (node). */
async function fake(dir: string, body: string): Promise<void> {
  const src = `const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(path.join(root, 'log.jsonl'))}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env, dir: ${JSON.stringify(dir)} }) + '\\n')
${body}
`
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'claude.cjs'), src)
  await fs.writeFile(path.join(dir, 'claude'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(dir, 'claude.cjs'))} "$@"\n`, { mode: 0o755 })
}

/** A temp folder of this test's own as TMPDIR (restored after each test), so another file's temp folders never count. */
const savedTmp = process.env.TMPDIR
async function privateTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, 'tmp-'))
  process.env.TMPDIR = dir
  return dir
}

const calls = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(process.cwd(), '.test-harness-')))
  bin = path.join(root, 'bin')
  shadow = path.join(root, 'node_modules', '.bin')
  log = path.join(root, 'log.jsonl')
})

afterAll(async () => {
  process.env.PATH = savedPath
  if (savedTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = savedTmp
  await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  if (savedTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = savedTmp
  await fs.rm(log, { force: true })
  env = { home: path.join(root, 'home'), vars: {}, euid: process.geteuid!(), platform: process.platform }
})

describe('resolving the binary', () => {
  it('never takes one from a node_modules/.bin folder, a relative entry or a temp directory', async () => {
    await fake(shadow, "process.stdout.write('shadow')")
    await fake(path.join(os.tmpdir(), `harness-tmp-${process.pid}`), "process.stdout.write('tmp')")
    await fake(bin, "process.stdout.write('real')")
    process.env.PATH = [shadow, 'relative/bin', path.join(os.tmpdir(), `harness-tmp-${process.pid}`), bin, savedPath].join(path.delimiter)
    try {
      expect(resolveHarnessCli('claude')).toBe(path.join(bin, 'claude'))
      expect((await runHarnessCli('claude', [], { env })).stdout).toBe('real')
      // Nor does the CLI get those entries on its own PATH, for the npm or git it starts.
      const childPath = harnessEnv(env).PATH!.split(path.delimiter)
      expect(childPath[0]).toBe(bin)
      for (const dropped of [shadow, 'relative/bin', path.join(os.tmpdir(), `harness-tmp-${process.pid}`)]) expect(childPath).not.toContain(dropped)
    } finally {
      await fs.rm(path.join(os.tmpdir(), `harness-tmp-${process.pid}`), { recursive: true, force: true })
    }
  })

  // How a global npm install lays out its bin: a link into a node_modules tree.
  it('takes a bin that links into a global node_modules tree', async () => {
    const lib = path.join(root, 'lib', 'node_modules', 'pkg')
    await fake(lib, "process.stdout.write('global')")
    const globalBin = path.join(root, 'global-bin')
    await fs.mkdir(globalBin, { recursive: true })
    await fs.rm(path.join(globalBin, 'claude'), { force: true })
    await fs.symlink(path.join(lib, 'claude'), path.join(globalBin, 'claude'))
    process.env.PATH = [globalBin, savedPath].join(path.delimiter)
    expect(resolveHarnessCli('claude')).toBe(path.join(globalBin, 'claude'))
  })

  it('never takes one from inside the project it acts on', async () => {
    const project = path.join(root, 'project')
    await fake(path.join(project, 'bin'), "process.stdout.write('planted')")
    await fake(bin, "process.stdout.write('real')")
    process.env.PATH = [path.join(project, 'bin'), bin].join(path.delimiter)
    expect(resolveHarnessCli('claude', project)).toBe(path.join(bin, 'claude'))
    // Without a project, the same PATH resolves the first.
    expect(resolveHarnessCli('claude')).toBe(path.join(project, 'bin', 'claude'))
    // A link from outside the project to a binary inside it is judged by where it leads.
    const outside = path.join(root, 'outside-bin')
    await fs.mkdir(outside, { recursive: true })
    await fs.rm(path.join(outside, 'claude'), { force: true })
    await fs.symlink(path.join(project, 'bin', 'claude'), path.join(outside, 'claude'))
    process.env.PATH = [outside, bin].join(path.delimiter)
    expect(resolveHarnessCli('claude', project)).toBe(path.join(bin, 'claude'))
  })

  it('reports a missing CLI as missing', async () => {
    process.env.PATH = path.join(root, 'nowhere')
    expect(resolveHarnessCli('claude')).toBeNull()
    expect((await runHarnessCli('claude', [], { env })).failure).toBe('spawn')
    await expect(runHarnessJson('claude', [], z.object({}), 'x', { env })).rejects.toMatchObject({ code: 'harness_cli_missing' })
  })
})

describe('running it', () => {
  beforeEach(async () => {
    await fake(bin, "process.stdout.write(JSON.stringify({ outcome: 'ok' }))")
    process.env.PATH = [bin, savedPath].join(path.delimiter)
  })

  it('passes arguments as a list, never through a shell, from the neutral root by default', async () => {
    const marker = path.join(root, 'shell-ran')
    await runHarnessCli('claude', ['plugin', `$(touch ${marker})`, '; touch x', '`id`'], { env })
    const [c] = await calls()
    expect(c.argv).toEqual(['plugin', `$(touch ${marker})`, '; touch x', '`id`'])
    expect(c.cwd).toBe(path.parse(process.cwd()).root)
    await expect(fs.access(marker)).rejects.toThrow()
  })

  it('builds the environment from a fixed list, with HOME from the installer', async () => {
    env = { ...env, vars: { CLAUDE_CONFIG_DIR: '/cfg', HTTPS_PROXY: 'http://proxy:1', ANTHROPIC_API_KEY: 'sk-x', GITHUB_TOKEN: 't', NPM_TOKEN: 'n', SSH_AUTH_SOCK: '/s' } }
    await runHarnessCli('claude', [], { env })
    const [c] = await calls()
    // The fake is a /bin/sh wrapper; the shell adds its own PWD, SHLVL and `_`.
    const keys = Object.keys(c.env).filter((k) => !['__CF_USER_TEXT_ENCODING', 'PWD', 'OLDPWD', 'SHLVL', '_'].includes(k)).sort()
    expect(keys).toEqual(['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'HOME', 'HTTPS_PROXY', 'PATH'])
    expect(c.env.HOME).toBe(env.home)
    expect(harnessEnv(env).PATH!.split(path.delimiter)).not.toContain('relative/bin')
    // A path-valued variable passes only as an absolute path.
    expect(harnessEnv({ ...env, vars: { CLAUDE_CONFIG_DIR: 'relative/cfg', TMPDIR: '/abs/tmp' } })).toMatchObject({ TMPDIR: '/abs/tmp' })
    expect(harnessEnv({ ...env, vars: { CLAUDE_CONFIG_DIR: 'relative/cfg' } })).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('kills a CLI that does not finish, with what it started, and one that floods its output', async () => {
    const marker = path.join(root, 'grandchild-ran')
    await fs.rm(marker, { force: true })
    // The CLI starts a helper (as Claude starts npm or git) that would outlive a kill of the CLI alone.
    await fake(bin, `require('node:child_process').spawn('/bin/sh', ['-c', 'sleep 1; touch ${marker}'], { stdio: 'ignore' }); setTimeout(() => {}, 60000)`)
    expect((await runHarnessCli('claude', [], { env, timeoutMs: 300 })).failure).toBe('timeout')
    await new Promise((r) => setTimeout(r, 1500))
    await expect(fs.access(marker)).rejects.toThrow()
    await fake(bin, "process.stdout.write('x'.repeat(4096))")
    expect((await runHarnessCli('claude', [], { env, maxBytes: 1024 })).failure).toBe('overflow')
  })

  it('can take stdout through a private file, capped, and leave nothing behind', async () => {
    await fake(bin, "process.stdout.write('x'.repeat(200000))")
    const tmp = await privateTmp()
    expect((await runHarnessCli('claude', [], { env, stdoutFile: true })).stdout).toHaveLength(200000)
    expect((await runHarnessCli('claude', [], { env, stdoutFile: true, maxBytes: 1000 })).failure).toBe('overflow')
    expect(await fs.readdir(tmp)).toEqual([])
  })

  it('returns stderr only when asked, through a private capped file, and leaves nothing behind', async () => {
    await fake(bin, "process.stdout.write('out'); process.stderr.write('ERROR failed to load plugin x\\n')")
    const tmp = await privateTmp()
    expect(await runHarnessCli('claude', [], { env })).toEqual({ code: 0, stdout: 'out' })
    expect(await runHarnessCli('claude', [], { env, stderrFile: true })).toEqual({ code: 0, stdout: 'out', stderr: 'ERROR failed to load plugin x\n' })
    expect(await runHarnessCli('claude', [], { env, stdoutFile: true, stderrFile: true })).toEqual({ code: 0, stdout: 'out', stderr: 'ERROR failed to load plugin x\n' })
    await fake(bin, "process.stderr.write('x'.repeat(4096))")
    expect((await runHarnessCli('claude', [], { env, stderrFile: true, maxBytes: 1000 })).failure).toBe('overflow')
    expect(await fs.readdir(tmp)).toEqual([])
  })

  it('stops a CLI whose file grows past the cap while it runs, and leaves nothing running after it exits', async () => {
    // Writes past the cap, then stays: only a check during the run sees it.
    await fake(bin, "process.stdout.write('x'.repeat(4096)); setTimeout(() => {}, 60000)")
    const t0 = Date.now()
    expect((await runHarnessCli('claude', [], { env, stdoutFile: true, maxBytes: 1000, timeoutMs: 20000 })).failure).toBe('overflow')
    expect(Date.now() - t0).toBeLessThan(15000)
    // A helper it leaves behind, holding the file, is killed when it exits.
    const marker = path.join(root, 'leftover-ran')
    await fs.rm(marker, { force: true })
    await fake(bin, `require('node:child_process').spawn('/bin/sh', ['-c', 'sleep 1; touch ${marker}'], { stdio: ['ignore', 'inherit', 'ignore'] }).unref(); process.stdout.write('done')`)
    expect((await runHarnessCli('claude', [], { env, stdoutFile: true })).stdout).toBe('done')
    await new Promise((r) => setTimeout(r, 1500))
    await expect(fs.access(marker)).rejects.toThrow()
  })

  it('accepts JSON only whole, from a CLI that succeeded, in the expected shape', async () => {
    const shape = z.object({ outcome: z.literal('ok') })
    await expect(runHarnessJson('claude', [], shape, 'cmd', { env })).resolves.toEqual({ outcome: 'ok' })
    for (const body of [
      "process.stdout.write('{\"outcome\":\"ok\"} trailing')",
      "process.stdout.write(JSON.stringify({ outcome: 'error' }))",
      "process.stdout.write(JSON.stringify({ outcome: 'ok' })); process.exit(1)",
      "process.stdout.write('')",
    ]) {
      await fake(bin, body)
      await expect(runHarnessJson('claude', [], shape, 'cmd', { env })).rejects.toMatchObject({ code: 'harness_cli_failed', label: 'cmd' })
    }
  })

  it('says why a CLI failed: the first line it wrote to stderr, made safe to show', async () => {
    const shape = z.object({ outcome: z.literal('ok') })
    await fake(bin, "process.stderr.write(\"\\nerror: unknown option '--json'\\n(Did you mean --jsonl?)\\n\"); process.exit(1)")
    await expect(runHarnessJson('claude', ['plugin', 'marketplace', 'add', '--json'], shape, 'plugin marketplace add', { env }))
      .rejects.toThrow("plugin marketplace add: harness cli failed: error: unknown option '--json'")
    // Where the line names the home folder or a secret, neither is shown.
    await fake(bin, `process.stderr.write('Error: cannot read ${env.home}/.claude/settings.json (token=abc123)\\n'); process.exit(2)`)
    const e = await runHarnessJson('claude', [], shape, 'plugin list', { env }).catch((x: Error) => x)
    expect(String(e)).toContain('plugin list: harness cli failed: Error: cannot read <path> (token=<redacted>)')
    expect(String(e)).not.toContain(env.home)
    // A run that succeeded carries no error line, whatever it wrote to stderr; one that wrote nothing fails with its label alone.
    await fake(bin, "process.stderr.write('warning: x\\n'); process.stdout.write('{}')")
    expect(await runHarnessCli('claude', [], { env })).not.toHaveProperty('errorLine')
    await fake(bin, 'process.exit(1)')
    await expect(runHarnessJson('claude', [], shape, 'cmd', { env })).rejects.toThrow(/^cmd: harness cli failed$/)
  })
})

describe('the error line', () => {
  const home = '/home/dev'
  it.each([
    ['first non-empty line, trimmed, colours removed', '\n\n  \x1b[31merror:\x1b[0m unknown option --json  \nsecond line', 'error: unknown option --json'],
    ['the home folder and every path', `Error: ENOENT ${home}/proj/.claude/settings.json and /etc/x and ./rel/y`, 'Error: ENOENT <path> and <path> and <path>'],
    ['a URL, whose credentials, path or query may hold a secret', 'fetch https://user:hunter2@registry.example.com/x?t=1 failed', 'fetch <url> failed'],
    ['secret-looking settings', 'bad config: api_key=AbC123 password: "p w" SESSION_TOKEN=xyz', 'bad config: api_key=<redacted> password: <redacted> SESSION_TOKEN=<redacted>'],
    ['bearer and known token prefixes', 'got Bearer abc.def.ghi and sk-ant-api03-abcdefgh and ghp_abcdefghij', 'got Bearer <redacted> and <redacted> and <redacted>'],
    ['long hex or base64 runs', 'digest 0123456789abcdef0123456789abcdef01 mismatch', 'digest <redacted> mismatch'],
    ['ordinary words stay', 'skipping the plugin: marketplace not found', 'skipping the plugin: marketplace not found'],
    ['non-ASCII as ?', 'ошибка: x', '??????: x'],
  ])('%s', (_name, input, expected) => {
    expect(errorLine(input, home)).toBe(expected)
  })

  it('caps the line, and gives nothing for empty output', () => {
    const l = errorLine('x'.repeat(31) + ' ' + 'word '.repeat(80), home)!
    expect(l.length).toBe(200)
    expect(l.endsWith('...')).toBe(true)
    expect(errorLine('\n \n', home)).toBeUndefined()
  })
})

describe('input arguments', () => {
  it('refuses a value that could read as an option or carries control characters', () => {
    expect(inputArg('dether.net', 'name')).toBe('dether.net')
    for (const bad of ['', '-x', '--config=a', 'a\nb', 'a\u0000b', 'x'.repeat(4097)]) {
      expect(() => inputArg(bad, 'name')).toThrow(expect.objectContaining({ code: 'argument_refused' }))
    }
  })
})
