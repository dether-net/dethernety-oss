import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generate } from '../../../../generator/index.js'
import { FIXTURE_WORKFLOW } from '../../../../generator/cli.js'
import { ensureStateRoot, type InstallerEnv, type StatePaths } from '../../../core/paths.js'
import { readManifest } from '../../../core/manifest.js'
import type { TxContext } from '../../../core/transaction.js'
import {
  applyOpenCode, checkOpenCode, coversStateRootAsOpenCode, effectiveRuleProblems, fillPlugin, installedOpenCodeUrl, OPENCODE_VERIFIED, openCodeLeftovers, OpenCodeRefusal, planOpenCode,
  PLUGIN_MARKER, pluginLoadProblems, stateRootPatterns, uninstallOpenCode, versionGate, versionStatus, type OpenCodeInput,
} from '../index.js'

let tmp: string
let home: string
let project: string
let env: InstallerEnv
let paths: StatePaths
let ctx: TxContext

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-opencode-writer-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'work', 'orders')
  await fs.mkdir(home, { mode: 0o700, recursive: true })
  await fs.mkdir(project, { recursive: true })
  // The worktree holds the project: a folder above the worktree is not one OpenCode loads plugins from.
  await fs.mkdir(path.join(tmp, 'work', '.git'), { recursive: true })
  env = { home, vars: {}, euid: process.geteuid!(), platform: process.platform }
  paths = (await ensureStateRoot(env)).paths
  ctx = { paths, env }
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** A runtime folder holding the generated OpenCode bundle (placeholders unfilled, as the package ships it). */
async function runtime(version: string, tweak?: (files: Map<string, string>) => void): Promise<{ version: string; runtimePath: string }> {
  const out = generate({ pkg: { name: '@dether.net/dethereal', version }, workflowDir: FIXTURE_WORKFLOW, harness: 'opencode' })
  tweak?.(out)
  const dir = path.join(paths.runtime, version)
  for (const [rel, content] of out) {
    const f = path.join(dir, rel)
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, content)
  }
  await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
  await fs.writeFile(path.join(dir, 'dist', 'index.js'), 'export {}\n')
  return { version, runtimePath: dir }
}

const input = async (over: Partial<OpenCodeInput> = {}): Promise<OpenCodeInput> => ({
  env, paths, scope: { project }, runtime: await runtime('0.5.0'), execPath: process.execPath, url: 'https://platform.example.test', openCodeVersion: '1.18.34', ...over,
})

async function install(over: Partial<OpenCodeInput> = {}) {
  return applyOpenCode(ctx, await planOpenCode(await input(over)))
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof OpenCodeRefusal) return e.code
    throw e
  }
  return 'none'
}

/** Every file below a folder with its content hash, the state root left out. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (p !== paths.root) await walk(p)
      } else out[path.relative(dir, p)] = createHash('sha256').update(await fs.readFile(p)).digest('hex')
    }
  }
  await walk(dir)
  return out
}

const read = (rel: string, base = project) => readFileSync(path.join(base, rel), 'utf8')

/**
 * Tests that install: every file is a durable transaction of the installer core (lock, backup,
 * manifest, fsync), about 35 ms each. An install with an upgrade or an uninstall takes up to 1.8 s
 * alone and 3 s inside a parallel full suite, where the default 5 s left too little room. Each test
 * has its own home, state root and project, so the time is disk work, not shared state.
 */
const INSTALLING = { timeout: 30_000 }

describe('the OpenCode writer: install', INSTALLING, () => {
  it('writes the bundle and its configuration into the project, the plugin first and the configuration last', async () => {
    const r = await install()
    expect(r.status).toBe('installed')
    const rels = r.records.map((x) => path.relative(project, x.path))
    expect(rels[0]).toBe('.opencode/plugins/dethereal.ts')
    expect(rels.at(-1)).toBe('opencode.json')
    expect(rels).toEqual(expect.arrayContaining(['.opencode/agents/dethereal-reviewer.md', '.opencode/commands/dethereal-audit.md', '.opencode/skills/dethereal-status/SKILL.md']))
    const plugin = read('.opencode/plugins/dethereal.ts')
    expect(plugin).toContain(PLUGIN_MARKER)
    expect(plugin).toContain(`const NODE: string = ${JSON.stringify(process.execPath)}`)
    expect(plugin).toContain('const URL_ENV: Record<string, string> = {"DETHERNETY_PLATFORM_URL":"https://platform.example.test"}')
    expect(plugin).not.toMatch(/<node-abs>|<runtime>|<ask-tools>|<platform-url>/)
    const config = JSON.parse(read('opencode.json'))
    expect(config.mcp.dethereal).toMatchObject({ type: 'local', command: [process.execPath, expect.stringMatching(/runtime\/0\.5\.0\/dist\/index\.js$/)], timeout: 60000 })
    // The install URL is a default: DETHERNETY_URL, which would override the shell's, is never written.
    expect(config.mcp.dethereal.environment).toEqual({ DETHERNETY_PLATFORM_URL: 'https://platform.example.test' })
    expect(config.permission.dethereal_model_state_waive).toBe('ask')
    expect(config.agent.explore.permission['dethereal_*']).toBe('deny')
    expect(Object.entries(config.permission.external_directory)).toEqual(expect.arrayContaining([['~/.dethernety', 'deny'], ['~/.dethernety/*', 'deny'], [`${await fs.realpath(home)}/.dethernety/*`, 'deny']]))
  })

  it('changes nothing when run again, and upgrades by undoing the old install first', async () => {
    await install()
    expect((await install()).status).toBe('unchanged')
    const next = await runtime('0.5.1', (files) => {
      const k = 'bundles/opencode/skills/dethereal-status/SKILL.md'
      files.set(k, `${files.get(k)}\nOne more line.\n`)
    })
    const r = await applyOpenCode(ctx, await planOpenCode(await input({ runtime: next })))
    expect(r.status).toBe('installed')
    expect(read('.opencode/skills/dethereal-status/SKILL.md')).toContain('One more line.')
    expect(JSON.parse(read('opencode.json')).mcp.dethereal.command[1]).toMatch(/0\.5\.1/)
    const { manifest } = await readManifest(paths, env)
    expect(Object.keys(manifest.installs)).toEqual([`opencode:project:${project}`])
  })

  it('installs again when only the URL changed, and keeps it', async () => {
    await install()
    expect((await install({ url: 'https://other.example.test' })).status).toBe('installed')
    expect(JSON.parse(read('opencode.json')).mcp.dethereal.environment).toEqual({ DETHERNETY_PLATFORM_URL: 'https://other.example.test' })
    expect(read('.opencode/plugins/dethereal.ts')).toContain('"https://other.example.test"')
    expect((await install({ url: 'https://other.example.test' })).status).toBe('unchanged')
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBe('https://other.example.test')
  })

  it('moves an entry an earlier version wrote, with the URL in DETHERNETY_URL, to the default key at the same version', async () => {
    await fs.writeFile(path.join(project, 'opencode.json'), '{\n  "theme": "dark"\n}\n')
    const original = read('opencode.json')
    // The earlier writer's entry, recorded as that writer recorded it.
    const plan = await planOpenCode(await input())
    const entries = plan.config.entries.map((e) =>
      e.path.join('.') === 'mcp.dethereal' ? { ...e, value: { ...(e.value as object), environment: { DETHERNETY_URL: 'https://platform.example.test' } } } : e)
    await applyOpenCode(ctx, { ...plan, config: { ...plan.config, entries } })
    expect(JSON.parse(read('opencode.json')).mcp.dethereal.environment).toEqual({ DETHERNETY_URL: 'https://platform.example.test' })
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBe('https://platform.example.test')

    expect((await install()).status).toBe('installed')
    const config = JSON.parse(read('opencode.json'))
    expect(config.mcp.dethereal.environment).toEqual({ DETHERNETY_PLATFORM_URL: 'https://platform.example.test' })
    expect(config.theme).toBe('dark')
    expect((await install()).status).toBe('unchanged')
    await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    expect(read('opencode.json')).toBe(original)
  })

  it('reports the URL of an install only while its entry is as the install wrote it', async () => {
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBeNull()
    await install({ url: 'https://kept.example.test' })
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBe('https://kept.example.test')
    expect(await installedOpenCodeUrl({ env, paths, scope: 'user' })).toBeNull()
    // Another key of the user's changed: the entry is still ours.
    const config = JSON.parse(read('opencode.json'))
    await fs.writeFile(path.join(project, 'opencode.json'), JSON.stringify({ ...config, theme: 'dark' }, null, 2))
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBe('https://kept.example.test')
    config.mcp.dethereal.environment.DETHERNETY_PLATFORM_URL = 'https://edited.example.test'
    await fs.writeFile(path.join(project, 'opencode.json'), JSON.stringify(config, null, 2))
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBeNull()
    await fs.rm(path.join(project, 'opencode.json'))
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBeNull()
    await fs.rm(project, { recursive: true })
    expect(await installedOpenCodeUrl({ env, paths, scope: { project } })).toBeNull()
  })

  it('stops an upgrade when a file it wrote was changed, before touching anything', async () => {
    await install()
    await fs.appendFile(path.join(project, '.opencode/plugins/dethereal.ts'), '\n// mine\n')
    const before = await tree(project)
    expect(await refusal(install({ runtime: await runtime('0.5.1') }))).toBe('user_edited')
    expect(await tree(project)).toEqual(before)
  })

  it('keeps comments and the user\'s own keys in opencode.jsonc, and gives the file back byte for byte on uninstall', async () => {
    const original = '// my settings\n{\n  "theme": "dark", // keep\n  "permission": { "edit": "ask" },\n}\n'
    await fs.writeFile(path.join(project, 'opencode.jsonc'), original)
    const before = await tree(tmp)
    await install()
    const text = read('opencode.jsonc')
    expect(text).toContain('// my settings')
    expect(text).toContain('"theme": "dark", // keep')
    expect(await fs.access(path.join(project, 'opencode.json')).then(() => true, () => false)).toBe(false)
    const out = await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    expect(out.every((o) => ['deleted', 'restored', 'unmerged'].includes(o.outcome))).toBe(true)
    expect(read('opencode.jsonc')).toBe(original)
    expect(await fs.access(path.join(project, '.opencode')).then(() => true, () => false)).toBe(false)
    const after = await tree(tmp)
    for (const k of Object.keys(after)) if (k.startsWith('home/.dethernety')) delete after[k]
    for (const k of Object.keys(before)) if (k.startsWith('home/.dethernety')) delete before[k]
    expect(after).toEqual(before)
  })

  it('keeps a user edit of opencode.jsonc made after the install, taking out only its own keys', async () => {
    await fs.writeFile(path.join(project, 'opencode.jsonc'), '{\n  "theme": "dark"\n}\n')
    await install()
    const text = read('opencode.jsonc').replace('"theme": "dark"', '"theme": "light"')
    await fs.writeFile(path.join(project, 'opencode.jsonc'), text)
    await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    expect(JSON.parse(read('opencode.jsonc'))).toEqual({ theme: 'light' })
  })

  it("starts a configuration file it creates with OpenCode's schema line, so OpenCode has nothing to write into it", async () => {
    await install()
    const text = read('opencode.json')
    expect(text.indexOf('"$schema": "https://opencode.ai/config.json"')).toBeLessThan(text.indexOf('"mcp"'))
    const out = await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    expect(out.find((o) => o.path.endsWith('opencode.json'))?.outcome).toBe('deleted')
    expect(await fs.access(path.join(project, 'opencode.json')).then(() => true, () => false)).toBe(false)
  })

  it('removes a configuration file it created that holds only the schema line once its keys are out, after OpenCode or a reformat changed it', async () => {
    await install()
    // As OpenCode or an editor would leave it: the same keys, laid out anew.
    await fs.writeFile(path.join(project, 'opencode.json'), `${JSON.stringify(JSON.parse(read('opencode.json')), null, 4)}\n`)
    const out = await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    expect(out.find((o) => o.path.endsWith('opencode.json'))?.outcome).toBe('deleted')
    expect(await fs.access(path.join(project, 'opencode.json')).then(() => true, () => false)).toBe(false)
  })

  it('keeps a configuration file it created once the user wrote anything else into it', async () => {
    await install()
    const edited = read('opencode.json').replace('{', '{\n  "theme": "dark",')
    await fs.writeFile(path.join(project, 'opencode.json'), edited)
    const out = await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    expect(out.find((o) => o.path.endsWith('opencode.json'))?.outcome).toBe('unmerged')
    expect(JSON.parse(read('opencode.json'))).toEqual({ theme: 'dark', $schema: 'https://opencode.ai/config.json' })
  })

  it('installs for the user into the XDG config folder', async () => {
    const xdg = path.join(home, 'xdg')
    await fs.mkdir(xdg, { mode: 0o700 })
    const userEnv = { ...env, vars: { XDG_CONFIG_HOME: xdg } }
    await applyOpenCode({ paths, env: userEnv }, await planOpenCode(await input({ env: userEnv, scope: 'user' })))
    expect(read('opencode/plugins/dethereal.ts', xdg)).toContain(PLUGIN_MARKER)
    expect(JSON.parse(read('opencode/opencode.json', xdg)).mcp.dethereal).toBeDefined()
  })
})

describe('the OpenCode writer: refusals, before anything is written', INSTALLING, () => {
  it.each([
    ['a permission given as one word', '{ "permission": "allow" }', 'config_conflict'],
    ['an external_directory given as one word', '{ "permission": { "external_directory": "allow" } }', 'config_conflict'],
    ['a Dethereal key holding another value', '{ "permission": { "dethereal_model_state_waive": "allow" } }', 'config_conflict'],
    ['a file that is not a JSON object', '[1, 2]', 'config_unreadable'],
  ])('refuses %s', async (_what, text, code) => {
    await fs.writeFile(path.join(project, 'opencode.json'), text)
    expect(await refusal(planOpenCode(await input()))).toBe(code)
  })

  it('leaves a key the user already set our way to the user, and notes it', async () => {
    await fs.writeFile(path.join(project, 'opencode.json'), '{ "permission": { "dethereal_model_state_waive": "ask" } }\n')
    const plan = await planOpenCode(await input())
    expect(plan.config.entries.some((e) => e.path.join('.') === 'permission.dethereal_model_state_waive')).toBe(false)
    expect(plan.notes.join('\n')).toMatch(/already set as Dethereal sets it/)
  })

  it('refuses both opencode.json and opencode.jsonc', async () => {
    await fs.writeFile(path.join(project, 'opencode.json'), '{}')
    await fs.writeFile(path.join(project, 'opencode.jsonc'), '{}')
    expect(await refusal(planOpenCode(await input()))).toBe('config_conflict')
  })

  it('refuses a file of ours that the installer did not write', async () => {
    await fs.mkdir(path.join(project, '.opencode/agents'), { recursive: true })
    await fs.writeFile(path.join(project, '.opencode/agents/dethereal-reviewer.md'), 'mine\n')
    const before = await tree(project)
    expect(await refusal(install())).toBe('unowned_file')
    expect(await tree(project)).toEqual(before)
  })

  it('refuses a project that is the home folder or holds it', async () => {
    expect(await refusal(planOpenCode(await input({ scope: { project: home } })))).toBe('project_at_home')
    expect(await refusal(planOpenCode(await input({ scope: { project: tmp } })))).toBe('project_at_home')
  })

  it('refuses a second Dethereal plugin wherever OpenCode would load one, by its marker', async () => {
    for (const where of [path.join(home, '.config/opencode/plugin'), path.join(home, '.opencode/plugins'), path.join(tmp, 'work', '.opencode', 'plugins')]) {
      await fs.mkdir(where, { recursive: true })
      await fs.writeFile(path.join(where, 'renamed.ts'), `${PLUGIN_MARKER}\nexport {}\n`)
      expect([where, await refusal(planOpenCode(await input()))]).toEqual([where, 'second_plugin'])
      await fs.rm(path.join(where, 'renamed.ts'))
    }
    // The worktree ends at its .git: a folder above it is not loaded.
    await fs.mkdir(path.join(tmp, '.opencode/plugins'), { recursive: true })
    await fs.writeFile(path.join(tmp, '.opencode/plugins/x.ts'), `${PLUGIN_MARKER}\n`)
    expect(await refusal(planOpenCode(await input()))).toBe('none')
  })

  it('refuses a second scope while one is installed', async () => {
    await install()
    const xdg = path.join(home, 'xdg')
    await fs.mkdir(xdg, { mode: 0o700 })
    const userEnv = { ...env, vars: { XDG_CONFIG_HOME: xdg } }
    expect(await refusal(planOpenCode(await input({ env: userEnv, scope: 'user' })))).toMatch(/second_plugin|second_scope/)
  })

  it('refuses a value OpenCode would read as a substitution', async () => {
    expect(await refusal(planOpenCode(await input({ execPath: '/opt/{file:~/.ssh/id_rsa}/node' })))).toBe('unsafe_value')
    expect(await refusal(planOpenCode(await input({ url: 'https://x.test/{env:HOME}' })))).toBe('unsafe_value')
  })

  it('refuses an OpenCode version outside the checked set, unless an unverified one is allowed', async () => {
    expect(await refusal(planOpenCode(await input({ openCodeVersion: '1.18.31' })))).toBe('opencode_version')
    expect(await refusal(planOpenCode(await input({ openCodeVersion: '1.19.0' })))).toBe('opencode_version')
    const plan = await planOpenCode(await input({ openCodeVersion: '1.19.0', allowUnverified: true }))
    expect(plan.notes.join('\n')).toMatch(/newer than the versions Dethereal was checked with/)
  })
})

describe('the OpenCode writer: its rules', () => {
  it('gates the version: below the floor never, the checked set yes, newer only when allowed, unknown read as no OpenCode', () => {
    expect(versionGate('1.18.31')).toMatchObject({ install: false })
    for (const v of OPENCODE_VERIFIED) expect(versionGate(v)).toEqual({ install: true, unverified: false })
    expect(versionGate('1.18.35')).toMatchObject({ install: false })
    expect(versionGate('1.18.35', true)).toMatchObject({ install: true, unverified: true })
    expect(versionGate('opencode')).toMatchObject({ install: false })
    expect(versionGate(null)).toMatchObject({ install: true, unverified: true })
  })

  it('pins the smoke script to the newest checked version', () => {
    const script = readFileSync(path.join(__dirname, '../../../../../scripts/smoke-opencode.mjs'), 'utf8')
    expect(/export const OPENCODE_VERSION = '([^']+)'/.exec(script)?.[1]).toBe(OPENCODE_VERIFIED.at(-1))
  })

  it('fills the plugin once, and refuses a template that is not its own', () => {
    const t = `${PLUGIN_MARKER}\nconst NODE: string = "<node-abs>"\nconst ENTRY: string = "<runtime>/dist/index.js"\nconst URL_ENV = {"DETHERNETY_PLATFORM_URL":"<platform-url>"}\n`
    const filled = fillPlugin(t, '/usr/bin/node', '/r/dist/index.js', 'https://p.example.test')
    expect(filled).toContain('const NODE: string = "/usr/bin/node"')
    expect(filled).toContain('const URL_ENV = {"DETHERNETY_PLATFORM_URL":"https://p.example.test"}')
    expect(() => fillPlugin(t.replace(PLUGIN_MARKER, ''), '/n', '/e', 'https://p')).toThrow(OpenCodeRefusal)
    expect(() => fillPlugin(`${t}"<node-abs>"`, '/n', '/e', 'https://p')).toThrow(OpenCodeRefusal)
    expect(() => fillPlugin(`${t}"<platform-url>"`, '/n', '/e', 'https://p')).toThrow(OpenCodeRefusal)
    expect(() => fillPlugin(t.replace('"<platform-url>"', '""'), '/n', '/e', 'https://p')).toThrow(OpenCodeRefusal)
  })

  it('covers the server folder as OpenCode asks about it, by every spelling of the home', () => {
    const patterns = stateRootPatterns('/fake-home', ['/private/fake-home'])
    expect(coversStateRootAsOpenCode(patterns, '/fake-home', ['/private/fake-home'])).toEqual([])
    expect(coversStateRootAsOpenCode(['~/.dethernety'], '/fake-home').length).toBeGreaterThan(0)
  })

  it('reads a live ruleset for doctor: a tool that would not ask, a place that would not be refused', () => {
    const ok = [
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'dethereal_model_state_waive', pattern: '*', action: 'ask' },
      { permission: 'external_directory', pattern: '~/.dethernety/*', action: 'deny' },
    ]
    expect(effectiveRuleProblems(ok, ['dethereal_model_state_waive'], '/fake-home')).toEqual([])
    const bad = [...ok, { permission: 'dethereal_*', pattern: '*', action: 'allow' }, { permission: 'external_directory', pattern: '/fake-home/*', action: 'allow' }]
    expect(effectiveRuleProblems(bad, ['dethereal_model_state_waive'], '/fake-home')).toEqual([
      'dethereal_model_state_waive is allow, not ask',
      'external_directory /fake-home/.dethernety/* is allow, not deny',
      'external_directory /fake-home/.dethernety/runtime/* is allow, not deny',
      'external_directory /fake-home/.dethernety/runtime/0.0.0/dist/* is allow, not deny',
    ])
  })
})

describe('the OpenCode writer: checks for doctor', INSTALLING, () => {
  it('reports the install, an edited file, a second plugin, overriding layers and a Node that cannot run', async () => {
    await install()
    let checks = await checkOpenCode(ctx, { env, paths, scope: { project }, openCodeVersion: '1.18.34' })
    expect(checks.filter((c) => !c.ok)).toEqual([])
    await fs.appendFile(path.join(project, '.opencode/skills/dethereal-status/SKILL.md'), 'x')
    await fs.mkdir(path.join(home, '.opencode/plugins'), { recursive: true })
    await fs.writeFile(path.join(home, '.opencode/plugins/old.ts'), `${PLUGIN_MARKER}\n`)
    const plugin = path.join(project, '.opencode/plugins/dethereal.ts')
    await fs.writeFile(plugin, readFileSync(plugin, 'utf8').replace(JSON.stringify(process.execPath), '"/nowhere/node"'))
    checks = await checkOpenCode(ctx, { env: { ...env, vars: { OPENCODE_PURE: '1' } }, paths, scope: { project }, openCodeVersion: '1.18.34' })
    expect(checks.filter((c) => !c.ok).map((c) => c.label).sort()).toEqual(['files as installed', 'no overriding configuration', 'one Dethereal plugin', "the plugin's Node"])
  })
})

describe('the OpenCode writer: a project that is gone, and the XDG folder', INSTALLING, () => {
  it('forgets the install of a deleted project only when asked, and a user install works after', async () => {
    await install()
    await fs.rm(project, { recursive: true, force: true })
    expect(await refusal(uninstallOpenCode(ctx, { env, paths, scope: { project } }))).toBe('project_missing')
    const xdg = path.join(home, 'xdg')
    await fs.mkdir(xdg, { mode: 0o700 })
    const userEnv = { ...env, vars: { XDG_CONFIG_HOME: xdg } }
    expect(await refusal(planOpenCode(await input({ env: userEnv, scope: 'user' })))).toMatch(/second_scope|second_plugin/)
    const out = await uninstallOpenCode(ctx, { env, paths, scope: { project }, forgetMissingProject: true })
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((o) => o.outcome === 'missing')).toBe(true)
    const { manifest } = await readManifest(paths, env)
    expect(Object.keys(manifest.installs).filter((k) => k.startsWith('opencode:'))).toEqual([])
    expect((await applyOpenCode({ paths, env: userEnv }, await planOpenCode(await input({ env: userEnv, scope: 'user' })))).status).toBe('installed')
  })

  it('writes where OpenCode reads XDG_CONFIG_HOME, even before the folder exists, and refuses a missing one outside the home', async () => {
    const xdg = path.join(home, 'not-yet', 'config')
    const userEnv = { ...env, vars: { XDG_CONFIG_HOME: xdg } }
    await applyOpenCode({ paths, env: userEnv }, await planOpenCode(await input({ env: userEnv, scope: 'user' })))
    expect(read('opencode/plugins/dethereal.ts', xdg)).toContain(PLUGIN_MARKER)
    const outside = { ...env, vars: { XDG_CONFIG_HOME: path.join(tmp, 'elsewhere', 'config') } }
    expect(await refusal(planOpenCode(await input({ env: outside, scope: 'user' })))).toBe('xdg_missing')
  })

  it("reports the files OpenCode keeps in its config folder and leaves them on uninstall", async () => {
    await install()
    await fs.mkdir(path.join(project, '.opencode', 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(project, '.opencode', 'package.json'), '{}')
    await fs.writeFile(path.join(project, '.opencode', '.gitignore'), 'node_modules\n')
    await uninstallOpenCode(ctx, { env, paths, scope: { project } })
    const left = (await openCodeLeftovers({ env, paths, scope: { project } })).map((p) => path.basename(p)).sort()
    expect(left).toEqual(['.gitignore', 'node_modules', 'package.json'])
    expect(await fs.access(path.join(project, '.opencode', 'plugins')).then(() => true, () => false)).toBe(false)
  })
})

describe('the OpenCode writer: doctor-side checks', () => {
  it('reports a newer OpenCode as a warning, an older one as a failure', () => {
    expect(versionStatus('1.18.34')).toEqual({ status: 'ok' })
    expect(versionStatus('1.19.0')).toMatchObject({ status: 'warn', detail: expect.stringMatching(/newer than the versions Dethereal was checked with/) })
    expect(versionStatus('1.18.31')).toMatchObject({ status: 'fail' })
    expect(versionStatus(null)).toMatchObject({ status: 'warn' })
  })

  it('names the flag and the reason when the installer refuses a newer OpenCode', () => {
    const v = versionGate('1.19.0')
    expect(v.install).toBe(false)
    expect(v.install ? '' : v.reason).toMatch(/--allow-unverified-opencode/)
    expect(v.install ? '' : v.reason).toMatch(/hooks OpenCode may change/)
  })

  it('tells whether OpenCode registered and loaded the plugin', () => {
    const file = '/p/.opencode/plugins/dethereal.ts'
    const url = 'file:///p/.opencode/plugins/dethereal.ts'
    expect(pluginLoadProblems({ plugin: [url] }, '', file)).toEqual([])
    expect(pluginLoadProblems({ plugin: [[url, {}]] }, '', file)).toEqual([])
    expect(pluginLoadProblems({ plugin: [] }, '', file)).toEqual(['OpenCode does not register the Dethereal plugin'])
    expect(pluginLoadProblems({ plugin: [url] }, 'ERROR failed to load plugin path=…', file)).toEqual(['OpenCode reported a plugin that failed to load or configure'])
  })

  it('reports a newer OpenCode as installed and working (a warning) in its checks', INSTALLING, async () => {
    await install()
    const checks = await checkOpenCode(ctx, { env, paths, scope: { project }, openCodeVersion: '1.19.0' })
    const v = checks.find((c) => c.label === 'OpenCode version')!
    expect(v).toMatchObject({ ok: true, status: 'warn' })
  })
})

