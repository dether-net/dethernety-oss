#!/usr/bin/env node
/**
 * Structural smoke for the OpenCode bundle, offline: no model, no credential, no network.
 *
 *   node scripts/smoke-opencode.mjs --opencode <absolute path of the pinned opencode binary> [--installed] [--keep]
 *   node scripts/smoke-opencode.mjs --opencode <bin> --project <dir> --home <dir> [--bundle <dir>]
 *
 * Run from a built package (`dist/index.js`). The binary is named explicitly and must report
 * OPENCODE_VERSION, the version this check was validated on; any other version is refused (exit 2).
 *
 * In throwaway folders (a home and every XDG folder, a git project) it generates the OpenCode bundle
 * against this package's server, installs it as the installer does (`.opencode/` and
 * `opencode.json`), and checks what OpenCode itself reports:
 *  - the Dethereal skills it lists;
 *  - the agents and commands in its resolved config, the MCP entry's timeout, the plugin file;
 *  - the MCP server connected;
 *  - every agent's permission rules as OpenCode evaluates them (the last matching rule wins);
 *  - the plugin imported with no load error, and its guard refusing a secret file through the CLI.
 * OpenCode runs no plugin hook offline, so the guard is driven by importing the installed plugin.
 *
 * With --installed, the bundle is installed by the installer's OpenCode writer from a runtime folder
 * (this package's dist and the generated bundle) into the sandbox home, as `install` does. Then:
 * the build agent's rules refuse the server's own folder, the installed plugin's guards refuse it
 * (a read through a skill folder's `..`, a write to the runtime), and an uninstall leaves none of the
 * installed files behind.
 *
 * With --project and --home, nothing is generated or installed: an existing install (by `dethereal
 * install --harness opencode`, either scope) is checked in that project and home, against the names in
 * --bundle (the package's bundles/opencode by default). The caller prepares the sandbox (the global
 * config with a model name, the pre-seeded config folders, the project's `deploy/db.yaml` Secret and
 * `src/app.ts`); this mode writes nothing there.
 *
 * Exit 0 when every check passes, 1 when one fails, 2 when it cannot run.
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The OpenCode version this smoke was validated on. */
export const OPENCODE_VERSION = '1.18.34'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CALL_TIMEOUT_MS = 120_000

// ── parsers (unit-tested) ────────────────────────────────────────────────────────────────────────

export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** JSON a debug command printed; it throws when the output is cut or is not JSON. */
export function parseJsonOutput(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${what}: the output is not complete JSON (${text.length} bytes)`)
  }
}

/** Whether `opencode --version` printed the expected version. */
export const versionMatches = (output, expected) => stripAnsi(output).trim().split(/\s+/).at(-1) === expected

/** Whether `opencode mcp list` shows the server connected. */
export const mcpConnected = (text, server) =>
  stripAnsi(text)
    .split('\n')
    .some((line) => new RegExp(`✓\\s+${server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s.*\\bconnected\\b`).test(line))

/**
 * OpenCode's wildcard: backslashes read as slashes, `*` any run and `?` one character (both across
 * `/`), a trailing " *" also matching nothing after it, anchored, case-sensitive.
 */
export function wildcard(subject, pattern) {
  const s = subject.replaceAll('\\', '/')
  let p = pattern.replaceAll('\\', '/')
  const optionalTail = p.endsWith(' *')
  if (optionalTail) p = p.slice(0, -2)
  let body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')
  if (optionalTail) body += '( .*)?'
  return new RegExp(`^${body}$`, 's').test(s)
}

/** The action OpenCode takes for a permission and pattern: the last matching rule's, else ask. */
export function lastMatch(rules, permission, pattern) {
  const hit = rules.findLast((r) => wildcard(permission, r.permission) && wildcard(pattern, r.pattern))
  return hit ? hit.action : 'ask'
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────

function args(argv) {
  const out = { keep: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep') out.keep = true
    else if (argv[i] === '--installed') out.installed = true
    else if (argv[i] === '--opencode') out.opencode = argv[++i]
    else if (argv[i] === '--project') out.project = argv[++i]
    else if (argv[i] === '--home') out.home = argv[++i]
    else if (argv[i] === '--bundle') out.bundle = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (!out.opencode || !path.isAbsolute(out.opencode)) throw new Error('--opencode <absolute path of the opencode binary> is required')
  if (!!out.project !== !!out.home) throw new Error('--project and --home go together')
  for (const k of ['project', 'home', 'bundle']) if (out[k] !== undefined && !path.isAbsolute(out[k])) throw new Error(`--${k} must be an absolute path`)
  if (out.project && out.installed) throw new Error('--installed installs into a new sandbox; --project checks an existing install')
  return out
}

/** Whether OpenCode's output names the real home, once the sandbox folders (which may sit inside it) are taken out. */
export function leaksRealHome(text, realHome, sandboxes) {
  if (realHome.length <= 1) return false
  let rest = text
  for (const s of [...sandboxes].sort((a, b) => b.length - a.length)) rest = rest.split(s).join('')
  return rest.includes(realHome)
}

/** Runs a command with its output in files (a pipe cuts OpenCode's debug output at 64 KiB). */
function run(file, argv, { cwd, env, dir }) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const outFile = path.join(dir, `${stamp}.out`)
  const errFile = path.join(dir, `${stamp}.err`)
  const out = openSync(outFile, 'w')
  const err = openSync(errFile, 'w')
  try {
    const r = spawnSync(file, argv, { cwd, env, stdio: ['ignore', out, err], timeout: CALL_TIMEOUT_MS })
    return { status: r.status, signal: r.signal, error: r.error, stdout: readFileSync(outFile, 'utf8'), stderr: readFileSync(errFile, 'utf8') }
  } finally {
    closeSync(out)
    closeSync(err)
  }
}

/** A config folder where OpenCode finds its plugin package already installed, so it fetches nothing. */
function preseed(dir) {
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'opencode-config', lockfileVersion: 3, packages: { '': { dependencies: { '@opencode-ai/plugin': '*' } } } }))
}

const names = (dir, strip = '') => (existsSync(dir) ? readdirSync(dir).map((n) => n.replace(strip, '')).sort() : [])

async function main() {
  const opt = args(process.argv.slice(2))
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  }

  const version = spawnSync(opt.opencode, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
  if (version.error || !versionMatches(version.stdout ?? '', OPENCODE_VERSION)) {
    console.error(`opencode at ${opt.opencode} reports ${JSON.stringify((version.stdout ?? '').trim())}; this smoke runs only on ${OPENCODE_VERSION}`)
    process.exit(2)
  }
  const entry = path.join(PKG, 'dist', 'index.js')
  if (!existsSync(entry)) {
    console.error('build the package first (dist/index.js is missing)')
    process.exit(2)
  }

  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dethereal-smoke-opencode-')))
  const external = !!opt.project
  const home = external ? realpathSync(opt.home) : path.join(tmp, 'home')
  const project = external ? realpathSync(opt.project) : path.join(tmp, 'project')
  const root = path.join(tmp, 'root')
  const logs = path.join(tmp, 'logs')
  const managed = path.join(tmp, 'managed')
  for (const d of external ? [logs, managed] : [home, project, logs, managed]) mkdirSync(d, { recursive: true })
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    OPENCODE_TEST_MANAGED_CONFIG_DIR: managed,
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
  }

  try {
    // The bundle, generated against this package's server, installed as the installer installs it.
    const tsx = path.join(PKG, 'node_modules', '.bin', 'tsx')
    let bundle
    if (external) bundle = opt.bundle ?? path.join(PKG, 'bundles', 'opencode')
    else {
      // Installed: the shipped form (placeholders unfilled); otherwise against this package's server.
      const serverArgs = opt.installed ? [] : ['--mcp-entry', entry, '--sandbox-home', path.join(tmp, 'server-home'), '--url', 'http://127.0.0.1:9']
      const gen = spawnSync(tsx, [path.join(PKG, 'src/generator/cli.ts'), '--harness', 'opencode', '--workflow', path.join(PKG, 'workflow'), '--out', root, ...serverArgs],
        { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      if (gen.status !== 0) throw new Error(`the generator failed: ${gen.stderr}`)
      bundle = path.join(root, 'bundles', 'opencode')
    }
    if (!existsSync(path.join(bundle, 'mcp.fragment.json'))) throw new Error(`no OpenCode bundle at ${bundle}`)
    // The install's config folder: the project's .opencode, or the user's OpenCode folder.
    const userConfig = path.join(env.XDG_CONFIG_HOME, 'opencode')
    const config = external && !existsSync(path.join(project, '.opencode', 'plugins', 'dethereal.ts')) ? userConfig : path.join(project, '.opencode')
    const fragment = JSON.parse(readFileSync(path.join(bundle, 'mcp.fragment.json'), 'utf8'))
    const writer = (command) => {
      const r = spawnSync(tsx, [path.join(tmp, 'writer.mts'), command], { cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      if (r.status !== 0) throw new Error(`the OpenCode writer failed to ${command}: ${r.stderr.slice(0, 600)}`)
      return r.stdout
    }
    if (external) {
      for (const [rel, what] of [['deploy/db.yaml', 'a content-only Secret'], ['src/app.ts', 'a plain file']]) {
        if (!existsSync(path.join(project, rel))) throw new Error(`the project needs ${rel} (${what}) before the check; this mode writes nothing there`)
      }
    } else if (opt.installed) {
      // A runtime as the installer lays it out, then the writer, as `install --harness opencode --scope project` runs it.
      const version = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')).version
      const runtimeDir = path.join(home, '.dethernety', 'runtime', version)
      cpSync(path.join(PKG, 'dist'), path.join(runtimeDir, 'dist'), { recursive: true })
      cpSync(bundle, path.join(runtimeDir, 'bundles', 'opencode'), { recursive: true })
      writeFileSync(path.join(runtimeDir, 'package.json'), '{"type":"module"}\n')
      writeFileSync(path.join(tmp, 'writer.mts'), `
import { ensureStateRoot } from ${JSON.stringify(path.join(PKG, 'src/installer/core/paths.ts'))}
import { applyOpenCode, planOpenCode, uninstallOpenCode } from ${JSON.stringify(path.join(PKG, 'src/installer/writers/opencode/index.ts'))}
const env = { home: process.env.HOME!, vars: { ...process.env }, euid: process.geteuid!(), platform: process.platform }
const { paths } = await ensureStateRoot(env)
const scope = { project: ${JSON.stringify(project)} }
if (process.argv[2] === 'install') {
  const plan = await planOpenCode({ env, paths, scope, runtime: { version: ${JSON.stringify(version)}, runtimePath: ${JSON.stringify(runtimeDir)} }, execPath: process.execPath, url: 'http://127.0.0.1:9', openCodeVersion: ${JSON.stringify(OPENCODE_VERSION)} })
  console.log(JSON.stringify((await applyOpenCode({ paths, env }, plan)).status))
} else console.log(JSON.stringify(await uninstallOpenCode({ paths, env }, { env, paths, scope })))
`)
    } else {
      for (const part of ['skills', 'agents', 'commands', 'plugins']) if (existsSync(path.join(bundle, part))) cpSync(path.join(bundle, part), path.join(config, part), { recursive: true })
      writeFileSync(path.join(project, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...fragment }, null, 2))
    }
    if (!external) {
      const globalConfig = userConfig
      mkdirSync(globalConfig, { recursive: true })
      // A model name only: listing an agent's tools needs a default model, never a call to it.
      writeFileSync(path.join(globalConfig, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'smoke/none', autoupdate: false }))
      preseed(config)
      preseed(globalConfig)
      mkdirSync(path.join(project, 'deploy'), { recursive: true })
      mkdirSync(path.join(project, 'src'), { recursive: true })
      writeFileSync(path.join(project, 'deploy', 'db.yaml'), 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\nstringData:\n  url: smoke-canary\n')
      writeFileSync(path.join(project, 'src', 'app.ts'), 'export {}\n')
      // OpenCode reads permission patterns relative to the git root: the project is one.
      const git = (...a) => spawnSync('git', a, { cwd: project, stdio: 'ignore', env: { ...env, GIT_CONFIG_NOSYSTEM: '1' } })
      git('init', '-q')
      git('-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'smoke')
    }
    if (opt.installed) check('installed by the OpenCode writer', JSON.parse(writer('install')) === 'installed')
    if (external) check('an installed plugin found', existsSync(path.join(config, 'plugins', 'dethereal.ts')), config)

    const skills = names(path.join(bundle, 'skills'))
    const agents = names(path.join(bundle, 'agents'), /\.md$/)
    const commands = names(path.join(bundle, 'commands'), /\.md$/)
    const promptTools = Object.entries(fragment.permission ?? {}).filter(([, a]) => a === 'ask').map(([k]) => k)
    const oc = (...argv) => run(opt.opencode, argv, { cwd: project, env, dir: logs })
    const realHome = os.homedir()
    const leaks = (text) => leaksRealHome(text, realHome, [tmp, home, project, path.dirname(opt.opencode)])

    // Skills.
    const sk = oc('debug', 'skill')
    const listed = parseJsonOutput(sk.stdout, 'debug skill').map((s) => s.name).filter((n) => n.startsWith('dethereal-')).sort()
    check('skills listed', JSON.stringify(listed) === JSON.stringify(skills), `${listed.length} of ${skills.length}`)
    check('no skill from the real home', !leaks(sk.stdout))

    // Agents, commands, the MCP entry and the plugin, as OpenCode resolves them.
    const cfg = parseJsonOutput(oc('debug', 'config').stdout, 'debug config')
    const missingAgents = agents.filter((a) => cfg.agent?.[a]?.mode !== 'subagent')
    check('agents loaded as subagents', missingAgents.length === 0, missingAgents.join(', '))
    const badCommands = commands.filter((c) => cfg.command?.[c]?.subtask !== true || !String(cfg.command?.[c]?.agent ?? '').startsWith('dethereal-'))
    check('commands run on their agent', badCommands.length === 0, badCommands.join(', '))
    check('MCP entry timeout', cfg.mcp?.dethereal?.timeout === 60000)
    const pluginUrl = pathToFileURL(path.join(config, 'plugins', 'dethereal.ts')).href
    check('plugin registered', (cfg.plugin ?? []).some((p) => (Array.isArray(p) ? p[0] : p) === pluginUrl), JSON.stringify(cfg.plugin ?? null))

    // The server.
    const mcp = oc('mcp', 'list')
    check('MCP server connected', mcpConnected(mcp.stdout + mcp.stderr, 'dethereal'))

    // Permissions, as OpenCode evaluates them; the plugin imported along the way.
    const loadErrors = []
    const verdicts = []
    const expect = (who, rules, permission, pattern, action) => {
      const got = lastMatch(rules, permission, pattern)
      if (got !== action) verdicts.push(`${who}: ${permission} ${pattern} is ${got}, not ${action}`)
    }
    const agentRules = (name) => {
      const r = oc('debug', 'agent', name, '--print-logs')
      if (/failed to load plugin/i.test(r.stderr)) loadErrors.push(name)
      return parseJsonOutput(r.stdout, `debug agent ${name}`)
    }
    // The agents that change attribute files and nothing else, as the generator's OpenCode target names them.
    const writersOut = spawnSync(tsx, ['-e', "import { ATTRIBUTE_WRITERS } from './src/generator/targets/opencode/index.ts'; console.log(JSON.stringify([...ATTRIBUTE_WRITERS]))"], { cwd: PKG, encoding: 'utf8' })
    if (writersOut.status !== 0) throw new Error(`reading the attribute writers failed: ${writersOut.stderr}`)
    const attributeWriters = new Set(JSON.parse(writersOut.stdout).map((n) => `dethereal-${n}`))
    for (const name of agents) {
      const a = agentRules(name)
      const rules = a.permission ?? []
      if (a.tools?.task !== undefined && a.tools.task !== false) verdicts.push(`${name}: task is offered`)
      for (const [p, pattern] of [['task', '*'], ['webfetch', '*'], ['question', '*'], ['skill', '*'], ['edit', 'opencode.json'], ['edit', '.opencode/plugins/x.ts']]) expect(name, rules, p, pattern, 'deny')
      for (const t of promptTools) expect(name, rules, t, '*', 'deny')
      // Which agents read or write comes from their own permission block; OpenCode's defaults sit before it.
      const own = cfg.agent?.[name]?.permission ?? {}
      if (own.read && typeof own.read === 'object') {
        expect(name, rules, 'read', '.env', 'deny')
        expect(name, rules, 'read', 'deploy/secrets.yaml', 'deny')
        expect(name, rules, 'read', 'src/app.ts', 'allow')
      }
      if (own.edit && typeof own.edit === 'object') {
        // An attribute writer (the enrichment applier) edits attribute files only; the others edit the model files.
        const writer = attributeWriters.has(name)
        expect(name, rules, 'edit', 'threat-models/m/attributes/c1.json', 'allow')
        expect(name, rules, 'edit', 'threat-models/m/manifest.json', writer ? 'deny' : 'allow')
        expect(name, rules, 'edit', '.dethernety/discovery-cache.json', writer ? 'deny' : 'allow')
        expect(name, rules, 'edit', 'src/app.ts', 'deny')
      }
    }
    for (const name of ['build', 'plan', 'general']) {
      const rules = agentRules(name).permission ?? []
      for (const t of promptTools) expect(name, rules, t, '*', 'ask')
    }
    const explore = agentRules('explore').permission ?? []
    for (const t of [...promptTools, 'dethereal_list_models']) expect('explore', explore, t, '*', 'deny')
    check('permission rules in effect', verdicts.length === 0, verdicts.slice(0, 8).join('; '))
    check('plugin imported without error', loadErrors.length === 0, loadErrors.join(', '))

    // The installed plugin, run as OpenCode runs it: one export, its guard through the real CLI.
    const pluginFile = path.join(config, 'plugins', 'dethereal.ts')
    const source = readFileSync(pluginFile, 'utf8')
    check('plugin: one export, placeholders filled', (source.match(/^export /gm) ?? []).length === 1 && !/<node-abs>|<runtime>/.test(source))
    const ts = createRequire(path.join(PKG, 'package.json'))('typescript')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    writeFileSync(path.join(tmp, 'plugin.mjs'), js)
    // tokens.json reached by climbing out of an installed skill folder, as a model could spell it.
    const skillDir = path.join(config, 'skills', skills[0] ?? 'dethereal-status')
    const climb = `${skillDir}/${path.relative(skillDir, path.join(home, '.dethernety', 'tokens.json'))}`
    writeFileSync(path.join(tmp, 'drive.mjs'), `
      const mod = await import(${JSON.stringify(pathToFileURL(path.join(tmp, 'plugin.mjs')).href)})
      const hooks = await Object.values(mod)[0]({ directory: ${JSON.stringify(project)} })
      const call = (tool, args) => hooks['tool.execute.before']({ tool, sessionID: 's', callID: 'c' }, { args }).then(() => null, (e) => String(e.message))
      const before = (filePath) => call('read', { filePath })
      const state = ${JSON.stringify(path.join(home, '.dethernety'))}
      console.log(JSON.stringify({
        exports: Object.keys(mod).length,
        hooks: Object.keys(hooks).sort(),
        secret: await before('deploy/db.yaml'),
        secretAbs: await before(${JSON.stringify(path.join(project, 'deploy', 'db.yaml'))}),
        plain: await before('src/app.ts'),
        stateRead: await before(${JSON.stringify(climb)}),
        stateBash: await call('bash', { command: 'cat $HOME/.dethernety/tokens.json' }),
        stateWrite: await call('write', { filePath: state + '/runtime/current.json', content: '{}' }),
      }))`)
    const drive = run(process.execPath, [path.join(tmp, 'drive.mjs')], { cwd: project, env, dir: logs })
    let d = {}
    try {
      d = JSON.parse(drive.stdout)
    } catch {
      d = {}
    }
    check('plugin hooks', d.exports === 1 && JSON.stringify(d.hooks) === JSON.stringify(['config', 'experimental.session.compacting', 'tool.execute.after', 'tool.execute.before']))
    // The guard names the file from the project root, which is the git root when the project sits below it.
    check('plugin guard refuses a secret file', /^dethereal-secret-guard: (?:[^\s/]+\/)*deploy\/db\.yaml is a secret file/.test(d.secret ?? '') && /^dethereal-secret-guard: /.test(d.secretAbs ?? '') && !String(d.secret).includes('smoke-canary'), d.secret ?? drive.stderr.slice(0, 200))
    check('plugin guard lets a plain file be read', d.plain === null, String(d.plain))

    if (opt.installed || external) {
      // The server's own folder, from the installed plugin's guards and from OpenCode's own rules.
      const denied = (v) => typeof v === 'string' && /^dethereal-secret-guard: |^Dethereal: /.test(v)
      check("plugin guard refuses the server folder: a read through a skill folder's ..", denied(d.stateRead), String(d.stateRead))
      check('plugin guard refuses the server folder: a shell command', denied(d.stateBash), String(d.stateBash))
      check('plugin guard refuses the server folder: a write to the runtime', denied(d.stateWrite), String(d.stateWrite))
      const build = (agentRules('build').permission ?? []).map((r) => ({ ...r, pattern: r.pattern.replace(/^~(?=\/|$)/, home) }))
      const requests = ['tokens.json', 'runtime/current.json', 'runtime/x/dist/index.js'].map((f) => `${path.dirname(path.join(home, '.dethernety', f))}/*`)
      const open = requests.filter((r) => lastMatch(build, 'external_directory', r) !== 'deny')
      check("OpenCode's build agent refuses the server folder", open.length === 0, open.join(', '))
    }
    if (opt.installed) {
      const outcomes = JSON.parse(writer('uninstall'))
      const left = ['.opencode/plugins/dethereal.ts', 'opencode.json', '.opencode/agents', '.opencode/commands', '.opencode/skills']
        .filter((rel) => existsSync(path.join(project, rel)) && (rel.endsWith('.ts') || rel.endsWith('.json') || readdirSync(path.join(project, rel)).some((n) => n.startsWith('dethereal'))))
      check('uninstall leaves none of the installed files', left.length === 0 && outcomes.every((o) => ['deleted', 'restored', 'unmerged'].includes(o.outcome)), left.join(', '))
    }
  } finally {
    if (opt.keep) console.log(`kept: ${tmp}`)
    else rmSync(tmp, { recursive: true, force: true })
  }
  const failed = results.filter((ok) => !ok).length
  console.log(failed ? `smoke-opencode: ${failed} check(s) failed` : `smoke-opencode: all ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`smoke-opencode: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  })
}
