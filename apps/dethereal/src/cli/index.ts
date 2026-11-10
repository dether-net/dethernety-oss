/**
 * Command-line entry: the same executable as the MCP server, run with arguments.
 *
 *   hook session-start --source startup|resume|clear|compact [--harness claude|codex|opencode] [--settlement]
 *   hook post-write [--harness claude|codex|opencode]      (the harness event on stdin)
 *   hook config-guard [--harness claude|codex|opencode]    (the harness event on stdin)
 *   hook approve [--harness claude] [--settlement]         (the harness event on stdin)
 *   hook secret-guard [--harness claude|codex|opencode]    (the harness event on stdin)
 *   workspace-status --json [--settlement]
 *
 * `--settlement`: the bundle has the settlement on, for a harness that gives its hooks no environment.
 *   install|uninstall|doctor|gc …                         (the installer; see installer/cli)
 *   help
 *
 * Harnesses run the hook commands as argv (never through a shell). A hook never
 * blocks a session by itself: an unusable invocation exits 1 with a one-line reason on
 * stderr, never 2 (on a Node too old to run, the entry stops a guard with 2 before this
 * loads; see node-floor.ts). On Claude Code 2.1.295 or later the two guards carry
 * `onFailure: "block"`, so there any exit of theirs other than 0 or 2 blocks the call.
 * Only post-write, config-guard, approve and secret-guard read stdin (bounded in size
 * and time); nothing but the command's output is written to stdout. config-guard denies a write
 * through its output, and on an event it cannot read it recovers the target path from the raw
 * stream (see config-guard.ts). secret-guard denies a read of a secret file the same way, and
 * denies a read or search it cannot check, whatever fails, a wrong --harness included (see
 * secret-guard.ts).
 *
 * Each command loads its own modules when it runs: post-write fires on every file
 * write and must stay fast.
 */

import os from 'node:os'
import path from 'node:path'
import { COMPACT_MODEL_LIMIT, HARNESSES, SESSION_SOURCES, renderSessionStart } from './session-start.js'
import type { RawEvent } from './config-guard.js'

/** The largest harness event read from stdin; a Write event carries the whole file. */
const MAX_EVENT_BYTES = 32 * 1024 * 1024
/** How long a harness may take to deliver and close stdin. */
const EVENT_TIMEOUT_MS = 3000

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
  /** The whole of stdin, or null when it is absent, too large or too slow (default: the process's) */
  stdin?: () => Promise<string | null>
  /** The PreToolUse event for the config guard (default: the process's stdin, scanned as it streams) */
  guardEvent?: () => Promise<RawEvent>
}

/** Read stdin to its end, within a size and a time limit. */
function readStdin(): Promise<string | null> {
  const input = process.stdin
  if (input.isTTY) return Promise.resolve(null)
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    const done = (value: string | null) => {
      clearTimeout(timer)
      input.removeAllListeners('data')
      input.removeAllListeners('end')
      input.removeAllListeners('error')
      // An open pipe would keep the process alive.
      input.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => done(null), EVENT_TIMEOUT_MS)
    input.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_EVENT_BYTES) done(null)
      else chunks.push(chunk)
    })
    input.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    input.on('error', () => done(null))
  })
}

const USAGE = `Usage:
  dethereal                                   run the MCP server (stdio)
  dethereal hook session-start --source <startup|resume|clear|compact> [--harness <claude|codex|opencode>] [--settlement]
  dethereal hook post-write [--harness <claude|codex|opencode>]   (reads the harness event on stdin)
  dethereal hook config-guard [--harness claude|codex|opencode]   (reads the harness event on stdin)
  dethereal hook approve [--harness claude] [--settlement]        (reads the harness event on stdin)
  dethereal hook secret-guard [--harness claude|codex|opencode]   (reads the harness event on stdin)
  dethereal workspace-status --json [--settlement]
  dethereal install   --harness <claude,codex,opencode> --scope user|project [--project <dir>] [--platform-url <url>] [--yes]
  dethereal uninstall --harness <claude,codex,opencode> --scope user|project [--project <dir>] [--yes]
  dethereal doctor    [--harness <claude,codex,opencode>] [--project <dir>] [--live-opencode] [--json]
  dethereal gc        [--yes]
  dethereal help`

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdin: readStdin
}

/** `--name value` or `--name=value`; undefined when absent. */
function option(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === `--${name}`) return args[i + 1] ?? ''
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
  }
  return undefined
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value)
}

async function sessionStart(args: string[], io: CliIo): Promise<number> {
  const source = option(args, 'source')
  if (!oneOf(SESSION_SOURCES, source)) {
    io.stderr(`dethereal hook session-start: --source must be one of ${SESSION_SOURCES.join(', ')}\n`)
    return 1
  }
  const harnessArg = option(args, 'harness')
  if (harnessArg !== undefined && !oneOf(HARNESSES, harnessArg)) {
    io.stderr(`dethereal hook session-start: --harness must be one of ${HARNESSES.join(', ')}\n`)
    return 1
  }
  const { initProjectRoot } = await import('../utils/project-root.js')
  const { collectWorkspaceStatus } = await import('../tools/workspace-status.tool.js')
  const { hookSettlement } = await import('../utils/settlement-switch.js')
  initProjectRoot()
  // Startup shows the first model only; the compaction reminder lists a few.
  const status = await collectWorkspaceStatus({
    maxModels: source === 'compact' ? COMPACT_MODEL_LIMIT : 1,
    stateMaxBytes: 256 * 1024,
    qualityMaxBytes: 64 * 1024,
    settlement: hookSettlement(args)
  })
  io.stdout(renderSessionStart(status, source, harnessArg) + '\n')
  return 0
}

async function postWriteHook(args: string[], io: CliIo): Promise<number> {
  const harnessArg = option(args, 'harness')
  if (harnessArg !== undefined && !oneOf(HARNESSES, harnessArg)) {
    io.stderr(`dethereal hook post-write: --harness must be one of ${HARNESSES.join(', ')}\n`)
    return 1
  }
  const raw = await (io.stdin ?? readStdin)()
  if (!raw) return 0
  let event: unknown
  try {
    event = JSON.parse(raw)
  } catch {
    return 0
  }
  const { postWrite } = await import('./post-write.js')
  const output = await postWrite(event, harnessArg)
  if (output) io.stdout(output + '\n')
  return 0
}

async function configGuardHook(args: string[], io: CliIo): Promise<number> {
  const harnessArg = option(args, 'harness')
  if (harnessArg === 'codex') return configGuardCodex(io)
  if (harnessArg === 'opencode') return configGuardOpenCode(io)
  if (harnessArg !== undefined && harnessArg !== 'claude') {
    io.stderr('dethereal hook config-guard: --harness must be claude, codex or opencode\n')
    return 1
  }
  const { decideConfigWrite, guardOutput, processGuardEnv, readGuardEvent } = await import('./config-guard.js')
  const raw = await (io.guardEvent ?? readGuardEvent)()
  const output = guardOutput(decideConfigWrite(raw, processGuardEnv()))
  if (output) io.stdout(output + '\n')
  return 0
}

/** A Codex call the guard could not check: denied, in the output both harnesses read. */
const codexDenial = (reason: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) + '\n'

/**
 * The config guard on Codex, where every write is a patch: the decision, then no update or move of a
 * project secret file (a new name, or content without its marks, would make it readable). It fails
 * closed: an event it cannot read whole, or any error, denies.
 */
async function configGuardCodex(io: CliIo): Promise<number> {
  const unchecked = 'Dethereal: this patch could not be checked, so it is not run.'
  try {
    const { decideConfigWrite, guardOutput, patchOperations, processGuardEnv, readGuardEvent } = await import('./config-guard.js')
    const raw = await (io.guardEvent ?? readGuardEvent)()
    if (raw.text === null) {
      io.stdout(codexDenial(unchecked))
      return 0
    }
    const g = processGuardEnv()
    const decision = decideConfigWrite(raw, g)
    if (decision.deny) {
      io.stdout(guardOutput(decision) + '\n')
      return 0
    }
    const event = JSON.parse(raw.text) as { tool_name?: unknown; tool_input?: { command?: unknown }; cwd?: unknown }
    if (event.tool_name !== 'apply_patch') return 0
    const cwd = typeof event.cwd === 'string' && path.isAbsolute(event.cwd) ? event.cwd : g.cwd
    const ops = patchOperations(String(event.tool_input?.command ?? '')) ?? []
    const { processSecretGuardEnv, projectSecretFile } = await import('./secret-guard.js')
    const sg = processSecretGuardEnv()
    // An update names the file it changes, or the one a move starts from.
    for (const source of new Set(ops.filter((o) => o.kind === 'update').map((o) => o.path))) {
      const verdict = projectSecretFile(path.resolve(cwd, source), cwd, sg)
      if (verdict?.deny) {
        io.stdout(codexDenial(verdict.reason))
        return 0
      }
    }
  } catch {
    io.stdout(codexDenial(unchecked))
  }
  return 0
}

/**
 * The config guard for OpenCode's plugin, before every file write: the config guard's decision on the
 * write as Claude would make it (the server's folder, harness configuration, definitions, plugin
 * folders), then no edit, update or move of a project secret file (a new name, or content without its
 * marks, would make it readable). The answer in the plugin's shape; anything unreadable or failing
 * denies.
 */
async function configGuardOpenCode(io: CliIo): Promise<number> {
  const denied = (reason: string) => io.stdout(JSON.stringify({ deny: true, reason }) + '\n')
  try {
    const { decideConfigWrite, openCodeWriteEvent, patchOperations, processGuardEnv, rawEventFrom, readGuardEvent } = await import('./config-guard.js')
    const raw = await (io.guardEvent ?? readGuardEvent)()
    const event = raw.text === null ? undefined : (JSON.parse(raw.text) as { tool?: unknown; directory?: unknown; args?: Record<string, unknown> })
    const mapped = openCodeWriteEvent(event)
    if (!mapped) {
      denied('Dethereal: this write could not be checked, so it is not run.')
      return 0
    }
    const g = processGuardEnv()
    const cwd = typeof event?.directory === 'string' && path.isAbsolute(event.directory) ? event.directory : g.cwd
    const decision = decideConfigWrite(rawEventFrom(mapped.text), { ...g, cwd })
    if (decision.deny) {
      denied(decision.reason)
      return 0
    }
    const args = event?.args ?? {}
    const sources =
      mapped.tool === 'edit' || mapped.tool === 'multiedit'
        ? [String(args.filePath ?? '')]
        : mapped.tool === 'patch' || mapped.tool === 'apply_patch'
          ? (patchOperations(String(args.patchText ?? '')) ?? []).filter((o) => o.kind === 'update').map((o) => o.path)
          : []
    const { processSecretGuardEnv, projectSecretFile } = await import('./secret-guard.js')
    const sg = processSecretGuardEnv()
    for (const source of new Set(sources.filter(Boolean))) {
      const verdict = projectSecretFile(path.resolve(cwd, source), cwd, { ...sg, cwd })
      if (verdict?.deny) {
        denied(verdict.reason)
        return 0
      }
    }
    io.stdout('{"deny":false}\n')
  } catch {
    denied('Dethereal: this write could not be checked (an internal error), so it is not run.')
  }
  return 0
}

/** The secret guard on Codex: its decision, and a denial for anything that fails. */
async function secretGuardCodex(io: CliIo): Promise<number> {
  try {
    const { guardOutput, readGuardEvent } = await import('./config-guard.js')
    const raw = await (io.guardEvent ?? readGuardEvent)()
    const { decideCodexAccess, processSecretGuardEnv } = await import('./secret-guard.js')
    const output = guardOutput(decideCodexAccess(raw, processSecretGuardEnv()))
    if (output) io.stdout(output + '\n')
  } catch {
    io.stdout(codexDenial('dethereal-secret-guard: this call could not be checked for secret files (an internal error), so it is not run.'))
  }
  return 0
}

async function approveHook(args: string[], io: CliIo): Promise<number> {
  const harnessArg = option(args, 'harness')
  if (harnessArg !== undefined && harnessArg !== 'claude') {
    io.stderr('dethereal hook approve: --harness must be claude\n')
    return 1
  }
  const { approveOutput } = await import('./approve.js')
  const { hookSettlement } = await import('../utils/settlement-switch.js')
  const output = approveOutput(await (io.stdin ?? readStdin)(), hookSettlement(args))
  if (output) io.stdout(output + '\n')
  return 0
}

/** The guard's denial when it cannot run at all: a read or search it could not check is not run. */
const UNCHECKED_DENIAL = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'dethereal-secret-guard: this call could not be checked for secret files (an internal error), so it is not run.',
  },
})

async function secretGuardHook(args: string[], io: CliIo): Promise<number> {
  const harnessArg = option(args, 'harness')
  if (harnessArg === 'opencode') return secretGuardOpenCode(io)
  if (harnessArg === 'codex') return secretGuardCodex(io)
  if (harnessArg !== undefined && harnessArg !== 'claude') {
    // A guard wired wrongly still fails closed: it denies, where another hook would exit 1 and let the call run.
    io.stderr('dethereal hook secret-guard: --harness must be claude, codex or opencode\n')
    io.stdout(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `dethereal-secret-guard: this call is not run: the guard is wired with --harness ${JSON.stringify(harnessArg.slice(0, 32))}, and it checks only the calls of Claude Code, Codex and OpenCode (--harness claude, codex or opencode).`,
        },
      }) + '\n',
    )
    return 0
  }
  let raw: RawEvent | undefined
  try {
    const { guardOutput, readGuardEvent } = await import('./config-guard.js')
    raw = await (io.guardEvent ?? readGuardEvent)()
    const { decideSecretAccess, processSecretGuardEnv } = await import('./secret-guard.js')
    const output = guardOutput(decideSecretAccess(raw, processSecretGuardEnv()))
    if (output) io.stdout(output + '\n')
  } catch {
    // Fail closed for a read or a search. A shell command is judged by name: denied when any of its
    // words names a secret file or guarded configuration, run otherwise.
    const tool = raw?.fields.get('tool_name')?.[0]
    const command = raw?.fields.get('command')?.[0]
    let named: boolean
    try {
      const { commandNamesGuarded, guardedHomes } = await import('../utils/secret-fallback.mjs')
      const { codexHome, claudeConfig, vars } = guardedHomes(process.env, os.homedir())
      named = command === undefined || commandNamesGuarded(command, codexHome, claudeConfig, vars)
    } catch {
      named = true
    }
    if (tool !== 'Bash' || named) io.stdout(UNCHECKED_DENIAL + '\n')
  }
  return 0
}

/** The guard for OpenCode's plugin: the decision in its own shape; whatever fails, a denial. */
async function secretGuardOpenCode(io: CliIo): Promise<number> {
  try {
    const { readGuardEvent } = await import('./config-guard.js')
    const raw = await (io.guardEvent ?? readGuardEvent)()
    const { decideOpenCodeAccess, openCodeOutput, processSecretGuardEnv } = await import('./secret-guard.js')
    io.stdout(openCodeOutput(decideOpenCodeAccess(raw, processSecretGuardEnv())) + '\n')
  } catch {
    io.stdout(JSON.stringify({ deny: true, reason: 'dethereal-secret-guard: this call could not be checked for secret files (an internal error), so it is not run.' }) + '\n')
  }
  return 0
}

async function hook(args: string[], io: CliIo): Promise<number> {
  const [event, ...rest] = args
  if (event === 'session-start') return sessionStart(rest, io)
  if (event === 'post-write') return postWriteHook(rest, io)
  if (event === 'config-guard') return configGuardHook(rest, io)
  if (event === 'approve') return approveHook(rest, io)
  if (event === 'secret-guard') return secretGuardHook(rest, io)
  io.stderr(`dethereal hook: unknown hook ${JSON.stringify(String(event ?? '').slice(0, 32))}; expected session-start, post-write, config-guard, approve or secret-guard\n`)
  return 1
}

async function workspaceStatus(args: string[], io: CliIo): Promise<number> {
  if (!args.includes('--json')) {
    io.stderr('dethereal workspace-status: only --json output is supported\n')
    return 2
  }
  const { initProjectRoot } = await import('../utils/project-root.js')
  const { collectWorkspaceStatus } = await import('../tools/workspace-status.tool.js')
  const { hookSettlement } = await import('../utils/settlement-switch.js')
  initProjectRoot()
  io.stdout(JSON.stringify(await collectWorkspaceStatus({ settlement: hookSettlement(args) }), null, 2) + '\n')
  return 0
}

/** Run a CLI command; resolves to the process exit code. Never rejects. */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...args] = argv
  try {
    switch (command) {
      case 'hook':
        return await hook(args, io)
      case 'workspace-status':
        return await workspaceStatus(args, io)
      case 'install':
      case 'uninstall':
      case 'doctor':
      case 'gc': {
        // A folder removed from under the shell: say so rather than fail on the first module that asks for it.
        try {
          process.cwd()
        } catch {
          io.stderr(`dethereal ${command}: the current folder no longer exists; cd to an existing folder and run it again\n`)
          return 1
        }
        const { runInstaller } = await import('../installer/cli/index.js')
        return await runInstaller(command, args, io)
      }
      case 'help':
      case '--help':
        io.stdout(USAGE + '\n')
        return 0
      default:
        io.stderr(USAGE + '\n')
        return 2
    }
  } catch {
    // Error text can carry repository paths or content; the reason stays generic.
    io.stderr(`dethereal ${command === 'hook' ? 'hook' : 'command'}: internal error\n`)
    return 1
  }
}
