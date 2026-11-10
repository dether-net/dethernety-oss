/**
 * A fake `claude` CLI for the writer's tests: the `plugin` commands the writer
 * runs, with the answers, the settings writes and the state Claude Code 2.1.287
 * showed when probed (marketplaces, plugins per scope, `pluginConfigs`,
 * `enabledPlugins`, a directory plugin loaded in place, an npm plugin copied to
 * the cache). Its state and a control file live under the HOME it is given:
 * `$HOME/fake-claude/{state,control}.json`; it logs every call to
 * `$HOME/fake-claude/calls.jsonl`.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface FakeControl {
  /** What `--version` prints. */
  version?: string
  /** The github marketplace's catalog: the version its npm entry serves, and where each version's package lies. */
  npmLatest?: string
  npmPackages?: Record<string, string>
  /** Answer `marketplace add` with this name instead of the real one. */
  addName?: string
  /** Report `configApplied: false` on install. */
  configNotApplied?: boolean
  /** Install without writing `enabledPlugins` into the settings (the list still says enabled). */
  skipEnabledSettings?: boolean
  /** Commands (`plugin install`, `plugin marketplace add`, …) that exit 1, or print broken JSON. */
  fail?: Record<string, 'exit' | 'badjson'>
  /** What an `exit` failure writes to stderr (default `failed`). */
  stderr?: string
}

export interface FakeState {
  marketplaces: Record<string, { source: 'github'; repo: string } | { source: 'directory'; path: string }>
  plugins: Array<{ id: string; scope: 'user' | 'project' | 'local'; projectPath?: string; version: string; enabled: boolean; installPath: string }>
}

const SOURCE = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const home = process.env.HOME
const dir = path.join(home, 'fake-claude')
fs.mkdirSync(dir, { recursive: true })
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const control = read(path.join(dir, 'control.json'), {})
const state = read(path.join(dir, 'state.json'), { marketplaces: {}, plugins: [] })
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\n')
const save = () => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2))
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
const userSettingsFile = path.join(configDir, 'settings.json')
const projectSettingsFile = path.join(process.cwd(), '.claude', 'settings.json')
const editSettings = (file, fn) => { const s = read(file, {}); fn(s); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2)) }
const out = (o) => { process.stdout.write(JSON.stringify(o)) }
const key = args.filter((a) => !a.startsWith('-')).slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
const failure = (control.fail || {})[key]
if (failure === 'exit') { process.stderr.write((control.stderr || 'failed') + '\n'); process.exit(1) }
if (failure === 'badjson') { process.stdout.write('{not json'); process.exit(0) }
const opt = (name) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
const configs = []
args.forEach((a, i) => { if (a === '--config') configs.push(args[i + 1]) })
const realCwd = fs.realpathSync(process.cwd())

if (args[0] === '--version') { process.stdout.write((control.version || '2.1.287') + ' (Claude Code)\n'); process.exit(0) }
if (args[0] !== 'plugin') process.exit(2)

const catalog = (mkt) => {
  const m = state.marketplaces[mkt]
  if (!m) return null
  if (m.source === 'directory') {
    const j = read(path.join(m.path, '.claude-plugin', 'marketplace.json'), null)
    const p = j && j.plugins[0]
    if (!p) return null
    if (typeof p.source === 'string') {
      const root = path.resolve(m.path, p.source)
      return { version: read(path.join(root, '.claude-plugin', 'plugin.json'), {}).version, installPath: root }
    }
    return { version: p.source.version, npm: true }
  }
  return { version: control.npmLatest, npm: true }
}
const placeNpm = (mkt, version) => {
  const target = path.join(configDir, 'plugins', 'cache', mkt, 'dethereal', version)
  const from = (control.npmPackages || {})[version]
  if (from) fs.cpSync(from, target, { recursive: true })
  return target
}
const at = (id, scope) => state.plugins.find((p) => p.id === id && p.scope === scope && (scope === 'user' || p.projectPath === realCwd))

if (args[1] === 'marketplace') {
  const sub = args[2]
  if (sub === 'list') { out(Object.entries(state.marketplaces).map(([name, m]) => ({ name, ...m, installLocation: m.path || path.join(configDir, 'plugins', 'marketplaces', name) }))); process.exit(0) }
  if (sub === 'add') {
    const src = args[3]
    let name, m
    if (path.isAbsolute(src)) { name = read(path.join(src, '.claude-plugin', 'marketplace.json'), {}).name; m = { source: 'directory', path: src } }
    else { name = 'dether.net'; m = { source: 'github', repo: src } }
    const existed = !!state.marketplaces[name]
    state.marketplaces[name] = m; save()
    editSettings(userSettingsFile, (s) => { s.extraKnownMarketplaces = { ...(s.extraKnownMarketplaces || {}), [name]: { source: m.source === 'directory' ? { source: 'directory', path: m.path } : { source: 'github', repo: m.repo } } } })
    out({ command: 'marketplace-add', outcome: 'ok', marketplace: control.addName || name, message: existed ? 'already on disk' : 'Successfully added' }); process.exit(0)
  }
  if (sub === 'update') { out({ command: 'marketplace-update', outcome: 'ok', marketplace: args[3] }); process.exit(0) }
  if (sub === 'remove') {
    delete state.marketplaces[args[3]]; save()
    editSettings(userSettingsFile, (s) => { if (s.extraKnownMarketplaces) delete s.extraKnownMarketplaces[args[3]] })
    out({ command: 'marketplace-remove', outcome: 'ok', marketplace: args[3] }); process.exit(0)
  }
  process.exit(2)
}

const sub = args[1]
if (sub === 'list') { out(state.plugins.map((p) => ({ ...p, ...(p.projectPath ? {} : {}) }))); process.exit(0) }
const id = args[2]
const scope = opt('scope') || 'user'
const mkt = id.split('@')[1]
const applyConfig = () => {
  if (configs.length === 0) return undefined
  if (control.configNotApplied) return false
  const kv = configs[configs.length - 1]
  const eq = kv.indexOf('=')
  if (kv.slice(0, eq) !== 'platform_url') return false
  editSettings(userSettingsFile, (s) => { s.pluginConfigs = { ...(s.pluginConfigs || {}), [id]: { options: { platform_url: kv.slice(eq + 1) } } } })
  return true
}
const enabledFile = scope === 'user' ? userSettingsFile : projectSettingsFile
if (sub === 'install') {
  const existing = at(id, scope)
  if (existing) { const c = applyConfig(); out({ command: 'install', outcome: 'ok', plugin: id, message: 'already installed', ...(c === undefined ? {} : { configApplied: c }), installedVersion: existing.version, availableVersion: existing.version }); process.exit(0) }
  const c0 = catalog(mkt)
  if (!c0) { out({ command: 'install', outcome: 'error', message: 'not found' }); process.exit(1) }
  const installPath = c0.npm ? placeNpm(mkt, c0.version) : c0.installPath
  state.plugins.push({ id, scope, ...(scope === 'project' ? { projectPath: realCwd } : {}), version: c0.version, enabled: true, installPath }); save()
  if (!control.skipEnabledSettings) editSettings(enabledFile, (s) => { s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: true } })
  const c = applyConfig()
  out({ command: 'install', outcome: 'ok', plugin: id, scope, ...(c === undefined ? {} : { configApplied: c }) }); process.exit(0)
}
const p = at(id, scope)
if (!p) { out({ command: sub, outcome: 'error', message: 'not installed' }); process.exit(1) }
if (sub === 'update') {
  const c0 = catalog(mkt)
  const from = p.version
  if (c0.version !== p.version) { p.version = c0.version; if (c0.npm) p.installPath = placeNpm(mkt, c0.version) }
  save()
  out({ command: 'update', outcome: 'ok', plugin: id, updateOutcome: from === p.version ? 'up_to_date' : 'updated', oldVersion: from, newVersion: p.version }); process.exit(0)
}
if (sub === 'uninstall') {
  state.plugins.splice(state.plugins.indexOf(p), 1); save()
  editSettings(enabledFile, (s) => { if (s.enabledPlugins) delete s.enabledPlugins[id] })
  if (!state.plugins.some((q) => q.id === id)) editSettings(userSettingsFile, (s) => { if (s.pluginConfigs) delete s.pluginConfigs[id] })
  out({ command: 'uninstall', outcome: 'ok', plugin: id, keptData: false }); process.exit(0)
}
if (sub === 'disable' || sub === 'enable') {
  p.enabled = sub === 'enable'; save()
  editSettings(enabledFile, (s) => { s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: p.enabled } })
  out({ command: sub, outcome: 'ok', plugin: id }); process.exit(0)
}
process.exit(2)
`

/** Put the fake on `binDir` as `claude`. */
export async function installFakeClaude(binDir: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true })
  await fs.writeFile(path.join(binDir, 'claude.cjs'), SOURCE)
  await fs.writeFile(path.join(binDir, 'claude'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(binDir, 'claude.cjs'))} "$@"\n`, { mode: 0o755 })
}

export async function setControl(home: string, control: FakeControl): Promise<void> {
  await fs.mkdir(path.join(home, 'fake-claude'), { recursive: true })
  await fs.writeFile(path.join(home, 'fake-claude', 'control.json'), JSON.stringify(control))
}

export async function setState(home: string, state: FakeState): Promise<void> {
  await fs.mkdir(path.join(home, 'fake-claude'), { recursive: true })
  await fs.writeFile(path.join(home, 'fake-claude', 'state.json'), JSON.stringify(state))
}

export async function fakeState(home: string): Promise<FakeState> {
  return JSON.parse(await fs.readFile(path.join(home, 'fake-claude', 'state.json'), 'utf8').catch(() => '{"marketplaces":{},"plugins":[]}')) as FakeState
}

export async function fakeCalls(home: string): Promise<Array<{ args: string[]; cwd: string }>> {
  const text = await fs.readFile(path.join(home, 'fake-claude', 'calls.jsonl'), 'utf8').catch(() => '')
  return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[]; cwd: string })
}
