/**
 * `dethereal install`, `uninstall`, `doctor` and `gc`: the installer.
 *
 *   install   --harness <claude,codex,opencode> --scope user|project [--project <dir>]
 *             [--platform-url <url>] [--allow-unverified-opencode] [--yes]
 *   uninstall --harness <claude,codex,opencode> --scope user|project [--project <dir>]
 *             [--forget-missing-project] [--purge-backups] [--yes]
 *   doctor    [--harness <claude,codex,opencode>] [--project <dir>] [--live-opencode] [--json]
 *   gc        [--yes]
 *
 * On a terminal, install and uninstall ask for what is not given; elsewhere, or with
 * `--yes`, `--harness` and `--scope` are required (USAGE below).
 *
 * `--harness` takes one harness or a comma list. Before it changes anything it
 * prints what it is about to add: installing through a harness's own CLI skips
 * that harness's own consent screen, so this summary is where the user sees it,
 * including what each harness's bundle lets run without asking.
 *
 * Claude Code runs the plugin from its own copy, so it is installed on its own.
 * Codex and OpenCode run the server from the installer's runtime: under one
 * install lock the runtime is installed once from this package, each of them is
 * installed against it, and the runtime is activated once at the end when at
 * least one of them succeeded. Each harness succeeds or fails on its own; the
 * report says, per harness, what is installed, what failed and what was not
 * touched, and the exit code is 1 when anything failed. A failed harness is
 * retried alone: `dethereal install --harness <that harness>`.
 *
 * `--claude-marketplace <dir>` installs from a local marketplace instead of the
 * official one. It loads code from that directory into every later session, so it
 * is honoured only with DETHEREAL_TEST_MARKETPLACE=1 (release candidates, tests)
 * and is not listed in the help.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { InstallerError } from '../core/errors.js'
import { cliFailed, resolveHarnessCli, runHarnessCli } from '../core/harness-cli.js'
import type { probeServer } from '../core/server-probe.js'
import { type DoctorCheck, type DoctorInput, runDoctor, versionOf } from '../doctor/index.js'
import { TOOL_MANIFEST } from '../../tools/manifest.js'
import { PromptAborted, type Prompter, readlinePrompter } from './prompt.js'
import { OFFICIAL_MARKETPLACE_NAME, readManifest, withStateLock } from '../core/manifest.js'
import { defaultEnv, ensureStateRoot, inspectStateRoot, type InstallerEnv, type StatePaths } from '../core/paths.js'
import { activateRuntimeLocked, gcRuntimesLocked, installRuntimeLocked, removeRuntimeLocked, stableNodePath } from '../core/runtime.js'
import { mutateManifest, purgeAllBackups, type TxContext } from '../core/transaction.js'
import {
  type ClaudeInstallReport, type ClaudeScope, type ClaudeUninstallReport, configuredUrl, defaultUrl, installClaude, normalisePlatformUrl, PACKAGE_NAME, packageVersion,
  PLUGIN_NAME, readSettings, userSettingsFile,
  uninstallClaude,
} from '../writers/claude/index.js'
import { installCodex, installedCodexUrl, uninstallCodex } from '../writers/codex/index.js'
import { applyOpenCode, installedOpenCodeUrl, openCodeLeftovers, OpenCodeRefusal, type OpenCodePlan, planOpenCode, uninstallOpenCode, versionGate } from '../writers/opencode/index.js'

export interface InstallerIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** The harness writers, replaceable in tests. */
export interface Writers {
  installClaude: typeof installClaude
  uninstallClaude: typeof uninstallClaude
  installCodex: typeof installCodex
  uninstallCodex: typeof uninstallCodex
  planOpenCode: typeof planOpenCode
  applyOpenCode: typeof applyOpenCode
  uninstallOpenCode: typeof uninstallOpenCode
  openCodeLeftovers: typeof openCodeLeftovers
  openCodeVersion: (env: InstallerEnv, projectRoot?: string) => Promise<string | null>
  /** The URL an install of that harness recorded, when its entry is still as installed (null otherwise): a re-run keeps it. */
  installedCodexUrl: InstalledUrl
  installedOpenCodeUrl: InstalledUrl
}

export type InstalledUrl = (input: { env: InstallerEnv; paths: StatePaths; scope: 'user' | { project: string } }) => Promise<string | null>

export interface InstallerDeps {
  env?: InstallerEnv
  packageRoot?: string
  writers?: Partial<Writers>
  /** The Node binary the runtime is recorded to run with (default: this process's, by its stable path). */
  node?: string
  /** Whether to ask on a terminal (default: stdin and stdout are terminals, and CI is not set). */
  tty?: boolean
  prompter?: Prompter
  probe?: typeof probeServer
  /** OpenCode's own server list, for doctor (default: `opencode mcp list --pure`). */
  openCodeMcpList?: DoctorInput['openCodeMcpList']
}

export const HARNESS_ORDER = ['claude', 'codex', 'opencode'] as const
export type HarnessName = (typeof HARNESS_ORDER)[number]
const SHOWN: Record<HarnessName, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

/** What `opencode --version` prints; null when OpenCode is not found. */
export async function openCodeVersion(env: InstallerEnv, projectRoot?: string): Promise<string | null> {
  // Never an `opencode` from inside the project; asking its version updates nothing.
  const r = await runHarnessCli('opencode', ['--version'], { env: { ...env, vars: { ...env.vars, OPENCODE_DISABLE_AUTOUPDATE: '1' } }, timeoutMs: 30_000, ...(projectRoot ? { projectRoot } : {}) })
  if (r.failure === 'spawn') return null
  if (r.failure || r.code !== 0) throw cliFailed('opencode --version', r)
  return (r.stdout.trim().split('\n')[0] ?? '').trim().slice(0, 64).replace(/[^\x20-\x7e]/g, '?')
}

const DEFAULT_WRITERS: Writers = {
  installClaude, uninstallClaude, installCodex, uninstallCodex, planOpenCode, applyOpenCode, uninstallOpenCode, openCodeLeftovers, openCodeVersion,
  installedCodexUrl, installedOpenCodeUrl,
}

export type InstallerCommand = 'install' | 'uninstall' | 'doctor' | 'gc'

const USAGE = `Usage:
  dethereal install   --harness <claude,codex,opencode> --scope user|project [--project <dir>]
                      [--platform-url <url>] [--allow-unverified-opencode] [--yes]
  dethereal uninstall --harness <claude,codex,opencode> --scope user|project [--project <dir>]
                      [--forget-missing-project] [--purge-backups] [--yes]
  dethereal doctor    [--harness <claude,codex,opencode>] [--project <dir>] [--live-opencode] [--json]
  dethereal gc        [--yes]
  On a terminal, install and uninstall ask for what is not given; elsewhere, or with --yes, --harness
  and --scope are required. A harness that fails is retried alone: run the same command with just
  that --harness. --live-opencode runs OpenCode with its plugins loaded: your own, and in a project
  the project's own too, whose dependencies it may install and whose MCP servers it may start.
  Outside a project, doctor runs OpenCode from the filesystem root with project configuration off.`

const VALUE_OPTIONS: Record<InstallerCommand, string[]> = {
  install: ['harness', 'scope', 'project', 'platform-url', 'claude-marketplace'],
  uninstall: ['harness', 'scope', 'project'],
  doctor: ['harness', 'project'],
  gc: [],
}
const FLAG_OPTIONS: Record<InstallerCommand, string[]> = {
  install: ['allow-unverified-opencode', 'yes'],
  uninstall: ['forget-missing-project', 'purge-backups', 'yes'],
  doctor: ['live-opencode', 'json'],
  gc: ['yes'],
}

class UsageError extends Error {}

/** `--name value` / `--name=value` options and bare flags, every one known, none twice. */
function parse(command: InstallerCommand, args: string[]): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg)
    if (!m) throw new UsageError(`unexpected argument ${JSON.stringify(arg.slice(0, 64))}`)
    const name = m[1]!
    if (values.has(name) || flags.has(name)) throw new UsageError(`--${name} given twice`)
    if (FLAG_OPTIONS[command].includes(name)) {
      if (m[2] !== undefined) throw new UsageError(`--${name} takes no value`)
      flags.add(name)
    } else if (VALUE_OPTIONS[command].includes(name)) {
      const value = m[2] ?? args[++i]
      if (value === undefined || value === '') throw new UsageError(`--${name} needs a value`)
      values.set(name, value)
    } else {
      throw new UsageError(`unknown option --${name}`)
    }
  }
  return { values, flags }
}

/** The package this code ships in: the nearest folder above it whose package.json is ours. */
async function findPackageRoot(): Promise<string> {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const pkg = await fs.readFile(path.join(dir, 'package.json'), 'utf8').then((t) => JSON.parse(t) as { name?: unknown }, () => null)
    if (pkg?.name === PACKAGE_NAME) return dir
    if (path.dirname(dir) === dir) throw new InstallerError('runtime_invalid', 'package root')
  }
}

/** The hook events the packaged Claude bundle registers, for the summary. */
async function hookEvents(packageRoot: string): Promise<string[]> {
  try {
    const hooks = JSON.parse(await fs.readFile(path.join(packageRoot, 'bundles', 'claude', 'hooks', 'hooks.json'), 'utf8')) as { hooks?: Record<string, unknown> }
    return Object.keys(hooks.hooks ?? {}).sort()
  } catch {
    return []
  }
}

function describe(e: unknown): string {
  if (e instanceof InstallerError) return e.message
  if (e instanceof OpenCodeRefusal) return e.message
  return 'internal error'
}

/** The harnesses named, each once, in the order they are installed. */
function harnessesOf(value: string): HarnessName[] {
  const names = value.split(',').map((s) => s.trim())
  for (const n of names) if (!(HARNESS_ORDER as readonly string[]).includes(n)) throw new UsageError(`--harness ${JSON.stringify(n.slice(0, 32))}: expected claude, codex or opencode`)
  return HARNESS_ORDER.filter((h) => names.includes(h))
}

function claudeSummary(scope: ClaudeScope, project: string | undefined, url: string | undefined, local: string | undefined, events: string[]): string[] {
  return [
    `Claude Code (${scope === 'user' ? 'every project, for this user' : `the project ${project}`}):`,
    `  Claude Code adds the ${local ? `local marketplace ${local}` : 'dether.net marketplace (github: dether-net/claude-plugins)'} and installs the plugin from it.`,
    `  The plugin runs hooks on ${events.length ? events.join(', ') : 'session and tool events'} and its own MCP server, dethereal.`,
    `  Platform URL: ${url ?? 'keeps the one already configured, or the plugin\'s default'} (default; ${SHELL_OVERRIDES}; Claude keeps it for every project of this user).`,
    `  Without asking: the plugin's approve hook lets Claude Code run Dethereal's ${AUTO_PHRASE}; your own deny and ask rules still apply. The other ${PROMPT_COUNT} tools ask as your settings say. Its skills read their own instruction files without asking.`,
    ...(scope === 'project' ? [`  It enables the plugin in ${path.join(project ?? '', '.claude', 'settings.json')}, a file a repository may commit.`] : []),
  ]
}

/**
 * What a harness may run without asking, in categories, from the tool manifest the bundles are generated
 * from. The summary names no tools: `doctor --json` lists them. model_state also changes the model's
 * local workflow state, which the server checks.
 */
const AUTO_PHRASE = 'read-only tools and the ones whose changes the server checks'
const AUTO_TOOLS = TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name).sort()
const PROMPT_TOOLS = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => t.name).sort()
const PROMPT_COUNT = PROMPT_TOOLS.length
// "The other N tools" holds only while every tool either runs without asking or asks: a third approval fails to compile here.
const _approvals: Record<(typeof TOOL_MANIFEST)[number]['approval'], true> = { auto: true, prompt: true }

const SHELL_OVERRIDES = 'a DETHERNETY_URL set in your shell overrides it'

function runtimeSummary(h: 'codex' | 'opencode', scope: ClaudeScope, project: string | undefined, url: string, kept: boolean): string[] {
  const where = scope === 'user' ? 'for this user' : `for the project ${project}`
  const urlLine = `Platform URL: ${kept ? 'keeps ' : ''}${url} (default; ${SHELL_OVERRIDES})`
  return h === 'codex'
    ? [
        `Codex (${where}):`,
        '  Adds a local marketplace from the installer\'s runtime, installs the plugin from it, writes the dethereal MCP server and its agents into the Codex configuration.',
        `  ${urlLine}. Codex asks you to trust the plugin's hooks before they run.`,
        `  Without asking: Codex runs Dethereal's ${AUTO_PHRASE}; the other ${PROMPT_COUNT} Dethereal tools ask first.`,
        '  Its Dethereal agents get Codex\'s sandbox settings (read-only for the scouts and the reviewer, which can still read the whole disk; workspace-write for the threat-modeler and the enricher); Codex\'s sandbox for an agent may not cover its shell commands, so Dethereal\'s hooks also refuse, best effort, any shell command of the scouts and the reviewer that does more than read. They set no approval policy of their own: Codex\'s decides whether their shell commands ask.',
        '  On Codex, Dethereal\'s guards are best effort: they judge a command by what it names, so an interpreter, or a session fed input later, can get past them; Codex\'s sandbox is the boundary.',
      ]
    : [
        `OpenCode (${where}):`,
        '  Writes its plugin, agents, commands and skills, and the dethereal MCP server, into the OpenCode configuration. The plugin runs with your user\'s rights inside OpenCode.',
        `  ${urlLine}.`,
        `  Without asking, the Dethereal agents: run its ${AUTO_PHRASE}; read project files, except secret ones; and two of them edit the model files. Their shell commands, and the ${PROMPT_COUNT} other tools, ask first. OpenCode's own agents keep your settings.`,
      ]
}

function claudeInstalled(r: ClaudeInstallReport): string[] {
  const url = r.url.value ? `${r.url.value} (${r.url.source === 'flag' ? 'from --platform-url' : r.url.source === 'kept' ? 'the one Claude Code had, kept' : 'the plugin\'s default'})` : 'unchanged'
  return [
    `${r.id} ${r.plugin.replace('_', ' ')} at ${r.version}, ${r.scope} scope${r.adopted ? ' (it was already installed: uninstall will leave it installed)' : ''}.`,
    `Marketplace ${r.marketplace.name}${r.marketplace.added ? ' added' : ' already present'}; platform URL ${url}.`,
    ...r.notes.map((n) => `Note: ${n}.`),
    'Start a new Claude Code session to load it.',
  ]
}

function claudeUninstalled(r: ClaudeUninstallReport): string[] {
  return [
    `${r.id} ${r.plugin === 'kept' ? 'left installed (it was there before)' : r.plugin === 'uninstalled' ? 'uninstalled' : 'was already gone'}, ${r.scope} scope.`,
    `Marketplace: ${r.marketplace === 'removed' ? 'removed' : r.marketplace === 'kept' ? 'kept' : 'not added by this installer, left as it is'}.`,
    ...r.notes.map((n) => `Note: ${n}.`),
  ]
}

type Status = 'installed' | 'unchanged' | 'uninstalled' | 'nothing to do' | 'failed' | 'not touched'
interface Outcome { status: Status; lines: string[] }

function report(command: 'install' | 'uninstall', outcomes: Map<HarnessName, Outcome>, version: string): { text: string; failed: HarnessName[] } {
  // A harness asked for that was never reached failed as much as one that refused.
  const failed = [...outcomes].filter(([, o]) => o.status === 'failed' || o.status === 'not touched').map(([h]) => h)
  const lines: string[] = []
  for (const [h, o] of outcomes) {
    lines.push(`${SHOWN[h]}: ${o.status}.`, ...o.lines.map((l) => `  ${l}`))
  }
  if (failed.length) lines.push('', `Retry the failed one alone: npx @dether.net/dethereal@${version} ${command} --harness ${failed.join(',')} (with the same --scope and --project).`)
  return { text: lines.join('\n') + '\n', failed }
}

/** Run an installer command; resolves to the exit code. Never rejects. */
export async function runInstaller(command: InstallerCommand, args: string[], io: InstallerIo, deps: InstallerDeps = {}): Promise<number> {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(command, args)
    const h = parsed.values.get('harness')
    if (h !== undefined) harnessesOf(h)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    io.stderr(`dethereal ${command}: ${e.message}\n${USAGE}\n`)
    return 2
  }
  const env = deps.env ?? defaultEnv()
  if (command === 'doctor') return doctorCommand(parsed, io, deps, env)
  if (command === 'gc') return gcCommand(parsed, io, deps, env)

  const interactive = !parsed.flags.has('yes') && (deps.tty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true && !env.vars.CI))
  const w: Writers = { ...DEFAULT_WRITERS, ...deps.writers }
  let harnesses: HarnessName[]
  let scope: ClaudeScope
  let project: string | undefined
  let flagUrl = parsed.values.get('platform-url')
  const marketplaceDir = parsed.values.get('claude-marketplace')
  try {
    const harnessArg = parsed.values.get('harness')
    const scopeArg = parsed.values.get('scope')
    if (scopeArg !== undefined && scopeArg !== 'user' && scopeArg !== 'project') throw new UsageError('--scope must be user or project')
    if (scopeArg === 'user' && parsed.values.has('project')) throw new UsageError('--project goes with --scope project')
    if (!interactive) {
      // Off a terminal, or with --yes, nothing is guessed: what to change is named.
      if (harnessArg === undefined) throw new UsageError('--harness is required (off a terminal, or with --yes)')
      if (scopeArg === undefined) throw new UsageError('--scope is required (off a terminal, or with --yes)')
      if (scopeArg === 'project' && !parsed.values.has('project')) throw new UsageError('--scope project needs --project <dir>')
    }
    if (marketplaceDir !== undefined && harnessArg !== undefined && !harnessesOf(harnessArg).includes('claude')) throw new UsageError('--claude-marketplace goes with --harness claude')
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    io.stderr(`dethereal ${command}: ${e.message}\n${USAGE}\n`)
    return 2
  }
  if (marketplaceDir !== undefined && env.vars.DETHEREAL_TEST_MARKETPLACE !== '1') {
    io.stderr(`dethereal ${command}: --claude-marketplace is for release candidates and tests, and needs DETHEREAL_TEST_MARKETPLACE=1\n`)
    return 2
  }
  // Every answer is collected before anything is locked or written.
  if (interactive) {
    const prompter = deps.prompter ?? readlinePrompter(process.stdin, process.stdout)
    try {
      const harnessArg = parsed.values.get('harness')
      if (harnessArg !== undefined) {
        harnesses = harnessesOf(harnessArg)
      } else {
        const choices = HARNESS_ORDER.map((h) => ({ value: h, label: SHOWN[h] }))
        const marked = command === 'install' ? HARNESS_ORDER.filter((h) => resolveHarnessCli(h)) : await installedHarnesses(env).catch(() => [])
        const picked = await prompter.multi(`Which harnesses${command === 'install' ? '' : ' to uninstall from'}?`, choices, marked)
        harnesses = HARNESS_ORDER.filter((h) => picked.includes(h))
      }
      scope = (parsed.values.get('scope') as ClaudeScope | undefined) ?? await prompter.select('For whom?', [{ value: 'user', label: 'this user, every project' }, { value: 'project', label: 'one project' }], 'user')
      const projectArg = parsed.values.get('project')
      project = scope === 'project' ? path.resolve(projectArg ?? await prompter.text('Which project folder?', process.cwd())) : undefined
      if (command === 'install' && flagUrl === undefined) {
        const packageRoot = deps.packageRoot ?? await findPackageRoot()
        // Enter keeps the URL Claude Code already has, or the one an install recorded, never silently the package default over it.
        const current = await currentClaudeUrl(env)
        const installed = current ? null : await installedUrls(w, env, harnesses, scope, project).then((u) => u.codex ?? u.opencode ?? null)
        const fallback = current ?? installed ?? await defaultUrl(packageRoot)
        const note = [current ? 'Enter keeps the one Claude Code has' : installed ? 'Enter keeps the one installed' : 'Enter takes the default', ...(harnesses.includes('claude') ? ['Claude keeps it for every project of this user'] : [])]
        for (let tries = 0; ; tries++) {
          const answer = await prompter.text(`Platform URL (${note.join('; ')})?`, fallback)
          try {
            flagUrl = normalisePlatformUrl(answer)
            break
          } catch {
            if (tries >= 2) throw new PromptAborted()
            io.stdout('That is not a usable http(s) URL.\n')
          }
        }
      }
    } catch (e) {
      prompter.close()
      if (e instanceof PromptAborted) { io.stderr(`dethereal ${command}: aborted; nothing changed\n`); return 1 }
      if (e instanceof UsageError) { io.stderr(`dethereal ${command}: ${e.message}\n${USAGE}\n`); return 2 }
      throw e
    }
    deps = { ...deps, prompter }
  } else {
    harnesses = harnessesOf(parsed.values.get('harness')!)
    scope = parsed.values.get('scope') as ClaudeScope
    const projectArg = parsed.values.get('project')
    project = projectArg !== undefined ? path.resolve(projectArg) : undefined
  }

  const outcomes = new Map<HarnessName, Outcome>()
  let installedBefore: Record<string, { version: string }> | undefined
  // Set when an uninstall removed the last install and a runtime is left: asked about after the report.
  let runtimeLeft: StatePaths | null = null
  try {
    const runtimeHarnesses = harnesses.filter((h): h is 'codex' | 'opencode' => h !== 'claude')
    const packageRoot = command === 'install' ? deps.packageRoot ?? await findPackageRoot() : ''
    // Per harness: --platform-url (or the answer), else the URL its install recorded, else the package default.
    const urls: Partial<Record<'codex' | 'opencode', string>> = {}
    let kept: Partial<Record<'codex' | 'opencode', string>> = {}
    let openCode: string | null = null
    let anything = true
    // The summary and the question come before the state folder is created or touched.
    if (command === 'install') {
      // OpenCode's version is checked before the question: a refusal is never asked about.
      if (runtimeHarnesses.includes('opencode')) {
        let refused: string | null
        try {
          openCode = await w.openCodeVersion(env, project)
          const gate = versionGate(openCode, parsed.flags.has('allow-unverified-opencode'))
          refused = gate.install ? null : gate.reason
        } catch (e) {
          refused = describe(e)
        }
        if (refused !== null) {
          outcomes.set('opencode', { status: 'failed', lines: [refused, 'Nothing was written for OpenCode.'] })
          runtimeHarnesses.splice(runtimeHarnesses.indexOf('opencode'), 1)
        }
      }
      if (runtimeHarnesses.length) {
        kept = flagUrl === undefined ? await installedUrls(w, env, runtimeHarnesses, scope, project) : {}
        const fallback = normalisePlatformUrl(flagUrl ?? await defaultUrl(packageRoot))
        for (const h of runtimeHarnesses) urls[h] = kept[h] ?? fallback
      }
      const summary = ['Installing Dethereal:']
      if (harnesses.includes('claude')) summary.push(...claudeSummary(scope, project, flagUrl, marketplaceDir, await hookEvents(packageRoot)))
      for (const h of runtimeHarnesses) summary.push(...runtimeSummary(h, scope, project, urls[h]!, kept[h] !== undefined))
      if (outcomes.has('opencode')) summary.push(`OpenCode: not installed. ${outcomes.get('opencode')!.lines[0]}`)
      summary.push('')
      io.stdout(summary.join('\n') + '\n')
      // Nothing left to ask about when every harness named was refused.
      anything = harnesses.includes('claude') || runtimeHarnesses.length > 0
      if (anything && deps.prompter && !(await askProceed(deps.prompter, 'Install?'))) { io.stdout('Nothing changed.\n'); return 0 }
    } else {
      const purge = parsed.flags.has('purge-backups') ? ', and remove the installer\'s backups if nothing stays installed' : ''
      if (deps.prompter && !(await askProceed(deps.prompter, `Uninstall Dethereal from ${harnesses.map((h) => SHOWN[h]).join(', ')} (${scope === 'user' ? 'this user' : `project ${project}`})${purge}?`))) {
        io.stdout('Nothing changed.\n')
        return 0
      }
    }
    if (!anything) {
      // Every harness named was refused: nothing to write, not even the state folder.
      const { text } = report(command, outcomes, await packageVersion(packageRoot))
      io.stdout(text)
      return 1
    }
    const { paths } = await ensureStateRoot(env)
    const ctx: TxContext = { paths, env }
    // The versions installed before this run: a session opened on one keeps running it until restarted.
    installedBefore = command === 'install' ? await readManifest(paths, env).then((r) => r.manifest.installs, () => ({})) : {}

    if (command === 'install') {
      if (harnesses.includes('claude')) {
        try {
          const r = await w.installClaude({
            ctx, packageRoot, scope, ...(project ? { project } : {}), ...(flagUrl !== undefined ? { platformUrl: flagUrl } : {}),
            ...(marketplaceDir !== undefined ? { marketplaceDir: path.resolve(marketplaceDir) } : {}),
          })
          outcomes.set('claude', { status: r.plugin === 'up_to_date' ? 'unchanged' : 'installed', lines: claudeInstalled(r) })
        } catch (e) {
          outcomes.set('claude', { status: 'failed', lines: [describe(e)] })
        }
      }

      if (runtimeHarnesses.length) {
        try {
          await withStateLock(paths, env, async (lock) => {
            const tx: TxContext = { ...ctx, lock }
            const rt = await installRuntimeLocked(paths, env, packageRoot, await packageVersion(packageRoot), lock)
            const node = deps.node ?? await stableNodePath(process.execPath)
            const succeeded: Array<'codex' | 'opencode'> = []
            // OpenCode's refusals come before anything is written for either harness.
            let plan: OpenCodePlan | undefined
            if (runtimeHarnesses.includes('opencode')) {
              try {
                plan = await w.planOpenCode({
                  env, paths, scope: scope === 'user' ? 'user' : { project: project! }, runtime: rt, execPath: node, url: urls.opencode!,
                  openCodeVersion: openCode, allowUnverified: parsed.flags.has('allow-unverified-opencode'),
                })
              } catch (e) {
                outcomes.set('opencode', { status: 'failed', lines: [describe(e), 'Nothing was written for OpenCode.'] })
              }
            }
            if (runtimeHarnesses.includes('codex')) {
              try {
                const r = await w.installCodex({ ctx: tx, scope, ...(project ? { project } : {}), platformUrl: urls.codex!, runtime: rt, node })
                succeeded.push('codex')
                outcomes.set('codex', {
                  status: 'installed',
                  lines: [
                    `Codex ${r.codexVersion}, ${r.scope} scope, runtime ${rt.version}.`,
                    ...(r.reset.length ? [`Set again where you had changed them: ${r.reset.join(', ')}.`] : []),
                    ...r.notices,
                  ],
                })
              } catch (e) {
                outcomes.set('codex', { status: 'failed', lines: [describe(e)] })
              }
            }
            if (plan) {
              try {
                const o = await w.applyOpenCode(tx, plan)
                succeeded.push('opencode')
                // The override is recorded for the version it was given for, and dropped once OpenCode is a verified one again.
                const gate = versionGate(openCode, parsed.flags.has('allow-unverified-opencode'))
                const shown = versionOf(openCode)
                await mutateManifest(tx, (m) => {
                  const e = m.installs[plan!.key]
                  if (!e) return
                  if (gate.install && gate.unverified && shown !== null) e.allowUnverified = { openCodeVersion: shown }
                  else delete e.allowUnverified
                })
                outcomes.set('opencode', { status: o.status, lines: [`runtime ${rt.version}.`, ...o.notes] })
              } catch (e) {
                outcomes.set('opencode', { status: 'failed', lines: [describe(e)] })
              }
            }
            if (succeeded.length) {
              try {
                await activateRuntimeLocked(paths, env, rt, node)
              } catch (e) {
                // Their hooks check the active runtime and refuse to run against another one.
                for (const h of succeeded) {
                  outcomes.set(h, { status: 'failed', lines: [...outcomes.get(h)!.lines, `The runtime could not be activated (${describe(e)}): the hooks will not run until this install succeeds.`] })
                }
              }
            }
          })
        } catch (e) {
          for (const h of runtimeHarnesses) {
            if (!outcomes.has(h)) outcomes.set(h, { status: 'not touched', lines: [`The runtime could not be installed: ${describe(e)}`] })
          }
        }
      }
    } else {
      if (harnesses.includes('claude')) {
        try {
          const r = await w.uninstallClaude({ ctx, scope, ...(project ? { project } : {}), forgetMissingProject: parsed.flags.has('forget-missing-project') })
          outcomes.set('claude', r ? { status: 'uninstalled', lines: claudeUninstalled(r) } : { status: 'nothing to do', lines: ['This installer did not install it at this scope.'] })
        } catch (e) {
          outcomes.set('claude', { status: 'failed', lines: [describe(e)] })
        }
      }
      if (runtimeHarnesses.length) {
        try {
          await withStateLock(paths, env, async (lock) => {
            const tx: TxContext = { ...ctx, lock }
            if (runtimeHarnesses.includes('codex')) {
              try {
                const r = await w.uninstallCodex({ ctx: tx, scope, ...(project ? { project } : {}), forgetMissingProject: parsed.flags.has('forget-missing-project') })
                const done = r.removed.length > 0 || r.pluginRemoved || r.forgotten
                outcomes.set('codex', {
                  status: done ? 'uninstalled' : 'nothing to do',
                  lines: [
                    ...(r.forgotten ? ['The project is gone; its entry is forgotten.'] : []),
                    ...r.manual.map((m) => `Left for you: ${m.path} (${m.outcome}).`),
                    ...(r.hookTrust.length ? [`Remove these hook trust entries from config.toml yourself: ${r.hookTrust.join(', ')}.`] : []),
                  ],
                })
              } catch (e) {
                outcomes.set('codex', { status: 'failed', lines: [describe(e)] })
              }
            }
            if (runtimeHarnesses.includes('opencode')) {
              try {
                const where = scope === 'user' ? ('user' as const) : { project: project! }
                const r = await w.uninstallOpenCode(tx, { env, paths, scope: where, forgetMissingProject: parsed.flags.has('forget-missing-project') })
                const manual = r.filter((x) => !['deleted', 'restored', 'unmerged', 'missing'].includes(x.outcome))
                const ownFiles = await w.openCodeLeftovers({ env, paths, scope: where }).catch(() => [] as string[])
                outcomes.set('opencode', {
                  status: r.length ? 'uninstalled' : 'nothing to do',
                  lines: [
                    ...manual.map((m) => `Left for you: ${m.path} (${m.outcome}).`),
                    ...(ownFiles.length ? [`OpenCode's own files stay (it installed its plugin package there, not Dethereal): ${ownFiles.join(', ')}.`] : []),
                  ],
                })
              } catch (e) {
                outcomes.set('opencode', { status: 'failed', lines: [describe(e)] })
              }
            }
            await gcRuntimesLocked(paths, env)
          })
        } catch (e) {
          for (const h of runtimeHarnesses) if (!outcomes.has(h)) outcomes.set(h, { status: 'not touched', lines: [describe(e)] })
        }
      }
    }
    if (command === 'uninstall' && parsed.flags.has('purge-backups')) {
      // The first backups are the way back to a file as it was before any install: only when nothing is installed any more.
      const { manifest } = await readManifest(paths, env)
      if (Object.keys(manifest.installs).length === 0) {
        const n = await purgeAllBackups(ctx)
        io.stdout(`Backups removed: ${n}.\n`)
      } else {
        io.stdout('Backups kept: other installs remain, and their backups are the way back to your files as they were.\n')
      }
    }
    if (command === 'uninstall') {
      const { manifest } = await readManifest(paths, env)
      if (Object.keys(manifest.installs).length === 0 && (await fs.readdir(paths.runtime).catch(() => [] as string[])).length > 0) runtimeLeft = paths
    }
  } catch (e) {
    io.stderr(`dethereal ${command}: ${describe(e)}\n`)
    runtimeLeft = null
    return 1
  } finally {
    if (!runtimeLeft) deps.prompter?.close()
  }
  const version = await packageVersion(deps.packageRoot ?? await findPackageRoot()).catch(() => 'latest')
  const restartScope = scope === 'user' ? 'user' : 'project:'
  for (const [h, o] of outcomes) {
    if (o.status !== 'installed') continue
    const older = [...new Set(Object.entries(installedBefore ?? {}).filter(([k, e]) => k.startsWith(`${h}:${restartScope}`) && e.version !== version).map(([, e]) => e.version))]
    if (older.length) o.lines.push(`Restart any open ${SHOWN[h]} session: it keeps running ${older.join(', ')} until then.`)
  }
  const { text, failed } = report(command, outcomes, version)
  io.stdout(text)
  if (runtimeLeft && !(await offerRuntimeRemoval(runtimeLeft, env, io, interactive ? deps.prompter : undefined))) return 1
  return failed.length ? 1 : 0
}

/** The runtime folder as the user knows it. */
function shownPath(p: string, env: InstallerEnv): string {
  return p.startsWith(env.home + path.sep) ? `~${p.slice(env.home.length)}` : p
}

/**
 * After the last install is gone: on a terminal, ask whether to remove the runtime too; otherwise keep it
 * and say how to remove it. Only the runtime folder is touched, never the sign-in files beside it.
 * Resolves to false when the removal failed.
 */
async function offerRuntimeRemoval(paths: StatePaths, env: InstallerEnv, io: InstallerIo, prompter: Prompter | undefined): Promise<boolean> {
  const where = shownPath(paths.runtime, env)
  try {
    if (!prompter || !(await askProceed(prompter, `Also remove the Dethereal runtime (in ${where})?`))) {
      io.stdout(`The Dethereal runtime stays in ${where}: \`dethereal gc\` removes it.\n`)
      return true
    }
  } finally {
    prompter?.close()
  }
  try {
    const { removed, left } = await withStateLock(paths, env, () => removeRuntimeLocked(paths, env))
    io.stdout(`${removed.length ? `Runtime removed: ${removed.join(', ')}. Restart any session that was still open.` : 'Nothing to remove.'}\n`)
    if (left.length) io.stdout(`Kept in ${where}: ${left.join(', ')} (quarantined copies, or files the installer did not make: look at them, then remove them yourself).\n`)
    return true
  } catch (e) {
    io.stderr(`dethereal uninstall: the runtime could not be removed: ${describe(e)}\n`)
    return false
  }
}

async function askProceed(prompter: Prompter, question: string): Promise<boolean> {
  try {
    return await prompter.confirm(question)
  } catch {
    return false
  }
}

/** The platform URL Claude Code already keeps for a Dethereal plugin, if it is a usable one. */
async function currentClaudeUrl(env: InstallerEnv): Promise<string | null> {
  try {
    const settings = await readSettings(await userSettingsFile(env))
    // The official marketplace's plugin first: the one an install without --claude-marketplace configures.
    const official = `${PLUGIN_NAME}@${OFFICIAL_MARKETPLACE_NAME}`
    const ids = Object.keys((settings.pluginConfigs as Record<string, unknown> | undefined) ?? {}).filter((k) => k.startsWith(`${PLUGIN_NAME}@`)).sort()
      .sort((a, b) => Number(b === official) - Number(a === official))
    for (const id of ids) {
      const v = configuredUrl(settings, id)
      if (v) return normalisePlatformUrl(v)
    }
  } catch {
    // An unreadable or unusable value: the package default is offered instead.
  }
  return null
}

/**
 * The URL each runtime harness's install recorded at this scope, where its entry is still as installed and the
 * URL usable. Read without creating the state folder; anything unreadable counts as none.
 */
async function installedUrls(w: Writers, env: InstallerEnv, harnesses: readonly HarnessName[], scope: ClaudeScope, project: string | undefined): Promise<Partial<Record<'codex' | 'opencode', string>>> {
  const out: Partial<Record<'codex' | 'opencode', string>> = {}
  const state = await inspectStateRoot(env).catch(() => null)
  if (!state?.exists) return out
  const where = scope === 'user' ? ('user' as const) : { project: project! }
  for (const h of ['codex', 'opencode'] as const) {
    if (!harnesses.includes(h)) continue
    const v = await (h === 'codex' ? w.installedCodexUrl : w.installedOpenCodeUrl)({ env, paths: state.paths, scope: where }).catch(() => null)
    try {
      if (v) out[h] = normalisePlatformUrl(v)
    } catch {
      // An unusable recorded URL is not kept.
    }
  }
  return out
}

/** The harnesses this installer has an entry for. */
async function installedHarnesses(env: InstallerEnv): Promise<HarnessName[]> {
  const { paths, exists } = await inspectStateRoot(env)
  if (!exists) return []
  const keys = Object.keys((await readManifest(paths, env)).manifest.installs)
  return HARNESS_ORDER.filter((h) => keys.some((k) => k.startsWith(`${h}:`)))
}

const MARK: Record<DoctorCheck['status'], string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' }

async function doctorCommand(parsed: ReturnType<typeof parse>, io: InstallerIo, deps: InstallerDeps, env: InstallerEnv): Promise<number> {
  try {
    const harnesses = parsed.values.has('harness') ? harnessesOf(parsed.values.get('harness')!) : [...HARNESS_ORDER]
    // Doctor writes nothing, not even the state folder.
    const { paths, exists, loose } = await inspectStateRoot(env)
    const projectArg = parsed.values.get('project')
    const packageRoot = deps.packageRoot ?? await findPackageRoot()
    if (parsed.flags.has('live-opencode')) io.stderr('doctor: --live-opencode runs OpenCode with its plugins loaded: your own, and in a project the project\'s own too, whose dependencies it may install and whose MCP servers it may start. Outside a project it runs from the filesystem root with project configuration off.\n')
    const checks = await runDoctor({
      ctx: { paths, env }, stateExists: exists, looseState: loose, packageRoot, harnesses, ...(projectArg ? { project: path.resolve(projectArg) } : {}),
      liveOpenCode: parsed.flags.has('live-opencode'), openCodeVersion: deps.writers?.openCodeVersion ?? openCodeVersion,
      ...(deps.probe ? { probe: deps.probe } : {}),
      ...(deps.openCodeMcpList ? { openCodeMcpList: deps.openCodeMcpList } : {}),
    })
    if (parsed.flags.has('json')) {
      // The tools by approval, which the install summary gives only as categories; the text view leaves them out.
      checks.push({ subject: 'tools', label: 'tool approvals', status: 'ok', detail: `${AUTO_TOOLS.length} run without asking: ${AUTO_TOOLS.join(', ')}; ${PROMPT_TOOLS.length} ask first: ${PROMPT_TOOLS.join(', ')}` })
      io.stdout(JSON.stringify(checks.map((c) => ({ subject: c.subject, label: c.label, status: c.status, ...(c.detail ? { detail: c.detail } : {}), ...(c.fix ? { fix: c.fix } : {}) })), null, 2) + '\n')
    } else {
      const lines: string[] = [`Dethereal doctor ${await packageVersion(packageRoot)}`]
      let subject = ''
      for (const c of checks) {
        if (c.subject !== subject) { subject = c.subject; lines.push('', `${subject}:`) }
        lines.push(`  ${MARK[c.status]}  ${c.label}${c.detail ? `: ${c.detail}` : ''}`)
        if (c.fix && c.status !== 'ok') lines.push(`        fix: ${c.fix}`)
      }
      io.stdout(lines.join('\n') + '\n')
    }
    return checks.some((c) => c.status === 'fail') ? 1 : 0
  } catch (e) {
    io.stderr(`dethereal doctor: ${describe(e)}\n`)
    return 1
  }
}

async function gcCommand(parsed: ReturnType<typeof parse>, io: InstallerIo, deps: InstallerDeps, env: InstallerEnv): Promise<number> {
  const interactive = !parsed.flags.has('yes') && (deps.tty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true && !env.vars.CI))
  if (!parsed.flags.has('yes') && !interactive) {
    io.stderr(`dethereal gc: off a terminal, gc needs --yes\n${USAGE}\n`)
    return 2
  }
  try {
    if (interactive) {
      const prompter = deps.prompter ?? readlinePrompter(process.stdin, process.stdout)
      try {
        if (!(await askProceed(prompter, 'Remove installed runtimes nothing uses any more? A session still open may be running one: restart open sessions first.'))) {
          io.stdout('Nothing changed.\n')
          return 0
        }
      } finally {
        prompter.close()
      }
    }
    const { paths } = await ensureStateRoot(env)
    // An explicit gc removes the current runtime too once no install uses it.
    const removed = await withStateLock(paths, env, () => gcRuntimesLocked(paths, env, { keepCurrent: 'while-used' }))
    io.stdout(removed.length ? `Removed: ${removed.join(', ')}. Restart any session that was still open.\n` : 'Nothing to remove.\n')
    return 0
  } catch (e) {
    io.stderr(`dethereal gc: ${describe(e)}\n`)
    return 1
  }
}
