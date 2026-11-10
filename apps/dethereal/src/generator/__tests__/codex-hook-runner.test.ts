/**
 * The Codex hook runner (`bin/hook.mjs`) run as a process against runtimes the installer core
 * installed in a temporary home: it runs a sound runtime and passes on its answers, and when the
 * runtime cannot be used (tampered, missing, its Node gone, its hook failing), the guards judge
 * the call by name.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PACKAGE_GOLDENS } from '../cli.js'
import { ensureStateRoot, type InstallerEnv, type StatePaths } from '../../installer/core/paths.js'
import { activateRuntime, installRuntime, type InstalledRuntime, readCurrentRuntime } from '../../installer/core/runtime.js'

const PLUGIN = path.join(PACKAGE_GOLDENS, 'codex', 'bundles', 'codex', 'plugins', 'dethereal')
const read = (p: string) => readFileSync(path.join(PLUGIN, p), 'utf8')

/** The package's CLI run from its sources, as a runtime's `dist/index.js` would run the built one. */
const TSX = new URL('../../../node_modules/tsx/dist/esm/index.mjs', import.meta.url).href
const SOURCE_ENTRY = fileURLToPath(new URL('../../index.ts', import.meta.url))

/** A runtime whose hook command behaves as `body` says (it reads the event from stdin). */
const RUNTIMES: Record<string, string> = {
  // The real guards behind a sound runtime.
  source: `import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const r = spawnSync(process.execPath, ['--import', ${JSON.stringify(TSX)}, ${JSON.stringify(SOURCE_ENTRY)}, ...process.argv.slice(2)], { input: readFileSync(0), env: process.env })
process.stdout.write(r.stdout ?? '')
process.exitCode = r.status ?? 1
`,
  sound: `import { readFileSync } from 'node:fs'
const [, , cmd, sub] = process.argv
const event = readFileSync(0, 'utf8')
if (cmd === 'hook' && sub === 'secret-guard' && event.includes('.env')) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'runtime guard: secret file' } }))
if (cmd === 'hook' && sub === 'session-start') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'runtime context' } }))
`,
  crash: 'process.exit(3)\n',
  garbage: "process.stdout.write('not json')\n",
  oversize: "process.stdout.write('x'.repeat(200000))\n",
  hang: 'setInterval(() => {}, 1000)\n',
  killed: "process.kill(process.pid, 'SIGKILL')\n",
  env: "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: JSON.stringify({ options: process.env.NODE_OPTIONS ?? null, path: process.env.NODE_PATH ?? null }) } }))\n",
  urls: "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: JSON.stringify({ platform: process.env.DETHERNETY_PLATFORM_URL ?? null, url: process.env.DETHERNETY_URL ?? null }) } }))\n",
}

/** A stand-in `codex`: answers `mcp list --json` as `answer.json` says, and logs every call. */
const FAKE_CODEX = `import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
appendFileSync(path.join(dir, 'calls.log'), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n')
const a = JSON.parse(readFileSync(path.join(dir, 'answer.json'), 'utf8'))
if (a.hang) setInterval(() => {}, 1000)
else {
  process.stdout.write(typeof a.stdout === 'string' ? a.stdout : JSON.stringify(a.stdout))
  process.exitCode = a.code ?? 0
}
`

describe('the Codex hook runner, run as a process', { timeout: 60_000 }, () => {
  let home: string
  let node: string
  let bin: string
  let env: InstallerEnv
  let paths: StatePaths
  const installed = new Map<string, InstalledRuntime>()
  const deadlines = JSON.parse(read('bin/hook-deadlines.json')) as Record<string, number>

  async function use(kind: string) {
    if (!installed.has(kind)) {
      const src = mkdtempSync(path.join(tmpdir(), `codex-runtime-${kind}-`))
      mkdirSync(path.join(src, 'dist'))
      writeFileSync(path.join(src, 'dist', 'index.js'), RUNTIMES[kind]!)
      installed.set(kind, await installRuntime(paths, env, src, `0.0.${installed.size + 1}`))
      rmSync(src, { recursive: true, force: true })
    }
    await activateRuntime(paths, env, installed.get(kind)!, node)
    return installed.get(kind)!
  }
  const run = (sub: string, input: string, extra: readonly string[] = [], more: Record<string, string> = {}) => {
    const t = Date.now()
    const r = spawnSync(node, [path.join(bin, 'hook.mjs'), sub, ...extra, '--harness', 'codex'], {
      input, encoding: 'utf8', timeout: 30_000, env: { HOME: home, PATH: process.env.PATH, PLUGIN_ROOT: home, ...more },
    })
    expect(r.status).toBe(0)
    return { out: r.stdout, ms: Date.now() - t }
  }
  const bash = (command: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
  const patch = (file: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch` } })
  const reason = (out: string) => (out ? (JSON.parse(out) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason : null)
  const context = (out: string) => (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
  const coreAgrees = (ok: boolean) => readCurrentRuntime(paths, env).then(() => true, () => false).then((v) => expect(v).toBe(ok))

  /** A state directory with nothing installed (runtime copies are read-only, so made writable first). */
  async function freshState() {
    spawnSync('chmod', ['-R', 'u+w', path.join(home, '.dethernety')])
    for (const p of [`${paths.runtime}-real`, path.join(home, '.dethernety'), path.join(home, 'link')]) rmSync(p, { recursive: true, force: true })
    installed.clear()
    paths = (await ensureStateRoot(env)).paths
  }

  /** With a runtime it cannot use: names refused, the rest passes, and session start says why. */
  const degraded = async (why: RegExp) => {
    expect(reason(run('secret-guard', bash('cat .env')).out)).toMatch(why)
    expect(run('secret-guard', bash('ls -la')).out).toBe('')
    expect(reason(run('config-guard', patch('.codex/config.toml')).out)).toMatch(why)
    expect(run('config-guard', patch('notes.txt')).out).toBe('')
    expect(context(run('session-start', '{}', ['--source', 'startup']).out)).toMatch(why)
    expect(run('post-write', '{}').out).toBe('')
  }

  // The runner takes codex only from a PATH entry outside the temp folders and the session's folder: the stand-in lives in the package.
  let codexDir: string
  let session: string
  const answer = (a: Record<string, unknown>) => {
    writeFileSync(path.join(codexDir, 'answer.json'), JSON.stringify(a))
    rmSync(path.join(codexDir, 'calls.log'), { force: true })
  }
  const codexCalls = () => { try { return readFileSync(path.join(codexDir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }
  const listing = (transport: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ stdout: [{ name: 'other', enabled: true, transport: { type: 'stdio', env: { DETHERNETY_URL: 'http://other.invalid' } } }, { name: 'dethereal', enabled: true, transport: { type: 'stdio', ...transport }, ...extra }] })
  const urlsSeen = (more: Record<string, string> = {}, pathEntry = codexDir) => {
    const t = Date.now()
    const r = spawnSync(node, [path.join(bin, 'hook.mjs'), 'session-start', '--source', 'startup', '--harness', 'codex'], {
      input: '{}', encoding: 'utf8', timeout: 30_000, cwd: session, env: { HOME: home, TMPDIR: tmpdir(), PATH: `${pathEntry}${path.delimiter}${path.dirname(process.execPath)}:/usr/bin:/bin`, PLUGIN_ROOT: home, ...more },
    })
    expect(r.status).toBe(0)
    return { ...(JSON.parse(context(r.stdout)) as { platform: string | null; url: string | null }), ms: Date.now() - t }
  }

  beforeAll(async () => {
    codexDir = mkdtempSync(path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..'), '.test-codex-runner-'))
    writeFileSync(path.join(codexDir, 'fake-codex.mjs'), FAKE_CODEX)
    writeFileSync(path.join(codexDir, 'codex'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(codexDir, 'fake-codex.mjs'))} "$@"\n`, { mode: 0o755 })
    session = realpathSync(mkdtempSync(path.join(tmpdir(), 'codex-runner-session-')))
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'codex-runner-home-')))
    // The node the runtime is activated with and the runner runs on (its fallback when the recorded one is
    // gone), under the test's control: a CI runner's own binary may sit group- or world-writable in its
    // tool cache, which the runtime checks rightly refuse.
    node = path.join(home, 'node-bin', 'node')
    mkdirSync(path.dirname(node), { mode: 0o700 })
    copyFileSync(process.execPath, node)
    chmodSync(node, 0o755)
    bin = path.join(home, 'plugin-bin')
    mkdirSync(bin)
    for (const f of ['hook.mjs', 'hook-deadlines.json', 'runtime-check.mjs', 'secret-fallback.mjs', 'shell-check.mjs', 'leaf-allowlist.json']) writeFileSync(path.join(bin, f), read(`bin/${f}`))
    env = { home, vars: { HOME: home }, euid: process.geteuid!(), platform: process.platform }
    paths = (await ensureStateRoot(env)).paths
  })
  afterAll(() => {
    spawnSync('chmod', ['-R', 'u+w', home])
    rmSync(home, { recursive: true, force: true })
    rmSync(session, { recursive: true, force: true })
    rmSync(codexDir, { recursive: true, force: true })
  })

  it('ships the installer\'s own runtime check and the shared secret list, byte for byte', () => {
    expect(read('bin/runtime-check.mjs')).toBe(readFileSync(new URL('../../installer/core/runtime-check.mjs', import.meta.url), 'utf8'))
    expect(read('bin/secret-fallback.mjs')).toBe(readFileSync(new URL('../../utils/secret-fallback.mjs', import.meta.url), 'utf8'))
    expect(read('bin/shell-check.mjs')).toBe(readFileSync(new URL('../../utils/shell-check.mjs', import.meta.url), 'utf8'))
  })

  it('stops each hook two seconds before Codex would', () => {
    const hooks = JSON.parse(read('hooks/hooks.json')).hooks as Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>
    const runnerHooks = Object.values(hooks).flat().flatMap((g) => g.hooks).filter((h) => h.command.includes('/bin/hook.mjs'))
    expect(runnerHooks).toHaveLength(7)
    for (const h of runnerHooks) expect(deadlines[/hook\.mjs" (\S+)/.exec(h.command)![1]!], h.command).toBe((h.timeout - 2) * 1000)
  })

  it('runs a sound runtime and passes its answers on', async () => {
    await use('sound')
    await coreAgrees(true)
    expect(reason(run('secret-guard', bash('cat .env')).out)).toBe('runtime guard: secret file')
    expect(run('secret-guard', bash('ls')).out).toBe('')
    expect(context(run('session-start', '{}', ['--source', 'startup']).out)).toBe('runtime context')
  })

  it('lets a read-only agent run only shell commands that read; writers and the main thread are untouched', async () => {
    await use('sound')
    const as = (agent_type: unknown, command: unknown) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_type, tool_input: { command } })
    for (const agent of ['dethereal-infrastructure-scout', 'dethereal-infrastructure-scout-scoped', 'dethereal-model-reviewer']) {
      // the refusal names what it refused, so the agent can read another way
      expect(reason(run('secret-guard', as(agent, 'echo x > child-write.txt')).out)).toBe(`Dethereal: ${agent} runs only shell commands that read (cat, sed -n, head, tail, rg, grep, ls, find, jq, git log, show, diff or status); this one is not: \`> child-write.txt\` (it writes to a file)`)
      expect(reason(run('secret-guard', as(agent, "sh -c 'cp a b'")).out)).toContain('`cp` (not a command that only reads)')
      expect(run('secret-guard', as(agent, 'cat README.md')).out).toBe('')
      expect(run('secret-guard', as(agent, ['bash', '-lc', "sed -n '1,20p' main.tf"])).out).toBe('')
      expect(reason(run('secret-guard', as(agent, ['bash', '-lc', 'rm main.tf'])).out)).toContain('`rm`')
      // a read the secret guard refuses is still refused by it
      expect(reason(run('secret-guard', as(agent, 'cat .env')).out)).toBe('runtime guard: secret file')
      expect(reason(run('secret-guard', as(agent, undefined)).out)).toContain('no command to check')
    }
    // agents that may change files, and the main conversation, go on to the secret guard as before
    for (const agent of ['dethereal-threat-modeler', 'dethereal-security-enricher', undefined, '', 'worker']) {
      expect(run('secret-guard', as(agent, 'echo x > notes.txt')).out, String(agent)).toBe('')
    }
    expect(run('secret-guard', '{"tool_name": "Bash", not json').out).toBe('')
    // a Dethereal caller it cannot read, or does not know, is refused
    expect(reason(run('secret-guard', '{"agent_type": "dethereal-model-reviewer", not json').out)).toContain('could not be read')
    expect(reason(run('secret-guard', as('dethereal-unknown', 'cat README.md')).out)).toContain('is not a known Dethereal agent')
  })

  it('refuses, from any caller, a command that runs input sent to it later; the main thread\'s other commands go on', async () => {
    await use('sound')
    const main = (command: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
    for (const command of ['while read -r l; do eval "$l"; done', 'xargs -I{} sh -c {}', 'bash -s', 'source /dev/stdin', 'bash']) {
      expect(reason(run('secret-guard', main(command)).out), command).toMatch(/^Dethereal: this command runs what is sent to it later, which no hook checks: .+\. Run each command on its own$/)
    }
    for (const command of ['git status', 'rg -n foo src', 'cat src/index.ts', 'node scripts/build.mjs', 'echo x > notes.txt']) {
      expect(run('secret-guard', main(command)).out, command).toBe('')
    }
  })

  it('refuses a read-only agent\'s writing command even when the runtime cannot be used', async () => {
    await freshState()
    const event = JSON.stringify({ tool_name: 'Bash', agent_type: 'dethereal-infrastructure-scout', tool_input: { command: 'touch x' } })
    expect(reason(run('secret-guard', event).out)).toContain('`touch` (not a command that only reads)')
  })

  it('starts the runtime without the caller\'s NODE_OPTIONS and NODE_PATH', async () => {
    await freshState()
    await use('env')
    const out = run('session-start', '{}', ['--source', 'startup'], { NODE_OPTIONS: '--no-warnings', NODE_PATH: '/elsewhere' }).out
    expect(JSON.parse(context(out))).toEqual({ options: null, path: null })
  })

  describe('session start gets the URL variables Codex gives the server', () => {
    const NEW = { env: { DETHERNETY_PLATFORM_URL: 'http://install.invalid' }, env_vars: ['DEBUG', 'DETHERNETY_URL'] }

    it('the install URL as the default, a shell DETHERNETY_URL still winning, a shell DETHERNETY_PLATFORM_URL replaced', async () => {
      await freshState()
      await use('urls')
      answer(listing(NEW))
      expect(urlsSeen()).toMatchObject({ platform: 'http://install.invalid', url: null })
      expect(urlsSeen({ DETHERNETY_URL: 'http://shell.invalid' })).toMatchObject({ platform: 'http://install.invalid', url: 'http://shell.invalid' })
      expect(urlsSeen({ DETHERNETY_URL: 'http://shell.invalid', DETHERNETY_PLATFORM_URL: 'http://mine.invalid' })).toMatchObject({ platform: 'http://install.invalid', url: 'http://shell.invalid' })
      // asked once per session start, from the session's folder
      expect(codexCalls().map((l) => JSON.parse(l))).toEqual(Array(3).fill({ args: ['mcp', 'list', '--json'], cwd: session }))
    })

    it('an older install\'s pinned DETHERNETY_URL as the server gets it: over the shell\'s, and no variable Codex would not pass', async () => {
      await freshState()
      await use('urls')
      answer(listing({ env: { DETHERNETY_URL: 'http://pinned.invalid' }, env_vars: ['DEBUG'] }))
      expect(urlsSeen({ DETHERNETY_URL: 'http://shell.invalid', DETHERNETY_PLATFORM_URL: 'http://mine.invalid' })).toMatchObject({ platform: null, url: 'http://pinned.invalid' })
    })

    it.each([
      ['Codex fails', { code: 1, stdout: '' }],
      ['an answer that does not parse', { stdout: 'not json' }],
      ['no dethereal server', { stdout: [] }],
      ['a disabled server', listing(NEW, { enabled: false })],
      ['an answer over the size limit', { stdout: 'x'.repeat(2 * 1024 * 1024) }],
    ] as const)('leaves the session\'s variables as they are when Codex cannot say (%s)', async (_label, a) => {
      await freshState()
      await use('urls')
      answer(a as Record<string, unknown>)
      expect(urlsSeen({ DETHERNETY_URL: 'http://shell.invalid', DETHERNETY_PLATFORM_URL: 'http://mine.invalid' })).toMatchObject({ platform: 'http://mine.invalid', url: 'http://shell.invalid' })
      expect(codexCalls()).toHaveLength(1)
    })

    it('gives up on a Codex that does not answer within five seconds, and the hook still runs in time', async () => {
      await freshState()
      await use('urls')
      answer({ hang: true })
      const r = urlsSeen({ DETHERNETY_URL: 'http://shell.invalid' })
      expect(r).toMatchObject({ platform: null, url: 'http://shell.invalid' })
      expect(r.ms).toBeGreaterThanOrEqual(5000)
      expect(r.ms).toBeLessThan(deadlines['session-start']!)
      // its whole process group is gone
      expect(spawnSync('pgrep', ['-f', path.join(codexDir, 'fake-codex.mjs')]).stdout.toString().trim()).toBe('')
    })

    it('never runs a codex from the session\'s folder, a temp folder or a node_modules folder, nor when none is found', async () => {
      await freshState()
      await use('urls')
      answer(listing(NEW))
      const planted = (dir: string) => {
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(codexDir, 'fake-codex.mjs'))} "$@"\n`, { mode: 0o755 })
        return dir
      }
      for (const dir of [planted(path.join(session, 'bin')), planted(path.join(home, 'tmp-bin')), planted(path.join(codexDir, 'node_modules', '.bin')), path.join(home, 'nothing-here')]) {
        expect(urlsSeen({ DETHERNETY_URL: 'http://shell.invalid' }, dir)).toMatchObject({ platform: null, url: 'http://shell.invalid' })
      }
      expect(codexCalls()).toEqual([])
    })

    it('never asks Codex for a guard or a post-write hook', async () => {
      await freshState()
      await use('sound')
      answer(listing(NEW))
      const more = { PATH: `${codexDir}${path.delimiter}${process.env.PATH ?? ''}` }
      expect(reason(run('secret-guard', bash('cat .env'), [], more).out)).toBe('runtime guard: secret file')
      expect(run('config-guard', patch('notes.txt'), [], more).out).toBe('')
      expect(run('post-write', '{}', [], more).out).toBe('')
      expect(codexCalls()).toEqual([])
    })
  })

  it.each([
    ['an extra file', (rt: InstalledRuntime) => { chmodSync(rt.runtimePath, 0o700); writeFileSync(path.join(rt.runtimePath, 'extra.js'), 'x'); chmodSync(rt.runtimePath, 0o500) }],
    ['a hard link', (rt: InstalledRuntime) => linkSync(path.join(rt.runtimePath, 'package.json'), path.join(home, 'link'))],
    ['a group-writable runtime directory', (rt: InstalledRuntime) => chmodSync(rt.runtimePath, 0o570)],
    ['a record that does not parse', () => { chmodSync(paths.current, 0o600); writeFileSync(paths.current, '{') }],
    ['a symlinked runtime folder', () => { renameSync(paths.runtime, `${paths.runtime}-real`); symlinkSync(`${paths.runtime}-real`, paths.runtime) }],
  ] as const)('never runs a tampered runtime (%s), and judges by name', async (_label, tamper) => {
    await freshState()
    const rt = await use('sound')
    tamper(rt)
    await degraded(/integrity check/)
    await coreAgrees(false)
  })

  it('judges by name when no runtime is installed', async () => {
    await freshState()
    await degraded(/could not be verified/)
  })

  it('refuses, by name, any shell command that reaches guarded configuration while the runtime cannot be used', async () => {
    await freshState()
    for (const command of [
      "sed -i 's/a/b/' ~/.codex/config.toml",
      'printf x > ~/.dethernety/runtime/current.json',
      'cp evil.mjs ~/.codex/plugins/cache/x/dethereal/1/bin/hook.mjs',
      'cat ~/.codex/plugins/cache/x/dethereal/1/skills/s/SKILL.md',
    ]) expect(reason(run('secret-guard', bash(command)).out), command).toMatch(/could not be verified/)
    expect(run('secret-guard', bash('ls -la')).out).toBe('')
  })

  it('refuses, by name, a command that reaches Codex\'s sign-in, in its default home or one set as an absolute path', async () => {
    await freshState()
    expect(reason(run('secret-guard', bash('cat ~/.codex/auth.json')).out)).toMatch(/could not be verified/)
    expect(run('secret-guard', bash('cat /opt/cx/auth.json')).out).toBe('')
    expect(reason(run('secret-guard', bash('cat /opt/cx/auth.json'), [], { CODEX_HOME: '/opt//cx/' }).out)).toMatch(/could not be verified/)
    // A relative value is a name too: Codex may still use it.
    expect(reason(run('secret-guard', bash('cat cx/auth.json'), [], { CODEX_HOME: 'cx' }).out)).toMatch(/could not be verified/)
    expect(reason(run('secret-guard', bash('cat "$CODEX_HOME"/auth.json'), [], { CODEX_HOME: '/opt/cx' }).out)).toMatch(/could not be verified/)
    expect(run('secret-guard', bash('cat "$CODEX_HOME"/auth.json')).out).toBe('')
  })

  it('refuses, with a sound runtime, a Codex shell command that changes Claude Code\'s configuration, and lets one read it', async () => {
    await use('source')
    // The sources load slower than a built runtime: the guard gets more time here.
    writeFileSync(path.join(bin, 'hook-deadlines.json'), JSON.stringify({ ...deadlines, 'secret-guard': 25_000 }))
    try {
      const shell = (command: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: session })
      const CLAUDE = /^dethereal-secret-guard: this command changes, copies or links something in Claude Code's configuration/
      expect(reason(run('secret-guard', shell('cp x ~/.claude/plugins/cache/m/dethereal/1/bin/hook.mjs')).out)).toMatch(CLAUDE)
      expect(run('secret-guard', shell('cat ~/.claude/plugins/cache/m/dethereal/1/skills/s/SKILL.md')).out).toBe('')
      const cfg = path.join(home, 'cfg', 'claude')
      expect(run('secret-guard', shell(`echo {} > ${cfg}/settings.json`)).out).toBe('')
      expect(reason(run('secret-guard', shell(`echo {} > ${cfg}/settings.json`), [], { CLAUDE_CONFIG_DIR: cfg }).out)).toMatch(CLAUDE)
      expect(reason(run('secret-guard', shell('cp x "$CLAUDE_CONFIG_DIR/plugins/h.mjs"'), [], { CLAUDE_CONFIG_DIR: cfg }).out)).toMatch(CLAUDE)
    } finally {
      writeFileSync(path.join(bin, 'hook-deadlines.json'), JSON.stringify(deadlines))
    }
  })

  it('refuses, by name, a call that reaches Claude Code\'s plugin cache or its set configuration directory while the runtime cannot be used', async () => {
    await freshState()
    const cfg = '/cfg/claude'
    expect(reason(run('config-guard', patch('.claude/plugins/cache/x/dethereal/1/hooks/hooks.json')).out)).toMatch(/could not be verified/)
    expect(reason(run('secret-guard', bash(`cp evil.mjs ${home}/.claude/plugins/cache/x/bin/hook.mjs`)).out)).toMatch(/could not be verified/)
    for (const file of [`${cfg}/plugins/cache/x/bin/hook.mjs`, `${cfg}/settings.json`]) {
      expect(run('config-guard', patch(file)).out, file).toBe('')
      expect(reason(run('config-guard', patch(file), [], { CLAUDE_CONFIG_DIR: cfg }).out), file).toMatch(/could not be verified/)
      expect(reason(run('secret-guard', bash(`cat ${file}`), [], { CLAUDE_CONFIG_DIR: cfg }).out), file).toMatch(/could not be verified/)
    }
    // The directory is read as text resolved: a doubled separator or a `..` in it still names the same place.
    expect(reason(run('config-guard', patch(`${cfg}/settings.json`), [], { CLAUDE_CONFIG_DIR: '/cfg//x/../claude/' }).out)).toMatch(/could not be verified/)
    // A relative value is not a configuration directory, as the full guard reads it.
    for (const file of ['cfg/plugins/x.mjs', path.join(process.cwd(), 'cfg', 'plugins', 'x.mjs')]) {
      expect(run('config-guard', patch(file), [], { CLAUDE_CONFIG_DIR: 'cfg' }).out, file).toBe('')
    }
    expect(run('config-guard', patch(`${cfg}/notes.md`), [], { CLAUDE_CONFIG_DIR: cfg }).out).toBe('')
  })

  it('runs the runtime on its own Node when the recorded one is gone, and says so', async () => {
    const rt = await use('sound')
    const cur = JSON.parse(readFileSync(paths.current, 'utf8'))
    chmodSync(paths.current, 0o600)
    writeFileSync(paths.current, JSON.stringify({ ...cur, execPath: '/nonexistent/node' }))
    expect(reason(run('secret-guard', bash('cat .env')).out)).toBe('runtime guard: secret file')
    expect(context(run('session-start', '{}', ['--source', 'startup']).out)).toMatch(/^The Node binary .*\nruntime context$/s)
    await activateRuntime(paths, env, rt, node)
  })

  // A sound runtime whose guard fails or stalls (a FIFO operand can hang it) is never judged by name: a
  // check that can be made to stall must not fall back to a weaker one.
  it.each(['crash', 'garbage', 'oversize', 'hang', 'killed'])('refuses every guarded call when the runtime\'s guard fails or does not answer in time (%s)', async (kind) => {
    await freshState()
    await use(kind)
    const UNCHECKED = /^Dethereal: this call could not be checked for secret files \(Dethereal's guard failed or took too long\), so it is not run\. Report this to the operator/
    if (kind === 'hang') writeFileSync(path.join(bin, 'hook-deadlines.json'), JSON.stringify({ ...deadlines, 'secret-guard': 1000, 'config-guard': 1000 }))
    try {
      const d = run('secret-guard', bash('test -e trap.json; cat k8s/db-password.txt'))
      expect(reason(d.out)).toMatch(UNCHECKED)
      expect(reason(run('secret-guard', bash('cat .env')).out)).toMatch(UNCHECKED)
      expect(reason(run('secret-guard', bash('ls')).out)).toMatch(UNCHECKED)
      expect(reason(run('config-guard', patch('.codex/config.toml')).out)).toMatch(UNCHECKED)
      expect(reason(run('config-guard', patch('notes.txt')).out)).toMatch(UNCHECKED)
      if (kind === 'hang') expect(d.ms).toBeLessThan(5000)
      // post-write is no guard: it goes on as before, never turned into a refusal
      expect(run('post-write', '{}').out).not.toMatch(/permissionDecision/)
    } finally {
      writeFileSync(path.join(bin, 'hook-deadlines.json'), JSON.stringify(deadlines))
    }
  })

  it('refuses everything when its secret list is missing and the runtime cannot be used', async () => {
    await freshState()
    rmSync(path.join(bin, 'secret-fallback.mjs'))
    try {
      expect(reason(run('secret-guard', bash('ls')).out)).toMatch(/list of secret files is missing/)
    } finally {
      writeFileSync(path.join(bin, 'secret-fallback.mjs'), read('bin/secret-fallback.mjs'))
    }
  })

  it('refuses a guard event it cannot read whole in time', () => {
    const r = spawnSync('/bin/sh', ['-c', `(sleep 5) | "${node}" "${path.join(bin, 'hook.mjs')}" secret-guard --harness codex`], { encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH } })
    expect(reason(r.stdout)).toMatch(/could not be read in full/)
  })
})
