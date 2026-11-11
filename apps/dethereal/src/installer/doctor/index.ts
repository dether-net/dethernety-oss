/**
 * `dethereal doctor`: what is installed, checked the way each harness will use
 * it. It writes nothing (the opt-in live OpenCode check runs OpenCode itself, and
 * says so).
 *
 * The server probe never runs a harness's configuration. The launch is built from
 * the installer's own verified state (the runtime's checked node and entry file,
 * or Claude's hash-checked plugin copy, with a fixed environment), and the
 * harness's configuration is compared with it: a configuration that differs is
 * reported and not started. Doctor reports key paths, never configuration values,
 * and never a credential: the session shows only as signed in, and as whom.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { isDeepStrictEqual } from 'node:util'
import { TOOL_MANIFEST, manifestToolNames } from '../../tools/manifest.js'
import { SETTLEMENT_ONLY_TOOLS } from '../../utils/settlement-switch.js'
import { harnessPath, resolveHarnessCli, runHarnessCli, type HarnessCliOptions } from '../core/harness-cli.js'
import { NEUTRAL_DIR } from '../../utils/git.js'
import { type InstallEntry, type Manifest, readManifest } from '../core/manifest.js'
import { tomlTreeDiff } from '../core/merge-toml.js'
import type { InstallerEnv } from '../core/paths.js'
import { checkExecPath, NODE_FLOOR, nodeAtLeast, readCurrentRuntime } from '../core/runtime.js'
import { nodeVersion, type ProbeLaunch, type ProbeResult, probeServer } from '../core/server-probe.js'
import type { TxContext } from '../core/transaction.js'
import {
  checkProject, claudeDir, claudePlugins, configuredUrl, normalisePlatformUrl, packageVersion, readSettings, shippedHash, userSettingsFile,
  CLAUDE_FLOOR, claudeCliVersion, claudeFloorMessage, olderThanFloor,
} from '../writers/claude/index.js'
import { codexAppServerVersions, codexHookTrust, renderFragment, readConfig, SERVER_TABLE } from '../writers/codex/config.js'
import { codexVersion, listMcpServers, listPlugins } from '../writers/codex/cli.js'
import { checkOpenCode, effectiveRuleProblems, pluginLoadProblems } from '../writers/opencode/index.js'
import type { Rule } from '../writers/opencode/rules.js'
import { canonical, within } from '../../utils/project-root.js'

export type DoctorHarness = 'claude' | 'codex' | 'opencode'

export interface DoctorCheck {
  /** `runtime` for the shared runtime; otherwise the harness and scope of an installed entry. */
  subject: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail?: string
  fix?: string
}

export interface DoctorInput {
  ctx: TxContext
  /** False when there is no state folder: nothing was ever installed, and doctor creates none. */
  stateExists?: boolean
  /** State files others can read (the folder, a session store), as `inspectStateRoot` found them. */
  looseState?: readonly string[]
  packageRoot: string
  harnesses: readonly DoctorHarness[]
  /** Only this project's entries (plus the user's) are probed; other recorded projects get static checks. */
  project?: string
  liveOpenCode?: boolean
  probe?: typeof probeServer
  openCodeVersion: (env: InstallerEnv, projectRoot?: string) => Promise<string | null>
  /** `opencode mcp list` as OpenCode prints it, `missing` when OpenCode is not found, null when it failed. */
  openCodeMcpList?: (env: InstallerEnv, cwd: string, projectRoot?: string) => Promise<string | 'missing' | null>
}

/** Text from files or processes, safe to show: printable ASCII, capped. */
export const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'] as const
const PATH_PROXY_VARS = new Set(['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])

/**
 * The fixed environment a probed server gets: this shell's DETHERNETY_URL when the harness lets it through to its
 * server, then the harness's own URL variable over it, as the harness lays its entry over its environment.
 */
function probeEnv(env: InstallerEnv, urlVar: 'DETHERNETY_URL' | 'DETHERNETY_PLATFORM_URL', url: string | null, project: string | undefined, shellPasses: boolean): Record<string, string> {
  const out: Record<string, string> = { HOME: env.home, PATH: harnessPath(project).join(path.delimiter) }
  const shell = shellUrl(env)
  if (shell && shellPasses) out.DETHERNETY_URL = shell
  if (url) out[urlVar] = url
  for (const k of PROXY_VARS) {
    const v = env.vars[k]
    if (v !== undefined && (!PATH_PROXY_VARS.has(k) || path.isAbsolute(v))) out[k] = v
  }
  return out
}

/** A DETHERNETY_URL in the shell doctor runs in, which a harness started from it hands to its server where it lets it through. */
const shellUrl = (env: InstallerEnv): string | null => env.vars.DETHERNETY_URL?.trim() || null

/**
 * The URL a Codex or OpenCode entry records, as its only variable: a default (`DETHERNETY_PLATFORM_URL`), which a
 * shell DETHERNETY_URL overrides, or, from an earlier Dethereal, a fixed `DETHERNETY_URL`, which overrides the shell.
 */
function recordedUrl(vars: unknown): { shape: 'default' | 'fixed'; url: string; normal: string | null } | null {
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return null
  const keys = Object.keys(vars)
  const url = keys.length === 1 ? (vars as Record<string, unknown>)[keys[0]!] : undefined
  if (typeof url !== 'string') return null
  const shape = keys[0] === 'DETHERNETY_PLATFORM_URL' ? 'default' : keys[0] === 'DETHERNETY_URL' ? 'fixed' : null
  if (!shape) return null
  return { shape, url, normal: (() => { try { return normalisePlatformUrl(url) } catch { return null } })() }
}

const FIXED_URL = 'installed by an earlier Dethereal: the install URL overrides a shell DETHERNETY_URL; re-run install to update'

/** Where the URL comes from, in words: the install's, or this shell's DETHERNETY_URL over it. */
function urlCheck(subject: string, installUrl: string, fixed: boolean, env: InstallerEnv, shellPasses: boolean): DoctorCheck {
  const shell = shellUrl(env)
  if (fixed) return { subject, label: 'platform URL', status: 'ok', detail: `${installUrl}, fixed by the install (a shell DETHERNETY_URL does not override it)` }
  if (shell && shellPasses) {
    return { subject, label: 'platform URL', status: 'warn', detail: `this shell's DETHERNETY_URL (${clean(shell)}) overrides the install URL ${installUrl}`, fix: 'unset DETHERNETY_URL to use the install URL' }
  }
  return { subject, label: 'platform URL', status: 'ok', detail: `${installUrl}, the install default (a DETHERNETY_URL set in your shell overrides it)` }
}

/** The server's own URL source (`auth_status`), in words. */
const URL_SOURCE_WORDS = (fixed: boolean): Record<string, string> => ({
  env: fixed ? 'the install URL, fixed' : 'DETHERNETY_URL in this shell', user_config: 'the install default', default: 'the built-in default',
})

/** The first `node` on the safe PATH entries that passes the binary checks (what Claude's bare `node` most likely is). */
async function pathNode(env: InstallerEnv, project?: string): Promise<string | null> {
  // Never a PATH entry inside the project (a repository's own bin folder).
  for (const dir of harnessPath(project)) {
    const p = path.join(dir, 'node')
    if (await checkExecPath(p, env).then(() => true, () => false)) return p
  }
  return null
}

/** A folder chain above a binary that only its owner (or root) can change. */
async function chainProblems(file: string, env: InstallerEnv): Promise<string[]> {
  const problems: string[] = []
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const st = await fs.stat(dir).catch(() => null)
    if (st && ((st.uid !== env.euid && st.uid !== 0) || (st.mode & 0o022) !== 0)) problems.push(dir)
    if (path.dirname(dir) === dir) break
  }
  return problems
}

const subjectOf = (key: string) => {
  const [harness, scope, ...rest] = key.split(':')
  return scope === 'user' ? `${harness} (user)` : `${harness} (project ${clean(rest.join(':'))})`
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
/** The x.y.z a version string starts with, or null. */
export const versionOf = (s: string | null) => (s ? /^(\d+\.\d+\.\d+)/.exec(s.trim())?.[1] ?? null : null)

/** Shows a path that starts with one of these homes from `~`; a longer home is tried first, and `/` never is. */
export function homeAsTilde(homes: readonly string[]): (s: string) => string {
  const sorted = [...new Set(homes)].filter((h) => h !== path.sep && h.length > 0).sort((a, b) => b.length - a.length)
  const escape = (h: string) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = sorted.map((h) => new RegExp(`(^|[\\s(,])${escape(h)}(?=/|$|[\\s),:])`, 'g'))
  return (s) => patterns.reduce((x, re) => x.replace(re, '$1~'), s)
}

/** OpenCode's view of the dethereal server in `opencode mcp list`: its status and the launch line under it; null when it is not listed. */
export function openCodeMcpStatus(text: string): { status: string; command: string | null } | null {
  // eslint-disable-next-line no-control-regex
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /\sdethereal\s+([a-z][a-z -]*?)\s*$/.exec(lines[i]!)
    if (m) return { status: m[1]!, command: lines[i + 1]?.replace(/^[\s\u2500-\u257f]+/, '').trim() || null }
  }
  return null
}

async function openCodeMcpList(env: InstallerEnv, cwd: string, projectRoot?: string): Promise<string | 'missing' | null> {
  // --pure: no OpenCode plugin runs; the configured MCP servers are still started to be listed.
  const r = await runHarnessCli('opencode', ['mcp', 'list', '--pure'], {
    env: { ...env, vars: { ...env.vars, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1' } },
    cwd, ...(projectRoot ? { projectRoot } : {}), stdoutFile: true, maxBytes: 1024 * 1024, timeoutMs: 120_000,
  })
  if (r.failure === 'spawn') return 'missing'
  return r.code === 0 && !r.failure ? r.stdout : null
}

/** Why Codex could not be asked when the reason is that its CLI is not there to ask. */
const CODEX_NOT_FOUND = 'the codex CLI was not found on PATH (PATH folders inside node_modules, or inside the project, are skipped)'
const CODEX_NOT_FOUND_FIX = 'install Codex, or put the folder holding codex on PATH'

/** Every prompt-class tool must still ask in OpenCode's effective rules, as the installer and the plugin set them. */
export const LIVE_ASK_TOOLS: readonly string[] = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => `dethereal_${t.name}`)

/** A path as one shell word: as is when plain, else single-quoted. */
export const shellArg = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${clean(p).replaceAll("'", "'\\''")}'`)

/** The config file a harness entry's server key lives in, from the entry's own records. */
const serverRecord = (entry: InstallEntry, keyPath: readonly string[]) =>
  entry.files.find((f) => (f.owned ?? []).some((o) => isDeepStrictEqual(o.path, [...keyPath])))

/** What the probe found, as checks. */
export function probeChecks(subject: string, r: ProbeResult, expectTools: string[] | null, userScope = false, sourceWords: Record<string, string> = {}): DoctorCheck[] {
  if (!r.started) return [{ subject, label: 'server starts', status: 'fail', detail: `it did not answer (${r.failure ?? 'no reply'})`, fix: 'reinstall; if it persists, run the server by hand to see its error' }]
  const out: DoctorCheck[] = [{ subject, label: 'server starts', status: 'ok' }]
  if (expectTools && r.tools) {
    // The server lists the settlement's tools only with the settlement on: the full list, or exactly the list without them.
    // Which one is not told apart here (the probe runs the server with its own environment).
    const listed = [...r.tools].sort()
    const same = isDeepStrictEqual(listed, [...expectTools].sort()) ||
      isDeepStrictEqual(listed, expectTools.filter((t) => !SETTLEMENT_ONLY_TOOLS.includes(t)).sort())
    out.push({ subject, label: 'tools', status: same ? 'ok' : 'fail', detail: `${r.tools.length} listed${same ? '' : `, ${expectTools.length} expected`}` })
  }
  if (!r.auth) {
    out.push({ subject, label: 'session', status: 'fail', detail: `auth_status did not answer (${r.failure ?? 'no reply'})` })
    return out
  }
  const a = r.auth
  out.push({ subject, label: 'platform', status: a.reachable ? 'ok' : 'warn', detail: `${clean(a.platformUrl ?? '?')} (from ${sourceWords[a.urlSource ?? ''] ?? clean(a.urlSource ?? '?')})${a.reachable ? '' : ', not reachable'}`, ...(a.reachable ? {} : { fix: 'start the platform, or set its URL' }) })
  out.push({ subject, label: 'signed in', status: a.authenticated ? 'ok' : 'warn', detail: a.authenticated ? (a.email ? clean(a.email) : 'yes') : 'no', ...(a.authenticated ? {} : { fix: 'sign in from a session (the login tool)' }) })
  if (userScope) out.push({ subject, label: 'project root', status: 'ok', detail: 'follows the folder each session starts in' })
  else if (a.projectRoot !== undefined) out.push({ subject, label: 'project root', status: 'ok', detail: a.projectRoot === null ? 'none (the session will ask)' : clean(a.projectRoot) })
  return out
}

/** A permission rule list, every action one OpenCode knows. */
function rulesOf(value: unknown): Rule[] | null {
  const perms = (value as { permission?: unknown } | null)?.permission
  if (!Array.isArray(perms)) return null
  const rules: Rule[] = []
  for (const r of perms) {
    const x = r as Partial<Rule>
    if (!x || typeof x.permission !== 'string' || typeof x.pattern !== 'string' || !['allow', 'ask', 'deny'].includes(String(x.action))) return null
    rules.push(x as Rule)
  }
  return rules
}

export async function runDoctor(input: DoctorInput): Promise<DoctorCheck[]> {
  const { ctx, packageRoot } = input
  const { env, paths } = ctx
  const probe = input.probe ?? probeServer
  const checks: DoctorCheck[] = []
  const mine = await packageVersion(packageRoot)
  const empty: Manifest = { schemaVersion: 1, installs: {} }
  const { manifest } = input.stateExists === false ? { manifest: empty } : await readManifest(paths, env)
  for (const name of input.looseState ?? []) {
    const folder = name === '.'
    checks.push({ subject: 'state', label: folder ? '~/.dethernety' : `~/.dethernety/${name}`, status: 'warn', detail: 'readable by other users', fix: folder ? 'chmod 700 ~/.dethernety' : `chmod 600 ~/.dethernety/${name}` })
  }
  const focus = input.project ? await checkProject(input.project, env) : undefined
  const entries = Object.entries(manifest.installs).filter(([k]) => input.harnesses.some((h) => k.startsWith(`${h}:`)))
  if (entries.length === 0) {
    checks.push({ subject: 'doctor', label: 'installed', status: 'fail', detail: 'nothing installed by this installer for the harnesses asked', fix: `npx @dether.net/dethereal@${mine} install --harness ${input.harnesses.join(',')} --scope user` })
    return checks
  }
  // The shared runtime, once, when an entry runs from it.
  const runtimeEntries = entries.filter(([k]) => !k.startsWith('claude:'))
  let current: Awaited<ReturnType<typeof readCurrentRuntime>> | null = null
  if (runtimeEntries.length) {
    try {
      current = await readCurrentRuntime(paths, env)
      checks.push({ subject: 'runtime', label: 'runtime', status: 'ok', detail: `${current.version}${current.version === mine ? '' : ` (doctor is ${mine})`}` })
      const v = await nodeVersion(current.execPath, env, NEUTRAL_DIR)
      checks.push(v && nodeAtLeast(v)
        ? { subject: 'runtime', label: 'node', status: 'ok', detail: `${v} at ${clean(current.execPath)}` }
        : { subject: 'runtime', label: 'node', status: 'fail', detail: v ? `${v} is older than ${NODE_FLOOR}` : `${clean(current.execPath)} cannot run`, fix: 'reinstall each harness after a Node change (install, with its --scope)' })
      const chain = await chainProblems(current.execPath, env)
      if (chain.length) checks.push({ subject: 'runtime', label: 'node folder', status: 'warn', detail: `others can change ${chain.map(clean).join(', ')}` })
    } catch (e) {
      checks.push({ subject: 'runtime', label: 'runtime', status: 'fail', detail: clean(e instanceof Error ? e.message : 'unreadable'), fix: 'reinstall the Codex or OpenCode install (install, with its --scope)' })
    }
  }

  // Claude Code's version is the machine's, asked once.
  let claudeSeen: Promise<string | null> | undefined
  for (const [key, entry] of entries) {
    const subject = subjectOf(key)
    const harness = key.split(':')[0] as DoctorHarness
    const project = key.includes(':project:') ? key.slice(key.indexOf(':project:') + ':project:'.length) : undefined
    // Commands run in a project only for the one asked about; other recorded projects get static checks.
    const live = !project || project === focus
    // Outside a project, everything runs from the filesystem root, which only the system can write to: never from a
    // temporary folder, whose parents any local user can write to, while a harness reads configuration upward from there.
    const cwd = project && live ? await checkProject(project, env).catch(() => null) : NEUTRAL_DIR
    // OpenCode outside a project runs with no project configuration: the guard wherever a configuration above the
    // folder could be planted, and the only one where the root itself is user-writable (a Windows drive root).
    const ocEnv: InstallerEnv = { ...env, vars: { ...env.vars, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', ...(project ? {} : { OPENCODE_DISABLE_PROJECT_CONFIG: '1' }) } }
    if (project && !cwd) {
      checks.push({ subject, label: 'project', status: 'fail', detail: 'the project folder is missing or refused', fix: `npx @dether.net/dethereal@${mine} uninstall --harness ${harness} --scope project --project ${shellArg(project)} --forget-missing-project` })
      continue
    }
    const scopeArgs = project ? `--scope project --project ${shellArg(project)}` : '--scope user'
    const reinstall = `npx @dether.net/dethereal@${mine} install --harness ${harness} ${scopeArgs}`
    // PATH entries inside this folder are never used: the entry's project, or the one asked about.
    const pathRoot = project ?? input.project
    if (entry.version !== mine) checks.push({ subject, label: 'version', status: 'warn', detail: `installed ${entry.version}, doctor is ${mine}`, fix: `npx @dether.net/dethereal@${entry.version} doctor${project ? ` --project ${shellArg(project)}` : ''}` })

    if (harness === 'claude') {
      const cli = entry.cli?.harness === 'claude' ? entry.cli : null
      if (!cli) continue
      const listed = live ? (await claudePlugins(env).catch(() => null))?.find((p) => p.id === cli.id && p.scope === (project ? 'project' : 'user') && (!project || (p.projectPath !== undefined && canonical(p.projectPath) === project))) : undefined
      if (!live) { checks.push({ subject, label: 'plugin', status: 'ok', detail: 'recorded (not checked: another project)' }); continue }
      // Below the floor, install and uninstall refuse: say so here, with the version needed.
      const claude = await (claudeSeen ??= claudeCliVersion(env).catch(() => null))
      checks.push(claude === null ? { subject, label: 'Claude Code version', status: 'warn', detail: 'claude --version could not be run' }
        : olderThanFloor(claude) ? { subject, label: 'Claude Code version', status: 'fail', detail: clean(claudeFloorMessage(claude)), fix: `update Claude Code to ${CLAUDE_FLOOR} or newer` }
        : { subject, label: 'Claude Code version', status: 'ok', detail: clean(claude) })
      if (!listed) { checks.push({ subject, label: 'plugin', status: 'fail', detail: `${clean(cli.id)} is not listed by Claude Code`, fix: reinstall }); continue }
      checks.push({ subject, label: 'plugin', status: listed.enabled ? 'ok' : 'fail', detail: `${clean(cli.id)} ${clean(listed.version)}${listed.enabled ? '' : ', disabled'}`, ...(listed.enabled ? {} : { fix: `claude plugin enable ${clean(cli.id)}` }) })
      const url = configuredUrl(await readSettings(await userSettingsFile(env)), cli.id)
      const normal = url ? (() => { try { return normalisePlatformUrl(url) } catch { return null } })() : null
      // Claude Code hands the server its own environment, so this shell's DETHERNETY_URL reaches it.
      if (url && !normal) checks.push({ subject, label: 'platform URL', status: 'fail', detail: 'unusable' })
      else {
        const c = urlCheck(subject, normal ? clean(normal) : 'the plugin default', false, env, true)
        checks.push(c.status === 'ok' ? { ...c, detail: `${c.detail}; Claude keeps it for every project of this user` } : c)
      }
      // Probe the copy Claude runs, only where it is this package's own files.
      const cacheRoot = canonical(path.join(path.dirname(path.join(claudeDir(env).root, claudeDir(env).pattern)), 'plugins', 'cache'))
      const local = manifest.shared?.claude?.marketplace.source.kind === 'directory' ? canonical(manifest.shared.claude.marketplace.source.path) : null
      const install = listed.installPath ? canonical(listed.installPath) : null
      const contained = !!install && (within(install, cacheRoot) || (local !== null && within(install, local))) && install !== cacheRoot && install !== local
      if (!contained) { checks.push({ subject, label: 'server starts', status: 'fail', detail: 'the plugin copy is outside Claude\'s plugin cache: not probed' }); continue }
      if (listed.version !== mine) {
        checks.push({ subject, label: 'server starts', status: 'warn', detail: `not probed: the copy is ${SEMVER.test(listed.version) ? listed.version : 'another version'}, doctor is ${mine}`, ...(SEMVER.test(listed.version) ? { fix: `npx @dether.net/dethereal@${listed.version} doctor` } : {}) })
        continue
      }
      const theirs = await shippedHash(install)
      if (!theirs || theirs !== (await shippedHash(packageRoot))) { checks.push({ subject, label: 'server starts', status: 'fail', detail: 'the plugin copy differs from this package: not probed', fix: reinstall }); continue }
      const node = await pathNode(env, pathRoot)
      if (!node) { checks.push({ subject, label: 'server starts', status: 'fail', detail: 'no usable node on PATH', fix: 'install Node.js' }); continue }
      const launch: ProbeLaunch = { node, entry: path.join(install, 'dist', 'index.js'), cwd: cwd!, env: probeEnv(env, 'DETHERNETY_PLATFORM_URL', normal, pathRoot, true) }
      checks.push(...probeChecks(subject, await probe(launch, env, { clientVersion: mine }), manifestToolNames(), !project, { ...URL_SOURCE_WORDS(false), user_config: 'Claude\'s plugin setting' }))
      checks.push({ subject, label: 'node', status: 'ok', detail: `${clean(node)} (Claude Code runs the first node on its own PATH)` })
      continue
    }

    // Codex and OpenCode run the shared runtime; their configuration must say exactly that.
    if (!current) continue
    const entryFile = path.join(current.runtimePath, 'dist', 'index.js')
    if (harness === 'codex') {
      const rec = serverRecord(entry, SERVER_TABLE)
      const bytes = rec ? await fs.readFile(rec.path).catch(() => null) : null
      let server: Record<string, unknown> | undefined
      try {
        server = (readConfig(bytes, 'config.toml').mcp_servers as Record<string, Record<string, unknown>> | undefined)?.dethereal
      } catch {
        server = undefined
      }
      const rec2 = recordedUrl(server?.env)
      const url = rec2?.url ?? null
      const normal = rec2?.normal ?? null
      const fixed = rec2?.shape === 'fixed'
      // Codex hands a server only the variables its env_vars lists.
      const shellPasses = Array.isArray(server?.env_vars) && server.env_vars.includes('DETHERNETY_URL')
      const matches = !!server && server.command === current.execPath && isDeepStrictEqual(server.args, [entryFile]) && !!normal
      checks.push(!matches ? { subject, label: 'configuration', status: 'fail', detail: 'the dethereal server entry differs from the install: not probed', fix: reinstall }
        : fixed ? { subject, label: 'configuration', status: 'warn', detail: FIXED_URL, fix: reinstall }
        : { subject, label: 'configuration', status: 'ok' })
      if (matches) checks.push(urlCheck(subject, clean(normal!), fixed, env, shellPasses))
      if (matches && bytes) {
        const template = await fs.readFile(path.join(current.runtimePath, 'bundles', 'codex', 'config.fragment.toml'), 'utf8').catch(() => null)
        if (template) {
          const expected = (readConfig(Buffer.from(renderFragment(template, { node: current.execPath, runtime: current.runtimePath, platformUrl: normal! })), 'fragment').mcp_servers as Record<string, unknown>).dethereal as Record<string, unknown>
          // An entry whose URL shape is not the template's differs by its URL variables alone: the configuration line says so.
          const otherShape = recordedUrl(expected.env)?.shape !== rec2!.shape
          const changed = tomlTreeDiff(bytes, SERVER_TABLE, expected).filter((p) => !(otherShape && (p[2] === 'env' || p[2] === 'env_vars'))).map((p) => p.slice(2).join('.'))
          if (changed.length) checks.push({ subject, label: 'changed since install', status: 'warn', detail: changed.map(clean).join(', ') })
        }
      }
      const codexHome = env.vars.CODEX_HOME && path.isAbsolute(env.vars.CODEX_HOME) ? env.vars.CODEX_HOME : path.join(env.home, '.codex')
      // A TUI run with `-p <name>` keeps its trust in `<name>.config.toml`, beside config.toml.
      const profileFiles: Array<{ name: string; bytes: Buffer }> = []
      for (const f of (await fs.readdir(codexHome).catch(() => [] as string[])).sort()) {
        const m = /^(.+)\.config\.toml$/.exec(f)
        const bytes = m ? await fs.readFile(path.join(codexHome, f)).catch(() => null) : null
        if (m && bytes) profileFiles.push({ name: m[1]!, bytes })
      }
      const trust = codexHookTrust(await fs.readFile(path.join(codexHome, 'config.toml')).catch(() => null), profileFiles)
      const trustFix = 'open Codex (the interactive app, not codex exec) and trust Dethereal\'s hooks when it asks, or later with /hooks'
      const elsewhere = trust.profiles.length ? `; trusted only in profile ${trust.profiles.map((p) => `${clean(p.name)} (${p.trusted}/${trust.expected})`).join(', ')}, which runs without -p do not use` : ''
      checks.push(trust.featuresOff ? { subject, label: 'hooks trusted', status: 'fail', detail: 'Codex hooks are switched off in config.toml [features]', fix: 'turn hooks and plugins back on in Codex\'s config.toml [features]' }
        : trust.trusted >= trust.expected ? { subject, label: 'hooks trusted', status: 'ok', detail: `${trust.trusted}/${trust.expected}, present, not verified` }
        : { subject, label: 'hooks trusted', status: 'fail', detail: `Codex hooks not trusted: ${trust.trusted}/${trust.expected}${trust.disabled ? `, ${trust.disabled} switched off` : ''}${elsewhere}`, fix: trustFix })
      // A running app-server serves sessions with the plugin it loaded at its start.
      const servers = codexAppServerVersions(codexHome)
      const cliVersion = servers.length ? await codexVersion({ env, timeoutMs: 30_000, ...(pathRoot ? { projectRoot: pathRoot } : {}) } as HarnessCliOptions).catch(() => null) : null
      if (cliVersion && !servers.includes(cliVersion)) {
        checks.push({ subject, label: 'Codex app-server', status: 'warn', detail: `the background app-server is ${servers.map(clean).join(', ')}, the CLI ${clean(cliVersion)}`, fix: 'quit Codex fully, its background app-server too, and start it again' })
      }
      if (live) {
        const plugins = await listPlugins({ env, timeoutMs: 30_000, ...(pathRoot ? { projectRoot: pathRoot } : {}) } as HarnessCliOptions).catch(() => null)
        const p = plugins?.find((x) => x.pluginId === 'dethereal@dethereal-local')
        checks.push(p ? { subject, label: 'plugin', status: p.enabled === false ? 'fail' : 'ok', detail: `dethereal@dethereal-local${p.version ? ` ${clean(p.version)}` : ''}${p.enabled === false ? ', disabled' : ''}` }
          : plugins || resolveHarnessCli('codex', pathRoot) ? { subject, label: 'plugin', status: 'fail', detail: plugins ? 'not listed by Codex' : 'Codex could not be asked (codex plugin list failed)', fix: reinstall }
          : { subject, label: 'plugin', status: 'fail', detail: CODEX_NOT_FOUND, fix: CODEX_NOT_FOUND_FIX })
        // Codex's own view, every trusted layer merged: from the project folder, a project layer that disables or
        // redefines the server shows here (listing starts no server).
        const view = project ? cwd! : focus ?? cwd!
        const servers = await listMcpServers({ env, timeoutMs: 30_000, cwd: view, ...(pathRoot ? { projectRoot: pathRoot } : {}) } as HarnessCliOptions).catch(() => null)
        const ours = servers?.find((s) => s.name === 'dethereal')
        const layerFix = 'look for [mcp_servers.dethereal] in the project\'s .codex/config.toml'
        checks.push(!servers ? { subject, label: 'Codex MCP list', status: 'warn', detail: resolveHarnessCli('codex', pathRoot) ? 'codex mcp list could not be run' : CODEX_NOT_FOUND }
          : !ours ? { subject, label: 'Codex MCP list', status: 'fail', detail: 'Codex does not list the dethereal server', fix: reinstall }
          : !ours.enabled ? { subject, label: 'Codex MCP list', status: 'fail', detail: 'a configuration layer disables the dethereal server', fix: layerFix }
          : ours.transport.command !== current.execPath || !isDeepStrictEqual(ours.transport.args ?? [], [entryFile])
              || !isDeepStrictEqual(ours.transport.env ?? {}, server?.env ?? {}) || !isDeepStrictEqual(ours.transport.env_vars ?? [], server?.env_vars ?? []) || !!ours.transport.cwd
            ? { subject, label: 'Codex MCP list', status: 'fail', detail: 'a configuration layer redefines the dethereal server', fix: layerFix }
          : { subject, label: 'Codex MCP list', status: 'ok', detail: 'enabled, as installed' })
        if (matches) checks.push(...probeChecks(subject, await probe({ node: current.execPath, entry: entryFile, cwd: cwd!, env: probeEnv(env, fixed ? 'DETHERNETY_URL' : 'DETHERNETY_PLATFORM_URL', normal, pathRoot, shellPasses) }, env, { clientVersion: mine }), current.version === mine ? manifestToolNames() : null, !project, URL_SOURCE_WORDS(fixed)))
      }
      continue
    }

    // OpenCode: the writer's own checks, the configuration compared, the probe, and the live check on request.
    const scope = project ? { project } : ('user' as const)
    // `opencode --version` runs from the neutral folder, never in a project.
    let versionFailed = false
    const openCode = await input.openCodeVersion(env, pathRoot).catch(() => { versionFailed = true; return null })
    // The override holds for the version it was given for; another unverified version needs it again.
    const allowed = !!entry.allowUnverified && entry.allowUnverified.openCodeVersion === versionOf(openCode)
    for (const c of await checkOpenCode(ctx, { env, paths, scope, openCodeVersion: openCode, allowUnverified: allowed })) {
      if (c.label === 'OpenCode version' && versionFailed) { checks.push({ subject, label: c.label, status: 'fail', detail: 'opencode --version could not be run' }); continue }
      checks.push({ subject, label: c.label, status: c.status, ...(c.detail ? { detail: clean(c.detail) } : {}) })
    }
    if (entry.allowUnverified) {
      const now = versionOf(openCode)
      checks.push({ subject, label: 'unverified OpenCode allowed', status: 'warn', detail: `installed with --allow-unverified-opencode for ${clean(entry.allowUnverified.openCodeVersion)}${allowed || !now ? '' : `; OpenCode is now ${now}`}` })
    }
    const rec = serverRecord(entry, ['mcp', 'dethereal'])
    const text = rec ? await fs.readFile(rec.path, 'utf8').catch(() => null) : null
    const server = text ? ((parseJsonc(text) as { mcp?: Record<string, Record<string, unknown>> } | undefined)?.mcp?.dethereal) : undefined
    const rec2 = recordedUrl(server?.environment)
    const normal = rec2?.normal ?? null
    const fixed = rec2?.shape === 'fixed'
    const matches = !!server && isDeepStrictEqual(server.command, [current.execPath, entryFile]) && !!normal
    checks.push(!matches ? { subject, label: 'server entry', status: 'fail', detail: 'the dethereal MCP entry differs from the install: not probed', fix: reinstall }
      : fixed ? { subject, label: 'server entry', status: 'warn', detail: FIXED_URL, fix: reinstall }
      : { subject, label: 'server entry', status: 'ok' })
    // OpenCode hands a local server its own environment, with the entry's laid over it.
    if (matches) checks.push(urlCheck(subject, clean(normal!), fixed, env, true))
    if (live && matches) checks.push(...probeChecks(subject, await probe({ node: current.execPath, entry: entryFile, cwd: cwd!, env: probeEnv(env, fixed ? 'DETHERNETY_URL' : 'DETHERNETY_PLATFORM_URL', normal, pathRoot, true) }, env, { clientVersion: mine }), current.version === mine ? manifestToolNames() : null, !project, URL_SOURCE_WORDS(fixed)))
    // OpenCode's own list, every layer applied: a layer that disables or redefines the server shows here. Listing starts
    // every configured MCP server, so in a project (whose own servers would start) it runs only with --live-opencode.
    if (live && matches && (!project || input.liveOpenCode)) {
      const listed = await (input.openCodeMcpList ?? openCodeMcpList)(ocEnv, cwd!, pathRoot)
      const seen = typeof listed === 'string' && listed !== 'missing' ? openCodeMcpStatus(listed) : null
      const launch = `${current.execPath} ${entryFile}`
      checks.push(listed === 'missing' ? { subject, label: 'OpenCode MCP list', status: 'warn', detail: 'OpenCode was not found; not checked' }
        : listed === null ? { subject, label: 'OpenCode MCP list', status: 'warn', detail: 'opencode mcp list could not be run' }
        : !seen ? { subject, label: 'OpenCode MCP list', status: 'fail', detail: 'OpenCode does not list the dethereal server', fix: reinstall }
        : seen.status !== 'connected' ? { subject, label: 'OpenCode MCP list', status: 'fail', detail: `OpenCode shows the dethereal server as ${clean(seen.status)}`, fix: 'look for an mcp.dethereal entry in the project\'s or OPENCODE_CONFIG\'s opencode.json' }
        : seen.command !== launch ? { subject, label: 'OpenCode MCP list', status: 'fail', detail: 'a configuration layer redefines the dethereal server', fix: 'look for an mcp.dethereal entry in the project\'s or OPENCODE_CONFIG\'s opencode.json' }
        : { subject, label: 'OpenCode MCP list', status: 'ok', detail: 'connected' })
    }
    if (live && input.liveOpenCode) {
      // Whether OpenCode loads the plugin: only a run with plugins shows it (a pure run loads none).
      const where = { cwd: cwd!, ...(project ? { projectRoot: project } : {}), maxBytes: 4 * 1024 * 1024, timeoutMs: 120_000 }
      const pluginFile = entry.files.find((r) => r.path.endsWith('/plugins/dethereal.ts'))?.path
      const config = await runHarnessCli('opencode', ['debug', 'config'], { env: ocEnv, ...where, stdoutFile: true })
      const logs = await runHarnessCli('opencode', ['debug', 'agent', 'build', '--print-logs'], { env: ocEnv, ...where, stdoutFile: true, stderrFile: true })
      let parsed: unknown
      try {
        parsed = config.code === 0 && !config.failure ? JSON.parse(config.stdout) : null
      } catch {
        parsed = null
      }
      const loadProblems = !pluginFile ? ['no plugin file is recorded for this install'] : parsed === null || logs.failure ? ['OpenCode could not be asked'] : pluginLoadProblems(parsed, logs.stderr ?? '', pluginFile)
      checks.push(loadProblems.length ? { subject, label: 'plugin loaded', status: 'fail', detail: loadProblems.map(clean).join('; ') } : { subject, label: 'plugin loaded', status: 'ok' })
      const askTools = LIVE_ASK_TOOLS
      const realHome = await fs.realpath(env.home)
      for (const agent of ['build', 'plan']) {
        const r = await runHarnessCli('opencode', ['debug', 'agent', agent, '--pure'], {
          env: ocEnv, cwd: cwd!, ...(project ? { projectRoot: project } : {}), stdoutFile: true, maxBytes: 4 * 1024 * 1024, timeoutMs: 120_000,
        })
        let rules: Rule[] | null
        try {
          rules = r.code === 0 && !r.failure ? rulesOf(JSON.parse(r.stdout)) : null
        } catch {
          rules = null
        }
        if (!rules) { checks.push({ subject, label: `live rules (${agent})`, status: 'fail', detail: 'OpenCode gave no rule list' }); continue }
        const problems = effectiveRuleProblems(rules, askTools, realHome)
        checks.push({ subject, label: `live rules (${agent})`, status: problems.length ? 'fail' : 'ok', detail: problems.length ? problems.slice(0, 6).map(clean).join('; ') : 'as installed (run without OPENCODE_CONFIG*/OPENCODE_PERMISSION, which real sessions may set)' })
      }
    }
  }
  // The home folder shows as ~ where a path starts with it: a report may be pasted elsewhere.
  // Fix hints keep their paths whole, since they are meant to be run.
  const tilde = homeAsTilde([env.home, await fs.realpath(env.home).catch(() => env.home)])
  return checks.map((c) => ({ ...c, subject: tilde(c.subject), ...(c.detail !== undefined ? { detail: tilde(c.detail) } : {}) }))
}
