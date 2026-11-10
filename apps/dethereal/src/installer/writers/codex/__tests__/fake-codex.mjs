// A stand-in for the `codex` CLI (0.157 `--json` shapes), keeping its state in CODEX_HOME/config.toml
// as text, the way Codex does: its own tables go in before a trailing managed-block end line, as
// Codex's editor put them in the real run. `control.json` beside this file sets the version and
// a command to fail; every call is logged to `log.jsonl` there.
/* global process */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const control = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'control.json'), 'utf8'))
  } catch {
    return {}
  }
})()
const argv = process.argv.slice(2)
fs.appendFileSync(path.join(here, 'log.jsonl'), JSON.stringify(argv) + '\n')
const words = argv.filter((a) => !a.startsWith('--'))
const cmd = words.slice(0, words[1] === 'marketplace' ? 3 : 2).join(' ')
const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n')
const fail = (msg) => {
  fs.appendFileSync(path.join(here, 'errors.log'), `${cmd}: ${msg}\n`)
  process.stderr.write(`Error: ${msg}\n`)
  process.exit(1)
}

if (argv[0] === '--version') {
  process.stdout.write(`codex-cli ${control.version ?? '0.157.0'}\n`)
  process.exit(0)
}
for (const f of control.fail ?? []) {
  if (!cmd.startsWith(f)) continue
  if (control.once) fs.writeFileSync(path.join(here, 'control.json'), JSON.stringify({ ...control, fail: control.fail.filter((x) => x !== f) }))
  fail(`injected failure: ${f}`)
}

const home = process.env.CODEX_HOME || path.join(process.env.HOME, '.codex')
const cfgPath = path.join(home, 'config.toml')
const read = () => (fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '')
const END = '# <<< dethereal managed <<<'

/** The text of one table (header to the next header), or null. */
function tableSpan(text, header) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === header)
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end]) && lines[end].trim() !== END) end++
  // Comment lines right above the next header stay with it, as Codex's TOML editor keeps them.
  if (end < lines.length) while (end - 1 > start && /^\s*#/.test(lines[end - 1])) end--
  return { lines, start, end }
}
function removeTable(header) {
  const s = tableSpan(read(), header)
  if (!s) return
  s.lines.splice(s.start, s.end - s.start)
  fs.writeFileSync(cfgPath, s.lines.join('\n').replace(/\n{3,}/g, '\n\n'))
}
function addTable(header, body) {
  let text = read()
  const block = `${header}\n${body}\n`
  const trimmed = text.replace(/\n+$/, '')
  if (trimmed.endsWith(END)) text = trimmed.slice(0, -END.length) + block + END + '\n'
  else text = (text && !text.endsWith('\n') ? text + '\n' : text) + (text ? '\n' : '') + block
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(cfgPath, text)
}
function marketplace() {
  const s = tableSpan(read(), '[marketplaces.dethereal-local]')
  if (!s) return null
  const src = s.lines.slice(s.start, s.end).map((l) => /^source = "(.*)"$/.exec(l.trim())).find(Boolean)
  return src ? src[1] : null
}
const sourceOk = (src) => fs.existsSync(path.join(src, '.agents', 'plugins', 'marketplace.json'))
const installed = () => !!tableSpan(read(), '[plugins."dethereal@dethereal-local"]')

/** Codex's layered view of the MCP servers from the current folder: the user config, then every trusted project layer, merged key by key. */
async function mcpList() {
  const { parse } = await import('smol-toml')
  const load = (f) => (fs.existsSync(f) ? parse(fs.readFileSync(f, 'utf8')) : {})
  const user = load(cfgPath)
  // Codex's rule: layers from the project root (the nearest folder holding .git, else the cwd) down to
  // the cwd; each trusted by its own setting, else by the project root's.
  const levels = new Map(Object.entries(user.projects ?? {}).map(([k, v]) => [k, v.trust_level]))
  const cwd = fs.realpathSync(process.cwd())
  let root = cwd
  for (let d = cwd; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) {
      root = d
      break
    }
    if (path.dirname(d) === d) break
  }
  const dirs = []
  for (let d = cwd; ; d = path.dirname(d)) {
    dirs.unshift(d)
    if (d === root || path.dirname(d) === d) break
  }
  const trusted = (d) => (levels.has(d) ? levels.get(d) : levels.get(root)) === 'trusted'
  const merge = (a, b) => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v
    return out
  }
  let servers = user.mcp_servers ?? {}
  for (const d of dirs) {
    if (!trusted(d)) continue
    servers = merge(servers, load(path.join(d, '.codex', 'config.toml')).mcp_servers ?? {})
  }
  return Object.entries(servers).map(([name, s]) => ({
    name, enabled: s.enabled !== false, disabled_reason: null,
    transport: { type: 'stdio', command: s.command ?? null, args: s.args ?? [], env: s.env ?? null, env_vars: s.env_vars ?? [], cwd: s.cwd ?? null },
    startup_timeout_sec: s.startup_timeout_sec ?? null, tool_timeout_sec: s.tool_timeout_sec ?? null, auth_status: 'unsupported',
  }))
}

switch (cmd) {
  case 'mcp list':
    out(await mcpList())
    break
  case 'plugin marketplace list': {
    const src = marketplace()
    if (src && !sourceOk(src)) fail('failed to load marketplace(s)')
    out({ marketplaces: src ? [{ name: 'dethereal-local', root: src, marketplaceSource: { sourceType: 'local', source: src } }] : [] })
    break
  }
  case 'plugin list': {
    const src = marketplace()
    if (src && !sourceOk(src)) fail('failed to load configured marketplace snapshot(s)')
    const list = installed() ? [{ pluginId: 'dethereal@dethereal-local', name: 'dethereal', marketplaceName: 'dethereal-local', version: control.pluginVersion ?? '0.0.0', installed: true, enabled: true }] : []
    out({ installed: [...list, ...(control.otherPlugins ?? [])], available: [] })
    break
  }
  case 'plugin marketplace add': {
    const dir = argv[argv.length - 1]
    const cur = marketplace()
    if (cur && cur !== dir) fail("marketplace 'dethereal-local' is already added from a different source; remove it before adding this source")
    if (!sourceOk(dir)) fail('marketplace root does not contain a supported manifest')
    if (!cur) addTable('[marketplaces.dethereal-local]', `source_type = "local"\nsource = "${dir}"`)
    out({ marketplaceName: 'dethereal-local', installedRoot: dir, alreadyAdded: !!cur })
    break
  }
  case 'plugin marketplace remove':
    removeTable('[marketplaces.dethereal-local]')
    out({ marketplaceName: 'dethereal-local', installedRoot: null })
    break
  case 'plugin add': {
    const src = marketplace()
    if (!src || !sourceOk(src)) fail('marketplace not found')
    const version = JSON.parse(fs.readFileSync(path.join(src, 'plugins', 'dethereal', '.codex-plugin', 'plugin.json'), 'utf8')).version
    if (!installed()) addTable('[plugins."dethereal@dethereal-local"]', 'enabled = true')
    out({ pluginId: 'dethereal@dethereal-local', name: 'dethereal', marketplaceName: 'dethereal-local', version, installedPath: path.join(home, 'plugins', 'cache', 'dethereal-local', 'dethereal', version) })
    break
  }
  case 'plugin remove':
    removeTable('[plugins."dethereal@dethereal-local"]')
    out({ pluginId: 'dethereal@dethereal-local', name: 'dethereal', marketplaceName: 'dethereal-local' })
    break
  default:
    fail(`unknown command: ${cmd}`)
}
