import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStateRoot } from '../../core/paths.js'
import { sha256 } from '../../core/safe-write.js'
import { probeServer } from '../../core/server-probe.js'
import { homeAsTilde, LIVE_ASK_TOOLS, shellArg } from '../index.js'
import { TOOL_MANIFEST } from '../../../tools/manifest.js'
import { runInstaller } from '../../cli/index.js'
import { setControl } from '../../writers/claude/__tests__/fake-claude.js'
import { doctorSuite, root, pkg, node, home, codexHome, env, version, io, deps, doctor, find, installAll, fixedUrl, entryVerdict, trustHooks } from './doctor-harness.js'

doctorSuite()

describe('doctor', () => {
  it('checks every harness as installed, and says when Codex has not trusted the hooks', async () => {
    await installAll()
    const { code, checks } = await doctor()
    expect(code).toBe(1)
    expect(find(checks, 'runtime', 'runtime')).toMatchObject({ status: 'ok', detail: version })
    expect(find(checks, 'runtime', 'node')).toMatchObject({ status: 'ok' })
    expect(find(checks, 'codex', 'hooks trusted')).toMatchObject({ status: 'fail', detail: 'Codex hooks not trusted: 0/8' })
    for (const h of ['claude', 'codex', 'opencode']) {
      expect(find(checks, h, 'server starts'), h).toMatchObject({ status: 'ok' })
      expect(find(checks, h, 'tools'), h).toMatchObject({ status: 'ok' })
      expect(find(checks, h, 'platform'), h).toMatchObject({ status: 'warn', detail: expect.stringMatching(/^http:\/\/127\.0\.0\.1:9 \(from .+\), not reachable$/) })
      expect(find(checks, h, 'signed in'), h).toMatchObject({ status: 'warn', detail: 'no' })
    }
    expect(find(checks, 'claude', 'platform URL')!.detail).toMatch(/every project of this user/)
    // Asked without --live-opencode too: the version is never a false failure.
    expect(find(checks, 'opencode', 'OpenCode version')).toMatchObject({ status: 'ok' })
    expect(find(checks, 'codex', 'project root')).toMatchObject({ detail: 'follows the folder each session starts in' })
    // As the writers record the URL: a default the shell overrides, or fixed by an earlier Dethereal.
    expect(find(checks, 'codex', 'configuration')).toMatchObject(await entryVerdict('codex'))
    expect(find(checks, 'opencode', 'server entry')).toMatchObject(await entryVerdict('opencode'))

    await trustHooks()
    const after = await doctor()
    expect(find(after.checks, 'codex', 'hooks trusted')).toMatchObject({ status: 'ok', detail: '8/8, present, not verified' })
    expect(after.checks.filter((c) => c.status === 'fail'), JSON.stringify(after.checks.filter((c) => c.status === 'fail'))).toEqual([])
    expect(after.code).toBe(0)
  })

  it('never starts a configuration that differs from the install, and says so', async () => {
    await installAll()
    const file = path.join(codexHome, 'config.toml')
    const text = await fs.readFile(file, 'utf8')
    await fs.writeFile(file, text.replace(/^command = ".*"$/m, 'command = "/bin/sh"'))
    const probed: string[] = []
    const spy: typeof probeServer = async (launch, e, o) => { probed.push(launch.entry); return probeServer(launch, e, o) }
    const { checks } = await doctor(['--harness', 'codex'], { probe: spy })
    expect(find(checks, 'codex', 'configuration')).toMatchObject({ status: 'fail', detail: 'the dethereal server entry differs from the install: not probed', fix: expect.stringMatching(/ install --harness codex --scope user$/) })
    expect(find(checks, 'codex', 'server starts')).toBeUndefined()
    expect(probed).toEqual([])
  })

  it('writes nothing, and shows key paths, never values', async () => {
    await installAll()
    const file = path.join(codexHome, 'config.toml')
    // The user changed a value in our server table: doctor names the key, not the value.
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace(/^startup_timeout_sec = \d+$/m, 'startup_timeout_sec = 987654321'))
    const { paths } = await ensureStateRoot(env)
    const before = sha256(await fs.readFile(paths.manifest))
    const { checks } = await doctor(['--harness', 'codex'])
    expect(find(checks, 'codex', 'changed since install')).toMatchObject({ status: 'warn', detail: 'startup_timeout_sec' })
    expect(JSON.stringify(checks)).not.toContain('987654321')
    expect(sha256(await fs.readFile(paths.manifest))).toBe(before)
    await expect(fs.access(path.join(home, '.dethernety', 'tokens.json'))).rejects.toThrow()
  })

  it('records an unverified OpenCode allowed on purpose, shows it as a warning, and drops it at a verified version', async () => {
    const r = io()
    expect(await runInstaller('install', ['--harness', 'opencode', '--scope', 'user', '--allow-unverified-opencode'], r.io, deps({ writers: { openCodeVersion: async () => '1.19.0-rc.1' } }) as never), r.text()).toBe(0)
    const { paths } = await ensureStateRoot(env)
    const m = JSON.parse(await fs.readFile(paths.manifest, 'utf8'))
    expect(m.installs['opencode:user'].allowUnverified).toEqual({ openCodeVersion: '1.19.0' })
    const { checks } = await doctor(['--harness', 'opencode'], { writers: { openCodeVersion: async () => '1.19.0' } })
    expect(find(checks, 'opencode', 'OpenCode version')).toMatchObject({ status: 'warn' })
    expect(find(checks, 'opencode', 'unverified OpenCode allowed')).toMatchObject({ status: 'warn' })
    // The override was given for one version: another unverified one is named against it.
    const later = await doctor(['--harness', 'opencode'], { writers: { openCodeVersion: async () => '1.19.1' } })
    expect(find(later.checks, 'opencode', 'OpenCode version')).toMatchObject({ status: 'warn' })
    expect(find(later.checks, 'opencode', 'unverified OpenCode allowed')).toMatchObject({ status: 'warn', detail: 'installed with --allow-unverified-opencode for 1.19.0; OpenCode is now 1.19.1' })
    expect(await runInstaller('install', ['--harness', 'opencode', '--scope', 'user'], io().io, deps() as never)).toBe(0)
    expect(JSON.parse(await fs.readFile(paths.manifest, 'utf8')).installs['opencode:user'].allowUnverified).toBeUndefined()
  })

  it('checks every prompt-class tool in OpenCode\'s live rules', () => {
    expect([...LIVE_ASK_TOOLS].sort()).toEqual(TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => `dethereal_${t.name}`).sort())
    expect(LIVE_ASK_TOOLS).toHaveLength(14)
  })

  it('names the version of another plugin copy only when it is a version', async () => {
    const r = io()
    expect(await runInstaller('install', ['--harness', 'claude', '--scope', 'user', '--platform-url', 'http://127.0.0.1:9'], r.io, deps() as never), r.text()).toBe(0)
    const file = path.join(home, 'fake-claude', 'state.json')
    const listedAs = async (v: string) => {
      const s = JSON.parse(await fs.readFile(file, 'utf8')) as { plugins: Array<{ version: string }> }
      for (const p of s.plugins) p.version = v
      await fs.writeFile(file, JSON.stringify(s))
      return find((await doctor(['--harness', 'claude'])).checks, 'claude', 'server starts')
    }
    expect(await listedAs('9.9.9')).toMatchObject({ status: 'warn', detail: `not probed: the copy is 9.9.9, doctor is ${version}`, fix: 'npx @dether.net/dethereal@9.9.9 doctor' })
    const odd = await listedAs('1.0.0; rm -rf ~')
    expect(odd).toMatchObject({ status: 'warn', detail: `not probed: the copy is another version, doctor is ${version}` })
    expect(odd).not.toHaveProperty('fix')
  })

  it('says when OpenCode cannot tell its version, and when the state folder is readable by others', async () => {
    const r = io()
    expect(await runInstaller('install', ['--harness', 'opencode', '--scope', 'user'], r.io, deps() as never), r.text()).toBe(0)
    const { paths } = await ensureStateRoot(env)
    await fs.chmod(paths.root, 0o750)
    try {
      const { checks } = await doctor(['--harness', 'opencode'], { writers: { openCodeVersion: async () => { throw new Error('exit 1') } } })
      expect(find(checks, 'opencode', 'OpenCode version')).toMatchObject({ status: 'fail', detail: 'opencode --version could not be run' })
      expect(find(checks, 'state', '~/.dethernety')).toMatchObject({ status: 'warn', fix: 'chmod 700 ~/.dethernety' })
      expect((await fs.stat(paths.root)).mode & 0o777).toBe(0o750)
    } finally {
      await fs.chmod(paths.root, 0o700)
    }
  })

  it('shows a home as ~ only where a path starts with it, and quotes a path that is not one plain word', () => {
    const t = homeAsTilde(['/home/u', '/home/u/real', '/'])
    expect(t('/home/u/p and (/home/u) at /home/u/real/x')).toBe('~/p and (~) at ~/x')
    expect(t('/home/user/p /mnt/bk/home/u/x /etc')).toBe('/home/user/p /mnt/bk/home/u/x /etc')
    expect(t('the root folder /')).toBe('the root folder /')
    expect(shellArg('/a/b-c_d.e')).toBe('/a/b-c_d.e')
    expect(shellArg("/a/x y$(id)'z")).toBe("'/a/x y$(id)'\\''z'")
  })

  it('lists the tools by approval in --json only', async () => {
    const { checks } = await doctor()
    const listed = find(checks, 'tools', 'tool approvals')!
    const auto = TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name).sort()
    const ask = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => t.name).sort()
    expect(auto.length + ask.length).toBe(TOOL_MANIFEST.length)
    expect(listed).toEqual({ subject: 'tools', label: 'tool approvals', status: 'ok', detail: `${auto.length} run without asking: ${auto.join(', ')}; ${ask.length} ask first: ${ask.join(', ')}` })
    const r = io()
    await runInstaller('doctor', [], r.io, deps() as never)
    expect(r.text()).not.toMatch(/tool approvals|run without asking/)
    for (const t of TOOL_MANIFEST) expect(r.text()).not.toContain(t.name)
  })

  it('checks the Claude Code version against the installer\'s floor', async () => {
    await installAll()
    expect(find((await doctor(['--harness', 'claude'])).checks, 'claude', 'Claude Code version')).toEqual(expect.objectContaining({ status: 'ok', detail: '2.1.295' }))
    await setControl(home, { npmLatest: version, npmPackages: { [version]: pkg }, version: '2.1.294' })
    expect(find((await doctor(['--harness', 'claude'])).checks, 'claude', 'Claude Code version')).toEqual(expect.objectContaining({
      status: 'fail', detail: 'Claude Code 2.1.294 is older than 2.1.295, the first that blocks a call when a guard hook fails; update Claude Code', fix: 'update Claude Code to 2.1.295 or newer',
    }))
  })

  it('says what to run when nothing is installed', async () => {
    const { code, checks } = await doctor()
    expect(code).toBe(1)
    // The tool list (its own test) is there whatever is installed.
    expect(checks.filter((c) => c.subject !== 'tools')).toEqual([expect.objectContaining({ subject: 'doctor', label: 'installed', status: 'fail', fix: expect.stringMatching(/^npx @dether\.net\/dethereal@\S+ install --harness claude,codex,opencode --scope user$/) })])
    // Doctor creates nothing, not even the state folder.
    await expect(fs.access(path.join(home, '.dethernety'))).rejects.toThrow()
  })

  it('prints grouped lines with fixes, and the live OpenCode warning on stderr', async () => {
    await installAll()
    const r = io()
    expect(await runInstaller('doctor', ['--harness', 'codex'], r.io, deps() as never)).toBe(1)
    expect(r.text()).toMatch(new RegExp(`^Dethereal doctor ${version.replace(/\./g, '\\.')}\n`))
    expect(r.text()).toMatch((await fixedUrl('codex')) ? /\ncodex \(user\):\n {2}warn {2}configuration: installed by an earlier Dethereal/ : /\ncodex \(user\):\n {2}ok {4}configuration\n/)
    expect(r.text()).toMatch(/FAIL {2}hooks trusted: Codex hooks not trusted: 0\/8\n {8}fix: open Codex \(the interactive app, not codex exec\) and trust/)
    const live = io()
    await runInstaller('doctor', ['--harness', 'claude', '--live-opencode'], live.io, deps() as never)
    expect(live.err()).toMatch(/--live-opencode runs OpenCode with its plugins loaded: your own, and in a project the project's own too/)
  })
})
