import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { doctorSuite, codexHome, env, setEnv, version, doctor, find, installAll, FIXED_URL, setUrlShape, trustHooks } from './doctor-harness.js'

doctorSuite()

describe('doctor: the platform URL and the Codex hook settings', () => {
  it('reads a URL recorded as a default, which a shell DETHERNETY_URL overrides, and says where the URL comes from', async () => {
    await installAll()
    await setUrlShape('default')
    const plain = (await doctor(['--harness', 'codex,opencode'])).checks
    for (const h of ['codex', 'opencode']) {
      expect(find(plain, h, h === 'codex' ? 'configuration' : 'server entry'), h).toMatchObject({ status: 'ok' })
      expect(find(plain, h, 'platform URL'), h).toEqual(expect.objectContaining({ status: 'ok', detail: 'http://127.0.0.1:9, the install default (a DETHERNETY_URL set in your shell overrides it)' }))
    }
    expect(find(plain, 'codex', 'platform')).toMatchObject({ detail: 'http://127.0.0.1:9 (from the install default), not reachable' })
    expect(find(plain, 'codex', 'Codex MCP list')).toMatchObject({ status: 'ok' })
    // This shell's DETHERNETY_URL reaches the server, and wins.
    setEnv({ ...env, vars: { ...env.vars, DETHERNETY_URL: 'http://127.0.0.1:8' } })
    const shell = await doctor(['--harness', 'claude,codex,opencode'])
    for (const h of ['claude', 'codex', 'opencode']) {
      expect(find(shell.checks, h, 'platform URL'), h).toMatchObject({ status: 'warn', detail: expect.stringMatching(/^this shell's DETHERNETY_URL \(http:\/\/127\.0\.0\.1:8\) overrides the install URL /), fix: 'unset DETHERNETY_URL to use the install URL' })
    }
    for (const h of ['claude', 'codex']) expect(find(shell.checks, h, 'platform'), h).toMatchObject({ detail: 'http://127.0.0.1:8 (from DETHERNETY_URL in this shell), not reachable' })
  })

  it('reads a URL an earlier Dethereal fixed as a warning to re-run install, still probed, the shell not reaching it', async () => {
    await installAll()
    await setUrlShape('fixed')
    setEnv({ ...env, vars: { ...env.vars, DETHERNETY_URL: 'http://127.0.0.1:8' } })
    const { checks } = await doctor(['--harness', 'codex,opencode'])
    expect(find(checks, 'codex', 'configuration')).toMatchObject({ status: 'warn', detail: FIXED_URL, fix: expect.stringMatching(/ install --harness codex --scope user$/) })
    expect(find(checks, 'opencode', 'server entry')).toMatchObject({ status: 'warn', detail: FIXED_URL, fix: expect.stringMatching(/ install --harness opencode --scope user$/) })
    for (const h of ['codex', 'opencode']) expect(find(checks, h, 'platform URL'), h).toMatchObject({ status: 'ok', detail: 'http://127.0.0.1:9, fixed by the install (a shell DETHERNETY_URL does not override it)' })
    expect(find(checks, 'codex', 'server starts')).toMatchObject({ status: 'ok' })
    expect(find(checks, 'codex', 'platform')).toMatchObject({ detail: 'http://127.0.0.1:9 (from the install URL, fixed), not reachable' })
    // Its URL variables alone are not reported as changed.
    expect(find(checks, 'codex', 'changed since install')).toBeUndefined()
  })

  it('says when Codex hooks are switched off, trusted only in a profile, or served by another app-server', async () => {
    await installAll()
    const file = path.join(codexHome, 'config.toml')
    const base = await fs.readFile(file, 'utf8')
    // Trusted only in a profile's own file: runs without -p never see it.
    const tables = (await (async () => { await trustHooks(); return fs.readFile(file, 'utf8') })()).slice(base.length)
    await fs.writeFile(file, base)
    await fs.writeFile(path.join(codexHome, 'work.config.toml'), tables)
    const prof = find((await doctor(['--harness', 'codex'])).checks, 'codex', 'hooks trusted')!
    expect(prof).toMatchObject({ status: 'fail', fix: 'open Codex (the interactive app, not codex exec) and trust Dethereal\'s hooks when it asks, or later with /hooks' })
    expect(prof.detail).toBe('Codex hooks not trusted: 0/8; trusted only in profile work (8/8), which runs without -p do not use')
    await fs.rm(path.join(codexHome, 'work.config.toml'))
    // Trusted, but hooks switched off for Codex as a whole.
    await fs.writeFile(file, `[features]\nhooks = false\n${base}${tables}`)
    expect(find((await doctor(['--harness', 'codex'])).checks, 'codex', 'hooks trusted')).toMatchObject({ status: 'fail', detail: 'Codex hooks are switched off in config.toml [features]' })
    await fs.writeFile(file, base + tables)
    // An app-server of another version keeps serving sessions with the plugin it loaded.
    const releases = path.join(codexHome, 'packages', 'app-server-daemon', 'releases')
    await fs.mkdir(path.join(releases, '0.150.0-darwin-arm64'), { recursive: true })
    expect(find((await doctor(['--harness', 'codex'])).checks, 'codex', 'Codex app-server')).toMatchObject({ status: 'warn', detail: 'the background app-server is 0.150.0, the CLI 0.157.0' })
    await fs.rename(path.join(releases, '0.150.0-darwin-arm64'), path.join(releases, '0.157.0-darwin-arm64'))
    expect(find((await doctor(['--harness', 'codex'])).checks, 'codex', 'Codex app-server')).toBeUndefined()
  })
})
