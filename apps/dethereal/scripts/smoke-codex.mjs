#!/usr/bin/env node
/* global process, console, setTimeout, clearTimeout */
/**
 * Codex structural smoke: installs the generated Codex bundle into a throwaway HOME and
 * CODEX_HOME the way the installer will — the plugin through the local marketplace, the server
 * entry from the config fragment, the agent files — with this checkout's server build, then checks
 * what Codex loads. Offline: the server points at a closed port and no credential is used.
 *
 *   node scripts/smoke-codex.mjs [--codex <codex binary>] [--work <empty dir outside the repo>] [--keep]
 *
 * Run `pnpm build` first. Prints a JSON summary; exits 1 when a check fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseToml } from 'smol-toml'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BLACKHOLE = 'http://127.0.0.1:9'
const MARKETPLACE = 'dethereal-local'

function args(argv) {
  const out = { codex: 'codex', work: undefined, keep: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--codex') out.codex = argv[++i]
    else if (argv[i] === '--work') out.work = argv[++i]
    else if (argv[i] === '--keep') out.keep = true
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  return out
}

function run(cmd, cmdArgs, opts) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 120_000, ...opts })
  if (r.error) throw r.error
  return r
}

/** The tool manifest, read through tsx: every tool name and the auto-approved ones. */
function manifest() {
  const tsx = path.join(PKG, 'node_modules', '.bin', 'tsx')
  // `served`: what the server lists with the settlement off, as the bundle ships it (no DETHEREAL_SETTLEMENT).
  const r = run(tsx, ['-e', "import { TOOL_MANIFEST } from './src/tools/manifest.ts'; import { shippedToolNames } from './src/utils/settlement-switch.ts'; console.log(JSON.stringify({ served: shippedToolNames(), auto: TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name) }))"], { cwd: PKG })
  if (r.status !== 0) throw new Error(`reading the tool manifest failed: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

/** The `dethereal:` skills `codex debug prompt-input` lists, each with its own SKILL.md. */
export function listedSkills(stdout) {
  const listed = new Set()
  const texts = []
  const walk = (v) => {
    if (typeof v === 'string') texts.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  try {
    walk(JSON.parse(stdout))
  } catch {
    return listed
  }
  for (const line of texts.join('\n').split('\n')) {
    // "- dethereal:<skill>: <description> (file: <root alias>/<skill>/SKILL.md)"
    const m = /^- dethereal:([a-z0-9-]+): .*\(file: (?:.+\/)?([a-z0-9-]+)\/SKILL\.md\)$/.exec(line.trim())
    if (m && m[1] === m[2]) listed.add(m[1])
  }
  return listed
}

/** An MCP initialize + tools/list over stdio with the configured command; resolves to the tool names. */
function handshake(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry.command, entry.args ?? [], { env: { PATH: process.env.PATH, ...(entry.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('no tools/list answer within 30 s'))
    }, 30_000)
    child.on('error', reject)
    child.stdout.on('data', (d) => {
      buf += d
      for (const line of buf.split('\n').slice(0, -1)) {
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
        }
        if (msg.id === 2) {
          clearTimeout(timer)
          child.kill()
          resolve((msg.result?.tools ?? []).map((t) => t.name))
        }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1)
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-codex', version: '1' } } }) + '\n')
  })
}

async function main() {
  const opt = args(process.argv.slice(2))
  const entry = path.join(PKG, 'dist', 'index.js')
  if (!existsSync(entry)) throw new Error('dist/index.js is missing: run pnpm build first')
  const work = opt.work ? path.resolve(opt.work) : mkdtempSync(path.join(tmpdir(), 'smoke-codex-'))
  if (opt.work) {
    mkdirSync(work, { recursive: true })
    if (readdirSync(work).length > 0) throw new Error(`${work} is not empty`)
  }
  const root = path.join(work, 'root')
  const sbx = path.join(work, 'sbx')
  const codexHome = path.join(sbx, '.codex')
  const project = path.join(work, 'project')
  for (const d of [codexHome, project, path.join(work, 'server-home')]) mkdirSync(d, { recursive: true })
  const env = {
    PATH: process.env.PATH,
    HOME: sbx,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(sbx, '.config'),
    XDG_DATA_HOME: path.join(sbx, '.local', 'share'),
    XDG_CACHE_HOME: path.join(sbx, '.cache'),
    XDG_STATE_HOME: path.join(sbx, '.local', 'state'),
  }
  const checks = []
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) })

  try {
    // The bundle, with this checkout's server build, its HOME a sandbox and its platform a closed port.
    const tsx = path.join(PKG, 'node_modules', '.bin', 'tsx')
    const gen = run(tsx, ['src/generator/cli.ts', '--harness', 'codex', '--workflow', 'workflow', '--out', root, '--mcp-entry', entry, '--sandbox-home', path.join(work, 'server-home'), '--url', BLACKHOLE], { cwd: PKG })
    if (gen.status !== 0) throw new Error(`generating the Codex bundle failed: ${gen.stderr}`)
    const bundle = path.join(root, 'bundles', 'codex')

    // Install as the installer will: the marketplace and the plugin, the fragment, the agents.
    const mkt = run(opt.codex, ['plugin', 'marketplace', 'add', bundle], { env, cwd: project })
    check('marketplace add', mkt.status === 0, mkt.status === 0 ? undefined : mkt.stderr.trim())
    const add = run(opt.codex, ['plugin', 'add', `dethereal@${MARKETPLACE}`], { env, cwd: project })
    check('plugin add', add.status === 0, add.status === 0 ? undefined : add.stderr.trim())
    const pluginRoot = /Installed plugin root: (.+)/.exec(add.stdout)?.[1]?.trim()
    // The fragment joins whatever `plugin add` recorded, as the installer's merge does.
    const configPath = path.join(codexHome, 'config.toml')
    const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
    writeFileSync(configPath, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}\n${readFileSync(path.join(bundle, 'config.fragment.toml'), 'utf8')}`)
    mkdirSync(path.join(codexHome, 'agents'), { recursive: true })
    const agentFiles = readdirSync(path.join(bundle, 'agents')).filter((f) => f.endsWith('.toml'))
    for (const f of agentFiles) copyFileSync(path.join(bundle, 'agents', f), path.join(codexHome, 'agents', f))

    // Skills: every generated skill is listed under its namespaced name, with its file.
    const skillNames = readdirSync(path.join(bundle, 'plugins', 'dethereal', 'skills')).sort()
    const prompt = run(opt.codex, ['debug', 'prompt-input'], { env, cwd: project })
    const listed = listedSkills(prompt.stdout)
    const missingSkills = skillNames.filter((s) => !listed.has(s))
    check(`skills listed (${skillNames.length})`, prompt.status === 0 && missingSkills.length === 0, missingSkills.length ? { missing: missingSkills } : undefined)

    // The server: configured as the fragment says, and it answers with exactly the tools it serves with the
    // settlement off, as shipped (the settle tool is listed only with the settlement on).
    const config = parseToml(readFileSync(path.join(codexHome, 'config.toml'), 'utf8'))
    const server = config.mcp_servers?.dethereal
    const list = run(opt.codex, ['mcp', 'list'], { env, cwd: project })
    check('mcp list shows dethereal', list.status === 0 && /^dethereal\s/m.test(list.stdout))
    const { served, auto } = manifest()
    try {
      const tools = await handshake(server)
      const missingTools = served.filter((t) => !tools.includes(t))
      const extraTools = tools.filter((t) => !served.includes(t))
      const off = missingTools.length === 0 && extraTools.length === 0
      check(`server handshake (${served.length} tools)`, off, off ? undefined : { missing: missingTools, extra: extraTools })
    } catch (err) {
      check('server handshake', false, String(err.message ?? err))
    }

    // Approvals: prompt by default, approve exactly the manifest's auto-approved tools.
    const approved = Object.entries(server?.tools ?? {}).filter(([, v]) => v?.approval_mode === 'approve').map(([k]) => k).sort()
    check('approvals', server?.default_tools_approval_mode === 'prompt' && JSON.stringify(approved) === JSON.stringify([...auto].sort()), { approved: approved.length, auto: auto.length })

    // Agents: every role file parses with the keys Codex reads.
    const badAgents = []
    for (const f of agentFiles) {
      try {
        const a = parseToml(readFileSync(path.join(codexHome, 'agents', f), 'utf8'))
        const ok = ['name', 'description', 'developer_instructions', 'model_reasoning_effort'].every((k) => typeof a[k] === 'string' && a[k].trim()) && ['read-only', 'workspace-write'].includes(a.sandbox_mode)
        if (!ok) badAgents.push(f)
      } catch {
        badAgents.push(f)
      }
    }
    check(`agents load (${agentFiles.length})`, agentFiles.length > 0 && badAgents.length === 0, badAgents.length ? { bad: badAgents } : undefined)

    // Hooks: the installed plugin carries hooks.json, and every script its commands name.
    if (!pluginRoot) check('hooks installed', false, 'no plugin root reported')
    else {
      const hooksPath = path.join(pluginRoot, 'hooks', 'hooks.json')
      const hooks = existsSync(hooksPath) ? JSON.parse(readFileSync(hooksPath, 'utf8')).hooks : undefined
      const commandsOf = (file) => Object.values(JSON.parse(readFileSync(file, 'utf8')).hooks).flat().flatMap((g) => g.hooks.map((h) => h.command))
      const commands = hooks ? commandsOf(hooksPath) : []
      // the installed hooks are exactly the generated ones
      const generated = commandsOf(path.join(bundle, 'plugins', 'dethereal', 'hooks', 'hooks.json'))
      const scripts = [...new Set(commands.map((c) => /\$\{PLUGIN_ROOT\}\/([^"]+)"/.exec(c)?.[1]).filter(Boolean))]
      const missingScripts = scripts.filter((s) => !existsSync(path.join(pluginRoot, s)))
      check(`hooks installed (${commands.length})`, commands.length > 0 && JSON.stringify(commands) === JSON.stringify(generated) && scripts.length > 0 && missingScripts.length === 0, missingScripts.length ? { missing: missingScripts } : undefined)
    }
  } finally {
    const failed = checks.filter((c) => !c.pass)
    let codex
    try {
      codex = run(opt.codex, ['--version'], { env }).stdout.trim()
    } catch (err) {
      codex = `not runnable: ${err.message ?? err}`
    }
    console.log(JSON.stringify({ codex, work: opt.keep ? work : undefined, checks, pass: failed.length === 0 && checks.length > 0 }, null, 2))
    if (!opt.keep) rmSync(work, { recursive: true, force: true })
    process.exitCode = failed.length === 0 && checks.length > 0 ? 0 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`smoke-codex: ${err.message ?? err}`)
    process.exitCode = 1
  })
}
